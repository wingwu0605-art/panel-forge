/**
 * 图片资产层：任何来源（File / data URL / blob URL / http）→ 统一资产对象。
 *
 * 从 app.js 抽出（约 70 行）。这里只管"图片怎么进来、怎么变小、blob 怎么复用"，
 * 不关心是哪一格、也不碰界面，所以独立成模块后可以单独测。
 *
 * 关键设计（沿用原来的注释）：
 *  · 存"显示用小图"（长边 2000），因为手机上内存/解码是硬约束
 *  · href 用 blob URL 而不是 data URL：整页重绘时 SVG 标记只有几十 KB（data URL 会到 MB 级）
 *  · 导出时 SVG 当 <img> 加载读不到 blob:，所以 exportImageMap 会转回 data URL（按 Blob 缓存）
 */
import { blobToDataURL } from './util.mjs';
import { state } from './state.mjs';

export const IMG_MAX_SIDE = 2000;
export const IMG_QUALITY = 0.9;
export const dataHrefCache = new WeakMap(); // Blob → data URL，导出时用一次就够
export const blobUrlCache = new WeakMap();  // Blob → blob URL，同一个 blob 永远拿同一个 URL（换页不会越攒越多）

export const urlForBlob = (blob) => {
  let u = blobUrlCache.get(blob);
  if (!u) { u = URL.createObjectURL(blob); blobUrlCache.set(blob, u); }
  return u;
};

export const loadImgEl = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('图片读不出来'));
  img.src = src;
});
export const blobOf = async (src) => (src instanceof Blob ? src : (await fetch(src)).blob());

/** 任何来源（File / data URL / blob URL / http）→ 统一的图片资产 */
export async function imageAsset(src, { name = 'image', maxSide = IMG_MAX_SIDE } = {}) {
  const blob = await blobOf(src);
  const tmpUrl = URL.createObjectURL(blob);
  let el;
  try {
    el = await loadImgEl(tmpUrl);
  } catch (e) {
    URL.revokeObjectURL(tmpUrl);
    throw e;
  }
  const iw = el.naturalWidth || 1000;
  const ih = el.naturalHeight || 1000;
  const k = Math.min(1, maxSide / Math.max(iw, ih));
  let display = blob;
  if (k < 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k));
    c.height = Math.max(1, Math.round(ih * k));
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    display = (await new Promise((res) => c.toBlob(res, 'image/jpeg', IMG_QUALITY))) || blob;
  }
  URL.revokeObjectURL(tmpUrl);
  return {
    blob: display,
    href: urlForBlob(display),
    iw, ih, zoom: 1, panX: 0, panY: 0, mode: 'cover', name,
  };
}

/** 草稿里取回来时 blob URL 已失效：按 blob 重建（老的 data URL 草稿原样保留） */
export function rehydrateImages(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (!v) continue;
    out[k] = v.blob ? { ...v, href: urlForBlob(v.blob) } : { ...v };
  }
  return out;
}

/** 导出用：把 blob 转回 data URL（结果按 Blob 缓存，重复导出不再转） */
export async function exportImageMap(map = state.images) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (!v) continue;
    if (!v.blob) { out[k] = { ...v }; continue; }
    let data = dataHrefCache.get(v.blob);
    if (!data) { data = await blobToDataURL(v.blob); dataHrefCache.set(v.blob, data); }
    out[k] = { ...v, href: data };
  }
  return out;
}
