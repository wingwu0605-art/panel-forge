/**
 * align.mjs — 节拍对齐（加权 LCS / DP）：把戏路的叙事节拍按阅读顺序贴到模板格子上
 *
 * 规则引擎打分（matcher.mjs）和模板生成器（scripts/gen-library.mjs）共用。
 * 只依赖 taxonomy，不依赖模板库。
 */
import { ROLES } from './taxonomy.mjs';

const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;
const CLS_OF = (role) => ROLES[role]?.cls || 'mid';

function affinity(beat, slot) {
  const pref = beat.roles || [];
  if (pref.includes(slot.role)) return 1;
  const cls = CLS_OF(slot.role);
  const prefCls = new Set(pref.map(CLS_OF));
  if (prefCls.has(cls)) return 0.55;
  return 0;
}

export function alignBeats(beats, slots) {
  const nb = beats.length, ns = slots.length;
  if (!nb || !ns) return { pairs: [], quality: 0, coverage: 0, score: 0 };

  const w = slots.map((s) => 1 + (s.area || 0) / 55);
  const V = beats.map((b) => slots.map((s, j) => affinity(b, s) * w[j]));

  const dp = Array.from({ length: nb + 1 }, () => new Float64Array(ns + 1));
  for (let i = nb - 1; i >= 0; i--) {
    for (let j = ns - 1; j >= 0; j--) {
      dp[i][j] = Math.max(V[i][j] + dp[i + 1][j + 1], dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs = [];
  let i = 0, j = 0;
  while (i < nb && j < ns) {
    const take = V[i][j] + dp[i + 1][j + 1];
    if (Math.abs(dp[i][j] - take) < 1e-9 && V[i][j] > 0) { pairs.push({ beat: i, slot: j, aff: V[i][j] / w[j] }); i++; j++; }
    else if (Math.abs(dp[i][j] - dp[i + 1][j]) < 1e-9) i++;
    else j++;
  }

  // 第二遍：没派上活的节拍补给空格子，但必须仍然合乎阅读顺序
  const usedBeats = new Set(pairs.map((p) => p.beat));
  const usedSlots = new Set(pairs.map((p) => p.slot));
  const orderOK = (bi, sj) => pairs.every((p) =>
    !(p.beat < bi && p.slot >= sj) && !(p.beat > bi && p.slot <= sj));

  for (let bi = 0; bi < nb; bi++) {
    if (usedBeats.has(bi)) continue;
    let best = -1, bestV = 0.25;
    for (let sj = 0; sj < ns; sj++) {
      if (usedSlots.has(sj)) continue;
      const v = affinity(beats[bi], slots[sj]);
      if (v > bestV && orderOK(bi, sj)) { bestV = v; best = sj; }
    }
    if (best >= 0) { pairs.push({ beat: bi, slot: best, aff: bestV }); usedBeats.add(bi); usedSlots.add(best); }
  }
  pairs.sort((a, b) => a.slot - b.slot);

  const coverage = pairs.length / nb;
  const quality = pairs.length ? pairs.reduce((s, p) => s + p.aff, 0) / pairs.length : 0;
  return {
    pairs,
    coverage: round(coverage),
    quality: round(quality),
    score: round(0.62 * coverage + 0.38 * quality),
  };
}

