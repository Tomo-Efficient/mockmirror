import { condenseProfile } from '../profile.js';
import { personaOf } from './local.js';

const clip = (s, n) => String(s || '').slice(0, n);

function personaBlock(persona) {
  return [
    `你现在的身份：${persona.name}（${persona.subtitle}）。`,
    `你的关注点：${(persona.focus || []).join('、')}。`,
    `你的语气：${persona.tone || '专业、克制'}。`,
    persona.description ? `人物设定：${persona.description}` : ''
  ].filter(Boolean).join('\n');
}

export function interviewerSystem(session) {
  const persona = personaOf(session.config.persona);
  const roleName = session.jd?.analysis?.roleName || session.config.roleName || '目标岗位';
  return `${personaBlock(persona)}

你正在「面镜 MockMirror」上为候选人 ${session.profile?.name || '同学'} 做一场 ${roleName} 岗位的模拟面试。

候选人画像：
${clip(condenseProfile(session.profile), 1800)}

目标岗位 JD：
${clip(session.jd?.text, 600)}

本场规则（必须遵守）：
1. 全程中文口语，像真人面试官，不要用列表、标题或 Markdown。
2. 每次只说一段话，最多 100 字，并且只问一个问题。
3. 先对上一段回答给一句真实、具体的反馈，但不要打分、不要透露评分维度。
4. 只能围绕简历里真实出现过的经历提问，禁止编造候选人没写过的公司、项目或数字。
5. 追问要抓含糊处（口径、归因、个人贡献、权衡），不要泛泛问“还有吗”。
6. 不要替候选人回答，不要输出面试建议，不要跳出面试官角色。
7. 如果候选人说“不知道”，可以给一个很小的提示，然后把问题拉回可回答的范围。`;
}

export function interviewerMessages(session, { decision, nextQuestion, preEvaluation, memory }) {
  const history = session.messages.filter((m) => m.kind !== 'guide' && m.kind !== 'hint').slice(-8).map((m) => ({
    role: m.role === 'candidate' ? 'user' : 'assistant',
    content: m.content
  }));
  let instruction;
  if (decision === 'probe') {
    instruction = `下一步：针对候选人刚才的回答追问。追问内容必须是：「${nextQuestion.text}」。先用一句话点出你为什么要追问（例如口径不清、贡献不明、缺少权衡），再自然地问出这个问题。`;
  } else if (decision === 'next') {
    instruction = `下一步：结束当前话题，自然过渡到下一个问题。下一个问题必须是：「${nextQuestion.text}」（考察点：${nextQuestion.intent || '综合判断'}）。过渡要短，不要总结上一题。`;
  } else {
    instruction = `下一步：结束面试。说一句简短的收尾，并告知候选人可以查看复盘报告。不要提出新问题。`;
  }
  const evalHint = preEvaluation ? `你刚才对回答的即时判断：${preEvaluation.verdict}，主要问题是${(preEvaluation.risks || [])[0] || '细节不足'}。` : '';
  return [
    { role: 'system', content: interviewerSystem(session) },
    ...history,
    {
      role: 'user',
      content: `【系统指令，不要直接复述】${instruction}\n${evalHint}\n候选人已答 ${session.evaluations.length} 题，本场计划 ${session.plan.rounds.length} 题。${memory?.summary ? `\n对话记忆：${clip(memory.summary, 300)}` : ''}\n请直接输出你要说的话。`
    }
  ];
}

export function evaluationMessages(session, { question, answer }) {
  return [
    {
      role: 'system',
      content: `你是资深面试教练，负责给候选人的单题回答打分。要求严格、具体、可执行，不灌鸡汤。
只输出 JSON，不要 Markdown。评分维度均为 0-100：
- structure 结构化表达：背景/目标/动作/结果/复盘是否清楚
- relevance 内容相关性：是否回答了问题，是否覆盖考察点
- depth 专业深度：是否有判断依据、权衡、技术/业务细节
- impact 结果量化：是否有数字、口径、基线、个人贡献
- fit 岗位匹配：是否体现目标岗位需要的能力

JSON 结构：
{"scores":{"structure":0,"relevance":0,"depth":0,"impact":0,"fit":0},"verdict":"强|稳|待加强|风险","strengths":["最多3条，指出具体哪句话好"],"risks":["最多3条，指出具体缺什么"],"coaching":"一句最优先的改进建议","rewrite":"一段 120-180 字的示范回答，用第一人称，只能使用候选人简历中已有的经历和数字，不得编造"}

注意：rewrite 是示范，不是替候选人虚构经历；如果信息不足，就写成带占位符的结构。`
    },
    {
      role: 'user',
      content: `【候选人画像】\n${clip(condenseProfile(session.profile), 1400)}

【目标岗位】${session.jd?.analysis?.roleName || session.config.roleName || ''}
【JD 摘要】${clip(session.jd?.text, 500)}

【本题】${question.text}
【考察点】${question.intent || ''}
【参考要点】${(question.answerPoints || []).map((p, i) => `${i + 1}. ${p}`).join(' ')}
${question.starExample ? `【示范回答参考】${clip(question.starExample, 400)}` : ''}

【候选人的回答】
${clip(answer, 2200)}

请输出 JSON。`
    }
  ];
}

export function planMessages({ profile, jd, config, pool }) {
  const persona = personaOf(config.persona);
  return [
    {
      role: 'system',
      content: `你是面试教研专家，需要为一场 ${config.rounds} 题的模拟面试设计题单。面试官人格：${persona.name}（${persona.tagline || ''}）。
只输出 JSON：
{"rounds":[{"refId":"题库中的 id 或 null","stage":"简历深挖|专业能力|行为面试|岗位认知|压力测试|反问环节","text":"题干","intent":"考察点","answerPoints":["4条具体要点"],"followUps":["2条追问"]}]}

规则：
1. 题量必须等于 ${config.rounds}，按“简历深挖→专业能力→行为/压力→反问”递进，最后一题可以是反问环节。
2. 至少一半题目要直接来自候选人简历里的真实项目/经历，题干要引用具体项目名或指标。
3. 优先从给定题库中选（refId 填对应 id），可以改写题干使其更贴合简历，但不要改变考察点。
4. 不要重复考察同一个点；难度从易到难。
5. 禁止编造候选人没有的经历。`
    },
    {
      role: 'user',
      content: `【候选人画像】\n${clip(condenseProfile(profile), 1800)}

【目标岗位】${jd?.analysis?.roleName || config.roleName || ''}
【JD】${clip(jd?.text, 900)}

【可选题库】
${pool.map((q) => `- ${q.id}｜${q.category}｜${q.text}｜考察：${clip(q.intent, 50)}`).join('\n')}

请生成 ${config.rounds} 道题。`
    }
  ];
}

export function reportMessages(session) {
  const roundsText = session.evaluations.map((e, i) => {
    return `${i + 1}. [${e.question.stage}] ${e.question.text}\n   得分：${e.total}（结构${e.scores.structure}/相关${e.scores.relevance}/深度${e.scores.depth}/结果${e.scores.impact}/匹配${e.scores.fit}）\n   回答摘要：${clip(e.answer, 220)}\n   问题：${(e.risks || []).join('；')}`;
  }).join('\n');
  return [
    {
      role: 'system',
      content: `你是候选人的面试教练，要基于整场模拟面试写一份复盘报告。只输出 JSON：
{"headline":"一句 12-18 字的结论","narrative":"120-180 字的整体评价，直接指出最核心的问题","readiness":0-100,"strengths":[{"title":"","detail":"结合具体回答，60字内"}],"risks":[{"title":"","detail":"结合具体回答，60字内"}],"actions":[{"title":"","detail":"可执行的练习动作，40字内","kbId":null}]}
要求：不编造未发生的事情；至少 2 条优势、3 条风险、3 条行动；行动要具体到“练什么、怎么练、练多久”。`
    },
    {
      role: 'user',
      content: `候选人：${session.profile?.name}｜目标岗位：${session.jd?.analysis?.roleName || ''}
岗位匹配：${session.jd?.analysis?.matchScore ?? '未知'} 分；简历关键词：${(session.profile?.keywords || []).slice(0, 10).join('、')}；JD 缺口：${(session.jd?.analysis?.missing || []).slice(0, 8).join('、')}

逐题记录：
${roundsText}

知识库参考（可引用）：
${(session.report?.citations || []).map((c) => `- ${c.title}：${clip(c.snippet, 80)}`).join('\n') || '无'}

请输出 JSON 报告。`
    }
  ];
}

export function resumeParseMessages(text) {
  return [
    {
      role: 'system',
      content: `你是简历解析器。把简历转成 JSON，只输出 JSON：
{"name":"","headline":"一句话定位","summary":"80字内画像","skills":[""],"keywords":[""],"highlights":["最多4条带数字的亮点"]}
不要编造，不确定的字段留空。`
    },
    { role: 'user', content: clip(text, 6000) }
  ];
}
