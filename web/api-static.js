/**
 * api-static.js — 静态托管版（GitHub Pages / 任何静态站）的 API 适配层
 *
 * 规则引擎、模板库、SVG 渲染全部是纯 ESM，直接在浏览器里跑，不需要服务器：
 *   - 模板列表 / 匹配 / 分镜表  → 本地计算（毫秒级，离线可用）
 *   - AI 导演                   → 需要服务端（本机 node server.mjs 或 Render/Docker），这里明确报错
 */
import { TEMPLATES, listTemplates, getTemplate, slim } from './lib/library.mjs';
import { matchTemplates, planStory, analyzePlot, buildPlan, RULES_VERSION, RULE_STATS } from './lib/matcher.mjs';
import { INTENTS, ROLES, STYLE_PACKS, COMMON_NEGATIVE, SCENES, TONES, DIRECTIVES } from './lib/taxonomy.mjs';
import { PAGE_PRESETS } from './lib/geometry.mjs';

const STATIC_LLM_ERROR = () => ({
  ok: false,
  code: 'STATIC_NO_LLM',
  error: '静态版（GitHub Pages）没有服务端',
  hint: 'AI 导演需要一台能跑 node 的机器：本机执行 node server.mjs，或把仓库部署到 Render / Docker。规则路在这里完全可用。',
  staticMode: true,
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
        llm: { configured: false, staticMode: true, keySet: false, source: 'static' },
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
          pages: [{ pageIndex: 1, segment: plot, analysis: a, templateScore: null, plan: buildPlan(t, a, { pageWidth, intent }) }],
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
      return { configured: false, staticMode: true, keySet: false, source: 'static', model: '', protocol: 'openai' };
    },

    async llmTest() {
      return STATIC_LLM_ERROR();
    },

    async aiDecide() {
      return STATIC_LLM_ERROR();
    },

    async prompts() {
      return STATIC_LLM_ERROR();
    },

    async proxyImage() {
      throw new Error('静态版没有图片代理：跨域图片无法栅格化导出，请改用本地上传');
    },
  };
}
