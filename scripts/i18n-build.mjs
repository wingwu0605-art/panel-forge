#!/usr/bin/env node
/**
 * 由 i18n/strings.tsv 生成 web/i18n/<lang>.mjs（浏览器按需下载的词典）。
 *
 *   node scripts/i18n-build.mjs           生成，并报告每种语言还缺多少条
 *   node scripts/i18n-build.mjs --check   只检查（CI 用）：占位符对不上、生成物过期 → 退出码 1
 *
 * strings.tsv：第一行是表头 zh en id ja；一行一条，第一列是界面上的中文原文（去掉首尾空白）。
 *   - 占位符：{0} 任意文字（翻译时会再翻一遍），{#0} 数字。译文里写 {0}，顺序可以换
 *   - 换行写成 \n；键为 __title__ 的那一行是浏览器标签页标题
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSV = path.join(ROOT, 'i18n', 'strings.tsv');
const OUT = path.join(ROOT, 'web', 'i18n');
const CHECK = process.argv.includes('--check');

const unesc = (s) => (s || '').replace(/\\n/g, '\n').trim();
const lines = readFileSync(TSV, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const header = lines.shift().split('\t');
const langs = header.slice(1);
const rows = lines.map((l, i) => {
  const cols = l.split('\t');
  return { line: i + 2, zh: unesc(cols[0]), vals: Object.fromEntries(langs.map((g, j) => [g, unesc(cols[j + 1])])) };
});

const problems = [];
const seen = new Map();
for (const r of rows) {
  if (!r.zh) { problems.push(`第 ${r.line} 行：原文为空`); continue; }
  if (seen.has(r.zh)) problems.push(`第 ${r.line} 行：和第 ${seen.get(r.zh)} 行重复「${r.zh}」`);
  seen.set(r.zh, r.line);
  const want = [...r.zh.matchAll(/\{#?(\d)\}/g)].map((m) => m[1]).sort().join(',');
  for (const g of langs) {
    const v = r.vals[g];
    if (!v) continue;
    const got = [...v.matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join(',');
    if (got !== want) problems.push(`第 ${r.line} 行 ${g}：占位符 {${got}} 和原文 {${want}} 对不上`);
  }
}

const files = {};
const missing = {};
for (const g of langs) {
  const table = {};
  let title = '';
  missing[g] = 0;
  for (const r of rows) {
    if (r.zh === '__title__') { title = r.vals[g] || ''; continue; }
    if (r.vals[g]) table[r.zh] = r.vals[g];
    else missing[g]++;
  }
  files[g] = '// 自动生成：scripts/i18n-build.mjs ← i18n/strings.tsv（别手改，改 tsv 再生成）\n'
    + `export const TITLE = ${JSON.stringify(title)};\n`
    + `export default ${JSON.stringify(table, null, 0).replace(/","/g, '",\n"').replace(/^\{/, '{\n').replace(/\}$/, '\n}')};\n`;
}

if (CHECK) {
  // CI 里要求三种语言都齐：新加的界面文字没翻，就在这里拦下来（不然线上会冒出一句中文）
  for (const g of langs) if (missing[g]) problems.push(`${g} 还有 ${missing[g]} 条没翻：在 i18n/strings.tsv 补上那一列`);
  for (const g of langs) {
    const f = path.join(OUT, g + '.mjs');
    if (!existsSync(f) || readFileSync(f, 'utf8') !== files[g]) problems.push(`web/i18n/${g}.mjs 过期了：跑一次 node scripts/i18n-build.mjs`);
  }
} else {
  mkdirSync(OUT, { recursive: true });
  for (const g of langs) writeFileSync(path.join(OUT, g + '.mjs'), files[g]);
}

console.log(`词条 ${rows.length} 条 · ` + langs.map((g) => `${g} 缺 ${missing[g]}`).join(' · '));
if (problems.length) {
  console.error('✗ ' + problems.join('\n✗ '));
  process.exit(1);
}
