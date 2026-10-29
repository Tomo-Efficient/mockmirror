import { loadBootstrap, state, paintShell } from './store.js';
import { renderAuth } from './auth.js';
import { api } from './api.js';
import { route, startRouter } from './router.js';
import { icon, toast } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderSetup } from './pages/setup.js';
import { renderInterview } from './pages/interview.js';
import { renderReport } from './pages/report.js';
import { renderBank } from './pages/bank.js';
import { renderKnowledge } from './pages/knowledge.js';
import { renderHistory } from './pages/history.js';
import { renderSettings } from './pages/settings.js';

function paintIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 18); });
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.innerHTML = icon('menu', 20);
}

function setupMenu() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const btn = document.getElementById('menuBtn');
  const close = () => { sidebar?.classList.remove('open'); scrim?.classList.remove('show'); };
  btn?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    scrim?.classList.toggle('show', sidebar?.classList.contains('open'));
  });
  scrim?.addEventListener('click', close);
  document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', close));
}

function paintUser(user) {
  const sideUser = document.getElementById('sideUser');
  const logout = document.getElementById('logoutBtn');
  if (!sideUser || !user) return;
  sideUser.hidden = false;
  logout.hidden = false;
  document.getElementById('sideName').textContent = user.name || '我的账号';
  document.getElementById('sideEmail').textContent = user.email || '';
  document.getElementById('sideAvatar').textContent = (user.name || user.email || '我').slice(0, 1).toUpperCase();
}

async function startApp() {
  try {
    await loadBootstrap();
    paintShell();
  } catch (err) {
    toast('后端未连接，请稍后刷新', 'error', 6000);
  }

  route('/', renderHome);
  route('/start', renderSetup);
  route('/interview/:id', renderInterview);
  route('/report/:id', renderReport);
  route('/bank', renderBank);
  route('/knowledge', renderKnowledge);
  route('/history', renderHistory);
  route('/settings', renderSettings);

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/';
  });

  startRouter();
}

async function boot() {
  paintIcons();
  setupMenu();

  let me = null;
  try {
    const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
    me = await res.json().catch(() => ({}));
    if (res.status === 401 || (me?.auth && !me.user)) {
      renderAuth();
      return;
    }
  } catch {
    // 后端暂时不可用，交给 startApp 的 bootstrap 错误提示
  }
  if (me?.user) paintUser(me.user);
  await startApp();
}

boot();
