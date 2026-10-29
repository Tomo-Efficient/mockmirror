import { loadBootstrap, state, paintShell } from './store.js';
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

async function boot() {
  paintIcons();
  setupMenu();
  try {
    await loadBootstrap();
    paintShell();
  } catch (err) {
    toast('后端未连接，请先运行 npm start', 'error', 6000);
  }

  route('/', renderHome);
  route('/start', renderSetup);
  route('/interview/:id', renderInterview);
  route('/report/:id', renderReport);
  route('/bank', renderBank);
  route('/knowledge', renderKnowledge);
  route('/history', renderHistory);
  route('/settings', renderSettings);

  startRouter();
}

boot();
