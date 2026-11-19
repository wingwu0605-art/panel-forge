/**
 * 格子绘制：按这一格的形状铺开画布 → 画 → 按多边形裁好贴回这一格。
 *
 * 优先用外部引擎 Klecks（iframe，压感 / 图层 / 撤销都是现成的，见 paint-host.mjs）；
 * 引擎起不来时退回自带的轻量笔（paint.mjs + perfect-freehand）。
 * 「用其他 App 画」：不进我们的画布，把带形状参考的底图交给手机上别的绘画 App。
 */
import { $, $$, PERF, perfNow, perfDone } from './util.mjs';
import { DBG } from './env.mjs';
import { state, commit } from './state.mjs';
import { imageAsset, loadImgEl } from './assets.mjs';
import { store, KEYS } from './storage.mjs';
import { play } from './motion.mjs';
import { toast, setBusy } from './ui.mjs';
import { exportBlob, sharePickOrSheet, nativeShareTargets, openSharePicker } from './share.mjs';
import { createCellPainter, localPoly } from './paint.mjs';
import { createKlecksHost } from './paint-host.mjs';
import { app } from './ctx.mjs';

let painter = null;        // 轻量笔会话（paint.mjs），引擎起不来时的兜底
let paintHost = null;      // 外部引擎会话（paint-host.mjs → Klecks iframe）
let paintEngine = 'none';  // 'klecks' | 'brush'
let paintSlotId = null;
let paintBound = false;

/** 把一张矩形 PNG 按格子多边形裁掉多余部分（斜切格靠这个贴合） */
async function clipToSlot(blob, slot) {
  const bmp = await createImageBitmap(blob);
  const k = bmp.width / slot.w;   // 输出分辨率 / 包围盒单位
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  const path = new Path2D();
  localPoly(slot).forEach(([x, y], i) => {
    const px = x * k, py = y * k;
    if (i) path.lineTo(px, py); else path.moveTo(px, py);
  });
  path.closePath();
  g.clip(path);
  g.drawImage(bmp, 0, 0);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

/** 把画布等比放进舞台（画布的像素尺寸固定，只有 CSS 尺寸随屏幕变） */
function fitPaintCanvas() {
  if (!painter) return;
  const stage = $('#paintStage');
  if (!stage) return;
  const box = stage.getBoundingClientRect();
  const ar = painter.w / painter.h;
  let w = Math.max(40, box.width - 20);
  let h = w / ar;
  if (h > box.height - 20) { h = Math.max(40, box.height - 20); w = h * ar; }
  painter.canvas.style.width = Math.round(w) + 'px';
  painter.canvas.style.height = Math.round(h) + 'px';
}

/** 铺满：从这一格在页面上的位置，长大到整屏（FLIP：先摆回格子的位置，再放到终点） */
function animatePaintIn(slot, el) {
  const svg = $('#canvas svg');
  const node = el || painter?.canvas;
  if (!svg || !node) return;
  const r = svg.getBoundingClientRect();
  const to = node.getBoundingClientRect();
  if (!r.width || !to.width) return;
  const k = r.width / state.tpl.page.w;
  const from = { x: r.left + slot.x * k, y: r.top + slot.y * k, w: slot.w * k };
  play(node, [
    { transform: `translate(${from.x - to.left}px,${from.y - to.top}px) scale(${from.w / to.width})`, opacity: 0.35, transformOrigin: '0 0' },
    { transform: 'none', opacity: 1, transformOrigin: '0 0' },
  ], { duration: 460, easing: 'ease', id: 'paintIn' });
}

/**
 * 打开某一格的绘制。
 * 优先用外部引擎（Klecks iframe）；它没产物 / 起不来时退回自带的轻量笔。
 */
export async function openPaint(slotId = state.selectedId) {
  if (!state.tpl || !slotId) { toast('先选一个格子'); return; }
  const slot = state.tpl.slots.find((s) => s.id === slotId);
  if (!slot) return;
  if (painter || paintHost) closePaint();

  // 底图 = 这一格现在的图（第一次是照片/参考图，之后再进是自己的上一版成图）
  const baseUrl = state.images[slotId]?.href || '';
  const rec = state.paint[slotId] || null;

  paintSlotId = slotId;
  const t0 = perfNow();
  const sheet = $('#paintSheet');
  const stage = $('#paintStage');
  stage.innerHTML = '';
  sheet.hidden = false;
  document.body.classList.add('painting');
  $('#paintTitle').textContent = `绘制第 ${slot.order} 格`;
  $('#paintSub').textContent = `${slot.shape?.zh || '常规格'} · ${Math.round(slot.w)}×${Math.round(slot.h)}`;
  if (!paintBound) bindPaintUI();
  syncPaintPaperBtn();

  // ---- 1) 先试外部引擎 ----
  const host = createKlecksHost({ slot, baseUrl });
  try {
    host.onSubmit = () => { finishPaint(); };
    await host.mount(stage);
    paintHost = host;
    paintEngine = 'klecks';
    document.body.classList.add('paint-engine');
    // 应用用户上次选的白底/透明
    await host.setPaper(paintPaperOn());
    // 窄屏（手机竖屏）：标题副行给一句最短的提示，别把顶栏撑满
    if (window.innerWidth < 560) {
      $('#paintSub').textContent = `${slot.shape?.zh || '常规格'} · 竖屏窄，建议横屏`;
    }
    animatePaintIn(slot, host.el);
    perfDone('paint', t0);
    return;
  } catch (e) {
    console.warn('[paint] 外部引擎没起来，退回轻量笔：', e.message);
    host.destroy();
    stage.innerHTML = '';
  }

  // ---- 2) 退回轻量笔 ----
  paintEngine = 'brush';
  document.body.classList.remove('paint-engine');
  if (!state.paint[slotId] && state.images[slotId] && !state.under[slotId]) {
    state.under[slotId] = state.images[slotId];
  }
  const under = state.under[slotId] || null;
  painter = createCellPainter({ slot, strokes: rec?.strokes || [] });
  stage.appendChild(painter.canvas);
  painter.setPaper(paintPaperOn());
  fitPaintCanvas();
  $('#paintUndo').disabled = !painter.strokes.length;
  wirePaintCanvas();
  if (under?.href) {
    try { painter.setUnderlay(await loadImgEl(under.href)); } catch { /* 底图读不出来就白底画 */ }
  }
  painter.render();
  animatePaintIn(slot, painter.canvas);
  perfDone('paint', t0);
}

/** 把某一格的图单独导成文件（画好的作品 / AI 生成图 / 拖进来的照片都走这里） */
export async function exportSlotImage(slotId = state.selectedId) {
  const im = slotId ? state.images[slotId] : null;
  if (!im) { toast('这一格还没有图'); return; }
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  try {
    const blob = im.blob instanceof Blob ? im.blob : await (await fetch(im.href)).blob();
    const ext = /png/.test(blob.type) ? 'png' : 'jpg';
    await exportBlob(blob, `${state.tpl?.id || 'page'}-第${slot?.order ?? '?'}格.${ext}`);
    toast('已导出这一格的图');
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

/** 白底 / 透明：用户可选，记在本机。true = 白底，false = 透明 */
function paintPaperOn() { return store.get(KEYS.paintPaper) !== '0'; }

function syncPaintPaperBtn() {
  const on = paintPaperOn();
  const b = $('#paintPaper');
  if (b) {
    b.textContent = on ? '白底' : '透明';
    b.classList.toggle('primary', !on);
  }
}

async function setPaintPaper(on) {
  store.set(KEYS.paintPaper, on ? null : '0');
  syncPaintPaperBtn();
  if (paintEngine === 'klecks' && paintHost) await paintHost.setPaper(on);
  else if (painter) painter.setPaper(on);
  toast(on ? '画布改成白底（导出不透明 PNG）' : '画布改成透明（导出带透明通道）');
}

/**
 * 把这一格做成「给别的 App 画」的画布：包围盒尺寸 + 白底（或已有底图）+ 形状参考。
 * 形状参考 = 多边形外面压 12% 灰 + 边界虚线。回填时按同一个多边形裁切，外面的灰会被裁掉，
 * 所以它既能告诉你边界在哪，又不会污染成图。
 */
async function cellSheetBlob(slot, workSide = 2048) {
  const scale = workSide / Math.max(slot.w, slot.h);
  const w = Math.max(1, Math.round(slot.w * scale));
  const h = Math.max(1, Math.round(slot.h * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const im = state.images[slot.id];
  if (im?.href) {
    try {
      const img = await loadImgEl(im.href);
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (iw && ih) {
        const k = Math.max(w / iw, h / ih);         // cover，和画布里的语义一致
        const dw = iw * k, dh = ih * k;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    } catch { /* 底图读不出来就画白纸 */ }
  }

  const pts = (slot.poly || []).map(([x, y]) => [(x - slot.x) * scale, (y - slot.y) * scale]);
  if (pts.length >= 3) {
    const veil = new Path2D();
    veil.rect(0, 0, w, h);
    pts.forEach(([x, y], i) => (i ? veil.lineTo(x, y) : veil.moveTo(x, y)));
    veil.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fill(veil, 'evenodd');

    const edge = new Path2D();
    pts.forEach(([x, y], i) => (i ? edge.lineTo(x, y) : edge.moveTo(x, y)));
    edge.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(2, w / 500);
    ctx.setLineDash([w / 90, w / 150]);
    ctx.stroke(edge);
    ctx.setLineDash([]);
  }
  return await new Promise((res) => cv.toBlob(res, 'image/png'));
}

/** 「用其他 App 画」：不经过我们的画布，直接把这一格交给别的绘画 App */
async function openExternalPaint() {
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  if (!slot) { toast('先选一个格子'); return; }
  try {
    const blob = await cellSheetBlob(slot);
    const name = `${state.tpl?.id || 'page'}-第${slot.order}格-底图.png`;
    const targets = await nativeShareTargets(true);
    if (targets?.length) { openSharePicker(targets, blob, name); return; }
    // 壳里没有直跳能力，或者根本在浏览器里：存相册/下载，让人自己去 App 里导入
    await exportBlob(blob, name);
    toast('已导出底图（含形状参考）：用别的 App 打开它，画完分享回 PanelForge 即可');
  } catch (e) {
    console.error('[external] 失败', e);
    toast('导出底图失败：' + e.message);
  }
}

/** 绘制页里「导出」：把当前画面按格子形状裁好存成 PNG（两种引擎都支持） */
async function exportPaintImage(mode = 'download') {
  const slot = state.tpl?.slots?.find((s) => s.id === paintSlotId);
  try {
    let raw = null;
    if (paintEngine === 'klecks' && paintHost) raw = await paintHost.exportPNG();
    else if (painter) raw = await painter.toBlob();
    if (!raw) { toast('还没有可导出的内容'); return; }
    const out = slot ? await clipToSlot(raw, slot) : raw;
    const name = `${state.tpl?.id || 'page'}-第${slot?.order ?? '?'}格-绘制.png`;
    if (mode === 'share') { await sharePickOrSheet(out, name, `第 ${slot?.order ?? '?'} 格`); return; }
    await exportBlob(out, name);
    toast('已导出这一格的绘制图');
  } catch (e) {
    console.error('[paint] 导出失败', e);
    toast('导出失败：' + e.message);
  }
}

export function closePaint() {
  if (paintHost) { paintHost.destroy(); paintHost = null; }
  if (painter) { painter.destroy(); painter = null; }
  paintEngine = 'none';
  paintSlotId = null;
  document.body.classList.remove('painting', 'paint-engine');
  const sheet = $('#paintSheet');
  if (sheet) sheet.hidden = true;
  const stage = $('#paintStage');
  if (stage) stage.innerHTML = '';
}

/** 完成：外部引擎取图 → 按格子多边形裁 → 当这一格的图 */
export async function finishPaint() {
  if (!paintSlotId) { closePaint(); return; }
  const slotId = paintSlotId;
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);

  if (paintEngine === 'klecks' && paintHost) {
    const host = paintHost;
    const btn = $('#paintDone');
    const old = btn?.textContent;
    if (btn) { setBusy(btn, true); btn.textContent = '取图…'; }
    try {
      const raw = await host.exportPNG();
      const workSide = Math.max(host.width, host.height);
      const clipped = slot ? await clipToSlot(raw, slot) : raw;
      commit();
      // maxSide = 工作分辨率 → 不缩放，保住 PNG 的清晰边缘
      state.images[slotId] = await imageAsset(clipped, { name: 'paint', maxSide: workSide });
      delete state.paint[slotId];   // 外部引擎不交笔画，只交成图
      closePaint();
      app.renderStage(); app.renderSlotPanel(); app.refreshScript(); app.queueSave();
      toast('已画好并贴回这一格');
    } catch (e) {
      console.error('[paint] 取图失败', e);
      toast('取图失败：' + e.message);
    } finally {
      if (btn) { setBusy(btn, false); btn.textContent = old || '完成'; }
    }
    return;
  }

  if (!painter) { closePaint(); return; }
  const strokes = painter.strokes.map((s) => ({ ...s, pts: [...s.pts] }));
  const workSide = Math.max(painter.w, painter.h);
  const blob = await painter.toBlob();
  commit();
  state.paint[slotId] = { strokes, workSide };
  if (blob) {
    state.images[slotId] = await imageAsset(blob, { name: 'paint', maxSide: workSide });
  }
  closePaint();
  app.renderStage(); app.renderSlotPanel(); app.refreshScript(); app.queueSave();
  toast(strokes.length ? `已存这一格（${strokes.length} 笔）` : '笔迹已清空');
}

/** 把指针事件接到当前画布（每次 open 都是新画布，所以单独抽出来） */
function wirePaintCanvas() {
  const c = painter?.canvas;
  if (!c || c.dataset.wired) return;
  c.dataset.wired = '1';
  c.addEventListener('pointerdown', (ev) => { painter?.begin(ev); syncPaintMeta(); });
  c.addEventListener('pointermove', (ev) => { painter?.move(ev); });
  const stop = (ev) => { painter?.end(ev); syncPaintMeta(); };
  c.addEventListener('pointerup', stop);
  c.addEventListener('pointercancel', stop);
  c.addEventListener('pointerleave', (ev) => { if (ev.buttons) stop(ev); });
}

function syncPaintMeta() {
  const btn = $('#paintUndo');
  if (btn) btn.disabled = !(painter && painter.strokes.length);
}

function bindPaintUI() {
  paintBound = true;
  $('#paintTools')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-t]');
    if (!b || !painter) return;
    painter.setTool(b.dataset.t);
    $$('#paintTools button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#paintSize')?.addEventListener('input', (ev) => {
    if (!painter) return;
    painter.setSize(Number(ev.target.value));
    $('#paintSizeVal').textContent = ev.target.value;
  });
  $('#paintColor')?.addEventListener('input', (ev) => { painter?.setColor(ev.target.value); });
  $('#paintUndo')?.addEventListener('click', () => { if (painter?.undo()) syncPaintMeta(); });
  $('#paintExport')?.addEventListener('click', () => { exportPaintImage(); });
  // 分享：手机上把这一格直接交给别的绘画 App（原生壳走 Capacitor Share，浏览器走 Web Share）
  $('#paintShare')?.addEventListener('click', () => { exportPaintImage('share'); });
  // 白底 / 透明：用户自己选，记在本机
  $('#paintPaper')?.addEventListener('click', () => { setPaintPaper(!paintPaperOn()); });
  $('#paintCancel')?.addEventListener('click', closePaint);
  $('#paintDone')?.addEventListener('click', () => { finishPaint(); });
  $('#paintSheet')?.addEventListener('pointerdown', (ev) => { if (ev.target.id === 'paintStage') closePaint(); });
  window.addEventListener('resize', () => { fitPaintCanvas(); });
  window.addEventListener('keydown', (ev) => {
    if (!painter && !paintHost) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); closePaint(); }
    else if (!painter) return;   // 下面这些只对轻量笔有意义
    else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault(); ev.stopPropagation();
      if (painter.undo()) syncPaintMeta();
    }
  }, true);
}

/**
 * 常驻入口在启动时就绑上。
 * 以前「用其他 App 画」的点击是在 bindPaintUI() 里绑的，而 bindPaintUI 要等第一次打开绘制页才跑 ——
 * 没画过的人点这个按钮没有任何反应。
 */
export function initPaint() {
  $('#btnExternalPaint')?.addEventListener('click', () => { openExternalPaint(); });
}

/* 自动化测试用的只读/驱动钩子（只在 ?dbg=1 / ?perf=1 下存在） */
if (PERF || DBG) {
  window.__pfPaint = {
    open: (id) => openPaint(id),
    finish: () => finishPaint(),
    close: () => closePaint(),
    info: () => ({
      engine: paintEngine,
      slot: paintSlotId,
      hasHost: !!paintHost,
      hasBrush: !!painter,
      frame: !!document.querySelector('.paint-frame'),
      sheetOpen: !document.querySelector('#paintSheet')?.hidden,
      hostSize: paintHost ? { w: paintHost.width, h: paintHost.height } : null,
    }),
  };
}
