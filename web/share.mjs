/**
 * 把文件送出去：下载 / 存相册（原生壳）/ 系统分享面板 / 直跳指定 App。
 *
 * 手机上把一格交给别的绘画 App（绘世界 / Procreate / 概念…）的通道：
 * 原生壳里先把图写到缓存 → 让用户从「真的接收图片的 App」里选一个 → 原生 setPackage 直跳；
 * 浏览器里走 Web Share；都没有就下载。目标 App 没声明接收图片的话谁也跳不过去（那是对方的选择）。
 */
import { escapeHtml } from './util.mjs';
import { SHELL } from './env.mjs';
import { toast } from './ui.mjs';
import { sheet } from './dialogs.mjs';
import { t as tr } from './i18n.mjs';

const cap = () => window.Capacitor;
const isNative = () => !!cap()?.isNativePlatform?.();

/* ------------------------------------------------------------------ 下载 / 存相册 */
export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = tr(name);   // 文件名跟着界面语言（「…-第3格.png」→「…-panel3.png」）
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function downloadText(text, name, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), name);
}

/** blob → base64（不带 dataURL 前缀），给原生插件用 */
export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      res(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => rej(new Error('读图片失败'));
    r.readAsDataURL(blob);
  });
}

/** 写进原生缓存目录，返回 file:// uri（文件名带中文时部分机型会失败，统一用 ASCII 安全名） */
async function writeCache(blob) {
  const fs = cap().Plugins.Filesystem;
  const path = `pf-${Date.now()}.png`;
  await fs.writeFile({ path, data: await blobToBase64(blob), directory: 'CACHE', recursive: true });
  return (await fs.getUri({ path, directory: 'CACHE' })).uri;
}

/**
 * 有原生「存相册」插件就走它（Android WebView 不支持 <a download>，网页那套会静默失败）。
 * 返回 true = 已存进相册；false = 交给调用方退回下载。
 */
export async function saveToGallery(blob, rawName) {
  const name = tr(rawName);
  const plugin = cap()?.Plugins?.SaveImage;
  if (!plugin?.save) return false;
  try {
    const r = await plugin.save({ data: await blobToBase64(blob), name, mime: blob.type || 'image/png' });
    toast(`已存到相册：${r?.path || 'Pictures/PanelForge'}`);
    return true;
  } catch (e) {
    console.warn('[save] 相册保存失败', e);
    toast('存相册失败：' + (e?.message || e));
    return false;
  }
}

/** 导出（能存相册就存相册，否则下载） */
export async function exportBlob(blob, name) {
  if (await saveToGallery(blob, name)) return;
  downloadBlob(blob, name);
}

/* ------------------------------------------------------------------ 分享 */
let targetsCache = null;

/** 列出手机上会出现在分享面板里的 App（壳里才有；浏览器返回 null） */
export async function nativeShareTargets(force = false) {
  const plugin = cap()?.Plugins?.ShareTo;
  if (!plugin?.listTargets) return null;
  if (targetsCache && !force) return targetsCache;
  try {
    const r = await plugin.listTargets();
    targetsCache = Array.isArray(r?.targets) ? r.targets : [];
    return targetsCache;
  } catch (e) {
    console.warn('[share] 列目标失败', e);
    return [];
  }
}

/** 把图片交给指定包名的 App（跳过系统面板） */
async function shareToPackage(pkg, blob) {
  const plugin = cap()?.Plugins?.ShareTo;
  if (!plugin?.sendTo) { toast('这个环境不支持直跳，用「分享」面板'); return false; }
  try {
    await plugin.sendTo({ package: pkg, uri: await writeCache(blob), mime: blob.type || 'image/png' });
    return true;
  } catch (e) {
    console.warn('[share] 直跳失败', e);
    toast(`直跳失败：${String(e?.message || e).slice(0, 60)}`);
    return false;
  }
}

/** 系统分享：原生壳 → Capacitor Share；浏览器 → Web Share Level 2；都没有 → 存相册 / 下载 */
export async function shareOrDownload(blob, rawName, rawTitle = 'PanelForge 分镜') {
  const name = tr(rawName);
  const title = tr(rawTitle);
  const native = isNative();
  if (native && cap().Plugins?.Filesystem && cap().Plugins?.Share) {
    try {
      await cap().Plugins.Share.share({ title, files: [await writeCache(blob)] });
      toast('已打开系统分享面板');
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      console.warn('[share] 原生分享失败', e);
      if (!/cancel/i.test(msg)) toast(`分享没成功（${msg.slice(0, 40)}），已改存相册`);   // 用户主动取消不算错误
    }
  }
  if (!native) {
    try {
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return true;
      }
    } catch { /* 用户取消或平台不支持 */ }
  }
  if (await saveToGallery(blob, name)) return false;
  downloadBlob(blob, name);
  toast(native ? '当前环境既不支持分享也不支持下载：请用「导出」' : '已下载');
  return false;
}

/** 选一个能接收图片的 App 直跳过去；最后一项是系统分享面板（更多 App） */
export function openSharePicker(targets, blob, name) {
  const s = sheet({
    id: 'sharePick',
    title: '用哪一个 App 打开',
    sub: '只有能接收图片的 App 才会出现在这里',
    width: 460,
    body: `<div class="list">
        ${targets.map((t) => `<button type="button" class="list-item" data-pkg="${escapeHtml(t.package)}">
          <b>${escapeHtml(t.label || t.package)}</b><span class="mono">${escapeHtml(t.package)}</span>
        </button>`).join('')}
      </div>
      <button type="button" class="btn wide" data-system>用系统分享面板（更多 App）</button>`,
  });
  s.body.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-system]')) { s.close(); await shareOrDownload(blob, name); return; }
    const btn = ev.target.closest('[data-pkg]');
    if (!btn) return;
    s.close();
    await shareToPackage(btn.dataset.pkg, blob);
  });
}

/** 壳里：「分享」先弹我们自己的 App 选择器，选完直接跳过去；没有插件就退回系统面板 */
export async function sharePickOrSheet(blob, name, title) {
  const targets = await nativeShareTargets();
  if (!targets?.length) { await shareOrDownload(blob, name, title); return; }
  openSharePicker(targets, blob, name);
}

/** 壳里排查分享 / 导出问题用：把这些能力的存在情况打出来 */
window.__pfShareDebug = () => {
  const c = cap();
  return {
    shell: SHELL || null,
    isNative: isNative(),
    plugins: c?.Plugins ? Object.keys(c.Plugins) : [],
    hasSaveImage: !!c?.Plugins?.SaveImage?.save,
    hasShare: !!c?.Plugins?.Share?.share,
    hasFilesystem: !!c?.Plugins?.Filesystem?.writeFile,
    hasShareTarget: !!c?.Plugins?.ShareTarget?.getPending,
    webShare: typeof navigator.canShare === 'function',
  };
};
