/**
 * bubbles.mjs — 文字气泡素材库
 *
 * 用途：分镜排版时「这一格要说什么」的最后一步。气泡是矢量形状 + 可编辑文字，
 * 直接画进页面 SVG，所以导出 PNG/SVG 时跟着一起走。
 *
 * 两类：
 *   - 形状按「对话/思考/喊叫/旁白/注释」五族分
 *   - UI 上分「推荐」（按当前格子的角色与节拍动态排序）与「常用」（使用频率）
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ============================== 通用几何工具 ============================== */
/** 极坐标 → 点；f(θ) 返回半径倍率 */
function polarPath(cx, cy, rx, ry, n, f, smooth = true) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = f(i, t);
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
  }
  return smooth ? catmullRom(pts) : polygon(pts);
}

function polygon(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z';
}

/** Catmull-Rom → 三次贝塞尔，闭合 */
function catmullRom(pts) {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + ' Z';
}

/** 气泡尾巴（三角） */
function tailPath(x, y, w, h, side, size) {
  const s = size || Math.min(w, h) * 0.34;
  if (side === 'none') return '';
  if (side === 'bl') {
    const bx = x + w * 0.26, by = y + h * 0.92;
    return polygon([[bx, by + s * 0.1], [bx + s * 0.62, by - s * 0.28], [bx + s * 0.12, by + s * 0.86]]);
  }
  if (side === 'br') {
    const bx = x + w * 0.74, by = y + h * 0.92;
    return polygon([[bx, by + s * 0.1], [bx - s * 0.62, by - s * 0.28], [bx - s * 0.12, by + s * 0.86]]);
  }
  if (side === 'top') {
    const bx = x + w * 0.6, by = y + h * 0.06;
    return polygon([[bx, by], [bx - s * 0.5, by - s * 0.72], [bx - s * 0.66, by - s * 0.1]]);
  }
  return '';
}

/* ============================== 气泡定义 ============================== */
export const BUBBLES = {
  'talk-ellipse': {
    zh: '椭圆对话泡', family: 'talk', w: 330, h: 150, tail: 'bl',
    hintZh: '最常用。适合普通对话，一行到两行字。',
    svg: (b, o) => `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}"/>`,
  },
  'talk-round': {
    zh: '圆角对话泡', family: 'talk', w: 340, h: 132, tail: 'bl', rx: 0.26,
    hintZh: '现代条漫/I 气口对话首选，比椭圆更"干净"。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) * 0.26}"/>`,
  },
  'talk-double': {
    zh: '双线对话泡', family: 'talk', w: 340, h: 156, tail: 'br', double: true,
    hintZh: '强调语气或重要台词，外圈留一道细边。',
    svg: (b) => `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}"/>`,
    extra: (b) => `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2 - 7}" ry="${b.h / 2 - 7}" fill="none"/>`,
  },
  'thought-cloud': {
    zh: '云朵思考泡', family: 'thought', w: 340, h: 170, tail: 'none', dots: true,
    hintZh: '心里想的事，不张口。云边 + 三个小圆。',
    svg: (b) => `<path d="${polarPath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 14, (i) => (i % 2 ? 0.93 : 1.0))}"/>`,
    extra: (b, o) => {
      const r = Math.min(b.w, b.h) * 0.055;
      const cx = b.x + b.w * 0.3, cy = b.y + b.h * 1.0;
      return [[0, 0, 1], [-r * 1.5, r * 1.7, 0.72], [-r * 2.7, r * 3.1, 0.5]]
        .map(([dx, dy, s]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r="${r * s}"/>`).join('');
    },
  },
  'thought-dashed': {
    zh: '虚框内心泡', family: 'thought', w: 320, h: 140, tail: 'bl', dash: true,
    hintZh: '内心独白/不确定的话。虚线让人觉得"未说出口"。',
    svg: (b) => `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}"/>`,
  },
  'burst-spike': {
    zh: '尖角喊叫泡', family: 'shout', w: 300, h: 190, tail: 'none',
    hintZh: '大喊、怒吼、受惊。尖角越密越激烈。',
    svg: (b) => `<path d="${polarPath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 22, (i) => (i % 2 ? 1.0 : 0.76))}"/>`,
  },
  'burst-explode': {
    zh: '爆炸冲击泡', family: 'shout', w: 300, h: 210, tail: 'none',
    hintZh: '冲击/爆炸瞬间的拟声或短喊，边缘不规则。',
    svg: (b) => `<path d="${polarPath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 20, (i) => 0.82 + 0.18 * ((i * 37) % 7) / 7)}"/>`,
  },
  'shout-heavy': {
    zh: '重描边方泡', family: 'shout', w: 300, h: 130, tail: 'none', heavy: true,
    hintZh: '不需要尖角也要压住场面的喊话，粗框。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) * 0.08}"/>`,
  },
  'narration-box': {
    zh: '旁白框', family: 'narration', w: 380, h: 108, tail: 'none', square: true,
    hintZh: '旁白/时间地点说明。直角细框，一般放画面上方。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`,
  },
  'caption-tab': {
    zh: '旁白标签', family: 'narration', w: 360, h: 96, tail: 'none', tab: true,
    hintZh: '带一条色块边的旁白，条漫里很常见（"三天后"）。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`,
  },
  'manga-inverse': {
    zh: '反白字幕条', family: 'narration', w: 360, h: 92, tail: 'none', inverse: true,
    hintZh: '黑底白字，强调一句判词或时间跳跃。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`,
  },
  'whisper-wavy': {
    zh: '耳语波纹泡', family: 'talk', w: 320, h: 150, tail: 'none',
    hintZh: '小声说、颤抖、虚弱。边缘起波纹。',
    svg: (b) => `<path d="${polarPath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 30, (i, t) => 0.96 + 0.05 * Math.sin(t * 18))}"/>`,
  },
  'small-caps': {
    zh: '小旁注', family: 'note', w: 230, h: 78, tail: 'none', small: true,
    hintZh: '拟声词旁边的小字或补充说明，字号更小。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) * 0.18}"/>`,
  },
  'arrow-callout': {
    zh: '箭头指示泡', family: 'note', w: 320, h: 112, tail: 'bl', arrow: true,
    hintZh: '指向画面某处的说明（"这里！"），带一个箭头。',
    svg: (b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) * 0.12}"/>`,
  },
};

export const BUBBLE_IDS = Object.keys(BUBBLES);

/* ============================== 推荐规则 ============================== */
const RECO_BY_ROLE = {
  reaction: ['burst-spike', 'talk-ellipse', 'small-caps'],
  action: ['burst-explode', 'shout-heavy', 'burst-spike'],
  impact: ['burst-explode', 'manga-inverse', 'burst-spike'],
  low: ['shout-heavy', 'burst-spike'],
  silence: ['narration-box', 'caption-tab'],
  inner: ['thought-dashed', 'thought-cloud'],
  eye: ['thought-dashed', 'small-caps'],
  face: ['talk-ellipse', 'thought-dashed', 'burst-spike'],
  close: ['talk-ellipse', 'thought-dashed'],
  medium: ['talk-round', 'talk-ellipse', 'narration-box'],
  two: ['talk-round', 'talk-ellipse'],
  wide: ['narration-box', 'caption-tab'],
  establish: ['narration-box', 'caption-tab'],
  panorama: ['caption-tab', 'narration-box'],
  object: ['small-caps', 'arrow-callout'],
  cutin: ['small-caps', 'arrow-callout'],
  hand: ['small-caps'],
  back: ['narration-box', 'thought-dashed'],
  shadow: ['narration-box', 'manga-inverse'],
  overhead: ['narration-box', 'caption-tab'],
  group: ['talk-round', 'narration-box'],
  full: ['talk-ellipse', 'narration-box'],
  grid: ['talk-ellipse'],
};

const DEFAULT_RECO = ['talk-ellipse', 'talk-round', 'narration-box', 'thought-cloud', 'burst-spike'];

/** 按格子角色/节拍给出推荐气泡（去重，最多 n 个） */
export function recommendBubbles({ role, beat, n = 6 } = {}) {
  const out = [];
  const push = (id) => { if (BUBBLES[id] && !out.includes(id)) out.push(id); };
  if (role && RECO_BY_ROLE[role]) RECO_BY_ROLE[role].forEach(push);
  if (beat && /喊|怒|吼|爆发|冲击/.test(beat)) ['burst-spike', 'burst-explode'].forEach(push);
  if (beat && /内|想|回忆/.test(beat)) ['thought-dashed', 'thought-cloud'].forEach(push);
  if (beat && /旁白|说明|时间/.test(beat)) ['narration-box', 'caption-tab'].forEach(push);
  DEFAULT_RECO.forEach(push);
  return out.slice(0, n);
}

/* ============================== 文字排版 ============================== */
/** 中英混排换行：中文按字断，英文按词断 */
export function wrapText(text, maxChars) {
  const src = String(text || '').replace(/\r/g, '');
  if (!src) return [];
  const lines = [];
  for (const para of src.split('\n')) {
    if (!para) { lines.push(''); continue; }
    let cur = '';
    const tokens = para.match(/[A-Za-z0-9']+|\s|[^\s]/g) || [];
    for (const t of tokens) {
      const next = cur + t;
      const visible = [...next.replace(/\s/g, '')].length;
      if (visible > maxChars && cur.trim()) {
        lines.push(cur.trim());
        cur = t === ' ' ? '' : t;
      } else {
        cur = next;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
  }
  return lines;
}

/**
 * 渲染一个气泡实例（供 svg.mjs 调用）
 * @param {object} b {type,x,y,w,h,rot,opacity,text,tail,fill,stroke,strokeWidth,fontSize}
 */
export function bubbleSVG(b, o = {}) {
  const def = BUBBLES[b.type] || BUBBLES['talk-ellipse'];
  const ink = b.stroke || o.ink || '#111111';
  const fill = b.fill || '#ffffff';
  const sw = b.strokeWidth ?? (def.heavy ? 7 : def.small ? 3 : 4.5);
  const opacity = b.opacity ?? 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const rot = b.rot ? ` rotate(${b.rot} ${cx} ${cy})` : '';
  const fontStack = o.fontStack || "ui-sans-serif,-apple-system,'Microsoft YaHei',sans-serif";

  const isInverse = def.inverse;
  const bodyFill = isInverse ? (b.fill || ink) : fill;
  const textColor = isInverse ? '#ffffff' : (b.textColor || ink);
  const dash = def.dash ? ` stroke-dasharray="${Math.max(6, b.h * 0.09)} ${Math.max(5, b.h * 0.07)}"` : '';

  const parts = [];
  parts.push(`<g opacity="${clamp(opacity, 0.05, 1)}" transform="${rot}">`);
  // 主体 + 尾巴（尾巴与主体同色，先画尾巴再画主体会留缝，故用同一 path 组）
  const tail = def.tail && def.tail !== 'none' ? tailPath(b.x, b.y, b.w, b.h, b.tail) : '';
  if (tail) {
    parts.push(`<path d="${tail}" fill="${bodyFill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  }
  parts.push(`<g fill="${bodyFill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"${dash}>${def.svg(b, o)}</g>`);

  if (def.extra) {
    parts.push(`<g fill="${bodyFill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round">${def.extra(b, o)}</g>`);
  }
  if (def.double) {
    parts.push(`<g fill="none" stroke="${ink}" stroke-width="${Math.max(1.4, sw * 0.35)}">${def.extra ? '' : ''}` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${b.w / 2 - sw * 1.6}" ry="${b.h / 2 - sw * 1.6}"/></g>`);
  }
  if (def.tab) {
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${Math.max(6, b.w * 0.035)}" height="${b.h}" fill="${o.accent || '#d0342c'}" stroke="none" opacity="0.9"/>`);
  }
  if (def.arrow) {
    const ax = b.x + b.w * 0.18, ay = b.y + b.h + 2;
    parts.push(`<path d="M${ax} ${ay} L${ax - b.h * 0.34} ${ay + b.h * 0.42} L${ax + b.h * 0.18} ${ay + b.h * 0.34} Z" fill="${bodyFill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  }

  // 文字
  const text = String(b.text || '').trim();
  if (text) {
    const fs = b.fontSize || clamp(Math.min(b.h * 0.19, b.w * 0.115), 9, 30);
    const maxChars = Math.max(3, Math.floor((b.w * 0.84) / fs));
    const lines = wrapText(text, maxChars);
    const lineH = fs * 1.42;
    const totalH = lines.length * lineH;
    const startY = cy - totalH / 2 + fs * 0.98;
    const inner = b.w * 0.08;
    parts.push(`<text x="${cx}" y="${startY}" text-anchor="middle" font-family="${fontStack}" font-size="${fs}" fill="${textColor}" opacity="0.95">` +
      lines.map((ln, i) => `<tspan x="${cx}" y="${startY + i * lineH}">${escXML(ln)}</tspan>`).join('') + '</text>');
    if (inner < 0) parts.push('');
  }
  parts.push('</g>');
  return parts.join('');
}

const escXML = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** 面板用的小预览（独立 <svg>，可直接塞进 HTML） */
export function bubbleThumb(type, width = 96) {
  const def = BUBBLES[type] || BUBBLES['talk-ellipse'];
  const ratio = def.w / def.h;
  const h = Math.max(26, Math.round(width / ratio));
  const inner = bubbleSVG({ type, x: 5, y: 6, w: width - 10, h: h - 10, opacity: 0.95, strokeWidth: 2.2 }, {});
  return `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<rect width="${width}" height="${h}" fill="#ffffff"/>${inner}</svg>`;
}

/** 新建一个气泡实例（默认尺寸按页面比例换算） */
export function makeBubble(type, { page, at, text } = {}) {
  const def = BUBBLES[type] || BUBBLES['talk-ellipse'];
  const pw = page?.w || 1000;
  const scale = pw / 1000;
  const w = def.w * scale;
  const h = def.h * scale;
  const x = clamp((at?.x ?? page.w * 0.5) - w / 2, 0, page.w - w);
  const y = clamp((at?.y ?? page.h * 0.22) - h / 2, 0, page.h - h);
  return {
    id: 'b' + Math.random().toString(36).slice(2, 8),
    type,
    x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
    rot: 0, opacity: 0.92, text: text || '',
    tail: def.tail || 'none',
  };
}
