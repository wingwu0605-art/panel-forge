/**
 * 模型配置：当前生效的那一份（state.llm）+ 多服务商 Key 管理（二级面板）。
 *
 * Key 只存在本机浏览器（localStorage），勾「仅本次会话」就不落盘。
 * 对话和生图是两条独立链路：可以只配生图、也可以两家各用一把 Key。
 */
import { $, escapeHtml, debounce } from './util.mjs';
import { state } from './state.mjs';
import { store, KEYS } from './storage.mjs';
import { toast, setBusy } from './ui.mjs';
import { openModal, closeModal } from './dialogs.mjs';
import { app } from './ctx.mjs';

/* ================================================================== *
 * AI 导演
 * ================================================================== */
const LLM_STORE = KEYS.llm;

const CHAR_STORE = KEYS.charSheet;

export function loadLlm() {
  const saved = store.json(LLM_STORE);
  if (saved && typeof saved === 'object') state.llm = { ...state.llm, ...saved };
  state.charSheet = store.get(CHAR_STORE) || '';
  $('#llmProtocol').value = state.llm.protocol || 'openai';
  $('#llmBase').value = state.llm.baseUrl || '';
  $('#llmKey').value = state.llm.apiKey || '';
  $('#llmModel').value = state.llm.model || '';
  if ($('#imgModel')) $('#imgModel').value = state.llm.imgModel || '';
  if ($('#imgProvider')) $('#imgProvider').value = state.llm.imageProvider || 'openai';
  $('#charSheet').value = state.charSheet;
  if ($('#chkKeySession')) $('#chkKeySession').checked = !!state.llm.sessionOnly;
}

export function saveLlm() {
  const sessionOnly = !!$('#chkKeySession')?.checked;
  // 注意：这里是**从表单重建** state.llm，所以任何表单项之外的字段都必须显式带过来。
  // 曾经漏了 imgBaseUrl / imgKey —— 生图前会调用本函数，于是「生图专用 Base URL」被抹掉、
  // 请求回落到对话那条 baseUrl（用户看到的 api.deepseek.com/images/generations 就是这么来的）。
  state.llm = {
    ...state.llm,
    protocol: $('#llmProtocol').value,
    baseUrl: $('#llmBase').value.trim(),
    apiKey: $('#llmKey').value.trim(),
    model: $('#llmModel').value.trim(),
    imgModel: $('#imgModel') ? $('#imgModel').value.trim() : (state.llm.imgModel || ''),
    imageProvider: $('#imgProvider') ? $('#imgProvider').value : (state.llm.imageProvider || 'openai'),
    imgBaseUrl: $('#imgBaseUrl') ? $('#imgBaseUrl').value.trim() : (state.llm.imgBaseUrl || ''),
    imgKey: $('#imgKey') ? $('#imgKey').value.trim() : (state.llm.imgKey || ''),
    sessionOnly,
  };
  state.charSheet = $('#charSheet').value.trim();
  // 勾了「仅本次会话」就不把 Key 写进浏览器存储
  store.setJSON(LLM_STORE, { ...state.llm, apiKey: sessionOnly ? '' : state.llm.apiKey });
  store.set(CHAR_STORE, state.charSheet);
}

function clearLlm() {
  store.set(LLM_STORE, null);
  state.llm = { protocol: 'openai', baseUrl: '', apiKey: '', model: '' };
  $('#llmBase').value = ''; $('#llmKey').value = ''; $('#llmModel').value = '';
  if ($('#imgModel')) $('#imgModel').value = '';
  syncLlmStatus();
  toast('已清除本机 AI 配置');
}

export async function syncLlmStatus() {
  const el = $('#llmStatus');
  const badge = $('#llmBadge');
  if (!el) return;
  const local = !!state.llm.apiKey;
  let server = null;
  try { server = await app.api.llmStatus(); } catch { /* ignore */ }
  if (server?.staticMode) {
    el.className = local ? 'llm-status ok' : 'llm-status';
    el.textContent = local
      ? `浏览器直连 · ${state.llm.protocol} · ${state.llm.model || '默认模型'}（Key 只在你这台机器上）`
      : '静态版也能用 AI：在上面填自己的 Key（只在浏览器里，不上传）。规则路不用 Key，随时可用';
    badge.textContent = local ? '就绪' : '待填 Key';
    badge.style.color = local ? 'var(--ok)' : 'var(--dim)';
    return;
  }
  if (local) {
    el.className = 'llm-status ok';
    el.textContent = `本机已填 Key · ${state.llm.protocol} · ${state.llm.model || '默认模型'}`;
    badge.textContent = '就绪';
    badge.style.color = 'var(--ok)';
  } else if (server?.configured) {
    el.className = 'llm-status ok';
    el.textContent = `服务端环境变量已配置 · ${server.protocol} · ${server.model}`;
    badge.textContent = '就绪';
    badge.style.color = 'var(--ok)';
  } else {
    el.className = 'llm-status';
    el.textContent = '未配置 · 规则路照常可用（AI 路需你填 Key，或设 LLM_API_KEY）';
    badge.textContent = '未配置';
    badge.style.color = '';
  }
}

async function testLlm() {
  const btn = $('#btnLlmTest');
  const old = btn.textContent;
  setBusy(btn, true); btn.textContent = '测试中…';
  saveLlm();
  try {
    const r = await app.api.llmTest({ llm: state.llm });
    if (r.ok) {
      $('#llmStatus').className = 'llm-status ok';
      $('#llmStatus').textContent = `连接成功 · ${r.model} · ${r.latencyMs}ms`;
      toast(`连接成功 ${r.latencyMs}ms`);
    } else {
      $('#llmStatus').className = 'llm-status bad';
      $('#llmStatus').textContent = `${r.error || '失败'}${r.hint ? ' · ' + r.hint : ''}`;
      toast('连接失败：' + (r.code || r.error));
    }
  } catch (e) {
    toast('连接失败：' + e.message);
  } finally {
    setBusy(btn, false); btn.textContent = old;
  }
}

/* ---------------- 多服务商 Key 管理 ---------------- */
const KEYS_STORE = KEYS.keys;

const KEY_PRESETS = {
  deepseek: { name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', imgModel: '' },
  openai: { name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', imgModel: 'gpt-image-1' },
  siliconflow: { name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', imgModel: 'Kwai-Kolors/Kolors' },
  anthropic: { name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', imgModel: '' },
  moonshot: { name: 'Moonshot', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', imgModel: '' },
  // 火山方舟（豆包）：版本段是 /api/v3，不是 /v1；模型要填 model id 或接入点 ep-xxxx。
  // 这里的默认值只是「能跑通的最小示例」，具体以你控制台里开通的模型为准。
  volcengine: {
    name: '火山方舟（豆包）', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    // 对话模型留空：账号里有哪些模型只有控制台知道，填死一个不存在的 ID 只会让人以为配置错了
    model: '',
    imgProvider: 'volcengine',
    imgModel: 'doubao-seedream-5-0-pro-260628',
    imgHint: 'Model ID 从方舟「模型广场」复制（带日期后缀，如 doubao-seedream-5-0-pro-260628）；'
      + '生图不需要对话模型，想用 AI 排戏/切分再填一个对话模型的 ID',
  },
  dashscope: {
    name: '通义百炼', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    imgProvider: 'openai',
    imgModel: 'wanx2.1-t2i-turbo',
    imgHint: '百炼兼容模式：文本 qwen-plus；生图用 wanx2.1-t2i-turbo（异步任务在部分模型上不支持，失败就换 wanx2.1-t2i-plus）',
  },
  custom: { name: '自定义', protocol: 'openai', baseUrl: '', model: '', imgModel: '' },
};

export function loadKeyStore() {
  const raw = store.json(KEYS_STORE);
  const ks = raw && Array.isArray(raw.entries) ? raw : { entries: [], activeId: null };
  // 从旧单条配置迁移
  const old = store.json(LLM_STORE);
  if (old?.apiKey && !ks.entries.length) {
    ks.entries.push({
      id: 'k' + Date.now().toString(36), name: '我的服务商', protocol: old.protocol || 'openai',
      baseUrl: old.baseUrl || '', model: old.model || '', apiKey: old.apiKey,
      imgProvider: old.imageProvider || 'openai', imgModel: old.imgModel || '',
      verifiedAt: 0,
    });
    ks.activeId = ks.entries[0].id;
  }
  state.keys = ks;
  const active = ks.entries.find((e) => e.id === ks.activeId) || ks.entries[0] || null;
  if (active) applyKeyEntry(active);
  renderKeyStatus();
}

function saveKeyStore() {
  store.setJSON(KEYS_STORE, state.keys);
}

function activeKeyEntry() {
  return state.keys.entries.find((e) => e.id === state.keys.activeId) || null;
}

function applyKeyEntry(e) {
  state.llm = {
    protocol: e.protocol || 'openai',
    baseUrl: e.baseUrl || '',
    model: e.model || '',
    apiKey: e.apiKey || '',
    imageProvider: e.imgProvider || 'openai',
    imgModel: e.imgModel || '',
    imgBaseUrl: e.imgBaseUrl || '',
    imgKey: e.imgKey || '',
    sessionOnly: false,
  };
  $('#llmProtocol').value = state.llm.protocol;
  $('#llmBase').value = state.llm.baseUrl;
  $('#llmModel').value = state.llm.model;
  $('#llmKey').value = state.llm.apiKey;
  if ($('#imgProvider')) $('#imgProvider').value = state.llm.imageProvider;
  if ($('#imgModel')) $('#imgModel').value = state.llm.imgModel;
  syncLlmStatus();
}

function renderKeyStatus() {
  const cur = activeKeyEntry();
  const nameEl = $('#aiCurName');
  const metaEl = $('#aiCurMeta');
  const btn = $('#btnKeyMgr');
  if (!nameEl) return;
  if (cur) {
    nameEl.textContent = cur.name || '已配置';
    metaEl.textContent = `${cur.model || '默认模型'} · ${cur.verifiedAt ? '已验证' : '未验证'} · ${state.keys.entries.length} 个 Key`;
    btn.textContent = cur.verifiedAt ? '管理 Key' : '输入 Key';
  } else {
    nameEl.textContent = '未配置 Key';
    metaEl.textContent = '规则路照常可用，AI 是可选加速';
    btn.textContent = '输入 Key';
  }
}

function renderKeySheet() {
  const list = $('#ksList');
  if (!list) return;
  if (!state.keys.entries.length) {
    list.innerHTML = '<div class="muted small" style="padding:8px 2px">还没有保存的 Key。在右边填一个，点「保存并使用」。</div>';
    return;
  }
  list.innerHTML = state.keys.entries.map((e) => {
    const on = e.id === state.keys.activeId;
    return `<div class="ks-item${on ? ' on' : ''}" data-id="${e.id}">
      <span class="ks-radio">${on ? '●' : '○'}</span>
      <div class="ks-info">
        <b>${escapeHtml(e.name || '未命名')}</b>
        <span>${escapeHtml(e.model || '默认模型')} · ${escapeHtml(e.baseUrl || '')}</span>
        <span class="ks-key">${e.apiKey ? 'sk-••••' + String(e.apiKey).slice(-4) : '无 Key'}${e.verifiedAt ? ' · 已验证' : ''}</span>
      </div>
      <div class="ks-acts">
        <button class="btn tiny" data-act="use">${on ? '当前' : '使用'}</button>
        <button class="btn tiny" data-act="edit">编辑</button>
        <button class="btn tiny danger" data-act="del">删</button>
      </div>
    </div>`;
  }).join('');
}

export function openKeySheet() {
  renderKeySheet();
  openModal($('#keySheet'));
}

export function closeKeySheet() { closeModal($('#keySheet')); }

/** 生图这条链路到底配好了没 —— 独立于对话模型，避免「对话挂了以为生图也废了」 */
function syncImgReady() {
  const el = $('#ksImgReady');
  if (!el) return;
  const provider = $('#ksImgProvider')?.value || state.llm?.imageProvider || 'openai';
  const model = ($('#ksImgModel')?.value || '').trim() || (state.llm?.imgModel || '');
  const base = ($('#ksImgBase')?.value || '').trim() || (state.llm?.imgBaseUrl || '') || ($('#ksBase')?.value || '').trim() || (state.llm?.baseUrl || '');
  const ownKey = ($('#ksImgKey')?.value || '').trim() || (state.llm?.imgKey || '');
  const fallbackKey = ($('#ksKey')?.value || '').trim() || (state.llm?.apiKey || '');
  const key = ownKey || fallbackKey;
  const providerName = { volcengine: '火山方舟 Seedream', openai: 'OpenAI 兼容', siliconflow: '硅基流动', stability: 'Stability' }[provider] || provider;
  if (!model) { el.textContent = '生图还没配好：缺生图模型'; el.dataset.ok = '0'; return; }
  if (!key) { el.textContent = '生图还没配好：缺 Key（生图 Key 或上面的 API Key 都行）'; el.dataset.ok = '0'; return; }
  const keySrc = ownKey ? '生图专用 Key' : '共用上面的 Key';
  const tail = ownKey || !fallbackKey ? '' : '（注意：上面那把 Key 可能属于另一家，测试对话失败也不影响这里）';
  el.textContent = `生图就绪：${providerName} · ${model} · ${base.replace(/^https?:\/\//, '')} · ${keySrc} ****${String(key).slice(-4)}${tail}`;
  el.dataset.ok = '1';
}

function fillKeyForm(e) {
  if (!e) return;
  $('#ksProtocol').value = e.protocol || 'openai';
  $('#ksBase').value = e.baseUrl || '';
  $('#ksModel').value = e.model || '';
  $('#ksKey').value = e.apiKey || '';
  $('#ksImgProvider').value = e.imgProvider || 'openai';
  $('#ksImgModel').value = e.imgModel || '';
  // 生图专属（留空 = 复用上面那条）
  if ($('#ksImgBase')) $('#ksImgBase').value = e.imgBaseUrl || '';
  if ($('#ksImgKey')) $('#ksImgKey').value = e.imgKey || '';
  const more = document.querySelector('.ks-more');
  if (more) more.open = !!(e.imgBaseUrl || e.imgKey);
}

function formEntry() {
  return {
    id: state._editingKeyId || 'k' + Date.now().toString(36),
    name: ($('#ksPreset').selectedOptions[0]?.textContent || '服务商').trim(),
    protocol: $('#ksProtocol').value,
    baseUrl: $('#ksBase').value.trim(),
    model: $('#ksModel').value.trim(),
    apiKey: $('#ksKey').value.trim(),
    imgProvider: $('#ksImgProvider').value,
    imgModel: $('#ksImgModel').value.trim(),
    imgBaseUrl: ($('#ksImgBase')?.value || '').trim(),
    imgKey: ($('#ksImgKey')?.value || '').trim(),
    verifiedAt: 0,
  };
}

function upsertKey(entry) {
  const i = state.keys.entries.findIndex((x) => x.id === entry.id);
  if (i >= 0) state.keys.entries[i] = { ...state.keys.entries[i], ...entry };
  else state.keys.entries.push(entry);
  state.keys.activeId = entry.id;
  saveKeyStore();
  applyKeyEntry(state.keys.entries.find((x) => x.id === entry.id));
  renderKeyStatus();
  renderKeySheet();
}

/** 启动时调用一次：接上 AI 导演卡与 Key 面板里的所有控件 */
export function bindKeys() {
  // AI 导演
  for (const id of ['llmProtocol', 'llmBase', 'llmKey', 'llmModel']) {
    $('#' + id).addEventListener('input', () => { saveLlm(); syncLlmStatus(); });
    $('#' + id).addEventListener('change', () => { saveLlm(); syncLlmStatus(); });
  }
  $('#btnLlmTest').addEventListener('click', testLlm);
  $('#btnLlmClear').addEventListener('click', clearLlm);
  $('#chkKeySession')?.addEventListener('change', () => { saveLlm(); syncLlmStatus(); });
  $('#btnKeyMgr')?.addEventListener('click', openKeySheet);
  $('#ksPreset')?.addEventListener('change', (ev) => {
    const p = KEY_PRESETS[ev.target.value];
    if (!p) return;
    $('#ksProtocol').value = p.protocol;
    $('#ksBase').value = p.baseUrl;
    $('#ksModel').value = p.model;
    if ('imgModel' in p) $('#ksImgModel').value = p.imgModel || '';
    if ('imgProvider' in p) $('#ksImgProvider').value = p.imgProvider || 'openai';
    // 每个服务商一句话提示（模型名/版本段各不相同，写死在选项里就会互相误导）
    const baseHint = $('#ksBaseHint');
    if (baseHint) {
      const hints = [];
      if (/\/api\/v\d/.test(p.baseUrl)) hints.push('这个服务商的版本段在 /api/v3，不是 /v1');
      if (p.imgHint) hints.push(p.imgHint);
      if (p.name === '自定义') hints.push('Base URL 填到 OpenAI 兼容的版本段为止（如 https://host/v1），模型填真实 model id');
      baseHint.textContent = hints.join('；');
      baseHint.classList.toggle('hidden', !hints.length);
    }
    // 填完自动把「模型」这一栏高亮一下，避免只改 Base URL 忘了改模型
    $('#ksModel')?.classList.add('needs-check');
    setTimeout(() => $('#ksModel')?.classList.remove('needs-check'), 1600);
  });
  $('#ksList')?.addEventListener('click', (ev) => {
    const item = ev.target.closest('.ks-item');
    if (!item) return;
    const id = item.dataset.id;
    const entry = state.keys.entries.find((e) => e.id === id);
    const act = ev.target.closest('button')?.dataset.act;
    if (act === 'use') {
      state.keys.activeId = id; saveKeyStore();
      applyKeyEntry(entry); renderKeyStatus(); renderKeySheet();
      toast('已切换到 ' + entry.name);
    } else if (act === 'edit') {
      state._editingKeyId = id;
      fillKeyForm(entry);
      $('#ksMsg').textContent = '正在编辑「' + entry.name + '」，改完点保存';
    } else if (act === 'del') {
      if (!confirm('删掉「' + entry.name + '」的 Key？')) return;
      state.keys.entries = state.keys.entries.filter((e) => e.id !== id);
      if (state.keys.activeId === id) state.keys.activeId = state.keys.entries[0]?.id || null;
      saveKeyStore();
      const next = activeKeyEntry();
      if (next) applyKeyEntry(next); else { state.llm = { protocol: 'openai', baseUrl: '', apiKey: '', model: '' }; syncLlmStatus(); }
      renderKeyStatus(); renderKeySheet();
    }
  });
  $('#ksTest')?.addEventListener('click', async () => {
    const btn = $('#ksTest'); const old = btn.textContent;
    setBusy(btn, true); btn.textContent = '测试中…';
    $('#ksMsg').textContent = '正在请求对话模型…';
    try {
      const r = await app.api.llmTest({ llm: formEntry() });
      if (r?.ok) {
        $('#ksMsg').textContent = '✅ 对话模型通了 · ' + (r.model || '') + ' · ' + (r.latencyMs || '?') + 'ms';
        state._lastTestOk = true;
      } else {
        const where = r?.endpoint ? ` · POST ${String(r.endpoint).replace(/^https?:\/\//, '')} · model=${r.model || '?'}` : '';
        // 明确说这是「对话」失败 —— 生图是另一条链路，用另一把 Key，不受影响
        $('#ksMsg').textContent = '❌ 对话模型失败（不影响生图）：' + (r?.error || '失败') + where + (r?.hint ? ' · ' + r.hint : '');
        state._lastTestOk = false;
      }
    } catch (e) {
      $('#ksMsg').textContent = '❌ 对话模型失败：' + e.message;
      state._lastTestOk = false;
    } finally { setBusy(btn, false); btn.textContent = old; }
  });

  /**
   * 只测生图：真的生成一张 512×512 小图（约 0.02 元），用来确认生图这条链路。
   * 和「测试对话」完全分开 —— 文本用哪家、生图用哪家互不影响。
   */
  $('#ksTestImg')?.addEventListener('click', async () => {
    const entry = formEntry();
    const model = entry.imgModel || '(未填生图模型)';
    if (!confirm(`会用生图模型 ${model} 真实生成一张小图（约 0.02 元），继续吗？`)) return;
    const btn = $('#ksTestImg'); const old = btn.textContent;
    setBusy(btn, true); btn.textContent = '生成中…';
    $('#ksMsg').textContent = '正在调用生图接口…';
    const t0 = Date.now();
    try {
      const r = await app.api.imageGenerate({
        prompt: 'a simple red circle on white background, minimal',
        size: '512x512',
        model: entry.imgModel,
        provider: entry.imgProvider,
        llm: entry,
      });
      if (r?.ok) {
        const host = r.endpointHost || '?';
        $('#ksMsg').textContent = `✅ 生图通了 · ${host} · ${r.model || model} · 请求尺寸 ${r.size || '?'} · ${Date.now() - t0}ms`
          + (r.refsUsed ? ` · 带 ${r.refsUsed} 张参考图` : '');
        state._lastImgTestOk = true;
      } else {
        $('#ksMsg').textContent = '❌ 生图失败：' + (r?.error || '失败') + (r?.hint ? ' · ' + r.hint : '');
        state._lastImgTestOk = false;
      }
    } catch (e) {
      $('#ksMsg').textContent = '❌ 生图失败：' + e.message;
      state._lastImgTestOk = false;
    } finally { setBusy(btn, false); btn.textContent = old; syncImgReady(); }
  });
  // 生图这些字段一变就刷新「生图就绪」提示（它和对话模型是两条独立链路）
  ['ksImgProvider', 'ksImgModel', 'ksImgBase', 'ksImgKey', 'ksBase', 'ksKey'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', syncImgReady);
    el.addEventListener('change', syncImgReady);
  });
  syncImgReady();
  $('#ksSave')?.addEventListener('click', () => {
    const e = formEntry();
    // 允许「只有生图配置」：文本用不上 AI 的人不该被对话 Key 拦住
    const hasChat = e.apiKey && e.baseUrl;
    const hasImg = e.imgKey && (e.imgBaseUrl || e.baseUrl) && e.imgModel;
    if (!hasChat && !hasImg) {
      $('#ksMsg').textContent = '至少配一条：对话（Base URL + API Key）或生图（生图模型 + Key）';
      return;
    }
    if (state._lastTestOk || state._lastImgTestOk) e.verifiedAt = Date.now();
    upsertKey(e);
    state._editingKeyId = null;
    $('#ksMsg').textContent = e.verifiedAt
      ? '已保存并验证，可以开始用了'
      : (hasChat ? '已保存（对话未验证，可以点「测试对话」）' : '已保存生图配置（可直接用「生这一格」）');
    toast('已保存 Key：' + e.name);
  });
  $('#charSheet').addEventListener('input', debounce(saveLlm, 400));
}
