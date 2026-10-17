/**
 * llm.mjs — AI 导演层（可选，用你自己的模型 API）
 *
 * 原则：**模型不许发明格位**。本地规则引擎先筛出 8–12 个合法候选 +
 * 每格的格位/角色，模型只负责「选哪套 + 每格排什么戏」。这样即使模型跑偏，
 * 出来的分镜也一定是能落纸的真实版式。
 *
 * 支持两种协议（都只用 fetch，无依赖）：
 *   openai     POST {base}/v1/chat/completions        （OpenAI / DeepSeek / Moonshot / 通义 / Ollama / LM Studio …）
 *   anthropic  POST {base}/v1/messages                （Claude）
 *
 * 配置来源：请求体 llm 字段 > 环境变量 LLM_*
 */

const DEFAULT_BASE = { openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com' };
const REDACT = (s, key) => (key ? String(s).split(key).join('***') : String(s));

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */
export function readLlmConfig(overrides = {}) {
  const protocol = String(overrides.protocol || process.env.LLM_PROTOCOL || 'openai').toLowerCase() === 'anthropic'
    ? 'anthropic' : 'openai';
  const baseUrl = String(overrides.baseUrl || process.env.LLM_BASE_URL || DEFAULT_BASE[protocol]).trim();
  const apiKey = String(overrides.apiKey || process.env.LLM_API_KEY || '').trim();
  const model = String(overrides.model || process.env.LLM_MODEL || (protocol === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini')).trim();
  const timeoutMs = Math.max(5000, Math.min(180000, Number(overrides.timeoutMs || process.env.LLM_TIMEOUT_MS || 60000)));
  const temperature = Math.max(0, Math.min(1.5, Number(overrides.temperature ?? process.env.LLM_TEMPERATURE ?? 0.3)));
  const maxTokens = Math.max(256, Math.min(8000, Number(overrides.maxTokens || process.env.LLM_MAX_TOKENS || 3000)));
  return { protocol, baseUrl, apiKey, model, timeoutMs, temperature, maxTokens, source: overrides.apiKey ? 'request' : (process.env.LLM_API_KEY ? 'env' : 'none') };
}

export function llmStatus(cfg = readLlmConfig()) {
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
    envVars: ['LLM_PROTOCOL', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_TIMEOUT_MS'],
  };
}

function resolveEndpoint(cfg) {
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
    e.hint = '在网页「AI 导演」里填 baseUrl / apiKey / model，或设置环境变量 LLM_API_KEY';
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
export async function testLlm(cfg = readLlmConfig()) {
  const r = await chat(cfg, {
    system: '你是连通性测试助手，只回复两个字符：OK',
    user: 'ping',
    maxTokens: 16,
    json: false,
    temperature: 0,
  });
  return { ok: true, latencyMs: r.latencyMs, model: cfg.model, protocol: cfg.protocol, reply: String(r.content || '').slice(0, 40).trim() };
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
- dialogue 是这句台词/旁白本身（中文），没有就填空字符串。
- 只输出 JSON，不要任何解释文字。

输出 JSON：
{
  "pick": "模板id",
  "confidence": 0.0-1.0,
  "reason": "60 字内说明这套版式为什么接得住这段剧情（讲节奏与景别，不要夸）",
  "alternatives": [{"id": "另一个候选id", "reason": "30 字内"}],
  "panels": [{"slotId": "该模板的slot id", "beat": "2-6字节拍名", "content": "画面内容", "dialogue": "台词或空串"}]
}`;

export async function aiDecide({ plot, analysis, candidates, cfg, culture, ratio, extraNote }) {
  const brief = {
    剧情: String(plot || '').slice(0, 3000),
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
