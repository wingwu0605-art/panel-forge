/**
 * library-kr.mjs — 韩式漫画（웹툰 / 만화）分镜模板
 *
 * 韩漫两条线：
 *   ① 웹툰（竖屏滚动）：无边框、以「여백 留白」计时，镜头是电影式的——大远景、长留白、
 *      연출（导演调度）靠格与格之间的空白而非格线；
 *   ② 인쇄만화（印刷漫画）：左往右读，细线框，密度高于日漫。
 */
import { row, col, leaf } from './geometry.mjs';

const webtoon = (o) => ({ culture: 'kr', reading: 'vertical', ratio: 'strip', frame: 'none', margin: 58, gutter: 54, ...o });
const scroll = (o) => ({ culture: 'kr', reading: 'vertical', ratio: 'scroll', frame: 'none', margin: 60, gutter: 58, ...o });
const tall = (o) => ({ culture: 'kr', reading: 'vertical', ratio: 'tall', frame: 'none', margin: 56, gutter: 52, ...o });
const print = (o) => ({ culture: 'kr', reading: 'ltr', ratio: 'a4', frame: 'hairline', margin: 28, gutter: 14, ...o });

export default [
  /* ==================================================== 웹툰 竖屏滚动 */
  webtoon({
    id: 'kr-webtoon-opening', name: '웹툰·开场（大片式定场）',
    tags: ['条漫', '全景', '留白', '大片感'], intents: ['scenery', 'daily', 'inner'],
    desc: '首格超大横长景（近半屏），只交代时间地点；后面三格才出现人物。韩漫的「电影开场」。',
    layout: row([2.1, 1.1, 0.9, 0.8], ['panorama', 'wide', 'medium', 'face']),
  }),
  webtoon({
    id: 'kr-webtoon-mood', name: '웹툰·氛围两格（大留白）',
    tags: ['条漫', '留白', '静默', '氛围'], intents: ['silence', 'inner', 'emotion'],
    desc: '两格之间留出接近一屏的空白，时间在留白里流逝。韩国导演最爱的「呼吸」。',
    gutter: 150, margin: 52,
    layout: row([1, 1.15], ['silence', 'wide']),
  }),
  webtoon({
    id: 'kr-webtoon-emotion', name: '웹툰·情绪四连（推近）',
    tags: ['条漫', '特写', '推镜', '情绪'], intents: ['emotion', 'romance', 'inner'],
    desc: '全景 → 中景 → 面部 → 眼部，四格一路推近，留白逐格变大。',
    layout: row([1.2, 1, 1.1, 1.3], ['wide', 'medium', 'face', 'eye']),
  }),
  webtoon({
    id: 'kr-webtoon-dialogue', name: '웹툰·对话五格',
    tags: ['条漫', '对话', '中景', '留白'], intents: ['dialogue', 'daily'],
    desc: '五格中景对切，格高一致，气泡放在画面外的留白里。竖屏阅读最稳的对话版式。',
    gutter: 64,
    layout: row([1, 1, 1, 1, 1.1], ['two', 'medium', 'close', 'medium', 'silence']),
  }),
  webtoon({
    id: 'kr-webtoon-action', name: '웹툰·动作八格（快剪）',
    tags: ['条漫', '动作', '多格', '快节奏'], intents: ['action', 'chase', 'impact'],
    desc: '八格：起手 → 三次交锋 → 受击 → 反击 → 大格冲击 → 余波。格高由疏到密再放开。',
    frame: 'hairline', gutter: 20, margin: 34,
    layout: row([1.1, 0.8, 0.8, 0.8, 1.2, 0.9, 1.8, 1], [
      'wide', 'action', 'action', 'reaction', 'action', 'close', 'impact', 'silence',
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-climax', name: '웹툰·高潮三格（越界）',
    tags: ['条漫', '大格', '越界', '冲击'], intents: ['climax', 'impact', 'reveal'],
    desc: '三格吃掉整屏，中间一格左右出血，人物直接冲出画面边界。',
    margin: 40, gutter: 36,
    layout: row([1, 1.5, 0.9], [
      leaf('low', { bleed: ['left', 'right'] }),
      leaf('impact', { bleed: ['left', 'right'] }),
      leaf('silence', { bleed: ['left', 'right'] }),
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-romance', name: '웹툰·心动五格',
    tags: ['条漫', '恋爱', '留白', '特写'], intents: ['romance', 'emotion'],
    desc: '双人中景 → 偷看 → 手部 → 眼神 → 大留白，心动靠「不敢看」的空格表达。',
    gutter: 70,
    layout: row([1.2, 0.9, 0.8, 1.1, 1.3], ['two', 'close', 'hand', 'eye', 'silence']),
  }),
  webtoon({
    id: 'kr-webtoon-thriller', name: '웹툰·惊悚六格',
    tags: ['条漫', '惊悚', '暗部', '不对称'], intents: ['suspense', 'horror'],
    desc: '黑场与特写交替，窄格像被压住呼吸；最后一格只剩一点点光。',
    frame: 'hairline', margin: 36, gutter: 28,
    layout: row([1.4, 0.6, 0.9, 0.6, 1.1, 0.7], [
      'establish', 'object', 'face', 'cutin', 'wide', 'eye',
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-flashback', name: '웹툰·回忆四格（去框）',
    tags: ['条漫', '回忆', '无框', '留白'], intents: ['inner', 'emotion'],
    desc: '全无框线，格与格之间只靠留白分隔；色彩建议做褪色处理区分时空。',
    gutter: 96, margin: 12,
    layout: row([1, 1, 1, 1], [
      leaf('silence', { borderless: true }),
      leaf('medium', { borderless: true }),
      leaf('face', { borderless: true }),
      leaf('back', { borderless: true }),
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-gag', name: '웹툰·搞笑五格',
    tags: ['条漫', '搞笑', '反应格', '小格'], intents: ['gag', 'daily'],
    desc: '铺垫两格 → 停顿 → 放大反应 → 收尾；末格留白让人笑完。',
    frame: 'hairline', gutter: 34,
    layout: row([1, 1, 0.7, 1.4, 0.8], ['medium', 'two', 'silence', 'reaction', 'silence']),
  }),
  webtoon({
    id: 'kr-webtoon-hook', name: '웹툰·截断钩子',
    tags: ['条漫', '悬念', '留白', '截断'], intents: ['suspense', 'reveal'],
    desc: '末格故意被屏幕切掉一半——每话结尾让人必须往下滑。',
    margin: 46, gutter: 44,
    layout: row([0.9, 1.2, 1.7], ['object', 'medium', 'face']),
  }),
  webtoon({
    id: 'kr-webtoon-insert', name: '웹툰·插入格叠压',
    tags: ['条漫', '插入格', '叠盖', '特写'], intents: ['suspense', 'emotion', 'dialogue'],
    desc: '主格上压两枚无框小格做特写插入，韩漫常用的「同时给两个人反应」。',
    insets: [
      { x: 0.06, y: 0.36, w: 0.30, h: 0.13, role: 'face', rot: -2 },
      { x: 0.62, y: 0.60, w: 0.30, h: 0.13, role: 'eye', rot: 2 },
    ],
    layout: row([1.5, 1.3, 1.2], ['wide', 'medium', 'two']),
  }),
  webtoon({
    id: 'kr-webtoon-split', name: '웹툰·双栏分割',
    tags: ['条漫', '竖向', '双人', '对称'], intents: ['dialogue', 'climax', 'romance'],
    desc: '左右两栏各讲一个人，竖屏也能做平行叙事；中间留缝当「心墙」。',
    gutter: 20, margin: 40,
    layout: col([1, 1], [
      row([1.2, 1, 1], ['medium', 'close', 'hand']),
      row([1, 1, 1.2], ['close', 'medium', 'face']),
    ]),
  }),
  tall({
    id: 'kr-tall-nine', name: '웹툰·九格速写（1:2）',
    tags: ['条漫', '多格', '快节奏', '速写'], intents: ['daily', 'montage', 'dialogue'],
    desc: '九格等高，适合日常段落与快速信息交代；手机上一屏能扫完。',
    gutter: 40, margin: 46,
    layout: row([1, 1, 1, 1, 1, 1, 1, 1, 1], [
      'panorama', 'wide', 'medium', 'two', 'close', 'object', 'face', 'reaction', 'silence',
    ]),
  }),
  tall({
    id: 'kr-tall-longtake', name: '웹툰·一镜到底（长留白）',
    tags: ['条漫', '留白', '氛围', '长镜头'], intents: ['silence', 'scenery', 'inner'],
    desc: '三格之间各留大半屏空白，像长镜头慢慢摇过去。适合悲伤或时间流逝。',
    gutter: 180, margin: 50,
    layout: row([1, 1, 1], ['panorama', 'wide', 'silence']),
  }),
  tall({
    id: 'kr-tall-versus', name: '웹툰·对视两格',
    tags: ['条漫', '双人', '特写', '对峙'], intents: ['climax', 'romance', 'reveal'],
    desc: '上下两格各给一个人特写，视线在中间留白处相撞。',
    gutter: 120, margin: 48,
    layout: row([1, 1], ['face', 'face']),
  }),

  /* ================================================ 长条漫（1:2.6）连载 */
  scroll({
    id: 'kr-scroll-episode', name: '长条漫·一话开场（10 格）',
    tags: ['长条', '多格', '叙事完整', '连载'], intents: ['daily', 'scenery', 'dialogue'],
    desc: '一话开头：大景 → 中景 → 人物 → 对话 ×4 → 反应 → 转场空镜。连载骨架。',
    layout: row([1.8, 1.2, 1, 1, 1, 1, 1, 1.1, 1, 1.4], [
      'panorama', 'wide', 'medium', 'two', 'close', 'medium', 'close', 'reaction', 'medium', 'silence',
    ]),
  }),
  scroll({
    id: 'kr-scroll-fight', name: '长条漫·打斗长条（11 格）',
    tags: ['长条', '动作', '多格', '长镜头'], intents: ['action', 'impact', 'chase'],
    desc: '十一格一镜到底：试探 → 三连击 → 中招 → 反击 → 大格 → 余波 → 留白。',
    frame: 'hairline', gutter: 22, margin: 34,
    layout: row([1.1, 0.8, 0.8, 0.8, 1.4, 0.7, 0.9, 1.9, 1, 0.9, 1.2], [
      'wide', 'action', 'action', 'reaction', 'action', 'cutin', 'close', 'impact', 'low', 'medium', 'silence',
    ]),
  }),
  scroll({
    id: 'kr-scroll-mystery', name: '长条漫·悬疑长条（9 格）',
    tags: ['长条', '悬疑', '暗部', '留白'], intents: ['suspense', 'horror', 'reveal'],
    desc: '小物件特写与黑场交替，两次大留白卡在关键信息前。',
    gutter: 66, margin: 46,
    layout: row([0.7, 0.7, 1.4, 0.6, 0.6, 1.6, 0.7, 0.8, 1.1], [
      'object', 'cutin', 'wide', 'hand', 'eye', 'face', 'object', 'close', 'silence',
    ]),
  }),
  scroll({
    id: 'kr-scroll-romance', name: '长条漫·恋爱长条（8 格）',
    tags: ['长条', '恋爱', '留白', '特写'], intents: ['romance', 'emotion', 'daily'],
    desc: '格高先大后小再放大，视线在两人之间来回；留白替代所有没说出口的话。',
    gutter: 72, margin: 50,
    layout: row([1.3, 0.9, 1, 0.8, 1, 1.2, 0.9, 1.5], [
      'wide', 'medium', 'two', 'hand', 'close', 'face', 'eye', 'silence',
    ]),
  }),
  scroll({
    id: 'kr-scroll-reveal', name: '长条漫·反转长条（7 格）',
    tags: ['长条', '反转', '大格', '留白'], intents: ['reveal', 'climax', 'suspense'],
    desc: '前四格切得很碎（不安）→ 第五格整屏放开（真相）→ 两格静默消化。',
    gutter: 34, margin: 40,
    layout: row([0.8, 0.8, 0.7, 0.8, 2.8, 1, 1.2], [
      'face', 'hand', 'object', 'close', 'impact', 'reaction', 'silence',
    ]),
  }),
  scroll({
    id: 'kr-scroll-time', name: '长条漫·时间流逝（12 格）',
    tags: ['长条', '蒙太奇', '多格', '留白'], intents: ['montage', 'inner'],
    desc: '十二格等高，像翻日历；每格同机位不同时间，最后两格放大做落点。',
    gutter: 30, margin: 44,
    layout: row([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.4, 1.6], [
      'panorama', 'wide', 'wide', 'medium', 'medium', 'object', 'close', 'wide', 'medium', 'close', 'face', 'silence',
    ]),
  }),

  /* ============================================== 인쇄만화 印刷漫画（LTR） */
  print({
    id: 'kr-print-4tier', name: '만화·四段定格（印刷）',
    tags: ['页漫', '多格', '对话', '竖向'], intents: ['dialogue', 'daily'],
    desc: '四条横带，每带二至三格，韩国印刷漫画最常见的叙事页。',
    layout: row([1, 1, 1, 1], [
      col([1, 1], ['wide', 'medium']),
      col([1, 1, 1], ['close', 'two', 'reaction']),
      col([1.3, 1], ['medium', 'face']),
      col([1, 1], ['close', 'silence']),
    ]),
  }),
  print({
    id: 'kr-print-action', name: '만화·动作页',
    tags: ['页漫', '动作', '斜切', '大格'], intents: ['action', 'impact', 'chase'],
    desc: '上带斜切，中间大格放冲击，下带三小格收势；韩式动作更偏写实透视。',
    layout: row([0.32, 0.42, 0.26], [
      col([1.2, 1], ['wide', 'action'], { slant: 0.08 }),
      leaf('impact'),
      col([1, 1, 1], ['reaction', 'medium', 'silence']),
    ]),
  }),
  print({
    id: 'kr-print-dialogue', name: '만화·对话密网',
    tags: ['页漫', '对话', '多格', '特写'], intents: ['dialogue', 'suspense'],
    desc: '六格密网，特写与中景交替，信息密度高，适合职场、法庭、谈判。',
    layout: row([1, 1, 1], [
      col([1, 1.2], ['two', 'close']),
      col([1, 1, 1], ['face', 'medium', 'hand']),
      col([1.2, 1], ['medium', 'close']),
    ]),
  }),
  print({
    id: 'kr-print-romance', name: '만화·恋爱页',
    tags: ['页漫', '恋爱', '留白', '特写'], intents: ['romance', 'emotion'],
    desc: '四格＋底部一条长景；格线细、留白多，是韩国少女漫画的甜度配方。',
    gutter: 18,
    layout: row([1, 1, 0.8], [
      col([1, 1], ['two', 'close']),
      col([1, 1], ['face', 'eye']),
      'panorama',
    ]),
  }),
  print({
    id: 'kr-print-drama', name: '만화·正剧三格',
    tags: ['页漫', '对话', '中景', '留白'], intents: ['dialogue', 'emotion', 'climax'],
    desc: '三格就把一场戏讲完：双人 → 特写 → 空镜；留白越大，台词越重。',
    margin: 34, gutter: 22,
    layout: row([1.2, 1, 0.8], ['two', 'face', 'silence']),
  }),
  print({
    id: 'kr-print-horror', name: '만화·恐怖页',
    tags: ['页漫', '恐怖', '不对称', '暗部'], intents: ['horror', 'suspense'],
    desc: '大格压顶＋底下碎格，黑色面积占比极高，最后一格只有一条缝。',
    margin: 24, gutter: 16,
    layout: row([0.52, 0.24, 0.24], [
      col([1, 1.6], ['establish', 'shadow'], { slant: 0.06 }),
      col([1, 1], ['object', 'face']),
      col([1, 1, 1], ['reaction', 'silence', 'eye']),
    ]),
  }),
  print({
    id: 'kr-print-splash', name: '만화·通版插图',
    tags: ['大格', '留白', '插图', '越界'], intents: ['scenery', 'emotion', 'silence'],
    desc: '整页一格，角落压一枚小特写；印刷漫画的「呼吸页」。',
    margin: 26,
    insets: [{ x: 0.60, y: 0.78, w: 0.30, h: 0.16, role: 'eye', note: '角格特写' }],
    layout: row([1], [leaf('impact', { bleed: true })]),
  }),
  print({
    id: 'kr-print-montage', name: '만화·蒙太奇六格',
    tags: ['页漫', '蒙太奇', '多格', '横向'], intents: ['montage', 'inner'],
    desc: '六格等高横带，同机位不同时刻，一页讲完一段时间。',
    gutter: 12,
    layout: row([1, 1, 1, 1, 1, 1], ['panorama', 'wide', 'medium', 'object', 'close', 'silence']),
  }),
  print({
    id: 'kr-print-climax', name: '만화·对峙页',
    tags: ['页漫', '对峙', '对称', '大格'], intents: ['climax', 'suspense'],
    desc: '中缝竖切，两人各占半边，上带一条横长景交代距离。',
    layout: col([1, 1], [
      row([1.4, 1, 1], ['panorama', 'low', 'close']),
      row([1, 1, 1.4], ['close', 'low', 'panorama']),
    ]),
  }),
  print({
    id: 'kr-print-gag', name: '만화·搞笑四格',
    tags: ['页漫', '搞笑', '小格', '反应格'], intents: ['gag', 'daily'],
    desc: '四格横带，越往下越窄，包袱落在最后被压扁的一格里。',
    gutter: 12,
    layout: row([1.2, 1, 0.85, 0.7], ['wide', 'medium', 'close', 'reaction']),
  }),

  /* ================================================ 웹툰 进阶：错位与并置 */
  webtoon({
    id: 'kr-webtoon-offset', name: '웹툰·错位单格（招牌不对称）',
    tags: ['条漫', '留白', '不对称', '竖向'], intents: ['emotion', 'inner', 'silence'],
    desc: '韩漫招牌手法：格子故意不满宽、左右交错，留白就是「沉默的时间」。',
    layout: row([1.3, 1, 1.2, 0.9], [
      leaf('wide', { pad: { left: 0.08 } }),
      leaf('close', { pad: { right: 0.20 } }),
      leaf('face', { pad: { left: 0.10, right: 0.04 } }),
      leaf('silence', { pad: { left: 0.26 } }),
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-duo-offset', name: '웹툰·双人错位',
    tags: ['条漫', '双人', '留白', '不对称'], intents: ['romance', 'dialogue', 'emotion'],
    desc: '两格各偏向一侧，视线在中间的空白里相遇——比并排更有暧昧感。',
    gutter: 76,
    layout: row([1, 1], [
      leaf('medium', { pad: { right: 0.16 } }),
      leaf('close', { pad: { left: 0.16 } }),
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-triptych', name: '웹툰·三栏并置',
    tags: ['条漫', '竖向', '多格', '并置'], intents: ['montage', 'dialogue', 'daily'],
    desc: '一屏三栏，栏高不同；同时讲三条线，读者一眼扫完。',
    gutter: 24, margin: 38,
    layout: col([1, 1, 1], [
      row([1.3, 1], ['wide', 'medium']),
      row([1, 1.4], ['close', 'face']),
      row([1.2, 1, 0.8], ['medium', 'wide', 'silence']),
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-cinema', name: '웹툰·宽幅电影感',
    tags: ['条漫', '横向', '全景', '越界'], intents: ['scenery', 'impact', 'action'],
    desc: '两条通宽出血宽幅夹一枚收窄特写——韩漫最像「电影截帧」的版式。',
    gutter: 44, margin: 30,
    layout: row([1.5, 0.85, 1.7], [
      leaf('panorama', { bleed: ['left', 'right'] }),
      leaf('close', { pad: { left: 0.26, right: 0.26 } }),
      leaf('impact', { bleed: ['left', 'right'] }),
    ]),
  }),
  tall({
    id: 'kr-tall-rail', name: '웹툰·窄栏特写（竖条）',
    tags: ['条漫', '竖向', '特写', '不对称'], intents: ['emotion', 'suspense', 'inner'],
    desc: '一条窄长格贯穿全屏，只放一个人物或一双眼；大面积留白让人物「孤零零」。',
    gutter: 30, margin: 40,
    layout: col([1, 0.42], [
      row([1, 1, 1], ['wide', 'medium', 'silence']),
      row([1.2, 1, 1], ['close', 'eye', 'hand']),
    ]),
  }),
  scroll({
    id: 'kr-scroll-season', name: '长条漫·季节转场（9 格）',
    tags: ['长条', '蒙太奇', '留白', '转场'], intents: ['montage', 'scenery', 'inner'],
    desc: '九格按季节递进，格高从左到右再上下变化，像翻一年的日历。',
    gutter: 48, margin: 46,
    layout: row([1.4, 0.8, 0.8, 0.8, 1.6, 0.9, 0.9, 1.1, 1.5], [
      'panorama', 'wide', 'object', 'medium', 'wide', 'close', 'medium', 'face', 'silence',
    ]),
  }),
  webtoon({
    id: 'kr-webtoon-insert2', name: '웹툰·对角插入格',
    tags: ['条漫', '插入格', '叠盖', '特写'], intents: ['suspense', 'reveal', 'emotion'],
    desc: '四格主体 + 两枚斜置插入格，把「同时在看」的两件事压进同一屏。',
    insets: [
      { x: 0.07, y: 0.06, w: 0.34, h: 0.11, role: 'eye', rot: -3 },
      { x: 0.58, y: 0.44, w: 0.34, h: 0.11, role: 'hand', rot: 3 },
    ],
    layout: row([1.3, 1.1, 1, 1.2], ['wide', 'two', 'close', 'silence']),
  }),
  print({
    id: 'kr-print-grid5', name: '만화·五格密排',
    tags: ['页漫', '多格', '对话', '特写'], intents: ['dialogue', 'action', 'suspense'],
    desc: '五格：上二下一大二，密度高但有呼吸位，适合信息量大的中段。',
    gutter: 13,
    layout: row([1, 1.25], [
      col([1, 1.2], ['wide', 'medium']),
      col([1.3, 1, 1], ['close', 'face', 'action']),
    ]),
  }),
];
