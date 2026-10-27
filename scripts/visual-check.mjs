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
    // 用语言无关的 body[data-ready]（界面文案会随语言变，不能再靠中文串判就绪）
    await this.waitFor(
      "(document.body.dataset.ready === '1' || !!document.querySelector('#statTpl')?.textContent?.includes('套模板')) && !!document.querySelector('#canvas svg, #stage svg')",
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
      await page.waitFor("document.querySelectorAll('#canvas svg image[data-slot]').length >= 3", { label: '草稿里的图片回来', timeout: 25000 });
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

  {
    name: 'paint-save-export',
    title: '⑩ 绘制：草稿保存 + 单独导出 + 图可再编辑',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      await page.goto('/?perf=1&fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();

      // 拦下载：把 a[download] 的 blob 地址记下来，后面读回真实字节
      await page.evaluate(`(() => {
        window.__dl = [];
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; }
          return orig.call(this);
        };
      })()`);

      // 塞一张图进中心那格 → 走「图片段 → 导出这一格的图」
      const seeded = await page.evaluate(`(async () => {
        const before = [...document.querySelectorAll('#canvas svg image[data-slot]')].map((e) => e.dataset.slot);
        const c = document.createElement('canvas');
        c.width = 900; c.height = 1200;
        const g = c.getContext('2d');
        g.fillStyle = '#2f6bff'; g.fillRect(0, 0, 900, 1200);
        g.fillStyle = '#fff'; g.beginPath(); g.arc(450, 500, 220, 0, 7); g.fill();
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
        return { fresh: after.filter((s) => !before.includes(s))[0] || null };
      })()`);
      check('图落进一格', !!seeded.fresh, seeded.fresh || '没有');

      // ① 图片段「导出这一格的图」
      await page.evaluate("document.querySelector('#btnExportSlot')?.click()");
      await sleep(700);
      const dl1 = await page.evaluate(`(async () => {
        const d = window.__dl[window.__dl.length - 1];
        if (!d) return { err: '没有触发下载' };
        const b = await (await fetch(d.href)).blob();
        return { name: d.name, bytes: b.size, type: b.type };
      })()`);
      check('「导出这一格的图」给出了文件', !dl1.err && dl1.bytes > 1000,
        dl1.err ? dl1.err : `${dl1.name} · ${Math.round(dl1.bytes / 1024)}KB · ${dl1.type}`);

      // ② 进画布 → 绘制页「导出」
      await page.evaluate("document.querySelector('#btnPaintTop').click()");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '绘制页打开', timeout: 30000 });
      await sleep(1500);
      const before = await page.evaluate('window.__dl.length');
      await page.evaluate("document.querySelector('#paintExport').click()");
      await page.waitFor(`window.__dl.length > ${before}`, { label: '绘制页导出', timeout: 20000 });
      const dl2 = await page.evaluate(`(async () => {
        const d = window.__dl[window.__dl.length - 1];
        const b = await (await fetch(d.href)).blob();
        const bmp = await createImageBitmap(b);
        return { name: d.name, bytes: b.size, w: bmp.width, h: bmp.height };
      })()`);
      check('绘制页「导出」按格子形状给了 PNG', /-绘制\.png$/.test(dl2.name) && dl2.bytes > 1000,
        `${dl2.name} · ${dl2.w}×${dl2.h}`);
      await shot('paint-export');

      // ③ 完成 → 草稿保存（刷新后还在，且能再次进画布编辑）
      await page.evaluate('window.__pfPaint.finish()');
      await page.waitFor("document.querySelector('#paintSheet')?.hidden !== false", { label: '关闭', timeout: 20000 });
      // 等草稿真正落盘（用应用暴露的 __pfSaveBusy，别用固定 sleep：慢机器上会抖）
      await page.waitFor("window.__pfSaveBusy !== true", { label: '等草稿落盘', timeout: 30000 });
      await sleep(300);
      await page.goto('/?perf=1&tpl=ref-4band-2col');   // 注意：不带 fresh=1，要恢复草稿
      await page.ready();
      await page.waitFor("document.querySelectorAll('#canvas svg image[data-slot]').length >= 1", { label: '草稿里的图回来', timeout: 30000 });
      const persisted = await page.evaluate(`(async () => {
        const el = document.querySelector('#canvas svg image[data-slot="${seeded.fresh}"]');
        if (!el) return { err: '这一格没回来' };
        const b = await (await fetch(el.getAttribute('href'))).blob();
        const bmp = await createImageBitmap(b);
        return { bytes: b.size, w: bmp.width, h: bmp.height };
      })()`);
      check('画完的草稿刷新后还在（IndexedDB 保存）', !persisted.err && persisted.bytes > 1000,
        persisted.err || `${persisted.w}×${persisted.h} · ${Math.round(persisted.bytes / 1024)}KB`);

      // ④ 保存下来的图能再次进画布编辑（AI 图 / 照片 / 画完的图都走同一条路）
      await page.evaluate("window.__pfPaint.open(document.querySelector('#canvas svg image[data-slot]').dataset.slot)");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '再次编辑', timeout: 30000 });
      await sleep(1200);
      const reedit = await page.evaluate(`(async () => {
        const f = document.querySelector('.paint-frame');
        const w = f.contentWindow;
        const layers = w.__pfKlecks?.embed?.klApp?.klCanvas?.getLayers?.()?.length
          ?? w.__pfKlecks?.embed?.klApp?.klCanvas?.layers?.length ?? null;
        return { layers, engine: window.__pfPaint.info().engine };
      })()`);
      check('保存的图能作为底稿再次进画布', reedit.engine === 'klecks' && (reedit.layers === null || reedit.layers >= 1),
        `图层数 ${reedit.layers}`);
      await page.evaluate('window.__pfPaint.close()');
    },
  },

  {
    name: 'panel-manager',
    title: '⑪ 面板管理：显示/隐藏/排序 + AI 总开关（两个版本各自记忆）',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      const state = `(() => {
        const panels = [...document.querySelectorAll('.rail.left [data-panel]')]
          .map((el) => ({ id: el.dataset.panel, hidden: !!el.hidden }));
        return {
          panels,
          ai: document.body.dataset.ai || '',
          aiCard: (() => { const el = document.querySelector('[data-panel="ai"]'); return el ? !el.hidden : null; })(),
          perSlotAi: (() => { const el = document.querySelector('.ai-gen'); return el ? getComputedStyle(el).display !== 'none' : null; })(),
          sheetOpen: !document.querySelector('#panelSheet')?.classList.contains('hidden'),
        };
      })()`;
      const openSheet = `(() => { document.querySelector('#btnPanels').click(); })()`;

      // ---- AI 版：默认全显示、AI 打开；能隐藏并记住 ----
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      await page.evaluate("localStorage.removeItem('pf.layout.v2')");
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      const d1 = await page.evaluate(state);
      check('AI 版默认：五块面板全显示 + AI 打开',
        d1.panels.every((p) => !p.hidden) && d1.ai === 'on' && d1.perSlotAi === true,
        `ai=${d1.ai} / 每格AI=${d1.perSlotAi}`);

      await page.evaluate(openSheet);
      await sleep(250);
      const sheet = await page.evaluate(state);
      check('「面板管理」能打开，列出 5 块', sheet.sheetOpen && (await page.evaluate("document.querySelectorAll('#panelList .panel-row').length")) === 5);
      await shot('panels-sheet');

      await page.evaluate(`(() => {
        const row = [...document.querySelectorAll('#panelList .panel-row')].find((r) => r.dataset.id === 'chars');
        row.querySelector('[data-act="toggle"]').click();
      })()`);
      await sleep(250);
      const hidden = await page.evaluate(state);
      check('隐藏「角色参考图」后它就不见了', hidden.panels.find((p) => p.id === 'chars').hidden === true);

      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      const afterReload = await page.evaluate(state);
      check('刷新后仍然记得（隐藏状态持久化）', afterReload.panels.find((p) => p.id === 'chars').hidden === true);

      await page.evaluate(openSheet);
      await sleep(200);
      await page.evaluate("document.querySelector('#btnPanelReset').click()");
      await sleep(250);
      const reset = await page.evaluate(state);
      check('「恢复默认」把它们还原', reset.panels.every((p) => !p.hidden));

      // ---- 画师版：AI 默认收起；用户想用可以自己加回来 ----
      await page.goto('/?fresh=1&mode=artist&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      const d2 = await page.evaluate(state);
      check('画师版默认：AI 面板收起、每格 AI 也收起', d2.aiCard === false && d2.ai === 'off' && d2.perSlotAi === false,
        `AI面板=${d2.aiCard} / ai=${d2.ai} / 每格AI=${d2.perSlotAi}`);

      await page.evaluate(openSheet);
      await sleep(200);
      await page.evaluate("document.querySelector('#chkAi').click()");
      await sleep(250);
      const aiOn = await page.evaluate(state);
      check('用户打开「启用 AI 功能」后，每格 AI 立刻回来', aiOn.ai === 'on' && aiOn.perSlotAi === true, `ai=${aiOn.ai}`);

      await page.evaluate(`(() => {
        const row = [...document.querySelectorAll('#panelList .panel-row')].find((r) => r.dataset.id === 'ai');
        row.querySelector('[data-act="toggle"]').click();
      })()`);
      await sleep(250);
      const aiPanel = await page.evaluate(state);
      check('也能把 AI 面板自己加回左栏', aiPanel.aiCard === true);

      // 画师版的布局和 AI 版是两套，互不影响
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      const backMain = await page.evaluate(state);
      check('两套布局互不干扰（回到 AI 版仍是 AI 开）', backMain.ai === 'on');
      await shot('panels-artist');
    },
  },

  {
    name: 'library-facets',
    title: '⑫ 模板库标签筛选 + 剧情卡两个选择（规则 / AI）',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      await page.goto('/?fresh=1&tpl=ref-4band-2col');
      await page.ready();

      // 剧情卡：规则 + AI 两个选择要并排出现（AI 开着时）
      const both = await page.evaluate(`({
        rule: !!document.querySelector('#btnMatch')?.offsetParent,
        ai: !!document.querySelector('#btnMatchAi')?.offsetParent,
        aiSwitch: document.body.dataset.ai,
      })`);
      check('剧情卡里两个选择都在（规则 + 让 AI 排戏）', both.rule && both.ai && both.aiSwitch === 'on',
        `ai=${both.aiSwitch}`);

      // 展开模板库
      await page.evaluate(`(() => {
        const card = document.querySelector('.card.browse');
        if (card?.classList.contains('collapsed')) card.querySelector('.card-head')?.click();
      })()`);
      await sleep(700);
      const bar = await page.evaluate(`({
        rows: [...document.querySelectorAll('#facetBar .frow .flabel')].map((x) => x.textContent),
        chips: document.querySelectorAll('#facetBar .fchip').length,
        cardTags: document.querySelectorAll('.tpl .ttag').length,
      })`);
      check('四行筛选（格数/题材/画幅/标签）都在', bar.rows.length === 4 && bar.chips > 20,
        `${bar.rows.join('/')} · ${bar.chips} 个 chip`);
      check('每张模板卡带可点标签', bar.cardTags > 50, `${bar.cardTags} 个标签`);
      await shot('facets-bar');

      // 点「4格」
      await page.evaluate(`(() => {
        const c = [...document.querySelectorAll('#facetBar .fchip')].find((x) => x.textContent.startsWith('4格'));
        c.click();
      })()`);
      await sleep(500);
      const four = await page.evaluate(`({
        count: (document.querySelector('#listCount')?.textContent || '').trim(),
        allFour: [...document.querySelectorAll('.tpl .mt span:first-child')].every((s) => s.textContent === '4格'),
        n: document.querySelectorAll('.tpl').length,
        clear: !!document.querySelector('#facetClear'),
      })`);
      check('点「4格」只剩四格模板', four.allFour && four.n === 24 && /24/.test(four.count), `${four.count} / ${four.n} 张`);
      check('有「清除筛选」', four.clear);

      // 点卡片上的标签（题材）也能筛选
      await page.evaluate(`(() => {
        const tag = [...document.querySelectorAll('.tpl .ttag')].find((x) => x.dataset.facet === 'intent');
        tag.click();
      })()`);
      await sleep(500);
      const byTag = await page.evaluate(`({
        count: (document.querySelector('#listCount')?.textContent || '').trim(),
        on: !!document.querySelector('#facetBar .fchip.on'),
      })`);
      check('点卡片标签能筛选（且过滤条高亮）', byTag.on && byTag.count !== four.count, `${four.count} → ${byTag.count}`);

      // 清除 + 用搜索框搜「战斗」（中文戏路名要能命中）
      await page.evaluate("document.querySelector('#facetClear')?.click()");
      await sleep(400);
      await page.evaluate(`(() => {
        const s = document.querySelector('#search');
        s.value = '战斗';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(600);
      const searched = await page.evaluate("(document.querySelector('#listCount')?.textContent || '').trim()");
      check('搜索框能搜中文戏路（战斗）', /^[1-9]\d* 套/.test(searched) && searched !== '138 套', searched);
      await shot('facets-search');
    },
  },

  {
    name: 'ui-skin',
    title: '⑬ 可选皮肤：iOS 26 液态玻璃（默认外观不受影响）',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      const tok = `(n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()`;

      // 默认：经典皮肤，没有 data-ui
      await page.goto('/?fresh=1&tpl=ref-4band-2col');
      await page.evaluate("localStorage.removeItem('pf.ui.v1')");
      await page.goto('/?fresh=1&tpl=ref-4band-2col');
      await page.ready();
      const classic = await page.evaluate(`({
        ui: document.documentElement.dataset.ui || '',
        rxl: getComputedStyle(document.documentElement).getPropertyValue('--r-xl').trim(),
        btnR: getComputedStyle(document.querySelector('.btn')).borderRadius,
      })`);
      check('默认是经典外观（没有 data-ui）', classic.ui === '' && classic.rxl === '20px',
        `--r-xl=${classic.rxl} / 按钮圆角=${classic.btnR}`);

      // 通过外观面板切到液态玻璃
      await page.evaluate(`(() => {
        const b = [...document.querySelectorAll('#uiSeg button')].find((x) => x.dataset.ui === 'ios26');
        b.click();
      })()`);
      await sleep(700);
      const glass = await page.evaluate(`({
        ui: document.documentElement.dataset.ui || '',
        label: document.querySelector('#uiName').textContent,
        rxl: getComputedStyle(document.documentElement).getPropertyValue('--r-xl').trim(),
        blur: getComputedStyle(document.documentElement).getPropertyValue('--blur').trim(),
        btnR: getComputedStyle(document.querySelector('.btn')).borderRadius,
        segR: getComputedStyle(document.querySelector('.seg')).borderRadius,
        bodyGrad: getComputedStyle(document.body).backgroundImage.slice(0, 24),
        saved: localStorage.getItem('pf.ui.v1'),
      })`);
      check('切到液态玻璃：data-ui + 令牌换了', glass.ui === 'ios26' && glass.rxl === '28px' && /blur\(32px\)/.test(glass.blur),
        `--r-xl ${classic.rxl} → ${glass.rxl}`);
      check('控件胶囊化', glass.btnR === '999px' && glass.segR === '999px', `按钮 ${glass.btnR} / 分段 ${glass.segR}`);
      check('背景有环境色渐变（玻璃才透得出来）', glass.bodyGrad.includes('radial-gradient'), glass.bodyGrad);
      check('记住了', glass.saved === 'ios26');
      await page.evaluate(`(() => {
        const b = [...document.querySelectorAll('#modeSeg button')].find((x) => x.dataset.mode === 'light');
        b.click();
      })()`);
      await sleep(900);
      await shot('skin-ios26-light');

      // 刷新后仍是液态玻璃；再切回经典要能干净恢复
      await page.goto('/?fresh=1&tpl=ref-4band-2col');
      await page.ready();
      const persisted = await page.evaluate("document.documentElement.dataset.ui || ''");
      check('刷新后皮肤记忆生效', persisted === 'ios26', persisted || '(无)');

      await page.evaluate(`(() => {
        const b = [...document.querySelectorAll('#uiSeg button')].find((x) => x.dataset.ui === 'classic');
        b.click();
      })()`);
      await sleep(600);
      const back = await page.evaluate(`({
        ui: document.documentElement.dataset.ui || '',
        rxl: getComputedStyle(document.documentElement).getPropertyValue('--r-xl').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      })`);
      check('切回经典能干净恢复', back.ui === '' && back.rxl === '20px', `--r-xl=${back.rxl}`);

      // ?ui=ios26 可直接分享预览链接
      await page.goto('/?fresh=1&tpl=ref-4band-2col&ui=ios26');
      await page.ready();
      const viaUrl = await page.evaluate("document.documentElement.dataset.ui || ''");
      check('?ui=ios26 链接可直接预览', viaUrl === 'ios26');
    },
  },

  {
    name: 'i18n',
    title: '⑭ 语言切换：English / Bahasa Indonesia（术语表也翻）',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.evaluate("localStorage.removeItem('pf.lang.v1')");
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();

      const sample = `(() => {
        const t = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\\s+/g, ' ').trim();
        return {
          lang: document.documentElement.lang,
          btn: t('#btnLang'),
          title: document.title,
          match: t('#btnMatch'),
          tab: t('#tabs button'),
          name: t('#langName'),
          count: t('#listCount'),
          chips: [...document.querySelectorAll('#facetBar .fchip')].slice(0, 3).map((x) => x.textContent.replace(/\\d+/g, '').trim()),
          cardMeta: t('.tpl .mt'),
        };
      })()`;

      const zh = await page.evaluate(sample);
      check('默认中文 + 语言按钮显示「中文」', zh.lang === 'zh-CN' && zh.btn === '中文', `${zh.lang} / ${zh.btn}`);

      // English
      await page.evaluate(`document.querySelector('#langSeg button[data-lang="en"]').click()`);
      await sleep(1100);
      const en = await page.evaluate(sample);
      check('English：按钮 / 标题 / 主行动都翻了',
        en.btn === 'English' && /Match by rules/.test(en.match) && /storyboard/i.test(en.title),
        `${en.btn} · ${en.match}`);
      check('English：术语表也翻了（格数 / 戏路）',
        /panel/i.test(en.cardMeta) && en.chips.some((c) => /panel|Dialogue/i.test(c)),
        `卡片「${en.cardMeta}」· chip「${en.chips.join('/')}」`);
      await shot('i18n-en');

      // 印尼语
      await page.evaluate(`document.querySelector('#langSeg button[data-lang="id"]').click()`);
      await sleep(1100);
      const id = await page.evaluate(sample);
      check('Bahasa Indonesia：按钮 / 主行动翻了',
        id.btn === 'Bahasa Indonesia' && /Cocokkan/.test(id.match), `${id.btn} · ${id.match}`);
      check('Bahasa Indonesia：术语表也翻了',
        /panel/i.test(id.cardMeta) && id.chips.some((c) => /panel|Dialog/i.test(c)),
        `卡片「${id.cardMeta}」· chip「${id.chips.join('/')}」`);
      await shot('i18n-id');

      // 记忆 + 链接参数 + 切回中文干净恢复
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      const persisted = await page.evaluate("localStorage.getItem('pf.lang.v1')");
      check('语言记住了', persisted === 'id', String(persisted));

      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1&lang=en');
      await page.ready();
      const viaUrl = await page.evaluate("document.documentElement.lang");
      check('?lang=en 链接可直接分享', viaUrl === 'en', viaUrl);

      await page.evaluate(`document.querySelector('#langSeg button[data-lang="zh"]').click()`);
      await sleep(1000);
      const back = await page.evaluate(sample);
      check('切回中文能干净恢复', back.lang === 'zh-CN' && /按规则匹配/.test(back.match) && back.btn === '中文',
        `${back.lang} · ${back.match}`);
    },
  },

  {
    name: 'page-size',
    title: '⑮ 页面画幅 / 导出尺寸（几何重排，不是只改导出）',
    async run(page, shot, { check }) {
      await page.viewport(1200, 900);
      await page.goto('/?fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      // 打开导出面板
      await page.evaluate(`(() => {
        const t = [...document.querySelectorAll('#tabs button')].find((b) => /导出|Export/.test(b.textContent));
        t?.click();
      })()`);
      await sleep(400);

      const state = `(() => {
        const g = window.__pfSize();
        const vb = (document.querySelector('#canvas svg')?.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
        const kv = (document.querySelector('#pageSizeKv')?.textContent || '').replace(/\\s+/g, ' ').trim();
        // 每个格子的 bbox 都要落在页面里（重排不能把格子推出去）
        const inside = g.slots.every((s) => s.x >= -1 && s.y >= -1
          && s.x + s.w <= g.w + 1 && s.y + s.h <= g.h + 1);
        return { w: g.w, h: g.h, mode: g.mode, custom: g.custom, vb: [vb[2], vb[3]],
          kv, slots: g.slots.length, inside };
      })()`;

      const a4 = await page.evaluate(state);
      check('模板原样：A4 1000×1414', Math.abs(a4.w - 1000) < 2 && Math.abs(a4.h - 1414) < 2, `${a4.w}×${a4.h}`);

      // 换成 9:16
      await page.evaluate(`(() => {
        const s = document.querySelector('#pageRatio');
        s.value = 'strip';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await sleep(900);
      const strip = await page.evaluate(state);
      check('改成 9:16：页面真的变高', strip.h > a4.h && Math.abs(strip.w - 1000) < 2, `${strip.w}×${strip.h}`);
      check('格子全部落在页面内（重排不越界）', strip.inside && strip.slots === a4.slots, `${strip.slots} 格`);
      check('导出尺寸跟着画幅走', /1600 × 2845|1600 × 2844/.test(strip.kv), strip.kv.slice(0, 80));

      // 自定义方形 + 等比留白
      await page.evaluate(`(() => {
        const s = document.querySelector('#pageRatio');
        s.value = 'custom';
        s.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#pageW').value = '1200';
        document.querySelector('#pageH').value = '1200';
        document.querySelector('#chkFitPage').checked = true;
        document.querySelector('#btnApplySize').click();
      })()`);
      await sleep(900);
      const square = await page.evaluate(state);
      check('自定义 1200×1200 + 等比留白：格子仍在页面内', square.w === 1200 && square.h === 1200 && square.inside,
        `${square.w}×${square.h}`);
      check('留白模式写进了状态', /等比留白/.test(square.kv), square.kv.slice(0, 90));
      await shot('page-size-square');

      // 反复改不叠误差：回到 A4 预设应与原模板一致
      await page.evaluate(`(() => {
        const s = document.querySelector('#pageRatio');
        s.value = 'a4';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await sleep(900);
      const backA4 = await page.evaluate(state);
      check('再次切 A4：尺寸回到 1:1.41（推导不叠误差）',
        Math.abs(backA4.w / backA4.h - 1 / Math.SQRT2) < 0.01, `${backA4.w}×${backA4.h}`);

      // 恢复模板画幅
      await page.evaluate("document.querySelector('#btnResetSize').click()");
      await sleep(800);
      const reset = await page.evaluate(state);
      check('「恢复模板画幅」回到 1000×1414',
        Math.abs(reset.w - 1000) < 2 && Math.abs(reset.h - 1414) < 2, `${reset.w}×${reset.h}`);

      // 画幅会被记住（改一次 → 落盘 → 刷新还在）
      await page.evaluate(`(() => {
        const s = document.querySelector('#pageRatio');
        s.value = 'strip';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await sleep(500);
      await page.waitFor("window.__pfSaveBusy !== true", { label: '等落盘', timeout: 30000 });
      await page.goto('/?tpl=ref-4band-2col');   // 不带 fresh=1，走草稿恢复
      await page.ready();
      const restored = await page.evaluate(state);
      check('改过的画幅刷新后还在', restored.h > 1700 && Math.abs(restored.w - 1000) < 2, `${restored.w}×${restored.h}`);
    },
  },

  {
    name: 'script-tab',
    title: '⑯ 「分镜表」标签可达 + AI 切原文入口（AI 关掉时收起）',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const probe = `(() => {
        const tab = [...document.querySelectorAll('#tabs button')].find((b) => b.dataset.tab === 'script');
        const body = document.querySelector('#tabScript');
        const vis = (sel) => { const el = document.querySelector(sel); return !!(el && el.offsetParent); };
        return {
          hasTab: !!tab, tabText: (tab?.textContent || '').trim(),
          bodyHidden: body ? body.classList.contains('hidden') : true,
          inlineNone: body ? body.style.display === 'none' : true,
          split: vis('#btnAiSplit'), prompts: vis('#btnAiPrompts'),
          rows: document.querySelectorAll('#scriptList > *').length,
        };
      })()`;

      check('桌面上有「分镜表」标签（以前根本点不到）', (await page.evaluate(probe)).hasTab);
      await page.evaluate(`(() => {
        [...document.querySelectorAll('#tabs button')].find((b) => b.dataset.tab === 'script').click();
      })()`);
      await sleep(600);
      const opened = await page.evaluate(probe);
      check('点开后面板真的显示（不再被 style="display:none" 卡死）',
        opened.bodyHidden === false && opened.inlineNone === false);
      check('「AI 切原文」和「AI 优化提示词」都在', opened.split && opened.prompts,
        `切原文=${opened.split} 优化=${opened.prompts}`);
      check('分镜表有内容（逐格行）', opened.rows > 0, `${opened.rows} 行`);
      await shot('script-tab-open');

      // 画师版：AI 关掉，这两个按钮应当收起，但分镜表本身还能看
      await page.goto('/?fresh=1&mode=artist&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      await page.evaluate(`(() => {
        [...document.querySelectorAll('#tabs button')].find((b) => b.dataset.tab === 'script').click();
      })()`);
      await sleep(600);
      const artist = await page.evaluate(probe);
      check('画师版：AI 切原文随 AI 开关收起', artist.split === false && artist.prompts === false,
        `切原文=${artist.split} 优化=${artist.prompts}`);
      check('画师版：分镜表仍可查看', artist.bodyHidden === false && artist.rows > 0, `${artist.rows} 行`);
    },
  },

  {
    name: 'paint-mobile',
    title: '⑰ 手机上的绘制页：画布占满屏宽 + 工具列可达',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      await page.goto('/?perf=1&fresh=1&tpl=ref-4band-2col&slot=p1');
      await page.ready();
      await page.evaluate("document.querySelector('#btnPaintTop').click()");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '绘制页打开', timeout: 30000 });
      await sleep(3200);

      const info = await page.evaluate(`(() => {
        const f = document.querySelector('.paint-frame');
        const d = f.contentDocument, w = f.contentWindow;
        const app = w.__pfKlecks?.embed?.klApp;
        const c = d.querySelector('canvas');
        const r = app?.mobileUi?.controlsEl?.getBoundingClientRect();
        return {
          viewport: d.documentElement.clientWidth,
          canvasW: c?.clientWidth || 0,
          canvasH: c?.clientHeight || 0,
          mobileVisible: !!app?.mobileUi?.isVisible,
          drawerOpen: !!app?.mobileUi?.toolspaceIsOpen,
          columnW: r ? Math.round(r.width) : 0,
          fit: Number(app?.easel?.targetTransform?.scale || 0),
        };
      })()`);
      check('画布占满手机屏宽（不再只剩 159px）', info.canvasW >= info.viewport - 4,
        `${info.canvasW}/${info.viewport} px`);
      check('缩放比例够用（> 0.2，之前只有 0.10）', info.fit > 0.2, info.fit.toFixed(3));
      check('Klecks 手机界面可见 + 工具栏抽屉默认收起',
        info.mobileVisible && info.drawerOpen === false, `工具列 ${info.columnW}px`);
      await shot('paint-mobile');

      // 手机工具列里要有可点的工具（笔刷入口在列里，完整工具栏由 Klecks 自己的折叠钮拉出）
      const tools = await page.evaluate(`(() => {
        const d = document.querySelector('.paint-frame').contentDocument;
        const col = document.querySelector('.paint-frame').contentWindow.__pfKlecks.embed.klApp.mobileUi.controlsEl;
        const btns = col ? [...col.querySelectorAll('button,[role=button],svg')].length : 0;
        const hit = col ? col.getBoundingClientRect() : null;
        return { btns, w: hit ? Math.round(hit.width) : 0, h: hit ? Math.round(hit.height) : 0 };
      })()`);
      check('手机工具列里有可点的工具（不是空白列）', tools.btns >= 4 && tools.w > 20,
        `${tools.btns} 个控件 · ${tools.w}×${tools.h}px`);
      await page.evaluate('window.__pfPaint.close()');
    },
  },

  {
    name: 'paint-paper',
    title: '⑲ 白底 / 透明由用户选（导出像素是真的白 / 真的透明）',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      const px = `(async () => {
        const w = document.querySelector('.paint-frame').contentWindow;
        const bmp = await w.createImageBitmap(await w.__pfKlecksPng());
        const cv = w.document.createElement('canvas');
        cv.width = bmp.width; cv.height = bmp.height;
        const cx = cv.getContext('2d');
        cx.drawImage(bmp, 0, 0);
        const p = cx.getImageData(2, 2, 1, 1).data;
        return [p[0], p[1], p[2], p[3]].join(',');
      })()`;
      const label = `(document.querySelector('#paintPaper')?.textContent || '').trim()`;

      await page.goto('/?perf=1&fresh=1&tpl=jp-triangle-impact&slot=p2');
      await page.evaluate("localStorage.removeItem('pf.paint.paper')");
      await page.goto('/?perf=1&fresh=1&tpl=jp-triangle-impact&slot=p2');
      await page.ready();
      await page.evaluate("document.querySelector('#btnPaintTop').click()");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '绘制页打开', timeout: 30000 });
      await sleep(3200);

      const white = await page.evaluate(px);
      check('默认白底：导出的像素是不透明白', white === '255,255,255,255', white);
      check('按钮显示「白底」', (await page.evaluate(label)) === '白底');
      await shot('paint-paper-white');

      await page.evaluate("document.querySelector('#paintPaper').click()");
      await sleep(1200);
      const alpha = await page.evaluate(px);
      check('切「透明」后导出带透明通道', alpha === '0,0,0,0', alpha);
      check('按钮显示「透明」', (await page.evaluate(label)) === '透明');

      await page.evaluate("document.querySelector('#paintPaper').click()");
      await sleep(1200);
      check('能切回白底', (await page.evaluate(px)) === '255,255,255,255');

      // 选透明 → 关掉重开：偏好要被记住
      await page.evaluate("document.querySelector('#paintPaper').click()");
      await sleep(800);
      await page.evaluate("document.querySelector('#paintCancel').click()");
      await sleep(600);
      await page.evaluate("document.querySelector('#btnPaintTop').click()");
      await page.waitFor("window.__pfPaint.info().engine !== 'none'", { label: '再打开', timeout: 30000 });
      await sleep(3200);
      const reopen = await page.evaluate(px);
      const reopenLabel = await page.evaluate(label);
      check('重开后仍按上次的选择（透明）', reopen === '0,0,0,0' && reopenLabel === '透明',
        `${reopen} · 按钮=${reopenLabel}`);
      await page.evaluate('window.__pfPaint.close()');
    },
  },

  {
    name: 'shell-profile',
    title: '⑳ 原生壳性能档 + 分享出口（Android WebView 预算）',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      await page.goto('/?perf=1&fresh=1&shell=android&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const st = await page.evaluate(`(() => {
        const cs = (sel, p) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[p] : ''; };
        return {
          shell: document.body.dataset.shell || '',
          blur: cs('.topbar', 'backdropFilter') || cs('.topbar', 'webkitBackdropFilter') || 'none',
          anim: cs('.card', 'animationDuration'),
          willChange: cs('#canvas', 'willChange'),
          shareBtn: !!document.querySelector('#paintShare'),
          hook: typeof window.__pfPullSharedImage,
        };
      })()`);
      check('壳标识生效（body[data-shell=android]）', st.shell === 'android', st.shell || '(无)');
      check('壳里关掉实时模糊（WebView 上最贵的一层）', st.blur === 'none', st.blur || 'none');
      check('壳里动画压到 180ms', /^0\.18s$/.test(st.anim), st.anim);
      check('画布热区提层（will-change: transform）', /transform/.test(st.willChange), st.willChange || 'auto');
      check('绘制页顶栏有「分享」（交给别的 App）', st.shareBtn === true);
      check('接收分享的钩子已装上', st.hook === 'function', st.hook);

      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      const web = await page.evaluate(`(() => ({
        shell: document.body.dataset.shell || '',
        blur: (getComputedStyle(document.querySelector('.topbar')).backdropFilter || 'none'),
      }))()`);
      check('浏览器模式不受影响（仍用毛玻璃）',
        web.shell === '' && /blur\(22px\)/.test(web.blur), web.blur);
      await shot('shell-profile');
    },
  },

  {
    name: 'skins',
    title: '㉑ 两套皮肤（灵动可爱 / 高级简约）+ 版本号 + 偏好记忆',
    async run(page, shot, { check }) {
      await page.viewport(1280, 900);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      await page.evaluate("localStorage.removeItem('pf.skin')");
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const probe = `(() => {
        const root = document.documentElement;
        const g = (n) => getComputedStyle(root).getPropertyValue(n).trim();
        const card = document.querySelector('.card');
        return {
          skin: root.dataset.skin || 'classic',
          tint: g('--tint'),
          rxl: g('--r-xl'),
          cardRadius: card ? getComputedStyle(card).borderRadius : '',
          btnRadius: (() => { const b = document.querySelector('.btn'); return b ? getComputedStyle(b).borderRadius : ''; })(),
          version: window.__pfVersion ? window.__pfVersion() : '',
          versionText: (document.querySelector('#appVersion') || {}).textContent || '',
        };
      })()`;

      const base = await page.evaluate(probe);
      check('版本号来自 VERSION 文件', /^\d+\.\d+\.\d+$/.test(base.version), base.version);
      check('外观面板底部显示版本', /v\d+\.\d+\.\d+/.test(base.versionText), base.versionText);

      // 灵动可爱
      await page.evaluate("document.querySelector('#skinSeg [data-skin=\"cute\"]').click()");
      await sleep(700);
      const cute = await page.evaluate(probe);
      check('切到灵动可爱（html[data-skin=cute]）', cute.skin === 'cute', cute.skin);
      check('灵动可爱换了自己的主色（莓红，不是经典蓝）',
        cute.tint !== base.tint && /oklch|rgb/.test(cute.tint), cute.tint);
      check('灵动可爱圆角更胖（26px）', cute.rxl === '26px' && cute.cardRadius === '26px', `${cute.rxl}/${cute.cardRadius}`);
      check('灵动可爱按钮是药丸形', /999|1e\+0|1000/.test(cute.btnRadius) || parseFloat(cute.btnRadius) > 100, cute.btnRadius);
      await shot('skin-cute');

      // 高级简约
      await page.evaluate("document.querySelector('#skinSeg [data-skin=\"minimal\"]').click()");
      await sleep(700);
      const min = await page.evaluate(probe);
      check('切到高级简约（html[data-skin=minimal]）', min.skin === 'minimal', min.skin);
      check('高级简约用的是低饱和靛蓝', min.tint !== cute.tint && /oklch|rgb/.test(min.tint), min.tint);
      check('高级简约圆角收敛（16px）', min.rxl === '16px' && min.cardRadius === '16px', `${min.rxl}/${min.cardRadius}`);
      await shot('skin-minimal');

      // 偏好记忆
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      const remembered = await page.evaluate(probe);
      check('刷新后记住上次的皮肤', remembered.skin === 'minimal', remembered.skin);

      // 回到经典
      await page.evaluate("document.querySelector('#skinSeg [data-skin=\"classic\"]').click()");
      await sleep(600);
      const back = await page.evaluate(probe);
      check('能切回经典', back.skin === 'classic' && back.tint !== min.tint, `${back.skin} · ${back.tint}`);
    },
  },

  {
    name: 'pin-cell',
    title: '㉒ 生图锁定格子：生成期间切格子不串格',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      // 桩掉 imageGenerate：慢 900ms 返回一张 1x1 PNG，模拟真实生图耗时
      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.confirm = () => true;
        const api = window.__pfApi();
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        let askedFor = null;
        api.imageGenerate = async (body) => {
          askedFor = body.slotId;
          await wait(900);
          return { ok: true, b64: png, provider: 'fake', size: '1024x1024', model: 'fake', refsUsed: 0, refsIgnored: 0 };
        };
        window.__pfSel('p1');
        await wait(150);
        document.querySelector('#btnAiImage').click();
        await wait(120);
        const running = Object.keys(window.__pfJobs());
        const btn = document.querySelector('#btnAiImage');
        const labelWhileRunning = btn.textContent.trim();
        const disabledWhileRunning = btn.disabled;
        // 生成期间切到第二格
        window.__pfSel('p2');
        await wait(120);
        const labelAfterSwitch = document.querySelector('#btnAiImage').textContent.trim();
        const enabledAfterSwitch = !document.querySelector('#btnAiImage').disabled;
        await wait(1400);
        return {
          askedFor, running, labelWhileRunning, disabledWhileRunning,
          labelAfterSwitch, enabledAfterSwitch,
          images: Object.keys(window.__pfImages()),
          jobsLeft: Object.keys(window.__pfJobs()).length,
          toast: (document.querySelector('#toast') || {}).textContent || '',
        };
      })()`);

      check('点下去就把格子钉住（请求里是 p1）', out.askedFor === 'p1', String(out.askedFor));
      check('生成中有该格的作业标记', out.running.includes('p1'), out.running.join(','));
      check('生成中按钮被禁用且写明「这一格正在生图」',
        out.disabledWhileRunning === true && /正在生图/.test(out.labelWhileRunning), out.labelWhileRunning);
      check('生成期间切到别的格子，按钮恢复可用（互不影响）',
        out.enabledAfterSwitch === true && /生这一格/.test(out.labelAfterSwitch), out.labelAfterSwitch);
      check('结果仍然落在最初那一格，没有串到新选中的格子',
        out.images.includes('p1') && !out.images.includes('p2'), out.images.join(','));
      check('完成提示点名是哪一格', /第\s*\d+\s*格/.test(out.toast) || /已生成/.test(out.toast), out.toast);
      check('作业标记已清理', out.jobsLeft === 0, String(out.jobsLeft));
      await shot('pin-cell');
    },
  },

  {
    name: 'auto-full',
    title: '㉖ 右下角 vs 全自动的语义区别 + 角色确认关卡',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.confirm = () => true;
        const api = window.__pfApi();
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const calls = { optimize: 0, images: 0 };
        api.aiSplit = async () => { throw new Error('桩：走规则切分'); };
        api.prompts = async () => { calls.optimize++; return { ok: true, applied: 6, total: 6 }; };
        api.imageGenerate = async () => { calls.images++; return { ok: true, b64: png, provider: 'fake' }; };
        const res = {};
        res.fabLabels = [...document.querySelectorAll('#fabStack .fab')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());

        // 右下角「一键生成该页」的确认文案：必须强调「用现有提示词、不做 AI 优化」
        window.__pfAutoSet('story');
        await wait(200);
        document.querySelector('#fabGenPage').click();
        await wait(300);
        res.fabBody = document.querySelector('#dangerBody').textContent.replace(/\s+/g, ' ');
        document.querySelector('#dangerSheet [data-cancel]').click();
        await wait(150);

        // 全自动：警示 → 角色确认 → 开始
        window.__pfAutoSet('full');
        await wait(250);
        document.querySelector('#autoText').value = '雨夜，他在屋顶拔刀。敌人从背后偷袭。';
        document.querySelector('#autoHero').value = '黑短发、左眉疤';
        document.querySelector('#btnAutoEstimate').click();
        await wait(120);
        document.querySelector('#btnAutoStart').click();
        await wait(300);
        res.autoWarn = document.querySelector('#dangerBody').textContent.replace(/\s+/g, ' ');
        document.querySelector('#dangerAck').checked = true;
        document.querySelector('#dangerAck').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#dangerGo').click();
        await wait(400);
        const cc = document.querySelector('#charConfirm');
        res.cc = {
          shown: !!cc,
          sum: cc?.querySelector('.cc-sum')?.textContent || '',
          sheet: cc?.querySelector('.cc-sheet')?.textContent || '',
          btns: [...(cc?.querySelectorAll('.row2 button') || [])].map((b) => b.textContent.trim()),
        };
        cc?.querySelector('#ccGoFix')?.click();
        await wait(300);
        res.afterFix = { ccGone: !document.querySelector('#charConfirm'), images: calls.images };

        // 再跑一次并确认角色
        document.querySelector('#btnAutoStart').click();
        await wait(300);
        document.querySelector('#dangerAck').checked = true;
        document.querySelector('#dangerAck').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#dangerGo').click();
        await wait(400);
        document.querySelector('#charConfirm #ccGo')?.click();
        await wait(5200);
        res.run = {
          optimize: calls.optimize,
          images: calls.images,
          log: [...document.querySelectorAll('#autoLog .al-row')].map((r) => r.textContent),
        };
        return res;
      })()`);

      check('右下角按钮叫「一键生成该页 / 一键生成全部分镜」',
        /一键生成\s*该页/.test(out.fabLabels[0]) && /一键生成\s*全部分镜/.test(out.fabLabels[1]),
        out.fabLabels.join(' / '));
      check('该页确认里写明「用每格现在的提示词，不做 AI 优化」',
        /现有|现在的提示词|原样/.test(out.fabBody) && /不会/.test(out.fabBody) && /AI 优化/.test(out.fabBody),
        out.fabBody.slice(0, 80));
      check('全自动警示里写明会先用 AI 优化提示词',
        /AI 优化/.test(out.autoWarn), out.autoWarn.slice(0, 80));
      check('警示之后弹「角色确认」（含页数/分镜数/设定/两个按钮）',
        out.cc.shown && /页/.test(out.cc.sum) && /角色设定/.test(out.cc.sheet) && out.cc.btns.length === 2,
        `${out.cc.sum} · ${out.cc.btns.join(' / ')}`);
      check('点「先去补角色」不会生成任何图',
        out.afterFix.ccGone && out.afterFix.images === 0, String(out.afterFix.images));
      check('确认角色后：先优化提示词，再出图',
        out.run.optimize >= 1 && out.run.images >= 1, `优化 ${out.run.optimize} 次 / 出图 ${out.run.images} 张`);
      check('日志里能看到「提示词已用 AI 优化过」排在出图之前',
        (() => {
          const iOpt = out.run.log.findIndex((x) => /AI 优化过/.test(x));
          const iImg = out.run.log.findIndex((x) => /逐格生成图片/.test(x));
          return iOpt >= 0 && iImg > iOpt;
        })(), out.run.log.slice(0, 10).join(' | '));
      await shot('auto-full');
    },
  },

  {
    name: 'slot-zoom',
    title: '㉘ 该格缩放条贴在格子右侧 + 拖放毛玻璃提示写清格式',
    async run(page, shot, { check }) {
      await page.viewport(1280, 900);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const mk = (name, type = 'image/png') => {
          const bin = atob(png); const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return new File([arr], name, { type });
        };
        const res = {};
        const box = document.querySelector('#slotZoom');
        res.hiddenBeforeImage = box.classList.contains('hidden');

        // 拖一张图进来
        const svg0 = document.querySelector('#canvas svg');
        const r0 = svg0.getBoundingClientRect();
        const dt = new DataTransfer(); dt.items.add(mk('pic.png'));
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt,
          clientX: r0.left + r0.width * 0.45, clientY: r0.top + r0.height * 0.25 }));
        await wait(650);

        const svg = document.querySelector('#canvas svg');
        const r = svg.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        // 用「格子真实屏幕矩形」当参照（图片是 cover 的，会溢出格子，拿 <image> 的 rect 会算错）
        const slotRect = window.__pfSlotRect ? window.__pfSlotRect() : null;
        res.show = {
          visible: !box.classList.contains('hidden'),
          pct: document.querySelector('#slotZoomVal')?.textContent || '',
          gapRight: slotRect ? Math.round(br.left - slotRect.right) : null,
          vCenterDiff: slotRect ? Math.round(Math.abs((br.top + br.height / 2) - (slotRect.top + slotRect.height / 2))) : null,
          hasSlotRect: !!slotRect,
        };

        // + 号放大
        box.querySelector('[data-step="1"]').click();
        await wait(200);
        res.plus = document.querySelector('#slotZoomVal')?.textContent || '';
        // 滑杆到 200%
        const range = document.querySelector('#slotZoomRange');
        range.value = '200';
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(200);
        res.slider = document.querySelector('#slotZoomVal')?.textContent || '';
        // 点百分比复位
        document.querySelector('#slotZoomVal').click();
        await wait(200);
        res.reset = document.querySelector('#slotZoomVal')?.textContent || '';

        // 拖放毛玻璃提示：图片
        const dt2 = new DataTransfer(); dt2.items.add(mk('x.png'));
        document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        await wait(220);
        const hint = document.querySelector('#dropHint');
        res.imgHint = {
          shown: hint && !hint.classList.contains('hidden'),
          title: document.querySelector('#dhTitle')?.textContent || '',
          formats: document.querySelector('#dhFormats')?.textContent || '',
          blur: (getComputedStyle(hint).backdropFilter || getComputedStyle(hint).webkitBackdropFilter || 'none'),
        };

        // 文档提示
        window.__pfAutoSet('story');
        await wait(220);
        const ta = document.querySelector('#autoText');
        const dt3 = new DataTransfer();
        dt3.items.add(new File(['原文'], 'a.md', { type: 'text/markdown' }));
        ta.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt3 }));
        await wait(200);
        res.docHint = {
          title: document.querySelector('#dhTitle')?.textContent || '',
          formats: document.querySelector('#dhFormats')?.textContent || '',
        };
        document.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
        window.__pfAutoSet('off');
        return res;
      })()`);

      check('没有图时缩放条不出现', out.hiddenBeforeImage === true);
      check('有图后缩放条贴在「这一格」正右侧（距格子右边界约 10px）',
        out.show.visible && out.show.hasSlotRect && out.show.gapRight >= 6 && out.show.gapRight <= 14,
        `gap=${out.show.gapRight}px`);
      check('缩放条与这一格垂直居中', Math.abs(out.show.vCenterDiff) <= 2, `Δ=${out.show.vCenterDiff}px`);
      check('缩放条显示百分比', /^\d+%$/.test(out.show.pct), out.show.pct);
      check('点「+」放大并同步百分比', out.plus !== out.show.pct, `${out.show.pct} → ${out.plus}`);
      check('拖滑杆到 200% 生效', out.slider === '200%', out.slider);
      check('点百分比可复位到 100%', out.reset === '100%', out.reset);
      check('拖图片时出现毛玻璃提示并写明格式',
        out.imgHint.shown && /图片/.test(out.imgHint.title) && /PNG/.test(out.imgHint.formats), out.imgHint.formats);
      check('提示面板真的是毛玻璃（backdrop-filter 生效）',
        /blur/.test(out.imgHint.blur), out.imgHint.blur);
      check('拖文档时提示换成原文格式（TXT/MD…）',
        /原文/.test(out.docHint.title) && /TXT/.test(out.docHint.formats), `${out.docHint.title} · ${out.docHint.formats}`);
      await shot('slot-zoom');
    },
  },

  {
    name: 'long-press',
    title: '㉗ 手机长按某一格：震动 + 直接进这一格的编辑页',
    async run(page, shot, { check }) {
      await page.viewport(430, 900);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        let vib = 0;
        navigator.vibrate = (ms) => { vib++; return true; };
        const svg = document.querySelector('#canvas svg');
        const r = svg.getBoundingClientRect();
        const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
        const ev = (type, fx, fy, pointerType = 'touch') => svg.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 1, pointerType, isPrimary: true, ...at(fx, fy),
        }));
        const res = { startView: document.body.dataset.view || '' };

        // ① 长按 620ms 不动
        ev('pointerdown', 0.5, 0.25);
        await wait(620);
        res.long = {
          view: document.body.dataset.view,
          vib,
          pulse: document.body.classList.contains('pf-lp'),
          toast: document.querySelector('#toast')?.textContent || '',
          selected: !!document.querySelector('#slotRole')?.textContent.trim(),
        };
        ev('pointerup', 0.5, 0.25);
        await wait(180);

        // ② 短按不触发
        const v0 = vib;
        ev('pointerdown', 0.3, 0.7);
        await wait(80);
        ev('pointerup', 0.3, 0.7);
        await wait(260);
        res.tap = { vib: vib - v0 };

        // ③ 长按中途移动 → 取消
        const v1 = vib;
        ev('pointerdown', 0.5, 0.5);
        await wait(120);
        ev('pointermove', 0.62, 0.56);
        await wait(520);
        res.drag = { vib: vib - v1 };
        ev('pointerup', 0.62, 0.56);

        // ④ 鼠标长按不触发（桌面走右键）
        const v2 = vib;
        ev('pointerdown', 0.5, 0.25, 'mouse');
        await wait(620);
        res.mouse = { vib: vib - v2 };
        ev('pointerup', 0.5, 0.25, 'mouse');
        return res;
      })()`);

      check('长按某一格会触发震动', out.long.vib === 1, String(out.long.vib));
      check('长按后直接进入编辑视图', out.long.view === 'edit', out.long.view || '(空)');
      check('长按有视觉反馈（画布脉冲 + 提示）',
        out.long.pulse === true && /长按进入/.test(out.long.toast), out.long.toast);
      check('短按不会震动（避免误触）', out.tap.vib === 0, String(out.tap.vib));
      check('长按过程中移动会取消（拖图不被误判成长按）', out.drag.vib === 0, String(out.drag.vib));
      check('鼠标长按不触发（桌面用右键菜单）', out.mouse.vib === 0, String(out.mouse.vib));
      await shot('long-press');
    },
  },

  {
    name: 'inbox',
    title: '㉕ 拖放/粘贴图片 + 气泡拖入 + 大图预览 + 右键菜单',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const mkFile = (name) => {
          const bin = atob(png); const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return new File([arr], name, { type: 'image/png' });
        };
        const images = () => window.__pfImages();
        const svg = document.querySelector('#canvas svg');
        const r = svg.getBoundingClientRect();
        const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
        const res = {};

        // ① 拖图片进画布
        const dt = new DataTransfer(); dt.items.add(mkFile('drop.png'));
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at(0.5, 0.25) }));
        await wait(500);
        res.dropped = Object.values(images()).map((x) => x.name);

        // ② Ctrl+V 粘贴图片
        const dt2 = new DataTransfer(); dt2.items.add(mkFile('paste.png'));
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt2 }));
        await wait(500);
        res.pasted = Object.values(images()).map((x) => x.name);

        // ③ 气泡可拖 + 拖进画面
        const bubBtn = document.querySelector('#bubGrid .bub-item[data-id]');
        res.bubDraggable = bubBtn ? bubBtn.draggable : false;
        const dt3 = new DataTransfer();
        dt3.setData('text/pf-bubble', bubBtn ? bubBtn.dataset.id : 'talk-oval');
        // 注意：每次 renderStage 都会换掉 #canvas svg，必须重新查询，否则派发到已脱离文档的旧节点
        const svg2 = document.querySelector('#canvas svg');
        svg2.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt3, ...at(0.45, 0.45) }));
        await wait(400);
        res.bubbles = document.querySelectorAll('#canvas g[data-bubble]').length;

        // ④ 右键某一格（有图）→ 我们的菜单 + 放大生效
        document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at(0.5, 0.25) }));
        await wait(200);
        const menu = document.querySelector('#ctxMenu');
        res.ctx = {
          shown: menu && !menu.classList.contains('hidden'),
          title: menu?.querySelector('.ctx-title')?.textContent || '',
          count: menu?.querySelectorAll('.ctx-item').length || 0,
          isOurs: !!menu?.querySelector('.ctx-item'),
        };
        const beforeZoom = Object.values(images())[0]?.zoom;
        menu?.querySelector('.ctx-item')?.click();   // 第一项 = 放大
        await wait(200);
        res.zoom = { before: beforeZoom, after: Object.values(images())[0]?.zoom };

        // ⑤ 右键输入框 → 文本菜单（复制/粘贴/全选）
        const line = document.querySelector('#slotLine');
        line.focus();
        line.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
        await wait(200);
        res.textCtx = {
          title: menu?.querySelector('.ctx-title')?.textContent || '',
          items: [...(menu?.querySelectorAll('.ctx-item') || [])].map((b) => b.textContent.trim()),
        };
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await wait(100);

        // ⑥ 拖文本文件进「全文」框（全自动面板）
        window.__pfAutoSet('story');
        await wait(250);
        const ta = document.querySelector('#autoText');
        const mkText = (name, type, body) => new File([body], name, { type });
        const dropFile = (el, file) => {
          const d = new DataTransfer();
          d.items.add(file);
          el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d }));
        };
        dropFile(ta, mkText('chapter1.md', 'text/markdown', '雨夜的屋顶上他缓缓拔出刀。敌人从背后偷袭，他反手斩断刀锋。'.repeat(12)));
        await wait(600);
        res.textDrop = { len: ta.value.length, stat: document.querySelector('#autoStat')?.textContent || '' };
        dropFile(ta, mkText('script.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x'));
        await wait(300);
        res.docReject = document.querySelector('#toast')?.textContent || '';
        window.__pfAutoSet('off');
        await wait(150);

        // ⑥ 大图预览
        window.__pfLightbox(0);
        await wait(250);
        const lb = document.querySelector('#lightbox');
        res.lightbox = {
          shown: !!lb,
          count: lb?.querySelector('#lbCount')?.textContent || '',
          acts: [...(lb?.querySelectorAll('.lb-acts button') || [])].length,
        };
        lb?.querySelector('[data-close]')?.click();
        await wait(120);
        res.lightboxClosed = !document.querySelector('#lightbox');
        return res;
      })()`);

      check('拖图片进画布 → 自动填入指针下那一格',
        out.dropped.includes('drop.png'), out.dropped.join(','));
      check('Ctrl+V 粘贴图片 → 同样入库', out.pasted.includes('paste.png'), out.pasted.join(','));
      check('气泡库的项可拖拽', out.bubDraggable === true);
      check('把气泡拖到画面上 → 生成气泡', out.bubbles >= 1, String(out.bubbles));
      check('右键某一格弹出我们自己的菜单（不是浏览器菜单）',
        out.ctx.shown && out.ctx.isOurs && out.ctx.title.includes('格'), `${out.ctx.title} · ${out.ctx.count} 项`);
      check('菜单里有常用的对齐/缩放项（≥12 项）', out.ctx.count >= 12, String(out.ctx.count));
      check('点「放大」真的改变了缩放',
        Number(out.zoom.after) > Number(out.zoom.before || 1), `${out.zoom.before} → ${out.zoom.after}`);
      check('右键输入框是文本菜单（复制/粘贴/全选）',
        out.textCtx.title === '文本' && out.textCtx.items.some((x) => x.includes('全选')), out.textCtx.items.join(' / '));
      check('候选/单图可以点开大图预览',
        out.lightbox.shown && /1\s*\/|第 1/.test(out.lightbox.count), out.lightbox.count);
      check('大图能关掉', out.lightboxClosed === true);
      check('原文档可以直接拖进「全文」框（不用点上传按钮）',
        out.textDrop.len > 100, String(out.textDrop.len) + ' 字');
      check('拖进来后自动估算页数', /页/.test(out.textDrop.stat), out.textDrop.stat);
      check('docx 这类读不了的格式会明确说清楚',
        /读不了|另存/.test(out.docReject), out.docReject);
      await shot('inbox');
    },
  },

  {
    name: 'auto-mode',
    title: '㉔ 全自动模式：开关 / 全文面板 / 危险确认 / 批量队列',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.confirm = () => true;
        const api = window.__pfApi();
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        let imgCalls = 0;
        api.imageGenerate = async () => { imgCalls++; await wait(60); return { ok: true, b64: png, provider: 'fake', size: '1024x1024', model: 'fake', refsUsed: 0, refsIgnored: 0 }; };

        const res = {};
        res.seg = [...document.querySelectorAll('#autoSeg button')].map((b) => b.dataset.auto);
        res.defaultMode = window.__pfAuto().mode;
        res.fabHiddenWhenOff = document.querySelector('#fabStack').classList.contains('hidden');

        window.__pfAutoSet('story');
        await wait(150);
        res.story = {
          panelVisible: !document.querySelector('#autoCard').classList.contains('hidden')
            && Math.round(document.querySelector('#autoPanel').getBoundingClientRect().height) > 100,
          plotHidden: document.querySelector('#plot').closest('.card').classList.contains('hidden'),
          topOverflow: (() => { const t = document.querySelector('.topbar'); return t.scrollWidth > t.clientWidth + 2; })(),
          fabVisible: !document.querySelector('#fabStack').classList.contains('hidden'),
          label: document.querySelector('#autoModeName').textContent,
        };

        // 估算
        document.querySelector('#autoText').value = '雨夜屋顶拔刀。敌人偷袭，反手斩断刀锋。两人在积水里僵持。'.repeat(20);
        document.querySelector('#btnAutoEstimate').click();
        await wait(150);
        res.estimate = document.querySelector('#autoStat').textContent;

        // 危险弹窗：未勾选禁用
        document.querySelector('#fabGenPage').click();
        await wait(200);
        res.danger = {
          shown: !document.querySelector('#dangerSheet').classList.contains('hidden'),
          goDisabled: document.querySelector('#dangerGo').disabled,
          hasAck: !!document.querySelector('#dangerAck'),
        };
        const ack = document.querySelector('#dangerAck');
        ack.checked = true;
        ack.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(80);
        res.dangerGoEnabled = !document.querySelector('#dangerGo').disabled;

        // 真跑：点继续 → 队列顺序生成
        document.querySelector('#dangerGo').click();
        await wait(2600);
        res.imagesAfter = Object.keys(window.__pfImages()).length;
        res.imgCalls = imgCalls;
        res.logLines = document.querySelectorAll('#autoLog .al-row').length;
        res.logHasDone = [...document.querySelectorAll('#autoLog .al-row')].some((r) => /完成/.test(r.textContent));

        window.__pfAutoSet('off');
        await wait(120);
        res.offRestored = document.querySelector('#fabStack').classList.contains('hidden');
        return res;
      })()`);

      check('顶栏开关三态（关闭 / 分镜 / 全自动）', out.seg.join(',') === 'off,story,full', out.seg.join(','));
      check('默认关闭，悬浮按钮不出现', out.defaultMode === 'off' && out.fabHiddenWhenOff === true);
      check('分镜模式：全自动面板出现、原剧情框收起',
        out.story.panelVisible && out.story.plotHidden, JSON.stringify(out.story));
      check('顶栏的开关不再溢出', out.story.topOverflow === false, String(out.story.topOverflow));
      check('悬浮按钮在分镜模式下出现', out.story.fabVisible === true);
      check('估算页数给出页数与格数', /页/.test(out.estimate) && /格/.test(out.estimate), out.estimate);
      check('危险弹窗出现，且未勾选时「继续」禁用', out.danger.shown && out.danger.goDisabled && out.danger.hasAck);
      check('勾选「我已知晓」后「继续」才可用', out.dangerGoEnabled === true);
      check('点继续后按队列逐格生成图片', out.imagesAfter >= 1 && out.imgCalls >= 1, `图 ${out.imagesAfter} 张 / 请求 ${out.imgCalls} 次`);
      check('前台日志记录了每一步', out.logLines >= 2 && out.logHasDone === true, `${out.logLines} 行`);
      check('切回关闭后悬浮按钮收起', out.offRestored === true);
      await shot('auto-mode');
    },
  },

  {
    name: 'ai-lines',
    title: '㉓ AI 写台词（单格 / 整页 / 自动挂气泡）',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();

      const out = await page.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const api = window.__pfApi();
        const calls = [];
        api.aiLines = async (body) => {
          calls.push({ ids: body.ids, avoid: body.avoid || null });
          const lines = {};
          for (const id of body.ids) lines[id] = { text: '别追了，屋顶到头了。', kind: '台词', why: '收束情绪' };
          return { ok: true, lines, dropped: 0, missing: [] };
        };
        window.__pfSel('p1');
        await wait(120);
        const btns = ['#btnAiLine', '#btnAiLineReroll', '#btnAiLinesPage'].map((x) => {
          const b = document.querySelector(x); return b ? b.textContent.trim() : null;
        });
        document.querySelector('#btnAiLine').click();
        await wait(400);
        const one = {
          textarea: (document.querySelector('#slotLine') || {}).value || '',
          why: (document.querySelector('#suggestText') || {}).textContent || '',
          fromAi: ((document.querySelector('#suggestFrom') || {}).textContent || '').includes('AI'),
        };
        // 换一句：应把刚才那句作为 avoid 发出去
        document.querySelector('#btnAiLineReroll').click();
        await wait(400);
        const rerollAvoid = calls.length > 1 ? calls[1].avoid : null;
        // 整页：只写空着的格子
        document.querySelector('#btnAiLinesPage').click();
        await wait(500);
        const pageCall = calls[calls.length - 1];
        return {
          btns, one, rerollAvoid,
          pageIdsCount: pageCall ? pageCall.ids.length : 0,
          bubbles: Object.keys(window.__pfState ? window.__pfState().bubbles : {}).length,
        };
      })()`);

      check('三个按钮都在（写这一格 / 换一句 / 写整页）',
        out.btns[0] === 'AI 写这一格' && out.btns[1] === '换一句' && out.btns[2] === 'AI 写整页', out.btns.join(' / '));
      check('单格：句子写进了输入框', out.one.textarea.includes('屋顶到头了'), out.one.textarea);
      check('单格：显示「为什么这样写」，来源标成 AI 思路',
        out.one.why.includes('收束') && out.one.fromAi === true, out.one.why);
      check('换一句：把上一句作为 avoid 发出去（不许重复）',
        !!out.rerollAvoid && Object.values(out.rerollAvoid).some((v) => String(v).includes('屋顶到头了')));
      check('整页：只写还没有句子的格子', out.pageIdsCount > 0 && out.pageIdsCount <= 6, String(out.pageIdsCount));
      await shot('ai-lines');
    },
  },

  {
    name: 'prompt-source',
    title: '⑱ 提示词三源共存（规则 / AI / 自己写）+ 开头词保留 + 手机分镜表不重叠',
    async run(page, shot, { check }) {
      await page.viewport(1400, 980);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      await page.evaluate(`(() => {
        document.querySelector('#plot').value = '雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋，两人在积水里僵持。';
        document.querySelector('#btnMatch').click();
      })()`);
      await sleep(4500);

      const st = `(() => {
        const ta = document.querySelector('#slotPrompt');
        const sent = (document.querySelector('#slotPromptSent')?.textContent || '');
        return {
          state: document.querySelector('#promptState')?.textContent || '',
          value: (ta?.value || '').slice(0, 80),
          readOnly: !!ta?.readOnly,
          prefixOn: !!document.querySelector('#chkPrefix')?.checked,
          sentStart: sent.slice(0, 40),
          sent,
        };
      })()`;

      const rule = await page.evaluate(st);
      check('默认就是「规则切分」，且提示词里带着原文',
        rule.state === '规则切分' && /雨夜的屋顶上|缓缓拔出刀|背后偷袭/.test(rule.sent),
        rule.sent.slice(0, 70));
      check('规则模式下文本框只读（避免误改自动结果）', rule.readOnly === true);

      // 切「自己写」
      await page.evaluate(`document.querySelector('#promptSrc [data-src="mine"]').click()`);
      await sleep(500);
      await page.evaluate(`(() => {
        const ta = document.querySelector('#slotPrompt');
        ta.value = 'he stands on the wet rooftop, rain, blade drawn';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(700);
      const mine = await page.evaluate(st);
      check('切到「自己写」后可以编辑', mine.readOnly === false && mine.state === '自己写');
      check('自己写的内容 + 形状开头词一起进最终提示词（开头词没被丢掉）',
        mine.sent.includes('he stands on the wet rooftop') && mine.sent.indexOf('he stands') > 30,
        mine.sentStart);

      // 关掉开头词
      await page.evaluate(`(() => {
        const c = document.querySelector('#chkPrefix');
        c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await sleep(600);
      const noPrefix = await page.evaluate(st);
      check('关掉「带开头词」后提示词从自己的话开始',
        noPrefix.sent.startsWith('he stands on the wet rooftop'), noPrefix.sentStart);

      // 切回规则：规则版仍然在（三份共存，不是覆盖）
      await page.evaluate(`document.querySelector('#promptSrc [data-src="rule"]').click()`);
      await sleep(600);
      const back = await page.evaluate(st);
      check('切回「规则切分」规则版还在（三源共存）',
        /雨夜的屋顶上|缓缓拔出刀|背后偷袭/.test(back.sent), back.sent.slice(0, 60));
      await shot('prompt-source');

      // 手机上的分镜表：卡片不重叠、底栏不压住最后一张卡
      await page.viewport(430, 900);
      await page.goto('/?perf=1&fresh=1&tpl=jp-shonen-3tier&slot=p1');
      await page.ready();
      await page.evaluate(`(() => {
        document.body.dataset.view = 'sheet';
        [...document.querySelectorAll('#tabs button')].find((b) => b.dataset.tab === 'script').click();
      })()`);
      await sleep(900);
      const mob = await page.evaluate(`(() => {
        const cards = [...document.querySelectorAll('#scriptList .sc-card')];
        const r = cards.map((c) => c.getBoundingClientRect());
        let overlap = 0;
        for (let i = 0; i < r.length - 1; i++) if (r[i].bottom > r[i + 1].top + 1) overlap++;
        const pr = cards[0]?.querySelector('.pr');
        const cs = pr ? getComputedStyle(pr) : null;
        const last = cards.at(-1)?.getBoundingClientRect();
        const bar = document.querySelector('#tabbar')?.getBoundingClientRect();
        return {
          n: cards.length, overlap,
          clamp: cs ? (cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp')) : '',
          overflow: cs ? cs.overflow : '',
          lastBottom: last ? Math.round(last.bottom) : 0,
          barTop: bar ? Math.round(bar.top) : 0,
          listPad: getComputedStyle(document.querySelector('#scriptList')).paddingBottom,
        };
      })()`);
      check('手机分镜表：卡片之间没有重叠', mob.overlap === 0, `${mob.n} 张卡`);
      // 注：Chrome 128+ 用 -webkit-line-clamp 时计算值报 flow-root，所以判 clamp + overflow，不判 display
      check('提示词框按行截断（不再在字中间切断）',
        /^[1-9]\d*$/.test(String(mob.clamp)) && mob.overflow === 'hidden',
        `clamp=${mob.clamp} overflow=${mob.overflow}`);
      check('列表给底栏留了空间（最后一张卡不被压住）',
        parseFloat(mob.listPad) > 40, `padding-bottom=${mob.listPad}`);
      await shot('script-mobile-sheet');
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
