import { readFileSync, writeFileSync } from 'node:fs';

const p = 'web/app.js';
const src = readFileSync(p, 'utf8');
const lines = src.split('\n');

/** 按"首行完全匹配"找到块，返回 [startIdx, endIdxExclusive]；end 由 endMatch 找 */
function block(startMatch, endMatch, label) {
  const start = lines.findIndex((l) => startMatch(l));
  if (start < 0) throw new Error('找不到块: ' + label);
  let end = start;
  if (endMatch) {
    for (let i = start; i < lines.length; i++) {
      if (endMatch(lines[i], i === start)) { end = i + 1; break; }
    }
    if (end === start) throw new Error('找不到块尾: ' + label);
  } else {
    end = start + 1;
  }
  return { start, end, label };
}

const blocks = [
  // $ / $$（两行紧邻）
  block((l) => l.startsWith('const $ = (s) => document.querySelector(s);'), (l) => l.startsWith('const $$ = (s) =>'), 'dom query'),
  // PERF / perf / perfPush / perfStats / perfNow / perfDone
  block((l) => l.startsWith('const PERF = new URLSearchParams'), (l) => l.startsWith('};') && l.includes('};'), 'perf core'),
];

// 逐块切片（从后往前删，避免索引漂移）
const parts = [];
const sortedDesc = [...blocks].sort((a, b) => b.start - a.start);
for (const b of sortedDesc) {
  parts.unshift({ label: b.label, text: lines.slice(b.start, b.end).join('\n') });
  lines.splice(b.start, b.end - b.start);
}

console.log('已取出块:', parts.map((p2) => p2.label).join(' / '));
console.log('--- 取出内容预览 ---');
for (const pt of parts) console.log('### ' + pt.label + '\n' + pt.text.split('\n').slice(0, 4).join('\n') + '\n…');
writeFileSync(p, lines.join('\n'));
console.log('\napp.js 新行数:', lines.length);
