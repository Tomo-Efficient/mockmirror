import { store } from '../store.js';
import { chat, extractJson, isLLMEnabled } from '../llm.js';
import { retrieveQuestions } from '../rag.js';
import { planMessages } from './prompts.js';
import { planInterview, evaluateAnswer, shouldProbe, pickProbe } from './local.js';

export const NODE_META = [
  { id: 'parse_resume', label: '解析简历', desc: '文档解析 → 结构化画像 → 亮点与关键词抽取' },
  { id: 'analyze_jd', label: '岗位匹配', desc: '岗位识别 → 关键词覆盖 → 缺口与考察重点' },
  { id: 'plan_interview', label: '题单规划', desc: '按岗位与人格编排题单，RAG 召回参考要点' },
  { id: 'ask_question', label: '提问', desc: '结合上下文与记忆，自然抛出下一个问题' },
  { id: 'evaluate_answer', label: '作答评估', desc: '五维评分 → 证据抽取 → 风险识别' },
  { id: 'route', label: '条件路由', desc: '证据不足则追问，否则换题；轮次用完则收尾' },
  { id: 'wrap_up', label: '收尾', desc: '结束面试，汇总本场表现' }
];

const META = Object.fromEntries(NODE_META.map((n) => [n.id, n]));

export class StateGraph {
  constructor(name) {
    this.name = name;
    this.nodes = new Map();
    this.edges = new Map();
    this.conditionals = new Map();
    this.entry = null;
  }
  addNode(id, fn) { this.nodes.set(id, fn); return this; }
  addEdge(from, to) { this.edges.set(from, to); return this; }
  addConditionalEdge(from, selector) { this.conditionals.set(from, selector); return this; }
  setEntry(id) { this.entry = id; return this; }
  async invoke(initial, { onStep } = {}) {
    let state = { ...initial };
    let current = this.entry;
    let guard = 0;
    const steps = [];
    while (current && current !== 'END') {
      if (++guard > 30) throw new Error('状态机出现环');
      const fn = this.nodes.get(current);
      if (!fn) throw new Error(`未知节点：${current}`);
      const started = Date.now();
      const patch = await fn(state);
      if (patch && typeof patch === 'object') state = { ...state, ...patch };
      const step = { node: current, ms: Date.now() - started, meta: META[current] || { label: current } };
      steps.push(step);
      onStep?.(step, state);
      const cond = this.conditionals.get(current);
      current = cond ? cond(state) : this.edges.get(current);
    }
    return { state, steps };
  }
}

function planPool(profile, jd, limit = 24) {
  const query = `${jd?.text || ''} ${(profile.keywords || []).join(' ')} ${(profile.skills || []).join(' ')}`;
  const picked = retrieveQuestions(query, limit);
  const seen = new Set(picked.map((q) => q.id));
  for (const q of store.questions) {
    if (picked.length >= limit) break;
    if (!seen.has(q.id)) { picked.push(q); seen.add(q.id); }
  }
  return picked.slice(0, limit);
}

const VALID_STAGES = ['简历深挖', '专业能力', '行为面试', '岗位认知', '压力测试', '反问环节'];

async function llmPlan({ profile, jd, config }) {
  const pool = planPool(profile, jd);
  const content = await chat(planMessages({ profile, jd, config, pool }), { json: true, maxTokens: 2200, temperature: 0.5 });
  const data = extractJson(content);
  if (!data?.rounds?.length) throw new Error('规划结果为空');
  const byId = new Map(store.questions.map((q) => [q.id, q]));
  const rounds = data.rounds
    .filter((r) => r && typeof r.text === 'string' && r.text.trim().length >= 6)
    .slice(0, config.rounds)
    .map((r, i) => {
      const ref = r.refId ? byId.get(r.refId) : null;
      const stage = VALID_STAGES.includes(r.stage) ? r.stage : (ref?.category || '专业能力');
      return {
        id: ref?.id || `llm-${i + 1}`,
        text: r.text.trim(),
        stage,
        intent: r.intent || ref?.intent || '',
        answerPoints: (Array.isArray(r.answerPoints) && r.answerPoints.length ? r.answerPoints : ref?.answerPoints) || ['背景与目标', '关键动作', '结果与验证', '复盘'],
        followUps: (Array.isArray(r.followUps) && r.followUps.length ? r.followUps : ref?.followUps) || ['能再具体一点吗？你个人做了什么？'],
        tags: r.tags || ref?.tags || [],
        source: ref ? 'bank' : 'llm',
        difficulty: ref?.difficulty || 3,
        citations: ref ? [] : []
      };
    });
  if (!rounds.length) throw new Error('规划结果无效');
  return rounds;
}

export async function runStartGraph({ profile, jd, config, session }) {
  const graph = new StateGraph('session-start')
    .addNode('plan_interview', async (state) => {
      let rounds = null;
      let source = 'local';
      if (isLLMEnabled()) {
        try {
          rounds = await llmPlan({ profile, jd, config });
          source = 'llm';
        } catch (err) {
          console.warn('[graph] LLM 规划失败，回退本地题单：', err.message);
        }
      }
      const local = planInterview({ profile, jd, config });
      if (!rounds) rounds = local.rounds;
      if (rounds.length < config.rounds) {
        const extras = local.rounds.filter((r) => !rounds.some((x) => x.text === r.text));
        rounds = rounds.concat(extras.slice(0, config.rounds - rounds.length));
      }
      state.plan = { rounds, roleName: local.roleName, opening: local.opening, closing: local.closing, source };
      return { plan: state.plan };
    })
    .addNode('ask_question', async (state) => {
      const first = state.plan.rounds[0];
      state.first = first;
      return { first };
    })
    .addEdge('plan_interview', 'ask_question')
    .addEdge('ask_question', 'END')
    .setEntry('plan_interview');

  const { state, steps } = await graph.invoke({ profile, jd, config, session });
  return { state, steps };
}

export async function runTurnGraph({ session, answer }) {
  const graph = new StateGraph('interview-turn')
    .addNode('evaluate_answer', async (state) => {
      const question = state.session.pending.question;
      const preEval = evaluateAnswer({
        question,
        answer: state.answer,
        profile: state.session.profile,
        jd: state.session.jd,
        isProbe: state.session.pending.kind === 'probe'
      });
      state.preEval = preEval;
      return { preEval };
    })
    .addNode('route', async (state) => {
      const { session: s, preEval, answer } = state;
      const pending = s.pending;
      const refusal = /^(不知道|不清楚|没做过|没有|跳过|不会|想不起来)/.test(String(answer).trim());
      let decision;
      let reason;
      if (refusal) {
        decision = 'next';
        reason = '候选人明确表示不会，不再追问';
      } else if (shouldProbe({ answer, evaluation: preEval, question: pending.question, followUpIndex: pending.followUpIndex }) &&
        (s.metrics?.probeCount || 0) < Math.max(1, Math.round(s.plan.rounds.length / 2))) {
        decision = 'probe';
        reason = preEval.total < 64 ? `证据不足（${preEval.total} 分）` : '关键口径含糊，需要再确认一层';
      } else if (s.plan.cursor + 1 < s.plan.rounds.length) {
        decision = 'next';
        reason = '本题信息足够，进入下一题';
      } else {
        decision = 'finish';
        reason = '题单已完成';
      }
      return { decision, reason };
    })
    .addConditionalEdge('route', (state) => {
      if (state.decision === 'probe') return 'ask_question';
      if (state.decision === 'next') return 'ask_question';
      return 'wrap_up';
    })
    .addNode('ask_question', async (state) => {
      const s = state.session;
      const pending = s.pending;
      if (state.decision === 'probe') {
        const text = pickProbe(pending.question, pending.followUpIndex, state.answer);
        const next = { ...pending.question, text, id: `${pending.question.id}-f${pending.followUpIndex + 1}` };
        return {
          nextQuestion: { ...next, stage: pending.question.stage, isProbe: true },
          nextIndex: pending.index,
          nextFollowUp: pending.followUpIndex + 1
        };
      }
      const nextIndex = s.plan.cursor + 1;
      return {
        nextQuestion: s.plan.rounds[nextIndex],
        nextIndex,
        nextFollowUp: 0
      };
    })
    .addNode('wrap_up', async () => ({ nextQuestion: null }))
    .addEdge('evaluate_answer', 'route')
    .addEdge('ask_question', 'END')
    .addEdge('wrap_up', 'END')
    .setEntry('evaluate_answer');

  const { state, steps } = await graph.invoke({ session, answer });
  return { state, steps };
}

export function traceStep(session, step, state) {
  const s = state.session;
  const meta = step.meta || {};
  let detail = '';
  let tone = 'ok';
  switch (step.node) {
    case 'plan_interview': {
      const plan = state.plan;
      const resumeCount = plan.rounds.filter((r) => r.source === 'resume').length;
      detail = `${plan.rounds.length} 道题 · ${resumeCount} 道来自简历 · ${plan.source === 'llm' ? 'LLM 规划' : '规则规划'}`;
      break;
    }
    case 'ask_question': {
      const q = state.nextQuestion || state.first;
      if (!q) { detail = '面试收尾'; break; }
      const idx = Number.isFinite(state.nextIndex) ? state.nextIndex : 0;
      detail = state.decision === 'probe'
        ? `第 ${idx + 1} 题 · 追问 ${state.nextFollowUp || 1}/2`
        : `第 ${idx + 1} 题 · ${q.stage}`;
      break;
    }
    case 'evaluate_answer': {
      const e = state.preEval;
      detail = `${e.total} 分 · ${e.verdict}${e.risks?.[0] ? ` · ${e.risks[0]}` : ''}`;
      tone = e.total >= 68 ? 'ok' : 'warn';
      break;
    }
    case 'route':
      detail = `${state.reason}`;
      tone = state.decision === 'probe' ? 'warn' : 'ok';
      break;
    case 'wrap_up':
      detail = '本场问题已问完，等待生成报告';
      break;
    default:
      detail = '';
  }
  session.trace.push({
    id: `${step.node}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    node: step.node,
    label: meta.label || step.node,
    detail: detail.slice(0, 160),
    at: new Date().toISOString(),
    ms: step.ms,
    tone
  });
  if (session.trace.length > 120) session.trace.splice(0, session.trace.length - 120);
}
