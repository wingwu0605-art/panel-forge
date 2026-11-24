/**
 * label.mjs — 给生成的版式配景别、标签、戏路、名字和说明
 *
 * 名字、说明都由一组固定的短语拼成（i18n/strings.tsv 里每个短语都有英 / 日 / 印尼译文），
 * 界面翻译引擎按「·」「；」「、」切开逐段翻，所以几千套模板的名字和说明在四种语言里都能看。
 */
import { INTENTS, ROLES } from '../../lib/taxonomy.mjs';
import { alignBeats } from '../../lib/align.mjs';

/* ------------------------------------------------------------------ *
 * 景别：按节拍给的候选 + 格子形状
 * ------------------------------------------------------------------ */
const PREF = {
  over: ['cutin', 'eye', 'hand', 'object', 'face', 'close'],
  wide: ['panorama', 'establish', 'wide', 'group', 'overhead', 'silence', 'eye', 'two'],
  tall: ['full', 'back', 'low', 'shadow', 'action', 'impact', 'silence', 'wide'],
  big: ['impact', 'establish', 'panorama', 'wide', 'group', 'overhead', 'action', 'two', 'silence'],
  small: ['reaction', 'face', 'eye', 'hand', 'object', 'cutin', 'close'],
};
const FALLBACK = {
  over: 'cutin', wide: 'wide', tall: 'full', big: 'wide', small: 'reaction',
};

export function shapeKind(slot, avgArea) {
  if (slot.over) return 'over';
  const aspect = slot.w / Math.max(1, slot.h);
  const rel = slot.area / Math.max(0.01, avgArea);
  if (aspect > 2.3) return 'wide';
  if (aspect < 0.6) return 'tall';
  if (rel >= 1.7) return 'big';
  if (rel <= 0.55) return 'small';
  return null;
}

/** @param {object} s 拍子 {beat, rep}  @returns 景别 id */
export function pickRole(s, slot, avgArea) {
  const roles = s.beat.roles;
  const kind = shapeKind(slot, avgArea);
  // 重复的拍换一个候选，免得来回几格都是同一个景别
  const rot = s.rep ? [...roles.slice(s.rep % roles.length), ...roles.slice(0, s.rep % roles.length)] : roles;
  if (!kind) return rot[0];
  const hit = rot.find((r) => PREF[kind].includes(r));
  if (hit) return hit;
  // 节拍的候选都不合这个形状：插入格 / 极扁 / 极窄的格子以形状为准
  if (kind === 'over' || kind === 'wide' || kind === 'tall') return FALLBACK[kind];
  return rot[0];
}

/* ------------------------------------------------------------------ *
 * 标签
 * ------------------------------------------------------------------ */
const GENRE_BY_INTENT = {
  action: ['动作'], impact: ['冲击'], chase: ['动势'], emotion: ['情绪'], dialogue: ['对话'], reveal: ['反转'],
  suspense: ['悬疑'], horror: ['恐怖', '暗部'], romance: ['恋爱'], gag: ['搞笑'], inner: ['回忆'], montage: ['蒙太奇'],
  silence: ['静默'], daily: ['日常'], climax: ['对峙'], scenery: ['插画'], sport: ['动势'], food: ['日常'], war: ['群像'],
  court: ['对话'], work: ['对话'], medical: ['悬念'], magic: ['插画'], disaster: ['暗部'], investigate: ['悬疑'], travel: ['插画'],
};
const JP_LINE = (intent) => (['action', 'impact', 'chase', 'sport', 'war', 'magic', 'climax'].includes(intent) ? '少年'
  : ['romance', 'emotion', 'inner'].includes(intent) ? '少女'
    : ['suspense', 'horror', 'court', 'investigate', 'medical', 'disaster', 'reveal'].includes(intent) ? '青年' : null);
const CN_LINE = (intent) => (['action', 'war', 'chase', 'climax'].includes(intent) ? '武侠'
  : ['magic'].includes(intent) ? '仙侠' : ['court'].includes(intent) ? '宫斗'
    : ['daily', 'work', 'food'].includes(intent) ? '都市' : null);

/** 左右镜像对称（只看底格的外接框） */
function isSymmetric(slots, page) {
  const base = slots.filter((s) => !s.over);
  if (base.some((s) => s.poly.length !== 4)) return false;
  return base.every((a) => base.some((b) =>
    Math.abs(a.y - b.y) < 8 && Math.abs(a.h - b.h) < 8 && Math.abs(a.w - b.w) < 10 && Math.abs((page.w - a.x - a.w) - b.x) < 10));
}

export function deriveTags({ culture, family, intent, slots, page, flags, frame, roles }) {
  const out = [];
  const add = (...t) => { for (const x of t) if (x && !out.includes(x)) out.push(x); };
  const base = slots.filter((s) => !s.over);
  const n = slots.length;
  const scroll = page.kind === 'scroll';
  // 体系
  if (culture === 'cn') add('国风');
  if (scroll) add('条漫', '竖向');
  if (page.h / page.w >= 2.4) add('长条');
  if (family === 'jp-4koma' || family === 'cn-4koma') add('四格');
  if (family === 'jp-spread') add('跨页', '横向');
  if (family === 'cn-longscroll') add('横向', '长镜头');
  if (['jp-page', 'cn-page'].includes(family)) add('页漫');
  if (culture === 'core') add('通用');
  if (flags.grid) add('网格');
  // 形状特征
  const maxArea = Math.max(...base.map((s) => s.area));
  const avg = base.reduce((a, s) => a + s.area, 0) / base.length;
  if (flags.splash || (maxArea >= (scroll ? 22 : 32) && maxArea >= avg * 1.8)) add('大格');
  if (flags.slant) add('斜切');
  if (flags.zigzag || (flags.slant || 0) >= 2) add('动势');
  if (flags.bleed) add('越界');
  if (flags.inset) add('插入格', '叠盖');
  if (flags.vsplit || flags.hanging) add('竖切');
  if (flags.pairs) add('并置');
  if (flags.stagger >= 3 && flags.pairs == null) add('台阶');
  if (flags.stagger || flags.pause || flags.title || flags.hanging || scroll) add('留白');
  if (flags.borderless || frame === 'none') add('无框');
  if (flags.tiers === 3) add('三段落');
  if (n === 2) add('二格');
  if (n === 3) add('三格');
  if (n >= 6) add('多格');
  if (n >= 10 && !scroll) add('密恐');
  const small = base.filter((s) => s.area < avg * 0.55).length;
  if (small >= 2) add('小格');
  if (base.filter((s) => s.w / s.h > 2.3).length >= 2) add('横向');
  if (base.some((s) => s.w / s.h > 3.2)) add('横长');
  if (flags.grid && base.every((s) => Math.abs(s.area - avg) < avg * 0.12)) add('多格等分');
  if (isSymmetric(slots, page)) add('对称'); else if (maxArea > avg * 2.2) add('不对称');
  // 景别特征
  const cnt = (list) => roles.filter((r) => list.includes(r)).length;
  if (cnt(['close', 'face', 'eye']) >= 2) add('特写');
  if (cnt(['panorama', 'establish']) >= 1) add('全景');
  if (cnt(['medium', 'two']) >= 2) add('中景');
  if (roles.includes('two')) add('双人');
  if (roles.includes('group')) add('群像');
  if (cnt(['reaction']) >= 2) add('反应格');
  if (cnt(['silence', 'inner']) >= 1 && (flags.borderless || frame === 'none')) add('空镜');
  const order = ['wide', 'medium', 'close', 'face', 'eye'];
  const seqIdx = roles.map((r) => order.indexOf(r)).filter((i) => i >= 0);
  if (seqIdx.length >= 3 && seqIdx.every((v, i) => i === 0 || v >= seqIdx[i - 1])) add('推镜');
  if (scroll && base.length >= 4) {
    const hs = base.map((s) => s.h);
    const inc = hs.every((v, i) => i === 0 || v >= hs[i - 1] * 0.95), dec = hs.every((v, i) => i === 0 || v <= hs[i - 1] * 1.05);
    if (inc || dec) add('渐层');
  }
  // 题材
  add(...(GENRE_BY_INTENT[intent] || []));
  if (culture === 'jp') add(JP_LINE(intent));
  if (culture === 'cn') add(CN_LINE(intent));
  if (['hot'].includes(INTENTS[intent]?.cls) && flags.slant) add('速度线');
  if (n >= 7 && small >= 3) add('快节奏');
  if (scroll && base.some((s) => s.w / s.h >= 2.6) && ['scenery', 'climax', 'reveal', 'travel', 'war', 'disaster'].includes(intent)) add('大片感');
  if (['romance', 'inner', 'emotion'].includes(intent) && (flags.borderless || frame === 'none')) add('柔和');
  if (flags.splash) add('插图');
  return out.slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * 戏路：主戏路（生成时用的那条）+ 最多两条也合适的
 * ------------------------------------------------------------------ */
const DENS = ['low', 'mid', 'high', 'dense'];
/** 副戏路只从「邻近」的戏路里挑：同一套版式能讲战斗也能讲追逐，但不会既是搞笑又是静默 */
const NEAR = {
  action: ['impact', 'chase', 'sport', 'war', 'climax', 'magic'],
  impact: ['action', 'climax', 'magic', 'reveal', 'war', 'disaster'],
  chase: ['action', 'sport', 'suspense', 'horror', 'disaster'],
  emotion: ['romance', 'inner', 'reveal', 'climax', 'silence', 'dialogue'],
  dialogue: ['daily', 'work', 'court', 'romance', 'investigate', 'gag', 'emotion'],
  reveal: ['suspense', 'climax', 'horror', 'emotion', 'investigate', 'impact'],
  suspense: ['horror', 'investigate', 'reveal', 'chase', 'medical'],
  horror: ['suspense', 'reveal', 'disaster', 'chase'],
  romance: ['emotion', 'daily', 'inner', 'dialogue', 'silence'],
  gag: ['daily', 'food', 'dialogue', 'montage'],
  inner: ['emotion', 'silence', 'romance', 'scenery'],
  montage: ['daily', 'travel', 'scenery', 'sport', 'war', 'food'],
  silence: ['inner', 'scenery', 'emotion', 'romance', 'travel'],
  daily: ['gag', 'dialogue', 'food', 'romance', 'montage', 'work'],
  climax: ['action', 'impact', 'reveal', 'emotion', 'war'],
  scenery: ['travel', 'silence', 'inner', 'magic', 'disaster', 'montage'],
  sport: ['action', 'chase', 'montage', 'impact', 'climax'],
  food: ['daily', 'gag', 'montage', 'romance'],
  war: ['action', 'impact', 'disaster', 'climax', 'chase'],
  court: ['dialogue', 'investigate', 'work', 'reveal', 'suspense'],
  work: ['dialogue', 'daily', 'court', 'montage'],
  medical: ['suspense', 'emotion', 'disaster', 'investigate'],
  magic: ['action', 'impact', 'scenery', 'climax', 'war'],
  disaster: ['war', 'impact', 'horror', 'chase', 'scenery'],
  investigate: ['suspense', 'reveal', 'court', 'dialogue', 'horror'],
  travel: ['scenery', 'daily', 'montage', 'silence', 'inner'],
};

export function pickIntents(primary, slots, tags, density) {
  const score = (id) => {
    const I = INTENTS[id];
    const align = alignBeats(I.beats, slots).score;
    const want = (I.wantTags || []).filter((t) => tags.includes(t)).length;
    const avoid = (I.avoidTags || []).filter((t) => tags.includes(t)).length;
    const fit = Math.max(0, Math.min(1, (want - avoid * 1.5) / 3));
    const dens = 1 - Math.abs(DENS.indexOf(I.density) - DENS.indexOf(density)) / 3;
    return 0.55 * align + 0.3 * fit + 0.15 * dens;
  };
  const ps = score(primary);
  const others = (NEAR[primary] || []).filter((id) => INTENTS[id])
    .map((id) => [id, score(id)])
    .filter(([, s]) => s >= 0.6 && s >= ps - 0.12)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => id);
  return [primary, ...others];
}

/* ------------------------------------------------------------------ *
 * 名字：体系·结构·特征·#编号
 * ------------------------------------------------------------------ */
const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];

export function systemLabel(culture, family, intent) {
  if (family === 'jp-4koma') return '四格';
  if (family === 'jp-spread') return '跨页';
  if (family === 'jp-splash') return '整页';
  if (culture === 'jp') {
    const line = JP_LINE(intent);
    if (line === '少年') return '少年漫';
    if (line === '少女') return '少女漫';
    if (line === '青年') return '青年漫';
    return ['gag', 'daily', 'food'].includes(intent) ? '日常' : '页漫';
  }
  if (culture === 'kr') return family === 'kr-fast' ? '웹툰·快剪' : '웹툰';
  if (culture === 'cn') {
    return family === 'cn-strip' ? '国风条漫' : family === 'cn-longscroll' ? '国风长卷' : family === 'cn-4koma' ? '彩漫四格' : '国风页漫';
  }
  return {
    'core-poster': '海报', 'core-splash': '整页', 'core-wide': '分镜表', 'core-strip': '竖屏',
  }[family] || '通用';
}

export function structureLabel(family, slots, flags) {
  const n = slots.length;
  if (flags.splash) return n === 1 ? '一格通版' : `一格通版＋${NUM[n - 1]}个角格`;
  if (flags.koma4) return n === 8 ? '双排四格' : '起承转合';
  if (flags.strip) return `${NUM[n] || n}格竖排`;
  if (family === 'cn-longscroll') return `${NUM[flags.segments] || flags.segments}段长卷`;
  if (flags.vsplit === 'full') return '通天竖格';
  if (flags.vsplit === 'partial') return '下半竖切';
  if (flags.poster) return '标题＋大图';
  if (flags.bsp) return `${NUM[n] || n}格${flags.grid ? '网格' : '分割'}`;
  if (flags.tiers) return `${NUM[flags.tiers]}段${NUM[n] || n}格`;
  return `${NUM[n] || n}格`;
}

export function featureLabel(flags, roles, slots) {
  const insetRole = slots.find((s) => s.over && s.role !== 'silence')?.role;
  if (flags.title) return '题字留白';
  if (insetRole === 'eye') return '眼部插入';
  if (insetRole === 'hand') return '手部插入';
  if (insetRole === 'object') return '物件插入';
  if (flags.inset && !flags.splash) return '特写插入';
  if (flags.bleed && flags.slant) return '斜切出血';
  if (flags.bleed) return '出血大格';
  if (flags.zigzag) return '锯齿斜切';
  if (flags.slant) return '斜切推进';
  if (flags.hanging) return '立轴留白';
  if (flags.lshape) return '大格叠格';
  if (flags.pairs) return '并排对切';
  if ((flags.stagger || 0) >= 3) return '错位留白';
  if (flags.pause) return '停顿留白';
  if (flags.grid && !flags.bsp) return '整齐网格';
  if (flags.borderless) return '无框留白';
  if (roles[0] === 'establish' || roles[0] === 'panorama') return '开场定场';
  if (roles[roles.length - 1] === 'silence') return '静默收尾';
  const areas = slots.filter((s) => !s.over).map((s) => s.area);
  if (areas.length > 1 && areas[areas.length - 1] === Math.max(...areas)) return '大格压轴';
  return '平稳叙事';
}

/* ------------------------------------------------------------------ *
 * 说明：几个固定句子用「；」连起来
 * ------------------------------------------------------------------ */
const INSERT_ROLE_ZH = (r) => ROLES[r]?.zh || '特写';

export function describe({ culture, family, slots, flags, intents, reading, page }) {
  const parts = [];
  const n = slots.length;
  const base = slots.filter((s) => !s.over);
  if (flags.splash) parts.push(n === 1 ? '整页一格出血' : `整页一格出血，压 ${n - 1} 个角格`);
  else if (flags.koma4) parts.push(n === 8 ? '两条四格并排，右边那条先读' : '四格：起、承、转、合');
  else if (flags.strip) parts.push(`竖屏滚动，${n} 格`);
  else if (family === 'cn-longscroll') parts.push(`长卷从左往右展开，${flags.segments} 段 ${n} 格`);
  else if (flags.landscape) parts.push(`横版，${flags.tiers || 1} 段 ${n} 格`);
  else if (flags.bsp) parts.push(flags.grid ? `网格切分，${n} 格` : `自由切分，${n} 格`);
  else if (flags.poster) parts.push('上面留标题，中间一张大图');
  else parts.push(`${reading === 'rtl' ? '从右往左读' : '从左往右读'}，${flags.tiers || 1} 段 ${n} 格`);

  // 最重的一格
  if (!flags.splash && base.length > 1) {
    const big = base.reduce((m, s) => (s.area > m.area ? s : m), base[0]);
    const share = Math.round((big.area / base.reduce((a, s) => a + s.area, 0)) * 100);
    if (page.kind === 'scroll') parts.push(`第 ${big.order} 格最长，停留最久`);
    else parts.push(`最大的是第 ${big.order} 格，约占全部格子的 ${share}%`);
  }
  // 特征（最多两句）
  const feats = [];
  if (flags.bleed) feats.push(page.kind === 'scroll' ? '大格左右出血，撑满屏宽' : '最重的一格出血，冲出页边');
  if (flags.zigzag) feats.push('锯齿斜切，节奏最急');
  else if (flags.slant) feats.push('斜切制造速度感');
  const cut = slots.find((s) => s.over && s.role !== 'silence');
  if (cut && !flags.splash) feats.push(`插入一格${INSERT_ROLE_ZH(cut.role)}，压在前一格上`);
  if (flags.title) feats.push('大格上留出题字区');
  if (flags.vsplit === 'full') feats.push('一格竖长格贯穿整侧');
  if (flags.vsplit === 'partial') feats.push('下半页一格竖长格');
  if (flags.lshape) feats.push('一大格配两个叠起来的小格');
  if (flags.hanging) feats.push('立轴式竖长格，两边大留白');
  if (flags.pairs) feats.push('两格并排，适合对切或反应');
  if ((flags.stagger || 0) >= 2) feats.push('小格左右错位，留白当呼吸');
  if (flags.pause) feats.push('关键格前多留一段白，节奏停一下');
  if (flags.grid) feats.push('格子吸附网格，排版整齐');
  if (flags.borderless) feats.push('安静的格子去掉边框');
  parts.push(...feats.slice(0, 2));
  parts.push(`适合${intents.map((i) => INTENTS[i].zh).join('、')}`);
  return parts.join('；');
}

/** 名字 / 说明用到的全部固定短语（i18n 词表要覆盖它们；scripts/gen-library.mjs --phrases 会列出来） */
export const PHRASE_HINT = 'see scripts/gen-library.mjs --phrases';
