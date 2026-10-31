/**
 * app.js — PanelForge 分镜坊 前端
 * 零框架；渲染内核与后端共用同一份 /lib/svg.mjs，保证「所见即导出」。
 */
import { estimateLayout, splitTextIntoPages, buildAutoSteps, imageQueueForPage, imageQueueAll, estimateCostHint } from './lib/auto.mjs';
import { $, $$, PERF, perf, perfPush, perfStats, perfNow, perfDone, withTimeout, blobToDataURL, clamp, escapeHtml, debounce, sysReduceMQ, motionOK, stagger, replay , withTransition } from './util.mjs';
import { state, installHistoryDeps, HIST_MAX, snapshot, restore, commit, undo, redo, resetHistory } from './state.mjs';
import { imageAsset, rehydrateImages, exportImageMap, urlForBlob } from './assets.mjs';
import { autoPromptOf, promptParts, effectivePrompt, buildImagePrompt, setPromptEdit, installPromptDeps } from './prompt.mjs';
import { setView, applyView, initViews, setEditMod, syncEditHead, syncEditZoom, clearEditZoom, stepSlot, enterEdit, exitEdit, installViewDeps } from './mobile.mjs';
import { installRails } from './rails.mjs';
import { renderTemplateSVG, imageAttrs } from './lib/svg.mjs';
import { createCellPainter, localPoly } from './paint.mjs';
import { createKlecksHost } from './paint-host.mjs';
import { installI18n, setLang as setI18nLang, getLang, stats as i18nStats } from './i18n.mjs';
import { pointInPoly } from './lib/geometry.mjs';
import { BUBBLES, BUBBLE_IDS, recommendBubbles, makeBubble, bubbleThumb, pickBubbleForText } from './lib/bubbles.mjs';

/**
 * 双模式 API：
 *  - 常规：走本机服务（node server.mjs），有 AI 导演
 *  - 静态：GitHub Pages 等纯静态托管，规则引擎在浏览器里跑（window.PF_STATIC）
 */
let api = null;
async function makeApi() {
  if (window.PF_STATIC) {
    const mod = await import('./api-static.js');
    return mod.createStaticApi();
  }
  const getJSON = (p) => fetch(p).then((r) => r.json());
  const postJSON = (p, body) => fetch(p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  return {
    meta: () => getJSON('/api/meta'),
    templates: () => getJSON('/api/templates'),
    template: (id) => getJSON('/api/templates/' + encodeURIComponent(id)),
    match: (body) => postJSON('/api/match', body),
    plan: (body) => postJSON('/api/plan', body),
    aiDecide: async (body) => (await directFirst('aiDecide', body)) || postJSON('/api/ai/decide', body),
    prompts: async (body) => (await directFirst('prompts', body)) || postJSON('/api/ai/prompts', body),
    // 版式已定，只让 AI 切原文（长剧本靠关键词切不准）
    aiSplit: async (body) => (await directFirst('aiSplit', body)) || postJSON('/api/ai/split', body),
  aiLines: async (body) => (await directFirst('aiLines', body)) || postJSON('/api/ai/lines', body),
    llmStatus: () => getJSON('/api/llm/status'),
    llmTest: async (body) => (await directFirst('llmTest', body)) || postJSON('/api/llm/test', body),
    async imageGenerate(body) {
      // 生图优先也让浏览器直连；被 CORS 挡了再走本机服务端中转
      const direct = await directFirst('imageGenerate', body);
      if (direct) return direct;
      const r = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pf-client': '1' },
        body: JSON.stringify(body),
      });
      return r.json();
    },
    async proxyImage(url) {
      // 带自定义头：强制走 CORS 预检，别的网站的脚本没法盲调这个代理
      const r = await fetch('/api/proxy?url=' + encodeURIComponent(url), { headers: { 'x-pf-client': '1' } });
      if (!r.ok) throw new Error('代理拉取失败 ' + r.status);
      return await r.blob();
    },
  };
}

const CULTURE_LABEL = { jp: '日', cn: '中', kr: '韩', core: '通' };
const CULTURE_ZH = { jp: '日式页漫', cn: '中式漫画', kr: '韩式条漫', core: '通用/跨界' };

/* 外观层常量（init() 在顶层就跑，所以必须放在这里，不能放文件末尾） */
const ACCENTS = [
  { id: 'blue', zh: '蓝色', l: '#007aff', d: '#0a84ff' },
  { id: 'indigo', zh: '靛蓝', l: '#5856d6', d: '#5e5ce6' },
  { id: 'purple', zh: '紫色', l: '#af52de', d: '#bf5af2' },
  { id: 'pink', zh: '粉色', l: '#ff2d55', d: '#ff375f' },
  { id: 'red', zh: '红色', l: '#ff3b30', d: '#ff453a' },
  { id: 'orange', zh: '橙色', l: '#f56300', d: '#ff9f0a' },
  { id: 'yellow', zh: '黄色', l: '#e0a800', d: '#ffd60a' },
  { id: 'green', zh: '绿色', l: '#28a745', d: '#30d158' },
  { id: 'teal', zh: '青色', l: '#0a9fb5', d: '#40c8e0' },
  { id: 'graphite', zh: '石墨', l: '#636366', d: '#98989d' },
];
const ACCENT_KEY = 'pf.accent';
/** 界面风格：classic（默认）/ ios26（液态玻璃皮肤）；改皮肤只动 data-ui，不动组件 */
const UI_KEY = 'pf.ui.v1';
/** 界面语言：zh（源语言）/ en / id */
const LANG_KEY = 'pf.lang.v1';
const MOTION_KEY = 'pf.motion';
const sysDarkMQ = window.matchMedia('(prefers-color-scheme: dark)');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const REPO_URL = 'https://github.com/wingwu0605-art/panel-forge';
const THEME_KEY = 'pf.theme';
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
/** ?dbg=1：底栏换成一行动调试信息（排查多页 / 面板问题时用） */
const DBG = new URLSearchParams(location.search).get('dbg') === '1';

/**
 * 画师版入口：`?mode=artist`，或构建时注入 `window.PF_PAINTER`（见 site/painter.html）。
 * 同一份源码产出两个独立网页：AI 版（index.html）和画师版（painter.html）。
 * 画师版里 AI 相关界面全部收起（规则匹配、分镜、绘制都在）。
 */
const ARTIST = window.PF_PAINTER === true
  || new URLSearchParams(location.search).get('mode') === 'artist';
if (ARTIST) {
  document.body.dataset.mode = 'artist';
  document.title = 'PanelForge 画师版 · 分镜与绘制';
}

/**
 * 原生壳（Capacitor / WebView）检测。
 * 壳里和浏览器里的性能预算不一样：WebView 的 backdrop-filter 很贵、弹簧动效更容易掉帧，
 * 所以壳里走一套更省的性能档（见 styles.css 的 body[data-shell]），并开启分享出口。
 * 优先级：?shell= 参数 → Capacitor 平台 → UA 标记。
 */
const SHELL = (() => {
  const q = new URLSearchParams(location.search).get('shell');
  if (q) return q;
  try {
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.()) return cap.getPlatform?.() || 'native';
  } catch { /* ignore */ }
  if (/PanelForgeShell/i.test(navigator.userAgent || '')) return 'android';
  return '';
})();
if (SHELL) {
  document.body.dataset.shell = SHELL;
  document.documentElement.lang = document.documentElement.lang || 'zh-CN';
}

/* ------------------------------------------------------------------ *
 * ?perf=1：性能浮层
 * 只在这个参数下存在；用来量「拖动 / 缩放」热路径到底花了多少时间，
 * 手机上也能直接看（不用连 Mac 抓 Safari 时间线）。
 * ---------------------------------------------------------------- */

function initPerfHud() {
  if (!PERF) return;
  const el = document.createElement('div');
  el.className = 'perf-hud';
  el.id = 'perfHud';
  el.textContent = 'perf…';
  document.body.appendChild(el);
  let last = performance.now();
  const tick = (t) => { perfPush(perf.frames, t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => perfPush(perf.longtask, Math.round(e.duration))))
        .observe({ type: 'longtask', buffered: true });
    } catch { /* 老浏览器没有 longtask */ }
  }
  const cls = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : '');
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + 'MB' : Math.round(n / 1024) + 'KB');
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
        imageBytes: Object.values(state.images || {}).reduce((n, im) => n + String(im?.href || '').length, 0),
        markupBytes: ($('#canvas svg')?.outerHTML || '').length,
      };
    },
  };
  setInterval(() => {
    const f = perfStats(perf.frames);
    const r = perfStats(perf.render);
    const p = perfStats(perf.patch);
    const imgs = Object.values(state.images || {});
    const bytes = imgs.reduce((n, im) => n + String(im?.href || '').length, 0);
    const markup = ($('#canvas svg')?.outerHTML || '').length;
    const fps = f.avg > 0 ? Math.round(1000 / f.avg) : 0;
    el.innerHTML = [
      `<b>${fps}</b> fps · 帧 p95 <span class="${cls(f.p95, 20, 34)}">${f.p95.toFixed(1)}ms</span> · 长任务 ${perf.longtask.length}`,
      `render ${perf.renders} 次 · 最近 ${r.p95.toFixed(1)}ms · 峰 ${r.max.toFixed(1)}ms`,
      `patch ${perf.patches} 次 · 最近 ${p.p95.toFixed(2)}ms`,
      `存盘 ${perf.saves} 次 · ${kb(perf.lastSaveBytes)} · 峰 ${perfStats(perf.save).max.toFixed(0)}ms`,
      `图 ${imgs.length} 张 · base64 ${kb(bytes)} · 标记 ${kb(markup)}`,
    ].join('\n');
  }, 250);
}

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.4a6.6 6.6 0 0 1 0 13.2Z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.4 12.6A7 7 0 0 1 7.4 3.6a7 7 0 1 0 9 9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const THEME_NAME = { auto: '跟随系统', light: '浅色', dark: '深色' };

/* ================================================================== *
 * 启动
 * ================================================================== */
// 注意：真正的 init() 调用放在文件最末尾（见底部）——
// 模块里的 const/let 是「先声明后初始化」，如果在文件中间就调 init()，
// 它同步执行到的 bindUI() 会读到还没初始化的常量（TDZ），
// 以前这些读取都被 try/catch 吞掉了，表现是「折叠状态记不住」这种软故障。

/** 列表里挑第一个能用的直连实现：浏览器直连失败（CORS）再退回服务端 */
async function directFirst(name, body) {
  try {
    const { createStaticApi } = await import('./api-static.js');
    const sapi = createStaticApi();
    const set = sapi[name] ? sapi : null;
    if (!set) return null;
    const r = await set[name](body || {});
    if (r && r.ok === false && (r.code === 'LLM_CORS' || r.code === 'NO_LLM_KEY')) return null;
    return r;
  } catch {
    return null;
  }
}

async function init() {
  // 语言必须最先装：initChrome 里的外观面板会读 getLang()，
  // 那时若 i18n 还没装，读到的默认值 'zh' 会把已存的语言偏好写回成 null（刷新后记不住）。
  installI18n(new URLSearchParams(location.search).get('lang') || store.get(LANG_KEY) || 'zh');
  initChrome();
  initPerfHud();
  bindUI();
  installPromptDeps({ pagePlan, activeCharPayload, queueSave });
  installViewDeps({ renderStage, renderSlotPanel, activateTab, currentPlanPanel });
  installHistoryDeps({ renderStage, renderSlotPanel, renderBubbles, toast });
  bindStyleFollow();
  initCollapsibles();
  api = await makeApi();
  adaptTopLinksForStatic();
  const meta = await api.meta();
  const list = await api.templates();
  state.items = list.items;
  state.filtered = list.items;
  state.engine = meta.engine || null;
  // 戏路 id → 中文，模板库的题材筛选和搜索都要用
  state.intentZh = Object.fromEntries((Array.isArray(meta.intents) ? meta.intents : [])
    .map((i) => [i.id, i.zh || i.id]));
  $('#statTpl').textContent = `${meta.templates} 套模板 · ${meta.roles.length} 种格型`;
  $('#statPort').textContent = window.PF_STATIC ? '离线可用' : location.host;
  $('#analyzeHint').textContent = '本地规则引擎';
  if (meta.engine) {
    const e = meta.engine;
    $('#engineNote').innerHTML = `本地规则引擎 v${escapeHtml(e.version)}：<b>${e.intents}</b> 戏路 · <b>${e.keywords}</b> 关键词 · <b>${e.beats}</b> 节拍 · <b>${e.scenes}</b> 场景族 · <b>${e.tones}</b> 基调`;
  }
  renderList();

  loadLlm();
  syncLlmStatus();

  const want = new URLSearchParams(location.hash.slice(1)).get('tpl')
    || new URLSearchParams(location.search).get('tpl');
  const first = want || 'ref-4band-2col';
  await selectTemplate(first, { silent: true });
  // 旧链接 / 打错的 ?tpl=：别停在"没有版式"的空状态，回落默认版式并说明
  if (!state.tpl) {
    await selectTemplate('ref-4band-2col', { silent: true });
    if (want && state.tpl) {
      toast(`没有「${want}」这套模板（可能是旧链接），先给你默认版式`);
      const foot = $('#footMsg');
      if (foot) {
        foot.textContent = `链接里的模板「${want}」不存在，已载入默认版式 —— 从左边模板库挑一套即可`;
        $('#stageFoot')?.classList.add('warn');
      }
    }
  }

  const params = new URLSearchParams(location.search);
  const wantSlot = params.get('slot');
  if (wantSlot && state.tpl?.slots?.some((s) => s.id === wantSlot)) {
    state.selectedId = wantSlot;
    renderStage(); renderSlotPanel();
  }
  if (params.get('demo') === '1') await demoFill();
  if (params.get('hollow') === '1') {
    state.hollow = true;
    $('#chkHollow').checked = true;
    renderStage();
  }
  // 先把第一页立起来（页签必须马上有，不能因为读草稿卡住而空白）
  if (!state.pages.length) {
    state.pages = [{ tplId: state.tpl?.id || 'ref-4band-2col', name: '第 1 页', images: {}, bubbles: [], lines: {} }];
    state.pageIdx = 0;
  }
  renderPageTabs();
  loadKeyStore();
  await loadChars();

  // 再尝试恢复草稿：IndexedDB 不可用/被策略拦住时也不能拖死启动
  // ?fresh=1 跳过恢复（自动化测试要干净的初始状态，否则上一个用例的草稿会换掉模板）
  try {
    const draft = params.get('fresh') === '1' ? null : await Promise.race([
      loadDraft(),
      new Promise((r) => setTimeout(() => r(null), 1500)),
    ]);
    if (draft && draft.pages?.length) {
      state.pages = draft.pages;
      state.pageIdx = Math.min(draft.pageIdx || 0, draft.pages.length - 1);
      const pg = state.pages[state.pageIdx];
      if (pg?.tplId) await selectTemplate(pg.tplId, { silent: true });
      // 这一页改过画幅就重排回来（草稿里存的是 {w,h,mode}）
      if (pg?.size) {
        state.tpl = deriveTpl(state.tplBase, pg.size.w, pg.size.h, pg.size.mode || 'stretch');
        state.pageSize = { ...pg.size };
      }
      state.images = rehydrateImages(pg?.images || {});
      state.bubbles = (pg?.bubbles || []).map((b) => ({ ...b }));
      state.lines = { ...(pg?.lines || {}) };
      state.promptEdits = { ...(pg?.promptEdits || {}) };
      state.promptSrc = { ...(pg?.promptSrc || {}) };
      state.promptPrefix = { ...(pg?.promptPrefix || {}) };
      if (Array.isArray(pg?.activeChars)) state.activeChars = pg.activeChars;
      state.selectedId = state.tpl?.slots?.[0]?.id || null;
      renderStage(); renderSlotPanel(); renderBubbles(); renderScript(); renderPageTabs();
      toast('已恢复上次的 ' + state.pages.length + ' 页草稿');
    }
  } catch (e) {
    console.warn('[PanelForge] 草稿恢复失败（不影响使用）', e);
  }
  if (params.get('keyselftest') === '1') await runKeySelfTest();
  if (params.get('aiselftest') === '1') await runAiSelfTest();
  if (params.get('shortcuts') === '1') toggleShortcuts(true);
  if (params.get('keys') === '1') openKeySheet();
  if (params.get('tab')) activateTab(params.get('tab'));
  if (params.get('plot')) {
    $('#plot').value = params.get('plot');
    await runMatch();
  }
  // 放在最后：匹配 / 恢复草稿都会改写底栏，dbg 要压在这些之后才有意义
  if (DBG) showDbgLine();
  // 原生壳：接上「接收分享」的通道（浏览器里是空操作）
  initShareIn();
  // 语言无关的「启动完成」标记：自动化测试用它判就绪（文案会随语言变）
  document.body.dataset.ready = '1';
}

/** 排查多页 / 面板问题用：页数、当前页、页签数、模板、选中格、视图、模块、分镜格数、角色 */
function showDbgLine() {
  const f = document.querySelector('#footMsg');
  if (!f) return;
  f.textContent = 'dbg pages=' + state.pages.length + ' idx=' + state.pageIdx
    + ' tabs=' + document.querySelectorAll('.pb-tab').length
    + ' tpl=' + (state.tpl?.id || '-')
    + ' sel=' + (state.selectedId || '-')
    + ' view=' + (document.body.dataset.view || '-')
    + ' mod=' + (state.editMod || '-')
    + ' plan=' + ((pagePlan()?.panels || []).length)
    + ' chars=' + state.chars.length + '/' + state.activeChars.length;
  f.classList.add('pf-dbg');
}

/* ================================================================== *
 * 快捷键自检（?keyselftest=1）：派发真实 keydown 事件，检查状态变化
 * ================================================================== */
async function runKeySelfTest() {
  const rows = [];
  const ok = (name, cond, extra = '') => rows.push({ name, cond: !!cond, extra });
  const press = (key, opts = {}) => {
    if (document.activeElement?.blur) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true,
    }));
  };
  const slots = state.tpl.slots;
  const s0 = slots[0].id;
  const s1 = slots[1]?.id || slots[0].id;

  state.images = {}; state.bubbles = []; state.lines = {};
  state.selBubble = null; state.selectedId = s0;
  resetHistory();

  // 撤销 / 重做
  commit();
  state.images[s0] = { href: 'data:image/png;base64,iVBORw0KGgo=', iw: 8, ih: 8, zoom: 1, panX: 0, panY: 0, mode: 'cover', name: 't' };
  ok('准备：第 1 格有图', !!state.images[s0]);
  press('z', { ctrl: true });
  ok('Ctrl+Z 撤销 → 图没了', !state.images[s0], `${Object.keys(state.images).length} 张`);
  press('z', { ctrl: true, shift: true });
  ok('Ctrl+Shift+Z 重做 → 图回来', !!state.images[s0]);

  // 复制 / 粘贴 / 删除
  state.selectedId = s0;
  press('c', { ctrl: true });
  ok('Ctrl+C 复制图片', state.clipboard?.kind === 'image');
  state.selectedId = s1;
  press('v', { ctrl: true });
  ok('Ctrl+V 粘贴到第 2 格', !!state.images[s1]);
  press('Delete');
  ok('Delete 移除第 2 格图片', !state.images[s1]);

  // 气泡：尺寸 / 微调 / 复制 / 删除
  state.selectedId = s0;
  addBubble('talk-ellipse', { noCommit: true });
  const b0 = selectedBubble();
  ok('气泡已添加', !!b0);
  if (b0) {
    const w0 = b0.w;
    press(']');
    ok('] 放大气泡', selectedBubble().w > w0, `${w0}→${selectedBubble().w}`);
    const w1 = selectedBubble().w;
    press('[');
    ok('[ 缩小气泡', selectedBubble().w < w1);
    const y0 = selectedBubble().y;
    press('ArrowDown', { shift: true });
    ok('Shift+↓ 下移 10', selectedBubble().y === y0 + 10, `${y0}→${selectedBubble().y}`);
    const n0 = state.bubbles.length;
    press('d', { ctrl: true });
    ok('Ctrl+D 复制气泡', state.bubbles.length === n0 + 1, `${n0}→${state.bubbles.length}`);
    press('Delete');
    ok('Delete 删除气泡', state.bubbles.length === n0);
  }

  // 视图开关 / 数字跳格 / 帮助
  const hollow0 = $('#chkHollow').checked;
  press('h');
  ok('H 切换镂空', $('#chkHollow').checked !== hollow0);
  press('h');
  const labels0 = $('#chkLabels').checked;
  press('g');
  ok('G 切换格号', $('#chkLabels').checked !== labels0);
  press('2');
  ok('数字键 2 跳到第 2 格', state.selectedId === s1);
  press('?');
  ok('? 打开快捷键表', !$('#shortcuts').classList.contains('hidden'));
  press('Escape');
  ok('Esc 关闭快捷键表', $('#shortcuts').classList.contains('hidden'));

  const pass = rows.filter((r) => r.cond).length;
  const box = document.createElement('div');
  box.className = 'selftest';
  box.innerHTML = `<b>快捷键自检：${pass}/${rows.length} 通过</b>` +
    rows.map((r) => `<div class="${r.cond ? '' : 'no'}">${r.cond ? '✅' : '❌'} ${r.name}${r.extra ? ' — ' + r.extra : ''}</div>`).join('');
  document.body.appendChild(box);
  console.log(box.textContent);
  return pass === rows.length;
}

/* ================================================================== *
 * 静态版 AI 自检（?aiselftest=1）
 * 直接 new 一个 static api，验证「浏览器直连模型」这条链路
 * ================================================================== */
async function runAiSelfTest() {
  const rows = [];
  const ok = (name, cond, extra = '') => rows.push({ name, cond: !!cond, extra });
  try {
    await aiSelfTestBody(ok);
  } catch (e) {
    rows.push({ name: '自检过程异常：' + e.message, cond: false, extra: String(e.stack || '').slice(0, 160) });
  }
  const pass = rows.filter((r) => r.cond).length;
  const box = document.createElement('div');
  box.className = 'selftest';
  box.innerHTML = `<b>静态版 AI 自检：${pass}/${rows.length} 通过</b>` +
    rows.map((r) => `<div class="${r.cond ? '' : 'no'}">${r.cond ? '✅' : '❌'} ${r.name}${r.extra ? ' — ' + r.extra : ''}</div>`).join('');
  document.body.appendChild(box);
  return pass === rows.length;
}

async function aiSelfTestBody(ok) {
  const { createStaticApi } = await import('./api-static.js');
  const sapi = createStaticApi();

  // 指向本地假模型（CORS 开放）
  state.llm = { protocol: 'openai', baseUrl: 'http://127.0.0.1:7399', apiKey: 'mock-key', model: 'mock-model' };
  localStorage.setItem(LLM_STORE, JSON.stringify(state.llm));

  const status = await sapi.llmStatus();
  ok('静态版 llmStatus 认得 Key', status.configured === true && status.staticMode === true);

  try {
    const t = await sapi.llmTest({ llm: state.llm });
    ok('llmTest 浏览器直连成功', t.ok === true, t.reply || t.error || '');
  } catch (e) {
    ok('llmTest 浏览器直连成功', false, e.message);
  }

  const plot = '雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋。';
  let decide = null;
  try {
    decide = await sapi.aiDecide({ plot, culture: 'all', ratio: 'auto', candidates: 8, pageWidth: 1600, llm: state.llm });
    ok('aiDecide 返回 ok', decide.ok === true, decide.error || '');
    ok('选中模板是合法 id', !decide.decision?.quality?.corrected, decide.decision?.pick || '');
    ok('生成的计划格数 > 0', (decide.plan?.panels?.length || 0) > 0, `${decide.plan?.panels?.length || 0} 格`);
    ok('每格都有画面内容', (decide.plan?.panels || []).every((p) => p.content), '');
  } catch (e) {
    ok('aiDecide 返回 ok', false, e.message);
  }

  if (decide?.ok) {
    try {
      const p = await sapi.prompts({ plot, templateId: decide.decision.pick, pageWidth: 1600, llm: state.llm });
      ok('prompts 返回 ok', p.ok === true, p.error || '');
      ok('优化生效的格数 > 0', (p.applied || 0) > 0, `${p.applied}/${p.total}`);
      const first = p.plan?.panels?.[0];
      ok('提示词已被替换为 AI 版', first?.aiOptimized === true, (first?.promptEn || '').slice(0, 46));
    } catch (e) {
      ok('prompts 返回 ok', false, e.message);
    }
  }

  localStorage.removeItem(LLM_STORE);
  const noKey = await sapi.aiDecide({ plot, llm: { apiKey: '' } });
  ok('无 Key 时给出友好提示', noKey.ok === false && (noKey.code === 'NO_LLM_KEY' || !!noKey.hint), noKey.code || '');
}

/* ================================================================== *
 * 撤销 / 重做
 * 快照只克隆对象的外壳，图片的 dataURL 字符串是共享引用，所以很轻
 * ================================================================== */

/* ================================================================== *
 * 可折叠面板：收起只留标题行，状态记在本机
 * ================================================================== */
const UI_STORE = 'pf.ui.v1';

function initCollapsibles() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(UI_STORE) || '{}') || {}; } catch { /* ignore */ }
  const persist = () => { try { localStorage.setItem(UI_STORE, JSON.stringify(saved)); } catch { /* ignore */ } };
  // ?collapse=ai,browse 可指定初始收起（分享"专注模式"链接用，不影响记住的状态）
  const force = (new URLSearchParams(location.search).get('collapse') || '').split(',').filter(Boolean);

  // 默认收起的卡片（用户改过就以记录为准）：模板库内容多、日常最占地方
  const DEFAULT_CLOSED = ['browse'];
  for (const el of $$('[data-collapse]')) {
    const key = el.dataset.collapse;
    const savedVal = saved[key];
    const initialOpen = typeof savedVal === 'boolean' ? savedVal : (!DEFAULT_CLOSED.includes(key) && !force.includes(key));

    // 原生 <details>（「怎么用」）
    if (el.tagName === 'DETAILS') {
      el.open = initialOpen;
      el.addEventListener('toggle', () => { saved[key] = el.open; persist(); });
      continue;
    }

    const head = el.querySelector(':scope > .card-head, :scope > .bub-head');
    if (!head) continue;

    // 头部之后的兄弟节点统一包进 .card-body
    let body = el.querySelector(':scope > .card-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'card-body';
      const inner = document.createElement('div');
      inner.className = 'card-body-inner';
      [...el.children].filter((c) => c !== head).forEach((c) => inner.appendChild(c));
      body.appendChild(inner);
      el.appendChild(body);
    }

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'caret';
    caret.title = '展开 / 收起';
    caret.setAttribute('aria-label', '展开或收起');
    caret.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    head.appendChild(caret);

    const apply = (open, save = true) => {
      animateFold(el, body, open, { instant: !save });
      caret.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (save) { saved[key] = open; persist(); }
    };
    apply(initialOpen, false);

    // 点标题行任意处都能折叠；但标题里的按钮/输入框不触发
    head.addEventListener('click', (ev) => {
      const hit = ev.target.closest('button, input, select, textarea, a');
      if (hit && !hit.classList.contains('caret')) return;
      apply(el.classList.contains('collapsed'));
    });
  }
}

/* ================================================================== *
 * 模板列表
 * ================================================================== */
/** 戏路 id → 中文（从 /api/meta 拿；拿不到就退回 id） */
function intentZh(id) {
  return state.intentZh?.[id] || id;
}

function renderList() {
  const q = ($('#search').value || '').trim().toLowerCase();
  let list = state.items;
  if (state.cultureTab !== 'all') list = list.filter((t) => t.culture === state.cultureTab);
  if (q) {
    // 搜索框也吃标签的**中文名**（「四格」「战斗」「9:16」都能命中）
    list = list.filter((t) => {
      const hay = (t.id + t.name + t.desc + t.tags.join('') + t.intents.map(intentZh).join('')
        + intentZh(t.ratio) + ratioName(t.ratio) + t.panels + '格 ' + CULTURE_ZH[t.culture]).toLowerCase();
      return hay.includes(q);
    });
  }
  if (state.libFilter) list = list.filter((t) => matchFacet(t, state.libFilter));
  state.filtered = list;
  $('#listCount').textContent = `${list.length} 套`;
  renderFacetBar();

  const frag = document.createDocumentFragment();
  for (const t of list) {
    const el = document.createElement('div');
    el.className = 'tpl' + (state.tpl && state.tpl.id === t.id ? ' on' : '');
    el.dataset.id = t.id;
    const chips = [
      `<button class="ttag" data-facet="panels" data-val="${t.panels}">${t.panels}格</button>`,
      ...t.tags.slice(0, 2).map((x) => `<button class="ttag" data-facet="tag" data-val="${escapeHtml(x)}">${escapeHtml(x)}</button>`),
      ...(t.intents[0] ? [`<button class="ttag" data-facet="intent" data-val="${escapeHtml(t.intents[0])}">${escapeHtml(intentZh(t.intents[0]))}</button>`] : []),
    ].join('');
    el.innerHTML = `
      <div class="th">${renderTemplateSVG({ ...t, slots: t.thumbSlots }, { width: 220, showEmptyTint: false, slotOutline: true })}</div>
      <div class="nm">${escapeHtml(t.name)}</div>
      <div class="mt">
        <span>${t.panels}格</span><span>·</span><span>${ratioName(t.ratio)}</span><span>·</span><span>${CULTURE_LABEL[t.culture]}</span>
      </div>
      <div class="tpl-tags">${chips}</div>
      <span class="bd">${t.panels}</span>
      <span class="cul">${CULTURE_LABEL[t.culture]}</span>`;
    el.addEventListener('click', (ev) => {
      const tag = ev.target.closest('[data-facet]');
      if (tag) {   // 点卡片上的标签 = 按它筛选，而不是换模板
        ev.stopPropagation();
        setFacet(tag.dataset.facet, tag.dataset.val);
        return;
      }
      selectTemplate(t.id); goCanvasOnCompact();
    });
    frag.appendChild(el);
  }
  const grid = $('#tplGrid');
  [...frag.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
  grid.innerHTML = '';
  grid.appendChild(frag);
}

/* ---------------- 模板库的标签筛选（格数 / 题材 / 画幅 / 标签） ---------------- */
function matchFacet(t, f) {
  if (f.kind === 'panels') return t.panels === Number(f.value);
  if (f.kind === 'intent') return t.intents.includes(f.value);
  if (f.kind === 'ratio') return t.ratio === f.value;
  if (f.kind === 'tag') return t.tags.includes(f.value);
  return true;
}
function setFacet(kind, value) {
  const same = state.libFilter && state.libFilter.kind === kind && state.libFilter.value === value;
  state.libFilter = same ? null : { kind, value };
  renderList();
}
function clearFacet() { state.libFilter = null; renderList(); }

function renderFacetBar() {
  const bar = $('#facetBar');
  if (!bar) return;
  const items = state.items;
  const act = state.libFilter || {};
  const chip = (kind, value, label, count) => {
    const on = act.kind === kind && String(act.value) === String(value);
    return `<button class="fchip${on ? ' on' : ''}" data-facet="${kind}" data-val="${escapeHtml(value)}">${escapeHtml(label)}${count != null ? `<i>${count}</i>` : ''}</button>`;
  };
  const tally = (fn) => {
    const m = new Map();
    for (const t of items) for (const k of fn(t)) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  // 格数：只显示有 ≥2 套的
  const panelEntries = [...tally((t) => [t.panels]).entries()]
    .filter(([, n]) => n >= 2).sort((a, b) => a[0] - b[0]).map(([p, n]) => [String(p), n]);
  // 题材：按出现次数取前 10
  const intentEntries = [...tally((t) => t.intents).entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([i, n]) => [i, n]);
  // 画幅
  const ratioEntries = [...tally((t) => [t.ratio]).entries()]
    .sort((a, b) => b[1] - a[1]).map(([r, n]) => [r, n]);
  // 标签：按出现次数取前 12
  const tagEntries = [...tally((t) => t.tags).entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x, n]) => [x, n]);

  const groups = [
    { kind: 'panels', label: '格数', entries: panelEntries, fmt: (v) => `${v}格` },
    { kind: 'intent', label: '题材', entries: intentEntries, fmt: (v) => intentZh(v) },
    { kind: 'ratio', label: '画幅', entries: ratioEntries, fmt: (v) => ratioName(v) },
    { kind: 'tag', label: '标签', entries: tagEntries, fmt: (v) => v },
  ];
  bar.innerHTML = groups.map((g) => {
    let entries = g.entries;
    // 当前生效的筛选可能不在「前 N 名」里（比如点了卡片上某个冷门题材）——
    // 那也要把它显示出来并高亮，否则用户看不出现在筛的是什么
    if (act.kind === g.kind && !entries.some(([v]) => String(v) === String(act.value))) {
      const n = items.filter((t) => matchFacet(t, act)).length;
      entries = [[act.value, n], ...entries];
    }
    const html = entries.map(([v, n]) => chip(g.kind, v, g.fmt(v), n)).join('');
    return `<div class="frow"><span class="flabel">${g.label}</span><div class="fchips">${html}</div></div>`;
  }).join('') + (state.libFilter ? '<button class="btn tiny fclear" id="facetClear">清除筛选</button>' : '');
}

function ratioName(r) {
  return { a4: 'A4', b5: 'B5', p34: '3:4', square: '1:1', wide: '16:9', strip: '9:16', tall: '1:2', scroll: '长条' }[r] || r;
}

/* ================================================================== *
 * 选择模板
 * ================================================================== */
async function selectTemplate(id, opts = {}) {
  if (!id) return;
  const tpl = await api.template(id);
  if (!tpl || tpl.error) { toast('模板不存在：' + id); return; }

  // 换模板时图片按阅读顺序搬家
  if (state.tpl && state.tpl.id !== tpl.id && !opts.keepImages === false) {
    const ordered = state.tpl.slots.map((s) => state.images[s.id]).filter(Boolean);
    const next = {};
    tpl.slots.forEach((s, i) => { if (ordered[i]) next[s.id] = ordered[i]; });
    state.images = next;
    if (ordered.length > tpl.slots.length) {
      toast(`新模板只有 ${tpl.slots.length} 格，超出的 ${ordered.length - tpl.slots.length} 张图未放入`);
    }
  }
  state.tpl = tpl;
  state.tplBase = JSON.parse(JSON.stringify(tpl));   // 画幅重排的基准，之后不再动
  state.pageSize = null;
  state.pageEnter = true;
  if (state.aiPlan && state.aiPlan.template?.id !== tpl.id) { state.aiPlan = null; state.aiDecision = null; }
  state.bubbles = [];
  state.selBubble = null;
  resetHistory();
  loadLines(tpl.id);
  state.promptEdits = {};
  attachSuggestions($('#plot').value || '', state.plan?.pages?.[0]?.plan);
  state.selectedId = tpl.slots[0]?.id || null;
  state.plan = null;
  location.hash = 'tpl=' + tpl.id;

  $('#tplName').textContent = tpl.name;
  $('#tplMeta').textContent = `${tpl.slots.length} 格 · ${ratioName(tpl.ratio)} · ${readOrderText(tpl.reading)} · ${CULTURE_ZH[tpl.culture]}`;
  $('#footOrder').textContent = `阅读顺序：${readOrderText(tpl.reading)}`;
  $('#stageEmpty').classList.add('hidden');

  renderStage();
  renderSlotPanel();
  renderExportKv();
  syncSizeUI();
  renderBubbles();
  $$('.tpl').forEach((el) => el.classList.toggle('on', el.dataset.id === tpl.id));
  refreshScript();
}

function readOrderText(r) {
  return r === 'rtl' ? '右→左 · 上→下' : r === 'vertical' ? '上→下' : '左→右 · 上→下';
}

/* ================================================================== *
 * 画布渲染
 * ================================================================== */
let rafPending = false;
let pageEnterTimer = 0;
/**
 * 拖动 / 缩放图片的热路径：只改被拖那一格 <image> 的几何属性，不重建整页。
 *
 * 以前每次 pointermove 都走 renderStage()：把整页 SVG（含所有图片的 base64）
 * 重新拼成字符串再 innerHTML —— 8 张图就是每帧 3MB 出头的字符串，
 * 桌面掉到 36fps，手机上直接个位数帧。这里只写 5 个属性，代价是微秒级。
 * 返回值 false 表示这一格没有 <image>（比如刚换过模板），调用方可以退回整页重绘。
 */
function patchSlotImage(slotId) {
  const t0 = perfNow();
  const svg = $('#canvas svg');
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  const img = state.images[slotId];
  if (!svg || !slot || !img) return false;
  const el = svg.querySelector(`image[data-slot="${(window.CSS?.escape || String)(slotId)}"]`);
  if (!el) return false;
  const a = imageAttrs(slot, img);
  el.setAttribute('x', a.x);
  el.setAttribute('y', a.y);
  el.setAttribute('width', a.width);
  el.setAttribute('height', a.height);
  el.setAttribute('preserveAspectRatio', a.preserveAspectRatio);
  if (a.rotate) el.setAttribute('transform', a.rotate);
  else el.removeAttribute('transform');
  perfDone('patch', t0);
  return true;
}
/** 热路径的兜底：能量到就只改属性，量不到（没图 / 换过模板）才整页重绘 */
function refreshSlotImage(slotId) {
  if (!patchSlotImage(slotId)) renderStage();
}

/**
 * 拖动气泡的热路径：只给这个气泡的 <g> 加一个 translate。
 * 标记里的位置是「烤死」的（data-x/data-y），所以每次按 state 和目标位置算一次偏移，
 * 不用累加，也就不会漂。
 */
function patchBubble(id) {
  const t0 = perfNow();
  const svg = $('#canvas svg');
  const b = state.bubbles.find((x) => x.id === id);
  const g = svg?.querySelector(`g[data-bubble="${(window.CSS?.escape || String)(id)}"]`);
  if (!g || !b) return false;
  const dx = b.x - (Number(g.dataset.x) || 0);
  const dy = b.y - (Number(g.dataset.y) || 0);
  if (dx || dy) g.setAttribute('transform', `translate(${Math.round(dx * 100) / 100} ${Math.round(dy * 100) / 100})`);
  else g.removeAttribute('transform');
  perfDone('patch', t0);
  return true;
}
function refreshBubble(id) {
  if (!patchBubble(id)) renderStage();
}

/* ================================================================== *
 * 格子内绘制（P0）：铺满动画 → 按格子形状裁剪的画布 → 存回这一格
 * ================================================================== */
let painter = null;        // 轻量笔会话（web/paint.mjs），引擎起不来时的兜底
let paintHost = null;      // 外部引擎会话（web/paint-host.mjs → Klecks iframe）
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

/** 铺满：从这一格在页面上的位置，长大到整屏 */
function animatePaintIn(slot, el) {
  const svg = $('#canvas svg');
  const node = el || painter?.canvas;
  if (!svg || !node || !motionOK()) return;
  const r = svg.getBoundingClientRect();
  const k = r.width / state.tpl.page.w;
  const to = node.getBoundingClientRect();
  if (!to.width) return;
  const from = { x: r.left + slot.x * k, y: r.top + slot.y * k, w: slot.w * k, h: slot.h * k };
  node.animate([
    { transform: `translate(${from.x - to.left}px,${from.y - to.top}px) scale(${from.w / to.width})`, opacity: 0.35 },
    { transform: 'none', opacity: 1 },
  ], { duration: 460, easing: 'cubic-bezier(.32,.72,0,1)' });
}

/**
 * 打开某一格的绘制。
 * 优先用外部引擎（Klecks iframe）；它没产物 / 起不来时退回自带的轻量笔。
 */
async function openPaint(slotId = state.selectedId) {
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
async function exportSlotImage(slotId = state.selectedId) {
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
function paintPaperOn() { return store.get('pf.paint.paper') !== '0'; }

function syncPaintPaperBtn() {
  const on = paintPaperOn();
  const b = $('#paintPaper');
  if (b) {
    b.textContent = on ? '白底' : '透明';
    b.classList.toggle('primary', !on);
  }
}

async function setPaintPaper(on) {
  store.set('pf.paint.paper', on ? null : '0');
  syncPaintPaperBtn();
  if (paintEngine === 'klecks' && paintHost) await paintHost.setPaper(on);
  else if (painter) painter.setPaper(on);
  toast(on ? '画布改成白底（导出不透明 PNG）' : '画布改成透明（导出带透明通道）');
}

/**
 * 把一张图「送出去」：原生壳里走系统分享面板，浏览器里走 Web Share，都没有就下载。
 * 这是手机上把这一格交给别的绘画 App（绘世界 / Procreate / 概念…）的唯一可靠通道。
 */
/* ------------------------------------------------------------------ *
 * 「用某个绘画 App 打开这一格」
 * 先把图写到缓存 → 让用户从「真的接收图片的 App」里选一个 → 原生 setPackage 直跳。
 * 如果目标 App 没声明接收图片，那谁也跳不过去（这是对方的选择，不是我们能绕的）。
 * ------------------------------------------------------------------ */
let sharedTargetsCache = null;

/** 列出手机上会出现在分享面板里的 App（壳里才有；浏览器返回 null） */
async function nativeShareTargets(force = false) {
  const plugin = window.Capacitor?.Plugins?.ShareTo;
  if (!plugin?.listTargets) return null;
  if (sharedTargetsCache && !force) return sharedTargetsCache;
  try {
    const r = await plugin.listTargets();
    sharedTargetsCache = Array.isArray(r?.targets) ? r.targets : [];
    return sharedTargetsCache;
  } catch (e) {
    console.warn('[share] 列目标失败', e);
    return [];
  }
}

/** 把图片交给指定包名的 App（跳过系统面板） */
async function shareToPackage(pkg, blob, name) {
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.ShareTo;
  if (!plugin?.sendTo) { toast('这个环境不支持直跳，用「分享」面板'); return false; }
  try {
    const b64 = await blobToBase64(blob);
    const safe = `pf-${Date.now()}.png`;
    await cap.Plugins.Filesystem.writeFile({ path: safe, data: b64, directory: 'CACHE', recursive: true });
    const { uri } = await cap.Plugins.Filesystem.getUri({ path: safe, directory: 'CACHE' });
    await plugin.sendTo({ package: pkg, uri, mime: blob.type || 'image/png' });
    return true;
  } catch (e) {
    console.warn('[share] 直跳失败', e);
    toast(`直跳失败：${String(e?.message || e).slice(0, 60)}`);
    return false;
  }
}

/** 壳里：「分享」先弹我们自己的 App 选择器，选完直接跳过去；没有插件就退回系统面板 */
async function sharePickOrSheet(blob, name, title) {
  const targets = await nativeShareTargets();
  if (!targets?.length) { await shareOrDownload(blob, name, title); return; }
  openSharePicker(targets, blob, name);
}

function openSharePicker(targets, blob, name) {
  const old = document.querySelector('#sharePick');
  if (old) old.remove();
  const sheet = document.createElement('div');
  sheet.className = 'keysheet';
  sheet.id = 'sharePick';
  sheet.innerHTML = `
    <div class="ks-panel" style="max-width:460px">
      <div class="ks-head">
        <b>用哪一个 App 打开</b>
        <span class="muted small">只有能接收图片的 App 才会出现在这里</span>
        <button class="btn tiny" data-close>关闭</button>
      </div>
      <div class="ks-body" style="display:block;padding:12px 14px 16px">
        <div class="share-pick-list">
          ${targets.map((t) => `<button class="share-pick" data-pkg="${escapeHtml(t.package)}">
            <b>${escapeHtml(t.label || t.package)}</b>
            <span>${escapeHtml(t.package)}</span>
          </button>`).join('')}
        </div>
        <button class="btn tiny wide" data-sheet style="margin-top:10px">用系统分享面板（更多 App）</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', async (ev) => {
    if (ev.target === sheet || ev.target.closest('[data-close]')) { close(); return; }
    if (ev.target.closest('[data-sheet]')) { close(); await shareOrDownload(blob, name); return; }
    const btn = ev.target.closest('[data-pkg]');
    if (!btn) return;
    close();
    await shareToPackage(btn.dataset.pkg, blob, name);
  });
}

async function shareOrDownload(blob, name, title = 'PanelForge 分镜') {
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  const cap = window.Capacitor;
  const native = !!cap?.isNativePlatform?.();
  // ① 原生壳：Capacitor Filesystem 写到缓存，再用 Share 打开系统面板
  if (native && cap.Plugins?.Filesystem && cap.Plugins?.Share) {
    try {
      const b64 = await blobToBase64(blob);
      // 文件名带中文时 Filesystem 在部分机型上会失败，统一转成 ASCII 安全名
      const safe = `pf-${Date.now()}.png`;
      await cap.Plugins.Filesystem.writeFile({ path: safe, data: b64, directory: 'CACHE', recursive: true });
      const { uri } = await cap.Plugins.Filesystem.getUri({ path: safe, directory: 'CACHE' });
      await cap.Plugins.Share.share({ title, files: [uri] });
      toast('已打开系统分享面板');
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      console.warn('[share] 原生分享失败', e);
      // 用户主动取消不算错误，不弹提示
      if (!/cancel/i.test(msg)) toast(`分享没成功（${msg.slice(0, 40)}），已改存相册`);
    }
  }
  // ② 浏览器：Web Share Level 2（iOS Safari 15+ / Chrome Android）
  if (!native) {
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return true;
      }
    } catch { /* 用户取消或平台不支持 */ }
  }
  // ③ 兜底：壳里存相册（WebView 不支持下载），浏览器里下载
  if (await saveToGallery(blob, name)) return false;
  downloadBlob(blob, name);
  toast(native ? '当前环境既不支持分享也不支持下载：请用「导出」' : '已下载');
  return false;
}

/** 壳里排查分享/导出问题用：把这些能力的存在情况打出来 */
window.__pfShareDebug = () => {
  const cap = window.Capacitor;
  return {
    shell: SHELL || null,
    isNative: !!cap?.isNativePlatform?.(),
    plugins: cap?.Plugins ? Object.keys(cap.Plugins) : [],
    hasSaveImage: !!cap?.Plugins?.SaveImage?.save,
    hasShare: !!cap?.Plugins?.Share?.share,
    hasFilesystem: !!cap?.Plugins?.Filesystem?.writeFile,
    hasShareTarget: !!cap?.Plugins?.ShareTarget?.getPending,
    webShare: typeof navigator.canShare === 'function',
  };
};

/**
 * 壳里：取走别的 App 分享进来的图片，填进当前选中的格子（没选中就第一空格）。
 * 这是「画完在别的 App 里 → 分享回 PanelForge → 自动回到对应格子」的那一半。
 */
async function pullSharedImage() {
  const plugin = window.Capacitor?.Plugins?.ShareTarget;
  if (!plugin?.getPending) return false;
  try {
    const r = await plugin.getPending();
    if (!r?.data) return false;
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: r.mime || 'image/png' });
    const slots = state.tpl?.slots || [];
    const target = state.selectedId
      || slots.find((s) => !state.images[s.id])?.id
      || slots[0]?.id;
    if (!target) { toast('收到一张图，但还没有版式：先选一套分镜'); return false; }
    commit();
    state.images[target] = await imageAsset(blob, { name: 'shared.png' });
    state.selectedId = target;
    const order = slots.find((s) => s.id === target)?.order ?? '?';
    renderStage(); renderSlotPanel(); renderScript(); 
    queueSave();
    toast(`收到分享的图，已填入第 ${order} 格`);
    return true;
  } catch (e) {
    console.warn('[share-in] 读分享图失败', e);
    return false;
  }
}

/** 壳里挂上：启动时取一次，回到前台时再取一次（分享进来时 App 可能已经在后台） */
function initShareIn() {
  // 调试/自动化钩子：浏览器里也能手动触发一次「取分享图」
  window.__pfPullSharedImage = pullSharedImage;
  if (!SHELL) return;
  const app = window.Capacitor?.Plugins?.App;
  if (!app?.addListener) return;
  setTimeout(() => { pullSharedImage(); }, 1200);
  app.addListener('appStateChange', ({ isActive }) => { if (isActive) pullSharedImage(); });
}

/**
 * 生图/写提示词失败时，把完整错误摊开给人看。
 * toast 是胶囊形，长文本会被截断（用户反馈「报错信息不全」就是这么来的），
 * 所以长错误一律进这个面板：可滚动、可选中、可一键复制。
 */
function showErrorDetail(title, err, extra = '') {
  const old = document.querySelector('#errSheet');
  if (old) old.remove();
  const msg = String(err?.message || err || '未知错误');
  const hint = err?.hint || '';
  const code = err?.code || '';
  const rid = err?.requestId ? `\nrequest_id=${err.requestId}` : '';
  const body = `${msg}${rid}${hint ? '\n\n建议：' + hint : ''}${extra ? '\n' + extra : ''}`;
  const sheet = document.createElement('div');
  sheet.className = 'keysheet';
  sheet.id = 'errSheet';
  sheet.innerHTML = `
    <div class="ks-panel" style="max-width:560px">
      <div class="ks-head">
        <b>${escapeHtml(title)}${code ? ` · ${escapeHtml(code)}` : ''}</b>
        <span class="muted small">完整信息（可选中复制）</span>
        <button class="btn tiny" data-close>关闭</button>
      </div>
      <div class="ks-body">
        <pre class="err-pre"></pre>
        <div class="row2">
          <button class="btn tiny primary" data-copy>复制错误信息</button>
          <button class="btn tiny" data-close2>知道了</button>
        </div>
      </div>
    </div>`;
  sheet.querySelector('.err-pre').textContent = body;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (ev) => {
    if (ev.target === sheet || ev.target.closest('[data-close]') || ev.target.closest('[data-close2]')) { close(); return; }
    if (ev.target.closest('[data-copy]')) copyText(body, '错误信息已复制');
  });
  return sheet;
}

// 调试/自动化钩子：不产生真实请求就能看错误面板长什么样
window.__pfShowError = showErrorDetail;
// 调试钩子：查看当前实际生效的 LLM 配置（排查「配了却没生效」这类问题）
window.__pfLlm = () => ({ ...state.llm });
window.__pfApi = () => api;
window.__pfJobs = () => ({ ...(state.imgJobs || {}) });
window.__pfImages = () => ({ ...state.images });
window.__pfSel = (id) => { state.selectedId = id; renderStage(); renderSlotPanel(); refreshGenButtons(); };

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

function closePaint() {
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
async function finishPaint() {
  if (!paintSlotId) { closePaint(); return; }
  const slotId = paintSlotId;
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);

  if (paintEngine === 'klecks' && paintHost) {
    const host = paintHost;
    const btn = $('#paintDone');
    const old = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '取图…'; }
    try {
      const raw = await host.exportPNG();
      const workSide = Math.max(host.width, host.height);
      const clipped = slot ? await clipToSlot(raw, slot) : raw;
      commit();
      // maxSide = 工作分辨率 → 不缩放，保住 PNG 的清晰边缘
      state.images[slotId] = await imageAsset(clipped, { name: 'paint', maxSide: workSide });
      delete state.paint[slotId];   // 外部引擎不交笔画，只交成图
      closePaint();
      renderStage(); renderSlotPanel(); refreshScript(); queueSave();
      toast('已画好并贴回这一格');
    } catch (e) {
      console.error('[paint] 取图失败', e);
      toast('取图失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || '完成'; }
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
  renderStage(); renderSlotPanel(); refreshScript(); queueSave();
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
  // 用其他 App 画：不进我们的画布，直接从格子这一栏把底图交给外部绘画 App
  $('#btnExternalPaint')?.addEventListener('click', () => { openExternalPaint(); });
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

/* ================================================================== *
 * 面板管理：左栏每一块可显示 / 隐藏 / 调顺序；AI 功能一个总开关
 * 布局按「模式」分开记：画师版和 AI 版各有一套，互不影响。
 * ================================================================== */
const LAYOUT_KEY = 'pf.layout.v2';
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
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
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
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/** 把布局套到 DOM 上：顺序 + 显隐 + AI 总开关 */
function applyLayout(cfg = currentLayout()) {
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

function bindPanelSheet() {
  const open = () => { renderPanelSheet(); $('#panelSheet')?.classList.remove('hidden'); };
  const close = () => $('#panelSheet')?.classList.add('hidden');
  $('#btnPanels')?.addEventListener('click', open);
  $('#btnPanelClose')?.addEventListener('click', close);
  $('#panelSheet')?.addEventListener('click', (ev) => { if (ev.target.id === 'panelSheet') close(); });
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

/* ================================================================== *
 * 页面画幅：改整页宽高比（格子按比例重排，不是只改导出尺寸）
 * - 几何永远从「原始模板」重新推导，反复改不会叠误差
 * - 拉伸铺满（默认）：格子填满新画幅，格子自身比例会变
 * - 等比留白：等比缩放后居中，格子比例不变，边上留白
 * ================================================================== */
const RATIO_PRESETS = {
  a4: [1, Math.SQRT2], p34: [3, 4], p45: [4, 5], strip: [9, 16],
  wide: [16, 9], square: [1, 1], tall: [1, 2],
};

const r2 = (v) => Math.round(v * 100) / 100;

/** 从原始模板推导出目标画幅下的几何 */
function deriveTpl(base, W, H, mode) {
  const sx = W / base.page.w;
  const sy = H / base.page.h;
  const k = mode === 'fit' ? Math.min(sx, sy) : null;
  const kx = k ?? sx;
  const ky = k ?? sy;
  const offX = k ? (W - base.page.w * k) / 2 : 0;
  const offY = k ? (H - base.page.h * k) / 2 : 0;
  const tpl = JSON.parse(JSON.stringify(base));
  const page = { w: Math.round(W), h: Math.round(H) };
  tpl.page = { ...base.page, ...page, kind: 'custom' };
  const kg = Math.min(kx, ky);
  tpl.margin = Math.round(base.margin * kg);
  tpl.gutter = Math.round(base.gutter * kg);
  const area = page.w * page.h;
  for (const s of tpl.slots) {
    s.poly = s.poly.map(([x, y]) => [r2(x * kx + offX), r2(y * ky + offY)]);
    s.x = r2(s.x * kx + offX);
    s.y = r2(s.y * ky + offY);
    s.w = r2(s.w * kx);
    s.h = r2(s.h * ky);
    s.aspect = s.h ? r2(s.w / s.h) : s.aspect;
    if (s.area != null) s.area = r2((s.w * s.h / area) * 100);
  }
  return tpl;
}

/** 把某一页改到目标画幅；w/h 省略时按预设比例算（保持原页宽） */
function applyPageSize(w, h, mode = 'stretch') {
  const base = state.tplBase;
  if (!base) { toast('还没载入模板'); return; }
  const cur = state.tpl?.page || base.page;
  let W = Number(w);
  let H = Number(h);
  if (!(W > 0) || !(H > 0)) return;
  W = clamp(W, 200, 8000);
  H = clamp(H, 200, 12000);

  // 气泡是用户内容，按「当前画幅 → 目标画幅」整体映射
  const bsx = W / cur.w;
  const bsy = H / cur.h;
  const bk = mode === 'fit' ? Math.min(bsx, bsy) : null;
  const bkx = bk ?? bsx;
  const bky = bk ?? bsy;
  const bOffX = bk ? (W - cur.w * bk) / 2 : 0;
  const bOffY = bk ? (H - cur.h * bk) / 2 : 0;
  for (const b of state.bubbles) {
    b.x = r2(b.x * bkx + bOffX);
    b.y = r2(b.y * bky + bOffY);
  }

  state.tpl = deriveTpl(base, W, H, mode);
  state.pageSize = { w: Math.round(W), h: Math.round(H), mode };
  commit();
  renderStage();
  renderSlotPanel();
  renderBubbles();
  renderScript();
  renderExportKv(); syncSizeUI();
  savePage();
  queueSave();
}

/** 恢复成模板自带的画幅 */
function resetPageSize() {
  if (!state.tplBase) return;
  const base = state.tplBase;
  const cur = state.tpl?.page || base.page;
  for (const b of state.bubbles) {
    b.x = r2(b.x * (base.page.w / cur.w));
    b.y = r2(b.y * (base.page.h / cur.h));
  }
  state.tpl = JSON.parse(JSON.stringify(base));
  state.pageSize = null;
  commit();
  renderStage();
  renderSlotPanel();
  renderBubbles();
  renderScript();
  renderExportKv(); syncSizeUI();
  savePage();
  queueSave();
  syncSizeUI();
}

/** 画幅/尺寸这几处 UI 跟着当前状态走 */
function syncSizeUI() {
  const sel = $('#pageRatio');
  const pg = state.tpl?.page;
  const sz = state.pageSize;
  if ($('#pageSizeKv') && pg) {
    const ratio = (pg.w / pg.h).toFixed(2);
    const long = Math.max(pg.w, pg.h);
    $('#pageSizeKv').innerHTML = `
      <div><span>页面尺寸</span><b>${pg.w} × ${pg.h} px</b></div>
      <div><span>宽高比</span><b>${ratio} : 1${sz ? (sz.mode === 'fit' ? ' · 等比留白' : ' · 拉伸铺满') : ' · 模板原样'}</b></div>
      <div><span>导出后</span><b>${state.exportWidth} × ${Math.round((state.exportWidth * pg.h) / pg.w)} px</b></div>
      <div><span>长边</span><b>${long} px（模板坐标）</b></div>`;
  }
  if (sel && sz) {
    const hit = Object.entries(RATIO_PRESETS).find(([, [a, b]]) =>
      Math.abs(pg.w / pg.h - a / b) < 0.01);
    sel.value = hit ? hit[0] : 'custom';
  } else if (sel) {
    sel.value = 'keep';
  }
  const row = $('#customSizeRow');
  if (row) row.classList.toggle('hidden', sel?.value !== 'custom');
  if ($('#pageW') && pg) $('#pageW').value = pg.w;
  if ($('#pageH') && pg) $('#pageH').value = pg.h;
  if ($('#chkFitPage')) $('#chkFitPage').checked = sz?.mode === 'fit';
  $$('#sizeChips .fchip').forEach((c) => c.classList.toggle('on', Number(c.dataset.w) === state.exportWidth));
}

/** ?dbg=1 用的调试钩子：测试和排查画幅/格位时方便 */
window.__pfSize = () => ({
  w: state.tpl?.page?.w || 0,
  h: state.tpl?.page?.h || 0,
  mode: state.pageSize?.mode || null,
  custom: !!state.pageSize,
  exportWidth: state.exportWidth,
  slots: (state.tpl?.slots || []).map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
});

function renderStage() {
  if (!state.tpl) return;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const t0 = perfNow();
    const tpl = state.tpl;
    let svg = '';
    try {
      svg = renderTemplateSVG(tpl, {
        width: 1200,
        images: state.hollow ? {} : state.images,
        selectedId: state.hollow ? null : state.selectedId,
        hoverId: state.hoverId,
        showNumbers: state.showLabels,
        showRoles: state.showLabels,
        slotOutline: true,
        overlays: state.bubbles,
        selectedBubbleId: state.selBubble,
        uiAccent: currentTint(),
      });
    } catch (err) {
      // 以前这里一抛错整块画布就空白/半渲染，看不出原因；现在直接把错误说出来
      const holder = $('#canvas');
      if (holder) {
        holder.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'stage-empty';
        box.style.pointerEvents = 'auto';
        box.innerHTML = '<p>这一套渲染出错了</p>'
          + `<p class="muted">${escapeHtml(err.message || String(err))}</p>`
          + `<p class="muted">模板 ${escapeHtml(tpl.id)} · 换一套版式，或把这句话发给我</p>`;
        const btn = document.createElement('button');
        btn.className = 'btn tiny';
        btn.textContent = '复错误信息';
        btn.addEventListener('click', () => copyText(`${tpl.id}: ${err.message}`, '错误信息已复制'));
        box.appendChild(btn);
        holder.appendChild(box);
      }
      console.error('[PanelForge] 渲染失败', err);
      return;
    }
    const holder = $('#canvas');
    holder.innerHTML = svg;
    queueSave();
    if (state.pageEnter) {
      state.pageEnter = false;
      replay(holder, 'page-enter');
      // 动画放完必须摘掉类，否则每次重绘 SVG 都会重放整页入场 → 切格子时整页闪
      clearTimeout(pageEnterTimer);
      pageEnterTimer = setTimeout(() => holder.classList.remove('page-enter'), 900);
    }
    const el = holder.querySelector('svg');
    if (el) el.addEventListener('dblclick', onCanvasDblClick);
    perfDone('render', t0);
    // 镂空模式要说清楚：图片是故意藏起来，不是丢了
    const foot = $('#footMsg');
    if (foot) {
      if (DBG) {
        // ?dbg=1：底栏归调试信息，别让入场动画的回调把它冲掉
        showDbgLine();
      } else {
        foot.textContent = state.hollow
          ? '镂空模式：只显示格线，图片被隐藏 —— 关掉「镂空」就能看到图片'
          : '拖图片进画布即可填充（自动裁切到格子形状，斜切格也不会变形）';
        $('#stageFoot')?.classList.toggle('warn', state.hollow);
      }
    }
  });
}

/* ================================================================== *
 * 交互：选格 / 拖图 / 平移 / 缩放 / 粘贴
 * ================================================================== */
let drag = null;

function pagePoint(ev) {
  const svg = $('#canvas svg');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  return {
    x: ((ev.clientX - r.left) / r.width) * state.tpl.page.w,
    y: ((ev.clientY - r.top) / r.height) * state.tpl.page.h,
  };
}

function slotAt(pt) {
  if (!pt || !state.tpl) return null;
  const slots = [...state.tpl.slots].sort((a, b) => (a.over === b.over ? 0 : a.over ? -1 : 1));
  for (const s of slots) if (pointInPoly([pt.x, pt.y], s.poly)) return s;
  return null;
}

/* ---------------- 手机双击：震动 + 进这一格的编辑页 ---------------- */
const DTAP_MS = 340;        // 两次点击间隔小于这个算双击
const DTAP_SLOP = 10;       // 两次点击位置允许的偏差（px）

function haptic(ms = 18) {
  // Android Chrome 支持；iOS Safari 没有 vibrate，静默跳过（靠视觉反馈兜底）
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

function lpPulse() {
  document.body.classList.add('pf-lp');
  clearTimeout(lpPulse._t);
  lpPulse._t = setTimeout(() => document.body.classList.remove('pf-lp'), 320);
}

// 生图超时：Seedream/Flux 排队 1–2 分钟是常态，默认给 120s；?imgtimeout=毫秒 可临时改（测试用）
const IMG_TIMEOUT_MS = Number(new URLSearchParams(location.search).get('imgtimeout')) || 120000;
const LLM_TIMEOUT_MS = 60000;    // 文本：60s 还没回来基本就是挂了

/** 双击某一格：震动 → 选中它 → 进编辑页 */
function fireDoubleTap(slot) {
  haptic(22);
  // 注意：这里**不要**再调 lpPulse()。它会临时给 #canvas svg 加 scale(1.015)，
  // 而进编辑页是一次 0.7s 的 FLIP 放大 —— 两个 transform 打架就会"闪一下"。
  state.selectedId = slot.id;
  state.selBubble = null;
  renderStage();
  renderSlotPanel();
  // 缩放条位置由「画布重绘观察器」自动跟随，这里不需要再手动同步
  setView('edit', { animate: true });
  const order = state.tpl?.slots?.find((x) => x.id === slot.id)?.order;
  toast(`双击进入第 ${order ?? '?'} 格的编辑`);
}

/** 判断这一下是不是"同一格的第二次点" */
function noteTap(slot, ev) {
  if (!slot || ev.pointerType === 'mouse') return false;   // 鼠标走 dblclick
  const now = Date.now();
  const last = state._lastTap;
  const same = last && last.id === slot.id && now - last.t < DTAP_MS
    && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < DTAP_SLOP;
  if (same) { state._lastTap = null; return true; }
  state._lastTap = { id: slot.id, t: now, x: ev.clientX, y: ev.clientY };
  clearTimeout(noteTap._clear);
  noteTap._clear = setTimeout(() => { state._lastTap = null; }, DTAP_MS + 60);
  return false;
}

/**
 * 逃生门：界面看起来"卡死"时一键复位。
 * 只清「进行中」的临时状态和浮层，不动用户的内容（图片/台词/草稿都不碰）。
 */
window.__pfUnstick = () => {
  const before = {
    imgJobs: Object.keys(state.imgJobs || {}).length,
    overlays: ['#dangerSheet', '#charConfirm', '#lightbox', '#ctxMenu', '#shortcuts', '#keysheet'].filter((sel) => {
      const el = $(sel);
      return el && !el.classList.contains('hidden');
    }).length,
  };
  state.imgJobs = {};
  state.autoStop = true;
  // 关浮层
  for (const sel of ['#dangerSheet', '#charConfirm', '#lightbox', '#ctxMenu', '#shortcuts', '#keysheet', '#railPop']) {
    $(sel)?.classList.add('hidden');
  }
  document.querySelectorAll('.rail-pop').forEach((p) => p.classList.add('hidden'));
  // 复所有被禁用的按钮（只放开 disabled，不改文案）
 $$('button[disabled]').forEach((b) => {
    if (b.id === 'dangerGo' || b.dataset.keepDisabled) return;
    b.disabled = false;
  });
  try { refreshGenButtons(); renderSlotPanel(); renderStage(); } catch { /* ignore */ }
  toast('已复位：清掉进行中标记、关掉浮层（你的内容没动）');
  return before;
};

function bindUI() {
  const canvas = $('#canvas');

  canvas.addEventListener('pointerdown', (ev) => {
    if (!state.tpl) return;
    const pt = pagePoint(ev);
    const bub = bubbleAt(pt);
    if (bub) {
      if (document.body.dataset.view === 'edit') setEditMod('bubble');
      state.selBubble = bub.id;
      drag = { bubble: bub, moved: false, x0: ev.clientX, y0: ev.clientY };
      renderStage();
      renderBubbleInspector();
      try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* 指针已失效时忽略 */ }
      return;
    }
    if (state.hollow) { toast('镂空预览模式下不能填图，先关掉「镂空」'); return; }
    const slot = slotAt(pt);
    drag = { slot, moved: false, x0: ev.clientX, y0: ev.clientY, start: pt };
    if (slot) try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* 指针已失效时忽略 */ }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!state.tpl) return;
    if (!drag) {
      // hover 高亮
      const slot = slotAt(pagePoint(ev));
      const id = slot ? slot.id : null;
      if (id !== state.hoverId) { state.hoverId = id; renderStage(); }
      return;
    }
    const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      document.body.classList.add('pf-dragging');
      if (drag.bubble || (drag.slot && state.images[drag.slot.id])) commit();
    }
    if (drag.moved && drag.bubble) {
      const svg = $('#canvas svg');
      const r = svg.getBoundingClientRect();
      const k = state.tpl.page.w / r.width;
      const b = drag.bubble;
      b.x = clamp(b.x + dx * k, -b.w * 0.5, state.tpl.page.w - b.w * 0.5);
      b.y = clamp(b.y + dy * k, -b.h * 0.5, state.tpl.page.h - b.h * 0.5);
      drag.x0 = ev.clientX;
      drag.y0 = ev.clientY;
      refreshBubble(b.id);
      return;
    }
    if (drag.moved && drag.slot && state.images[drag.slot.id]) {
      const svg = $('#canvas svg');
      const r = svg.getBoundingClientRect();
      const k = state.tpl.page.w / r.width;
      const img = state.images[drag.slot.id];
      img.panX += dx * k;
      img.panY += dy * k;
      drag.x0 = ev.clientX;
      drag.y0 = ev.clientY;
      refreshSlotImage(drag.slot.id);
    }
  });

  const endDrag = (ev) => {
    document.body.classList.remove('pf-dragging');
    if (!drag) return;
    if (drag.bubble) {
      if (!drag.moved) renderBubbleInspector();
      else { renderStage(); queueSave(); } // 松手把 translate 烘回标记，并落一次草稿
      drag = null;
      return;
    }
    if (!drag.moved) {
      const slot = drag.slot;
      // 手机：同一格连点两下 → 震动 + 进这一格的编辑页（长按会和系统菜单打架，已弃用）
      const isDouble = slot ? noteTap(slot, ev) : false;
      if (slot) { state.selectedId = slot.id; state.selBubble = null; renderStage(); renderSlotPanel(); renderBubbles(); }
      else { state.selectedId = null; state.selBubble = null; renderStage(); renderSlotPanel(); }
      drag = null;
      if (isDouble) fireDoubleTap(slot);
      return;
    }
    if (drag.slot) {
      // 拖动过程中走的是 patch 热路径（不存盘），松手这里才真正落一次草稿
      renderSlotPanel();
      queueSave();
    }
    drag = null;
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; document.body.classList.remove('pf-dragging'); });
  canvas.addEventListener('pointerleave', () => {
    if (state.hoverId) { state.hoverId = null; renderStage(); }
  });

  canvas.addEventListener('wheel', (ev) => {
    if (!state.tpl || state.hollow) return;
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey) return;
    const slot = slotAt(pagePoint(ev));
    if (!slot || !state.images[slot.id]) return;
    ev.preventDefault();
    const img = state.images[slot.id];
    img.zoom = clamp((img.zoom || 1) * (ev.deltaY < 0 ? 1.08 : 0.93), 0.3, 6);
    // 换格子要整页重绘（选中框跟着变），同一格内滚动只改属性
    if (state.selectedId !== slot.id) { state.selectedId = slot.id; renderSlotPanel(); renderStage(); }
    else refreshSlotImage(slot.id);
    syncZoomSlider();
    queueSave();
  }, { passive: false });

  // 拖拽文件
  canvas.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    if (!state.tpl) return;
    const slot = slotAt(pagePoint(ev));
    canvas.classList.add('dragover');
    if (slot) { state.hoverId = slot.id; renderStage(); }
  });
  canvas.addEventListener('dragleave', () => {
    canvas.classList.remove('dragover');
    state.hoverId = null; renderStage();
  });
  canvas.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    canvas.classList.remove('dragover');
    const files = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const slot = slotAt(pagePoint(ev));

    // 支持从浏览器拖入的图片 URL
    if (!files.length) return;
    if (files.length === 1 && slot) {
      await putImage(slot.id, files[0]);
    } else {
      const targets = state.tpl.slots.filter((s) => !state.images[s.id]);
      const list = targets.length ? targets : state.tpl.slots;
      for (let i = 0; i < Math.min(files.length, list.length); i++) {
        await putImage(list[i].id, files[i], { render: false });
      }
      state.selectedId = list[Math.min(files.length, list.length) - 1]?.id || state.selectedId;
      renderStage(); renderSlotPanel(); refreshScript();
      toast(`已填入 ${Math.min(files.length, list.length)} 格`);
    }
  });

  // 键盘
  window.addEventListener('keydown', (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;

    // Ctrl+Shift+Enter：AI 导演（先判断带 Shift 的组合，否则会被下面的规则匹配吃掉）
    if (mod && ev.shiftKey && k === 'Enter') { ev.preventDefault(); runAiDecide(); return; }
    // Ctrl+Enter：按规则匹配（输入框里也能用）
    if (mod && k === 'Enter') { ev.preventDefault(); runMatch(); return; }

    // 输入框里按 Esc：先退出输入（之后的单键快捷键才能用）
    if (typing && k === 'Escape') { document.activeElement.blur(); return; }
    if (typing) return;

    // ?：快捷键表（任何状态都能开）
    if (k === '?' || (ev.shiftKey && k === '/')) { ev.preventDefault(); toggleShortcuts(); return; }
    if (k === 'Escape') {
      if (!$('#shortcuts').classList.contains('hidden')) { toggleShortcuts(false); return; }
      state.selectedId = null; state.selBubble = null;
      renderStage(); renderSlotPanel();
      return;
    }
    if (!state.tpl) return;

    // ---- 撤销 / 重做 ----
    if (mod && lower === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo(); else undo();
      return;
    }
    if (mod && lower === 'y') { ev.preventDefault(); redo(); return; }

    // ---- 复制 / 剪切 / 粘贴 / 复制气泡 ----
    if (mod && lower === 'c') { ev.preventDefault(); copySelection(); return; }
    if (mod && lower === 'x') { ev.preventDefault(); cutSelection(); return; }
    if (mod && lower === 'v') { /* 交给 paste 事件处理系统剪贴板；内部剪贴板在下面兜底 */ }
    if (mod && lower === 'd') { ev.preventDefault(); duplicateBubble(); return; }
    if (mod && lower === 's') { ev.preventDefault(); exportPNG(); return; }

    // ---- 切换类 ----
    if (!mod && lower === 'g') { ev.preventDefault(); toggleCheck('#chkLabels'); return; }
    if (!mod && lower === 'h') { ev.preventDefault(); toggleCheck('#chkHollow'); return; }
    if (!mod && lower === 'p') { ev.preventDefault(); openPaint(); return; }   // 画这一格
    if (!mod && lower === 'e') {
      ev.preventDefault();
      if (ev.shiftKey) exportSVG(); else exportPNG();
      return;
    }
    if (!mod && lower === 'n') { ev.preventDefault(); jumpNextEmpty(); return; }

    // ---- 图片操作（选中格子有图时）----
    const img = state.selectedId ? state.images[state.selectedId] : null;
    if (!mod && lower === 'f' && img) {
      ev.preventDefault(); commit();
      img.mode = img.mode === 'contain' ? 'cover' : 'contain';
      renderStage(); renderSlotPanel();
      toast(img.mode === 'contain' ? '完整显示' : '填满裁切');
      return;
    }
    if (!mod && lower === 'r' && img) {
      ev.preventDefault(); commit();
      img.panX = 0; img.panY = 0; img.zoom = 1;
      syncZoomSlider(); renderStage(); renderSlotPanel();
      toast('图片已复位');
      return;
    }

    // ---- 格子导航 ----
    const idx = state.tpl.slots.findIndex((s) => s.id === state.selectedId);
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      ev.preventDefault();
      const dir = k === 'ArrowRight' ? 1 : -1;
      const next = state.tpl.slots[clamp(idx + dir, 0, state.tpl.slots.length - 1)];
      state.selectedId = next.id; state.selBubble = null;
      renderStage(); renderSlotPanel();
      return;
    }

    // ---- 气泡微调 / 尺寸 ----
    const bub = selectedBubble();
    if (bub && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      commitThrottled(300);
      if (k === 'ArrowUp') bub.y -= step;
      if (k === 'ArrowDown') bub.y += step;
      if (k === 'ArrowLeft') bub.x -= step;
      if (k === 'ArrowRight') bub.x += step;
      renderStage();
      return;
    }
    if (k === '[' || k === ']') {
      ev.preventDefault();
      const grow = k === ']';
      commitThrottled(250);
      if (bub) {
        const cx = bub.x + bub.w / 2, cy = bub.y + bub.h / 2;
        const f = grow ? 1.08 : 0.93;
        bub.w = Math.round((bub.baseW || bub.w) * ((bub.w / (bub.baseW || bub.w)) * f));
        bub.h = Math.round((bub.baseH || bub.h) * ((bub.h / (bub.baseH || bub.h)) * f));
        bub.x = Math.round(cx - bub.w / 2);
        bub.y = Math.round(cy - bub.h / 2);
        renderStage(); renderBubbles();
      } else if (img) {
        img.zoom = clamp((img.zoom || 1) * (grow ? 1.08 : 0.93), 0.3, 6);
        syncZoomSlider(); renderStage();
      }
      return;
    }

    // ---- 数字键：跳到第 N 格 ----
    if (!mod && /^[1-9]$/.test(k)) {
      const slot = state.tpl.slots[Number(k) - 1];
      if (slot) {
        ev.preventDefault();
        state.selectedId = slot.id; state.selBubble = null;
        renderStage(); renderSlotPanel();
      }
      return;
    }

    // ---- 删除 ----
    if (k === 'Delete' || k === 'Backspace') {
      if (bub) {
        ev.preventDefault(); commit(); deleteBubble();
        return;
      }
      if (state.selectedId && state.images[state.selectedId]) {
        ev.preventDefault(); commit();
        delete state.images[state.selectedId];
        renderStage(); renderSlotPanel();
        toast('已移除该格图片');
      }
      return;
    }

    // ---- 内部剪贴板粘贴（系统图片由 paste 事件处理）----
    if (mod && lower === 'v' && state.clipboard) {
      ev.preventDefault();
      pasteSelection();
    }
  });

  window.addEventListener('paste', async (ev) => {
    if (!state.tpl) return;
    const items = [...(ev.clipboardData?.items || [])];
    const imgs = items.filter((i) => i.type && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    // 和拖放用同一套落点规则：样图区 / 角色卡 / 当前格子
    if (inboxArea === 'sample' || document.activeElement?.closest?.('#styleFollow')) {
      ev.preventDefault();
      await addSamples(imgs);
      return;
    }
    if (inboxArea === 'char' || document.activeElement?.closest?.('.chars')) {
      ev.preventDefault();
      await addCharCard(imgs);
      return;
    }
    if (!state.selectedId) return;
    ev.preventDefault();
    await putImage(state.selectedId, imgs[0]);
  });

  // 顶栏 / 左栏
  $('#cultureTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    state.cultureTab = b.dataset.c;
    $$('#cultureTabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });
  $('#search').addEventListener('input', debounce(renderList, 160));
  $('#btnMatch').addEventListener('click', runMatch);
  // 第二个选择：让 AI 排戏（和「按规则匹配」并排；AI 关掉时这条隐藏）
  $('#btnMatchAi')?.addEventListener('click', () => runAiDecide());
  // 模板库的标签筛选
  $('#facetBar')?.addEventListener('click', (ev) => {
    if (ev.target.closest('#facetClear')) { clearFacet(); return; }
    const c = ev.target.closest('[data-facet]');
    if (c) setFacet(c.dataset.facet, c.dataset.val);
  });

  // 画布工具
  $('#btnFill').addEventListener('click', () => { $('#filePick').dataset.mode = 'fill'; $('#filePick').click(); });
  $('#btnDemo').addEventListener('click', demoFill);

  // AI 导演
  for (const id of ['llmProtocol', 'llmBase', 'llmKey', 'llmModel']) {
    $('#' + id).addEventListener('input', () => { saveLlm(); syncLlmStatus(); });
    $('#' + id).addEventListener('change', () => { saveLlm(); syncLlmStatus(); });
  }
  $('#btnLlmTest').addEventListener('click', testLlm);
  $('#btnLlmClear').addEventListener('click', clearLlm);
  $('#chkKeySession')?.addEventListener('change', () => { saveLlm(); syncLlmStatus(); });
  $('#btnAiDecide').addEventListener('click', runAiDecide);
  $('#btnClear').addEventListener('click', () => {
    if (!Object.keys(state.images).length) return;
    commit();
    state.images = {}; renderStage(); renderSlotPanel(); refreshScript(); toast('已清空全部图片');
  });
  $('#chkHollow').addEventListener('change', (ev) => { state.hollow = ev.target.checked; renderStage(); });
  $('#chkLabels').addEventListener('change', (ev) => { state.showLabels = ev.target.checked; renderStage(); });

  // 右栏 tabs
  $('#tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) activateTab(b.dataset.tab);
  });

  // 格子面板
  $('#btnPickImage').addEventListener('click', () => { $('#filePick').dataset.mode = 'slot'; $('#filePick').click(); });
  $('#btnPaint')?.addEventListener('click', () => openPaint());
  // 标题行那个「绘制」永远可见：图片段被收起时也能进画
  $('#btnPaintTop')?.addEventListener('click', () => openPaint());
  $('#btnRemoveImage').addEventListener('click', () => {
    if (!state.selectedId) return;
    commit();
    delete state.images[state.selectedId];
    renderStage(); renderSlotPanel(); toast('已移除');
  });
  $('#btnUrl').addEventListener('click', importByUrl);
  $('#btnExportSlot')?.addEventListener('click', () => exportSlotImage());
  $('#zoom').addEventListener('input', (ev) => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commitThrottled(600);
    img.zoom = Number(ev.target.value) / 100;
    $('#zoomVal').textContent = ev.target.value + '%';
    refreshSlotImage(state.selectedId);
    queueSave();
  });
  $('#btnFitMode').addEventListener('click', () => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commit();
    img.mode = img.mode === 'contain' ? 'cover' : 'contain';
    renderSlotPanel(); refreshSlotImage(state.selectedId); queueSave();
    toast(img.mode === 'contain' ? '完整显示（可留白）' : '填满格子（裁切）');
  });
  $('#btnResetPan').addEventListener('click', () => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commit();
    img.panX = 0; img.panY = 0; img.zoom = 1;
    syncZoomSlider(); refreshSlotImage(state.selectedId); queueSave(); toast('已复位');
  });
  $('#btnCopyPrompt').addEventListener('click', () => {
    if (state.selectedId) copyText(effectivePrompt(state.selectedId).prompt, '提示词已复制');
  });
  $('#btnCopyShape').addEventListener('click', copyShapePrefix);
  $('#btnCopyShapeZh')?.addEventListener('click', copyShapePrefixZh);
  $('#btnUseSuggest')?.addEventListener('click', () => {
    const txt = state._suggest || '';
    if (!txt || !state.selectedId) return;
    commit();
    const el = $('#slotLine');
    el.value = el.value.trim() ? el.value.replace(/\s+$/, '') + '\n' + txt : txt;
    state.lines[state.selectedId] = el.value;
    saveLines(); queueSave?.();
    syncSuggest(); syncSecSummary();
    toast('已填进本格句子（可撤销）');
  });
  // 生图提示词：可编辑
  $('#slotPrompt').addEventListener('input', (ev) => {
    if (!state.selectedId) return;
    commitThrottled(900);
    setPromptEdit(state.selectedId, 'prompt', ev.target.value);
    syncPromptMeta();
    syncSecSummary(); renderScriptSoon();
  });
  $('#slotNegative').addEventListener('input', (ev) => {
    if (!state.selectedId) return;
    commitThrottled(900);
    setPromptEdit(state.selectedId, 'negative', ev.target.value);
    syncPromptMeta();
    syncSecSummary();
  });
  $('#btnPromptReset').addEventListener('click', () => {
    if (!state.selectedId) return;
    commit();
    delete state.promptEdits[state.selectedId];
    delete state.promptSrc[state.selectedId];
    delete state.promptPrefix[state.selectedId];
    queueSave?.();
    renderSlotPanel(); renderScript();
    toast('已恢复自动生成的提示词');
  });
  // 提示词来源：规则切分 / AI 生成 / 自己写 —— 三份共存，一键切
  $('#promptSrc')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-src]');
    if (!b || !state.selectedId) return;
    const src = b.dataset.src;
    if (src === 'ai' && !effectivePrompt(state.selectedId).hasAi) {
      toast('这一格还没有 AI 版提示词：先点「AI 切原文」或「AI 优化提示词」');
      return;
    }
    commit();
    state.promptSrc[state.selectedId] = src;
    // 从「自己写」切回自动时，保留草稿但不参与出图（切回来还在）
    if (src === 'mine') {
      const ta = $('#slotPrompt');
      const cur = state.promptEdits[state.selectedId]?.prompt;
      if (cur == null && ta) setPromptEdit(state.selectedId, 'prompt', ta.value || '');
    }
    syncPromptMeta();
    syncSecSummary(); renderScript();
    queueSave?.();
    toast({ rule: '用规则切分的提示词', ai: '用 AI 生成的提示词', mine: '自己写这一格的提示词' }[src] || '');
  });
  // 开头词（构图前缀）开关：自己写的时候也保留在最前
  $('#chkPrefix')?.addEventListener('change', (ev) => {
    if (!state.selectedId) return;
    commit();
    state.promptPrefix[state.selectedId] = ev.target.checked;
    syncPromptMeta();
    syncSecSummary(); renderScript();
    queueSave?.();
  });
  $('#slotPromptSent').closest('details')?.addEventListener('toggle', syncPromptMeta);
  $('#btnKeyMgr')?.addEventListener('click', openKeySheet);
  $('#btnKeySheetClose')?.addEventListener('click', closeKeySheet);
  $('#keySheet')?.addEventListener('click', (ev) => { if (ev.target.id === 'keySheet') closeKeySheet(); });
  $('#ksPreset')?.addEventListener('change', (ev) => {
    const p = KEY_PRESETS[ev.target.value];
    if (!p) return;
    $('#ksProtocol').value = p.protocol;
    $('#ksBase').value = p.baseUrl;
    $('#ksModel').value = p.model;
    if ('imgModel' in p) $('#ksImgModel').value = p.imgModel || '';
    if ('imgProvider' in p) $('#ksImgProvider').value = p.imgProvider || 'openai';
    // 每个服务商一句话提示（模型名/版本段各不相同，写死在选项里就会互相误导）
    const baseHint = $('#ksBaseHint');
    if (baseHint) {
      const hints = [];
      if (/\/api\/v\d/.test(p.baseUrl)) hints.push('这个服务商的版本段在 /api/v3，不是 /v1');
      if (p.imgHint) hints.push(p.imgHint);
      if (p.name === '自定义') hints.push('Base URL 填到 OpenAI 兼容的版本段为止（如 https://host/v1），模型填真实 model id');
      baseHint.textContent = hints.join('；');
      baseHint.classList.toggle('hidden', !hints.length);
    }
    // 填完自动把「模型」这一栏高亮一下，避免只改 Base URL 忘了改模型
    $('#ksModel')?.classList.add('needs-check');
    setTimeout(() => $('#ksModel')?.classList.remove('needs-check'), 1600);
  });
  $('#ksList')?.addEventListener('click', (ev) => {
    const item = ev.target.closest('.ks-item');
    if (!item) return;
    const id = item.dataset.id;
    const entry = state.keys.entries.find((e) => e.id === id);
    const act = ev.target.closest('button')?.dataset.act;
    if (act === 'use') {
      state.keys.activeId = id; saveKeyStore();
      applyKeyEntry(entry); renderKeyStatus(); renderKeySheet();
      toast('已切换到 ' + entry.name);
    } else if (act === 'edit') {
      state._editingKeyId = id;
      fillKeyForm(entry);
      $('#ksMsg').textContent = '正在编辑「' + entry.name + '」，改完点保存';
    } else if (act === 'del') {
      if (!confirm('删掉「' + entry.name + '」的 Key？')) return;
      state.keys.entries = state.keys.entries.filter((e) => e.id !== id);
      if (state.keys.activeId === id) state.keys.activeId = state.keys.entries[0]?.id || null;
      saveKeyStore();
      const next = activeKeyEntry();
      if (next) applyKeyEntry(next); else { state.llm = { protocol: 'openai', baseUrl: '', apiKey: '', model: '' }; syncLlmStatus(); }
      renderKeyStatus(); renderKeySheet();
    }
  });
  $('#ksTest')?.addEventListener('click', async () => {
    const btn = $('#ksTest'); const old = btn.textContent;
    btn.disabled = true; btn.textContent = '测试中…';
    $('#ksMsg').textContent = '正在请求对话模型…';
    try {
      const r = await api.llmTest({ llm: formEntry() });
      if (r?.ok) {
        $('#ksMsg').textContent = '✅ 对话模型通了 · ' + (r.model || '') + ' · ' + (r.latencyMs || '?') + 'ms';
        state._lastTestOk = true;
      } else {
        const where = r?.endpoint ? ` · POST ${String(r.endpoint).replace(/^https?:\/\//, '')} · model=${r.model || '?'}` : '';
        // 明确说这是「对话」失败 —— 生图是另一条链路，用另一把 Key，不受影响
        $('#ksMsg').textContent = '❌ 对话模型失败（不影响生图）：' + (r?.error || '失败') + where + (r?.hint ? ' · ' + r.hint : '');
        state._lastTestOk = false;
      }
    } catch (e) {
      $('#ksMsg').textContent = '❌ 对话模型失败：' + e.message;
      state._lastTestOk = false;
    } finally { btn.disabled = false; btn.textContent = old; }
  });

  /**
   * 只测生图：真的生成一张 512×512 小图（约 0.02 元），用来确认生图这条链路。
   * 和「测试对话」完全分开 —— 文本用哪家、生图用哪家互不影响。
   */
  $('#ksTestImg')?.addEventListener('click', async () => {
    const entry = formEntry();
    const model = entry.imgModel || '(未填生图模型)';
    if (!confirm(`会用生图模型 ${model} 真实生成一张小图（约 0.02 元），继续吗？`)) return;
    const btn = $('#ksTestImg'); const old = btn.textContent;
    btn.disabled = true; btn.textContent = '生成中…';
    $('#ksMsg').textContent = '正在调用生图接口…';
    const t0 = Date.now();
    try {
      const r = await api.imageGenerate({
        prompt: 'a simple red circle on white background, minimal',
        size: '512x512',
        model: entry.imgModel,
        provider: entry.imgProvider,
        llm: entry,
      });
      if (r?.ok) {
        const host = r.endpointHost || '?';
        $('#ksMsg').textContent = `✅ 生图通了 · ${host} · ${r.model || model} · 请求尺寸 ${r.size || '?'} · ${Date.now() - t0}ms`
          + (r.refsUsed ? ` · 带 ${r.refsUsed} 张参考图` : '');
        state._lastImgTestOk = true;
      } else {
        $('#ksMsg').textContent = '❌ 生图失败：' + (r?.error || '失败') + (r?.hint ? ' · ' + r.hint : '');
        state._lastImgTestOk = false;
      }
    } catch (e) {
      $('#ksMsg').textContent = '❌ 生图失败：' + e.message;
      state._lastImgTestOk = false;
    } finally { btn.disabled = false; btn.textContent = old; syncImgReady(); }
  });
  // 生图这些字段一变就刷新「生图就绪」提示（它和对话模型是两条独立链路）
  ['ksImgProvider', 'ksImgModel', 'ksImgBase', 'ksImgKey', 'ksBase', 'ksKey'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', syncImgReady);
    el.addEventListener('change', syncImgReady);
  });
  syncImgReady();
  $('#ksSave')?.addEventListener('click', () => {
    const e = formEntry();
    // 允许「只有生图配置」：文本用不上 AI 的人不该被对话 Key 拦住
    const hasChat = e.apiKey && e.baseUrl;
    const hasImg = e.imgKey && (e.imgBaseUrl || e.baseUrl) && e.imgModel;
    if (!hasChat && !hasImg) {
      $('#ksMsg').textContent = '至少配一条：对话（Base URL + API Key）或生图（生图模型 + Key）';
      return;
    }
    if (state._lastTestOk || state._lastImgTestOk) e.verifiedAt = Date.now();
    upsertKey(e);
    state._editingKeyId = null;
    $('#ksMsg').textContent = e.verifiedAt
      ? '已保存并验证，可以开始用了'
      : (hasChat ? '已保存（对话未验证，可以点「测试对话」）' : '已保存生图配置（可直接用「生这一格」）');
    toast('已保存 Key：' + e.name);
  });
  initSlotSections();
  bindPanelSheet();
  applyLayout();
  $('#slotAiMode')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-m]');
    if (!b) return;
    state.slotAiMode = b.dataset.m;
    for (const x of document.querySelectorAll('#slotAiMode button')) x.classList.toggle('on', x === b);
    refreshGenButtons();
  });
  $('#btnAiImage')?.addEventListener('click', () => {
    if (state.slotAiMode === 'prompt') generateSlotPromptOnly();
    else generateSlotImage();
  });
  // AI 写台词：单格 / 换一句 / 整页
  $('#btnAiLine')?.addEventListener('click', () => aiWriteLines('one'));
  $('#btnAiLineReroll')?.addEventListener('click', () => aiWriteLines('again'));
  $('#btnAiLinesPage')?.addEventListener('click', () => aiWriteLines('page'));
  $('#btnCharPick')?.addEventListener('click', () => $('#charFiles').click());
  $('#charFiles')?.addEventListener('change', async (ev) => {
    const files = ev.target.files;
    if (files && files.length) await addCharCard(files);
    ev.target.value = '';
  });
  $('#charList')?.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.char-item');
    if (!item) return;
    const id = item.dataset.id;
    const act = ev.target.closest('button')?.dataset.act;
    if (act === 'toggle') {
      const i = state.activeChars.indexOf(id);
      if (i >= 0) state.activeChars.splice(i, 1);
      else state.activeChars.push(id);
      renderChars(); queueSave();
    } else if (act === 'del') {
      state.chars = state.chars.filter((c) => c.id !== id);
      state.activeChars = state.activeChars.filter((x) => x !== id);
      await saveChars(); renderChars(); queueSave();
    }
  });
  $('#btnCharClearAll')?.addEventListener('click', async () => {
    if (!confirm('清空所有角色卡？参考图会一起删掉。')) return;
    state.chars = []; state.activeChars = [];
    await saveChars(); renderChars(); queueSave();
  });
  $('#btnCharExport')?.addEventListener('click', exportChars);
  $('#btnCharImport')?.addEventListener('click', () => $('#charImportFile').click());
  $('#charImportFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) await importChars(f);
    ev.target.value = '';
  });
  $('#btnResetDraft')?.addEventListener('click', async () => {
    if (!confirm('清空本机草稿？所有页的图片、气泡和句子都会删掉，不能恢复。')) return;
    await idbSet('pages', null);
    // 图片是分页单独存的，清草稿要连它们一起删，否则几 MB 会一直占着
    for (const pg of state.pages) if (pg.id) await idbSet('img:' + pg.id, null);
    savedImageSigs.clear();
    state.pages = [{ tplId: state.tpl?.id || 'ref-4band-2col', name: '第 1 页', images: {}, bubbles: [], lines: {} }];
    state.pageIdx = 0; state.images = {}; state.bubbles = []; state.lines = {}; state.cands = {}; state.promptEdits = {};
    resetHistory(); renderStage(); renderSlotPanel(); renderBubbles(); renderScript(); renderPageTabs();
    toast('草稿已清空');
  });
  $('#candGrid')?.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) {
      ev.stopPropagation();
      const list = candsOf(state.selectedId);
      list.splice(Number(del.dataset.del), 1);
      renderCands();
      return;
    }
    const edit = ev.target.closest('[data-edit]');
    if (edit) {
      ev.stopPropagation();
      applyCandAndEdit(Number(edit.dataset.edit));
      return;
    }
    const b = ev.target.closest('.cand');
    if (b) applyCand(Number(b.dataset.i));
  });
  $('#btnCandNext')?.addEventListener('click', () => {
    const list = state.selectedId ? candsOf(state.selectedId) : [];
    if (list.length < 2) { toast('候选还不够，再生一张吧'); return; }
    applyCand(Math.floor(Math.random() * list.length));
  });
  $('#btnCandClear')?.addEventListener('click', () => {
    if (state.selectedId) state.cands[state.selectedId] = [];
    renderCands();
  });
  $('#pageTabs')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('.pb-tab');
    if (b) switchPage(Number(b.dataset.i));
  });
  $('#pageTabs')?.addEventListener('dblclick', (ev) => {
    const b = ev.target.closest('.pb-tab');
    if (b) { ev.preventDefault(); renamePage(Number(b.dataset.i)); }
  });
  $('#btnAddPage')?.addEventListener('click', addPage);
  $('#btnExportAll')?.addEventListener('click', exportAllPages);
  $('#charSheet').addEventListener('input', debounce(saveLlm, 400));
  $('#btnAiPrompts').addEventListener('click', runAiPrompts);
  $('#btnAiSplit')?.addEventListener('click', runAiSplit);

/* ================================================================== *
 * 全自动模式
 *   off    关闭（原来的左栏：剧情 → 分镜）
 *   story  分镜全自动：粘贴全文 → 我们决定页数/切格/提示词
 *   full   真正全自动：再加上台词、气泡、以及批量出图
 *
 * 三条铁律（用户明确要求）：
 *   1. 花钱的动作必须先弹确认，勾选「我已知晓」才能继续；全部页还要二次确认
 *   2. 确认里必须写明「一旦开始就不会中途停」以及大概多少钱
 *   3. 全自动的所有动作都要在前台可见（每一步打进日志），且随时能停
 * ================================================================== */
const AUTO_KEY = 'pf.auto';

/** 危险确认：返回 Promise<boolean>，必须勾选才能点「继续」 */
function confirmDanger({ title, body, images = 0, llmCalls = 0 }) {
  return new Promise((res) => {
    const sheet = $('#dangerSheet');
    if (!sheet) { res(false); return; }
    $('#dangerTitle').textContent = title;
    const bodyEl = $('#dangerBody');
    bodyEl.innerHTML = body;
    const ack = $('#dangerAck');
    const go = $('#dangerGo');
    if (ack) ack.checked = false;
    if (go) go.disabled = true;
    const cost = estimateCostHint({ images, llmCalls });
    const tip = document.createElement('div');
    tip.className = 'danger-cost';
    tip.textContent = cost.text;
    bodyEl.appendChild(tip);
    sheet.classList.remove('hidden');

    const close = (val) => {
      sheet.classList.add('hidden');
      sheet.removeEventListener('click', onClick);
      ack?.removeEventListener('change', onAck);
      go?.removeEventListener('click', onGo);
      res(val);
    };
    const onAck = () => { if (go) go.disabled = !ack.checked; };
    const onGo = () => { if (!ack?.checked) return; close(true); };
    const onClick = (ev) => {
      if (ev.target === sheet || ev.target.closest('[data-cancel]') || ev.target.closest('[data-cancel2]')) close(false);
    };
    ack?.addEventListener('change', onAck);
    go?.addEventListener('click', onGo);
    sheet.addEventListener('click', onClick);
  });
}

function autoLog(line, kind = '') {
  const box = $('#autoLog');
  if (!box) return;
  box.classList.remove('hidden');
  const row = document.createElement('div');
  row.className = 'al-row' + (kind ? ' al-' + kind : '');
  row.textContent = line;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function autoText() {
  return ($('#autoText')?.value || '').trim();
}

function autoEstimate() {
  const text = autoText();
  if (!text) { toast('先把全文粘进来'); return null; }
  const est = estimateLayout(text);
  const st = $('#autoStat');
  if (st) {
    st.textContent = est.note;
    st.dataset.pages = String(est.pages);
    st.dataset.panels = String(est.panels);
  }
  return est;
}

/** 切换全自动模式：换左栏内容 + 显示悬浮按钮 */
function setAutoMode(mode, opts = {}) {
  const m = ['off', 'story', 'full'].includes(mode) ? mode : 'off';
  state.autoMode = m;
  const root = document.documentElement;
  if (m === 'off') delete root.dataset.auto; else root.dataset.auto = m;
  const autoCard = $('#autoCard');
  const plotBox = $('#plot')?.closest('.card') || null;
  // 注意：两块是**并列的卡片**。曾经把全自动面板塞进剧情卡片里再隐藏卡片，面板跟着一起消失（bug）
  if (autoCard) autoCard.classList.toggle('hidden', m === 'off');
  if (plotBox) plotBox.classList.toggle('hidden', m !== 'off');
  $$('#autoSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.auto || 'off') === m));
  // 指示条要按模式变色：把当前模式写进 data-mode（纯 CSS 无法知道哪个按钮是激活态）
  const segEl = $('#autoSeg');
  if (segEl) segEl.dataset.mode = m;
  const name = $('#autoModeName');
  const title = $('#autoModeTitle');
  const desc = $('#autoModeDesc');
  if (name) name.textContent = m === 'full' ? '真正全自动' : '分镜自动';
  if (title) title.textContent = m === 'full' ? '真正全自动' : '分镜自动';
  if (desc) {
    desc.textContent = m === 'full'
      ? '从分镜、提示词、出图到台词与气泡全由 AI 完成，全程前台可见、随时可停'
      : '决定画几页、每页怎么切；你只改提示词和男女主形象';
  }
  const stack = $('#fabStack');
  if (stack) stack.classList.toggle('hidden', m === 'off');
  if (!opts.silent) store.set(AUTO_KEY, m === 'off' ? null : m);
}

/* ---------------- 批量出图（悬浮按钮） ---------------- */
async function currentPagePanels() {
  savePage();
  const page = pagePlan();
  return page?.panels || (state.tpl?.slots || []).map((sl) => ({ id: sl.id }));
}

/** 生成当前页所有还没有图的格子 */
async function genPageImages() {
  const panels = await currentPagePanels();
  const queue = imageQueueForPage(panels, state.images || {});
  if (!queue.length) { toast('这一页每格都有图了'); return 0; }
  const ok = await confirmDanger({
    title: '生成这一页的 ' + queue.length + ' 张图',
    body: '<ul class="danger-list">'
      + '<li><b>一键生成该页</b>：把这一页每个还没图的分镜依次生成</li>'
      + '<li>用的就是<b>每格现在的提示词</b> —— 你手改过的、规则生成的，都按原样发出去，'
      + '<b>不会</b>先做 AI 优化（要 AI 优化请用顶栏「全自动」）</li>'
      + '<li>点了就会一路做完，中途不会停（关掉页面会中断，但已发出的请求照样扣费）</li>'
      + '<li>每张图都会进候选，不满意的可以单独换</li>'
      + '</ul>',
    images: queue.length,
  });
  if (!ok) return 0;
  return runImageQueue(queue.map((slotId) => ({ page: state.pageIdx, slotId })), '这一页');
}

/** 生成全部页所有还没有图的格子（二次确认） */
async function genAllImages() {
  savePage();
  const pagesOfPanels = [];
  for (let i = 0; i < state.pages.length; i++) {
    if (i === state.pageIdx) { pagesOfPanels.push(pagePlan()?.panels || []); continue; }
    const tpl = await api.template(state.pages[i].tplId).catch(() => null);
    pagesOfPanels.push((tpl?.slots || []).map((sl) => ({ id: sl.id })));
  }
  const imagesByPage = state.pages.map((pg, i) => (i === state.pageIdx ? (state.images || {}) : (pg.images || {})));
  const queue = imageQueueAll(pagesOfPanels, imagesByPage);
  if (!queue.length) { toast('所有页面都有图了'); return 0; }
  const pagesTouched = new Set(queue.map((q) => q.page)).size;

  const first = await confirmDanger({
    title: '生成全部 ' + queue.length + ' 张图（跨 ' + pagesTouched + ' 页）',
    body: '<ul class="danger-list">'
      + '<li><b>一键生成全部分镜</b>：共 <b>' + state.pages.length + ' 页</b>，其中 <b>' + pagesTouched + ' 页</b>缺图，共 <b>' + queue.length + ' 张</b></li>'
      + '<li>用的是<b>每格现有提示词</b>（含你手改过的），<b>不会</b>先做 AI 优化</li>'
      + '<li><b>开始后不会停</b>，直到这 ' + queue.length + ' 张全部跑完</li>'
      + '<li>会花掉大量 token / 额度，这是本项目里最贵的一个按钮</li>'
      + '</ul>',
    images: queue.length,
  });
  if (!first) return 0;

  const second = await confirmDanger({
    title: '你真的确定吗？',
    body: '<div class="danger-big">' + state.pages.length + ' 页 · ' + queue.length + ' 张图</div>'
      + '<ul class="danger-list">'
      + '<li>这是最终确认，点「继续」后立刻开始扣费</li>'
      + '<li>想反悔只有「停止」按钮（当前这张会跑完，后面的不再发）</li>'
      + '</ul>',
    images: queue.length,
  });
  if (!second) return 0;
  return runImageQueue(queue, '全部页');
}

/** 顺序跑队列：一次一张，失败重试 1 次，随时可停 */
async function runImageQueue(queue, scopeLabel = '') {
  state.autoStop = false;
  const btnStop = $('#btnAutoStop');
  if (btnStop) btnStop.disabled = false;
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  autoLog('▶ 开始生成' + scopeLabel + '：' + queue.length + ' 张', 'start');
  for (const item of queue) {
    if (state.autoStop) { autoLog('■ 已停止（已发出的请求会跑完）', 'stop'); break; }
    if (item.page !== state.pageIdx) await switchPage(item.page);
    const before = !!state.images[item.slotId];
    autoLog('· 第 ' + (item.page + 1) + ' 页 · ' + item.slotId + '：请求中…');
    try { await generateSlotImage(item.slotId); } catch { /* 内部已提示 */ }
    if (!before && state.images[item.slotId]) { done++; autoLog('✓ ' + item.slotId + ' 完成（' + done + '/' + queue.length + '）', 'ok'); continue; }
    autoLog('… ' + item.slotId + ' 失败，重试 1 次');
    try { await generateSlotImage(item.slotId); } catch { /* ignore */ }
    if (state.images[item.slotId]) { done++; autoLog('✓ ' + item.slotId + ' 重试成功（' + done + '/' + queue.length + '）', 'ok'); }
    else { failed++; autoLog('✗ ' + item.slotId + ' 仍然失败', 'bad'); }
  }
  if (btnStop) btnStop.disabled = true;
  const secs = Math.round((Date.now() - t0) / 1000);
  autoLog('完成：成功 ' + done + ' 张 · 失败 ' + failed + ' 张 · 用时 ' + secs + 's', done ? 'ok' : 'bad');
  toast('批量出图结束：成功 ' + done + (failed ? ' / 失败 ' + failed : ''));
  return done;
}

/* ---------------- 全自动工作流 ---------------- */
/** 全自动：把一份 plan 装进当前页（aiPlan 优先，其次 state.plan.pages[0]） */
function adoptAutoPlan(plan, segment) {
  if (!plan) return;
  if (state.aiPlan && state.aiPlan.template?.id === state.tpl?.id) state.aiPlan = plan;
  else {
    state.plan = {
      pages: [{ pageIndex: state.pageIdx + 1, segment: segment || '', analysis: null, templateScore: null, plan }],
    };
  }
  renderScript();
  renderSlotPanel();
}

/**
 * 角色确认（真正全自动专用）
 * 在花钱警示之后、开始生成之前，把「这一话会出现谁、设定是什么、有没有参考图」摊开确认。
 * 返回 Promise<boolean>：true = 角色没问题，可以开始。
 */
function confirmCharacters({ pages = 1, panels = 0 } = {}) {
  return new Promise((res) => {
    document.querySelector('#charConfirm')?.remove();
    const chars = (state.chars || []);
    const active = new Set(state.activeChars || []);
    const hero = ($('#autoHero')?.value || '').trim();
    const heroine = ($('#autoHeroine')?.value || '').trim();
    const sheet = ($('#charSheet')?.value || '').trim();
    const rows = chars.length
      ? chars.map((c) => {
        const on = active.has(c.id);
        const refs = (c.images || []).length;
        const warn = on && !refs;
        return '<div class="cc-row' + (on ? ' on' : '') + (warn ? ' warn' : '') + '">'
          + '<span class="cc-dot">' + (on ? '●' : '○') + '</span>'
          + '<b>' + escapeHtml(c.name || '未命名') + '</b>'
          + (c.note ? '<span class="cc-note">' + escapeHtml(c.note) + '</span>' : '')
          + '<span class="cc-refs">' + (refs ? '参考图 ' + refs + ' 张' : '没有参考图') + '</span>'
          + (on ? '' : '<span class="cc-off">未启用</span>')
          + (warn ? '<span class="cc-warn">⚠ 启用了但没有参考图，脸会飘</span>' : '')
          + '</div>';
      }).join('')
      : '<div class="muted small">还没有角色卡。这一话的人物形象只靠下面的文字设定 —— 建议至少给主角加一张参考图。</div>';

    const box = document.createElement('div');
    box.className = 'keysheet';
    box.id = 'charConfirm';
    box.innerHTML = `
      <div class="ks-panel" style="max-width:560px">
        <div class="ks-head">
          <b>先确认角色形象</b>
          <span class="muted small">这一步不花钱，但少了它后面几十张图的脸会不一致</span>
          <button class="btn tiny" data-cancel>关闭</button>
        </div>
        <div class="ks-body">
          <div class="cc-sum">要做 ${pages} 页 · 约 ${panels} 个分镜、${panels} 张图</div>
          <div class="cc-list">${rows}</div>
          <div class="cc-sheet">角色设定：${escapeHtml(sheet || [hero ? '男主：' + hero : '', heroine ? '女主：' + heroine : ''].filter(Boolean).join('；') || '（空）')}</div>
          <div class="row2">
            <button class="btn tiny" id="ccGoFix">先去补角色</button>
            <button class="btn primary" id="ccGo">角色没问题，开始生成</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = (val) => { box.remove(); res(val); };
    box.addEventListener('click', (ev) => {
      if (ev.target === box || ev.target.closest('[data-cancel]')) { close(false); return; }
      if (ev.target.closest('#ccGoFix')) {
        close(false);
        // 把角色卡滚进视野并聚焦到名字输入框，让用户直接开始补
        document.querySelector('.chars')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => document.querySelector('#charName')?.focus(), 400);
        toast('先去补角色：加参考图或改设定，再从「全自动」重新开始');
        return;
      }
      if (ev.target.closest('#ccGo')) close(true);
    });
  });
}

async function autoRun() {
  const text = autoText();
  if (!text) { toast('先把全文粘进来'); return; }
  const mode = state.autoMode === 'full' ? 'full' : 'story';
  const est = autoEstimate();
  if (!est) return;

  const hero = ($('#autoHero')?.value || '').trim();
  const heroine = ($('#autoHeroine')?.value || '').trim();
  const sheet = [hero ? '男主：' + hero : '', heroine ? '女主：' + heroine : ''].filter(Boolean).join('；');
  if (sheet) {
    const el = $('#charSheet');
    if (el && !el.value.trim()) el.value = sheet;
    state.charSheet = (el?.value || sheet).trim();
  }

  const steps = buildAutoSteps({ mode, pages: est.pages, panelsPerPage: est.panelsPerPage });
  const imgCount = mode === 'full' ? est.panels : 0;
  const ok = await confirmDanger({
    title: mode === 'full' ? '真正全自动：全部交给 AI' : '分镜全自动：只做分镜与提示词',
    body: '<ul class="danger-list">'
      + '<li>分 <b>' + est.pages + ' 页</b>，约 <b>' + est.panels + ' 个分镜</b>'
      + (mode === 'full'
        ? '，约 <b>' + est.panels + ' 张图</b>、约 <b>' + est.panels + ' 句台词</b>（台词/旁白/内心由 AI 决定，气泡也由它布置）'
        : '；台词与出图不自动做（之后可用右下角悬浮按钮单独触发）')
      + '</li>'
      + '<li>共 ' + steps.length + ' 个步骤，每一步都打进下面的日志，你能看见内容是怎么一步步出来的</li>'
      + '<li><b>可以随时点「停止」</b>（已发出的请求会跑完，之后的不再发）</li>'
      + (mode === 'full' ? '<li>提示词用 AI 优化过的版本，不是规则模板</li>' : '')
      + '</ul>',
    images: imgCount,
    llmCalls: steps.filter((x) => x.cost === 'llm').length,
  });
  if (!ok) return;

  if (mode === 'full') {
    // 花钱警示之后、真正开始之前：再确认一次角色形象（用户要求）
    const charOk = await confirmCharacters({ pages: est.pages, panels: est.panels });
    if (!charOk) { autoLog('已取消：先确认角色形象'); return; }
  }

  state.autoStop = false;
  const btnStart = $('#btnAutoStart');
  const btnStop = $('#btnAutoStop');
  if (btnStart) btnStart.disabled = true;
  if (btnStop) btnStop.disabled = false;
  const t0 = Date.now();
  autoLog('▶ 全自动开始（' + (mode === 'full' ? '真正全自动' : '分镜自动') + '）：' + est.pages + ' 页', 'start');

  try {
    const pageTexts = splitTextIntoPages(text, est.pages);
    autoLog('① 全文 ' + est.chars + ' 字 → 切成 ' + est.pages + ' 页（每页约 ' + Math.round(est.chars / est.pages) + ' 字）');

    for (let i = 0; i < est.pages; i++) {
      if (state.autoStop) break;
      const pageText = pageTexts[i] || '';
      autoLog('② 第 ' + (i + 1) + ' 页：挑版式 + 切格…');
      let decided = false;
      if (i === 0) {
        try {
          const res = await api.match({
            plot: pageText,
            culture: $('#culture')?.value || 'all',
            genre: $('#genre')?.value || 'all',
            ratio: $('#ratio')?.value || 'auto',
            limit: 6,
          });
          const top = res?.results?.[0];
          if (top?.id) {
            await selectTemplate(top.id, { keepImages: true });
            autoLog('   · 选到「' + top.name + '」（' + top.panels + ' 格）', 'ok');
            decided = true;
          }
        } catch { /* ignore */ }
      } else {
        await addPage();
      }
      if (!decided && i === 0 && !state.tpl) throw new Error('还没有可用的版式');

      autoLog('③ 第 ' + (i + 1) + ' 页：把这一页的原文切成每格…');
      try {
        const cut = await api.aiSplit({
          plot: pageText || text,
          templateId: state.tpl.id,
          pageWidth: state.exportWidth,
          characterSheet: state.charSheet,
        });
        if (cut?.ok && cut.plan) { adoptAutoPlan(cut.plan, pageText); autoLog('   · AI 切分完成', 'ok'); }
        else throw new Error(cut?.error || '切分失败');
      } catch (e) {
        autoLog('   · AI 切分没成（' + String(e.message).slice(0, 40) + '），改用规则切分');
        try {
          const rp = await api.plan({ plot: pageText || text, templateId: state.tpl.id, pageWidth: state.exportWidth });
          if (rp?.plan) adoptAutoPlan(rp.plan, pageText);
        } catch { /* ignore */ }
      }

      autoLog('④ 第 ' + (i + 1) + ' 页：AI 优化逐格提示词…');
      try {
        await runAiPrompts({ silent: true });
        autoLog('   · 提示词已用 AI 优化过', 'ok');
      } catch (e) {
        autoLog('   · 提示词优化失败（保留规则版）：' + String(e.message).slice(0, 40), 'bad');
      }

      if (mode === 'full') {
        if (state.autoStop) break;
        autoLog('⑤ 第 ' + (i + 1) + ' 页：写台词/旁白并挂气泡…');
        try { await aiWriteLines('page'); autoLog('   · 台词与气泡布置完成', 'ok'); }
        catch (e) { autoLog('   · 台词失败：' + String(e.message).slice(0, 40), 'bad'); }
        if (state.autoStop) break;
        autoLog('⑥ 第 ' + (i + 1) + ' 页：逐格生成图片…');
        const panels = await currentPagePanels();
        const queue = imageQueueForPage(panels, state.images || {});
        await runImageQueue(queue.map((slotId) => ({ page: state.pageIdx, slotId })), '第 ' + (i + 1) + ' 页');
      }
      savePage();
      autoLog('— 第 ' + (i + 1) + ' 页完成 —', 'ok');
    }
  } catch (e) {
    autoLog('✗ 中断：' + e.message, 'bad');
    toast('全自动中断：' + e.message);
  } finally {
    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
    const secs = Math.round((Date.now() - t0) / 1000);
    autoLog(state.autoStop ? '■ 已停止 · 用时 ' + secs + 's' : '✓ 全自动结束 · 用时 ' + secs + 's', state.autoStop ? 'stop' : 'ok');
  }
}

/* ---------------- 绑定 ---------------- */
function bindAutoUI() {
  setAutoMode(store.get(AUTO_KEY) || 'off', { silent: true });
  $$('#autoSeg button').forEach((b) => b.addEventListener('click', () => setAutoMode(b.dataset.auto || 'off')));
  $('#btnAutoEstimate')?.addEventListener('click', () => autoEstimate());
  $('#btnAutoFile')?.addEventListener('click', () => $('#autoFile').click());
  $('#autoFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const t = await f.text();
      $('#autoText').value = t.slice(0, 200000);
      autoEstimate();
      toast('已读入：' + f.name);
    } catch { toast('文件读不出来（换 .txt 试试）'); }
    ev.target.value = '';
  });
  $('#btnAutoStart')?.addEventListener('click', () => autoRun());
  $('#btnAutoStop')?.addEventListener('click', () => {
    state.autoStop = true;
    autoLog('… 收到停止指令：当前请求会跑完，后面的不再发', 'stop');
  });
  $('#fabGenPage')?.addEventListener('click', () => genPageImages());
  $('#fabGenAll')?.addEventListener('click', () => genAllImages());
}

// 调试/自动化钩子
window.__pfAuto = () => ({
  mode: state.autoMode || 'off',
  running: !!(state.autoMode && state.autoStop === false && $('#btnAutoStart')?.disabled),
  log: [...document.querySelectorAll('#autoLog .al-row')].map((r) => r.className + '|' + r.textContent),
});
window.__pfAutoSet = (m) => setAutoMode(m);

  bindAutoUI();
  // 页面被隐藏或卸载前，把还没落盘的草稿立刻写一次
  const flushNow = () => { if (dirty) { try { flushSave(); } catch { /* ignore */ } } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);
  window.__pfFlush = () => flushSave();
  bindSlotZoom();
  bindInboxUI();
  installRails();

/* ================================================================== *
 * 交互收件箱：拖放 / 粘贴 / 气泡拖入 / 候选大图 / 右键菜单
 *
 * 设计原则：
 *   1. 任何「能把图片放进来」的地方都支持三种入口：点按钮选文件、拖进来、Ctrl+V 粘贴
 *   2. 拖放目标以「指针下面是什么」为准（画布 → 那一格；角色卡 → 角色参考图）
 *   3. 右键菜单用我们自己的（浏览器默认菜单在编辑器里很难用），
 *      但输入框里保留文本操作项，不让人失去剪切/粘贴
 * ================================================================== */

let inboxArea = 'slot';   // 'slot' | 'char'：粘贴时往哪儿放

function firstImageFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  if (dt.files && dt.files.length) {
    for (const f of dt.files) if (/^image\//i.test(f.type)) out.push(f);
  }
  if (!out.length && dt.items) {
    for (const it of dt.items) {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && /^image\//i.test(f.type)) out.push(f); }
    }
  }
  return out;
}

/** 指针落在哪：画布 / 角色卡 / 其它 */
function dropZoneOf(el) {
  if (!el || !el.closest) return null;
  if (el.closest('#styleFollow')) return 'sample';   // 拖到「风格跟随」= 加样图
  if (el.closest('.chars')) return 'char';
  if (el.closest('#canvas') || el.closest('#stage') || el.closest('.paint-stage')) return 'canvas';
  return null;
}

async function acceptImages(files, { zone, ev } = {}) {
  const imgs = (files || []).filter((f) => f && /^image\//i.test(f.type));
  if (!imgs.length) return false;
  if (zone === 'sample') {
    setStyleFollow(followSamples() ? styleMode() : 'sample');
    await addSamples(imgs);
    return true;
  }
  if (zone === 'char') {
    await addCharCard(imgs);
    toast(`已加入 ${imgs.length} 张角色参考图`);
    return true;
  }
  // 画布：优先「指针下那一格」，否则当前选中的格子
  let slotId = state.selectedId;
  if (ev && zone === 'canvas') {
    const pt = pagePoint(ev);
    const s = slotAt(pt);
    if (s) slotId = s.id;
  }
  if (!slotId) { toast('先点一个格子，再拖图进来'); return false; }
  await putImage(slotId, imgs[0]);
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  toast(`已填入第 ${slot?.order ?? '?'} 格${imgs.length > 1 ? `（只用了第一张，共 ${imgs.length} 张）` : ''}`);
  return true;
}

/* ---------------- 拖放 + 粘贴 ---------------- */
/** 拖进来的文件里挑出「文本类」的（原文/大纲/脚本） */
const TEXT_EXT = /\.(txt|md|markdown|text|csv|tsv|journal|log)$/i;
function textFilesFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  const push = (f) => {
    if (!f) return;
    // docx/pdf 这类也算「文本候选」—— 收下来才能给一句明确的「读不了，请另存 txt」
    const DOC_EXT = /\.(docx|doc|pdf|epub|rtf)$/i;
    const isText = /^text\//i.test(f.type) || TEXT_EXT.test(f.name || '') || DOC_EXT.test(f.name || '');
    if (isText) out.push(f);
  };
  if (dt.files && dt.files.length) for (const f of dt.files) push(f);
  if (!out.length && dt.items) {
    for (const it of dt.items) if (it.kind === 'file') push(it.getAsFile());
  }
  return out;
}

/** 判断落点是哪个文本框：全自动的全文框 / 普通模式的剧情框 */
function textTargetOf(el) {
  if (!el || !el.closest) return null;
  if (el.closest('#autoPanel, #autoCard')) return '#autoText';
  if (el.closest('.match, #plot')) return '#plot';
  return null;
}

/** 把文本文件读进对应的文本框；读不了（比如 docx）就说清楚 */
async function acceptTextFiles(files, { targetSel } = {}) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return false;
  const f = list[0];
  const sel = targetSel || (state.autoMode && state.autoMode !== 'off' ? '#autoText' : '#plot');
  const ta = $(sel);
  if (!ta) return false;
  // docx / pdf / epub：浏览器里要额外依赖才能解，别假装支持
  if (/\.(docx|doc|pdf|epub|rtf)$/i.test(f.name || '')) {
    toast('这个格式读不了：请另存为 .txt / .md 再拖进来（docx 在浏览器里需要额外依赖）');
    return false;
  }
  try {
    const text = await f.text();
    if (!text || !text.trim()) { toast('这个文件是空的'); return false; }
    ta.value = text.slice(0, 200000);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (sel === '#autoText') autoEstimate();
    const chars = text.replace(/\s+/g, '').length;
    toast(`已读入「${f.name}」：${chars} 字${sel === '#autoText' ? '，已估算页数' : ''}`);
    ta.focus();
    // 光标放到末尾，方便接着写
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* ignore */ }
    return true;
  } catch (e) {
    toast('读文件失败：' + e.message);
    return false;
  }
}

/* ---------------- 选中格子的悬浮缩放条 ---------------- */
function slotZoomEls() {
  return { box: $('#slotZoom'), range: $('#slotZoomRange'), val: $('#slotZoomVal') };
}

/** 把缩放条贴到「当前选中格子」的正右侧；没有图就藏起来 */
function syncSlotZoom() {
  const { box, range, val } = slotZoomEls();
  if (!box) return;
  const svg = $('#canvas')?.querySelector('svg');
  const slot = state.tpl?.slots?.find((x) => x.id === state.selectedId);
  const img = state.selectedId ? state.images[state.selectedId] : null;
  const view = document.body.dataset.view || '';
  // 只在「画布」视图显示：以前写的是 view !== 'edit'，于是在剧情/模板库/导出视图里
  // 也会显示——那几屏 #canvas 是 display:none，getBoundingClientRect 全 0，
  // 缩放条就被定到了视口左上角（用户看到的那条小条）。
  const showIt = !!(svg && slot && img && !state.hollow && view === 'canvas');
  if (!showIt) { box.classList.add('hidden'); return; }
  // 再兜一层：svh 还没排版（宽高为 0）时也不显示
  {
    const pre = svg.getBoundingClientRect();
    if (pre.width < 8 || pre.height < 8) { box.classList.add('hidden'); return; }
  }

  // 用 position:fixed + 视口坐标：完全不依赖 offsetParent。
  // （踩过两次坑：offsetParent 会因祖先被加 transform 而变，算出来的位置在同步和 resize 时不一致）
  const sRect = svg.getBoundingClientRect();
  const tpl = state.tpl.page;
  const kx = sRect.width / tpl.w;
  const ky = sRect.height / tpl.h;
  const x = sRect.left + (slot.x + slot.w) * kx + 10;
  const y = sRect.top + (slot.y + slot.h / 2) * ky;

  box.classList.remove('hidden');
  box.style.left = Math.round(x) + 'px';
  box.style.top = Math.round(y) + 'px';
  box.style.transform = 'translateY(-50%)';

  // 直接观察 svg 自身尺寸：加载后期版心还会变宽一点（453→466），只在 #canvas 上挂 RO 抓不到
  if (typeof ResizeObserver === 'function' && svg !== syncSlotZoom._svg) {
    syncSlotZoom._ro?.disconnect();
    syncSlotZoom._svg = svg;
    syncSlotZoom._ro = new ResizeObserver(() => {
      try { syncSlotZoom(); } catch { /* ignore */ }
    });
    syncSlotZoom._ro.observe(svg);
  }

  const pct = Math.round((img.zoom || 1) * 100);
  if (val) val.textContent = pct + '%';
  if (range && document.activeElement !== range) range.value = String(Math.min(400, Math.max(30, pct)));
}

/** 调试/测试用：某一格的屏幕矩形（从模板几何 + SVG 缩放换算，与图片溢出一概无关） */
window.__pfSlotRect = (id = state.selectedId) => {
  const canvas = $('#canvas');
  const svg = canvas?.querySelector('svg');
  const slot = state.tpl?.slots?.find((x) => x.id === id);
  if (!svg || !slot) return null;
  const r = svg.getBoundingClientRect();
  const page = state.tpl.page;
  const kx = r.width / page.w;
  const ky = r.height / page.h;
  return {
    left: r.left + slot.x * kx,
    top: r.top + slot.y * ky,
    right: r.left + (slot.x + slot.w) * kx,
    bottom: r.top + (slot.y + slot.h) * ky,
    width: slot.w * kx,
    height: slot.h * ky,
  };
};

/** 设置当前格的缩放（30%–400%），走热路径只改这一张图 */
function setSlotZoom(pct) {
  const id = state.selectedId;
  const img = id ? state.images[id] : null;
  if (!img) return;
  const next = clamp(Number(pct) / 100, 0.3, 4);
  if (Math.abs(next - (img.zoom || 1)) < 0.001) return;
  img.zoom = next;
  if (typeof refreshSlotImage === 'function') refreshSlotImage(id);
  else renderStage();
  syncSlotZoom();
  const zv = $('#zoomVal');
  if (zv) zv.textContent = Math.round(next * 100) + '%';
  const zr = $('#zoom');
  if (zr) zr.value = String(Math.round(next * 100));
  queueSave();
}

function bindSlotZoom() {
  const { box, range, val } = slotZoomEls();
  if (!box || box.dataset.ready) return;
  box.dataset.ready = '1';
  // 挂到 body：position:fixed 就不再受任何祖先 transform 影响
  if (box.parentElement !== document.body) document.body.appendChild(box);
  range?.addEventListener('input', (ev) => setSlotZoom(ev.target.value));
  box.addEventListener('click', (ev) => {
    const step = ev.target.closest('[data-step]');
    if (step) {
      const img = state.images[state.selectedId];
      const cur = Math.round((img?.zoom || 1) * 100);
      setSlotZoom(cur + Number(step.dataset.step) * 8);
      return;
    }
    if (ev.target.closest('#slotZoomVal')) setSlotZoom(100);
  });
  window.addEventListener('resize', syncSlotZoom);
  document.addEventListener('scroll', syncSlotZoom, { passive: true, capture: true });
  // 画布每次重绘（换页/换格/改图）都会替换 svg —— 盯住它，重算缩放条位置
  const canvasEl = $('#canvas');
  // 画布每次重绘都会换 svg；但「刚换完」那一刻布局可能还没稳定（实测会算出偏 288px 的假位置），
  // 所以连续同步两次：rAF 一次、稍后再一次；尺寸变化再交给 ResizeObserver。
  // 重绘后连续同步一小段：加载后期版心会变宽、进页动画也会缩放画布，
  // 这些变化 ResizeObserver 看不见（它只报布局盒，不报 transform），所以按时间点补几帧。
  const syncTwice = () => {
    for (const t of [0, 50, 120, 250, 500, 900]) {
      setTimeout(() => { try { syncSlotZoom(); } catch { /* ignore */ } }, t);
    }
  };
  if (canvasEl && !canvasEl.dataset.zoomObserver) {
    canvasEl.dataset.zoomObserver = '1';
    let raf = 0;
    new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncTwice);
    }).observe(canvasEl, { childList: true });
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { try { syncSlotZoom(); } catch { /* ignore */ } });
      ro.observe(canvasEl);
      const stageEl = canvasEl.closest('.stage') || canvasEl.parentElement;
      if (stageEl) ro.observe(stageEl);
    }
  }
  syncTwice();
}

/* ---------------- 拖放提示：毛玻璃卡片 + 格式说明 ---------------- */
const DROP_KINDS = {
  image: { title: '放入图片', formats: 'JPG / PNG / WebP / GIF / AVIF / SVG', ico: '▤' },
  text: { title: '放入原文文件', formats: 'TXT / MD / CSV / TSV / LOG', ico: '🅃' },
  bubble: { title: '放入气泡', formats: '松手就放到画面上', ico: '💬' },
};

function showDropHint(kind, targetEl) {
  const el = $('#dropHint');
  if (!el || !targetEl) return;
  const spec = DROP_KINDS[kind] || DROP_KINDS.image;
  $('#dhIco').textContent = spec.ico;
  $('#dhTitle').textContent = spec.title;
  $('#dhFormats').textContent = spec.formats;
  const r = targetEl.getBoundingClientRect();
  el.classList.remove('hidden');
  el.style.left = Math.round(r.left) + 'px';
  el.style.top = Math.round(r.top) + 'px';
  el.style.width = Math.round(r.width) + 'px';
  el.style.height = Math.round(r.height) + 'px';
}

function hideDropHint() {
  $('#dropHint')?.classList.add('hidden');
}

function installImageInbox() {
  const canvas = $('#canvas');

  // 记录最近一次交互区域，供 Ctrl+V 决定往哪放
  document.addEventListener('pointerdown', (ev) => {
    const zone = dropZoneOf(ev.target);
    if (zone === 'sample') inboxArea = 'sample';
    else if (zone === 'char') inboxArea = 'char';
    else if (zone === 'canvas' || ev.target.closest?.('#railRight')) inboxArea = 'slot';
  }, true);
  document.addEventListener('focusin', (ev) => {
    if (ev.target.closest?.('#styleFollow')) inboxArea = 'sample';
    else if (ev.target.closest?.('.chars')) inboxArea = 'char';
  }, true);

  // 拖到画布/角色卡上时给出可放置的视觉反馈
  document.addEventListener('dragover', (ev) => {
    const hasImages = firstImageFromDataTransfer(ev.dataTransfer).length > 0;
    const hasText = textFilesFromDataTransfer(ev.dataTransfer).length > 0;
    const isBubble = ev.dataTransfer?.types?.includes('text/pf-bubble');
    if (!hasImages && !hasText && !isBubble) return;
    // 文本文件优先落在文本框上
    const textSel = hasText && !hasImages ? textTargetOf(ev.target) : null;
    // 合成事件的 target 可能是 document，用坐标兜底判断落在画布上
    const zone = textSel
      ? 'text'
      : (dropZoneOf(ev.target) || (Number.isFinite(ev.clientX) && $('#canvas svg') ? 'canvas' : null));
    if (!zone) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    document.body.dataset.dropZone = zone;
    // 毛玻璃提示：盖在目标区域上，写明能放什么格式
    if (textSel) showDropHint('text', $(textSel));
    else if (isBubble && !hasImages) showDropHint('bubble', $('#canvas svg') || $('#canvas'));
    else showDropHint('image', zone === 'char' ? $('.chars') : ($('#canvas svg') || $('#canvas')));
  });
  document.addEventListener('dragleave', (ev) => {
    if (ev.target === document || !ev.relatedTarget) { delete document.body.dataset.dropZone; hideDropHint(); }
  });

  document.addEventListener('drop', async (ev) => {
    hideDropHint();
    const bubbleType = ev.dataTransfer?.getData('text/pf-bubble');
    // 事件可能派发在 document 上（合成事件 / 某些浏览器），这时用坐标兜底判断落在画布
    const zone = dropZoneOf(ev.target)
      || (Number.isFinite(ev.clientX) && $('#canvas svg') ? 'canvas' : null);
    delete document.body.dataset.dropZone;
    if (bubbleType) {
      if (!zone || zone === 'char') return;
      ev.preventDefault();
      const pt = pagePoint(ev);
      const slot = slotAt(pt);
      if (!state.tpl) { toast('先选一套版式'); return; }
      const b = addBubble(bubbleType, { at: pt, noCommit: false });
      if (b) {
        if (slot) { state.selectedId = slot.id; renderSlotPanel(); }
        toast(`已把「${BUBBLES[bubbleType]?.zh || bubbleType}」放到画面上，拖它调位置`);
      }
      return;
    }
    // 先看是不是文本文件（原文/大纲），它落在文本框上就填文本框
    const texts = textFilesFromDataTransfer(ev.dataTransfer);
    const textSel = texts.length ? textTargetOf(ev.target) : null;
    if (texts.length && (textSel || !firstImageFromDataTransfer(ev.dataTransfer).length)) {
      ev.preventDefault();
      await acceptTextFiles(texts, { targetSel: textSel });
      return;
    }
    const files = firstImageFromDataTransfer(ev.dataTransfer);
    if (!files.length) return;
    ev.preventDefault();
    await acceptImages(files, { zone, ev });
  });

  // Ctrl+V 粘贴图片
  document.addEventListener('paste', async (ev) => {
    const files = firstImageFromDataTransfer(ev.clipboardData);
    if (!files.length) return;   // 文本粘贴不拦
    const inField = ev.target.closest?.('input, textarea');
    // 输入框里粘图片没意义（会变成字），但用户常常是在输入框聚焦时按的 Ctrl+V
    const zone = inboxArea === 'char' ? 'char' : 'canvas';
    ev.preventDefault();
    await acceptImages(files, { zone });
    if (inField) toast('已把剪贴板里的图片放进去了');
  });
}

/* ---------------- 气泡库可拖拽 ---------------- */
function makeBubbleLibDraggable() {
  const lib = $('#bubGrid');
  if (!lib || lib.dataset.draggableReady) return;
  lib.dataset.draggableReady = '1';
  const SEL = '.bub-item[data-id]';
  lib.addEventListener('dragstart', (ev) => {
    const btn = ev.target.closest(SEL);
    if (!btn) return;
    const type = btn.dataset.id;
    ev.dataTransfer.setData('text/pf-bubble', type);
    ev.dataTransfer.setData('text/plain', BUBBLES[type]?.zh || type);
    ev.dataTransfer.effectAllowed = 'copy';
    btn.classList.add('dragging');
  });
  lib.addEventListener('dragend', (ev) => {
    ev.target.closest(SEL)?.classList.remove('dragging');
    delete document.body.dataset.dropZone;
    hideDropHint();
  });
  // 气泡项是 .bub-item[data-id]，标记成可拖（每次重渲染后都要补）
  const mark = () => {
    lib.querySelectorAll(SEL).forEach((b) => {
      b.draggable = true;
      const zh = BUBBLES[b.dataset.id]?.zh || b.dataset.id;
      b.title = `${zh} · 拖到画面上直接放置（也可以点一下加到当前格）`;
    });
  };
  mark();
  new MutationObserver(mark).observe(lib, { childList: true, subtree: true });
}

/* ---------------- 候选图大图预览 ---------------- */
function openLightbox(list, index = 0, opts = {}) {
  if (!list || !list.length) return;
  let i = Math.max(0, Math.min(list.length - 1, index));
  let box = $('#lightbox');
  if (box) box.remove();
  box = document.createElement('div');
  box.className = 'keysheet lightbox';
  box.id = 'lightbox';
  box.innerHTML = `
    <div class="lb-panel">
      <div class="lb-head">
        <b id="lbCount">–</b>
        <span class="muted small">← → 切换 · Esc 关闭 · 滚轮缩放</span>
        <button class="btn tiny" data-close>关闭</button>
      </div>
      <div class="lb-stage"><img id="lbImg" alt="候选图预览" draggable="false"></div>
      <div class="row2 lb-acts">
        <button class="btn tiny" id="lbPrev">上一张</button>
        <button class="btn tiny" id="lbNext">下一张</button>
        <button class="btn tiny primary" id="lbUse">用这张</button>
        <button class="btn tiny" id="lbEdit">用这张进画布改</button>
        <button class="btn tiny danger" id="lbDel">删掉这张</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const img = $('#lbImg', box);
  let scale = 1;
  const sync = () => {
    img.src = list[i];
    scale = 1;
    img.style.transform = 'scale(1)';
    $('#lbCount', box).textContent = `第 ${i + 1} / ${list.length} 张`;
    $('#lbPrev', box).disabled = i <= 0;
    $('#lbNext', box).disabled = i >= list.length - 1;
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); if (i > 0) { i--; sync(); } }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); if (i < list.length - 1) { i++; sync(); } }
  };
  document.addEventListener('keydown', onKey, true);

  box.addEventListener('click', (ev) => {
    if (ev.target === box || ev.target.closest('[data-close]')) { close(); return; }
  });
  $('#lbPrev', box).addEventListener('click', () => { if (i > 0) { i--; sync(); } });
  $('#lbNext', box).addEventListener('click', () => { if (i < list.length - 1) { i++; sync(); } });
  $('#lbUse', box).addEventListener('click', async () => { close(); await applyCand(i); });
  $('#lbEdit', box).addEventListener('click', async () => { close(); await applyCandAndEdit(i); });
  $('#lbDel', box).addEventListener('click', () => {
    const sid = state.selectedId;
    const arr = candsOf(sid);
    if (!arr.length) return;
    arr.splice(i, 1);
    renderCands();
    if (!arr.length) { close(); return; }
    i = Math.min(i, arr.length - 1);
    list = arr;
    sync();
  });
  box.querySelector('.lb-stage').addEventListener('wheel', (ev) => {
    ev.preventDefault();
    scale = Math.min(4, Math.max(0.4, scale * (ev.deltaY < 0 ? 1.1 : 0.9)));
    img.style.transform = `scale(${scale})`;
  }, { passive: false });
  sync();
}

/* ---------------- 右键菜单 ---------------- */
const CTX_TRANSFORM = [
  { key: 'zoomIn', label: '放大', hint: '+', run: (id) => nudgeImage(id, 'zoom', 1.12) },
  { key: 'zoomOut', label: '缩小', hint: '−', run: (id) => nudgeImage(id, 'zoom', 1 / 1.12) },
  { sep: true },
  { key: 'left', label: '靠左', run: (id) => alignImage(id, 'left') },
  { key: 'hcenter', label: '水平居中', run: (id) => alignImage(id, 'hcenter') },
  { key: 'right', label: '靠右', run: (id) => alignImage(id, 'right') },
  { key: 'top', label: '靠上', run: (id) => alignImage(id, 'top') },
  { key: 'vcenter', label: '垂直居中', run: (id) => alignImage(id, 'vcenter') },
  { key: 'bottom', label: '靠下', run: (id) => alignImage(id, 'bottom') },
  { sep: true },
  { key: 'cover', label: '填满裁切', run: (id) => setImageMode(id, 'cover') },
  { key: 'contain', label: '完整显示', run: (id) => setImageMode(id, 'contain') },
  { key: 'reset', label: '复位位置', run: (id) => resetImageTransform(id) },
];

function nudgeImage(id, field, factor) {
  const img = state.images[id];
  if (!img) return;
  commit();
  if (field === 'zoom') img.zoom = clamp((img.zoom || 1) * factor, 0.3, 6);
  renderStage(); renderSlotPanel(); queueSave();
}
function alignImage(id, dir) {
  const img = state.images[id];
  if (!img) return;
  commit();
  const big = 260;   // 用足够大的位移把图推到边界（渲染时会被格子裁剪）
  img.mode = img.mode || 'cover';
  if (dir === 'left') img.panX = -big;
  if (dir === 'right') img.panX = big;
  if (dir === 'hcenter') img.panX = 0;
  if (dir === 'top') img.panY = -big;
  if (dir === 'bottom') img.panY = big;
  if (dir === 'vcenter') img.panY = 0;
  renderStage(); renderSlotPanel(); queueSave();
}
function setImageMode(id, mode) {
  const img = state.images[id];
  if (!img) return;
  commit();
  img.mode = mode;
  renderStage(); renderSlotPanel(); queueSave();
  toast(mode === 'contain' ? '完整显示（可能留白）' : '填满裁切');
}
function resetImageTransform(id) {
  const img = state.images[id];
  if (!img) return;
  commit();
  img.zoom = 1; img.panX = 0; img.panY = 0;
  renderStage(); renderSlotPanel(); queueSave();
}

function ctxItem(label, run, opts = {}) {
  return { label, run, ...opts };
}

/** 根据右键位置算出该显示哪些菜单项 */
function buildContextMenu(ev) {
  // 真实右键的 target 就是被点的元素；只有合成事件派发在 document/body 上时才用坐标兜底
  const raw = ev.target;
  const usable = raw && raw.closest && raw !== document && raw !== document.body && raw !== document.documentElement;
  const target = usable ? raw : (document.elementFromPoint(ev.clientX, ev.clientY) || raw);
  const sel = state.selectedId;

  // ① 输入框/文本域：保留文本操作（不用浏览器菜单，但功能要对等）
  if (target.closest?.('input, textarea, [contenteditable="true"]')) {
    const el = target.closest('input, textarea, [contenteditable="true"]');
    const hasSel = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0);
    return {
      title: '文本',
      items: [
        ctxItem('复制', () => { el.focus(); document.execCommand('copy'); }, { disabled: !hasSel }),
        ctxItem('剪切', () => { el.focus(); document.execCommand('cut'); }, { disabled: !hasSel }),
        ctxItem('粘贴', () => { el.focus(); toast('用 Ctrl+V 粘贴（浏览器不允许脚本代按）'); }, { hint: 'Ctrl+V' }),
        { sep: true },
        ctxItem('全选', () => { el.focus(); el.select?.(); }),
      ],
    };
  }

  // ② 候选图
  const cand = target.closest?.('.cand');
  if (cand) {
    const i = Number(cand.dataset.i) || 0;
    return {
      title: '候选图',
      items: [
        ctxItem('放大看细节', () => openLightbox(candsOf(sel), i)),
        ctxItem('用这张', () => applyCand(i)),
        ctxItem('用这张进画布改', () => applyCandAndEdit(i)),
        { sep: true },
        ctxItem('删掉这张', () => {
          const arr = candsOf(sel);
          arr.splice(i, 1);
          renderCands();
        }),
      ],
    };
  }

  // ③ 画布（含某一格的图）
  const inCanvas = target.closest?.('#canvas') || target.closest?.('#stage');
  if (inCanvas) {
    const pt = pagePoint(ev);
    const slot = slotAt(pt);
    const sid = slot?.id || sel;
    if (!sid) return null;
    const hasImg = !!state.images[sid];
    const items = [];
    if (hasImg) {
      items.push(...CTX_TRANSFORM.map((it) => (it.sep ? it : { ...it, run: () => it.run(sid) })));
      items.push({ sep: true });
      items.push(ctxItem('看大图', () => { state.selectedId = sid; window.__pfLightbox(0); }));
      items.push(ctxItem('替换图片…', () => { state.selectedId = sid; $('#filePick').dataset.mode = 'slot'; $('#filePick').click(); }));
      items.push(ctxItem('绘制这一格', () => { state.selectedId = sid; openPaint(sid); }));
      items.push(ctxItem('导出这一格', async () => { state.selectedId = sid; await exportSlotImage(); }));
      items.push({ sep: true });
      items.push(ctxItem('清空这一格的图', () => {
        commit();
        delete state.images[sid];
        renderStage(); renderSlotPanel(); refreshScript(); queueSave();
        toast('已清空这一格的图');
      }, { danger: true }));
    } else {
      items.push(ctxItem('选图片填入这一格', () => { state.selectedId = sid; renderSlotPanel(); $('#filePick').dataset.mode = 'slot'; $('#filePick').click(); }));
      items.push(ctxItem('AI 生成这一格', () => { state.selectedId = sid; renderSlotPanel(); generateSlotImage(sid); }));
      items.push(ctxItem('绘制这一格', () => { state.selectedId = sid; openPaint(sid); }));
    }
    // 选中的格与右键的格不同时，先把它选上，动作才不会作用错对象
    const firstRun = items.find((x) => x.run);
    if (firstRun) {
      const orig = firstRun.run;
      firstRun.run = () => { state.selectedId = sid; renderSlotPanel(); orig(); };
    }
    return { title: slot ? `第 ${slot.order} 格` : '画布', items };
  }

  // ④ 气泡
  // 画面里的气泡渲染成 <g data-bubble="<id>">（见 lib/svg.mjs），不是 .bub / data-bubble-id
  const bub = target.closest?.('g[data-bubble]');
  if (bub) {
    const id = bub.getAttribute('data-bubble');
    return {
      title: '气泡',
      items: [
        ctxItem('换样式', () => { state.selBubble = id; renderBubbles(); $('#bubbleLib')?.scrollIntoView({ block: 'nearest' }); }),
        ctxItem('编辑文字', () => { state.selBubble = id; renderBubbles(); $('#bubText')?.focus(); }),
        ctxItem('复制一个', () => duplicateBubble()),
        { sep: true },
        ctxItem('删除', () => { state.selBubble = id; deleteBubble(); }, { danger: true }),
      ],
    };
  }

  // ⑤ 全局
  return {
    title: 'PanelForge',
    items: [
      ctxItem('AI 生成这一格', () => generateSlotImage(state.selectedId)),
      ctxItem('绘制这一格', () => openPaint(state.selectedId)),
      { sep: true },
      ctxItem('导出这一页 PNG', () => $('#btnExportPng')?.click()),
      ctxItem('快捷键表', () => toggleShortcuts(true), { hint: '?' }),
    ],
  };
}

function installContextMenu() {
  let menu = $('#ctxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'ctxMenu';
    menu.className = 'ctx-menu hidden';
    document.body.appendChild(menu);
  }
  const hide = () => menu.classList.add('hidden');

  document.addEventListener('contextmenu', (ev) => {
    // 触屏长按也会派发 contextmenu：那不是用户要的右键菜单，直接吞掉（编辑用双击）
    const fromTouch = ev.pointerType === 'touch' || ev.sourceCapabilities?.firesTouchEvents === true;
    if (fromTouch) { ev.preventDefault(); return; }
    const spec = buildContextMenu(ev);
    if (!spec || !spec.items?.length) return;   // 没有我们的上下文 → 保留浏览器菜单
    ev.preventDefault();
    menu.innerHTML = `<div class="ctx-title">${escapeHtml(spec.title || '')}</div>`
      + spec.items.map((it, i) => (it.sep
        ? '<div class="ctx-sep"></div>'
        : `<button class="ctx-item${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
             <span>${escapeHtml(it.label)}</span>${it.hint ? `<kbd>${escapeHtml(it.hint)}</kbd>` : ''}
           </button>`)).join('');
    menu.classList.remove('hidden');
    // 贴边修正
    const r = menu.getBoundingClientRect();
    const x = Math.min(ev.clientX, window.innerWidth - r.width - 8);
    const y = Math.min(ev.clientY, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(6, x) + 'px';
    menu.style.top = Math.max(6, y) + 'px';
    menu._spec = spec;
  });

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ctx-item');
    if (!btn || btn.disabled) { hide(); return; }
    const i = Number(btn.dataset.i);
    const item = menu._spec?.items?.[i];
    hide();
    try { item?.run?.(); } catch (e) { toast('操作失败：' + e.message); }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!menu.contains(ev.target)) hide();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  window.addEventListener('blur', hide);
}

/* ---------------- 绑定 ---------------- */

function bindInboxUI() {
  installImageInbox();
  makeBubbleLibDraggable();
  installContextMenu();
  // 候选图：点缩略图直接看大图（原来的「点一下用这张」仍在右键/大图里）
  $('#candGrid')?.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) return;                       // 删除按钮走原逻辑
    const editBtn = ev.target.closest('[data-edit]');
    if (editBtn) return;                   // ✎ 走原逻辑
    const card = ev.target.closest('.cand');
    if (!card) return;
    if (ev.altKey || ev.shiftKey) return;  // 按住修饰键时保留原来的「直接用」行为
    ev.stopImmediatePropagation?.();
    ev.preventDefault();
    openLightbox(candsOf(state.selectedId), Number(card.dataset.i) || 0);
  }, true);
}

window.__pfLightbox = (i = 0) => {
  const list = (candsOf(state.selectedId) || []).slice();
  if (!list.length && state.images[state.selectedId]) list.push(state.images[state.selectedId].href);
  return openLightbox(list, i);
};
window.__pfContextMenu = (ev) => buildContextMenu(ev);
window.__pfInbox = () => inboxArea;

  // 快捷键表
  $('#btnShortcuts').addEventListener('click', () => toggleShortcuts(true));
  $('#btnCloseShortcuts').addEventListener('click', () => toggleShortcuts(false));
  $('#shortcuts').addEventListener('click', (ev) => { if (ev.target.id === 'shortcuts') toggleShortcuts(false); });

  // 气泡素材库
  $('#bubTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    state.bubTab = b.dataset.g;
    $$('#bubTabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderBubbles();
  });
  $('#bubOpacity').addEventListener('input', (ev) => {
    const b = selectedBubble();
    if (!b) return;
    commitThrottled(600);
    b.opacity = Number(ev.target.value) / 100;
    $('#opVal').textContent = ev.target.value + '%';
    renderStage();
  });
  $('#bubSize').addEventListener('input', (ev) => {
    const b = selectedBubble();
    if (!b) return;
    commitThrottled(600);
    const k = Number(ev.target.value) / 100;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    b.w = Math.round((b.baseW || b.w) * k);
    b.h = Math.round((b.baseH || b.h) * k);
    b.x = Math.round(cx - b.w / 2);
    b.y = Math.round(cy - b.h / 2);
    $('#sizeVal').textContent = ev.target.value + '%';
    renderStage();
  });
  $('#bubRot').addEventListener('input', (ev) => {
    const b = selectedBubble();
    if (!b) return;
    commitThrottled(600);
    b.rot = Number(ev.target.value);
    $('#rotVal').textContent = ev.target.value + '°';
    renderStage();
  });
  $('#bubText').addEventListener('input', (ev) => {
    const b = selectedBubble();
    if (!b) return;
    commitThrottled(900);
    b.text = ev.target.value;
    renderStage();
  });
  $('#bubDup').addEventListener('click', duplicateBubble);
  $('#bubDel').addEventListener('click', deleteBubble);
  $('#bubClear').addEventListener('click', () => {
    if (!state.bubbles.length) return;
    commit();
    state.bubbles = [];
    state.selBubble = null;
    renderStage(); renderBubbles();
    toast('已清空本页气泡');
  });

  // 本格句子
  $('#slotLine').addEventListener('input', (ev) => {
    if (!state.selectedId) return;
    commitThrottled(900);
    state.lines[state.selectedId] = ev.target.value;
    saveLines();
    syncSuggest(); syncSecSummary();
    // 句子变了 → 气泡推荐要跟着换（按内容挑气泡）
    clearTimeout(lineBubTimer);
    lineBubTimer = setTimeout(() => renderBubbles(), 260);
  });
  $('#btnBubbleFromLine').addEventListener('click', () => {
    const text = currentLine().trim();
    const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
    const panel = currentPlanPanel();
    // 按内容挑样式：喊叫用尖角/放射，低语用波纹，心里想的用思考泡，旁白用旁白框…
    const pick = pickBubbleForText(text, { role: panel?.role || slot?.role, beat: panel?.beat });
    addBubble(pick.type, { text });
    if (text) toast(`按内容选「${BUBBLES[pick.type]?.zh || pick.type}」· ${pick.why}`);
    if (document.body.dataset.view === 'edit') setEditMod('bubble');
    if (!text) toast('已加一个空气泡，用上面的「文字」填内容');
  });

  // 分镜表
  $('#btnReloadScript').addEventListener('click', () => refreshScript(true));
  $('#btnCopyAll').addEventListener('click', () => copyText(scriptMarkdown(), '整页分镜表已复制'));
  $('#btnDownloadScript').addEventListener('click', () => downloadText(scriptMarkdown(), `${state.tpl?.id || 'storyboard'}.md`));

  // 导出
  $('#exportW').addEventListener('input', (ev) => {
    state.exportWidth = Number(ev.target.value);
    $('#wVal').textContent = state.exportWidth + 'px';
    renderExportKv(); syncSizeUI();
  });
  // 导出宽度预设
  $('#sizeChips')?.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-w]');
    if (!c) return;
    state.exportWidth = Number(c.dataset.w);
    $('#exportW').value = String(state.exportWidth);
    $('#wVal').textContent = state.exportWidth + 'px';
    renderExportKv(); syncSizeUI();
  });
  // 页面画幅
  $('#pageRatio')?.addEventListener('change', (ev) => {
    const v = ev.target.value;
    const cur = state.tpl?.page;
    $('#customSizeRow').classList.toggle('hidden', v !== 'custom');
    if (v === 'keep') { resetPageSize(); return; }
    if (v === 'custom') {
      if (cur) { $('#pageW').value = Math.round(cur.w); $('#pageH').value = Math.round(cur.h); }
      return;
    }
    const p = RATIO_PRESETS[v];
    if (!p || !cur) return;
    const W = Math.round(cur.w);
    // 记住目标画幅：下一次「按规则匹配 / 让 AI 排戏」会优先挑同等画幅的模板
    state.wantRatio = v;
    applyPageSize(W, Math.round((W * p[1]) / p[0]), $('#chkFitPage').checked ? 'fit' : 'stretch');
  });
  $('#btnApplySize')?.addEventListener('click', () => {
    applyPageSize(Number($('#pageW').value), Number($('#pageH').value),
      $('#chkFitPage').checked ? 'fit' : 'stretch');
  });
  $('#btnResetSize')?.addEventListener('click', () => resetPageSize());
  $('#chkFitPage')?.addEventListener('change', () => toast('点「应用到这一页」生效'));
  $('#chkOutlineExport').addEventListener('change', (ev) => { state.outlineExport = ev.target.checked; });
  $('#btnPng').addEventListener('click', exportPNG);
  $('#btnSvg').addEventListener('click', exportSVG);
  $('#btnJson').addEventListener('click', exportJSON);
  $('#btnTemplateSvg').addEventListener('click', exportHollowSVG);

  // 文件选择
  $('#filePick').addEventListener('change', async (ev) => {
    const files = [...ev.target.files].filter((f) => f.type.startsWith('image/'));
    ev.target.value = '';
    if (!files.length) return;
    const mode = ev.target.dataset.mode;
    if (mode === 'slot' && state.selectedId) {
      await putImage(state.selectedId, files[0]);
    } else {
      const targets = state.tpl.slots.filter((s) => !state.images[s.id]).length
        ? state.tpl.slots.filter((s) => !state.images[s.id])
        : state.tpl.slots;
      for (let i = 0; i < Math.min(files.length, targets.length); i++) {
        await putImage(targets[i].id, files[i], { render: false });
      }
      renderStage(); renderSlotPanel(); refreshScript();
      toast(`已按阅读顺序填入 ${Math.min(files.length, targets.length)} 格`);
    }
  });
}

function onCanvasDblClick(ev) {
  const slot = slotAt(pagePoint(ev));
  if (!slot) return;
  state.selectedId = slot.id;
  renderStage(); renderSlotPanel();
  // 画师版：双击格子直接进画布（这是画师最顺的手势）
  if (ARTIST) { openPaint(slot.id); return; }
  $('#filePick').dataset.mode = 'slot';
  $('#filePick').click();
}

function activateTab(tab) {
  if (!tab) return;
  if (tab === 'script' && !document.querySelector('[data-tab="script"]')) tab = 'slot';
  $$('#tabs button').forEach((x) => {
    const on = x.dataset.tab === tab;
    x.classList.toggle('on', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  for (const k of ['slot', 'script', 'export']) {
    $('#tab' + k[0].toUpperCase() + k.slice(1)).classList.toggle('hidden', k !== tab);
  }
  if (tab === 'script' && !state.plan) refreshScript();
  if (tab === 'export') renderExportKv();
}

/* ================================================================== *
 * 图片
 * ================================================================== */
/**
 * 图片资产：一张图存成「显示用小图」的 Blob，href 用 blob URL。
 *
 * 为什么不用 data URL：
 * 整页重绘要把每张图的 href 拼进 SVG 字符串，8 张 1600×2000 的照片就是
 * 每帧 3.3MB 的字符串（实测桌面掉到 36fps）；换成 blob URL 后整页标记只有几十 KB。
 * 代价：导出时 SVG 当 <img> 加载，读不到 blob:，必须转回 data URL（见 exportImageMap）。
 *
 * 为什么存小图：手机上内存/解码是硬约束。长边 2000 够 2× 屏和 2000px 导出，
 * 又比原图（往往 4000×3000）省一个数量级的解码开销。
 */
async function putImage(slotId, file, opts = {}) {
  if (!opts.noCommit) commit();
  let asset;
  try {
    asset = await imageAsset(file, { name: file.name || 'image' });
  } catch {
    toast('这张图读不出来，换一张试试');
    return;
  }
  state.images[slotId] = asset;
  state.selectedId = slotId;
  if (opts.render !== false) {
    renderStage(); renderSlotPanel(); refreshScript();
  }
}

async function importByUrl() {
  if (!state.selectedId) return;
  const url = prompt('图片链接（http/https，或用 data:image/... 开头）：');
  if (!url) return;
  try {
    let src = url.trim();
    if (/^https?:\/\//.test(src)) src = await api.proxyImage(src);
    commit();
    state.images[state.selectedId] = await imageAsset(src, { name: 'url' });
    renderStage(); renderSlotPanel(); refreshScript();
    toast('已填入链接图片');
  } catch (e) {
    toast('导入失败：' + e.message);
  }
}

const fileToDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

const imageSize = (href) => new Promise((res) => {
  const img = new Image();
  img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => res({ w: 1000, h: 1000 });
  img.src = href;
});

/* 占位图：预览「图片塞进各种形状格子」的效果 */
async function demoFill() {
  if (!state.tpl) return;
  for (const s of state.tpl.slots) {
    if (state.images[s.id]) continue;
    state.images[s.id] = {
      href: makePlaceholder(s), iw: 1000, ih: 1000,
      zoom: 1, panX: 0, panY: 0, mode: 'cover', name: 'demo',
    };
  }
  // 顺手放两个示例气泡，让人一眼看懂气泡怎么用
  if (!state.bubbles.length) {
    const s0 = state.tpl.slots[0];
    const sBig = state.tpl.slots.reduce((a, b) => (b.area > a.area ? b : a), state.tpl.slots[0]);
    const nb = addBubble('narration-box', { text: '三天后 · 旧城区' });
    nb.x = s0.x + 10; nb.y = s0.y + 10;
    const tb = addBubble('talk-ellipse', { text: '雨停了吗？' });
    tb.x = sBig.x + sBig.w * 0.5 - tb.w / 2;
    tb.y = sBig.y + sBig.h * 0.14;
    state.selBubble = null;
  }
  renderStage(); renderSlotPanel(); refreshScript();
  toast('已用占位图预览填充效果');
}

function makePlaceholder(slot) {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 1000;
  const x = c.getContext('2d');
  const hue = (slot.order * 53 + 12) % 360;
  const g = x.createLinearGradient(0, 0, 1000, 1000);
  g.addColorStop(0, `hsl(${hue} 48% 80%)`);
  g.addColorStop(0.5, `hsl(${(hue + 26) % 360} 42% 62%)`);
  g.addColorStop(1, `hsl(${(hue + 58) % 360} 38% 42%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 1000, 1000);
  x.fillStyle = 'rgba(0,0,0,.22)';
  x.beginPath(); x.arc(500, 372, 116, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(500, 770, 205, 258, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,.9)';
  x.font = 'bold 132px ui-sans-serif, sans-serif';
  x.textAlign = 'center';
  x.fillText(String(slot.order), 500, 580);
  x.font = '38px ui-sans-serif, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.7)';
  x.fillText('PLACEHOLDER', 500, 940);
  return c.toDataURL('image/jpeg', 0.85);
}

/* ================================================================== *
 * 右栏：格子
 * ================================================================== */
/* ---------------- 格子面板：「这一格说什么」/「这一格的分镜」/「图片」三段各自折叠 ---------------- */
const SLOT_SEC_KEY = 'pf.slotsec';
/** 默认展开哪些段：「分镜」默认收起（它是查资料用的，日常最占地方） */
const SLOT_SEC_OPEN = { text: true, image: true, ai: true, board: false };
function initSlotSections() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SLOT_SEC_KEY) || '{}') || {}; } catch { /* ignore */ }
  for (const sec of $$('#slotPanel .slot-sec')) {
    const key = sec.dataset.sec;
    const head = sec.querySelector('.sec-head');
    const body = sec.querySelector('.sec-body');
    const apply = (open, animate) => {
      animateFold(sec, body, open, { instant: !animate });
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    // 用户手动开关过的以记录为准，没动过的按上面这张默认表
    apply(typeof saved[key] === 'boolean' ? saved[key] : (SLOT_SEC_OPEN[key] !== false), false);
    head.addEventListener('click', () => {
      const open = sec.classList.contains('collapsed');
      apply(open, true);
      saved[key] = open;
      try { localStorage.setItem(SLOT_SEC_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
    });
  }
}

/* ---------------- 生图提示词：自动生成 + 用户可改 ---------------- */

function syncPromptMeta() {
  const id = state.selectedId;
  if (!id) return;
  const b = buildImagePrompt(id);
  const src = b.src || 'rule';
  // 三源切换：规则切分 / AI 生成 / 自己写
  $$('#promptSrc button').forEach((x) => {
    const on = x.dataset.src === src;
    x.classList.toggle('on', on);
    if (x.dataset.src === 'ai') x.classList.toggle('disabled', !b.hasAi);
  });
  $('#promptState').textContent = { rule: '规则切分', ai: 'AI 生成', mine: '自己写' }[src] || '规则切分';
  const aiSum = $('#secAiSum');
  if (aiSum) aiSum.textContent = { rule: '规则切分', ai: 'AI 生成', mine: '自己写' }[src] || '规则切分';
  $('#promptState').classList.toggle('edited', b.edited);
  const chk = $('#chkPrefix');
  if (chk) chk.checked = b.usePrefix;
  // 只有「自己写」允许编辑；规则/AI 是只读预览（想改就切到「自己写」）
  const ta = $('#slotPrompt');
  if (ta) {
    ta.readOnly = src !== 'mine';
    ta.classList.toggle('readonly', src !== 'mine');
    const val = src === 'mine' ? (b.mine ?? '') : b.prompt;
    if (ta.value !== val) ta.value = val;
    ta.placeholder = src === 'mine'
      ? '自己写这一格的画面描述；开头词会自动保留在最前面（可在上面关掉）'
      : '这是自动生成的提示词，只读；想改就切到「自己写」';
  }
  $('#btnPromptReset').classList.toggle('hidden', !b.edited && src !== 'mine');
  $('#slotPromptSent').textContent = b.full || '—';
}

/**
 * 折叠 / 展开（卡片、格子面板、气泡库共用）
 * 量出当前高度和目标高度，用 Web Animations 走一段弹簧；
 * 终态交给 CSS 的 .collapsed（height:0 + visibility:hidden），所以动画被打断也不会卡在半截。
 */
const FOLD_EASE = 'linear(0, 0.0128, 0.0467, 0.0955, 0.1544, 0.2194, 0.2874, 0.3559, 0.4232, 0.488, 0.5491, 0.6062, 0.6587, 0.7065, 0.7497, 0.7882, 0.8224, 0.8524, 0.8786, 0.9013, 0.9207, 0.9373, 0.9512, 0.9629, 0.9726, 0.9806, 0.987, 0.9922, 0.9963, 0.9994, 1.0018, 1.0036, 1.0048, 1.0056, 1.0061, 1.0063, 1.0063, 1.0061, 1.0058, 1.0055, 1.0051, 1.0047, 1.0043, 1.0038, 1.0034, 1.003, 1.0026, 1.0023, 1)';
function animateFold(container, body, open, { instant = false } = {}) {
  if (!container || !body) return;
  const wasOpen = !container.classList.contains('collapsed');
  const from = body.getBoundingClientRect().height;
  body.getAnimations?.().forEach((a) => a.cancel());
  container.classList.toggle('collapsed', !open);
  if (instant || wasOpen === open || !body.animate || !motionOK()) return;

  const to = open ? body.scrollHeight : 0;
  const frames = open
    ? [{ height: from + 'px', opacity: 0, visibility: 'visible' }, { opacity: 1, offset: 0.55 }, { height: to + 'px', opacity: 1, visibility: 'visible' }]
    : [{ height: from + 'px', opacity: 1, visibility: 'visible' }, { opacity: 0, offset: 0.6 }, { height: '0px', opacity: 0, visibility: 'visible' }];
  container.classList.add('folding');
  let anim;
  const opt = { duration: open ? 560 : 420, easing: open ? FOLD_EASE : 'cubic-bezier(.32,.72,0,1)' };
  try { anim = body.animate(frames, opt); } catch { anim = body.animate(frames, { ...opt, easing: 'cubic-bezier(.32,.72,0,1)' }); }
  const done = () => container.classList.remove('folding');
  anim.addEventListener('finish', done);
  anim.addEventListener('cancel', done);
}

/** 小框折叠：内联样式驱动，保证真的塌下去 */
function applySlotCollapse() {
  const panel = document.querySelector('#slotPanel');
  if (!panel) return;
  for (const k of [...panel.children].filter((c) => !c.classList.contains('slot-head'))) {
    k.style.overflow = 'hidden';
    k.style.transition = 'max-height .45s cubic-bezier(.25,.8,.25,1), opacity .28s, margin .3s';
    k.style.maxHeight = state.slotCollapsed ? '0px' : 'none';
    k.style.opacity = state.slotCollapsed ? '0' : '1';
    k.style.marginTop = state.slotCollapsed ? '0px' : '';
  }
  panel.classList.toggle('collapsed', state.slotCollapsed);
  document.querySelector('#btnSlotCollapse')?.classList.toggle('open', !state.slotCollapsed);
}

/**
 * 把原来「分镜表」里这一格的信息渲染进小框的「这一格的分镜」段。
 * 由 renderSlotPanel() 统一调用 —— 换格子、重新匹配、AI 排戏之后都会自动跟着变。
 */
function renderSlotBoard(panel) {
  const box = document.querySelector('#slotBoard');
  const pr = document.querySelector('#slotBoardPrompts');
  if (!box) return;
  if (!panel) {
    box.innerHTML = '<b>状态</b><span>先在左边写剧情并点「按规则匹配」，或让 AI 导演排一次戏</span>';
    if (pr) pr.innerHTML = '';
    const sum = document.querySelector('#secBoardSum');
    if (sum) sum.textContent = '待生成';
    return;
  }
  // 只放「分镜」层面的东西；画幅比 / 导出像素这些归下面的「图片」段，别两处重复
  const rows = [
    ['景别', `${panel.roleZh || ''} ｜ ${panel.shot || ''}`],
    ['节拍', panel.beat || '通用镜头'],
    ['画面', panel.content || '（未填，写剧情或让 AI 排戏）'],
    ['台词', panel.dialogue ? '「' + panel.dialogue + '」' : '（无）'],
    ['构图', panel.beatHint || panel.composition || '—'],
  ];
  box.innerHTML = rows.map(([k, v]) => `<b>${k}</b><span>${escapeHtml(String(v))}</span>`).join('');

  if (pr) {
    pr.innerHTML = `
      <div class="bp-row"><span class="bp-label">英文提示词</span><button class="btn tiny" id="btnBoardCopyEn">复制</button></div>
      <pre class="bp-pre">${escapeHtml(panel.promptEn || '—')}</pre>
      <div class="bp-row"><span class="bp-label">中文提示词</span><button class="btn tiny" id="btnBoardCopyZh">复制</button></div>
      <pre class="bp-pre">${escapeHtml(panel.promptZh || '—')}</pre>
      <div class="bp-neg"><b>避免</b><span>${escapeHtml(panel.negative || '—')}</span></div>`;
    document.querySelector('#btnBoardCopyEn')?.addEventListener('click', () => copyText(panel.promptEn, '英文提示词已复制'));
    document.querySelector('#btnBoardCopyZh')?.addEventListener('click', () => copyText(panel.promptZh, '中文提示词已复制'));
  }
  const sum = document.querySelector('#secBoardSum');
  if (sum) sum.textContent = panel.aiOptimized ? 'AI' : (panel.beat || '规则');
}

function renderSlotPanel() {
  const has = !!(state.tpl && state.selectedId);
  syncSlotFab(has);
  $('#slotEmpty').classList.toggle('hidden', has);
  $('#slotPanel').classList.toggle('hidden', !has);
  if (!has) return;

  const slot = state.tpl.slots.find((s) => s.id === state.selectedId);
  if (!slot) return;
  const img = state.images[slot.id];
  const panel = currentPlanPanel();
  // 这一格的分镜（景别 / 节拍 / 画面 / 台词 / 构图 + 中英提示词）
  renderSlotBoard(panel);

  const idxEl = $('#slotIndex');
  if (idxEl.dataset.slot !== slot.id) {
    const first = !idxEl.dataset.slot;
    idxEl.dataset.slot = slot.id;
    if (!first) { replay(idxEl, 'pop'); replay($('#slotPanel'), 'swap'); }
  }
  idxEl.textContent = slot.order;
  $('#slotRole').textContent = panel ? `${panel.roleZh}` : slot.role;
  $('#slotShot').textContent = panel ? `${panel.shot} · ${panel.beat || '通用'}` : '';

  const thumb = $('#slotThumb');
  thumb.innerHTML = img
    ? `<img src="${img.href}" alt="slot ${slot.order}">`
    : `<span class="muted small">空格子 · 点击下方按钮或拖入图片</span>`;

  const px = {
    w: Math.round((slot.w / state.tpl.page.w) * state.exportWidth),
    h: Math.round((slot.h / state.tpl.page.w) * state.exportWidth),
  };
  $('#slotKv').innerHTML = [
    ['画幅比', panel ? panel.aspectLabel : (slot.w / slot.h).toFixed(2)],
    ['整页占比', (slot.area || 0).toFixed(1) + '%'],
    ['导出像素', `${px.w} × ${px.h}`],
    ['建议出图', panel ? panel.genSize : '—'],
  ].map(([k, v]) => `<b>${k}</b><span>${escapeHtml(String(v))}</span>`).join('');

  {
    const e = effectivePrompt(slot.id);
    const ta = $('#slotPrompt'), neg = $('#slotNegative');
    // 正在打字时不回写，免得光标跳
    if (document.activeElement !== ta) ta.value = e.prompt;
    if (document.activeElement !== neg) neg.value = e.negative;
    syncPromptMeta();
  }

  // 形状开头词（不依赖 AI，永远可用）
  const shape = panel?.shape || slot.shape || null;
  $('#shapeName').textContent = shape ? shape.zh : '—';
  $('#shapePrefix').textContent = shape?.prefixEn || '—';
  if ($('#shapePrefixZh')) $('#shapePrefixZh').textContent = shape?.prefixZh || '—';

  // 这一格应该是什么：AI 给的优先，没有就用规则引擎算的建议句
  renderCands();
  state._suggest = panel?.suggest || slotSuggest(slot.id) || '';
  state._suggestAi = !!panel?.suggestAi;
  $('#shapeTip').innerHTML = shape
    ? `已自动放在生图提示词<b>最前面</b>；用别的工具出图时也可单独复制。${escapeHtml(shape.hintZh || '')}`
    : '已自动放在生图提示词<b>最前面</b>。';

  $('#zoom').value = Math.round((img?.zoom || 1) * 100);
  $('#zoomVal').textContent = Math.round((img?.zoom || 1) * 100) + '%';
  $('#btnFitMode').textContent = img?.mode === 'contain' ? '当前：完整显示' : '当前：填满裁切';

  // 本格句子（这一格要说什么）
  $('#lineBeat').textContent = panel ? (panel.beat || panel.roleZh) : (slot.role || '—');
  const saved = state.lines[slot.id];
  $('#slotLine').value = saved != null ? saved : (panel?.dialogue || '');
  $('#slotLine').placeholder = panel?.content
    ? `这一格：${panel.content.slice(0, 40)}…  ← 在这里写台词`
    : '台词 / 旁白 / 内心独白（自动存到本机）';
  syncSuggest();
  syncSecSummary();
  if (document.body.dataset.view === 'edit') { syncEditHead(); syncEditZoom(); }

  renderBubbles();
}

function syncZoomSlider() {
  const img = state.images[state.selectedId];
  if (!img) return;
  $('#zoom').value = Math.round(img.zoom * 100);
  $('#zoomVal').textContent = Math.round(img.zoom * 100) + '%';
}

/** 生图按钮的文案/禁用状态只看「当前选中的那一格」有没有在跑 */
function refreshGenButtons() {
  const btn = $('#btnAiImage');
  if (!btn) return;
  const running = !!(state.imgJobs && state.imgJobs[state.selectedId]);
  const aiMode = state.slotAiMode === 'prompt';
  btn.disabled = running;
  btn.textContent = running
    ? (aiMode ? 'AI 正在写这一格…' : '这一格正在生图…（10–60 秒）')
    : (aiMode ? '只写这一格的提示词' : '生这一格');
}

function currentPlanPanel(slotId = state.selectedId) {
  const page = pagePlan();
  return (page?.panels || []).find((p) => p.id === slotId) || null;
}

/** 取当前页的分镜计划：AI 导演的结果优先于规则引擎 */
function pagePlan() {
  if (state.aiPlan && state.tpl && state.aiPlan.template?.id === state.tpl.id) return state.aiPlan;
  const p = state.plan?.pages?.[0];
  return p?.plan || (p && p.panels ? p : null) || (state.plan && state.plan.panels ? state.plan : null);
}

/* ================================================================== *
 * AI 导演
 * ================================================================== */
const LLM_STORE = 'pf.llm.v1';
const CHAR_STORE = 'pf.char.v1';

function loadLlm() {
  try {
    const saved = JSON.parse(localStorage.getItem(LLM_STORE) || 'null');
    if (saved) state.llm = { ...state.llm, ...saved };
  } catch { /* ignore */ }
  try { state.charSheet = localStorage.getItem(CHAR_STORE) || ''; } catch { /* ignore */ }
  $('#llmProtocol').value = state.llm.protocol || 'openai';
  $('#llmBase').value = state.llm.baseUrl || '';
  $('#llmKey').value = state.llm.apiKey || '';
  $('#llmModel').value = state.llm.model || '';
  if ($('#imgModel')) $('#imgModel').value = state.llm.imgModel || '';
  if ($('#imgProvider')) $('#imgProvider').value = state.llm.imageProvider || 'openai';
  $('#charSheet').value = state.charSheet;
  if ($('#chkKeySession')) $('#chkKeySession').checked = !!state.llm.sessionOnly;
}

function saveLlm() {
  const sessionOnly = !!$('#chkKeySession')?.checked;
  // 注意：这里是**从表单重建** state.llm，所以任何表单项之外的字段都必须显式带过来。
  // 曾经漏了 imgBaseUrl / imgKey —— 生图前会调用本函数，于是「生图专用 Base URL」被抹掉、
  // 请求回落到对话那条 baseUrl（用户看到的 api.deepseek.com/images/generations 就是这么来的）。
  state.llm = {
    ...state.llm,
    protocol: $('#llmProtocol').value,
    baseUrl: $('#llmBase').value.trim(),
    apiKey: $('#llmKey').value.trim(),
    model: $('#llmModel').value.trim(),
    imgModel: $('#imgModel') ? $('#imgModel').value.trim() : (state.llm.imgModel || ''),
    imageProvider: $('#imgProvider') ? $('#imgProvider').value : (state.llm.imageProvider || 'openai'),
    imgBaseUrl: $('#imgBaseUrl') ? $('#imgBaseUrl').value.trim() : (state.llm.imgBaseUrl || ''),
    imgKey: $('#imgKey') ? $('#imgKey').value.trim() : (state.llm.imgKey || ''),
    sessionOnly,
  };
  state.charSheet = $('#charSheet').value.trim();
  try {
    // 勾了「仅本次会话」就不把 Key 写进浏览器存储
    localStorage.setItem(LLM_STORE, JSON.stringify({ ...state.llm, apiKey: sessionOnly ? '' : state.llm.apiKey }));
  } catch { /* ignore */ }
  try { localStorage.setItem(CHAR_STORE, state.charSheet); } catch { /* ignore */ }
}

function clearLlm() {
  try { localStorage.removeItem(LLM_STORE); } catch { /* ignore */ }
  state.llm = { protocol: 'openai', baseUrl: '', apiKey: '', model: '' };
  $('#llmBase').value = ''; $('#llmKey').value = ''; $('#llmModel').value = '';
  if ($('#imgModel')) $('#imgModel').value = '';
  syncLlmStatus();
  toast('已清除本机 AI 配置');
}

async function syncLlmStatus() {
  const el = $('#llmStatus');
  const badge = $('#llmBadge');
  if (!el) return;
  const local = !!state.llm.apiKey;
  let server = null;
  try { server = await api.llmStatus(); } catch { /* ignore */ }
  if (server?.staticMode) {
    el.className = local ? 'llm-status ok' : 'llm-status';
    el.textContent = local
      ? `浏览器直连 · ${state.llm.protocol} · ${state.llm.model || '默认模型'}（Key 只在你这台机器上）`
      : '静态版也能用 AI：在上面填自己的 Key（只在浏览器里，不上传）。规则路不用 Key，随时可用';
    badge.textContent = local ? '就绪' : '待填 Key';
    badge.style.color = local ? 'var(--ok)' : 'var(--dim)';
    return;
  }
  if (local) {
    el.className = 'llm-status ok';
    el.textContent = `本机已填 Key · ${state.llm.protocol} · ${state.llm.model || '默认模型'}`;
    badge.textContent = '就绪';
    badge.style.color = 'var(--ok)';
  } else if (server?.configured) {
    el.className = 'llm-status ok';
    el.textContent = `服务端环境变量已配置 · ${server.protocol} · ${server.model}`;
    badge.textContent = '就绪';
    badge.style.color = 'var(--ok)';
  } else {
    el.className = 'llm-status';
    el.textContent = '未配置 · 规则路照常可用（AI 路需你填 Key，或设 LLM_API_KEY）';
    badge.textContent = '未配置';
    badge.style.color = '';
  }
}

async function testLlm() {
  const btn = $('#btnLlmTest');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '测试中…';
  saveLlm();
  try {
    const r = await api.llmTest({ llm: state.llm });
    if (r.ok) {
      $('#llmStatus').className = 'llm-status ok';
      $('#llmStatus').textContent = `连接成功 · ${r.model} · ${r.latencyMs}ms`;
      toast(`连接成功 ${r.latencyMs}ms`);
    } else {
      $('#llmStatus').className = 'llm-status bad';
      $('#llmStatus').textContent = `${r.error || '失败'}${r.hint ? ' · ' + r.hint : ''}`;
      toast('连接失败：' + (r.code || r.error));
    }
  } catch (e) {
    toast('连接失败：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function runAiDecide() {
  const plot = $('#plot').value.trim();
  if (!plot) { toast('先写一段剧情吧'); $('#plot').focus(); return; }
  saveLlm();
  const btn = $('#btnAiDecide');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'AI 正在读剧情、挑版式、排戏…';
  const box = $('#aiResult');
  box.classList.remove('hidden');
  box.innerHTML = '<span class="muted small">调用模型中，通常 3–20 秒…</span>';

  try {
    const res = await api.aiDecide({
      plot,
      culture: $('#culture').value,
      genre: $('#genre') ? $('#genre').value : 'all',
      ratio: $('#ratio').value,
      pageWidth: state.exportWidth,
      candidates: 10,
      characterSheet: state.charSheet,
      llm: state.llm,
    });

    if (!res.ok) {
      box.innerHTML = `<b class="err-title">AI 路失败（${escapeHtml(res.code || 'ERROR')}）</b>`
        + `<div class="rs">${escapeHtml(res.error || '')}${res.hint ? ' · ' + escapeHtml(res.hint) : ''}</div>`
        + (res.fallback?.top?.length
          ? `<div class="rs">规则路结果仍可用：${res.fallback.top.map((t) => escapeHtml(t.name)).join(' / ')}</div>`
          : '');
      toast('AI 路失败：' + (res.code || res.error));
      return;
    }

    state.aiPlan = res.plan;
    state.aiDecision = res.decision;
    state.analysis = res.analysis;
    renderIntentChips(res.analysis);
    await selectTemplate(res.decision.pick, { keepImages: true });
    // selectTemplate 只在模板不一致时清空 AI 结果，这里再兜一次
    state.aiPlan = res.plan;
    state.aiDecision = res.decision;
    renderAiResult(res);
    renderScript();
    renderSlotPanel();
    activateTab('script');
    toast(`AI 选定：${res.decision.pickName}`);
  } catch (e) {
    box.innerHTML = `<b class="err-title">调用失败</b><div class="rs">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function renderAiResult(res) {
  const d = res.decision;
  const warn = [];
  if (d.quality?.corrected) warn.push('模型给的模板 id 不合法，已自动纠正');
  if (d.quality?.missing?.length) warn.push(`${d.quality.missing.length} 格未排戏，已回落到规则节拍`);
  if (d.quality?.dropped?.length) warn.push(`${d.quality.dropped.length} 个无效 slotId 被丢弃`);

  const box = $('#aiResult');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="pick">${escapeHtml(d.pickName)}<span class="conf">${d.confidence != null ? Math.round(d.confidence * 100) + '%' : ''}</span></div>
    <div class="rs">${escapeHtml(d.reason || '')}</div>
    ${d.alternatives?.length ? `<div class="rs">备选：${d.alternatives.map((a) => escapeHtml(a.id)).join(' / ')}</div>` : ''}
    <div class="rs">${escapeHtml(res.llm?.model || '')} · ${res.llm?.latencyMs || 0}ms${res.llm?.usage ? ` · ${res.llm.usage.total_tokens || res.llm.usage.output_tokens || ''} tokens` : ''}</div>
    ${warn.length ? `<div class="warn">${warn.map(escapeHtml).join('；')}</div>` : ''}`;
}

/* ================================================================== *
 * 匹配
 * ================================================================== */
async function runMatch() {
  const plot = $('#plot').value.trim();
  if (!plot) { toast('先写一段剧情吧（哪怕两句话）'); $('#plot').focus(); return; }
  state.plot = plot;
  const btn = $('#btnMatch');
  btn.disabled = true;
  btn.querySelector('span').textContent = '匹配中…';
  try {
    const res = await api.match({
      plot,
      culture: $('#culture').value,
      genre: $('#genre') ? $('#genre').value : 'all',
      // 「自动」时如果这一页已经改过画幅，就按当前画幅挑模板（从一开始就对齐目标尺寸）
      ratio: $('#ratio').value !== 'auto' ? $('#ratio').value : (state.wantRatio || 'auto'),
      limit: 8,
    });
    state.analysis = res.analysis;
    renderIntentChips(res.analysis);
    renderMatchResults(res.results);
    if (res.results[0]) {
      await selectTemplate(res.results[0].id, { keepImages: true });
      toast(`已载入最匹配的分镜：${res.results[0].name}`);
    }
  } catch (e) {
    toast('匹配失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = '按规则匹配';
  }
}

function renderIntentChips(a) {
  const box = $('#intentChips');
  if (!a) { box.innerHTML = ''; return; }
  const bits = a.intents.slice(0, 4).map((it, i) =>
    `<span class="chip ${i === 0 ? 'hot' : ''}">${it.zh} ${(it.conf * 100).toFixed(0)}%</span>`);
  bits.push(`<span class="chip">约 ${a.panelTarget} 格</span>`);
  if (a.cultureHint) bits.push(`<span class="chip">${CULTURE_ZH[a.cultureHint]}</span>`);
  if (a.pace === 'fast') bits.push('<span class="chip">快节奏</span>');
  if (a.pace === 'slow') bits.push('<span class="chip">慢节奏</span>');
  box.innerHTML = bits.join('');
  $('#analyzeHint').textContent = '规则引擎·已识别';
}

function renderMatchResults(results) {
  const box = $('#matchResults');
  box.classList.remove('hidden');
  box.innerHTML = results.map((r, i) => `
    <div class="res" data-id="${r.id}">
      <div class="rank">${i + 1}</div>
      <div>
        <div class="nm">${escapeHtml(r.name)}</div>
        <div class="wh">${escapeHtml(r.why.slice(0, 2).join('；') || '—')} · ${r.panels}格 ${ratioName(r.ratio)}</div>
      </div>
      <div class="sc">${r.score.toFixed(1)}</div>
    </div>`).join('');
  stagger(box, '.res');
  box.querySelectorAll('.res').forEach((el) => {
    el.addEventListener('click', () => { selectTemplate(el.dataset.id, { keepImages: true }); goCanvasOnCompact(); });
  });
}

/* ================================================================== *
 * 分镜表
 * ================================================================== */
async function refreshScript(force = false) {
  if (!state.tpl) return;
  // AI 导演已经排过这套模板的戏 → 不再用规则结果覆盖
  if (state.aiPlan && state.aiPlan.template?.id === state.tpl.id && !force) {
    renderScript(); renderSlotPanel();
    return;
  }
  const plot = $('#plot').value.trim();  // 空文本交给服务端：用模板自身戏路当骨架
  try {
    const res = await api.plan({
      plot,
      templateId: state.tpl.id,
      pageWidth: state.exportWidth,
    });
    if (res.error) throw new Error(res.error);
    attachSuggestions(plot, res?.pages?.[0]?.plan);
    state.plan = res;
    renderScript();
    renderSlotPanel();
  } catch (e) {
    $('#scriptHint').textContent = '分镜表生成失败：' + e.message;
  }
}

function renderScript() {
  const page = pagePlan();
  if (!page) return;
  const panels = page.panels || [];
  const aiMode = !!(state.aiPlan && state.aiPlan.template?.id === state.tpl.id);
  $('#scriptHint').textContent = `${state.tpl.name} · ${panels.length} 格 · ${page.readingOrder || ''}${aiMode ? ' · AI 排戏' : ' · 规则引擎'}`;

  const db = $('#decisionBox');
  if (aiMode && state.aiDecision) {
    const d = state.aiDecision;
    db.classList.remove('hidden');
    db.innerHTML = `<div class="pick">AI 导演选择：${escapeHtml(d.pickName)}<span class="conf">${d.confidence != null ? Math.round(d.confidence * 100) + '%' : ''}</span></div>`
      + `<div class="rs">${escapeHtml(d.reason || '')}</div>`;
  } else {
    db.classList.add('hidden');
  }

  $('#scriptList').innerHTML = panels.map((p) => `
    <div class="sc-card" data-id="${p.id}">
      <div class="top">
        <span class="no">${p.order}</span>
        <span class="rl">${escapeHtml(p.roleZh)}</span>
        ${p.shape ? `<span class="shape-chip">${escapeHtml(p.shape.zh)}</span>` : ''}
        ${p.aiOptimized ? '<span class="shape-chip ai-chip">AI</span>' : ''}
        <span class="bt">${escapeHtml(p.beat || '通用镜头')}</span>
      </div>
      <div class="asp">${p.aspectLabel} · 建议出图 ${p.genSize} · 占页 ${p.areaPct}%</div>
      ${p.content ? `<div class="ct">${escapeHtml(p.content)}</div>` : ''}
      ${p.dialogue ? `<div class="dl">「${escapeHtml(p.dialogue)}」</div>` : ''}
      <div class="pr">${escapeHtml(effectivePrompt(p.id).prompt)}</div>
      ${p.promptZh ? `<div class="pr zh">${escapeHtml(p.promptZh)}</div>` : ''}
      <div class="act">
        <button class="btn tiny" data-act="copy">复制提示词</button>
        <button class="btn tiny" data-act="prefix">复制形状词</button>
        <button class="btn tiny" data-act="prefixZh">复制中文形状词</button>
        <button class="btn tiny" data-act="promptZh">复制中文提示词</button>
        <button class="btn tiny" data-act="fill">填入选中格</button>
      </div>
    </div>`).join('');
  stagger($('#scriptList'), '.sc-card', 10);

 $('#scriptList').querySelectorAll('.sc-card').forEach((card) => {
    const p = panels.find((x) => x.id === card.dataset.id);
    card.addEventListener('click', (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'copy') copyText(effectivePrompt(p.id).prompt, '该格提示词已复制');
      else if (act === 'prefix') copyText(p.shape?.prefixEn || '', '形状开头词已复制');
      else if (act === 'prefixZh') copyText(p.shape?.prefixZh || '', '中文形状词已复制');
      else if (act === 'promptZh') copyText(p.promptZh || '', '中文提示词已复制');
      else if (act === 'fill') { state.selectedId = p.id; renderStage(); renderSlotPanel(); toast('已选中第 ' + p.order + ' 格'); }
      else { state.selectedId = p.id; renderStage(); renderSlotPanel(); }
    });
  });
}

/* ================================================================== *
 * AI 提示词优化
 * ================================================================== */
/** 把剧情按标点切成短句，按格数均匀铺开（AI 接管时以 AI 的 say 为准） */
function attachSuggestions(plot, plan) {
  const panels = plan?.panels || [];
  if (!panels.length) return plan;
  const clauses = String(plot || '')
    .split(/[。！？；\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (!clauses.length) return plan;
  panels.forEach((p, i) => {
    if (p.suggest) return;              // AI 已经给了，不覆盖
    const idx = Math.min(clauses.length - 1, Math.floor((i / panels.length) * clauses.length));
    p.suggest = clauses[idx];
    p.suggestAi = false;
  });
  return plan;
}

function slotSuggest(slotId) {
  const page = pagePlan();
  return page?.panels?.find((p) => p.id === slotId)?.suggest || '';
}

/* ---------------- 候选图（重画 / 换一张） ---------------- */
function candsOf(slotId) {
  if (!state.cands[slotId]) state.cands[slotId] = [];
  return state.cands[slotId];
}

function renderCands() {
  const strip = $('#candStrip');
  const grid = $('#candGrid');
  if (!strip || !grid) return;
  const list = state.selectedId ? candsOf(state.selectedId) : [];
  strip.classList.toggle('hidden', list.length === 0);
  if (!list.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = list.map((href, i) => `
    <button class="cand" data-i="${i}" title="点一下用这张">
      <img src="${escapeHtml(href)}" alt="候选 ${i + 1}">
      <span class="del" data-del="${i}" title="删掉这张">×</span>
      <span class="edit" data-edit="${i}" title="用这张进画布继续画（AI 出稿 → 手改）">✎</span>
    </button>`).join('');
}

/** 候选图 → 直接用这张进画布（AI 出稿、画师接手的那一步） */
async function applyCandAndEdit(i) {
  const sid = state.selectedId;
  const list = sid ? candsOf(sid) : [];
  const href = list[i];
  if (!href) return;
  try {
    const asset = await imageAsset(href, { name: 'ai' });
    commit();
    state.images[sid] = asset;
    renderStage(); renderSlotPanel(); refreshScript();
    await openPaint(sid);
  } catch (e) {
    toast('这张图打不开：' + e.message);
  }
}

function applyCand(i) {
  const list = state.selectedId ? candsOf(state.selectedId) : [];
  const href = list[i];
  if (!href) return;
  const sid = state.selectedId;
  imageAsset(href, { name: 'ai' }).then((asset) => {
    commit();
    state.images[sid] = asset;
    renderStage(); renderSlotPanel(); refreshScript();
    toast('已换成候选 ' + (i + 1));
  }).catch((e) => toast('这张图读不出来：' + e.message));
}

/* ---------------- 多服务商 Key 管理 ---------------- */
const KEYS_STORE = 'pf.keys.v1';

const KEY_PRESETS = {
  deepseek: { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', imgModel: '' },
  openai: { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', imgModel: 'gpt-image-1' },
  siliconflow: { name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', imgModel: 'Kwai-Kolors/Kolors' },
  anthropic: { name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', imgModel: '' },
  moonshot: { name: 'Moonshot', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', imgModel: '' },
  // 火山方舟（豆包）：版本段是 /api/v3，不是 /v1；模型要填 model id 或接入点 ep-xxxx。
  // 这里的默认值只是「能跑通的最小示例」，具体以你控制台里开通的模型为准。
  volcengine: {
    name: '火山方舟（豆包）', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    // 对话模型留空：账号里有哪些模型只有控制台知道，填死一个不存在的 ID 只会让人以为配置错了
    model: '',
    imgProvider: 'volcengine',
    imgModel: 'doubao-seedream-5-0-pro-260628',
    imgHint: 'Model ID 从方舟「模型广场」复制（带日期后缀，如 doubao-seedream-5-0-pro-260628）；'
      + '生图不需要对话模型，想用 AI 排戏/切分再填一个对话模型的 ID',
  },
  dashscope: {
    name: '通义百炼', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    imgProvider: 'openai',
    imgModel: 'wanx2.1-t2i-turbo',
    imgHint: '百炼兼容模式：文本 qwen-plus；生图用 wanx2.1-t2i-turbo（异步任务在部分模型上不支持，失败就换 wanx2.1-t2i-plus）',
  },
  custom: { name: '自定义', protocol: 'openai', baseUrl: '', model: '', imgModel: '' },
};

function loadKeyStore() {
  let store = { entries: [], activeId: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS_STORE) || 'null');
    if (raw && Array.isArray(raw.entries)) store = raw;
  } catch { /* ignore */ }
  // 从旧单条配置迁移
  try {
    const old = JSON.parse(localStorage.getItem(LLM_STORE) || 'null');
    if (old && old.apiKey && !store.entries.length) {
      store.entries.push({
        id: 'k' + Date.now().toString(36), name: '我的服务商', protocol: old.protocol || 'openai',
        baseUrl: old.baseUrl || '', model: old.model || '', apiKey: old.apiKey,
        imgProvider: old.imageProvider || 'openai', imgModel: old.imgModel || '',
        verifiedAt: 0,
      });
      store.activeId = store.entries[0].id;
    }
  } catch { /* ignore */ }
  state.keys = store;
  const active = store.entries.find((e) => e.id === store.activeId) || store.entries[0] || null;
  if (active) applyKeyEntry(active);
  renderKeyStatus();
}

function saveKeyStore() {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(state.keys)); } catch { /* ignore */ }
}

function activeKeyEntry() {
  return state.keys.entries.find((e) => e.id === state.keys.activeId) || null;
}

function applyKeyEntry(e) {
  state.llm = {
    protocol: e.protocol || 'openai',
    baseUrl: e.baseUrl || '',
    model: e.model || '',
    apiKey: e.apiKey || '',
    imageProvider: e.imgProvider || 'openai',
    imgModel: e.imgModel || '',
    imgBaseUrl: e.imgBaseUrl || '',
    imgKey: e.imgKey || '',
    sessionOnly: false,
  };
  $('#llmProtocol').value = state.llm.protocol;
  $('#llmBase').value = state.llm.baseUrl;
  $('#llmModel').value = state.llm.model;
  $('#llmKey').value = state.llm.apiKey;
  if ($('#imgProvider')) $('#imgProvider').value = state.llm.imageProvider;
  if ($('#imgModel')) $('#imgModel').value = state.llm.imgModel;
  syncLlmStatus();
}

function renderKeyStatus() {
  const cur = activeKeyEntry();
  const nameEl = $('#aiCurName');
  const metaEl = $('#aiCurMeta');
  const btn = $('#btnKeyMgr');
  if (!nameEl) return;
  if (cur) {
    nameEl.textContent = cur.name || '已配置';
    metaEl.textContent = `${cur.model || '默认模型'} · ${cur.verifiedAt ? '已验证' : '未验证'} · ${state.keys.entries.length} 个 Key`;
    btn.textContent = cur.verifiedAt ? '管理 Key' : '输入 Key';
  } else {
    nameEl.textContent = '未配置 Key';
    metaEl.textContent = '规则路照常可用，AI 是可选加速';
    btn.textContent = '输入 Key';
  }
}

function renderKeySheet() {
  const list = $('#ksList');
  if (!list) return;
  if (!state.keys.entries.length) {
    list.innerHTML = '<div class="muted small" style="padding:8px 2px">还没有保存的 Key。在右边填一个，点「保存并使用」。</div>';
    return;
  }
  list.innerHTML = state.keys.entries.map((e) => {
    const on = e.id === state.keys.activeId;
    return `<div class="ks-item${on ? ' on' : ''}" data-id="${e.id}">
      <span class="ks-radio">${on ? '●' : '○'}</span>
      <div class="ks-info">
        <b>${escapeHtml(e.name || '未命名')}</b>
        <span>${escapeHtml(e.model || '默认模型')} · ${escapeHtml(e.baseUrl || '')}</span>
        <span class="ks-key">${e.apiKey ? 'sk-••••' + String(e.apiKey).slice(-4) : '无 Key'}${e.verifiedAt ? ' · 已验证' : ''}</span>
      </div>
      <div class="ks-acts">
        <button class="btn tiny" data-act="use">${on ? '当前' : '使用'}</button>
        <button class="btn tiny" data-act="edit">编辑</button>
        <button class="btn tiny danger" data-act="del">删</button>
      </div>
    </div>`;
  }).join('');
}

function openKeySheet() {
  renderKeySheet();
  $('#keySheet').classList.remove('hidden');
}

function closeKeySheet() { $('#keySheet').classList.add('hidden'); }

/** 生图这条链路到底配好了没 —— 独立于对话模型，避免「对话挂了以为生图也废了」 */
function syncImgReady() {
  const el = $('#ksImgReady');
  if (!el) return;
  const provider = $('#ksImgProvider')?.value || state.llm?.imageProvider || 'openai';
  const model = ($('#ksImgModel')?.value || '').trim() || (state.llm?.imgModel || '');
  const base = ($('#ksImgBase')?.value || '').trim() || (state.llm?.imgBaseUrl || '') || ($('#ksBase')?.value || '').trim() || (state.llm?.baseUrl || '');
  const ownKey = ($('#ksImgKey')?.value || '').trim() || (state.llm?.imgKey || '');
  const fallbackKey = ($('#ksKey')?.value || '').trim() || (state.llm?.apiKey || '');
  const key = ownKey || fallbackKey;
  const providerName = { volcengine: '火山方舟 Seedream', openai: 'OpenAI 兼容', siliconflow: '硅基流动', stability: 'Stability' }[provider] || provider;
  if (!model) { el.textContent = '生图还没配好：缺生图模型'; el.dataset.ok = '0'; return; }
  if (!key) { el.textContent = '生图还没配好：缺 Key（生图 Key 或上面的 API Key 都行）'; el.dataset.ok = '0'; return; }
  const keySrc = ownKey ? '生图专用 Key' : '共用上面的 Key';
  const tail = ownKey || !fallbackKey ? '' : '（注意：上面那把 Key 可能属于另一家，测试对话失败也不影响这里）';
  el.textContent = `生图就绪：${providerName} · ${model} · ${base.replace(/^https?:\/\//, '')} · ${keySrc} ****${String(key).slice(-4)}${tail}`;
  el.dataset.ok = '1';
}

function fillKeyForm(e) {
  if (!e) return;
  $('#ksProtocol').value = e.protocol || 'openai';
  $('#ksBase').value = e.baseUrl || '';
  $('#ksModel').value = e.model || '';
  $('#ksKey').value = e.apiKey || '';
  $('#ksImgProvider').value = e.imgProvider || 'openai';
  $('#ksImgModel').value = e.imgModel || '';
  // 生图专属（留空 = 复用上面那条）
  if ($('#ksImgBase')) $('#ksImgBase').value = e.imgBaseUrl || '';
  if ($('#ksImgKey')) $('#ksImgKey').value = e.imgKey || '';
  const more = document.querySelector('.ks-more');
  if (more) more.open = !!(e.imgBaseUrl || e.imgKey);
}

function formEntry() {
  return {
    id: state._editingKeyId || 'k' + Date.now().toString(36),
    name: ($('#ksPreset').selectedOptions[0]?.textContent || '服务商').trim(),
    protocol: $('#ksProtocol').value,
    baseUrl: $('#ksBase').value.trim(),
    model: $('#ksModel').value.trim(),
    apiKey: $('#ksKey').value.trim(),
    imgProvider: $('#ksImgProvider').value,
    imgModel: $('#ksImgModel').value.trim(),
    imgBaseUrl: ($('#ksImgBase')?.value || '').trim(),
    imgKey: ($('#ksImgKey')?.value || '').trim(),
    verifiedAt: 0,
  };
}

function upsertKey(entry) {
  const i = state.keys.entries.findIndex((x) => x.id === entry.id);
  if (i >= 0) state.keys.entries[i] = { ...state.keys.entries[i], ...entry };
  else state.keys.entries.push(entry);
  state.keys.activeId = entry.id;
  saveKeyStore();
  applyKeyEntry(state.keys.entries.find((x) => x.id === entry.id));
  renderKeyStatus();
  renderKeySheet();
}

/* ---------------- 角色参考图 ---------------- */
async function loadChars() {
  try {
    const list = await Promise.race([idbGet('chars'), new Promise((r) => setTimeout(() => r(null), 1200))]);
    if (Array.isArray(list)) state.chars = list;
  } catch { /* ignore */ }
  renderChars();
}

async function saveChars() {
  await idbSet('chars', state.chars);
}

function renderChars() {
  const box = document.querySelector('#charList');
  if (!box) return;
  if (!state.chars.length) {
    box.innerHTML = '<span class="muted small">还没有角色卡。加一张参考图，以后每次生图都会自动带上。</span>';
    return;
  }
  box.innerHTML = state.chars.map((c) => {
    const on = state.activeChars.includes(c.id);
    return `<div class="char-item${on ? ' on' : ''}" data-id="${c.id}">
      <div class="char-thumbs">${(c.images || []).slice(0, 3).map((h) => `<img src="${escapeHtml(h)}" alt="">`).join('')}</div>
      <div class="char-meta">
        <b>${escapeHtml(c.name || '未命名')}</b>
        <span>${escapeHtml(c.note || '')}</span>
      </div>
      <div class="char-acts">
        <button class="btn tiny" data-act="toggle">${on ? '停用' : '启用'}</button>
        <button class="btn tiny danger" data-act="del">删</button>
      </div>
    </div>`;
  }).join('');
}

async function addCharCard(files) {
  const nameEl = document.querySelector('#charName');
  const noteEl = document.querySelector('#charNote');
  const name = (nameEl?.value || '').trim() || '角色 ' + (state.chars.length + 1);
  const note = (noteEl?.value || '').trim();
  const picked = [...files].slice(0, 3);
  const images = [];
  for (const f of picked) {
    try {
      const href = await shrinkImage(f, 512);
      images.push(href);
    } catch { /* 跳过读不出的 */ }
  }
  if (!images.length) { toast('这几张图读不出来，换一张试试'); return; }
  state.chars.push({ id: 'c' + Date.now().toString(36), name, note, images });
  state.activeChars.push(state.chars[state.chars.length - 1].id);
  if (nameEl) nameEl.value = '';
  if (noteEl) noteEl.value = '';
  await saveChars();
  renderChars();
  queueSave();
  toast('已保存角色「' + name + '」并启用');
}

/** 参考图统一压到 512px 长边，省空间也够模型认人 */
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片读不出来')); };
    img.src = url;
  });
}

/** 当前启用的角色 → { block: 提示词片段, refs: [dataURL] } */
/** 风格跟随模式（char / sample / both / none） */
function styleMode() {
  const m = state.styleFollow;
  return ['char', 'sample', 'both', 'none'].includes(m) ? m : 'char';
}
function followChars() { return styleMode() === 'char' || styleMode() === 'both'; }
function followSamples() { return styleMode() === 'sample' || styleMode() === 'both'; }

/**
 * 这一次要发给生图模型的人设/风格信息。
 * 统一入口：人设图、样图都从这里出，避免"某个按钮忘了带参考图"这类不一致。
 */
function activeCharPayload() {
  const parts = [];
  const refs = [];

  if (followChars()) {
    const chars = state.chars.filter((c) => state.activeChars.includes(c.id));
    if (chars.length) {
      parts.push('角色一致性：' + chars.map((c) => `${c.name}${c.note ? '（' + c.note + '）' : ''}`).join('；')
        + '。外观、发型、服装、年龄必须与参考图完全一致，不要换脸。');
      refs.push(...chars.flatMap((c) => c.images || []));
    }
  }

  if (followSamples()) {
    const samples = (state.samples || []).filter((x) => x && x.href);
    if (samples.length) {
      parts.push(`风格一致性：严格照参考样图的画风、线宽、上色方式与配色，不要擅自更换画风（共 ${samples.length} 张样图）。`);
      refs.push(...samples.map((x) => x.href));
    }
  }

  return { block: parts.join(' '), refs: refs.slice(0, 6) };
}

/* ---------------- 角色卡的导出 / 导入（团队共用同一批人） ---------------- */
const CHARS_MAX = 60;
/** 去重指纹：名字 + 第一张参考图 */
const charKey = (c) => `${(c.name || '').trim()}||${(c.images || [])[0] || ''}`;

function exportChars() {
  if (!state.chars.length) { toast('还没有角色卡可导出'); return; }
  const payload = {
    app: 'panel-forge',
    kind: 'character-cards',
    version: 1,
    exportedAt: new Date().toISOString(),
    chars: state.chars.map((c) => ({
      name: c.name || '',
      note: c.note || '',
      active: state.activeChars.includes(c.id),
      images: (c.images || []).slice(0, 3),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(JSON.stringify(payload, null, 2), `角色卡-${stamp}.json`, 'application/json;charset=utf-8');
  toast(`已导出 ${payload.chars.length} 张角色卡`);
}

/** 从 JSON 导入：本机已有的（名字＋参考图都一样）自动跳过，重复导入不会堆一堆 */
async function importChars(file) {
  if (file.size > 24 * 1024 * 1024) { toast('这个文件太大了（超过 24MB），拆成两份再导'); return null; }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('这个文件不是合法的 JSON'); return null;
  }
  // 兼容两种：导出时生成的整包，或者干脆是一个角色数组
  const list = Array.isArray(data) ? data : (Array.isArray(data?.chars) ? data.chars : null);
  if (!list) { toast('JSON 里没找到角色卡，请用「导出角色卡」生成的那份文件'); return null; }

  const seen = new Set(state.chars.map(charKey));
  const room = Math.max(0, CHARS_MAX - state.chars.length);
  const fresh = [];
  let skipped = 0, noImg = 0;
  for (const raw of list.slice(0, 200)) {
    const images = (Array.isArray(raw?.images) ? raw.images : [])
      .filter((h) => typeof h === 'string' && /^data:image\//i.test(h)).slice(0, 3);
    if (!images.length) { noImg++; continue; }
    const card = {
      id: 'c' + Math.random().toString(36).slice(2, 10),
      name: String(raw?.name || '').trim().slice(0, 40) || '角色',
      note: String(raw?.note || '').trim().slice(0, 120),
      images,
    };
    const key = charKey(card);
    if (seen.has(key) || fresh.length >= room) { skipped++; continue; }
    seen.add(key);
    fresh.push({ card, active: raw?.active !== false });
  }
  if (!fresh.length) {
    toast(room <= 0 ? `角色卡最多 ${CHARS_MAX} 张，先删几张再导入`
      : noImg ? '导入的角色都没有参考图，没法用'
        : '这些角色卡本机已经有了');
    return null;
  }
  for (const { card } of fresh) state.chars.push(card);
  for (const { card, active } of fresh) if (active) state.activeChars.push(card.id);
  await saveChars();
  renderChars();
  queueSave();
  const tail = [skipped ? `${skipped} 张重复` : '', noImg ? `${noImg} 张缺参考图` : ''].filter(Boolean).join('，');
  toast(`导入 ${fresh.length} 张角色卡${tail ? `（跳过 ${tail}）` : ''}`);
  return { added: fresh.length, skipped, noImg };
}

/* ---------------- 多页：IndexedDB 草稿（关掉浏览器也不丢） ---------------- */
const DB_NAME = 'panelforge';
const DB_STORE = 'drafts';
let dbPromise = null;
let dirty = false;
let saveTimer = 0;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbPromise;
}

/**
 * 草稿存储分两块：
 *   drafts/pages      小记录（模板、句子、气泡、图片的变换；**不含图片字节**）
 *   drafts/img:<页id> 图片 Blob，只在那一页换了图时才重写
 * 这样改一句台词只写几 KB，不用把几 MB 的图重写一遍（手机上那一下停顿很明显）。
 */
let pageSeq = 0;
const savedImageSigs = new Map(); // pageId → 图片指纹
const blobIds = new WeakMap();
let blobSeq = 0;
const blobIdOf = (blob) => {
  if (!blob) return 0;
  let id = blobIds.get(blob);
  if (!id) { id = ++blobSeq; blobIds.set(blob, id); }
  return id;
};
const imageSig = (images) => Object.entries(images || {})
  .map(([k, v]) => `${k}#${blobIdOf(v?.blob)}#${v?.iw || 0}x${v?.ih || 0}`).join('|');
const stripBlobs = (images) => Object.fromEntries(Object.entries(images || {}).map(([k, v]) => {
  if (!v) return [k, v];
  const { blob, ...rest } = v;
  return [k, rest];
}));
const blobMap = (images) => Object.fromEntries(Object.entries(images || {})
  .filter(([, v]) => v && v.blob).map(([k, v]) => [k, v.blob]));

/** 老草稿里的图是 data URL：转成 Blob（顺手按 IMG_MAX_SIDE 降采样），之后存盘就不用再搬那几 MB */
async function upgradeImages(images) {
  const out = {};
  for (const [k, v] of Object.entries(images || {})) {
    if (!v) continue;
    if (v.blob) { out[k] = { ...v, href: urlForBlob(v.blob) }; continue; }
    if (!/^data:image\//i.test(String(v.href || ''))) { out[k] = { ...v }; continue; }
    try {
      const a = await imageAsset(v.href, { name: v.name || 'image' });
      out[k] = { ...a, zoom: v.zoom ?? 1, panX: v.panX ?? 0, panY: v.panY ?? 0, mode: v.mode || 'cover' };
    } catch { out[k] = { ...v }; }
  }
  return out;
}

async function idbSet(key, value) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((res) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch { res(false); }
  });
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

function queueSave() {
  dirty = true;
  clearTimeout(saveTimer);
  // 给自动化测试一个可等待的「保存中」标记（固定 sleep 在慢机器上会抖）
  window.__pfSaveBusy = true;
  saveTimer = setTimeout(saveDraft, 1200);
}

/**
 * 立即落盘（跳过 queueSave 的 1200ms 防抖）。
 * 场景：刚拖完图就刷新/关页面 —— 防抖还没到点，草稿里就没有这张图。
 */
async function flushSave() {
  if (!state.tpl || !state.pages.length) return false;
  clearTimeout(saveTimer);
  try { await saveDraft(); return true; }
  catch { return false; }
}

async function saveDraft() {
  if (!state.tpl || !state.pages.length) return;
  const t0 = perfNow();
  savePage();
  for (const pg of state.pages) if (!pg.id) pg.id = 'pg' + (++pageSeq);
  const meta = {
    pages: state.pages.map((pg) => ({ ...pg, images: stripBlobs(pg.images) })),
    pageIdx: state.pageIdx, savedAt: Date.now(), v: 2,
  };
  const ok = await idbSet('pages', meta);
  if (ok) dirty = false;
  // 图片单独写，而且只有那一页真的换了图才写
  let blobBytes = 0;
  for (const pg of state.pages) {
    const sig = imageSig(pg.images);
    if (savedImageSigs.get(pg.id) === sig) continue;
    const blobs = blobMap(pg.images);
    await idbSet('img:' + pg.id, blobs);
    savedImageSigs.set(pg.id, sig);
    for (const b of Object.values(blobs)) blobBytes += b.size || 0;
  }
  if (PERF) {
    perf.saves++;
    perf.lastSaveBytes = JSON.stringify(meta).length + blobBytes;
    perfDone('save', t0);
  }
  window.__pfSaveBusy = false;
}

async function loadDraft() {
  const d = await idbGet('pages');
  if (!d || !Array.isArray(d.pages) || !d.pages.length) return null;
  for (const pg of d.pages) {
    // 图片字节单独存着，先装回 Blob，再（老草稿）把 data URL 换成 Blob
    const stored = pg.id ? await idbGet('img:' + pg.id) : null;
    if (stored) {
      for (const [slot, blob] of Object.entries(stored)) {
        if (pg.images?.[slot] && blob instanceof Blob) pg.images[slot].blob = blob;
      }
    }
    pg.images = await upgradeImages(pg.images);
    if (!pg.id) pg.id = 'pg' + (++pageSeq);
    savedImageSigs.set(pg.id, imageSig(pg.images));
  }
  return d;
}

function pageLabel(pg, i) {
  return (pg && pg.name) || '第 ' + (i + 1) + ' 页';
}

async function renamePage(i) {
  const pg = state.pages[i];
  if (!pg) return;
  const cur = pg.name || '';
  const name = prompt('给这一页起个名字（比如：开场 / 对峙 / 收束）', cur || pageLabel(pg, i));
  if (name === null) return;
  pg.name = String(name).trim().slice(0, 24);
  renderPageTabs();
  queueSave();
}

/* ---------------- 多页 ---------------- */
function currentPageSnapshot() {
  return {
    // 页 id 必须带下去：图片是按 `img:<页id>` 单独存的，丢了 id 就每次都重写图片
    id: state.pages[state.pageIdx]?.id || undefined,
    tplId: state.tpl?.id || 'ref-4band-2col',
    images: { ...state.images },
    bubbles: state.bubbles.map((b) => ({ ...b })),
    lines: { ...state.lines },
    promptEdits: { ...state.promptEdits },
    cands: state.cands,
    activeChars: [...state.activeChars],
    slotCollapsed: state.slotCollapsed,
    slotAiMode: state.slotAiMode,
    paint: clonePaint(state.paint),
    under: { ...state.under },
    size: state.pageSize ? { ...state.pageSize } : null,   // 本页画幅（改过才存）
  };
}
/** 笔画对象要深拷一层（pts 是扁平数组），否则撤销会把旧的笔画改掉 */
function clonePaint(map) {
  return Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, {
    ...v, strokes: (v.strokes || []).map((s) => ({ ...s, pts: [...s.pts] })),
  }]));
}

function savePage() {
  if (!state.tpl) return;
  state.pages[state.pageIdx] = currentPageSnapshot();
}

function renderPageTabs() {
  const tabs = $('#pageTabs');
  if (!tabs) return;
  tabs.innerHTML = state.pages.map((pg, i) => `
    <button class="pb-tab${i === state.pageIdx ? ' on' : ''}" data-i="${i}"
      title="${escapeHtml(pg.name || pageLabel(pg, i))} · ${escapeHtml(pg.tplId)} · 双击改名">
      <b>${i + 1}</b> ${escapeHtml(pageLabel(pg, i))}${Object.keys(pg.images || {}).length ? ` · ${Object.keys(pg.images).length}图` : ''}
    </button>`).join('');
}

async function switchPage(i) {
  if (i === state.pageIdx || !state.pages[i]) return;
  savePage();
  state.pageIdx = i;
  const pg = state.pages[i];
  await selectTemplate(pg.tplId, { silent: true });
  // 这一页可能改过画幅：selectTemplate 已把 base 换成原模板，这里重排回来
  if (pg.size) {
    const sz = pg.size;
    const tpl = deriveTpl(state.tplBase, sz.w, sz.h, sz.mode || 'stretch');
    // 气泡存的是改画幅之后的坐标，直接用（不再二次缩放）
    state.tpl = tpl;
    state.pageSize = { ...sz };
  }
  state.images = rehydrateImages(pg.images || {});
  state.under = rehydrateImages(pg.under || {});
  state.paint = clonePaint(pg.paint || {});
  state.bubbles = (pg.bubbles || []).map((b) => ({ ...b }));
  state.lines = { ...(pg.lines || {}) };
  state.promptEdits = { ...(pg.promptEdits || {}) };
  state.promptSrc = { ...(pg.promptSrc || {}) };
  state.promptPrefix = { ...(pg.promptPrefix || {}) };
  state.selBubble = null;
  state.cands = pg.cands || {};
  if (Array.isArray(pg.activeChars)) state.activeChars = [...pg.activeChars];
  resetHistory();
  renderStage(); renderSlotPanel(); renderBubbles(); renderScript(); renderPageTabs();
  queueSave();
}

async function addPage() {
  if (!state.tpl) return;
  savePage();
  const copyTpl = state.tpl.id;
  state.pages.push({ tplId: copyTpl, images: {}, bubbles: [], lines: {} });
  await switchPage(state.pages.length - 1);
  toast('已加一页（同一套版式，空图）');
  queueSave();
}

async function exportAllPages() {
  if (!state.pages.length) { toast('还没有页'); return; }
  savePage();
  const btn = $('#btnExportAll');
  const old = btn.textContent;
  btn.disabled = true;
  let n = 0;
  try {
    for (let i = 0; i < state.pages.length; i++) {
      btn.textContent = `导出中 ${i + 1}/${state.pages.length}…`;
      await switchPage(i);
      await new Promise((r) => setTimeout(r, 420));
      const svg = stageSVG({ images: await exportImageMap() });
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('栅格化失败'));
        im.src = url;
      });
      const w = state.exportWidth;
      const h = Math.round((w * state.tpl.page.h) / state.tpl.page.w);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const safe = String(pageLabel(state.pages[i], i)).replace(/[\\/:*?"<>|]/g, '_');
      await exportBlob(png, `${String(i + 1).padStart(2, '0')}-${safe}.png`);
      n++;
      await new Promise((r) => setTimeout(r, 260));
    }
    toast(`已导出 ${n} 页`);
  } catch (e) {
    toast('导出中断：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function copyShapePrefixZh() {
  const p = currentPlanPanel();
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  const prefix = p?.shape?.prefixZh || slot?.shape?.prefixZh;
  if (!prefix) { toast('这一格没有中文形状词'); return; }
  copyText(prefix, '中文形状词已复制，粘到你提示词最前面');
}

/** 只让 AI 写这一格的提示词（不生图） */
async function generateSlotPromptOnly(targetId = state.selectedId) {
  if (!state.tpl || !targetId) { toast('先点一个格子'); return; }
  // 同样锁定格子：写提示词期间切格子，结果也只写回这一格
  const sid = targetId;
  state.imgJobs = state.imgJobs || {};
  if (state.imgJobs[sid]) { toast('这一格正在处理，等它出来'); return; }
  state.imgJobs[sid] = true;
  refreshGenButtons();
  saveLlm();
  try {
    const page = pagePlan();
    const llmPanels = page ? Object.fromEntries(page.panels.map((p) => [p.id, { beat: p.beat, content: p.content, dialogue: p.dialogue }])) : null;
    const res = await api.prompts({
      plot: $('#plot').value.trim(),
      templateId: state.tpl.id,
      pageWidth: state.exportWidth,
      characterSheet: state.charSheet,
      llmPanels,
      llm: state.llm,
    });
    if (!res?.ok) throw new Error((res?.code ? res.code + '：' : '') + (res?.error || 'AI 没返回'));
    const want = res.plan?.panels?.find((p) => p.id === sid);
    if (!want) throw new Error('这一格没拿到提示词');
    const target = currentPlanPanel(sid);
    if (target) { target.promptEnRule = target.promptEnRule || target.promptEn; target.promptEn = want.promptEn; target.aiOptimized = true; }
    if (state.promptEdits[sid]?.prompt != null) { commit(); delete state.promptEdits[state.selectedId].prompt; if (!Object.keys(state.promptEdits[state.selectedId]).length) delete state.promptEdits[state.selectedId]; }
    renderSlotPanel(); renderScript();
    toast(state.selectedId === sid ? '这一格的提示词已由 AI 改写' : '提示词已写回原来的那一格');
  } catch (e) {
    toast('写提示词失败：' + e.message);
  } finally {
    delete state.imgJobs[sid];
    refreshGenButtons();
  }
}

/** 用用户自己的生图模型，直接生成当前这一格 */
/**
 * AI 写台词/旁白。
 *   mode='one'   只写当前这一格
 *   mode='page'  写这一页所有还没有句子的格子（已有内容的跳过）
 *   mode='again' 换一句：连同刚才那句一起发给模型，让它别重复
 * 写好的句子会落进 state.lines（和手打完全同一条路径），并顺手给一个气泡建议。
 */
async function aiWriteLines(mode = 'one') {
  if (!state.tpl) { toast('先选一套版式'); return; }
  const page = pagePlan();
  const panels = page?.panels || [];
  if (!panels.length) { toast('还没有分镜计划：先按规则匹配或让 AI 排戏'); return; }

  const sel = state.selectedId;
  let ids = [];
  if (mode === 'page') {
    ids = panels.filter((p) => !String(state.lines?.[p.id] || '').trim()).map((p) => p.id);
    if (!ids.length) { toast('这一页每一格都有句子了'); return; }
  } else {
    if (!sel) { toast('先点一个格子'); return; }
    ids = [sel];
  }

  const btn = $('#btnAiLine');
  const btns = ['#btnAiLine', '#btnAiLineReroll', '#btnAiLinesPage'].map((x) => $(x)).filter(Boolean);
  const labels = btns.map((b) => b.textContent);
  btns.forEach((b, i) => { b.disabled = true; b.textContent = i === 0 ? 'AI 正在写…' : b.textContent; });
  saveLlm();
  try {
    const avoid = mode === 'again'
      ? { [sel]: String(state.lines?.[sel] || '') }
      : Object.fromEntries(Object.entries(state.lines || {}).filter(([, v]) => String(v || '').trim()));
    const res = await api.aiLines({
      plot: $('#plot')?.value?.trim() || '',
      plan: page,
      characterSheet: state.charSheet,
      style: $('#culture')?.selectedOptions?.[0]?.textContent || undefined,
      ids,
      avoid,
      llm: state.llm,
    });
    if (!res?.ok) throw new Error((res?.code ? res.code + '：' : '') + (res?.error || 'AI 没返回'));

    const lines = res.lines || {};
    const got = Object.keys(lines);
    if (!got.length) throw new Error('模型这次没写出可用的句子');

    commit();
    let filled = 0;
    for (const id of got) {
      const item = lines[id];
      if (!item || !item.text) continue;
      state.lines[id] = item.text;
      filled++;
      // 顺手给气泡建议：用已有的按文本选样式逻辑，不额外烧 token
      const slot = state.tpl.slots.find((x) => x.id === id);
      const panel = panels.find((x) => x.id === id);
      const pick = pickBubbleForText(item.text, { role: slot?.role, beat: panel?.beat });
      if (id === state.selectedId && pick?.type) {
        state._lineBubbleHint = { type: pick.type, why: pick.why, kind: item.kind };
      }
      if (!String(state.bubbles?.[id] || '') && pick?.type && (item.kind === '台词' || item.kind === '内心')) {
        // 该有气泡的格子直接挂上（台词/内心），旁白不挂
        state.bubbles[id] = pick.type;
      }
    }
    renderSlotPanel(); renderStage(); renderScript();

    // 把「为什么这样写」显示在思路行里
    const first = lines[ids[0]] || lines[got[0]];
    if (first?.why) { state._suggest = first.why; state._suggestAi = true; syncSuggest(); }
    if (state.selectedId === ids[0]) {
      const ta = $('#slotLine');
      if (ta) ta.value = state.lines[ids[0]] || '';
    }
    toast(mode === 'page'
      ? `已给 ${filled} 格写好台词（空着的才写）`
      : `已写好：${String(state.lines[ids[0]] || '').slice(0, 16)}`);
  } catch (e) {
    const code = e?.code ? `（${e.code}）` : '';
    toast(`写台词失败${code}`);
    showErrorDetail('写台词失败', e);
  } finally {
    btns.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; });
  }
}

async function generateSlotImage(targetId = state.selectedId) {
  if (!state.tpl || !targetId) { toast('先点一个格子'); return; }
  // 锁定格子：生成期间你点别的格子，结果也只回到这一格（以前是回到「点击时选中的那格」→ 会串格）
  const sid = targetId;
  const panel = currentPlanPanel(sid);
  const slot = state.tpl.slots.find((s) => s.id === sid);
  const cellLabel = slot ? `第 ${slot.order} 格` : '这一格';
  state.imgJobs = state.imgJobs || {};
  if (state.imgJobs[sid]) { toast(`${cellLabel}正在生成，等它出来`); return; }
  state.imgJobs[sid] = true;
  refreshGenButtons();
  saveLlm();
  try {
    const built = buildImagePrompt(sid);
    const charPayload = built.chars;
    if (!charPayload.block) {
      const ok = confirm('还没启用角色参考图，生成的图可能每格长得不一样。\n\n建议先去左边「角色参考图」加一张。\n\n仍然继续生图吗？');
      if (!ok) { btn.disabled = false; btn.textContent = old; return; }
    }
    const res = await withTimeout(api.imageGenerate({
      prompt: built.full,
      refs: charPayload.refs,
      size: panel?.genSize || undefined,
      model: state.llm.imgModel || undefined,
      provider: state.llm.imageProvider || 'openai',
      llm: state.llm,
      templateId: state.tpl.id,
      slotId: sid,
    }), IMG_TIMEOUT_MS, `${cellLabel}生图`);
    if (!res?.ok) throw new Error((res?.code ? res.code + '：' : '') + (res?.error || '生图失败'));
    let href = res.href;
    if (!href && res.b64) href = 'data:image/png;base64,' + res.b64;
    if (!href && res.url) href = await api.proxyImage ? await blobToDataURL(await api.proxyImage(res.url)) : res.url;
    if (!href) throw new Error('生图接口没有返回可用的图片');
    const list = candsOf(sid);
    list.unshift(href);
    if (list.length > 8) list.pop();
    commit();
    state.images[sid] = await imageAsset(href, { name: 'ai' });
    renderStage(); renderSlotPanel(); refreshScript(); renderCands();
    const ignoredRefs = Number(res?.refsIgnored) || 0;
    const stillOnCell = state.selectedId === sid;
    if (ignoredRefs) {
      // 模型不吃参考图（如 dall-e-3）：生成了，但要说清楚参考图没生效
      toast(`${cellLabel}已生成，但 ${ignoredRefs} 张参考图被忽略：当前模型不支持图生图`);
    } else if (stillOnCell) {
      toast('已生成并填入这一格（候选里还留着，可以换一张）');
    } else {
      // 生成期间你切了格子：结果照样回到原来那一格，明说一句免得你以为没反应
      toast(`${cellLabel}已生成（没有跳过去，还停在你现在看的这格）`);
    }
  } catch (e) {
    // 短提示 + 完整面板：toast 装不下长错误，用户报过「报错信息不全」
    const code = e?.code ? `（${e.code}）` : '';
    toast(`生图失败${code} · 已弹出详情`);
    showErrorDetail('生图失败', e);
    if ($('#footMsg')) $('#footMsg').textContent = '生图失败：' + (e?.message || e);
  } finally {
    // 只清这一格的作业标记；按钮状态跟着「当前选中的格子」走（用户可能已经切走了）
    if (state.imgJobs) delete state.imgJobs[sid];
    refreshGenButtons();
  }
}

function copyShapePrefix() {
  const p = currentPlanPanel();
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  const prefix = p?.shape?.prefixEn || slot?.shape?.prefixEn;
  if (!prefix) { toast('这一格没有形状词'); return; }
  copyText(prefix, '形状开头词已复制，粘到你提示词最前面');
}

async function runAiSplit() {
  if (!state.tpl) { toast('先选一套版式'); return; }
  const plot = $('#plot').value.trim();
  if (!plot) { toast('先在左栏粘贴源文本'); return; }
  const btn = $('#btnAiSplit');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '切分中…';
  $('#scriptHint').textContent = 'AI 正在把源文本切成每格…';
  try {
    saveLlm();
    const res = await api.aiSplit({
      plot,
      templateId: state.tpl.id,
      pageWidth: state.exportWidth,
      characterSheet: state.charSheet,
      note: $('#charSheet')?.value?.trim() ? '' : undefined,
    });
    if (!res.ok) {
      $('#scriptHint').textContent = `${res.error || '切分失败'}${res.hint ? ' · ' + res.hint : ''}`;
      toast(`切分失败：${res.code || res.error}`);
      return;
    }
    // AI 的切分结果作为这一页的分镜（不再走规则引擎的节拍表）
    state.aiPlan = { template: { id: state.tpl.id, name: state.tpl.name }, plan: res.plan, mode: 'ai-split' };
    state.plan = { pages: [{ pageIndex: 1, segment: plot, analysis: state.analysis, templateScore: null, plan: res.plan }] };
    renderScript();
    renderSlotPanel();
    const miss = res.quality?.missing?.length || 0;
    $('#scriptHint').textContent = `${state.tpl.name} · 已切好 ${res.applied}/${res.total} 格`
      + (miss ? ` · ${miss} 格模型没给（可用「AI 优化提示词」补）` : '')
      + (res.globalNotes ? ` · ${res.globalNotes}` : '');
    toast(`AI 切原文完成：${res.applied}/${res.total} 格`);
  } catch (e) {
    $('#scriptHint').textContent = '切分出错：' + e.message;
    toast('切分失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function runAiPrompts() {
  if (!state.tpl) { toast('先选一套版式'); return; }
  const plot = $('#plot').value.trim();
  saveLlm();
  const btn = $('#btnAiPrompts');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '优化中…';
  try {
    const page = pagePlan();
    const llmPanels = page
      ? Object.fromEntries(page.panels.map((p) => [p.id, { beat: p.beat, content: p.content, dialogue: p.dialogue }]))
      : null;
    const res = await api.prompts({
      plot,
      templateId: state.tpl.id,
      pageWidth: state.exportWidth,
      characterSheet: state.charSheet,
      llmPanels,
    });
    if (!res.ok) {
      toast(`优化失败：${res.code || res.error}`);
      if (res.hint) $('#scriptHint').textContent = `${res.error || ''} · ${res.hint}`;
      return;
    }
    if (state.aiPlan && state.aiPlan.template?.id === state.tpl.id) state.aiPlan = res.plan;
    else state.plan = { pages: [{ pageIndex: 1, segment: plot, analysis: null, templateScore: null, plan: res.plan }] };
    renderScript();
    renderSlotPanel();
    $('#scriptHint').textContent = `${state.tpl.name} · ${res.applied}/${res.total} 格已 AI 优化${res.globalNotes ? ' · ' + res.globalNotes : ''}`;
    toast(`AI 优化完成：${res.applied}/${res.total} 格`);
  } catch (e) {
    toast('优化失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function scriptMarkdown() {
  const page = pagePlan();
  if (!page) return '';
  const t = page.template;
  const lines = [
    `# 分镜表 · ${t.name}`,
    '',
    `- 模板 ID：\`${t.id}\``,
    `- 画风：${CULTURE_ZH[t.culture]}（${t.reading}）`,
    `- 页幅：${t.page.w}×${t.page.h}（${ratioName(t.ratio)}）`,
    `- 阅读顺序：${page.readingOrder}`,
    `- 格数：${page.panels.length}`,
    '',
    '| 格 | 景别 | 形状 | 叙事节拍 | 画幅 | 建议出图 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...page.panels.map((p) => `| ${p.order} | ${p.roleZh} | ${p.shape?.zh || '常规格'} | ${p.beat || '通用镜头'} | ${p.aspectLabel} | ${p.genSize} |`),
    '',
    '## 逐格分镜',
    ...page.panels.map((p) => [
      '',
      `### ${p.order}. ${p.roleZh} · ${p.shape?.zh || '常规格'} · ${p.beat || '通用镜头'}`,
      p.content ? `- 画面：${p.content}` : `- 构图：${p.beatHint}`,
      `- 台词：${(state.lines[p.id] ?? p.dialogue) ? '「' + (state.lines[p.id] ?? p.dialogue) + '」' : '无'}`,
      `- 形状开头词：\`${p.shape?.prefixEn || ''}\``,
      `- 提示词：\`${effectivePrompt(p.id).prompt}\``,
      `- 精简版：\`${p.promptShort || ''}\``,
      `- 负面词：\`${p.negative}\``,
    ].join('\n')),
    '',
    state.bubbles.length ? `## 气泡（${state.bubbles.length} 个）` : '',
    ...state.bubbles.map((b) => `- ${BUBBLES[b.type]?.zh || b.type}｜${b.text ? '「' + b.text + '」' : '（空）'}｜不透明度 ${Math.round((b.opacity ?? 1) * 100)}%`),
    '',
  ].filter((x) => x !== undefined);
  return lines.join('\n');
}

/* ================================================================== *
 * 导出
 * ================================================================== */
/** 导出用的整页 SVG（图片传进来的必须是 data URL，SVG 当 <img> 加载时读不到 blob:） */
function stageSVG({ withImages = true, numbers = false, images = null } = {}) {
  return renderTemplateSVG(state.tpl, {
    width: state.exportWidth,
    images: withImages ? (images || state.images) : {},
    overlays: state.bubbles,
    showNumbers: numbers,
    showRoles: false,
    slotOutline: state.outlineExport,
    selectedId: null,
    hoverId: null,
    selectedBubbleId: null,
  });
}

async function exportPNG() {
  if (!state.tpl) return;
  try {
    const svg = stageSVG({ images: await exportImageMap() });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('SVG 栅格化失败（图片可能跨域）'));
      i.src = url;
    });
    const w = state.exportWidth;
    const h = Math.round((w * state.tpl.page.h) / state.tpl.page.w);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(async (b) => {
      await exportBlob(b, `${state.tpl.id}-${w}px.png`);
      toast(`已导出 PNG ${w}×${h}`);
    }, 'image/png');
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

async function exportSVG() {
  if (!state.tpl) return;
  downloadText(stageSVG({ images: await exportImageMap() }), `${state.tpl.id}.svg`, 'image/svg+xml');
  toast('已导出 SVG');
}

function exportHollowSVG() {
  if (!state.tpl) return;
  downloadText(stageSVG({ withImages: false, numbers: true }), `${state.tpl.id}-template.svg`, 'image/svg+xml');
  toast('已导出镂空模板 SVG');
}

function exportJSON() {
  if (!state.tpl) return;
  const data = {
    template: {
      id: state.tpl.id, name: state.tpl.name, culture: state.tpl.culture,
      reading: state.tpl.reading, ratio: state.tpl.ratio, page: state.tpl.page,
      slots: state.tpl.slots.map((s) => ({
        id: s.id, order: s.order, role: s.role, poly: s.poly,
        box: { x: s.x, y: s.y, w: s.w, h: s.h }, areaPct: s.area,
      })),
    },
    images: Object.fromEntries(Object.entries(state.images).map(([k, v]) => [k, {
      name: v.name, iw: v.iw, ih: v.ih, zoom: v.zoom, panX: v.panX, panY: v.panY, mode: v.mode,
    }])),
    lines: state.lines,
    promptEdits: state.promptEdits,
    bubbles: state.bubbles,
    plan: state.plan?.pages?.[0] || null,
    exportedAt: new Date().toISOString(),
  };
  downloadText(JSON.stringify(data, null, 2), `${state.tpl.id}.json`, 'application/json');
  toast('已导出 JSON');
}

function renderExportKv() {
  if (!state.tpl) return;
  const w = state.exportWidth;
  const h = Math.round((w * state.tpl.page.h) / state.tpl.page.w);
  const filled = Object.keys(state.images).length;
  $('#exportKv').innerHTML = [
    ['输出尺寸', `${w} × ${h} px`],
    ['格数 / 已填', `${state.tpl.slots.length} / ${filled}`],
    ['画风', CULTURE_ZH[state.tpl.culture]],
    ['阅读顺序', readOrderText(state.tpl.reading)],
  ].map(([k, v]) => `<b>${k}</b><span>${escapeHtml(v)}</span>`).join('');
}

/* ================================================================== *
 * 静态站没有 /api/* 路由：把顶栏那几个只有服务端才有的链接换掉
 * ================================================================== */
const REPO = 'https://github.com/wingwu0605-art/panel-forge';

function adaptTopLinksForStatic() {
  if (!api?.staticMode) return;
  const sheet = $('#lnkSheet');
  if (sheet) { sheet.href = './sheet.html'; sheet.textContent = '全部模板一览'; }
  const docs = $('#lnkDocs');
  if (docs) docs.href = `${REPO}/blob/main/docs/API.md`;
  const tools = $('#lnkTools');
  if (tools) { tools.href = `${REPO}/blob/main/docs/AI-INTEGRATION.md`; tools.textContent = 'AI 接入说明'; }
  const chip = $('#statApi');
  if (chip) {
    chip.textContent = '静态版';
    chip.title = '没有服务端：规则引擎在你的浏览器里跑，AI 直连你填的模型';
    chip.style.opacity = '.8';
  }
}

/* ================================================================== *
 * 快捷键辅助：复制/粘贴/切换/跳转
 * ================================================================== */
let lastCommitAt = 0;
function commitThrottled(ms = 700) {
  const now = Date.now();
  if (now - lastCommitAt < ms) return;
  lastCommitAt = now;
  commit();
}

function toggleCheck(sel) {
  const el = $(sel);
  if (!el) return;
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function toggleShortcuts(force) {
  const el = $('#shortcuts');
  if (!el) return;
  const show = force === undefined ? el.classList.contains('hidden') : !!force;
  el.classList.toggle('hidden', !show);
}

function jumpNextEmpty() {
  if (!state.tpl) return;
  const list = state.tpl.slots;
  const i = list.findIndex((s) => s.id === state.selectedId);
  for (let k = 1; k <= list.length; k++) {
    const s = list[(i + k) % list.length];
    if (!state.images[s.id]) {
      state.selectedId = s.id;
      state.selBubble = null;
      renderStage(); renderSlotPanel();
      toast(`跳到第 ${s.order} 格（还是空的）`);
      return;
    }
  }
  toast('所有格子都填满了');
}

function copySelection() {
  const bub = selectedBubble();
  if (bub) {
    state.clipboard = { kind: 'bubble', data: { ...bub } };
    toast('已复制气泡（Ctrl+V 粘贴）');
    return;
  }
  const img = state.selectedId ? state.images[state.selectedId] : null;
  if (img) {
    state.clipboard = { kind: 'image', data: { ...img } };
    toast('已复制图片（选中另一格 Ctrl+V 粘贴）');
    return;
  }
  toast('没有选中的图片或气泡');
}

function cutSelection() {
  copySelection();
  const bub = selectedBubble();
  if (bub) { deleteBubble(); return; }
  if (state.selectedId && state.images[state.selectedId]) {
    commit();
    delete state.images[state.selectedId];
    renderStage(); renderSlotPanel(); refreshScript();
    toast('已剪切');
  }
}

function pasteSelection() {
  const c = state.clipboard;
  if (!c) { toast('剪贴板里没有东西'); return; }
  if (c.kind === 'image') {
    if (!state.selectedId) { toast('先点一个格子再粘贴'); return; }
    commit();
    state.images[state.selectedId] = { ...c.data };
    renderStage(); renderSlotPanel(); refreshScript();
    toast('已粘贴到该格');
    return;
  }
  if (c.kind === 'bubble') {
    commit();
    const nb = { ...c.data, id: 'b' + Math.random().toString(36).slice(2, 8), x: c.data.x + 26, y: c.data.y + 26 };
    state.bubbles.push(nb);
    state.selBubble = nb.id;
    renderStage(); renderBubbles();
    toast('已粘贴气泡');
  }
}

/* ================================================================== *
 * 气泡：素材库 + 画布交互 +  inspectors
 * ================================================================== */
function bubbleAt(pt) {
  if (!pt || !state.bubbles.length) return null;
  for (let i = state.bubbles.length - 1; i >= 0; i--) {
    const b = state.bubbles[i];
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return b;
  }
  return null;
}

function selectedBubble() {
  return state.bubbles.find((b) => b.id === state.selBubble) || null;
}

let lineBubTimer = 0;
function renderBubbles() {
  const grid = $('#bubGrid');
  if (!grid) return;
  if (!state.tpl) { grid.innerHTML = '<span class="muted small">先选一套版式</span>'; return; }

  const panel = currentPlanPanel();
  const slot = state.tpl.slots?.find((s) => s.id === state.selectedId);
  const role = panel?.role || slot?.role;
  const beat = panel?.beat || '';
  const sel = selectedBubble();

  let ids;
  let matched = null;
  if (state.bubTab === 'rec') {
    const pick = pickBubbleForText(currentLine().trim(), { role, beat });
    matched = pick;
    ids = [pick.type, ...pick.alternatives, ...recommendBubbles({ role, beat, n: 8 })];
    ids = [...new Set(ids)].slice(0, 8);
  } else {
    const used = Object.entries(state.bubUse).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    ids = [...new Set([...used, 'talk-ellipse', 'narration-box', 'burst-spike', 'thought-cloud', 'caption-tab'])].slice(0, 8);
  }

  grid.innerHTML = ids.map((id) => {
    const on = sel && sel.type === id;
    const best = matched && matched.type === id;
    return `
    <div class="bub-item${on ? ' on' : ''}${best ? ' best' : ''}" data-id="${id}"
         title="${escapeHtml(BUBBLES[id]?.hintZh || '')}${best ? ' · ' + escapeHtml(matched.why) : ''}">
      ${bubbleThumb(id, 92)}
      <span>${escapeHtml(BUBBLES[id]?.zh || id)}${best ? ' · 配这段字' : ''}</span>
    </div>`;
  }).join('');

  stagger(grid, '.bub-item');
  grid.querySelectorAll('.bub-item').forEach((el) => {
    // 已经选中一个气泡时，点下面的样式 = 换样式（不新建）
    el.addEventListener('click', () => {
      if (selectedBubble()) { setBubbleType(el.dataset.id); return; }
      addBubble(el.dataset.id);
    });
  });

  renderBubbleInspector();
}

/** 把选中的气泡换成另一种样式：保留文字、中心位置，尺寸按新样式的默认比例重算 */
function setBubbleType(type) {
  const b = selectedBubble();
  const def = BUBBLES[type];
  if (!b || !def) return false;
  if (b.type === type) { toast('已经是这个样式了'); return false; }
  commit();
  const page = state.tpl.page;
  const scale = page.w / 1000;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const ratio = def.w / def.h;
  // 尺寸：按新样式比例、面积接近原来（避免换个样式后字全挤在一起）
  const area = b.w * b.h;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  if (w > page.w * 0.9) { w = page.w * 0.9; h = w / ratio; }
  b.type = type;
  b.tail = def.tail || 'none';
  b.w = Math.round(w);
  b.h = Math.round(h);
  b.x = Math.round(clamp(cx - b.w / 2, 0, page.w - b.w));
  b.y = Math.round(clamp(cy - b.h / 2, 0, page.h - b.h));
  b.baseW = b.w; b.baseH = b.h;
  state.bubUse[type] = (state.bubUse[type] || 0) + 1;
  try { localStorage.setItem('pf.bub.use', JSON.stringify(state.bubUse)); } catch { /* ignore */ }
  renderStage();
  renderBubbles();
  toast(`样式换成「${def.zh}」`);
  return true;
}

function renderBubbleInspector() {
  const box = $('#bubInspect');
  const b = selectedBubble();
  box.classList.toggle('hidden', !b);
  if (!b) return;
  const tn = $('#bubTypeName');
  if (tn) tn.textContent = BUBBLES[b.type]?.zh || b.type;
  $('#opVal').textContent = Math.round((b.opacity ?? 1) * 100) + '%';
  $('#bubOpacity').value = Math.round((b.opacity ?? 1) * 100);
  const sc = Math.round(((b.w / (b.baseW || b.w)) || 1) * 100);
  $('#sizeVal').textContent = sc + '%';
  $('#bubSize').value = clamp(sc, 40, 220);
  $('#rotVal').textContent = (b.rot || 0) + '°';
  $('#bubRot').value = b.rot || 0;
  $('#bubText').value = b.text || '';
}

function addBubble(type, opts = {}) {
  if (!state.tpl) { toast('先选一套版式'); return null; }
  if (!opts.noCommit) commit();
  const slot = state.tpl.slots?.find((s) => s.id === state.selectedId);
  const at = opts.at || (slot ? { x: slot.x + slot.w * 0.5, y: slot.y + Math.max(30, slot.h * 0.28) } : undefined);
  const b = makeBubble(type, { page: state.tpl.page, at, text: opts.text ?? '' });
  b.baseW = b.w; b.baseH = b.h;
  state.bubbles.push(b);
  state.selBubble = b.id;
  state.bubUse[type] = (state.bubUse[type] || 0) + 1;
  try { localStorage.setItem('pf.bub.use', JSON.stringify(state.bubUse)); } catch { /* ignore */ }
  renderStage();
  renderBubbles();
  toast(`已加入「${BUBBLES[type]?.zh || type}」`);
  return b;
}

function deleteBubble() {
  const b = selectedBubble();
  if (!b) return;
  commit();
  state.bubbles = state.bubbles.filter((x) => x.id !== b.id);
  state.selBubble = null;
  renderStage();
  renderBubbles();
}

function duplicateBubble() {
  const b = selectedBubble();
  if (!b) return;
  commit();
  const copy = { ...b, id: 'b' + Math.random().toString(36).slice(2, 8), x: b.x + 24, y: b.y + 24 };
  state.bubbles.push(copy);
  state.selBubble = copy.id;
  renderStage();
  renderBubbles();
}

/* ---------- 本格句子 ---------- */
const LINES_KEY = (id) => 'pf.lines.' + id;

function loadLines(tplId) {
  try { state.lines = JSON.parse(localStorage.getItem(LINES_KEY(tplId)) || '{}') || {}; } catch { state.lines = {}; }
}

function saveLines() {
  if (!state.tpl) return;
  try { localStorage.setItem(LINES_KEY(state.tpl.id), JSON.stringify(state.lines)); } catch { /* ignore */ }
}

function currentLine() {
  const manual = state.lines[state.selectedId];
  if (manual != null) return manual;
  return currentPlanPanel()?.dialogue || '';
}

/* ================================================================== *
 * 工具
 * ================================================================== */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2200);
}

function copyText(text, msg) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => toast(msg || '已复制')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast(msg || '已复制');
  });
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** blob → base64（不带 dataURL 前缀），给原生插件用 */
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      res(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => rej(new Error('读图片失败'));
    r.readAsDataURL(blob);
  });
}

/**
 * 有原生「存相册」插件就走它（Android WebView 不支持 <a download>，网页那套会静默失败）。
 * 返回 true = 已存进相册；false = 交给调用方退回下载。
 */
async function saveToGallery(blob, name) {
  const plugin = window.Capacitor?.Plugins?.SaveImage;
  if (!plugin?.save) return false;
  try {
    const data = await blobToBase64(blob);
    const r = await plugin.save({ data, name, mime: blob.type || 'image/png' });
    toast(`已存到相册：${r?.path || 'Pictures/PanelForge'}`);
    return true;
  } catch (e) {
    console.warn('[save] 相册保存失败', e);
    toast('存相册失败：' + (e?.message || e));
    return false;
  }
}

/** 导出（能存相册就存相册，否则下载） */
async function exportBlob(blob, name) {
  if (await saveToGallery(blob, name)) return;
  downloadBlob(blob, name);
}

function downloadText(text, name, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), name);
}

/* ================================================================== *
 * 外观层：主题 / 平台快捷键 / 手机视图 / 滑块填充 / 静态版链接
 * ================================================================== */

function initChrome() {
  initTheme();
  initSegIndicators();
  initRanges();
  initPlatformKeys();
  initMoreMenu();
  initViews();
  initStaticLinks();
}

/** 当前强调色（画布里的选中框 / 格号跟着变） */
function currentTint() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim();
  return /^#|^rgb|^hsl|^color/.test(v) ? v : '#007aff';
}

function initTheme() {
  const btn = $('#btnTheme');
  const pop = $('#appearancePop');
  if (!btn || !pop) return;
  const root = document.documentElement;
  let mode = store.get(THEME_KEY) || 'auto';
  let accent = store.get(ACCENT_KEY) || 'blue';

  const syncMeta = () => {
    const dark = mode === 'auto' ? sysDarkMQ.matches : mode === 'dark';
    for (const meta of $$('meta[name="theme-color"]')) {
      meta.content = mode === 'auto' ? (meta.media.includes('dark') ? '#000000' : '#f2f2f7') : (dark ? '#000000' : '#f2f2f7');
    }
  };
  const setMode = (m) => {
    mode = m;
    if (m === 'auto') delete root.dataset.theme; else root.dataset.theme = m;
    btn.innerHTML = THEME_ICONS[m];
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    store.set(THEME_KEY, m === 'auto' ? null : m);
    syncMeta();
    renderStage();
  };
  const setAccent = (a) => {
    accent = a;
    if (a === 'blue') delete root.dataset.accent; else root.dataset.accent = a;
    const info = ACCENTS.find((x) => x.id === a) || ACCENTS[0];
    $('#accentName').textContent = info.zh;
    $$('#swatches .swatch').forEach((sw) => {
      const on = sw.dataset.a === a;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    store.set(ACCENT_KEY, a === 'blue' ? null : a);
    renderStage();
  };

  // 色板
  const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 2.9 2.9 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  $('#swatches').innerHTML = ACCENTS.map((a) =>
    `<button type="button" class="swatch" role="radio" data-a="${a.id}" title="${a.zh}" aria-label="${a.zh}" style="--sw-l:${a.l};--sw-d:${a.d}">${check}</button>`).join('');
  $('#swatches').setAttribute('role', 'radiogroup');
  $$('#swatches .swatch').forEach((sw) => sw.addEventListener('click', () => {
    if (sw.dataset.a === accent) return;
    withTransition('accent', () => setAccent(sw.dataset.a));
  }));

  // 主题：从点击位置圆形扩散
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', (ev) => {
    const m = b.dataset.mode;
    if (m === mode) return;
    const wasDark = root.dataset.theme === 'dark' || (!root.dataset.theme && sysDarkMQ.matches);
    const willDark = m === 'dark' || (m === 'auto' && sysDarkMQ.matches);
    if (wasDark === willDark) { setMode(m); return; }  // 看起来没变（比如 自动→浅色），不做扩散
    const t = withTransition('theme', () => setMode(m));
    if (!t) return;
    const x = ev.clientX || innerWidth - 40, y = ev.clientY || 30;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    t.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.32,.72,0,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  }));

  // 界面风格：经典 / iOS 26 液态玻璃（可选皮肤，只换令牌，不动组件代码）
  const setUi = (name) => {
    const skin = name === 'ios26' ? 'ios26' : 'classic';
    if (skin === 'ios26') root.dataset.ui = 'ios26'; else delete root.dataset.ui;
    $('#uiName').textContent = skin === 'ios26' ? '液态玻璃' : '经典';
    $$('#uiSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.ui === 'ios26') === (skin === 'ios26')));
    store.set(UI_KEY, skin === 'ios26' ? 'ios26' : null);
  };
  $$('#uiSeg button').forEach((b) => b.addEventListener('click', () => {
    if ((b.dataset.ui === 'ios26') === (root.dataset.ui === 'ios26')) return;
    withTransition('ui', () => setUi(b.dataset.ui));
  }));

  // 皮肤：经典 / 灵动可爱 / 高级简约（只换色板+圆角+动效令牌，组件代码零改动）
  // 与上面的「界面风格」正交：玻璃管材质，皮肤管色板。
  const SKIN_KEY = 'pf.skin';
  const SKIN_LABEL = { classic: '经典', cute: '灵动可爱', minimal: '高级简约' };
  const setSkin = (name, animate = true) => {
    const id = SKIN_LABEL[name] ? name : 'classic';
    const apply = () => {
      if (id === 'classic') delete root.dataset.skin; else root.dataset.skin = id;
      const label = $('#skinName');
      if (label) label.textContent = SKIN_LABEL[id];
      $$('#skinSeg button').forEach((b) => b.classList.toggle('on', b.dataset.skin === id));
      // 主题色板变了，画布底色/圆角也跟着走，重算一次布局尺寸
      try { window.dispatchEvent(new Event('resize')); } catch { /* ignore */ }
    };
    if (animate && document.startViewTransition) withTransition('skin', apply);
    else apply();
    store.set(SKIN_KEY, id === 'classic' ? null : id);
  };
  $$('#skinSeg button').forEach((b) => b.addEventListener('click', () => {
    if ((b.dataset.skin || 'classic') === (root.dataset.skin || 'classic')) return;
    setSkin(b.dataset.skin);
  }));
  // 启动时恢复上次的皮肤
  setSkin(store.get(SKIN_KEY) || 'classic', false);
  window.__pfSkin = () => root.dataset.skin || 'classic';

  // 版本号：唯一真源是仓库根 VERSION，构建时写进 <meta name="app-version">（scripts/set-version.mjs）
  const VERSION = document.querySelector('meta[name="app-version"]')?.content || '0.0.0';
  const verEl = $('#appVersion');
  if (verEl) verEl.textContent = `PanelForge v${VERSION}`;
  window.__pfVersion = () => VERSION;

  // 语言：中文（源语言）/ English / Bahasa Indonesia
  const LANG_LABEL = { zh: '中文', en: 'English', id: 'Bahasa Indonesia' };
  const setLang = (lang) => {
    const id = setI18nLang(lang);      // i18n 内部会立刻把整页重翻一遍
    $('#langName').textContent = LANG_LABEL[id] || id;
    const tb = $('#btnLang');
    if (tb) {
      tb.textContent = LANG_LABEL[id] || id;   // 按钮上就是当前语言本身（不是地球图标/国旗）
      tb.setAttribute('aria-expanded', pop.classList.contains('open') ? 'true' : 'false');
    }
    $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === id));
    store.set(LANG_KEY, id === 'zh' ? null : id);
  };
  const rebuildAll = () => {
    renderList(); renderSlotPanel(); renderScript(); renderBubbles(); renderPageTabs(); renderCands(); renderChars();
  };
  $$('#langSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang === getLang()) return;
    // 用中文原文重建动态块（模板库/右栏/气泡/页签），i18n 的 observer 会把新节点翻掉
    setI18nLang('zh');
    rebuildAll();
    setLang(b.dataset.lang);
    rebuildAll();
  }));
  // 顶栏那个低调的语言按钮：点开外观面板（语言选项就在里面）
  $('#btnLang')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    open(!pop.classList.contains('open'));
    setLang(getLang());                 // 顺手同步一下 aria-expanded
  });

  // 减弱动态效果
  const chk = $('#chkReduceMotion');
  chk.checked = root.dataset.motion === 'reduced';
  chk.addEventListener('change', () => {
    if (chk.checked) root.dataset.motion = 'reduced'; else delete root.dataset.motion;
    store.set(MOTION_KEY, chk.checked ? 'reduced' : null);
  });

  // 开关面板
  const open = (on) => {
    pop.classList.toggle('open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); open(!pop.classList.contains('open')); });
  document.addEventListener('click', (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) open(false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && pop.classList.contains('open')) open(false); }, true);

  sysDarkMQ.addEventListener?.('change', () => { syncMeta(); renderStage(); });
  setMode(mode);
  setAccent(accent);
  // 皮肤：URL 上的 ?ui= 优先（方便发给别人看），否则用记住的
  setUi(new URLSearchParams(location.search).get('ui') || store.get(UI_KEY) || 'classic');
  // 语言按钮的初始高亮（语言本身在 init 开头已经装好了）
  setLang(getLang());
  // 另一个标签页改了语言：跟着变（storage 事件只在"别的"标签页触发）
  addEventListener('storage', (ev) => {
    if (ev.key !== LANG_KEY && ev.key !== null) return;
    const want = store.get(LANG_KEY) || 'zh';
    if (want === getLang()) return;
    rebuildAll();
    setLang(want);
    rebuildAll();
  });
}

/* ================================================================== *
 * 动效辅助
 * ================================================================== */
/** 分段控件 / 右栏标签：加一块会滑动的选中底 */
function initSegIndicators() {
  const groups = $$('.seg, #tabs');
  const ro = window.ResizeObserver ? new ResizeObserver((es) => es.forEach((e) => placeInd(e.target))) : null;
  for (const g of groups) {
    if (g.querySelector(':scope > .seg-ind')) continue;
    const ind = document.createElement('span');
    ind.className = 'seg-ind';
    ind.setAttribute('aria-hidden', 'true');
    g.prepend(ind);
    g.classList.add('has-ind');
    placeInd(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('ready')));
    // .on 由各自的点击逻辑切换，这里只负责跟着挪
    new MutationObserver(() => placeInd(g)).observe(g, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    g.addEventListener('pointerdown', (ev) => { if (ev.target.closest('button')) g.classList.add('pressing'); });
    const up = () => g.classList.remove('pressing');
    g.addEventListener('pointerup', up); g.addEventListener('pointerleave', up); g.addEventListener('pointercancel', up);
    ro?.observe(g);
  }
}
function placeInd(g) {
  const ind = g.querySelector(':scope > .seg-ind');
  const on = g.querySelector(':scope > button.on, :scope > button[aria-selected="true"]');
  if (!ind) return;
  if (!on || !on.offsetWidth) { ind.style.opacity = on ? '' : '0'; return; }
  ind.style.opacity = '';
  ind.style.setProperty('--x', on.offsetLeft + 'px');
  ind.style.setProperty('--w', on.offsetWidth + 'px');
}

/** 滑块左侧填充：用 --p 画出 iOS 那种「已选部分是蓝色」的轨道 */
function paintRange(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const v = Number(el.value);
  const p = max > min ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', p.toFixed(2) + '%');
}
function initRanges() {
  // 代码里直接改 .value 时也要重画，所以包一层 setter
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (desc && desc.set && !HTMLInputElement.prototype.__pfRange) {
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...desc,
      set(v) { desc.set.call(this, v); if (this.type === 'range') paintRange(this); },
    });
    HTMLInputElement.prototype.__pfRange = true;
  }
  $$('input[type=range]').forEach(paintRange);
  document.addEventListener('input', (ev) => { if (ev.target?.type === 'range') paintRange(ev.target); });
}

/** Mac 显示 ⌘ ⌥ ⇧，其它平台显示 Ctrl / Alt / Shift */
function initPlatformKeys() {
  if (IS_MAC) {
    const map = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Del: '⌫' };
    $$('#shortcuts kbd').forEach((k) => { if (map[k.textContent]) k.textContent = map[k.textContent]; });
    $$('.help li').forEach((li) => {
      li.innerHTML = li.innerHTML.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥ ');
    });
    const note = $('.sc-note');
    if (note) note.textContent = note.textContent.replace('带 Ctrl 的组合键', '带 ⌘ 的组合键');
  } else {
    $$('.kbd-mod-enter').forEach((k) => { k.textContent = 'Ctrl ⏎'; });
  }
}

function initMoreMenu() {
  const btn = $('#btnMore');
  const menu = $('#topActions');
  if (!btn || !menu) return;
  const set = (open) => { menu.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); set(!menu.classList.contains('open')); });
  document.addEventListener('click', (ev) => { if (!menu.contains(ev.target)) set(false); });
  menu.addEventListener('click', () => set(false));
}

/** 手机 / 平板竖屏：底部标签栏切换「模板库 / 剧情 / 画布 / 编辑 / 分镜与导出」 */
function syncSlotFab(has) {
  document.body.classList.toggle('has-slot', !!has);
  if (!has) return;
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  const t = $('#fabText');
  if (t && slot) t.textContent = `编辑第 ${slot.order} 格`;
}

/** 静态版没有服务端：/api/* 链接改指向仓库里的文档 */
function initStaticLinks() {
  if (!window.PF_STATIC) return;
  const docs = $('#lnkDocs'), sheet = $('#lnkSheet'), tools = $('#lnkTools');
  if (docs) docs.href = REPO_URL + '/blob/main/docs/API.md';
  if (tools) { tools.href = REPO_URL + '/blob/main/docs/AI-INTEGRATION.md'; tools.textContent = 'AI 接入说明'; }
  if (sheet) { sheet.href = REPO_URL; sheet.textContent = 'GitHub 仓库'; }
}

/* ---------------- 本格句子里的建议行 & 两段的小结 ---------------- */
const renderScriptSoon = debounce(() => { if (state.tpl) renderScript(); }, 400);

function syncSuggest() {
  const box = $('#suggestBox');
  if (!box) return;
  const sug = (state._suggest || '').trim();
  const cur = ($('#slotLine')?.value || '').trim();
  // 没建议、或者已经用上了，就不占地方
  box.classList.toggle('hidden', !sug || cur.includes(sug));
  $('#suggestFrom').textContent = state._suggestAi ? 'AI 思路' : '思路';
  $('#suggestText').textContent = sug;
}
function syncSecSummary() {
  const id = state.selectedId;
  if (!id) return;
  const line = ($('#slotLine')?.value || '').trim();
  $('#secTextSum').textContent = line ? '「' + (line.length > 14 ? line.slice(0, 14) + '…' : line) + '」' : '还没写';
  const img = state.images[id];
  const nc = (state.cands?.[id] || []).length;
  const edited = !!state.promptEdits?.[id];
  $('#secImageSum').textContent = [img ? '已填图' : '空', nc ? `${nc} 张候选` : '', edited ? '提示词已手改' : ''].filter(Boolean).join(' · ');
}

/* ================================================================== *
 * 真正启动（必须留在文件最后：这时上面所有 const 都已初始化完成）
 * ================================================================== */
/* ---------------- 风格跟随：样图 ---------------- */
const SAMPLES_MAX = 6;

function renderSamples() {
  const box = $('#sampleBox');
  const grid = $('#sampleGrid');
  if (!box || !grid) return;
  box.classList.toggle('hidden', !followSamples());
  $$('#styleSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.follow || 'char') === styleMode()));
  const hint = $('#styleHint');
  if (hint) {
    hint.textContent = {
      char: '跟角色参考图',
      sample: '跟样图的画风',
      both: '人设图 + 样图都参考',
      none: '不参考任何图',
    }[styleMode()];
  }
  grid.innerHTML = (state.samples || []).map((sp, i) => `
    <div class="sample-item" data-i="${i}">
      <img src="${escapeHtml(sp.href)}" alt="样图 ${i + 1}">
      <button class="sample-del" type="button" data-del="${i}" title="删掉这张">×</button>
    </div>`).join('') + ((state.samples || []).length < SAMPLES_MAX
    ? '<button class="sample-add" type="button" id="btnSampleAddInner" title="加样图（也可以直接拖进来 / Ctrl+V）">＋</button>'
    : '');
}

async function addSamples(files) {
  const list = (files || []).filter((f) => f && /^image\//i.test(f.type || ''));
  if (!list.length) return 0;
  const room = SAMPLES_MAX - (state.samples || []).length;
  if (room <= 0) { toast(`样图最多 ${SAMPLES_MAX} 张`); return 0; }
  const use = list.slice(0, room);
  for (const f of use) {
    try {
      const asset = await imageAsset(f, { name: 'sample' });
      state.samples.push(asset);
    } catch { /* 跳过坏图 */ }
  }
  renderSamples();
  persistSamples();
  toast(`已加入 ${use.length} 张样图（共 ${state.samples.length} 张）`);
  return use.length;
}

function removeSample(i) {
  state.samples.splice(i, 1);
  renderSamples();
  persistSamples();
}

let sampleSaveTimer = 0;
function persistSamples() {
  clearTimeout(sampleSaveTimer);
  sampleSaveTimer = setTimeout(async () => {
    try {
      const urls = [];
      for (const sp of state.samples || []) {
        // href 是 blob URL，先取回 Blob 再转 dataURL（blobToDataURL 只接受 Blob）
        const blob = await (await fetch(sp.href)).blob();
        urls.push(await blobToDataURL(blob));
      }
      await idbSet('samples', { urls, savedAt: Date.now() });
    } catch { /* ignore */ }
  }, 400);
}

async function restoreSamples() {
  try {
    const rec = await idbGet('samples');
    const urls = rec?.urls || [];
    const out = [];
    for (const u of urls) {
      try { out.push(await imageAsset(u, { name: 'sample' })); } catch { /* 跳过 */ }
    }
    if (out.length) { state.samples = out; renderSamples(); }
  } catch { /* ignore */ }
}

function setStyleFollow(mode) {
  const m = ['char', 'sample', 'both', 'none'].includes(mode) ? mode : 'char';
  state.styleFollow = m;
  try { localStorage.setItem('pf.stylefollow', m); } catch { /* ignore */ }
  renderSamples();
  queueSave?.();
  toast({
    char: '生图会跟人设图',
    sample: '生图会跟样图的画风',
    both: '人设图 + 样图都会参考',
    none: '生图不参考任何图（每格可能长得不一样）',
  }[m]);
}

window.__pfStyle = () => ({
  mode: styleMode(),
  samples: (state.samples || []).length,
  followChars: followChars(),
  followSamples: followSamples(),
});

function bindStyleFollow() {
  try {
    const saved = localStorage.getItem('pf.stylefollow');
    if (saved) state.styleFollow = saved;
  } catch { /* ignore */ }
  renderSamples();
  restoreSamples();
  $$('#styleSeg button').forEach((b) => b.addEventListener('click', () => setStyleFollow(b.dataset.follow)));
  $('#btnSamplePick')?.addEventListener('click', () => $('#sampleFiles').click());
  $('#sampleFiles')?.addEventListener('change', async (ev) => {
    await addSamples([...(ev.target.files || [])]);
    ev.target.value = '';
  });
  $('#sampleGrid')?.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { removeSample(Number(del.dataset.del)); return; }
    if (ev.target.closest('#btnSampleAddInner')) $('#sampleFiles').click();
  });

}

init().catch((e) => {
  console.error(e);
  window.__pfLastInitError = String((e && e.stack) || e);   // 出问题时方便在控制台一眼看到
  toast('初始化失败：' + e.message);
});
