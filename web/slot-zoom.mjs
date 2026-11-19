/**
 * 选中格子的悬浮缩放条：显示百分比，拖动 / 点 +− 只改这一张图（走热路径）。
 *
 * 放在哪：绝不压住别的格子。
 *   ① 页面外侧的空白里，和这一格同一高度（离这一格近的那一侧优先）—— 桌面上基本都是这种
 *   ② 两侧都没空（手机、放大看页面时）：放进这一格自己里面贴右边，只挡这一格自己的图
 *   ③ 这一格太矮放不下竖条：换成横条，贴在这一格里面的底边
 *   ④ 还放不下：横条放在页面上方 / 下方的空白里；再不行就不浮出来（编辑页里也能调）
 *   以前一律贴在格子正右侧 10px，右边那一格就被它盖住一大块。
 *
 * 位置怎么跟上：画布重绘后同步一次（app.js 在 renderStage 末尾调 syncSlotZoom），
 * 舞台尺寸变了交给 ResizeObserver，滚动 / 窗口变化跟着走，换页入场动画结束时再对一次。
 * 以前是 MutationObserver 盯住画布、每次重绘后按 0/50/120/250/500/900ms 补 6 个定时器去量 ——
 * 鼠标在格子上扫一遍就会排出上百个定时器、每个都强制一次布局。
 */
import { $, clamp } from './util.mjs';
import { state } from './state.mjs';
import { setRange } from './ui.mjs';
import { app } from './ctx.mjs';

const els = () => ({ box: $('#slotZoom'), range: $('#slotZoomRange'), val: $('#slotZoomVal') });

/** 一格在屏幕上的矩形（从模板几何 + SVG 缩放换算，与图片溢出无关） */
function slotRect(id) {
  const svg = $('#canvas svg');
  const slot = state.tpl?.slots?.find((x) => x.id === id);
  if (!svg || !slot) return null;
  const r = svg.getBoundingClientRect();
  const kx = r.width / state.tpl.page.w;
  const ky = r.height / state.tpl.page.h;
  return {
    left: r.left + slot.x * kx,
    top: r.top + slot.y * ky,
    right: r.left + (slot.x + slot.w) * kx,
    bottom: r.top + (slot.y + slot.h) * ky,
    width: slot.w * kx,
    height: slot.h * ky,
  };
}
/** 调试 / 测试用 */
window.__pfSlotRect = (id = state.selectedId) => slotRect(id);

const GAP = 12;   // 离页面边缘 / 格子边缘的距离
const EDGE = 6;   // 离舞台可视区边缘的最小距离
const PAD = 8;    // 放进格子里时离格子边的距离

/**
 * 算缩放条的位置：按顺序试，第一个「在可视区里、又不碰别的格子」的就用；都不行就不显示
 * （手机上这一格的缩放在编辑页「图片」那一段里也能调，宁可不浮出来也不能盖住别的格子）。
 * r = 这一格的屏幕矩形，page = 整页，view = 舞台可视区，others = 其它格子的屏幕矩形
 */
function placeFor(box, r, page, view, others) {
  const size = (h) => { box.classList.toggle('h', h); return { w: box.offsetWidth, h: box.offsetHeight }; };
  const V = size(false);
  const H = size(true);
  const midX = r.left + r.width / 2;
  const midY = r.top + r.height / 2;
  const inView = (c) => c.x >= view.left + EDGE && c.x + c.w <= view.right - EDGE
    && c.y >= view.top + EDGE && c.y + c.h <= view.bottom - EDGE;
  const hits = (c) => others.some((q) => c.x < q.right - 1 && c.x + c.w > q.left + 1 && c.y < q.bottom - 1 && c.y + c.h > q.top + 1);
  const yV = clamp(midY - V.h / 2, view.top + EDGE, view.bottom - V.h - EDGE);
  const xH = clamp(midX - H.w / 2, view.left + EDGE, view.right - H.w - EDGE);
  const gutterR = { x: page.right + GAP, y: yV, ...V, h: false, where: 'gutter-right' };
  const gutterL = { x: page.left - GAP - V.w, y: yV, ...V, h: false, where: 'gutter-left' };
  const nearRight = midX >= page.left + page.width / 2;
  const candidates = [
    // ① 页面外侧、和这一格同高（离得近的那一侧优先）
    ...(nearRight ? [gutterR, gutterL] : [gutterL, gutterR]),
    // ② 这一格里面贴右边（竖条，只挡这一格自己的图）
    { x: r.right - V.w - PAD, y: clamp(midY - V.h / 2, r.top + PAD, r.bottom - V.h - PAD), ...V, h: false, where: 'inside' },
    // ③ 这一格里面贴底边（横条）
    { x: clamp(midX - H.w / 2, r.left + PAD, r.right - H.w - PAD), y: r.bottom - H.h - PAD, ...H, h: true, where: 'inside-h' },
    // ④ 页面上方 / 下方的空白里（横条，对准这一格）
    { x: xH, y: page.bottom + GAP, ...H, h: true, where: 'gutter-bottom' },
    { x: xH, y: page.top - GAP - H.h, ...H, h: true, where: 'gutter-top' },
  ];
  for (const c of candidates) {
    const inside = c.where.startsWith('inside');
    // 放进格子里的两种，必须整条都在这一格里面
    if (inside && (c.x < r.left || c.x + c.w > r.right || c.y < r.top || c.y + c.h > r.bottom)) continue;
    if (inView(c) && !hits(c)) { box.classList.toggle('h', c.h); return c; }
  }
  return null;
}

/** 把缩放条放到这一格旁边（不压别的格子）；没有图、不在画布视图、或放哪都会挡住别的格子，就藏起来 */
export function syncSlotZoom() {
  const { box, range, val } = els();
  if (!box) return;
  const img = state.selectedId ? state.images[state.selectedId] : null;
  // 只在「画布」视图显示：别的视图里 #canvas 是 display:none，矩形全是 0，
  // 缩放条会被定到视口左上角（真出现过）
  const r = img && !state.hollow && document.body.dataset.view === 'canvas' ? slotRect(state.selectedId) : null;
  const page = $('#canvas svg')?.getBoundingClientRect();
  if (!r || !page || r.width < 4 || r.height < 4) { box.classList.add('hidden'); return; }
  // position:fixed + 视口坐标：不依赖 offsetParent（祖先一加 transform 它就会变，踩过两次）
  box.classList.remove('hidden');
  const view = $('#stage')?.getBoundingClientRect() || { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const others = (state.tpl?.slots || []).filter((x) => x.id !== state.selectedId).map((x) => slotRect(x.id)).filter(Boolean);
  const p = placeFor(box, r, page, view, others);
  if (!p) { box.classList.add('hidden'); box.dataset.place = ''; return; }
  box.style.left = Math.round(p.x) + 'px';
  box.style.top = Math.round(p.y) + 'px';
  box.dataset.place = p.where;
  const pct = Math.round((img.zoom || 1) * 100);
  if (val) val.textContent = pct + '%';
  if (range && document.activeElement !== range) setRange(range, clamp(pct, 30, 400));
}

let raf = 0;
/** 同一帧里多次请求只量一次 */
export function syncSlotZoomSoon() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(syncSlotZoom);
}

/** 设置当前格的缩放（30%–400%），走热路径只改这一张图 */
export function setSlotZoom(pct) {
  const id = state.selectedId;
  const img = id ? state.images[id] : null;
  if (!img) return;
  const next = clamp(Number(pct) / 100, 0.3, 4);
  if (Math.abs(next - (img.zoom || 1)) < 0.001) return;
  img.zoom = next;
  app.refreshSlotImage(id);
  syncSlotZoom();
  app.syncZoomSlider();
  app.queueSave();
}

export function bindSlotZoom() {
  const { box, range } = els();
  if (!box || box.dataset.ready) return;
  box.dataset.ready = '1';
  // 挂到 body：position:fixed 就不再受任何祖先 transform 影响
  if (box.parentElement !== document.body) document.body.appendChild(box);
  range?.addEventListener('input', (ev) => setSlotZoom(ev.target.value));
  box.addEventListener('click', (ev) => {
    const step = ev.target.closest('[data-step]');
    if (step) {
      const cur = Math.round((state.images[state.selectedId]?.zoom || 1) * 100);
      setSlotZoom(cur + Number(step.dataset.step) * 8);
      return;
    }
    if (ev.target.closest('#slotZoomVal')) setSlotZoom(100);
  });
  window.addEventListener('resize', syncSlotZoomSoon);
  document.addEventListener('scroll', syncSlotZoomSoon, { passive: true, capture: true });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncSlotZoomSoon);
    for (const el of [$('#stage'), $('#canvas')]) if (el) ro.observe(el);
  }
  syncSlotZoomSoon();
}
