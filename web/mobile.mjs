/**
 * 手机视图与「进 / 出这一格编辑」的动画。
 *
 * setView / applyView / enterEdit / exitEdit + FLIP 缩放，以及底部的视图切换绑定 initViews。
 * 只在手机断点（≤1024px）生效；桌面上视图切换就是直接换。
 *
 * 动画全部走 Web Animations：
 *   · 以前 FLIP 是「设起始 transform → 读 offsetWidth 强制同步布局 → 设 CSS transition」，
 *     再用 setTimeout(720) 估摸结束时间去摘类 —— 手机上那次同步布局就是「先到位再滑上来」的那一下。
 *   · 现在：终态直接写在 style 上，element.animate 从起始帧播到终态，等 finished 再收尾；
 *     被打断就从当前画面接着走，不会跳。
 * 用到的 app.js 能力（renderStage / renderSlotPanel / activateTab / currentPlanPanel）从 ctx.mjs 的 app 取。
 */
import { $, $$, clamp } from './util.mjs';
import { params } from './env.mjs';
import { state } from './state.mjs';
import { app } from './ctx.mjs';
import { fx, play, settled, motionOK, withTransition } from './motion.mjs';

export const ZOOM_EASE = 'cubic-bezier(.32,.72,0,1)';
export const VIEW_ORDER = ['library', 'story', 'canvas', 'edit', 'output'];
export const VIEW_ALIAS = { inspect: 'edit' };
export const compactMQ = window.matchMedia('(max-width:1024px)');
const IDENTITY = { tx: 0, ty: 0, k: 1 };
let zoomT = IDENTITY;   // #canvas 当前（终态）的变换
let zoomKey = '';
const zoomKeyNow = () => [state.selectedId, state.tpl?.id, $('#stage')?.clientWidth, $('#stage')?.clientHeight].join('|');
const sheetEl = () => $('.layout > .rail.right');
const dirOf = (from, to) => (VIEW_ORDER.indexOf(to) > VIEW_ORDER.indexOf(from) ? 'view-fwd' : 'view-back');

export function setView(view, opts = {}) {
  view = VIEW_ALIAS[view] || view;
  if (!VIEW_ORDER.includes(view)) return;
  const prev = document.body.dataset.view;
  const compact = compactMQ.matches;
  if (view === 'edit' && state.tpl && !state.selectedId) {
    state.selectedId = state.tpl.slots[0]?.id || null;
    app.renderStage(); app.renderSlotPanel();
  }
  if (opts.animate && prev && prev !== view && compact) {
    const tab = $(`#tabbar button[data-view="${view}"]`);
    fx.bounce(tab?.querySelector('svg') || tab);
    // 画布 ⇄ 编辑：页面直接放大 / 缩回这一格，比整页滑动更有空间感
    if (view === 'edit') { enterEdit(prev === 'canvas'); return; }
    if (prev === 'edit') { exitEdit(view); return; }
    withTransition(dirOf(prev, view), () => applyView(view));
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
    if (!cur || cur === 'slot') app.activateTab('script');
  }
  if (view === 'edit') { app.activateTab('slot'); setEditMod(state.editMod || 'text', { quiet: true }); syncEditHead(); }
  if (view === 'canvas' || view === 'edit') app.renderStage();
}
export function goCanvasOnCompact() { if (compactMQ.matches) setView('canvas', { animate: true }); }

/* ---------------- 编辑页：放大到选中的格子 ---------------- */

export function holderEl() { return $('#canvas'); }
const tf = (t) => `translate(${t.tx}px, ${t.ty}px) scale(${t.k})`;
/** 直接摆到某个变换（没有过程） */
export function setHolderT(t) {
  const h = holderEl();
  if (!h) return;
  zoomT = t;
  h.style.transform = (t.k === 1 && !t.tx && !t.ty) ? '' : tf(t);
}
/** 平滑移到 to：终态先写上，动画从 from（默认：当前画面上的样子）播过去 */
function moveHolder(to, { from = null, duration = 620 } = {}) {
  const h = holderEl();
  if (!h) return null;
  const running = h.getAnimations().some((x) => x.id === 'zoom');
  const start = from ? tf(from) : (running ? getComputedStyle(h).transform : tf(zoomT));
  setHolderT(to);
  return play(h, [{ transform: start }, { transform: tf(to) }], { duration, easing: ZOOM_EASE, id: 'zoom' });
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
  const key = zoomKeyNow();
  if (!force && key === zoomKey) return;
  // 画布还没画出来（比如直接用 ?view=edit 打开）：先别记 key，等 renderStage 画完再来一次
  if (!holderEl()?.querySelector('svg')) return;
  zoomKey = key;
  const t = zoomTargetFor(state.selectedId);
  if (motionOK()) moveHolder(t); else setHolderT(t);
}
export function clearEditZoom() {
  zoomKey = '';
  holderEl()?.getAnimations().forEach((x) => { if (x.id === 'zoom') x.cancel(); });
  setHolderT(IDENTITY);
}

/** FLIP：从 rect A 看起来的位置，变到 rect B 现在的位置所需的起始变换 */
export function flipFrom(A, g) {
  const k0 = A.width / g.svg.width;
  return { tx: A.left - g.hl - (g.svg.left - g.hl) * k0, ty: A.top - g.ht - (g.svg.top - g.ht) * k0, k: k0 };
}

/** 画布 → 编辑：抽屉从底部滑上来，页面同时放大到这一格 */
export function enterEdit(fromCanvas, { instant = false } = {}) {
  const svg = holderEl()?.querySelector('svg');
  const A = fromCanvas && svg ? svg.getBoundingClientRect() : null;
  const body = document.body;
  const animate = !instant && motionOK();
  clearEditZoom();
  if (animate) body.classList.add('zooming');
  applyView('edit');
  if (!animate) { requestAnimationFrame(() => syncEditZoom(true)); return; }
  // 同一个任务里就把动画挂上：第一帧就是起点，不会先在终点闪一下
  play(sheetEl(), [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 600, easing: 'spring-soft', id: 'sheet' });
  requestAnimationFrame(() => {
    const g = untransformed();
    zoomKey = zoomKeyNow();
    const anim = moveHolder(zoomTargetFor(state.selectedId), { from: A && g ? flipFrom(A, g) : IDENTITY, duration: 700 });
    settled(anim).then(() => body.classList.remove('zooming'));
  });
}

/** 编辑 → 画布：抽屉往下收，页面从这一格缩回整页 */
export function exitEdit(toView) {
  const body = document.body;
  const svg = holderEl()?.querySelector('svg');
  const E = svg ? svg.getBoundingClientRect() : null;
  if (!motionOK() || toView !== 'canvas' || !E) {
    clearEditZoom();
    withTransition(dirOf('edit', toView), () => applyView(toView));
    return;
  }
  body.classList.add('sheet-out', 'zooming');   // sheet-out：退场这段时间抽屉保持可见
  const sheetAnim = play(sheetEl(), [{ transform: 'none' }, { transform: 'translateY(105%)' }],
    { duration: 320, easing: 'ease', fill: 'forwards', id: 'sheet' });
  clearEditZoom();
  body.dataset.view = toView;
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === toView));
  app.renderStage();
  requestAnimationFrame(() => {
    const g = untransformed();
    const anim = moveHolder(IDENTITY, { from: g ? flipFrom(E, g) : IDENTITY, duration: 600 });
    Promise.all([settled(anim), settled(sheetAnim)]).then(() => {
      sheetAnim?.cancel();
      body.classList.remove('sheet-on', 'sheet-out', 'zooming');
      applyView(toView);
    });
  });
}

export function setEditMod(m, { quiet = false } = {}) {
  state.editMod = m;
  const rail = $('#railRight');
  if (!rail) return;
  const changed = rail.dataset.mod !== m;
  rail.dataset.mod = m;
  $$('#editSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  if (changed && !quiet) {
    rail.querySelectorAll('#tabSlot, .bubble-dock').forEach((el) => fx.rise(el));
    rail.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' });
  }
}

export function syncEditHead() {
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  if (!slot) return;
  const panel = app.currentPlanPanel();
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
  app.renderStage(); app.renderSlotPanel();
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
  const want = params.get('view');
  setView(VIEW_ALIAS[want] || (VIEW_ORDER.includes(want) ? want : 'canvas'));
}

