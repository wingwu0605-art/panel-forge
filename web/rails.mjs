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

const RAIL_PREFIX = 'pf.rail.';
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

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const FRESH = (() => {
  try { return new URLSearchParams(location.search).get('fresh') === '1'; } catch { return false; }
})();

const store = {
  get(k) {
    if (FRESH) return null;                 // 自动化测试要干净的初始状态
    try { return localStorage.getItem(RAIL_PREFIX + k); } catch { return null; }
  },
  set(k, v) {
    if (FRESH) return;
    try { localStorage.setItem(RAIL_PREFIX + k, v); } catch { /* ignore */ }
  },
};

/** 一条侧栏的实例 */
function makeRail(railEl, side, itemsFn) {
  if (!railEl) return null;
  const st = {
    el: railEl,
    side,
    mini: store.get(side) === 'mini',
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

  const closePop = () => {
    restore();
    pop.classList.add('hidden');
    $$('.rail-ico', strip).forEach((b) => b.classList.remove('on'));
    st.openKey = null;
  };

  const openPop = (key) => {
    if (st.openKey === key) { closePop(); return; }
    // 同时只留一个功能气泡：先把其它侧栏的关掉（键盘/脚本触发 click 时也要成立）
    for (const other of RAILS) if (other !== st) other.closePop();

    const swap = !!st.openKey && !pop.classList.contains('hidden');
    closePop();
    const item = st.itemsFn().find((i) => i.key === key);
    if (!item || !item.node) return;
    st.moved = { node: item.node, parent: item.node.parentNode, next: item.node.nextSibling };
    $('.rail-pop-body', pop).appendChild(item.node);
    $('.rail-pop-head b', pop).textContent = item.label;

    // 切换功能：内容换掉后重新播一次"弹入"，并给内容一个从上滑入的小非线性动画
    pop.classList.remove('hidden');
    pop.classList.remove('swap-in', 'pop-in');
    void pop.offsetWidth;
    pop.classList.add(swap ? 'swap-in' : 'pop-in');
    const bodyEl = $('.rail-pop-body', pop);
    bodyEl.classList.remove('content-in');
    void bodyEl.offsetWidth;
    bodyEl.classList.add('content-in');
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
   * 收起 / 展开。
   * 性能要点：列宽切换是**布局变更**，一帧内完成即可；绝不能给 grid-template-columns 加过渡，
   * 否则每帧都要重排卡片里的文字（真实窗口里就是严重卡顿）。
   * 为了不让那一次布局抖动被看见，先给内容盖一层"挡板"（opacity:0，无过渡），
   * 下一帧再落布局，再下一帧淡回来 —— 抖动发生在不可见的帧里。
   */
  const applyMini = (mini, opts = {}) => {
    if (COMPACT_MQ.matches) mini = false;   // 窄屏强制展开
    st.mini = mini;

    const commit = () => {
      railEl.classList.toggle('mini', mini);
      document.body.classList.toggle(side === 'left' ? 'rail-left-mini' : 'rail-right-mini', mini);
      if (mini) rebuild();
      else closePop();
      if (!opts.silent) store.set(side, mini ? 'mini' : 'open');
    };

    // 首次装配（silent）不需要挡板，直接落位
    if (opts.silent) { commit(); return; }

    document.body.classList.add('rail-hide');   // 挡板：opacity:0 且无过渡
    requestAnimationFrame(() => {
      commit();                                  // 布局只在这里发生一次
      requestAnimationFrame(() => document.body.classList.remove('rail-hide'));
    });
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
    if (ev.target.closest('.rail-pop-close')) closePop();
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!st.openKey) return;
    if (pop.contains(ev.target) || strip.contains(ev.target) || toggle.contains(ev.target)) return;
    closePop();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(); });
  window.addEventListener('resize', () => { if (st.openKey) closePop(); });

  applyMini(st.mini, { silent: true });
  // 从宽窗缩到窄窗：立刻退出收起态，避免"只剩一列图标"
  const onMQ = () => applyMini(st.mini, { silent: true });
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
