/**
 * 参考图：角色卡（让同一个人每格都长一样）+ 风格跟随的样图。
 *
 * 生图时统一从 activeCharPayload() 取「提示词片段 + 参考图」，
 * 避免「某个按钮忘了带参考图」这类不一致。
 */
import { $, $$, escapeHtml } from './util.mjs';
import { state } from './state.mjs';
import { imageAsset } from './assets.mjs';
import { store, KEYS, idbGet, idbSet, idbGetWithin } from './storage.mjs';
import { toast } from './ui.mjs';
import { downloadText } from './share.mjs';
import { app } from './ctx.mjs';

/* ---------------- 角色参考图 ---------------- */
export async function loadChars() {
  try {
    const list = await idbGetWithin('chars', 1200);
    if (Array.isArray(list)) state.chars = list;
  } catch { /* ignore */ }
  renderChars();
}

export async function saveChars() {
  await idbSet('chars', state.chars);
}

export function renderChars() {
  const box = document.querySelector('#charList');
  if (!box) return;
  if (!state.chars.length) {
    box.innerHTML = '<span class="muted small">还没有角色卡。加一张参考图，以后每次生图都会自动带上。</span>';
    return;
  }
  box.innerHTML = state.chars.map((c) => {
    const on = state.activeChars.includes(c.id);
    return `<div class="char-item${on ? ' on' : ''}" data-id="${c.id}">
      <div class="char-thumbs">${(c.images || []).slice(0, 3).map((h) => `<img src="${escapeHtml(h)}" alt="">`).join('')}</div>
      <div class="char-meta">
        <b>${escapeHtml(c.name || '未命名')}</b>
        <span>${escapeHtml(c.note || '')}</span>
      </div>
      <div class="char-acts">
        <button class="btn tiny" data-act="toggle">${on ? '停用' : '启用'}</button>
        <button class="btn tiny danger" data-act="del">删</button>
      </div>
    </div>`;
  }).join('');
}

export async function addCharCard(files) {
  const nameEl = document.querySelector('#charName');
  const noteEl = document.querySelector('#charNote');
  const name = (nameEl?.value || '').trim() || '角色 ' + (state.chars.length + 1);
  const note = (noteEl?.value || '').trim();
  const picked = [...files].slice(0, 3);
  const images = [];
  for (const f of picked) {
    try {
      const href = await shrinkImage(f, 512);
      images.push(href);
    } catch { /* 跳过读不出的 */ }
  }
  if (!images.length) { toast('这几张图读不出来，换一张试试'); return; }
  state.chars.push({ id: 'c' + Date.now().toString(36), name, note, images });
  state.activeChars.push(state.chars[state.chars.length - 1].id);
  if (nameEl) nameEl.value = '';
  if (noteEl) noteEl.value = '';
  await saveChars();
  renderChars();
  app.queueSave();
  toast('已保存角色「' + name + '」并启用');
}

/** 参考图统一压到 512px 长边，省空间也够模型认人 */
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片读不出来')); };
    img.src = url;
  });
}

/** 当前启用的角色 → { block: 提示词片段, refs: [dataURL] } */
/** 风格跟随模式（char / sample / both / none） */
export function styleMode() {
  const m = state.styleFollow;
  return ['char', 'sample', 'both', 'none'].includes(m) ? m : 'char';
}

export function followChars() { return styleMode() === 'char' || styleMode() === 'both'; }

export function followSamples() { return styleMode() === 'sample' || styleMode() === 'both'; }

/**
 * 这一次要发给生图模型的人设/风格信息。
 * 统一入口：人设图、样图都从这里出，避免"某个按钮忘了带参考图"这类不一致。
 */
export function activeCharPayload() {
  const parts = [];
  const refs = [];

  if (followChars()) {
    const chars = state.chars.filter((c) => state.activeChars.includes(c.id));
    if (chars.length) {
      parts.push('角色一致性：' + chars.map((c) => `${c.name}${c.note ? '（' + c.note + '）' : ''}`).join('；')
        + '。外观、发型、服装、年龄必须与参考图完全一致，不要换脸。');
      refs.push(...chars.flatMap((c) => c.images || []));
    }
  }

  if (followSamples()) {
    const samples = (state.samples || []).filter((x) => x && x.href);
    if (samples.length) {
      parts.push(`风格一致性：严格照参考样图的画风、线宽、上色方式与配色，不要擅自更换画风（共 ${samples.length} 张样图）。`);
      refs.push(...samples.map((x) => x.href));
    }
  }

  return { block: parts.join(' '), refs: refs.slice(0, 6) };
}

/* ---------------- 角色卡的导出 / 导入（团队共用同一批人） ---------------- */
const CHARS_MAX = 60;

/** 去重指纹：名字 + 第一张参考图 */
const charKey = (c) => `${(c.name || '').trim()}||${(c.images || [])[0] || ''}`;

export function exportChars() {
  if (!state.chars.length) { toast('还没有角色卡可导出'); return; }
  const payload = {
    app: 'panel-forge',
    kind: 'character-cards',
    version: 1,
    exportedAt: new Date().toISOString(),
    chars: state.chars.map((c) => ({
      name: c.name || '',
      note: c.note || '',
      active: state.activeChars.includes(c.id),
      images: (c.images || []).slice(0, 3),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(JSON.stringify(payload, null, 2), `角色卡-${stamp}.json`, 'application/json;charset=utf-8');
  toast(`已导出 ${payload.chars.length} 张角色卡`);
}

/** 从 JSON 导入：本机已有的（名字＋参考图都一样）自动跳过，重复导入不会堆一堆 */
export async function importChars(file) {
  if (file.size > 24 * 1024 * 1024) { toast('这个文件太大了（超过 24MB），拆成两份再导'); return null; }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('这个文件不是合法的 JSON'); return null;
  }
  // 兼容两种：导出时生成的整包，或者干脆是一个角色数组
  const list = Array.isArray(data) ? data : (Array.isArray(data?.chars) ? data.chars : null);
  if (!list) { toast('JSON 里没找到角色卡，请用「导出角色卡」生成的那份文件'); return null; }

  const seen = new Set(state.chars.map(charKey));
  const room = Math.max(0, CHARS_MAX - state.chars.length);
  const fresh = [];
  let skipped = 0, noImg = 0;
  for (const raw of list.slice(0, 200)) {
    const images = (Array.isArray(raw?.images) ? raw.images : [])
      .filter((h) => typeof h === 'string' && /^data:image\//i.test(h)).slice(0, 3);
    if (!images.length) { noImg++; continue; }
    const card = {
      id: 'c' + Math.random().toString(36).slice(2, 10),
      name: String(raw?.name || '').trim().slice(0, 40) || '角色',
      note: String(raw?.note || '').trim().slice(0, 120),
      images,
    };
    const key = charKey(card);
    if (seen.has(key) || fresh.length >= room) { skipped++; continue; }
    seen.add(key);
    fresh.push({ card, active: raw?.active !== false });
  }
  if (!fresh.length) {
    toast(room <= 0 ? `角色卡最多 ${CHARS_MAX} 张，先删几张再导入`
      : noImg ? '导入的角色都没有参考图，没法用'
        : '这些角色卡本机已经有了');
    return null;
  }
  for (const { card } of fresh) state.chars.push(card);
  for (const { card, active } of fresh) if (active) state.activeChars.push(card.id);
  await saveChars();
  renderChars();
  app.queueSave();
  const tail = [skipped ? `${skipped} 张重复` : '', noImg ? `${noImg} 张缺参考图` : ''].filter(Boolean).join('，');
  toast(`导入 ${fresh.length} 张角色卡${tail ? `（跳过 ${tail}）` : ''}`);
  return { added: fresh.length, skipped, noImg };
}

/* ================================================================== *
 * 真正启动（必须留在文件最后：这时上面所有 const 都已初始化完成）
 * ================================================================== */
/* ---------------- 风格跟随：样图 ---------------- */
const SAMPLES_MAX = 6;

function renderSamples() {
  const box = $('#sampleBox');
  const grid = $('#sampleGrid');
  if (!box || !grid) return;
  box.classList.toggle('hidden', !followSamples());
  $$('#styleSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.follow || 'char') === styleMode()));
  const hint = $('#styleHint');
  if (hint) {
    hint.textContent = {
      char: '跟角色参考图',
      sample: '跟样图的画风',
      both: '人设图 + 样图都参考',
      none: '不参考任何图',
    }[styleMode()];
  }
  grid.innerHTML = (state.samples || []).map((sp, i) => `
    <div class="sample-item" data-i="${i}">
      <img src="${escapeHtml(sp.href)}" alt="样图 ${i + 1}">
      <button class="sample-del" type="button" data-del="${i}" title="删掉这张">×</button>
    </div>`).join('') + ((state.samples || []).length < SAMPLES_MAX
    ? '<button class="sample-add" type="button" id="btnSampleAddInner" title="加样图（也可以直接拖进来 / Ctrl+V）">＋</button>'
    : '');
}

export async function addSamples(files) {
  const list = (files || []).filter((f) => f && /^image\//i.test(f.type || ''));
  if (!list.length) return 0;
  const room = SAMPLES_MAX - (state.samples || []).length;
  if (room <= 0) { toast(`样图最多 ${SAMPLES_MAX} 张`); return 0; }
  const use = list.slice(0, room);
  for (const f of use) {
    try {
      const asset = await imageAsset(f, { name: 'sample' });
      state.samples.push(asset);
    } catch { /* 跳过坏图 */ }
  }
  renderSamples();
  persistSamples();
  toast(`已加入 ${use.length} 张样图（共 ${state.samples.length} 张）`);
  return use.length;
}

function removeSample(i) {
  state.samples.splice(i, 1);
  renderSamples();
  persistSamples();
}

let sampleSaveTimer = 0;
/** 样图直接存 Blob（IndexedDB 原生支持；以前先转成 base64 data URL，体积 +33%、每次都要重新编码） */
function persistSamples() {
  clearTimeout(sampleSaveTimer);
  sampleSaveTimer = setTimeout(() => {
    const blobs = (state.samples || []).map((sp) => sp.blob).filter((b) => b instanceof Blob);
    idbSet('samples', { blobs, savedAt: Date.now() });
  }, 400);
}

async function restoreSamples() {
  try {
    const rec = await idbGet('samples');
    const src = rec?.blobs || rec?.urls || [];      // urls：老版本存的 data URL
    const out = [];
    for (const u of src) {
      try { out.push(await imageAsset(u, { name: 'sample' })); } catch { /* 跳过坏图 */ }
    }
    if (out.length) { state.samples = out; renderSamples(); }
  } catch { /* ignore */ }
}

export function setStyleFollow(mode) {
  const m = ['char', 'sample', 'both', 'none'].includes(mode) ? mode : 'char';
  state.styleFollow = m;
  store.set(KEYS.styleFollow, m);
  renderSamples();
  app.queueSave();
  toast({
    char: '生图会跟人设图',
    sample: '生图会跟样图的画风',
    both: '人设图 + 样图都会参考',
    none: '生图不参考任何图（每格可能长得不一样）',
  }[m]);
}

window.__pfStyle = () => ({
  mode: styleMode(),
  samples: (state.samples || []).length,
  followChars: followChars(),
  followSamples: followSamples(),
});

/** 启动时调用一次：恢复样图 / 风格跟随，并接上角色卡与样图的所有按钮 */
export function bindRefs() {
  const saved = store.get(KEYS.styleFollow);
  if (saved) state.styleFollow = saved;
  renderSamples();
  restoreSamples();
  $$('#styleSeg button').forEach((b) => b.addEventListener('click', () => setStyleFollow(b.dataset.follow)));
  $('#btnSamplePick')?.addEventListener('click', () => $('#sampleFiles').click());
  $('#sampleFiles')?.addEventListener('change', async (ev) => {
    await addSamples([...(ev.target.files || [])]);
    ev.target.value = '';
  });
  $('#sampleGrid')?.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { removeSample(Number(del.dataset.del)); return; }
    if (ev.target.closest('#btnSampleAddInner')) $('#sampleFiles').click();
  });

  $('#btnCharPick')?.addEventListener('click', () => $('#charFiles').click());
  $('#charFiles')?.addEventListener('change', async (ev) => {
    const files = ev.target.files;
    if (files && files.length) await addCharCard(files);
    ev.target.value = '';
  });
  $('#charList')?.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.char-item');
    if (!item) return;
    const id = item.dataset.id;
    const act = ev.target.closest('button')?.dataset.act;
    if (act === 'toggle') {
      const i = state.activeChars.indexOf(id);
      if (i >= 0) state.activeChars.splice(i, 1);
      else state.activeChars.push(id);
      renderChars(); app.queueSave();
    } else if (act === 'del') {
      state.chars = state.chars.filter((c) => c.id !== id);
      state.activeChars = state.activeChars.filter((x) => x !== id);
      await saveChars(); renderChars(); app.queueSave();
    }
  });
  $('#btnCharClearAll')?.addEventListener('click', async () => {
    if (!confirm('清空所有角色卡？参考图会一起删掉。')) return;
    state.chars = []; state.activeChars = [];
    await saveChars(); renderChars(); app.queueSave();
  });
  $('#btnCharExport')?.addEventListener('click', exportChars);
  $('#btnCharImport')?.addEventListener('click', () => $('#charImportFile').click());
  $('#charImportFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) await importChars(f);
    ev.target.value = '';
  });
}
