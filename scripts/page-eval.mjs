#!/usr/bin/env node
/**
 * 在真浏览器里临时查一件事（调试用，比 ?dbg=1 灵活）。
 *
 *   node scripts/page-eval.mjs "document.querySelectorAll('.slot-sec').length"
 *   node scripts/page-eval.mjs --path="/?tpl=ref-4band-2col&plot=雨夜" --eval="..."
 *   node scripts/page-eval.mjs --w=900 --path="/?view=edit" --shot=edit --eval="..."
 *
 * 选项：--path=<网址路径>（默认 "/"） --w= --h= --wait=<等这个表达式为真> --shot=<截图名>
 *       --file=<js 文件>  表达式写进文件再跑，绕开 PowerShell 的引号地狱（强烈推荐）
 * 结果以 JSON 打到终端。需要 `node server.mjs` 已经在跑。
 */
import { launch } from './visual-check.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (m) opt[m[1]] = m[2];
  else if (/^--[a-zA-Z]+$/.test(a)) opt[a.slice(2)] = true;
  else rest.push(a);
}
const expr = opt.file ? (await readFile(resolve(ROOT, opt.file), 'utf8')).trim() : (opt.eval || rest.join(' '));
if (!expr) {
  console.error('用法：node scripts/page-eval.mjs "<js 表达式>" | --file=out/dbg.js [--path=/...] [--w=1440] [--h=900] [--wait=expr] [--shot=name]');
  process.exit(2);
}

const width = Number(opt.w || 1440);
const height = Number(opt.h || 900);
const session = await launch({ width, height });
try {
  const { page } = session;
  await page.viewport(width, height);
  await page.goto(opt.path || '/');
  // --noready：打开的不是主应用（比如 /klecks/embed.html）时，别等应用启动标记
  if (!opt.noready) await page.ready();
  if (opt.wait) await page.waitFor(opt.wait, { timeout: Number(opt.timeout || 15000), label: opt.wait });
  const value = await page.evaluate(expr);
  console.log(JSON.stringify(value, null, 2));
  if (opt.shot) {
    const file = await page.shot(opt.shot);
    console.log('截图：' + file.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
  }
  const errs = page.errors();
  if (errs.length) console.error('页面错误：\n  ' + errs.join('\n  '));
} finally {
  session.close();
}
