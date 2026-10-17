#!/usr/bin/env node
/**
 * 拖动性能赛跑（零依赖）：灌 N 张真图 → 合成一次拖动 → 报帧率与热路径次数。
 *
 *   node scripts/perf-bench.mjs                 # 8 张 1600x2000 的图
 *   node scripts/perf-bench.mjs --n=15 --w=430  # 手机宽度、塞满 15 格
 *   node scripts/perf-bench.mjs --frames=120    # 拖久一点
 *
 * 需要 `node server.mjs` 已经在跑。数据只落在临时浏览器 profile 里，不碰你的草稿。
 * 判读：拖动期间 render 次数应该接近 0（整页重建），patch 次数接近帧数（只改属性）。
 */
import { launch, BASE } from './visual-check.mjs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; }));
const N = Number(opt.n || 8);
const FRAMES = Number(opt.frames || 60);
const W = Number(opt.w || 430);
const H = Number(opt.h || 900);
const TPL = opt.tpl || 'ref-4band-2col';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = await launch({ width: W, height: H });
try {
  const { page } = session;
  await page.viewport(W, H);
  await page.goto(`/?perf=1&tpl=${encodeURIComponent(TPL)}`);
  await page.ready();
  if (!(await page.evaluate('!!window.__pfPerf'))) throw new Error('没拿到 window.__pfPerf（?perf=1 没生效？）');

  // ---- 灌图：走真实的 drop 入口 ----
  const fill = await page.evaluate(`(async () => {
    const N = ${N};
    const mk = (seed) => new Promise((res) => {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 2000;
      const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + (seed * 40) + ',70%,55%)'; g.fillRect(0, 0, 1600, 2000);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = 'hsla(' + (i * 7) + ',80%,' + (30 + (i % 50)) + '%,.8)';
        g.beginPath(); g.arc((i * 137) % 1600, (i * 211) % 2000, 20 + (i % 60), 0, 7); g.fill();
      }
      g.font = 'bold 160px sans-serif'; g.fillStyle = '#fff'; g.fillText('PANEL ' + seed, 80, 200);
      c.toBlob(res, 'image/jpeg', 0.92);
    });
    const files = [];
    for (let i = 0; i < N; i++) files.push(new File([await mk(i)], 'p' + i + '.jpg', { type: 'image/jpeg' }));
    const inputMB = +(files.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(2);
    const canvas = document.querySelector('#canvas');
    const r = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    canvas.dispatchEvent(new DragEvent('drop', {
      dataTransfer: dt, bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    await new Promise((res) => setTimeout(res, 2500));
    return { inputMB, slots: document.querySelectorAll('#canvas svg image[data-slot]').length };
  })()`);

  // ---- 合成拖动：每帧一个 pointermove（跟手机触摸采样一个节奏）----
  await page.evaluate('window.__pfPerf.reset()');
  const drag = await page.evaluate(`(async () => {
    const FRAMES = ${FRAMES};
    const canvas = document.querySelector('#canvas');
    const target = canvas.querySelector('svg image[data-slot]');
    const tr = (target || canvas.querySelector('svg')).getBoundingClientRect();
    const x0 = tr.left + tr.width / 2, y0 = tr.top + tr.height / 2;
    const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    canvas.dispatchEvent(ev('pointerdown', x0, y0));
    const marks = [];
    for (let i = 0; i < FRAMES; i++) {
      await new Promise((res) => requestAnimationFrame((t) => {
        marks.push(t);
        canvas.dispatchEvent(ev('pointermove', x0 + (i % 40), y0 + (i % 30)));
        res();
      }));
    }
    canvas.dispatchEvent(ev('pointerup', x0, y0));
    const d = marks.slice(1).map((t, i) => t - marks[i]).sort((a, b) => a - b);
    const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))] || 0;
    const avg = d.reduce((n, v) => n + v, 0) / Math.max(1, d.length);
    return {
      frames: d.length, avg: +avg.toFixed(1), p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1),
      worst: +(d[d.length - 1] || 0).toFixed(1), fps: Math.round(1000 / avg),
    };
  })()`);

  // 松手后等一下，让一次落盘走完
  await sleep(1600);
  const hud = await page.evaluate('window.__pfPerf.snapshot()');

  // ---- 顺便量一下「整页重绘」还有多贵：点不同格子，每次都会重建整页 SVG ----
  await page.evaluate('window.__pfPerf.reset()');
  const full = await page.evaluate(`(async () => {
    const canvas = document.querySelector('#canvas');
    const ev = (t, x, y) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    const rects = [...canvas.querySelectorAll('svg image[data-slot]')].map((e) => e.getBoundingClientRect());
    for (const r of rects) {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      canvas.dispatchEvent(ev('pointerdown', x, y));
      canvas.dispatchEvent(ev('pointerup', x, y));
      await new Promise((res) => requestAnimationFrame(res));
    }
    return window.__pfPerf.snapshot();
  })()`);

  // ---- 改一句台词之后的存盘量：图片没变就不该重写那几 MB ----
  await page.evaluate('window.__pfPerf.reset()');
  await page.evaluate(`(async () => {
    const canvas = document.querySelector('#canvas');
    const ev = (t, x, y) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    const rects = [...canvas.querySelectorAll('svg image[data-slot]')].slice(0, 2).map((e) => e.getBoundingClientRect());
    for (const r of rects) {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      canvas.dispatchEvent(ev('pointerdown', x, y));
      canvas.dispatchEvent(ev('pointerup', x, y));
      await new Promise((res) => requestAnimationFrame(res));
    }
    const ta = document.querySelector('#slotLine');
    ta.value = (ta.value || '') + '（补一句）';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // 再点一下让整页重绘把它带进草稿（renderStage 会排一次存盘）
    const c2 = canvas.querySelector('svg image[data-slot]')?.getBoundingClientRect();
    if (c2) {
      canvas.dispatchEvent(ev('pointerdown', c2.left + 4, c2.top + 4));
      canvas.dispatchEvent(ev('pointerup', c2.left + 4, c2.top + 4));
    }
  })()`);
  await sleep(2400);
  const save2 = await page.evaluate('window.__pfPerf.snapshot()');

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + 'MB' : Math.round(n / 1024) + 'KB');
  console.log(`\n  PanelForge 拖动赛跑 · ${TPL} · 视口 ${W}×${H}`);
  console.log(`  灌入 ${N} 张 ${opt.src || '1600×2000'}（原图 ${fill.inputMB}MB）→ 画布上 ${fill.slots} 格有图`);
  console.log(`  页面里：base64 ${kb(hud.imageBytes)} · SVG 标记 ${kb(hud.markupBytes)}\n`);
  console.log(`  拖动 ${drag.frames} 帧：平均 ${drag.avg}ms · p50 ${drag.p50}ms · p95 ${drag.p95}ms · 最差 ${drag.worst}ms → 约 ${drag.fps}fps`);
  console.log(`  整页重绘 render：${hud.renders} 次 · 最近一批 p95 ${hud.render.p95.toFixed(1)}ms`);
  console.log(`  属性补丁 patch：${hud.patches} 次 · 最近一批 p95 ${hud.patch.p95.toFixed(2)}ms`);
  console.log(`  首次落盘（含图片）：${hud.saves} 次 · ${kb(hud.saveBytes)} · 峰 ${hud.save.max.toFixed(0)}ms`);
  console.log(`  之后改句子再落盘：${kb(save2.saveBytes)} · 峰 ${save2.save.max.toFixed(0)}ms`);
  console.log(`  长任务（>50ms）：${hud.longtasks.length ? hud.longtasks.join(', ') + 'ms' : '无'}`);
  console.log(`  非热路径的整页重绘（点格子切换）：${full.renders} 次 · p95 ${full.render.p95.toFixed(1)}ms · 峰 ${full.render.max.toFixed(1)}ms\n`);
  const okPerf = drag.p95 <= 20 && hud.renders <= Math.max(3, FRAMES * 0.1) && full.render.max < 100;
  const okSave = save2.saveBytes < 512 * 1024;
  console.log(`  ${okPerf && okSave ? '✅ 合格：帧稳、拖动里几乎不重建整页、改句子不再重写图片' : '⚠️ 有回退'}\n`);
  process.exitCode = okPerf && okSave ? 0 : 1;
} finally {
  session.close();
}
