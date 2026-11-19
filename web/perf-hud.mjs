/**
 * 性能浮窗（?perf=1 才加载）：帧时间、整页重绘 / 局部刷新次数、存盘体积、图片占用。
 * window.__pfPerf.snapshot() 给 scripts/perf-bench.mjs 读。
 */
import { $, perf, perfPush, perfStats } from './util.mjs';
import { state } from './state.mjs';
import { blobForUrl } from './assets.mjs';

const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + 'MB' : Math.round(n / 1024) + 'KB');
const cls = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : '');

/** 图片实际占用：blob URL 按 Blob 大小算（以前按 href 字符串长度算，换成 blob URL 后永远是几十字节） */
function imageBytes() {
  let n = 0;
  for (const im of Object.values(state.images || {})) {
    const href = String(im?.href || '');
    n += blobForUrl(href)?.size ?? href.length;
  }
  return n;
}

export function initPerfHud() {
  const el = document.createElement('div');
  el.className = 'perf-hud';
  el.id = 'perfHud';
  el.textContent = 'perf…';
  document.body.appendChild(el);

  let last = performance.now();
  const tick = (t) => { perfPush(perf.frames, t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => perfPush(perf.longtask, Math.round(e.duration))))
      .observe({ type: 'longtask', buffered: true });
  } catch { /* 不支持 longtask */ }

  window.__pfPerf = {
    reset() {
      for (const k of ['frames', 'render', 'patch', 'save', 'longtask']) perf[k].length = 0;
      perf.renders = 0; perf.patches = 0; perf.saves = 0; perf.lastSaveBytes = 0;
    },
    snapshot() {
      return {
        frames: perfStats(perf.frames), render: perfStats(perf.render), patch: perfStats(perf.patch),
        save: perfStats(perf.save), renders: perf.renders, patches: perf.patches, saves: perf.saves,
        longtasks: perf.longtask.slice(-8), saveBytes: perf.lastSaveBytes,
        images: Object.keys(state.images || {}).length,
        imageBytes: imageBytes(),
        markupBytes: ($('#canvas svg')?.outerHTML || '').length,
      };
    },
  };

  setInterval(() => {
    if (document.hidden) return;
    const f = perfStats(perf.frames);
    const r = perfStats(perf.render);
    const p = perfStats(perf.patch);
    const markup = ($('#canvas svg')?.outerHTML || '').length;
    const fps = f.avg > 0 ? Math.round(1000 / f.avg) : 0;
    el.innerHTML = [
      `<b>${fps}</b> fps · 帧 p95 <span class="${cls(f.p95, 20, 34)}">${f.p95.toFixed(1)}ms</span> · 长任务 ${perf.longtask.length}`,
      `render ${perf.renders} 次 · 最近 ${r.p95.toFixed(1)}ms · 峰 ${r.max.toFixed(1)}ms`,
      `patch ${perf.patches} 次 · 最近 ${p.p95.toFixed(2)}ms`,
      `存盘 ${perf.saves} 次 · ${kb(perf.lastSaveBytes)} · 峰 ${perfStats(perf.save).max.toFixed(0)}ms`,
      `图 ${Object.keys(state.images || {}).length} 张 · ${kb(imageBytes())} · 标记 ${kb(markup)}`,
    ].join('\n');
  }, 500);
}
