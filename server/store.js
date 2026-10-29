import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { CONTENT_DIR, DATA_DIR, DATA_FILE, ENV_LLM, DATABASE_URL } from './config.js';

const EMPTY = () => ({
  personas: [],
  roles: [],
  questions: [],
  kb: [],
  customKb: [],
  bank: [],
  sessions: [],
  resumes: {},
  meta: { createdAt: new Date().toISOString() },
  settings: {
    llm: {
      provider: 'deepseek',
      baseUrl: ENV_LLM.baseUrl || 'https://api.deepseek.com/v1',
      model: ENV_LLM.model || 'deepseek-chat',
      apiKey: ENV_LLM.apiKey || '',
      temperature: Number.isFinite(ENV_LLM.temperature) ? ENV_LLM.temperature : 0.7,
      enabled: Boolean(ENV_LLM.apiKey)
    },
    profile: { name: '', targetRole: '' },
    preferences: { defaultRounds: 6, defaultPersona: 'senior' }
  }
});

export const store = EMPTY();

let sql = null;
let storage = 'file';
let writeChain = Promise.resolve();

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
};

function readDirJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    try {
      const parsed = readJson(path.join(dir, file));
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch (err) {
      console.warn(`[store] 跳过无法解析的内容文件 ${file}: ${err.message}`);
    }
  }
  return out;
}

function normalizeQuestion(q, i) {
  const cat = q.category || '专业能力';
  return {
    id: q.id || `q-${i}`,
    text: q.text || '',
    category: cat,
    role: Array.isArray(q.role) ? q.role : [],
    level: q.level || '中级',
    persona: Array.isArray(q.persona) && q.persona.length ? q.persona : ['senior', 'manager'],
    difficulty: Math.min(5, Math.max(1, Number(q.difficulty) || 3)),
    intent: q.intent || '',
    tags: Array.isArray(q.tags) ? q.tags : [],
    answerPoints: Array.isArray(q.answerPoints) ? q.answerPoints : [],
    followUps: Array.isArray(q.followUps) ? q.followUps : [],
    redFlags: Array.isArray(q.redFlags) ? q.redFlags : [],
    starExample: q.starExample || '',
    source: 'builtin'
  };
}

function loadContent() {
  store.personas = readDirJson(CONTENT_DIR).length ? [] : [];
  try {
    store.personas = readJson(path.join(CONTENT_DIR, 'personas.json'), []);
  } catch { store.personas = []; }
  try {
    store.roles = readJson(path.join(CONTENT_DIR, 'roles.json'), []);
  } catch { store.roles = []; }

  const rawQuestions = readDirJson(path.join(CONTENT_DIR, 'questions'));
  store.questions = rawQuestions
    .filter((q) => q && q.text)
    .map(normalizeQuestion)
    .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);

  store.kb = readDirJson(path.join(CONTENT_DIR, 'kb'))
    .filter((d) => d && d.title && d.content)
    .map((d) => ({
      id: d.id || crypto.randomUUID(),
      title: d.title,
      category: d.category || '回答方法论',
      tags: Array.isArray(d.tags) ? d.tags : [],
      summary: d.summary || '',
      content: d.content,
      source: d.source || '面镜教研组',
      readingMinutes: Number(d.readingMinutes) || Math.max(2, Math.round((d.content || '').length / 500)),
      custom: false,
      createdAt: null
    }));
}

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const saved = readJson(DATA_FILE);
    if (saved.settings) {
      store.settings = {
        ...store.settings,
        ...saved.settings,
        llm: { ...store.settings.llm, ...(saved.settings.llm || {}) },
        profile: { ...store.settings.profile, ...(saved.settings.profile || {}) },
        preferences: { ...store.settings.preferences, ...(saved.settings.preferences || {}) }
      };
    }
    if (Array.isArray(saved.bank)) store.bank = saved.bank;
    if (Array.isArray(saved.sessions)) store.sessions = saved.sessions;
    if (saved.resumes && typeof saved.resumes === 'object') store.resumes = saved.resumes;
    if (Array.isArray(saved.customKb)) store.customKb = saved.customKb;
  } catch (err) {
    console.warn(`[store] 数据文件损坏，已备份并重建: ${err.message}`);
    try { fs.copyFileSync(DATA_FILE, `${DATA_FILE}.broken-${Date.now()}`); } catch {}
  }
  if (!store.settings.llm.apiKey && ENV_LLM.apiKey) {
    store.settings.llm.apiKey = ENV_LLM.apiKey;
    store.settings.llm.enabled = true;
  }
}

let saveTimer = null;

function applyData(saved) {
  if (!saved || typeof saved !== 'object') return;
  if (saved.settings) {
    store.settings = {
      ...store.settings,
      ...saved.settings,
      llm: { ...store.settings.llm, ...(saved.settings.llm || {}) },
      profile: { ...store.settings.profile, ...(saved.settings.profile || {}) },
      preferences: { ...store.settings.preferences, ...(saved.settings.preferences || {}) }
    };
  }
  if (Array.isArray(saved.bank)) store.bank = saved.bank;
  if (Array.isArray(saved.sessions)) store.sessions = saved.sessions;
  if (saved.resumes && typeof saved.resumes === 'object') store.resumes = saved.resumes;
  if (Array.isArray(saved.customKb)) store.customKb = saved.customKb;
}

function applyEnvLlm() {
  if (!store.settings.llm.apiKey && ENV_LLM.apiKey) {
    store.settings.llm.apiKey = ENV_LLM.apiKey;
    store.settings.llm.enabled = true;
  }
}

function payload() {
  return {
    settings: store.settings,
    bank: store.bank,
    sessions: store.sessions,
    resumes: store.resumes,
    customKb: store.customKb
  };
}

function writeFile(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[store] 保存失败', err);
  }
}

async function persistState() {
  const data = payload();
  if (storage === 'neon' && sql) {
    try {
      const json = JSON.stringify(data);
      await sql`INSERT INTO mockmirror_state (id, data, updated_at)
                VALUES (1, ${json}::jsonb, now())
                ON CONFLICT (id) DO UPDATE
                SET data = EXCLUDED.data, updated_at = now()`;
      return;
    } catch (err) {
      console.error('[store] Neon 保存失败，降级文件:', err.message);
      storage = 'file';
    }
  }
  writeFile(data);
}

function enqueuePersist() {
  writeChain = writeChain.then(persistState, persistState);
  return writeChain;
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void enqueuePersist();
  }, 80);
  saveTimer.unref?.();
}

export async function flushStore() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await enqueuePersist();
}

export async function initStore() {
  loadContent();
  if (DATABASE_URL) {
    try {
      sql = neon(DATABASE_URL);
      await sql`CREATE TABLE IF NOT EXISTS mockmirror_state (
        id smallint PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (id = 1)
      )`;
      const rows = await sql`SELECT data FROM mockmirror_state WHERE id = 1`;
      storage = 'neon';
      if (rows[0]?.data) {
        applyData(typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data);
        console.log('[store] Neon 持久化已连接');
      } else {
        loadData();
        await enqueuePersist();
        console.log('[store] Neon 持久化已初始化');
      }
    } catch (err) {
      console.warn(`[store] Neon 连接失败，降级文件: ${err.message}`);
      storage = 'file';
      loadData();
    }
  } else {
    loadData();
  }
  applyEnvLlm();
  console.log(`[store] 内容加载完成：${store.questions.length} 道题 / ${store.kb.length} 篇知识 / ${store.roles.length} 个岗位包 / ${store.personas.length} 种人格`);
}

export function storageMode() {
  return storage;
}

export function allKb() {
  return [...store.kb, ...store.customKb];
}

export function findKb(id) {
  return allKb().find((d) => d.id === id);
}

export function publicSettings() {
  const { llm } = store.settings;
  return {
    llm: {
      provider: llm.provider,
      baseUrl: llm.baseUrl,
      model: llm.model,
      temperature: llm.temperature,
      enabled: Boolean(llm.enabled && llm.apiKey),
      hasKey: Boolean(llm.apiKey),
      keyHint: llm.apiKey ? `••••${llm.apiKey.slice(-4)}` : ''
    },
    profile: store.settings.profile,
    preferences: store.settings.preferences
  };
}

export function updateSettings(patch = {}) {
  const s = store.settings;
  if (patch.llm) {
    const next = { ...s.llm, ...patch.llm };
    if (patch.llm.apiKey === '' || patch.llm.apiKey == null) {
      if (patch.llm.apiKey === '') next.apiKey = '';
    }
    if (typeof next.temperature !== 'number') next.temperature = 0.7;
    next.temperature = Math.min(1.5, Math.max(0, next.temperature));
    if (!next.apiKey) next.enabled = false;
    s.llm = next;
  }
  if (patch.profile) s.profile = { ...s.profile, ...patch.profile };
  if (patch.preferences) s.preferences = { ...s.preferences, ...patch.preferences };
  save();
  return publicSettings();
}

export function getSession(id) {
  return store.sessions.find((s) => s.id === id);
}

export function createSession(session) {
  store.sessions.unshift(session);
  if (store.sessions.length > 200) store.sessions.length = 200;
  save();
  return session;
}

export function deleteSession(id) {
  const i = store.sessions.findIndex((s) => s.id === id);
  if (i < 0) return false;
  store.sessions.splice(i, 1);
  save();
  return true;
}

export function listSessions() {
  return store.sessions.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
    persona: s.config.persona,
    roleName: s.config.roleName,
    candidateName: s.profile?.name || '',
    jdTitle: s.jd?.title || '',
    answered: s.evaluations?.length || 0,
    rounds: s.plan?.rounds?.length || 0,
    score: s.report?.readiness ?? s.metrics?.avgScore ?? null
  }));
}

export function stats() {
  return {
    questions: store.questions.length,
    kb: allKb().length,
    roles: store.roles.length,
    sessions: store.sessions.length,
    answered: store.sessions.reduce((n, s) => n + (s.evaluations?.length || 0), 0),
    bank: store.bank.length
  };
}

export function addBankItem(item) {
  const exists = store.bank.find((b) => b.question === item.question);
  if (exists) return exists;
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    question: item.question,
    category: item.category || '未分类',
    tags: item.tags || [],
    source: item.source || '模拟面试',
    sessionId: item.sessionId || null,
    status: 'new',
    notes: '',
    createdAt: now,
    updatedAt: now,
    reviewAt: now,
    reviewCount: 0
  };
  store.bank.unshift(row);
  save();
  return row;
}

export function updateBankItem(id, patch = {}) {
  const item = store.bank.find((b) => b.id === id);
  if (!item) return null;
  const allowed = ['status', 'notes', 'tags', 'question', 'category'];
  for (const key of allowed) {
    if (patch[key] !== undefined) item[key] = patch[key];
  }
  item.updatedAt = new Date().toISOString();
  if (patch.status && patch.status !== 'new') {
    item.reviewCount = (item.reviewCount || 0) + 1;
    const gap = { learning: 1, mastered: 7 }[patch.status] || 1;
    item.reviewAt = new Date(Date.now() + gap * 86400000).toISOString();
  }
  save();
  return item;
}

export function deleteBankItem(id) {
  const i = store.bank.findIndex((b) => b.id === id);
  if (i < 0) return false;
  store.bank.splice(i, 1);
  save();
  return true;
}

export function addCustomKb(doc) {
  const row = {
    ...doc,
    id: doc.id || `custom-${crypto.randomUUID().slice(0, 8)}`,
    custom: true,
    source: doc.source || '我的知识库',
    createdAt: new Date().toISOString()
  };
  store.customKb.unshift(row);
  save();
  return row;
}

export function deleteCustomKb(id) {
  const i = store.customKb.findIndex((d) => d.id === id);
  if (i < 0) return false;
  store.customKb.splice(i, 1);
  save();
  return true;
}

export function addResume(resume) {
  const row = {
    id: resume.id || crypto.randomUUID(),
    name: resume.name || '未命名简历',
    filename: resume.filename || '',
    text: resume.text,
    profile: resume.profile,
    quality: resume.quality,
    createdAt: new Date().toISOString()
  };
  store.resumes[row.id] = row;
  const ids = Object.keys(store.resumes);
  if (ids.length > 40) {
    for (const id of ids.slice(0, ids.length - 40)) delete store.resumes[id];
  }
  save();
  return row;
}

export function getResume(id) {
  return store.resumes[id] || null;
}
