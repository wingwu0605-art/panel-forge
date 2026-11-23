/**
 * app.js — PanelForge 分镜坊 前端
 * 零框架；渲染内核与后端共用同一份 /lib/svg.mjs，保证「所见即导出」。
 */
import { renderTemplateSVG, highlightMarkup, imageAttrs } from './lib/svg.mjs';
import { pointInPoly } from './lib/geometry.mjs';
import { BUBBLES, recommendBubbles, makeBubble, bubbleThumb, pickBubbleForText } from './lib/bubbles.mjs';
import { $, $$, PERF, perfNow, perfDone, withTimeout, clamp, escapeHtml, debounce } from './util.mjs';
import { params, DBG, FRESH, STATIC, ARTIST, PURE, SHELL, REPO_URL } from './env.mjs';
import { store, KEYS } from './storage.mjs';
import { app } from './ctx.mjs';
import { fx, settled, staggerIn, setFold } from './motion.mjs';
import { openModal, closeModal, sheet, ask, askText } from './dialogs.mjs';
import { toast, copyText, setRange, setBusy, busyLabel, initSegIndicators, initRanges, initCollapsibles, initPlatformKeys, initMoreMenu } from './ui.mjs';
import { state, commit, undo, redo, resetHistory } from './state.mjs';
import { imageAsset, rehydrateImages, exportImageMap, loadImgEl, blobUrlOf } from './assets.mjs';
import { effectivePrompt, buildImagePrompt, setPromptEdit } from './prompt.mjs';
import { setView, initViews, setEditMod, syncEditHead, syncEditZoom, goCanvasOnCompact } from './mobile.mjs';
import { installRails } from './rails.mjs';
import { installI18n, getLang, t as tr } from './i18n.mjs';
import { initAppearance, currentTint } from './theme.mjs';
import { downloadText, exportBlob } from './share.mjs';
import { openPaint, exportSlotImage, initPaint } from './paint-ui.mjs';
import { loadChars, renderChars, activeCharPayload, bindRefs } from './refs.mjs';
import { loadLlm, saveLlm, syncLlmStatus, loadKeyStore, openKeySheet, bindKeys } from './keys.mjs';
import { queueSave, clearDrafts, loadDraft, installAutosave, newPageId } from './drafts.mjs';
import { applyLayout, bindPanelSheet } from './panels.mjs';
import { bindSlotZoom, syncSlotZoom, syncSlotZoomSoon } from './slot-zoom.mjs';
import { bindAutoUI } from './auto-mode.mjs';
import { bindInboxUI } from './inbox.mjs';

/**
 * 双模式 API：
 *  - 常规：走本机服务（node server.mjs），有 AI 导演
 *  - 静态：GitHub Pages 等纯静态托管，规则引擎在浏览器里跑（window.PF_STATIC）
 */
let api = null;
/**
 * AI 这几条路把界面语言一起带上：模型写的节拍 / 画面 / 台词跟着界面语言走
 * （英文界面的人不会收到一屏中文台词）。语言放在 llm 配置里，服务端和浏览器直连都认。
 */
const AI_CALLS = ['aiDecide', 'prompts', 'aiSplit', 'aiLines'];
function withUiLang(a) {
  for (const k of AI_CALLS) {
    const fn = a[k];
    if (typeof fn !== 'function') continue;
    a[k] = (body = {}) => fn({ ...body, llm: { ...(body.llm || {}), lang: getLang() } });
  }
  return a;
}
/**
 * 纯粹版：没有 AI 作画 —— 生图和「AI 写生图提示词」两个口子封死（就算在控制台里手动调也发不出去）；
 * AI 分镜照常（排戏 / 切原文 / 写台词 / 测试连接），切原文时也不让模型写生图提示词（省 token）。
 */
const DRAW_METHODS = ['prompts', 'imageGenerate'];
function withoutDrawing(a) {
  for (const k of DRAW_METHODS) a[k] = async () => { throw new Error('纯粹版不含 AI 作画'); };
  const split = a.aiSplit;
  if (typeof split === 'function') a.aiSplit = (body = {}) => split({ ...body, textOnly: true });
  return a;
}
async function makeApi() {
  const a = withUiLang(await makeApiRaw());
  return PURE ? withoutDrawing(a) : a;
}
async function makeApiRaw() {
  if (STATIC) {
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

/**
 * 纯粹版的几处措辞：同一个控件在纯粹版里只做 AI 分镜，说明别还在讲生图。
 * （整段换掉的说明放在 HTML 的 data-pure-only 里；这里只改单个标题 / 属性）
 */
function pureCopy() {
  const card = $('#autoCard');
  if (card) {
    card.dataset.panelName = '分镜自动';
    const h = card.querySelector('.card-head h2');
    if (h) h.textContent = '分镜自动';
  }
  $('#autoSeg')?.setAttribute('aria-label', '分镜自动');
  const split = $('#btnAiSplit');
  if (split) split.title = '版式已经定死：让 AI 把源文本切成每格（长剧本 / 小说也切得准）';
  const cs = $('#charSheet')?.closest('label')?.querySelector('span');
  if (cs) cs.textContent = '角色设定（可选，AI 写画面和台词时照着它）';
}

if (PURE) {
  document.documentElement.dataset.pure = '1';
  document.body.dataset.mode = 'pure';
  document.title = 'PanelForge 纯粹版 · 分镜与绘制';
} else if (ARTIST) {
  document.body.dataset.mode = 'artist';
  document.title = 'PanelForge 画师版 · 分镜与绘制';
}

if (SHELL) {
  document.body.dataset.shell = SHELL;
  document.documentElement.lang = document.documentElement.lang || 'zh-CN';
}

/* ------------------------------------------------------------------ *
 * ?perf=1：性能浮层
 * 只在这个参数下存在；用来量「拖动 / 缩放」热路径到底花了多少时间，
 * 手机上也能直接看（不用连 Mac 抓 Safari 时间线）。
 * ---------------------------------------------------------------- */

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
  await installI18n(params.get('lang') || store.get(KEYS.lang) || 'zh');
  initChrome();
  if (PERF) import('./perf-hud.mjs').then((m) => m.initPerfHud());
  bindUI();
  // 各功能模块自己绑自己的界面（以前全塞在 bindUI 里，一千多行）
  // 纯粹版：角色参考图 / 风格跟随只给生图用，不绑；Key 和分镜自动是 AI 分镜要用的，照绑
  if (!PURE) bindRefs();
  bindKeys();
  bindAutoUI();
  if (PURE) pureCopy();
  bindInboxUI();
  bindSlotZoom();
  initPaint();
  installRails();
  installAutosave();
  initCollapsibles();
  app.api = api = await makeApi();
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
  $('#statPort').textContent = STATIC ? '离线可用' : location.host;
  $('#analyzeHint').textContent = '本地规则引擎';
  if (meta.engine) {
    const e = meta.engine;
    $('#engineNote').innerHTML = `本地规则引擎 v${escapeHtml(e.version)}：<b>${e.intents}</b> 戏路 · <b>${e.keywords}</b> 关键词 · <b>${e.beats}</b> 节拍 · <b>${e.scenes}</b> 场景族 · <b>${e.tones}</b> 基调`;
  }
  renderList();

  loadLlm();
  syncLlmStatus();

  const want = new URLSearchParams(location.hash.slice(1)).get('tpl') || params.get('tpl');
  const first = want || 'ref-4band-2col';
  await selectTemplate(first);
  // 旧链接 / 打错的 ?tpl=：别停在"没有版式"的空状态，回落默认版式并说明
  if (!state.tpl) {
    await selectTemplate('ref-4band-2col');
    if (want && state.tpl) {
      toast(`没有「${want}」这套模板（可能是旧链接），先给你默认版式`);
      const foot = $('#footMsg');
      if (foot) {
        foot.textContent = `链接里的模板「${want}」不存在，已载入默认版式 —— 从左边模板库挑一套即可`;
        $('#stageFoot')?.classList.add('warn');
      }
    }
  }

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
    state.pages = [{ id: newPageId(), tplId: state.tpl?.id || 'ref-4band-2col', name: '第 1 页', images: {}, bubbles: [], lines: {} }];
    state.pageIdx = 0;
  }
  renderPageTabs();
  loadKeyStore();
  if (!PURE) await loadChars();   // 角色参考图只给生图用，纯粹版不读

  // 再尝试恢复草稿：IndexedDB 不可用 / 被策略卡住时 loadDraft 1.5s 内返回 null，不会拖死启动
  // ?fresh=1 跳过恢复（自动化测试要干净的初始状态，否则上一个用例的草稿会换掉模板）
  try {
    const draft = FRESH ? null : await loadDraft();
    if (draft && draft.pages?.length) {
      state.pages = draft.pages;
      state.pageIdx = Math.min(draft.pageIdx || 0, draft.pages.length - 1);
      const pg = state.pages[state.pageIdx];
      if (pg?.tplId) await selectTemplate(pg.tplId, { keepImages: false });
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
  if (params.get('keyselftest') === '1') await (await import('./selftest.mjs')).runKeySelfTest();
  if (params.get('aiselftest') === '1') await (await import('./selftest.mjs')).runAiSelfTest();
  if (params.get('shortcuts') === '1') toggleShortcuts(true);
  // AI 关着的时候 Key 面板是藏起来的：别把一个看不见的模态框打开（整页会点不动）
  if (params.get('keys') === '1' && document.body.dataset.ai !== 'off') openKeySheet();
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
 * 撤销 / 重做
 * 快照只克隆对象的外壳，图片的 dataURL 字符串是共享引用，所以很轻
 * ================================================================== */

/* ================================================================== *
 * 模板列表
 * ================================================================== */
/** 戏路 id → 中文（从 /api/meta 拿；拿不到就退回 id） */
function intentZh(id) {
  return state.intentZh?.[id] || id;
}

/* ---------------- 模板库 ----------------
 * 138 张卡的缩略图只在第一次生成；之后搜索 / 筛选 / 换选中只切 hidden 和 .on。
 * 以前每敲一个字就把 138 个缩略图 SVG 重新拼一遍再 innerHTML（40–90ms），整排入场动画也跟着重放。 */
const tplCards = new Map();   // 模板 id → 卡片元素
const tplHay = (t) => {
  const lang = getLang();
  const memo = (t._hay ??= {});
  if (memo[lang]) return memo[lang];
  const zh = t.id + t.name + t.desc + t.tags.join('') + t.intents.map(intentZh).join('')
    + intentZh(t.ratio) + ratioName(t.ratio) + t.panels + '格 ' + CULTURE_ZH[t.culture];
  // 非中文界面：把卡片上看得见的字（名字、标签、戏路、画风）的译文也放进去，用户用自己的语言搜得到
  const local = lang === 'zh' ? '' : ' ' + [...String(t.name).split('·'), ...t.tags, ...t.intents.map(intentZh), CULTURE_ZH[t.culture], ratioName(t.ratio)]
    .map((x) => tr(String(x || '').trim())).join(' ');
  return (memo[lang] = (zh + local).toLowerCase());
};

function tplCard(t) {
  let el = tplCards.get(t.id);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'tpl';
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
  tplCards.set(t.id, el);
  return el;
}

/** rebuild：换语言时把卡片按当前语言重建一遍 */
function renderList({ rebuild = false } = {}) {
  const q = ($('#search').value || '').trim().toLowerCase();
  let list = state.items;
  if (state.cultureTab !== 'all') list = list.filter((t) => t.culture === state.cultureTab);
  // 搜索框也吃标签的**中文名**（「四格」「战斗」「9:16」都能命中）
  if (q) list = list.filter((t) => tplHay(t).includes(q));
  if (state.libFilter) list = list.filter((t) => matchFacet(t, state.libFilter));
  state.filtered = list;
  $('#listCount').textContent = `${list.length} 套`;
  renderFacetBar();

  const grid = $('#tplGrid');
  if (rebuild || grid._items !== state.items) {
    tplCards.clear();
    grid._items = state.items;
    grid.replaceChildren(...state.items.map(tplCard));
    staggerIn(grid, '.tpl:nth-child(-n+18)', { cap: 14, step: 24 });
  }
  if (!grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.tpl');
      if (!card) return;
      const tag = ev.target.closest('[data-facet]');
      if (tag) {   // 点卡片上的标签 = 按它筛选，而不是换模板
        ev.stopPropagation();
        setFacet(tag.dataset.facet, tag.dataset.val);
        return;
      }
      selectTemplate(card.dataset.id); goCanvasOnCompact();
    });
  }
  const show = new Set(list.map((t) => t.id));
  const cur = state.tpl?.id;
  const revealed = [];
  for (const [id, el] of tplCards) {
    const hide = !show.has(id);
    if (el.hidden && !hide) revealed.push(el);
    el.hidden = hide;
    el.classList.toggle('on', id === cur);
  }
  // 筛选 / 搜索后新出现的卡片依次浮上来（只动前十几张，屏幕外的不浪费）
  revealed.slice(0, 14).forEach((el, i) => fx.rise(el, i * 22));
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
/**
 * 模板是只读数据：同一个 id 只取一次（换页、批量出图、导出全部页都会反复要同一套）。
 * 返回的是缓存里的对象，调用方**不要改它**（改画幅走 deriveTpl，它会深拷一份）。
 */
const tplCache = new Map();
async function fetchTemplate(id) {
  if (!id) return null;
  if (!tplCache.has(id)) {
    tplCache.set(id, Promise.resolve(api.template(id)).then((t) => (t && !t.error ? t : null)).catch(() => null));
  }
  const t = await tplCache.get(id);
  if (!t) tplCache.delete(id);   // 失败不缓存，下次还能重试
  return t;
}

async function selectTemplate(id, opts = {}) {
  if (!id) return;
  // 再点一次当前这套：内容原样保留（以前会清掉气泡、手改的提示词和撤销历史），只按当前剧情刷新分镜表
  if (state.tpl?.id === id && opts.keepImages !== false) {
    refreshScript();
    return;
  }
  const tpl = await fetchTemplate(id);
  if (!tpl) { toast('模板不存在：' + id); return; }

  // 换模板时图片按阅读顺序搬家、气泡按页面比例跟过去（换页 / 恢复草稿时传 keepImages:false，
  // 那两条路径之后会整体换成那一页自己的内容）。
  // 以前这里写成 `!opts.keepImages === false`，结果恰好反了：模板库里点卡片换模板时图片不搬家，
  // 旧格子 id 的图留在 state 里（被藏起来、换回去又冒出来），气泡则被直接清空且不可撤销。
  const moving = !!(state.tpl && state.tpl.id !== tpl.id && opts.keepImages !== false);
  if (moving) {
    const ordered = state.tpl.slots.map((s) => state.images[s.id]).filter(Boolean);
    const next = {};
    tpl.slots.forEach((s, i) => { if (ordered[i]) next[s.id] = ordered[i]; });
    state.images = next;
    if (ordered.length > tpl.slots.length) {
      toast(`新模板只有 ${tpl.slots.length} 格，超出的 ${ordered.length - tpl.slots.length} 张图未放入`);
    }
    const from = state.tpl.page;
    const kx = tpl.page.w / from.w, ky = tpl.page.h / from.h;
    for (const b of state.bubbles) {
      b.x = r2(b.x * kx); b.y = r2(b.y * ky);
    }
  }
  state.tpl = tpl;
  state.tplBase = JSON.parse(JSON.stringify(tpl));   // 画幅重排的基准，之后不再动
  state.pageSize = null;
  state.pageEnter = true;
  if (state.aiPlan && state.aiPlan.template?.id !== tpl.id) { state.aiPlan = null; state.aiDecision = null; }
  if (!moving) state.bubbles = [];
  state.selBubble = null;
  resetHistory();
  loadLines(tpl.id);
  state.promptEdits = {};
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
  for (const [id, el] of tplCards) el.classList.toggle('on', id === tpl.id);
  refreshScript();
}

function readOrderText(r) {
  return r === 'rtl' ? '右→左 · 上→下' : r === 'vertical' ? '上→下' : '左→右 · 上→下';
}

/* ================================================================== *
 * 画布渲染
 * ================================================================== */
let rafPending = false;
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
 * 选中 / 悬停换了：只重画高亮那一层（几个 path），不重拼整页 SVG、也不触发存草稿。
 * 以前鼠标每划过一格就整页重绘 + 排一次存盘（扫一遍画布 25 次重绘、175 个定时器）。
 * 还没画出高亮层（比如整页重绘还在排队）就返回 false，调用方退回 renderStage()。
 */
function patchHighlight() {
  const layer = $('#canvas svg g[data-hl-layer]');
  if (!layer || !state.tpl || rafPending) return false;
  const t0 = perfNow();
  const h = highlightMarkup(state.tpl, {
    selectedId: state.hollow ? null : state.selectedId,
    hoverId: state.hoverId,
    uiAccent: currentTint(),
  });
  const [hov, sel] = layer.children;
  if (hov._hl !== h.hover) { hov.innerHTML = h.hover; hov._hl = h.hover; }
  if (sel._hl !== h.sel) { sel.innerHTML = h.sel; sel._hl = h.sel; }
  perfDone('patch', t0);
  return true;
}
function setHover(id) {
  if (id === state.hoverId) return;
  state.hoverId = id;
  if (!patchHighlight()) renderStage();
}
/** 只换选中格（不动内容）：选中的气泡要取消时，气泡的虚线框也得重画，那就走整页 */
function selectSlotQuick(id) {
  const hadBubble = state.selBubble != null;
  state.selectedId = id;
  state.selBubble = null;
  if (hadBubble || !patchHighlight()) renderStage();
  syncSlotZoomSoon();
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
/** 错误详情：toast 装不下的完整报错（可选中复制）。用通用弹窗 sheet()，和其它弹窗同一套样子与进出场 */
function showErrorDetail(title, err, extra = '') {
  const msg = String(err?.message || err || '未知错误');
  const hint = err?.hint || '';
  const code = err?.code || '';
  const rid = err?.requestId ? `\nrequest_id=${err.requestId}` : '';
  const text = `${msg}${rid}${hint ? '\n\n建议：' + hint : ''}${extra ? '\n' + extra : ''}`;
  const s = sheet({
    id: 'errSheet',
    title: title + (code ? ` · ${code}` : ''),
    sub: '完整信息（可选中复制）',
    body: `<pre class="err-pre"></pre>
      <div class="row2">
        <button type="button" class="btn tiny primary" data-copy>复制错误信息</button>
        <button type="button" class="btn tiny" data-close>知道了</button>
      </div>`,
  });
  s.body.querySelector('.err-pre').textContent = text;
  s.body.addEventListener('click', (ev) => { if (ev.target.closest('[data-copy]')) copyText(text, '错误信息已复制'); });
  return s.el;
}

// 调试/自动化钩子：不产生真实请求就能看错误面板长什么样
window.__pfShowError = showErrorDetail;
// 调试钩子：查看当前实际生效的 LLM 配置（排查「配了却没生效」这类问题）
window.__pfLlm = () => ({ ...state.llm });
window.__pfApi = () => api;
window.__pfJobs = () => ({ ...(state.imgJobs || {}) });
window.__pfImages = () => ({ ...state.images });
window.__pfSel = (id) => { selectSlotQuick(id); renderSlotPanel(); refreshGenButtons(); };

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
        highlightLayer: true,
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
        btn.textContent = '复制错误信息';
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
    // 换模板：页面从景深里浮上来；落定后再对一次缩放条（动画期间格子位置在变）
    if (state.pageEnter) {
      state.pageEnter = false;
      settled(fx.pageIn(holder)).then(syncSlotZoom);
    }
    syncSlotZoom();
    syncEditZoom();   // 手机编辑页：选中格 / 尺寸没变时立即返回
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

// 生图超时：Seedream/Flux 排队 1–2 分钟是常态，默认给 120s；?imgtimeout=毫秒 可临时改（测试用）
const IMG_TIMEOUT_MS = Number(params.get('imgtimeout')) || 120000;
    // 文本：60s 还没回来基本就是挂了

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
  const open = [...document.querySelectorAll('dialog[open], #ctxMenu:not(.hidden), .rail-pop:not(.hidden)')];
  const before = { imgJobs: Object.keys(state.imgJobs || {}).length, overlays: open.length };
  state.imgJobs = {};
  state.autoStop = true;
  // 关浮层
  for (const el of open) {
    if (el.tagName === 'DIALOG') el.close('dismiss'); else el.classList.add('hidden');
  }
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
    lastPointerType = ev.pointerType || 'mouse';
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
      setHover(id);
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
      if (slot) { selectSlotQuick(slot.id); renderSlotPanel(); renderBubbles(); }
      else { selectSlotQuick(null); renderSlotPanel(); }
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
    setHover(null);
  });

  canvas.addEventListener('wheel', (ev) => {
    if (!state.tpl || state.hollow) return;
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey) return;
    const slot = slotAt(pagePoint(ev));
    if (!slot || !state.images[slot.id]) return;
    ev.preventDefault();
    const img = state.images[slot.id];
    img.zoom = clamp((img.zoom || 1) * (ev.deltaY < 0 ? 1.08 : 0.93), 0.3, 6);
    // 换格子只重画高亮层，图片本身只改属性
    if (state.selectedId !== slot.id) { selectSlotQuick(slot.id); renderSlotPanel(); }
    refreshSlotImage(slot.id);
    syncZoomSlider();
    queueSave();
  }, { passive: false });

  // 拖文件经过画布：只负责「指针下是哪一格」的高亮（落下由 installImageInbox 的 document 级 drop 统一处理。
  // 以前这里还有一套 drop：一次拖放被两套监听器各处理一遍——同一张图塞两次、多图拖入会被第二套覆盖）
  canvas.addEventListener('dragover', (ev) => {
    if (!state.tpl) return;
    const id = slotAt(pagePoint(ev))?.id || null;
    canvas.classList.add('dragover');
    setHover(id);
  });
  canvas.addEventListener('dragleave', () => {
    canvas.classList.remove('dragover');
    setHover(null);
  });
  canvas.addEventListener('drop', () => canvas.classList.remove('dragover'));

  // 键盘
  window.addEventListener('keydown', (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;

    // Ctrl+Shift+Enter：AI 导演（先判断带 Shift 的组合，否则会被下面的规则匹配吃掉）
    if (mod && ev.shiftKey && k === 'Enter') { ev.preventDefault(); if (!(PURE && document.body.dataset.ai === 'off')) runAiDecide(); return; }
    // Ctrl+Enter：按规则匹配（输入框里也能用）
    if (mod && k === 'Enter') { ev.preventDefault(); runMatch(); return; }

    // 输入框里按 Esc：先退出输入（之后的单键快捷键才能用）
    if (typing && k === 'Escape') { document.activeElement.blur(); return; }
    if (typing) return;

    // ?：快捷键表（任何状态都能开）
    if (k === '?' || (ev.shiftKey && k === '/')) { ev.preventDefault(); toggleShortcuts(); return; }
    // 弹窗开着：别的单键快捷键不作用到背后的画布上（Esc 交给弹窗自己关）
    const modal = document.querySelector('dialog[open]');
    if (modal) { if (k === 'Escape') closeModal(modal); return; }
    if (k === 'Escape') {
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

    // ---- 气泡微调（必须排在格子导航前面：选中气泡时 ←→ 是挪气泡，不是换格子）----
    const bub = selectedBubble();
    if (bub && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      commitThrottled(300);
      if (k === 'ArrowUp') bub.y -= step;
      if (k === 'ArrowDown') bub.y += step;
      if (k === 'ArrowLeft') bub.x -= step;
      if (k === 'ArrowRight') bub.x += step;
      refreshBubble(bub.id);
      queueSave();
      return;
    }

    // ---- 格子导航 ----
    const idx = state.tpl.slots.findIndex((s) => s.id === state.selectedId);
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      ev.preventDefault();
      const dir = k === 'ArrowRight' ? 1 : -1;
      const next = state.tpl.slots[clamp(idx + dir, 0, state.tpl.slots.length - 1)];
      selectSlotQuick(next.id); renderSlotPanel();
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
        selectSlotQuick(slot.id); renderSlotPanel();
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
  $('#btnResetDraft')?.addEventListener('click', async () => {
    if (!(await ask('清空本机草稿？所有页的图片、气泡和句子都会删掉，不能恢复。', { ok: '清空', danger: true }))) return;
    // 图片 / 底图 / 候选图是分页单独存的，要连它们一起删，否则几 MB 会一直占着
    await clearDrafts();
    state.pages = [{ id: newPageId(), tplId: state.tpl?.id || 'ref-4band-2col', name: '第 1 页', images: {}, bubbles: [], lines: {} }];
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
  $('#btnAiPrompts').addEventListener('click', () => runAiPrompts());
  $('#btnAiSplit')?.addEventListener('click', runAiSplit);

                  // 快捷键表
  $('#btnShortcuts').addEventListener('click', () => toggleShortcuts(true));

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
    queueSave();   // 内容变了自己排存盘（以前靠「下一次整页重绘顺手存」，选格不再整页重绘后就会漏）
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
    setRange($('#exportW'), state.exportWidth);
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

/** 最近一次按下画布用的是什么（mouse / touch / pen）：触屏双击是「进编辑页」，不能再顺手打开图库 */
let lastPointerType = 'mouse';
/**
 * 鼠标双击某一格 = 选图填进去（画师版 = 直接进画布）。
 * 触屏 / 手写笔的双击由 noteTap → fireDoubleTap 处理（进这一格的编辑页）；
 * 手机浏览器在双击后还会补发一次 dblclick，以前它会接着弹出系统图库。
 */
function onCanvasDblClick(ev) {
  if (lastPointerType !== 'mouse') return;
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
  const url = await askText('图片链接（http/https，或用 data:image/... 开头）：', { title: '用图片链接', placeholder: 'https://…' });
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

/** 默认展开哪些段：「分镜」默认收起（它是查资料用的，日常最占地方） */
const SLOT_SEC_OPEN = { text: true, image: true, ai: true, board: false };
function initSlotSections() {
  const saved = store.json(KEYS.slotSec, {});
  for (const sec of $$('#slotPanel .slot-sec')) {
    const key = sec.dataset.sec;
    const head = sec.querySelector('.sec-head');
    // 折叠用 grid 0fr↔1fr：内容要包进唯一的一层 .sec-inner
    const body = sec.querySelector(':scope > .sec-body');
    if (body && !body.querySelector(':scope > .sec-inner')) {
      const inner = document.createElement('div');
      inner.className = 'sec-inner';
      inner.append(...body.childNodes);
      body.append(inner);
    }
    const apply = (open, animate) => {
      setFold(sec, open, { instant: !animate });
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    // 用户手动开关过的以记录为准，没动过的按上面这张默认表
    apply(typeof saved[key] === 'boolean' ? saved[key] : (SLOT_SEC_OPEN[key] !== false), false);
    head.addEventListener('click', () => {
      const open = sec.classList.contains('collapsed');
      apply(open, true);
      saved[key] = open;
      store.setJSON(KEYS.slotSec, saved);
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
 * 把原来「分镜表」里这一格的信息渲染进小框的「这一格的分镜」段。
 * 由 renderSlotPanel() 统一调用 —— 换格子、重新匹配、AI 排戏之后都会自动跟着变。
 */
/**
 * 这一格的构图提示。AI 切原文会把画面内容写进 beatHint（两处一模一样），那时就不再重复一遍。
 */
function compHint(p) {
  if (!p) return '';
  return (p.beatHint && p.beatHint !== p.content ? p.beatHint : '') || p.composition || '';
}

function renderSlotBoard(panel) {
  const box = document.querySelector('#slotBoard');
  const pr = document.querySelector('#slotBoardPrompts');
  if (!box) return;
  // AI 关着（画师版默认、纯粹版关掉 AI 分镜）就别再叫人「让 AI 排戏」
  const aiOff = document.body.dataset.ai === 'off';
  if (!panel) {
    box.innerHTML = aiOff ? '<b>状态</b><span>先在左边写剧情并点「按规则匹配」</span>'
      : '<b>状态</b><span>先在左边写剧情并点「按规则匹配」，或让 AI 导演排一次戏</span>';
    if (pr) pr.innerHTML = '';
    const sum = document.querySelector('#secBoardSum');
    if (sum) sum.textContent = '待生成';
    return;
  }
  // 只放「分镜」层面的东西；画幅比 / 导出像素这些归下面的「图片」段，别两处重复
  const rows = [
    ['景别', `${panel.roleZh || ''} ｜ ${panel.shot || ''}`],
    ['节拍', panel.beat || '通用镜头'],
    ['画面', panel.content || (aiOff ? '（未填，写一段剧情再按规则匹配）' : '（未填，写剧情或让 AI 排戏）')],
    ['台词', panel.dialogue ? '「' + panel.dialogue + '」' : '（无）'],
    ['构图', compHint(panel) || '—'],
  ];
  box.innerHTML = rows.map(([k, v]) => `<b>${k}</b><span>${escapeHtml(String(v))}</span>`).join('');

  if (pr && !PURE) {   // 纯粹版：不放提示词
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
    if (!first) { fx.pop(idxEl); fx.swapIn($('#slotPanel'), 'slotSwap'); }
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
    ...(PURE ? [] : [['建议出图', panel ? panel.genSize : '—']]),
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
  // 两句分开放：固定说明 + 这种形状的构图提示（各自是完整一句，翻译时才不会被拆碎）
  $('#shapeTip').innerHTML = '<span>已经自动放在上面生图提示词的最前面；自己用别的工具出图时也可以单独复制。</span>'
    + (shape?.hintZh ? ` <span>${escapeHtml(shape.hintZh)}</span>` : '');

  setRange($('#zoom'), Math.round((img?.zoom || 1) * 100));
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
  setRange($('#zoom'), Math.round(img.zoom * 100));
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

async function runAiDecide() {
  const plot = $('#plot').value.trim();
  if (!plot) { toast('先写一段剧情吧'); $('#plot').focus(); return; }
  saveLlm();
  const btn = $('#btnAiDecide');
  const restore = busyLabel(btn);
  setBusy(btn, true);
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
    await selectTemplate(res.decision.pick);
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
    setBusy(btn, false);
    restore();
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
  setBusy(btn, true);
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
      await selectTemplate(res.results[0].id);
      toast(`已载入最匹配的分镜：${res.results[0].name}`);
    }
  } catch (e) {
    toast('匹配失败：' + e.message);
  } finally {
    setBusy(btn, false);
    btn.querySelector('span').textContent = '按规则匹配';
  }
}

function renderIntentChips(a) {
  const box = $('#intentChips');
  if (!a) { box.innerHTML = ''; return; }
  const bits = a.intents.slice(0, 4).map((it, i) =>
    `<span class="chip ${i === 0 ? 'hot' : ''}"><span>${it.zh}</span> ${(it.conf * 100).toFixed(0)}%</span>`);
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
  staggerIn(box, '.res');
  box.querySelectorAll('.res').forEach((el) => {
    el.addEventListener('click', () => { selectTemplate(el.dataset.id); goCanvasOnCompact(); });
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

  const list = $('#scriptList');
  list.innerHTML = panels.map((p) => `
    <div class="sc-card" data-id="${p.id}">
      <div class="top">
        <span class="no">${p.order}</span>
        <span class="rl">${escapeHtml(p.roleZh)}</span>
        ${p.shape ? `<span class="shape-chip">${escapeHtml(p.shape.zh)}</span>` : ''}
        ${p.aiOptimized ? '<span class="shape-chip ai-chip">AI</span>' : ''}
        <span class="bt">${escapeHtml(p.beat || '通用镜头')}</span>
      </div>
      <div class="asp">${PURE ? `${p.aspectLabel} · 占页 ${p.areaPct}%` : `${p.aspectLabel} · 建议出图 ${p.genSize} · 占页 ${p.areaPct}%`}</div>
      ${p.content ? `<div class="ct">${escapeHtml(p.content)}</div>` : ''}
      ${p.dialogue ? `<div class="dl" translate="no">「${escapeHtml(p.dialogue)}」</div>` : ''}
      ${PURE ? (compHint(p) ? `<div class="hint">${escapeHtml(compHint(p))}</div>` : '') : `<div class="pr">${escapeHtml(effectivePrompt(p.id).prompt)}</div>
      ${p.promptZh ? `<div class="pr zh" translate="no">${escapeHtml(p.promptZh)}</div>` : ''}`}
      <div class="act">
        ${PURE ? '' : `<button class="btn tiny" data-act="copy">复制提示词</button>
        <button class="btn tiny" data-act="prefix">复制形状词</button>
        <button class="btn tiny" data-act="prefixZh">复制中文形状词</button>
        <button class="btn tiny" data-act="promptZh">复制中文提示词</button>`}
        <button class="btn tiny" data-act="fill">填入选中格</button>
      </div>
    </div>`).join('');
  // 只有换了版式 / 格子变了才依次浮现（以前每改一个字、每次重绘都整排重放一遍）
  const listKey = state.tpl.id + ':' + panels.map((p) => p.id).join(',');
  if (list.dataset.key !== listKey) { list.dataset.key = listKey; staggerIn(list, '.sc-card', { cap: 10 }); }

  list.querySelectorAll('.sc-card').forEach((card) => {
    const p = panels.find((x) => x.id === card.dataset.id);
    card.addEventListener('click', (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'copy') copyText(effectivePrompt(p.id).prompt, '该格提示词已复制');
      else if (act === 'prefix') copyText(p.shape?.prefixEn || '', '形状开头词已复制');
      else if (act === 'prefixZh') copyText(p.shape?.prefixZh || '', '中文形状词已复制');
      else if (act === 'promptZh') copyText(p.promptZh || '', '中文提示词已复制');
      else if (act === 'fill') { selectSlotQuick(p.id); renderSlotPanel(); toast('已选中第 ' + p.order + ' 格'); }
      else { selectSlotQuick(p.id); renderSlotPanel(); }
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
  if (!list.length) { grid.innerHTML = ''; grid._html = ''; grid._n = 0; return; }
  const html = list.map((href, i) => `
    <button type="button" class="cand" data-i="${i}" title="点一下用这张">
      <img src="${escapeHtml(href)}" alt="候选 ${i + 1}" decoding="async">
      <span class="del" data-del="${i}" title="删掉这张">×</span>
      <span class="edit" data-edit="${i}" title="用这张进画布继续画（AI 出稿 → 手改）">✎</span>
    </button>`).join('');
  // 每次选格 / 重绘右栏都会叫到这里：内容没变就不碰 DOM（以前每次都重建、入场动画整排重放）
  if (grid._html === html) return;
  const fresh = grid.dataset.sid !== state.selectedId;
  const grew = list.length > (grid._n || 0);
  grid._html = html;
  grid._n = list.length;
  grid.dataset.sid = state.selectedId;
  grid.innerHTML = html;
  // 换了格子：整排依次浮现；同一格新出了一张：只让新的那张（排在最前）浮上来；删图不动
  if (fresh) staggerIn(grid, '.cand', { cap: 8 });
  else if (grew) fx.rise(grid.firstElementChild);
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

 function pageLabel(pg, i) {
  return (pg && pg.name) || '第 ' + (i + 1) + ' 页';
}

async function renamePage(i) {
  const pg = state.pages[i];
  if (!pg) return;
  const cur = pg.name || '';
  const name = await askText('给这一页起个名字（比如：开场 / 对峙 / 收束）', { title: '页面名字', value: cur || pageLabel(pg, i) });
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
    // 提示词来源（规则 / AI / 自己写）和开头词开关也是本页内容：以前没存，换页、刷新就回到默认
    promptSrc: { ...state.promptSrc },
    promptPrefix: { ...state.promptPrefix },
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
  await selectTemplate(pg.tplId, { keepImages: false });
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

/**
 * 导出全部页：每一页在内存里按它自己的模板 / 画幅 / 图片 / 气泡拼成 SVG 再栅格化，
 * **不切换**界面上正在看的那一页（以前是逐页 switchPage + 固定 sleep 等它画完，
 * 一边闪一边慢，导完还把人留在最后一页）。
 */
async function exportAllPages() {
  if (!state.pages.length) { toast('还没有页'); return; }
  savePage();
  const btn = $('#btnExportAll');
  const restore = busyLabel(btn);
  setBusy(btn, true);
  let n = 0;
  try {
    for (let i = 0; i < state.pages.length; i++) {
      btn.textContent = `导出中 ${i + 1}/${state.pages.length}…`;
      const pg = state.pages[i];
      const base = i === state.pageIdx ? state.tplBase : await fetchTemplate(pg.tplId);
      if (!base) continue;
      const tpl = i === state.pageIdx ? state.tpl
        : (pg.size ? deriveTpl(base, pg.size.w, pg.size.h, pg.size.mode || 'stretch') : base);
      const images = await exportImageMap(i === state.pageIdx ? state.images : rehydrateImages(pg.images || {}));
      const bubbles = i === state.pageIdx ? state.bubbles : (pg.bubbles || []);
      const w = state.exportWidth;
      const h = Math.round((w * tpl.page.h) / tpl.page.w);
      const png = await rasterizeSVG(stageSVG({ tpl, images, bubbles }), w, h);
      const safe = String(pageLabel(pg, i)).replace(/[\\/:*?"<>|]/g, '_');
      await exportBlob(png, `${String(i + 1).padStart(2, '0')}-${safe}.png`);
      n++;
    }
    toast(`已导出 ${n} 页`);
  } catch (e) {
    toast('导出中断：' + e.message);
  } finally {
    setBusy(btn, false);
    restore();
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

/**
 * AI 写台词/旁白。
 *   mode='one'   只写当前这一格
 *   mode='page'  写这一页所有还没有句子的格子（已有内容的跳过）
 *   mode='again' 换一句：连同刚才那句一起发给模型，让它别重复
 * 写好的句子会落进 state.lines（和手打完全同一条路径）；台词 / 内心独白顺手挂一个气泡
 * （按文字内容挑样式，不额外烧 token）。之前这一步写成了 `state.bubbles[id] = type`——
 * 往气泡**数组**上挂字符串属性，结果一个气泡也没出现。
 * @param {{silent?: boolean}} opts silent=true（全自动调用）：失败直接抛出，不弹错误面板挡住流程
 */
async function aiWriteLines(mode = 'one', { silent = false } = {}) {
  const fail = (msg) => { if (silent) throw new Error(msg); toast(msg); };
  if (!state.tpl) return fail('先选一套版式');
  const page = pagePlan();
  const panels = page?.panels || [];
  if (!panels.length) return fail('还没有分镜计划：先按规则匹配或让 AI 排戏');

  const sel = state.selectedId;
  let ids = [];
  if (mode === 'page') {
    ids = panels.filter((p) => !String(state.lines?.[p.id] || '').trim()).map((p) => p.id);
    if (!ids.length) { if (!silent) toast('这一页每一格都有句子了'); return; }
  } else {
    if (!sel) return fail('先点一个格子');
    ids = [sel];
  }

  const btns = ['#btnAiLine', '#btnAiLineReroll', '#btnAiLinesPage'].map((x) => $(x)).filter(Boolean);
  const labels = btns.map((b) => b.textContent);
  btns.forEach((b, i) => { setBusy(b, true); if (i === 0) b.textContent = 'AI 正在写…'; });
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
    if (!res?.ok) throw Object.assign(new Error((res?.code ? res.code + '：' : '') + (res?.error || 'AI 没返回')), { code: res?.code, hint: res?.hint });

    const lines = res.lines || {};
    const got = Object.keys(lines).filter((id) => lines[id]?.text);
    if (!got.length) throw new Error('模型这次没写出可用的句子');

    commit();
    let bubbled = 0;
    for (const id of got) {
      const item = lines[id];
      state.lines[id] = item.text;
      const slot = state.tpl.slots.find((x) => x.id === id);
      const panel = panels.find((x) => x.id === id);
      const pick = pickBubbleForText(item.text, { role: slot?.role, beat: panel?.beat });
      if (id === state.selectedId && pick?.type) {
        state._lineBubbleHint = { type: pick.type, why: pick.why, kind: item.kind };
      }
      // 台词 / 内心挂气泡；旁白不挂（交给人决定放不放旁白框）。
      // 这一格已经有 AI 挂过的气泡就只换文字，「换一句」不会越堆越多
      if (slot && pick?.type && (item.kind === '台词' || item.kind === '内心')) {
        const mine = state.bubbles.find((b) => b.slot === id && b.auto);
        if (mine) { mine.text = item.text; continue; }
        const b = makeBubble(pick.type, {
          page: state.tpl.page,
          at: { x: slot.x + slot.w * 0.5, y: slot.y + Math.max(30, slot.h * 0.22) },
          text: item.text,
        });
        Object.assign(b, { baseW: b.w, baseH: b.h, slot: id, auto: true });
        state.bubbles.push(b);
        bubbled++;
      }
    }
    saveLines();
    renderSlotPanel(); renderStage(); renderScript();

    // 把「为什么这样写」显示在思路行里
    const first = lines[ids[0]] || lines[got[0]];
    if (first?.why) { state._suggest = first.why; state._suggestAi = true; syncSuggest(); }
    if (state.selectedId === ids[0]) {
      const ta = $('#slotLine');
      if (ta) ta.value = state.lines[ids[0]] || '';
    }
    if (!silent) {
      const tail = bubbled ? `，挂了 ${bubbled} 个气泡` : '';
      toast(mode === 'page'
        ? `已给 ${got.length} 格写好台词（空着的才写）${tail}`
        : `已写好：${String(state.lines[ids[0]] || '').slice(0, 16)}${tail}`);
    }
    return { filled: got.length, bubbled };
  } catch (e) {
    if (silent) throw e;
    toast(`写台词失败${e?.code ? `（${e.code}）` : ''}`);
    showErrorDetail('写台词失败', e);
    return null;
  } finally {
    btns.forEach((b, i) => { setBusy(b, false); b.textContent = labels[i]; });
  }
}

/**
 * 用用户自己的生图模型，直接生成某一格。
 * @param {string} targetId 生成哪一格（发起时锁定，期间切格子不会串格）
 * @param {{askChars?: boolean}} opts askChars=false：批量队列里不再逐张弹「没有角色参考图」确认
 *   （批量开始前的危险确认里已经说明过，一次跑 20 张就弹 20 次是灾难）
 */
/**
 * 给一格生图。quiet：批量生图用 —— 不弹提示、不问角色图，失败直接抛给调用方记日志。
 */
async function generateSlotImage(targetId = state.selectedId, { askChars = true, quiet = false } = {}) {
  if (!state.tpl || !targetId) { if (!quiet) toast('先点一个格子'); return; }
  // 锁定格子：生成期间你点别的格子，结果也只回到这一格（以前是回到「点击时选中的那格」→ 会串格）
  const sid = targetId;
  const panel = currentPlanPanel(sid);
  const slot = state.tpl.slots.find((s) => s.id === sid);
  const cellLabel = slot ? `第 ${slot.order} 格` : '这一格';
  state.imgJobs = state.imgJobs || {};
  if (state.imgJobs[sid]) { if (!quiet) toast(`${cellLabel}正在生成，等它出来`); return; }
  state.imgJobs[sid] = true;
  refreshGenButtons();
  saveLlm();
  try {
    const built = buildImagePrompt(sid);
    const charPayload = built.chars;
    // 取消时直接 return：finally 会清掉作业标记、复原按钮（以前这里引用了不存在的 btn/old，
    // 一取消就抛 ReferenceError，被下面的 catch 当成「生图失败」弹出错误面板）
    if (askChars && !charPayload.block
      && !(await ask('还没启用角色参考图，生成的图可能每格长得不一样。\n建议先去左边「角色参考图」加一张。\n仍然继续生图吗？', { ok: '继续生图', cancel: '先去加参考图' }))) return;
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
    let src = res.href || (res.b64 ? 'data:image/png;base64,' + res.b64 : '');
    // 只给了 URL：能走代理就拉成 Blob（导出时不会因为跨域把画布弄脏），否则只能直接用 URL
    if (!src && res.url) src = api.proxyImage ? await api.proxyImage(res.url) : res.url;
    if (!src) throw new Error('生图接口没有返回可用的图片');
    // 候选图存 blob URL（以前存 data URL：DOM 里塞几 MB base64，每次存草稿还整段重写）
    let cand = typeof src === 'string' ? src : '';
    try { cand = await blobUrlOf(src); } catch { /* 跨域拿不到字节：保留原 URL */ }
    const list = candsOf(sid);
    list.unshift(cand);
    if (list.length > 8) list.pop();
    commit();
    state.images[sid] = await imageAsset(cand || src, { name: 'ai' });
    renderStage(); renderSlotPanel(); refreshScript(); renderCands();
    queueSave();
    if (quiet) return;
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
    if (quiet) throw e;
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
  const restore = busyLabel(btn);
  setBusy(btn, true);
  btn.textContent = '切分中…';
  $('#scriptHint').textContent = 'AI 正在把源文本切成每格…';
  try {
    saveLlm();
    const res = await api.aiSplit({
      plot,
      templateId: state.tpl.id,
      pageWidth: state.exportWidth,
      characterSheet: state.charSheet,
      llm: state.llm,
    });
    if (!res.ok) {
      $('#scriptHint').textContent = `${res.error || '切分失败'}${res.hint ? ' · ' + res.hint : ''}`;
      toast(`切分失败：${res.code || res.error}`);
      return;
    }
    // AI 的切分结果就是这一页的分镜。注意 aiPlan 必须是 plan 本身（带 template / panels）：
    // 以前包了一层 {template, plan}，pagePlan() 拿到的是没有 panels 的外壳 → 分镜表和小框都是空的
    state.aiPlan = res.plan;
    state.aiDecision = null;
    renderScript();
    renderSlotPanel();
    const miss = res.quality?.missing?.length || 0;
    $('#scriptHint').textContent = `${state.tpl.name} · 已切好 ${res.applied}/${res.total} 格`
      + (miss ? (PURE ? ` · ${miss} 格模型没给（先用规则节拍顶上）` : ` · ${miss} 格模型没给（可用「AI 优化提示词」补）`) : '')
      + (res.globalNotes ? ` · ${res.globalNotes}` : '');
    toast(`AI 切原文完成：${res.applied}/${res.total} 格`);
  } catch (e) {
    $('#scriptHint').textContent = '切分出错：' + e.message;
    toast('切分失败：' + e.message);
  } finally {
    setBusy(btn, false);
    restore();
  }
}

/**
 * AI 优化逐格提示词。
 * @param {{silent?: boolean}} opts silent=true（全自动调用）：不弹提示，失败直接抛出，
 *   让调用方的日志写「失败」而不是一律写「已优化」（以前内部吞掉错误，日志永远报成功）
 */
async function runAiPrompts({ silent = false } = {}) {
  if (!state.tpl) { if (silent) throw new Error('还没有版式'); toast('先选一套版式'); return null; }
  const plot = $('#plot').value.trim();
  saveLlm();
  const btn = $('#btnAiPrompts');
  const restore = busyLabel(btn);
  setBusy(btn, true);
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
      llm: state.llm,
    });
    if (!res.ok) {
      const err = Object.assign(new Error(res.error || res.code || '优化失败'), { code: res.code, hint: res.hint });
      throw err;
    }
    if (state.aiPlan && state.aiPlan.template?.id === state.tpl.id) state.aiPlan = res.plan;
    else state.plan = { pages: [{ pageIndex: 1, segment: plot, analysis: null, templateScore: null, plan: res.plan }] };
    renderScript();
    renderSlotPanel();
    $('#scriptHint').textContent = `${state.tpl.name} · ${res.applied}/${res.total} 格已 AI 优化${res.globalNotes ? ' · ' + res.globalNotes : ''}`;
    if (!silent) toast(`AI 优化完成：${res.applied}/${res.total} 格`);
    return res;
  } catch (e) {
    if (silent) throw e;
    toast(`优化失败：${e.code || e.message}`);
    if (e.hint) $('#scriptHint').textContent = `${e.message} · ${e.hint}`;
    return null;
  } finally {
    setBusy(btn, false);
    restore();
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
    // 纯粹版：不要「建议出图」那一列和下面的提示词（那些是给生图模型用的）
    PURE ? '| 格 | 景别 | 形状 | 叙事节拍 | 画幅 |' : '| 格 | 景别 | 形状 | 叙事节拍 | 画幅 | 建议出图 |',
    PURE ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- | --- | --- |',
    ...page.panels.map((p) => `| ${p.order} | ${tr(p.roleZh)} | ${tr(p.shape?.zh || '常规格')} | ${tr(p.beat || '通用镜头')} | ${p.aspectLabel} |${PURE ? '' : ` ${p.genSize} |`}`),
    '',
    '## 逐格分镜',
    ...page.panels.map((p) => [
      '',
      `### ${p.order}. ${tr(p.roleZh)} · ${tr(p.shape?.zh || '常规格')} · ${tr(p.beat || '通用镜头')}`,
      p.content ? `- 画面：${p.content}` : `- 构图：${p.beatHint}`,
      ...(PURE && p.content && compHint(p) ? [`- 构图：${compHint(p)}`] : []),
      `- 台词：${(state.lines[p.id] ?? p.dialogue) ? '「' + (state.lines[p.id] ?? p.dialogue) + '」' : '无'}`,
      ...(PURE ? [] : [
        `- 形状开头词：\`${p.shape?.prefixEn || ''}\``,
        `- 提示词：\`${effectivePrompt(p.id).prompt}\``,
        `- 精简版：\`${p.promptShort || ''}\``,
        `- 负面词：\`${p.negative}\``,
      ]),
    ].join('\n')),
    '',
    state.bubbles.length ? `## 气泡（${state.bubbles.length} 个）` : '',
    ...state.bubbles.map((b) => `- ${tr(BUBBLES[b.type]?.zh || b.type)}｜${b.text ? '「' + b.text + '」' : tr('（空）')}｜不透明度 ${Math.round((b.opacity ?? 1) * 100)}%`),
    '',
  ].filter((x) => x !== undefined);
  // 复制出去的表也跟着界面语言（中文界面 tr 原样返回）
  return lines.map((l) => tr(l)).join('\n');
}

/* ================================================================== *
 * 导出
 * ================================================================== */
/** 导出用的整页 SVG（图片传进来的必须是 data URL，SVG 当 <img> 加载时读不到 blob:） */
function stageSVG({ withImages = true, numbers = false, images = null, tpl = state.tpl, bubbles = state.bubbles } = {}) {
  return renderTemplateSVG(tpl, {
    width: state.exportWidth,
    images: withImages ? (images || state.images) : {},
    overlays: bubbles,
    showNumbers: numbers,
    showRoles: false,
    slotOutline: state.outlineExport,
    selectedId: null,
    hoverId: null,
    selectedBubbleId: null,
  });
}

/** SVG 字符串 → PNG Blob（白底；图片必须已经是 data URL，见 exportImageMap） */
async function rasterizeSVG(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImgEl(url).catch(() => { throw new Error('SVG 栅格化失败（图片可能跨域）'); });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('浏览器没能生成 PNG（尺寸太大？）');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportPNG() {
  if (!state.tpl) return;
  try {
    const w = state.exportWidth;
    const h = Math.round((w * state.tpl.page.h) / state.tpl.page.w);
    const png = await rasterizeSVG(stageSVG({ images: await exportImageMap() }), w, h);
    await exportBlob(png, `${state.tpl.id}-${w}px.png`);
    toast(`已导出 PNG ${w}×${h}`);
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
  // 一览页点进来、点「回到编辑器」都要回到当前这个版本（纯粹版的人不该被带回 AI 版）
  if (sheet && (PURE || ARTIST)) sheet.href = './sheet.html?ed=' + (PURE ? 'pure' : 'painter');
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
  if (force ?? !el.open) openModal(el); else closeModal(el);
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

  const html = ids.map((id) => {
    const on = sel && sel.type === id;
    const best = matched && matched.type === id;
    return `
    <button type="button" class="bub-item${on ? ' on' : ''}${best ? ' best' : ''}" data-id="${id}" draggable="true"
         title="${escapeHtml(BUBBLES[id]?.hintZh || '')}${best ? ' · ' + escapeHtml(matched.why) : ''}">
      ${bubbleThumb(id, 92)}
      <span>${escapeHtml(BUBBLES[id]?.zh || id)}${best ? ' · 配这段字' : ''}</span>
    </button>`;
  }).join('');
  // 内容没变就不碰 DOM：renderBubbles 在每次选格、每次改字时都会被叫到，
  // 以前每次都重建 8 个缩略图 SVG、重新绑监听、整排重放浮现动画
  if (grid._html !== html) {
    grid._html = html;
    grid.innerHTML = html;
    const key = state.bubTab + ':' + ids.join(',');
    if (grid.dataset.key !== key) { grid.dataset.key = key; staggerIn(grid, '.bub-item'); }
  }
  if (!grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', (ev) => {
      const el = ev.target.closest('.bub-item');
      if (!el) return;
      // 已经选中一个气泡时，点下面的样式 = 换样式（不新建）
      if (selectedBubble()) { setBubbleType(el.dataset.id); return; }
      addBubble(el.dataset.id);
    });
  }

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
  store.setJSON(KEYS.bubUse, state.bubUse);
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
  setRange($('#bubOpacity'), Math.round((b.opacity ?? 1) * 100));
  const sc = Math.round(((b.w / (b.baseW || b.w)) || 1) * 100);
  $('#sizeVal').textContent = sc + '%';
  setRange($('#bubSize'), clamp(sc, 40, 220));
  $('#rotVal').textContent = (b.rot || 0) + '°';
  setRange($('#bubRot'), b.rot || 0);
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
  store.setJSON(KEYS.bubUse, state.bubUse);
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

function loadLines(tplId) {
  state.lines = store.json(KEYS.lines(tplId), {});
}

function saveLines() {
  if (!state.tpl) return;
  store.setJSON(KEYS.lines(state.tpl.id), state.lines);
}

function currentLine() {
  const manual = state.lines[state.selectedId];
  if (manual != null) return manual;
  return currentPlanPanel()?.dialogue || '';
}

/* ================================================================== *
 * 外观层：主题 / 平台快捷键 / 手机视图 / 滑块填充 / 静态版链接
 * ================================================================== */

function initChrome() {
  initAppearance();
  initSegIndicators();
  initRanges();
  initPlatformKeys();
  initMoreMenu();
  initViews();
  initStaticLinks();
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
  if (!STATIC) return;
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

/* 模块共享的核心能力（见 ctx.mjs：功能模块从这里取，不直接 import app.js，免得成环） */
Object.assign(app, {
  queueSave, renderStage, renderSlotPanel, renderBubbles, renderScript, renderCands, refreshScript, refreshSlotImage,
  savePage, switchPage, addPage, selectTemplate, fetchTemplate, pagePlan, candsOf, applyCand, applyCandAndEdit,
  slotAt, pagePoint, putImage, generateSlotImage, aiWriteLines, runAiPrompts, exportPNG, syncZoomSlider, toggleShortcuts,
  addBubble, selectedBubble, duplicateBubble, deleteBubble,
  activateTab, currentPlanPanel, activeCharPayload, toast,
  /** 换语言：动态生成的块用当前语言重建 */
  rebuildLocalized() {
    renderList({ rebuild: true }); renderSlotPanel(); renderScript(); renderBubbles(); renderPageTabs(); renderCands(); renderChars();
  },
});

init().catch((e) => {
  console.error(e);
  window.__pfLastInitError = String((e && e.stack) || e);   // 出问题时方便在控制台一眼看到
  toast('初始化失败：' + e.message);
});
