import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { esc, icon, toast, fmtDate, personaMeta, relativeTime } from '../ui.js';
import { pageHead, emptyState } from '../components.js';

export async function renderHistory(params, root) {
  const { sessions } = await api('/api/sessions');
  const finished = sessions.filter((s) => s.status === 'finished');
  const scores = finished.map((s) => s.score).filter((n) => typeof n === 'number');
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const best = scores.length ? Math.max(...scores) : null;
  let filter = 'all';

  root.innerHTML = `<div class="page">
    ${pageHead({ eyebrow: 'SESSIONS', title: '面试记录', desc: '所有演练都留在这里。进行中的可以继续，完成的可以回看报告。', actions: `<a class="btn btn-primary btn-sm" href="/start" data-link>${icon('plus', 14)} 新一场</a>` })}
    <div class="grid grid-3" style="margin-bottom:22px">
      <div class="card" style="padding:18px"><div class="stat"><strong>${sessions.length}</strong><span>累计场次</span></div></div>
      <div class="card" style="padding:18px"><div class="stat"><strong>${avg ?? '—'}</strong><span>平均准备度</span></div></div>
      <div class="card" style="padding:18px"><div class="stat"><strong>${best ?? '—'}</strong><span>最佳准备度</span></div></div>
    </div>
    <div class="toolbar">
      <div class="segmented" id="hisSeg">
        <button data-f="all" class="active">全部 ${sessions.length}</button>
        <button data-f="active">进行中 ${sessions.filter((s) => s.status !== 'finished').length}</button>
        <button data-f="finished">已完成 ${finished.length}</button>
      </div>
      <span class="spacer"></span>
      <span class="small faint">最近更新在前</span>
    </div>
    <div id="hisList"></div>
  </div>`;

  const list = root.querySelector('#hisList');
  function paint() {
    const filtered = sessions.filter((s) => filter === 'all' || (filter === 'finished' ? s.status === 'finished' : s.status !== 'finished'));
    if (!filtered.length) {
      list.innerHTML = emptyState({ iconName: 'history', title: filter === 'all' ? '还没有面试记录' : '这个分类下暂无记录', desc: '准备好简历和 JD，第一场模拟只要 15 分钟。', action: '<a class="btn btn-primary btn-sm" href="/start" data-link>开始第一场</a>' });
      return;
    }
    list.innerHTML = `<div class="history-list">${filtered.map((s) => {
      const persona = personaMeta(state.personas, s.persona);
      const done = s.status === 'finished';
      return `<div class="history-row">
        <span class="avatar" style="background:${persona.color}22;border-color:${persona.color}44;color:${persona.color}">${s.persona === 'peer' ? '同' : s.persona === 'senior' ? '资' : '经'}</span>
        <a class="h-main" href="${done ? `/report/${s.id}` : `/interview/${s.id}`}" data-link>
          <h3>${esc(s.roleName || '模拟面试')} <span class="badge ${done ? 'ok' : 'warn'}">${done ? '已完成' : '进行中'}</span></h3>
          <p>${esc(s.candidateName || '')} · ${esc(persona.name)} · ${s.answered}/${s.rounds} 题 · ${relativeTime(s.updatedAt || s.createdAt)}</p>
        </a>
        <div class="h-score">${s.score != null ? s.score : '—'}<small>准备度</small></div>
        <a class="btn btn-ghost btn-sm" href="${done ? `/report/${s.id}` : `/interview/${s.id}`}" data-link>${done ? '看报告' : '继续'}</a>
        <button class="icon-btn" data-del="${s.id}" title="删除记录">${icon('trash', 15)}</button>
      </div>`;
    }).join('')}</div>`;
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('删除这条面试记录？报告和作答都会一起删除。')) return;
        try {
          await api(`/api/sessions/${btn.dataset.del}`, { method: 'DELETE' });
          const idx = sessions.findIndex((x) => x.id === btn.dataset.del);
          sessions.splice(idx, 1);
          paint(); refreshStats(); toast('记录已删除');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }
  root.querySelectorAll('#hisSeg button').forEach((btn) => {
    btn.onclick = () => {
      filter = btn.dataset.f;
      root.querySelectorAll('#hisSeg button').forEach((b) => b.classList.toggle('active', b === btn));
      paint();
    };
  });
  paint();
}
