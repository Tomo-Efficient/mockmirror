import { esc, icon, scoreTone } from './ui.js';

export function pageHead({ eyebrow = '', title, desc = '', actions = '' }) {
  return `<div class="page-head">
    <div>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div>
    ${actions ? `<div class="row wrap">${actions}</div>` : ''}
  </div>`;
}

export function emptyState({ iconName = 'sparkles', title, desc = '', action = '' }) {
  return `<div class="empty">${icon(iconName, 44)}<h3>${esc(title)}</h3><p>${desc}</p>${action}</div>`;
}

export function personaAvatar(persona, extra = '') {
  const color = persona?.color || '#18181b';
  const initial = { peer: '同', senior: '资', manager: '经' }[persona?.id] || (persona?.name || '面').slice(0, 1);
  return `<span class="avatar ${extra}" style="background:${color}22;border-color:${color}55;color:${color}">${esc(initial)}</span>`;
}

export function kbCard(doc) {
  return `<a class="kb-card" href="/knowledge?id=${encodeURIComponent(doc.id)}" data-link>
    <span class="k-cat">${esc(doc.category || '知识')}</span>
    <h3>${esc(doc.title)}</h3>
    <p>${esc(doc.summary || '')}</p>
    <div class="k-foot"><span>${esc(doc.source || '面镜教研组')}</span><span>${doc.readingMinutes || 3} min</span></div>
  </a>`;
}

export function scoreBadge(score, label = '') {
  const tone = scoreTone(score);
  return `<span class="badge ${tone === 'green' ? 'ok' : tone === 'amber' ? 'warn' : tone === 'red' ? 'bad' : ''}">${label ? `${esc(label)} ` : ''}${Math.round(score)}</span>`;
}

export function personaLabels(personas, id) {
  return personas.find((p) => p.id === id) || { name: '面试官' };
}

export function statBlock(value, label) {
  return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
}
