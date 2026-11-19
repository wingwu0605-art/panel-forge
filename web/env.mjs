/**
 * 运行环境：URL 参数、入口模式、平台。全站只算一次，谁要谁 import。
 * （以前 app.js / rails.mjs / util.mjs 各自 new URLSearchParams(location.search) 一遍）
 */
export const params = new URLSearchParams(location.search);

/** ?dbg=1：底栏换成一行调试状态 */
export const DBG = params.get('dbg') === '1';
/** ?fresh=1：不恢复草稿、不读记忆的侧栏状态（自动化测试要干净的初始状态） */
export const FRESH = params.get('fresh') === '1';
/** 静态托管版（GitHub Pages）：规则引擎在浏览器里跑，没有服务端路由 */
export const STATIC = window.PF_STATIC === true;

/**
 * 画师版入口：`?mode=artist`，或构建时注入 `window.PF_PAINTER`（site/painter.html）。
 * 同一份源码产出两个网页：AI 版（index.html）和画师版（painter.html，AI 界面全部收起）。
 */
export const ARTIST = window.PF_PAINTER === true || params.get('mode') === 'artist';

/**
 * 原生壳（Capacitor / WebView）。壳里的性能预算不同：backdrop-filter 很贵、弹簧动效更容易掉帧，
 * 所以壳里走更省的性能档（styles.css 的 body[data-shell]），并开启分享出口。
 * 优先级：?shell= 参数 → Capacitor 平台 → UA 标记。
 */
export const SHELL = (() => {
  const q = params.get('shell');
  if (q) return q;
  try {
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.()) return cap.getPlatform?.() || 'native';
  } catch { /* ignore */ }
  return /PanelForgeShell/i.test(navigator.userAgent || '') ? 'android' : '';
})();

export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

export const REPO_URL = 'https://github.com/wingwu0605-art/panel-forge';

/** 版本号：唯一真源是仓库根的 VERSION，构建时写进 <meta name="app-version">（scripts/set-version.mjs） */
export const VERSION = document.querySelector('meta[name="app-version"]')?.content || '0.0.0';
