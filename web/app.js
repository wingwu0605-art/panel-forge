/**
 * app.js — PanelForge 分镜坊 前端
 * 零框架；渲染内核与后端共用同一份 /lib/svg.mjs，保证「所见即导出」。
 */
import { renderTemplateSVG, imageAttrs } from './lib/svg.mjs';
import { createCellPainter, localPoly } from './paint.mjs';
import { createKlecksHost } from './paint-host.mjs';
import { installI18n, setLang as setI18nLang, getLang, stats as i18nStats } from './i18n.mjs';
import { pointInPoly } from './lib/geometry.mjs';
import { BUBBLES, BUBBLE_IDS, recommendBubbles, makeBubble, bubbleThumb } from './lib/bubbles.mjs';

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

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  items: [],          // 轻量模板列表
  filtered: [],
  cultureTab: 'all',
  tpl: null,          // 完整模板
  images: {},         // slotId -> {href,iw,ih,zoom,panX,panY,mode,name}
  selectedId: null,
  hoverId: null,
  plan: null,         // 规则引擎给的分镜表
  aiPlan: null,       // AI 导演给的分镜表（优先）
  aiDecision: null,
  llm: { protocol: 'openai', baseUrl: '', apiKey: '', model: '' },
  charSheet: '',
  bubbles: [],        // 气泡实例（画在页面上，导出时一起走）
  selBubble: null,
  lines: {},          // slotId -> 这一格的句子（台词/旁白）
  editMod: 'text',     // 手机编辑页：text | image | bubble
  promptEdits: {},    // slotId -> {prompt?, negative?} 用户手改的生图提示词（没改就不存）
  bubTab: 'rec',      // rec | fav
  bubUse: {},         // 气泡使用次数（常用排序）
  engine: null,
  hollow: false,
  showLabels: true,
  exportWidth: 1600,
  outlineExport: true,
  analysis: null,
  plot: '',
  pages: [],          // 多页：{tplId, images, bubbles, lines}
  pageIdx: 0,
  cands: {},          // slotId -> [href...] 候选图
  slotCollapsed: false,
  slotAiMode: 'img',  // img | prompt
  paint: {},          // slotId -> {strokes:[...], workSide} 格子内绘制的笔画（唯一真相）
  under: {},          // slotId -> 图片资产：画在照片上时，照片留在这里当底图
  chars: [],          // 角色卡 [{id,name,note,images:[dataURL]}]
  activeChars: [],    // 本页启用的角色 id
  clipboard: null,    // 内部剪贴板（图片或气泡）
  libFilter: null,    // 模板库的标签筛选 {kind:'panels'|'intent'|'ratio'|'tag', value}
  intentZh: {},       // 戏路 id → 中文（从 /api/meta 来）
  history: { past: [], future: [] },
};

const CULTURE_LABEL = { jp: '日', cn: '中', kr: '韩', core: '通' };
const CULTURE_ZH = { jp: '日式页漫', cn: '中式漫画', kr: '韩式条漫', core: '通用/跨界' };

/* 外观层常量（init() 在顶层就跑，所以必须放在这里，不能放文件末尾） */
const VIEW_ORDER = ['library', 'story', 'canvas', 'edit', 'output'];
const VIEW_ALIAS = { inspect: 'edit' };
const ZOOM_EASE = 'cubic-bezier(.32,.72,0,1)';
let zoomT = { tx: 0, ty: 0, k: 1 };   // #canvas 当前的变换
let zoomKey = '';
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
const sysReduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const REPO_URL = 'https://github.com/wingwu0605-art/panel-forge';
const THEME_KEY = 'pf.theme';
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const compactMQ = window.matchMedia('(max-width:1024px)');
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

/* ------------------------------------------------------------------ *
 * ?perf=1：性能浮层
 * 只在这个参数下存在；用来量「拖动 / 缩放」热路径到底花了多少时间，
 * 手机上也能直接看（不用连 Mac 抓 Safari 时间线）。
 * ---------------------------------------------------------------- */
const PERF = new URLSearchParams(location.search).get('perf') === '1';
const perf = {
  frames: [], render: [], patch: [], save: [], paint: [], longtask: [],
  lastSaveBytes: 0, renders: 0, patches: 0, saves: 0,
};
function perfPush(arr, v) { arr.push(v); if (arr.length > 90) arr.shift(); }
function perfStats(arr) {
  if (!arr.length) return { avg: 0, p95: 0, max: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    avg: s.reduce((n, v) => n + v, 0) / s.length,
    p95: at(0.95), max: s[s.length - 1],
  };
}
/** 量一段代码耗时（只在 ?perf=1 下记录，别的地方调它不会变慢） */
const perfNow = () => (PERF ? performance.now() : 0);
const perfDone = (kind, t0) => {
  if (!PERF || !t0) return;
  perfPush(perf[kind], performance.now() - t0);
  if (kind === 'render') perf.renders++;
  if (kind === 'patch') perf.patches++;
};
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
      state.images = rehydrateImages(pg?.images || {});
      state.bubbles = (pg?.bubbles || []).map((b) => ({ ...b }));
      state.lines = { ...(pg?.lines || {}) };
      state.promptEdits = { ...(pg?.promptEdits || {}) };
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
const HIST_MAX = 60;

function snapshot() {
  return {
    images: Object.fromEntries(Object.entries(state.images).map(([k, v]) => [k, { ...v }])),
    bubbles: state.bubbles.map((b) => ({ ...b })),
    lines: { ...state.lines },
    promptEdits: JSON.parse(JSON.stringify(state.promptEdits || {})),
    selectedId: state.selectedId,
    selBubble: state.selBubble,
  };
}

function restore(snap) {
  state.images = Object.fromEntries(Object.entries(snap.images).map(([k, v]) => [k, { ...v }]));
  state.bubbles = snap.bubbles.map((b) => ({ ...b }));
  state.lines = { ...snap.lines };
  state.promptEdits = JSON.parse(JSON.stringify(snap.promptEdits || {}));
  state.selectedId = snap.selectedId;
  state.selBubble = snap.selBubble;
  renderStage();
  renderSlotPanel();
  renderBubbles();
}

/** 在改动之前调用：把当前状态压进历史 */
function commit() {
  if (!state.tpl) return;
  state.history.past.push(snapshot());
  if (state.history.past.length > HIST_MAX) state.history.past.shift();
  state.history.future.length = 0;
}

function undo() {
  if (!state.history.past.length) { toast('没有可撤销的操作'); return; }
  state.history.future.push(snapshot());
  restore(state.history.past.pop());
  toast('已撤销');
}

function redo() {
  if (!state.history.future.length) { toast('没有可重做的操作'); return; }
  state.history.past.push(snapshot());
  restore(state.history.future.pop());
  toast('已重做');
}

function resetHistory() {
  state.history = { past: [], future: [] };
}

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

  for (const el of $$('[data-collapse]')) {
    const key = el.dataset.collapse;
    const initialOpen = saved[key] !== false && !force.includes(key);

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

  // ---- 1) 先试外部引擎 ----
  const host = createKlecksHost({ slot, baseUrl });
  try {
    host.onSubmit = () => { finishPaint(); };
    await host.mount(stage);
    paintHost = host;
    paintEngine = 'klecks';
    document.body.classList.add('paint-engine');
    // 窄屏（手机竖屏）上 Klecks 的桌面工具栏不收起，工作区只剩一百多像素，画布会缩得很小。
    // 这里不硬改它的 UI（那是 fork 级别的事），只把预期说清楚。
    if (window.innerWidth < 560) {
      $('#paintSub').textContent = `${slot.shape?.zh || '常规格'} · 竖屏空间小，建议横屏或平板/电脑`;
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
    downloadBlob(blob, `${state.tpl?.id || 'page'}-第${slot?.order ?? '?'}格.${ext}`);
    toast('已导出这一格的图');
  } catch (e) {
    toast('导出失败：' + e.message);
  }
}

/** 绘制页里「导出」：把当前画面按格子形状裁好存成 PNG（两种引擎都支持） */
async function exportPaintImage() {
  const slot = state.tpl?.slots?.find((s) => s.id === paintSlotId);
  try {
    let raw = null;
    if (paintEngine === 'klecks' && paintHost) raw = await paintHost.exportPNG();
    else if (painter) raw = await painter.toBlob();
    if (!raw) { toast('还没有可导出的内容'); return; }
    const out = slot ? await clipToSlot(raw, slot) : raw;
    downloadBlob(out, `${state.tpl?.id || 'page'}-第${slot?.order ?? '?'}格-绘制.png`);
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
  return {
    order: Array.isArray(v.order) && v.order.length ? v.order : d.order,
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
      canvas.setPointerCapture?.(ev.pointerId);
      return;
    }
    if (state.hollow) { toast('镂空预览模式下不能填图，先关掉「镂空」'); return; }
    const slot = slotAt(pt);
    drag = { slot, moved: false, x0: ev.clientX, y0: ev.clientY, start: pt };
    if (slot) canvas.setPointerCapture?.(ev.pointerId);
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
      if (drag.slot) { state.selectedId = drag.slot.id; state.selBubble = null; renderStage(); renderSlotPanel(); renderBubbles(); }
      else { state.selectedId = null; state.selBubble = null; renderStage(); renderSlotPanel(); }
    } else if (drag.slot) {
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
    if (!state.tpl || !state.selectedId) return;
    const items = [...(ev.clipboardData?.items || [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (!img) return;
    ev.preventDefault();
    const file = img.getAsFile();
    if (file) await putImage(state.selectedId, file);
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
    queueSave?.();
    renderSlotPanel(); renderScript();
    toast('已恢复自动生成的提示词');
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
    if (p.imgModel) $('#ksImgModel').value = p.imgModel;
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
    $('#ksMsg').textContent = '正在请求模型…';
    try {
      const r = await api.llmTest({ llm: formEntry() });
      if (r?.ok) {
        $('#ksMsg').textContent = '✅ 连接成功 · ' + (r.model || '') + ' · ' + (r.latencyMs || '?') + 'ms';
        state._lastTestOk = true;
      } else {
        $('#ksMsg').textContent = '❌ ' + (r?.error || '失败') + (r?.hint ? ' · ' + r.hint : '');
        state._lastTestOk = false;
      }
    } catch (e) {
      $('#ksMsg').textContent = '❌ ' + e.message;
      state._lastTestOk = false;
    } finally { btn.disabled = false; btn.textContent = old; }
  });
  $('#ksSave')?.addEventListener('click', () => {
    const e = formEntry();
    if (!e.apiKey) { $('#ksMsg').textContent = '请先填 API Key'; return; }
    if (!e.baseUrl) { $('#ksMsg').textContent = '请先填 Base URL'; return; }
    if (state._lastTestOk) e.verifiedAt = Date.now();
    upsertKey(e);
    state._editingKeyId = null;
    $('#ksMsg').textContent = e.verifiedAt ? '已保存并验证，可以开始用了' : '已保存（未验证，建议先点测试连接）';
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
    $('#btnAiImage').textContent = state.slotAiMode === 'prompt' ? '只写这一格的提示词' : '生这一格';
  });
  $('#btnAiImage')?.addEventListener('click', () => {
    if (state.slotAiMode === 'prompt') generateSlotPromptOnly();
    else generateSlotImage();
  });
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
  });
  $('#btnBubbleFromLine').addEventListener('click', () => {
    const text = currentLine().trim();
    addBubble(text ? 'talk-ellipse' : 'narration-box', { text });
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
    renderExportKv();
  });
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
  if (name === 'script' && !document.querySelector('[data-tab="script"]')) name = 'slot';
  if (!tab) return;
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
const IMG_MAX_SIDE = 2000;
const IMG_QUALITY = 0.9;
const dataHrefCache = new WeakMap(); // Blob → data URL，导出时用一次就够
const blobUrlCache = new WeakMap();  // Blob → blob URL，同一个 blob 永远拿同一个 URL（换页不会越攒越多）

const urlForBlob = (blob) => {
  let u = blobUrlCache.get(blob);
  if (!u) { u = URL.createObjectURL(blob); blobUrlCache.set(blob, u); }
  return u;
};

const loadImgEl = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('图片读不出来'));
  img.src = src;
});
const blobOf = async (src) => (src instanceof Blob ? src : (await fetch(src)).blob());

/** 任何来源（File / data URL / blob URL / http）→ 统一的图片资产 */
async function imageAsset(src, { name = 'image', maxSide = IMG_MAX_SIDE } = {}) {
  const blob = await blobOf(src);
  const tmpUrl = URL.createObjectURL(blob);
  let el;
  try {
    el = await loadImgEl(tmpUrl);
  } catch (e) {
    URL.revokeObjectURL(tmpUrl);
    throw e;
  }
  const iw = el.naturalWidth || 1000;
  const ih = el.naturalHeight || 1000;
  const k = Math.min(1, maxSide / Math.max(iw, ih));
  let display = blob;
  if (k < 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k));
    c.height = Math.max(1, Math.round(ih * k));
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    display = (await new Promise((res) => c.toBlob(res, 'image/jpeg', IMG_QUALITY))) || blob;
  }
  URL.revokeObjectURL(tmpUrl);
  return {
    blob: display,
    href: urlForBlob(display),
    iw, ih, zoom: 1, panX: 0, panY: 0, mode: 'cover', name,
  };
}

/** 草稿里取回来时 blob URL 已失效：按 blob 重建（老的 data URL 草稿原样保留） */
function rehydrateImages(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (!v) continue;
    out[k] = v.blob ? { ...v, href: urlForBlob(v.blob) } : { ...v };
  }
  return out;
}

/** 导出用：把 blob 转回 data URL（结果按 Blob 缓存，重复导出不再转） */
async function exportImageMap(map = state.images) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (!v) continue;
    if (!v.blob) { out[k] = { ...v }; continue; }
    let data = dataHrefCache.get(v.blob);
    if (!data) { data = await blobToDataURL(v.blob); dataHrefCache.set(v.blob, data); }
    out[k] = { ...v, href: data };
  }
  return out;
}

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
const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
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
const SLOT_SEC_OPEN = { text: true, image: true, board: false };
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
function autoPromptOf(slot, panel) {
  if (panel?.promptEn) return panel.promptEn;
  const shape = panel?.shape || slot?.shape || null;
  return [shape?.prefixEn, 'single panel, no text'].filter(Boolean).join(', ');
}
/** 这一格最终用的提示词：手改过就用手改的 */
function effectivePrompt(slotId) {
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  const panel = (pagePlan()?.panels || []).find((p) => p.id === slotId) || null;
  const edit = state.promptEdits?.[slotId] || {};
  const autoPrompt = autoPromptOf(slot, panel);
  const autoNeg = panel?.negative || '';
  return {
    prompt: edit.prompt ?? autoPrompt,
    negative: edit.negative ?? autoNeg,
    autoPrompt, autoNeg,
    edited: edit.prompt != null || edit.negative != null,
  };
}
/** 真正发给生图模型的那一段（角色一致性 + 提示词 + 避免项），预览和生图共用 */
function buildImagePrompt(slotId) {
  const e = effectivePrompt(slotId);
  const chars = activeCharPayload();
  const body = [chars.block, e.prompt].filter(Boolean).join(' ');
  return { ...e, chars, full: e.negative ? `${body} | avoid: ${e.negative}` : body };
}
function setPromptEdit(slotId, field, value) {
  const e = effectivePrompt(slotId);
  const cur = { ...(state.promptEdits[slotId] || {}) };
  const auto = field === 'prompt' ? e.autoPrompt : e.autoNeg;
  if (value.trim() === auto.trim()) delete cur[field]; else cur[field] = value;
  if (Object.keys(cur).length) state.promptEdits[slotId] = cur; else delete state.promptEdits[slotId];
  queueSave?.();
}
function syncPromptMeta() {
  const id = state.selectedId;
  if (!id) return;
  const b = buildImagePrompt(id);
  $('#promptState').textContent = b.edited ? '已手改' : (currentPlanPanel()?.aiOptimized ? 'AI 写的' : '自动');
  $('#promptState').classList.toggle('edited', b.edited);
  $('#btnPromptReset').classList.toggle('hidden', !b.edited);
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

function currentPlanPanel() {
  const page = pagePlan();
  return (page?.panels || []).find((p) => p.id === state.selectedId) || null;
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
  state.llm = {
    protocol: $('#llmProtocol').value,
    baseUrl: $('#llmBase').value.trim(),
    apiKey: $('#llmKey').value.trim(),
    model: $('#llmModel').value.trim(),
    imgModel: $('#imgModel') ? $('#imgModel').value.trim() : '',
    imageProvider: $('#imgProvider') ? $('#imgProvider').value : 'openai',
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
      ratio: $('#ratio').value === 'auto' ? 'auto' : $('#ratio').value,
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

function fillKeyForm(e) {
  if (!e) return;
  $('#ksProtocol').value = e.protocol || 'openai';
  $('#ksBase').value = e.baseUrl || '';
  $('#ksModel').value = e.model || '';
  $('#ksKey').value = e.apiKey || '';
  $('#ksImgProvider').value = e.imgProvider || 'openai';
  $('#ksImgModel').value = e.imgModel || '';
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
function activeCharPayload() {
  const chars = state.chars.filter((c) => state.activeChars.includes(c.id));
  if (!chars.length) return { block: '', refs: [] };
  const block = '角色一致性：' + chars.map((c) => `${c.name}${c.note ? '（' + c.note + '）' : ''}`).join('；')
    + '。外观、发型、服装、年龄必须与参考图完全一致，不要换脸。';
  const refs = chars.flatMap((c) => c.images || []).slice(0, 3);
  return { block, refs };
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
  saveTimer = setTimeout(saveDraft, 1200);
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
  state.images = rehydrateImages(pg.images || {});
  state.under = rehydrateImages(pg.under || {});
  state.paint = clonePaint(pg.paint || {});
  state.bubbles = (pg.bubbles || []).map((b) => ({ ...b }));
  state.lines = { ...(pg.lines || {}) };
  state.promptEdits = { ...(pg.promptEdits || {}) };
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
      downloadBlob(png, `${String(i + 1).padStart(2, '0')}-${safe}.png`);
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
async function generateSlotPromptOnly() {
  if (!state.tpl || !state.selectedId) { toast('先点一个格子'); return; }
  const btn = $('#btnAiImage');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'AI 正在写…';
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
    const want = res.plan?.panels?.find((p) => p.id === state.selectedId);
    if (!want) throw new Error('这一格没拿到提示词');
    const target = currentPlanPanel();
    if (target) { target.promptEnRule = target.promptEnRule || target.promptEn; target.promptEn = want.promptEn; target.aiOptimized = true; }
    if (state.promptEdits[state.selectedId]?.prompt != null) { commit(); delete state.promptEdits[state.selectedId].prompt; if (!Object.keys(state.promptEdits[state.selectedId]).length) delete state.promptEdits[state.selectedId]; }
    renderSlotPanel(); renderScript();
    toast('这一格的提示词已由 AI 改写');
  } catch (e) {
    toast('写提示词失败：' + e.message);
  } finally { btn.disabled = false; btn.textContent = old; }
}

/** 用用户自己的生图模型，直接生成当前这一格 */
async function generateSlotImage() {
  if (!state.tpl || !state.selectedId) { toast('先点一个格子'); return; }
  const panel = currentPlanPanel();
  const slot = state.tpl.slots.find((s) => s.id === state.selectedId);
  const btn = $('#btnAiImage');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在生图…（10–60 秒）';
  saveLlm();
  try {
    const built = buildImagePrompt(state.selectedId);
    const charPayload = built.chars;
    if (!charPayload.block) {
      const ok = confirm('还没启用角色参考图，生成的图可能每格长得不一样。\n\n建议先去左边「角色参考图」加一张。\n\n仍然继续生图吗？');
      if (!ok) { btn.disabled = false; btn.textContent = old; return; }
    }
    const res = await api.imageGenerate({
      prompt: built.full,
      refs: charPayload.refs,
      size: panel?.genSize || undefined,
      model: state.llm.imgModel || undefined,
      provider: state.llm.imageProvider || 'openai',
      llm: state.llm,
      templateId: state.tpl.id,
      slotId: state.selectedId,
    });
    if (!res?.ok) throw new Error((res?.code ? res.code + '：' : '') + (res?.error || '生图失败'));
    let href = res.href;
    if (!href && res.b64) href = 'data:image/png;base64,' + res.b64;
    if (!href && res.url) href = await api.proxyImage ? await blobToDataURL(await api.proxyImage(res.url)) : res.url;
    if (!href) throw new Error('生图接口没有返回可用的图片');
    const sid = state.selectedId;
    const list = candsOf(sid);
    list.unshift(href);
    if (list.length > 8) list.pop();
    commit();
    state.images[sid] = await imageAsset(href, { name: 'ai' });
    renderStage(); renderSlotPanel(); refreshScript(); renderCands();
    toast('已生成并填入这一格（候选里还留着，可以换一张）');
  } catch (e) {
    toast('生图失败：' + e.message);
    $('#footMsg') && ($('#footMsg').textContent = '生图失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function copyShapePrefix() {
  const p = currentPlanPanel();
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  const prefix = p?.shape?.prefixEn || slot?.shape?.prefixEn;
  if (!prefix) { toast('这一格没有形状词'); return; }
  copyText(prefix, '形状开头词已复制，粘到你提示词最前面');
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
    canvas.toBlob((b) => {
      downloadBlob(b, `${state.tpl.id}-${w}px.png`);
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

function renderBubbles() {
  const grid = $('#bubGrid');
  if (!grid) return;
  if (!state.tpl) { grid.innerHTML = '<span class="muted small">先选一套版式</span>'; return; }

  const panel = currentPlanPanel();
  const slot = state.tpl.slots?.find((s) => s.id === state.selectedId);
  const role = panel?.role || slot?.role;
  const beat = panel?.beat || '';

  let ids;
  if (state.bubTab === 'rec') {
    ids = recommendBubbles({ role, beat, n: 8 });
  } else {
    const used = Object.entries(state.bubUse).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    ids = [...new Set([...used, 'talk-ellipse', 'narration-box', 'burst-spike', 'thought-cloud', 'caption-tab'])].slice(0, 8);
  }

  grid.innerHTML = ids.map((id) => `
    <div class="bub-item" data-id="${id}" title="${escapeHtml(BUBBLES[id]?.hintZh || '')}">
      ${bubbleThumb(id, 92)}
      <span>${escapeHtml(BUBBLES[id]?.zh || id)}</span>
    </div>`).join('');

  stagger(grid, '.bub-item');
  grid.querySelectorAll('.bub-item').forEach((el) => {
    el.addEventListener('click', () => addBubble(el.dataset.id));
  });

  renderBubbleInspector();
}

function renderBubbleInspector() {
  const box = $('#bubInspect');
  const b = selectedBubble();
  box.classList.toggle('hidden', !b);
  if (!b) return;
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

function downloadText(text, name, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), name);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
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

function motionOK() {
  return !sysReduceMQ.matches && document.documentElement.dataset.motion !== 'reduced';
}

/** 用 View Transitions 包一层；不支持或用户要求减弱动效时直接执行 */
function withTransition(kind, fn) {
  if (!document.startViewTransition || !motionOK()) { fn(); return null; }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
  return t;
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

/** 列表依次浮现：给每个子元素一个序号 */
function stagger(container, sel, cap = 14) {
  if (!container) return;
  container.querySelectorAll(sel).forEach((el, i) => el.style.setProperty('--i', Math.min(i, cap)));
}

/** 重新触发一个 CSS 动画类 */
function replay(el, cls) {
  if (!el || !motionOK()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
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
function setView(view, opts = {}) {
  view = VIEW_ALIAS[view] || view;
  if (!VIEW_ORDER.includes(view)) return;
  const prev = document.body.dataset.view;
  const compact = compactMQ.matches;
  if (view === 'edit' && state.tpl && !state.selectedId) {
    state.selectedId = state.tpl.slots[0]?.id || null;
    renderStage(); renderSlotPanel();
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
function applyView(view) {
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
    if (!cur || cur === 'slot') activateTab('script');
  }
  if (view === 'edit') { activateTab('slot'); setEditMod(state.editMod || 'text', { quiet: true }); syncEditHead(); }
  if (view === 'canvas' || view === 'edit') renderStage();
}
function goCanvasOnCompact() { if (compactMQ.matches) setView('canvas', { animate: true }); }

/* ---------------- 编辑页：放大到选中的格子 ---------------- */

function holderEl() { return $('#canvas'); }
function setHolderT(t, transition) {
  const h = holderEl();
  if (!h) return;
  zoomT = t;
  h.style.transition = transition || 'none';
  h.style.transform = (t.k === 1 && !t.tx && !t.ty) ? '' : `translate(${t.tx}px, ${t.ty}px) scale(${t.k})`;
}
/** 不受当前变换影响的几何：holder 左上角 + 页面 svg 的位置（反算 zoomT） */
function untransformed() {
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
function zoomTargetFor(slotId) {
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
function syncEditZoom(force = false) {
  if (document.body.dataset.view !== 'edit' || !compactMQ.matches || document.body.classList.contains('zooming')) return;
  const key = [state.selectedId, state.tpl?.id, $('#stage')?.clientWidth, $('#stage')?.clientHeight].join('|');
  if (!force && key === zoomKey) return;
  zoomKey = key;
  const t = zoomTargetFor(state.selectedId);
  setHolderT(t, motionOK() ? `transform .62s ${ZOOM_EASE}` : 'none');
}
function clearEditZoom() { zoomKey = ''; setHolderT({ tx: 0, ty: 0, k: 1 }); }

/** FLIP：从 rect A 看起来的位置，变到 rect B 现在的位置所需的起始变换 */
function flipFrom(A, g) {
  const k0 = A.width / g.svg.width;
  return { tx: A.left - g.hl - (g.svg.left - g.hl) * k0, ty: A.top - g.ht - (g.svg.top - g.ht) * k0, k: k0 };
}

function enterEdit(fromCanvas, { instant = false } = {}) {
  const svg = holderEl()?.querySelector('svg');
  const A = fromCanvas && svg ? svg.getBoundingClientRect() : null;
  const body = document.body;
  clearEditZoom();
  applyView('edit');
  if (instant || !motionOK()) { requestAnimationFrame(() => syncEditZoom(true)); return; }
  body.classList.add('zooming');
  replay(body, 'sheet-in');
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

function exitEdit(toView) {
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
  renderStage();
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

function setEditMod(m, { quiet = false } = {}) {
  state.editMod = m;
  const rail = $('#railRight');
  if (!rail) return;
  const changed = rail.dataset.mod !== m;
  rail.dataset.mod = m;
  $$('#editSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  if (changed && !quiet) { replay(rail, 'mod-swap'); rail.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' }); }
}

function syncEditHead() {
  const slot = state.tpl?.slots?.find((s) => s.id === state.selectedId);
  if (!slot) return;
  const panel = currentPlanPanel();
  $('#editIndex').textContent = slot.order;
  $('#editRole').textContent = panel ? panel.roleZh : slot.role;
  $('#editShot').textContent = panel ? `${panel.shot} · ${panel.beat || '通用'}` : '';
  const idx = state.tpl.slots.findIndex((s) => s.id === slot.id);
  $('#btnEditPrev').disabled = idx <= 0;
  $('#btnEditNext').disabled = idx >= state.tpl.slots.length - 1;
}

function stepSlot(dir) {
  if (!state.tpl) return;
  const list = state.tpl.slots;
  const i = list.findIndex((s) => s.id === state.selectedId);
  const next = list[clamp(i + dir, 0, list.length - 1)];
  if (!next || next.id === state.selectedId) return;
  state.selectedId = next.id; state.selBubble = null;
  renderStage(); renderSlotPanel();
}

function initViews() {
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
init().catch((e) => {
  console.error(e);
  toast('初始化失败：' + e.message);
});
