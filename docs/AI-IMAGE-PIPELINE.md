# AI 生图全流程（v0.9.0 实测版）

> 这份文档描述**现在真实在跑**的链路，每一段都标了文件与函数，方便核对。
> 不是设计稿 —— 凡是没做的，都在最后「缺口」里列清楚。

```
① 填剧情
      │
      ▼
② 剧情 → 选模板      POST /api/match         lib/matcher.mjs
      │
      ▼
③ 模板 + 剧情 → 逐格分镜   POST /api/plan / buildPlan   lib/matcher.mjs
      │                    （可选）POST /api/ai/split     lib/llm-core.mjs
      │                    （可选）POST /api/ai/decide    lib/llm-core.mjs
      ▼
④ 单格提示词组装      promptParts → effectivePrompt → buildImagePrompt   web/app.js
      │
      ▼
⑤ 单格出图            api.imageGenerate            lib/llm-core.mjs generateImage()
      │
      ▼
⑥ 回填 + 候选          imageAsset()（下采样 2000px）     web/app.js
      │
      ▼
⑦ 落版 / 绘制 / 导出   lib/svg.mjs · Klecks · clipToSlot
```

---

## ① 准备（一次性）

| 项 | 存哪 | 说明 |
| --- | --- | --- |
| Base URL / API Key | `localStorage`（`saveLlm`） | **只在本机浏览器**，不进构建产物、不进仓库 |
| 文本模型 | 同上 | 用于 AI 排版、AI 切分、逐格提示词 |
| 生图模型 + 图服务商 | 同上 | `imageProvider`: `openai` / `siliconflow` / `stability` |
| 角色卡（角色参考图） | IndexedDB | 名字 + 备注 + 参考图；勾选才生效，最多 3 张进 `refs` |

- 开发版（`node server.mjs`）：可走 `/api/llm/*` 中转，绕开 CORS。
- 静态版（GitHub Pages / APK）：**浏览器直连**你的服务商，因此需要对方允许跨域；
  不允许的（部分国内厂商）得自建代理。

---

## ② 剧情 → 选模板

```js
POST /api/match  { plot, culture, ratio, limit }
```
- 引擎：`lib/matcher.mjs` 规则版 —— **26 戏路 / 1150 关键词 / 113 节拍 / 7 幕景线 / 8 基调**
- 输出：候选模板列表（含命中理由、分数）
- 选一个 → 载入 `state.tpl`（138 套，带 `poly` / `clipPath` / 每格格型）

> AI 版可跳过：`POST /api/ai/decide`（`aiDecide`）让模型在规则候选里自己挑并排戏。

---

## ③ 模板 + 剧情 → 逐格分镜

```js
POST /api/plan { plot, culture, maxPages, pageWidth }
```
内部：`buildPlan(tpl, analysis, { plot })`

1. **切句**：`splitClauses(text)` —— 按 `。！？；\n` 切；不够格数时 `assignSegments` 再按 `，,、` 切
2. **每格产出**：

| 字段 | 含义 |
| --- | --- |
| `beat` | 节拍（如「揭开架势」） |
| `content` | 这段剧情原文（切给这一格的部分） |
| `shot` | 景别（26 种，含英文 `wide shot` 等） |
| `intent` | 构图意图（交代关系 / 冲击 / 停顿…） |
| `genSize` | 建议生图尺寸（按格子宽高比算） |
| `negative` | 这一格的避免项 |
| `promptEn` / `promptZh` | 可直接喂模型的提示词（中/英） |
| `shape.prefixEn` | 形状开头词（如 `full body shot, wide panel`） |

3. **可选 AI 增强**

| 接口 | 模型做啥 | 代码 |
| --- | --- | --- |
| `POST /api/ai/split` | 把长文本按格数切准 + 补画面描述 | `aiSplitPanels`（`SYSTEM_SPLITTER`） |
| `POST /api/ai/decide` | 在候选模板里挑一个并排戏 | `aiDecide`（`SYSTEM_DIRECTOR`） |
| `api.prompts`（单格） | 只改写这一格的提示词 | `generateSlotPromptOnly` |

---

## ④ 单格提示词组装（三源共存）

```
promptParts(slotId)          ← web/app.js
  ├─ rule : panel.promptEnRule ?? panel.promptEn ?? autoPromptOf(slot, panel)
  ├─ ai   : panel.aiOptimized ? panel.promptEn : ''      （AI 改写后覆盖 promptEn，原值留在 promptEnRule）
  ├─ mine : state.promptEdits[slotId].prompt             （手写）
  └─ prefix: panel.shape.prefixEn
          │
          ▼
effectivePrompt(slotId)      ← 按 state.promptSrc 选源；按 state.promptPrefix 决定开头词留不留
          │
          ▼
buildImagePrompt(slotId)     ← 真正发出去的那一段
  full = `${chars.block} ${effectivePrompt.prompt}` + (negative ? ` | avoid: ${negative}` : '')
```

**发出去的样子：**

```
角色一致性：小龙（17岁，黑色短发）…外观、发型、服装、年龄必须与参考图完全一致，不要换脸。
full body shot, wide panel,
雨夜的屋顶上，他缓缓拔出刀，雨水顺着刀锋流下；敌人从背后偷袭。wide shot，交代人物的对立与距离。
| avoid: 文字, 水印, 多余的手指, 严重变形
```

- 界面里 `#slotPromptSent` **原样显示这段**（所见即所得，不用猜）。
- 角色卡没勾选时会提示：「生成的图可能每格长得不一样，仍要继续吗？」

---

## ⑤ 单格出图

```js
// web/app.js  generateSlotImage()
api.imageGenerate({
  prompt: built.full,          // 上面那段
  refs: charPayload.refs,      // 角色参考图（dataURL，最多 3 张）
  size: panel.genSize,         // 按格子比例
  model: state.llm.imgModel,
  provider: state.llm.imageProvider,
})
```

落到 `lib/llm-core.mjs → generateImage()`，三条分支：

| 服务商 | 端点 | 请求 | 参考图 |
| --- | --- | --- | --- |
| **openai**（有 refs） | `{base}/v1/images/edits` | multipart：`model` `prompt` `n` `size` `image[]`×N | ✅ 最多 4 张（gpt-image-1 多图参考） |
| **openai**（无 refs） | `{base}/v1/images/generations` | JSON：`model` `prompt` `n` `size` `response_format=b64_json` | — |
| **stability** | `{base}/v2beta/stable-image/generate/core` | multipart：`prompt` `aspect_ratio` `output_format=png`；有 refs 时加 `init_image`+`strength=0.55` | ✅ 单张 |
| **siliconflow** | `{base}/v1/images/generations` | JSON：`model`(默认 `Kwai-Kolors/Kolors`) `prompt` `image_size`；有 refs 时 `image` | ✅ 单张 |

**尺寸适配** `fitImageSize(provider, genSize, model)`：

- OpenAI：按模型名认枚举；认不出就按比例猜 `1024x1024` / `1792x1024` / `1024x1792`
- 硅基：`1024x1024 / 768x1024 / 1024x768 / 1280x720 / 720x1280 / 1152x864 / 864x1152` 取最近
- Stability：`1:1 / 3:2 / 2:3 / 4:5 / 5:4 / 9:16 / 16:9 / 21:9` 取最近

**报错带路**：`code` + `hint`（`NO_LLM_KEY` 未配置、`IMAGE_HTTP_401` Key 无权限、
`IMAGE_HTTP_403` 可能被内容审核拦、`IMAGE_HTTP_404` 端点不对 → 换服务商）。超时 120 秒。

---

## ⑥ 回填 + 候选

1. 拿到 `href`：`b64` → `data:image/png;base64,…`；`url` → 能代理就代理，否则直连
2. `imageAsset(href)`：**下采样到长边 2000px**，存成 Blob + blobURL（省内存）
3. `state.images[slotId] = asset` → 重绘画布 / 格子面板 / 分镜表
4. **候选**：每次生成都 `candsOf(slotId).unshift(href)`，最多留 **8 张**，可随时切回

---

## ⑦ 落版 / 绘制 / 导出

- **渲染**：`lib/svg.mjs` 单一几何真相 —— 屏幕与导出共用同一份 `imageAttrs()` + 格子 `clipPath`
  （所以「看到的」和「导出的」不会不一致）
- **我们的画布**：Klecks 嵌入式引擎，白底/透明可选、格子外压灰做形状参考，完成时 `clipToSlot()` 按多边形裁切
- **外部 App**：`cellSheetBlob()` 导出带形状参考的底图 → `ShareTo` 直跳其它绘画 App → 画完分享回来自动填格
- **导出**：单格 PNG/JPG、整页 PNG/SVG、镂空 SVG、JSON、分镜表 `.md`、全部页
- **持久化**：IndexedDB `drafts/pages`（meta）+ `drafts/img:<pageId>`（图片 Blob 分离）

---

## 缺口（诚实清单，按画师实际痛感排序）

| # | 缺什么 | 影响 | 大概工作量 |
| --- | --- | --- | --- |
| 1 | **批量出图**：现在只能一格一格点，没有整页排队 + 进度 + 失败重试 | 8 格要点 8 次，改一格描述要重来 | 1–2 天（job 队列 + 并发闸 + 重试） |
| 2 | **局部重绘（inpaint）**：只能整格重出 | 画师最想要的「只修这张脸」做不到 | 2–3 天（遮罩 UI + edits 端点） |
| 3 | **一致性只有提示词 + 参考图**：没有 IP-Adapter / LoRA / 逐格种子锁定 | 多格之间人物会漂 | 依赖服务商能力，接就是配置层工作 |
| 4 | **没有质检**：出图后不做人脸/构图/水印检查，也不记成本 | 批量时无人兜底 | 1 天（简单检测 + 花费统计） |
| 5 | **透明底 / 线稿模式**：`output_format` 固定 png | 需要透明素材时要再处理 | 半天 |
| 6 | **静态版跨域**：直连第三方，部分服务商需要自建代理 | Pages/APK 上某些厂商用不了 | 半天（加个可选的代理地址字段） |

> 建议下一轮做 **1（批量出图）** —— 它是把「能用」变成「画一话」的分水岭，
> 而且和已经有的候选机制、IndexedDB 存储天然贴合。
