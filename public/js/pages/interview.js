import { api, streamTurn } from '../api.js';
import { state } from '../store.js';
import { navigate } from '../router.js';
import { esc, icon, toast, fmtDuration, personaMeta, scoreTone, downloadFile } from '../ui.js';
import { miniBars } from '../charts.js';

const STAGE_LABEL = { '简历深挖': '简历深挖', '专业能力': '专业能力', '行为面试': '行为面试', '岗位认知': '岗位认知', '压力测试': '压力测试', '反问环节': '反问环节' };

export async function renderInterview(params, root) {
  let session = await api(`/api/sessions/${params.id}`);
  if (!session) throw new Error('面试不存在');
  if (session.status === 'finished' && session.report) { navigate(`/report/${session.id}`, { replace: true }); return; }

  const persona = personaMeta(state.personas, session.config.persona);
  let streaming = false;
  let timer = null;
  let recognition = null;
  let lastEval = session.evaluations?.[session.evaluations.length - 1] || null;

  root.innerHTML = `<div class="page" style="max-width:1320px">
    <div class="interview-page">
      <section class="chat-panel">
        <header class="chat-head">
          <span class="avatar" style="background:${persona.color}22;border-color:${persona.color}55;color:${persona.color}">${persona.id === 'peer' ? '同' : persona.id === 'senior' ? '资' : '经'}</span>
          <div class="ch-info">
            <h2>${esc(persona.name)} <span class="badge">${esc(session.jd?.analysis?.roleName || '模拟面试')}</span></h2>
            <p>${esc(persona.subtitle || '')} · ${esc(session.profile?.name || '')}</p>
          </div>
          <div class="progress-mini">
            <div class="lbl"><span>进度</span><span id="progText">${session.progress.reached ?? session.progress.answered}/${session.progress.total}</span></div>
            <div class="meter"><i id="progBar" style="width:${session.progress.percent}%"></i></div>
          </div>
          <span class="badge mobile-progress" id="mobileProgress">${session.progress.reached ?? session.progress.answered}/${session.progress.total}</span>
          <span class="timer" id="timer">${icon('clock', 13)} 00:00</span>
          <a class="icon-btn" href="/history" data-link title="退出并保留记录" aria-label="退出">${icon('x', 18)}</a>
        </header>
        <div class="chat-body" id="chatBody"></div>
        <div class="chat-foot" id="chatFoot"></div>
      </section>
      <aside class="side-rail" id="rail"></aside>
    </div>
  </div>`;

  const chatBody = root.querySelector('#chatBody');
  const chatFoot = root.querySelector('#chatFoot');
  const rail = root.querySelector('#rail');

  function renderMessages() {
    chatBody.innerHTML = session.messages.map((m) => {
      if (m.role === 'system') {
        const cls = m.kind === 'hint' ? 'hint' : '';
        return `<div class="msg system ${cls}"><div class="note">${m.kind === 'hint' ? icon('lightbulb', 13) + ' ' : ''}${esc(m.content)}</div></div>`;
      }
      const mine = m.role === 'candidate';
      return `<div class="msg ${mine ? 'me' : 'ai'}">
        ${mine ? '' : `<span class="avatar sm" style="background:${persona.color}22;border-color:${persona.color}44;color:${persona.color}">${persona.id === 'peer' ? '同' : persona.id === 'senior' ? '资' : '经'}</span>`}
        <div>
          <div class="bubble">${String(m.content).split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>
          <div class="meta">${mine ? '我' : persona.name}${m.kind === 'probe' ? ' · 追问' : ''}${m.kind === 'closing' ? ' · 结束' : ''}</div>
        </div>
      </div>`;
    }).join('');
    scrollBottom(true);
  }

  function scrollBottom(force = false) {
    const near = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 160;
    if (force || near) chatBody.scrollTop = chatBody.scrollHeight;
  }

  function renderFoot() {
    if (session.status !== 'active') {
      chatFoot.innerHTML = `<div class="notice ok" style="margin:0">${icon('check', 16)}<div style="flex:1">本场面试已完成。${session.report ? '复盘报告已生成。' : '生成报告后可以查看五维评分与改进动作。'}</div>
        <a class="btn btn-primary btn-sm" href="${session.report ? `/report/${session.id}` : '#'}" data-link>${session.report ? '查看报告' : '生成报告'}</a></div>`;
      if (!session.report) chatFoot.querySelector('a').onclick = (e) => { e.preventDefault(); finish(); };
      return;
    }
    chatFoot.innerHTML = `<div class="chat-quick">
        <button class="btn btn-ghost btn-sm" id="mHint">${icon('lightbulb', 13)} 提示</button>
        <button class="btn btn-ghost btn-sm" id="mSkip">${icon('skip', 13)} 换题</button>
        <button class="btn btn-ghost btn-sm" id="mReport">${icon('chart', 13)} 结束</button>
      </div>
      <div class="composer">
        <textarea id="answerBox" placeholder="用你自己的话回答，越具体越好。Enter 发送，Shift + Enter 换行"></textarea>
        <div class="composer-foot">
          <button class="icon-btn mic-btn" id="micBtn" title="语音输入">${icon('mic', 17)}</button>
          <span class="count" id="charCount">0 字</span>
          <span class="spacer"></span>
          <span class="small faint" style="font-size:10px">建议 90–180 秒</span>
          <button class="send-btn" id="sendBtn" disabled aria-label="发送">${icon('send', 16)}</button>
        </div>
      </div>
      <div class="composer-hint"><span>${icon('shield', 11)} 回答仅保存在本地</span><span>${session.llm ? '模型已连接' : '本地规则引擎'}</span></div>`;
    const box = chatFoot.querySelector('#answerBox');
    const send = chatFoot.querySelector('#sendBtn');
    const count = chatFoot.querySelector('#charCount');
    box.oninput = () => {
      send.disabled = !box.value.trim() || streaming;
      count.textContent = `${box.value.replace(/\s/g, '').length} 字`;
      box.style.height = 'auto';
      box.style.height = `${Math.min(180, box.scrollHeight)}px`;
    };
    box.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAnswer(); }
    };
    send.onclick = sendAnswer;
    chatFoot.querySelector('#micBtn').onclick = toggleMic;
    chatFoot.querySelector('#mHint').onclick = () => rail.querySelector('#hintBtn')?.click();
    chatFoot.querySelector('#mSkip').onclick = () => rail.querySelector('#skipBtn')?.click();
    chatFoot.querySelector('#mReport').onclick = () => rail.querySelector('#reportBtn')?.click();
    box.focus();
  }

  function renderRail() {
    const p = session.pending;
    const avg = session.metrics?.avgScore || 0;
    const evalForBars = lastEval || null;
    rail.innerHTML = `
      <div class="rail-card">
        <h4>当前问题 <span class="badge">${p ? esc(p.question.stage) : '已完成'}</span></h4>
        ${p ? `<div class="q-text">${esc(p.question.text)}</div>
          <div class="q-intent">${esc(p.question.intent || '考察你的真实经历与判断过程')}</div>
          <div style="margin-top:12px"><button class="btn btn-ghost btn-sm btn-block" id="pointsBtn">${icon('eye', 14)} 查看参考要点</button></div>
          <ul class="points" id="pointsList" hidden>${(p.question.answerPoints || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
        : `<div class="rail-empty">本场问题已问完，去生成报告吧。</div>`}
      </div>
      <div class="rail-card">
        <h4>本场表现 <span class="mono" style="color:var(--ink);font-size:12px">${avg || '—'}</span></h4>
        ${evalForBars ? `<div class="score-mini">${miniBars(evalForBars.scores)}</div>
          <div class="small faint" style="margin-top:10px;line-height:1.6">最近一题：${esc(evalForBars.verdict)} · ${esc((evalForBars.strengths || [])[0] || '继续补齐证据')}</div>`
        : `<div class="rail-empty">完成第一题后，这里会出现五维评分。</div>`}
      </div>
      <div class="rail-card">
        <h4>Agent 轨迹 <span class="faint" style="font-family:var(--sans);letter-spacing:0;text-transform:none">实时</span></h4>
        <div class="trace">${(session.trace || []).slice(-7).reverse().map((t) => `<div class="trace-item ${t.tone || 'ok'}"><span class="trace-dot"></span><div class="trace-body"><strong>${esc(t.label)}</strong><span>${esc(t.detail || '')}</span></div></div>`).join('') || '<div class="rail-empty">等待第一步…</div>'}</div>
      </div>
      <div class="rail-card">
        <h4>操作</h4>
        <div class="rail-actions">
          <button class="btn btn-ghost btn-sm" id="hintBtn" ${p ? '' : 'disabled'}>${icon('lightbulb', 14)} 给点提示</button>
          <button class="btn btn-ghost btn-sm" id="skipBtn" ${p ? '' : 'disabled'}>${icon('skip', 14)} 换一题</button>
          <button class="btn btn-ghost btn-sm" id="reportBtn" style="grid-column:span 2">${icon('chart', 14)} 结束并生成报告</button>
        </div>
        <div class="small faint" style="margin-top:10px;line-height:1.6">提示会记录在报告里；换题不扣分，但会标记为未作答。</div>
      </div>`;
    const pointsBtn = rail.querySelector('#pointsBtn');
    if (pointsBtn) pointsBtn.onclick = () => {
      const list = rail.querySelector('#pointsList');
      list.hidden = !list.hidden;
      pointsBtn.innerHTML = `${icon('eye', 14)} ${list.hidden ? '查看参考要点' : '收起参考要点'}`;
    };
    const hintBtn = rail.querySelector('#hintBtn');
    if (hintBtn) hintBtn.onclick = async () => {
      hintBtn.disabled = true;
      try {
        const data = await api(`/api/sessions/${session.id}/hint`, { method: 'POST' });
        appendHint(data);
        toast('提示已加入对话');
      } catch (err) { toast(err.message, 'error'); }
      finally { hintBtn.disabled = false; }
    };
    const skipBtn = rail.querySelector('#skipBtn');
    if (skipBtn) skipBtn.onclick = async () => {
      if (!confirm('跳过当前问题？这道题会标记为未作答。')) return;
      skipBtn.disabled = true;
      try {
        const data = await api(`/api/sessions/${session.id}/skip`, { method: 'POST' });
        session = data.session;
        lastEval = session.evaluations?.[session.evaluations.length - 1] || lastEval;
        renderMessages(); renderRail(); renderFoot(); updateProgress();
        if (data.finished) toast('本场问题已问完，可以生成报告了');
      } catch (err) { toast(err.message, 'error'); }
      finally { skipBtn.disabled = false; }
    };
    rail.querySelector('#reportBtn').onclick = finish;
  }

  function appendHint(data) {
    const note = document.createElement('div');
    note.className = 'msg system hint';
    note.innerHTML = `<div class="note">${icon('lightbulb', 13)} 提示：可以从这几个角度展开——${esc((data.points || []).join('；'))}</div>`;
    chatBody.appendChild(note);
    session.messages.push({ role: 'system', kind: 'hint', content: `提示：${(data.points || []).join('；')}` });
    scrollBottom(true);
    const list = rail.querySelector('#pointsList');
    if (list) list.hidden = false;
  }

  function updateProgress() {
    const t = root.querySelector('#progText');
    const b = root.querySelector('#progBar');
    const m = root.querySelector('#mobileProgress');
    if (t) t.textContent = `${session.progress.reached ?? session.progress.answered}/${session.progress.total}`;
    if (b) b.style.width = `${session.progress.percent}%`;
    if (m) m.textContent = `${session.progress.reached ?? session.progress.answered}/${session.progress.total}`;
  }

  function startTimer() {
    clearInterval(timer);
    const startedAt = session.metrics?.startedAt || Date.now();
    const tick = () => {
      const el = root.querySelector('#timer');
      if (!el) return;
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      el.innerHTML = `${icon('clock', 13)} ${fmtDuration(elapsed)}`;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function sendAnswer() {
    if (streaming) return;
    const box = chatFoot.querySelector('#answerBox');
    const send = chatFoot.querySelector('#sendBtn');
    if (!box) return;
    const text = box.value.trim();
    if (!text) return;
    streaming = true;
    send.disabled = true;
    box.disabled = true;
    box.value = '';
    box.style.height = 'auto';
    chatFoot.querySelector('#charCount').textContent = '0 字';

    const me = document.createElement('div');
    me.className = 'msg me';
    me.innerHTML = `<div><div class="bubble">${esc(text).replace(/\n/g, '<br>')}</div><div class="meta">我</div></div>`;
    chatBody.appendChild(me);

    const ai = document.createElement('div');
    ai.className = 'msg ai';
    ai.innerHTML = `<span class="avatar sm" style="background:${persona.color}22;border-color:${persona.color}44;color:${persona.color}">${persona.id === 'peer' ? '同' : persona.id === 'senior' ? '资' : '经'}</span><div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
    chatBody.appendChild(ai);
    const bubble = ai.querySelector('.bubble');
    let buffer = '';
    scrollBottom(true);

    try {
      await streamTurn(session.id, text, (event, data) => {
        if (event === 'meta') {
          // 下一题信息会随 state 事件一起更新
        } else if (event === 'delta') {
          buffer += data.text || '';
          bubble.innerHTML = esc(buffer).replace(/\n/g, '<br>');
          scrollBottom();
        } else if (event === 'evaluation') {
          lastEval = data.evaluation;
          session.evaluations = [...(session.evaluations || []), data.evaluation];
        } else if (event === 'state') {
          session = data.session;
          if (session.lastError && !window.__mmWarned) {
            window.__mmWarned = true;
            toast(`模型调用失败，已切换本地兜底：${String(session.lastError).slice(0, 40)}`, 'error', 4200);
          }
        } else if (event === 'error') {
          throw new Error(data.message || '生成失败');
        }
      });
      if (!buffer.trim()) bubble.innerHTML = '<span class="faint">（面试官没有返回内容，请重试）</span>';
      else {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${persona.name} · ${session.status === 'active' ? '继续' : '结束'}`;
        ai.querySelector('div').appendChild(meta);
      }
    } catch (err) {
      toast(err.message || '发送失败', 'error', 5000);
      bubble.innerHTML = `<span style="color:var(--red)">${esc(err.message || '发送失败')}</span>`;
    } finally {
      streaming = false;
      box.disabled = false;
      send.disabled = true;
      updateProgress();
      renderRail();
      renderFoot();
      updateProgress();
      if (session.status === 'active') chatFoot.querySelector('#answerBox')?.focus();
    }
  }

  async function finish() {
    const btn = rail.querySelector('#reportBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:1.5px"></span> 生成中`; }
    try {
      await api(`/api/sessions/${session.id}/report`, { method: 'POST' });
      navigate(`/report/${session.id}`);
    } catch (err) {
      toast(err.message, 'error', 5000);
      if (btn) { btn.disabled = false; btn.innerHTML = `${icon('chart', 14)} 结束并生成报告`; }
    }
  }

  function toggleMic() {
    const mic = chatFoot.querySelector('#micBtn');
    const box = chatFoot.querySelector('#answerBox');
    if (!box) return;
    if (recognition) { recognition.stop(); recognition = null; mic.classList.remove('recording'); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('当前浏览器不支持语音输入，Chrome / Edge 可用', 'error'); return; }
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) box.value += event.results[i][0].transcript;
      }
      box.dispatchEvent(new Event('input'));
    };
    recognition.onerror = () => { toast('语音识别失败，请检查麦克风权限', 'error'); };
    recognition.onend = () => { mic?.classList.remove('recording'); recognition = null; };
    recognition.start();
    mic.classList.add('recording');
    toast('开始录音，再点一次结束');
  }

  renderMessages();
  renderRail();
  renderFoot();
  updateProgress();
  startTimer();
  requestAnimationFrame(() => {
    scrollBottom(true);
    setTimeout(() => scrollBottom(true), 120);
  });
  const onResize = () => scrollBottom(true);
  window.addEventListener('resize', onResize);
  return () => { clearInterval(timer); window.removeEventListener('resize', onResize); };
}
