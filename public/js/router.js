const routes = [];
let cleanup = null;
const TITLES = { '/': '工作台', '/start': '开始面试', '/history': '面试记录', '/bank': '个人题库', '/knowledge': '知识库', '/settings': '设置' };

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ regex, keys, handler, pattern });
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}

export function activeNav(pathname) {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/start')) return 'start';
  if (pathname.startsWith('/history')) return 'history';
  if (pathname.startsWith('/bank')) return 'bank';
  if (pathname.startsWith('/knowledge')) return 'knowledge';
  if (pathname.startsWith('/settings')) return 'settings';
  return '';
}

async function render() {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const view = document.getElementById('view');
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === activeNav(pathname));
  });
  const match = routes.find((r) => r.regex.test(pathname));
  if (!match) {
    view.innerHTML = `<div class="page"><div class="empty">404</div></div>`;
    return;
  }
  const params = {};
  const values = pathname.match(match.regex).slice(1);
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(values[i]); });
  view.innerHTML = '<div class="page-loading"><span class="spinner"></span></div>';
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} cleanup = null; }
  try {
    const result = await match.handler({ ...params, query: new URLSearchParams(location.search) }, view);
    cleanup = result;
    window.scrollTo({ top: 0, behavior: 'instant' });
    view.focus({ preventScroll: true });
    const label = TITLES[pathname] || (pathname.startsWith('/interview') ? '模拟面试' : pathname.startsWith('/report') ? '复盘报告' : '');
    document.title = label ? `${label} · 面镜 MockMirror` : '面镜 MockMirror · AI 面试教练';
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="empty">${err.message || '页面加载失败'}</div></div>`;
  }
}

export function startRouter() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank') return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', render);
  render();
}

export { render };
