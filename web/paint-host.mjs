/**
 * paint-host.mjs —— 把外部绘画引擎（Klecks）接进格子绘制壳的适配层
 *
 * 为什么是 iframe（而不是像另一条路那样直接 import）：
 *   1. Klecks 的官方 embed 是**单实例**、直接挂到 `document.body` 的全屏应用，
 *      没有销毁接口 —— 每次绘制开一个新 iframe，天然就是干净实例。
 *   2. 它自带一整套样式，关在 iframe 里就不会污染主应用的设计系统。
 *   3. 同源 → 父页面直接读 `iframe.contentWindow.__pfKlecksPng()`，
 *      不需要设计 postMessage 协议。
 *
 * 这个文件只负责「把引擎放进舞台 + 把结果取回来」。格子形状的裁剪由调用方做
 * （见 app.js 的 clipToSlot），所以换引擎时这里改，裁剪与回填都不用动。
 */
export const PAINT_ENGINE_WORK_SIDE = 2048;

/**
 * @param {{slot: object, baseUrl?: string, workSide?: number}} o
 *   slot    模板里的一格（用它的包围盒定画布尺寸）
 *   baseUrl 底图（blob URL / data URL）：上一版的成图或参考图，作为「底稿」层
 */
export function createKlecksHost({ slot, baseUrl = '', workSide = PAINT_ENGINE_WORK_SIDE } = {}) {
  const scale = workSide / Math.max(slot.w, slot.h);
  const width = Math.max(1, Math.round(slot.w * scale));
  const height = Math.max(1, Math.round(slot.h * scale));
  // 格子多边形换算到画布坐标（画布 = 这一格包围盒，所以减掉 x/y 再乘缩放），
  // 交给引擎画成「外面压灰」的形状参考线
  const guide = Array.isArray(slot.poly)
    ? slot.poly.map(([x, y]) => [Math.round((x - slot.x) * scale), Math.round((y - slot.y) * scale)])
    : null;
  let frame = null;
  let onSubmit = null;
  let paperOn = true;

  const win = () => frame?.contentWindow || null;

  return {
    engine: 'klecks',
    width,
    height,
    get el() { return frame; },
    /** Klecks 界面上点「完成」时回调 */
    set onSubmit(fn) { onSubmit = fn; },

    /**
     * 建 iframe 并等引擎就绪。失败会抛错，调用方可以退回轻量笔。
     * @param {HTMLElement} stageEl 舞台容器
     */
    async mount(stageEl) {
      frame = document.createElement('iframe');
      frame.className = 'paint-frame';
      frame.title = '绘制';
      frame.setAttribute('allow', 'clipboard-write');
      frame.src = './klecks/embed.html';
      stageEl.appendChild(frame);

      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('绘画引擎加载超时')), 25000);
        frame.addEventListener('load', () => { clearTimeout(timer); res(); }, { once: true });
        frame.addEventListener('error', () => { clearTimeout(timer); rej(new Error('绘画引擎加载失败')); }, { once: true });
      });

      const w = win();
      if (!w) throw new Error('iframe 没起来');
      if (!w.__pfKlecksReady) throw new Error('embed.html 不是预期版本（缺 __pfKlecksReady）');
      await w.__pfKlecksReady;
      w.__pfOnSubmit = () => { try { onSubmit?.(); } catch { /* ignore */ } };
      await w.__pfKlecksBoot({ width, height, baseUrl, guide });
      // 记住用户选的白底/透明，挂载后应用一次
      if (paperOn === false) w.__pfKlecksPaper?.(false);
      return true;
    },

    /**
     * 白底 / 透明：隐藏或显示「纸」层。
     * 刚 mount 完 Klecks 的图层还没稳，一次切换可能不生效 —— 校验实际状态并重试。
     */
    async setPaper(on) {
      paperOn = !!on;
      const w = win();
      if (!w?.__pfKlecksPaper) return false;
      for (let i = 0; i < 12; i++) {
        const now = w.__pfKlecksPaper(!!on);
        if (now === !!on) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },

    /** 取当前画面（所有可见图层合成，带 alpha）。跨 realm 的 Blob 重新包一层更保险。 */
    async exportPNG() {
      const w = win();
      if (!w?.__pfKlecksPng) throw new Error('引擎还没就绪');
      const raw = await w.__pfKlecksPng();
      return raw instanceof Blob ? raw : new Blob([raw], { type: raw?.type || 'image/png' });
    },

    destroy() {
      try { frame?.remove(); } catch { /* ignore */ }
      frame = null;
      onSubmit = null;
    },
  };
}
