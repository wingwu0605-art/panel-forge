/**
 * 动效：全部走 Web Animations API（element.animate）。
 *
 * 以前的套路是「删类 → 读一次 offsetWidth 强制同步布局 → 再加类」来重放 CSS 关键帧，
 * 再用 setTimeout 估摸着动画什么时候结束去摘类 / 改状态。问题：
 *   · 每次重放都是一次同步布局（手机上就是那一下「弹一下」）
 *   · 定时器和真实动画时长对不上就会闪、会冲掉别的状态（比如底栏提示）
 *   · 同一元素连续触发会叠加
 * 现在：动画是对象，可取消、可等待（`await anim.finished`），同名动画自动替换，
 * 尊重「减弱动态效果」（系统设置或外观面板里的开关）。
 *
 * 曲线从 CSS 令牌读（--ease / --spring / --spring-soft），所以每套风格可以有自己的动效性格
 * （灵动可爱回弹更多、高级简约不回弹），JS 和 CSS 永远是同一组数。
 */
const sysReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

export function motionOK() {
  return !sysReduce.matches && document.documentElement.dataset.motion !== 'reduced';
}

/* ------------------------------------------------------------------ 曲线 */
const FALLBACK = {
  ease: 'cubic-bezier(.32,.72,0,1)',
  spring: 'cubic-bezier(.34,1.3,.64,1)',
  'spring-soft': 'cubic-bezier(.22,1.08,.36,1)',
  in: 'cubic-bezier(.4,0,1,1)',
};
let curveCache = null;
/** 换风格时 theme.mjs 会派发 pf:style，曲线跟着重读 */
window.addEventListener('pf:style', () => { curveCache = null; });

export function curve(name = 'ease') {
  if (name.includes('(')) return name;            // 直接给了曲线
  if (!curveCache) curveCache = {};
  if (!(name in curveCache)) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); } catch { /* ignore */ }
    curveCache[name] = v || FALLBACK[name] || FALLBACK.ease;
  }
  return curveCache[name];
}

/**
 * 播一段动画。减弱动效时返回 null（调用方照常往下走，只是没有过程）。
 * @param {Element} el
 * @param {Keyframe[]} keyframes
 * @param {{duration?:number, easing?:string, delay?:number, fill?:FillMode, id?:string}} o
 *   id：同一个元素上同 id 的旧动画会被取消（连续点击不会叠加）
 */
export function play(el, keyframes, { duration = 300, easing = 'ease', delay = 0, fill = 'none', id = '' } = {}) {
  if (!el?.animate || !motionOK()) return null;
  if (id) for (const a of el.getAnimations?.() || []) if (a.id === id) a.cancel();
  let anim;
  try {
    anim = el.animate(keyframes, { duration, easing: curve(easing), delay, fill });
  } catch {
    // 老浏览器不认 linear() 曲线：退回贝塞尔
    anim = el.animate(keyframes, { duration, easing: FALLBACK[easing] || FALLBACK.ease, delay, fill });
  }
  if (id) anim.id = id;
  return anim;
}

/** 等一段动画放完（没有动画 / 被取消都立刻返回，不会挂住） */
export const settled = (anim) => (anim ? anim.finished.then(() => true, () => false) : Promise.resolve(false));

/* ------------------------------------------------------------------ 常用动效 */
export const fx = {
  /** 徽标 / 小块：弹一下 */
  pop: (el) => play(el, [{ transform: 'scale(.6)', opacity: 0.4 }, { transform: 'none', opacity: 1 }],
    { duration: 520, easing: 'spring', id: 'pop' }),
  /** 内容浮上来 */
  rise: (el, delay = 0) => play(el, [{ opacity: 0, transform: 'translateY(8px) scale(.985)' }, { opacity: 1, transform: 'none' }],
    { duration: 460, easing: 'spring-soft', delay, fill: 'backwards', id: 'rise' }),
  /** 换模板：页面从景深里浮上来（只动 opacity / transform —— 以前还带 blur，整页滤镜每帧重绘很贵） */
  pageIn: (el) => play(el, [{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'none' }],
    { duration: 620, easing: 'spring-soft', id: 'pageIn' }),
  /** 标签栏图标点中时跳一下 */
  bounce: (el) => play(el, [
    { transform: 'scale(1)' }, { transform: 'scale(.82)', offset: 0.3 }, { transform: 'scale(1.1)', offset: 0.65 }, { transform: 'scale(1)' },
  ], { duration: 520, easing: 'spring-soft', id: 'bounce' }),
  /** 浮层弹入（id 对外可读：测试据此确认「打开」和「切换」是两段不同的动画） */
  popIn: (el, id = 'popIn') => play(el, [
    { opacity: 0, transform: 'translateY(10px) scale(.97)' },
    { opacity: 1, transform: 'translateY(-1px) scale(1.004)', offset: 0.6 },
    { opacity: 1, transform: 'none' },
  ], { duration: 360, easing: 'ease', id }),
  swapIn: (el, id = 'swapIn') => play(el, [
    { opacity: 0.3, transform: 'translateY(6px) scale(.985)' }, { opacity: 1, transform: 'none' },
  ], { duration: 280, easing: 'ease', id }),
  fadeOut: (el, id = 'fadeOut') => play(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }],
    { duration: 150, easing: 'in', fill: 'forwards', id }),
};

/**
 * 列表依次浮现。只在「内容真的换了」时调用（以前每次重渲染都整排重放，
 * 气泡库每敲一个字就闪一次）。
 */
export function staggerIn(container, selector, { cap = 12, step = 26 } = {}) {
  if (!container || !motionOK()) return;
  container.querySelectorAll(selector).forEach((el, i) => fx.rise(el, Math.min(i, cap) * step));
}

/**
 * View Transitions 包一层：截图 → 改 DOM → 交叉淡变（合成层完成，不逐帧重排）。
 * 不支持或要求减弱动效时直接执行 fn。kind 写进 html[data-vt]，CSS 按它选过渡样式。
 */
export function withTransition(kind, fn) {
  if (!document.startViewTransition || !motionOK()) { fn(); return null; }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  // 上一个过渡还没放完又来一个：浏览器会跳过旧的，旧的 ready 以 AbortError 拒绝 —— 这是正常情况，不是错误
  t.ready.catch(() => {});
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
  return t;
}

/**
 * 折叠 / 展开：只切状态，过程交给 CSS（grid-template-rows 0fr ↔ 1fr + 透明度）。
 * 不用 JS 量高度、不需要动画结束回调；被打断也不会卡在半截。
 * instant：首屏恢复记忆状态时用，不要过程。
 */
export function setFold(container, open, { instant = false } = {}) {
  if (!container) return;
  if (instant) container.classList.add('fold-instant');
  container.classList.toggle('collapsed', !open);
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => container.classList.remove('fold-instant')));
}
