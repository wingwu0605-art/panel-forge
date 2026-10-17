/**
 * library-cn.mjs — 中式漫画分镜模板
 *
 * 三个子体系：
 *   ① 条漫（竖屏滚动）：无框、以留白控制节奏，格高就是「停留时间」；
 *   ② 国风页漫（杂志彩漫）：左往右读，重墨线，三栏／斜切，画面信息量大；
 *   ③ 四格彩漫：起承转合，手机端传播。
 */
import { row, col, leaf } from './geometry.mjs';

const strip = (o) => ({ culture: 'cn', reading: 'vertical', ratio: 'strip', frame: 'none', margin: 52, gutter: 46, ...o });
const scroll = (o) => ({ culture: 'cn', reading: 'vertical', ratio: 'scroll', frame: 'none', margin: 54, gutter: 44, ...o });
const page = (o) => ({ culture: 'cn', reading: 'ltr', ratio: 'a4', frame: 'bold', margin: 30, gutter: 16, ...o });

export default [
  /* ======================================================== 条漫（9:16） */
  strip({
    id: 'cn-strip-opening', name: '条漫·开场定场（4 格）',
    tags: ['条漫', '全景', '留白', '竖向'], intents: ['scenery', 'daily', 'inner'],
    desc: '竖屏第一屏：横长全景 → 全景人物 → 中景 → 特写，四格里完成「在哪、谁、什么情绪」。',
    layout: row([1.5, 1, 1.1, 0.9], ['panorama', 'wide', 'medium', 'face']),
  }),
  strip({
    id: 'cn-strip-talk', name: '条漫·对话三连',
    tags: ['条漫', '对话', '中景', '留白'], intents: ['dialogue', 'daily'],
    desc: '三格对话，上格留大块白给气泡，中间双人中景交代站位。',
    margin: 56, gutter: 40,
    layout: row([1.25, 1, 1], ['two', 'medium', 'close']),
  }),
  strip({
    id: 'cn-strip-emotion', name: '条漫·情绪递进（推镜）',
    tags: ['条漫', '特写', '竖向', '推镜'], intents: ['emotion', 'romance', 'inner'],
    desc: '同一人物从全景一路推到眼部，四格完成推镜。竖屏最好的「情绪放大器」。',
    layout: row([0.8, 1, 1.2, 1.4], ['wide', 'medium', 'face', 'eye']),
  }),
  strip({
    id: 'cn-strip-impact', name: '条漫·一格爆发',
    tags: ['条漫', '大格', '打击', '留白'], intents: ['impact', 'action'],
    desc: '上面两小格铺垫，第三格吃掉整屏宽度做冲击，最后一格静默收尾。',
    frame: 'hairline', gutter: 34,
    layout: row([0.55, 0.55, 2.4, 0.7], [
      col([1, 1], ['face', 'reaction']),
      leaf('action'),
      leaf('impact', { bleed: ['left', 'right'] }),
      leaf('silence', { bleed: ['left', 'right'] }),
    ]),
  }),
  strip({
    id: 'cn-strip-versus', name: '条漫·左右对峙',
    tags: ['条漫', '对称', '双人', '竖向'], intents: ['climax', 'suspense', 'reveal'],
    desc: '一条中缝把屏幕劈开，左侧持刀、右侧冷眼，竖屏也能做出横向对峙。',
    margin: 40, gutter: 18,
    layout: col([1, 1], [
      row([1, 1], ['low', 'face']),
      row([1, 1], ['close', 'low']),
    ]),
  }),
  strip({
    id: 'cn-strip-silence', name: '条漫·大留白静默',
    tags: ['条漫', '留白', '大格', '静默'], intents: ['silence', 'emotion', 'inner'],
    desc: '两格占满一屏，中间隔着几乎一屏高的白——条漫里最贵的节奏是「什么都不发生」。',
    margin: 44, gutter: 120,
    layout: row([1, 1], ['silence', 'wide']),
  }),
  strip({
    id: 'cn-strip-combo', name: '条漫·连击六格',
    tags: ['条漫', '多格', '动作', '快节奏'], intents: ['action', 'chase'],
    desc: '六格窄条连打，每格只放一个动作瞬间，读起来像分帧动画。',
    frame: 'hairline', gutter: 22, margin: 34,
    layout: row([1, 1, 1, 1, 1, 1], ['action', 'action', 'reaction', 'action', 'wide', 'silence']),
  }),
  strip({
    id: 'cn-strip-montage', name: '条漫·时间蒙太奇',
    tags: ['条漫', '蒙太奇', '多格', '留白'], intents: ['montage', 'inner'],
    desc: '五格等高的时间切片，格间留白等宽，像翻日历一样推进时间。',
    layout: row([1, 1, 1, 1, 1], ['panorama', 'wide', 'medium', 'close', 'silence']),
  }),
  strip({
    id: 'cn-strip-hook', name: '条漫·悬念钩子（截断式）',
    tags: ['条漫', '留白', '悬念', '竖向'], intents: ['suspense', 'reveal', 'horror'],
    desc: '末格被切在屏幕外一半，逼读者继续下滑——条漫特有的「截断钩子」。',
    margin: 46, gutter: 40,
    layout: row([0.9, 1.1, 1.6], ['object', 'medium', 'close']),
  }),
  strip({
    id: 'cn-strip-gag', name: '条漫·搞笑三连',
    tags: ['条漫', '搞笑', '反应格', '小格'], intents: ['gag'],
    desc: '铺垫 → 停顿 → 爆笑反应，第三格人物变形冲出边框。',
    frame: 'hairline', margin: 38, gutter: 30,
    layout: row([1, 0.7, 1.3], ['medium', 'silence', 'reaction']),
  }),
  strip({
    id: 'cn-strip-flashback', name: '条漫·回忆滤镜',
    tags: ['条漫', '回忆', '无框', '留白'], intents: ['inner', 'emotion'],
    desc: '整屏无框、格间大留白，回忆画面比现实更松，读者自然知道「这是过去」。',
    gutter: 80, margin: 60,
    layout: row([1, 1, 1], ['silence', 'medium', 'back']),
  }),
  strip({
    id: 'cn-strip-horror', name: '条漫·恐怖逼近',
    tags: ['条漫', '恐怖', '竖向', '暗部'], intents: ['horror', 'suspense'],
    desc: '上格大面积黑，下格只有一条缝的光。条漫的恐怖靠「黑得太多」。',
    margin: 36, gutter: 30,
    layout: row([1.3, 0.5, 1.2], ['establish', 'object', 'face']),
  }),

  /* ====================================================== 长条漫（1:2.6） */
  scroll({
    id: 'cn-scroll-scene', name: '长条漫·一场戏（8 格）',
    tags: ['长条', '多格', '条漫', '叙事完整'], intents: ['daily', 'dialogue', 'scenery'],
    desc: '一屏讲完一场戏：定场 → 人物 → 对话 ×3 → 反应 → 收束。条漫连载最常用的骨架。',
    layout: row([1.4, 1.2, 1, 1, 1, 1, 1.2, 0.9], [
      'panorama', 'wide', 'medium', 'two', 'close', 'reaction', 'medium', 'silence',
    ]),
  }),
  scroll({
    id: 'cn-scroll-fight', name: '长条漫·战斗长镜头（10 格）',
    tags: ['长条', '动作', '多格', '长镜头'], intents: ['action', 'chase', 'impact'],
    desc: '十格一镜到底：起势 → 交锋 → 受击 → 反击 → 爆发 → 余波，节奏从疏到密再到疏。',
    frame: 'hairline', gutter: 26, margin: 40,
    layout: row([1.2, 0.9, 0.9, 1.5, 0.8, 0.8, 0.8, 2.2, 1, 1.1], [
      'wide', 'action', 'action', 'impact', 'reaction', 'close', 'action', 'impact', 'wide', 'silence',
    ]),
  }),
  scroll({
    id: 'cn-scroll-romance', name: '长条漫·恋爱长条（7 格）',
    tags: ['长条', '恋爱', '留白', '特写'], intents: ['romance', 'emotion'],
    desc: '格高先大后小再大，视线在两人之间来回；留白替代台词。',
    gutter: 54, margin: 48,
    layout: row([1.1, 0.9, 1.3, 0.8, 1, 1.2, 1.4], [
      'wide', 'medium', 'two', 'cutin', 'face', 'eye', 'silence',
    ]),
  }),
  scroll({
    id: 'cn-scroll-mystery', name: '长条漫·悬疑长条（8 格）',
    tags: ['长条', '悬疑', '留白', '暗部'], intents: ['suspense', 'horror', 'reveal'],
    desc: '大量小物件特写＋两次大留白，读者被拖着一格一格往下找线索。',
    gutter: 60, margin: 44,
    layout: row([0.7, 0.7, 0.7, 1.6, 0.6, 0.6, 1.4, 0.8], [
      'object', 'cutin', 'hand', 'medium', 'object', 'eye', 'wide', 'silence',
    ]),
  }),
  scroll({
    id: 'cn-scroll-daily', name: '长条漫·日常四时（9 格）',
    tags: ['长条', '日常', '蒙太奇', '多格'], intents: ['daily', 'montage', 'scenery'],
    desc: '九格等高，像手账一样记录一天；格间留白一致，节奏轻快。',
    gutter: 34, margin: 46,
    layout: row([1, 1, 1, 1, 1, 1, 1, 1, 1], [
      'panorama', 'wide', 'medium', 'object', 'two', 'close', 'wide', 'face', 'silence',
    ]),
  }),
  scroll({
    id: 'cn-scroll-reveal', name: '长条漫·真相揭示（6 格）',
    tags: ['长条', '反转', '大格', '留白'], intents: ['reveal', 'climax'],
    desc: '前四格故意切得很碎制造不安，第五格整屏放开做揭示，第六格留白给读者消化。',
    gutter: 30, margin: 40,
    layout: row([0.8, 0.8, 0.8, 0.8, 3, 1], [
      'face', 'hand', 'object', 'close', 'impact', 'silence',
    ]),
  }),

  /* ==================================================== 国风页漫（LTR） */
  page({
    id: 'cn-page-wuxia', name: '国风·武侠对决（六格）',
    tags: ['国风', '武侠', '斜切', '大格', '对峙'], intents: ['action', 'climax', 'impact'],
    desc: '三带六格，上带斜切出剑气方向，中带大格放招式，下带三小格收势。',
    layout: row([0.30, 0.40, 0.30], [
      col([1, 1.5], ['wide', 'low'], { slant: 0.09 }),
      leaf('impact'),
      col([1, 1, 1], ['action', 'reaction', 'silence']),
    ]),
  }),
  page({
    id: 'cn-page-xianxia', name: '国风·仙侠全景（三格）',
    tags: ['国风', '仙侠', '全景', '大格'], intents: ['scenery', 'impact', 'emotion'],
    desc: '上格横长云海，下格左右分栏：左边人物，右边留白给旁白。适合大场面开篇。',
    layout: row([1.2, 1], [
      'panorama',
      col([1, 1], ['full', 'silence']),
    ]),
  }),
  page({
    id: 'cn-page-palace', name: '国风·宫斗密谈（六格）',
    tags: ['国风', '宫斗', '对话', '多格', '特写'], intents: ['dialogue', 'suspense'],
    desc: '六格密网，眼神与手部特写交替，纱幔/屏风做前后景分隔。',
    layout: row([1, 1, 1], [
      col([1.2, 1], ['two', 'close']),
      col([1, 1, 1], ['eye', 'medium', 'hand']),
      col([1, 1.1], ['face', 'medium']),
    ]),
  }),
  page({
    id: 'cn-page-urban', name: '国风·都市爱情（五格）',
    tags: ['国风', '都市', '恋爱', '中景'], intents: ['romance', 'dialogue', 'daily'],
    desc: '四格对切＋底部一长格，末格用横向长景收住情绪，彩漫常用的「甜」。',
    gutter: 18,
    layout: row([1, 1, 0.8], [
      col([1, 1], ['two', 'medium']),
      col([1, 1], ['close', 'face']),
      'panorama',
    ]),
  }),
  page({
    id: 'cn-page-xuanhuan', name: '国风·玄幻爆发（四格）',
    tags: ['国风', '玄幻', '大格', '冲击'], intents: ['impact', 'action', 'reveal'],
    desc: '一格吃掉下半页做技能光效，上带三小格交代双方与蓄力。',
    margin: 24, gutter: 20,
    layout: row([0.32, 0.68], [
      col([1, 1, 1.1], ['wide', 'face', 'hand']),
      leaf('impact', { bleed: ['left', 'right', 'bottom'] }),
    ]),
  }),
  page({
    id: 'cn-page-horror', name: '国风·志怪惊悚（五格）',
    tags: ['国风', '恐怖', '留白', '不对称'], intents: ['horror', 'suspense'],
    desc: '大面积浓墨留白＋小格突兀插入，中式恐怖讲「不该在那里出现的东西」。',
    margin: 26, gutter: 14,
    insets: [{ x: 0.62, y: 0.30, w: 0.26, h: 0.14, role: 'shadow', rot: -3, note: '不该出现的身影' }],
    layout: row([0.42, 0.30, 0.28], [
      col([1.6, 1], ['wide', 'object'], { slant: 0.08 }),
      col([1, 1], ['medium', 'close']),
      col([1, 1, 1], ['reaction', 'silence', 'face']),
    ]),
  }),
  page({
    id: 'cn-page-magazine', name: '国风·杂志四格横排（彩漫）', ratio: 'p34',
    tags: ['四格', '彩漫', '横向', '对称'], intents: ['gag', 'daily'],
    desc: '四格横排，左往右读，格子等分最利于手机竖屏缩略图识别。',
    layout: col([1, 1, 1, 1], ['wide', 'medium', 'close', 'face']),
  }),
  page({
    id: 'cn-page-splash', name: '国风·通版插图＋题字',
    tags: ['大格', '留白', '插图', '越界'], intents: ['scenery', 'emotion', 'silence'],
    desc: '整页一格，留出上方大字标题区；国漫单行本每话第一页的常规做法。',
    margin: 26,
    insets: [{ x: 0.08, y: 0.06, w: 0.84, h: 0.10, role: 'silence', note: '标题/题字区' }],
    layout: row([1], [leaf('impact', { bleed: true })]),
  }),
  page({
    id: 'cn-page-triple-band', name: '国风·三栏叙事（标准页）',
    tags: ['国风', '三段落', '中景', '对话'], intents: ['dialogue', 'daily', 'action'],
    desc: '三带：上两格、中两格、下两格，是最不容易出错的国漫叙事页。',
    layout: row([1, 1, 1], [
      col([1.4, 1], ['wide', 'close']),
      col([1, 1.3], ['two', 'medium']),
      col([1, 1, 1], ['face', 'medium', 'action']),
    ]),
  }),
  page({
    id: 'cn-page-vertical-split', name: '国风·竖切双线',
    tags: ['国风', '竖向', '双人', '对称'], intents: ['climax', 'dialogue', 'reveal'],
    desc: '页面被一条竖线劈成两条叙事线，左右各三格，适合「同时发生」。',
    gutter: 20,
    layout: col([1, 1], [
      row([1, 1.2, 1], ['wide', 'medium', 'close']),
      row([1.2, 1, 1], ['low', 'face', 'action']),
    ]),
  }),
  page({
    id: 'cn-page-quad', name: '国风·彩漫四格（2×2）', ratio: 'p34',
    tags: ['四格', '彩漫', '对称', '多格'], intents: ['gag', 'daily', 'dialogue'],
    desc: '2×2 四格彩漫，左往右读，节奏平均，最适合手机端的轻喜剧段落。',
    layout: row([1, 1], [
      col([1, 1], ['wide', 'medium']),
      col([1, 1], ['close', 'reaction']),
    ]),
  }),
  /* ================================================ 错位 / 不对齐（条漫进阶） */
  page({
    id: 'cn-page-chase', name: '国风·追逃斜线',
    tags: ['国风', '动势', '斜切', '速度线'], intents: ['chase', 'action'],
    desc: '整页用三条平行斜线切出格位，人物永远朝右下跑，读者视线被拽着走。',
    gutter: 14,
    layout: row([0.28, 0.34, 0.38], [
      col([1, 1.2], ['wide', 'action'], { slant: 0.16 }),
      col([1.2, 1], ['action', 'reaction'], { slant: 0.16 }),
      col([1, 1], ['wide', 'silence'], { slant: 0.16 }),
    ]),
  }),
  strip({
    id: 'cn-strip-offset', name: '条漫·错位四格（不对称）',
    tags: ['条漫', '留白', '不对称', '竖向'], intents: ['emotion', 'inner', 'silence'],
    desc: '四格都不满宽，左右交错偏置。读者视线被留白推着走，是条漫进阶的「呼吸」做法。',
    layout: row([1.2, 1, 1.3, 0.9], [
      leaf('wide', { pad: { left: 0.10 } }),
      leaf('medium', { pad: { right: 0.18 } }),
      leaf('close', { pad: { left: 0.06, right: 0.06 } }),
      leaf('silence', { pad: { left: 0.22 } }),
    ]),
  }),
  strip({
    id: 'cn-strip-triptych', name: '条漫·三栏并置',
    tags: ['条漫', '竖向', '多格', '并置'], intents: ['montage', 'dialogue', 'daily'],
    desc: '一屏内三栏并列，每栏高度不同；适合「同时发生的三件事」。',
    gutter: 22, margin: 40,
    layout: col([1, 1, 1], [
      row([1.4, 1], ['wide', 'medium']),
      row([1, 1.3], ['close', 'face']),
      row([1.2, 1, 0.9], ['medium', 'wide', 'silence']),
    ]),
  }),
  strip({
    id: 'cn-strip-cinema', name: '条漫·电影宽幅',
    tags: ['条漫', '横向', '全景', '越界'], intents: ['scenery', 'action', 'impact'],
    desc: '两条通宽出血的宽幅夹一枚收窄的特写，像宽银幕电影的分镜。',
    gutter: 40, margin: 34,
    layout: row([1.4, 0.9, 1.6], [
      leaf('panorama', { bleed: ['left', 'right'] }),
      leaf('close', { pad: { left: 0.24, right: 0.24 } }),
      leaf('impact', { bleed: ['left', 'right'] }),
    ]),
  }),
  strip({
    id: 'cn-strip-talk-offset', name: '条漫·对话错位（五格）',
    tags: ['条漫', '对话', '留白', '不对称'], intents: ['dialogue', 'daily'],
    desc: '五格左右交错，气泡可以放在宽出来的留白里；比等宽堆叠更像真实条漫。',
    gutter: 34, margin: 44,
    layout: row([1, 1.1, 1, 1.1, 0.9], [
      leaf('two', { pad: { right: 0.10 } }),
      leaf('close', { pad: { left: 0.14 } }),
      leaf('medium', { pad: { right: 0.06 } }),
      leaf('face', { pad: { left: 0.20 } }),
      leaf('silence', { pad: { left: 0.08, right: 0.08 } }),
    ]),
  }),
  page({
    id: 'cn-page-wuxia-duel', name: '国风·剑拔弩张（斜线页）',
    tags: ['国风', '武侠', '斜切', '对峙', '速度线'], intents: ['climax', 'action', 'impact'],
    desc: '整页三条平行斜线，人物永远朝斜线方向出招；国漫打斗页最提气的一张。',
    margin: 24, gutter: 15,
    layout: row([0.3, 0.38, 0.32], [
      col([1, 1.3], ['wide', 'low'], { slant: 0.12 }),
      col([1.2, 1, 1], ['action', 'impact', 'reaction'], { slant: 0.12 }),
      col([1, 1], ['wide', 'silence'], { slant: 0.12 }),
    ]),
  }),
  page({
    id: 'cn-page-magic', name: '国风·结印施法（五格）',
    tags: ['国风', '玄幻', '特写', '插入格'], intents: ['action', 'impact', 'reveal'],
    desc: '手部特写 ×2 + 中景蓄势 + 大格放光效 + 一枚无框空镜收尾。',
    gutter: 17,
    layout: row([0.26, 0.34, 0.40], [
      col([1, 1], ['hand', 'face']),
      col([1.4, 1], ['medium', 'eye'], { slant: 0.06 }),
      leaf('impact'),
    ]),
  }),
  page({
    id: 'cn-page-school', name: '国风·校园日常（七格）',
    tags: ['国风', '日常', '多格', '中景'], intents: ['daily', 'dialogue', 'gag'],
    desc: '七格 2/3/2 分布，格高留白均匀，适合轻松的社团/教室段落。',
    gutter: 14,
    layout: row([1, 1.1, 1], [
      col([1, 1], ['wide', 'two']),
      col([1, 1, 1], ['medium', 'close', 'object']),
      col([1, 1], ['face', 'silence']),
    ]),
  }),
  scroll({
    id: 'cn-scroll-horror', name: '长条漫·志怪长条（8 格）',
    tags: ['长条', '恐怖', '留白', '暗部'], intents: ['horror', 'suspense', 'reveal'],
    desc: '两次超长留白把读者悬在半空，中间只给一条缝和一个不该出现的影子。',
    gutter: 96, margin: 42,
    layout: row([0.8, 1.4, 0.6, 0.6, 1.6, 0.7, 1.1, 0.9], [
      'establish', 'wide', 'object', 'cutin', 'shadow', 'eye', 'medium', 'silence',
    ]),
  }),
];
