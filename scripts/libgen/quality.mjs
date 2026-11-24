/**
 * quality.mjs — 生成模板的体检与去重
 *
 * 体检比 scripts/validate.mjs 更严：除了不重叠 / 不出界 / 覆盖率，还要求
 *   · 最小边 ≥ 64（条漫 ≥ 90），格子不能细成一条线；
 *   · 宽高比：页漫 0.28–4.6、条漫 0.35–4.8、插入格 0.3–3.5（不许细成一条）；
 *   · 斜切格上下两条边都 ≥ 70 且长短比 ≥ 0.4（不许切成三角片）；
 *   · 插入格完整压在它的宿主格里、不压到别的格子、不盖掉宿主四成以上。
 * 去重：两套模板格数相同、每个格子四个顶点（按页宽页高归一）的平均位移 < 2.8%、最大位移 < 9%，
 *       看起来就是同一套 —— 只留先生成的那一套。
 */
import { inspectSlots, pointInPoly, polyArea } from '../../lib/geometry.mjs';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function checkQuality(slots, page) {
  const scroll = page.kind === 'scroll';
  const issues = inspectSlots(slots, page, { minSide: scroll ? 90 : 64, minCoverage: scroll ? 0.55 : 0.72 });
  if (issues.length) return issues;
  const base = slots.filter((s) => !s.over);
  const total = base.reduce((a, s) => a + s.area, 0);
  for (const s of slots) {
    const aspect = s.w / Math.max(1, s.h);
    const [lo, hi] = s.over ? [0.3, 3.5] : scroll ? [0.35, 4.8] : [0.28, 4.6];
    if (aspect < lo || aspect > hi) return [`[宽高比] ${s.id} ${aspect.toFixed(2)}`];
    if (!s.over && s.area / total < (scroll ? 0.012 : 0.018)) return [`[太小] ${s.id} ${s.area}`];
    if (s.poly.length === 4 && !s.over) {
      const top = dist(s.poly[0], s.poly[1]), bot = dist(s.poly[3], s.poly[2]);
      if (Math.min(top, bot) < 70 || Math.min(top, bot) / Math.max(top, bot) < 0.4) return [`[斜切过头] ${s.id}`];
    }
  }
  return [];
}

/** 插入格：完整压在宿主里、不碰别的格子、不盖掉宿主太多 */
export function checkInset(inset, host, others) {
  if (!inset.poly.every((p) => pointInPoly(p, host.poly))) return '插入格出了宿主格';
  if (polyArea(inset.poly) > polyArea(host.poly) * 0.38) return '插入格盖掉宿主太多';
  for (const o of others) {
    if (o === host || o.over) continue;
    if (inset.poly.some((p) => pointInPoly(p, o.poly))) return '插入格压到别的格子';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 去重
 * ------------------------------------------------------------------ */
const GROUP = { a4: 'portrait', b5: 'portrait', p34: 'portrait', square: 'square', wide: 'wide', strip: 'strip', tall: 'tall', scroll: 'scroll' };

/** 指纹：按阅读顺序，每格 4 个顶点（不足 4 个补最后一个）归一到 0..1 */
export function fingerprint(slots, page, ratio) {
  const v = [];
  for (const s of [...slots].sort((a, b) => a.order - b.order)) {
    const pts = s.poly.length >= 4 ? s.poly.slice(0, 4) : [...s.poly, ...Array(4 - s.poly.length).fill(s.poly[s.poly.length - 1])];
    for (const [x, y] of pts) v.push(x / page.w, y / page.h);
  }
  const overs = slots.filter((s) => s.over).length;
  return { key: `${GROUP[ratio] || ratio}|${slots.length}|${overs}`, v: Float64Array.from(v) };
}

export function isNearDuplicate(a, b, meanTol = 0.028, maxTol = 0.09) {
  if (a.v.length !== b.v.length) return false;
  let s = 0, mx = 0;
  for (let i = 0; i < a.v.length; i++) {
    const d = Math.abs(a.v[i] - b.v[i]);
    s += d;
    if (d > mx) mx = d;
    if (mx >= maxTol) return false;
  }
  return s / a.v.length < meanTol;
}

export class DedupeIndex {
  constructor() { this.groups = new Map(); }
  has(fp) {
    const g = this.groups.get(fp.key);
    return !!g && g.some((x) => isNearDuplicate(fp, x));
  }
  add(fp) {
    if (!this.groups.has(fp.key)) this.groups.set(fp.key, []);
    this.groups.get(fp.key).push(fp);
  }
}
