/**
 * 全自动模式的可测试内核（纯函数，不碰 DOM、不发请求）。
 *
 * 为什么单独一层：全自动是「多步骤 + 花钱 + 不可中途撤销」的功能，
 * 页数怎么估、步骤有哪些、要生成多少张图，这些一旦算错就是真金白银。
 * 所以规则全部放在这里，由 scripts/test-units.mjs 覆盖。
 */

/** 一页大概装多少字的剧情（中文）。日式页漫一页 5–8 格，正文通常 200–350 字。 */
export const CHARS_PER_PAGE = 260;

/** 单页最多几页（防止粘贴一整本小说把自己烧穿） */
export const MAX_AUTO_PAGES = 12;

/** 一格里最长放多少字的台词/旁白（与 aiWriteLines 的约束一致） */
export const MAX_LINE_CHARS = 40;

/**
 * 估计「这段全文该分成几页、每页几格」。
 * 只做保守估计：宁可多一页，不要把 20 格的戏压进 8 格。
 */
export function estimateLayout(text, opts = {}) {
  const charsPerPage = Math.max(80, Number(opts.charsPerPage) || CHARS_PER_PAGE);
  const panelsPerPage = Math.max(2, Math.min(12, Number(opts.panelsPerPage) || 6));
  const maxPages = Math.max(1, Number(opts.maxPages) || MAX_AUTO_PAGES);
  const text2 = String(text || '').replace(/\s+/g, '');
  const chars = text2.length;
  const rawPages = Math.max(1, Math.ceil(chars / charsPerPage));
  const pages = Math.min(maxPages, rawPages);
  const clamped = rawPages > maxPages;
  return {
    chars,
    pages,
    panelsPerPage,
    panels: pages * panelsPerPage,
    clamped,
    note: clamped
      ? `全文 ${chars} 字，按每页约 ${charsPerPage} 字需要 ${rawPages} 页，已按上限收到 ${pages} 页（避免一次花太多）`
      : `全文 ${chars} 字 → ${pages} 页 × 约 ${panelsPerPage} 格 ≈ ${pages * panelsPerPage} 格`,
  };
}

/** 把全文均分成 pages 份（按句子边界切，不切在句子中间） */
export function splitTextIntoPages(text, pages) {
  const n = Math.max(1, Number(pages) || 1);
  const src = String(text || '').trim();
  if (!src) return Array.from({ length: n }, () => '');
  // 先按句末标点切成句子，再按字数均分
  const sentences = src.split(/(?<=[。！？!?；;\n])/).filter((s) => s.trim());
  if (!sentences.length) return Array.from({ length: n }, () => src);
  const total = sentences.reduce((a, s) => a + s.length, 0);
  const target = total / n;
  const out = [];
  let buf = '';
  let idx = 0;
  for (const s of sentences) {
    if (idx < n - 1 && buf.length + s.length > target * (out.length + 1) * 1.05) {
      out.push(buf.trim());
      buf = '';
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  while (out.length < n) out.push('');
  return out.slice(0, n);
}

/**
 * 一次自动运行要做哪些步骤（只描述，不执行）—— 用于开场告诉用户「接下来会发生什么」，
 * 也用于测试断言步骤顺序。
 *
 * mode: 'story'（分镜全自动） | 'full'（真正全自动）
 */
export function buildAutoSteps({ mode = 'story', pages = 1, panelsPerPage = 6 } = {}) {
  const steps = [
    { key: 'estimate', label: `估算页数：${pages} 页 × 约 ${panelsPerPage} 格`, cost: 'free' },
  ];
  for (let i = 1; i <= pages; i++) {
    steps.push({ key: `plan-${i}`, label: `第 ${i} 页：挑版式 + 切成格`, cost: 'llm' });
    steps.push({ key: `prompt-${i}`, label: `第 ${i} 页：逐格写生图提示词（AI 优化过的）`, cost: 'llm' });
  }
  if (mode === 'full') {
    for (let i = 1; i <= pages; i++) steps.push({ key: `line-${i}`, label: `第 ${i} 页：写台词/旁白 + 挂气泡`, cost: 'llm' });
    steps.push({ key: 'images', label: `生成全部图片（${pages * panelsPerPage} 张，最贵的一步）`, cost: 'image' });
  }
  return steps;
}

/** 这一页要生成哪些格的图（排除已经有图的） */
export function imageQueueForPage(panels, images = {}) {
  return (panels || [])
    .filter((p) => p && p.id)
    .filter((p) => !images[p.id])
    .map((p) => p.id);
}

/** 全部页要生成的图（逐页调用上面的函数后汇总） */
export function imageQueueAll(pagesOfPanels, imagesByPage = []) {
  const out = [];
  (pagesOfPanels || []).forEach((panels, i) => {
    for (const sid of imageQueueForPage(panels, imagesByPage[i] || {})) out.push({ page: i, slotId: sid });
  });
  return out;
}

/** 花钱预估：给确认弹窗用（保守上限，不承诺精确） */
export function estimateCostHint({ images = 0, llmCalls = 0 } = {}) {
  // 单价按常见国内服务商量级给区间，仅用于让人有心理准备
  const imgLow = images * 0.02;
  const imgHigh = images * 0.25;
  return {
    images,
    llmCalls,
    text: images
      ? `约 ${images} 张图，按常见服务商 ¥0.02–0.25/张估算，合计约 ¥${imgLow.toFixed(2)}–${imgHigh.toFixed(2)}（以你的服务商计费为准）`
      : '这一步不生成图片，只消耗文本 token',
  };
}
