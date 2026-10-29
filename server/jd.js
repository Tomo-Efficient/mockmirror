import { store } from './store.js';
import { resumeToText } from './profile.js';

const GENERIC_KEYWORDS = [
  'Agent', 'RAG', 'LLM', '大模型', 'Prompt', 'SQL', 'Python', '数据分析', '指标体系', 'AB 实验', '用户研究', '需求分析',
  '产品规划', '项目管理', '跨部门', '商业化', '增长', '推荐系统', '知识图谱', '微调', '评测', '数据治理', '数仓', 'ETL',
  'Figma', 'Axure', 'PRD', 'B 端', 'C 端', 'SaaS', 'AI', '机器学习', '深度学习', 'BI', 'Tableau'
];

function profileText(profile) {
  return `${resumeToText(profile)} ${(profile.skills || []).join(' ')} ${(profile.keywords || []).join(' ')}`.toLowerCase();
}

function scoreRole(role, jdText, profile) {
  const text = jdText.toLowerCase();
  let score = 0;
  if (role.name && text.includes(role.name.toLowerCase())) score += 8;
  for (const alias of role.aliases || []) {
    if (alias && text.includes(alias.toLowerCase())) score += 5;
  }
  for (const kw of role.keywords || []) {
    if (kw && text.includes(kw.toLowerCase())) score += 1.4;
  }
  for (const t of profile.targetRoles || []) {
    if (t.id === role.id) score += 3;
  }
  return score;
}

function extractRequirements(text) {
  const lines = text.split(/\n|(?<=[。；;])/).map((l) => l.trim()).filter((l) => l.length >= 6);
  const picked = lines.filter((l) => /(负责|要求|熟悉|掌握|具备|参与|推动|优先|加分|经验|能力|独立)/.test(l));
  return [...new Set(picked)].slice(0, 8).map((l) => l.replace(/^[\d.、•·\-\s]+/, ''));
}

function seniorityOf(text) {
  if (/实习|校招|应届|202[6-9]\s*届/.test(text)) return '应届/实习';
  if (/1\s*[-~到]\s*3\s*年|一到三年|初级/.test(text)) return '1-3 年';
  if (/3\s*[-~到]\s*5\s*年|三到五年|中级/.test(text)) return '3-5 年';
  if (/5\s*年以上|资深|专家/.test(text)) return '5 年以上';
  return '未标注';
}

function titleOf(text, roleName) {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length >= 2);
  if (firstLine && firstLine.length <= 40 && !/[。；;]/.test(firstLine)) return firstLine;
  return roleName ? `${roleName}（目标岗位）` : '目标岗位';
}

export function analyzeJD({ jdText, profile }) {
  const text = String(jdText || '').trim();
  const lower = text.toLowerCase();
  const pText = profileText(profile);

  let best = null;
  let bestScore = 0;
  for (const role of store.roles) {
    const score = scoreRole(role, text, profile);
    if (score > bestScore) { best = role; bestScore = score; }
  }
  const role = best || { id: 'generic', name: '产品经理', keywords: GENERIC_KEYWORDS, focusTopics: [], competencies: [] };
  const roleName = role.name || '产品经理';

  const roleKeywords = [...new Set([...(role.keywords || []), ...GENERIC_KEYWORDS])];
  const jdKeywords = roleKeywords.filter((k) => lower.includes(String(k).toLowerCase())).slice(0, 18);
  const matched = jdKeywords.filter((k) => pText.includes(String(k).toLowerCase()));
  const missing = jdKeywords.filter((k) => !matched.includes(k));
  const coverage = jdKeywords.length ? matched.length / jdKeywords.length : 0;

  const profileRoleHit = (profile.targetRoles || []).some((t) => t.id === role.id);
  const expText = (profile.experience || []).map((e) => `${e.company} ${e.role}`).join(' ');
  const expOverlap = roleKeywords.filter((k) => expText.toLowerCase().includes(String(k).toLowerCase())).length;
  const seniority = seniorityOf(text);
  const expFactor = Math.min(1, expOverlap / 4) * 0.6 + (profileRoleHit ? 0.4 : 0.25);

  const matchScore = Math.round(Math.min(98, Math.max(35, coverage * 58 + Math.min(20, bestScore) + expFactor * 18 + 8)));
  const level = matchScore >= 78 ? '高度匹配' : matchScore >= 60 ? '基本匹配' : '存在差距';

  const suggestions = [];
  if (missing.length) suggestions.push(`JD 提到但简历未体现：${missing.slice(0, 5).join('、')}，建议补一段相关经历或能力证据`);
  if (coverage < 0.55) suggestions.push('关键词覆盖率偏低，面试前先把 JD 里的核心能力映射到你的项目上');
  if (/Agent|RAG|大模型|LLM/i.test(text) && !/Agent|RAG|LLM|大模型/i.test(pText)) suggestions.push('岗位强调大模型落地，建议准备一个 LLM 应用的完整案例（含评测与幻觉治理）');
  if (/数据|指标|分析/.test(text) && !/指标|AARRR|归因/.test(pText)) suggestions.push('准备一个从指标定义到归因分析的闭环案例');
  if (!suggestions.length) suggestions.push('关键词覆盖较好，重点准备项目深挖与追问，确保每个数字都能解释口径');

  return {
    roleId: role.id,
    roleName,
    roleConfidence: Math.min(1, bestScore / 18),
    title: titleOf(text, roleName),
    seniority,
    keywords: jdKeywords,
    matched,
    missing,
    coverage: Math.round(coverage * 100),
    matchScore,
    level,
    requirements: extractRequirements(text),
    focusTopics: (role.focusTopics || []).slice(0, 6),
    suggestions,
    analyzedAt: new Date().toISOString()
  };
}
