/**
 * 界面小件：提示条、复制、分段控件的滑块、滑杆填充、折叠卡片、平台快捷键文字、顶栏「更多」菜单。
 * 这些都不碰业务状态，谁都能用。
 */
import { $, $$ } from './util.mjs';
import { IS_MAC, params } from './env.mjs';
import { store, KEYS } from './storage.mjs';
import { setFold } from './motion.mjs';

/* ------------------------------------------------------------------ 提示条 */
let toastTimer = 0;
/**
 * 底部（手机在顶部）的提示条。停留时间按字数算：短句 2 秒，长句最多 6 秒
 * （以前一律 2.2 秒，长的报错还没读完就没了）。
 */
/**
 * 按钮进入 / 退出「正在处理」：disabled 挡重复点击，aria-busy 给读屏和样式用
 * （只有忙的按钮才扫光；单纯禁用的按钮只是变灰）。
 */
export function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = !!on;
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

export function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  const text = String(msg ?? '');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), Math.min(6000, 1800 + text.length * 45));
}

export function copyText(text, msg) {
  if (!text) return;
  const done = () => toast(msg || '已复制');
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    done();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, legacy);
  else legacy();
}

/* ------------------------------------------------------------------ 分段控件：滑动的选中底 */
const segRO = window.ResizeObserver ? new ResizeObserver((es) => es.forEach((e) => placeInd(e.target))) : null;

/** 给页面上所有 .seg（含右栏标签 #tabs）加一块会滑动的选中底；新出现的分段控件再调一次即可 */
export function initSegIndicators(root = document) {
  for (const g of root.querySelectorAll('.seg')) {
    if (g.querySelector(':scope > .seg-ind')) continue;
    const ind = document.createElement('span');
    ind.className = 'seg-ind';
    ind.setAttribute('aria-hidden', 'true');
    g.prepend(ind);
    g.classList.add('has-ind');
    placeInd(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('ready')));
    // .on 由各自的点击逻辑切换，这里只负责跟着挪（只看按钮自己的变化，不看容器上的 pressing/ready）
    new MutationObserver((recs) => { if (recs.some((r) => r.target !== g)) placeInd(g); })
      .observe(g, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    g.addEventListener('pointerdown', (ev) => { if (ev.target.closest('button')) g.classList.add('pressing'); });
    const up = () => g.classList.remove('pressing');
    g.addEventListener('pointerup', up);
    g.addEventListener('pointerleave', up);
    g.addEventListener('pointercancel', up);
    segRO?.observe(g);
  }
}

export function placeInd(g) {
  const ind = g.querySelector(':scope > .seg-ind');
  if (!ind) return;
  const on = g.querySelector(':scope > button.on, :scope > button[aria-selected="true"]');
  if (!on || !on.offsetWidth) { ind.style.opacity = on ? '' : '0'; return; }
  ind.style.opacity = '';
  ind.style.setProperty('--x', on.offsetLeft + 'px');
  ind.style.setProperty('--w', on.offsetWidth + 'px');
}

/* ------------------------------------------------------------------ 滑杆：已选部分着色 */
/** 用 --p 画出 iOS 那种「已选部分是主色」的轨道 */
export function paintRange(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const p = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', p.toFixed(2) + '%');
}

/**
 * 代码里改滑杆的值请走这里（会顺手重画轨道）。
 * 以前是改写了全局 HTMLInputElement.prototype.value 的 setter —— 页面上每一个输入框的
 * 每一次赋值都要多走一层判断，还会让任何第三方代码看到被篡改的原型。
 */
export function setRange(el, v) {
  if (!el) return;
  el.value = String(v);
  paintRange(el);
}

export function initRanges() {
  $$('input[type=range]').forEach(paintRange);
  document.addEventListener('input', (ev) => { if (ev.target?.type === 'range') paintRange(ev.target); });
}

/* ------------------------------------------------------------------ 折叠卡片 */
/**
 * [data-collapse] 的卡片 / 气泡库：点标题行任意处收起，只留标题；状态记在本机。
 * 头部之后的兄弟节点统一包进 .card-body > .card-body-inner（CSS 用 grid 0fr↔1fr 做高度过渡）。
 * ?collapse=ai,browse 可指定初始收起（分享「专注模式」链接用，不影响记住的状态）。
 */
export function initCollapsibles() {
  let saved = store.json(KEYS.fold);
  if (!saved || typeof saved !== 'object') {
    // 迁移：老版本把折叠状态写在 pf.ui.v1（是 JSON 对象才是折叠记录；字符串是当年的界面风格）
    const old = store.json(KEYS.legacyUi);
    saved = old && typeof old === 'object' ? old : {};
  }
  const persist = () => store.setJSON(KEYS.fold, saved);
  const force = (params.get('collapse') || '').split(',').filter(Boolean);
  // 默认收起的卡片（用户改过就以记录为准）：模板库内容多、日常最占地方
  const DEFAULT_CLOSED = ['browse'];

  for (const el of $$('[data-collapse]')) {
    const key = el.dataset.collapse;
    const initialOpen = typeof saved[key] === 'boolean'
      ? saved[key] : (!DEFAULT_CLOSED.includes(key) && !force.includes(key));

    if (el.tagName === 'DETAILS') {      // 原生 <details>（「怎么用」）
      el.open = initialOpen;
      el.addEventListener('toggle', () => { saved[key] = el.open; persist(); });
      continue;
    }
    const head = el.querySelector(':scope > .card-head, :scope > .bub-head');
    if (!head) continue;

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
    caret.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    head.appendChild(caret);

    const apply = (open, save = true) => {
      setFold(el, open, { instant: !save });
      caret.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (save) { saved[key] = open; persist(); }
    };
    apply(initialOpen, false);
    // 点标题行任意处都能折叠；标题里的按钮 / 输入框不触发
    head.addEventListener('click', (ev) => {
      const hit = ev.target.closest('button, input, select, textarea, a');
      if (hit && !hit.classList.contains('caret')) return;
      apply(el.classList.contains('collapsed'));
    });
  }
}

/* ------------------------------------------------------------------ 平台快捷键文字 */
const MAC_KEYS = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', del: '⌫' };
const PC_KEYS = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: '⇧', enter: '⏎', del: 'Del' };

/**
 * 快捷键提示按平台显示：Mac 是 ⌘ ⌥ ⇧，其它平台是 Ctrl / Alt。
 * 按钮上的组合键写成 <kbd data-keys="mod shift enter">（以前两个按钮都被写死成「Ctrl ⏎」，
 * 「让 AI 排戏」真正的组合键 Ctrl+Shift+Enter 被显示成了规则匹配那个）。
 */
export function initPlatformKeys() {
  const map = IS_MAC ? MAC_KEYS : PC_KEYS;
  for (const k of $$('kbd[data-keys]')) {
    k.textContent = k.dataset.keys.split(/\s+/).map((x) => map[x] || x).join(IS_MAC ? '' : ' ');
  }
  if (!IS_MAC) return;
  const plain = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Del: '⌫' };
  $$('#shortcuts kbd:not([data-keys])').forEach((k) => { if (plain[k.textContent]) k.textContent = plain[k.textContent]; });
  $$('.help li').forEach((li) => { li.innerHTML = li.innerHTML.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥ '); });
  const note = $('.sc-note');
  if (note) note.textContent = note.textContent.replace('带 Ctrl 的组合键', '带 ⌘ 的组合键');
}

/* ------------------------------------------------------------------ 顶栏「更多」（窄屏） */
export function initMoreMenu() {
  const btn = $('#btnMore');
  const menu = $('#topActions');
  if (!btn || !menu) return;
  const set = (open) => { menu.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); set(!menu.classList.contains('open')); });
  document.addEventListener('click', (ev) => { if (!menu.contains(ev.target)) set(false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') set(false); });
  menu.addEventListener('click', () => set(false));
}
