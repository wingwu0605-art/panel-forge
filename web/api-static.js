/**
 * api-static.js — 静态托管版（GitHub Pages / 任何静态站）的 API 适配层
 *
 * 规则引擎、模板库、SVG 渲染全部是纯 ESM，直接在浏览器里跑，不需要服务器：
 *   - 模板列表 / 匹配 / 分镜表  → 本地计算（毫秒级，离线可用）
 *   - AI 导演 / AI 优化提示词   → 浏览器直连模型（用访客自己的 Key）
 *
 * 直连的前提是服务商允许 CORS。实测：DeepSeek / OpenAI / SiliconFlow 放行；
 * Anthropic 需要 anthropic-dangerous-direct-browser-access 头（已在 llm-core 里自动加上）。
 * 想改成「中转」：让用户把 baseUrl 填成你的中转地址即可，逻辑不用动。
 */
import { TEMPLATES, listTemplates, getTemplate, slim } from './lib/library.mjs';
import { matchTemplates, planStory, analyzePlot, buildPlan, RULES_VERSION, RULE_STATS } from './lib/matcher.mjs';
import { INTENTS, ROLES, STYLE_PACKS, COMMON_NEGATIVE, SCENES, TONES, DIRECTIVES } from './lib/taxonomy.mjs';
import { PAGE_PRESETS } from './lib/geometry.mjs';
import {
  aiDecide as aiDecideCore,
  aiSplitPanels as aiSplitCore,
  optimizePrompts as optimizePromptsCore,
  testLlmWith,
  llmStatusOf,
  normalizeCfg,
  generateImage as generateImageCore,
} from './lib/llm-core.mjs';

const LLM_STORE = 'pf.llm.v1';

/** 从 localStorage 读访客自己填的配置（和 app.js 用同一个 key） */
function storedLlm() {
  try { return JSON.parse(localStorage.getItem(LLM_STORE) || 'null') || {}; } catch { return {}; }
}

function cfgFrom(passed) {
  const stored = storedLlm();
  const merged = { ...stored, ...(passed || {}) };
  // 请求里没带 key 时，回落到本机保存的那份
  if (!merged.apiKey) merged.apiKey = stored.apiKey || '';
  return normalizeCfg(merged);
}

const llmError = (err, cfg) => ({
  ok: false,
  mode: 'llm',
  code: err.code || 'LLM_ERROR',
  error: String(err.message || err),
  hint: err.hint || (err.code === 'NO_LLM_KEY'
    ? '在左边「AI 导演」里填 baseUrl / apiKey / model 就能用（Key 只存在你浏览器里）'
    : undefined),
  // 排查用：把「实际请求的地址 + 用的模型」带回去，用户一眼看出自己填的东西有没有生效
  endpoint: err.endpoint || '',
  model: err.model || cfg?.model || '',
  llm: llmStatusOf(cfg),
});

export function createStaticApi() {
  const clamp = (v, lo, hi, d) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(hi, Math.max(lo, n));
  };

  return {
    staticMode: true,

    async meta() {
      const counts = (c) => TEMPLATES.filter((t) => t.culture === c).length;
      return {
        service: 'PanelForge 分镜坊（静态版）',
        version: '2.0.0',
        mode: 'static',
        engine: { type: 'local-rules', version: RULES_VERSION, ...RULE_STATS },
        templates: TEMPLATES.length,
        cultures: {
          jp: { zh: STYLE_PACKS.jp.zh, reading: 'rtl', count: counts('jp'), tip: STYLE_PACKS.jp.tip },
          cn: { zh: STYLE_PACKS.cn.zh, reading: 'ltr', count: counts('cn'), tip: STYLE_PACKS.cn.tip },
          kr: { zh: STYLE_PACKS.kr.zh, reading: 'vertical', count: counts('kr'), tip: STYLE_PACKS.kr.tip },
          core: { zh: '通用/跨界', reading: 'ltr', count: counts('core'), tip: '中性骨架，任何画风都能套' },
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
        llm: { ...llmStatusOf(cfgFrom()), staticMode: true, direct: true },
      };
    },

    async templates() {
      const r = listTemplates({ limit: 500 });
      return { total: r.total, items: r.items.map(slim) };
    },

    async template(id) {
      return getTemplate(id) || { error: 'template not found', id };
    },

    async match(body = {}) {
      return matchTemplates(String(body.plot || ''), {
        culture: body.culture || 'all',
        genre: body.genre || 'all',
        ratio: body.ratio || 'auto',
        limit: clamp(body.limit, 1, 50, 10),
        includeCore: body.includeCore !== false,
      });
    },

    async plan(body = {}) {
      const plot = String(body.plot || '');
      const pageWidth = clamp(body.pageWidth, 400, 4000, 1600);

      if (body.templateId) {
        const t = getTemplate(body.templateId);
        if (!t) return { error: 'template not found', templateId: body.templateId };
        const a = analyzePlot(plot, {});
        const intent = body.intent || (!plot.trim() ? (t.intents[0] || 'daily') : undefined);
        return {
          pages: [{ pageIndex: 1, segment: plot, analysis: a, templateScore: null, plan: buildPlan(t, a, { pageWidth, intent, plot }) }],
          analysis: a,
          segmentCount: 1,
        };
      }

      return planStory(plot, {
        culture: body.culture || 'all',
        ratio: body.ratio || 'auto',
        maxPages: clamp(body.maxPages, 1, 8, 3),
        pageWidth,
        intent: body.intent || undefined,
      });
    },

    async llmStatus() {
      const cfg = cfgFrom();
      return { ...llmStatusOf(cfg), staticMode: true, direct: true };
    },

    async llmTest(body = {}) {
      const cfg = cfgFrom(body.llm);
      try {
        const r = await testLlmWith(cfg);
        return { ...r, status: llmStatusOf(cfg) };
      } catch (err) {
        return llmError(err, cfg);
      }
    },

    /** AI 导演：规则引擎筛候选 → 浏览器直连模型 → 校验 → 生成分镜表 */
    async aiDecide(body = {}) {
      const plot = String(body.plot || '').trim();
      if (!plot) return { ok: false, code: 'BAD_REQUEST', error: '缺少 plot 字段（剧情文本）' };

      const culture = body.culture || 'all';
      const ratio = body.ratio || 'auto';
      const pageWidth = clamp(body.pageWidth, 400, 4000, 1600);
      const candidateCount = clamp(body.candidates, 3, 16, 10);

      // ① 合法候选（模型只能在这里面挑）
      const genre = body.genre || 'all';
      const m = matchTemplates(plot, { culture, genre, ratio, limit: candidateCount, includeCore: body.includeCore !== false });
      const cfg = cfgFrom(body.llm);

      let decision;
      try {
        decision = await aiDecideCore({
          plot,
          analysis: m.analysis,
          candidates: m.results,
          cfg,
          culture,
          ratio,
          characterSheet: body.characterSheet ? String(body.characterSheet).slice(0, 600) : '',
          extraNote: [
            genre && genre !== 'all' ? `题材必须属于「${genre}」` : '',
            body.note ? String(body.note).slice(0, 400) : '',
          ].filter(Boolean).join('；') || undefined,
        });
      } catch (err) {
        return {
          ...llmError(err, cfg),
          fallback: {
            note: '规则引擎结果仍然可用：直接在网页里点「按规则匹配」',
            top: m.results.slice(0, 3).map((r) => ({ id: r.id, name: r.name, score: r.score })),
          },
        };
      }

      const tpl = getTemplate(decision.pick);
      const plan = buildPlan(tpl, m.analysis, { pageWidth, llmPanels: decision.panels, plot });

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
    },

    /** AI 优化提示词：逐格压成高密度生图提示词 */
    async prompts(body = {}) {
      const tpl = body.templateId ? getTemplate(body.templateId) : null;
      if (!tpl) return { ok: false, code: 'BAD_REQUEST', error: '需要 templateId：先选一套版式再优化提示词' };

      const plot = String(body.plot || '');
      const pageWidth = clamp(body.pageWidth, 400, 4000, 1600);
      const a = analyzePlot(plot, {});
      const plan = buildPlan(tpl, a, { pageWidth, llmPanels: body.llmPanels || null, plot });
      const cfg = cfgFrom(body.llm);

      try {
        const r = await optimizePromptsCore({
          plot, plan, cfg,
          characterSheet: body.characterSheet ? String(body.characterSheet).slice(0, 600) : '',
          note: body.note ? String(body.note).slice(0, 400) : '',
        });
        let applied = 0;
        for (const p of plan.panels) {
          const o = r.prompts[p.id];
          if (!o) continue;
          p.promptEnRule = p.promptEnRule || p.promptEn;
          p.promptEn = o.prompt;
          if (o.negative) p.negative = o.negative;
          p.aiOptimized = true;
          applied++;
        }
        return {
          ok: true,
          mode: 'ai-prompts',
          applied,
          total: plan.panels.length,
          globalNotes: r.globalNotes,
          quality: r.quality,
          plan,
          llm: r.llm,
        };
      } catch (err) {
        return llmError(err, cfg);
      }
    },

    /** AI 切原文：版式已定，让模型把源文本切成 N 格（逐格内容＋台词＋英文提示词） */
    async aiSplit(body = {}) {
      const tpl = body.templateId ? getTemplate(body.templateId) : null;
      if (!tpl) return { ok: false, code: 'BAD_REQUEST', error: '需要 templateId：先选一套版式再让 AI 切原文' };

      const plot = String(body.plot || '').trim();
      if (!plot) return { ok: false, code: 'BAD_REQUEST', error: '缺少 plot 字段（源文本）' };

      const pageWidth = clamp(body.pageWidth, 400, 4000, 1600);
      const a = analyzePlot(plot, {});
      const plan = buildPlan(tpl, a, { pageWidth, plot });
      const cfg = cfgFrom(body.llm);

      try {
        const r = await aiSplitCore({
          plot, plan, cfg,
          characterSheet: body.characterSheet ? String(body.characterSheet).slice(0, 600) : '',
          note: body.note ? String(body.note).slice(0, 400) : '',
        });
        let applied = 0;
        for (const p of plan.panels) {
          const o = r.panels[p.id];
          if (!o) continue;
          if (o.beat) p.beat = o.beat;
          if (o.content) { p.content = o.content; p.beatHint = o.content; }
          p.dialogue = o.dialogue || '';
          if (o.prompt) {
            p.promptEnRule = p.promptEnRule || p.promptEn;
            p.promptEn = o.prompt;
          }
          p.aiOptimized = true;
          applied++;
        }
        return {
          ok: true, mode: 'ai-split', templateId: tpl.id,
          applied, total: plan.panels.length,
          globalNotes: r.globalNotes, quality: r.quality, plan, llm: r.llm,
        };
      } catch (err) {
        return llmError(err, cfg);
      }
    },

    async proxyImage() {
      throw new Error('静态版没有图片代理：跨域图片无法栅格化导出，请改用本地上传');
    },

    /** AI 生图：浏览器直连用户的生图接口 */
    async imageGenerate(body = {}) {
      const cfg = cfgFrom(body.llm);
      try {
        const r = await generateImageCore({
          cfg,
          prompt: body.prompt,
          size: body.size,
          refs: body.refs || [],
          model: body.model || cfg.imgModel,
        });
        return { ...r, ok: true };
      } catch (err) {
        return llmError(err, cfg);
      }
    },
  };
}

