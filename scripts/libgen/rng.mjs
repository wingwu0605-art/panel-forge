/**
 * rng.mjs — 可复现的随机数（同一个种子永远生成同一批模板，编号才稳定）
 */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** [lo, hi) 均匀 */
    range: (lo, hi) => lo + (hi - lo) * next(),
    /** [lo, hi] 整数 */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** 按权重挑：[[值, 权重], …] 或 {值: 权重} */
    weighted(entries) {
      const list = Array.isArray(entries) ? entries : Object.entries(entries);
      const total = list.reduce((s, [, w]) => s + Math.max(0, w), 0);
      let r = next() * total;
      for (const [v, w] of list) {
        r -= Math.max(0, w);
        if (r <= 0) return v;
      }
      return list[list.length - 1][0];
    },
    /** 乘性抖动：v × [1-k, 1+k] */
    jitter: (v, k) => v * (1 - k + 2 * k * next()),
    shuffle(arr) {
      const a2 = [...arr];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
  return rng;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const round2 = (v) => Math.round(v * 100) / 100;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
