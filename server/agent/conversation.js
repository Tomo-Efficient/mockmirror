import crypto from 'node:crypto';
import { store, save } from '../store.js';
import { isLLMEnabled, chat, streamChat, extractJson } from '../llm.js';
import { LIMITS } from '../config.js';
import { runStartGraph, runTurnGraph, traceStep } from './graph.js';
import { evaluationMessages, reportMessages, interviewerMessages } from './prompts.js';
import {
  openingMessage, composeReply, summarizeMemory, localReport, personaOf, personas
} from './local.js';
import { analyzeJD } from '../jd.js';

const DIMS = ['structure', 'relevance', 'depth', 'impact', 'fit'];
const WEIGHTS = { structure: 0.2, relevance: 0.25, depth: 0.25, impact: 0.2, fit: 0.1 };
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeConfig(raw = {}) {
  const personaIds = personas().map((p) => p.id);
  return {
    persona: personaIds.includes(raw.persona) ? raw.persona : (personaIds[1] || 'senior'),
    rounds: Math.max(LIMITS.rounds.min, Math.min(LIMITS.rounds.max, Number(raw.rounds) || 6)),
    focus: ['balanced', 'deep', 'behavior', 'pressure'].includes(raw.focus) ? raw.focus : 'balanced',
    roleName: String(raw.roleName || '').slice(0, 60)
  };
}

export async function createSession({ resume, jdText, config }) {
  const profile = resume.profile;
  const cfg = normalizeConfig(config);
  const analysis = analyzeJD({ jdText, profile });
  if (!cfg.roleName) cfg.roleName = analysis.roleName;

  const session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    resumeId: resume.id,
    profile,
    jd: { text: jdText, title: analysis.title, analysis },
    config: cfg,
    plan: { rounds: [], cursor: 0, opening: '', closing: '', source: 'local' },
    pending: null,
    messages: [],
    evaluations: [],
    trace: [],
    memory: { summary: '', topics: [] },
    metrics: { avgScore: 0, answered: 0, hintCount: 0, skipCount: 0, probeCount: 0, startedAt: Date.now() },
    report: null
  };

  const { state, steps } = await runStartGraph({ profile, jd: session.jd, config: cfg, session });
  session.plan = { ...state.plan, cursor: 0 };
  steps.forEach((step) => {
    if (step.node === 'ask_question') {
      session.trace.push({
        id: `ask-${Date.now()}`,
        node: 'ask_question',
        label: '提问',
        detail: `第 1 题 · ${state.plan.rounds[0].stage}`,
        at: new Date().toISOString(),
        ms: step.ms,
        tone: 'ok'
      });
    } else {
      traceStep(session, step, state);
    }
  });

  const first = state.plan.rounds[0];
  session.pending = { question: first, index: 0, followUpIndex: 0, kind: 'main' };
  session.messages.push({
    id: crypto.randomUUID(),
    role: 'interviewer',
    kind: 'question',
    content: openingMessage({ personaId: cfg.persona, plan: session.plan, profile, rounds: cfg.rounds }),
    at: new Date().toISOString(),
    questionIndex: 0
  });
  session.messages.push({
    id: crypto.randomUUID(),
    role: 'system',
    kind: 'guide',
    content: '回答不用完美，把背景、你的动作和结果讲清楚就够了。需要帮助可以点「给点提示」，也可以跳过。',
    at: new Date().toISOString()
  });

  store.sessions.unshift(session);
  if (store.sessions.length > 200) store.sessions.length = 200;
  save();
  return publicSession(session);
}

function normalizeEvaluation(raw, local, question) {
  const scores = {};
  for (const d of DIMS) {
    scores[d] = clamp(raw?.scores?.[d] ?? local.scores[d]);
  }
  const total = clamp(DIMS.reduce((n, d) => n + scores[d] * WEIGHTS[d], 0));
  return {
    scores,
    total,
    verdict: total >= 82 ? '强' : total >= 68 ? '稳' : total >= 52 ? '待加强' : '风险',
    strengths: (Array.isArray(raw?.strengths) && raw.strengths.length ? raw.strengths : local.strengths).slice(0, 4).map(String),
    risks: (Array.isArray(raw?.risks) && raw.risks.length ? raw.risks : local.risks).slice(0, 4).map(String),
    coaching: String(raw?.coaching || local.coaching),
    rewrite: String(raw?.rewrite || local.rewrite).slice(0, 900),
    citations: local.citations,
    answerPoints: question.answerPoints || [],
    reference: question.starExample || '',
    mode: raw ? 'llm' : 'local'
  };
}

async function evaluateWithLLM({ session, question, answer, local }) {
  try {
    const content = await chat(evaluationMessages(session, { question, answer }), { json: true, maxTokens: 900, temperature: 0.3 });
    const raw = extractJson(content);
    if (!raw || !raw.scores) throw new Error('评分结果无法解析');
    return normalizeEvaluation(raw, local, question);
  } catch (err) {
    console.warn('[eval] LLM 评估失败，使用本地评分：', err.message);
    return { ...normalizeEvaluation(null, local, question), warning: err.message };
  }
}

async function* streamLocal(text, { delay = 14 } = {}) {
  const chunk = 3;
  for (let i = 0; i < text.length; i += chunk) {
    yield text.slice(i, i + chunk);
    if (delay) await sleep(delay);
  }
}

function updateMetrics(session) {
  const answered = session.evaluations.length;
  session.metrics.answered = answered;
  session.metrics.avgScore = answered ? Math.round(session.evaluations.reduce((n, e) => n + e.total, 0) / answered) : 0;
  session.metrics.durationSec = Math.round((Date.now() - session.metrics.startedAt) / 1000);
}

export async function* streamTurn(session, rawAnswer, { signal } = {}) {
  if (!session.pending || session.status !== 'active') throw new Error('本场面试已经结束');
  const answer = String(rawAnswer || '').trim().slice(0, LIMITS.answerChars);
  if (answer.length < 1) throw new Error('请先输入你的回答');

  const question = session.pending.question;
  const now = new Date().toISOString();
  session.messages.push({ id: crypto.randomUUID(), role: 'candidate', kind: 'answer', content: answer, at: now, questionIndex: session.plan.cursor });

  const { state, steps } = await runTurnGraph({ session, answer });
  steps.forEach((step) => traceStep(session, step, { ...state, session }));

  const nextQuestion = state.nextQuestion;
  const localEval = state.preEval;
  const localReply = state.decision === 'finish'
    ? composeReply({ decision: 'finish', evaluation: localEval, personaId: session.config.persona, profile: session.profile })
    : composeReply({
        decision: state.decision,
        question: nextQuestion,
        evaluation: localEval,
        personaId: session.config.persona
      });

  yield { type: 'meta', decision: state.decision, questionIndex: session.plan.cursor, question: nextQuestion ? { text: nextQuestion.text, stage: nextQuestion.stage, intent: nextQuestion.intent } : null };

  const evalPromise = isLLMEnabled()
    ? evaluateWithLLM({ session, question, answer, local: localEval })
    : Promise.resolve({ ...normalizeEvaluation(null, localEval, question) });

  let reply = '';
  let streamError = null;
  if (isLLMEnabled()) {
    try {
      const messages = interviewerMessages(session, {
        decision: state.decision,
        nextQuestion,
        preEvaluation: localEval,
        memory: session.memory
      });
      for await (const delta of streamChat(messages, { maxTokens: 320, temperature: 0.65, signal })) {
        reply += delta;
        yield { type: 'delta', text: delta };
      }
    } catch (err) {
      streamError = err.message;
    }
  }

  if (!reply.trim()) {
    for await (const delta of streamLocal(localReply)) {
      reply += delta;
      yield { type: 'delta', text: delta };
    }
  }

  const evaluation = await evalPromise;

  const record = {
    id: crypto.randomUUID(),
    index: session.evaluations.length + 1,
    question: { id: question.id, text: question.text, stage: question.stage, intent: question.intent, tags: question.tags },
    isProbe: session.pending?.kind === 'probe',
    answer,
    ...evaluation,
    at: new Date().toISOString()
  };
  session.evaluations.push(record);
  session.messages.push({
    id: crypto.randomUUID(),
    role: 'interviewer',
    kind: state.decision === 'probe' ? 'probe' : state.decision === 'finish' ? 'closing' : 'question',
    content: reply.trim(),
    at: new Date().toISOString(),
    questionIndex: session.plan.cursor
  });

  if (state.decision === 'probe') session.metrics.probeCount = (session.metrics.probeCount || 0) + 1;
  if (state.decision === 'finish') {
    session.status = 'completed';
    session.pending = null;
    session.finishedAt = new Date().toISOString();
    session.messages.push({
      id: crypto.randomUUID(),
      role: 'system',
      kind: 'finish',
      content: '本场面试已结束，可以生成复盘报告。',
      at: new Date().toISOString()
    });
  } else {
    session.pending = {
      question: nextQuestion,
      index: state.nextIndex,
      followUpIndex: state.nextFollowUp,
      kind: state.decision === 'probe' ? 'probe' : 'main'
    };
    if (state.decision === 'next') session.plan.cursor = state.nextIndex;
  }

  session.memory = summarizeMemory(session.messages, session.evaluations);
  session.updatedAt = new Date().toISOString();
  session.lastError = streamError || evaluation.warning || null;
  updateMetrics(session);
  save();

  yield { type: 'evaluation', evaluation: record };
  yield { type: 'state', session: publicSession(session) };
}

export function getHint(session) {
  if (!session.pending) throw new Error('本场面试已经结束');
  const q = session.pending.question;
  const points = (q.answerPoints || []).slice(0, 3);
  const tip = (q.citations && q.citations[0]) || null;
  session.metrics.hintCount += 1;
  session.messages.push({
    id: crypto.randomUUID(),
    role: 'system',
    kind: 'hint',
    content: `提示：可以从这几个角度展开——${points.join('；')}`,
    at: new Date().toISOString()
  });
  save();
  return { points, tip, question: q.text };
}

export function skipQuestion(session) {
  if (!session.pending) throw new Error('本场面试已经结束');
  session.metrics.skipCount += 1;
  const skipped = session.pending.question;
  session.messages.push({
    id: crypto.randomUUID(),
    role: 'system',
    kind: 'skip',
    content: `（跳过：${skipped.text.slice(0, 40)}）`,
    at: new Date().toISOString()
  });
  const nextIndex = session.plan.cursor + 1;
  let text;
  let finished = false;
  if (nextIndex >= session.plan.rounds.length) {
    finished = true;
    text = composeReply({ decision: 'finish', personaId: session.config.persona, profile: session.profile });
    session.status = 'completed';
    session.pending = null;
    session.finishedAt = new Date().toISOString();
  } else {
    session.plan.cursor = nextIndex;
    const q = session.plan.rounds[nextIndex];
    session.pending = { question: q, index: nextIndex, followUpIndex: 0, kind: 'main' };
    text = `好，这题先跳过。${q.text}`;
    session.messages.push({
      id: crypto.randomUUID(),
      role: 'interviewer',
      kind: 'question',
      content: text,
      at: new Date().toISOString()
    });
    session.trace.push({
      id: `skip-${Date.now()}`,
      node: 'ask_question',
      label: '提问',
      detail: `第 ${nextIndex + 1} 题 · ${q.stage}（跳过一题）`,
      at: new Date().toISOString(),
      ms: 0,
      tone: 'warn'
    });
  }
  session.updatedAt = new Date().toISOString();
  save();
  return { message: text, finished, session: publicSession(session) };
}

async function buildLLMReport(session) {
  const base = localReport({ session });
  session.report = base;
  const content = await chat(reportMessages(session), { json: true, maxTokens: 1400, temperature: 0.5 });
  const raw = extractJson(content);
  if (!raw) throw new Error('报告解析失败');
  const readiness = clamp(raw.readiness ?? base.readiness);
  return {
    ...base,
    readiness,
    headline: String(raw.headline || base.headline),
    narrative: String(raw.narrative || base.narrative),
    strengths: Array.isArray(raw.strengths) && raw.strengths.length ? raw.strengths.slice(0, 4) : base.strengths,
    risks: Array.isArray(raw.risks) && raw.risks.length ? raw.risks.slice(0, 4) : base.risks,
    actions: Array.isArray(raw.actions) && raw.actions.length ? raw.actions.slice(0, 4) : base.actions,
    mode: 'llm'
  };
}

export async function finishSession(session, { force = false } = {}) {
  if (!force && session.status === 'finished' && session.report) return publicSession(session);
  const base = localReport({ session });
  session.report = base;
  if (isLLMEnabled()) {
    try {
      session.report = await buildLLMReport(session);
    } catch (err) {
      console.warn('[report] LLM 报告失败，使用本地报告：', err.message);
      session.report = base;
      session.report.warning = err.message;
    }
  }
  session.status = 'finished';
  session.pending = null;
  session.finishedAt = session.finishedAt || new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  if (!session.trace.some((t) => t.node === 'wrap_up')) {
    session.trace.push({
      id: `wrap-${Date.now()}`,
      node: 'wrap_up',
      label: '收尾',
      detail: '已完成报告生成',
      at: new Date().toISOString(),
      ms: 0,
      tone: 'ok'
    });
  }
  save();
  return publicSession(session);
}

export function publicSession(session) {
  if (!session) return null;
  const answered = session.evaluations?.length || 0;
  const total = session.plan?.rounds?.length || 0;
  const current = session.plan?.cursor ?? 0;
  const reached = Math.max(answered, current + (session.pending ? 1 : 0));
  return {
    ...session,
    progress: {
      answered,
      total,
      current,
      reached: Math.min(total, reached),
      percent: total ? Math.min(100, Math.round((reached / total) * 100)) : 0
    },
    llm: isLLMEnabled(),
    canAnswer: Boolean(session.pending) && session.status === 'active'
  };
}

export function sessionSummary(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    persona: session.config.persona,
    personaName: personaOf(session.config.persona).name,
    roleName: session.jd?.analysis?.roleName || session.config.roleName,
    candidateName: session.profile?.name,
    answered: session.evaluations?.length || 0,
    rounds: session.plan?.rounds?.length || 0,
    score: session.report?.readiness ?? session.metrics?.avgScore ?? null,
    durationSec: session.metrics?.durationSec || 0
  };
}
