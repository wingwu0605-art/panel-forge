/**
 * shapes.mjs — 格子形状 → 构图开头提示词
 *
 * 为什么需要它：生图模型不知道你的格子是三角形、竖长条还是小方格，
 * 它只会按「一张图」来构图，结果塞进异形格就被裁掉脑袋。
 * 这里给每一类格子配一段「开头提示词」+「收尾词」+「建议负面词」，
 * 作者把它粘到自己提示词的最前面，模型就会按格子形状来构图。
 *
 * 判定顺序：形状特征（三角/斜切/插入/出血）优先，其次按宽高比。
 */

export const SHAPES = {
  triangle: {
    zh: '三角格',
    when: '只有 3 个顶点',
    priority: 100,
    prefixEn: 'diagonal triangular composition, subject anchored to the lower corner, large empty diagonal wedge',
    suffixEn: 'crop to a triangle, one strong diagonal edge',
    negative: 'symmetric composition, centered subject, full frame evenly filled',
    hintZh: '三角格：主体压在角上，另一角留大面积空白。画满就浪费了这个形状。',
  },
  slant: {
    zh: '斜切格',
    when: '4 顶点但边是斜的（梯形/平行四边形）',
    priority: 90,
    prefixEn: 'skewed diagonal panel framing, tilted horizon, subject offset along the diagonal',
    suffixEn: 'tilted framing, dynamic skew',
    negative: 'perfectly straight horizon, symmetrical layout',
    hintZh: '斜切格：地平线可以歪，人物沿斜线摆。正面对称构图会把它压平。',
  },
  inset: {
    zh: '插入格',
    when: '压在别的格子上的小格',
    priority: 85,
    prefixEn: 'inset detail crop, extreme tight framing, isolated subject on plain background',
    suffixEn: 'overlaid detail, no border',
    negative: 'wide scene, multiple characters, busy background',
    hintZh: '插入格：只放一个细节（眼、手、刀锋、物件），背景几乎去掉。',
  },
  bleed: {
    zh: '出血格',
    when: '有边延伸到页面边缘',
    priority: 80,
    prefixEn: 'full-bleed edge-to-edge composition, subject may break the frame edge, no visible border',
    suffixEn: 'composition extends past the panel edge',
    negative: 'framed border, visible margins, contained composition',
    hintZh: '出血格：可以让人或物冲出画面边缘，气势最大，别画成规矩的框内构图。',
  },
  tall: {
    zh: '竖长格',
    when: '宽高比 < 0.72',
    priority: 70,
    prefixEn: 'vertical extreme framing, tall narrow crop, subject standing full height with headroom and footroom',
    suffixEn: 'vertical 9:16 crop',
    negative: 'horizontal composition, cropped head, cropped feet, wide background',
    hintZh: '竖长格：只放一个人或一条街景，别塞两个人的全身。',
  },
  wide: {
    zh: '横长全景格',
    when: '宽高比 > 2.3',
    priority: 65,
    prefixEn: 'extreme horizontal panorama, letterbox composition, layered foreground and background, strong left-to-right flow',
    suffixEn: 'ultra wide panoramic crop',
    negative: 'square crop, cropped left or right, centered single portrait',
    hintZh: '横长条：讲空间、追逐、群像最合适；人物可以画得很小。',
  },
  banner: {
    zh: '横幅格',
    when: '宽高比 1.55–2.3',
    priority: 60,
    prefixEn: 'wide horizontal framing, action flowing left to right, breathing space at both ends',
    suffixEn: 'wide 16:9 crop',
    negative: 'vertical crop, cramped framing',
    hintZh: '横幅格：适合两人对话或横向动作，左右两端留出气口。',
  },
  small: {
    zh: '小方格',
    when: '占页面积 < 7%',
    priority: 55,
    prefixEn: 'tight compact composition, single clear silhouette, simple background, readable at thumbnail size',
    suffixEn: 'small panel crop, minimal detail',
    negative: 'busy detail, multiple characters, tiny face, fine texture',
    hintZh: '小格：只放一个动作或一个表情。这个尺寸读者看不清细节。',
  },
  square: {
    zh: '近方格',
    when: '宽高比 0.85–1.18',
    priority: 50,
    prefixEn: 'centered square composition, single subject fills the frame, clean background',
    suffixEn: 'square crop',
    negative: 'wide panorama, off-center subject',
    hintZh: '近方格：最稳的叙事格，主体居中即可。',
  },
  grid: {
    zh: '常规格',
    when: '其它矩形格',
    priority: 10,
    prefixEn: 'balanced composition, clear focal point, readable silhouette',
    suffixEn: '',
    negative: 'cluttered composition, unclear subject',
    hintZh: '常规格：按景别正常构图。',
  },
};

export const SHAPE_IDS = Object.keys(SHAPES);

const isAxisAlignedRect = (poly) => {
  if (!poly || poly.length !== 4) return false;
  const ys = [...new Set(poly.map((p) => Math.round(p[1] * 10) / 10))];
  const xs = [...new Set(poly.map((p) => Math.round(p[0] * 10) / 10))];
  return xs.length === 2 && ys.length === 2;
};

/**
 * 判定一个格子的形状类别
 * @param {object} slot 模板格子（poly / w / h / area / over / bleed / borderless）
 * @returns {{id, zh, prefixEn, suffixEn, negative, hintZh, aspect, borderless}}
 */
export function classifyShape(slot) {
  const poly = slot.poly || [];
  const aspect = slot.w / Math.max(1, slot.h);
  const area = slot.area ?? 0;

  let id = 'grid';
  if (poly.length === 3) id = 'triangle';
  else if (slot.over) id = 'inset';
  else if (slot.bleed) id = 'bleed';
  else if (!isAxisAlignedRect(poly)) id = 'slant';
  else if (aspect < 0.72) id = 'tall';
  else if (aspect > 2.3) id = 'wide';
  else if (aspect >= 1.55) id = 'banner';
  else if (area > 0 && area < 7) id = 'small';
  else if (aspect >= 0.85 && aspect <= 1.18) id = 'square';
  else id = 'grid';

  const def = SHAPES[id];
  return {
    id,
    zh: def.zh,
    prefixEn: def.prefixEn,
    suffixEn: def.suffixEn,
    negative: def.negative,
    hintZh: def.hintZh,
    aspect: Math.round(aspect * 100) / 100,
    borderless: !!slot.borderless,
  };
}

/** 把一段「开头词」拼成可直接粘贴的片段（供作者自己写提示词时用） */
export function prefixSnippet(shapeId, { rolePrompt, stylePrompt } = {}) {
  const def = SHAPES[shapeId] || SHAPES.grid;
  return [def.prefixEn, rolePrompt, stylePrompt].filter(Boolean).join(', ');
}

/** 统计一个模板里出现了哪些形状（给 UI/文档展示） */
export function shapeSummary(slots) {
  const m = new Map();
  for (const s of slots) {
    const k = classifyShape(s).id;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([id, n]) => ({ id, zh: SHAPES[id].zh, count: n }))
    .sort((a, b) => b.count - a.count);
}
