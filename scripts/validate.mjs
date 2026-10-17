/** 版面体检：跑全库，检查重叠/出界/过小/覆盖率/字段合法性 */
import { TEMPLATES } from '../lib/library.mjs';
import { inspectSlots } from '../lib/geometry.mjs';
import { ROLES, INTENTS } from '../lib/taxonomy.mjs';

const MIN_SIDE = 44;
let totalIssues = 0;
const rows = [];

for (const t of TEMPLATES) {
  const issues = [];
  const minSide = t.page.kind === 'scroll' ? 70 : MIN_SIDE;
  // 条漫天然靠留白分隔，覆盖率阈值放宽
  const minCoverage = t.page.kind === 'scroll' ? 0.55 : 0.72;
  issues.push(...inspectSlots(t.slots, t.page, { minSide, minCoverage }));

  for (const s of t.slots) {
    if (!ROLES[s.role]) issues.push(`[未知角色] ${s.id}: ${s.role}`);
  }
  for (const it of t.intents) {
    if (!INTENTS[it]) issues.push(`[未知意图] ${it}`);
  }
  if (!t.intents.length) issues.push('[无意图标签]');
  if (!t.tags.length) issues.push('[无题材标签]');
  const dupRole = new Map();
  for (const s of t.slots) dupRole.set(s.role, (dupRole.get(s.role) || 0) + 1);

  if (issues.length) {
    totalIssues += issues.length;
    rows.push({ id: t.id, issues });
  }
}

const byCulture = {};
for (const t of TEMPLATES) byCulture[t.culture] = (byCulture[t.culture] || 0) + 1;

console.log(`模板总数: ${TEMPLATES.length}  ${JSON.stringify(byCulture)}`);
const panelHist = {};
for (const t of TEMPLATES) panelHist[t.slots.length] = (panelHist[t.slots.length] || 0) + 1;
console.log('格数分布:', JSON.stringify(panelHist));

if (!rows.length) {
  console.log('✅ 全部通过（无重叠 / 无出界 / 无过小格）');
} else {
  console.log(`⚠️  ${rows.length} 个模板有问题（共 ${totalIssues} 条）:`);
  for (const r of rows) {
    console.log(`\n${r.id}`);
    for (const i of r.issues) console.log('   ', i);
  }
  process.exitCode = 1;
}
