/**
 * geometry.mjs — 分镜版面内核
 *
 * 坐标系：页面归一化到宽度 1000，高度 = 1000 / (w/h)。所有模板都以「归一化单位」存储，
 * 渲染时按目标像素宽高等比缩放，因此同一模板可用于任意出版尺寸。
 *
 * 版面用「盒子树」描述（box tree）：
 *   row([权重], [子…])  → 上下切分（横向分栏带 / Band）
 *   col([权重], [子…])  → 左右切分（纵向分栏 / Tier）
 *   字符串             → 叶子格（值为 role 角色名）
 *   {role, ...}        → 叶子格（带属性：borderless / bleed / notes）
 *
 * 支持斜切（slant：漫画的「ななめ割り」斜线格力），支持出血（bleed：ぶち抜き），
 * 支持叠盖插入格（insets：小格压在格子上），因此能表达真正的手绘漫画版式，而不是死板网格。
 */

/** 页面预设（宽固定 1000，高按比例） */
export const PAGE_PRESETS = {
  a4:     { id: 'a4',     label: 'A4 页漫 1:1.414',  w: 1000, h: 1414, kind: 'page' },
  b5:     { id: 'b5',     label: 'B5 页漫 1:1.46',   w: 1000, h: 1460, kind: 'page' },
  p34:    { id: 'p34',    label: '3:4 页漫',         w: 1000, h: 1333, kind: 'page' },
  square: { id: 'square', label: '方形 1:1',         w: 1000, h: 1000, kind: 'page' },
  wide:   { id: 'wide',   label: '跨页横版 16:9',    w: 1000, h: 563,  kind: 'spread' },
  strip:  { id: 'strip',  label: '竖屏条漫 9:16',    w: 1000, h: 1778, kind: 'scroll' },
  tall:   { id: 'tall',   label: '竖屏长条 1:2',     w: 1000, h: 2000, kind: 'scroll' },
  scroll: { id: 'scroll', label: '长条漫 1:2.6',     w: 1000, h: 2600, kind: 'scroll' },
};

export const DEFAULT_GUTTER = 15;   // 格与格之间（约占页宽 1.5%）
export const DEFAULT_MARGIN = 28;   // 页面白边（约占页宽 2.8%）

/* ------------------------------------------------------------------ *
 * 四边形：{tl,tr,br,bl}，约定上下边水平（斜切只倾斜竖直边，即漫画常规斜线格）
 * ------------------------------------------------------------------ */
export const rectQuad = (x, y, w, h) => ({
  tl: [x, y], tr: [x + w, y], br: [x + w, y + h], bl: [x, y + h],
});

const lerp = (a, b, t) => a + (b - a) * t;
/** 在四边形上边按比例取值（上下边水平，故 y 恒定） */
const qTop = (q, t) => [lerp(q.tl[0], q.tr[0], t), q.tl[1]];
const qBot = (q, t) => [lerp(q.bl[0], q.br[0], t), q.bl[1]];
const qLeft = (q, t) => [lerp(q.tl[0], q.bl[0], t), lerp(q.tl[1], q.bl[1], t)];
const qRight = (q, t) => [lerp(q.tr[0], q.br[0], t), lerp(q.tr[1], q.br[1], t)];

export function quadToPoly(q) {
  return [q.tl, q.tr, q.br, q.bl].map(([x, y]) => [round2(x), round2(y)]);
}

const round2 = (v) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ *
 * 盒子树构造器
 * ------------------------------------------------------------------ */
/** 叶子格 */
export const leaf = (role, extra = {}) => ({ leaf: true, role, ...extra });
const asNode = (v) => (typeof v === 'string' ? leaf(v) : v);

/** 上下切分（横向条带） */
export function row(weights, children, opts = {}) {
  return { dir: 'h', weights, children: children.map(asNode), ...opts };
}
/** 左右切分（纵向分栏） */
export function col(weights, children, opts = {}) {
  return { dir: 'v', weights, children: children.map(asNode), ...opts };
}

/* ------------------------------------------------------------------ *
 * 切分
 * ------------------------------------------------------------------ */
/** 左右切分，支持斜切（slant：以格高为单位的斜移量，正=下边左移） */
function splitCol(quad, weights, gutter, opts = {}) {
  const { slant = 0, zigzag = false, flip = false } = opts;
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cum = [0];
  weights.forEach((w, i) => cum.push(cum[i] + w / total));
  const n = weights.length;
  const H = Math.abs(quad.bl[1] - quad.tl[1]);
  const baseShift = slant * H * (flip ? -1 : 1);

  // 计算 n+1 条竖直边（top/bottom 的 x）
  const edges = [];
  for (let k = 0; k <= n; k++) {
    const isInternal = k > 0 && k < n;
    const shift = isInternal
      ? baseShift * (zigzag && k % 2 === 0 ? -1 : 1)
      : 0;
    edges.push({
      top: qTop(quad, cum[k])[0] + shift,
      bot: qBot(quad, cum[k])[0] - shift,
      yTop: quad.tl[1],
      yBot: quad.bl[1],
    });
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const L = edges[i], R = edges[i + 1];
    const gl = i > 0 ? gutter / 2 : 0;
    const gr = i < n - 1 ? gutter / 2 : 0;
    const lt = L.top + gl, lb = L.bot + gl;
    const rt = R.top - gr, rb = R.bot - gr;
    out.push({
      tl: [lt, L.yTop], tr: [rt, L.yTop], br: [rb, L.yBot], bl: [lb, L.yBot],
    });
  }
  return out;
}

/** 上下切分（水平切分线，不做斜切：漫画中横线多为水平） */
function splitRow(quad, weights, gutter, opts = {}) {
  const { slant = 0 } = opts; // 若需要，可用 slant 让水平边略微倾斜（暂以水平为主）
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cum = [0];
  weights.forEach((w, i) => cum.push(cum[i] + w / total));
  const n = weights.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const f0 = cum[i], f1 = cum[i + 1];
    const y0 = lerp(quad.tl[1], quad.bl[1], f0) + (i > 0 ? gutter / 2 : 0);
    const y1 = lerp(quad.tl[1], quad.bl[1], f1) - (i < n - 1 ? gutter / 2 : 0);
    const t = (y0 - quad.tl[1]) / Math.max(1e-6, quad.bl[1] - quad.tl[1]);
    const b = (y1 - quad.tl[1]) / Math.max(1e-6, quad.bl[1] - quad.tl[1]);
    const tl = qLeft(quad, t), tr = qRight(quad, t);
    const bl = qLeft(quad, b), br = qRight(quad, b);
    out.push({
      tl: [tl[0], y0], tr: [tr[0], y0], br: [br[0], y1], bl: [bl[0], y1],
    });
  }
  return out;
}

function padQuad(quad, pad, page) {
  const q = { tl: [...quad.tl], tr: [...quad.tr], br: [...quad.br], bl: [...quad.bl] };
  const dx = (f) => f * page.w, dy = (f) => f * page.h;
  if (pad.left) { q.tl[0] += dx(pad.left); q.bl[0] += dx(pad.left); }
  if (pad.right) { q.tr[0] -= dx(pad.right); q.br[0] -= dx(pad.right); }
  if (pad.top) { q.tl[1] += dy(pad.top); q.tr[1] += dy(pad.top); }
  if (pad.bottom) { q.bl[1] -= dy(pad.bottom); q.br[1] -= dy(pad.bottom); }
  return q;
}

/* ------------------------------------------------------------------ *
 * 出血
 * ------------------------------------------------------------------ */
function applyBleed(quad, bleed, page, margin = 0) {
  if (!bleed) return quad;
  const near = (v, t) => Math.abs(v - t) < 2;
  const sides = Array.isArray(bleed)
    ? bleed
    : // bleed:true → 只对「本来就贴着版心白边」的那几条边出血（真正的ぶち抜き）
      [['top', quad.tl[1], margin], ['bottom', quad.bl[1], page.h - margin],
       ['left', quad.tl[0], margin], ['right', quad.tr[0], page.w - margin]]
        .filter(([, v, m]) => near(v, m) || near(v, 0) || near(v, page.w) || near(v, page.h))
        .map(([s]) => s);
  const q = { tl: [...quad.tl], tr: [...quad.tr], br: [...quad.br], bl: [...quad.bl] };
  if (sides.includes('top')) { q.tl[1] = 0; q.tr[1] = 0; }
  if (sides.includes('bottom')) { q.bl[1] = page.h; q.br[1] = page.h; }
  if (sides.includes('left')) { q.tl[0] = 0; q.bl[0] = 0; }
  if (sides.includes('right')) { q.tr[0] = page.w; q.br[0] = page.w; }
  return q;
}

/* ------------------------------------------------------------------ *
 * 主构建
 * ------------------------------------------------------------------ */
/**
 * 把盒子树展开为 slot 数组（按阅读顺序）。
 * @param {object} tree
 * @param {object} cfg {page, margin, gutter, reading}
 */
export function buildSlots(tree, cfg = {}) {
  const page = cfg.page || PAGE_PRESETS.a4;
  const margin = cfg.margin ?? DEFAULT_MARGIN;
  const gutter = cfg.gutter ?? DEFAULT_GUTTER;
  const reading = cfg.reading || 'rtl';
  const slots = [];

  const walk = (node, quad, path) => {
    if (node.leaf) {
      const leafOpts = node;
      let q = quad;
      if (leafOpts.pad) q = padQuad(q, leafOpts.pad, page);
      q = applyBleed(q, leafOpts.bleed, page, margin);
      slots.push(makeSlot(q, leafOpts, path, slots.length));
      return;
    }
    const { dir, weights, children } = node;
    // 页漫 RTL：weights / children 都按「阅读顺序」= 从右往左给，几何整体镜像生成。
    // perm 把「第 i 个读到的孩子」映射到「几何上第几个格子」，保证视觉与阅读顺序一致。
    let quads, perm;
    if (dir === 'v' && reading === 'rtl') {
      quads = splitCol(quad, [...weights].reverse(), gutter, node);
      perm = [...children.keys()].reverse();
    } else if (dir === 'v') {
      quads = splitCol(quad, weights, gutter, node);
      perm = [...children.keys()];
    } else {
      quads = splitRow(quad, weights, gutter, node);
      perm = [...children.keys()];
    }
    children.forEach((child, i) => walk(child, quads[perm[i]], path.concat(i)));
  };

  walk(tree, rectQuad(margin, margin, page.w - margin * 2, page.h - margin * 2), []);

  // 叠盖插入格（后绘制＝盖在上面）
  if (Array.isArray(cfg.insets)) {
    for (const ins of cfg.insets) {
      const x = ins.x * page.w, y = ins.y * page.h;
      const w = ins.w * page.w, h = ins.h * page.h;
      let q = rectQuad(x, y, w, h);
      if (ins.rot) q = rotateQuad(q, ins.rot);
      const s = makeSlot(q, { ...ins, leaf: true, over: true }, ['inset', slots.length]);
      s.over = true;
      slots.push(s);
    }
  }

  // 阅读顺序：默认按树遍历顺序；若给了几何排序则改用几何
  let ordered = slots;
  if (cfg.orderByGeometry || cfg.reading === 'vertical') {
    ordered = orderByGeometry(slots, reading);
  }
  ordered.forEach((s, i) => { s.order = i + 1; });
  return ordered;
}

function rotateQuad(q, deg) {
  const cx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
  const cy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const rot = ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
  return { tl: rot(q.tl), tr: rot(q.tr), br: rot(q.br), bl: rot(q.bl) };
}

function makeSlot(quad, spec, path, idx = 0) {
  const poly = quadToPoly(quad);
  const b = polyBounds(poly);
  return {
    id: spec.id || `p${idx + 1}`,
    role: spec.role || 'medium',
    poly,
    x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h),
    aspect: round2(b.w / Math.max(1, b.h)),
    area: round2((polyArea(poly) / 1e6) * 100),  // 占页百分比
    borderless: !!spec.borderless,
    bleed: spec.bleed || false,
    radius: spec.radius || 0,
    note: spec.note || '',
    rot: spec.rot || 0,
    over: !!spec.over,
  };
}

/* ------------------------------------------------------------------ *
 * 多边形工具
 * ------------------------------------------------------------------ */
export function polyBounds(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

export function pointInPoly(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** 生成 SVG path d */
export function polyPathD(poly) {
  return poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${round2(p[0])} ${round2(p[1])}`).join(' ') + ' Z';
}

/** 生成 CSS clip-path（百分比，可直接给 div/img 用） */
export function polyClipCSS(poly, page) {
  return 'polygon(' + poly.map(([x, y]) =>
    `${round2((x / page.w) * 100)}% ${round2((y / page.h) * 100)}%`).join(', ') + ')';
}

/** 按阅读顺序（几何） */
export function orderByGeometry(slots, reading = 'rtl') {
  const withC = slots.map((s) => ({ s, cx: s.x + s.w / 2, cy: s.y + s.h / 2 }));
  const sorted = [...withC].sort((a, b) => a.cy - b.cy);
  const bands = [];
  for (const it of sorted) {
    const band = bands[bands.length - 1];
    if (!band) { bands.push([it]); continue; }
    const anchor = band.reduce((m, x) => m + x.cy, 0) / band.length;
    const tol = 40;
    if (Math.abs(it.cy - anchor) <= tol) band.push(it); else bands.push([it]);
  }
  const out = [];
  for (const band of bands) {
    band.sort((a, b) => (reading === 'rtl' ? b.cx - a.cx : a.cx - b.cx));
    out.push(...band.map((x) => x.s));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 版面体检（构建期自检：重叠 / 出界 / 过小 / 覆盖率）
 * ------------------------------------------------------------------ */
export function inspectSlots(slots, page, opts = {}) {
  const issues = [];
  const base = slots.filter((s) => !s.over);
  const MIN = opts.minSide ?? 46;   // 归一化单位下最小边长（≈页宽 4.6%）

  for (const s of slots) {
    if (![s.x, s.y, s.w, s.h, s.aspect].every((v) => Number.isFinite(v))) {
      issues.push(`[几何缺失] ${s.id} x/y/w/h/aspect 不是有限数（手写 poly 忘了算外接矩形？）`);
      continue;
    }
    if (s.x < -1 || s.y < -1 || s.x + s.w > page.w + 1 || s.y + s.h > page.h + 1) {
      issues.push(`[出界] ${s.id} bbox=(${s.x},${s.y},${s.w},${s.h})`);
    }
    if (Math.min(s.w, s.h) < MIN) {
      issues.push(`[过小] ${s.id} ${s.w}×${s.h}`);
    }
    if (s.poly.length < 3) issues.push(`[多边形退化] ${s.id}`);
    for (let i = 0; i < s.poly.length; i++) {
      const [x1, y1] = s.poly[i], [x2, y2] = s.poly[(i + 1) % s.poly.length];
      if (Math.abs(x2 - x1) < 1e-6 && Math.abs(y2 - y1) < 1e-6) {
        issues.push(`[重复顶点] ${s.id}#${i}`); break;
      }
    }
  }

  // 重叠检测：仅在 bbox 交叠区域内采样（细斜切也能抓到）
  const N = 14;
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const a = base[i], b = base[j];
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      let hits = 0, tests = 0;
      for (let ix = 0; ix < N; ix++) {
        for (let iy = 0; iy < N; iy++) {
          const px = x0 + ((ix + 0.5) / N) * (x1 - x0);
          const py = y0 + ((iy + 0.5) / N) * (y1 - y0);
          tests++;
          if (pointInPoly([px, py], a.poly) && pointInPoly([px, py], b.poly)) hits++;
        }
      }
      const frac = hits / Math.max(1, tests);
      if (frac > 0.04) issues.push(`[重叠] ${a.id} × ${b.id} = ${(frac * 100).toFixed(0)}%`);
    }
  }

  // 覆盖率（含 gutter 与白边，故阈值放宽）
  if (opts.coverage !== false) {
    const GX = 46, GY = Math.round(46 * page.h / page.w);
    let inside = 0, total = 0;
    for (let ix = 0; ix < GX; ix++) {
      for (let iy = 0; iy < GY; iy++) {
        const px = ((ix + 0.5) / GX) * page.w;
        const py = ((iy + 0.5) / GY) * page.h;
        total++;
        if (base.some((s) => pointInPoly([px, py], s.poly))) inside++;
      }
    }
    const cov = inside / total;
    if (cov < (opts.minCoverage ?? 0.82)) issues.push(`[覆盖率低] ${(cov * 100).toFixed(1)}%`);
  }

  if (slots.length < 1) issues.push(`[无格子]`);
  return issues;
}

/** 归一化模板：补全 id/顺序/字段，供面板与 API 使用 */
export function finalizeTemplate(tpl) {
  const page = PAGE_PRESETS[tpl.ratio] || PAGE_PRESETS.a4;
  const reading = tpl.reading || (tpl.culture === 'jp' ? 'rtl' : 'ltr');
  // 手写多边形模板也要补齐外接矩形/面积/宽高比，否则图片位置与形状判定都会是 NaN
  const slots = tpl.slots
    ? tpl.slots.map((s, i) => normalizeSlot(s, i))
    : buildSlots(tpl.layout, { page, margin: tpl.margin, gutter: tpl.gutter, reading, insets: tpl.insets, orderByGeometry: tpl.orderByGeometry });
  return {
    id: tpl.id,
    name: tpl.name,
    culture: tpl.culture,
    reading,
    ratio: page.id,
    page: { w: page.w, h: page.h, kind: page.kind },
    frame: tpl.frame || (tpl.culture === 'kr' ? 'none' : 'ink'),
    tags: tpl.tags || [],
    intents: tpl.intents || [],
    density: tpl.density || densityOf(slots),
    desc: tpl.desc || '',
    margin: tpl.margin ?? DEFAULT_MARGIN,
    gutter: tpl.gutter ?? DEFAULT_GUTTER,
    slots: slots.map((s, i) => ({ ...s, order: s.order ?? i + 1 })),
  };
}

/** 由 poly 反推 x/y/w/h/aspect/area，并补默认属性 */
function normalizeSlot(s, i) {
  const poly = (s.poly || []).map(([x, y]) => [round2(x), round2(y)]);
  const b = polyBounds(poly);
  return {
    id: s.id || `p${i + 1}`,
    role: s.role || 'medium',
    poly,
    x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h),
    aspect: round2(b.w / Math.max(1, b.h)),
    area: round2((polyArea(poly) / 1e6) * 100),
    borderless: !!s.borderless,
    bleed: s.bleed || false,
    radius: s.radius || 0,
    note: s.note || '',
    rot: s.rot || 0,
    over: !!s.over,
    order: s.order ?? i + 1,
  };
}

function densityOf(slots) {
  const n = slots.length;
  if (n <= 3) return 'low';
  if (n <= 5) return 'mid';
  if (n <= 8) return 'high';
  return 'dense';
}
