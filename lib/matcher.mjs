/**
 * matcher.mjs — 本地规则引擎：剧情 → 分镜
 *
 * 五步流水线（全部确定性、离线、可复现）：
 *   ① 分词命中    26 戏路 × 1300+ 关键词，按词长加权，处理否定（「不要打斗」≠ 打斗）
 *   ② 场景/基调   8 个场景族推年代与画风；8 种基调推模板气质
 *   ③ 硬约束      用户说「竖屏/四格/跨页/封面/无框」→ 直接过滤模板，不打分
 *   ④ 节拍对齐    戏路自带 4–6 个叙事节拍，用加权 DP 贴到模板格子上（可留空）
 *   ⑤ 加权打分    意图 25% / 气质 12% / 节拍 26% / 格数 13% / 画风 10% / 画幅 5% / 节奏 3% / 基调 6%
 */
import {
  INTENTS, ROLES, STYLE_PACKS, CULTURE_HINTS, SCENES, TONES, DIRECTIVES, NEGATORS,
  COMMON_NEGATIVE, VOCAB_STATS, beatEn,
} from './taxonomy.mjs';
import { TEMPLATES } from './library.mjs';
import { ratioLabel } from './svg.mjs';
import { classifyShape } from './shapes.mjs';

export const RULES_VERSION = '2.0';
export const RULE_STATS = VOCAB_STATS;

const CJK_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十二: 12 };

/* 关键词权重：越长越具体，单字只做弱提示 */
function kwWeight(k) {
  const n = k.length;
  if (n <= 1) return 0.5;
  if (n === 2) return 1.0;
  if (n === 3) return 1.35;
  return 1.6;
}

/** 命中位置往前 3 个字内出现否定词 → 视为否定 */
function isNegated(text, idx) {
  const win = text.slice(Math.max(0, idx - 3), idx);
  return NEGATORS.some((n) => win.includes(n));
}

/* ------------------------------------------------------------------ *
 * ① 剧情解析
 * ------------------------------------------------------------------ */
export function analyzePlot(plot, opts = {}) {
  const raw = String(plot || '');
  const text = raw.toLowerCase();
  const chars = raw.replace(/\s/g, '').length;

  // ---- 戏路关键词 ----
  const scores = {};
  const hits = {};
  const negated = [];

  for (const [id, def] of Object.entries(INTENTS)) {
    let s = 0;
    const h = [];
    for (const kw of def.keywords) {
      const k = kw.toLowerCase();
      let idx = 0, count = 0;
      while ((idx = text.indexOf(k, idx)) !== -1 && count < 3) {
        count++;
        const neg = isNegated(text, idx);
        s += kwWeight(k) * (neg ? 0.15 : 1);
        if (neg) negated.push({ kw, intent: id });
        idx += k.length;
      }
      if (count) h.push(kw);
    }
    if (s > 0) { scores[id] = s; hits[id] = h; }
  }

  // ---- 引号密度 → 对话倾向（只认中日式引号与西文引号） ----
  const quoteChars = (raw.match(/[「『“"][^」』”"]{1,120}[」』”"]/g) || []).join('').length;
  const dialogueDensity = chars ? quoteChars / chars : 0;
  if (dialogueDensity > 0.12) {
    scores.dialogue = (scores.dialogue || 0) + 2 + dialogueDensity * 10;
    hits.dialogue = [...(hits.dialogue || []), '对话比例高'];
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ id, score: round(s), zh: INTENTS[id].zh, hits: [...new Set(hits[id])].slice(0, 6) }));
  const top = ranked[0]?.score || 1;
  const intents = ranked.map((r) => ({ ...r, conf: round(r.score / top) }));
  const primary = intents[0]?.id || 'daily';

  // ---- 格数期望 ----
  let panelTarget = null;
  const mNum = raw.match(/(\d{1,2})\s*(?:格|コマ|칸|panels?|p)\b/i);
  const mCjk = raw.match(/([一二两三四五六七八九十]{1,2})\s*格/);
  if (mNum) panelTarget = clamp(+mNum[1], 1, 16);
  else if (mCjk && CJK_NUM[mCjk[1]]) panelTarget = clamp(CJK_NUM[mCjk[1]], 1, 16);
  else if (chars) panelTarget = clamp(Math.round(chars / 34) + 2, 3, 12);
  else panelTarget = 5;
  const explicitPanel = !!(mNum || mCjk);

  const beatFloor = Math.min(INTENTS[primary]?.beats.length || 4, 8);
  if (!explicitPanel && panelTarget < beatFloor) panelTarget = beatFloor;

  // ---- 场景族 / 基调 / 硬约束 ----
  const scenes = [];
  for (const [key, def] of Object.entries(SCENES)) {
    const found = def.words.filter((w) => text.includes(w.toLowerCase()));
    if (found.length) scenes.push({ key, zh: def.zh, era: def.era, culture: def.culture, score: found.length, hits: found.slice(0, 4) });
  }
  scenes.sort((a, b) => b.score - a.score);

  const tones = [];
  for (const [key, def] of Object.entries(TONES)) {
    const found = def.words.filter((w) => text.includes(w.toLowerCase()));
    if (found.length) tones.push({ key, zh: def.zh, score: found.length, tags: def.tags, hits: found.slice(0, 4) });
  }
  tones.sort((a, b) => b.score - a.score);

  const directives = [];
  let hardKind = null;
  let hardFrame = null;
  for (const [key, def] of Object.entries(DIRECTIVES)) {
    const found = def.words.filter((w) => text.includes(w.toLowerCase()));
    if (!found.length) continue;
    directives.push({ key, zh: def.zh, kind: def.kind, hits: found.slice(0, 3) });
    if (def.kind === 'frame-none') hardFrame = 'none';
    else if (!hardKind) hardKind = def.kind;
  }

  // ---- 画风线索 ----
  const cultureHit = { jp: 0, cn: 0, kr: 0 };
  const cultureKeys = { jp: [], cn: [], kr: [] };
  for (const [c, list] of Object.entries(CULTURE_HINTS)) {
    for (const k of list) {
      if (text.includes(k.toLowerCase())) { cultureHit[c] += 1; cultureKeys[c].push(k); }
    }
  }
  if (scenes[0]?.culture) cultureHit[scenes[0].culture] += 1;
  const cultureSorted = Object.entries(cultureHit).sort((a, b) => b[1] - a[1]);
  const cultureHint = cultureSorted[0][1] > 0 ? cultureSorted[0][0] : null;

  // ---- 节奏 ----
  let pace = 'mid';
  if (/爆|冲|斩|轰|连击|快|急|追|闪|瞬间|一口气|猛地|突然|一把/.test(text)) pace = 'fast';
  if (/静|缓|沉默|无言|停顿|寂静|很久|慢慢|缓缓|轻轻|久久/.test(text)) pace = 'slow';

  // ---- 画幅线索 ----
  let ratioHint = hardKind;
  if (!ratioHint) {
    if (/条漫|竖屏|手机|滚动/.test(text)) ratioHint = 'scroll';
    else if (/跨页|双页|横版/.test(text)) ratioHint = 'spread';
    else if (/四格|方形/.test(text)) ratioHint = 'square';
  }

  const tags = [...new Set([
    ...(tones[0]?.tags || []),
    ...scenes.slice(0, 2).flatMap((s) => SCENE_TAGS[s.key] || []),
  ])];

  return {
    version: RULES_VERSION,
    chars,
    intents,
    primary,
    secondary: intents[1]?.id || null,
    tertiary: intents[2]?.id || null,
    panelTarget,
    explicitPanel,
    cultureHint,
    cultureKeys,
    sceneHint: scenes[0]?.key || null,
    sceneZh: scenes[0]?.zh || null,
    eraHint: scenes[0]?.era || null,
    scenes: scenes.slice(0, 3),
    toneHint: tones[0]?.key || null,
    toneZh: tones[0]?.zh || null,
    tones: tones.slice(0, 3),
    ambienceTags: tags,
    directives,
    hardFilters: { kind: hardKind, frame: hardFrame },
    ratioHint,
    pace,
    dialogueDensity: round(dialogueDensity),
    negated: negated.slice(0, 6),
    ruleStats: VOCAB_STATS,
  };
}

const SCENE_TAGS = {
  modern_city: ['都市', '对话', '中景'],
  school: ['日常', '校园', '四格'],
  ancient_cn: ['国风', '武侠', '仙侠'],
  fantasy: ['玄幻', '插画', '大格'],
  scifi: ['插画', '大格', '不对称'],
  horror_place: ['恐怖', '暗部'],
  rural: ['全景', '插画', '留白'],
};

/* ------------------------------------------------------------------ *
 * ④ 节拍对齐（加权 LCS / DP）
 * ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ *
 * ③ 硬约束过滤
 * ------------------------------------------------------------------ */
export function passesHardFilters(tpl, a) {
  const { kind, frame } = a.hardFilters || {};
  if (frame && tpl.frame !== frame) return false;
  if (!kind) return true;
  switch (kind) {
    case 'scroll': return tpl.page.kind === 'scroll';
    case 'spread': return tpl.page.kind === 'spread';
    case 'page': return tpl.page.kind === 'page';
    case 'square': return tpl.ratio === 'square';
    case 'splash': return tpl.slots.length <= 2;
    default: return true;
  }
}

/* ------------------------------------------------------------------ *
 * ⑤ 模板打分
 * ------------------------------------------------------------------ */
export function scoreTemplate(tpl, a, prefs = {}) {
  const why = [];
  const primary = a.primary;
  const secondary = a.secondary;
  const conf = new Map(a.intents.map((x) => [x.id, x.conf]));

  // A. 意图命中
  let intentScore = 0;
  if (tpl.intents.includes(primary)) { intentScore += 1; why.push(`戏路匹配「${INTENTS[primary].zh}」`); }
  if (secondary && tpl.intents.includes(secondary)) intentScore += 0.45 * (conf.get(secondary) || 0.5);
  if (a.tertiary && tpl.intents.includes(a.tertiary)) intentScore += 0.2;
  for (const it of tpl.intents) if (it !== primary && it !== secondary) intentScore += 0.08;
  intentScore = Math.min(1, intentScore);

  // B. 题材气质（wantTags 命中 − avoidTags 命中）＋ 基调/场景气质
  const want = new Set([...(INTENTS[primary].wantTags || []), ...(secondary ? INTENTS[secondary].wantTags || [] : [])]);
  const avoid = new Set([...(INTENTS[primary].avoidTags || []), ...(secondary ? INTENTS[secondary].avoidTags || [] : [])]);
  const tagHits = tpl.tags.filter((t) => want.has(t));
  const tagMiss = tpl.tags.filter((t) => avoid.has(t));
  const ambience = a.ambienceTags || [];
  const ambHits = tpl.tags.filter((t) => ambience.includes(t));
  let tagScore = 0.6 * clamp(tagHits.length / 3, 0, 1) + 0.4 * clamp(ambHits.length / 2, 0, 1) - tagMiss.length * 0.22;
  tagScore = clamp(tagScore, 0, 1);
  if (tagHits.length) why.push(`画面气质命中：${tagHits.slice(0, 4).join('、')}`);
  else if (ambHits.length) why.push(`基调契合：${a.toneZh || ''}${ambHits.length ? '（' + ambHits.slice(0, 3).join('、') + '）' : ''}`);

  // C. 节拍对齐
  const beats = INTENTS[primary].beats;
  const align = alignBeats(beats, tpl.slots);
  if (align.coverage >= 0.999) why.push(`节拍全中：${beats.length} 拍正好落在 ${tpl.slots.length} 格`);
  else if (align.coverage >= 0.6) why.push(`节拍命中 ${Math.round(align.coverage * 100)}%（${beats.length} 拍）`);

  // D. 格数贴合
  const n = tpl.slots.length;
  const panelFit = Math.exp(-Math.abs(n - a.panelTarget) / 2.4);

  // E. 画风
  const wantCulture = prefs.culture && prefs.culture !== 'all' ? prefs.culture : a.cultureHint;
  let cultureScore = 0.55;
  if (wantCulture) {
    if (tpl.culture === wantCulture) { cultureScore = 1; why.push(`画风体系：${STYLE_PACKS[wantCulture].zh}`); }
    else if (tpl.culture === 'core') cultureScore = 0.72;
    else cultureScore = 0.18;
  } else if (tpl.culture === 'core') cultureScore = 0.62;

  // F. 画幅
  let ratioScore = 0.6;
  const kind = tpl.page.kind;
  const wantKind = a.ratioHint;
  if (prefs.ratio && prefs.ratio !== 'auto') {
    ratioScore = tpl.ratio === prefs.ratio ? 1 : 0.35;
  } else if (wantKind === 'scroll') {
    ratioScore = kind === 'scroll' ? 1 : 0.12;
    if (kind === 'scroll') why.push('竖屏滚动画幅匹配');
  } else if (wantKind === 'spread') {
    ratioScore = kind === 'spread' ? 1 : 0.2;
  } else if (wantKind === 'square') {
    ratioScore = tpl.ratio === 'square' ? 1 : 0.3;
  } else if (wantKind === 'page') {
    ratioScore = kind === 'page' ? 1 : 0.3;
  }

  // G. 节奏
  let paceScore = 0.5;
  if (a.pace === 'fast') paceScore = ['high', 'dense'].includes(tpl.density) ? 1 : 0.35;
  if (a.pace === 'slow') paceScore = ['low', 'mid'].includes(tpl.density) ? 1 : 0.35;
  if (a.pace === 'fast' && paceScore === 1) why.push('高密度格子契合快节奏');

  // 权重自适应：显式给了画幅/画风时上调
  const explicitRatio = !!(prefs.ratio && prefs.ratio !== 'auto') || !!a.ratioHint;
  const explicitCulture = !!(prefs.culture && prefs.culture !== 'all') || !!a.cultureHint;
  const W = explicitRatio
    ? { intent: 0.24, tags: 0.10, beats: 0.26, panels: 0.13, culture: explicitCulture ? 0.12 : 0.09, ratio: explicitCulture ? 0.12 : 0.13, pace: 0.03, tone: 0.05 }
    : { intent: 0.25, tags: 0.12, beats: 0.26, panels: 0.13, culture: explicitCulture ? 0.12 : 0.10, ratio: 0.05, pace: 0.03, tone: 0.06 };

  const toneScore = clamp(ambHits.length / 2, 0, 1);

  const total =
    W.intent * intentScore + W.tags * tagScore + W.beats * align.score + W.panels * panelFit +
    W.culture * cultureScore + W.ratio * ratioScore + W.pace * paceScore + W.tone * toneScore;

  return {
    score: round(total * 100),
    why: [...new Set(why)].slice(0, 4),
    breakdown: {
      intent: round(intentScore), tags: round(tagScore), beats: round(align.score),
      panels: round(panelFit), culture: round(cultureScore), ratio: round(ratioScore),
      pace: round(paceScore), tone: round(toneScore),
    },
    align,
  };
}

/* ------------------------------------------------------------------ *
 * ④ 分镜表生成
 * ------------------------------------------------------------------ */
const GEN_SIZES = [
  [0.5, '576x1152'], [0.5625, '768x1344'], [0.6, '768x1280'], [0.6667, '832x1248'],
  [0.75, '896x1200'], [0.8, '1024x1280'], [1, '1024x1024'], [1.25, '1280x1024'],
  [1.3333, '1152x864'], [1.5, '1216x832'], [1.7778, '1344x768'], [2, '1280x640'],
  [2.5, '1280x512'], [3.5, '1344x384'],
];

export function genSize(aspect) {
  let best = GEN_SIZES[6], bd = Infinity;
  for (const [v, s] of GEN_SIZES) {
    const d = Math.abs(Math.log(aspect / v));
    if (d < bd) { bd = d; best = [v, s]; }
  }
  return best[1];
}

/**
 * 生成分镜表。llmPanels 可选：{ [slotId]: { beat, content, dialogue } } —— AI 导演的排戏结果
 */
/* ============================== 原文切分 ============================== */
const CLAUSE_SPLIT = /[。！？!?；;\n]+/;
const SUB_SPLIT = /[，,、]/;

/**
 * 把源文本切成子句（保持顺序）。
 * 先按句号/问号/叹号切；只有一句时再按逗号切（长句切成半句，别让一格吃掉整段）。
 */
export function splitClauses(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  let parts = t.split(CLAUSE_SPLIT).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = t.split(SUB_SPLIT).map((s) => s.trim()).filter(Boolean);
  return parts;
}

/**
 * 把子句分配到 n 个格子（按顺序，不重排、不编造）。
 * - 子句数 == 格数：一格一句
 * - 子句多：按字数均衡分组，多的并进最后一格
 * - 子句少：一句一格，后面的格子留空（由景别/节拍补节奏，不编剧情）
 */
export function assignSegments(parts, n) {
  const out = new Array(Math.max(0, n)).fill('');
  if (!parts.length || !n) return out;
  // 子句不够填满每一格时，继续按逗号/顿号切细（"雨夜的屋顶上，他缓缓拔出刀" → 两段），
  // 尽量让每格都能拿到原文，而不是只有前两格有内容
  let list = [...parts];
  for (let guard = 0; list.length < n && guard < 8; guard++) {
    const expanded = list.flatMap((p) => (SUB_SPLIT.test(p)
      ? p.split(SUB_SPLIT).map((x) => x.trim()).filter(Boolean)
      : [p]));
    if (expanded.length === list.length) break;
    list = expanded;
  }
  if (list.length === n) {
    list.forEach((p, i) => { out[i] = p; });
    return out;
  }
  if (list.length < n) {
    list.forEach((p, i) => { out[i] = p; });
    return out;
  }
  const total = list.reduce((s, p) => s + p.length, 0);
  const target = total / n;
  let i = 0;
  for (let k = 0; k < n; k++) {
    let acc = '';
    while (i < list.length) {
      const next = acc ? `${acc}，${list[i]}` : list[i];
      if (acc && next.length > target && k < n - 1) break;
      acc = next;
      i++;
    }
    out[k] = acc;
  }
  if (i < list.length) out[n - 1] = [out[n - 1], ...list.slice(i)].filter(Boolean).join('，');
  return out;
}

export function buildPlan(tpl, a, prefs = {}) {
  const primary = prefs.intent || a.primary;
  const beats = INTENTS[primary].beats;
  const align = alignBeats(beats, tpl.slots);
  const style = STYLE_PACKS[tpl.culture] || STYLE_PACKS.jp;
  const beatOf = new Map(align.pairs.map((p) => [p.slot, p.beat]));
  const pageW = prefs.pageWidth || 1600;
  const aiPanels = prefs.llmPanels || null;
  // 规则模式也要把原文落到每格：切开、按顺序分配，AI 没参与时 content 就是这一段
  const segs = assignSegments(splitClauses(prefs.plot || ''), tpl.slots.length);

  const panels = tpl.slots.map((s, idx) => {
    const role = ROLES[s.role] || ROLES.medium;
    const shape = classifyShape(s);
    const ai = aiPanels ? aiPanels[s.id] : null;
    const bi = beatOf.get(idx);
    const beat = bi == null ? null : beats[bi];
    const aspect = s.aspect;
    const px = { w: Math.round((s.w / tpl.page.w) * pageW), h: Math.round((s.h / tpl.page.w) * pageW) };

    const beatZh = ai?.beat || (beat ? beat.zh : '通用镜头');
    // 内容优先用 AI 的；没有 AI 就用这一格分到的原文句子
    const content = ai?.content || segs[idx] || '';
    const dialogue = ai?.dialogue || '';
    const hint = beat?.hint || role.hint;

    // 有内容就写进去；没有就干脆不出现 subject，别把占位符留在可复制的提示词里
    const subject = content ? `subject: ${content}` : '';

    const aspectTag = `aspect ratio ${ratioLabel(s.w, s.h).split(' ')[0]}`;
    const styleShort = style.prompt.split(',').slice(0, 4).join(',').trim();

    // 形状开头词放最前面：模型对开头 token 权重最高，先定构图再谈别的
    const promptEn = [
      shape.prefixEn,
      role.prompt,
      beat ? beatEn(primary, beat.id) : (ai?.beatEn || ''),
      subject,
      style.prompt,
      shape.suffixEn,
      aspectTag,
      'subject centered in the safe area, generous headroom and margin for cropping',
      'single panel, no text, no speech bubble, no panel border',
    ].filter(Boolean).join(', ');

    // 精简版：给有 token 上限的模型（MJ / 部分 API）
    const promptShort = [shape.prefixEn, role.prompt, subject, styleShort, aspectTag, 'no text']
      .filter(Boolean).join(', ');

    return {
      id: s.id,
      order: s.order,
      role: s.role,
      roleZh: role.zh,
      shot: role.shot,
      shotZh: role.zh,
      shape: {
        id: shape.id, zh: shape.zh, aspect: shape.aspect,
        prefixEn: shape.prefixEn, suffixEn: shape.suffixEn,
        prefixZh: shape.prefixZh || '', suffixZh: shape.suffixZh || '',
        negative: shape.negative, hintZh: shape.hintZh,
      },
      shapePrefix: shape.prefixEn,
      beat: ai?.beat || (beat?.zh || null),
      beatId: ai ? 'ai' : (beat?.id || null),
      beatHint: hint,
      composition: role.hint,
      content,
      dialogue,
      suggest: ai?.say || '',
      suggestAi: !!ai?.say,
      aspect: round(aspect),
      aspectLabel: ratioLabel(s.w, s.h),
      genSize: genSize(aspect),
      sizePx: px,
      areaPct: s.area,
      box: { x: s.x, y: s.y, w: s.w, h: s.h },
      poly: s.poly,
      clipPath: polyToClip(s.poly, tpl.page),
      promptEn,
      promptShort,
      promptEnRule: promptEn,
      promptZh: [
        shape.prefixZh,
        role.zh,
        beatZh,
        content ? `画面：${content}` : `画面：${hint || '按景别构图'}`,
        style.zh,
        dialogue ? '（台词不进画面，后期排字）' : '',
        shape.suffixZh,
        `画幅 ${ratioLabel(s.w, s.h)}`,
        '单格画面，不要文字，不要气泡，不要画框',
      ].filter(Boolean).join('，'),
      negative: dedupeTerms(shape.negative, style.negative, COMMON_NEGATIVE),
    };
  });

  return {
    template: {
      id: tpl.id, name: tpl.name, culture: tpl.culture, reading: tpl.reading,
      ratio: tpl.ratio, page: tpl.page, frame: tpl.frame, panels: tpl.slots.length,
      tags: tpl.tags, intents: tpl.intents, desc: tpl.desc,
    },
    intent: primary,
    intentZh: INTENTS[primary].zh,
    beatCoverage: align.coverage,
    beatQuality: align.quality,
    readingOrder: tpl.reading === 'rtl' ? '右 → 左，上 → 下' : tpl.reading === 'vertical' ? '上 → 下' : '左 → 右，上 → 下',
    style: {
      culture: tpl.culture, zh: style.zh, prompt: style.prompt,
      negative: `${style.negative}, ${COMMON_NEGATIVE}`, tip: style.tip,
    },
    pageWidth: pageW,
    panels,
    notes: [
      `共 ${tpl.slots.length} 格，阅读顺序：${tpl.reading === 'rtl' ? '从右往左' : tpl.reading === 'vertical' ? '由上往下' : '从左往右'}`,
      `建议整页导出宽度 ${pageW}px；每格给出像素尺寸与最接近的出图尺寸，可直接用于 AI 生图`,
      `每格提示词已含景别、构图意图与画风包；subject 处替换为你的角色/场景描述`,
    ],
  };
}

function polyToClip(poly, page) {
  return 'polygon(' + poly.map(([x, y]) => `${round((x / page.w) * 100)}% ${round((y / page.h) * 100)}%`).join(', ') + ')';
}

/* ------------------------------------------------------------------ *
 * 题材过滤（「我就喜欢日漫少年漫」这类需求）
 * 题材（少年/少女/恐怖…）混在 tags 里，和「大格/留白/斜切」这些版面标签并列，
 * 所以只认题材词，避免把「大格」当题材去匹配。
 * ------------------------------------------------------------------ */
export const GENRE_TAGS = ['少年', '少女', '青年', '日常', '搞笑', '恐怖', '悬疑', '回忆'];

export function isGenreTag(tag) {
  return GENRE_TAGS.includes(String(tag || ''));
}

/** genre='all' 或非法值 → 原样返回；命中为空时也退回原池，不让人面对空白 */
export function filterTemplatesByGenre(list, genre) {
  const g = String(genre || 'all');
  if (!g || g === 'all' || !isGenreTag(g)) return list;
  const hit = (list || []).filter((t) => Array.isArray(t.tags) && t.tags.includes(g));
  return hit.length ? hit : list;
}

export function matchTemplates(plot, opts = {}) {
  const a = analyzePlot(plot, opts);
  const limit = opts.limit ?? 12;
  let pool = opts.culture && opts.culture !== 'all'
    ? TEMPLATES.filter((t) => t.culture === opts.culture || (opts.includeCore !== false && t.culture === 'core'))
    : TEMPLATES;

  const genreApplied = !!(opts.genre && opts.genre !== 'all' && isGenreTag(opts.genre));
  if (genreApplied) pool = filterTemplatesByGenre(pool, opts.genre);

  // 硬约束先过滤；如果一个不剩（条件太苛刻），退回全量但标注
  const strict = pool.filter((t) => passesHardFilters(t, a));
  const hardFilterApplied = strict.length > 0 && strict.length < pool.length;
  if (strict.length > 0) pool = strict;

  const scored = pool.map((t) => {
    const r = scoreTemplate(t, a, opts);
    return {
      id: t.id, name: t.name, culture: t.culture, reading: t.reading, ratio: t.ratio,
      page: t.page, frame: t.frame, tags: t.tags, intents: t.intents, density: t.density,
      desc: t.desc, panels: t.slots.length,
      score: r.score, why: r.why, breakdown: r.breakdown,
      slots: t.slots.map((s) => ({ id: s.id, order: s.order, role: s.role })),
    };
  }).sort((x, y) => y.score - x.score);

  return {
    analysis: a,
    results: scored.slice(0, limit),
    total: scored.length,
    filtered: {
      applied: hardFilterApplied,
      kind: a.hardFilters.kind,
      frame: a.hardFilters.frame,
      kept: pool.length,
      note: hardFilterApplied ? '已按硬约束（画幅/边框）过滤模板' : null,
    },
  };
}

/** 长剧情 → 多页分镜序列 */
export function planStory(plot, opts = {}) {
  const a = analyzePlot(plot, opts);
  const maxPages = clamp(opts.maxPages || 3, 1, 8);
  const segments = splitSegments(plot, maxPages);
  const pages = segments.map((seg, i) => {
    const segA = i === 0 ? a : analyzePlot(seg, opts);
    const m = matchTemplates(seg, { ...opts, limit: 6 });
    const top = m.results[0];
    const tpl = TEMPLATES.find((t) => t.id === top.id);
    const plan = buildPlan(tpl, segA, opts);
    return { pageIndex: i + 1, segment: seg, analysis: segA, templateScore: top.score, plan };
  });
  return { pages, analysis: a, segmentCount: pages.length };
}

function splitSegments(plot, maxPages) {
  const text = String(plot || '').trim();
  if (!text) return [''];
  const budget = Math.max(90, Math.ceil(text.length / maxPages));
  if (text.length <= budget * 1.2) return [text];
  const parts = text.split(/(?<=[。！？!?…\n])/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur.length + p.length > budget && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, maxPages);
}

/* ------------------------------------------------------------------ */
/** 把多段逗号分隔的词表合并去重（负面词很容易重复） */
function dedupeTerms(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists.filter(Boolean)) {
    for (const raw of String(l).split(',')) {
      const t = raw.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out.join(', ');
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;
