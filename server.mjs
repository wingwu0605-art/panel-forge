/**
 * server.mjs — PanelForge 分镜坊 · 零依赖 HTTP 服务
 *
 *   /                     网页编辑器
 *   /api/*                REST API（CORS 全开，供任意 AI / 脚本调用）
 *   /lib/*.mjs            浏览器端直接复用的同一份渲染内核
 *
 * 启动：node server.mjs  （默认 http://127.0.0.1:7311 ，端口用 PORT 环境变量覆盖）
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPLATES, listTemplates, getTemplate, slim } from './lib/library.mjs';
import { renderTemplateSVG } from './lib/svg.mjs';
import { matchTemplates, planStory, analyzePlot, buildPlan, RULES_VERSION, RULE_STATS } from './lib/matcher.mjs';
import { INTENTS, ROLES, STYLE_PACKS, COMMON_NEGATIVE, SCENES, TONES, DIRECTIVES, NEGATORS, VOCAB_STATS, BEAT_EN } from './lib/taxonomy.mjs';
import { PAGE_PRESETS } from './lib/geometry.mjs';
import { aiTools, systemPrompt, openapiSpec } from './lib/aidocs.mjs';
import { readLlmConfig, llmStatus, testLlm, aiDecide } from './lib/llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7311);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const json = (res, code, obj, extra = {}) => {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(body);
};
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  });
  res.end(body);
};

async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大（>40MB）');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('请求体不是合法 JSON'); }
}

/* ------------------------------------------------------------------ *
 * 模板 SVG
 * ------------------------------------------------------------------ */
function svgFor(tpl, q = {}) {
  const width = Math.min(4000, Math.max(200, Number(q.width) || 1200));
  return renderTemplateSVG(tpl, {
    width,
    frame: q.frame || undefined,
    showNumbers: q.numbers === '1' || q.numbers === 'true',
    showRoles: q.roles === '1' || q.roles === 'true',
    showGuides: q.guides === '1' || q.guides === 'true',
    slotOutline: q.outline === '0' ? false : true,
    bg: q.bg || '#ffffff',
    ink: q.ink || undefined,
    accent: q.accent || undefined,
  });
}

/* ------------------------------------------------------------------ *
 * API 路由
 * ------------------------------------------------------------------ */
const routes = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true, service: 'panel-forge', templates: TEMPLATES.length, version: '2.0.0', engine: RULES_VERSION, vocab: RULE_STATS.total })],

  ['GET', /^\/api\/meta$/, async () => ({
    service: 'PanelForge 分镜坊',
    version: '2.0.0',
    engine: { type: 'local-rules', version: RULES_VERSION, ...RULE_STATS },
    templates: TEMPLATES.length,
    cultures: {
      jp: { zh: STYLE_PACKS.jp.zh, reading: 'rtl', count: TEMPLATES.filter((t) => t.culture === 'jp').length, tip: STYLE_PACKS.jp.tip },
      cn: { zh: STYLE_PACKS.cn.zh, reading: 'ltr', count: TEMPLATES.filter((t) => t.culture === 'cn').length, tip: STYLE_PACKS.cn.tip },
      kr: { zh: STYLE_PACKS.kr.zh, reading: 'vertical', count: TEMPLATES.filter((t) => t.culture === 'kr').length, tip: STYLE_PACKS.kr.tip },
      core: { zh: '通用/跨界', reading: 'ltr', count: TEMPLATES.filter((t) => t.culture === 'core').length, tip: '中性骨架，任何画风都能套' },
    },
    intents: Object.entries(INTENTS).map(([id, v]) => ({ id, zh: v.zh, en: v.en, beats: v.beats.length, keywords: v.keywords.length })),
    roles: Object.entries(ROLES).map(([id, v]) => ({ id, zh: v.zh, shot: v.shot })),
    scenes: Object.entries(SCENES).map(([id, v]) => ({ id, zh: v.zh, era: v.era, culture: v.culture, words: v.words.length })),
    tones: Object.entries(TONES).map(([id, v]) => ({ id, zh: v.zh, tags: v.tags, words: v.words.length })),
    directives: Object.entries(DIRECTIVES).map(([id, v]) => ({ id, zh: v.zh, kind: v.kind })),
    ratios: Object.values(PAGE_PRESETS),
    frames: ['ink', 'bold', 'hairline', 'none'],
    tags: [...new Set(TEMPLATES.flatMap((t) => t.tags))].sort(),
    styles: STYLE_PACKS,
    negative: COMMON_NEGATIVE,
    llm: llmStatus(),
    endpoints: ['/api/templates', '/api/templates/:id', '/api/templates/:id/svg', '/api/match', '/api/plan', '/api/ai/decide', '/api/llm/status', '/api/llm/test', '/api/rules', '/api/compose', '/api/meta', '/api/openapi.json', '/api/ai-tools.json'],
  })],

  // 规则库全量导出：所有词典、权重、戏路节拍（透明可审计）
  ['GET', /^\/api\/rules$/, async () => ({
    engine: { type: 'local-rules', version: RULES_VERSION },
    stats: VOCAB_STATS,
    weights: {
      note: '总分 = Σ(权重 × 各项 0–1 归一值)；显式给了画幅/画风时会重新分配权重',
      default: { intent: 0.25, tags: 0.12, beats: 0.26, panels: 0.13, culture: 0.10, ratio: 0.05, pace: 0.03, tone: 0.06 },
      explicitRatio: { intent: 0.24, tags: 0.10, beats: 0.26, panels: 0.13, culture: 0.09, ratio: 0.13, pace: 0.03, tone: 0.05 },
    },
    keywordWeight: { len1: 0.5, len2: 1.0, len3: 1.35, len4plus: 1.6, repeatCap: 3, negatedFactor: 0.15, negatorWindow: 3 },
    intents: Object.entries(INTENTS).map(([id, v]) => ({
      id, zh: v.zh, en: v.en, cls: v.cls, density: v.density,
      keywordCount: v.keywords.length, keywords: v.keywords,
      wantTags: v.wantTags, avoidTags: v.avoidTags,
      beats: v.beats.map((b) => ({ id: b.id, zh: b.zh, roles: b.roles, hint: b.hint, en: BEAT_EN[`${id}.${b.id}`] || '' })),
    })),
    scenes: SCENES,
    tones: TONES,
    directives: DIRECTIVES,
    negators: NEGATORS,
    roles: ROLES,
  })],

  // AI 导演：状态 / 连通性测试 / 自动决定
  ['GET', /^\/api\/llm\/status$/, async () => llmStatus()],

  ['POST', /^\/api\/llm\/test$/, async (req) => {
    const body = await readBody(req);
    const cfg = readLlmConfig(body.llm || body || {});
    try {
      const r = await testLlm(cfg);
      return { ...r, status: llmStatus(cfg) };
    } catch (err) {
      return { __status: err.code === 'NO_LLM_KEY' ? 400 : 502, ok: false, error: String(err.message), code: err.code || 'LLM_ERROR', hint: err.hint };
    }
  }],

  ['POST', /^\/api\/ai\/decide$/, async (req) => {
    const body = await readBody(req);
    const plot = String(body.plot || '').trim();
    if (!plot) return { __status: 400, error: '缺少 plot 字段（剧情文本）' };

    const culture = body.culture || 'all';
    const ratio = body.ratio || 'auto';
    const pageWidth = clampNum(body.pageWidth, 400, 4000, 1600);
    const candidateCount = clampNum(body.candidates, 3, 16, 10);

    // ① 规则引擎先给合法候选（模型只在这里面挑，不许发明格位）
    const m = matchTemplates(plot, { culture, ratio, limit: candidateCount, includeCore: body.includeCore !== false });
    const cfg = readLlmConfig(body.llm || {});

    // ② AI 导演
    let decision;
    try {
      decision = await aiDecide({
        plot, analysis: m.analysis, candidates: m.results, cfg, culture, ratio,
        extraNote: body.note ? String(body.note).slice(0, 500) : undefined,
      });
    } catch (err) {
      return {
        __status: err.code === 'NO_LLM_KEY' ? 400 : 502,
        ok: false,
        mode: 'llm',
        error: String(err.message),
        code: err.code || 'LLM_ERROR',
        hint: err.hint,
        fallback: {
          note: '规则引擎结果仍然可用：把 mode 换成 rules，或直接在网页里点「按规则匹配」',
          top: m.results.slice(0, 3).map((r) => ({ id: r.id, name: r.name, score: r.score })),
        },
        llm: llmStatus(cfg),
      };
    }

    // ③ 用选中模板 + AI 排戏结果生成分镜表
    const tpl = getTemplate(decision.pick);
    const plan = buildPlan(tpl, m.analysis, { pageWidth, llmPanels: decision.panels });

    return {
      ok: true,
      mode: 'llm',
      analysis: m.analysis,
      filtered: m.filtered,
      candidates: m.results.map((r) => ({ id: r.id, name: r.name, culture: r.culture, panels: r.panels, ratio: r.ratio, score: r.score, why: r.why })),
      decision: {
        pick: decision.pick,
        pickName: tpl.name,
        confidence: decision.confidence,
        reason: decision.reason,
        alternatives: decision.alternatives,
        quality: decision.quality,
      },
      plan,
      llm: decision.llm,
    };
  }],

  ['GET', /^\/api\/templates$/, async (req, url) => {
    const q = url.searchParams;
    const r = listTemplates({
      culture: q.get('culture') || undefined,
      q: q.get('q') || undefined,
      tag: q.get('tag') || undefined,
      intent: q.get('intent') || undefined,
      ratio: q.get('ratio') || undefined,
      density: q.get('density') || undefined,
      minPanels: q.get('minPanels') ? Number(q.get('minPanels')) : undefined,
      maxPanels: q.get('maxPanels') ? Number(q.get('maxPanels')) : undefined,
      limit: q.get('limit') ? Math.min(500, Number(q.get('limit'))) : 500,
      offset: q.get('offset') ? Number(q.get('offset')) : 0,
      sort: q.get('sort') || 'id',
    });
    return { total: r.total, items: r.items.map(slim) };
  }],

  ['GET', /^\/api\/templates\/([\w-]+)$/, async (req, url, m) => {
    const t = getTemplate(m[1]);
    if (!t) return { __status: 404, error: 'template not found', id: m[1] };
    return t;
  }],

  ['GET', /^\/api\/templates\/([\w-]+)\/svg$/, async (req, url, m) => {
    const t = getTemplate(m[1]);
    if (!t) return { __status: 404, error: 'template not found' };
    return { __svg: svgFor(t, Object.fromEntries(url.searchParams)) };
  }],

  ['POST', /^\/api\/match$/, async (req, url) => {
    const body = await readBody(req);
    if (!body.plot) return { __status: 400, error: '缺少 plot 字段（剧情文本）' };
    const r = matchTemplates(String(body.plot), {
      culture: body.culture || 'all',
      ratio: body.ratio || 'auto',
      limit: clampNum(body.limit, 1, 50, 10),
      includeCore: body.includeCore !== false,
    });
    return r;
  }],

  ['POST', /^\/api\/plan$/, async (req, url) => {
    const body = await readBody(req);
    const tpl = body.templateId ? getTemplate(body.templateId) : null;
    if (!tpl && !body.plot) return { __status: 400, error: '缺少 plot 字段（剧情文本）' };
    if (body.templateId && !tpl) return { __status: 404, error: 'template not found', templateId: body.templateId };
    const pageWidth = clampNum(body.pageWidth, 400, 4000, 1600);

    // 指定模板时跳过匹配，直接为这套版式生成分镜表
    if (tpl) {
      const plot = String(body.plot || '');
      const a = analyzePlot(plot, {});
      // 没给剧情就用模板自身的第一个戏路当节拍骨架
      const intent = body.intent || (!plot.trim() ? (tpl.intents[0] || 'daily') : undefined);
      return {
        pages: [{ pageIndex: 1, segment: plot, analysis: a, templateScore: null, plan: buildPlan(tpl, a, { pageWidth, intent }) }],
        analysis: a,
        segmentCount: 1,
      };
    }

    const story = planStory(String(body.plot), {
      culture: body.culture || 'all',
      ratio: body.ratio || 'auto',
      maxPages: clampNum(body.maxPages, 1, 8, 3),
      pageWidth,
      intent: body.intent || undefined,
    });
    return story;
  }],

  ['POST', /^\/api\/analyze$/, async (req) => {
    const body = await readBody(req);
    return analyzePlot(String(body.plot || ''));
  }],

  ['POST', /^\/api\/compose$/, async (req, url) => {
    const body = await readBody(req);
    const t = getTemplate(body.templateId);
    if (!t) return { __status: 404, error: 'template not found', templateId: body.templateId };

    // 支持两种写法：images 为 {slotId: href} 映射，或按阅读顺序的数组
    const images = {};
    if (Array.isArray(body.images)) {
      body.images.forEach((href, i) => {
        const slot = t.slots[i];
        if (slot && href) images[slot.id] = typeof href === 'string' ? { href } : href;
      });
    } else if (body.images && typeof body.images === 'object') {
      Object.assign(images, body.images);
    }

    const svg = renderTemplateSVG(t, {
      width: clampNum(body.width, 200, 4000, 1600),
      frame: body.frame || undefined,
      images,
      showNumbers: !!body.showNumbers,
      showRoles: !!body.showRoles,
      slotOutline: body.outline !== false,
      bg: body.bg || '#ffffff',
    });

    if (url.searchParams.get('format') === 'json' || body.format === 'json') {
      return {
        ok: true,
        template: { id: t.id, name: t.name, page: t.page, slots: t.slots.length },
        filled: Object.keys(images).length,
        svg,
      };
    }
    return { __svg: svg, __download: `${t.id}-composed.svg` };
  }],

  ['GET', /^\/api\/openapi\.json$/, async () => openapiSpec()],

  ['GET', /^\/api\/ai-tools\.json$/, async () => ({
    service: 'PanelForge 分镜坊',
    baseUrl: `http://${HOST}:${PORT}`,
    systemPrompt,
    tools: aiTools(`http://${HOST}:${PORT}`),
    quickstart: [
      '1) POST /api/match {"plot":"...","culture":"jp"} 先挑 3-5 个候选分镜',
      '2) 选一个后 POST /api/plan {"plot":"...","maxPages":3} 拿到逐格景别与「可直接生图」的提示词',
      '3) 每格按 genSize 生成图片（或你自己画），按 order 顺序上传到网页，或 POST /api/compose 拼成整页 SVG',
      '4) GET /api/templates/{id}/svg 取镂空模板底稿，可直接进 Photoshop/Procreate 当参考层',
    ],
  })],

  // 远程图片代理：让浏览器导出 PNG 时不吃到跨域污染
  ['GET', /^\/api\/proxy$/, async (req, url) => {
    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//.test(target)) return { __status: 400, error: '需要 url=http(s)://...' };
    const r = await fetch(target, { headers: { 'user-agent': 'panel-forge/1.0' } });
    if (!r.ok) return { __status: 502, error: `上游返回 ${r.status}` };
    const type = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    return { __raw: buf, __type: type };
  }],

  ['GET', /^\/api\/sheet$/, async (req, url) => ({ __html: sheetHTML(url.searchParams.get('culture') || 'all') })],

  ['GET', /^\/api\/docs$/, async () => ({ __html: docsHTML() })],
];

/* ------------------------------------------------------------------ */
function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const routePath = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- API ----
  if (routePath.startsWith('/api/')) {
    for (const [method, re, fn] of routes) {
      if (req.method !== method) continue;
      const m = routePath.match(re);
      if (!m) continue;
      try {
        const out = await fn(req, url, m);
        if (out && out.__svg) {
          return send(res, 200, out.__svg, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Content-Disposition': out.__download ? `inline; filename="${out.__download}"` : 'inline',
          });
        }
        if (out && out.__html) return send(res, 200, out.__html, { 'Content-Type': 'text/html; charset=utf-8' });
        if (out && out.__raw) return send(res, 200, out.__raw, { 'Content-Type': out.__type });
        if (out && out.__status) {
          const { __status, ...rest } = out;
          return json(res, __status, rest);
        }
        return json(res, 200, out);
      } catch (err) {
        return json(res, 500, { error: String(err && err.message || err) });
      }
    }
    return json(res, 404, { error: 'unknown endpoint', path: routePath, see: '/api/meta' });
  }

  // ---- 静态文件 ----
  let rel = routePath === '/' ? '/web/index.html' : routePath;
  if (rel === '/app.js') rel = '/web/app.js';
  if (rel === '/styles.css') rel = '/web/styles.css';
  const file = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(__dirname)) return send(res, 403, 'forbidden');
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const buf = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    return send(res, 200, buf, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.mjs' || ext === '.js' || ext === '.css' || ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
  } catch {
    return send(res, 404, `404 Not Found: ${routePath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  const n = TEMPLATES.length;
  const llm = llmStatus();
  console.log(`\n  PanelForge 分镜坊 v2  ·  ${n} 套分镜模板  ·  本地规则引擎 v${RULES_VERSION}（${RULE_STATS.total} 条词条 / ${RULE_STATS.intents} 戏路 / ${RULE_STATS.beats} 节拍）`);
  console.log(`  网页编辑器   http://${HOST}:${PORT}/`);
  console.log(`  规则库       http://${HOST}:${PORT}/api/rules`);
  console.log(`  AI 导演      ${llm.configured ? `已配置 ${llm.protocol} · ${llm.model}` : '未配置（在网页里填 Key，或设 LLM_API_KEY）'}`);
  console.log(`  API 元信息   http://${HOST}:${PORT}/api/meta`);
  console.log(`  AI 工具定义  http://${HOST}:${PORT}/api/ai-tools.json`);
  console.log(`  接触表       http://${HOST}:${PORT}/api/sheet\n`);
});

/* ------------------------------------------------------------------ *
 * 简易页面（/api/sheet 与 /api/docs）
 * ------------------------------------------------------------------ */
function sheetHTML(culture) {
  const list = culture === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.culture === culture);
  const cards = list.map((t) => `
    <figure>
      ${renderTemplateSVG(t, { width: 260, showNumbers: true })}
      <figcaption><b>${t.id}</b> · ${t.name}<br><span>${t.slots.length} 格 · ${t.ratio} · ${t.frame} · ${t.intents.join('/')}</span></figcaption>
    </figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>PanelForge 接触表</title>
  <style>body{background:#14151a;color:#e8e6e2;font:13px/1.5 system-ui,'Microsoft YaHei';padding:22px}
  h1{font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,260px);gap:18px}
  figure{margin:0;background:#fff;color:#222;border-radius:8px;overflow:hidden}
  svg{display:block;width:100%;height:auto}figcaption{padding:6px 8px;font-size:11px}
  figcaption span{color:#777}</style>
  <h1>PanelForge 分镜接触表 · ${culture} · ${list.length} 套</h1><div class="grid">${cards}</div>`;
}

function docsHTML() {
  const eps = [
    ['GET', '/api/health', '健康检查'],
    ['GET', '/api/meta', '全部元信息：画风、意图、角色、画幅、标签'],
    ['GET', '/api/templates?culture=jp&minPanels=4', '模板列表（可筛选）'],
    ['GET', '/api/templates/{id}', '单个模板完整数据（含 poly / clipPath）'],
    ['GET', '/api/templates/{id}/svg?width=1400&numbers=1', '镂空模板 SVG'],
    ['POST', '/api/match {plot,culture,ratio,limit}', '剧情 → 候选分镜排名'],
    ['POST', '/api/plan {plot,culture,maxPages,pageWidth}', '剧情 → 逐格分镜表 + 生图提示词'],
    ['POST', '/api/compose {templateId, images}', '图片 → 整页 SVG'],
    ['GET', '/api/openapi.json', 'OpenAPI 3 描述'],
    ['GET', '/api/ai-tools.json', 'OpenAI / Anthropic 工具定义 + system prompt'],
  ];
  return `<!doctype html><meta charset="utf-8"><title>PanelForge API</title>
  <style>body{background:#14151a;color:#e8e6e2;font:14px/1.7 system-ui,'Microsoft YaHei';padding:28px;max-width:900px}
  code{background:#22242c;padding:2px 6px;border-radius:4px;color:#ffb59e}td{padding:6px 12px;border-bottom:1px solid #2a2c35}
  a{color:#7fb0ff}</style>
  <h1>PanelForge 分镜坊 API</h1>
  <p>完整文档见仓库 <code>docs/API.md</code>；AI 接入见 <code>docs/AI-INTEGRATION.md</code>。</p>
  <table>${eps.map(([m, p, d]) => `<tr><td><b>${m}</b></td><td><code>${p}</code></td><td>${d}</td></tr>`).join('')}</table>
  <p>示例：<a href="/api/templates/jp-shonen-3tier/svg?numbers=1">/api/templates/jp-shonen-3tier/svg?numbers=1</a></p>`;
}
