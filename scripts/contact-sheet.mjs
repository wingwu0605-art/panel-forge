/** 生成视觉接触表（HTML，供无头浏览器截图肉眼验收） */
import { writeFileSync, mkdirSync } from 'node:fs';
import { TEMPLATES } from '../lib/library.mjs';
import { renderTemplateSVG } from '../lib/svg.mjs';

const outDir = new URL('../out/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const groups = {
  jp: '日式页漫',
  cn: '中式漫画',
  kr: '韩式条漫',
  core: '通用/跨界',
};

function page(list, title) {
  const cards = list.map((t) => `
    <figure>
      <div class="svg">${renderTemplateSVG(t, { width: 300, showNumbers: true })}</div>
      <figcaption><b>${t.id}</b><br>${t.name}<br><span>${t.slots.length} 格 · ${t.ratio} · ${t.frame}</span></figcaption>
    </figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
  <style>
    body{background:#eceae4;font:13px/1.5 'Microsoft YaHei',sans-serif;margin:0;padding:24px}
    h1{font-size:20px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:repeat(4,300px);gap:22px}
    figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px #0003}
    .svg{height:420px;display:flex;align-items:center;justify-content:center;background:#fff}
    .svg svg{max-height:420px;width:auto}
    figcaption{padding:6px 8px;font-size:11px;color:#333}
    figcaption span{color:#888}
  </style><h1>${title}（${list.length}）</h1><div class="grid">${cards}</div>`;
}

const all = [];
const BATCH = 12;
for (const [k, label] of Object.entries(groups)) {
  const list = TEMPLATES.filter((t) => t.culture === k);
  if (!list.length) continue;
  all.push(...list);
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    writeFileSync(new URL(`contact-${k}-${i / BATCH + 1}.html`, outDir), page(chunk, `${label} ${i + 1}-${i + chunk.length}`), 'utf8');
  }
}
writeFileSync(new URL('contact-all.html', outDir), page(all, '全部模板'), 'utf8');
console.log(`写出分批接触表 out/contact-{${Object.keys(groups).join(',')}}-*.html（共 ${all.length} 个模板）`);
