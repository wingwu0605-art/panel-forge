/**
 * paint.mjs —— 格子内绘制引擎（P0：描线 / 上色）
 *
 * 三个设计决定，都是为了「能用」而不是「能跑」：
 *
 * 1. **按格子多边形硬裁**：每格一张 canvas，等于格子包围盒；`ctx.clip(Path2D(多边形))`
 *    保证笔迹和橡皮**物理上**出不了格子。所以斜切格、三角格不用做任何特殊适配。
 *
 * 2. **笔画是唯一真相**：存的是 `{tool,color,size,pts:[x,y,p…]}`，坐标用格子包围盒单位
 *    （0..slot.w），跟分辨率解耦。渲染随时可重放 → 撤销就是弹一笔重放，
 *    改工作分辨率也不会把老笔画错位。
 *
 * 3. **两层画布**：`base` 存已提交的笔画，显示层每帧 = base + 当前湿笔迹。
 *    湿笔迹用 `last:false` 让笔画末端是「没收口」的，手感更接近真实笔。
 *
 * 笔画轮廓算法来自 perfect-freehand（MIT，见 vendor/）。
 */
import { getStroke } from './vendor/perfect-freehand.mjs';

/** 作画工作分辨率（长边像素）。跟导出分辨率解耦：导出时按页面宽度栅格化。 */
export const PAINT_WORK_SIDE = 2048;

const cloneStroke = (s) => ({ ...s, pts: [...s.pts] });

/** 格子多边形在「包围盒坐标系」里的点（相对 slot.x / slot.y） */
export function localPoly(slot) {
  return slot.poly.map(([x, y]) => [x - slot.x, y - slot.y]);
}

/**
 * 建一个格子的绘制会话
 * @param {{slot: object, strokes?: Array, workSide?: number}} o
 */
export function createCellPainter({ slot, strokes = [], workSide = PAINT_WORK_SIDE }) {
  const scale = workSide / Math.max(slot.w, slot.h);
  const w = Math.max(1, Math.round(slot.w * scale));
  const h = Math.max(1, Math.round(slot.h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.className = 'paint-canvas';
  const ctx = canvas.getContext('2d');

  // base：已提交的笔画（外加底图），避免每帧重放几百笔
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const bctx = base.getContext('2d');

  const st = {
    strokes: strokes.map(cloneStroke),
    redo: [],
    tool: 'pen',
    color: '#1d1d1f',
    size: 12,        // 笔尖直径，包围盒单位
    underlay: null,  // HTMLImageElement | null（描线时的底图）
    wet: null,       // 正在画的这一笔
    usingPen: false,
    activeId: null,
  };

  // 格子的裁剪路径（一次算好，所有落笔共用）
  const clip = new Path2D();
  localPoly(slot).forEach(([x, y], i) => {
    const px = x * scale, py = y * scale;
    if (i) clip.lineTo(px, py); else clip.moveTo(px, py);
  });
  clip.closePath();

  /** 底图按 cover 铺满包围盒（和 imageLayout 的 cover 语义一致） */
  function drawUnderlay(c) {
    const img = st.underlay;
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const k = Math.max(w / iw, h / ih);
    const dw = iw * k, dh = ih * k;
    c.save();
    c.clip(clip);
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    c.restore();
  }

  /** 把一笔画到某个 context 上（wet=true 时末端不封口） */
  function paintStroke(c, s, wet = false) {
    if (!s.pts.length) return;
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i] * scale, s.pts[i + 1] * scale, s.pts[i + 2]]);
    const outline = getStroke(pts, {
      size: Math.max(0.5, s.size * scale),
      thinning: s.tool === 'eraser' ? 0 : 0.55,
      smoothing: 0.5,
      streamline: 0.42,
      simulatePressure: !s.pen,
      last: !wet,
    });
    if (outline.length < 3) return;
    const path = new Path2D();
    path.moveTo((outline[0][0] + outline[1][0]) / 2, (outline[0][1] + outline[1][1]) / 2);
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    path.closePath();
    c.save();
    c.clip(clip);          // ← 出不了格子，就靠这一行
    if (s.tool === 'eraser') {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
    } else {
      c.fillStyle = s.color;
    }
    c.fill(path);
    c.restore();
  }

  function rebuildBase() {
    bctx.clearRect(0, 0, w, h);
    drawUnderlay(bctx);
    for (const s of st.strokes) paintStroke(bctx, s);
  }

  function render() {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0);
    if (st.wet) paintStroke(ctx, st.wet, true);
  }

  /* ---------------- 输入 ---------------- */
  /** 客户端坐标 → 包围盒坐标（0..slot.w / 0..slot.h） */
  function toLocal(ev) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return [0, 0];
    return [
      ((ev.clientX - r.left) / r.width) * slot.w,
      ((ev.clientY - r.top) / r.height) * slot.h,
    ];
  }

  function pushPoint(ev) {
    const [x, y] = toLocal(ev);
    const pen = ev.pointerType === 'pen';
    const p = pen ? ev.pressure : 0.5;
    const s = st.wet;
    if (!s) return;
    // 抽稀：离上一个点太近就丢掉，省重绘也省存储
    const n = s.pts.length;
    if (n >= 3) {
      const dx = x - s.pts[n - 3], dy = y - s.pts[n - 2];
      if (dx * dx + dy * dy < 0.6 * 0.6) return;
    }
    s.pts.push(x, y, p);
  }

  function begin(ev) {
    if (st.activeId != null) return;
    // 掌压拒识：笔正在画的时候，手指一律不接
    if (ev.pointerType === 'touch' && st.usingPen) return;
    if (ev.pointerType === 'pen') st.usingPen = true;
    st.activeId = ev.pointerId;
    canvas.setPointerCapture?.(ev.pointerId);
    st.wet = {
      tool: st.tool, color: st.color, size: st.size,
      pen: ev.pointerType === 'pen' && (ev.pressure || 0) > 0,
      pts: [],
    };
    pushPoint(ev);
    render();
    ev.preventDefault();
  }

  function move(ev) {
    if (st.activeId == null || ev.pointerId !== st.activeId || !st.wet) return;
    if (ev.pointerType === 'touch' && st.usingPen) return;
    // 子帧采样：120Hz 的笔一帧里可能有 2~3 个点，丢掉就成折线
    const batch = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
    if (batch && batch.length) for (const e of batch) pushPoint(e);
    else pushPoint(ev);
    render();
    ev.preventDefault();
  }

  function end(ev) {
    if (st.activeId == null || (ev && ev.pointerId !== st.activeId)) return;
    if (ev?.pointerType === 'pen') st.usingPen = false;
    st.activeId = null;
    const s = st.wet;
    st.wet = null;
    if (s && s.pts.length) {
      // 单点也要能画出一个点
      if (s.pts.length === 3) s.pts.push(s.pts[0] + 0.01, s.pts[1] + 0.01, s.pts[2]);
      st.strokes.push(s);
      st.redo.length = 0;
      paintStroke(bctx, s);
    }
    render();
    return s;
  }

  return {
    canvas, slot, scale,
    get w() { return w; },
    get h() { return h; },
    get strokes() { return st.strokes; },
    get stats() {
      return { w, h, workSide: Math.max(w, h), strokes: st.strokes.length, tool: st.tool, size: st.size };
    },
    setTool: (t) => { st.tool = t === 'eraser' ? 'eraser' : 'pen'; },
    setColor: (c) => { st.color = c; },
    setSize: (n) => { st.size = Math.max(0.5, Number(n) || 1); },
    setUnderlay(img) { st.underlay = img || null; rebuildBase(); render(); },
    begin, move, end,
    render,
    undo() {
      const s = st.strokes.pop();
      if (!s) return false;
      st.redo.push(s);
      rebuildBase();
      render();
      return true;
    },
    redo() {
      const s = st.redo.pop();
      if (!s) return false;
      st.strokes.push(s);
      paintStroke(bctx, s);
      render();
      return true;
    },
    clear() {
      st.strokes.length = 0;
      st.redo.length = 0;
      rebuildBase();
      render();
    },
    /** 完成时栅格化：底图 + 全部笔画 → PNG（保留透明，导出才好看） */
    toBlob: () => new Promise((res) => canvas.toBlob(res, 'image/png')),
    /** 采样一个像素（测试用）：包围盒坐标 */
    samplePoint(x, y) {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    destroy() {
      st.wet = null;
      st.strokes.length = 0;
      canvas.remove();
    },
  };
}
