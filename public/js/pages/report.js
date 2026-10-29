import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { esc, icon, toast, fmtDate, personaMeta, downloadFile, modal, md, copyText, scoreTone } from '../ui.js';
import { radarSVG, DIMS } from '../charts.js';

const DIM_LABEL = Object.fromEntries(DIMS.map((d) => [d.key, d.label]));

function verdictBadge(score) {
  const tone = scoreTone(score);
  const label = score >= 82 ? '强' : score >= 68 ? '稳' : score >= 52 ? '待加强' : '风险';
  return `<span class="badge ${tone === 'green' ? 'ok' : tone === 'amber' ? 'warn' : tone === 'red' ? 'bad' : ''}">${label}</span>`;
}

export async function renderReport(params, root) {
  let session = await api(`/api/sessions/${params.id}`);
  if (!session.report) {
    if (session.status === 'active') { root.innerHTML = `<div class="page"><div class="empty"><p>这场面试还没结束。</p><a class="btn btn-primary" href="/interview/${session.id}" data-link>继续面试</a></div></div>`; return; }
    toast('正在生成报告…');
    session = await api(`/api/sessions/${session.id}/report`, { method: 'POST' });
  }
  const report = session.report;
  const kbMap = new Map();
  try {
    const kb = await api('/api/kb');
    for (const doc of kb.items || []) kbMap.set(doc.id, doc.title);
  } catch { /* ignore */ }
  const persona = personaMeta(state.personas, session.config.persona);
  const evaluations = session.evaluations || [];
  const analysis = session.jd?.analysis;

  root.innerHTML = `<div class="page">
    <div class="row-between wrap" style="margin-bottom:18px">
      <a class="btn btn-quiet btn-sm" href="/history" data-link>${icon('arrowLeft', 15)} 面试记录</a>
      <div class="row">
        <button class="btn btn-ghost btn-sm" id="copyBtn">${icon('copy', 14)} 复制摘要</button>
        <button class="btn btn-ghost btn-sm" id="exportBtn">${icon('download', 14)} 导出 Markdown</button>
        <a class="btn btn-primary btn-sm" href="/start" data-link>${icon('refresh', 14)} 再来一场</a>
      </div>
    </div>

    <section class="report-hero">
      <div class="ring-wrap">${radarRing(report.readiness)}</div>
      <div>
        <div class="row wrap" style="gap:8px;margin-bottom:10px">
          <span class="badge ${report.preliminary ? 'warn' : 'ok'}">${report.preliminary ? '初评 · 题量偏少' : '完整复盘'}</span>
          <span class="chip">${esc(persona.name)}</span>
          <span class="chip">${esc(session.jd?.analysis?.roleName || '目标岗位')}</span>
          <span class="chip">${evaluations.length} 次作答${session.metrics?.durationSec >= 60 ? ` · ${Math.round(session.metrics.durationSec / 60)} 分钟` : ''}</span>
          <span class="chip ${report.mode === 'llm' ? 'violet' : ''}">${report.mode === 'llm' ? '模型评估' : '规则评分'}</span>
        </div>
        <h1>${esc(report.headline || '本场复盘')}</h1>
        <p>${esc(report.narrative || '')}</p>
        <div class="report-actions">
          <a class="btn btn-primary" href="#qa">${icon('list', 15)} 看逐题复盘</a>
          <a class="btn btn-ghost" href="#actions">${icon('target', 15)} 7 天行动清单</a>
        </div>
      </div>
    </section>

    <div class="report-grid">
      <div class="stack">
        <div class="report-section">
          <h2>${icon('chart', 16)} 五维能力</h2>
          <div class="radar-wrap">${radarSVG(report.dimensionScores || {}, { size: 300 })}</div>
          <div class="dim-list">${DIMS.map((d) => `<div class="dim-row"><span>${d.label}</span><div class="meter"><i style="width:${report.dimensionScores?.[d.key] || 0}%"></i></div><b>${report.dimensionScores?.[d.key] || 0}</b></div>`).join('')}</div>
        </div>
        <div class="report-section" id="qa">
          <h2>${icon('message', 16)} 逐题复盘 <span class="faint small" style="font-weight:400;margin-left:auto">${evaluations.length} 条</span></h2>
          <div class="qa-list">
            ${evaluations.map((e, i) => qaItem(e, i)).join('') || '<div class="empty"><p>这场没有产生有效作答。</p></div>'}
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="report-section">
          <h2>${icon('target', 16)} 岗位匹配</h2>
          ${analysis ? `<div class="jd-match-strip">
            <div class="jms"><strong>${analysis.matchScore}</strong><span>匹配度</span></div>
            <div class="jms"><strong>${analysis.coverage}%</strong><span>关键词覆盖</span></div>
            <div class="jms"><strong>${(analysis.missing || []).length}</strong><span>待补缺口</span></div>
          </div>
          <div class="kw-row" style="margin-top:14px">${(analysis.matched || []).map((k) => `<span class="chip green">${esc(k)}</span>`).join('')}${(analysis.missing || []).map((k) => `<span class="chip amber">${esc(k)}</span>`).join('')}</div>
          ${analysis.suggestions?.[0] ? `<p class="small muted" style="margin-top:12px;line-height:1.75">${esc(analysis.suggestions[0])}</p>` : ''}` : '<div class="rail-empty">本场未做 JD 分析</div>'}
        </div>

        <div class="report-section" id="actions">
          <h2>${icon('zap', 16)} 7 天行动清单</h2>
          <div style="margin-top:14px">
            ${(report.actions || []).map((a, i) => `<div class="action-card"><span class="n">${String(i + 1).padStart(2, '0')}</span><div><h4>${esc(a.title)}</h4><p>${esc(a.detail)}</p>${a.kbId ? `<a href="/knowledge?id=${encodeURIComponent(a.kbId)}" data-link>${icon('book', 12)} 去看《${esc(kbMap.get(a.kbId) || '相关面经')}》</a>` : ''}</div></div>`).join('')}
          </div>
        </div>

        <div class="report-section">
          <h2>${icon('award', 16)} 本场优点</h2>
          <ul class="evidence" style="margin-top:12px">${(report.strengths || []).map((x) => `<li class="good"><strong>${esc(x.title || '')}</strong><br>${esc(x.detail || '')}</li>`).join('')}</ul>
        </div>
        <div class="report-section">
          <h2>${icon('alert', 16)} 需要优先修正</h2>
          <ul class="evidence" style="margin-top:12px">${(report.risks || []).map((x) => `<li class="risk"><strong>${esc(x.title || '')}</strong><br>${esc(x.detail || '')}</li>`).join('')}</ul>
        </div>
      </div>
    </div>

    <div class="report-meta">
      <span>${icon('clock', 12)} 生成于 ${fmtDate(report.generatedAt)}</span>
      <span>${icon('route', 12)} ${evaluations.length} 次作答 · ${session.plan?.rounds?.length || 0} 题题单</span>
      <span>${icon('shield', 12)} ${report.mode === 'llm' ? '由模型基于本场记录生成，结论仅供参考' : '规则引擎评分：结构、相关、深度、量化、匹配五维启发式'}</span>
    </div>
  </div>`;

  root.querySelectorAll('.qa-head').forEach((head) => {
    head.onclick = () => head.closest('.qa-item').classList.toggle('open');
  });

  root.querySelectorAll('[data-save-q]').forEach((btn) => {
    btn.onclick = async () => {
      const i = Number(btn.dataset.saveQ);
      const e = evaluations[i];
      btn.disabled = true;
      try {
        await api('/api/bank', { method: 'POST', body: { question: e.question.text, category: e.question.stage, tags: e.question.tags || [], source: `模拟面试 · ${session.jd?.analysis?.roleName || ''}`, sessionId: session.id } });
        btn.innerHTML = `${icon('check', 13)} 已加入题库`;
        btn.classList.add('btn-ghost');
        refreshStats();
        toast('已加入个人题库');
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  });

  root.querySelectorAll('[data-kb]').forEach((el) => {
    el.onclick = async (e) => {
      e.preventDefault();
      try {
        const { item } = await api(`/api/kb/${el.dataset.kb}`);
        modal({ title: item.title, subtitle: `${item.category} · ${item.source}`, body: `<div class="prose">${md(item.content)}</div>`, width: 760 });
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  root.querySelector('#exportBtn').onclick = () => {
    downloadFile(`面镜复盘-${session.profile?.name || '候选人'}-${new Date().toISOString().slice(0, 10)}.md`, buildMarkdown(session, report));
    toast('已导出 Markdown');
  };
  root.querySelector('#copyBtn').onclick = async () => {
    const text = `【面镜复盘】${session.profile?.name || ''} · ${session.jd?.analysis?.roleName || ''}\n准备度 ${report.readiness}/100 · ${report.headline}\n${(report.risks || [])[0]?.title || ''}\n下一步：${(report.actions || [])[0]?.title || ''}`;
    await copyText(text);
    toast('摘要已复制');
  };
}

function radarRing(score) {
  const r = 74;
  const c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 170 170" width="170" height="170" role="img" aria-label="准备度 ${score} 分">
    <circle cx="85" cy="85" r="${r}" fill="none" stroke="#f4f4f5" stroke-width="7"/>
    <circle cx="85" cy="85" r="${r}" fill="none" stroke="#18181b" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}" transform="rotate(-90 85 85)"/>
    <text x="85" y="88" text-anchor="middle" font-family="SFMono-Regular,Menlo,monospace" font-size="40" font-weight="600" fill="#18181b">${Math.round(score)}</text>
    <text x="85" y="108" text-anchor="middle" font-size="9" letter-spacing="2" fill="#8a8a93">READINESS</text>
  </svg>`;
}

function qaItem(e, i) {
  const score = e.total || 0;
  const tone = scoreTone(score);
  return `<div class="qa-item ${i === 0 ? 'open' : ''}">
    <div class="qa-head">
      <span class="qa-idx">${String(i + 1).padStart(2, '0')}</span>
      <div class="qa-title"><div class="row wrap" style="gap:6px;margin-bottom:4px"><span class="badge">${esc(e.question.stage)}</span>${e.isProbe ? '<span class="badge warn">追问</span>' : ''}${verdictBadge(score)}</div>${esc(e.question.text)}</div>
      <span class="qa-score" style="color:var(--ink)">${score}</span>
      ${icon('chevronDown', 16)}
    </div>
    <div class="qa-body">
      <div class="qa-answer">${esc(e.answer || '（未作答）')}</div>
      <div class="qa-block"><h5>五维得分</h5><div class="qa-scores">${DIMS.map((d) => `<span class="qa-score-pill">${d.label} <b>${e.scores?.[d.key] || 0}</b></span>`).join('')}</div></div>
      ${e.strengths?.length ? `<div class="qa-block"><h5>做得好的</h5><ul class="evidence">${e.strengths.map((x) => `<li class="good">${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${e.risks?.length ? `<div class="qa-block"><h5>需要改进</h5><ul class="evidence">${e.risks.map((x) => `<li class="risk">${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${e.coaching ? `<div class="qa-block"><h5>教练建议</h5><p class="evidence">${esc(e.coaching)}</p></div>` : ''}
      ${e.answerPoints?.length ? `<div class="qa-block"><h5>参考要点</h5><ul class="evidence">${e.answerPoints.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${e.rewrite ? `<div class="qa-block"><h5>示范结构</h5><div class="qa-answer" style="white-space:pre-wrap">${esc(e.rewrite)}</div></div>` : ''}
      ${e.reference ? `<div class="qa-block"><h5>参考示范</h5><div class="qa-answer" style="white-space:pre-wrap">${esc(e.reference)}</div></div>` : ''}
      ${(e.citations || []).length ? `<div class="qa-block"><h5>知识库依据</h5>${e.citations.map((c) => `<div class="qa-cite" data-kb="${esc(c.id)}" role="button" tabindex="0">${icon('book', 14)}<div><strong>${esc(c.title)}</strong>${esc(c.snippet || '')}</div></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-save-q="${i}">${icon('plus', 13)} 加入个人题库</button></div>
    </div>
  </div>`;
}

function buildMarkdown(session, report) {
  const lines = [];
  lines.push(`# 面镜 MockMirror · 面试复盘报告`);
  lines.push('');
  lines.push(`- 候选人：${session.profile?.name || ''}`);
  lines.push(`- 目标岗位：${session.jd?.analysis?.roleName || ''}（匹配 ${session.jd?.analysis?.matchScore ?? '-'}）`);
  lines.push(`- 面试官：${personaMeta(state.personas, session.config.persona).name}`);
  lines.push(`- 时间：${fmtDate(report.generatedAt)}`);
  lines.push(`- 准备度：**${report.readiness} / 100**`);
  lines.push('');
  lines.push(`## 总评`);
  lines.push(report.headline || '');
  lines.push('');
  lines.push(report.narrative || '');
  lines.push('');
  lines.push(`## 五维得分`);
  lines.push('| 维度 | 得分 |');
  lines.push('| --- | --- |');
  for (const d of DIMS) lines.push(`| ${d.label} | ${report.dimensionScores?.[d.key] || 0} |`);
  lines.push('');
  lines.push(`## 优势`);
  for (const s of report.strengths || []) lines.push(`- **${s.title}**：${s.detail}`);
  lines.push('');
  lines.push(`## 待改进`);
  for (const r of report.risks || []) lines.push(`- **${r.title}**：${r.detail}`);
  lines.push('');
  lines.push(`## 逐题复盘`);
  for (const [i, e] of (session.evaluations || []).entries()) {
    lines.push(`### ${i + 1}. [${e.question.stage}] ${e.question.text}`);
    lines.push('');
    lines.push(`得分：**${e.total}**（结构 ${e.scores.structure} / 相关 ${e.scores.relevance} / 深度 ${e.scores.depth} / 结果 ${e.scores.impact} / 匹配 ${e.scores.fit}）`);
    lines.push('');
    lines.push(`> ${String(e.answer || '').replace(/\n/g, '\n> ')}`);
    lines.push('');
    for (const r of e.risks || []) lines.push(`- 待改进：${r}`);
    if (e.coaching) lines.push(`- 教练建议：${e.coaching}`);
    if (e.rewrite) { lines.push(''); lines.push('示范结构：'); lines.push(''); lines.push(e.rewrite); }
    lines.push('');
  }
  lines.push(`## 7 天行动清单`);
  for (const [i, a] of (report.actions || []).entries()) lines.push(`${i + 1}. **${a.title}**：${a.detail}`);
  lines.push('');
  lines.push(`---`);
  lines.push(`由面镜 MockMirror 生成 · ${report.mode === 'llm' ? '模型评估' : '规则评分'}`);
  return lines.join('\n');
}
