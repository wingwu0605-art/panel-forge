# 让 AI 用起来（System Prompt + 工具 + 工作流）

目标：**你给剧情，AI 给可落纸的分镜方案**——不是文学描述，而是「第 3 格用大特写、仰视、血流过刀尖」
这种能直接开画的指令。

---

## 一、三种接法

| 接法 | 适合 | 做法 |
| --- | --- | --- |
| **HTTP 直连** | DeepSeek / 自建 agent / 脚本 | AI 通过工具调用 `/api/match`、`/api/plan`（推荐，最稳） |
| **函数调用（function calling）** | ChatGPT、Claude Desktop、Cursor 等 | 把 `GET /api/ai-tools.json` 的 `tools.openai` 或 `tools.anthropic` 原样注册 |
| **纯提示词** | 不联网的模型，手里只有网页 | 贴下面的 system prompt，让 AI 自己按格式输出，你手动在网页里选模板 |

---

## 二、System Prompt（可直接复制）

见 `GET /api/ai-tools.json` 的 `systemPrompt` 字段，内容如下：

```text
你是资深漫画分镜导演（komawari / 스토리보드），正在配合 PanelForge 分镜坊的模板库工作。

你的任务：把我（作者）给的剧情文字，变成"可直接执行的漫画分镜方案"——不是文学描述，而是可落纸的格位安排。

必须遵守的调用规则：
1. 先用 match_panels 拿候选模板（culture 由剧情决定：日式页漫=jp，中式条漫/国风=cn，韩式竖屏=kr，不确定=all）。
2. 选定模板后，用 plan_storyboard 拿逐格分镜表（含每格景别、构图意图、生图提示词、推荐出图尺寸）。
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

语气：直接、专业、给判断，不要客套。
```

---

## 三、工具定义

`GET /api/ai-tools.json` → `tools.openai`（OpenAI 格式）/ `tools.anthropic`（Anthropic 格式）。

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `match_panels` | `plot`*, `culture`, `ratio`, `limit` | 候选版式 + 分数 + 匹配理由 |
| `plan_storyboard` | `plot`*, `culture`, `ratio`, `maxPages`, `pageWidth` | 逐格分镜表（景别/构图/提示词/出图尺寸） |
| `list_templates` | `culture`, `minPanels`, `maxPanels`, `intent`, `ratio` | 模板库存 |
| `get_template` | `templateId`* | 单模板几何数据 |
| `compose_page` | `templateId`*, `images`*, `width`, `outline` | 整页 SVG |

> 真正调用时把工具名映射到 `POST /api/match`、`POST /api/plan`、`GET /api/templates`、`GET /api/templates/{id}`、`POST /api/compose`。

---

## 四、标准工作流

```
作者：给我这场戏的分镜——雨夜，主角在屋顶被偷袭，反手斩断对方的刀，两人在积水里僵持。

AI：
1) match_panels(plot="雨夜…僵持", culture="jp")
   → jp-shonen-ladder 95.2 / jp-shonen-bleed 95.2 / jp-triangle-impact 93.2
2) plan_storyboard(plot="…", culture="jp", maxPages=1, pageWidth=1600)
   → 6 格，阅读顺序 右→左
3) 输出逐格表（见下）
```

产出示例（第 1–3 格）：

| 格 | 景别 | 节拍 | 画幅 | 建议出图 | 画面 |
| --- | --- | --- | --- | --- | --- |
| 1 | 全景（wide） | 摆开架势 | 9:16 | 576×1152 | 屋顶积水反光，两人相隔十步，雨丝斜切画面 |
| 2 | 动作格 | 发起攻击 | 9:16 | 576×1152 | 刀出鞘的瞬间，手腕出画格 |
| 3 | 动作格 | 冲击瞬间 | 1:2 | 576×1152 | 两刀相撞，火花与雨水炸开 |

```
第 1 格提示词：
wide full-body shot, character small in frame, environment visible, fighters taking stance,
measuring the distance, subject: 两个黑衣剑客, rooftop in the rain at night, wet tiles
reflecting neon, japanese manga style, monochrome black and white, sharp ink lineart,
screentone shading, cross-hatching, high contrast, aspect ratio 9:16,
single panel, no text, no speech bubble, no panel border
```

---

## 五、把提示词变成"不廉价的画"

### 1. 先锁画风，再锁角色

- **画风包**：`plan.style.prompt` 已含该体系的核心笔法（网点/赛璐璐/厚涂），**不要删**。
- **角色一致性**：把主角的外观写成一个固定字符串（发色/瞳色/服装/年龄），每次都塞进 `subject:` 后的 `{{…}}` 位置：

  ```
  subject: 18-year-old swordsman, black bob cut, scar over left eyebrow,
           dark high-collar coat, silver katana
  ```

- 进阶：先生成一张「角色三视图 / 设定板」，之后每格用 **img2img / reference image / seed 锁定**。
- 同一页内所有格子**沿用同一个 seed 与同一段风格词**，只有 `subject` 与景别变。

### 2. 按 `genSize` 出图，再塞进格子

`genSize` 是按格子的真实长宽比贴近的常用分辨率。**先按它出图，再填格**，比「出方图再裁」锐利得多。

### 3. 负面词照抄

每格都给了 `negative`（含 `speech bubbles, text, watermark, deformed hands…`）。
AI 漫画最常见的翻车是**画面里自带对白泡**——一定要把 `speech bubble` 写进负面词，气泡后期自己排。

### 4. 斜切格的图要留「安全边」

三角形/梯形格子会裁掉四角，重要信息（脸、手）尽量放中心；`panel.clipPath` 可直接在预览里验证。

### 5. 一页里别超过两种景别

真实分镜的景别是**跳**的：大远景 → 大特写，中间不要塞一堆中景。
`plan` 给出的节拍序列就是这种跳跃，别把它改平滑。

---

## 六、常见错误

| 错误 | 后果 | 正确做法 |
| --- | --- | --- |
| 让模型「发明」格子坐标 | 版面重叠、比例失控 | 格位永远来自模板 id |
| 每格都写「masterpiece, best quality」 | 画风飘、不统一 | 用 `plan.style.prompt` |
| 忽略 `reading` | 日式页面从左上读，叙事错乱 | 按 `order` 顺序填图 |
| 剧情太长硬塞一页 | 每格信息过载 | 拆分 `maxPages`，一页一场戏 |
| 用 1:1 方图填 9:16 竖格 | 裁掉半张脸 | 按 `genSize` 出图 |

---

## 六、方式二：让本服务的「AI 导演」替你决定

上面的做法是「你有一个 AI，让它调我的接口」。
反过来的做法是：**你给我一个模型 API，我的服务自己当导演**——规则先筛合法候选，模型只负责挑和排戏。

### 6.1 配置

网页左栏「AI 导演」填三项即可（存在本机 `localStorage`）：

| 项 | 例子 |
| --- | --- |
| 协议 | OpenAI 兼容 / Anthropic |
| Base URL | `https://api.deepseek.com/v1`、`https://api.openai.com/v1`、`http://127.0.0.1:11434/v1`（Ollama）、`https://dashscope.aliyuncs.com/compatible-mode/v1`（通义） |
| 模型 | `deepseek-chat`、`gpt-4o-mini`、`claude-3-5-sonnet-latest`、`qwen-plus`、`llama3.1` |

服务端也可以直接用环境变量（适合容器/无人值守）：

```bat
set LLM_PROTOCOL=openai
set LLM_BASE_URL=https://api.deepseek.com/v1
set LLM_MODEL=deepseek-chat
set LLM_API_KEY=sk-...
```

点「测试连接」会发一个极短请求验证 Key 与路径，错误会直说原因：

| 报错 | 意思 |
| --- | --- |
| `NO_LLM_KEY` | 没填 Key |
| `LLM_HTTP_401 / 403` | Key 不对、或 baseUrl 与服务商不匹配 |
| `LLM_HTTP_404` | baseUrl 路径不对（OpenAI 兼容端一般填到 `…/v1`） |
| `LLM_HTTP_429` | 额度或频率受限 |
| `LLM_TIMEOUT` | 超时（默认 60s，可用 `LLM_TIMEOUT_MS` 调） |

### 6.2 它比「规则路」多给了你什么

规则路给你「格位 + 景别 + 提示词 + 出图尺寸」。
AI 路在此之上多出：

- **每格的画面内容**（`plan.panels[].content`）：谁、在哪、什么动作、什么表情、光从哪来；
- **每格的台词/旁白**（`plan.panels[].dialogue`）；
- **导演的选择理由**（`decision.reason`）与置信度、备选版式；
- 这些内容会被**注入生图提示词**的 `subject:` 位置，所以出图直接贴合剧情，不用你手改提示词。

### 6.3 安全阀（为什么不怕模型瞎编）

```
规则引擎 ──10 个合法候选（含每格 id/角色/阅读顺序）──▶ 模型
   ▲                                                    │
   └──── pick 不在候选里 → 自动纠正；slotId 瞎编 → 丢弃；缺格 → 回落规则节拍 ────┘
```

所以 AI 路最差的结果也和规则路一样能用，不会出现「格子重叠 / 格数对不上 / 坐标乱飞」。

### 6.4 什么时候用哪条路

| 场景 | 建议 |
| --- | --- |
| 批量出稿、要快、要免费 | 规则路 |
| 剧情绕、人物关系复杂、需要「排戏」 | AI 路 |
| 先看候选再决定 | 规则路挑，挑完不满意再点 AI 路 |
| 离线 / 内网 / 断网 | 规则路（AI 路会明确报错并给兜底） |

### 6.5 自测（不需要真 Key）

```bash
node scripts/test-llm-mock.mjs
```

它会起一个本地假模型，验证：endpoint 自动补全、鉴权头、JSON 解析、
非法 pick 纠正、无效 slotId 丢弃、缺格回落、usage 回传——14 项断言。

---

## 六.6 提示词这一段怎么调（最关键）

规则版提示词已经是「形状开头词 + 景别 + 节拍 + 画风包 + 画幅 + 负面词」，
但真正决定出图质量的是**你自己补的那部分**。按这个顺序拼：

```
[形状开头词]            ← 直接抄 API 的 shape.prefixEn，不要改
[角色设定（固定串）]      ← 每格原样复制，只改动作/表情
[动作 + 环境 + 光]
[画风包]                ← plan.style.prompt
[画幅]                  ← plan.panels[].aspectLabel
```

三个常见翻车点：

| 症状 | 原因 | 改法 |
| --- | --- | --- |
| 塞进三角格后脑袋被裁 | 没带形状开头词，模型按满画幅构图 | 把 `shape.prefixEn` 放到最前面 |
| 每格主角长得不一样 | 角色描述每格重写了一遍 | 用「角色设定」固定串，整页不动 |
| 画面里出现对话框/文字 | 漏了负面词 | 抄 `plan.panels[].negative`，里面已含 `speech bubbles, text` |

点「AI 优化提示词」会把每格压成 ≤55 词的高密度版本，
`promptEnRule` 保留规则版原文，随时能对比回滚。

---

## 七、自建集成（不用工具调用）

```js
// 1. 选版式
const { results } = await fetch('http://127.0.0.1:7311/api/match', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ plot: story, culture: 'kr', limit: 5 }),
}).then(r => r.json());

// 2. 出分镜表
const { pages } = await fetch('http://127.0.0.1:7311/api/plan', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ plot: story, culture: 'kr', maxPages: 2, pageWidth: 1600 }),
}).then(r => r.json());

// 3. 逐格生图（你的模型），按 order 排序
const images = await Promise.all(pages[0].plan.panels.map(p => text2image(p.promptEn, p.genSize)));

// 4. 拼整页
const svg = await fetch('http://127.0.0.1:7311/api/compose', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ templateId: pages[0].plan.template.id, images, width: 1600 }),
}).then(r => r.text());
```

`compose` 也可以完全绕过：把图片按 `order` 拖进网页，点「导出 PNG」。

---

## 八、调试技巧

- `POST /api/analyze`：只跑剧情解析，看意图分布对不对；不对就改关键词（`lib/taxonomy.mjs`）。
- `plan.beatCoverage < 0.6`：说明这个模板的格型与戏路不搭，换一个。
- `breakdown.beats` 高但 `breakdown.tags` 低：版式能用、气质不对，换个同格型的另一套。
- 同一段剧情换 3 个候选模板各导出一次，肉眼对比——比看分数更快。
