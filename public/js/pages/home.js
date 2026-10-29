import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { esc, icon, personaMeta, relativeTime } from '../ui.js';

function statusBadge(session) {
  const done = session.status === 'finished';
  return `<span class="badge ${done ? 'ok' : 'warn'}">${done ? '已完成' : '进行中'}</span>`;
}

function sessionRow(session) {
  const persona = personaMeta(state.personas, session.persona);
  const done = session.status === 'finished';
  const href = done ? `/report/${session.id}` : `/interview/${session.id}`;
  return `<a class="history-row" href="${href}" data-link>
    <span class="avatar" style="background:${persona.color}22;border-color:${persona.color}44;color:${persona.color}">${session.persona === 'peer' ? '同' : session.persona === 'senior' ? '资' : '经'}</span>
    <div class="h-main">
      <h3>${esc(session.roleName || '模拟面试')} ${statusBadge(session)}</h3>
      <p>${esc(session.candidateName || '')} · ${esc(persona.name)} · ${session.answered}/${session.rounds} 题 · ${relativeTime(session.updatedAt || session.createdAt)}</p>
    </div>
    <div class="h-score">${done && session.score != null ? session.score : '—'}<small>${done ? '准备度' : '进行中'}</small></div>
    <span class="btn btn-ghost btn-sm">${done ? '看报告' : '继续'}</span>
  </a>`;
}

export async function renderHome(params, root) {
  await refreshStats();
  const { sessions } = await api('/api/sessions');
  const active = sessions.find((s) => s.status !== 'finished');
  const lastDone = sessions.find((s) => s.status === 'finished');
  const stats = state.stats || {};
  const continueSession = active || lastDone;
  const hasSessions = sessions.length > 0;

  const continueCard = continueSession ? `
    <div class="wb-continue card">
      <div class="wb-continue-main">
        <span class="eyebrow">${active ? 'CONTINUE' : 'LAST SESSION'}</span>
        <h2>${active ? '继续上一场面试' : '上一场已完成'}</h2>
        <p>${esc(continueSession.roleName || '模拟面试')} · ${esc(personaMeta(state.personas, continueSession.persona).name)} · ${continueSession.answered}/${continueSession.rounds} 题</p>
      </div>
      ${active ? `<a class="btn btn-primary" href="/interview/${continueSession.id}" data-link>${icon('play', 14)} 继续</a>`
        : `<div class="wb-score"><strong>${continueSession.score ?? '—'}</strong><span>准备度</span></div><a class="btn btn-ghost" href="/report/${continueSession.id}" data-link>看报告</a>`}
    </div>` : `
    <div class="wb-continue card wb-start">
      <div class="wb-continue-main">
        <span class="eyebrow">START HERE</span>
        <h2>开始第一场模拟面试</h2>
        <p>上传简历，粘贴目标 JD，选一个面试官。</p>
      </div>
      <a class="btn btn-primary" href="/start" data-link>${icon('sparkles', 14)} 开始面试</a>
    </div>`;

  root.innerHTML = `<div class="page wb-page">
    <div class="wb-head">
      <div>
        <span class="eyebrow">WORKBENCH</span>
        <h1>工作台</h1>
        <p>继续练习，或者开始新的一场。</p>
      </div>
      ${hasSessions ? `<a class="btn btn-primary" href="/start" data-link>${icon('plus', 15)} 开始面试</a>` : ''}
    </div>

    ${hasSessions ? `<div class="wb-kpis">
      <span><strong>${sessions.length}</strong> 场记录</span>
      <span><strong>${sessions.filter((s) => s.status !== 'finished').length}</strong> 进行中</span>
      <span><strong>${stats.bank || 0}</strong> 道题库</span>
    </div>` : ''}

    ${continueCard}

    ${hasSessions ? `<div class="wb-section-head">
      <h2>最近面试</h2>
      <a class="text-link" href="/history" data-link>全部记录 ${icon('arrowRight', 13)}</a>
    </div>
    <div class="history-list">${sessions.slice(0, 5).map(sessionRow).join('')}</div>` : ''}

    <div class="wb-links">
      <a href="/bank" data-link>${icon('library', 14)} 个人题库 <span>${stats.bank || 0}</span></a>
      <a href="/knowledge" data-link>${icon('book', 14)} 知识库 <span>${stats.kb || 16}</span></a>
      <a href="/history" data-link>${icon('history', 14)} 面试记录 <span>${sessions.length}</span></a>
    </div>
  </div>`;
}
