/**
 * 选中格子的悬浮缩放条：贴在格子正右侧，显示百分比，拖动 / 点 +− 只改这一张图（走热路径）。
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

/** 把缩放条贴到「当前选中格子」的正右侧；没有图（或不在画布视图）就藏起来 */
export function syncSlotZoom() {
  const { box, range, val } = els();
  if (!box) return;
  const img = state.selectedId ? state.images[state.selectedId] : null;
  // 只在「画布」视图显示：别的视图里 #canvas 是 display:none，矩形全是 0，
  // 缩放条会被定到视口左上角（真出现过）
  const r = img && !state.hollow && document.body.dataset.view === 'canvas' ? slotRect(state.selectedId) : null;
  if (!r || r.width < 4 || r.height < 4) { box.classList.add('hidden'); return; }
  // position:fixed + 视口坐标：不依赖 offsetParent（祖先一加 transform 它就会变，踩过两次）
  box.classList.remove('hidden');
  box.style.left = Math.round(r.right + 10) + 'px';
  box.style.top = Math.round(r.top + r.height / 2) + 'px';
  box.style.transform = 'translateY(-50%)';
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
