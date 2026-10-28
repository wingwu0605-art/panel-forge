import { readFileSync, writeFileSync } from 'node:fs';

const p = 'web/index.html';
let s = readFileSync(p, 'utf8');
if (s.includes('<!-- MOVED:STYLE -->')) { console.log('已有'); process.exit(0); }

/* ---------- 1) 把「风格跟随」卡片挪到「AI 导演」之后（紧贴角色参考图上方）---------- */
const start = s.indexOf('    <!-- 风格跟随：生图时参考谁（人设图 / 样图 / 都参考） -->');
if (start < 0) throw new Error('找不到风格跟随卡片');
const endMark = '    </section>\n';
const end = s.indexOf(endMark, start);
if (end < 0) throw new Error('找不到风格跟随卡片结尾');
const card = s.slice(start, end + endMark.length);
s = s.slice(0, start) + s.slice(end + endMark.length);

// 插到角色参考图之前（也就是 AI 导演之后）
const charsAnchor = '    <section class="card chars" data-panel="chars"';
const idx = s.indexOf(charsAnchor);
if (idx < 0) throw new Error('找不到角色参考图');
s = s.slice(0, idx) + '    <!-- MOVED:STYLE 风格跟随：紧贴角色参考图上方（用户要求与 AI 导演对调） -->\n' + card + s.slice(idx);

/* ---------- 2) SVG 标签加 class，便于翻译后重算宽度 ---------- */
writeFileSync(p, s);
console.log('index.html：风格跟随已挪到 AI 导演之后（角色参考图上方）');
