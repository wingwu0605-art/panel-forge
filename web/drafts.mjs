/**
 * 草稿：所有页存在 IndexedDB，关掉浏览器也不丢。分几块存：
 *   pages          小记录（模板、句子、气泡、提示词、图片的变换 —— **不含任何图片字节**，KB 级）
 *   img:<页id>     这一页的图片 Blob，只在那一页真的换了图时才重写
 *   under:<页id>   轻量笔描线用的底图 Blob（同上）
 *   cand:<页id>    这一页每格的 AI 候选图 Blob（同上）
 * 改一句台词只写几 KB，不会把几 MB 的图重写一遍（手机上那一下停顿很明显）。
 *
 * 以前候选图是以 base64 data URL 直接塞在 pages 小记录里的 —— 生过几张图之后，
 * 每次改一个字都要把几 MB 的 base64 重新序列化写一遍，「小记录」的设计等于白做。
 */
import { state } from './state.mjs';
import { PERF, perf, perfNow, perfDone } from './util.mjs';
import { idbGet, idbSet } from './storage.mjs';
import { imageAsset, urlForBlob, blobForUrl } from './assets.mjs';
import { app } from './ctx.mjs';

let dirty = false;
let saveTimer = 0;
const savedSigs = new Map();        // 'img:pg…' / 'cand:pg…' → 上次写入时的指纹

/**
 * 页 id 必须全局唯一。以前是 'pg' + 自增计数，计数器每次刷新从 0 开始 ——
 * 恢复了 pg1、pg2 两页草稿后再加一页，新页又拿到 pg1，于是把第 1 页的图片记录覆盖成空的。
 */
export const newPageId = () => 'pg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

/* ------------------------------------------------------------------ 指纹：同一个 Blob 永远同一个号 */
const blobIds = new WeakMap();
let blobSeq = 0;
const blobIdOf = (blob) => {
  if (!blob) return 0;
  let id = blobIds.get(blob);
  if (!id) { id = ++blobSeq; blobIds.set(blob, id); }
  return id;
};
const assetSig = (map) => Object.entries(map || {})
  .map(([k, v]) => `${k}#${blobIdOf(v?.blob)}#${v?.iw || 0}x${v?.ih || 0}`).join('|');
const stripBlobs = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => {
  if (!v) return [k, v];
  const { blob: _blob, ...rest } = v;
  return [k, rest];
}));
const blobsOf = (map) => Object.fromEntries(Object.entries(map || {})
  .filter(([, v]) => v && v.blob).map(([k, v]) => [k, v.blob]));

/** 候选图：内存里是 blob URL 列表，落盘时换成 Blob 列表 */
const candBlobs = (cands) => Object.fromEntries(Object.entries(cands || {})
  .map(([k, list]) => [k, (list || []).map(blobForUrl).filter(Boolean)])
  .filter(([, list]) => list.length));
const candSig = (cands) => Object.entries(cands || {})
  .map(([k, list]) => `${k}:${(list || []).map((u) => blobIdOf(blobForUrl(u))).join(',')}`).join('|');

/* ------------------------------------------------------------------ 写 */
export function queueSave() {
  dirty = true;
  clearTimeout(saveTimer);
  // 给自动化测试一个可等待的「保存中」标记（固定 sleep 在慢机器上会抖）
  window.__pfSaveBusy = true;
  saveTimer = setTimeout(saveDraft, 1200);
}

/**
 * 立即落盘（跳过 queueSave 的 1200ms 防抖）。
 * 场景：刚拖完图就刷新 / 关页面 —— 防抖还没到点，草稿里就没有这张图。
 */
export async function flushSave() {
  if (!state.tpl || !state.pages.length) return false;
  clearTimeout(saveTimer);
  try { await saveDraft(); return true; } catch { return false; }
}

/** 只在内容真的变了时才写那一块 */
async function writeIfChanged(key, sig, value) {
  if (savedSigs.get(key) === sig) return 0;
  await idbSet(key, value);
  savedSigs.set(key, sig);
  return Object.values(value || {}).flat().reduce((n, b) => n + (b?.size || 0), 0);
}

async function saveDraft() {
  if (!state.tpl || !state.pages.length) return;
  const t0 = perfNow();
  app.savePage();
  for (const pg of state.pages) if (!pg.id) pg.id = newPageId();
  const meta = {
    pages: state.pages.map(({ cands: _cands, ...pg }) => ({ ...pg, images: stripBlobs(pg.images), under: stripBlobs(pg.under) })),
    pageIdx: state.pageIdx, savedAt: Date.now(), v: 3,
  };
  const ok = await idbSet('pages', meta);
  if (ok) dirty = false;
  let blobBytes = 0;
  for (const pg of state.pages) {
    blobBytes += await writeIfChanged('img:' + pg.id, assetSig(pg.images), blobsOf(pg.images));
    blobBytes += await writeIfChanged('under:' + pg.id, assetSig(pg.under), blobsOf(pg.under));
    blobBytes += await writeIfChanged('cand:' + pg.id, candSig(pg.cands), candBlobs(pg.cands));
  }
  if (PERF) {
    perf.saves++;
    perf.lastSaveBytes = JSON.stringify(meta).length + blobBytes;
    perfDone('save', t0);
  }
  window.__pfSaveBusy = false;
}

/** 清空本机草稿（含每一页的图片 / 底图 / 候选图记录） */
export async function clearDrafts(pages = state.pages) {
  clearTimeout(saveTimer);
  await idbSet('pages', null);
  for (const pg of pages) {
    if (!pg.id) continue;
    for (const k of ['img:', 'under:', 'cand:']) await idbSet(k + pg.id, null);
  }
  savedSigs.clear();
  dirty = false;
}

/* ------------------------------------------------------------------ 读 */
/** 老草稿里的图是 data URL：转成 Blob（顺手按 IMG_MAX_SIDE 降采样），之后存盘就不用再搬那几 MB */
async function upgradeImages(images) {
  const out = {};
  for (const [k, v] of Object.entries(images || {})) {
    if (!v) continue;
    if (v.blob) { out[k] = { ...v, href: urlForBlob(v.blob) }; continue; }
    if (!/^data:image\//i.test(String(v.href || ''))) { out[k] = { ...v }; continue; }
    try {
      const a = await imageAsset(v.href, { name: v.name || 'image' });
      out[k] = { ...a, zoom: v.zoom ?? 1, panX: v.panX ?? 0, panY: v.panY ?? 0, mode: v.mode || 'cover' };
    } catch { out[k] = { ...v }; }
  }
  return out;
}

/** 把单独存的 Blob 装回 {slot: asset} */
function attachBlobs(map, stored) {
  if (!stored) return map;
  for (const [slot, blob] of Object.entries(stored)) {
    if (map?.[slot] && blob instanceof Blob) map[slot].blob = blob;
  }
  return map;
}

async function loadCands(pg) {
  const out = {};
  const stored = await idbGet('cand:' + pg.id);
  if (stored) {
    for (const [slot, list] of Object.entries(stored)) out[slot] = (list || []).filter((b) => b instanceof Blob).map(urlForBlob);
    return out;
  }
  // 老草稿：候选图是 data URL 数组，直接塞在 pages 记录里
  for (const [slot, list] of Object.entries(pg.cands || {})) {
    const urls = [];
    for (const href of list || []) {
      try { urls.push(urlForBlob(await (await fetch(href)).blob())); } catch { /* 坏的跳过 */ }
    }
    if (urls.length) out[slot] = urls;
  }
  return out;
}

export async function loadDraft() {
  const d = await idbGet('pages');
  if (!d || !Array.isArray(d.pages) || !d.pages.length) return null;
  const seen = new Set();
  for (const pg of d.pages) {
    // 老版本可能已经存出了重复的页 id（见 newPageId 的说明）：重复的那页换个新 id，别再互相覆盖
    if (!pg.id || seen.has(pg.id)) pg.id = newPageId();
    seen.add(pg.id);
    pg.images = await upgradeImages(attachBlobs(pg.images, await idbGet('img:' + pg.id)));
    pg.under = await upgradeImages(attachBlobs(pg.under, await idbGet('under:' + pg.id)));
    pg.cands = await loadCands(pg);
    savedSigs.set('img:' + pg.id, assetSig(pg.images));
    savedSigs.set('under:' + pg.id, assetSig(pg.under));
    savedSigs.set('cand:' + pg.id, candSig(pg.cands));
  }
  return d;
}

/** 页面被隐藏或卸载前，把还没落盘的草稿立刻写一次 */
export function installAutosave() {
  const flushNow = () => { if (dirty) flushSave(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);
  window.__pfFlush = () => flushSave();
}
