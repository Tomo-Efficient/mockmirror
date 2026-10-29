import { store } from './store.js';

const SECTION_ALIASES = [
  { key: 'education', label: '教育背景', patterns: ['教育背景', '教育经历', '学历背景', '教育'] },
  { key: 'experience', label: '实习经历', patterns: ['实习经历', '工作经历', '职业经历', '实习经验', '工作经验', '实习与工作'] },
  { key: 'projects', label: '项目经历', patterns: ['项目经历', '项目经验', '科研经历', '研究经历', '实践经历'] },
  { key: 'honors', label: '荣誉奖项', patterns: ['荣誉奖项', '获奖情况', '主要荣誉', '奖项荣誉', '荣誉'] },
  { key: 'campus', label: '校园经历', patterns: ['校园经历', '社团经历', '学生工作', '校园实践'] },
  { key: 'profile', label: '个人特质', patterns: ['个人特质', '个人优势', '自我评价', '个人总结', '关于我'] },
  { key: 'skills', label: '技能', patterns: ['专业技能', '技能特长', '技术栈', '技能'] },
  { key: 'languages', label: '语言能力', patterns: ['语言能力'] }
];

const SKILL_DICT = [
  'LLM', '大模型', 'Agent', 'RAG', 'Prompt', 'Prompt 工程', 'Prompt工程', 'Function Calling', 'ReAct', 'MCP', 'LangChain', 'LangGraph',
  'Dify', 'Coze', '微调', 'SFT', 'RLHF', '多模态', 'Embedding', '向量数据库', '知识图谱', '幻觉治理', '模型评测', 'AIGC', 'ChatGPT', 'Claude',
  '深度学习', '机器学习', '神经网络', '自然语言处理', 'NLP', '推荐系统', '计算机视觉',
  'SQL', 'Python', 'R', 'Excel', 'Tableau', 'Power BI', 'PowerBI', '指标体系', 'AB 实验', 'AB实验', 'A/B 测试', 'A/B测试',
  '数据治理', '数仓', '数据仓库', 'ETL', '埋点', '归因', '用户分层', '用户画像', '漏斗', '留存', 'ROI', 'AARRR', '数据建模',
  '统计分析', '假设检验', '时间序列', '因果推断', '聚类', '回归', 'Spark', 'Hive', 'Flink', 'ClickHouse',
  'PRD', '原型', 'Figma', 'Axure', 'Xmind', '需求评审', '用户研究', '用户访谈', '竞品分析', '项目管理', 'Scrum', '敏捷',
  '商业化', '增长', '数据分析', '指标体系搭建', '灰度测试', 'A/B 实验', '成本控制',
  'Claude Code', 'Cursor', 'Codex', 'Vibe Coding', 'Git', 'Java', 'JavaScript', 'TypeScript', 'Node.js', 'React', 'Vue',
  'Linux', 'Docker', 'API', 'Figma', 'Visio', 'Notion', 'Jira'
];

const ROLE_HINTS = [
  'AI产品经理', 'AI 产品经理', '人工智能产品经理', '数据产品经理', '产品经理', '数据分析师', '数据开发', '算法工程师',
  '开发工程师', '前端工程师', '后端工程师', '全栈工程师', '项目经理', '产品运营', '运营经理', '增长运营', '用户运营', '产品负责人', '项目负责人',
  '内容运营', '市场运营', '研究员', '设计师', '交互设计师', '商业分析', '数据科学', '实习生', '创始人', '负责人'
];

const DATE_RANGE = /((?:19|20)\d{2})\s*[.\-/年]\s*(\d{1,2})?\s*(?:月)?\s*[—–\-~至到]\s*((?:19|20)\d{2})\s*[.\-/年]\s*(\d{1,2})?\s*(?:月)?/;
const METRIC_RE = /(\d+(?:\.\d+)?\s*(?:%|％|倍|万|亿|小时|分钟|天|周|个月|年|人|个|次|条|页|秒|s|h|k|K|w))|(\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*(?:%|％|倍|小时|天|周|个月|人|个|次|条|秒))/g;

const normalizeLine = (line) => line.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

function headingKey(line) {
  let s = normalizeLine(line)
    .replace(/^[0-9０-９]{1,2}\s*[/、.．]\s*/, '')
    .replace(/^[一二三四五六七八九十]{1,2}[、.．]\s*/, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, '');
  if (s.length > 12) return null;
  for (const def of SECTION_ALIASES) {
    if (def.patterns.includes(s)) return def;
  }
  return null;
}

function splitSections(text) {
  const lines = text.split('\n').map(normalizeLine).filter((l) => l.length > 0);
  const sections = [{ key: 'header', label: '基本信息', lines: [] }];
  let current = sections[0];
  for (const line of lines) {
    const def = headingKey(line);
    if (def && line.replace(/\s/g, '').length <= 12) {
      current = { key: def.key, label: def.label, lines: [] };
      sections.push(current);
      continue;
    }
    current.lines.push(line);
  }
  return sections;
}

function extractContacts(text) {
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
  const phone = (text.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/) || [''])[0].replace(/[-\s]/g, '');
  const links = [...text.matchAll(/https?:\/\/[^\s，。；、）)]+/g)].map((m) => m[0]).slice(0, 4);
  const location = (text.match(/(?:现居|所在地|城市)[：:\s]*([\u4e00-\u9fa5]{2,8})/) || [])[1] || '';
  const years = (text.match(/(\d{4})\s*届/) || [])[1] || '';
  return { email, phone, links, location, graduateYear: years };
}

function parseDateRange(line) {
  const m = line.match(DATE_RANGE);
  if (!m) return null;
  const fmt = (y, mo) => `${y}.${String(mo || '01').padStart(2, '0')}`;
  return {
    start: fmt(m[1], m[2]),
    end: fmt(m[3], m[4]),
    raw: m[0],
    index: m.index,
    length: m[0].length
  };
}

function matchRole(line) {
  for (const role of ROLE_HINTS) {
    if (line.includes(role)) return role;
  }
  return '';
}

function splitCompanyRole(line, date) {
  let rest = line;
  if (date) rest = (line.slice(0, date.index) + ' ' + line.slice(date.index + date.length)).trim();
  rest = rest.replace(/^[\s•·\-–—|丨]+/, '').replace(/\s+/g, ' ').trim();
  if (!rest) return { name: '', role: '' };

  const candidates = [];
  for (const hint of ROLE_HINTS) {
    let idx = rest.lastIndexOf(hint);
    while (idx >= 0) {
      candidates.push({ hint, idx });
      idx = rest.lastIndexOf(hint, idx - 1);
    }
  }
  if (candidates.length) {
    const prefixOk = (idx) => {
      if (idx <= 0) return true;
      const before = rest.slice(Math.max(0, idx - 12), idx).trim();
      return /(?:^|[\s（(·])(?:AI|ai|高级|资深|初级|中级|首席|数据|增长|用户|内容|商业化|策略|平台|产品|运营|B ?端|C ?端|海外|金融|供应链)$/.test(before) ||
        /[A-Za-z0-9&+\-]$/.test(before) || /[\s|丨·]$/.test(rest.slice(idx - 1, idx));
    };
    candidates.sort((a, b) => b.hint.length - a.hint.length || b.idx - a.idx);
    const picked = candidates.find((c) => prefixOk(c.idx)) || candidates[0];
    const name = rest.slice(0, picked.idx).replace(/[\s|丨·,，、]+$/, '').trim();
    const role = rest.slice(picked.idx).trim();
    if (name && role) return { name, role };
  }

  const parts = rest.split(/\s{2,}|[|丨｜]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { name: parts[0], role: parts.slice(1).join(' ') };
  return { name: rest, role: '' };
}

function extractMetrics(text) {
  const out = [];
  const re = new RegExp(METRIC_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const token = (m[0] || '').trim();
    if (!token) continue;
    const start = Math.max(0, m.index - 26);
    const end = Math.min(text.length, m.index + token.length + 20);
    out.push({ value: token, context: text.slice(start, end).replace(/\s+/g, ' ') });
    if (out.length >= 6) break;
  }
  return out;
}

function parseBullet(line) {
  const text = line.replace(/^[•·\-–—*]\s*/, '').trim();
  if (!text) return null;
  const m = text.match(/^([^：:]{2,14})[：:]\s*(.+)$/);
  if (m && !/^https?$/.test(m[1])) {
    const value = m[2].trim();
    if (value.replace(/[\s，,。；;]/g, '').length < 4) return null;
    return { label: m[1].trim(), text: value, metrics: extractMetrics(value) };
  }
  if (/^(项目背景|核心职责|项目成果|主要职责|工作内容|职责描述)[\s：:]*$/.test(text)) return null;
  if (text.replace(/[\s，,。；;]/g, '').length < 4) return null;
  return { label: '', text, metrics: extractMetrics(text) };
}

function parseEntries(lines, kind) {
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const date = parseDateRange(line);
    const isHeader = date && line.replace(DATE_RANGE, '').replace(/[\s•·|丨]/g, '').length >= 2 && line.length < 90;
    if (isHeader) {
      const { name, role } = splitCompanyRole(line, date);
      current = {
        [kind === 'projects' ? 'name' : 'company']: name,
        role: role || (kind === 'projects' ? '项目成员' : ''),
        start: date.start,
        end: date.end,
        bullets: [],
        tags: []
      };
      entries.push(current);
      continue;
    }
    const bullet = parseBullet(line);
    if (!bullet) continue;
    if (!current) {
      current = {
        [kind === 'projects' ? 'name' : 'company']: kind === 'projects' ? '未命名项目' : '未命名经历',
        role: '',
        start: '',
        end: '',
        bullets: [],
        tags: []
      };
      entries.push(current);
    }
    current.bullets.push(bullet);
  }
  return entries;
}

function parseEducation(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    const date = parseDateRange(line);
    if (!date && !/(大学|学院|学校|University|College)/i.test(line)) {
      const last = out[out.length - 1];
      if (last && /课程|主修/.test(line)) last.courses.push(line.replace(/^主修课程[：:]?\s*/, '').replace(/^课程[：:]?\s*/, ''));
      continue;
    }
    const degree = (line.match(/博士|硕士|学士|本科|研究生|大专/ ) || [''])[0];
    const schoolMatch = line.match(/([\u4e00-\u9fa5A-Za-z·（）() ]{2,36}?(?:大学|学院|学校|University|College))/);
    const school = schoolMatch ? schoolMatch[1].trim() : '';
    let major = '';
    if (school) {
      major = line.slice(line.indexOf(school) + school.length);
      if (degree) major = major.replace(degree, '');
      if (date) major = major.replace(date.raw, '');
      major = major.replace(/[（(][^）)]*QS[^）)]*[）)]/gi, '').replace(/[（(]\s*[)）]/g, '').replace(/\s{2,}/g, ' ').trim();
      major = major.replace(/^[，,、\s]+|[，,、\s]+$/g, '');
    }
    if (!school && !degree) continue;
    out.push({
      school,
      major,
      degree,
      start: date?.start || '',
      end: date?.end || '',
      courses: []
    });
  }
  return out;
}

function parseSkills(sections, text) {
  const explicit = [];
  const BLACKLIST = /篮球|健身|摄影|身高|爱好|特长|普通话|母语|英语|六级|雅思|托福|驾照|性格|审美/;
  const looksLikeTool = (t) => /[A-Za-z]/.test(t) || SKILL_DICT.some((s) => s.toLowerCase() === t.toLowerCase()) ||
    /(?:模型|算法|分析|工程|系统|平台|框架|数据库|指标|方法|工具|语言)$/.test(t);
  for (const s of sections.filter((x) => x.key === 'skills' || x.key === 'profile')) {
    for (const line of s.lines) {
      const cleaned = line.replace(/^[•·\-–—*]\s*/, '');
      if (/爱好|特长|语言|身高|审美/.test(cleaned)) continue;
      const m = cleaned.match(/^([^：:]{2,16})[：:]\s*(.+)$/);
      const body = m ? m[2] : cleaned;
      body.split(/[、,，;；/]|\s{2,}/).forEach((part) => {
        const t = part.replace(/^(掌握|熟练使用|熟悉|了解|精通|会使用|使用|具备)/, '').replace(/等$/, '').replace(/[。.]$/, '').trim();
        if (!t || t.length > 18 || BLACKLIST.test(t) || !looksLikeTool(t)) return;
        if (/^(能|可|理解|擅长|独立|有|较强|良好)/.test(t) || /的/.test(t)) return;
        if (t.length > 8 && /(与|和|及)/.test(t)) return;
        explicit.push(t);
      });
    }
  }
  const lower = text.toLowerCase();
  const detected = [];
  for (const skill of SKILL_DICT) {
    const s = skill.toLowerCase();
    if (/^[a-z]{1,2}$/.test(s)) continue;
    let hit = false;
    if (/^[a-z0-9+#. ]+$/i.test(s)) {
      const re = new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      hit = re.test(lower);
    } else {
      hit = lower.includes(s);
    }
    if (hit) detected.push(skill);
  }
  const out = [];
  const seen = new Set();
  for (const s of [...explicit, ...detected]) {
    const key = s.toLowerCase().replace(/\s/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 30);
}

function qualityOf(profile, text) {
  const notes = [];
  let score = 40;
  if (profile.email || profile.phone) { score += 10; notes.push('联系方式已识别'); }
  if (profile.education.length) { score += 12; notes.push(`${profile.education.length} 段教育经历`); }
  if (profile.experience.length) { score += 14; notes.push(`${profile.experience.length} 段实习/工作经历`); }
  if (profile.projects.length) { score += 8; notes.push(`${profile.projects.length} 个项目`); }
  if (profile.highlights.length >= 3) { score += 10; notes.push(`${profile.highlights.length} 条量化亮点`); }
  if (profile.skills.length >= 5) { score += 6; notes.push(`${profile.skills.length} 项技能`); }
  if (text.length < 400) { score -= 25; notes.push('文本较短，建议补充经历细节'); }
  if (!profile.experience.length && !profile.projects.length) { score -= 10; notes.push('未识别到经历段落，请检查排版'); }
  return { score: Math.max(10, Math.min(96, score)), notes };
}

function buildHighlights(experience, projects) {
  const pool = [];
  for (const e of experience) {
    for (const b of e.bullets) {
      if (b.metrics.length) {
        pool.push({ text: b.text, label: b.label, source: `${e.company}${e.role ? ` · ${e.role}` : ''}`, metric: b.metrics[0].value, metricCount: b.metrics.length });
      }
    }
  }
  for (const p of projects) {
    for (const b of p.bullets) {
      if (b.metrics.length) {
        pool.push({ text: b.text, label: b.label, source: p.name, metric: b.metrics[0].value, metricCount: b.metrics.length });
      }
    }
  }
  return pool.sort((a, b) => b.metricCount - a.metricCount).slice(0, 6);
}

function monthsBetween(start, end) {
  if (!start || !end) return 0;
  const [y1, m1] = start.split('.').map(Number);
  const [y2, m2] = end.split('.').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + 1);
}

export function parseResume(text, { filename = '' } = {}) {
  const sections = splitSections(text);
  const get = (key) => sections.find((s) => s.key === key)?.lines || [];
  const headerLines = sections.find((s) => s.key === 'header')?.lines || [];

  const contacts = extractContacts(text);
  let name = '';
  for (const line of headerLines.slice(0, 6)) {
    const candidate = line.replace(/\s/g, '');
    if (/^[\u4e00-\u9fa5·]{2,4}$/.test(candidate) && !/简历|求职|个人/.test(candidate)) {
      name = candidate;
      break;
    }
  }
  if (!name) {
    const m = text.match(/姓\s*名[：:\s]*([\u4e00-\u9fa5·]{2,4})/);
    if (m) name = m[1];
  }
  if (!name) name = filename.replace(/\.[^.]+$/, '').slice(0, 12) || '候选人';

  const education = parseEducation(get('education'));
  const experience = parseEntries(get('experience'), 'experience');
  const projects = parseEntries(get('projects'), 'projects');

  for (const entry of [...experience, ...projects]) {
    const content = entry.bullets.map((b) => `${b.label} ${b.text}`).join(' ');
    entry.tags = SKILL_DICT.filter((s) => s.length > 1 && content.toLowerCase().includes(s.toLowerCase())).slice(0, 6);
  }

  const skills = parseSkills(sections, text);
  const highlights = buildHighlights(experience, projects);

  const roleFamily = experience[0]?.role || projects[0]?.role || '';
  const degree = education.find((e) => e.degree)?.degree || '';
  const major = education.find((e) => e.major)?.major || '';
  const months = experience.reduce((n, e) => n + monthsBetween(e.start, e.end), 0);
  const yearsLabel = months >= 12 ? `${Math.round(months / 12 * 10) / 10} 年` : `${months} 个月`;

  const targetRoles = store.roles
    .filter((role) => {
      const hay = `${role.name} ${(role.aliases || []).join(' ')} ${(role.keywords || []).join(' ')}`.toLowerCase();
      const source = `${text} ${roleFamily}`.toLowerCase();
      return (role.aliases || []).some((a) => text.includes(a)) ||
        (role.name && text.includes(role.name)) ||
        (role.keywords || []).filter((k) => source.includes(k.toLowerCase())).length >= 3;
    })
    .map((r) => ({ id: r.id, name: r.name }))
    .slice(0, 3);

  const headlineParts = [];
  if (major || degree) headlineParts.push(`${major}${degree ? ` ${degree}` : ''}`.trim());
  if (experience.length) headlineParts.push(`${experience.length} 段${roleFamily.includes('产品') ? '产品' : '相关'}经历`);
  const headline = headlineParts.join(' · ') || roleFamily || '求职候选人';

  const topSkills = skills.slice(0, 5);
  const trimEnd = (s) => String(s).replace(/[。；;\s]+$/, '');
  const summaryParts = [];
  if (education[0]) summaryParts.push(trimEnd(`${education[0].school}${education[0].major ? ` ${education[0].major}` : ''}${education[0].degree ? ` ${education[0].degree}` : ''}`));
  if (experience.length) summaryParts.push(trimEnd(`累计 ${yearsLabel} 实习/工作经历，最近一段在 ${experience[0].company}${experience[0].role ? ` 担任 ${experience[0].role}` : ''}`));
  if (highlights[0]) summaryParts.push(trimEnd(`代表性成果：${highlights[0].text.slice(0, 56)}`));
  if (topSkills.length) summaryParts.push(trimEnd(`技能覆盖 ${topSkills.slice(0, 4).join('、')}`));
  const summary = summaryParts.join('；') + '。';

  const keywords = [...new Set([...topSkills, ...experience.flatMap((e) => e.tags), ...projects.flatMap((p) => p.tags)])].slice(0, 18);
  const profile = {
    name,
    headline,
    email: contacts.email,
    phone: contacts.phone,
    links: contacts.links,
    location: contacts.location,
    graduateYear: contacts.graduateYear,
    roleFamily,
    summary,
    education,
    experience,
    projects,
    skills,
    keywords,
    targetRoles,
    highlights,
    experienceLabel: yearsLabel,
    sections: sections.filter((s) => s.key !== 'header').map((s) => ({ key: s.key, label: s.label, text: s.lines.join('\n') })),
    source: { filename, chars: text.length }
  };
  profile.quality = qualityOf(profile, text);
  return profile;
}

export function condenseProfile(profile) {
  if (!profile) return '';
  const lines = [];
  lines.push(`姓名：${profile.name || '未提供'}｜学历：${profile.education?.[0]?.degree || ''} ${profile.education?.[0]?.major || ''}`.trim());
  if (profile.education?.length) {
    lines.push('教育：' + profile.education.map((e) => `${e.school} ${e.major} ${e.degree} ${e.start}-${e.end}`.trim()).join('；'));
  }
  if (profile.experience?.length) {
    lines.push('经历：');
    for (const e of profile.experience.slice(0, 4)) {
      lines.push(`- ${e.company}｜${e.role}｜${e.start}-${e.end}`);
      for (const b of e.bullets.slice(0, 4)) lines.push(`  · ${b.label ? `${b.label}：` : ''}${b.text.slice(0, 160)}`);
    }
  }
  if (profile.projects?.length) {
    lines.push('项目：');
    for (const p of profile.projects.slice(0, 3)) {
      lines.push(`- ${p.name}｜${p.role}｜${p.start}-${p.end}`);
      for (const b of p.bullets.slice(0, 5)) lines.push(`  · ${b.label ? `${b.label}：` : ''}${b.text.slice(0, 180)}`);
    }
  }
  if (profile.skills?.length) lines.push(`技能：${profile.skills.slice(0, 18).join('、')}`);
  return lines.join('\n').slice(0, 3000);
}

export function resumeToText(profile) {
  if (!profile) return '';
  const parts = [profile.headline, profile.summary];
  for (const e of profile.experience || []) {
    parts.push(`${e.company} ${e.role} ${e.start}-${e.end}`);
    for (const b of e.bullets) parts.push(`${b.label}：${b.text}`);
  }
  for (const p of profile.projects || []) {
    parts.push(`${p.name} ${p.role} ${p.start}-${p.end}`);
    for (const b of p.bullets) parts.push(`${b.label}：${b.text}`);
  }
  parts.push((profile.skills || []).join(' '));
  return parts.join('\n');
}
