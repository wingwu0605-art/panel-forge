#!/usr/bin/env node
/**
 * 发版：改版本号 → 同步各落点 → 自动生成 CHANGELOG 片段 → 提交 → 打标签 →（可选）推送
 *
 *   node scripts/release.mjs 0.10.0            # 发版，但不推送（会打印后续命令）
 *   node scripts/release.mjs 0.10.0 --push     # 发版并推送提交 + 标签
 *   node scripts/release.mjs --minor --push    # 按上一次标签自动 +0.1.0
 *   node scripts/release.mjs 0.10.0 --dry      # 只打印将要写入的内容，不改文件
 *
 * 为什么要有它：版本号以前靠手改，v0.9.0 之后积压了 37 个提交没进版本记录。
 * 这里把「算版本 → 写 CHANGELOG → 打标签」变成一条命令，迭代末跑一次就不会断档。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const dry = flag('dry');
const push = flag('push');
const skipTests = flag('skip-tests');
const versionArg = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitInherit = (args) => execFileSync('git', args, { stdio: 'inherit' });

/* ---------- 1) 决定版本号 ---------- */
const lastTag = (() => { try { return git(['describe', '--tags', '--abbrev=0']); } catch { return ''; } })();
const current = existsSync('VERSION') ? readFileSync('VERSION', 'utf8').trim() : '0.0.0';
const bump = (v, kind) => {
  const [a, b, c] = v.split('.').map(Number);
  if (kind === 'major') return `${a + 1}.0.0`;
  if (kind === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
};
const version = versionArg
  || (flag('major') ? bump(current, 'major') : flag('minor') ? bump(current, 'minor') : bump(current, 'patch'));

/* ---------- 2) 收集上一个标签之后的提交，按类型分组 ---------- */
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const log = (() => {
  try { return git(['log', range, '--format=%h%x09%s', '--no-merges']); } catch { return ''; }
})();
const groups = new Map([
  ['feat', { title: '新增', items: [] }],
  ['fix', { title: '修复', items: [] }],
  ['perf', { title: '性能', items: [] }],
  ['refactor', { title: '重构', items: [] }],
  ['docs', { title: '文档', items: [] }],
  ['test', { title: '测试', items: [] }],
  ['chore', { title: '杂项', items: [] }],
  ['other', { title: '变更', items: [] }],
]);
const TYPE_RE = /^(feat|fix|perf|refactor|docs|test|chore|build|ci|style)(\([^)]*\))?\s*[:：]\s*/;
for (const line of log.split('\n').filter(Boolean)) {
  const [sha, ...rest] = line.split('\t');
  const subject = rest.join('\t');
  const m = TYPE_RE.exec(subject);
  const key = m ? m[1] : 'other';
  const bucket = groups.get(['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore'].includes(key) ? key : 'other');
  bucket.items.push(`- ${subject.replace(TYPE_RE, '')}（\`${sha}\`）`);
}
const sections = [...groups.values()].filter((g) => g.items.length);

const today = new Date().toISOString().slice(0, 10);
const block = [
  `## [${version}] — ${today}`,
  '',
  ...(sections.length
    ? sections.flatMap((g) => [`### ${g.title}`, '', ...g.items, ''])
    : ['本版无提交记录（仅版本号变更）。', '']),
].join('\n');

/* ---------- 3) 写进 CHANGELOG（插在 [Unreleased] 之后） ---------- */
const changelogPath = 'CHANGELOG.md';
let changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# 变更日志\n\n## [Unreleased]\n\n---\n';
if (!changelog.includes(`## [${version}]`)) {
  const anchor = '## [Unreleased]';
  const idx = changelog.indexOf(anchor);
  if (idx >= 0) {
    const afterUnreleased = idx + anchor.length;
    // 找到 [Unreleased] 那一段结束（下一个 "---" 或下一个 "## "）
    const rest = changelog.slice(afterUnreleased);
    const m = /\n---\n/.exec(rest);
    const cut = m ? afterUnreleased + m.index + m[0].length : afterUnreleased;
    changelog = `${changelog.slice(0, cut)}\n${block}\n${changelog.slice(cut)}`;
  } else {
    changelog = `${changelog}\n${block}\n`;
  }
}

/* ---------- 4) dry run：只打印 ---------- */
if (dry) {
  console.log(`上一次标签: ${lastTag || '(无)'} | 当前 VERSION: ${current} → ${version}`);
  console.log(`提交区间: ${range}（${log ? log.split('\n').length : 0} 条）`);
  console.log('\n----- 将写入 CHANGELOG -----\n' + block);
  process.exit(0);
}

/* ---------- 5) 落盘 ---------- */
writeFileSync(changelogPath, changelog, 'utf8');
console.log(`CHANGELOG: 已加入 [${version}]（${log ? log.split('\n').length : 0} 条提交）`);

execFileSync(process.execPath, ['scripts/set-version.mjs', version], { stdio: 'inherit' });

/* ---------- 6) 闸门（可选） ---------- */
if (!skipTests) {
  for (const cmd of [['scripts/test-units.mjs'], ['scripts/validate.mjs'], ['scripts/check-contrast.mjs'], ['scripts/visual-all.mjs', '--shards=3']]) {
    process.stdout.write(`跑闸门 ${cmd[0]} … `);
    try {
      execFileSync(process.execPath, cmd, { stdio: 'ignore' });
      console.log('通过');
    } catch {
      console.log('失败');
      console.error('闸门未通过，已中止发版（工作区已改文件，可用 git checkout 撤销）');
      process.exit(1);
    }
  }
}

/* ---------- 7) 提交 + 打标签 ---------- */
gitInherit(['add', '-A']);
gitInherit(['commit', '-m', `chore(release): v${version}`]);
git(['tag', '-a', `v${version}`, '-m', `v${version}`]);
console.log(`已提交并打标签 v${version}`);

if (push) {
  gitInherit(['push', 'origin', 'HEAD', '--follow-tags']);
  console.log('已推送提交与标签');
} else {
  console.log(`\n下一步（确认无误后执行）:\n  git push origin HEAD --follow-tags`);
}
