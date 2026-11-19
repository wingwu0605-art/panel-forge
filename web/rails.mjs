/**
 * 左右侧栏的「收回成图标条」交互。
 *
 * 规则（按用户描述）：
 *   · 每张卡片留一个自己的 logo，收回后只剩这一列图标
 *   · 单击某个 logo → 只弹出这一个功能的气泡面板（不是全部）
 *   · 只有点右上角那个「展开全部」按钮，才把整条侧栏展开
 *   · 悬停时线条/颜色有动效，并冒出一个写着功能名的小气泡
 *
 * 实现要点：
 *   面板不复制，而是**把原来的卡片节点搬进气泡**——这样所有既有的事件绑定、
 *   渲染函数查到的还是同一批节点，不会出现"气泡里的按钮不灵"。
 *   关闭时按记住的父节点/兄弟节点原位放回。
 */

import { $, $$ } from './util.mjs';
import { FRESH } from './env.mjs';
import { fx, play, settled, staggerIn, motionOK } from './motion.mjs';
import { store, KEYS } from './storage.mjs';

// 紧凑布局（手机 / 窄窗）走的是单列 + 底部 tabbar，侧栏收起会与「按视图隐藏区块」打架：
// 结果是左栏只剩一列图标、画布和右栏全被隐藏（真出现过这个 bug）。所以窄屏一律不收起。
const COMPACT_MQ = (() => { try { return window.matchMedia('(max-width:1024px)'); } catch { return { matches: false, addEventListener() {} }; } })();
const RAILS = [];   // 已安装的侧栏（开气泡时把别人的关掉）

/** 每个功能一个 logo：24 网格，stroke 用 currentColor */
const ICONS = {
  auto: '<path d="M13 2.6 5.2 13.4h5.1l-1.1 8 7.8-10.8h-5.1l1.1-8Z"/>',
  style: '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.4 0 2.2-.9 2.2-2 0-.8-.4-1.3-.4-2 0-1 .8-1.7 2-1.7h1.6c2 0 3.4-1.4 3.4-3.3C20.8 6.8 17 3.2 12 3.2Z"/><circle cx="8" cy="9.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="9.4" r="1.2" fill="currentColor" stroke="none"/>',
  plot: '<path d="M3 6h11"/><path d="M3 12h8"/><path d="M3 18h11"/><path d="M17 8.5 21 12l-4 3.5"/>',
  ai: '<rect x="3" y="9" width="14" height="10" rx="2"/><path d="M3 9 5.6 4.6h4L8 9"/><path d="M11 9l2.6-4.4h4L16 9"/><path d="M17 12.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1 1-2.2Z"/>',
  chars: '<circle cx="9.5" cy="8" r="3.2"/><path d="M3.4 19.4c.9-3.4 3.2-5.4 6.1-5.4s5.2 2 6.1 5.4"/><circle cx="17.5" cy="7" r="2.2"/><path d="M15.6 12.4c2.2.3 3.7 1.9 4.3 4.2"/>',
  browse: '<rect x="3" y="3" width="7.4" height="7.4" rx="1.6"/><rect x="13.6" y="3" width="7.4" height="7.4" rx="1.6"/><rect x="3" y="13.6" width="7.4" height="7.4" rx="1.6"/><rect x="13.6" y="13.6" width="7.4" height="7.4" rx="1.6"/>',
  help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.5-1.2 1.1-1.2 2"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  text: '<path d="M4 6.5h16"/><path d="M4 12h10.5"/><path d="M4 17.5h7"/><circle cx="17.5" cy="16.4" r="3.4"/>',
  board: '<rect x="2.6" y="6.6" width="12.4" height="10.8" rx="2"/><path d="M15 11l5.4-3.2v8.4L15 13"/><path d="M6 10.4h5.6"/>',
  image: '<rect x="3" y="4.4" width="18" height="15.2" rx="2"/><circle cx="8.4" cy="9.6" r="1.6"/><path d="M4 17.2l5-4.8 4 3.8 3-2.8 4 3.8"/>',
  script: '<path d="M4 6h16"/><path d="M4 11.2h16"/><path d="M4 16.4h10.5"/>',
  export: '<path d="M12 3.4v10.8"/><path d="M8 10.6l4 4 4-4"/><path d="M4 19.4h16"/>',
  bubbles: '<path d="M3.6 6.8h12.2v8.4H8.6L5 18.2v-3H3.6Z"/><path d="M18.4 9.6h2v8.2h-1.4v2.6l-3.2-2.6h-5.4v-2"/>',
  more: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
};

function iconSvg(key) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] || ICONS.more}</svg>`;
}

// 侧栏收起状态（?fresh=1 时不读也不写：自动化测试要干净的初始状态）
const railStore = {
  get: (side) => (FRESH ? null : store.get(KEYS.rail(side))),
  set: (side, v) => { if (!FRESH) store.set(KEYS.rail(side), v); },
};

/** 一条侧栏的实例 */
function makeRail(railEl, side, itemsFn) {
  if (!railEl) return null;
  const st = {
    el: railEl,
    side,
    mini: railStore.get(side) === 'mini',
    openKey: null,
    moved: null,      // { node, parent, next }
    itemsFn,
    strip: null,
    pop: null,
  };

  /* ---- 顶部按钮：展开全部 / 收起 ---- */
  // 独立标题条：按钮放在这里，就不会压住右栏的「格子 / 分镜表 / 导出」
  const head = document.createElement('div');
  head.className = 'rail-head';
  railEl.insertBefore(head, railEl.firstChild);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'rail-toggle';
  toggle.title = '收起 / 展开全部功能';
  toggle.setAttribute('aria-label', '收起或展开全部功能');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9 4.8v14.4"/></svg>';
  head.appendChild(toggle);

  /* ---- 图标条 ---- */
  const strip = document.createElement('div');
  strip.className = 'rail-strip';
  railEl.appendChild(strip);
  st.strip = strip;

  const rebuild = () => {
    const items = st.itemsFn();
    strip.innerHTML = items.map((it) => `
      <button type="button" class="rail-ico" data-key="${it.key}" data-label="${it.label}"
        title="${it.label}" ${it.disabled ? 'disabled' : ''} aria-label="${it.label}">
        ${iconSvg(it.icon || it.key)}
        <span class="rail-tip">${it.label}</span>
      </button>`).join('');
  };

  /* ---- 气泡面板 ---- */
  const pop = document.createElement('div');
  pop.className = 'rail-pop hidden';
  pop.innerHTML = '<div class="rail-pop-head"><b></b><button type="button" class="rail-pop-close" aria-label="关闭">×</button></div><div class="rail-pop-body"></div>';
  document.body.appendChild(pop);
  st.pop = pop;

  const restore = () => {
    if (!st.moved) return;
    const { node, parent, next } = st.moved;
    if (next && next.parentNode === parent) parent.insertBefore(node, next);
    else parent.appendChild(node);
    st.moved = null;
  };

  /** 关掉气泡。animate：用户主动关（点外面 / Esc / ×）时淡出一下；切换功能时立刻关 */
  const closePop = ({ animate = false } = {}) => {
    $$('.rail-ico', strip).forEach((b) => b.classList.remove('on'));
    st.openKey = null;
    const done = () => { restore(); pop.classList.add('hidden'); };
    const out = animate && !pop.classList.contains('hidden') ? fx.fadeOut(pop, 'railPopOut') : null;
    if (!out) { pop.getAnimations().forEach((a) => a.cancel()); done(); return; }
    // 淡出期间又打开了别的功能：openPop 会先 closePop()（立刻关），这里的收尾就不再执行
    settled(out).then((finished) => { if (finished && st.openKey === null) { out.cancel(); done(); } });
  };

  const openPop = (key) => {
    if (st.openKey === key) { closePop({ animate: true }); return; }
    // 同时只留一个功能气泡：先把其它侧栏的关掉（键盘/脚本触发 click 时也要成立）
    for (const other of RAILS) if (other !== st) other.closePop();

    const swap = !!st.openKey && !pop.classList.contains('hidden');
    closePop();
    const item = st.itemsFn().find((i) => i.key === key);
    if (!item || !item.node) return;
    st.moved = { node: item.node, parent: item.node.parentNode, next: item.node.nextSibling };
    $('.rail-pop-body', pop).appendChild(item.node);
    $('.rail-pop-head b', pop).textContent = item.label;

    // 打开 = 带一点过冲的弹入；切换功能 = 轻一些的淡入，内容再从下面滑上来一点
    // （Web Animations：以前是摘类 → 读 offsetWidth 强制同步布局 → 再加类，来重放 CSS 动画）
    pop.classList.remove('hidden');
    if (swap) fx.swapIn(pop, 'railPopSwap'); else fx.popIn(pop, 'railPopIn');
    play($('.rail-pop-body', pop), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 300, easing: 'spring-soft', id: 'railContentIn' });
    // 位置：贴着侧栏那一侧
    const r = railEl.getBoundingClientRect();
    const pw = Math.min(360, window.innerWidth * 0.86);
    pop.style.width = pw + 'px';
    pop.style.maxHeight = Math.min(window.innerHeight - 32, 720) + 'px';
    const left = side === 'left' ? Math.min(r.right + 10, window.innerWidth - pw - 10) : Math.max(10, r.left - pw - 10);
    pop.style.left = left + 'px';
    const topBar = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    pop.style.top = Math.max(topBar + 8, Math.min(r.top + 8, window.innerHeight - 240)) + 'px';
    $$('.rail-ico', strip).forEach((b) => b.classList.toggle('on', b.dataset.key === key));
    st.openKey = key;
  };

  /* ---- 迷你 / 展开 ---- */
  /**
   * 收起 / 展开：整条侧栏当抽屉滑进 / 滑出（弹簧曲线），舞台跟着列宽一起伸缩。
   *
   * 列宽用 Web Animations 从「屏幕上现在的样子」插到目标值（中途再点一次也是从当前位置接着走）；
   * 动画期间栏里每一块的宽度钉死在展开态、整块平移，所以逐帧排版的只有舞台，
   * 卡片里的文字不会逐帧重排 —— 以前就是怕这个，才改成「一帧落定 + 挡板淡出 / 整页交叉淡变」，
   * 结果点一下整个界面都闪一下。
   */
  const SLIDE_MS = 560;
  const contentKids = () => [...railEl.children].filter((el) => !el.classList.contains('rail-strip'));
  let slideToken = null;

  /** 收尾：放开钉死的宽度，收起的那一侧换成图标条（reveal：图标依次冒出来） */
  const finishSlide = ({ reveal = true } = {}) => {
    slideToken = null;
    for (const el of contentKids()) {
      el.getAnimations().forEach((a) => { if (a.id === 'railSlide') a.cancel(); });
      el.style.width = '';
      el.style.flexShrink = '';
    }
    const closing = railEl.classList.contains('rail-closing');
    railEl.classList.remove('rail-anim', 'rail-closing');
    if (closing && reveal) staggerIn(strip, '.rail-ico', { cap: 8, step: 22 });
  };

  const slide = (from, kids, widths) => {
    const layout = railEl.parentElement;
    const to = getComputedStyle(layout).gridTemplateColumns;   // 类已经换好：这里排一次版拿到目标列宽
    const col = (cols) => parseFloat(String(cols).split(' ')[side === 'left' ? 0 : 2]) || 0;
    const c0 = col(from);
    const c1 = col(to);
    if (Math.abs(c0 - c1) < 1 || from.split(' ').length !== to.split(' ').length) { finishSlide(); return; }
    const wide = Math.max(c0, c1);              // 展开态的列宽
    const dir = side === 'left' ? -1 : 1;       // 左栏往左收，右栏往右收
    const off = (c) => `translateX(${dir * (wide - c)}px)`;   // 内容外缘始终贴着列的边
    const ws = widths || kids.map((el) => el.getBoundingClientRect().width);
    kids.forEach((el, i) => {
      if (!ws[i]) return;
      el.style.width = ws[i] + 'px';
      el.style.flexShrink = '0';
    });
    railEl.classList.add('rail-anim');
    const timing = { duration: SLIDE_MS, easing: 'spring-soft' };
    // 两条侧栏共用一个列宽动画：后点的那条从当前画面接管，两边都走到目标
    play(layout, [{ gridTemplateColumns: from }, { gridTemplateColumns: to }], { ...timing, id: 'railCols' });
    const anims = kids.filter((el, i) => ws[i]).map((el) =>
      play(el, [{ transform: off(c0) }, { transform: off(c1) }], { ...timing, id: 'railSlide' }));
    const token = {};
    slideToken = token;
    Promise.all(anims.map((a) => settled(a))).then(() => { if (slideToken === token) finishSlide(); });
  };

  const applyMini = (mini, opts = {}) => {
    if (COMPACT_MQ.matches) mini = false;   // 窄屏强制展开
    st.mini = mini;
    const animate = !opts.silent && motionOK() && !COMPACT_MQ.matches && railEl.parentElement;
    // 先读「屏幕上现在的样子」（动画进行中读到的就是动画当前帧），再收掉上一次没放完的
    const from = animate ? getComputedStyle(railEl.parentElement).gridTemplateColumns : '';
    const kids = animate && mini ? contentKids() : [];
    const widths = kids.map((el) => el.getBoundingClientRect().width);
    finishSlide({ reveal: false });

    railEl.classList.toggle('mini', mini);
    railEl.classList.toggle('rail-closing', !!(animate && mini));   // 收起动画期间保持展开态的样子
    document.body.classList.toggle(side === 'left' ? 'rail-left-mini' : 'rail-right-mini', mini);
    if (mini) rebuild();
    else closePop();
    if (!opts.silent) railStore.set(side, mini ? 'mini' : 'open');
    if (animate) slide(from, mini ? kids : contentKids(), mini ? widths : null);
  };

  toggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // 点这个按钮 = 展开全部（如果已经在展开态，则收回成图标）
    applyMini(!st.mini);
  });

  strip.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.rail-ico');
    if (!btn || btn.disabled) return;
    openPop(btn.dataset.key);
  });

  pop.addEventListener('click', (ev) => {
    if (ev.target.closest('.rail-pop-close')) closePop({ animate: true });
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!st.openKey) return;
    if (pop.contains(ev.target) || strip.contains(ev.target) || toggle.contains(ev.target)) return;
    closePop({ animate: true });
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && st.openKey) closePop({ animate: true }); });
  window.addEventListener('resize', () => { if (st.openKey) closePop(); });

  applyMini(st.mini, { silent: true });
  // 从宽窗缩到窄窗：立刻退出收起态，避免"只剩一列图标"
  // 跨过手机断点：窄屏强制展开，回到宽屏按记住的偏好恢复（以前回来就丢了「收起」）
  const onMQ = () => applyMini(railStore.get(side) === 'mini', { silent: true });
  if (COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener('change', onMQ);
  else if (COMPACT_MQ.addListener) COMPACT_MQ.addListener(onMQ);
  st.rebuild = rebuild;
  st.closePop = closePop;
  RAILS.push(st);
  return st;
}

/** 左栏：每张 .card 一个 logo */
function leftItems(railEl) {
  return $$(':scope > .card', railEl)
    .filter((c) => c.dataset.panel)
    .map((c) => ({
      key: c.dataset.panel,
      label: c.dataset.panelName || c.dataset.panel,
      icon: c.dataset.panel,
      node: c,
    }));
}

/** 右栏：四段（说什么/分镜/图片/AI）+ 分镜表 + 导出 */
function rightItems(railEl) {
  const out = [];
  $$('#slotPanel .slot-sec').forEach((sec) => {
    const key = sec.dataset.sec;
    const label = $('.sec-head > span', sec)?.textContent?.trim() || key;
    out.push({ key, label, icon: key, node: sec });
  });
  const scriptTab = $('#tabScript');
  if (scriptTab) out.push({ key: 'script', label: '分镜表', icon: 'script', node: scriptTab });
  const exportTab = $('#tabExport');
  if (exportTab) out.push({ key: 'export', label: '导出', icon: 'export', node: exportTab });
  const dock = $('#bubbleDock');
  if (dock) out.push({ key: 'bubbles', label: '气泡', icon: 'bubbles', node: dock });
  return out;
}

export function installRails() {
  const left = $('.rail.left');
  const right = $('#railRight');
  const rails = [];
  if (left) rails.push(makeRail(left, 'left', () => leftItems(left)));
  if (right) rails.push(makeRail(right, 'right', () => rightItems(right)));
  // 暴露给测试/调试
  window.__pfRails = () => rails.map((r) => ({
    side: r.side, mini: r.mini, open: r.openKey,
    icons: $$('.rail-ico', r.strip).map((b) => b.dataset.key),
  }));
  window.__pfRailToggle = (side) => {
    const r = rails.find((x) => x.side === side);
    if (!r) return null;
    $(r.el ? '.rail-toggle' : 'body')?.click?.();
    return window.__pfRails();
  };
  return rails;
}
