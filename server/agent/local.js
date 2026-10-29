import { store, allKb } from '../store.js';
import { tokenize, citationsFor, retrieveQuestions } from '../rag.js';

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));
const chars = (s) => String(s || '').replace(/\s/g, '').length;

export const PERSONA_FALLBACK = {
  peer: {
    id: 'peer', name: '同级面试官', subtitle: '未来同事 · 平等对话', tagline: '像同事一样聊，重点看协作与潜力',
    description: '大概率是你入职后的搭档，关心你实际做过什么、遇到分歧怎么处理、能不能快速上手。',
    tone: '轻松、平等、会给提示', focus: ['协作沟通', '学习能力', '技术判断'], color: '#8b5cf6',
    opening: '你好{name}，我是团队里的产品，今天主要和你聊聊，别紧张。', closing: '今天聊得挺开心，后面 HR 会同步安排。'
  },
  senior: {
    id: 'senior', name: '资深面试官', subtitle: '专业深度 · 追问细节', tagline: '不放过细节，验证你是否真的想清楚了',
    description: '团队里的资深专家，会顺着你的回答往下追问三层，重点看你的判断依据和技术理解。',
    tone: '克制、爱追问细节、对含糊表述不买账', focus: ['专业深度', '技术判断', '复盘能力'], color: '#22d3ee',
    opening: '你好{name}，我是{role}方向的面试官。我们直接进入正题，先聊一个你最近的项目。', closing: '好，今天先到这里，后续流程会有人联系你。'
  },
  manager: {
    id: 'manager', name: '直属经理', subtitle: '业务结果 · 优先级', tagline: '只关心结果和取舍，判断你能不能扛事',
    description: '你未来的直属上级，关注业务目标、资源约束下的取舍、跨团队推动和最终结果。',
    tone: '直接、有压迫感、会质疑优先级', focus: ['业务结果', '项目推进', '优先级判断'], color: '#f59e0b',
    opening: '{name}你好，我是这个岗位的直属负责人。时间有限，我们聊点实在的。', closing: '今天先到这，感谢你的时间。'
  }
};

export function personas() {
  if (store.personas?.length) return store.personas;
  return Object.values(PERSONA_FALLBACK);
}

export function personaOf(id) {
  return personas().find((p) => p.id === id) || personas[0];
}

const STAGE_PLANS = {
  balanced: ['简历深挖', '简历深挖', '专业能力', '行为面试', '岗位认知', '反问环节'],
  deep: ['简历深挖', '专业能力', '专业能力', '简历深挖', '专业能力', '行为面试', '压力测试', '反问环节'],
  behavior: ['简历深挖', '行为面试', '行为面试', '专业能力', '行为面试', '岗位认知', '压力测试', '反问环节'],
  pressure: ['简历深挖', '专业能力', '压力测试', '行为面试', '压力测试', '岗位认知', '反问环节']
};

function stagePlan(rounds, focus) {
  const base = STAGE_PLANS[focus] || STAGE_PLANS.balanced;
  const out = [];
  for (let i = 0; i < rounds; i++) out.push(base[i % base.length]);
  return out;
}

function keywordScore(text, keywords) {
  const lower = String(text || '').toLowerCase();
  let n = 0;
  for (const k of keywords || []) {
    if (k && lower.includes(String(k).toLowerCase())) n++;
  }
  return n;
}

function customQuestions(profile, personaId) {
  const out = [];
  const entries = [...(profile.experience || []).map((e) => ({ ...e, kind: 'experience' })), ...(profile.projects || []).map((p) => ({ ...p, kind: 'project' }))];
  for (const entry of entries.slice(0, 5)) {
    const name = entry.company || entry.name;
    const role = entry.role || '';
    const bullets = (entry.bullets || []).filter((b) => b.text && chars(b.text) > 18);
    const withMetric = bullets.filter((b) => b.metrics?.length);
    const top = withMetric[0] || bullets[0];
    if (!top) continue;
    const pickHeadline = (b) => {
      if (!b?.metrics?.length) return null;
      const strong = b.metrics.filter((m) => /(提升|降低|缩短|增长|节省|减少|达到|从.*到)/.test(m.context));
      return (strong[strong.length - 1] || b.metrics[b.metrics.length - 1]).value;
    };
    const metric = pickHeadline(top) || '';
    const label = top.label || '这段经历';
    const variants = [
      `你在${name}负责的「${label}」，当时最关键的一个决策是什么？为什么这么定？`,
      metric ? `你提到「${label}」做到 ${metric}，这个结果具体是怎么算出来的？你个人做了什么？` : `在${name}的「${label}」里，你个人具体做了什么？`,
      `如果重来一次，「${label}」这件事你会改变哪一步？`,
      `在${name}，你和研发或算法同学意见不一致时，是怎么处理的？`
    ];
    const text = variants[out.length % variants.length];
    out.push({
      id: `resume-${entry.kind}-${out.length + 1}`,
      text,
      stage: '简历深挖',
      intent: `验证「${label}」是否由你主导，以及结果是否可归因，而不是团队成绩的复述。`,
      answerPoints: [
        `当时的业务问题与目标（${label}）`,
        '你的关键判断：为什么选这个方案，放弃了什么',
        '你个人负责的动作，以及和团队的边界',
        metric ? `结果与口径：${metric} 怎么算，基线是多少` : '结果与衡量口径，基线是多少',
        '复盘：如果重来会改哪一步'
      ],
      followUps: [
        metric ? `这个「${metric}」具体是怎么算出来的？基线是多少？` : '这个结果有对比基线吗？怎么排除其他因素的影响？',
        '如果当时资源只有一半，你会优先保什么、砍什么？',
        '这件事里有没有你判断失误的地方？后来怎么修正的？'
      ],
      tags: [label, role].filter(Boolean),
      source: 'resume'
    });
  }
  return out;
}

function bankPool(stage, roleName, personaId, jdText, profile) {
  const roleKeys = [roleName, profile.roleFamily, ...(profile.targetRoles || []).map((r) => r.name)].filter(Boolean);
  const jdKeywords = tokenize(jdText || '').slice(0, 80);
  return store.questions
    .filter((q) => q.category === stage)
    .map((q) => {
      let score = 0;
      const roleHit = (q.role || []).filter((r) => roleKeys.some((k) => k && (r.includes(k) || k.includes(r))));
      score += roleHit.length * 6;
      score += (q.persona || []).includes(personaId) ? 2 : 0;
      const text = `${q.text} ${q.intent} ${(q.tags || []).join(' ')}`;
      score += keywordScore(text, jdKeywords.slice(0, 40)) * 0.4;
      score += keywordScore(text, roleKeys) * 2;
      score -= Math.abs((q.difficulty || 3) - 3) * 0.5;
      return { q, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.q);
}

function toRound(q, stage, source) {
  return {
    id: q.id,
    text: q.text,
    stage,
    intent: q.intent || '',
    answerPoints: q.answerPoints?.length ? q.answerPoints : ['背景与目标', '关键动作', '结果与验证', '复盘'],
    followUps: q.followUps?.length ? q.followUps : ['能再具体一点吗？你个人做了什么？'],
    tags: q.tags || [],
    source,
    difficulty: q.difficulty || 3,
    citations: citationsFor(`${q.text} ${q.intent || ''} ${(q.tags || []).join(' ')}`, { topK: 2 })
  };
}

export function planInterview({ profile, jd, config }) {
  const persona = personaOf(config.persona);
  const roleName = jd?.analysis?.roleName || config.roleName || profile.targetRoles?.[0]?.name || '';
  const stages = stagePlan(config.rounds || 6, config.focus || 'balanced');
  const customs = customQuestions(profile, persona.id);
  const used = new Set();
  const rounds = [];

  for (const stage of stages) {
    if (stage === '简历深挖' && customs.length) {
      const next = customs.find((c) => !used.has(c.id));
      if (next) {
        used.add(next.id);
        rounds.push(toRound(next, stage, 'resume'));
        continue;
      }
    }
    const pool = bankPool(stage, roleName, persona.id, jd?.text, profile);
    let picked = pool.find((q) => !used.has(q.id));
    if (!picked) {
      const relaxed = store.questions.filter((q) => !used.has(q.id));
      picked = relaxed[(rounds.length * 3) % Math.max(1, relaxed.length)];
    }
    if (picked) {
      used.add(picked.id);
      rounds.push(toRound(picked, stage, 'bank'));
    }
  }

  if (!rounds.length) {
    rounds.push({
      id: 'fallback-1',
      text: '先做一个自我介绍吧，重点讲和你目标岗位最相关的两段经历。',
      stage: '简历深挖',
      intent: '建立基本画像，观察表达结构与重点取舍。',
      answerPoints: ['一句话定位', '两段最相关经历', '结果与量化', '为什么匹配这个岗位'],
      followUps: ['这两段经历里，哪一段最能代表你？'],
      tags: ['自我介绍'],
      source: 'fallback',
      citations: []
    });
  }

  const opening = (persona.opening || '你好{name}，我们开始今天的面试。')
    .replace('{name}', profile.name || '同学')
    .replace('{role}', roleName || '产品');

  return {
    rounds,
    opening,
    closing: (persona.closing || '今天的面试到这里，感谢你的时间。').replace('{name}', profile.name || '同学'),
    roleName,
    persona
  };
}

/* ---------------- 评估 ---------------- */

function pointCoverage(points, answerTokens, answer) {
  if (!points?.length) return 0;
  const set = new Set(answerTokens);
  let hit = 0;
  for (const point of points) {
    const tokens = tokenize(point);
    if (!tokens.length) continue;
    const covered = tokens.filter((t) => set.has(t)).length / tokens.length;
    if (covered >= 0.28) hit++;
  }
  return hit / points.length;
}

function ownership(answer) {
  const i = (answer.match(/我/g) || []).length;
  const we = (answer.match(/我们|团队|大家/g) || []).length;
  if (i + we === 0) return 0.4;
  return i / (i + we);
}

function inferQuestionType(question) {
  const t = question.text || '';
  if (/(怎么算|口径|基线|怎么验证|依据|区别|是什么|怎么衡量|如何评估|为什么)/.test(t)) return 'explain';
  if (/(如果|会怎么|如何取舍|优先级|怎么选|怎么排)/.test(t)) return 'judge';
  return 'story';
}

function scoreAnswer({ question, answer, profile, jd, isProbe = false }) {
  const text = String(answer || '');
  const len = chars(text);
  const qType = inferQuestionType(question);
  const conciseOk = qType !== 'story' || isProbe;
  const answerTokens = tokenize(text);
  const coreTokens = tokenize(`${question.text} ${question.intent || ''}`);
  const qSet = new Set(coreTokens);
  const overlap = new Set(answerTokens.filter((t) => qSet.has(t))).size;
  const qCoverage = Math.min(1, overlap / Math.max(7, coreTokens.length * 0.32));

  const hasSituation = /(当时|背景|目标|问题|接手|负责|需求|场景|前提|约束)/.test(text);
  const hasAction = /(我(?:负责|主导|设计|推动|搭建|拆分|协调|落地|决定|牵头|梳理|访谈|记录|定义|补)|首先|然后|接着|具体来说|做法是|方案是|第一|第二|拆成|固化|做成|改成|上线)/.test(text);
  const hasResult = /(结果|最终|上线|提升|降低|缩短|增长|达到|节省|实现|跑了|验证|降到|涨到|下降到|压缩到|从.{0,12}到)/.test(text);
  const hasReflection = /(复盘|反思|学到|如果重来|改进|收获|教训|下次|后续)/.test(text);
  const connectors = (text.match(/(首先|其次|然后|最后|因为|所以|因此|不过|但是|同时|相比之下|第一|第二|以及|关键是)/g) || []).length;

  let structure = 30 + (hasSituation ? 14 : 0) + (hasAction ? 20 : 0) + (hasResult ? 14 : 0) + (hasReflection ? 8 : 0) + Math.min(12, connectors * 2);
  if (len > 520) structure -= 10;
  if (!isProbe && qType === 'story' && len < 70) structure -= 18;
  if (conciseOk) structure = Math.max(structure, 52 + (hasResult ? 8 : 0) + (connectors ? 4 : 0));
  if (qType === 'explain' && /(因为|所以|口径|基线|抽样|归因|排除)/.test(text)) structure += 4;

  const coverage = pointCoverage(question.answerPoints, answerTokens, text);
  let relevance = isProbe ? 45 + coverage * 10 + qCoverage * 42 : 40 + coverage * 16 + qCoverage * 42;
  const evidenceNums = (text.match(/\d+(?:\.\d+)?\s*(?:%|％|万|亿|小时|分钟|天|周|个月|倍|人|个|次|条|秒)?/g) || []).length;
  if (len > 180 && evidenceNums >= 2) relevance = Math.max(relevance, 68);
  if (len > 260 && evidenceNums >= 3) relevance = Math.max(relevance, 74);
  if (len < 45) relevance -= 12;
  if (/(不知道|没做过|不会|跳过)/.test(text) && len < 80) relevance -= 15;

  const techWords = new Set((text.match(/[A-Za-z][A-Za-z0-9+#.]{1,}/g) || []).map((w) => w.toLowerCase()));
  const domainWords = (text.match(/(模型|指标|链路|归因|口径|召回|检索|评测|灰度|埋点|转化|留存|成本|时延|并发|对齐|优先级|ROI|AB|实验|Prompt|RAG|Agent|SQL|反馈|闭环|飞轮|信号|标注|场景|策略|验证|假设|上线|复盘|用户|需求|方案|业务|数据|基线|抽样)/g) || []).length;
  let depth = 30 + Math.min(24, len / 12) + Math.min(18, techWords.size * 3) + Math.min(16, domainWords * 1.8);
  if (/(权衡|取舍|为什么不|原因|判断|因为)/.test(text)) depth += 8;
  if (len > 120) depth += 4;
  if (!conciseOk && len < 90) depth -= 14;
  if (conciseOk && len < 45) depth -= 8;
  if (/(大概|差不多|应该是|可能吧|反正)/.test(text)) depth -= 6;
  if (isProbe && /(口径|基线|抽样|归因|复核|对比|剔除|拆解|前提|标准)/.test(text)) depth += 8;

  const nums = (text.match(/\d+(?:\.\d+)?\s*(?:%|％|万|亿|小时|天|周|个月|倍|人|个|次|条|秒|k|K)?/g) || []).filter((n) => n.replace(/\D/g, '').length >= 1).length;
  let impact = 32 + Math.min(30, nums * 7);
  if (/(提升|降低|缩短|增长|节省|减少|达到|做到|降到|涨到|下降到|压缩到|从.{0,14}到)/.test(text)) impact += 12;
  if (/(基线|对比|之前|原来|环比|同比|剔除|抽样|复核)/.test(text)) impact += 8;
  if (!conciseOk && len < 70) impact -= 8;

  const jdKeywords = (jd?.analysis?.keywords || []).concat(jd?.analysis?.matched || []).slice(0, 18);
  const skillHit = (profile?.skills || []).filter((s) => text.toLowerCase().includes(String(s).toLowerCase())).length;
  const jdHit = keywordScore(text, jdKeywords);
  const owner = ownership(text);
  let fit = 42 + Math.min(20, skillHit * 3) + Math.min(18, jdHit * 5) + owner * 20;

  if (isProbe && len >= 80) {
    depth = Math.max(depth, 55);
    impact = Math.max(impact, 45);
  }
  if (isProbe && len >= 120) {
    depth = Math.max(depth, 60);
    impact = Math.max(impact, 50);
  }
  const scores = {
    structure: clamp(structure),
    relevance: clamp(relevance),
    depth: clamp(depth),
    impact: clamp(impact),
    fit: clamp(fit)
  };
  const total = clamp(scores.structure * 0.2 + scores.relevance * 0.25 + scores.depth * 0.25 + scores.impact * 0.2 + scores.fit * 0.1);
  return { scores, total, coverage, owner, len, nums };
}

function verdictOf(total) {
  if (total >= 82) return '强';
  if (total >= 68) return '稳';
  if (total >= 52) return '待加强';
  return '风险';
}

function buildFeedback({ question, answer, result, profile }) {
  const { scores, total, len, nums, owner } = result;
  const strengths = [];
  const risks = [];
  if (scores.structure >= 68) strengths.push('回答有明确的结构，能听出背景、动作和结果');
  if (scores.impact >= 66) strengths.push('给出了量化结果，结果感比较强');
  if (scores.depth >= 66) strengths.push('有技术/业务细节，能支撑你的判断');
  if (scores.relevance >= 70) strengths.push('紧扣题目，没有明显跑题');
  if (owner >= 0.55 && len > 100) strengths.push('个人贡献的边界比较清楚');

  const qType = inferQuestionType(question);
  if (len < (qType === 'story' ? 90 : 45)) risks.push('回答偏短，信息量不足，面试官很难判断你的真实水平');
  if (len > 600) risks.push('回答偏长，重点被稀释，建议控制在 2 分钟内');
  if (scores.impact < 58) risks.push('缺少可核验的量化结果，或只说了结果没说口径');
  if (scores.depth < 58) risks.push('停留在“做了什么”，没有讲清“为什么这么做”和权衡');
  if (scores.structure < 58 && qType === 'story') risks.push('结构松散，建议用「背景-目标-动作-结果-复盘」组织');
  if (qType === 'story' && owner < 0.3 && /(我们|团队)/.test(answer)) risks.push('“我们”太多，听不出你个人的决策和动作');
  if (nums === 0 && /(项目|经历|负责)/.test(question.text)) risks.push('项目类问题没有任何数字，可信度会被打折');
  if (scores.relevance < 70) risks.push('回答与题目的核心考点有偏差，建议先正面回答“问的是什么”，再展开背景');
  if (scores.fit < 62) risks.push('没有体现目标岗位需要的能力关键词，岗位匹配感偏弱');

  const coaching = risks.length
    ? `下一轮优先改这一点：${risks[0]}。可以先写 4 行提纲再开口，确保每个结论后面跟一个动作或数字。`
    : '这段回答已经比较完整，下一步可以练“被追问三层仍然稳定”，并准备 1-2 个失败案例。';

  const rewrite = [
    '① 背景与目标：一句话说清当时的业务问题和你要达成的目标。',
    `② 我的动作：${(question.answerPoints || []).slice(1, 3).join('；') || '你做了哪 2-3 个关键动作，为什么这么选'}。`,
    '③ 结果与验证：给出数字、口径和对比基线，说明哪些是你的贡献。',
    '④ 复盘：如果重来一次，你会改哪一步。'
  ].join('\n');

  return {
    strengths: strengths.slice(0, 4),
    risks: risks.slice(0, 4),
    coaching,
    rewrite,
    verdict: verdictOf(total),
    overall: total >= 75 ? '这段回答可以进入下一轮打磨，重点补细节。' : total >= 55 ? '骨架有了，但证据密度不够，需要补“为什么”和“结果”。' : '这段回答目前很难让面试官建立信任，建议先按模板重写一遍。'
  };
}

export function evaluateAnswer({ question, answer, profile, jd, isProbe = false }) {
  const result = scoreAnswer({ question, answer, profile, jd, isProbe });
  const feedback = buildFeedback({ question, answer, result, profile });
  const citations = citationsFor(`${question.text} ${question.intent} ${feedback.risks.join(' ')}`, { topK: 2 });
  return {
    ...feedback,
    scores: result.scores,
    total: result.total,
    citations,
    answerPoints: question.answerPoints || [],
    reference: question.starExample || '',
    mode: 'local'
  };
}

export function shouldProbe({ answer, evaluation, question, followUpIndex, maxFollowUps = 2 }) {
  if (followUpIndex >= maxFollowUps) return false;
  if (!question.followUps?.length) return false;
  const len = chars(answer);
  if (len < 130) return true;
  if (evaluation.total < 64) return true;
  if (evaluation.scores.impact < 58) return true;
  if (evaluation.scores.depth < 60) return true;
  if (/(大概|差不多|应该是|可能|好像|忘了|记不清)/.test(answer)) return true;
  return false;
}

export function pickProbe(question, followUpIndex, answer) {
  const list = question.followUps || [];
  if (list[followUpIndex]) return list[followUpIndex];
  const m = String(answer).match(/(?:我|我们)(?:负责|做了|推动|设计|搭建)([^，。；]{4,24})/);
  if (m) return `你刚才提到${m[1]}，能具体说说当时的判断依据吗？`;
  return '能再往下讲一层吗？你当时的判断依据是什么？';
}

export function composeReply({ decision, question, evaluation, personaId, isFirstTurn = false, profile }) {
  const persona = personaOf(personaId);
  const name = profile?.name || '同学';
  if (decision === 'finish') {
    const summary = evaluation
      ? `最后这段回答我记下了。`
      : '';
    return `${summary}好，今天的问题就到这里。${(persona.closing || '感谢你的时间，后续流程会有人联系你。').replace('{name}', name)}`;
  }
  if (decision === 'probe') {
    const lead = evaluation?.total >= 70 ? '这个点不错，不过我还想往下确认一下。' : '嗯，我大概听到了你的思路，但还缺一点关键信息。';
    return `${lead}${question.text}`;
  }
  const lead = isFirstTurn
    ? ''
    : evaluation?.total >= 75
      ? '好，这段我了解了。'
      : evaluation?.total >= 55
        ? '好，我们换一个角度。'
        : '嗯，我们先记下，继续。';
  return `${lead}${question.text}`;
}

export function openingMessage({ personaId, plan, profile, rounds }) {
  const first = plan.rounds[0];
  const opening = plan.opening.replace(/\s+方向/g, '方向');
  const intro = opening.length < 36 ? `今天大概聊 ${rounds} 个问题，主要是想了解你真实做过的事，遇到不确定的可以直接说。` : '';
  return `${opening}${intro ? `\n\n${intro}` : ''}\n\n第一个问题：${first.text}`;
}

export function summarizeMemory(messages, evaluations) {
  const answers = messages.filter((m) => m.role === 'candidate');
  const topics = evaluations.map((e) => e.question.text.replace(/[？?]$/, '')).slice(-6);
  const claims = answers.map((a) => a.content.replace(/\s+/g, ' ').slice(0, 48)).slice(-4);
  return {
    topics,
    summary: claims.length ? `已聊到：${topics.join('；')}。候选人近期表述：${claims.join(' / ')}` : ''
  };
}

export function localReport({ session }) {
  const evaluations = session.evaluations || [];
  const weightOf = (e) => (e.isProbe ? 0.6 : 1);
  const weightSum = evaluations.reduce((n, e) => n + weightOf(e), 0);
  const avg = weightSum ? Math.round(evaluations.reduce((n, e) => n + e.total * weightOf(e), 0) / weightSum) : 0;
  const dims = ['structure', 'relevance', 'depth', 'impact', 'fit'];
  const dimensionScores = Object.fromEntries(dims.map((d) => [d, weightSum ? Math.round(evaluations.reduce((n, e) => n + (e.scores?.[d] || 0) * weightOf(e), 0) / weightSum) : 0]));
  const readiness = clamp(avg * 0.92 + Math.min(8, evaluations.length * 1.2));

  const lowDims = dims.map((d) => ({ d, v: dimensionScores[d] })).sort((a, b) => a.v - b.v);
  const highDims = [...lowDims].reverse();
  const DIM_LABEL = { structure: '结构化表达', relevance: '内容相关性', depth: '专业深度', impact: '结果量化', fit: '岗位匹配' };
  const DIMS_KEYS = ['structure', 'relevance', 'depth', 'impact', 'fit'];

  const goodPool = [...new Set(evaluations.flatMap((e) => e.strengths || []))];
  const strengths = goodPool.slice(0, 3).map((text, i) => ({
    title: i === 0 ? `相对优势：${DIM_LABEL[highDims[0].d]}（${highDims[0].v} 分）` : '稳定的加分项',
    detail: text
  }));
  if (!strengths.length) strengths.push({ title: '完成了整场演练', detail: '至少你已经把这些问题真实地说了一遍，下一步是补证据密度。' });

  const riskPool = [...new Set(evaluations.flatMap((e) => e.risks || []))];
  const RISK_HINTS = {
    structure: /结构|松散|偏短|偏长|重点|铺垫/,
    relevance: /跑题|核心考点|正面回答|答非所问/,
    depth: /深度|为什么|权衡|技术细节|判断依据/,
    impact: /量化|数字|口径|基线|结果/,
    fit: /岗位|关键词|匹配/
  };
  const riskTitle = (text) => {
    for (const d of DIMS_KEYS) if (RISK_HINTS[d].test(text)) return DIM_LABEL[d];
    return '表达习惯';
  };
  const risks = [];
  const usedRisk = new Set();
  for (const text of riskPool) {
    if (risks.length >= 3) break;
    if (usedRisk.has(text)) continue;
    usedRisk.add(text);
    risks.push({ title: `${riskTitle(text)}：本场高频问题`, detail: text });
  }
  for (const x of lowDims) {
    if (risks.length >= 3) break;
    if (x.v <= 0) continue;
    if (risks.some((r) => r.title.startsWith(DIM_LABEL[x.d]))) continue;
    risks.push({ title: `${DIM_LABEL[x.d]}偏弱（${x.v} 分）`, detail: `本场该维度平均 ${x.v} 分，建议针对「${DIM_LABEL[x.d]}」做一次专项重练。` });
  }
  if (risks.length < 2) {
    risks.push({ title: '样本量偏少，结论可能不稳定', detail: `本场只完成 ${evaluations.length} 次作答，建议至少完成 4 题再判断真实水平。` });
    risks.push({ title: '追问下的稳定性还未验证', detail: '本场追问次数较少，建议开启“压力面”模式，专门练被连续追问三层。' });
  }

  const actions = [];
  if (dimensionScores.impact < 65) actions.push({ title: '给每个项目补 2 个可核验数字', detail: '口径 + 基线 + 你的贡献，写成一行卡片，开口前先看一遍。', kbId: 'kb-quantify-impact' });
  if (dimensionScores.depth < 65) actions.push({ title: '用“为什么-取舍-验证”重写一个项目', detail: '挑最近的一个项目，写下 3 个关键决策和当时的备选方案。', kbId: 'kb-star-decision' });
  if (dimensionScores.structure < 65) actions.push({ title: '练 5 遍 90 秒结构', detail: '背景 15 秒、动作 40 秒、结果 20 秒、复盘 15 秒，录音回听。', kbId: 'kb-answer-structure' });
  const defaults = [
    { title: '把本场低分题存进个人题库', detail: '按 1/3/7 天复述，直到能不看稿讲完。', kbId: null },
    { title: '录音复听一场 90 秒回答', detail: '只抓两件事：有没有结论先行、有没有数字支撑。', kbId: 'kb-answer-structure' },
    { title: '用 STAR-C 重写最低分那道题', detail: '补上“当时为什么这么选”，再重录一遍。', kbId: 'kb-star-decision' },
    { title: '准备 3 个失败/冲突案例', detail: '每个 90 秒，重点讲你改了什么、后来验证是否有效。', kbId: 'kb-failure-story' }
  ];
  for (const item of defaults) {
    if (actions.length >= 4) break;
    if (!actions.some((a) => a.title === item.title)) actions.push(item);
  }

  const preliminary = evaluations.length < Math.min(4, session.plan?.rounds?.length || 4);
  const narrative = evaluations.length
    ? `本场共完成 ${evaluations.length} 次作答，平均 ${avg} 分${preliminary ? '（样本偏少，结论为初步判断）' : ''}。整体${avg >= 72 ? (preliminary ? '单题表现不错，但还不足以判断整场的稳定性' : '表达和内容都在线，已经具备可面试的状态') : avg >= 58 ? '骨架完整，但证据密度和追问稳定性还不够' : '还停留在“讲经历”，需要先补结构和结果'}。最需要优先补的是${DIM_LABEL[lowDims[0].d]}，它直接决定了面试官是否相信你的贡献。`
    : '本场没有产生有效作答，建议重新开始一场完整演练。';

  return {
    readiness,
    avgScore: avg,
    dimensionScores,
    preliminary,
    headline: preliminary ? '先跑完一场，再下结论' : avg >= 75 ? '可以上桌了，再把追问练稳' : avg >= 58 ? '有骨架，缺证据' : '先补结构，再谈技巧',
    narrative,
    strengths,
    risks: risks.length ? risks : riskPool.map((r) => ({ title: '需要修正的表达习惯', detail: r })),
    actions: actions.slice(0, 4),
    citations: [...new Map(evaluations.flatMap((e) => e.citations || []).map((c) => [c.id, c])).values()].slice(0, 5),
    mode: 'local',
    generatedAt: new Date().toISOString()
  };
}

export function suggestKnowledge(query, topK = 3) {
  return citationsFor(query, { topK });
}

export function relatedQuestions(query, topK = 3) {
  return retrieveQuestions(query, topK).map((q) => ({ id: q.id, text: q.text, category: q.category }));
}

export function kbById(id) {
  return allKb().find((d) => d.id === id);
}
