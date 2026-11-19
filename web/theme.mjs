/**
 * 外观：明暗（自动 / 浅色 / 深色）× 风格（经典 / 液态玻璃 / 高级简约 / 灵动可爱）× 强调色，外加语言与减弱动效。
 *
 * 以前「界面风格（经典 / 液态玻璃）」和「皮肤（经典 / 灵动可爱 / 高级简约）」是两条独立开关，
 * 叠出 6 种组合，其中好几种从没设计过（圆角、动效、按钮形状互相覆盖），
 * 而且在可爱 / 简约下点强调色完全没反应（皮肤的主色写死盖住了强调色）。
 * 现在只有一条「风格」轴：每套风格完整定义亮 / 暗两态，强调色在所有风格下都生效
 * （选「跟随风格」就用这套风格自己的主色）。
 *
 * 状态都写在 <html> 上，CSS 只看这几个属性（index.html 的启动脚本在样式表加载前就写好，不会闪）：
 *   data-scheme = light | dark      实际生效的明暗（「自动」时由系统决定）
 *   data-theme  = light | dark      用户手动选的（自动时不写）
 *   data-style  = glass | minimal | cute（经典不写）
 *   data-accent = blue | indigo | …（跟随风格时不写）
 *   data-motion = reduced
 */
import { $, $$ } from './util.mjs';
import { params, VERSION } from './env.mjs';
import { store, KEYS } from './storage.mjs';
import { withTransition } from './motion.mjs';
import { setLang as setI18nLang, getLang } from './i18n.mjs';
import { app } from './ctx.mjs';

export const STYLES = [
  { id: 'classic', zh: '经典' },
  { id: 'glass', zh: '液态玻璃' },
  { id: 'minimal', zh: '高级简约' },
  { id: 'cute', zh: '灵动可爱' },
];

/** 强调色。default = 跟随当前风格自己的主色；l / d 是色板上小圆点的颜色（真正的取值在 styles.css） */
export const ACCENTS = [
  { id: 'default', zh: '跟随风格' },
  { id: 'blue', zh: '蓝色', l: '#0066cc', d: '#0a84ff' },
  { id: 'indigo', zh: '靛蓝', l: '#5856d6', d: '#7d7aff' },
  { id: 'purple', zh: '紫色', l: '#9b3fc8', d: '#bf5af2' },
  { id: 'pink', zh: '粉色', l: '#d1124a', d: '#ff6482' },
  { id: 'red', zh: '红色', l: '#d70015', d: '#ff6961' },
  { id: 'orange', zh: '橙色', l: '#b84a00', d: '#ff9f0a' },
  { id: 'yellow', zh: '黄色', l: '#8a6300', d: '#ffd60a' },
  { id: 'green', zh: '绿色', l: '#1d7a35', d: '#30d158' },
  { id: 'teal', zh: '青色', l: '#00728a', d: '#40c8e0' },
  { id: 'graphite', zh: '石墨', l: '#515154', d: '#98989d' },
];

const THEME_ICONS = {
  auto: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.4a6.6 6.6 0 0 1 0 13.2Z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.4 12.6A7 7 0 0 1 7.4 3.6a7 7 0 1 0 9 9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const LANG_LABEL = { zh: '中文', en: 'English', id: 'Bahasa Indonesia' };

const root = document.documentElement;
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');

/* ------------------------------------------------------------------ 画布用的主色 */
let tintCache = '';
/**
 * 当前强调色（画布里的选中框 / 格号跟着变）。读一次计算样式就缓存，换外观时清掉 ——
 * 以前每次整页重绘都 getComputedStyle 一遍。
 */
export function currentTint() {
  if (!tintCache) {
    const v = getComputedStyle(root).getPropertyValue('--tint').trim();
    tintCache = /^#|^rgb|^hsl|^color|^oklch/.test(v) ? v : '#0066cc';
  }
  return tintCache;
}

let booting = true;
/** 外观变了：清缓存、通知动效曲线重读、重画画布（启动时三项一起套用，只在最后算一次） */
function changed() {
  tintCache = '';
  if (booting) return;
  window.dispatchEvent(new Event('pf:style'));
  app.renderStage?.();
}

/* ------------------------------------------------------------------ 明暗 */
const schemeOf = (mode) => (mode === 'dark' || (mode === 'auto' && sysDark.matches) ? 'dark' : 'light');

function syncThemeColor() {
  // 状态栏颜色跟着页面底色走（取计算后的 --bg，风格换了也对）
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const meta of $$('meta[name="theme-color"]')) {
    meta.removeAttribute('media');
    if (bg) meta.content = bg;
  }
}

/* ------------------------------------------------------------------ 风格：读取 + 旧版迁移 */
/** 记住的风格；第一次用新版时从两个旧 key 迁移（皮肤优先，其次液态玻璃） */
function savedStyle() {
  const v = store.get(KEYS.style);
  if (STYLES.some((s) => s.id === v)) return v;
  const skin = store.get(KEYS.legacySkin);
  const legacy = skin === 'cute' || skin === 'minimal' ? skin : (store.get(KEYS.legacyUi) === 'ios26' ? 'glass' : 'classic');
  if (legacy !== 'classic') store.set(KEYS.style, legacy);
  store.set(KEYS.legacySkin, null);
  if (store.get(KEYS.legacyUi) === 'ios26') store.set(KEYS.legacyUi, null);
  return legacy;
}
/** 链接上的 ?style=（或旧的 ?ui=ios26）只是预览：不写进偏好（以前打开一次分享链接就把你的风格永久改掉了） */
const urlStyle = () => {
  const q = params.get('style') || (params.get('ui') === 'ios26' ? 'glass' : '');
  return STYLES.some((s) => s.id === q) ? q : '';
};

/* ------------------------------------------------------------------ 外观面板 */
export function initAppearance() {
  const btn = $('#btnTheme');
  const pop = $('#appearancePop');
  if (!btn || !pop) return;

  let mode = store.get(KEYS.theme) || 'auto';
  if (!['auto', 'light', 'dark'].includes(mode)) mode = 'auto';
  let style = urlStyle() || savedStyle();
  let accent = store.get(KEYS.accent) || 'default';
  if (!ACCENTS.some((a) => a.id === accent)) accent = 'default';

  const applyMode = (m, persist = true) => {
    mode = m;
    if (m === 'auto') delete root.dataset.theme; else root.dataset.theme = m;
    root.dataset.scheme = schemeOf(m);
    btn.innerHTML = THEME_ICONS[m];
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (persist) store.set(KEYS.theme, m === 'auto' ? null : m);
    syncThemeColor();
    changed();
  };
  const applyStyle = (id, persist = true) => {
    style = STYLES.some((s) => s.id === id) ? id : 'classic';
    if (style === 'classic') delete root.dataset.style; else root.dataset.style = style;
    $('#styleName').textContent = STYLES.find((s) => s.id === style).zh;
    $$('#uiStyleSeg button').forEach((b) => b.classList.toggle('on', b.dataset.style === style));
    if (persist) store.set(KEYS.style, style === 'classic' ? null : style);
    syncThemeColor();
    changed();
  };
  const applyAccent = (a, persist = true) => {
    accent = a;
    if (a === 'default') delete root.dataset.accent; else root.dataset.accent = a;
    $('#accentName').textContent = ACCENTS.find((x) => x.id === a)?.zh || '';
    $$('#swatches .swatch').forEach((sw) => {
      const on = sw.dataset.a === a;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (persist) store.set(KEYS.accent, a === 'default' ? null : a);
    changed();
  };

  // 色板：第一个是「跟随风格」（小圆点画的是当前风格自己的主色，CSS 里 --style-tint）
  const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 2.9 2.9 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const sw = $('#swatches');
  sw.setAttribute('role', 'radiogroup');
  sw.innerHTML = ACCENTS.map((a) => `<button type="button" class="swatch${a.id === 'default' ? ' swatch-default' : ''}" role="radio"
      data-a="${a.id}" title="${a.zh}" aria-label="${a.zh}"${a.l ? ` style="--sw-l:${a.l};--sw-d:${a.d}"` : ''}>${check}</button>`).join('');
  sw.addEventListener('click', (ev) => {
    const b = ev.target.closest('.swatch');
    if (b && b.dataset.a !== accent) withTransition('accent', () => applyAccent(b.dataset.a));
  });

  // 明暗：从点击位置圆形扩散（看起来没变的切换就不做扩散，比如 自动→浅色）
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', (ev) => {
    const m = b.dataset.mode;
    if (m === mode) return;
    if (schemeOf(m) === root.dataset.scheme) { applyMode(m); return; }
    const t = withTransition('theme', () => applyMode(m));
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

  $$('#uiStyleSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.style !== style) withTransition('style', () => applyStyle(b.dataset.style));
  }));

  // 语言：中文（源语言）/ English / Bahasa Indonesia
  const rebuildAll = () => app.rebuildLocalized?.();
  const syncLang = () => {
    const id = getLang();
    $('#langName').textContent = LANG_LABEL[id] || id;
    const tb = $('#btnLang');
    if (tb) {
      tb.textContent = LANG_LABEL[id] || id;   // 按钮上就是当前语言本身（不是地球图标 / 国旗）
      tb.setAttribute('aria-expanded', pop.classList.contains('open') ? 'true' : 'false');
    }
    $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === id));
  };
  const switchLang = (lang) => {
    // 动态块（模板库 / 右栏 / 气泡 / 页签）用中文原文重建一遍，i18n 的观察器会把新节点翻掉
    setI18nLang('zh');
    rebuildAll();
    const id = setI18nLang(lang);
    rebuildAll();
    store.set(KEYS.lang, id === 'zh' ? null : id);
    syncLang();
  };
  $$('#langSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang !== getLang()) switchLang(b.dataset.lang);
  }));
  // 另一个标签页改了语言：跟着变（storage 事件只在「别的」标签页触发）
  addEventListener('storage', (ev) => {
    if (ev.key !== KEYS.lang && ev.key !== null) return;
    const want = store.get(KEYS.lang) || 'zh';
    if (want !== getLang()) switchLang(want);
  });

  // 减弱动态效果
  const chk = $('#chkReduceMotion');
  chk.checked = root.dataset.motion === 'reduced';
  chk.addEventListener('change', () => {
    if (chk.checked) root.dataset.motion = 'reduced'; else delete root.dataset.motion;
    store.set(KEYS.motion, chk.checked ? 'reduced' : null);
  });

  // 版本号：唯一真源是仓库根 VERSION
  const verEl = $('#appVersion');
  if (verEl) verEl.textContent = `PanelForge v${VERSION}`;
  window.__pfVersion = () => VERSION;

  // 开关面板（外观按钮 / 顶栏语言按钮都能打开）
  const open = (on) => {
    pop.classList.toggle('open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    syncLang();
  };
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); open(!pop.classList.contains('open')); });
  $('#btnLang')?.addEventListener('click', (ev) => { ev.stopPropagation(); open(!pop.classList.contains('open')); });
  document.addEventListener('click', (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) open(false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && pop.classList.contains('open')) open(false); }, true);

  sysDark.addEventListener?.('change', () => { if (mode === 'auto') applyMode('auto', false); });
  applyMode(mode, false);
  applyStyle(style, false);
  applyAccent(accent, false);
  booting = false;
  syncLang();
  window.__pfLook = () => ({ mode, scheme: root.dataset.scheme, style, accent });
}
