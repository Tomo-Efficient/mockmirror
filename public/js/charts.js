const DIMS = [
  { key: 'structure', label: '结构表达' },
  { key: 'relevance', label: '内容相关' },
  { key: 'depth', label: '专业深度' },
  { key: 'impact', label: '结果量化' },
  { key: 'fit', label: '岗位匹配' }
];

export function radarSVG(scores = {}, { size = 300, showLabels = true } = {}) {
  const cx = size / 2;
  const cy = size / 2 + 2;
  const R = size * 0.31;
  const n = DIMS.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const rings = [0.25, 0.5, 0.75, 1];
  let out = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="radar" role="img" aria-label="能力雷达图">`;
  out += `<defs><linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#18181b" stop-opacity=".14"/><stop offset="1" stop-color="#18181b" stop-opacity=".04"/></linearGradient></defs>`;
  for (const k of rings) {
    const pts = DIMS.map((_, i) => pt(i, R * k).join(',')).join(' ');
    out += `<polygon points="${pts}" fill="none" stroke="${k === 1 ? '#d4d4d8' : '#e4e4e7'}" stroke-width="1"/>`;
  }
  DIMS.forEach((_, i) => {
    const [x, y] = pt(i, R);
    out += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#f0f0f1" stroke-width="1"/>`;
  });
  const points = DIMS.map((d, i) => pt(i, R * Math.max(0.04, Math.min(1, (scores[d.key] || 0) / 100))));
  out += `<polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="url(#radarFill)" stroke="#18181b" stroke-width="1.6" stroke-linejoin="round"/>`;
  points.forEach(([x, y]) => { out += `<circle cx="${x}" cy="${y}" r="3.2" fill="#ffffff" stroke="#18181b" stroke-width="1.6"/>`; });
  if (showLabels) {
    DIMS.forEach((d, i) => {
      const [x, y] = pt(i, R + 30);
      const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
      out += `<text x="${x}" y="${y - 2}" text-anchor="${anchor}" font-size="11" fill="#71717a">${d.label}</text>`;
      out += `<text x="${x}" y="${y + 12}" text-anchor="${anchor}" font-size="12" font-family="SFMono-Regular, Menlo, monospace" fill="#18181b">${scores[d.key] || 0}</text>`;
    });
  }
  out += '</svg>';
  return out;
}

export function ringSVG(score = 0, { size = 170, label = 'READINESS' } = {}) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring-svg" role="img" aria-label="准备度 ${value} 分">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke="#18181b" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - value / 100)}"/>
    <text x="50%" y="48%" text-anchor="middle" class="ring-txt">${Math.round(value)}</text>
    <text x="50%" y="60%" text-anchor="middle" class="ring-sub">${label}</text>
  </svg>`;
}

export function miniBars(scores = {}) {
  return DIMS.map((d) => {
    const v = Math.max(0, Math.min(100, scores[d.key] || 0));
    return `<div class="sm-row"><span>${d.label}</span><div class="meter"><i style="width:${v}%"></i></div><b>${v}</b></div>`;
  }).join('');
}

export { DIMS };
