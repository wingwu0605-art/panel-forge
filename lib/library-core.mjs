/**
 * library-core.mjs — 通用 / 跨界骨架
 *
 * 不挑画风的中性版式：网格、对角线、海报页、相册页、竖屏三格……
 * 包括「参考图还原」的那张双栏四段式。
 */
import { row, col, leaf } from './geometry.mjs';

const g = (o) => ({ culture: 'core', reading: 'ltr', ratio: 'a4', frame: 'ink', ...o });

export default [
  g({
    id: 'ref-4band-2col', name: '参考图还原·双栏四段式',
    tags: ['多格', '双栏', '三段落', '对称', '页漫'], intents: ['dialogue', 'action', 'daily'],
    desc: '左右两栏、四段横切：左栏「大格＋双叠格」起手，右栏「斜切＋大格」推进。信息密度高且节奏不均，适合多线并行的一页。',
    margin: 22, gutter: 13,
    layout: col([1, 1], [
      row([1.0, 0.62, 0.70, 0.86], [
        col([2.3, 1], ['wide', row([1, 1], ['object', 'reaction'])]),
        'panorama',
        'panorama',
        col([1, 1.15, 1], ['wide', 'action', 'medium'], { slant: 0.06 }),
      ]),
      row([0.92, 1.06, 0.80], [
        col([1.35, 1, 0.85], ['wide', 'low', 'object'], { slant: 0.05 }),
        'panorama',
        col([1, 1, 1], ['medium', 'wide', 'reaction']),
      ]),
    ]),
  }),
  g({
    id: 'core-3-tier', name: '通用·三段式（引子-事件-收束）',
    tags: ['三段落', '通用', '中景', '对话'], intents: ['daily', 'dialogue', 'scenery'],
    desc: '最中性的三格：上格交代、中格事件、下格收束。任何题材都能用的骨架。',
    layout: row([1, 1.3, 1], ['wide', 'impact', 'silence']),
  }),
  g({
    id: 'core-4-grid', name: '通用·2×2 四格',
    tags: ['四格', '对称', '通用', '网格'], intents: ['gag', 'daily', 'dialogue'],
    desc: '等分四格，节奏平均，最容易被读者接受的安全版式。',
    layout: row([1, 1], [
      col([1, 1], ['wide', 'medium']),
      col([1, 1], ['close', 'face']),
    ]),
  }),
  g({
    id: 'core-6-grid', name: '通用·3×2 六格',
    tags: ['多格', '网格', '通用', '对话'], intents: ['dialogue', 'daily', 'montage'],
    desc: '六格等分，气泡位充足，适合信息量大的对话页。',
    layout: row([1, 1], [
      col([1, 1, 1], ['wide', 'medium', 'close']),
      col([1, 1, 1], ['medium', 'face', 'reaction']),
    ]),
  }),
  g({
    id: 'core-9-grid', name: '通用·3×3 九格',
    tags: ['多格', '网格', '小格', '通用'], intents: ['montage', 'dialogue', 'gag'],
    desc: '九宫格，小格多，适合快速剪辑或「同时发生」。',
    gutter: 12,
    layout: row([1, 1, 1], [
      col([1, 1, 1], ['wide', 'medium', 'close']),
      col([1, 1, 1], ['medium', 'object', 'face']),
      col([1, 1, 1], ['close', 'reaction', 'medium']),
    ]),
  }),
  g({
    id: 'core-album-12', name: '通用·十二格相册页',
    tags: ['多格', '小格', '蒙太奇', '密恐'], intents: ['montage', 'daily', 'inner'],
    desc: '十二小格像相册一样铺开，一页装下一整段时间。',
    gutter: 10, margin: 22,
    layout: row([1, 1, 1, 1], [
      col([1, 1, 1], ['wide', 'object', 'medium']),
      col([1, 1, 1], ['medium', 'close', 'wide']),
      col([1, 1, 1], ['close', 'hand', 'face']),
      col([1, 1, 1], ['medium', 'wide', 'silence']),
    ]),
  }),
  g({
    id: 'core-splash', name: '通用·整页一格',
    tags: ['大格', '越界', '留白', '插图'], intents: ['scenery', 'impact', 'emotion'],
    desc: '一格通版、四面出血。全篇最重的一页用它。',
    margin: 24,
    layout: row([1], [leaf('impact', { bleed: true })]),
  }),
  g({
    id: 'core-diagonal-2', name: '通用·对角二格',
    tags: ['斜切', '二格', '大格', '动势'], intents: ['climax', 'action', 'reveal'],
    desc: '一条对角线把页面劈成两半，两格都够大，最适合「一击定胜负」。',
    margin: 24, gutter: 16,
    layout: row([1, 1], [
      leaf('impact', { bleed: true }),
      leaf('wide', { bleed: true }),
    ], { slant: 0.5 }),
  }),
  g({
    id: 'core-poster', name: '通用·海报式（上文下图）',
    tags: ['大格', '留白', '插图', '竖切'], intents: ['scenery', 'emotion', 'silence'],
    desc: '上方三分之一留白排大字标语，下方一整格插图。适合每话封面、预告页。',
    margin: 26,
    layout: row([0.32, 1], [
      leaf('silence', { bleed: ['left', 'right', 'top'] }),
      leaf('impact', { bleed: ['left', 'right', 'bottom'] }),
    ]),
  }),
  g({
    id: 'core-inset-focus', name: '通用·主格＋特写插入',
    tags: ['插入格', '叠盖', '大格', '特写'], intents: ['emotion', 'suspense', 'reveal'],
    desc: '一大格打底，压两枚特写插入格，视线被牵着走。',
    margin: 30, gutter: 18,
    insets: [
      { x: 0.06, y: 0.08, w: 0.32, h: 0.16, role: 'eye', rot: -3 },
      { x: 0.62, y: 0.74, w: 0.30, h: 0.15, role: 'hand', rot: 2 },
    ],
    layout: row([1], [leaf('wide', { bleed: true })]),
  }),
  g({
    id: 'core-banner-stack', name: '通用·横幅＋四连',
    tags: ['横向', '多格', '全景', '通用'], intents: ['scenery', 'daily', 'dialogue'],
    desc: '顶部一条横幅定场，下面四格推进。开篇、转场、交代日常都好用。',
    layout: row([1.05, 1, 1, 1], [
      'panorama',
      col([1.4, 1], ['wide', 'medium']),
      col([1, 1], ['close', 'reaction']),
      col([1, 1, 1], ['medium', 'face', 'silence']),
    ]),
  }),
  g({
    id: 'core-strip-3', name: '竖屏·三格', ratio: 'strip',
    tags: ['条漫', '竖向', '留白', '通用'], intents: ['daily', 'scenery', 'dialogue'],
    desc: '手机竖屏最基础的三格：定场、事件、收束。中文/韩文皆可直接套用。',
    reading: 'vertical', frame: 'hairline', margin: 46, gutter: 44,
    layout: row([1.3, 1, 1], ['panorama', 'medium', 'close']),
  }),
  g({
    id: 'core-strip-5', name: '竖屏·五格', ratio: 'strip',
    tags: ['条漫', '竖向', '多格', '节奏'], intents: ['dialogue', 'action', 'daily'],
    desc: '五格竖屏，格高递进，适合一段完整的小事件。',
    reading: 'vertical', frame: 'hairline', margin: 42, gutter: 38,
    layout: row([1.2, 1, 1, 1, 1.1], ['wide', 'medium', 'close', 'face', 'silence']),
  }),
  g({
    id: 'core-strip-9', name: '竖屏·九格速写', ratio: 'tall',
    tags: ['条漫', '竖向', '多格', '速写'], intents: ['montage', 'daily', 'gag'],
    desc: '九格竖屏，一屏扫完的速写节奏；适合连载的过渡段落。',
    reading: 'vertical', frame: 'hairline', margin: 38, gutter: 30,
    layout: row([1, 1, 1, 1, 1, 1, 1, 1, 1], [
      'wide', 'medium', 'close', 'object', 'two', 'face', 'reaction', 'wide', 'silence',
    ]),
  }),
  g({
    id: 'core-two-up', name: '通用·左右二格（跨页感）', ratio: 'wide',
    tags: ['横向', '二格', '对称', '对峙'], intents: ['climax', 'reveal', 'romance'],
    desc: '左右各一格，中间的缝就是「距离」。横版或跨页都成立。',
    layout: col([1, 1], ['wide', 'wide']),
  }),
  g({
    id: 'core-four-strip', name: '通用·横排四格（手机友好）', ratio: 'square',
    tags: ['四格', '横向', '对称', '小格'], intents: ['gag', 'daily', 'dialogue'],
    desc: '一横排四格，缩略图里也能一眼看懂，社交平台传播最优。',
    gutter: 14,
    layout: col([1, 1, 1, 1], ['wide', 'medium', 'close', 'reaction']),
  }),
  g({
    id: 'core-diagonal-band', name: '通用·斜切横带（三格）',
    tags: ['斜切', '横向', '三格', '动势'], intents: ['action', 'chase', 'climax'],
    desc: '中间一带被斜线切开，营造速度与不稳定感；上下两格做锚点。',
    layout: row([1, 1.35, 1], [
      'panorama',
      col([1, 1], ['action', 'low'], { slant: 0.14 }),
      'silence',
    ]),
  }),
  g({
    id: 'core-offset-panels', name: '通用·错位四格（不对称）',
    tags: ['不对称', '留白', '四格', '通用'], intents: ['emotion', 'daily', 'silence'],
    desc: '每格都偏一边，留白代替节奏；任何题材都能用，视觉上立刻不像「AI 网格」。',
    layout: row([1.1, 1, 1.15, 0.9], [
      leaf('wide', { pad: { left: 0.10 } }),
      leaf('medium', { pad: { right: 0.16 } }),
      leaf('close', { pad: { left: 0.07, right: 0.07 } }),
      leaf('silence', { pad: { left: 0.20 } }),
    ]),
  }),
  g({
    id: 'core-triptych', name: '通用·三栏并置',
    tags: ['竖向', '多格', '并置', '通用'], intents: ['montage', 'dialogue', 'daily'],
    desc: '三栏并列，栏高各异，一页同时讲三件事。',
    layout: col([1, 1, 1], [
      row([1.3, 1], ['wide', 'medium']),
      row([1, 1.3], ['close', 'face']),
      row([1.2, 1, 0.9], ['medium', 'wide', 'silence']),
    ]),
  }),
  g({
    id: 'core-cinema-bars', name: '通用·宽银幕三格', ratio: 'wide',
    tags: ['横向', '全景', '三格', '电影感'], intents: ['scenery', 'action', 'climax'],
    desc: '横版宽银幕三格连排，像电影分镜条的打印稿。',
    layout: col([1, 1, 1], ['panorama', 'wide', 'silence']),
  }),
];
