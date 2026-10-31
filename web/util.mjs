/**
 * 通用工具：DOM 查询、转义、防抖、超时、Blob 转换、动效开关、性能打点。
 *
 * 从 app.js 里抽出来的第一批：这些函数不碰业务状态（state），
 * 谁都能用、也不需要知道分镜怎么渲染，放独立模块最安全。
 */
/* ---------- dom ---------- */
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- perf ---------- */
export const PERF = new URLSearchParams(location.search).get('perf') === '1';
export const perf = {
  frames: [], render: [], patch: [], save: [], paint: [], longtask: [],
  lastSaveBytes: 0, renders: 0, patches: 0, saves: 0,
};
export function perfPush(arr, v) { arr.push(v); if (arr.length > 90) arr.shift(); }
export function perfStats(arr) {
  if (!arr.length) return { avg: 0, p95: 0, max: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    avg: s.reduce((n, v) => n + v, 0) / s.length,
    p95: at(0.95), max: s[s.length - 1],
  };
}
/** 量一段代码耗时（只在 ?perf=1 下记录，别的地方调它不会变慢） */
export const perfNow = () => (PERF ? performance.now() : 0);
export const perfDone = (kind, t0) => {
  if (!PERF || !t0) return;
  perfPush(perf[kind], performance.now() - t0);
  if (kind === 'render') perf.renders++;
  if (kind === 'patch') perf.patches++;
};

/* ---------- timeout ---------- */
/**
 * 给一个 Promise 加超时。
 * 为什么要它：生图/写台词这类请求一旦挂住（服务商不返回、网络半死），
 * 按钮会永远停在"生成中"、格子永远显示"正在生成"，用户看到的就是"卡死了"。
 * 超时后抛错，流程照常走 catch/finally，状态才能真正复位。
 */
export function withTimeout(promise, ms, label = '请求') {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s 没有响应），已放弃`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ---------- blob ---------- */
export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

/* ---------- misc ---------- */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- sysReduce ---------- */
export const sysReduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- motionOK ---------- */
export function motionOK() {
  return !sysReduceMQ.matches && document.documentElement.dataset.motion !== 'reduced';
}

/* ---------- stagger/replay ---------- */
/** 列表依次浮现：给每个子元素一个序号 */
export function stagger(container, sel, cap = 14) {
  if (!container) return;
  container.querySelectorAll(sel).forEach((el, i) => el.style.setProperty('--i', Math.min(i, cap)));
}

/** 重新触发一个 CSS 动画类 */
export function replay(el, cls) {
  if (!el || !motionOK()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export /** 用 View Transitions 包一层；不支持或用户要求减弱动效时直接执行 */
function withTransition(kind, fn) {
  if (!document.startViewTransition || !motionOK()) { fn(); return null; }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
  return t;
}
