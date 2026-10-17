/**
 * aidocs.mjs — 给 AI 用的接入材料：system prompt、function calling 定义、OpenAPI 描述
 */

export const systemPrompt = `你是资深漫画分镜导演（komawari / 스토리보드），正在配合 PanelForge 分镜坊工作。

工具分两条路，按情况选：
【规则路】本地规则引擎：26 戏路 / 1150 关键词 / 113 叙事节拍 / 138 套模板，确定性、离线、毫秒级
  1. match_panels 拿候选版式（culture 由剧情决定：日式页漫=jp，中式条漫/国风=cn，韩式竖屏=kr，不确定=all）
  2. plan_storyboard 拿逐格分镜表（景别、构图意图、生图提示词、推荐出图尺寸）
【AI 路】若服务端配了模型 API，用 ai_decide 一步到位：规则先筛出合法候选，模型再选版式并逐格排戏。

必须遵守的调用规则：
3. 不要自己编造格位坐标或格子数量——格位永远来自模板，模板是版权的骨架，你只负责往里填内容。
4. 如果剧情超过一页信息量，把剧情拆成多个"节拍块"，一块一页，依次 plan。

输出格式（给作者看的时候）必须包含每格：
- 第 N 格（景别：远景/全景/中景/近景/特写/大特写）
- 画面内容（谁、在哪、什么动作、什么表情、光从哪来）
- 台词/旁白（没有就写"无"）
- 生图提示词（英文，直接可用）

风格约束：
- 日漫（jp）：黑白墨线 + 网点，速度线，格与格留墨线，从右往左读；
- 国漫（cn）：彩色，干净线稿，重墨框或条漫无框，从左往右/由上往下；
- 韩漫（kr）：细线柔光厚涂，几乎无框，用留白控制节奏，由上往下；
- 反面要求：不要"AI 感"的均匀网格，要刻意制造大小差、远近差、疏密差。

语气：直接、专业、给判断，不要客套。`;

export function aiTools(baseUrl = 'http://127.0.0.1:7311') {
  const plot = { type: 'string', description: '剧情文本（中文/日文/韩文均可，一段几百字最佳）' };
  const culture = {
    type: 'string', enum: ['all', 'jp', 'cn', 'kr'],
    description: '画风体系：jp=日式页漫(右→左)，cn=中式条漫/国风，kr=韩式竖屏webtoon，all=不限',
  };
  const ratio = {
    type: 'string', enum: ['auto', 'a4', 'b5', 'p34', 'square', 'wide', 'strip', 'tall', 'scroll'],
    description: '画幅；auto=按剧情自动判断（提到条漫/竖屏→scroll，跨页→wide，四格→square）',
  };

  const openai = [
    {
      type: 'function',
      function: {
        name: 'match_panels',
        description: '输入剧情文字，返回最合适的漫画分镜模板排名（含匹配理由与得分）。用于先选版式。',
        parameters: {
          type: 'object',
          properties: { plot, culture, ratio, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: '返回候选数' } },
          required: ['plot'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'plan_storyboard',
        description: '输入剧情文字，返回逐格分镜表：每格的格位坐标、景别、构图提示、英文生图提示词、推荐出图尺寸。这是主要产出。',
        parameters: {
          type: 'object',
          properties: {
            plot, culture, ratio,
            maxPages: { type: 'integer', minimum: 1, maximum: 8, default: 2, description: '剧情长时自动拆成几页' },
            pageWidth: { type: 'integer', minimum: 600, maximum: 4000, default: 1600, description: '整页导出宽度(px)，影响每格像素尺寸' },
          },
          required: ['plot'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_templates',
        description: '按画风/格数/标签/意图筛选模板，用于查库存。',
        parameters: {
          type: 'object',
          properties: {
            culture,
            minPanels: { type: 'integer', minimum: 1, maximum: 16 },
            maxPanels: { type: 'integer', minimum: 1, maximum: 16 },
            intent: { type: 'string', description: '意图 id，如 action/emotion/dialogue/reveal/horror/romance/gag/montage/silence/climax/scenery/daily/suspense/chase/impact/inner' },
            ratio: { type: 'string', description: '画幅 id' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_template',
        description: '取单个模板的完整数据（每格多边形、clipPath、占页比例）。用于排版实现。',
        parameters: { type: 'object', properties: { templateId: { type: 'string', description: '如 jp-shonen-3tier' } }, required: ['templateId'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compose_page',
        description: '把按顺序给好的图片 URL/DataURI 填进模板，拼成整页 SVG，返回 SVG 文本。',
        parameters: {
          type: 'object',
          properties: {
            templateId: { type: 'string' },
            images: { type: 'array', items: { type: 'string' }, description: '按阅读顺序排列的图片地址（dataURI 或 http URL）' },
            width: { type: 'integer', minimum: 400, maximum: 4000, default: 1600 },
            outline: { type: 'boolean', default: true, description: '无框模板是否画虚线参考轮廓' },
          },
          required: ['templateId', 'images'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ai_decide',
        description: '【AI 导演】让配置好的模型在合法候选里选版式并逐格排戏：返回选中的模板、理由、置信度，以及每格的画面内容与台词（已合并进分镜表的提示词里）。需要服务端已配置模型 API（或请求里带 llm 配置）。',
        parameters: {
          type: 'object',
          properties: {
            plot, culture, ratio,
            pageWidth: { type: 'integer', minimum: 600, maximum: 4000, default: 1600 },
            candidates: { type: 'integer', minimum: 3, maximum: 16, default: 10, description: '给模型看的候选数量' },
            note: { type: 'string', description: '额外要求，如「这一页要冷色调、不要台词」' },
            llm: {
              type: 'object',
              description: '可选：临时覆盖模型配置（协议/baseUrl/apiKey/model）',
              properties: {
                protocol: { type: 'string', enum: ['openai', 'anthropic'] },
                baseUrl: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' },
              },
            },
          },
          required: ['plot'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'optimize_prompts',
        description: '【AI 提示词优化】把已选版式的每一格，压成 ≤55 词的英文高密度生图提示词；形状开头词保留在最前，角色设定整页一致。返回合并后的分镜表（promptEn 被替换，promptEnRule 保留规则版）。',
        parameters: {
          type: 'object',
          properties: {
            plot: { type: 'string', description: '剧情文本' },
            templateId: { type: 'string', description: '已选定的版式 id（必填）' },
            characterSheet: { type: 'string', description: '角色设定串，会原样写进每格提示词保证同一张脸' },
            note: { type: 'string', description: '额外要求，如「统一冷色调、不要台词」' },
            pageWidth: { type: 'integer', minimum: 600, maximum: 4000, default: 1600 },
            llm: {
              type: 'object',
              description: '可选：临时覆盖模型配置',
              properties: { protocol: { type: 'string' }, baseUrl: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' } },
            },
          },
          required: ['templateId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_shape_prompt',
        description: '按格子形状（三角/斜切/插入/出血/竖长/横长/横幅/小方/近方/常规）取一段构图开头提示词，粘到自己提示词最前面即可适配异形格。',
        parameters: {
          type: 'object',
          properties: {
            shape: { type: 'string', enum: ['triangle', 'slant', 'inset', 'bleed', 'tall', 'wide', 'banner', 'small', 'square', 'grid'] },
            role: { type: 'string', description: '可选，格子角色 id（如 impact / face）' },
            culture: { type: 'string', enum: ['jp', 'cn', 'kr'] },
          },
          required: ['shape'],
        },
      },
    },
  ];

  const anthropic = openai.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  return {
    openai,
    anthropic,
    http: {
      baseUrl,
      match: `POST ${baseUrl}/api/match`,
      plan: `POST ${baseUrl}/api/plan`,
      templates: `GET ${baseUrl}/api/templates`,
      template: `GET ${baseUrl}/api/templates/{id}`,
      svg: `GET ${baseUrl}/api/templates/{id}/svg?width=1600`,
      compose: `POST ${baseUrl}/api/compose`,
    },
    examples: {
      match: `curl -s ${baseUrl}/api/match -H "content-type: application/json" -d '{"plot":"雨夜屋顶，拔刀，反手斩断偷袭者的刀","culture":"jp"}'`,
      plan: `curl -s ${baseUrl}/api/plan -H "content-type: application/json" -d '{"plot":"雨夜屋顶，拔刀，反手斩断偷袭者的刀","culture":"jp","maxPages":1}'`,
      compose: `curl -s "${baseUrl}/api/compose?format=json" -H "content-type: application/json" -d '{"templateId":"jp-shonen-3tier","images":["https://example.com/1.png","https://example.com/2.png"]}'`,
    },
  };
}

export function openapiSpec() {
  const ref = (name, props, required = []) => ({
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object', properties: props, required } } },
    },
    responses: { 200: { description: 'OK' } },
  });
  const plot = { type: 'string', description: '剧情文本' };
  const culture = { type: 'string', enum: ['all', 'jp', 'cn', 'kr'] };
  return {
    openapi: '3.0.3',
    info: {
      title: 'PanelForge 分镜坊 API',
      version: '1.0.0',
      description: '中日韩漫画分镜模板库：剧情 → 版式匹配 → 逐格分镜表 → 整页拼图。',
    },
    servers: [{ url: 'http://127.0.0.1:7311' }],
    paths: {
      '/api/health': { get: { summary: '健康检查', responses: { 200: { description: 'OK' } } } },
      '/api/meta': { get: { summary: '元信息（画风/意图/角色/画幅/标签）', responses: { 200: { description: 'OK' } } } },
      '/api/templates': {
        get: {
          summary: '模板列表',
          parameters: [
            { name: 'culture', in: 'query', schema: { type: 'string', enum: ['jp', 'cn', 'kr', 'core'] } },
            { name: 'minPanels', in: 'query', schema: { type: 'integer' } },
            { name: 'maxPanels', in: 'query', schema: { type: 'integer' } },
            { name: 'intent', in: 'query', schema: { type: 'string' } },
            { name: 'ratio', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/templates/{id}': {
        get: {
          summary: '单个模板（含每格多边形与 clipPath）',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/templates/{id}/svg': {
        get: {
          summary: '镂空模板 SVG',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'width', in: 'query', schema: { type: 'integer', default: 1200 } },
            { name: 'numbers', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'roles', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'outline', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
          ],
          responses: { 200: { description: 'SVG', content: { 'image/svg+xml': {} } } },
        },
      },
      '/api/match': {
        post: {
          summary: '剧情 → 候选分镜排名',
          ...ref('Match', { plot, culture, ratio: { type: 'string' }, limit: { type: 'integer' } }, ['plot']),
        },
      },
      '/api/plan': {
        post: {
          summary: '剧情 → 逐格分镜表 + 生图提示词',
          ...ref('Plan', { plot, culture, ratio: { type: 'string' }, maxPages: { type: 'integer' }, pageWidth: { type: 'integer' } }, ['plot']),
        },
      },
      '/api/compose': {
        post: {
          summary: '图片 → 整页 SVG',
          ...ref('Compose', {
            templateId: { type: 'string' },
            images: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'object' }] },
            width: { type: 'integer' },
            outline: { type: 'boolean' },
          }, ['templateId', 'images']),
        },
      },
      '/api/ai-tools.json': { get: { summary: 'AI 工具定义 + system prompt', responses: { 200: { description: 'OK' } } } },
      '/api/ai/decide': {
        post: {
          summary: 'AI 导演：模型选版式 + 逐格排戏（规则先筛合法候选）',
          ...ref('AiDecide', {
            plot, culture, ratio: { type: 'string' },
            pageWidth: { type: 'integer' },
            candidates: { type: 'integer' },
            note: { type: 'string' },
            llm: {
              type: 'object',
              properties: {
                protocol: { type: 'string', enum: ['openai', 'anthropic'] },
                baseUrl: { type: 'string' },
                apiKey: { type: 'string' },
                model: { type: 'string' },
              },
            },
          }, ['plot']),
        },
      },
      '/api/llm/status': { get: { summary: '模型配置状态（不回显 Key）', responses: { 200: { description: 'OK' } } } },
      '/api/llm/test': {
        post: {
          summary: '模型连通性测试',
          ...ref('LlmTest', {
            llm: { type: 'object', properties: { protocol: { type: 'string' }, baseUrl: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' } } },
          }, []),
        },
      },
      '/api/rules': { get: { summary: '规则库全量导出（词典/权重/节拍，透明可审计）', responses: { 200: { description: 'OK' } } } },
      '/api/shapes': { get: { summary: '10 类格子形状 → 构图开头词', responses: { 200: { description: 'OK' } } } },
      '/api/prefix': {
        post: {
          summary: '按形状取一段可直接粘贴的构图开头片段',
          ...ref('Prefix', {
            shape: { type: 'string', enum: ['triangle', 'slant', 'inset', 'bleed', 'tall', 'wide', 'banner', 'small', 'square', 'grid'] },
            role: { type: 'string' },
            culture: { type: 'string', enum: ['jp', 'cn', 'kr'] },
          }, ['shape']),
        },
      },
      '/api/templates/{id}/shapes': {
        get: {
          summary: '模板内每格的形状判定与开头词',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/ai/prompts': {
        post: {
          summary: 'AI 提示词优化（每格压成高密度英文提示词，保留形状开头词）',
          ...ref('AiPrompts', {
            plot: { type: 'string' },
            templateId: { type: 'string' },
            characterSheet: { type: 'string' },
            note: { type: 'string' },
            pageWidth: { type: 'integer' },
            llm: { type: 'object', properties: { protocol: { type: 'string' }, baseUrl: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' } } },
          }, ['templateId']),
        },
      },
    },
  };
}
