/**
 * 交互收件箱：拖放 / 粘贴 / 气泡拖入 / 候选大图 / 右键菜单。
 *
 * 设计原则：
 *   1. 任何「能把图片放进来」的地方都支持三种入口：点按钮选文件、拖进来、Ctrl+V 粘贴
 *   2. 拖放目标以「指针下面是什么」为准（画布 → 那一格；角色卡 → 角色参考图；样图区 → 样图）
 *   3. 全站只有**一个** drop 入口和**一个** paste 入口（以前画布和 document 各有一套，
 *      同一次拖放被处理两遍）
 *   4. 右键菜单用我们自己的（浏览器默认菜单在编辑器里很难用），但输入框里保留文本操作项
 */
import { $, clamp, escapeHtml } from './util.mjs';
import { state, commit } from './state.mjs';
import { BUBBLES } from './lib/bubbles.mjs';
import { toast } from './ui.mjs';
import { sheet } from './dialogs.mjs';
import { setStyleFollow, followSamples, styleMode, addSamples, addCharCard } from './refs.mjs';
import { autoEstimate } from './auto-mode.mjs';
import { openPaint, exportSlotImage } from './paint-ui.mjs';
import { app } from './ctx.mjs';

let inboxArea = 'slot';   // 'slot' | 'char' | 'sample'：粘贴时往哪儿放

function firstImageFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  if (dt.files && dt.files.length) {
    for (const f of dt.files) if (/^image\//i.test(f.type)) out.push(f);
  }
  if (!out.length && dt.items) {
    for (const it of dt.items) {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && /^image\//i.test(f.type)) out.push(f); }
    }
  }
  return out;
}

/** 指针落在哪：画布 / 角色卡 / 其它 */
function dropZoneOf(el) {
  if (!el || !el.closest) return null;
  if (el.closest('#styleFollow')) return 'sample';   // 拖到「风格跟随」= 加样图
  if (el.closest('.chars')) return 'char';
  if (el.closest('#canvas') || el.closest('#stage') || el.closest('.paint-stage')) return 'canvas';
  return null;
}

export async function acceptImages(files, { zone, ev } = {}) {
  const imgs = (files || []).filter((f) => f && /^image\//i.test(f.type));
  if (!imgs.length) return false;
  if (zone === 'sample') {
    setStyleFollow(followSamples() ? styleMode() : 'sample');
    await addSamples(imgs);
    return true;
  }
  if (zone === 'char') {
    await addCharCard(imgs);
    toast(`已加入 ${imgs.length} 张角色参考图`);
    return true;
  }
  if (!state.tpl) { toast('先选一套版式'); return false; }
  // 多张图：按阅读顺序填进空格子（没有空格就从第一格开始覆盖）
  if (imgs.length > 1) {
    const empty = state.tpl.slots.filter((s) => !state.images[s.id]);
    const list = empty.length ? empty : state.tpl.slots;
    const n = Math.min(imgs.length, list.length);
    commit();
    for (let i = 0; i < n; i++) await app.putImage(list[i].id, imgs[i], { render: false, noCommit: true });
    state.selectedId = list[n - 1]?.id || state.selectedId;
    app.renderStage(); app.renderSlotPanel(); app.refreshScript();
    toast(`已按阅读顺序填入 ${n} 格${imgs.length > n ? `（还剩 ${imgs.length - n} 张没地方放）` : ''}`);
    return true;
  }
  // 一张图：优先「指针下那一格」，否则当前选中的格子
  let slotId = state.selectedId;
  if (ev && zone === 'canvas') {
    const s = app.slotAt(app.pagePoint(ev));
    if (s) slotId = s.id;
  }
  if (!slotId) { toast('先点一个格子，再拖图进来'); return false; }
  await app.putImage(slotId, imgs[0]);
  const slot = state.tpl.slots.find((s) => s.id === slotId);
  toast(`已填入第 ${slot?.order ?? '?'} 格`);
  return true;
}

/* ---------------- 拖放 + 粘贴 ---------------- */
/** 拖进来的文件里挑出「文本类」的（原文/大纲/脚本） */
const TEXT_EXT = /\.(txt|md|markdown|text|csv|tsv|journal|log)$/i;

function textFilesFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  const push = (f) => {
    if (!f) return;
    // docx/pdf 这类也算「文本候选」—— 收下来才能给一句明确的「读不了，请另存 txt」
    const DOC_EXT = /\.(docx|doc|pdf|epub|rtf)$/i;
    const isText = /^text\//i.test(f.type) || TEXT_EXT.test(f.name || '') || DOC_EXT.test(f.name || '');
    if (isText) out.push(f);
  };
  if (dt.files && dt.files.length) for (const f of dt.files) push(f);
  if (!out.length && dt.items) {
    for (const it of dt.items) if (it.kind === 'file') push(it.getAsFile());
  }
  return out;
}

/** 判断落点是哪个文本框：全自动的全文框 / 普通模式的剧情框 */
function textTargetOf(el) {
  if (!el || !el.closest) return null;
  if (el.closest('#autoPanel, #autoCard')) return '#autoText';
  if (el.closest('.match, #plot')) return '#plot';
  return null;
}

/** 把文本文件读进对应的文本框；读不了（比如 docx）就说清楚 */
async function acceptTextFiles(files, { targetSel } = {}) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return false;
  const f = list[0];
  const sel = targetSel || (state.autoMode && state.autoMode !== 'off' ? '#autoText' : '#plot');
  const ta = $(sel);
  if (!ta) return false;
  // docx / pdf / epub：浏览器里要额外依赖才能解，别假装支持
  if (/\.(docx|doc|pdf|epub|rtf)$/i.test(f.name || '')) {
    toast('这个格式读不了：请另存为 .txt / .md 再拖进来（docx 在浏览器里需要额外依赖）');
    return false;
  }
  try {
    const text = await f.text();
    if (!text || !text.trim()) { toast('这个文件是空的'); return false; }
    ta.value = text.slice(0, 200000);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (sel === '#autoText') autoEstimate();
    const chars = text.replace(/\s+/g, '').length;
    toast(`已读入「${f.name}」：${chars} 字${sel === '#autoText' ? '，已估算页数' : ''}`);
    ta.focus();
    // 光标放到末尾，方便接着写
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* ignore */ }
    return true;
  } catch (e) {
    toast('读文件失败：' + e.message);
    return false;
  }
}

/* ---------------- 拖放提示：毛玻璃卡片 + 格式说明 ---------------- */
const DROP_KINDS = {
  image: { title: '放入图片', formats: 'JPG / PNG / WebP / GIF / AVIF / SVG', ico: '▤' },
  text: { title: '放入原文文件', formats: 'TXT / MD / CSV / TSV / LOG', ico: '🅃' },
  bubble: { title: '放入气泡', formats: '松手就放到画面上', ico: '💬' },
};

function showDropHint(kind, targetEl) {
  const el = $('#dropHint');
  if (!el || !targetEl) return;
  const spec = DROP_KINDS[kind] || DROP_KINDS.image;
  $('#dhIco').textContent = spec.ico;
  $('#dhTitle').textContent = spec.title;
  $('#dhFormats').textContent = spec.formats;
  const r = targetEl.getBoundingClientRect();
  el.classList.remove('hidden');
  el.style.left = Math.round(r.left) + 'px';
  el.style.top = Math.round(r.top) + 'px';
  el.style.width = Math.round(r.width) + 'px';
  el.style.height = Math.round(r.height) + 'px';
}

function hideDropHint() {
  $('#dropHint')?.classList.add('hidden');
}

function installImageInbox() {
  // 记录最近一次交互区域，供 Ctrl+V 决定往哪放
  document.addEventListener('pointerdown', (ev) => {
    const zone = dropZoneOf(ev.target);
    if (zone === 'sample') inboxArea = 'sample';
    else if (zone === 'char') inboxArea = 'char';
    else if (zone === 'canvas' || ev.target.closest?.('#railRight')) inboxArea = 'slot';
  }, true);
  document.addEventListener('focusin', (ev) => {
    if (ev.target.closest?.('#styleFollow')) inboxArea = 'sample';
    else if (ev.target.closest?.('.chars')) inboxArea = 'char';
  }, true);

  // 拖到画布/角色卡上时给出可放置的视觉反馈
  document.addEventListener('dragover', (ev) => {
    const hasImages = firstImageFromDataTransfer(ev.dataTransfer).length > 0;
    const hasText = textFilesFromDataTransfer(ev.dataTransfer).length > 0;
    const isBubble = ev.dataTransfer?.types?.includes('text/pf-bubble');
    if (!hasImages && !hasText && !isBubble) return;
    // 文本文件优先落在文本框上
    const textSel = hasText && !hasImages ? textTargetOf(ev.target) : null;
    // 合成事件的 target 可能是 document，用坐标兜底判断落在画布上
    const zone = textSel
      ? 'text'
      : (dropZoneOf(ev.target) || (Number.isFinite(ev.clientX) && $('#canvas svg') ? 'canvas' : null));
    if (!zone) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    document.body.dataset.dropZone = zone;
    // 毛玻璃提示：盖在目标区域上，写明能放什么格式
    if (textSel) showDropHint('text', $(textSel));
    else if (isBubble && !hasImages) showDropHint('bubble', $('#canvas svg') || $('#canvas'));
    else showDropHint('image', zone === 'char' ? $('.chars') : ($('#canvas svg') || $('#canvas')));
  });
  document.addEventListener('dragleave', (ev) => {
    if (ev.target === document || !ev.relatedTarget) { delete document.body.dataset.dropZone; hideDropHint(); }
  });

  document.addEventListener('drop', async (ev) => {
    hideDropHint();
    const bubbleType = ev.dataTransfer?.getData('text/pf-bubble');
    // 事件可能派发在 document 上（合成事件 / 某些浏览器），这时用坐标兜底判断落在画布
    const zone = dropZoneOf(ev.target)
      || (Number.isFinite(ev.clientX) && $('#canvas svg') ? 'canvas' : null);
    delete document.body.dataset.dropZone;
    if (bubbleType) {
      if (!zone || zone === 'char') return;
      ev.preventDefault();
      const pt = app.pagePoint(ev);
      const slot = app.slotAt(pt);
      if (!state.tpl) { toast('先选一套版式'); return; }
      const b = app.addBubble(bubbleType, { at: pt, noCommit: false });
      if (b) {
        if (slot) { state.selectedId = slot.id; app.renderSlotPanel(); }
        toast(`已把「${BUBBLES[bubbleType]?.zh || bubbleType}」放到画面上，拖它调位置`);
      }
      return;
    }
    // 先看是不是文本文件（原文/大纲），它落在文本框上就填文本框
    const texts = textFilesFromDataTransfer(ev.dataTransfer);
    const textSel = texts.length ? textTargetOf(ev.target) : null;
    if (texts.length && (textSel || !firstImageFromDataTransfer(ev.dataTransfer).length)) {
      ev.preventDefault();
      await acceptTextFiles(texts, { targetSel: textSel });
      return;
    }
    const files = firstImageFromDataTransfer(ev.dataTransfer);
    if (!files.length) return;
    ev.preventDefault();
    await acceptImages(files, { zone, ev });
  });

  // Ctrl+V 粘贴图片（全站唯一的粘贴入口）：落点 = 最近一次交互的区域（样图 / 角色卡 / 画布）
  document.addEventListener('paste', async (ev) => {
    const files = firstImageFromDataTransfer(ev.clipboardData);
    if (!files.length) return;   // 文本粘贴不拦
    const inField = ev.target.closest?.('input, textarea');
    const focus = document.activeElement;
    const zone = inboxArea === 'sample' || focus?.closest?.('#styleFollow') ? 'sample'
      : inboxArea === 'char' || focus?.closest?.('.chars') ? 'char' : 'canvas';
    ev.preventDefault();
    // 输入框里粘图片没意义（会变成字），但用户常常是在输入框聚焦时按的 Ctrl+V
    if (await acceptImages(files, { zone }) && inField && zone === 'canvas') toast('已把剪贴板里的图片放进当前格子');
  });
}

/* ---------------- 气泡库可拖拽 ---------------- */
function makeBubbleLibDraggable() {
  const lib = $('#bubGrid');
  if (!lib || lib.dataset.draggableReady) return;
  lib.dataset.draggableReady = '1';
  const SEL = '.bub-item[data-id]';
  lib.addEventListener('dragstart', (ev) => {
    const btn = ev.target.closest(SEL);
    if (!btn) return;
    const type = btn.dataset.id;
    ev.dataTransfer.setData('text/pf-bubble', type);
    ev.dataTransfer.setData('text/plain', BUBBLES[type]?.zh || type);
    ev.dataTransfer.effectAllowed = 'copy';
    btn.classList.add('dragging');
  });
  lib.addEventListener('dragend', (ev) => {
    ev.target.closest(SEL)?.classList.remove('dragging');
    delete document.body.dataset.dropZone;
    hideDropHint();
  });
}

/* ---------------- 候选图大图预览 ---------------- */
/**
 * @param {string[]} list 图片地址
 * @param {number} index 从第几张开始
 * @param {{cands?: boolean}} o cands=false：看的是格子里的图（不是候选），不显示「用这张 / 删掉」
 */
export function openLightbox(list, index = 0, { cands = true } = {}) {
  if (!list || !list.length) return;
  let i = clamp(index, 0, list.length - 1);
  const s = sheet({
    id: 'lightbox',
    className: 'lightbox',
    title: '–',
    sub: '← → 切换 · Esc 关闭 · 滚轮缩放',
    width: 900,
    body: `<div class="lb-stage"><img id="lbImg" alt="候选图预览" draggable="false"></div>
      <div class="lb-acts">
        <button type="button" class="btn tiny" id="lbPrev">上一张</button>
        <button type="button" class="btn tiny" id="lbNext">下一张</button>
        ${cands ? `<span class="grow"></span>
        <button type="button" class="btn tiny primary" id="lbUse">用这张</button>
        <button type="button" class="btn tiny" id="lbEdit">用这张进画布改</button>
        <button type="button" class="btn tiny danger" id="lbDel">删掉这张</button>` : ''}
      </div>`,
  });
  const box = s.el;
  box.querySelector('.sheet-title').id = 'lbCount';
  const img = $('#lbImg', box);
  let scale = 1;
  const sync = () => {
    img.src = list[i];
    scale = 1;
    img.style.transform = '';
    $('#lbCount', box).textContent = `第 ${i + 1} / ${list.length} 张`;
    $('#lbPrev', box).disabled = i <= 0;
    $('#lbNext', box).disabled = i >= list.length - 1;
  };
  const step = (d) => { const n = clamp(i + d, 0, list.length - 1); if (n !== i) { i = n; sync(); } };
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
  });
  $('#lbPrev', box).addEventListener('click', () => step(-1));
  $('#lbNext', box).addEventListener('click', () => step(1));
  $('#lbUse', box)?.addEventListener('click', async () => { s.close(); await app.applyCand(i); });
  $('#lbEdit', box)?.addEventListener('click', async () => { s.close(); await app.applyCandAndEdit(i); });
  $('#lbDel', box)?.addEventListener('click', () => {
    const arr = app.candsOf(state.selectedId);
    if (!arr.length) return;
    arr.splice(i, 1);
    app.renderCands();
    app.queueSave();
    if (!arr.length) { s.close(); return; }
    list = arr;
    i = Math.min(i, arr.length - 1);
    sync();
  });
  box.querySelector('.lb-stage').addEventListener('wheel', (ev) => {
    ev.preventDefault();
    scale = clamp(scale * (ev.deltaY < 0 ? 1.1 : 0.9), 0.4, 4);
    img.style.transform = `scale(${scale})`;
  }, { passive: false });
  sync();
}

/** 看某一格的图：有候选就从候选看起，没有就看这一格现在的图 */
export function previewSlot(sid = state.selectedId) {
  const list = (app.candsOf(sid) || []).slice();
  if (list.length) return openLightbox(list, 0);
  if (state.images[sid]) return openLightbox([state.images[sid].href], 0, { cands: false });
  return undefined;
}

/* ---------------- 右键菜单 ---------------- */
const CTX_TRANSFORM = [
  { key: 'zoomIn', label: '放大', hint: '+', run: (id) => nudgeImage(id, 'zoom', 1.12) },
  { key: 'zoomOut', label: '缩小', hint: '−', run: (id) => nudgeImage(id, 'zoom', 1 / 1.12) },
  { sep: true },
  { key: 'left', label: '靠左', run: (id) => alignImage(id, 'left') },
  { key: 'hcenter', label: '水平居中', run: (id) => alignImage(id, 'hcenter') },
  { key: 'right', label: '靠右', run: (id) => alignImage(id, 'right') },
  { key: 'top', label: '靠上', run: (id) => alignImage(id, 'top') },
  { key: 'vcenter', label: '垂直居中', run: (id) => alignImage(id, 'vcenter') },
  { key: 'bottom', label: '靠下', run: (id) => alignImage(id, 'bottom') },
  { sep: true },
  { key: 'cover', label: '填满裁切', run: (id) => setImageMode(id, 'cover') },
  { key: 'contain', label: '完整显示', run: (id) => setImageMode(id, 'contain') },
  { key: 'reset', label: '复位位置', run: (id) => resetImageTransform(id) },
];

function nudgeImage(id, field, factor) {
  const img = state.images[id];
  if (!img) return;
  commit();
  if (field === 'zoom') img.zoom = clamp((img.zoom || 1) * factor, 0.3, 6);
  app.renderStage(); app.renderSlotPanel(); app.queueSave();
}

function alignImage(id, dir) {
  const img = state.images[id];
  if (!img) return;
  commit();
  const big = 260;   // 用足够大的位移把图推到边界（渲染时会被格子裁剪）
  img.mode = img.mode || 'cover';
  if (dir === 'left') img.panX = -big;
  if (dir === 'right') img.panX = big;
  if (dir === 'hcenter') img.panX = 0;
  if (dir === 'top') img.panY = -big;
  if (dir === 'bottom') img.panY = big;
  if (dir === 'vcenter') img.panY = 0;
  app.renderStage(); app.renderSlotPanel(); app.queueSave();
}

function setImageMode(id, mode) {
  const img = state.images[id];
  if (!img) return;
  commit();
  img.mode = mode;
  app.renderStage(); app.renderSlotPanel(); app.queueSave();
  toast(mode === 'contain' ? '完整显示（可能留白）' : '填满裁切');
}

function resetImageTransform(id) {
  const img = state.images[id];
  if (!img) return;
  commit();
  img.zoom = 1; img.panX = 0; img.panY = 0;
  app.renderStage(); app.renderSlotPanel(); app.queueSave();
}

function ctxItem(label, run, opts = {}) {
  return { label, run, ...opts };
}

/** 根据右键位置算出该显示哪些菜单项 */
function buildContextMenu(ev) {
  // 真实右键的 target 就是被点的元素；只有合成事件派发在 document/body 上时才用坐标兜底
  const raw = ev.target;
  const usable = raw && raw.closest && raw !== document && raw !== document.body && raw !== document.documentElement;
  const target = usable ? raw : (document.elementFromPoint(ev.clientX, ev.clientY) || raw);
  const sel = state.selectedId;

  // ① 输入框/文本域：保留文本操作（不用浏览器菜单，但功能要对等）
  if (target.closest?.('input, textarea, [contenteditable="true"]')) {
    const el = target.closest('input, textarea, [contenteditable="true"]');
    const hasSel = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0);
    return {
      title: '文本',
      items: [
        ctxItem('复制', () => { el.focus(); document.execCommand('copy'); }, { disabled: !hasSel }),
        ctxItem('剪切', () => { el.focus(); document.execCommand('cut'); }, { disabled: !hasSel }),
        ctxItem('粘贴', () => { el.focus(); toast('用 Ctrl+V 粘贴（浏览器不允许脚本代按）'); }, { hint: 'Ctrl+V' }),
        { sep: true },
        ctxItem('全选', () => { el.focus(); el.select?.(); }),
      ],
    };
  }

  // ② 候选图
  const cand = target.closest?.('.cand');
  if (cand) {
    const i = Number(cand.dataset.i) || 0;
    return {
      title: '候选图',
      items: [
        ctxItem('放大看细节', () => openLightbox(app.candsOf(sel), i)),
        ctxItem('用这张', () => app.applyCand(i)),
        ctxItem('用这张进画布改', () => app.applyCandAndEdit(i)),
        { sep: true },
        ctxItem('删掉这张', () => {
          const arr = app.candsOf(sel);
          arr.splice(i, 1);
          app.renderCands();
        }),
      ],
    };
  }

  // ③ 画布（含某一格的图）
  const inCanvas = target.closest?.('#canvas') || target.closest?.('#stage');
  if (inCanvas) {
    const pt = app.pagePoint(ev);
    const slot = app.slotAt(pt);
    const sid = slot?.id || sel;
    if (!sid) return null;
    const hasImg = !!state.images[sid];
    const items = [];
    if (hasImg) {
      items.push(...CTX_TRANSFORM.map((it) => (it.sep ? it : { ...it, run: () => it.run(sid) })));
      items.push({ sep: true });
      items.push(ctxItem('看大图', () => { state.selectedId = sid; previewSlot(sid); }));
      items.push(ctxItem('替换图片…', () => { state.selectedId = sid; $('#filePick').dataset.mode = 'slot'; $('#filePick').click(); }));
      items.push(ctxItem('绘制这一格', () => { state.selectedId = sid; openPaint(sid); }));
      items.push(ctxItem('导出这一格', async () => { state.selectedId = sid; await exportSlotImage(); }));
      items.push({ sep: true });
      items.push(ctxItem('清空这一格的图', () => {
        commit();
        delete state.images[sid];
        app.renderStage(); app.renderSlotPanel(); app.refreshScript(); app.queueSave();
        toast('已清空这一格的图');
      }, { danger: true }));
    } else {
      items.push(ctxItem('选图片填入这一格', () => { state.selectedId = sid; app.renderSlotPanel(); $('#filePick').dataset.mode = 'slot'; $('#filePick').click(); }));
      items.push(ctxItem('AI 生成这一格', () => { state.selectedId = sid; app.renderSlotPanel(); app.generateSlotImage(sid); }));
      items.push(ctxItem('绘制这一格', () => { state.selectedId = sid; openPaint(sid); }));
    }
    // 选中的格与右键的格不同时，先把它选上，动作才不会作用错对象
    const firstRun = items.find((x) => x.run);
    if (firstRun) {
      const orig = firstRun.run;
      firstRun.run = () => { state.selectedId = sid; app.renderSlotPanel(); orig(); };
    }
    return { title: slot ? `第 ${slot.order} 格` : '画布', items };
  }

  // ④ 气泡
  // 画面里的气泡渲染成 <g data-bubble="<id>">（见 lib/svg.mjs），不是 .bub / data-bubble-id
  const bub = target.closest?.('g[data-bubble]');
  if (bub) {
    const id = bub.getAttribute('data-bubble');
    return {
      title: '气泡',
      items: [
        ctxItem('换样式', () => { state.selBubble = id; app.renderStage(); app.renderBubbles(); $('#bubbleDock')?.scrollIntoView({ block: 'nearest' }); }),
        ctxItem('编辑文字', () => { state.selBubble = id; app.renderStage(); app.renderBubbles(); $('#bubText')?.focus(); }),
        ctxItem('复制一个', () => { state.selBubble = id; app.duplicateBubble(); }),
        { sep: true },
        ctxItem('删除', () => { state.selBubble = id; app.deleteBubble(); }, { danger: true }),
      ],
    };
  }

  // ⑤ 全局
  return {
    title: 'PanelForge',
    items: [
      ctxItem('AI 生成这一格', () => app.generateSlotImage(state.selectedId)),
      ctxItem('绘制这一格', () => openPaint(state.selectedId)),
      { sep: true },
      ctxItem('导出这一页 PNG', () => app.exportPNG()),
      ctxItem('快捷键表', () => app.toggleShortcuts(true), { hint: '?' }),
    ],
  };
}

function installContextMenu() {
  let menu = $('#ctxMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'ctxMenu';
    menu.className = 'ctx-menu hidden';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
  }
  const hide = () => menu.classList.add('hidden');

  document.addEventListener('contextmenu', (ev) => {
    // 触屏长按也会派发 contextmenu：那不是用户要的右键菜单，直接吞掉（编辑用双击）
    const fromTouch = ev.pointerType === 'touch' || ev.sourceCapabilities?.firesTouchEvents === true;
    if (fromTouch) { ev.preventDefault(); return; }
    const spec = buildContextMenu(ev);
    if (!spec || !spec.items?.length) return;   // 没有我们的上下文 → 保留浏览器菜单
    ev.preventDefault();
    menu.innerHTML = `<div class="ctx-title">${escapeHtml(spec.title || '')}</div>`
      + spec.items.map((it, i) => (it.sep
        ? '<div class="ctx-sep"></div>'
        : `<button type="button" role="menuitem" class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
             <span>${escapeHtml(it.label)}</span>${it.hint ? `<kbd>${escapeHtml(it.hint)}</kbd>` : ''}
           </button>`)).join('');
    menu.classList.remove('hidden');
    // 贴边修正
    const r = menu.getBoundingClientRect();
    const x = Math.min(ev.clientX, window.innerWidth - r.width - 8);
    const y = Math.min(ev.clientY, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(6, x) + 'px';
    menu.style.top = Math.max(6, y) + 'px';
    menu._spec = spec;
  });

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ctx-item');
    if (!btn || btn.disabled) { hide(); return; }
    const i = Number(btn.dataset.i);
    const item = menu._spec?.items?.[i];
    hide();
    try { item?.run?.(); } catch (e) { toast('操作失败：' + e.message); }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!menu.contains(ev.target)) hide();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  window.addEventListener('blur', hide);
}

export function bindInboxUI() {
  installImageInbox();
  makeBubbleLibDraggable();
  installContextMenu();
}

window.__pfLightbox = (i = 0) => {
  const list = (app.candsOf(state.selectedId) || []).slice();
  if (list.length) return openLightbox(list, i);
  return previewSlot();
};

window.__pfContextMenu = (ev) => buildContextMenu(ev);

window.__pfInbox = () => inboxArea;
