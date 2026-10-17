/**
 * app.js — PanelForge 分镜坊 前端
 * 零框架；渲染内核与后端共用同一份 /lib/svg.mjs，保证「所见即导出」。
 */
import { renderTemplateSVG } from './lib/svg.mjs';
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
    aiDecide: (body) => postJSON('/api/ai/decide', body),
    prompts: (body) => postJSON('/api/ai/prompts', body),
    llmStatus: () => getJSON('/api/llm/status'),
    llmTest: (body) => postJSON('/api/llm/test', body),
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
  bubTab: 'rec',      // rec | fav
  bubUse: {},         // 气泡使用次数（常用排序）
  engine: null,
  hollow: false,
  showLabels: true,
  exportWidth: 1600,
  outlineExport: true,
  analysis: null,
  plot: '',
  clipboard: null,    // 内部剪贴板（图片或气泡）
  history: { past: [], future: [] },
};

const CULTURE_LABEL = { jp: '日', cn: '中', kr: '韩', core: '通' };
const CULTURE_ZH = { jp: '日式页漫', cn: '中式漫画', kr: '韩式条漫', core: '通用/跨界' };

/* 外观层常量（init() 在顶层就跑，所以必须放在这里，不能放文件末尾） */
const REPO_URL = 'https://github.com/wingwu0605-art/panel-forge';
const THEME_KEY = 'pf.theme';
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const compactMQ = window.matchMedia('(max-width:1024px)');

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.4a6.6 6.6 0 0 1 0 13.2Z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.4 12.6A7 7 0 0 1 7.4 3.6a7 7 0 1 0 9 9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const THEME_NAME = { auto: '跟随系统', light: '浅色', dark: '深色' };

/* ================================================================== *
 * 启动
 * ================================================================== */
init().catch((e) => {
  console.error(e);
  toast('初始化失败：' + e.message);
});

async function init() {
  initChrome();
  bindUI();
  initCollapsibles();
  api = await makeApi();
  adaptTopLinksForStatic();
  const meta = await api.meta();
  const list = await api.templates();
  state.items = list.items;
  state.filtered = list.items;
  state.engine = meta.engine || null;
  $('#statTpl').textContent = `${meta.templates} 套模板 · ${meta.roles.length} 种格型`;
  $('#statPort').textContent = window.PF_STATIC ? '静态版 · 离线可用' : location.host;
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
  if (params.get('keyselftest') === '1') await runKeySelfTest();
  if (params.get('aiselftest') === '1') await runAiSelfTest();
  if (params.get('shortcuts') === '1') toggleShortcuts(true);
  if (params.get('tab')) activateTab(params.get('tab'));
  if (params.get('plot')) {
    $('#plot').value = params.get('plot');
    await runMatch();
  }
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
    selectedId: state.selectedId,
    selBubble: state.selBubble,
  };
}

function restore(snap) {
  state.images = Object.fromEntries(Object.entries(snap.images).map(([k, v]) => [k, { ...v }]));
  state.bubbles = snap.bubbles.map((b) => ({ ...b }));
  state.lines = { ...snap.lines };
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
      [...el.children].filter((c) => c !== head).forEach((c) => body.appendChild(c));
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
      el.classList.toggle('collapsed', !open);
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
function renderList() {
  const q = ($('#search').value || '').trim().toLowerCase();
  let list = state.items;
  if (state.cultureTab !== 'all') list = list.filter((t) => t.culture === state.cultureTab);
  if (q) {
    list = list.filter((t) =>
      (t.id + t.name + t.desc + t.tags.join('') + t.intents.join('')).toLowerCase().includes(q));
  }
  state.filtered = list;
  $('#listCount').textContent = `${list.length} 套`;

  const frag = document.createDocumentFragment();
  for (const t of list) {
    const el = document.createElement('div');
    el.className = 'tpl' + (state.tpl && state.tpl.id === t.id ? ' on' : '');
    el.dataset.id = t.id;
    el.innerHTML = `
      <div class="th">${renderTemplateSVG({ ...t, slots: t.thumbSlots }, { width: 220, showEmptyTint: false, slotOutline: true })}</div>
      <div class="nm">${escapeHtml(t.name)}</div>
      <div class="mt">
        <span>${t.panels}格</span><span>·</span><span>${ratioName(t.ratio)}</span><span>·</span><span>${CULTURE_LABEL[t.culture]}</span>
      </div>
      <span class="bd">${t.panels}</span>
      <span class="cul">${CULTURE_LABEL[t.culture]}</span>`;
    el.addEventListener('click', () => { selectTemplate(t.id); goCanvasOnCompact(); });
    frag.appendChild(el);
  }
  const grid = $('#tplGrid');
  grid.innerHTML = '';
  grid.appendChild(frag);
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
  if (state.aiPlan && state.aiPlan.template?.id !== tpl.id) { state.aiPlan = null; state.aiDecision = null; }
  state.bubbles = [];
  state.selBubble = null;
  resetHistory();
  loadLines(tpl.id);
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
function renderStage() {
  if (!state.tpl) return;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const tpl = state.tpl;
    const svg = renderTemplateSVG(tpl, {
      width: 1200,
      images: state.hollow ? {} : state.images,
      selectedId: state.hollow ? null : state.selectedId,
      hoverId: state.hoverId,
      showNumbers: state.showLabels,
      showRoles: state.showLabels,
      slotOutline: true,
      overlays: state.bubbles,
      selectedBubbleId: state.selBubble,
      uiAccent: '#007aff',
    });
    const holder = $('#canvas');
    holder.innerHTML = svg;
    const el = holder.querySelector('svg');
    if (el) el.addEventListener('dblclick', onCanvasDblClick);
    // 镂空模式要说清楚：图片是故意藏起来，不是丢了
    const foot = $('#footMsg');
    if (foot) {
      foot.textContent = state.hollow
        ? '镂空模式：只显示格线，图片被隐藏 —— 关掉「镂空」就能看到图片'
        : '拖图片进画布即可填充（自动裁切到格子形状，斜切格也不会变形）';
      $('#stageFoot')?.classList.toggle('warn', state.hollow);
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
      renderStage();
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
      renderStage();
    }
  });

  const endDrag = (ev) => {
    if (!drag) return;
    if (drag.bubble) {
      if (!drag.moved) renderBubbleInspector();
      drag = null;
      return;
    }
    if (!drag.moved) {
      if (drag.slot) { state.selectedId = drag.slot.id; state.selBubble = null; renderStage(); renderSlotPanel(); renderBubbles(); }
      else { state.selectedId = null; state.selBubble = null; renderStage(); renderSlotPanel(); }
    } else if (drag.slot) {
      renderSlotPanel();
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; });
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
    if (state.selectedId !== slot.id) { state.selectedId = slot.id; renderSlotPanel(); }
    syncZoomSlider();
    renderStage();
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
  $('#btnRemoveImage').addEventListener('click', () => {
    if (!state.selectedId) return;
    commit();
    delete state.images[state.selectedId];
    renderStage(); renderSlotPanel(); toast('已移除');
  });
  $('#btnUrl').addEventListener('click', importByUrl);
  $('#zoom').addEventListener('input', (ev) => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commitThrottled(600);
    img.zoom = Number(ev.target.value) / 100;
    $('#zoomVal').textContent = ev.target.value + '%';
    renderStage();
  });
  $('#btnFitMode').addEventListener('click', () => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commit();
    img.mode = img.mode === 'contain' ? 'cover' : 'contain';
    renderSlotPanel(); renderStage();
    toast(img.mode === 'contain' ? '完整显示（可留白）' : '填满格子（裁切）');
  });
  $('#btnResetPan').addEventListener('click', () => {
    const img = state.images[state.selectedId];
    if (!img) return;
    commit();
    img.panX = 0; img.panY = 0; img.zoom = 1;
    syncZoomSlider(); renderStage(); toast('已复位');
  });
  $('#btnCopyPrompt').addEventListener('click', () => {
    const p = currentPlanPanel();
    if (p) copyText(p.promptEn, '提示词已复制');
  });
  $('#btnCopyShape').addEventListener('click', copyShapePrefix);
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
  });
  $('#btnBubbleFromLine').addEventListener('click', () => {
    const text = currentLine().trim();
    addBubble(text ? 'talk-ellipse' : 'narration-box', { text });
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
  $('#filePick').dataset.mode = 'slot';
  $('#filePick').click();
}

function activateTab(tab) {
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
async function putImage(slotId, file, opts = {}) {
  if (!opts.noCommit) commit();
  const href = await fileToDataURL(file);
  const dim = await imageSize(href);
  state.images[slotId] = {
    href, iw: dim.w, ih: dim.h, zoom: 1, panX: 0, panY: 0, mode: 'cover', name: file.name || 'image',
  };
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
    let href = url.trim();
    if (/^https?:\/\//.test(href)) {
      href = await blobToDataURL(await api.proxyImage(href));
    }
    const dim = await imageSize(href);
    commit();
    state.images[state.selectedId] = { href, iw: dim.w, ih: dim.h, zoom: 1, panX: 0, panY: 0, mode: 'cover', name: 'url' };
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

  $('#slotIndex').textContent = slot.order;
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
    ...(panel?.content ? [['画面', panel.content]] : []),
    ...(panel?.dialogue ? [['台词', '「' + panel.dialogue + '」']] : []),
    ['构图提示', panel ? (panel.beatHint || panel.composition || '—') : '—'],
  ].map(([k, v]) => `<b>${k}</b><span>${escapeHtml(String(v))}</span>`).join('');

  $('#slotPrompt').textContent = panel ? panel.promptEn : '（先在左侧输入剧情并点「按规则匹配」，可获得贴合这一格的提示词）';

  // 形状开头词（不依赖 AI，永远可用）
  const shape = panel?.shape || slot.shape || null;
  $('#shapeName').textContent = shape ? shape.zh : '—';
  $('#shapePrefix').textContent = shape?.prefixEn || '—';
  $('#shapeTip').innerHTML = shape
    ? `粘到你自己的提示词<b>最前面</b>，构图就会适配这个形状。${escapeHtml(shape.hintZh || '')}`
    : '粘到你自己的提示词<b>最前面</b>。';

  $('#zoom').value = Math.round((img?.zoom || 1) * 100);
  $('#zoomVal').textContent = Math.round((img?.zoom || 1) * 100) + '%';
  $('#btnFitMode').textContent = img?.mode === 'contain' ? '当前：完整显示' : '当前：填满裁切';

  // 本格句子（这一格要说什么）
  $('#lineBeat').textContent = panel ? (panel.beat || panel.roleZh) : (slot.role || '—');
  const saved = state.lines[slot.id];
  $('#slotLine').value = saved != null ? saved : (panel?.dialogue || '');
  $('#slotLine').placeholder = panel?.content
    ? `这一格：${panel.content.slice(0, 40)}…  ← 在这里写台词`
    : '这一格要说什么：台词 / 旁白 / 内心独白（会自动存到本机）';

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
      <div class="pr">${escapeHtml(p.promptEn)}</div>
      <div class="act">
        <button class="btn tiny" data-act="copy">复制提示词</button>
        <button class="btn tiny" data-act="prefix">复制形状词</button>
        <button class="btn tiny" data-act="fill">填入选中格</button>
      </div>
    </div>`).join('');

  $('#scriptList').querySelectorAll('.sc-card').forEach((card) => {
    const p = panels.find((x) => x.id === card.dataset.id);
    card.addEventListener('click', (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'copy') copyText(p.promptEn, '该格提示词已复制');
      else if (act === 'prefix') copyText(p.shape?.prefixEn || '', '形状开头词已复制');
      else if (act === 'fill') { state.selectedId = p.id; renderStage(); renderSlotPanel(); toast('已选中第 ' + p.order + ' 格'); }
      else { state.selectedId = p.id; renderStage(); renderSlotPanel(); }
    });
  });
}

/* ================================================================== *
 * AI 提示词优化
 * ================================================================== */
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
      `- 提示词：\`${p.promptEn}\``,
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
function stageSVG({ withImages = true, numbers = false } = {}) {
  return renderTemplateSVG(state.tpl, {
    width: state.exportWidth,
    images: withImages ? state.images : {},
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
    const svg = stageSVG();
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

function exportSVG() {
  if (!state.tpl) return;
  downloadText(stageSVG(), `${state.tpl.id}.svg`, 'image/svg+xml');
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
  initRanges();
  initPlatformKeys();
  initMoreMenu();
  initViews();
  initStaticLinks();
}

function initTheme() {
  const btn = $('#btnTheme');
  if (!btn) return;
  let mode = 'auto';
  try { mode = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* ignore */ }
  const apply = (m, announce) => {
    mode = m;
    if (m === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = m;
    btn.innerHTML = THEME_ICONS[m];
    btn.title = '外观：' + THEME_NAME[m] + '（点击切换）';
    // 状态栏 / 浏览器顶部颜色跟着走
    for (const meta of $$('meta[name="theme-color"]')) {
      const sysDark = meta.media.includes('dark');
      const dark = m === 'auto' ? sysDark : m === 'dark';
      meta.content = dark ? '#000000' : '#f2f2f7';
    }
    try { if (m === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, m); } catch { /* ignore */ }
    if (announce) toast('外观：' + THEME_NAME[m]);
  };
  apply(mode, false);
  btn.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    apply(order[(order.indexOf(mode) + 1) % order.length], true);
  });
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

/** 手机 / 平板竖屏：底部标签栏切换「模板库 / 剧情匹配 / 画布 / 格子与导出」 */
function setView(view) {
  if (!view) return;
  document.body.dataset.view = view;
  $$('#tabbar button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (view === 'canvas') renderStage();
}
function goCanvasOnCompact() { if (compactMQ.matches) setView('canvas'); }

function initViews() {
  $$('#tabbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btnEditSlot')?.addEventListener('click', () => { setView('inspect'); activateTab('slot'); });
  const want = new URLSearchParams(location.search).get('view');
  setView(['library', 'story', 'canvas', 'inspect'].includes(want) ? want : 'canvas');
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
