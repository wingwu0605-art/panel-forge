/**
 * svg.mjs — 模板渲染器（服务端与浏览器共用同一份实现，保证导出/预览完全一致）
 *
 * 输出「镂空模板」：只有格子轮廓，格子内可选嵌入图片。
 * 图片按 clipPath 裁切，因此任何矩形图片塞进任意斜切格都会自然贴合。
 */
import { polyPathD, polyClipCSS, DEFAULT_GUTTER } from './geometry.mjs';
import { ROLES } from './taxonomy.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Math.round(v * 100) / 100;
let UID = 0; // 每个 SVG 实例独立的 id 前缀，避免同页面多个 SVG 的 clipPath 互相串台

const FRAME_STYLE = {
  ink:      { w: 5.5, color: '#111111' },   // 日式墨线
  bold:     { w: 8,   color: '#0a0a0a' },   // 国漫重框
  hairline: { w: 2.2, color: '#2b2b2b' },   // 细线
  none:     { w: 0,   color: 'transparent' }, // 韩漫无框
};

/**
 * 计算图片在某一格内的摆放（cover / contain + 缩放 + 平移）
 * @returns {{x,y,w,h,rotate,cx,cy}}
 */
export function imageLayout(slot, img = {}) {
  const zoom = img.zoom ?? 1;
  const mode = img.mode || 'cover';
  const iw = img.iw || 0, ih = img.ih || 0;
  const cx = slot.x + slot.w / 2 + (img.panX ?? 0);
  const cy = slot.y + slot.h / 2 + (img.panY ?? 0);
  if (!iw || !ih) {
    return { x: slot.x, y: slot.y, w: slot.w, h: slot.h, cx, cy, rotate: img.rotate ?? 0, unknown: true };
  }
  let s = mode === 'contain' ? Math.min(slot.w / iw, slot.h / ih) : Math.max(slot.w / iw, slot.h / ih);
  s *= zoom;
  const dw = iw * s, dh = ih * s;
  return { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, cx, cy, rotate: img.rotate ?? 0 };
}

/**
 * 渲染整页 SVG
 * @param {object} tpl  finalizeTemplate 后的模板
 * @param {object} o    {width, frame, strokeScale, bg, images, showNumbers, showRoles, showGuides, ink, accent}
 */
export function renderTemplateSVG(tpl, o = {}) {
  const page = tpl.page;
  const width = o.width || 1000;
  const height = Math.round((width * page.h) / page.w);
  const frameKey = o.frame || tpl.frame || 'ink';
  const fs = FRAME_STYLE[frameKey] || FRAME_STYLE.ink;
  const strokeW = fs.w * (o.strokeScale ?? 1);
  const ink = o.ink || fs.color;
  const accent = o.accent || '#d0342c';
  const bg = o.bg || '#ffffff';
  const showNumbers = !!o.showNumbers;
  const showRoles = !!o.showRoles;
  const images = o.images || {};
  const selectedId = o.selectedId || null;
  const hoverId = o.hoverId || null;
  const fontStack = "ui-sans-serif,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif";
  const uid = o.idPrefix || `pf${++UID}`;

  const defs = [];
  const body = [];

  const slots = [...tpl.slots].sort((a, b) => (a.over === b.over ? a.order - b.order : a.over ? 1 : -1));

  for (const s of slots) {
    const d = polyPathD(s.poly);
    const cid = `${uid}-${s.id}`;
    defs.push(`<clipPath id="clip-${esc(cid)}"><path d="${d}"/></clipPath>`);

    const img = images[s.id];
    if (img && img.href) {
      const L = imageLayout(s, img);
      const rot = L.rotate ? ` rotate(${n(L.rotate)} ${n(L.cx)} ${n(L.cy)})` : '';
      const href = String(img.href);
      // 尺寸未知时用 slice（等比裁切填满），已知时用精确变换（支持缩放/平移）
      const par = L.unknown ? 'xMidYMid slice' : 'none';
      body.push(
        `<g clip-path="url(#clip-${esc(cid)})">` +
        `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="${esc(o.mat || '#111')}"/>` +
        `<image x="${n(L.x)}" y="${n(L.y)}" width="${n(L.w)}" height="${n(L.h)}" preserveAspectRatio="${par}" ` +
        `href="${esc(href)}" transform="${rot}"/></g>`
      );
    } else if (o.showEmptyTint !== false) {
      // 镂空状态：淡淡的地子，方便看出格子形状
      body.push(`<path d="${d}" fill="#f6f6f4" fill-opacity="0"/>`);
    }

    if (strokeW > 0 && !s.borderless) {
      if (s.over) {
        // 叠盖插入格：先描一圈白边把它从底格里「抬」出来
        body.push(`<path d="${d}" fill="none" stroke="${bg}" stroke-width="${n(strokeW * 2.6)}" stroke-linejoin="miter"/>`);
      }
      body.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n(strokeW)}" stroke-linejoin="miter" stroke-linecap="square"/>`);
    } else if (o.slotOutline !== false) {
      // 无框 / 裸格（韩式 webtoon、少女漫留白格）：虚线参考轮廓，让「镂空格」可见
      body.push(`<path d="${d}" fill="none" stroke="#8a8a86" stroke-opacity="0.6" stroke-width="2" stroke-dasharray="12 10" stroke-linejoin="miter"/>`);
    }

    if (selectedId === s.id || hoverId === s.id) {
      const isSel = selectedId === s.id;
      body.push(`<path d="${d}" fill="${isSel ? accent : '#000'}" fill-opacity="${isSel ? 0.05 : 0.03}" ` +
        `stroke="${accent}" stroke-opacity="${isSel ? 1 : 0.55}" stroke-width="${n(Math.max(3, strokeW * 1.25))}" stroke-linejoin="miter"/>`);
      if (isSel) {
        const pts = s.poly;
        body.push(pts.map(([x, y]) =>
          `<circle cx="${n(x)}" cy="${n(y)}" r="${n(strokeW * 1.05)}" fill="${bg}" stroke="${accent}" stroke-width="${n(strokeW * 0.55)}"/>`).join(''));
      }
    }

    if (showNumbers) {
      // 紧凑格号：小圆徽标，永远贴在格子左上角内侧
      const r = Math.max(11, Math.min(19, Math.min(s.w, s.h) * 0.095));
      const cx = s.x + r + Math.max(5, s.w * 0.02);
      const cy = s.y + r + Math.max(5, s.h * 0.02);
      body.push(
        `<g><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#ffffff" fill-opacity="0.9" stroke="${esc(accent)}" stroke-width="${n(Math.max(1.6, r * 0.16))}"/>` +
        `<text x="${n(cx)}" y="${n(cy + r * 0.36)}" text-anchor="middle" font-family="${fontStack}" font-size="${n(r * 1.12)}" font-weight="600" fill="${esc(accent)}">${s.order}</text></g>`
      );
    }
    if (showRoles && s.w > 250 && s.h > 165) {
      // 放得下才标角色名，避免小格糊成一团
      const role = ROLES[s.role];
      const text = role ? role.zh : s.role;
      const fsz = Math.max(13, Math.min(20, s.w * 0.055));
      const pad = fsz * 0.45;
      const tw = text.length * fsz * 0.98 + pad * 2;
      const bx = s.x + Math.max(6, s.w * 0.02);
      const by = s.y + s.h - fsz * 1.9;
      body.push(
        `<g opacity="0.94"><rect x="${n(bx)}" y="${n(by)}" width="${n(tw)}" height="${n(fsz * 1.55)}" rx="${n(fsz * 0.4)}" fill="#ffffff" fill-opacity="0.9" stroke="${esc(ink)}" stroke-opacity="0.3" stroke-width="${n(fsz * 0.06)}"/>` +
        `<text x="${n(bx + pad)}" y="${n(by + fsz * 1.12)}" font-family="${fontStack}" font-size="${n(fsz)}" fill="${esc(ink)}" fill-opacity="0.85">${esc(text)}</text></g>`
      );
    }
  }

  const guides = o.showGuides
    ? `<g stroke="${esc(accent)}" stroke-opacity="0.35" stroke-dasharray="6 6" stroke-width="1.5" fill="none">` +
      `<rect x="${tpl.margin}" y="${tpl.margin}" width="${n(page.w - tpl.margin * 2)}" height="${n(page.h - tpl.margin * 2)}"/></g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${page.w} ${page.h}" ` +
    `shape-rendering="geometricPrecision" style="background:${bg}">` +
    `<rect x="0" y="0" width="${page.w}" height="${page.h}" fill="${bg}"/>` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    guides + body.join('') + `</svg>`;
}

/** 仅供 API 输出的辅助信息：每格的 clip-path / 尺寸建议 */
export function slotMeta(tpl, s) {
  const role = ROLES[s.role] || { zh: s.role, shot: s.role, hint: '', prompt: '' };
  return {
    id: s.id,
    order: s.order,
    role: s.role,
    roleZh: role.zh,
    shot: role.shot,
    hint: role.hint,
    aspect: s.aspect,
    aspectLabel: ratioLabel(s.w, s.h),
    size: { w: s.w, h: s.h },
    areaPct: s.area,
    box: { x: s.x, y: s.y, w: s.w, h: s.h },
    poly: s.poly,
    clipPath: polyClipCSS(s.poly, tpl.page),
    px: {
      // 按 A4 300dpi / 目标导出宽度给出的建议像素
      atWidth: (W) => ({ w: Math.round((s.w / tpl.page.w) * W), h: Math.round((s.h / tpl.page.w) * W) }),
    },
  };
}

/** 将格子的宽高比换算成最接近的常用画幅 */
export function ratioLabel(w, h) {
  const r = w / h;
  const table = [
    [1 / 2, '1:2'], [9 / 16, '9:16'], [2 / 3, '2:3'], [3 / 4, '3:4'], [4 / 5, '4:5'],
    [1, '1:1'], [5 / 4, '5:4'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'],
    [2, '2:1'], [5 / 2, '5:2'], [3, '3:1'], [4, '4:1'],
  ];
  let best = table[0], bd = Infinity;
  for (const [v, lab] of table) {
    const d = Math.abs(Math.log(r / v));
    if (d < bd) { bd = d; best = [v, lab]; }
  }
  return `${best[1]} (${r.toFixed(2)})`;
}

export { DEFAULT_GUTTER };
