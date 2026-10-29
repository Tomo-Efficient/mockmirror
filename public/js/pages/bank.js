import { api } from '../api.js';
import { refreshStats } from '../store.js';
import { esc, icon, toast, fmtDate, modal, downloadFile } from '../ui.js';
import { pageHead, emptyState } from '../components.js';

const STATUS = { all: '全部', new: '未掌握', learning: '复习中', mastered: '已掌握' };

export async function renderBank(params, root) {
  const { items } = await api('/api/bank');
  let filter = params.query?.get('status') || 'all';
  let q = '';

  root.innerHTML = `<div class="page">
    ${pageHead({ eyebrow: 'QUESTION BANK', title: '个人题库', desc: '把答不好的题留下来，按 1 / 3 / 7 天复述。这里只存你自己遇到过的题。', actions: `<button class="btn btn-ghost btn-sm" id="exportBank">${icon('download', 14)} 导出 JSON</button><button class="btn btn-primary btn-sm" id="addBank">${icon('plus', 14)} 手动加题</button>` })}
    <div class="toolbar">
      <div class="search-box">${icon('search', 15)}<input class="input" id="bankSearch" placeholder="搜索题目、标签…"></div>
      <div class="segmented" id="statusSeg">${Object.entries(STATUS).map(([k, v]) => `<button data-s="${k}" class="${k === filter ? 'active' : ''}">${v}</button>`).join('')}</div>
      <span class="small faint" id="bankCount"></span>
    </div>
    <div id="bankList"></div>
  </div>`;

  const list = root.querySelector('#bankList');
  const count = root.querySelector('#bankCount');

  function paint() {
    const filtered = items.filter((it) => {
      if (filter !== 'all' && it.status !== filter) return false;
      if (q) {
        const hay = `${it.question} ${(it.tags || []).join(' ')} ${it.category || ''} ${it.notes || ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    count.textContent = `${filtered.length} / ${items.length} 题`;
    if (!filtered.length) {
      list.innerHTML = emptyState({ iconName: 'library', title: items.length ? '没有匹配的题' : '题库还是空的', desc: items.length ? '换个关键词或筛选条件试试。' : '完成一场模拟面试后，在复盘报告里把低分题加进来。', action: items.length ? '' : '<a class="btn btn-primary btn-sm" href="/start" data-link>开始一场面试</a>' });
      return;
    }
    list.innerHTML = `<div class="bank-grid">${filtered.map((it) => `<div class="bank-card" data-id="${it.id}">
      <div class="b-top">
        <h4>${esc(it.question)}</h4>
        <div class="mastery" data-id="${it.id}">
          ${Object.entries(STATUS).filter(([k]) => k !== 'all').map(([k, v]) => `<button data-status="${k}" class="${it.status === k ? 'active' : ''}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="b-tags"><span class="chip">${esc(it.category || '未分类')}</span>${(it.tags || []).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      ${it.notes ? `<div class="bank-note">${esc(it.notes)}</div>` : ''}
      <div class="b-foot">
        <span class="small faint">${esc(it.source || '')} · ${fmtDate(it.updatedAt, false)}</span>
        <div class="row" style="gap:4px">
          <button class="icon-btn" data-note="${it.id}" title="添加笔记">${icon('edit', 15)}</button>
          <button class="icon-btn" data-del="${it.id}" title="删除">${icon('trash', 15)}</button>
        </div>
      </div>
    </div>`).join('')}</div>`;

    list.querySelectorAll('.mastery button').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.closest('.mastery').dataset.id;
        try {
          await api(`/api/bank/${id}`, { method: 'PATCH', body: { status: btn.dataset.status } });
          const item = items.find((i) => i.id === id);
          item.status = btn.dataset.status;
          paint();
          toast(`已标记为「${STATUS[btn.dataset.status]}」`);
          refreshStats();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
    list.querySelectorAll('[data-note]').forEach((btn) => {
      btn.onclick = () => {
        const item = items.find((i) => i.id === btn.dataset.note);
        modal({
          title: '练习笔记', subtitle: item.question, width: 600,
          body: `<div class="field"><label>记录你的思路、卡点或更好的说法</label><textarea class="textarea" id="noteBox" style="min-height:180px">${esc(item.notes || '')}</textarea></div>
            <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" id="saveNote">保存笔记</button></div>`,
          onMount(el, close) {
            el.querySelector('#saveNote').onclick = async () => {
              const notes = el.querySelector('#noteBox').value;
              try {
                await api(`/api/bank/${item.id}`, { method: 'PATCH', body: { notes } });
                item.notes = notes; close(); paint(); toast('笔记已保存');
              } catch (err) { toast(err.message, 'error'); }
            };
          }
        });
      };
    });
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('从个人题库删除这道题？')) return;
        try {
          await api(`/api/bank/${btn.dataset.del}`, { method: 'DELETE' });
          items.splice(items.findIndex((i) => i.id === btn.dataset.del), 1);
          paint(); refreshStats(); toast('已删除');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  root.querySelector('#statusSeg').querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      filter = btn.dataset.s;
      root.querySelectorAll('#statusSeg button').forEach((b) => b.classList.toggle('active', b === btn));
      paint();
    };
  });
  root.querySelector('#bankSearch').oninput = (e) => { q = e.target.value.trim(); paint(); };

  root.querySelector('#addBank').onclick = () => {
    modal({
      title: '手动添加题目', subtitle: '比如面试中真实被问到、但题库里没有的题', width: 620,
      body: `<div class="stack">
        <div class="field"><label>题目</label><textarea class="textarea" id="newQ" placeholder="例如：如果让你把推荐系统的点击率提升 10%，你会先动哪一环？"></textarea></div>
        <div class="field"><label>类别</label><select class="select" id="newCat"><option>项目深挖</option><option>专业能力</option><option>行为面试</option><option>岗位认知</option><option>压力面试</option><option>反问环节</option></select></div>
        <div class="field"><label>标签 <span class="hint">用逗号分隔</span></label><input class="input" id="newTags" placeholder="推荐系统, 指标, 归因"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="saveQ">加入题库</button></div>
      </div>`,
      onMount(el, close) {
        el.querySelector('#saveQ').onclick = async () => {
          const question = el.querySelector('#newQ').value.trim();
          if (question.length < 6) { toast('题目太短', 'error'); return; }
          try {
            const { item } = await api('/api/bank', { method: 'POST', body: { question, category: el.querySelector('#newCat').value, tags: el.querySelector('#newTags').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean), source: '手动添加' } });
            if (!items.some((x) => x.id === item.id)) items.unshift(item);
            close(); paint(); refreshStats(); toast('已加入题库');
          } catch (err) { toast(err.message, 'error'); }
        };
      }
    });
  };

  root.querySelector('#exportBank').onclick = () => {
    downloadFile(`面镜题库-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(items, null, 2), 'application/json');
    toast('题库已导出');
  };

  paint();
}
