import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { esc, icon, personaMeta, reveal } from '../ui.js';
import { pageHead, emptyState, kbCard, personaLabels } from '../components.js';

export async function renderHome(params, root) {
  await refreshStats();
  const [sessionsRes, kbRes] = await Promise.all([
    api('/api/sessions').catch(() => ({ sessions: [] })),
    api('/api/kb').catch(() => ({ items: [] }))
  ]);
  const sessions = sessionsRes.sessions || [];
  const kb = kbRes.items || [];
  const stats = state.stats || {};
  const personas = state.personas || [];
  const nodes = state.nodes || [];
  const last = sessions.find((s) => s.status === 'finished') || sessions[0];

  const heroChat = `<div class="hero-card">
    <div class="hc-top">
      <span class="avatar cyan">资</span>
      <div class="grow"><strong>资深面试官 · 二面</strong><small>AI 产品经理 / 大模型应用</small></div>
      <span class="hc-live"><i></i>LIVE</span>
    </div>
    <div class="hc-chat">
      <div class="hc-msg ai">你提到取数时间从 25 分钟降到 40 秒，这个口径是怎么算的？基线是多少？</div>
      <div class="hc-msg me">按投顾真实取数工单统计，基线是上线前 4 周的均值，去掉了 3 个异常工单。</div>
      <div class="hc-msg ai">去掉异常工单的标准是什么？如果不去掉，结论还成立吗？<span class="hc-typing"><i></i><i></i><i></i></span></div>
    </div>
    <div class="hc-foot"><span>${icon('route', 13)} 条件路由 · 追问 1/2</span><span class="spacer"></span><span>第 3 / 6 题</span></div>
  </div>`;

  const hero = `<section class="hero">
    <div>
      <span class="eyebrow">AI INTERVIEW COACH · 面镜 v1.0</span>
      <h1>把每一次面试，<br>提前演练一遍。</h1>
      <p class="lead">上传简历与目标 JD，面镜会像真实面试官一样出题、追问、打断，再给你一份能直接照着改的复盘报告。三种人格，一条完整训练闭环。</p>
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="/start" data-link>${icon('sparkles', 17)} 开始一场模拟面试</a>
        ${last && last.status === 'finished' ? `<a class="btn btn-ghost btn-lg" href="/report/${last.id}" data-link>${icon('eye', 17)} 查看上一场报告</a>` : `<a class="btn btn-ghost btn-lg" href="/knowledge" data-link>${icon('book', 17)} 先看 16 篇面经</a>`}
      </div>
      <div class="hero-meta">
        ${[['内置题库', stats.questions || 80, '+'], ['教研知识', stats.kb || 16, ' 篇'], ['面试官人格', 3, ' 种'], ['已演练', stats.answered || 0, ' 次作答']].map(([label, value, suffix]) => `
          <div class="stat"><strong>${value}${suffix}</strong><span>${label}</span></div>`).join('')}
      </div>
    </div>
    <div class="hero-visual">
      ${heroChat}
    </div>
  </section>`;

  const loop = `<div class="section-head reveal">
    <div><span class="eyebrow">01 / PIPELINE</span><h2>不是聊天，是一条训练闭环</h2><div class="desc">每一场都从你的简历出发，以可执行的改进动作结束。中间每一步都能看到依据。</div></div>
  </div>
  <div class="loop-grid reveal">
    ${[
      ['01', '简历解析', 'DOCX / PDF 一键上传，抽出经历、指标、技能与亮点，生成候选人画像。'],
      ['02', '岗位匹配', '粘贴 JD，识别岗位与关键词覆盖，标出你缺的那几块，而不是泛泛而谈。'],
      ['03', '多轮追问', '按简历深挖 → 专业 → 行为 → 压力递进，答得含糊就追问，答得好就换题。'],
      ['04', '复盘沉淀', '五维评分 + 证据 + 示范结构 + 知识库引用，低分题一键进个人题库。']
    ].map(([n, t, d]) => `<div class="loop-card"><span class="num">${n}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}
  </div>`;

  const personaSection = `<div class="section-head reveal">
    <div><span class="eyebrow">02 / PERSONAS</span><h2>三种面试官，三种压力</h2><div class="desc">同一个人、同一份简历，换一种人格，问题的锋利程度完全不同。</div></div>
    <a class="btn btn-quiet btn-sm" href="/start" data-link>去选人格 ${icon('arrowRight', 14)}</a>
  </div>
  <div class="persona-grid reveal">
    ${personas.map((p) => `<div class="persona-card">
      <div class="p-top"><span class="avatar" style="background:${p.color}22;border-color:${p.color}55;color:${p.color}">${p.id === 'peer' ? '同' : p.id === 'senior' ? '资' : '经'}</span>
        <div><h3>${esc(p.name)}</h3><div class="p-sub">${esc(p.subtitle || '')}</div></div></div>
      <p>${esc(p.description || p.tagline || '')}</p>
      <div class="p-focus">${(p.focus || []).map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
    </div>`).join('')}
  </div>`;

  const nodeRow = nodes.length ? nodes.map((n, i) => `
    <div class="pnode ${n.id === 'route' ? 'route' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span><strong>${esc(n.label)}</strong><small>${esc(n.desc)}</small></div>
    ${i < nodes.length - 1 ? `<div class="pconn">${icon('chevronRight', 14)}</div>` : ''}`).join('') : '';

  const pipeline = `<div class="section-head reveal">
    <div><span class="eyebrow">03 / AGENT</span><h2>可解释的 Agent 工作流</h2><div class="desc">用显式状态机编排节点与条件边。每次追问、换题、收尾都有路由依据，过程实时可见。</div></div>
  </div>
  <div class="pipeline reveal">${nodeRow}</div>`;

  const recent = sessions.length ? `<div class="recent-list">
    ${sessions.slice(0, 3).map((s) => `<a class="recent-row" href="${s.status === 'finished' ? `/report/${s.id}` : `/interview/${s.id}`}" data-link>
      <span class="avatar sm" style="background:${personaMeta(personas, s.persona).color}22;border-color:${personaMeta(personas, s.persona).color}44;color:${personaMeta(personas, s.persona).color}">${s.persona === 'peer' ? '同' : s.persona === 'senior' ? '资' : '经'}</span>
      <div class="r-main"><strong>${esc(s.roleName || '模拟面试')} · ${esc(personaLabels(personas, s.persona).name)}</strong><small>${new Date(s.createdAt).toLocaleDateString('zh-CN')} · ${s.answered}/${s.rounds} 题 · ${esc(s.status === 'finished' ? '已完成' : '进行中')}</small></div>
      ${s.score != null ? `<span class="recent-score">${s.score}</span>` : `<span class="badge">继续</span>`}
      ${icon('chevronRight', 15)}
    </a>`).join('')}
  </div>` : emptyState({ iconName: 'message', title: '还没有面试记录', desc: '准备好简历和一份 JD，第一场只要 15 分钟。', action: '<a class="btn btn-primary btn-sm" href="/start" data-link>开始第一场</a>' });

  const kbStrip = kb.length ? `<div class="kb-strip reveal">${kb.slice(0, 4).map((d) => `<div style="min-width:260px;max-width:300px">${kbCard(d)}</div>`).join('')}</div>` : '';

  root.innerHTML = `<div class="page">
    ${hero}
    ${loop}
    ${personaSection}
    ${pipeline}
    <div class="section-head reveal">
      <div><span class="eyebrow">04 / RECENT</span><h2>接着上次继续</h2></div>
      ${sessions.length ? `<a class="btn btn-quiet btn-sm" href="/history" data-link>全部记录 ${icon('arrowRight', 14)}</a>` : ''}
    </div>
    <div class="reveal">${recent}</div>
    <div class="section-head reveal">
      <div><span class="eyebrow">05 / KNOWLEDGE</span><h2>面试前，先补认知</h2><div class="desc">教研知识库会作为 RAG 上下文参与出题与复盘，报告里的建议都有出处。</div></div>
      ${kb.length ? `<a class="btn btn-quiet btn-sm" href="/knowledge" data-link>进入知识库 ${icon('arrowRight', 14)}</a>` : ''}
    </div>
    ${kbStrip}
    <div class="hr"></div>
    <div class="row-between wrap" style="font-size:11px;color:var(--faint)">
      <span>面镜 MockMirror · 个人项目 · 2026</span>
      <span>Node.js · 原生 ES Modules · 零构建</span>
    </div>
  </div>`;
  reveal();
}
