/**
 * 面板管理：左栏每一块可显示 / 隐藏 / 调顺序；AI 功能一个总开关。
 * 布局按「模式」分开记：画师版和 AI 版各有一套，互不影响。
 */
import { $, escapeHtml } from './util.mjs';
import { ARTIST } from './env.mjs';
import { store, KEYS } from './storage.mjs';
import { toast } from './ui.mjs';
import { openModal, closeModal } from './dialogs.mjs';

/* ================================================================== *
 * 面板管理：左栏每一块可显示 / 隐藏 / 调顺序；AI 功能一个总开关
 * 布局按「模式」分开记：画师版和 AI 版各有一套，互不影响。
 * ================================================================== */
const LAYOUT_KEY = KEYS.layout;

/** 画师版默认：AI 面板收起；AI 版默认：全部显示 */
const layoutDefaults = () => (ARTIST
  ? { order: ['plot', 'browse', 'chars', 'help', 'ai'], hidden: ['ai'], ai: false }
  : { order: ['plot', 'ai', 'chars', 'browse', 'help'], hidden: [], ai: true });

/** 左栏面板在 HTML 里的真实顺序（新增卡片的落位依据） */
function orderFromDom() {
  return [...document.querySelectorAll('.rail.left [data-panel]')].map((el) => el.dataset.panel);
}

/**
 * 把「用户保存的顺序」和「HTML 里的顺序」合并。
 * 关键：新加的面板（老用户存里没有）要落在它 HTML 里的位置，
 * 否则 applyLayout 的 appendChild 会把它挤到最前面 —— 之前"风格跟随跑到 AI 导演上面"就是这么来的。
 */
function mergeOrder(stored, dom) {
  const known = new Set(dom);
  const out = (stored || []).filter((id) => known.has(id));
  dom.forEach((id, i) => {
    if (out.includes(id)) return;
    const prev = dom.slice(0, i).reverse().find((p) => out.includes(p));
    if (prev) out.splice(out.indexOf(prev) + 1, 0, id);
    else out.unshift(id);
  });
  return out;
}

function readLayouts() {
  const raw = store.json(LAYOUT_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function currentLayout() {
  const all = readLayouts();
  const key = ARTIST ? 'artist' : 'main';
  const d = layoutDefaults();
  const v = all[key] || {};
  const dom = orderFromDom();
  const stored = Array.isArray(v.order) && v.order.length ? v.order : d.order;
  return {
    // DOM 是"默认顺序"的真相：新卡片按 HTML 位置落位，老用户的自定义顺序照旧
    order: mergeOrder(stored, dom.length ? dom : stored),
    hidden: Array.isArray(v.hidden) ? v.hidden : d.hidden,
    ai: typeof v.ai === 'boolean' ? v.ai : d.ai,
  };
}

function saveLayout(cfg) {
  const all = readLayouts();
  all[ARTIST ? 'artist' : 'main'] = cfg;
  store.setJSON(LAYOUT_KEY, all);
}

/** 把布局套到 DOM 上：顺序 + 显隐 + AI 总开关 */
export function applyLayout(cfg = currentLayout()) {
  const rail = document.querySelector('.rail.left');
  const panels = [...document.querySelectorAll('.rail.left [data-panel]')];
  if (!rail || !panels.length) return;
  const byId = new Map(panels.map((el) => [el.dataset.panel, el]));
  // 按 order 依次 append：appendChild 会自动把节点挪到末尾，等于重排
  for (const id of cfg.order) { const el = byId.get(id); if (el) rail.appendChild(el); }
  for (const el of panels) {
    const hide = cfg.hidden.includes(el.dataset.panel);
    el.hidden = hide;
    el.classList.toggle('panel-off', hide);
  }
  // AI 总开关：控制每格的生图区 / 候选图 / AI 优化 / Key 面板（AI 导演卡由上一条 hidden 控制）
  document.body.dataset.ai = cfg.ai ? 'on' : 'off';
  const chk = $('#chkAi');
  if (chk) chk.checked = cfg.ai;
}

function renderPanelSheet() {
  const list = $('#panelList');
  if (!list) return;
  const cfg = currentLayout();
  const panels = [...document.querySelectorAll('.rail.left [data-panel]')];
  const byId = new Map(panels.map((el) => [el.dataset.panel, el]));
  const order = cfg.order.filter((id) => byId.has(id));
  list.innerHTML = order.map((id, i) => {
    const el = byId.get(id);
    const off = cfg.hidden.includes(id);
    return `<div class="panel-row${off ? ' off' : ''}" data-id="${escapeHtml(id)}">
      <span class="panel-name">${escapeHtml(el.dataset.panelName || id)}</span>
      <span class="panel-acts">
        <button class="btn tiny" data-act="up" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button class="btn tiny" data-act="down" ${i === order.length - 1 ? 'disabled' : ''} title="下移">↓</button>
        <button class="btn tiny" data-act="toggle">${off ? '显示' : '隐藏'}</button>
      </span>
    </div>`;
  }).join('');
}

export function bindPanelSheet() {
  const open = () => { renderPanelSheet(); openModal($('#panelSheet')); };
  const close = () => closeModal($('#panelSheet'));
  $('#btnPanels')?.addEventListener('click', open);
  $('#btnPanelClose')?.addEventListener('click', close);
  $('#chkAi')?.addEventListener('change', (ev) => {
    const cfg = currentLayout();
    cfg.ai = !!ev.target.checked;
    saveLayout(cfg);
    applyLayout(cfg);
    renderPanelSheet();
    toast(cfg.ai ? '已启用 AI 功能' : 'AI 功能已收起（随时可以再打开）');
  });
  $('#panelList')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    const row = ev.target.closest('.panel-row');
    if (!btn || !row) return;
    const id = row.dataset.id;
    const cfg = currentLayout();
    const i = cfg.order.indexOf(id);
    if (btn.dataset.act === 'up' && i > 0) {
      [cfg.order[i - 1], cfg.order[i]] = [cfg.order[i], cfg.order[i - 1]];
    } else if (btn.dataset.act === 'down' && i >= 0 && i < cfg.order.length - 1) {
      [cfg.order[i + 1], cfg.order[i]] = [cfg.order[i], cfg.order[i + 1]];
    } else if (btn.dataset.act === 'toggle') {
      cfg.hidden = cfg.hidden.includes(id) ? cfg.hidden.filter((x) => x !== id) : [...cfg.hidden, id];
    }
    saveLayout(cfg);
    applyLayout(cfg);
    renderPanelSheet();
  });
  $('#btnPanelReset')?.addEventListener('click', () => {
    const d = layoutDefaults();
    saveLayout({ order: [...d.order], hidden: [...d.hidden], ai: d.ai });
    applyLayout();
    renderPanelSheet();
    toast('已恢复默认面板布局');
  });
}
