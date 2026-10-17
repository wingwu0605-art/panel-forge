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

export function resolveEndpoint(cfg) {
  const u = cfg.baseUrl.replace(/\/+$/, '');
  if (cfg.protocol === 'anthropic') {
    if (/\/messages$/.test(u)) return u;
    if (/\/v1$/.test(u)) return `${u}/messages`;
    return `${u}/v1/messages`;
  }
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/chat/completions`;
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
      e.hint = res.status === 401 || res.status === 403
        ? 'Key 无效或无权限；检查 apiKey 是否完整、baseUrl 是否匹配该服务商'
        : res.status === 404 ? 'baseUrl 路径不对：OpenAI 兼容端一般填到 https://host/v1 或 https://host'
          : res.status === 429 ? '额度/频率受限，稍后重试' : undefined;
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
export function resolveImageEndpoint(cfg) {
  const u = cfg.baseUrl.replace(/\/+$/, '');
  if (/\/images\/generations$/.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/images/generations`;
  return `${u}/v1/images/generations`;
}

export async function generateImage({ cfg, prompt, size, model, n = 1 }) {
  const c = cfg || normalizeCfg();
  if (!c.apiKey) {
    const e = new Error('未配置生图 Key');
    e.code = 'NO_LLM_KEY';
    e.hint = '在「AI 导演」里填 Base URL / Key，再填一个生图模型（如 gpt-image-1、dall-e-3、Kwai-Kolors/Kolors）';
    throw e;
  }
  const endpoint = resolveImageEndpoint(c);
  const body = { model: model || '', prompt: String(prompt || '').slice(0, 3800), n };
  if (size) body.size = size;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(c.timeoutMs, 90000));
  try {
    const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 240);
      const e = new Error(`生图接口返回 ${r.status}：${REDACT(msg, c.apiKey)}`);
      e.code = 'IMAGE_HTTP_' + r.status;
      e.hint = r.status === 404 ? '这个 Base URL 可能没有 /images/generations；换一个生图服务商或填全路径'
        : r.status === 401 || r.status === 403 ? 'Key 无生图权限'
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
      model: body.model,
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
