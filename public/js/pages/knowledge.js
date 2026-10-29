import { api } from '../api.js';
import { state, refreshStats } from '../store.js';
import { esc, icon, toast, modal, md } from '../ui.js';
import { pageHead, emptyState, kbCard } from '../components.js';

export async function renderKnowledge(params, root) {
  let items = [];
  let category = '全部';
  let q = '';

  root.innerHTML = `<div class="page">
    ${pageHead({ eyebrow: 'KNOWLEDGE BASE', title: '面试知识库', desc: '16 篇教研笔记构成 RAG 语料：出题时用来参考，复盘时用来给依据。也可以加入你自己的资料。', actions: `<button class="btn btn-ghost btn-sm" id="addDoc">${icon('plus', 14)} 添加文档</button>` })}
    <div class="notice info" style="margin-bottom:20px">${icon('layers', 16)}<div>检索使用 BM25 + 中文二元分词，结果会作为 evidence 进入 Prompt。报告里的“知识库依据”就是这里的内容。</div></div>
    <div class="toolbar">
      <div class="search-box">${icon('search', 15)}<input class="input" id="kbSearch" placeholder="搜索：RAG 幻觉、量化结果、反问…"></div>
      <div class="tabs" id="kbTabs" style="border:0;margin:0;flex:1"></div>
      <span class="small faint" id="kbCount"></span>
    </div>
    <div id="kbList"></div>
  </div>`;

  const list = root.querySelector('#kbList');
  const tabs = root.querySelector('#kbTabs');
  const count = root.querySelector('#kbCount');

  function paintTabs() {
    const cats = ['全部', ...state.categories];
    tabs.innerHTML = cats.map((c) => `<button class="tab ${c === category ? 'active' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    tabs.querySelectorAll('.tab').forEach((btn) => {
      btn.onclick = () => { category = btn.dataset.c; paintTabs(); paint(); };
    });
  }

  function paint() {
    const filtered = items.filter((d) => (category === '全部' || d.category === category));
    count.textContent = `${filtered.length} 篇`;
    if (!filtered.length) {
      list.innerHTML = emptyState({ iconName: 'search', title: '没有找到相关内容', desc: '换个关键词，或者添加一篇自己的面经。' });
      return;
    }
    list.innerHTML = `<div class="kb-grid">${filtered.map((d) => kbCard(d)).join('')}</div>`;
    list.querySelectorAll('.kb-card').forEach((card, i) => {
      card.onclick = (e) => { e.preventDefault(); openDoc(filtered[i].id); };
    });
  }

  async function openDoc(id) {
    try {
      const { item } = await api(`/api/kb/${id}`);
      modal({
        title: item.title,
        subtitle: `${item.category} · ${item.source} · ${item.readingMinutes || 3} 分钟`,
        width: 780,
        body: `<div class="row wrap" style="gap:6px;margin-bottom:16px">${(item.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${item.custom ? '<span class="chip violet">我的文档</span>' : ''}</div>
          <div class="prose">${md(item.content)}</div>
          ${item.custom ? `<div class="hr"></div><button class="btn btn-danger btn-sm" id="delDoc">${icon('trash', 14)} 删除这篇文档</button>` : ''}`,
        onMount(el, close) {
          const del = el.querySelector('#delDoc');
          if (del) del.onclick = async () => {
            if (!confirm('删除这篇文档？检索索引会同步更新。')) return;
            try {
              await api(`/api/kb/${item.id}`, { method: 'DELETE' });
              items = items.filter((x) => x.id !== item.id);
              close(); paint(); refreshStats(); toast('已删除');
            } catch (err) { toast(err.message, 'error'); }
          };
        }
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  async function load() {
    const data = await api('/api/kb');
    items = data.items || [];
    paintTabs(); paint();
  }

  let searchTimer = null;
  root.querySelector('#kbSearch').oninput = (e) => {
    q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!q) { await load(); return; }
      try {
        const data = await api(`/api/kb?q=${encodeURIComponent(q)}`);
        items = (data.items || []).map((r) => {
          const full = { ...r, summary: r.snippet || '', readingMinutes: 3, source: '检索结果' };
          return full;
        });
        category = '全部';
        paintTabs(); paint();
      } catch (err) { toast(err.message, 'error'); }
    }, 260);
  };

  root.querySelector('#addDoc').onclick = () => {
    modal({
      title: '添加知识文档', subtitle: '支持 Markdown，正文至少 80 字；保存后会进入检索索引', width: 720,
      body: `<div class="stack">
        <div class="field"><label>标题</label><input class="input" id="docTitle" placeholder="例如：我总结的 AI 产品面试 20 问"></div>
        <div class="row" style="gap:12px">
          <div class="field" style="flex:1"><label>分类</label><select class="select" id="docCat">${['我的资料', ...state.categories].map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label>标签</label><input class="input" id="docTags" placeholder="用逗号分隔"></div>
        </div>
        <div class="field"><label>正文 <span class="hint">Markdown</span></label><textarea class="textarea" id="docContent" style="min-height:240px" placeholder="## 小标题&#10;你的总结、模板或面经…"></textarea></div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="saveDoc">保存并索引</button></div>
      </div>`,
      onMount(el, close) {
        el.querySelector('#saveDoc').onclick = async () => {
          const title = el.querySelector('#docTitle').value.trim();
          const content = el.querySelector('#docContent').value.trim();
          if (!title || content.length < 80) { toast('标题必填，正文至少 80 字', 'error'); return; }
          try {
            await api('/api/kb', { method: 'POST', body: { title, content, category: el.querySelector('#docCat').value, tags: el.querySelector('#docTags').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) } });
            close(); await load(); refreshStats(); toast('文档已加入知识库');
          } catch (err) { toast(err.message, 'error'); }
        };
      }
    });
  };

  await load();
  const openId = params.query?.get('id');
  if (openId) openDoc(openId);
}
