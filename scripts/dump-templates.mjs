/** 导出全部模板为单个 JSON（供其它工具/离线集成使用） */
import { writeFileSync, mkdirSync } from 'node:fs';
import { TEMPLATES } from '../lib/library.mjs';
import { INTENTS, ROLES, STYLE_PACKS } from '../lib/taxonomy.mjs';
import { PAGE_PRESETS } from '../lib/geometry.mjs';

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  count: TEMPLATES.length,
  pages: PAGE_PRESETS,
  cultures: STYLE_PACKS,
  roles: ROLES,
  intents: INTENTS,
  templates: TEMPLATES,
};
writeFileSync(new URL('../out/templates.json', import.meta.url), JSON.stringify(payload, null, 2), 'utf8');
const byCulture = TEMPLATES.reduce((a, t) => (a[t.culture] = (a[t.culture] || 0) + 1, a), {});
console.log(`out/templates.json 已生成：${TEMPLATES.length} 套 ${JSON.stringify(byCulture)}`);
