import { api } from '../api.js';
import { state, loadBootstrap, refreshStats } from '../store.js';
import { esc, icon, toast } from '../ui.js';
import { pageHead } from '../components.js';

const PRESETS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  custom: { label: '自定义', baseUrl: '', model: '' }
};

export async function renderSettings(params, root) {
  const settings = await api('/api/settings');
  state.settings = settings;
  const llm = settings.llm || {};
  const initialProvider = PRESETS[llm.provider] ? llm.provider : 'custom';
  const stats = state.stats || {};

  root.innerHTML = `<div class="page" style="max-width:1080px">
    ${pageHead({ eyebrow: 'SETTINGS', title: '模型与数据', desc: '不配置模型也能完整跑通全流程（本地规则引擎）。配置后，出题、追问与复盘会由模型完成。' })}
    <div class="settings-grid">
      <div class="stack">
        <div class="panel">
          <div class="row-between"><div><div class="panel-title">模型接入</div><div class="panel-sub">任意 OpenAI 兼容接口：DeepSeek、OpenAI、OpenRouter、自建网关。</div></div>
            <label class="row" style="gap:8px;font-size:12px;color:var(--muted)"><input type="checkbox" id="enabled" ${llm.enabled ? 'checked' : ''}> 启用模型</label></div>
          <div class="preset-row" style="margin-top:18px" id="presets">
            ${Object.entries(PRESETS).map(([k, v]) => `<button class="preset ${k === initialProvider ? 'active' : ''}" data-p="${k}">${v.label}</button>`).join('')}
          </div>
          <div class="grid grid-2" style="margin-top:16px">
            <div class="field"><label>Base URL</label><input class="input" id="baseUrl" value="${esc(llm.baseUrl || '')}" placeholder="https://api.deepseek.com/v1"></div>
            <div class="field"><label>模型名称</label><input class="input" id="model" value="${esc(llm.model || '')}" placeholder="deepseek-chat"></div>
          </div>
          <div class="field" style="margin-top:14px"><label>API Key <span class="hint">${llm.hasKey ? `已保存 ${esc(llm.keyHint)}，留空则不修改` : '只保存在本机 data/store.json'}</span></label><div class="row" style="gap:8px"><input class="input" id="apiKey" type="password" placeholder="${llm.hasKey ? '••••••••（留空不修改）' : 'sk-...'}" autocomplete="off">${llm.hasKey ? '<button class="btn btn-ghost btn-sm" id="clearKey">清除</button>' : ''}</div></div>
          <div class="field" style="margin-top:14px"><label>Temperature <span class="hint" id="tempVal">${llm.temperature ?? 0.7}</span></label><input type="range" id="temp" min="0" max="1.2" step="0.1" value="${llm.temperature ?? 0.7}"></div>
          <div class="row" style="margin-top:18px">
            <button class="btn btn-primary" id="saveBtn">${icon('check', 15)} 保存设置</button>
            <button class="btn btn-ghost" id="testBtn">${icon('zap', 15)} 测试连接</button>
            <span class="small faint" id="testState">修改后先保存，再测试</span>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">数据与隐私</div>
          <div class="panel-sub">所有简历、对话、报告都写在项目目录的 data/store.json 里，不上传云端。</div>
          <div style="margin-top:16px">
            <div class="kv"><span>题库</span><strong>${stats.questions || 0} 道</strong></div>
            <div class="kv"><span>知识库</span><strong>${stats.kb || 0} 篇</strong></div>
            <div class="kv"><span>面试记录</span><strong>${stats.sessions || 0} 场</strong></div>
            <div class="kv"><span>个人题库</span><strong>${stats.bank || 0} 道</strong></div>
          </div>
          <div class="row" style="margin-top:16px"><button class="btn btn-danger btn-sm" id="clearBtn">${icon('trash', 14)} 清空全部面试记录</button></div>
        </div>
      </div>

      <aside class="stack">
        <div class="panel">
          <div class="panel-title" style="font-size:15px">当前运行模式</div>
          <div class="notice ${llm.enabled ? 'ok' : 'warn'}" style="margin-top:12px">${icon(llm.enabled ? 'zap' : 'shield', 16)}<div>${llm.enabled ? `已连接 <b>${esc(llm.model)}</b>：出题、追问、评分与复盘由模型完成，本地启发式评分作为兜底。` : '本地规则引擎：用启发式规则完成出题、追问与五维评分。流程完整，但语义理解有限。'}</div></div>
          <div class="small muted" style="margin-top:14px;line-height:1.8">建议用途：<br>· 面试前快速跑流程 → 本地模式即可<br>· 想要更真实的追问与复盘 → 配置模型</div>
        </div>
        <div class="panel">
          <div class="panel-title" style="font-size:15px">成本参考</div>
          <div class="small muted" style="margin-top:10px;line-height:1.9">一场 6 题面试约 1.5 万 tokens：<br>· 规划 1 次<br>· 追问/衔接 约 6 次<br>· 单题评估 约 6 次<br>· 整场复盘 1 次<br><br>DeepSeek 约 ¥0.02–0.05 / 场。</div>
        </div>
        <div class="panel">
          <div class="panel-title" style="font-size:15px">关于</div>
          <div class="small muted" style="margin-top:10px;line-height:1.8">面镜 MockMirror v1.0<br>Node.js 原生 HTTP · 零前端构建<br>状态机编排 · BM25 检索 · 多轮记忆压缩</div>
        </div>
      </aside>
    </div>
  </div>`;

  let provider = initialProvider;
  const baseUrl = root.querySelector('#baseUrl');
  const model = root.querySelector('#model');
  const apiKey = root.querySelector('#apiKey');
  const temp = root.querySelector('#temp');
  const enabled = root.querySelector('#enabled');

  root.querySelectorAll('#presets .preset').forEach((btn) => {
    btn.onclick = () => {
      provider = btn.dataset.p;
      root.querySelectorAll('#presets .preset').forEach((b) => b.classList.toggle('active', b === btn));
      const p = PRESETS[provider];
      if (p.baseUrl) baseUrl.value = p.baseUrl;
      if (p.model) model.value = p.model;
    };
  });
  temp.oninput = () => { root.querySelector('#tempVal').textContent = temp.value; };

  root.querySelector('#saveBtn').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const payload = {
        llm: {
          provider,
          baseUrl: baseUrl.value.trim(),
          model: model.value.trim(),
          temperature: Number(temp.value),
          enabled: enabled.checked
        }
      };
      if (apiKey.value.trim()) payload.llm.apiKey = apiKey.value.trim();
      const next = await api('/api/settings', { method: 'PUT', body: payload });
      state.settings = next;
      const boot = await loadBootstrap(true);
      state.llm = Boolean(boot.llm?.enabled);
      apiKey.value = '';
      toast('设置已保存');
      refreshStats();
      renderSettings(params, root);
    } catch (err) { toast(err.message, 'error', 5000); btn.disabled = false; }
  };

  root.querySelector('#testBtn').onclick = async (e) => {
    const btn = e.currentTarget;
    const out = root.querySelector('#testState');
    btn.disabled = true; out.textContent = '测试中…';
    try {
      const res = await api('/api/settings/test', { method: 'POST' });
      out.textContent = `连接正常 · ${res.latency}ms · ${res.model}`;
      out.style.color = 'var(--green)';
      toast('模型连接正常');
    } catch (err) {
      out.textContent = err.message;
      out.style.color = 'var(--red)';
    } finally { btn.disabled = false; }
  };

  const clearKey = root.querySelector('#clearKey');
  if (clearKey) clearKey.onclick = async () => {
    if (!confirm('清除已保存的 API Key？清除后回到本地规则引擎。')) return;
    try {
      await api('/api/settings', { method: 'PUT', body: { llm: { apiKey: '', enabled: false } } });
      await loadBootstrap(true);
      refreshStats();
      toast('已清除 Key，回到本地模式');
      renderSettings(params, root);
    } catch (err) { toast(err.message, 'error'); }
  };

  root.querySelector('#clearBtn').onclick = async () => {
    if (!confirm('确定清空全部面试记录？此操作不可恢复。')) return;
    try {
      const { sessions } = await api('/api/sessions');
      for (const s of sessions) await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
      await refreshStats();
      toast('已清空面试记录');
      renderSettings(params, root);
    } catch (err) { toast(err.message, 'error'); }
  };
}
