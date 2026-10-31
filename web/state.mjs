/**
 * 全局状态与撤销栈。
 *
 * 从 app.js 里抽出来的：state 是唯一的可变状态对象（搬出来只是换个文件，
 * 对象引用不变，所以所有 state.xxx 的读写照旧），history 只依赖 state。
 *
 * 为什么值得单独一个文件：以前它埋在 7000 行的 app.js 中间，
 * 谁也说不清"到底有哪些状态"，新增字段容易重复或漏改。
 */
/** 撤销/重做会重绘界面并弹提示，这两件事属于 app.js，用注入而不是反向 import */
const ui = {
  renderStage: () => {},
  renderSlotPanel: () => {},
  renderBubbles: () => {},
  toast: () => {},
};
export function installHistoryDeps(next) { Object.assign(ui, next); }

export const state = {
  items: [],          // 轻量模板列表
  filtered: [],
  cultureTab: 'all',
  tpl: null,          // 完整模板（可能已被改过画幅）
  tplBase: null,      // 原始模板（画幅重排的推导基准，永远不动）
  pageSize: null,     // 本页自定义画幅 {w,h,mode}；null = 跟随模板
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
  styleFollow: 'char',  // 生图参考谁：char 人设图 / sample 样图 / both 都参考 / none 都不跟
  samples: [],          // 样图（风格参考），可多张
  clipboard: null,    // 内部剪贴板（图片或气泡）
  promptSrc: {},      // 每格提示词来源：rule（规则切分）/ ai（AI 生成）/ mine（自己写）
  promptPrefix: {},   // 每格是否把「形状开头词」放在提示词最前面（默认 true）
  libFilter: null,    // 模板库的标签筛选 {kind:'panels'|'intent'|'ratio'|'tag', value}
  intentZh: {},       // 戏路 id → 中文（从 /api/meta 来）
  history: { past: [], future: [] },
};

/* ---------- 撤销 / 重做 ---------- */
export const HIST_MAX = 60;

export function snapshot() {
  return {
    images: Object.fromEntries(Object.entries(state.images).map(([k, v]) => [k, { ...v }])),
    bubbles: state.bubbles.map((b) => ({ ...b })),
    lines: { ...state.lines },
    promptEdits: JSON.parse(JSON.stringify(state.promptEdits || {})),
    selectedId: state.selectedId,
    selBubble: state.selBubble,
  };
}

export function restore(snap) {
  state.images = Object.fromEntries(Object.entries(snap.images).map(([k, v]) => [k, { ...v }]));
  state.bubbles = snap.bubbles.map((b) => ({ ...b }));
  state.lines = { ...snap.lines };
  state.promptEdits = JSON.parse(JSON.stringify(snap.promptEdits || {}));
  state.selectedId = snap.selectedId;
  state.selBubble = snap.selBubble;
  ui.renderStage();
  ui.renderSlotPanel();
  ui.renderBubbles();
}

/** 在改动之前调用：把当前状态压进历史 */
export function commit() {
  if (!state.tpl) return;
  state.history.past.push(snapshot());
  if (state.history.past.length > HIST_MAX) state.history.past.shift();
  state.history.future.length = 0;
}

export function undo() {
  if (!state.history.past.length) { ui.toast('没有可撤销的操作'); return; }
  state.history.future.push(snapshot());
  restore(state.history.past.pop());
  ui.toast('已撤销');
}

export function redo() {
  if (!state.history.future.length) { ui.toast('没有可重做的操作'); return; }
  state.history.past.push(snapshot());
  restore(state.history.future.pop());
  ui.toast('已重做');
}

export function resetHistory() {
  state.history = { past: [], future: [] };
}
