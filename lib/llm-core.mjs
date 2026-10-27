/**
 * llm-core.mjs — AI 层「纯浏览器也能跑」的那部分
 *
 * 和 llm.mjs 的分工：
 *   llm.mjs       读环境变量（Node 专用）+ 重新导出本文件的函数
 *   llm-core.mjs  只有 fetch / AbortController / URL，浏览器与 Node 通用
 *
 * 所以同一份 prompt、同一套「模型不许发明格位」的校验，服务端和静态版共用，
 * 不会出现两边行为不一致。
 *
 * 支持两种协议：
 *   openai     POST {base}/v1/chat/completions   （OpenAI / DeepSeek / Moonshot / 通义 / Ollama / LM Studio / 中转）
 *   anthropic  POST {base}/v1/messages           （Claude）
 *
 * 想做成中转（relay）：把 baseUrl 指向你的中转域名即可，其余逻辑不用改。
 */

export const DEFAULT_BASE = { openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com' };

export const REDACT = (s, key) => (key ? String(s).split(key).join('***') : String(s));

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/** 用外部传入的配置对象补全默认值（不读环境变量，浏览器安全） */
export function normalizeCfg(o = {}) {
  const protocol = String(o.protocol || 'openai').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const num = (v, def, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  };
  return {
    protocol,
    baseUrl: String(o.baseUrl || DEFAULT_BASE[protocol]).trim(),
    apiKey: String(o.apiKey || '').trim(),
    model: String(o.model || (protocol === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini')).trim(),
    timeoutMs: num(o.timeoutMs, 60000, 5000, 180000),
    temperature: num(o.temperature ?? 0.3, 0.3, 0, 1.5),
    maxTokens: num(o.maxTokens, 3000, 256, 8000),
    imgModel: String(o.imgModel || '').trim(),
    // 生图可以完全独立于对话：换服务商、换地址、换 Key。
    // 留空就回落到对话的 baseUrl / apiKey —— 火山方舟、OpenAI、硅基、百炼都是同一把 Key 两项通用。
    imgBaseUrl: String(o.imgBaseUrl || '').trim(),
    imgKey: String(o.imgKey || '').trim(),
    imageProvider: ['openai', 'siliconflow', 'stability', 'volcengine'].includes(String(o.imageProvider || '').toLowerCase())
      ? String(o.imageProvider).toLowerCase() : 'openai',
    source: o.apiKey ? 'request' : 'none',
  };
}

export function llmStatusOf(cfg = normalizeCfg()) {
  let host = '';
  try { host = new URL(cfg.baseUrl).host; } catch { host = cfg.baseUrl; }
  return {
    configured: !!cfg.apiKey,
    protocol: cfg.protocol,
    model: cfg.model,
    host,
    baseUrl: host ? `https://${host}/…` : '',
    keySet: !!cfg.apiKey,
    source: cfg.source,
    timeoutMs: cfg.timeoutMs,
  };
}

/**
 * baseUrl 是否已经带版本段。
 * 支持的形态：`https://host/v1`、`https://host/api/v3`、`https://host/v4`、
 * `https://host/api/v2beta`（Stability）等 —— 带了就只追加资源路径，不再插 `/v1`。
 */
export function isVersionedBase(u) {
  return /\/(?:api\/)?v\d+(?:\.\d+)?(?:beta|alpha)?$/i.test(String(u || '').replace(/\/+$/, ''));
}

/**
 * 把用户填的 baseUrl 归一化成「API 根」。
 * 常见手误：把完整端点粘进来（…/v1/chat/completions、…/api/v3/images/generations），
 * 这时聊天和生图会各自拼出错误路径。这里统一截到版本段为止。
 */
export function baseRoot(u) {
  const clean = String(u || '').trim().replace(/\/+$/, '');
  const m = clean.match(/^(.*?\/(?:api\/)?v\d+(?:\.\d+)?(?:beta|alpha)?)(?:\/|$)/i);
  return m ? m[1] : clean;
}

/**
 * 把「接口报错」翻译成「下一步该干什么」。
 * 抽成纯函数是为了能被单测覆盖 —— 这类文案比代码更容易写错。
 *
 * 真实踩过的 404 有三种完全不同的原因，必须分开说：
 *   1. 模型没开通 / 账号没权限（火山方舟最常见）
 *   2. 模型栏填的是产品名而不是模型 ID
 *   3. baseUrl 拼错（版本段不对、把完整端点粘进来）
 */
export function chatErrorHint(status, msg = '', endpoint = '', model = '') {
  const m = String(msg || '');
  // 只有「提到了模型」才归到模型问题：裸的 "Not Found" 通常是路径错
  const modelish = /model|endpoint|无权限|不存在/i.test(m) || /not exist/i.test(m);
  const ark = /volces\.com/i.test(String(endpoint || ''));
  const where = `实际请求：${endpoint || '?'} · model=${model || '?'}`;
  if (status === 401 || status === 403) {
    return `Key 无效或无权限：检查 Key 是否完整；火山方舟还要确认该模型在「开通管理」里已开通（${where}）`;
  }
  if (status === 404) {
    if (modelish) {
      if (ark) {
        return '这不是路径问题，是账号里没有这个模型。三步排查：'
          + '① 方舟控制台 →「开通管理」把要用的模型开通（开通免费，按量计费）；'
          + '② 到「模型广场」复制模型 ID（doubao-seed-… 带日期后缀），或创建推理接入点用 ep-… 开头的 ID；'
          + '③ 模型栏不要填「豆包」这类产品名。'
          + `（${where}）`;
      }
      return `404 且提示模型不存在：确认「模型」填的是真实 model id，不是产品名。（${where}）`;
    }
    return `baseUrl 路径不对：OpenAI 兼容端填到 https://host/v1 或 https://host；火山方舟填到 .../api/v3。（${where}）`;
  }
  if (status === 429) return '额度或频率受限：稍后再试，或换一个服务商/Key';
  return undefined;
}

export function resolveEndpoint(cfg) {
  const raw = cfg.baseUrl.replace(/\/+$/, '');
  if (cfg.protocol === 'anthropic') {
    if (/\/messages$/.test(raw)) return raw;
    const u = baseRoot(raw);
    return isVersionedBase(u) ? `${u}/messages` : `${u}/v1/messages`;
  }
  if (/\/chat\/completions$/.test(raw)) return raw;
  // 已经带版本段（/v1、/api/v3、/v2beta…）就直接接路径，
  // 否则会把火山方舟这种 https://host/api/v3 拼成 /api/v3/v1/chat/completions
  const u = baseRoot(raw);
  if (isVersionedBase(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

/* ------------------------------------------------------------------ *
 * 单次调用
 * ------------------------------------------------------------------ */
export async function chat(cfg, { system, user, maxTokens, json = true, temperature }) {
  if (!cfg.apiKey) {
    const e = new Error('未配置模型 API Key');
    e.code = 'NO_LLM_KEY';
    e.hint = '在网页「AI 导演」里填 baseUrl / apiKey / model';
    throw e;
  }
  const endpoint = resolveEndpoint(cfg);
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);

  let body;
  const headers = { 'content-type': 'application/json' };
  if (cfg.protocol === 'anthropic') {
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    // 浏览器直连 Claude 必须显式声明（Anthropic 的 CORS 开关）
    if (IS_BROWSER) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {
      model: cfg.model,
      max_tokens: maxTokens || cfg.maxTokens,
      temperature: temperature ?? cfg.temperature,
      system,
      messages: [{ role: 'user', content: user }],
    };
  } else {
    headers.authorization = `Bearer ${cfg.apiKey}`;
    body = {
      model: cfg.model,
      temperature: temperature ?? cfg.temperature,
      max_tokens: maxTokens || cfg.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (json) body.response_format = { type: 'json_object' };
  }

  try {
    let res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    // 部分兼容端点不支持 response_format → 去掉重试一次
    if (!res.ok && res.status >= 400 && res.status < 500 && body.response_format) {
      delete body.response_format;
      res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 300);
      const e = new Error(`模型接口返回 ${res.status}：${REDACT(msg, cfg.apiKey)}`);
      e.code = 'LLM_HTTP_' + res.status;
      e.hint = chatErrorHint(res.status, msg, endpoint, cfg.model);
      e.endpoint = endpoint;
      e.model = cfg.model;
      throw e;
    }

    const content = cfg.protocol === 'anthropic'
      ? (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
      : (data?.choices?.[0]?.message?.content || '');
    const usage = data?.usage || null;
    return { content, usage, latencyMs: Date.now() - t0, endpoint, raw: data };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`模型接口超时（${cfg.timeoutMs}ms）`);
      e.code = 'LLM_TIMEOUT';
      throw e;
    }
    // 浏览器里最常见的失败：CORS / 网络（fetch 抛 TypeError: Failed to fetch）
    if (IS_BROWSER && err.name === 'TypeError') {
      const e = new Error('浏览器无法直连该接口（多半是 CORS 或网络）');
      e.code = 'LLM_CORS';
      e.hint = '确认 baseUrl 支持浏览器直连（DeepSeek / OpenAI / SiliconFlow 可以；部分企业网关不行）。也可以改用本地版或自建中转。';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * JSON 解析（容忍 ```json 围栏 / 前后废话 / 尾逗号）
 * ------------------------------------------------------------------ */
export function extractJSON(text) {
  if (!text) throw new Error('模型返回为空');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('模型返回里没有 JSON 对象');
  let json = s.slice(a, b + 1);
  try { return JSON.parse(json); } catch (e1) {
    const repaired = json.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ');
    try { return JSON.parse(repaired); } catch {
      throw new Error('模型返回的 JSON 解析失败：' + e1.message + ' 片段=' + json.slice(0, 160));
    }
  }
}

/** 连通性测试：极短请求 */
export async function testLlmWith(cfg) {
  const c = cfg || normalizeCfg();
  const r = await chat(c, {
    system: '你是连通性测试助手，只回复两个字符：OK',
    user: 'ping',
    maxTokens: 16,
    json: false,
    temperature: 0,
  });
  return { ok: true, latencyMs: r.latencyMs, model: c.model, protocol: c.protocol, reply: String(r.content || '').slice(0, 40).trim() };
}

/* ------------------------------------------------------------------ *
 * AI 提示词优化：分镜 → 高密度英文生图提示词
 * ------------------------------------------------------------------ */
const SYSTEM_PROMPT_ENGINEER = `你是漫画分格的「文生图提示词工程师」。你只做一件事：把每格的中文画面描述，压成一条高密度、可直接喂给文生图模型的英文提示词。

硬性规则：
- 英文；逗号分隔的名词短语/形容词；不要完整句子，不要解释，不要序号。
- 每格 ≤ 55 个英文词。
- 开头必须原样保留我给的 shapePrefix（形状开头词，8–14 个词），不要改写、不要翻译。
- 角色外观整页逐字一致：用我给的「角色设定」原文，只改动作/表情/景别；没给就沿用剧情里的描述。
- 每格必须交代清楚：构图、主体、动作、环境、光。
- 禁止出现：文字、对白气泡、水印、签名、画面边框、拼图感。

格子形状（硬编码已知，请主动利用，但**不要限制画面尺寸**）：
- 每格都会给出 aspect（画幅比）与形状（横长条 / 竖长格 / 三角格 / 斜切格 / 小方格…）。
- 写提示词时只把"叙事中心"往这个形状的**可展示中心**靠：主体放在画面中央安全区，
  **上下左右都要留足裁剪冗余**（宁可环境多一点，不要卡边构图）。
- 不要写死画布尺寸、不要写 "cropped tightly"、不要为了塞进异形格而牺牲画面完整性。
- 目的是让构图在裁切后仍然成立，而不是让模型按框尺寸作画。
- 不要把台词写进画面提示词（台词由作者后期排字）。

只输出 JSON：
{
  "globalNotes": "整页一致性提醒，40 个汉字以内",
  "panels": [{ "slotId": "p1", "prompt": "英文提示词", "negative": "该格建议的负面词" }]
}`;

export async function optimizePrompts({ plot, plan, cfg, characterSheet, note }) {
  const brief = {
    剧情: String(plot || '').slice(0, 2000),
    角色设定: characterSheet ? String(characterSheet).slice(0, 500) : '（未提供，沿用剧情描述）',
    画风包: { 名称: plan.style.zh, prompt: plan.style.prompt, negative: plan.style.negative, 提示: plan.style.tip },
    补充要求: note ? String(note).slice(0, 400) : undefined,
    格: plan.panels.map((p) => ({
      slotId: p.id,
      order: p.order,
      形状: p.shape?.zh || '常规格',
      画幅比说明: p.aspectLabel || '',
      安全区要求: '主体居中，四周留裁剪余量',
      shapePrefix: p.shape?.prefixEn || '',
      景别: p.roleZh,
      节拍: p.beat || '通用镜头',
      画面: p.content || p.beatHint || '',
      台词: p.dialogue || '',
      画幅比: p.aspectLabel,
      建议出图: p.genSize,
    })),
  };

  const r = await chat(cfg, {
    system: SYSTEM_PROMPT_ENGINEER,
    user: JSON.stringify(brief, null, 1),
    maxTokens: cfg.maxTokens,
  });

  const json = extractJSON(r.content);
  const valid = new Set(plan.panels.map((p) => p.id));
  const prompts = {};
  const dropped = [];
  for (const it of Array.isArray(json.panels) ? json.panels : []) {
    const sid = String(it.slotId || it.id || '');
    if (!valid.has(sid)) { dropped.push(sid); continue; }
    const prompt = String(it.prompt || '').trim();
    if (!prompt) continue;
    prompts[sid] = { prompt: prompt.slice(0, 900), negative: String(it.negative || '').slice(0, 400) };
  }

  return {
    ok: true,
    prompts,
    globalNotes: String(json.globalNotes || '').slice(0, 300),
    quality: { dropped, missing: [...valid].filter((id) => !prompts[id]) },
    llm: {
      model: cfg.model, protocol: cfg.protocol, latencyMs: r.latencyMs, usage: r.usage,
      endpointHost: (() => { try { return new URL(r.endpoint).host; } catch { return cfg.baseUrl; } })(),
    },
  };
}

/* ------------------------------------------------------------------ *
 * AI 生图（走用户自己的生图模型，OpenAI 兼容 /images/generations）
 * ---------------------------------------------------------------- */
/**
 * OpenAI 各生图模型认的尺寸枚举不一样：拿 dall-e-3 的 1792x1024 去喂 gpt-image-1
 * 会直接 400 invalid_value。所以按模型名挑枚举，再在里面选最接近的一档。
 */
const OPENAI_SIZE_ENUMS = [
  [/gpt-image/i, ['1024x1024', '1536x1024', '1024x1536']],
  [/dall-e-3/i, ['1024x1024', '1792x1024', '1024x1792']],
  [/dall-e-2/i, ['1024x1024', '512x512', '256x256']],
];

/** 在候选枚举里取比例最接近的一档（用对数比例算，横竖两个方向对称） */
function nearestSize(table, ratio) {
  let best = table[0], diff = Infinity;
  for (const t of table) {
    const [a, b] = t.split('x').map(Number);
    const d = Math.abs(Math.log(a / b) - Math.log(ratio));
    if (d < diff) { diff = d; best = t; }
  }
  return best;
}

/** 跟我们建议尺寸最接近、且这家服务商真的接受的尺寸 */
export function fitImageSize(provider, size, model = '') {
  const m = String(size || '').match(/(\d+)\s*[x×*]\s*(\d+)/i);
  const w = m ? Number(m[1]) : 1024, h = m ? Number(m[2]) : 1024;
  const r = w / Math.max(1, h);
  if (provider === 'volcengine') {
    // 火山方舟 Seedream：size 用 "WxH"，以官方支持档位为准。
    // 4.0 还接受 "1K"/"2K"/"4K" 这种预设，但这里统一给具体像素更好控比例。
    // （1792x1024 这类 OpenAI 尺寸方舟不接受，所以不能复用 openai 的表）
    const table = [
      '1024x1024', '864x1152', '1152x864', '1280x720', '720x1280',
      '832x1248', '1248x832', '1512x648', '2048x2048', '2304x1728',
    ];
    return nearestSize(table, r);
  }
  if (provider === 'stability') {
    // Stability 用比例：1:1 3:2 2:3 4:5 5:4 9:16 16:9 21:9
    const table = [[1, '1:1'], [1.5, '3:2'], [0.667, '2:3'], [0.8, '4:5'], [1.25, '5:4'], [0.5625, '9:16'], [1.778, '16:9'], [2.333, '21:9']];
    let best = table[0], diff = Infinity;
    for (const [v, k] of table) { const d = Math.abs(v - r); if (d < diff) { diff = d; best = [v, k]; } }
    return best[1];
  }
  if (provider === 'siliconflow') {
    // 硅基流动：image_size 支持 1024x1024 / 768x1024 / 1024x768 / 1280x720 等
    const table = ['1024x1024', '768x1024', '1024x768', '1280x720', '720x1280', '1152x864', '864x1152'];
    return nearestSize(table, r);
  }
  // OpenAI：先按模型名认枚举；认不出来就按 dall-e-3 那三档猜（多数兼容服务商照这个来）
  const hit = OPENAI_SIZE_ENUMS.find(([re]) => re.test(String(model || '')));
  if (hit) return nearestSize(hit[1], r);
  if (r > 1.25) return '1792x1024';
  if (r < 0.8) return '1024x1792';
  return '1024x1024';
}

const dataUrlToBlob = (href) => {
  const m = String(href || '').match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
};

const toB64 = (buf) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function resolveImageEndpoint(cfg) {
  // 生图自己的 Base URL 优先；没填就用对话那条（同一家时就是这么用的）
  const raw = String(cfg.imgBaseUrl || cfg.baseUrl || '').replace(/\/+$/, '');
  if (cfg.imageProvider === 'stability') {
    if (/\/stable-image\/generate/.test(raw)) return raw;
    const u = baseRoot(raw);
    if (/\/v2beta$/.test(u)) return `${u}/stable-image/generate/core`;
    return `${u}/v2beta/stable-image/generate/core`;
  }
  // 火山方舟（Seedream）：POST {base}/api/v3/images/generations
  // 它没有 OpenAI 的 /images/edits，图生图也是同一个端点（靠 body.image 传参考图）
  const host = (() => { try { return new URL(raw).host; } catch { return ''; } })();
  if (cfg.imageProvider === 'volcengine' || /(^|\.)volces\.com$/i.test(host)) {
    const root = baseRoot(raw);
    return /\/images\/generations$/.test(root) ? root : `${root}/images/generations`;
  }
  if (/\/images\/generations$/.test(raw)) return raw;
  // 火山方舟这类是 /api/v3/images/generations；只认 /v1 会拼成 /api/v3/v1/...
  const u = baseRoot(raw);
  if (isVersionedBase(u)) return `${u}/images/generations`;
  return `${u}/v1/images/generations`;
}

/**
 * 生图报错：把「状态码 + 端点 + 模型 + 响应体片段 + request id」全部带上。
 *
 * 为什么需要：方舟返回 404 时**响应体可能是空的**，只留一句「方舟生图返回 404：」
 * 等于没说 —— 这正是用户遇到的「报错信息不全」。
 */
export function imageHttpError({ status, bodyText, json, endpoint, model, key, provider = '' }) {
  const jmsg = json?.error?.message || json?.message || '';
  const snippet = String(jmsg || bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const bodyPart = snippet || '（响应体为空，服务端没给原因）';
  const e = new Error(
    `生图接口返回 ${status}：${REDACT(bodyPart, key)}\n`
    + `POST ${endpoint}\n`
    + `model=${model || '?'} · provider=${provider || '?'}`,
  );
  e.code = 'IMAGE_HTTP_' + status;
  e.status = status;
  e.endpoint = endpoint;
  e.model = model;
  e.bodySnippet = bodyPart;
  const rid = json?.error?.request_id || json?.request_id || '';
  if (rid) e.requestId = rid;
  const m = String(snippet || '');
  const modelish = /model|endpoint|not exist|not found|无权限|不存在/i.test(m);
  const ark = /volces\.com/i.test(String(endpoint || ''));
  if (status === 404) {
    e.hint = (modelish || !snippet)
      ? (ark
        ? '账号里没有这个生图模型：方舟控制台 →「开通管理」开通 Seedream；模型 ID 从「模型广场」复制'
          + '（如 doubao-seedream-5-0-pro-260628）；确认 Key 与接入点在同一个 region（cn-beijing）'
        : '确认生图模型 ID 与服务商匹配，且该模型已开通/有权限')
      : '生图端点不对：Base URL 要填到版本段（OpenAI 兼容 …/v1，火山方舟 …/api/v3）';
  } else if (status === 401 || status === 403) {
    e.hint = 'Key 无生图权限：换成有该模型权限的 Key，或在方舟「开通管理」里开通这个模型';
  } else if (status === 429) {
    e.hint = '额度/频率（IPM）受限：降低频率或换 Key';
  } else if (status === 400) {
    e.hint = /size|resolution|dimension/i.test(m)
      ? '这个模型不接受当前尺寸：换 seedream 4.0/5.0，或把尺寸改成 1024x1024'
      : '参数不被接受：检查模型名与提示词长度（Seedream 建议中文 ≤300 字）';
  }
  return e;
}

/** 方舟默认地址：只有「显式选了方舟但没给生图 Base URL」时才会用到 */
export const ARK_DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * 决定这次生图到底打到哪。
 * 顺带兜住一类配置错：选了火山方舟、模型也是 doubao/seedream，但生图 Base URL 空着，
 * 于是回落到对话那条（可能是 DeepSeek）→ 一定 404。这里直接纠正并标记 corrected。
 */
export function planImageRequest(cfg, model = '') {
  const c = cfg || {};
  const provider = c.imageProvider || 'openai';
  const host = (() => { try { return new URL(String(c.imgBaseUrl || c.baseUrl || '')).host; } catch { return ''; } })();
  const looksArk = /(^|[\/-])(doubao|seedream|seedance)/i.test(String(model || '')) || provider === 'volcengine';
  const hostIsArk = /(^|\.)volces\.com$/i.test(host);
  let base = c.imgBaseUrl || c.baseUrl || '';
  let corrected = false;
  if (looksArk && !hostIsArk) {
    base = ARK_DEFAULT_BASE;
    corrected = true;
  }
  const endpoint = resolveImageEndpoint({ ...c, imgBaseUrl: base });
  return { endpoint, provider, baseUsed: base, corrected, looksArk, host };
}

/**
 * 这次请求到底走哪条路（把「参考图 / 无参考图」的分支集中到一处，便于测试）。
 *
 * 返回 mode：
 *   generations      纯文生图
 *   ark-image        方舟：同一个端点，参考图放 body.image
 *   openai-edits     OpenAI：参考图走 /images/edits（multipart image[]）
 *   siliconflow-image 硅基：body.image
 *   stability-init   Stability：multipart init_image + strength
 *
 * refsIgnored > 0 表示「该模型不吃参考图」，我们主动忽略并告知，而不是发出去等 404。
 */
export function imageRoute(cfg, model = '', refCount = 0) {
  const plan = planImageRequest(cfg, model);
  // 关键：端点被纠正成方舟时，provider 也要跟着变，
  // 否则会出现「端点=方舟 / 分支=OpenAI」→ 去请求 方舟的 /images/edits（不存在）
  const provider = plan.corrected ? 'volcengine' : (cfg?.imageProvider || 'openai');
  let mode = 'generations';
  let endpoint = plan.endpoint;
  let refsIgnored = 0;
  if (refCount > 0) {
    if (provider === 'volcengine') mode = 'ark-image';
    else if (provider === 'stability') mode = 'stability-init';
    else if (provider === 'siliconflow') mode = 'siliconflow-image';
    else if (provider === 'openai') {
      // dall-e-2/3 没有图生图能力；只有 gpt-image-* 支持 /images/edits
      const supportsEdits = /gpt-image/i.test(String(model || ''));
      if (supportsEdits) {
        mode = 'openai-edits';
        endpoint = endpoint.replace(/\/images\/generations$/, '/images/edits');
      } else {
        refsIgnored = refCount;
      }
    }
  }
  return { ...plan, provider, endpoint, mode, refsIgnored, refsUsed: refCount - refsIgnored };
}

export async function generateImage({ cfg, prompt, size, model, n = 1, refs = [] }) {
  const c = cfg || normalizeCfg();
  // 生图优先用自己的 Key；没有就用对话那把（主流服务商是同一把）
  const imgKey = c.imgKey || c.apiKey;
  if (!imgKey) {
    const e = new Error('未配置生图 Key');
    e.code = 'NO_LLM_KEY';
    e.hint = '在「AI 导演」里填 Base URL / Key，再填一个生图模型（如 gpt-image-1、dall-e-3、Kwai-Kolors/Kolors）';
    throw e;
  }
  const route = imageRoute(c, model, refs.length);
  const endpoint = route.endpoint;
  const provider = route.provider;
  const plan = route;
  if (route.corrected) {
    // 别静默改地址：留一条日志，出问题能解释清楚
    try {
      console.warn(
        `[image] 生图 Base URL 指向 ${route.host || '(空)'}，但模型/provider 是火山方舟 → 已改用 ${ARK_DEFAULT_BASE}`,
      );
    } catch { /* ignore */ }
  }
  if (route.refsIgnored) {
    try { console.warn(`[image] ${model || '当前模型'} 不支持参考图，已忽略 ${route.refsIgnored} 张`); } catch { /* ignore */ }
  }
  const fitted = fitImageSize(provider, size, model);
  // Seedream 建议中文提示词 ≤300 字 / 英文 ≤600 词；超长不一定报错，但会更慢更贵
  const promptText = String(prompt || '').slice(0, provider === 'volcengine' ? 1200 : 3800);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(c.timeoutMs, 120000));
  try {
    let r;
    if (provider === 'volcengine') {
      // 火山方舟 Seedream：一个端点同时管文生图和图生图（参考图走 body.image）
      const body = {
        model: model || 'doubao-seedream-5-0-pro-260628',
        prompt: promptText,
        response_format: 'b64_json',
        size: fitted,
        watermark: false,   // 方舟默认 true，会盖「AI生成」水印；画分镜必须关掉
      };
      if (refs.length) body.image = refs.length === 1 ? refs[0] : refs.slice(0, 4);
      r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${imgKey}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const vtext = await r.text();
      let vdata = null;
      try { vdata = JSON.parse(vtext); } catch { vdata = null; }
      if (!r.ok) {
        // 统一走 imageHttpError：状态码 + 端点 + 模型 + 响应体 + request id 全带上，
        // 而且**空响应体**也会明确写出来（这就是「报错信息不全」的根因）
        throw imageHttpError({ status: r.status, bodyText: vtext, json: vdata, endpoint, model: body.model, key: imgKey, provider });
      }
      const vitem = vdata?.data?.[0] || {};
      const vb64 = vitem.b64_json || null;
      const vurl = vitem.url || null;
      if (!vb64 && !vurl) throw Object.assign(new Error('方舟返回里没有图片'), { code: 'IMAGE_EMPTY' });
      return {
        ok: true,
        b64: vb64,
        url: vurl,
        provider: 'volcengine',
        size: fitted,
        model: body.model,
        refsUsed: route.refsUsed,
        refsIgnored: route.refsIgnored,
        endpointHost: (() => { try { return new URL(endpoint).host; } catch { return c.baseUrl; } })(),
      };
    }
    if (provider === 'stability') {
      // Stability：multipart/form-data，返回原始图片字节。
      // 注意：带 init_image 时**不要再发 aspect_ratio** —— 比例由参考图决定，
      // 两个一起发会被拒（这是「有参考图」和「无参考图」路径的第一个差别）。
      const fd = new FormData();
      fd.append('prompt', promptText);
      fd.append('output_format', 'png');
      const refBlob = refs.length ? dataUrlToBlob(refs[0]) : null;
      if (refBlob) {
        fd.append('init_image', refBlob, 'ref.png');
        fd.append('strength', '0.55');
      } else {
        fd.append('aspect_ratio', fitted);
      }
      if (model) fd.append('model', model);
      r = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${imgKey}`, accept: 'image/*' },
        body: fd,
        signal: ac.signal,
      });
      if (!r.ok) {
        const t = await r.text();
        const e = new Error(`生图接口返回 ${r.status}：${REDACT(t.slice(0, 200), c.apiKey)}`);
        e.code = 'IMAGE_HTTP_' + r.status;
        e.hint = r.status === 404 ? 'Stability 路径应为 {base}/v2beta/stable-image/generate/core'
          : r.status === 401 ? 'Key 无权限' : r.status === 403 ? '可能是内容审核拦截' : undefined;
        throw e;
      }
      const buf = await r.arrayBuffer();
      return {
        ok: true,
        b64: toB64(buf),
        url: null,
        provider,
        size: fitted,
        model: model || 'sd3',
        endpointHost: (() => { try { return new URL(endpoint).host; } catch { return c.baseUrl; } })(),
      };
    }

    // OpenAI：只有 gpt-image-* 支持参考图（走 /images/edits）。
    // dall-e-2/3 不吃图，route.refsIgnored 已在上面记过，这里自然跳过。
    if (route.mode === 'openai-edits') {
      const fd = new FormData();
      fd.append('model', model || 'gpt-image-1');
      fd.append('prompt', promptText);
      fd.append('n', String(n));
      fd.append('size', fitted);
      refs.slice(0, 4).forEach((href, i) => {
        const blob = dataUrlToBlob(href);
        if (blob) fd.append('image[]', blob, 'ref' + i + '.png');
      });
      const editsUrl = endpoint;
      const er = await fetch(editsUrl, { method: 'POST', headers: { authorization: `Bearer ${imgKey}` }, body: fd, signal: ac.signal });
      const etext = await er.text();
      let edata = null;
      try { edata = JSON.parse(etext); } catch { edata = null; }
      if (!er.ok) {
        const e = new Error(`参考图生图返回 ${er.status}：${REDACT((edata?.error?.message || etext).slice(0, 200), imgKey)}`);
        e.code = 'IMAGE_EDIT_' + er.status;
        e.hint = er.status === 404 ? '这个端点可能不支持 /images/edits；把服务商切到硅基流动或去掉参考图' : undefined;
        throw e;
      }
      const it = edata?.data?.[0] || {};
      return {
        ok: true,
        b64: it.b64_json || it.b64 || null,
        url: it.url || null,
        provider: 'openai-edits',
        size: fitted,
        model: model || 'gpt-image-1',
        refsUsed: route.refsUsed,
        refsIgnored: route.refsIgnored,
        endpointHost: (() => { try { return new URL(editsUrl).host; } catch { return c.baseUrl; } })(),
      };
    }

    const body = { model: model || '', prompt: promptText, n };
    if (provider === 'siliconflow') {
      body.image_size = fitted;
      if (!body.model) body.model = 'Kwai-Kolors/Kolors';
      if (refs.length) body.image = refs[0];
    } else {
      body.size = fitted;
      body.response_format = 'b64_json';
    }
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${imgKey}` };
    r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 240);
      const e = new Error(`生图接口返回 ${r.status}：${REDACT(msg, imgKey)}`);
      e.code = 'IMAGE_HTTP_' + r.status;
      e.hint = r.status === 404 ? '这个 Base URL 可能没有 /images/generations；换一个生图服务商或填全路径'
        : r.status === 401 || r.status === 403 ? 'Key 无生图权限'
          : r.status === 400 && /size|resolution|dimension/i.test(String(msg))
            ? `这个模型不接受 ${fitted} 这个尺寸：换一个模型，或在生图服务商里选「硅基流动」这类按比例出图的`
            : r.status === 400 ? '模型名可能不对（有的服务商叫 Kwai-Kolors/Kolors、dall-e-3…）' : undefined;
      throw e;
    }
    const item = data?.data?.[0] || data?.images?.[0] || {};
    const b64 = item.b64_json || item.b64 || item.image_base64;
    const url = item.url || item.image_url;
    if (!b64 && !url) {
      const e = new Error('生图接口没有返回图片（既没有 b64_json 也没有 url）');
      e.code = 'IMAGE_EMPTY';
      throw e;
    }
    return {
      ok: true,
      b64: b64 || null,
      url: url || null,
      revisedPrompt: item.revised_prompt || '',
      provider,
      size: fitted,
      model: body.model,
      refsUsed: route.refsUsed,
      refsIgnored: route.refsIgnored,
      endpointHost: (() => { try { return new URL(endpoint).host; } catch { return c.baseUrl; } })(),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('生图超时（90s+）');
      e.code = 'IMAGE_TIMEOUT';
      throw e;
    }
    if (IS_BROWSER && err.name === 'TypeError') {
      const e = new Error('浏览器无法直连生图接口（CORS / 网络）');
      e.code = 'LLM_CORS';
      e.hint = '生图接口多半不放行浏览器直连：可以用本地版（node server.mjs）走服务端中转，或自建中转';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * AI 导演：在合法候选里选版式 + 逐格排戏
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * AI 切原文：版式已定，让模型把源文本切成 N 格（逐格内容 + 台词 + 提示词）
 * 和 aiDecide 的区别：aiDecide 要**挑**版式；这里版式是用户选的，模型只做切分。
 * 用途：长剧本/小说没法靠关键词切；也让作者能钉死自己想要的版式。
 * ------------------------------------------------------------------ */
const SYSTEM_SPLITTER = `你是资深漫画分镜导演，负责把一段源文本「切成格子」，版式已经由作者定死。

工作方式：下面给你一套已经确定的分镜模板（含每格 slotId / 阅读顺序 / 景别），以及一段源文本。
你要做的是**切分**：决定源文本的哪一句话落在哪一格，并给出那一格的画面与台词。

硬性规则（违反即视为无效输出）：
- 必须为每一个 slotId 都写一条 panels 记录，不多不少；不许发明新 slotId。
- 切分要**覆盖整段源文本**：按 order 排队，前面的格子放前面的内容，不要跳过中间的句子，
  也不要把同一句话拆到两格里重复使用。
- 源文本信息超过格数时：合并次要描述，保留冲突、转折、情绪峰值；不要平均分配。
- 源文本信息不足时：用环境/反应/空镜补齐节奏（留白、远景、道具特写都好），但不要编造新人物或新事件。
- content 必须具体：谁、在哪、什么动作、什么表情、光从哪来。禁止「气氛紧张」这类空话。
- dialogue 是这一格要说的话（中文，台词/旁白/内心独白），没有就填空字符串；不要把台词塞进 content。
- prompt 是给文生图模型的**英文**提示词：名词短语+形容词，逗号分隔，≤55 词，
  开头原样保留给的 shapePrefix，不出现文字/气泡/边框/水印。
- 如果给了「角色设定」，人物外观必须逐格一致。
- 只输出 JSON，不要解释文字。

输出 JSON：
{
  "globalNotes": "整段的一致性提醒，40 字内",
  "panels": [{ "slotId": "p1", "beat": "2-6字节拍名", "content": "画面内容（中文）", "dialogue": "台词或空串", "prompt": "英文提示词" }]
}`;

export async function aiSplitPanels({ plot, plan, cfg, characterSheet, note }) {
  const brief = {
    源文本: String(plot || '').slice(0, 6000),
    角色设定: characterSheet ? String(characterSheet).slice(0, 500) : '（未提供，沿用源文本描述）',
    画风: plan?.style?.zh || null,
    阅读顺序: plan?.template?.reading || null,
    格数: plan?.panels?.length || 0,
    格: (plan?.panels || []).map((p) => ({
      slotId: p.id,
      order: p.order,
      景别: p.roleZh,
      形状: p.shape?.zh || '常规格',
      画幅比: p.aspectLabel || '',
      shapePrefix: p.shape?.prefixEn || '',
      建议出图: p.genSize,
    })),
    补充要求: note ? String(note).slice(0, 400) : undefined,
  };

  const r = await chat(cfg, {
    system: SYSTEM_SPLITTER,
    user: JSON.stringify(brief, null, 1),
    maxTokens: Math.max(cfg.maxTokens || 0, 2400),
  });

  const json = extractJSON(r.content);
  const valid = new Set((plan?.panels || []).map((p) => p.id));
  const panels = {};
  const dropped = [];
  for (const it of Array.isArray(json.panels) ? json.panels : []) {
    const sid = String(it.slotId || it.id || '');
    if (!valid.has(sid)) { dropped.push(sid); continue; }
    panels[sid] = {
      beat: String(it.beat || '').slice(0, 12),
      content: String(it.content || '').slice(0, 240),
      dialogue: String(it.dialogue || '').slice(0, 200),
      prompt: String(it.prompt || '').trim().slice(0, 800),
    };
  }
  const missing = [...valid].filter((s) => !panels[s]);

  return {
    ok: true,
    panels,
    globalNotes: String(json.globalNotes || '').slice(0, 240),
    quality: { dropped, missing },
    llm: {
      model: cfg.model, protocol: cfg.protocol,
      latencyMs: r.latencyMs, usage: r.usage,
      endpointHost: (() => { try { return new URL(r.endpoint).host; } catch { return cfg.baseUrl; } })(),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 台词 / 旁白：让模型按「这一格要表达什么」来写（或从候选里挑）
 *
 * 与 aiSplitPanels 的区别：切分是「决定谁放哪一格」，这里是「这一格该说什么」。
 * 所以输入只需要 beat/content/shot/intent，甚至可以不传剧情全文。
 * ------------------------------------------------------------------ */
const SYSTEM_LINES = `你是资深漫画编剧兼台词指导，负责给**已经确定的每一格**写台词/旁白/内心独白。

你会收到：整段剧情（可能为空）、角色设定（可能为空）、以及每一格的
slotId / 节拍(beat) / 该格内容(content) / 景别(shot) / 构图意图(intent) / 现在已有的句子(currentLine)。

硬性规则（违反即视为无效输出）：
- 必须为每个 slotId 输出一条 lines 记录，不多不少，不许发明新 slotId。
- text 要**短**：台词 ≤ 24 个汉字，旁白 ≤ 20 个汉字；宁可少写，不要塞满。
- 台词是人物说出口的话，要像人说的（口语、有性格），不要写成说明文。
- 旁白/内心独白要与画面互补：画面能看见的不要复述。
- 网格之间要有变化：连续几格不要都用同一种语气、不要每格都有台词；
  该沉默的格子给空字符串（text: ""），让画面自己说。
- kind 只能是这四个之一：台词 / 旁白 / 内心 / 空。
- 不要出现「他说」「她想」这类转述；直接用第一人称或旁白口吻。
- 不要用引号包裹 text（我们渲染时自己加）。

输出严格 JSON（不要 markdown 代码块）：
{"lines":[{"slotId":"p1","text":"……","kind":"台词","why":"为什么这句合适，≤20字"}]}`;

/** 把模型返回的台词结果归一化：只保留合法 slotId、按 kind 白名单、限长 */
export function normalizeLineItems(json, validIds, { maxChars = 40 } = {}) {
  const ids = new Set(validIds || []);
  const KINDS = ['台词', '旁白', '内心', '独白', '拟声', '空'];
  const out = {};
  let dropped = 0;
  for (const it of Array.isArray(json?.lines) ? json.lines : []) {
    const sid = String(it?.slotId || it?.id || '');
    if (!ids.has(sid)) { dropped++; continue; }
    let text = String(it?.text ?? it?.line ?? '').trim();
    // 去掉模型可能自带的引号与「他说：」前缀
    text = text.replace(/^["“「『]|["”」』]$/g, '').replace(/^(他说|她说|他说：|她说：)[:：]?/, '').trim();
    if (text.length > maxChars) text = text.slice(0, maxChars);
    let kind = String(it?.kind || '').trim();
    if (!KINDS.includes(kind)) kind = text ? '台词' : '空';
    if (!text) kind = '空';
    out[sid] = { text, kind, why: String(it?.why || '').trim().slice(0, 60) };
  }
  return {
    lines: out,
    dropped,
    missing: [...ids].filter((id) => !out[id]),
  };
}

/**
 * @param {{plot?:string, plan:object, cfg:object, characterSheet?:string, ids?:string[], avoid?:object, style?:string}} o
 *   ids    只写这些格子（单格模式）；不传=整页
 *   avoid  已写过的句子，告诉模型别再重复（「换一句」用）
 */
export async function aiWriteLines({ plot, plan, cfg, characterSheet, ids, avoid, style }) {
  const c = cfg || normalizeCfg();
  const panels = (plan?.panels || []).map((p) => ({
    slotId: p.id,
    beat: p.beat || '',
    content: String(p.content || '').slice(0, 220),
    shot: p.shotZh || p.shot || '',
    intent: p.intentZh || p.intent || '',
    currentLine: String(p.line || '').slice(0, 80),
  }));
  const want = Array.isArray(ids) && ids.length ? ids : panels.map((p) => p.slotId);
  const targets = panels.filter((p) => want.includes(p.slotId));

  const brief = {
    风格: style || '日式页漫',
    剧情背景: String(plot || '').slice(0, 1600) || '（未提供，仅依据每格内容写）',
    角色设定: characterSheet ? String(characterSheet).slice(0, 500) : '（未提供）',
    要写的格子: targets,
    已经用过的句子_不要再重复: avoid && Object.keys(avoid).length
      ? Object.fromEntries(Object.entries(avoid).slice(0, 40))
      : undefined,
  };

  const r = await chat(c, {
    system: SYSTEM_LINES,
    user: JSON.stringify(brief, null, 1),
    maxTokens: Math.min(c.maxTokens, 2000),
  });
  const json = extractJSON(r.content);
  const res = normalizeLineItems(json, want);
  return {
    ok: true,
    ...res,
    llm: {
      model: c.model, protocol: c.protocol, latencyMs: r.latencyMs, usage: r.usage,
      endpointHost: (() => { try { return new URL(r.endpoint).host; } catch { return c.baseUrl; } })(),
    },
  };
}

const SYSTEM_DIRECTOR = `你是资深漫画分镜导演（komawari / 스토리보드），擅长把一段剧情拆成可落纸的格子安排。

工作方式：本地规则引擎已经从真实分镜模板库里筛出 8–12 个合法候选版式，附带了每格的格位 id、阅读顺序和角色（全景/特写/冲击大格…）。你只做两件事：
1. 从候选里挑出最接得住这段剧情的那一套；
2. 为它的每一格排出「画什么 + 说什么」。

硬性规则（违反即视为无效输出）：
- pick 必须是候选里的某个 id，绝对不许发明新 id 或新格位。
- 必须为候选的每一个 slotId 都写一条 panels 记录，不多不少。
- 日式（reading=rtl）从右上角开始读；条漫（vertical）只从上往下。按 order 排列你的叙事。
- 制造景别落差：不要连续三格都是中景；用一格大格压住情绪，用一格留白呼吸。
- content 必须具体：谁、在哪、什么动作、什么表情、光从哪来。不要写「气氛紧张」这种空话。
- 如果给了「角色设定」，content 里的人物外观必须与之一致，不要临时改发色/服装。
- dialogue 是这句台词/旁白本身（中文），没有就填空字符串。
- say 用一句话说清这一格在叙事里承担什么（例：『他其实已经认出对方』的沉默），给作者当下笔参考；不要复述 content。
- 只输出 JSON，不要任何解释文字。

输出 JSON：
{
  "pick": "模板id",
  "confidence": 0.0-1.0,
  "reason": "60 字内说明这套版式为什么接得住这段剧情（讲节奏与景别，不要夸）",
  "alternatives": [{"id": "另一个候选id", "reason": "30 字内"}],
  "panels": [{"slotId": "该模板的slot id", "beat": "2-6字节拍名", "content": "画面内容", "dialogue": "台词或空串", "say": "这一格应该是什么，一句中文，用『』标出重点"}]
}`;

export async function aiDecide({ plot, analysis, candidates, cfg, culture, ratio, extraNote, characterSheet }) {
  const brief = {
    剧情: String(plot || '').slice(0, 3000),
    角色设定: characterSheet ? String(characterSheet).slice(0, 500) : '（未提供）',
    用户约束: {
      画风: culture && culture !== 'all' ? culture : (analysis?.cultureHint || '不限'),
      画幅: ratio && ratio !== 'auto' ? ratio : (analysis?.ratioHint || '不限'),
      期望格数: analysis?.panelTarget || null,
    },
    规则引擎分析: {
      主打戏路: analysis?.intents?.slice(0, 3).map((i) => `${i.zh}(${i.conf})`) || [],
      场景: analysis?.sceneZh || null,
      基调: analysis?.toneZh || null,
      节奏: analysis?.pace || null,
      硬约束: analysis?.directives?.map((d) => d.zh) || [],
    },
    候选模板: candidates.map((c) => ({
      id: c.id, name: c.name, culture: c.culture, reading: c.reading,
      ratio: c.ratio, panels: c.panels, density: c.density,
      tags: c.tags, intents: c.intents, desc: c.desc,
      slots: c.slots,
    })),
    补充说明: extraNote || undefined,
  };

  const r = await chat(cfg, {
    system: SYSTEM_DIRECTOR,
    user: JSON.stringify(brief, null, 1),
    maxTokens: cfg.maxTokens,
  });

  const json = extractJSON(r.content);
  const ids = new Set(candidates.map((c) => c.id));
  let pick = String(json.pick || '');
  let corrected = false;
  if (!ids.has(pick)) {
    // 模型编了个 id：按名字/最接近的兜底
    const byName = candidates.find((c) => c.name === json.pick || json.pick?.includes(c.id));
    pick = byName ? byName.id : candidates[0].id;
    corrected = true;
  }

  const tpl = candidates.find((c) => c.id === pick);
  const slotIds = new Set(tpl.slots.map((s) => s.id));
  const panels = {};
  const dropped = [];
  for (const p of Array.isArray(json.panels) ? json.panels : []) {
    const sid = String(p.slotId || p.id || '');
    if (!slotIds.has(sid)) { dropped.push(sid); continue; }
    panels[sid] = {
      beat: String(p.beat || '').slice(0, 12),
      content: String(p.content || '').slice(0, 220),
      dialogue: String(p.dialogue || '').slice(0, 200),
      say: String(p.say || '').slice(0, 140),
    };
  }
  const missing = [...slotIds].filter((s) => !panels[s]);

  return {
    ok: true,
    pick,
    confidence: Number(json.confidence) || null,
    reason: String(json.reason || '').slice(0, 400),
    alternatives: (Array.isArray(json.alternatives) ? json.alternatives : [])
      .filter((x) => ids.has(String(x?.id))).slice(0, 3)
      .map((x) => ({ id: x.id, reason: String(x.reason || '').slice(0, 200) })),
    panels,
    quality: { corrected, dropped, missing },
    llm: {
      model: cfg.model, protocol: cfg.protocol,
      latencyMs: r.latencyMs, usage: r.usage,
      endpointHost: (() => { try { return new URL(r.endpoint).host; } catch { return cfg.baseUrl; } })(),
    },
  };
}
