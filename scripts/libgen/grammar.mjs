/**
 * grammar.mjs — 四类分镜的版式文法（生成「草稿」：盒子树 + 插入格计划）
 *
 * 叶子格先用 '#k' 占位（k = 拍子序号，按阅读顺序），版式算完几何之后再按节拍和格子形状换成真正的景别。
 *
 *   日漫  jp：右往左读的页漫。段落（2–5 段）里切格；斜切（ななめ割り）、出血（ぶち抜き）、
 *            插入格、通天竖格、L 形叠格；另有四格、跨页、整页插图。
 *   韩漫  kr：竖屏条漫。格高 = 停留时间，大块留白分隔；小格缩窄错位，大格撑满或左右出血；
 *            两格并排做对切 / 反应；动作条漫用细线框和小间距快剪。
 *   国风  cn：国风条漫（错落、立轴窄长格、题字竖条）、国风页漫（粗墨框、立轴竖切、题字区、武侠斜切）、
 *            横向长卷（从左往右展开）。
 *   通用 core：网格（含合并格）、自由切分、海报、整页插图、16:9 分镜表 / 宽银幕。
 *
 * 插入格计划 insetPlan：{ k, host, kind }
 *   kind = 'cutin'  某一拍做成压在前一格上的小插入格（k = 这一拍，host = 前一拍）
 *          'corner' 整页插图上的角格（k = 这一拍）
 *          'title'  国风题字区（不是一拍：k = null，压在 host 那一格上，读完 host 紧接着读）
 */
import { row, col, leaf, PAGE_PRESETS } from '../../lib/geometry.mjs';
import { clamp, round2 } from './rng.mjs';

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */
const sum = (a) => a.reduce((s, x) => s + x, 0);
const norm = (a) => { const t = sum(a) || 1; return a.map((x) => x / t); };
const r2 = (a) => a.map((x) => round2(x));

/** 把一组份额夹在 [lo, hi] 内（迭代几次再归一） */
function clampShares(shares, lo, hi = 1) {
  let s = norm(shares);
  for (let it = 0; it < 8; it++) s = norm(s.map((x) => clamp(x, lo, hi)));
  return s;
}

/** 所有「把 m 拆成 T 段、每段 1..kmax」的组合 */
function compositions(m, T, kmax) {
  const out = [];
  const rec = (left, parts) => {
    if (parts.length === T - 1) {
      if (left >= 1 && left <= kmax) out.push([...parts, left]);
      return;
    }
    const rest = T - parts.length - 1;
    for (let k = 1; k <= Math.min(kmax, left - rest); k++) rec(left - k, [...parts, k]);
  };
  if (T >= 1 && m >= T) rec(m, []);
  return out;
}

const argmax = (seq) => seq.reduce((m, s, i) => (s.w > seq[m].w ? i : m), 0);

const TALL_ROLES = ['full', 'back', 'low', 'shadow', 'impact', 'action', 'wide', 'establish', 'silence', 'inner'];
const DETAIL_ROLES = ['eye', 'hand', 'object', 'cutin', 'face'];
const QUIET_ROLES = ['silence', 'inner', 'shadow', 'back'];
const hasRole = (s, list) => s.beat.roles.some((r) => list.includes(r));

/** 叶子：'#k' 占位 + 这一拍的附加属性（出血 / 无框 / pad） */
const L = (ctx, k) => leaf('#' + k, { ...(ctx.leafOpts?.[k] || {}) });

/* ------------------------------------------------------------------ *
 * 分段（tier）
 * ------------------------------------------------------------------ */
function partitionTiers(seq, rng, o) {
  const m = seq.length;
  if (m === 1) return [[0]];
  const climax = argmax(seq);
  const Tt = clamp(Math.round(m / (o.perTier || 2.1)), o.Tmin || 1, o.Tmax || 5);
  const cands = [];
  for (let T = Math.max(1, o.Tmin || 1); T <= Math.min(m, o.Tmax || 5); T++) {
    for (const comp of compositions(m, T, o.kmax || 3)) {
      let p = 0, i = 0;
      for (const k of comp) {
        const g = seq.slice(i, i + k);
        const hasC = climax >= i && climax < i + k;
        if (hasC && k >= 3) p += 2.4;
        else if (hasC && k === 2) p += Math.min(...g.map((s) => s.w)) < 0.95 ? 0.3 : 0.85;
        for (const s of g) if (s.w >= 1.9 && k >= 3) p += 1.3;
        if (k === 1 && g[0].w < 0.9) p += 0.7;
        if (k === 4) p += o.allow4 ? 0.45 : 2.6;
        if (k >= 5) p += o.allow5 ? 1.1 : 9;
        i += k;
      }
      if (comp.length > 1 && new Set(comp).size === 1) p += o.gridOk ? -0.2 : 0.55;
      if (comp.length === 1 && m > 2) p += 3;
      p += Math.abs(comp.length - Tt) * 0.55;
      cands.push([comp, Math.exp(-p * 1.45)]);
    }
  }
  if (!cands.length) return seq.map((s, i) => [i]);
  const comp = rng.weighted(cands);
  const groups = [];
  let i = 0;
  for (const k of comp) { groups.push(seq.slice(i, i + k).map((s, j) => i + j)); i += k; }
  return groups;
}

/** 段高：段里最重的那一拍说了算，格多的段略高一点 */
function tierHeights(groups, seq, rng, o = {}) {
  const h = groups.map((g) => {
    const mx = Math.max(...g.map((k) => seq[k].w));
    return rng.jitter(Math.pow(mx, o.hPow ?? 0.95) * (1 + 0.06 * (g.length - 1)), 0.14);
  });
  const T = groups.length;
  const lo = o.hmin ?? (T <= 3 ? 0.16 : T === 4 ? 0.13 : 0.105);
  return clampShares(h, lo, o.hmax ?? 0.62);
}

/** 一段里的格宽 */
function tierWidths(g, seq, rng, o = {}) {
  const k = g.length;
  const ws = g.map((i) => rng.jitter(Math.pow(seq[i].w, o.wPow ?? 0.9), 0.1));
  const lo = o.wmin ?? (k === 2 ? 0.3 : k === 3 ? 0.22 : k === 4 ? 0.17 : 0.14);
  return clampShares(ws, lo, 1);
}

/** 斜切：slant 是「格高的倍数」，先挑实际横移 S（页宽单位）再除以段高 */
function slantOpts(ctx, rng, tierH, k) {
  if (!ctx.slant || !tierH || k < 2 || !rng.chance(ctx.slant.p)) return {};
  const S = rng.range(ctx.slant.min, ctx.slant.max);
  let s = clamp(S / tierH, 0.03, 0.24);
  if (rng.chance(0.5)) s = -s;
  ctx.flags.slant = (ctx.flags.slant || 0) + 1;
  const o = { slant: round2(s) };
  if (k >= 3 && rng.chance(ctx.slant.zigzag ?? 0.3)) { o.zigzag = true; ctx.flags.zigzag = true; }
  return o;
}

/**
 * 一段 → 盒子节点。三拍里有两拍相邻且轻时，可能叠成 L 形（一大格 + 两个叠起来的小格）。
 * @param {number[]} g 这段的拍子序号
 */
function tierNode(g, seq, rng, ctx, tierH) {
  if (g.length === 1) return L(ctx, g[0]);
  const k = g.length;
  if (k === 3 && ctx.allowL && rng.chance(ctx.pL ?? 0.33)) {
    const w = g.map((i) => seq[i].w);
    const lp = w[1] < 1.15 && w[2] < 1.15 ? 1 : w[0] < 1.15 && w[1] < 1.15 ? 0 : -1;
    if (lp >= 0) {
      const heavy = lp === 1 ? g[0] : g[2];
      const pair = lp === 1 ? [g[1], g[2]] : [g[0], g[1]];
      const wH = rng.range(0.5, 0.66);
      const stack = row(r2(clampShares(pair.map((i) => rng.jitter(seq[i].w, 0.15)), 0.36)), pair.map((i) => L(ctx, i)));
      const kids = lp === 1 ? [L(ctx, heavy), stack] : [stack, L(ctx, heavy)];
      ctx.flags.lshape = (ctx.flags.lshape || 0) + 1;
      return col(r2(lp === 1 ? [wH, 1 - wH] : [1 - wH, wH]), kids, slantOpts(ctx, rng, tierH, 2));
    }
  }
  return col(r2(tierWidths(g, seq, rng, ctx.widthOpts)), g.map((i) => L(ctx, i)), slantOpts(ctx, rng, tierH, k));
}

/** 斜切 / 出血 / 无框 / 插入格的倾向（按戏路冷热和画风） */
function styleFor(cls, culture) {
  const t = {
    hot: { slantP: 0.62, bleedP: 0.5, borderlessP: 0.05, insetP: 0.24, smin: 32, smax: 104 },
    cool: { slantP: 0.32, bleedP: 0.36, borderlessP: 0.22, insetP: 0.3, smin: 24, smax: 70 },
    soft: { slantP: 0.14, bleedP: 0.18, borderlessP: 0.32, insetP: 0.22, smin: 18, smax: 52 },
    mid: { slantP: 0.12, bleedP: 0.14, borderlessP: 0.12, insetP: 0.2, smin: 18, smax: 46 },
  }[cls];
  if (culture === 'core') return { ...t, slantP: t.slantP * 0.45, bleedP: t.bleedP * 0.7, insetP: t.insetP * 0.7 };
  if (culture === 'cn') return { ...t, slantP: t.slantP * 0.8, borderlessP: t.borderlessP + 0.1 };
  return t;
}

/** 选一拍做插入格：它前一拍要够重（插入格压在前一格上，读完那格紧接着读它） */
function pickInset(seq, rng, p) {
  if (seq.length < 3 || !rng.chance(p)) return -1;
  const cands = [];
  for (let k = 1; k < seq.length; k++) {
    if (seq[k - 1].w < 1.35) continue;
    if (!(hasRole(seq[k], DETAIL_ROLES) || seq[k].w < 0.85)) continue;
    cands.push(k);
  }
  return cands.length ? rng.pick(cands) : -1;
}

/* ------------------------------------------------------------------ *
 * 页漫（日漫 / 国风页漫 / 通用页）
 * ------------------------------------------------------------------ */
function pageDraft(ctx) {
  const { seq, rng } = ctx;
  const page = PAGE_PRESETS[ctx.ratio];
  const st = styleFor(ctx.cls, ctx.culture);
  ctx.flags = {};
  const usableH = page.h - 2 * ctx.margin;

  const insetK = ctx.noInset ? -1 : pickInset(seq, rng, ctx.insetP ?? st.insetP);
  const baseIdx = seq.map((s, i) => i).filter((i) => i !== insetK);
  const base = baseIdx.map((i) => seq[i]);

  // 出血（全页最重那一格）/ 无框（安静的拍）
  const climaxK = baseIdx[argmax(base)];
  ctx.leafOpts = {};
  const bleed = !ctx.noBleed && rng.chance(ctx.bleedP ?? st.bleedP);
  for (const k of baseIdx) {
    const o = {};
    if (bleed && k === climaxK) o.bleed = true;
    if (QUIET_ROLES.includes(seq[k].beat.roles[0]) && rng.chance(ctx.borderlessP ?? st.borderlessP)) o.borderless = true;
    if (Object.keys(o).length) ctx.leafOpts[k] = o;
  }
  ctx.slant = ctx.noSlant ? null : { p: ctx.slantP ?? st.slantP, min: st.smin, max: st.smax, zigzag: ctx.cls === 'hot' ? 0.38 : 0.18 };
  ctx.allowL = !ctx.noL;

  const m = base.length;
  const tierOpts = {
    kmax: ctx.kmax ?? (m >= 9 ? 4 : 3),
    allow4: ctx.allow4 ?? (m >= 8 || ['gag', 'montage'].includes(ctx.intent)),
    Tmin: ctx.Tmin ?? (m >= 7 ? 3 : m >= 3 ? 2 : 1),
    Tmax: ctx.Tmax ?? (m >= 9 ? 5 : m >= 6 ? 4 : 3),
    perTier: ctx.perTier ?? 2.1,
    gridOk: !!ctx.gridOk,
  };

  let tree = null;
  if (ctx.allowV !== false && m >= 4 && rng.chance(ctx.vP ?? 0.2)) tree = verticalSplit(ctx, baseIdx, tierOpts, usableH);
  if (!tree) {
    const groups = partitionTiers(base, rng, tierOpts).map((g) => g.map((j) => baseIdx[j]));
    const hs = tierHeights(groups, seq, rng, ctx.heightOpts);
    const tiers = groups.map((g, t) => tierNode(g, seq, rng, ctx, hs[t] * usableH));
    tree = groups.length === 1 ? tiers[0] : row(r2(hs), tiers);
    ctx.flags.tiers = groups.length;
    ctx.flags.perTier = groups.map((g) => g.length);
  }
  const insetPlan = [];
  if (insetK >= 0) { insetPlan.push({ k: insetK, host: insetK - 1, kind: 'cutin' }); ctx.flags.inset = true; }
  if (ctx.titleP && rng.chance(ctx.titleP)) {
    // 国风题字区：压在最重的那一格上
    insetPlan.push({ k: null, host: climaxK, kind: 'title' });
    ctx.flags.title = true;
  }
  if (Object.values(ctx.leafOpts).some((o) => o.bleed)) ctx.flags.bleed = true;
  if (Object.values(ctx.leafOpts).some((o) => o.borderless)) ctx.flags.borderless = true;
  return { layout: tree, insetPlan };
}

/**
 * 通天竖格：一拍占满一侧的整个高度（full），或者上面先放一两段整宽、下半页再分左右（partial）。
 * 阅读顺序：竖格所在那一侧先读（它是那一块的第一拍），另一侧从上往下。
 */
function verticalSplit(ctx, baseIdx, tierOpts, usableH) {
  const { seq, rng } = ctx;
  const m = baseIdx.length;
  const sideOpts = { ...tierOpts, kmax: 2, allow4: false, Tmin: 2, Tmax: 4, perTier: 1.5 };
  const wT = rng.range(0.3, 0.46);
  const fits = (k, minW) => hasRole(seq[k], TALL_ROLES) && seq[k].w >= minW;
  const tierBlock = (ks, share) => {
    const groups = partitionTiers(ks.map((k) => seq[k]), rng, sideOpts).map((g) => g.map((j) => ks[j]));
    if (groups.length < 2) return null;
    const hs = tierHeights(groups, seq, rng, { hmin: 0.2 });
    return row(r2(hs), groups.map((g, t) => tierNode(g, seq, rng, ctx, hs[t] * share * usableH)));
  };

  // partial：前 t 拍放整宽段，第 t 拍是竖格，后面的拍在竖格旁边
  if (m >= 5 && rng.chance(0.45)) {
    const t = rng.int(1, Math.min(2, m - 3));
    const tallK = baseIdx[t];
    if (fits(tallK, 1.0)) {
      const topKs = baseIdx.slice(0, t);
      const sideKs = baseIdx.slice(t + 1);
      const topShare = clamp(rng.range(0.24, 0.4) * (t === 2 ? 1.2 : 1), 0.22, 0.48);
      const topGroups = partitionTiers(topKs.map((k) => seq[k]), rng, { ...tierOpts, Tmin: 1, Tmax: 2, kmax: 3 }).map((g) => g.map((j) => topKs[j]));
      const topH = tierHeights(topGroups, seq, rng, { hmin: 0.3 });
      const side = tierBlock(sideKs, 1 - topShare);
      if (side) {
        const topNodes = topGroups.map((g, i) => tierNode(g, seq, rng, ctx, topH[i] * topShare * usableH));
        const block = col(r2([wT, 1 - wT]), [L(ctx, tallK), side]);
        ctx.flags.vsplit = 'partial';
        ctx.flags.tiers = topGroups.length + 1;
        return row(r2([...topH.map((h) => h * topShare), 1 - topShare]), [...topNodes, block]);
      }
    }
  }
  // full：第一拍（先读的一侧）或最后一拍（后读的一侧）是竖格
  const firstOK = fits(baseIdx[0], 1.15);
  const lastOK = fits(baseIdx[m - 1], 1.0);
  if (!firstOK && !lastOK) return null;
  const useFirst = firstOK && (!lastOK || rng.chance(0.65));
  const tallK = useFirst ? baseIdx[0] : baseIdx[m - 1];
  const side = tierBlock(baseIdx.filter((k) => k !== tallK), 1);
  if (!side) return null;
  ctx.flags.vsplit = 'full';
  ctx.flags.tiers = 1;
  return useFirst ? col(r2([wT, 1 - wT]), [L(ctx, tallK), side]) : col(r2([1 - wT, wT]), [side, L(ctx, tallK)]);
}

/* ------------------------------------------------------------------ *
 * 竖屏条漫（韩漫条漫 / 国风条漫 / 通用竖屏）
 * ------------------------------------------------------------------ */
function stripDraft(ctx) {
  const { seq, rng } = ctx;
  const page = PAGE_PRESETS[ctx.ratio];
  ctx.flags = { strip: true };
  const n = seq.length;
  const guofeng = ctx.culture === 'cn';
  const fast = ctx.frame === 'hairline' && ctx.cls === 'hot';

  // 一行一格，或两 / 三格并排（对切、反应、蒙太奇）
  const units = [];
  const pairP = ctx.pairP ?? (['dialogue', 'romance', 'gag', 'court', 'work', 'investigate'].includes(ctx.intent) ? 0.42 : fast ? 0.45 : 0.2);
  for (let i = 0; i < n;) {
    if (i + 2 < n && ctx.intent === 'montage' && [0, 1, 2].every((d) => seq[i + d].w < 1.2) && rng.chance(0.35)) {
      units.push({ ks: [i, i + 1, i + 2], kind: 'tri' }); i += 3; continue;
    }
    if (i + 1 < n && seq[i].w < 1.15 && seq[i + 1].w < 1.15 && rng.chance(pairP)) {
      units.push({ ks: [i, i + 1], kind: 'pair' }); i += 2; continue;
    }
    units.push({ ks: [i], kind: 'one' }); i++;
  }
  if (units.length < 2 && n >= 2) return null;

  const minPanelH = guofeng ? 150 : 140;
  const rows = units.length;
  const maxGutter = Math.floor((page.h - 2 * ctx.margin - rows * minPanelH) / Math.max(1, rows - 1));
  if (maxGutter < 14) return null;
  ctx.gutter = Math.min(ctx.gutter, maxGutter);
  const usableH = page.h - 2 * ctx.margin - (rows - 1) * ctx.gutter;
  const hs = clampShares(units.map((u) => {
    const mx = Math.max(...u.ks.map((k) => seq[k].w));
    return rng.jitter(Math.pow(mx, 1.05) * (u.kind === 'one' ? 1 : 1.12), 0.14);
  }), minPanelH / usableH, 0.62);

  ctx.leafOpts = {};
  const W = page.w - 2 * ctx.margin;
  const altSides = ['dialogue', 'romance', 'court', 'work', 'climax'].includes(ctx.intent);
  let lastSide = rng.chance(0.5) ? 'l' : 'r';
  const sideFor = () => (altSides ? (lastSide === 'l' ? 'r' : 'l') : rng.weighted([['l', 1], ['r', 1], ['c', guofeng ? 0.5 : 0.8]]));

  const nodes = units.map((u, ui) => {
    const H = hs[ui] * usableH;
    if (u.kind !== 'one') {
      const ws = clampShares(u.ks.map((k) => rng.jitter(seq[k].w, 0.12)), u.kind === 'tri' ? 0.24 : 0.34, 1);
      const o = {};
      if ((fast || ctx.cls === 'hot') && rng.chance(0.45)) {
        o.slant = round2((rng.chance(0.5) ? 1 : -1) * clamp(rng.range(30, 80) / H, 0.04, 0.22));
        ctx.flags.slant = (ctx.flags.slant || 0) + 1;
      }
      ctx.flags.pairs = (ctx.flags.pairs || 0) + 1;
      return col(r2(ws), u.ks.map((k) => L(ctx, k)), o);
    }
    const k = u.ks[0], s = seq[k];
    const o = {};
    let padL = 0, padR = 0;
    if (s.w >= 1.6) {
      if (['impact', 'action', 'low', 'establish', 'panorama'].includes(s.beat.roles[0]) && rng.chance(ctx.bleedP ?? (ctx.cls === 'hot' ? 0.55 : 0.3))) {
        o.bleed = ['left', 'right'];
        ctx.flags.bleed = true;
      } else if (guofeng && rng.chance(0.3)) {
        // 国风立轴：大格反而收窄成竖长的「挂轴」，两边大留白
        const p = rng.range(0.12, 0.24);
        padL = p * rng.range(0.6, 1.4); padR = p * rng.range(0.6, 1.4);
        ctx.flags.hanging = (ctx.flags.hanging || 0) + 1;
      }
    } else if (s.w < 1.0) {
      const mode = sideFor();
      const p = rng.range(guofeng ? 0.18 : 0.16, guofeng ? 0.36 : 0.32);
      if (mode === 'l') padR = p; else if (mode === 'r') padL = p; else { padL = p / 2; padR = p / 2; }
      if (mode !== 'c') lastSide = mode;
      ctx.flags.stagger = (ctx.flags.stagger || 0) + 1;
    } else if (rng.chance(guofeng ? 0.45 : 0.15)) {
      const p = rng.range(0.06, guofeng ? 0.2 : 0.12);
      const mode = altSides ? (lastSide === 'l' ? 'r' : 'l') : rng.pick(['l', 'r', 'c']);
      if (mode === 'l') padR = p; else if (mode === 'r') padL = p; else { padL = p / 2; padR = p / 2; }
      if (mode !== 'c') lastSide = mode;
      ctx.flags.stagger = (ctx.flags.stagger || 0) + 1;
    }
    // 太扁的格再收窄（竖屏上一条细线没法画）
    if (!o.bleed && (W * (1 - padL - padR)) / H > 4.6) {
      const extra = 1 - (4.4 * H) / W - padL - padR;
      if (extra > 0) { if (padL >= padR) padL += extra; else padR += extra; }
    }
    // 停顿：静默 / 揭示前多留一段白
    let padT = 0;
    if (ui > 0 && (QUIET_ROLES.includes(s.beat.roles[0]) || ['twist', 'release', 'truth', 'shock', 'freeze', 'reveal'].includes(s.beat.id)) && rng.chance(0.45)) {
      padT = round2(clamp(rng.range(30, 80) / page.h, 0.01, 0.045));
      ctx.flags.pause = (ctx.flags.pause || 0) + 1;
    }
    if (padL > 0.005 || padR > 0.005 || padT > 0) {
      o.pad = {};
      if (padL > 0.005) o.pad.left = round2(padL);
      if (padR > 0.005) o.pad.right = round2(padR);
      if (padT > 0) o.pad.top = padT;
    }
    if (Object.keys(o).length) ctx.leafOpts[k] = o;
    return L(ctx, k);
  });

  const insetPlan = [];
  if (guofeng && n >= 3 && ['scenery', 'inner', 'travel', 'silence', 'emotion', 'romance', 'magic', 'war'].includes(ctx.intent) && rng.chance(0.32)) {
    // 题字竖条压在最重的一格上
    const climax = argmax(seq);
    if (units.find((u) => u.ks.includes(climax))?.kind === 'one') {
      insetPlan.push({ k: null, host: climax, kind: 'title' });
      ctx.flags.title = true;
    }
  }
  return { layout: row(r2(hs), nodes), insetPlan };
}

/* ------------------------------------------------------------------ *
 * 横向：跨页 / 16:9 分镜表 / 国风长卷
 * ------------------------------------------------------------------ */
function landscapeDraft(ctx) {
  const { seq, rng } = ctx;
  ctx.flags = { landscape: true };
  ctx.leafOpts = {};
  const n = seq.length;
  const page = PAGE_PRESETS[ctx.ratio];
  if (ctx.family === 'cn-longscroll') {
    // 长卷：从左往右一段段展开，某些段上下叠两格
    const segs = [];
    for (let i = 0; i < n;) {
      if (i + 1 < n && seq[i].w < 1.3 && seq[i + 1].w < 1.3 && rng.chance(0.38)) { segs.push([i, i + 1]); i += 2; }
      else { segs.push([i]); i++; }
    }
    if (segs.length < 2) return null;
    const ws = clampShares(segs.map((g) => rng.jitter(Math.max(...g.map((k) => seq[k].w)), 0.15)), 0.12, 0.5);
    const nodes = segs.map((g) => (g.length === 1 ? L(ctx, g[0])
      : row(r2(clampShares(g.map((k) => rng.jitter(seq[k].w, 0.15)), 0.3)), g.map((k) => L(ctx, k)))));
    const o = rng.chance(0.25) ? { slant: round2((rng.chance(0.5) ? 1 : -1) * rng.range(0.06, 0.14)) } : {};
    if (o.slant) ctx.flags.slant = 1;
    ctx.flags.segments = segs.length;
    const insetPlan = [];
    if (rng.chance(0.35)) {
      const climax = argmax(seq);
      if (segs.find((g) => g.includes(climax))?.length === 1) { insetPlan.push({ k: null, host: climax, kind: 'title' }); ctx.flags.title = true; }
    }
    return { layout: col(r2(ws), nodes, o), insetPlan };
  }
  // 跨页 / 分镜表：1–3 段，每段多格
  const usableH = page.h - 2 * ctx.margin;
  const groups = partitionTiers(seq, rng, {
    kmax: ctx.kmax ?? 4, allow4: true, allow5: n >= 9, Tmin: n >= 7 ? 2 : 1, Tmax: n >= 4 ? 3 : 2,
    perTier: ctx.perTier ?? 3, gridOk: !!ctx.gridOk,
  });
  const hs = tierHeights(groups, seq, rng, { hmin: groups.length === 3 ? 0.22 : 0.28 });
  ctx.slant = ctx.noSlant ? null : { p: ctx.cls === 'hot' ? 0.5 : 0.18, min: 20, max: 60, zigzag: 0.25 };
  ctx.allowL = !ctx.noL;
  ctx.widthOpts = { wmin: 0.12 };
  const tiers = groups.map((g, t) => tierNode(g, seq, rng, ctx, hs[t] * usableH));
  ctx.flags.tiers = groups.length;
  ctx.flags.perTier = groups.map((g) => g.length);
  return { layout: groups.length === 1 ? tiers[0] : row(r2(hs), tiers), insetPlan: [] };
}

/* ------------------------------------------------------------------ *
 * 通用：自由切分（BSP）与网格（份额吸到 1/4、1/3、1/2）
 * ------------------------------------------------------------------ */
function bspDraft(ctx) {
  const { seq, rng } = ctx;
  ctx.flags = { bsp: true };
  ctx.leafOpts = {};
  const page = PAGE_PRESETS[ctx.ratio];
  const snap = ctx.family === 'core-grid';
  const SNAPS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
  const build = (ks, dir, depth, w, h) => {
    if (ks.length === 1) return L(ctx, ks[0]);
    const aspect = w / h;
    let d = dir;
    if (aspect > 1.55) d = 'v';
    else if (aspect < 0.62) d = 'h';
    else if (depth > 0 && rng.chance(0.25)) d = d === 'h' ? 'v' : 'h';
    const parts = ks.length >= 4 && rng.chance(snap ? 0.45 : 0.3) ? 3 : 2;
    // 按分量把连续的拍切成几块
    const total = sum(ks.map((k) => seq[k].w));
    const cuts = [];
    let acc = 0, p = 1;
    for (let i = 0; i < ks.length - 1 && cuts.length < parts - 1; i++) {
      acc += seq[ks[i]].w;
      if (acc >= (total * p) / parts * rng.range(0.82, 1.18) || ks.length - 1 - i <= parts - 1 - cuts.length) { cuts.push(i + 1); p++; }
    }
    const groups = [];
    let st = 0;
    for (const c of [...cuts, ks.length]) { if (c > st) groups.push(ks.slice(st, c)); st = c; }
    if (groups.length < 2) return L(ctx, ks[0]);
    let ws = norm(groups.map((g) => rng.jitter(Math.pow(sum(g.map((k) => seq[k].w)), 0.85), 0.12)));
    if (snap) {
      ws = groups.length === 2
        ? (() => { const a = SNAPS.reduce((b, x) => (Math.abs(x - ws[0]) < Math.abs(b - ws[0]) ? x : b), 0.5); return [a, 1 - a]; })()
        : ws.map(() => 1 / groups.length);
      ctx.flags.grid = true;
    } else ws = clampShares(ws, 0.24, 0.8);
    const kids = groups.map((g, gi) => (d === 'h' ? build(g, 'v', depth + 1, w, h * ws[gi]) : build(g, 'h', depth + 1, w * ws[gi], h)));
    return d === 'h' ? row(r2(ws), kids) : col(r2(ws), kids);
  };
  const W = page.w - 2 * ctx.margin, H = page.h - 2 * ctx.margin;
  return { layout: build(seq.map((s, i) => i), W / H > 1.2 ? 'v' : 'h', 0, W, H), insetPlan: [] };
}

/* ------------------------------------------------------------------ *
 * 整页插图 + 角格 / 海报（标题带 + 大图 + 一排小格）
 * ------------------------------------------------------------------ */
function splashDraft(ctx) {
  const { seq } = ctx;
  ctx.flags = { splash: true, bleed: true };
  const climax = argmax(seq);
  const others = seq.map((s, i) => i).filter((i) => i !== climax);
  if (others.length > 2) return null;
  ctx.leafOpts = { [climax]: { bleed: true } };
  if (others.length) ctx.flags.inset = true;
  return { layout: L(ctx, climax), insetPlan: others.map((k) => ({ k, host: climax, kind: 'corner' })) };
}

function posterDraft(ctx) {
  const { seq, rng } = ctx;
  ctx.flags = { poster: true };
  ctx.leafOpts = {};
  const n = seq.length;
  if (n < 2 || n > 5) return null;
  const climax = argmax(seq);
  if (climax === 0) return null;
  const between = seq.map((s, i) => i).filter((i) => i > 0 && i < climax);
  const below = seq.map((s, i) => i).filter((i) => i > climax);
  if (between.length > 1 || below.length > 3) return null;
  const bands = [], ws = [];
  if (rng.chance(0.6)) ctx.leafOpts[0] = { borderless: true };
  bands.push(L(ctx, 0)); ws.push(rng.range(0.14, 0.3));
  if (between.length) { bands.push(L(ctx, between[0])); ws.push(rng.range(0.14, 0.22)); }
  if (rng.chance(0.5)) { ctx.leafOpts[climax] = { bleed: ['left', 'right'] }; ctx.flags.bleed = true; }
  bands.push(L(ctx, climax)); ws.push(rng.range(0.42, 0.62));
  if (below.length) {
    bands.push(below.length === 1 ? L(ctx, below[0])
      : col(r2(clampShares(below.map((k) => rng.jitter(seq[k].w, 0.1)), 0.25)), below.map((k) => L(ctx, k))));
    ws.push(rng.range(0.16, 0.26));
  }
  return { layout: row(r2(norm(ws)), bands), insetPlan: [] };
}

/* ------------------------------------------------------------------ *
 * 四格（方形 2×2 / 竖四格 / 两条并排的八格）
 * ------------------------------------------------------------------ */
function fourKomaDraft(ctx) {
  const { seq, rng } = ctx;
  ctx.flags = { koma4: true };
  ctx.leafOpts = {};
  const jr = (k) => r2(clampShares(Array.from({ length: k }, () => rng.jitter(1, rng.chance(0.5) ? 0.14 : 0.02)), 0.18));
  if (ctx.ratio === 'square') {
    if (seq.length !== 4) return null;
    return { layout: row(jr(2), [col(jr(2), [L(ctx, 0), L(ctx, 1)]), col(jr(2), [L(ctx, 2), L(ctx, 3)])]), insetPlan: [] };
  }
  if (seq.length === 4) return { layout: row(jr(4), [0, 1, 2, 3].map((k) => L(ctx, k))), insetPlan: [] };
  if (seq.length !== 8) return null;
  const a = row(jr(4), [0, 1, 2, 3].map((k) => L(ctx, k)));
  const b = row(jr(4), [4, 5, 6, 7].map((k) => L(ctx, k)));
  return { layout: col([1, 1], [a, b]), insetPlan: [] };
}

export const DRAFTERS = {
  page: pageDraft,
  strip: stripDraft,
  landscape: landscapeDraft,
  bsp: bspDraft,
  splash: splashDraft,
  poster: posterDraft,
  koma4: fourKomaDraft,
};
