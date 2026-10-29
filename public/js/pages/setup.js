import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { navigate } from '../router.js';
import { esc, icon, toast, personaMeta } from '../ui.js';

const FOCUS = [
  { id: 'balanced', label: '综合能力', desc: '简历、专业、行为各占一部分' },
  { id: 'deep', label: '专业深挖', desc: '更多技术判断与方案取舍' },
  { id: 'behavior', label: '行为面试', desc: '协作、冲突、失败与复盘' },
  { id: 'pressure', label: '压力面', desc: '质疑数据、压缩资源、连续追问' }
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function matchRing(score) {
  const r = 27;
  const c = 2 * Math.PI * r;
  return `<svg class="match-ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#f4f4f5" stroke-width="5"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#18181b" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle" font-size="15" fill="#18181b" font-family="SFMono-Regular,Menlo,monospace">${score}</text>
  </svg>`;
}

export async function renderSetup(params, root) {
  const s = {
    step: 1,
    resumeId: null,
    profile: null,
    text: '',
    filename: '',
    quality: null,
    jdText: '',
    analysis: null,
    busy: false,
    config: { persona: state.settings?.preferences?.defaultPersona || 'senior', rounds: state.settings?.preferences?.defaultRounds || 6, focus: 'balanced' }
  };

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div><span class="eyebrow">NEW SESSION</span><h1>开始面试</h1><p>上传简历、粘贴 JD、选择面试官。</p></div>
      <a class="btn btn-ghost btn-sm" href="/" data-link>${icon('arrowLeft', 15)} 返回工作台</a>
    </div>
    <div class="steps" id="steps">
      <div class="step active" data-step="1"><span class="idx">01</span><span>简历</span></div><div class="step-line"></div>
      <div class="step" data-step="2"><span class="idx">02</span><span>目标岗位</span></div><div class="step-line"></div>
      <div class="step" data-step="3"><span class="idx">03</span><span>面试设置</span></div>
    </div>
    <div class="setup-grid">
      <div class="panel" id="stepPanel"></div>
      <aside class="config-side" id="side"></aside>
    </div>
  </div>`;

  const panel = root.querySelector('#stepPanel');
  const side = root.querySelector('#side');
  const stepsEl = root.querySelector('#steps');

  function paintSteps() {
    stepsEl.querySelectorAll('.step').forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle('active', n === s.step);
      el.classList.toggle('done', n < s.step);
    });
  }

  function paintSide() {
    const p = s.profile;
    const persona = personaMeta(state.personas, s.config.persona);
    side.innerHTML = `<div class="summary-box">
      <div class="eyebrow" style="margin-bottom:10px">SESSION BRIEF</div>
      <div class="s-row"><span>候选人</span><strong>${p ? esc(p.name) : '待上传'}</strong></div>
      <div class="s-row"><span>目标岗位</span><strong>${s.analysis ? esc(s.analysis.roleName) : '待粘贴 JD'}</strong></div>
      <div class="s-row"><span>岗位匹配</span><strong>${s.analysis ? `${s.analysis.matchScore} / 100` : '—'}</strong></div>
      <div class="s-row"><span>面试官</span><strong>${esc(persona.name)}</strong></div>
      <div class="s-row"><span>题量</span><strong>${s.config.rounds} 题</strong></div>
      <div class="s-row"><span>侧重</span><strong>${FOCUS.find((f) => f.id === s.config.focus)?.label}</strong></div>
    </div>`;
  }

  function bindStepNav() {
    stepsEl.querySelectorAll('.step').forEach((el) => {
      el.onclick = () => {
        const n = Number(el.dataset.step);
        if (n < s.step) { s.step = n; paint(); }
      };
    });
  }

  function paint() {
    paintSteps();
    paintSide();
    bindStepNav();
    if (s.step === 1) step1();
    if (s.step === 2) step2();
    if (s.step === 3) step3();
  }

  async function parseResume({ filename, mime, dataBase64, text }) {
    if (s.busy) return;
    s.busy = true;
    panel.querySelector('.dz-body')?.classList.add('hidden');
    const loading = panel.querySelector('#parseState');
    if (loading) loading.innerHTML = `<div class="dropzone" style="cursor:default"><span class="spinner" style="margin:0 auto 12px"></span><h3>正在解析简历</h3><p>提取经历、指标与技能，大约需要 1-2 秒</p></div>`;
    try {
      const data = await api('/api/resume/parse', { method: 'POST', body: { filename, mime, dataBase64, text } });
      s.resumeId = data.resumeId; s.profile = data.profile; s.text = data.text; s.quality = data.quality; s.filename = filename || '粘贴的简历';
      await refreshStats();
      paint();
      toast('简历已解析，可以进入下一步');
    } catch (err) {
      toast(err.message, 'error', 4200);
      paint();
    } finally {
      s.busy = false;
    }
  }

  function step1() {
    const p = s.profile;
    if (p) {
      const exps = (p.experience || []).slice(0, 3).map((e) => `<div class="exp-item"><div class="e-head"><strong>${esc(e.company)}</strong><small>${esc(e.role)} · ${esc(e.start)}-${esc(e.end)}</small></div><p>${esc(e.bullets?.[0]?.text || '')}</p></div>`).join('');
      panel.innerHTML = `<div class="row-between" style="margin-bottom:18px"><div><div class="panel-title">简历已解析</div><div class="panel-sub">${esc(s.filename)} · ${s.text.length} 字</div></div><button class="btn btn-quiet btn-sm" id="reupload">${icon('refresh', 14)} 换一份</button></div>
        <div class="profile-card">
          <div class="profile-head">
            <span class="avatar">${esc((p.name || '候').slice(0, 1))}</span>
            <div style="min-width:0"><h3>${esc(p.name)}</h3><p>${esc(p.headline)}</p></div>
            <div class="quality"><strong>${s.quality?.score || p.quality?.score || 0}</strong><small>解析质量</small></div>
          </div>
          <div class="profile-sec">
            <h4>经历</h4>
            ${exps || '<p class="small muted">未识别到经历段落，可以返回粘贴调整格式。</p>'}
          </div>
          <div class="profile-sec">
            <h4>技能与关键词</h4>
            <div class="kw-row">${(p.skills || []).slice(0, 14).map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:18px">
          <button class="btn btn-primary" id="toStep2">下一步：目标岗位 ${icon('arrowRight', 15)}</button>
        </div>`;
      panel.querySelector('#reupload').onclick = () => { s.profile = null; s.resumeId = null; paint(); };
      panel.querySelector('#toStep2').onclick = () => { s.step = 2; paint(); };
      return;
    }

    panel.innerHTML = `<div class="panel-title">上传简历</div>
      <div class="panel-sub">PDF / DOCX / TXT / MD，最大 10MB。</div>
      <div id="parseState">
        <div class="dz-body">
          <div class="dropzone" id="dropzone" style="margin-top:18px">
            <input type="file" id="fileInput" accept=".pdf,.docx,.txt,.md" hidden>
            <div class="dz-ico">${icon('upload', 22)}</div>
            <h3>拖拽简历到这里，或点击选择文件</h3>
            <p>简历只对当前账号可见</p>
          </div>
          <div class="or-line">或者</div>
          <div class="field">
            <label>或直接粘贴文字</label>
            <textarea class="textarea" id="pasteBox" placeholder="粘贴简历文字，保留分段即可。"></textarea>
          </div>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-primary" id="parseText">${icon('sparkles', 15)} 解析粘贴内容</button>
            <button class="btn btn-ghost" id="demoBtn">用示例简历试试</button>
          </div>
        </div>
      </div>`;
    const dz = panel.querySelector('#dropzone');
    const input = panel.querySelector('#fileInput');
    dz.onclick = () => input.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = async (e) => {
      e.preventDefault(); dz.classList.remove('drag');
      const file = e.dataTransfer.files?.[0];
      if (file) await upload(file);
    };
    input.onchange = async () => { if (input.files?.[0]) await upload(input.files[0]); };

    async function upload(file) {
      if (file.size > 10 * 1024 * 1024) { toast('文件超过 10MB', 'error'); return; }
      const dataBase64 = await fileToBase64(file);
      await parseResume({ filename: file.name, mime: file.type, dataBase64 });
    }

    panel.querySelector('#parseText').onclick = async () => {
      const text = panel.querySelector('#pasteBox').value.trim();
      if (text.length < 80) { toast('至少粘贴 80 个字，信息才够解析', 'error'); return; }
      await parseResume({ text, filename: '粘贴的简历' });
    };
    panel.querySelector('#demoBtn').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const demo = await api('/api/demo');
        await parseResume({ text: demo.resumeText, filename: '示例简历 · 周予安.txt' });
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  }

  function step2() {
    panel.innerHTML = `<div class="panel-title">粘贴目标岗位 JD</div>
      <div class="panel-sub">建议包含职责与任职要求。</div>
      <div class="field" style="margin-top:18px">
        <label>职位描述</label>
        <textarea class="textarea" id="jdBox" style="min-height:210px" placeholder="粘贴目标岗位 JD">${esc(s.jdText)}</textarea>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-primary" id="analyzeBtn">${icon('target', 15)} 分析岗位匹配</button>
        <button class="btn btn-ghost" id="demoJd">用示例 JD</button>
        <span class="small faint" id="jdCount"></span>
      </div>
      <div id="jdResult">${s.analysis ? renderAnalysis(s.analysis) : ''}</div>
      <div class="row-between" style="margin-top:20px">
        <button class="btn btn-quiet" id="back1">${icon('arrowLeft', 15)} 上一步</button>
        <button class="btn btn-primary" id="toStep3">下一步：设置面试 ${icon('arrowRight', 15)}</button>
      </div>`;
    const box = panel.querySelector('#jdBox');
    const updateCount = () => { panel.querySelector('#jdCount').textContent = `${box.value.trim().length} 字`; };
    box.oninput = () => { s.jdText = box.value; updateCount(); };
    updateCount();

    panel.querySelector('#back1').onclick = () => { s.step = 1; paint(); };
    panel.querySelector('#demoJd').onclick = async () => {
      try { const demo = await api('/api/demo'); box.value = demo.jdText; s.jdText = demo.jdText; updateCount(); toast('已填入示例 JD'); } catch (err) { toast(err.message, 'error'); }
    };
    panel.querySelector('#analyzeBtn').onclick = async (e) => {
      if (s.jdText.trim().length < 20) { toast('先粘贴一段 JD', 'error'); return; }
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:1.5px"></span> 分析中`;
      try {
        s.analysis = await api('/api/jd/analyze', { method: 'POST', body: { resumeId: s.resumeId, jdText: s.jdText } });
        panel.querySelector('#jdResult').innerHTML = renderAnalysis(s.analysis);
        paintSide();
        toast('岗位分析完成');
      } catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = `${icon('target', 15)} 重新分析`; }
    };
    panel.querySelector('#toStep3').onclick = async () => {
      s.jdText = box.value;
      if (s.jdText.trim().length < 20) { toast('JD 至少 20 个字', 'error'); return; }
      if (!s.analysis) {
        try { s.analysis = await api('/api/jd/analyze', { method: 'POST', body: { resumeId: s.resumeId, jdText: s.jdText } }); } catch (err) { toast(err.message, 'error'); return; }
      }
      s.step = 3; paint();
    };
  }

  function renderAnalysis(a) {
    return `<div class="jd-result">
      <div class="jd-match">
        ${matchRing(a.matchScore)}
        <div style="flex:1;min-width:0"><h3>${esc(a.roleName)} · ${esc(a.level)}</h3><p>${esc(a.title)} · ${esc(a.seniority)} · 关键词覆盖 ${a.coverage}%</p></div>
      </div>
      <div class="kw-row">${(a.matched || []).map((k) => `<span class="chip green">${icon('check', 11)} ${esc(k)}</span>`).join('')}${(a.missing || []).map((k) => `<span class="chip amber">${icon('alert', 11)} ${esc(k)}</span>`).join('')}</div>
    </div>`;
  }

  function step3() {
    const persona = personaMeta(state.personas, s.config.persona);
    panel.innerHTML = `<div class="panel-title">设置这场面试</div>
      <div class="panel-sub">人格决定提问风格，题量决定时长。</div>
      <div class="field" style="margin-top:20px">
        <label>面试官人格</label>
        <div class="persona-pick" id="personaPick">
          ${state.personas.map((p) => `<button class="ppick ${p.id === s.config.persona ? 'active' : ''}" data-p="${p.id}">
            <span class="p-name"><span class="p-dot" style="background:${p.color}"></span>${esc(p.name)}</span>
            <p>${esc(p.tagline || p.subtitle || '')}</p>
          </button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-top:20px">
        <label>题量</label>
        <div class="range-row"><input type="range" id="rounds" min="4" max="10" step="1" value="${s.config.rounds}"><span class="range-val" id="roundsVal">${s.config.rounds}</span><span class="small faint">题</span></div>
      </div>
      <div class="field" style="margin-top:20px">
        <label>本场侧重</label>
        <div class="segmented" id="focusSeg">${FOCUS.map((f) => `<button data-f="${f.id}" class="${f.id === s.config.focus ? 'active' : ''}" title="${esc(f.desc)}">${esc(f.label)}</button>`).join('')}</div>
      </div>
      <div class="row-between" style="margin-top:24px">
        <button class="btn btn-quiet" id="back2">${icon('arrowLeft', 15)} 上一步</button>
        <button class="btn btn-primary btn-lg" id="startBtn">${icon('play', 16)} 开始面试</button>
      </div>`;
    panel.querySelectorAll('.ppick').forEach((btn) => {
      btn.onclick = () => { s.config.persona = btn.dataset.p; panel.querySelectorAll('.ppick').forEach((b) => b.classList.toggle('active', b === btn)); paintSide(); };
    });
    const range = panel.querySelector('#rounds');
    range.oninput = () => { s.config.rounds = Number(range.value); panel.querySelector('#roundsVal').textContent = range.value; paintSide(); };
    panel.querySelectorAll('#focusSeg button').forEach((btn) => {
      btn.onclick = () => { s.config.focus = btn.dataset.f; panel.querySelectorAll('#focusSeg button').forEach((b) => b.classList.toggle('active', b === btn)); paintSide(); };
    });
    panel.querySelector('#back2').onclick = () => { s.step = 2; paint(); };
    panel.querySelector('#startBtn').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:1.5px"></span> 正在编排题单`;
      try {
        const session = await api('/api/sessions', { method: 'POST', body: { resumeId: s.resumeId, jdText: s.jdText, config: { ...s.config, roleName: s.analysis?.roleName } } });
        navigate(`/interview/${session.id}`);
      } catch (err) {
        toast(err.message, 'error', 5000);
        btn.disabled = false; btn.innerHTML = `${icon('play', 16)} 开始面试`;
      }
    };
  }

  paint();
}
