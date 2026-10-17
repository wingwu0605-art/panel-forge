import { renderTemplateSVG } from '../lib/svg.mjs';
import { getTemplate } from '../lib/library.mjs';

const t = getTemplate('jp-shonen-3tier');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const images = {};
for (const s of t.slots) images[s.id] = { href: png, iw: 1, ih: 1 };

const a = renderTemplateSVG(t, { width: 600, images });
const b = renderTemplateSVG(t, { width: 600, images });
const ids = (x) => [...x.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
const A = ids(a), B = ids(b);
console.log('svgA clip ids:', A.length, A.slice(0, 2).join(', '));
console.log('svgB clip ids:', B.length, B.slice(0, 2).join(', '));
console.log('跨实例 id 冲突:', A.some((x) => B.includes(x)) ? '有（坏）' : '无（好）');
console.log('实例内唯一:', new Set(A).size === A.length);
console.log('image 数量:', (a.match(/<image /g) || []).length);
