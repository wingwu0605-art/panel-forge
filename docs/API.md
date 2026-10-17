# PanelForge API 参考

基址：`http://127.0.0.1:7311`（端口用 `PORT` 环境变量改）。
所有响应 `application/json; charset=utf-8`，全部带 `Access-Control-Allow-Origin: *`，可直接从浏览器或任意脚本调用。
报错统一形如 `{"error":"..."}`（4xx/5xx）。

---

## 目录

- [元信息](#元信息) · [/api/health](#get-apihealth) · [/api/meta](#get-apimeta)
- [模板](#模板) · [/api/templates](#get-apitemplates) · [/api/templates/{id}](#get-apitemplatesid) · [/api/templates/{id}/svg](#get-apitemplatesidsvg)
- [匹配](#匹配) · [/api/match](#post-apimatch) · [/api/analyze](#post-apianalyze)
- [分镜表](#分镜表) · [/api/plan](#post-apiplan)
- [拼图](#拼图) · [/api/compose](#post-apicompose)
- [AI 接入](#ai-接入) · [/api/ai-tools.json](#get-apiai-toolsjson) · [/api/openapi.json](#get-apiopenapijson)
- [其它](#其它) · [/api/sheet](#get-apisheet) · [/api/docs](#get-apidocs) · [/api/proxy](#get-apiproxy)
- [数据模型](#数据模型) · [错误码](#错误码)

---

## GET /api/health

```json
{ "ok": true, "service": "panel-forge", "templates": 138, "version": "1.0.0" }
```

## GET /api/meta

一次拿到全部枚举，写 UI / 拼提示词都靠它。

```json
{
  "templates": 138,
  "cultures": {
    "jp": { "zh": "日式页漫", "reading": "rtl", "count": 40, "tip": "黑白网点、大量速度线…" },
    "cn": { "zh": "中式彩漫", "reading": "ltr", "count": 38, "tip": "彩色、干净线稿…" },
    "kr": { "zh": "韩式条漫", "reading": "vertical", "count": 40, "tip": "细线＋柔和厚涂…" },
    "core": { "zh": "通用/跨界", "reading": "ltr", "count": 20, "tip": "中性骨架…" }
  },
  "intents": [{ "id": "action", "zh": "战斗动作", "en": "action", "beats": 6, "keywords": 33 }],
  "roles":   [{ "id": "impact", "zh": "冲击大格", "shot": "impact panel, dramatic wide" }],
  "ratios":  [{ "id": "a4", "label": "A4 页漫 1:1.414", "w": 1000, "h": 1414, "kind": "page" }],
  "frames":  ["ink", "bold", "hairline", "none"],
  "tags":    ["三段落", "大格", "斜切", "留白", "…"],
  "styles":  { "jp": { "prompt": "…", "negative": "…" } },
  "negative": "text, speech bubble, …",
  "endpoints": ["/api/templates", "…"]
}
```

`intents` 全集（16）：`action` `impact` `chase` `emotion` `dialogue` `reveal` `suspense` `horror` `romance` `gag` `inner` `montage` `silence` `daily` `climax` `scenery`

---

## GET /api/templates

列表（轻量，不含每格多边形细节）。

| 参数 | 说明 |
| --- | --- |
| `culture` | `jp` / `cn` / `kr` / `core` |
| `q` | 关键词，匹配 id / 名字 / 描述 / 标签 |
| `tag` | 精确标签，如 `斜切`、`留白` |
| `intent` | 戏路 id，如 `action` |
| `ratio` | `a4` `b5` `p34` `square` `wide` `strip` `tall` `scroll` |
| `density` | `low` `mid` `high` `dense` |
| `minPanels` / `maxPanels` | 格数区间 |
| `limit` / `offset` | 分页，`limit` ≤ 500 |
| `sort` | `id`（默认）/ `panels` / `panels-desc` |

```json
{
  "total": 40,
  "items": [{
    "id": "jp-shonen-3tier", "name": "少年漫·三段落とし（标准事件页）",
    "culture": "jp", "reading": "rtl", "ratio": "a4",
    "page": { "w": 1000, "h": 1414, "kind": "page" },
    "frame": "ink", "panels": 6, "density": "high",
    "tags": ["少年", "三段落", "大格", "全景", "特写"],
    "intents": ["action", "daily", "dialogue"],
    "desc": "上段「引き」交代空间…",
    "thumbSlots": [{ "id": "p1", "order": 1, "role": "wide", "poly": [[...]], "over": false }]
  }]
}
```

## GET /api/templates/{id}

完整模板。`slots[].poly` 是页面归一化坐标（页宽固定 1000），可直接当 SVG path 或 CSS clip-path 用。

```json
{
  "id": "jp-shonen-3tier", "name": "…", "culture": "jp", "reading": "rtl", "ratio": "a4",
  "page": { "w": 1000, "h": 1414, "kind": "page" },
  "frame": "ink", "tags": ["…"], "intents": ["…"], "density": "high", "desc": "…",
  "margin": 28, "gutter": 15,
  "slots": [{
    "id": "p1", "order": 1, "role": "wide",
    "poly": [[28,28],[972,28],[972,330],[28,330]],
    "x": 28, "y": 28, "w": 944, "h": 302,
    "aspect": 3.13, "area": 20.7,
    "borderless": false, "bleed": false, "over": false, "rot": 0, "note": ""
  }]
}
```

## GET /api/templates/{id}/svg

返回 `image/svg+xml`。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `width` | 1200 | 输出像素宽（200–4000） |
| `numbers` | 0 | `1` 画格号（按阅读顺序） |
| `roles` | 0 | `1` 画格子角色名（放得下才画） |
| `outline` | 1 | 无框模板是否画虚线参考轮廓；`0` = 干净无框 |
| `guides` | 0 | `1` 画版心参考线 |
| `bg` | `#ffffff` | 背景色 |

```bash
curl -o panel.svg "http://127.0.0.1:7311/api/templates/jp-shonen-3tier/svg?width=1400&numbers=1"
```

---

## POST /api/match

剧情 → 候选分镜排名。**不改任何状态，可随意调。**

```json
{ "plot": "雨夜屋顶，他拔刀，敌人背后偷袭，反手斩断对方刀锋", "culture": "jp", "ratio": "auto", "limit": 10 }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `plot` | ✅ | 剧情文本（中/日/韩/英都行，一段 100–400 字最准） |
| `culture` | | `all`(默认) / `jp` / `cn` / `kr` |
| `ratio` | | `auto`(默认) / `page` / `scroll` / `wide` / `square` |
| `limit` | | 默认 10，上限 50 |
| `includeCore` | | 默认 `true`，指定画风时是否仍混入通用模板 |

响应：

```json
{
  "analysis": {
    "chars": 26,
    "intents": [{ "id": "action", "zh": "战斗动作", "score": 6.55, "conf": 1, "hits": ["拔刀", "反手", "偷袭"] }],
    "primary": "action", "secondary": "climax",
    "panelTarget": 6, "cultureHint": null, "ratioHint": null,
    "pace": "fast", "dialogueDensity": 0, "explicitPanel": false
  },
  "results": [{
    "id": "jp-shonen-ladder", "name": "少年漫·阶梯格", "culture": "jp", "panels": 6,
    "ratio": "a4", "frame": "ink", "density": "high", "tags": ["…"], "intents": ["…"],
    "score": 95.17,
    "why": ["主打戏路匹配「战斗动作」", "画面气质命中：少年、斜切、动势", "节拍命中 83%（6 拍）", "画风体系：日式页漫"],
    "breakdown": { "intent": 1, "tags": 0.667, "beats": 0.872, "panels": 1, "culture": 1, "ratio": 0.6, "pace": 1 }
  }],
  "total": 138
}
```

`score` = 加权总分（0–100）：意图 24–26% / 节拍对齐 26–28% / 标签气质 11–14% / 格数贴合 13–14% / 画风 9–13% / 画幅 5–14% / 节奏 3%。
`breakdown` 是各项的 0–1 归一值，方便你自己再排序。

## POST /api/analyze

只做解析，不排序（调试/自建排序用）。

```json
{ "plot": "她低下头，握紧了伞柄" }
```

---

## GET /api/rules

规则库全量导出（透明可审计）。改关键词、调权重都可以先看这里。

```json
{
  "engine": { "type": "local-rules", "version": "2.0" },
  "stats": { "intents": 26, "keywords": 1150, "beats": 113, "roles": 22, "scenes": 7, "sceneWords": 86,
             "tones": 8, "toneWords": 51, "directives": 6, "dirWords": 37, "negators": 10, "total": 1459 },
  "weights": { "default": { "intent": 0.25, "tags": 0.12, "beats": 0.26, "panels": 0.13,
                            "culture": 0.10, "ratio": 0.05, "pace": 0.03, "tone": 0.06 }, "…": "…" },
  "keywordWeight": { "len1": 0.5, "len2": 1.0, "len3": 1.35, "len4plus": 1.6, "repeatCap": 3,
                     "negatedFactor": 0.15, "negatorWindow": 3 },
  "intents": [{ "id": "action", "zh": "战斗动作", "keywordCount": 62, "keywords": ["…"],
                "beats": [{ "id": "clash", "zh": "冲击瞬间", "roles": ["impact","action","low"], "en": "…" }] }],
  "scenes": { "…": "…" }, "tones": { "…": "…" }, "directives": { "…": "…" }, "negators": ["…"], "roles": { "…": "…" }
}
```

`/api/match` 的 `analysis` 在 v2 里多了这些字段：

| 字段 | 含义 |
| --- | --- |
| `intents[].hits` | 命中的具体关键词（可解释） |
| `sceneZh` / `eraHint` | 场景族与年代（校园/古代江湖/科幻…） |
| `toneZh` | 情绪基调（热血/压抑/诡异…） |
| `directives[]` | 命中的硬约束指令 |
| `hardFilters {kind, frame}` | 硬约束过滤条件 |
| `negated[]` | 被否定压制的关键词（「没有打斗」） |
| `ruleStats` | 规则库规模 |

响应顶层多一个 `filtered`：`{ applied, kind, frame, kept, note }`——硬约束是否真的过滤了模板。

---

## AI 导演（v2）

模型是你的，规则是我的。**模型只能在规则筛出的合法候选里挑**，不许发明格位。

### GET /api/llm/status

```json
{ "configured": false, "protocol": "openai", "model": "gpt-4o-mini",
  "host": "api.openai.com", "baseUrl": "https://api.openai.com/…", "keySet": false,
  "source": "none", "timeoutMs": 60000, "envVars": ["LLM_PROTOCOL","LLM_BASE_URL","LLM_API_KEY","LLM_MODEL","LLM_TIMEOUT_MS"] }
```

### POST /api/llm/test

```json
{ "llm": { "protocol": "openai", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-…", "model": "deepseek-chat" } }
```

成功：`{ "ok": true, "latencyMs": 812, "model": "deepseek-chat", "reply": "OK" }`
失败：`400 {"code":"NO_LLM_KEY", …}` / `502 {"code":"LLM_HTTP_401","hint":"Key 无效或无权限…"}`

### POST /api/ai/decide

```json
{
  "plot": "雨夜屋顶，他拔刀，反手斩断对方刀锋，两人在积水里僵持。",
  "culture": "jp",
  "ratio": "auto",
  "pageWidth": 1600,
  "candidates": 10,
  "note": "这一页要冷色调、不要台词",
  "llm": { "protocol": "openai", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-…", "model": "deepseek-chat" }
}
```

响应（节选）：

```json
{
  "ok": true, "mode": "llm",
  "analysis": { "primary": "action", "panelTarget": 6, "…": "…" },
  "candidates": [{ "id": "jp-shonen-ladder", "name": "…", "score": 84.6, "why": ["…"] }],
  "decision": {
    "pick": "jp-shonen-ladder", "pickName": "少年漫·阶梯格",
    "confidence": 0.86,
    "reason": "六格的阶梯式下落正好接住「拔刀—被袭—反手」的三段加速",
    "alternatives": [{ "id": "jp-shonen-bleed", "reason": "…" }],
    "quality": { "corrected": false, "dropped": [], "missing": [] }
  },
  "plan": { "template": { "…": "…" }, "panels": [{
      "id": "p1", "order": 1, "roleZh": "全景", "beat": "摆开架势",
      "content": "雨夜屋顶，积水映着远处的霓虹，两人相隔十步",
      "dialogue": "",
      "promptEn": "wide full-body shot, …, subject: 雨夜屋顶，积水映着远处的霓虹…, japanese manga style, …",
      "genSize": "1280x1024", "clipPath": "polygon(…)"
  }] },
  "llm": { "model": "deepseek-chat", "protocol": "openai", "latencyMs": 6400,
           "usage": { "total_tokens": 1600 }, "endpointHost": "api.deepseek.com" }
}
```

没配 Key 时返回 `400 {"code":"NO_LLM_KEY","fallback":{"top":[…]}}`——规则路结果照常可用。

安全阀（`decision.quality` 会告诉你触发过哪条）：

| 情况 | 处理 |
| --- | --- |
| 模型编了个不存在的 `pick` | 纠正为最接近的合法候选，`corrected: true` |
| 给了不存在的 `slotId` | 丢弃，记进 `dropped` |
| 有格子没排到戏 | 回落到规则节拍的景别提示词，记进 `missing` |

模型配置优先级：请求体 `llm` > 环境变量 `LLM_*` > 内置默认（`api.openai.com` / `gpt-4o-mini`）。

---

## POST /api/plan

剧情 → 逐格分镜表。**这是主要产出**。

```json
{
  "plot": "雨夜屋顶，他拔刀，反手斩断对方刀锋，两人在积水里僵持。",
  "culture": "jp",
  "maxPages": 3,
  "pageWidth": 1600,
  "templateId": "jp-shonen-3tier",
  "intent": "action"
}
```

| 字段 | 说明 |
| --- | --- |
| `plot` | 剧情；配合 `templateId` 时可留空（此时用模板首个戏路当骨架） |
| `culture` / `ratio` | 同 `/api/match` |
| `maxPages` | 1–8，默认 3；剧情长时按标点切段，一段一页 |
| `pageWidth` | 整页导出宽度，决定每格像素尺寸，默认 1600 |
| `templateId` | 指定版式则跳过匹配 |
| `intent` | 强制用某个戏路的节拍骨架 |

响应（节选）：

```json
{
  "pages": [{
    "pageIndex": 1,
    "segment": "雨夜屋顶，他拔刀…",
    "analysis": { "primary": "action", "panelTarget": 6, "…": "…" },
    "templateScore": 95.17,
    "plan": {
      "template": { "id": "jp-shonen-ladder", "name": "…", "culture": "jp", "reading": "rtl",
                    "ratio": "a4", "page": {"w":1000,"h":1414}, "frame": "ink", "panels": 6 },
      "intent": "action", "intentZh": "战斗动作",
      "beatCoverage": 0.833, "beatQuality": 1,
      "readingOrder": "右 → 左，上 → 下",
      "pageWidth": 1600,
      "style": { "culture": "jp", "zh": "日式页漫",
                 "prompt": "japanese manga style, monochrome black and white, sharp ink lineart, screentone shading…",
                 "negative": "color, gradient shading, …, text, speech bubble, watermark",
                 "tip": "黑白网点、大量速度线…" },
      "panels": [{
        "id": "p1", "order": 1, "role": "wide", "roleZh": "全景",
        "shot": "wide shot", "shotZh": "全景",
        "beat": "摆开架势", "beatId": "setup",
        "beatHint": "双方位置与距离", "composition": "全身入画，动作方向清晰，留出运动空间",
        "aspect": 0.594, "aspectLabel": "9:16 (0.59)", "genSize": "576x1152",
        "sizePx": { "w": 950, "h": 1600 },
        "areaPct": 12.6,
        "box": { "x": 28, "y": 28, "w": 400, "h": 674 },
        "poly": [[28,28],[428,28],[428,674],[28,674]],
        "clipPath": "polygon(2.8% 1.98%, 42.8% 1.98%, 42.8% 47.67%, 2.8% 47.67%)",
        "promptEn": "wide full-body shot, character small in frame, environment visible, fighters taking stance, measuring the distance, subject: {{characters and setting from your story}}, japanese manga style, …, aspect ratio 9:16, single panel, no text, no speech bubble, no panel border",
        "promptZh": "【1｜全景／摆开架势】全身入画，动作方向明确…",
        "negative": "color, gradient shading, soft painting, …, extra fingers, deformed hands, lowres"
      }],
      "notes": ["共 6 格，阅读顺序：从右往左", "…"]
    }
  }],
  "analysis": { "…": "…" },
  "segmentCount": 1
}
```

要点：

- `panel.poly` 与 `clipPath` 是同一块区域的两副面孔：做 SVG 用 `poly`，做 CSS/DOM 用 `clipPath`。
- `genSize` 是按 `aspect` 贴近常用出图分辨率表给的（如 `832x1216`、`1344x768`），直接填进 SD/Midjourney。
- `beat` 为空 = 这一格没派到节拍，当「通用镜头」用（提示词已按格型给景别）。
- 剧情超过一页信息量时 `pages` 会有多页，每页是独立版式。

---

## POST /api/compose

图片 → 整页 SVG。

```json
{
  "templateId": "ref-4band-2col",
  "images": ["https://…/01.png", "data:image/png;base64,…"],
  "width": 1600,
  "outline": true,
  "format": "json"
}
```

| 字段 | 说明 |
| --- | --- |
| `templateId` | ✅ |
| `images` | 两种写法：**数组**＝按阅读顺序填；**对象**＝`{ "p1": "url", … }` 精确指定格子 |
| `width` | 输出宽，默认 1600 |
| `outline` | 无框模板是否画虚线参考轮廓（`false` = 干净成品） |
| `format` | `json` 返回 `{svg: "…"}`；缺省直接返回 `image/svg+xml` |

对象写法可带细节：`{ "p3": { "href": "…", "zoom": 1.2, "panX": 40, "panY": -20, "mode": "contain", "rotate": 0 } }`
（`zoom`/`pan`/`rotate` 只在提供了图片原始宽高 `iw`/`ih` 时精确生效；否则等比裁切填满。）

```bash
# 返回 SVG 文件
curl -o page.svg http://127.0.0.1:7311/api/compose \
  -H 'content-type: application/json' \
  -d '{"templateId":"jp-shonen-3tier","images":["https://…/1.png","https://…/2.png"]}'

# 返回 JSON（含 svg 字符串）
curl -s 'http://127.0.0.1:7311/api/compose?format=json' … -d '{…}'
```

---

## AI 接入

### GET /api/ai-tools.json

```json
{
  "systemPrompt": "你是资深漫画分镜导演…",
  "tools": {
    "openai":    [{ "type": "function", "function": { "name": "match_panels", "parameters": {...} } }],
    "anthropic": [{ "name": "match_panels", "description": "…", "input_schema": {...} }]
  },
  "http": { "match": "POST …/api/match", "plan": "POST …/api/plan", "…": "…" },
  "examples": { "match": "curl …", "plan": "curl …" }
}
```

五个工具：`match_panels`、`plan_storyboard`、`list_templates`、`get_template`、`compose_page`。

### GET /api/openapi.json

OpenAPI 3.0.3，9 个 path，可直接丢进 Postman / Apifox / 任何代码生成器。

---

## 其它

### GET /api/sheet

`?culture=all|jp|cn|kr|core` — 全部模板的可视化接触表（HTML，给人看的）。

### GET /api/docs

简版端点一览（HTML）。

### GET /api/proxy

`?url=https://…` — 图片代理。用途：让浏览器把远程图片转成 dataURI，导出 PNG 时才不会被跨域污染；也给 `compose` 提供免跨域素材。

---

## 数据模型

### 模板 Template

```ts
{
  id: string; name: string; culture: 'jp'|'cn'|'kr'|'core';
  reading: 'rtl'|'ltr'|'vertical';
  ratio: 'a4'|'b5'|'p34'|'square'|'wide'|'strip'|'tall'|'scroll';
  page: { w: number; h: number; kind: 'page'|'spread'|'scroll' };
  frame: 'ink'|'bold'|'hairline'|'none';
  tags: string[]; intents: IntentId[]; density: 'low'|'mid'|'high'|'dense';
  desc: string; margin: number; gutter: number;
  slots: Slot[];
}
```

### 格子 Slot

```ts
{
  id: string; order: number;            // order = 阅读顺序（1 起）
  role: RoleId;                          // 全景/特写/冲击大格…，见 /api/meta
  poly: [number, number][];              // 归一化多边形，页宽 1000
  x, y, w, h: number;                    // 外接矩形
  aspect: number;                        // w/h
  area: number;                          // 占页面积百分比
  borderless?: boolean; bleed?: boolean; over?: boolean; rot?: number;
}
```

### 阅读顺序

- `rtl`（日式）：同一横带内从右往左；带上到下。格号从右上角开始。
- `ltr`（中式页漫/印刷韩漫）：从左往右。
- `vertical`（条漫/webtoon）：只按上 → 下；同一带内从左往右。

---

## 错误码

| 状态 | 场景 |
| --- | --- |
| 400 | 缺 `plot`（且没给 `templateId`）、请求体不是 JSON |
| 404 | 模板不存在、未知端点 |
| 500 | 服务端异常（响应含 `error` 文本） |
| 502 | `/api/proxy` 上游失败 |
