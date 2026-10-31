#!/usr/bin/env node
/**
 * 并行跑整套可视化检查：把场景切成 N 份，多进程同时跑，最后汇总。
 *
 *   node scripts/visual-all.mjs                # 默认 3 片
 *   node scripts/visual-all.mjs --shards=4     # 4 片
 *   node scripts/visual-all.mjs --shards=1     # 串行（等同原来）
 *
 * 为什么：31 个场景串行要 9 分多钟，改一行代码等 10 分钟不现实。
 * 每片有自己的 Chrome 实例（独立 profile + 端口），互不干扰。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const shardsArg = argv.find((a) => a.startsWith('--shards='));
const SHARDS = Math.max(1, Number(shardsArg ? shardsArg.split('=')[1] : 3) || 3);

/* --fast：只跑这 10 个"一改就容易坏"的场景（提交前用，约 15 秒） */
const FAST_NAMES = [
  'board-desktop', 'hotpath', 'paint-klecks', 'script-tab', 'auto-mode',
  'auto-full', 'rails', 'inbox', 'double-tap', 'style-follow',
];
const FAST = argv.includes('--fast');
const filters = FAST ? FAST_NAMES : [];

const runShard = (index) => new Promise((resolve) => {
  const extra = FAST ? filters : [];
  const child = spawn(process.execPath, ['scripts/visual-check.mjs', `--shard=${index}/${SHARDS}`, ...extra], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('close', (code) => resolve({ index, code, out }));
});

const t0 = Date.now();
console.log(FAST ? `快速模式：${FAST_NAMES.length} 个核心场景，分 ${SHARDS} 片并行…` : `并行跑 ${SHARDS} 片…`);
const results = await Promise.all(Array.from({ length: SHARDS }, (_, i) => runShard(i + 1)));

let pass = 0;
let fail = 0;
const failures = [];
for (const r of results.sort((a, b) => a.index - b.index)) {
  const m = /(\d+)\/(\d+) 项通过/.exec(r.out);
  const rows = [...r.out.matchAll(/^\s+(PASS|FAIL)\s+(.+)$/gm)];
  const myFail = r.out.match(/FAIL\s+(.+)$/gm) || [];
  if (m) { pass += Number(m[1]); fail += Number(m[2]) - Number(m[1]); }
  for (const line of myFail) failures.push(`[片 ${r.index}] ${line.replace(/^FAIL\s+/, '').trim()}`);
  console.log(`  片 ${r.index}: ${m ? m[0] : '未产出统计'}（${rows.length} 条断言，退出码 ${r.code}）`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
const total = pass + fail;
console.log(`\n${fail ? '❌' : '✅'}  ${pass}/${total} 项通过 · 用时 ${secs}s（${SHARDS} 片并行）`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log('  ' + f);
}
process.exit(fail ? 1 : 0);
