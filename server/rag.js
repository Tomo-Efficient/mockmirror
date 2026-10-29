import { allKb, store } from './store.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'you', 'your', 'are', 'was', 'were', 'have', 'has', 'not', 'but', 'can', 'will',
  '一个', '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '如何', '可以', '需要', '进行', '通过', '以及', '因为', '所以', '但是',
  '如果', '就是', '还是', '没有', '自己', '时候', '问题', '面试', '面试官', '回答', '项目', '公司'
]);

export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const tokens = [];
  for (const m of s.matchAll(/[a-z][a-z0-9+#.]{1,}|[0-9]{2,}/g)) tokens.push(m[0]);
  for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const run = m[0];
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    if (run.length <= 5) tokens.push(run);
  }
  return tokens.filter((t) => !STOPWORDS.has(t) && t.length <= 24);
}

function stripMd(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let index = null;
let indexSig = '';

function buildIndex() {
  const docs = [];
  for (const d of allKb()) {
    docs.push({
      id: d.id,
      type: 'kb',
      title: d.title,
      category: d.category,
      tags: d.tags || [],
      text: `${d.title} ${d.summary} ${d.content}`,
      summary: d.summary,
      content: d.content,
      custom: Boolean(d.custom)
    });
  }
  for (const q of store.questions) {
    docs.push({
      id: q.id,
      type: 'question',
      title: q.text,
      category: q.category,
      tags: q.tags || [],
      text: `${q.text} ${q.intent} ${q.tags.join(' ')} ${q.answerPoints.join(' ')}`,
      question: q
    });
  }
  for (const r of store.roles) {
    docs.push({
      id: r.id,
      type: 'role',
      title: r.name,
      category: '岗位包',
      tags: r.keywords || [],
      text: `${r.name} ${(r.aliases || []).join(' ')} ${(r.keywords || []).join(' ')} ${(r.focusTopics || []).join(' ')}`
    });
  }
  const inverted = new Map();
  let totalLen = 0;
  docs.forEach((doc, i) => {
    const tokens = tokenize(doc.text);
    doc.len = tokens.length;
    doc.tf = new Map();
    totalLen += tokens.length;
    for (const t of tokens) {
      doc.tf.set(t, (doc.tf.get(t) || 0) + 1);
      if (!inverted.has(t)) inverted.set(t, new Set());
      inverted.get(t).add(i);
    }
  });
  index = { docs, inverted, avgdl: totalLen / Math.max(1, docs.length) };
  indexSig = `${allKb().length}:${store.questions.length}:${store.roles.length}`;
}

export function invalidateIndex() {
  index = null;
}

function ensureIndex() {
  const sig = `${allKb().length}:${store.questions.length}:${store.roles.length}`;
  if (!index || sig !== indexSig) buildIndex();
  return index;
}

function snippetFor(doc, tokens) {
  const content = doc.content || doc.text || '';
  const plain = stripMd(content);
  for (const t of tokens.slice(0, 12)) {
    const i = plain.toLowerCase().indexOf(t);
    if (i >= 0) {
      const start = Math.max(0, i - 40);
      return `${start > 0 ? '…' : ''}${plain.slice(start, start + 130)}…`;
    }
  }
  return plain.slice(0, 130);
}

export function search(query, { topK = 6, types = null } = {}) {
  const idx = ensureIndex();
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const qtf = new Map();
  for (const t of tokens) qtf.set(t, (qtf.get(t) || 0) + 1);
  const k1 = 1.35;
  const b = 0.72;
  const N = idx.docs.length;
  const scored = [];
  for (const [term, qn] of qtf) {
    const posting = idx.inverted.get(term);
    if (!posting) continue;
    const idf = Math.log(1 + (N - posting.size + 0.5) / (posting.size + 0.5));
    for (const di of posting) {
      const doc = idx.docs[di];
      if (types && !types.includes(doc.type)) continue;
      const tf = doc.tf.get(term);
      const score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.len / idx.avgdl));
      scored[di] = scored[di] || { doc, score: 0 };
      scored[di].score += score * Math.min(qn, 2);
    }
  }
  return scored
    .filter(Boolean)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK)
    .map(({ doc, score }) => ({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      category: doc.category,
      tags: doc.tags,
      score: Math.round(score * 100) / 100,
      snippet: snippetFor(doc, tokens),
      custom: Boolean(doc.custom)
    }));
}

export function citationsFor(texts, { topK = 3 } = {}) {
  const query = Array.isArray(texts) ? texts.join(' ') : texts;
  return search(query, { topK, types: ['kb'] }).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    snippet: r.snippet,
    score: r.score
  }));
}

export function retrieveQuestions(query, topK = 4) {
  return search(query, { topK, types: ['question'] })
    .map((r) => store.questions.find((q) => q.id === r.id))
    .filter(Boolean);
}
