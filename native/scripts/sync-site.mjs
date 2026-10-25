import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * 把仓库根目录构建出的 site/ 同步到 native/www/。
 *
 * WebView 里跑的就是这份构建产物 —— 和网页版完全同一套代码，
 * 只有 shell 检测（?shell=android / Capacitor.isNativePlatform）会让界面走性能档。
 */
const here = path.dirname(fileURLToPath(import.meta.url));   // 路径含中文/空格时要 URL 解码
const root = path.resolve(here, '..', '..');
const site = path.join(root, 'site');
const www = path.resolve(here, '..', 'www');

if (!existsSync(site)) {
  console.log('site/ 不存在，先构建：');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-static.mjs')], { stdio: 'inherit' });
}
if (!existsSync(site)) throw new Error('构建没产出 site/，检查 scripts/build-static.mjs');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
await cp(site, www, { recursive: true });

const list = await readdir(www);
console.log(`已同步 → native/www（${list.length} 项）`);
