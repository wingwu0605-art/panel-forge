/**
 * library-jp.mjs — 日式页漫分镜模板（コマ割り）
 *
 * 日漫版面三原则：① 从右往左读（RTL）；② 三段落とし（三段式）保证「引き→大ゴマ→小ゴマ」的呼吸；
 * ③ 用斜线格（ななめ割り）与越界出血（ぶち抜き）制造速度感。
 */
import { row, col, leaf } from './geometry.mjs';

const jp = (o) => ({ culture: 'jp', reading: 'rtl', ratio: 'a4', frame: 'ink', ...o });

export default [
  /* ---------------------------------------------------------------- 四格 */
  jp({
    id: 'jp-4koma-square', name: '四格·起承转合（方形）', ratio: 'square',
    tags: ['四格', '对称', '小格', '日常', '页漫'], intents: ['gag', 'daily'],
    desc: '最经典 2×2 四格，右上起读。起（交代）→承（发展）→转（反转）→合（吐槽）。',
    layout: row([1, 1], [
      col([1, 1], ['medium', 'reaction']),
      col([1, 1], ['wide', 'reaction']),
    ]),
  }),
  jp({
    id: 'jp-4koma-vertical', name: '四格·纵长条（手机友好）',
    tags: ['四格', '竖向', '小格', '日常'], intents: ['gag', 'daily', 'dialogue'],
    desc: '四格纵向等分，适合手机竖屏阅读，节奏平均、包袱落在最后一格。',
    layout: row([1, 1, 1, 1], ['medium', 'close', 'reaction', 'face']),
  }),
  jp({
    id: 'jp-4koma-broken', name: '四格·错位变格',
    tags: ['四格', '小格', '变形', '搞笑'], intents: ['gag'],
    desc: '四格但体重不均：首格大、末格被压扁，用格子的形变本身搞笑。',
    layout: row([1.5, 1, 0.85], [
      col([1, 1], ['wide', 'face']),
      col([1, 1, 1], ['reaction', 'reaction', 'reaction']),
      col([1, 1], ['cutin', 'face']),
    ]),
  }),

  /* ---------------------------------------------------------- 少年漫主力 */
  jp({
    id: 'jp-shonen-3tier', name: '少年漫·三段落とし（标准事件页）',
    tags: ['少年', '三段落', '大格', '全景', '特写'], intents: ['action', 'daily', 'dialogue'],
    desc: '上段「引き」交代空间，中段一整格大ゴマ放事件，下段三小格推进。日漫最通用的教科书版式。',
    layout: row([0.30, 0.40, 0.30], [
      col([1.6, 1], ['wide', 'face']),
      'impact',
      col([1, 1, 1], ['reaction', 'medium', 'close']),
    ]),
  }),
  jp({
    id: 'jp-shonen-diagonal', name: '少年漫·斜切开场',
    tags: ['少年', '斜切', '动势', '大格'], intents: ['action', 'chase', 'climax'],
    desc: '上段两格沿斜线切分，视线被斜线推向中段大格，是「战斗打响」最常用的破格手法。',
    layout: row([0.34, 0.40, 0.26], [
      col([1.7, 1], ['wide', 'low'], { slant: 0.10 }),
      col([1, 0.55], ['action', 'cutin'], { slant: -0.16 }),
      col([1, 1, 1], ['face', 'reaction', 'medium']),
    ]),
  }),
  jp({
    id: 'jp-shonen-impact', name: '少年漫·一撃大格（必杀页）',
    tags: ['少年', '大格', '留白', '越界', '冲击'], intents: ['impact', 'action'],
    desc: '整页只服务一击：最大格占到 70% 面积，其余小格只做反应与余波。',
    margin: 24, gutter: 18,
    layout: row([1, 3.1, 0.9], [
      col([1, 1, 1.2], ['face', 'reaction', 'eye']),
      'impact',
      col([1.6, 1], ['silence', 'back']),
    ]),
  }),
  jp({
    id: 'jp-shonen-speed', name: '少年漫·速度线长条',
    tags: ['少年', '竖向', '速度线', '小格', '动势'], intents: ['chase', 'action'],
    desc: '四条竖长格模拟速度线的方向感，读者会不由自主快速下扫——冲刺、追击专用。',
    layout: row([0.16, 0.42, 0.42], [
      'panorama',
      col([1, 0.62, 1], ['action', 'cutin', 'action'], { slant: 0.12 }),
      col([1, 1], ['wide', 'reaction']),
    ]),
  }),
  jp({
    id: 'jp-shonen-spread', name: '少年漫·跨页对决（16:9）', ratio: 'wide',
    tags: ['跨页', '横向', '对称', '大格', '对峙'], intents: ['climax', 'impact', 'action'],
    desc: '横长跨页，左右各一大格对峙，中间用窄格切出「一击」。适合页漫印刷的见开き。',
    layout: col([1, 0.34, 1], [
      col([1, 1], ['low', 'action']),
      leaf('impact'),
      col([1, 1], ['action', 'low']),
    ]),
  }),
  jp({
    id: 'jp-shonen-bleed', name: '少年漫·越界ぶち抜き',
    tags: ['少年', '越界', '大格', '动势'], intents: ['action', 'impact', 'chase'],
    desc: '首格三面出血，人物可冲出画格边界。日漫「破格」的入门版式。',
    layout: row([0.46, 0.28, 0.26], [
      leaf('impact', { bleed: true }),
      col([1, 1], ['action', 'wide']),
      col([1, 1, 1], ['face', 'reaction', 'silence']),
    ]),
  }),
  jp({
    id: 'jp-shonen-2page-splash', name: '少年漫·全页插图＋角格', ratio: 'a4',
    tags: ['大格', '留白', '越界', '插图'], intents: ['scenery', 'impact', 'emotion'],
    desc: '一格吃掉全页（可出血），右下压一个小角格放台词——「静」页的标准做法。',
    insets: [{ x: 0.60, y: 0.80, w: 0.34, h: 0.14, role: 'close', note: '角格：一句台词' }],
    margin: 26, gutter: 14,
    layout: row([1], [ leaf('impact', { bleed: true }) ]),
  }),

  /* -------------------------------------------------------------- 少女漫 */
  jp({
    id: 'jp-shojo-petal', name: '少女漫·斜线花瓣格',
    tags: ['少女', '斜切', '留白', '特写', '柔和'], intents: ['romance', 'emotion', 'inner'],
    desc: '上段用斜线切成三片「花瓣」，装饰性留白多，情绪压在最大的一格里。',
    layout: row([0.30, 0.34, 0.36], [
      col([1, 1.2, 0.9], ['wide', 'face', 'silence'], { slant: 0.12, zigzag: true }),
      col([1.35, 1], ['medium', 'eye'], { slant: 0.12 }),
      col([1, 1], ['close', 'silence'], { slant: -0.10 }),
    ]),
  }),
  jp({
    id: 'jp-shojo-gaze', name: '少女漫·视线交错',
    tags: ['少女', '特写', '插入格', '留白', '双人'], intents: ['romance', 'emotion'],
    desc: '上下两格人物对望，中间用一枚斜置插入格放瞳孔倒影。少女漫的「心的距离」。',
    insets: [{ x: 0.44, y: 0.40, w: 0.28, h: 0.17, role: 'eye', rot: -4, note: '瞳孔里有对方' }],
    layout: row([0.42, 0.30, 0.28], [
      col([1, 1], ['close', 'silence'], { slant: 0.08 }),
      bare('wide'),
      col([1, 1], ['face', 'medium']),
    ]),
  }),
  jp({
    id: 'jp-shojo-confess', name: '少女漫·告白三格',
    tags: ['少女', '留白', '特写', '大格'], intents: ['romance', 'emotion', 'dialogue'],
    desc: '三格=三次呼吸：全景拉开距离 → 特写鼓起勇气 → 大格留白给那句台词。',
    margin: 34,
    layout: row([0.28, 0.34, 0.38], [
      'wide',
      col([1, 1.4], ['close', 'face']),
      'silence',
    ]),
  }),
  jp({
    id: 'jp-shojo-memory', name: '少女漫·回忆无框',
    tags: ['少女', '无框', '留白', '回忆', '柔和'], intents: ['inner', 'emotion'],
    desc: '格线全部取消，用留白与淡墨分层——回忆/梦境页。',
    frame: 'hairline', gutter: 26,
    insets: [{ x: 0.12, y: 0.62, w: 0.30, h: 0.16, role: 'object', rot: 3, note: '记忆锚点' }],
    layout: row([0.34, 0.38, 0.28], [
      leaf('silence', { borderless: true }),
      leaf('medium', { borderless: true }),
      leaf('back', { borderless: true }),
    ]),
  }),
  jp({
    id: 'jp-shojo-tall', name: '少女漫·竖长情绪格',
    tags: ['少女', '竖向', '特写', '留白'], intents: ['emotion', 'silence', 'inner'],
    desc: '左右两列竖长格，人物立姿与天空并置，适合「一个人站着」的孤独镜头。',
    layout: col([1, 1], [
      row([0.55, 0.45], ['full', 'silence']),
      row([0.4, 0.6], ['face', 'inner']),
    ]),
  }),

  /* -------------------------------------------------------------- 青年漫 */
  jp({
    id: 'jp-seinen-mesh', name: '青年漫·六格密网',
    tags: ['青年', '多格', '对话', '小格', '堆叠'], intents: ['dialogue', 'suspense', 'daily'],
    desc: '六格三带，宽窄交替。青年漫的信息密度靠「格多而不乱」建立压迫感。',
    gutter: 12,
    layout: row([0.32, 0.36, 0.32], [
      col([1.25, 1, 0.9], ['medium', 'two', 'close']),
      col([0.9, 1.4], ['reaction', 'wide']),
      col([1, 1, 1.1], ['face', 'object', 'close']),
    ]),
  }),
  jp({
    id: 'jp-seinen-talk', name: '青年漫·对话堆叠（三带）',
    tags: ['青年', '对话', '多格', '中景', '堆叠'], intents: ['dialogue', 'suspense'],
    desc: '三段等分但每段列数不同（2/3/2），台词量大的场景靠这个版式不腻。',
    layout: row([1, 1, 1], [
      col([1.3, 1], ['two', 'medium']),
      col([1, 1, 1], ['close', 'medium', 'reaction']),
      col([1, 1.3], ['face', 'medium']),
    ]),
  }),
  jp({
    id: 'jp-seinen-montage', name: '青年漫·横向蒙太奇',
    tags: ['青年', '蒙太奇', '横向', '多格'], intents: ['montage', 'inner'],
    desc: '五条横带从早到晚，同机位不同时刻，时间流逝一页说完。',
    gutter: 11,
    layout: row([1, 0.85, 1, 0.85, 1], ['panorama', 'establish', 'wide', 'medium', 'silence']),
  }),
  jp({
    id: 'jp-seinen-overhead', name: '青年漫·俯视压迫',
    tags: ['青年', '俯视', '大格', '不对称'], intents: ['suspense', 'climax', 'emotion'],
    desc: '俯视大格把人物压在世界里，四周小格是旁人的视线。孤独/被围专用。',
    layout: row([0.32, 0.40, 0.28], [
      col([1, 1.2, 1], ['face', 'object', 'silence']),
      'overhead',
      col([1.4, 1], ['medium', 'close'], { slant: 0.09 }),
    ]),
  }),
  jp({
    id: 'jp-seinen-9', name: '青年漫·九宫密恐',
    tags: ['青年', '多格', '小格', '密恐'], intents: ['horror', 'suspense', 'dialogue'],
    desc: '3×3 九格，格子小到透不过气，适合监控感、群像、庭审式对话。',
    gutter: 10, margin: 22,
    layout: row([1, 1, 1], [
      col([1, 1, 1], ['medium', 'close', 'object']),
      col([1, 1, 1], ['face', 'wide', 'reaction']),
      col([1, 1, 1], ['close', 'medium', 'eye']),
    ]),
  }),
  jp({
    id: 'jp-seinen-stare', name: '青年漫·特写堆叠',
    tags: ['青年', '特写', '插入格', '多格'], intents: ['climax', 'suspense', 'dialogue'],
    desc: '四个特写交替叠压，插入格打破矩形——长时间沉默对峙的版式。',
    gutter: 12,
    insets: [{ x: 0.54, y: 0.44, w: 0.32, h: 0.15, role: 'eye', rot: 2, note: '插入：对方瞳孔' }],
    layout: row([0.30, 0.34, 0.36], [
      col([1, 1], ['face', 'close']),
      col([1, 1.2], ['eye', 'medium']),
      col([1.2, 1], ['close', 'hand']),
    ]),
  }),

  /* --------------------------------------------------------- 恐怖 / 悬疑 */
  jp({
    id: 'jp-horror-void', name: '恐怖·巨格留白',
    tags: ['恐怖', '留白', '大格', '不对称'], intents: ['horror', 'suspense', 'silence'],
    desc: '一格占 65% 且几乎全白，只在角落压两个小格。恐怖来自「读者自己填的空」。',
    margin: 30,
    layout: row([0.18, 0.62, 0.20], [
      col([1, 1.4], ['close', 'object']),
      'silence',
      col([1.6, 1], ['reaction', 'face']),
    ]),
  }),
  jp({
    id: 'jp-horror-bands', name: '恐怖·密集横条',
    tags: ['恐怖', '横向', '多格', '暗部'], intents: ['horror', 'suspense'],
    desc: '七条横带像被剖开的切片，越往下越窄——「越来越不对劲」的机械感。',
    gutter: 10,
    layout: row([1.2, 1, 0.9, 0.8, 0.7, 0.7], ['wide', 'close', 'object', 'face', 'cutin', 'eye']),
  }),
  jp({
    id: 'jp-horror-approach', name: '恐怖·逼近',
    tags: ['恐怖', '斜切', '大格', '不对称'], intents: ['horror', 'suspense', 'chase'],
    desc: '斜线把威胁从画面边缘切进来，最后一格是「它已经站在你面前」。',
    layout: row([0.26, 0.34, 0.40], [
      col([1, 1], ['establish', 'silence'], { slant: 0.14 }),
      col([1.5, 1], ['close', 'reaction'], { slant: -0.12 }),
      col([1, 1], ['low', 'object'], { slant: 0.16 }),
    ]),
  }),
  jp({
    id: 'jp-suspense-door', name: '悬疑·门槛构图',
    tags: ['悬疑', '竖向', '留白', '不对称'], intents: ['suspense', 'reveal'],
    desc: '中间一条竖长格＝门缝/走廊，两侧窄格是窥视者。空间本身就是悬念。',
    layout: col([1, 0.85, 1], [
      row([0.62, 0.38], ['medium', 'face']),
      row([0.3, 0.4, 0.3], ['object', 'silence', 'cutin']),
      row([0.5, 0.5], ['close', 'reaction']),
    ], { slant: 0.04 }),
  }),

  /* --------------------------------------------------------- 日常 / 搞笑 */
  jp({
    id: 'jp-daily-room', name: '日常·室内三带',
    tags: ['日常', '三段落', '中景', '对话'], intents: ['daily', 'dialogue', 'gag'],
    desc: '教室/房间里的日常对话：景别保持中近景不动，靠格子大小变化节奏。',
    layout: row([0.36, 0.32, 0.32], [
      col([1.5, 1], ['medium', 'wide']),
      col([1, 1, 1.15], ['close', 'reaction', 'two']),
      col([1.2, 1], ['face', 'object']),
    ]),
  }),
  jp({
    id: 'jp-gag-tempo', name: '搞笑·吐槽节奏',
    tags: ['搞笑', '小格', '反应格', '节奏快'], intents: ['gag'],
    desc: '四小格匀速铺垫，第五格突然放大反应格——三小一大是日式搞笑的黄金比例。',
    layout: row([0.22, 0.22, 0.26, 0.30], [
      col([1, 1], ['medium', 'close']),
      col([1, 1, 1], ['face', 'reaction', 'reaction']),
      col([1.4, 1], ['medium', 'cutin']),
      'reaction',
    ]),
  }),
  jp({
    id: 'jp-gag-squash', name: '搞笑·压扁变格',
    tags: ['搞笑', '变形', '小格'], intents: ['gag'],
    desc: '末格被极度压扁成条，人物变形挤在里面——格子的形状直接讲笑话。',
    layout: row([0.34, 0.34, 0.20, 0.12], [
      col([1, 1], ['wide', 'medium']),
      col([1, 1], ['close', 'face']),
      'reaction',
      'cutin',
    ]),
  }),

  /* --------------------------------------------------------- 对话 / 对峙 */
  jp({
    id: 'jp-talk-6', name: '对话·六格标准',
    tags: ['对话', '多格', '中景', '三段落'], intents: ['dialogue'],
    desc: '页漫最常用的对话页：六格，中景为主、穿插两个特写，气泡永远不会没地方放。',
    layout: row([1, 1, 1], [
      col([1, 1], ['two', 'medium']),
      col([1, 1, 1], ['close', 'medium', 'close']),
      col([1, 1], ['face', 'medium']),
    ]),
  }),
  jp({
    id: 'jp-talk-4', name: '对话·双人对切',
    tags: ['对话', '双人', '小格', '对称'], intents: ['dialogue', 'romance', 'climax'],
    desc: '四格两人来回对切，视线方向必须左右相反，才读得通。',
    layout: row([1, 1], [
      col([1, 1], ['two', 'close']),
      col([1, 1], ['close', 'medium'], { slant: 0.05 }),
    ]),
  }),
  jp({
    id: 'jp-climax-split', name: '对峙·中竖切',
    tags: ['对峙', '竖向', '对称', '大格', '双人'], intents: ['climax', 'suspense'],
    desc: '中间一条竖格把画面劈成两半，两人各占一侧，中线即刀锋。',
    layout: col([1, 0.30, 1], [
      row([0.34, 0.66], ['wide', 'low']),
      row([0.24, 0.14, 0.20, 0.42], ['eye', 'silence', 'hand', 'impact']),
      row([0.30, 0.70], ['close', 'low']),
    ]),
  }),
  jp({
    id: 'jp-climax-eyes', name: '对峙·眼神四格',
    tags: ['对峙', '特写', '对称', '留白'], intents: ['climax', 'suspense', 'emotion'],
    desc: '一格眼神、一格嘴、一格手、一格空——四格无台词，全靠剪接。',
    margin: 34, gutter: 20,
    layout: row([1, 1], [
      col([1, 1], ['eye', 'face']),
      col([1, 1], ['hand', 'silence']),
    ]),
  }),

  /* --------------------------------------------------------- 景 / 特殊页 */
  jp({
    id: 'jp-establish-duo', name: '景·上下二分（天与地）',
    tags: ['全景', '横向', '留白', '大格'], intents: ['scenery', 'daily', 'inner'],
    desc: '上方一条全景铺开天空，下方两格交代地面人物。开篇第一页最稳的构图。',
    layout: row([0.46, 0.54], [
      'panorama',
      col([1, 1], ['wide', 'medium']),
    ]),
  }),
  jp({
    id: 'jp-splash-inset', name: '全页格·角插台词格',
    tags: ['大格', '留白', '插入格', '插图'], intents: ['scenery', 'emotion', 'silence'],
    desc: '一格通版＋角上一片白，白处直接排台词。少女漫与散文漫画常用的「静页」。',
    margin: 30,
    insets: [{ x: 0.06, y: 0.06, w: 0.40, h: 0.10, role: 'silence', note: '空白处排旁白' }],
    layout: row([1], [ leaf('impact', { bleed: true }) ]),
  }),
  jp({
    id: 'jp-triangle-impact', name: '破格·三角冲击',
    tags: ['斜切', '大格', '越界', '冲击'], intents: ['impact', 'action', 'reveal'],
    desc: '对角线把右下切成三角大格，冲击从角落刺进全页。手工多边形版式。',
    slots: [
      // 上：横长全景
      { id: 't1', order: 1, role: 'panorama', poly: [[28, 28], [972, 28], [972, 330], [28, 330]] },
      // 中：对角线切出两枚三角格（右上大三角 = 冲击）
      { id: 't2', order: 2, role: 'impact', poly: [[28, 345], [972, 345], [972, 830]] },
      { id: 't3', order: 3, role: 'medium', poly: [[28, 357], [958, 845], [28, 845]] },
      // 下：右大格 + 左侧两小格
      { id: 't4', order: 4, role: 'face', poly: [[430, 860], [972, 860], [972, 1386], [430, 1386]] },
      { id: 't5', order: 5, role: 'reaction', poly: [[28, 860], [415, 860], [415, 1100], [28, 1100]] },
      { id: 't6', order: 6, role: 'silence', poly: [[28, 1115], [415, 1115], [415, 1386], [28, 1386]] },
    ],
  }),
  jp({
    id: 'jp-inset-overlay', name: '叠盖·插入格五连',
    tags: ['插入格', '叠盖', '多格', '特写'], intents: ['dialogue', 'emotion', 'suspense'],
    desc: '主格之下压两枚斜置插入格，打破均分网格。信息量大但不死板。',
    gutter: 13,
    insets: [
      { x: 0.055, y: 0.545, w: 0.26, h: 0.15, role: 'eye', rot: -3 },
      { x: 0.66, y: 0.115, w: 0.28, h: 0.14, role: 'object', rot: 2 },
    ],
    layout: row([0.40, 0.34, 0.26], [
      col([1.4, 1], ['wide', 'close']),
      col([1, 1], ['medium', 'face'], { slant: 0.07 }),
      col([1, 1, 1], ['reaction', 'medium', 'silence']),
    ]),
  }),
  jp({
    id: 'jp-shonen-multiangle', name: '少年漫·同ポジ四连（同一瞬间四机位）',
    tags: ['少年', '特写', '多格', '剪辑'], intents: ['action', 'impact', 'climax'],
    desc: '同一瞬间切四个机位：全景、手、眼、背影。日漫「时间被拉长」的经典剪接法。',
    gutter: 13,
    layout: row([1.15, 1, 1], [
      'wide',
      col([1, 1], ['hand', 'face']),
      col([1, 1], ['action', 'back']),
    ]),
  }),
  jp({
    id: 'jp-shojo-overlay', name: '少女漫·柔光叠格',
    tags: ['少女', '插入格', '留白', '柔和'], intents: ['romance', 'emotion', 'inner'],
    desc: '主格留白极多，两枚无框特写轻轻叠在上面；像记忆里的闪光点。',
    frame: 'hairline', margin: 30, gutter: 20,
    insets: [
      { x: 0.10, y: 0.12, w: 0.30, h: 0.12, role: 'eye', rot: -4 },
      { x: 0.58, y: 0.52, w: 0.32, h: 0.13, role: 'hand', rot: 3 },
    ],
    layout: row([1.6, 1], [
      leaf('wide', { borderless: true }),
      col([1, 1], ['face', 'silence']),
    ]),
  }),
  jp({
    id: 'jp-seinen-four', name: '青年漫·四格克制',
    tags: ['青年', '对称', '留白', '对话'], intents: ['silence', 'dialogue', 'emotion'],
    desc: '四格等分但留白极大，几乎不说话；青年漫的「静」比「动」更难画。',
    margin: 40, gutter: 24,
    layout: row([1, 1], [
      col([1, 1], ['wide', 'close']),
      col([1, 1], ['medium', 'silence']),
    ]),
  }),
  jp({
    id: 'jp-shonen-ladder', name: '少年漫·阶梯格',
    tags: ['少年', '斜切', '竖向', '动势'], intents: ['chase', 'action', 'climax'],
    desc: '格子像楼梯一样一格格错落下行，视线被强制往下带——追击、坠落、连锁反应。',
    gutter: 12,
    layout: col([1.5, 1, 1], [
      row([1, 1], ['wide', 'action']),
      row([0.8, 1.2], ['action', 'medium']),
      row([1.1, 0.9], ['wide', 'silence']),
    ]),
  }),
];

/** 无边框裸格（用于需要单格留白的场合） */
function bare(role) {
  return leaf(role, { borderless: true });
}
