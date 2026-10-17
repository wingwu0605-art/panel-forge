/**
 * build-static.mjs — 生成可纯静态托管的站点（GitHub Pages / 任意静态服务器）
 *
 * 产物：site/
 *   index.html  app.js  styles.css  api-static.js
 *   lib/*.mjs   （模板库 + 规则引擎 + 渲染器，全部在浏览器里跑）
 *
 * 静态版能做什么：浏览 138 套模板、镂空填充、拖图/粘贴、按规则匹配剧情、生成分镜表、
 *                导出 PNG/SVG/JSON —— 全部离线可用。
 * 静态版不能做什么：AI 导演（需要服务端）、图片 URL 代理（需要服务端）。
 */
import { cp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(path.join(site, 'lib'), { recursive: true });

for (const f of ['index.html', 'app.js', 'styles.css', 'api-static.js']) {
  await cp(path.join(root, 'web', f), path.join(site, f));
}
for (const f of await readdir(path.join(root, 'lib'))) {
  if (f.endsWith('.mjs')) await cp(path.join(root, 'lib', f), path.join(site, 'lib', f));
}

let html = await readFile(path.join(site, 'index.html'), 'utf8');
if (!html.includes('PF_STATIC')) {
  html = html.replace('</head>', '<script>window.PF_STATIC = true;</script>\n</head>');
}
await writeFile(path.join(site, 'index.html'), html, 'utf8');
await writeFile(path.join(site, '.nojekyll'), '', 'utf8');

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
