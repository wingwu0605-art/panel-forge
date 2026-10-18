#!/usr/bin/env node
/**
 * 目视检查（零依赖）：起一个 headless Chrome，按场景开页面 / 点按钮 / 截图 / 断言。
 *
 *   node scripts/visual-check.mjs            # 跑全部场景
 *   node scripts/visual-check.mjs bubble     # 只跑名字里含 "bubble" 的场景
 *   node scripts/visual-check.mjs --keep     # 保留 out/shots 里的旧图（默认也保留，只是不清理）
 *
 * 前提：本机装了 Chrome 或 Edge（取不到就用 CHROME_PATH 指定），
 *       并且 `node server.mjs` 已经在跑（默认 http://127.0.0.1:7311）。
 * 产物：out/shots/<场景>.png + 终端里的 PASS/FAIL 清单。
 *
 * 为什么要有它：折叠 / 面板消失这类问题靠读代码判断不了，必须真的渲染一次看几何。
 * 它只读页面状态、不写业务数据（不点删除、不点保存），所以随便重复跑。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'out', 'shots');
const BASE = process.env.PF_BASE || 'http://127.0.0.1:7311';

const argv = process.argv.slice(2);
const filters = argv.filter((a) => !a.startsWith('-'));
const SHOW = filters.length ? filters : null;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge，请用 CHROME_PATH 指定可执行文件');
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/* ------------------------------------------------------------------ CDP 最小客户端 */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
        return;
      }
      if (msg.method) {
        this.events.push(msg);
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  static async attach(port) {
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* Chrome 还没起来 */ }
      if (!target) await sleep(150);
    }
    if (!target) throw new Error('Chrome 起来了但拿不到页面 target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('连不上 CDP WebSocket')), { once: true });
    });
    const page = new Page(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    return page;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`${method} 超时`)); }
      }, 20000);
    });
  }

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 1024,
    });
  }

  /** 在页面里求值，返回结构化结果（函数源码会被包一层 async） */
  async evaluate(fnOrExpr, ...args) {
    const expression = typeof fnOrExpr === 'function'
      ? `(${fnOrExpr.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`
      : fnOrExpr;
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async goto(path) {
    const url = path.startsWith('http') ? path : BASE + path;
    await this.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'", { timeout: 15000, label: '页面加载' });
  }

  /** 等应用启动完成：模板数与版式都就位 */
  async ready() {
    await this.waitFor(
      "!!document.querySelector('#statTpl')?.textContent?.includes('套模板') && !!document.querySelector('#canvas svg, #stage svg')",
      { timeout: 20000, label: '应用启动' },
    );
    await sleep(450); // 让入场动画落定，截图才稳定
  }

  async waitFor(expr, { timeout = 8000, label = expr } = {}) {
    const t0 = Date.now();
    for (;;) {
      if (await this.evaluate(expr)) return true;
      if (Date.now() - t0 > timeout) throw new Error(`等超时：${label}`);
      await sleep(80);
    }
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT_DIR, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    return file;
  }

  /** 页面里的脚本错误 */
  errors() {
    return this.events
      .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => e.params.entry.text);
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ------------------------------------------------------------------ 断言小工具 */
function reporter(scenario) {
  const rows = [];
  const check = (label, ok, detail = '') => {
    rows.push({ label, ok: !!ok, detail });
    return !!ok;
  };
  return { scenario, rows, check };
}

/* 在页面里读一个元素的关键几何 / 可见性 */
const PROBE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    width: Math.round(r.width), height: Math.round(r.height),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    classes: [...el.classList].join(' '),
    childCount: el.children.length,
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
  };
}`;

/* ------------------------------------------------------------------ 场景 */
const PLOT = '雨夜里，主角在便利店门口捡到一把会说话的旧伞，伞突然开口劝他别回家。';

const scenarios = [
  {
    name: 'board-desktop',
    title: '① 这一格的分镜（桌面 1440）',
    async run(page, shot, { check }) {
      await page.viewport(1440, 900);
      await page.goto(`/?tpl=ref-4band-2col&plot=${encodeURIComponent(PLOT)}`);
      await page.ready();
      // 规则匹配是异步的；等它把提示词写出来
      await page.waitFor("(document.querySelector('#promptState')?.textContent||'').trim() !== ''", { label: '规则匹配完成' });
      await sleep(300);

      const first = await page.evaluate((probeSrc) => {
        const probe = eval(probeSrc);
        return {
          board: probe('#slotBoard'),
          prompts: probe('#slotBoardPrompts'),
          rows: document.querySelectorAll('#slotBoard > b').length,
          pres: document.querySelectorAll('#slotBoardPrompts .bp-pre').length,
          copyEn: !!document.querySelector('#btnBoardCopyEn'),
          copyZh: !!document.querySelector('#btnBoardCopyZh'),
          sum: (document.querySelector('#secBoardSum')?.textContent || '').trim(),
          boardText: (document.querySelector('#slotBoard')?.textContent || '').replace(/\s+/g, ' ').trim(),
          idx: (document.querySelector('#slotIndex')?.textContent || '').trim(),
        };
      }, PROBE);

      check('#slotBoard 有内容', first.rows >= 4, `${first.rows} 行 / 小结「${first.sum}」`);
      check('#slotBoard 显示景别与画面', /景别/.test(first.boardText) && /画面/.test(first.boardText));
      check('中英提示词各一段', first.pres >= 2, `${first.pres} 段`);
      check('两个复制按钮都在', first.copyEn && first.copyZh);
      await shot('board-desktop');

      // 复制按钮真的能给出反馈
      await page.evaluate("document.querySelector('#btnBoardCopyEn')?.click()");
      await sleep(250);
      const toast1 = await page.evaluate("(document.querySelector('#toast')?.classList.contains('on') ? document.querySelector('#toast').textContent : '')");
      check('复制英文提示词有反馈', /已复制/.test(toast1 || ''), toast1 || '(没有 toast)');

      // 换一格：内容必须跟着换
      await page.evaluate("document.querySelector('#btnEditNext')?.click()");
      await sleep(400);
      const second = await page.evaluate((probeSrc) => {
        const probe = eval(probeSrc);
        return {
          idx: (document.querySelector('#slotIndex')?.textContent || '').trim(),
          boardText: (document.querySelector('#slotBoard')?.textContent || '').replace(/\s+/g, ' ').trim(),
          pres: document.querySelectorAll('#slotBoardPrompts .bp-pre').length,
        };
      }, PROBE);
      check('换格子后分镜信息跟着换', second.idx !== first.idx && second.boardText !== first.boardText,
        `${first.idx} → ${second.idx}`);
      check('换格子后提示词段仍在', second.pres >= 2, `${second.pres} 段`);
      await shot('board-desktop-slot2');
    },
  },

  {
    name: 'bubble-collapse',
    title: '② 气泡面板收起（桌面 1440）',
    async run(page, shot, { check }) {
      await page.viewport(1440, 900);
      await page.goto('/?tpl=ref-4band-2col');
      await page.ready();
      // 先确保是展开的（上一轮可能被记住成收起）
      const open = await page.evaluate("!document.querySelector('#bubbleDock')?.classList.contains('collapsed')");
      if (!open) await page.evaluate("document.querySelector('#bubbleDock .bub-head')?.click()");
      await sleep(700);

      const railW = await page.evaluate("Math.round(document.querySelector('#railRight').getBoundingClientRect().width)");
      const before = await page.evaluate((src) => { const probe = eval(src); return { dock: probe('#bubbleDock'), head: probe('#bubbleDock .bub-head'), grid: probe('#bubGrid') }; }, PROBE);
      check('收起前气泡面板可见', before.dock.display !== 'none' && before.dock.height > 40,
        `height=${before.dock.height}`);
      await shot('bubble-before');

      // 点标题行收起
      await page.evaluate("document.querySelector('#bubbleDock .bub-head')?.click()");
      await sleep(800);
      const after = await page.evaluate((src) => {
        const probe = eval(src);
        const dock = document.querySelector('#bubbleDock');
        return {
          dock: probe('#bubbleDock'),
          head: probe('#bubbleDock .bub-head'),
          body: probe('#bubbleDock > .card-body'),
          collapsed: dock?.classList.contains('collapsed'),
          caretExpanded: document.querySelector('#bubbleDock .caret')?.getAttribute('aria-expanded'),
        };
      }, PROBE);

      check('收起后气泡面板整体还在（不是 display:none）', after.dock && after.dock.display !== 'none', `display=${after.dock?.display}`);
      check('收起后高度没有塌成 0', after.dock.height >= 40, `height=${after.dock.height}`);
      check('收起后标题行仍然可见', after.head && after.head.display !== 'none' && after.head.height > 16,
        `head height=${after.head?.height}`);
      check('收起后内容区确实收上去了', !after.body || after.body.height === 0, `body height=${after.body?.height}`);
      check('收起状态记在 .collapsed 上', after.collapsed === true);
      check('宽度仍然撑满右栏', after.dock.width >= railW - 2, `dock=${after.dock.width} rail=${railW}`);
      await shot('bubble-collapsed');

      // 再点一次要能展开回来
      await page.evaluate("document.querySelector('#bubbleDock .bub-head')?.click()");
      await sleep(800);
      const back = await page.evaluate((src) => { const probe = eval(src); return { dock: probe('#bubbleDock'), grid: probe('#bubGrid'), collapsed: document.querySelector('#bubbleDock')?.classList.contains('collapsed') }; }, PROBE);
      check('再点一次能展开回来', back.collapsed === false && back.grid.height > 40,
        `grid height=${back.grid?.height}`);
      await shot('bubble-reopened');
    },
  },

  {
    name: 'bubble-mobile',
    title: '③ 手机编辑页的气泡模块（900 宽）',
    async run(page, shot, { check }) {
      await page.viewport(900, 1000);
      await page.goto(`/?tpl=ref-4band-2col&view=edit&plot=${encodeURIComponent(PLOT)}`);
      await page.ready();
      await sleep(500);

      const view = await page.evaluate("({ view: document.body.dataset.view, mod: document.querySelector('#railRight')?.dataset.mod, sheet: document.body.classList.contains('sheet-on') })");
      check('进到了编辑页', view.view === 'edit' && view.sheet, `data-view=${view.view}`);

      const textMod = await page.evaluate((src) => { const probe = eval(src); return probe('#bubbleDock'); }, PROBE);
      check('文字模块下气泡面板不占位（设计如此）', textMod.display === 'none', `display=${textMod?.display}`);
      await shot('mobile-text');

      // 切到「气泡」模块
      await page.evaluate("document.querySelector('#editSeg button[data-m=\\\"bubble\\\"]')?.click()");
      await sleep(700);
      const bubbleMod = await page.evaluate((src) => {
        const probe = eval(src);
        return { dock: probe('#bubbleDock'), head: probe('#bubbleDock .bub-head'), grid: probe('#bubGrid'),
                 mod: document.querySelector('#railRight')?.dataset.mod };
      }, PROBE);
      check('切到气泡模块后 data-mod=bubble', bubbleMod.mod === 'bubble', `data-mod=${bubbleMod.mod}`);
      check('气泡面板出现了', bubbleMod.dock.display !== 'none' && bubbleMod.dock.height > 40, `height=${bubbleMod.dock?.height}`);
      check('气泡格子排出来了', bubbleMod.grid.height > 40, `grid height=${bubbleMod.grid?.height}`);
      await shot('mobile-bubble');

      // 编辑页里点标题行不应该把内容收起（CSS 兜住了）
      await page.evaluate("document.querySelector('#bubbleDock .bub-head')?.click()");
      await sleep(800);
      const afterClick = await page.evaluate((src) => { const probe = eval(src); return { grid: probe('#bubGrid'), collapsed: document.querySelector('#bubbleDock')?.classList.contains('collapsed') }; }, PROBE);
      check('编辑页里点标题不会把气泡内容收没', afterClick.grid.height > 40, `grid height=${afterClick.grid?.height}`);
      await shot('mobile-bubble-after-head-click');

      // 第 4 个模块：「分镜」——景别/节拍/画面/台词/构图 + 中英提示词都在这一栏
      const segs = await page.evaluate("[...document.querySelectorAll('#editSeg button')].map((b) => b.dataset.m)");
      check('编辑页有四个模块（说什么/图片/分镜/气泡）', ['text', 'image', 'board', 'bubble'].every((m) => segs.includes(m)), segs.join(' / '));
      await page.evaluate("document.querySelector('#editSeg button[data-m=\\\"board\\\"]')?.click()");
      await sleep(600);
      const boardMod = await page.evaluate((src) => {
        const probe = eval(src);
        const sec = (k) => probe(`#slotPanel .slot-sec[data-sec="${k}"]`);
        return {
          mod: document.querySelector('#railRight')?.dataset.mod,
          board: sec('board'), text: sec('text'), image: sec('image'),
          rows: document.querySelectorAll('#slotBoard > b').length,
          prompts: document.querySelectorAll('#slotBoardPrompts .bp-pre').length,
          dock: probe('#bubbleDock'),
        };
      }, PROBE);
      check('切到分镜模块后 data-mod=board', boardMod.mod === 'board', `data-mod=${boardMod.mod}`);
      check('分镜这一段显示了', boardMod.board.display !== 'none' && boardMod.board.height > 60, `height=${boardMod.board?.height}px`);
      check('分镜这一栏带中英提示词', boardMod.rows >= 4 && boardMod.prompts >= 2, `${boardMod.rows} 行 / ${boardMod.prompts} 段提示词`);
      check('分镜模块下其余两段不占位', boardMod.text.display === 'none' && boardMod.image.display === 'none');
      check('分镜模块下气泡面板不占位', boardMod.dock.display === 'none');
      await shot('mobile-board');

      // 图片模块：分镜这一段必须让位
      await page.evaluate("document.querySelector('#editSeg button[data-m=\\\"image\\\"]')?.click()");
      await sleep(600);
      const imageMod = await page.evaluate((src) => {
        const probe = eval(src);
        return { board: probe('#slotPanel .slot-sec[data-sec="board"]'), image: probe('#slotPanel .slot-sec[data-sec="image"]') };
      }, PROBE);
      check('图片模块下分镜让位、图片出现', imageMod.board.display === 'none' && imageMod.image.height > 60,
        `board=${imageMod.board.display} / image=${imageMod.image?.height}px`);
      await shot('mobile-image');
    },
  },

  {
    name: 'section-fold',
    title: '④ 小框分段折叠（桌面 1440）',
    async run(page, shot, { check }) {
      await page.viewport(1440, 900);
      await page.goto(`/?tpl=ref-4band-2col&plot=${encodeURIComponent(PLOT)}`);
      await page.ready();
      await sleep(400);

      const secs = await page.evaluate(() => [...document.querySelectorAll('#slotPanel .slot-sec')].map((s) => s.dataset.sec));
      check('三段都在（说什么 / 分镜 / 图片）', ['text', 'board', 'image'].every((k) => secs.includes(k)), secs.join(', '));

      // 默认状态：分镜收起（查资料用，最占地方），说什么 / 图片展开
      const initState = await page.evaluate((src) => {
        const probe = eval(src);
        const one = (k) => {
          const sec = document.querySelector(`#slotPanel .slot-sec[data-sec="${k}"]`);
          return {
            collapsed: sec?.classList.contains('collapsed'),
            body: probe(`#slotPanel .slot-sec[data-sec="${k}"] .sec-body`),
            sum: (sec?.querySelector('.sec-sum')?.textContent || '').trim(),
          };
        };
        return { text: one('text'), board: one('board'), image: one('image') };
      }, PROBE);
      check('「这一格的分镜」默认收起', initState.board.collapsed === true && initState.board.body.height === 0,
        `height=${initState.board.body.height}`);
      check('收起时标题行给出小结', initState.board.sum !== '', `「${initState.board.sum}」`);
      check('说什么 / 图片默认展开', initState.text.collapsed === false && initState.image.collapsed === false);
      await shot('secs-default');

      // 点开「这一格的分镜」
      await page.evaluate("document.querySelector('#slotPanel .slot-sec[data-sec=\\\"board\\\"] .sec-head')?.click()");
      await sleep(900);
      const opened = await page.evaluate((src) => {
        const probe = eval(src);
        return { body: probe('#slotPanel .slot-sec[data-sec="board"] .sec-body'),
                 collapsed: document.querySelector('#slotPanel .slot-sec[data-sec="board"]')?.classList.contains('collapsed'),
                 expanded: document.querySelector('#slotPanel .slot-sec[data-sec="board"] .sec-head')?.getAttribute('aria-expanded'),
                 prompts: document.querySelectorAll('#slotBoardPrompts .bp-pre').length };
      }, PROBE);
      check('点开能展开（含中英提示词）', opened.collapsed === false && opened.body.height > 60 && opened.prompts >= 2,
        `height=${opened.body.height} / ${opened.prompts} 段提示词`);
      check('展开状态与 aria 一致', opened.expanded === 'true');
      await shot('secs-board-open');

      // 再收起来
      await page.evaluate("document.querySelector('#slotPanel .slot-sec[data-sec=\\\"board\\\"] .sec-head')?.click()");
      await sleep(900);
      const folded = await page.evaluate((src) => {
        const probe = eval(src);
        return { body: probe('#slotPanel .slot-sec[data-sec="board"] .sec-body'),
                 collapsed: document.querySelector('#slotPanel .slot-sec[data-sec="board"]')?.classList.contains('collapsed'),
                 expanded: document.querySelector('#slotPanel .slot-sec[data-sec="board"] .sec-head')?.getAttribute('aria-expanded') };
      }, PROBE);
      check('再点能收起，body 高度归零', folded.collapsed === true && folded.body.height === 0, `height=${folded.body.height}`);
      check('收起状态与 aria 一致（收起）', folded.expanded === 'false');
      await shot('secs-board-collapsed');
    },
  },

  {
    name: 'chars-io',
    title: '⑤ 角色卡导出 / 导入（桌面 1440）',
    async run(page, shot, { check }) {
      await page.viewport(1440, 900);
      await page.goto('/?tpl=ref-4band-2col');
      await page.ready();

      // 拦下下载：把 a[download] 的地址记下来，后面直接读回来
      await page.evaluate(`(() => {
        window.__dl = [];
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; }
          return orig.call(this);
        };
      })()`);

      // 名字先填好，再用 canvas 造一张真图，走真实的「选参考图」入口
      await page.evaluate("document.querySelector('#charName').value = '沈砚'");
      await page.evaluate("document.querySelector('#charNote').value = '黑短发、左眉疤'");
      await page.evaluate(`(async () => {
        const c = document.createElement('canvas');
        c.width = 300; c.height = 400;
        const g = c.getContext('2d');
        g.fillStyle = '#2d6cdf'; g.fillRect(0, 0, 300, 400);
        g.fillStyle = '#fff'; g.beginPath(); g.arc(150, 140, 70, 0, 7); g.fill();
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'ref.png', { type: 'image/png' }));
        const input = document.querySelector('#charFiles');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await page.waitFor("document.querySelectorAll('.char-item').length >= 1", { label: '角色卡出现' });
      await sleep(400);
      const seeded = await page.evaluate(`({
        items: document.querySelectorAll('.char-item').length,
        name: (document.querySelector('.char-item b')?.textContent || '').trim(),
        thumbs: document.querySelectorAll('.char-item img').length,
        enabled: /停用/.test(document.querySelector('.char-item .char-acts button')?.textContent || ''),
      })`);
      check('角色卡存下来了（带参考图 + 默认启用）', seeded.items === 1 && seeded.thumbs >= 1 && seeded.enabled,
        `${seeded.items} 张 / ${seeded.thumbs} 图 / 名字「${seeded.name}」`);
      await shot('chars-before-export');

      // 导出：把下载的 JSON 读回来检查结构
      await page.evaluate("document.querySelector('#btnCharExport')?.click()");
      await sleep(400);
      const exported = await page.evaluate(`(async () => {
        const dl = window.__dl[window.__dl.length - 1];
        if (!dl) return { err: '没有触发下载' };
        const text = await (await fetch(dl.href)).text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignore */ }
        return { name: dl.name, json, bytes: text.length };
      })()`);
      check('导出的是 JSON 文件', /\.json$/.test(exported.name || ''), exported.name || '(没下载)');
      check('导出包结构正确', exported.json?.kind === 'character-cards' && exported.json?.chars?.length === 1,
        `kind=${exported.json?.kind} / ${exported.json?.chars?.length} 张`);
      const img0 = exported.json?.chars?.[0]?.images?.[0] || '';
      check('参考图以 base64 内嵌', /^data:image\/\w+;base64,/.test(img0), `长度 ${img0.length} 字节`);
      check('带上了名字与外观备注', exported.json?.chars?.[0]?.name === '沈砚' && !!exported.json?.chars?.[0]?.note);

      // 原样导入：应该认出来「已经有了」，不重复堆一份
      const roundTrip = await page.evaluate(`(async () => {
        const dl = window.__dl[window.__dl.length - 1];
        const text = await (await fetch(dl.href)).text();
        const dt = new DataTransfer();
        dt.items.add(new File([text], '角色卡.json', { type: 'application/json' }));
        const input = document.querySelector('#charImportFile');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 800));
        return { items: document.querySelectorAll('.char-item').length,
                 toast: (document.querySelector('#toast')?.textContent || '').trim() };
      })()`);
      check('重复导入不会堆出一份新的', roundTrip.items === 1, `${roundTrip.items} 张 · ${roundTrip.toast}`);

      // 改个名字再导入：应该新增一张
      const fresh = await page.evaluate(`(async () => {
        const dl = window.__dl[window.__dl.length - 1];
        const text = await (await fetch(dl.href)).text();
        const json = JSON.parse(text);
        json.chars[0].name = '沈砚（女）';
        const dt = new DataTransfer();
        dt.items.add(new File([JSON.stringify(json)], '角色卡2.json', { type: 'application/json' }));
        const input = document.querySelector('#charImportFile');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 800));
        return { items: document.querySelectorAll('.char-item').length,
                 names: [...document.querySelectorAll('.char-item b')].map((b) => b.textContent.trim()),
                 toast: (document.querySelector('#toast')?.textContent || '').trim() };
      })()`);
      check('导入新角色会加进来', fresh.items === 2, `${fresh.items} 张 · ${fresh.names.join(' / ')}`);
      check('导入有明确反馈', /导入 1 张/.test(fresh.toast || ''), fresh.toast);
      await shot('chars-after-import');

      // 坏文件不能把页面搞崩、也不能动数据
      const bad = await page.evaluate(`(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['{ 这不是 json'], 'bad.json', { type: 'application/json' }));
        const input = document.querySelector('#charImportFile');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 600));
        return { items: document.querySelectorAll('.char-item').length,
                 toast: (document.querySelector('#toast')?.textContent || '').trim() };
      })()`);
      check('坏文件只提示、不改数据', bad.items === 2 && /JSON/.test(bad.toast || ''), bad.toast);
    },
  },

  {
    name: 'hotpath',
    title: '⑥ 图片拖动热路径 / 草稿往返 / 导出（手机宽度 430）',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      await page.goto('/?perf=1&tpl=ref-4band-2col');
      await page.ready();

      // 灌 3 张 2400×3000 的真图（走真实 drop 入口）
      await page.evaluate(`(async () => {
        const mk = (hue) => new Promise((res) => {
          const c = document.createElement('canvas');
          c.width = 2400; c.height = 3000;
          const g = c.getContext('2d');
          g.fillStyle = 'hsl(' + hue + ',75%,45%)'; g.fillRect(0, 0, 2400, 3000);
          g.fillStyle = '#fff'; g.beginPath(); g.arc(1200, 900, 500, 0, 7); g.fill();
          c.toBlob(res, 'image/jpeg', 0.92);
        });
        const files = [];
        for (const hue of [0, 120, 240]) files.push(new File([await mk(hue)], 'p' + hue + '.jpg', { type: 'image/jpeg' }));
        const canvas = document.querySelector('#canvas');
        const r = canvas.getBoundingClientRect();
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        canvas.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        }));
      })()`);
      await page.waitFor("document.querySelectorAll('#canvas svg image[data-slot]').length >= 3", { label: '图片落格' });
      await sleep(600);

      const dom = await page.evaluate(`({
        imgs: document.querySelectorAll('#canvas svg image[data-slot]').length,
        allBlob: [...document.querySelectorAll('#canvas svg image[data-slot]')].every((e) => (e.getAttribute('href') || '').startsWith('blob:')),
        markupKB: Math.round(document.querySelector('#canvas svg').outerHTML.length / 1024),
      })`);
      check('图片以 blob URL 进 DOM', dom.imgs === 3 && dom.allBlob, `${dom.imgs} 图`);
      check('页面上不再搬 base64', dom.markupKB < 200, `整页标记 ${dom.markupKB}KB`);
      await shot('hot-images');

      const drag = await page.evaluate(`(async () => {
        window.__pfPerf.reset();
        const pick = () => [...document.querySelectorAll('#canvas svg image[data-slot]')].map((e) => e.getAttribute('x') + ',' + e.getAttribute('width'));
        const before = pick();
        const canvas = document.querySelector('#canvas');
        const el = canvas.querySelector('svg image[data-slot]');
        const r = el.getBoundingClientRect();
        const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        const ev = (t, x, y) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
        canvas.dispatchEvent(ev('pointerdown', x0, y0));
        for (let i = 0; i < 30; i++) {
          await new Promise((res) => requestAnimationFrame(() => { canvas.dispatchEvent(ev('pointermove', x0 + i * 2, y0 + i)); res(); }));
        }
        const during = pick();
        const perf = window.__pfPerf.snapshot();
        canvas.dispatchEvent(ev('pointerup', x0, y0));
        await new Promise((res) => setTimeout(res, 400));
        return { moved: JSON.stringify(before) !== JSON.stringify(during), renders: perf.renders, patches: perf.patches, patchMs: perf.patch.p95 };
      })()`);
      check('拖动真的改了图片位置', drag.moved);
      check('拖动期间几乎不整页重绘', drag.renders <= 3,
        `render ${drag.renders} 次 · patch ${drag.patches} 次 · 单次 patch ${drag.patchMs.toFixed(2)}ms`);
      await shot('hot-images-dragged');

      // 刷新：图片存在 IndexedDB 里（Blob），取回来要能重建 href
      await page.goto('/?perf=1&tpl=ref-4band-2col');
      await page.ready();
      await page.waitFor("document.querySelectorAll('#canvas svg image[data-slot]').length >= 3", { label: '草稿里的图片回来', timeout: 12000 });
      const back = await page.evaluate(`({
        imgs: document.querySelectorAll('#canvas svg image[data-slot]').length,
        allBlob: [...document.querySelectorAll('#canvas svg image[data-slot]')].every((e) => (e.getAttribute('href') || '').startsWith('blob:')),
      })`);
      check('刷新后图片还在（Blob 草稿往返）', back.imgs >= 3 && back.allBlob, `${back.imgs} 图`);

      // 导出 PNG：blob 图必须被转成 data URL 才能进 SVG，否则导出是白页
      await page.evaluate(`(() => {
        window.__dl = [];
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; }
          return orig.call(this);
        };
        document.querySelector('#tabs button[data-tab=export]').click();
      })()`);
      await sleep(300);
      await page.evaluate("document.querySelector('#btnPng')?.click()");
      await page.waitFor('window.__dl.length > 0', { label: 'PNG 导出完成', timeout: 25000 });
      const png = await page.evaluate(`(async () => {
        const dl = window.__dl[window.__dl.length - 1];
        const blob = await (await fetch(dl.href)).blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let colored = 0, total = 0;
        for (let i = 0; i < d.length; i += 4 * 17) {
          total++;
          if (!(d[i] > 238 && d[i + 1] > 238 && d[i + 2] > 238)) colored++;
        }
        return { name: dl.name, bytes: blob.size, w: bmp.width, h: bmp.height, coloredPct: +((colored / total) * 100).toFixed(1) };
      })()`);
      check('导出的 PNG 里有图（不是白页）', png.coloredPct > 2,
        `${png.name} · ${Math.round(png.bytes / 1024)}KB · ${png.w}×${png.h} · 非白像素 ${png.coloredPct}%`);
    },
  },

  {
    name: 'bubble-drag',
    title: '⑦ 气泡拖动热路径（手机宽度 430）',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      await page.goto(`/?perf=1&tpl=ref-4band-2col&plot=${encodeURIComponent(PLOT)}`);
      await page.ready();
      await sleep(400);

      await page.evaluate("document.querySelector('#bubGrid .bub-item')?.click()");
      await page.waitFor("!!document.querySelector('#canvas svg g[data-bubble]')", { label: '气泡出现' });
      await sleep(300);

      const drag = await page.evaluate(`(async () => {
        window.__pfPerf.reset();
        const canvas = document.querySelector('#canvas');
        const live = () => canvas.querySelector('svg g[data-bubble]');
        const g = live();
        const r = g.getBoundingClientRect();
        const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        const ev = (t, x, y) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
        const before = g.dataset.x + ',' + g.dataset.y;
        canvas.dispatchEvent(ev('pointerdown', x0, y0));
        for (let i = 0; i < 24; i++) {
          await new Promise((res) => requestAnimationFrame(() => { canvas.dispatchEvent(ev('pointermove', x0 + i * 2, y0 + i)); res(); }));
        }
        // 注意：pointerdown 会整页重绘，之前抓的节点已经不在文档里了，必须重新查
        const mid = { transform: live()?.getAttribute('transform'), perf: window.__pfPerf.snapshot() };
        canvas.dispatchEvent(ev('pointerup', x0, y0));
        await new Promise((res) => setTimeout(res, 500));
        const g2 = live();
        return {
          movedDuringDrag: !!mid.transform && /translate/.test(mid.transform),
          renders: mid.perf.renders, patches: mid.perf.patches, patchMs: mid.perf.patch.p95,
          bakedX: g2?.dataset.x, bakedY: g2?.dataset.y, beforeXY: before,
          bakedNoTransform: !g2?.getAttribute('transform'),
        };
      })()`);
      check('拖动中气泡靠 translate 移动', drag.movedDuringDrag);
      check('拖动期间几乎不整页重绘', drag.renders <= 3,
        `render ${drag.renders} 次 · patch ${drag.patches} 次 · 单次 patch ${drag.patchMs.toFixed(2)}ms`);
      check('松手后位置烘进标记（transform 清掉）', drag.bakedNoTransform && drag.bakedX + ',' + drag.bakedY !== drag.beforeXY,
        `${drag.beforeXY} → ${drag.bakedX},${drag.bakedY}`);
      await shot('bubble-dragged');
    },
  },

  {
    name: 'paint-klecks',
    title: '⑧ 格子绘制：外部引擎 + 按形状裁切（手机宽度 430）',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      // p6 是 ref-4band-2col 里的斜切格（上宽下窄），bbox 右下角落在多边形外。
      // fresh=1：别恢复上一个用例的草稿，否则模板会被换掉、p6 可能不存在
      await page.goto('/?perf=1&fresh=1&tpl=ref-4band-2col&slot=p6');
      await page.ready();

      const hasHook = await page.evaluate('!!window.__pfPaint');
      check('绘制钩子在（?perf=1）', hasHook);
      if (!hasHook) return;

      // 先给画面中心那一格塞一张纯色照片：既覆盖「描线」场景，也给像素断言一个基准
      const seeded = await page.evaluate(`(async () => {
        const before = [...document.querySelectorAll('#canvas svg image[data-slot]')].map((e) => e.dataset.slot);
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 1600;
        const g = c.getContext('2d');
        g.fillStyle = '#2f6bff'; g.fillRect(0, 0, 1200, 1600);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
        const canvas = document.querySelector('#canvas');
        const r = canvas.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'base.jpg', { type: 'image/jpeg' }));
        canvas.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5,
        }));
        await new Promise((res) => setTimeout(res, 1400));
        const after = [...document.querySelectorAll('#canvas svg image[data-slot]')].map((e) => e.dataset.slot);
        // 只认「这次新落进去的那一格」，别拿别的用例留下的图当基准
        return { all: after, fresh: after.filter((s) => !before.includes(s))[0] || null };
      })()`);
      check('底图落进了一格（且是这次新填的）', !!seeded.fresh, seeded.all.join(',') || '没有');

      await page.evaluate('window.__pfPaint.close()');
      await page.evaluate("window.__pfPaint.open('p6')");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '绘制页打开', timeout: 30000 });
      await sleep(1500);

      const info = await page.evaluate('window.__pfPaint.info()');
      check('外部引擎（Klecks）挂上了', info.engine === 'klecks' && info.frame && info.sheetOpen, `engine=${info.engine}`);
      check('画布比例跟格子包围盒一致', info.hostSize && Math.abs(info.hostSize.w / info.hostSize.h - 0.453) < 0.03,
        `画布 ${info.hostSize?.w}×${info.hostSize?.h}`);
      await shot('paint-open');

      const inner = await page.evaluate(`(() => {
        const f = document.querySelector('.paint-frame');
        const w = f && f.contentWindow;
        return { klecks: !!w?.Klecks, inst: !!w?.__pfKlecks, canvas: !!f?.contentDocument?.querySelector('canvas') };
      })()`);
      check('iframe 里有 Klecks 实例和画布', inner.klecks && inner.inst && inner.canvas);

      /* 真画一笔：用 CDP 派发「可信」鼠标事件 ——
         合成 PointerEvent 进不了它的笔刷管线（试过，它有自己的指针事件栈）。
         坐标要从 iframe 里的画布 rect 换算到父页面视口。 */
      const rect = await page.evaluate(`(() => {
        const f = document.querySelector('.paint-frame');
        const fr = f.getBoundingClientRect();
        const doc = f.contentDocument;
        const want = 0.453;
        const best = [...doc.querySelectorAll('canvas')]
          .filter((c) => c.width > 30 && c.height > 30)
          .sort((a, b) => Math.abs((a.width / a.height) - want) - Math.abs((b.width / b.height) - want))[0];
        if (!best) return null;
        const r = best.getBoundingClientRect();
        return { x: fr.left + r.left, y: fr.top + r.top, w: r.width, h: r.height, cw: best.width, ch: best.height };
      })()`);
      check('找到引擎的绘画画布', !!rect, rect ? `${rect.cw}×${rect.ch}（显示 ${Math.round(rect.w)}×${Math.round(rect.h)}）` : '没找到');

      if (rect) {
        const y = rect.y + rect.h * 0.5;
        const x0 = rect.x + rect.w * 0.28;
        const x1 = rect.x + rect.w * 0.62;
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', clickCount: 1, buttons: 1 });
        for (let i = 1; i <= 16; i++) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 16, y, button: 'left', buttons: 1,
          });
          await sleep(16);
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', clickCount: 1, buttons: 0 });
        await sleep(700);
        const painted = await page.evaluate(`(async () => {
          const w = document.querySelector('.paint-frame').contentWindow;
          const blob = await w.__pfKlecksPng();
          const bmp = await createImageBitmap(blob);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext('2d');
          g.drawImage(bmp, 0, 0);
          const d = g.getImageData(0, Math.round(bmp.height * 0.5), bmp.width, 1).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 4) {
            const [r, g2, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
            if (a > 8 && r < 90 && g2 < 90 && b < 90) dark++;
          }
          return { dark, w: bmp.width };
        })()`);
        check('CDP 真输入能在引擎里画出笔迹', painted.dark > 3, `中线深色像素 ${painted.dark} 个（画布宽 ${painted.w}）`);
        await shot('paint-drawn');
      }

      // 完成 → 回填，再从最终产物验证：底图在、格子外被裁掉
      await page.evaluate('window.__pfPaint.finish()');
      await page.waitFor("document.querySelector('#paintSheet')?.hidden !== false", { label: '绘制页关闭', timeout: 20000 });
      await sleep(700);
      const px = await page.evaluate(`(async () => {
        const el = document.querySelector('#canvas svg image[data-slot="p6"]');
        if (!el) return { err: '这一格没有图' };
        const href = el.getAttribute('href') || '';
        const blob = await (await fetch(href)).blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const at = (fx, fy) => {
          const d = g.getImageData(Math.round(bmp.width * fx), Math.round(bmp.height * fy), 1, 1).data;
          return { a: d[3], rgb: [d[0], d[1], d[2]] };
        };
        // 中线整行数一下不透明像素：证明笔迹真的进了最终产物
        const row = g.getImageData(0, Math.round(bmp.height * 0.5), bmp.width, 1).data;
        let opaqueRow = 0;
        for (let i = 3; i < row.length; i += 4) if (row[i] > 8) opaqueRow++;
        return {
          blob: href.startsWith('blob:'), w: bmp.width, h: bmp.height,
          ratio: +(bmp.width / bmp.height).toFixed(3),
          opaqueRow, mid: at(0.45, 0.5), corner: at(0.975, 0.975),
        };
      })()`);
      check('结果以 blob 贴回这一格', px.blob && px.w > 100, px.err || `${px.w}×${px.h}`);
      check('画布比例=格子包围盒', Math.abs(px.ratio - 0.453) < 0.03, `ratio=${px.ratio}`);
      check('笔迹进了最终产物（中线有不透明像素）', px.opaqueRow > 3, `中线 ${px.opaqueRow} 个像素`);
      check('斜切格外的角被裁掉（右下角透明）', px.corner.a === 0, `alpha=${px.corner.a}`);
      await shot('paint-result');

      // ---- 第二段：底图必须能经引擎走一趟再回来（描线场景）----
      if (seeded.fresh) {
        await page.evaluate(`window.__pfPaint.open(${JSON.stringify(seeded.fresh)})`);
        await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '底图格绘制页打开', timeout: 30000 });
        await sleep(1600);
        await page.evaluate('window.__pfPaint.finish()');
        await page.waitFor("document.querySelector('#paintSheet')?.hidden !== false", { label: '关闭', timeout: 20000 });
        await sleep(700);
        const base = await page.evaluate(`(async () => {
          const el = document.querySelector('#canvas svg image[data-slot=' + ${JSON.stringify(seeded.fresh)} + ']');
          if (!el) return { err: '没有图' };
          const blob = await (await fetch(el.getAttribute('href'))).blob();
          const bmp = await createImageBitmap(blob);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext('2d');
          g.drawImage(bmp, 0, 0);
          const d = g.getImageData(Math.round(bmp.width * 0.5), Math.round(bmp.height * 0.5), 1, 1).data;
          return { rgb: [d[0], d[1], d[2]], a: d[3] };
        })()`);
        check('底图经引擎走一趟还能回来（中心仍是蓝色）',
          base.a > 200 && base.rgb[2] > 150 && base.rgb[0] < 120, `rgb=${base.rgb}`);
        await shot('paint-base-roundtrip');
      }
    },
  },

  {
    name: 'painter-mode',
    title: '⑨ 画师版入口（?mode=artist）：AI 收起、绘制可用',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      await page.goto('/?perf=1&fresh=1&mode=artist&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      await sleep(400);

      const st = await page.evaluate(`(() => {
        const vis = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return 'missing';
          return getComputedStyle(el).display === 'none' || el.getBoundingClientRect().height === 0 ? 'hidden' : 'visible';
        };
        return {
          mode: document.body.dataset.mode || '',
          title: document.title,
          aiCard: vis('.card.ai'),
          aiGen: vis('.ai-gen'),
          aiPrompts: vis('#btnAiPrompts'),
          paintBtn: vis('#btnPaint'),
          browse: vis('.card.browse'),
          canvas: vis('#canvas svg'),
        };
      })()`);
      check('body 进入 artist 模式 + 标题换了', st.mode === 'artist' && /画师版/.test(st.title), st.title);
      check('AI 界面全部收起', st.aiCard === 'hidden' && st.aiGen === 'hidden' && st.aiPrompts === 'hidden',
        `AI 导演=${st.aiCard} / 每格 AI=${st.aiGen} / AI 优化=${st.aiPrompts}`);
      check('画布与绘制入口照常可用', st.canvas === 'visible' && st.paintBtn === 'visible',
        `画布=${st.canvas} / 绘制=${st.paintBtn}`);
      await shot('painter-mode');

      // 真实入口：把「图片」段收起来，再用标题行那个常驻的「绘制」—— 这才是用户会走的路
      await page.evaluate(`(() => {
        const sec = document.querySelector('#slotPanel .slot-sec[data-sec="image"]');
        if (sec && !sec.classList.contains('collapsed')) sec.querySelector('.sec-head').click();
      })()`);
      await sleep(900);
      const entry = await page.evaluate(`(() => {
        const btn = document.querySelector('#btnPaintTop');
        const sec = document.querySelector('#slotPanel .slot-sec[data-sec="image"]');
        return { collapsed: !!sec?.classList.contains('collapsed'), hasBtn: !!btn?.offsetParent, txt: (btn?.textContent || '').trim() };
      })()`);
      check('图片段收起时，标题行仍有「绘制」入口', entry.collapsed && entry.hasBtn, `按钮文字「${entry.txt}」`);
      await page.evaluate("document.querySelector('#btnPaintTop').click()");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '画师版里打开绘制', timeout: 30000 });
      const info = await page.evaluate('window.__pfPaint.info()');
      check('画师版里能直接画（引擎挂上）', info.engine === 'klecks' && info.sheetOpen, `engine=${info.engine}`);
      await page.evaluate('window.__pfPaint.close()');
    },
  },
];

/* ------------------------------------------------------------------ 起浏览器 */
/** 起一个 headless Chrome 并连上它的当前页；用完记得 close() */
export async function launch({ width = 1440, height = 900 } = {}) {
  const profile = join(tmpdir(), 'pf-visual-' + Date.now());
  const port = await freePort();
  const exe = findChrome();
  const chrome = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--force-color-profile=srgb', '--disable-gpu',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const page = await Page.attach(port);
  const close = () => {
    page.close();
    try { chrome.kill(); } catch { /* ignore */ }
  };
  return { page, chrome, port, close };
}

/* ------------------------------------------------------------------ 主流程 */
async function main() {
  const picked = SHOW
    ? scenarios.filter((s) => SHOW.some((f) => s.name.includes(f) || s.title.includes(f)))
    : scenarios;

  if (!picked.length) {
    console.error('没有匹配的场景。可选：' + scenarios.map((s) => s.name).join(', '));
    process.exit(2);
  }

  let session = null;
  let fatal = null;
  const report = [];

  try {
    await mkdir(OUT_DIR, { recursive: true });
    session = await launch();
    const page = session.page;

    for (const sc of picked) {
      const r = reporter(sc);
      try {
        await sc.run(page, (name) => page.shot(name), r);
      } catch (e) {
        r.check('场景跑完没报错', false, e.message);
      }
      report.push(r);
      // 场景之间清掉 localStorage，免得上一个场景记的折叠状态影响下一个
      await page.evaluate('localStorage.clear()').catch(() => {});
    }
    const errs = page.errors().filter((t) => !/favicon|Failed to load resource/i.test(t));
    if (errs.length) {
      const r = reporter({ title: '页面有没有报错' });
      r.check('控制台没有红色错误', false, errs.slice(0, 3).join(' | '));
      report.push(r);
    }
  } catch (e) {
    fatal = e;
  } finally {
    session?.close();
  }

  let failed = 0;
  for (const r of report) {
    console.log(`\n── ${r.scenario.title} ${'─'.repeat(Math.max(0, 46 - r.scenario.title.length))}`);
    for (const row of r.rows) {
      if (!row.ok) failed++;
      console.log(`  ${row.ok ? 'PASS' : 'FAIL'}  ${row.label}${row.detail ? `  —  ${row.detail}` : ''}`);
    }
  }
  const total = report.reduce((n, r) => n + r.rows.length, 0);
  console.log(`\n${failed ? '❌' : '✅'}  ${total - failed}/${total} 项通过 · 截图在 out/shots/`);
  if (fatal) {
    console.error('\n崩了：' + fatal.message);
    process.exit(1);
  }
  process.exit(failed ? 1 : 0);
}

export { Page, PROBE, OUT_DIR, BASE };

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
