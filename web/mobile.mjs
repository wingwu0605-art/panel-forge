/**
 * 手机视图与「进/出这一格编辑」的动画。
 *
 * 从 app.js 抽出：setView / applyView / enterEdit / exitEdit + FLIP 缩放那套，
 * 以及底部的视图切换绑定 initViews。
 *
 * 为什么值得独立：这块是今天改得最多的（双击进编辑、抽屉滑入、窄屏禁用收起），
 * 逻辑集中在一个文件里才能保证"只在手机断点生效"之类的判断不被散落修改。
 *
 * 依赖注入（避免和 app.js 循环引用）：
 *   renderStage / renderSlotPanel —— 视图切换后需要重绘
 */
import { $, $$, clamp, withTransition, motionOK, replay } from './util.mjs';
import { state } from './state.mjs';

let deps = {
  renderStage: () => {},
  renderSlotPanel: () => {},
  // 下面两个仍在 app.js 里（它们和渲染/面板强耦合），这里通过注入使用
  activateTab: () => {},
  currentPlanPanel: () => null,
};
export function installViewDeps(next) { deps = { ...deps, ...next }; }

export const ZOOM_EASE = 'cubic-bezier(.32,.72,0,1)';
export const VIEW_ORDER = ['library', 'story', 'canvas', 'edit', 'output'];
export const VIEW_ALIAS = { inspect: 'edit' };
export const compactMQ = window.matchMedia('(max-width:1024px)');let zoomT = { tx: 0, ty: 0, k: 1 };   // #canvas 当前的变换
export let zoomKey = '';

export function setView(view, opts = {}) {
  view = VIEW_ALIAS[view] || view;
  if (!VIEW_ORDER.includes(view)) return;
  const prev = document.body.dataset.view;
  const compact = compactMQ.matches;
  if (view === 'edit' && state.tpl && !state.selectedId) {
    state.selectedId = state.tpl.slots[0]?.id || null;
    deps.renderStage(); deps.renderSlotPanel();
  }
  if (opts.animate && prev && prev !== view && compact) {
    replay($(`#tabbar button[data-view="${view}"]`), 'bounce');
    // 画布 ⇄ 编辑：页面直接放大 / 缩回这一格，比整页滑动更有空间感
    if (view === 'edit') { enterEdit(prev === 'canvas'); return; }
    if (prev === 'edit') { exitEdit(view); return; }
    const dir = VIEW_ORDER.indexOf(view) > VIEW_ORDER.indexOf(prev) ? 'view-fwd' : 'view-back';
    withTransition(dir, () => applyView(view));
    return;
  }
  if (view === 'edit' && compact) { enterEdit(false, { instant: !opts.animate }); return; }
  if (prev === 'edit') clearEditZoom();
  applyView(view);
}
export function applyView(view) {
  const body = document.body;
  body.dataset.view = view;
  body.classList.toggle('sheet-on', view === 'edit');
  $$('#tabbar button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (view === 'output') {
    const cur = $('#tabs button.on')?.dataset.tab;
    if (!cur || cur === 'slot') deps.activateTab('script');
  }
  if (view === 'edit') { deps.activateTab('slot'); setEditMod(state.editMod || 'text', { quiet: true }); syncEditHead(); }
  if (view === 'canvas' || view === 'edit') deps.renderStage();
}
export function goCanvasOnCompact() { if (compactMQ.matches) setView('canvas', { animate: true }); }

/* ---------------- 编辑页：放大到选中的格子 ---------------- */

export function holderEl() { return $('#canvas'); }
export function setHolderT(t, transition) {
  const h = holderEl();
  if (!h) return;
  zoomT = t;
  h.style.transition = transition || 'none';
  h.style.transform = (t.k === 1 && !t.tx && !t.ty) ? '' : `translate(${t.tx}px, ${t.ty}px) scale(${t.k})`;
}
/** 不受当前变换影响的几何：holder 左上角 + 页面 svg 的位置（反算 zoomT） */
export function untransformed() {
  const h = holderEl(), svg = h?.querySelector('svg');
  if (!svg) return null;
  const hr = h.getBoundingClientRect(), sr = svg.getBoundingClientRect();
  const { tx, ty, k } = zoomT;
  const hl = hr.left - tx, ht = hr.top - ty;
  return {
    hl, ht,
    svg: { left: hl + (sr.left - hl - tx) / k, top: ht + (sr.top - ht - ty) / k, width: sr.width / k, height: sr.height / k },
  };
}
/** 选中格子放大填满上半屏需要的变换 */
export function zoomTargetFor(slotId) {
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  const g = untransformed();
  const stage = $('#stage')?.getBoundingClientRect();
  if (!slot || !g || !stage?.width) return { tx: 0, ty: 0, k: 1 };
  const pw = state.tpl.page.w, ph = state.tpl.page.h, R = g.svg;
  const sw = (slot.w / pw) * R.width, sh = (slot.h / ph) * R.height;
  const cx = R.left + ((slot.x + slot.w / 2) / pw) * R.width;
  const cy = R.top + ((slot.y + slot.h / 2) / ph) * R.height;
  const pad = 18;
  const k = clamp(Math.min((stage.width - pad * 2) / sw, (stage.height - pad * 2) / sh), 1, 6);
  const scx = stage.left + stage.width / 2, scy = stage.top + stage.height / 2;
  return { tx: scx - g.hl - (cx - g.hl) * k, ty: scy - g.ht - (cy - g.ht) * k, k };
}
/** 选中格变了 / 尺寸变了就平滑移过去 */
export function syncEditZoom(force = false) {
  if (document.body.dataset.view !== 'edit' || !compactMQ.matches || document.body.classList.contains('zooming')) return;
  const key = [state.selectedId, state.tpl?.id, $('#stage')?.clientWidth, $('#stage')?.clientHeight].join('|');
  if (!force && key === zoomKey) return;
  zoomKey = key;
  const t = zoomTargetFor(state.selectedId);
  setHolderT(t, motionOK() ? `transform .62s ${ZOOM_EASE}` : 'none');
}
export function clearEditZoom() { zoomKey = ''; setHolderT({ tx: 0, ty: 0, k: 1 }); }

/** FLIP：从 rect A 看起来的位置，变到 rect B 现在的位置所需的起始变换 */
export function flipFrom(A, g) {
  const k0 = A.width / g.svg.width;
  return { tx: A.left - g.hl - (g.svg.left - g.hl) * k0, ty: A.top - g.ht - (g.svg.top - g.ht) * k0, k: k0 };
}

export function enterEdit(fromCanvas, { instant = false } = {}) {
  const svg = holderEl()?.querySelector('svg');
  const A = fromCanvas && svg ? svg.getBoundingClientRect() : null;
  const body = document.body;
  const animate = !(instant || !motionOK());
  clearEditZoom();
  // ⚠️ 顺序很重要：先把动画类挂上，再切视图。
  // 反过来的话抽屉会先出现在最终位置，然后动画又把它摆回屏幕下方再滑上来 —— 看上去就是"闪一下"。
  if (animate) body.classList.add('zooming', 'sheet-in');
  applyView('edit');
  if (!animate) { requestAnimationFrame(() => syncEditZoom(true)); return; }
  // 这里**不要** remove/add 重放动画：
  //   类在 applyView 之前就挂好了，元素一旦可见动画就从起点开始；
  //   而重放要读一次 offsetWidth —— 那是同步布局，前面 applyView 刚把整块右栏渲染完，
  //   在手机上这一下就是肉眼可见的"先到位再滑上来"（弹一下）。
  requestAnimationFrame(() => {
    const g = untransformed();
    if (A && g) setHolderT(flipFrom(A, g));            // 先摆回原来整页的位置
    void holderEl().offsetWidth;
    const t = zoomTargetFor(state.selectedId);
    zoomKey = [state.selectedId, state.tpl?.id, $('#stage')?.clientWidth, $('#stage')?.clientHeight].join('|');
    setHolderT(t, `transform .7s ${ZOOM_EASE}`);       // 再放大到这一格
    setTimeout(() => body.classList.remove('zooming', 'sheet-in'), 720);
  });
}

export function exitEdit(toView) {
  const body = document.body;
  const svg = holderEl()?.querySelector('svg');
  const E = svg ? svg.getBoundingClientRect() : null;
  if (!motionOK() || toView !== 'canvas' || !E) {
    clearEditZoom();
    withTransition(VIEW_ORDER.indexOf(toView) > VIEW_ORDER.indexOf('edit') ? 'view-fwd' : 'view-back', () => applyView(toView));
    return;
  }
  // 抽屉往下收，页面从这一格缩回整页
  body.classList.add('sheet-on', 'sheet-out', 'zooming');
  clearEditZoom();
  body.dataset.view = toView;
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === toView));
  deps.renderStage();
  requestAnimationFrame(() => {
    const g = untransformed();
    if (g) setHolderT(flipFrom(E, g));
    void holderEl().offsetWidth;
    setHolderT({ tx: 0, ty: 0, k: 1 }, `transform .6s ${ZOOM_EASE}`);
    setTimeout(() => {
      body.classList.remove('sheet-on', 'sheet-out', 'zooming');
      applyView(toView);
      setHolderT({ tx: 0, ty: 0, k: 1 });
    }, 620);
  });
}

export function setEditMod(m, { quiet = false } = {}) {
  state.editMod = m;
  const rail = $('#railRight');
  if (!rail) return;
  const changed = rail.dataset.mod !== m;
  rail.dataset.mod = m;
  $$('#editSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  if (changed && !quiet) { replay(rail, 'mod-swap'); rail.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' }); }
}

export function syncEditHead() {
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  if (!slot) return;
  const panel = deps.currentPlanPanel();
  $('#editIndex').textContent = slot.order;
  $('#editRole').textContent = panel ? panel.roleZh : slot.role;
  $('#editShot').textContent = panel ? `${panel.shot} · ${panel.beat || '通用'}` : '';
  const idx = state.tpl.slots.findIndex((s) => s.id === slot.id);
  $('#btnEditPrev').disabled = idx <= 0;
  $('#btnEditNext').disabled = idx >= state.tpl.slots.length - 1;
}

export function stepSlot(dir) {
  if (!state.tpl) return;
  const list = state.tpl.slots;
  const i = list.findIndex((s) => s.id === state.selectedId);
  const next = list[clamp(i + dir, 0, list.length - 1)];
  if (!next || next.id === state.selectedId) return;
  state.selectedId = next.id; state.selBubble = null;
  deps.renderStage(); deps.renderSlotPanel();
}

export function initViews() {
  $$('#tabbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view, { animate: true })));
  $('#btnEditSlot')?.addEventListener('click', () => setView('edit', { animate: true }));
  $('#btnEditDone')?.addEventListener('click', () => setView('canvas', { animate: true }));
  $('#btnEditPrev')?.addEventListener('click', () => stepSlot(-1));
  $('#btnEditNext')?.addEventListener('click', () => stepSlot(1));
  $('#editSeg')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-m]');
    if (b) setEditMod(b.dataset.m);
  });
  // 上半屏尺寸变了（旋转屏幕、键盘弹出）就重新对准
  if (window.ResizeObserver) new ResizeObserver(() => syncEditZoom()).observe($('#stage'));
  compactMQ.addEventListener?.('change', () => {
    if (!compactMQ.matches) { clearEditZoom(); document.body.classList.remove('sheet-on', 'sheet-in', 'sheet-out', 'zooming'); }
    else if (document.body.dataset.view === 'edit') { applyView('edit'); syncEditZoom(true); }
  });
  const want = new URLSearchParams(location.search).get('view');
  setView(VIEW_ALIAS[want] || (VIEW_ORDER.includes(want) ? want : 'canvas'));
}

