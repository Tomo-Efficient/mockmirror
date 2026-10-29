import { api } from './api.js';

export const state = {
  bootstrap: null,
  personas: [],
  roles: [],
  categories: [],
  stats: { questions: 0, kb: 0, roles: 0, sessions: 0, answered: 0, bank: 0 },
  settings: null,
  nodes: [],
  llm: false,
  session: null
};

export async function loadBootstrap(force = false) {
  if (state.bootstrap && !force) return state.bootstrap;
  const data = await api('/api/bootstrap');
  state.bootstrap = data;
  const tones = { peer: '#6d28d9', senior: '#0369a1', manager: '#b45309' };
  state.personas = (data.personas || []).map((p) => ({ ...p, color: tones[p.id] || p.color }));
  state.roles = data.roles || [];
  state.categories = data.categories || [];
  state.stats = data.stats || state.stats;
  state.settings = data.settings;
  state.nodes = data.nodes || [];
  state.llm = Boolean(data.llm?.enabled);
  return data;
}

export async function refreshStats() {
  try {
    state.stats = await api('/api/stats');
    if (state.settings) state.settings = await api('/api/settings');
    state.llm = Boolean(state.settings?.llm?.enabled);
  } catch { /* offline */ }
  paintShell();
}

export function paintShell() {
  const dot = document.getElementById('modeDot');
  const title = document.getElementById('modeTitle');
  const sub = document.getElementById('modeSub');
  const count = document.getElementById('navBankCount');
  if (dot) dot.classList.toggle('online', state.llm);
  if (title) title.textContent = state.llm ? '模型已连接' : '本地规则引擎';
  if (sub) sub.textContent = state.llm ? `${state.settings?.llm?.model || 'LLM'} · 可追问` : '未配置模型 · 点击设置';
  if (count) count.textContent = state.stats?.bank ? String(state.stats.bank) : '';
}
