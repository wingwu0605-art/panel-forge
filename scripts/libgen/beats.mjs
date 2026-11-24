/**
 * beats.mjs — 从戏路（intent）的叙事节拍出发，排出一页的「拍子序列」
 *
 * 每个生成的模板都先定「这一页讲什么」：取某条戏路的节拍（战斗 = 摆开架势 → 发起攻击 → 冲击瞬间 → …），
 * 按格数增删（格多就让交锋 / 对切 / 蒙太奇的中段拍重复，格少就删分量最轻的拍），
 * 每一拍带一个「画面分量」w：冲击 / 定场的拍分量大 → 格子大；反应 / 物件特写分量小 → 格子小。
 * 版式生成器再按 w 分配格子大小，最后按节拍给每格挑景别。这样每套模板都是能直接排戏的分镜，不是随机切块。
 */
import { INTENTS, ROLES } from '../../lib/taxonomy.mjs';

/** 景别类别 → 画面分量 */
const CLS_WEIGHT = { impact: 2.1, scene: 2.1, wide: 1.6, mid: 1.25, close: 1.0, detail: 0.72, reaction: 0.66, quiet: 1.1 };

/** 戏路的冷热（决定斜切、出血、留白的倾向） */
export function intentClass(intentId) {
  const c = INTENTS[intentId]?.cls;
  return c === 'hot' || c === 'cool' || c === 'soft' ? c : 'mid';
}

export function beatWeight(beat, intentId) {
  const r0 = beat.roles[0];
  const cls = ROLES[r0]?.cls;
  let w = CLS_WEIGHT[cls] ?? 1;
  if (r0 === 'impact') w = 2.9;
  else if (r0 === 'establish' || r0 === 'panorama') w = 2.2;
  else if (r0 === 'eye') w = 0.8;
  else if (r0 === 'action') w = 1.8;
  // 静默 / 风光 / 回忆：空镜和留白本身就是主角，格子要大
  if (['silence', 'scenery', 'inner', 'travel'].includes(intentId) && cls === 'quiet') w = 1.75;
  return w;
}

/**
 * @returns {{beat, idx, w, rep}[]} 长度 = n 的拍子序列（按阅读顺序）
 */
export function beatScript(intentId, n, rng) {
  const beats = INTENTS[intentId].beats;
  let seq = beats.map((b, i) => ({ beat: b, idx: i, w: beatWeight(b, intentId), rep: 0 }));
  const climaxIdx = seq.reduce((m, s, i) => (s.w > seq[m].w ? i : m), 0);

  if (n === 1) {
    seq = [seq[climaxIdx]];
  } else {
    // 格少：删最轻的拍（第一拍和高潮拍不删）
    while (seq.length > n) {
      let drop = -1;
      for (let i = 0; i < seq.length; i++) {
        if (i === 0 || seq[i].idx === climaxIdx) continue;
        if (drop < 0 || seq[i].w < seq[drop].w || (seq[i].w === seq[drop].w && rng.chance(0.5))) drop = i;
      }
      if (drop < 0) drop = seq.length - 1;
      seq.splice(drop, 1);
    }
    // 格多：让中段的拍重复（交锋来回、对话对切、蒙太奇的段落），复本紧跟在原拍后面
    let guard = 0;
    while (seq.length < n && guard++ < 200) {
      const mids = seq.map((s, i) => i).filter((i) => i > 0 && (i < seq.length - 1 || seq.length <= 2));
      const pool = mids.length ? mids : seq.map((s, i) => i);
      // 轻的拍（反应、特写、对话）更常被重复：这才像「来回」
      const i = rng.weighted(pool.map((k) => [k, 1 / Math.max(0.5, seq[k].w) + (seq[k].rep ? -0.35 : 0)]));
      const src = seq[i];
      const copy = { ...src, w: src.w * rng.range(0.72, 0.95), rep: src.rep + 1 };
      seq.splice(i + 1, 0, copy);
    }
  }
  return seq.map((s) => ({ ...s, w: rng.jitter(s.w, 0.12) }));
}

/** 这条戏路一页大概几格（density 决定） */
export function panelCountFor(intentId, family, rng) {
  const d = INTENTS[intentId]?.density || 'mid';
  const table = {
    low: [[2, 2], [3, 5], [4, 5], [5, 3], [6, 1]],
    mid: [[3, 2], [4, 4], [5, 5], [6, 4], [7, 2]],
    high: [[4, 2], [5, 4], [6, 5], [7, 4], [8, 3], [9, 1]],
    dense: [[5, 2], [6, 3], [7, 4], [8, 4], [9, 3], [10, 2], [11, 1]],
  }[d];
  return rng.weighted(table);
}
