/**
 * build-static.mjs — 生成可纯静态托管的站点（GitHub Pages / 任意静态服务器）
 *
 * 产物：site/
 *   index.html  app.js  styles.css  api-static.js
 *   lib/*.mjs   （模板库 + 规则引擎 + 渲染器，全部在浏览器里跑）
 *   sheet.html  （138 套模板一览，静态版没有 /api/sheet 服务端路由，用这个替代）
 *
 * 静态版能做什么：浏览 138 套模板、镂空填充、拖图/粘贴、按规则匹配剧情、生成分镜表、
 *                导出 PNG/SVG/JSON，以及浏览器直连模型跑 AI 导演 —— 全部离线可用。
 * 静态版不能做什么：图片 URL 代理（需要服务端）。
 */
import { cp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TEMPLATES } from '../lib/library.mjs';
import { renderTemplateSVG } from '../lib/svg.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(path.join(site, 'lib'), { recursive: true });

for (const f of ['index.html', 'app.js', 'styles.css', 'api-static.js']) {
  await cp(path.join(root, 'web', f), path.join(site, f));
}
// 前端模块：web/ 下所有 .mjs 都要拷（写死清单漏过一次，线上 404 让整站起不来）
for (const f of await readdir(path.join(root, 'web'))) {
  if (f.endsWith('.mjs')) await cp(path.join(root, 'web', f), path.join(site, f));
}
// 目录整体拷贝（新增文件不用每次改白名单）：
//   vendor/  perfect-freehand（轻量笔用）
//   klecks/  外部绘画引擎的预构建产物（iframe 里跑）
for (const d of ['vendor', 'klecks', 'i18n']) {
  await cp(path.join(root, 'web', d), path.join(site, d), { recursive: true });
}
for (const f of await readdir(path.join(root, 'lib'))) {
  if (f.endsWith('.mjs')) await cp(path.join(root, 'lib', f), path.join(site, 'lib', f));
}

let html = await readFile(path.join(site, 'index.html'), 'utf8');
if (!html.includes('PF_STATIC')) {
  html = html.replace('</head>', '<script>window.PF_STATIC = true;</script>\n</head>');
}
// 按内容哈希给 CSS / JS 加版本号：内容一变链接就变，浏览器不会吃旧缓存（不用再手动改 ?v=）
let BUILD_V = '';
{
  const { createHash } = await import('node:crypto');
  const h = createHash('sha1');
  for (const f of await readdir(site)) {
  if (f.endsWith('.mjs') || ['app.js', 'styles.css', 'api-static.js'].includes(f)) {
    h.update(await readFile(path.join(site, f)));
  }
}
  for (const f of await readdir(path.join(site, 'lib'))) h.update(await readFile(path.join(site, 'lib', f)));
  // 语言包也算进去：只改了译文时版本号也要变，不然浏览器还用缓存里的旧词典
  for (const f of await readdir(path.join(site, 'i18n'))) h.update(await readFile(path.join(site, 'i18n', f)));
  const v = h.digest('hex').slice(0, 8);
  BUILD_V = v;
  html = html.replace(/(\.\/(?:styles\.css|app\.js))(\?v=[\w-]*)?(?=")/g, `$1?v=${v}`);

  // 模块之间的 import 也要带同一个版本号。
  // 只给入口加 ?v= 不够：GitHub Pages 让浏览器把每个文件缓存 10 分钟，发版后新的 app.js
  // 会 import 到缓存里旧的 assets.mjs，导出名对不上 → 整张模块图链接失败，页面一行脚本都不跑。
  // 所有相对路径的 import / import() 统一加 ?v=（同一个号，模块不会被加载成两份）。
  const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+?\.m?js)\2/g;
  const stamp = async (file) => {
    const src = await readFile(file, 'utf8');
    const out = src.replace(SPEC, (_, kw, q, spec) => `${kw}${q}${spec}?v=${v}${q}`);
    if (out !== src) await writeFile(file, out, 'utf8');
  };
  for (const f of await readdir(site)) if (/\.m?js$/.test(f)) await stamp(path.join(site, f));
  for (const f of await readdir(path.join(site, 'lib'))) if (f.endsWith('.mjs')) await stamp(path.join(site, 'lib', f));
  for (const f of await readdir(path.join(site, 'vendor'))) if (/\.m?js$/.test(f)) await stamp(path.join(site, 'vendor', f));

  // 自检：还有没带版本号的相对 import 就直接构建失败（CI 里会挡住发布）
  const LEFT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"?]+\.m?js)['"]/g;
  const missed = [];
  for (const dir of ['', 'lib', 'vendor', 'i18n']) {
    for (const f of await readdir(path.join(site, dir))) {
      if (!/\.m?js$/.test(f)) continue;
      const src = await readFile(path.join(site, dir, f), 'utf8');
      for (const m of src.matchAll(LEFT)) missed.push(`${dir ? dir + '/' : ''}${f} → ${m[1]}`);
    }
  }
  if (missed.length) {
    console.error('✗ 这些 import 没带版本号（发版后会和浏览器缓存里的旧文件混用）：\n  ' + missed.join('\n  '));
    process.exit(1);
  }
}
await writeFile(path.join(site, 'index.html'), html, 'utf8');

/* ---------------- 画师版入口：同一份源码、独立网页 ---------------- */
/* 和 index.html 唯一的区别是 pre-set 了 window.PF_PAINTER（AI 界面全部收起）。
   同一个源码库部署成三个 URL：/panel-forge/（AI 版）、painter.html（画师版）、pure.html（纯粹版）。 */
const entry = (flag, title) => {
  let page = html;
  if (page.includes('<script>window.PF_STATIC = true;</script>')) {
    page = page.replace('<script>window.PF_STATIC = true;</script>', `<script>window.PF_STATIC = true; ${flag}</script>`);
  } else {
    page = page.replace('</head>', `<script>window.PF_STATIC = true; ${flag}</script>\n</head>`);
  }
  return page.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
};
/** 纯粹版的页面简介：不提生图提示词 */
const pureMeta = (page) => page.replace(/<meta name="description" content="[^"]*">/,
  '<meta name="description" content="138 套中·日·韩漫画分镜模板：镂空填充编辑器、规则 / AI 分镜、逐格手绘。纯粹版，不含 AI 作画。">');
await writeFile(path.join(site, 'painter.html'), entry('window.PF_PAINTER = true;', 'PanelForge 画师版 · 分镜与绘制'), 'utf8');
/* ---------------- 纯粹版：没有 AI 作画、保留 AI 分镜（界面拿掉 + 生图接口锁死，见 web/env.mjs 的 PURE） ---------------- */
await writeFile(path.join(site, 'pure.html'),
  pureMeta(entry("window.PF_PURE = true; document.documentElement.dataset.pure = '1';", 'PanelForge 纯粹版 · 分镜与绘制')), 'utf8');
await writeFile(path.join(site, '.nojekyll'), '', 'utf8');

/* ---------------- 模板一览（替代服务端的 /api/sheet） ---------------- */
const GROUPS = { jp: '日式页漫', cn: '中式漫画', kr: '韩式条漫', core: '通用/跨界' };
const READ_ZH = { rtl: '右→左', ltr: '左→右', vertical: '上→下' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(t) {
  return `<figure data-id="${esc(t.id)}">
    <div class="svg">${renderTemplateSVG(t, { width: 240, showNumbers: true })}</div>
    <figcaption>
      <b>${esc(t.name)}</b>
      <span class="meta">${t.slots.length} 格 · ${t.ratio} · ${READ_ZH[t.reading] || t.reading} · ${esc(t.id)}</span>
    </figcaption>
  </figure>`;
}

function section(culture) {
  const list = TEMPLATES.filter((t) => t.culture === culture);
  if (!list.length) return '';
  return `<h2 id="${culture}">${GROUPS[culture] || culture} <em>${list.length} 套</em></h2>
    <div class="grid">${list.map(card).join('')}</div>`;
}

const sheetHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>全部模板一览 · PanelForge 分镜坊</title>
<style>
  :root{--bg:#f4f2ec;--ink:#1b1c1f;--dim:#7a776e;--line:#d8d4c9;--accent:#c8402c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,'Microsoft YaHei',sans-serif;padding:26px 30px 60px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px}
  h1{font-size:20px;margin:0}
  .sub{color:var(--dim);font-size:12px}
  a.back{margin-left:auto;color:var(--accent);text-decoration:none;font-size:12.5px;border-bottom:1px solid currentColor}
  nav{position:sticky;top:0;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);z-index:5;margin-bottom:18px}
  nav a{color:var(--dim);text-decoration:none;margin-right:14px;font-size:12.5px}
  nav a:hover{color:var(--accent)}
  h2{font-size:14px;margin:26px 0 12px;padding-top:8px;border-top:1px solid var(--line)}
  h2 em{font-style:normal;color:var(--dim);font-weight:400;font-size:12px;margin-left:6px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
  figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;transition:.15s}
  figure:hover{box-shadow:0 6px 18px #0002;transform:translateY(-2px)}
  .svg{height:250px;display:flex;align-items:center;justify-content:center;padding:10px;background:#fff}
  .svg svg{max-height:230px;width:auto}
  figcaption{padding:7px 9px 9px;border-top:1px solid #eee;font-size:11.5px}
  figcaption b{display:block;font-size:12px;margin-bottom:2px}
  .meta{color:var(--dim);font-size:10.5px}
  footer{margin-top:36px;color:var(--dim);font-size:11.5px}
</style></head><body>
<header>
  <h1>全部模板一览</h1>
  <span class="sub">${TEMPLATES.length} 套 · 格子里的数字就是阅读顺序</span>
  <a class="back" href="./index.html">← 回到编辑器</a>
</header>
<nav>${Object.entries(GROUPS).map(([k, v]) => {
  const n = TEMPLATES.filter((t) => t.culture === k).length;
  return n ? `<a href="#${k}"><span>${v}</span> ${n}</a>` : '';
}).join('')}</nav>
${Object.keys(GROUPS).map(section).join('\n')}
<footer>这是静态版的一览页（服务器版有同样的页面，路径 <code>/api/sheet</code>）。点开任意一套即可在编辑器里使用。</footer>
<script type="module">
  // 跟编辑器同一个语言设置（同源 localStorage）；?lang= 也认
  import { installI18n } from './i18n.mjs?v=${BUILD_V}';
  let lang = new URLSearchParams(location.search).get('lang');
  try { lang = lang || localStorage.getItem('pf.lang.v1'); } catch { /* 隐私模式 */ }
  if (lang && lang !== 'zh') installI18n(lang);
</script>
<script>
  // 从哪个版本点进来就回哪个版本（?ed=pure|painter）：纯粹版的人不该被带回 AI 版
  const ED = { pure: './pure.html', painter: './painter.html' }[new URLSearchParams(location.search).get('ed')] || './index.html';
  document.querySelector('a.back').href = ED;
  document.querySelectorAll('figure').forEach((f) => {
    f.style.cursor = 'pointer';
    f.addEventListener('click', () => { location.href = ED + '?tpl=' + encodeURIComponent(f.dataset.id); });
  });
</script>
</body></html>`;

await writeFile(path.join(site, 'sheet.html'), sheetHtml, 'utf8');

// 统计产物体积
let bytes = 0, files = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else { files++; bytes += (await readFile(p)).length; }
  }
}
await walk(site);
console.log(`✅ site/ 已生成：${files} 个文件，${(bytes / 1024).toFixed(1)} KB`);
console.log('   本地预览：node scripts/serve-static.mjs   → http://127.0.0.1:7313/');
