/**
 * decode.mjs — 把生成模板包（lib/packs/{jp,kr,cn,core}.mjs）里的紧凑条目还原成模板定义
 *
 * 条目格式（scripts/gen-library.mjs 写出）：
 *   i 编号 · n 名字 · d 说明 · fm 版式家族 · r 画幅 · rd 阅读方向（r 右往左 / l 左往右 / v 竖屏）· f 边框
 *   m 白边 · g 格间距 · k 格数 · t 标签 · it 戏路 · L 盒子树 · x 插入格 · o 阅读顺序（可选）
 *   盒子树：节点 [方向 'h'|'v', 权重[], 子[], {s 斜切, z 锯齿}?]；叶子 '景别' 或 ['景别', {b 出血, n 无框, p 留白}]
 */
import { row, col, leaf } from '../geometry.mjs';

const READ = { r: 'rtl', l: 'ltr', v: 'vertical' };

export function decNode(x) {
  if (typeof x === 'string') return leaf(x);
  if (!Array.isArray(x[1])) {
    const o = x[1] || {};
    const extra = {};
    if (o.b) extra.bleed = o.b === 1 ? true : o.b;
    if (o.n) extra.borderless = true;
    if (o.p) extra.pad = o.p;
    return leaf(x[0], extra);
  }
  const [dir, weights, children, o = {}] = x;
  const opts = {};
  if (o.s) opts.slant = o.s;
  if (o.z) opts.zigzag = true;
  return (dir === 'h' ? row : col)(weights, children.map(decNode), opts);
}

export function decodeEntry(e, culture) {
  return {
    id: e.i,
    name: e.n,
    culture,
    reading: READ[e.rd] || 'ltr',
    ratio: e.r,
    frame: e.f,
    tags: e.t,
    intents: e.it,
    desc: e.d,
    margin: e.m,
    gutter: e.g,
    layout: decNode(e.L),
    insets: e.x
      ? e.x.map(([x, y, w, h, rot, role, note, bl]) => ({ x, y, w, h, rot, role, ...(note ? { note } : {}), ...(bl ? { borderless: true } : {}) }))
      : undefined,
    order: e.o,
    family: e.fm,
    panels: e.k,
    generated: true,
  };
}
