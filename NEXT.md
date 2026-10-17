# NEXT.md · 交接单（给下一个会话的我）

> 现在这个仓库已经有几百个提交、功能很多。**新会话先读这个文件**，不要盲目全量读代码。

## 一、跑起来（Windows，node 不在 PATH）

```powershell
$env:PATH = "D:\nodejs;$env:PATH"
cd "D:\harness workspace\新建文件夹\panel-forge"
node server.mjs                 # http://127.0.0.1:7311/
node scripts/build-static.mjs   # 生成 site/ 给 Pages
node scripts/validate.mjs       # 138 套模板版面体检
node scripts/test-api.mjs       # 41 项
node scripts/test-llm-mock.mjs  # 22 项（会自己起 mock 在 7399，先确保 7399 没被占）
```

线上：https://wingwu0605-art.github.io/panel-forge/
仓库：https://github.com/wingwu0605-art/panel-forge （Pages 从 main 自动构建）

推送：`git push origin main` 即可（GitHub 凭据已缓存在 Windows 凭据管理器）。

## 二、目录速查

| 路径 | 内容 |
| --- | --- |
| `lib/library-*.mjs` | 138 套模板数据（jp 40 / cn 38 / kr 40 / core 20）|
| `lib/matcher.mjs` | 规则引擎 + `buildPlan()`（**提示词就是这里拼的**）|
| `lib/shapes.mjs` | 10 类格子形状 → `prefixEn/prefixZh/suffixEn/suffixZh` |
| `lib/llm-core.mjs` | 浏览器/Node 共用：prompt 常量、`chat()`、`aiDecide`、`optimizePrompts`、`generateImage`（三服务商）|
| `lib/llm.mjs` | Node 入口：读 `LLM_*` 环境变量后转交 core |
| `web/app.js` | 前端全部逻辑（~2900 行，无框架）|
| `web/api-static.js` | 静态版 API（规则引擎在浏览器里跑 + 直连模型）|
| `server.mjs` | 零依赖 HTTP 服务：页面 + `/api/*` |

## 三、提示词是怎么生成的（用户最常问）

`lib/matcher.mjs` 的 `buildPlan()`：

```
① shape.prefixEn（形状开头词）
② role.prompt（景别/机位）
③ beatEn()（叙事节拍）
④ subject: <AI 排戏给的 content>，没有则是占位符
⑤ style.prompt（画风包 jp/cn/kr）
⑥ shape.suffixEn
⑦ aspect ratio x:y
⑧ subject centered in the safe area, generous headroom and margin for cropping
⑨ single panel, no text, no speech bubble, no panel border
```

`negative = dedupeTerms(shape.negative, style.negative, COMMON_NEGATIVE)`
另外还有 `promptShort`（精简版）和 `promptZh`（中文版，以 `prefixZh` 开头）。

## 四、当前功能清单（都已上线）

- 138 套模板浏览 / 镂空 / 拖图粘贴 / 按阅读顺序填充
- 剧情 → 规则匹配（26 戏路 / 1150 关键词）
- 每格：本格句子、中英形状词（各带复制）、「这里应该是」建议句
- 气泡：14 种、可拖/缩/转/调透明度、放进气泡
- 撤销重做（60 步）、完整快捷键、`?` 快捷键表
- **多页**：页签 + 加一页 + 导出全部页（存 IndexedDB，关浏览器不丢）
- **角色参考图**：多角色卡、512px 压缩、跨页复用、生图时自动注入（提示词层 + 图片层）
- **AI 导演**：二级菜单管理多家 Key（DeepSeek/OpenAI/硅基流动/Anthropic/Moonshot/自定义），可切换
- **AI 生图**：三服务商尺寸适配、候选图（重画/换一张）、每格独立
- 静态版直连模型（浏览器直连，失败回落本机服务端）

## 五、这一轮刚改、**尚未目视验证**的（优先确认）

1. 删掉「分镜表」标签页，信息并入小框新增的「这一格的分镜」段
   - 检查：`#slotBoard` 有内容、换格子会刷新、中英提示词复制按钮可用
2. 气泡面板收起后是否还在
   - 上一版加了 `min-height:46px` 兜底，但根因未定位
   - **线索**：`web/styles.css` 里有一条
     `body[data-view="edit"] .rail.right:not([data-mod="bubble"]) .bubble-dock{display:none!important}`
     需要确认收起时 `.rail.right` 的 `data-mod` 是否被改走
3. 小框现在是分段折叠（`section.slot-sec` + `.sec-head` + `animateFold()`），
   不是我以前那种整块折叠 —— 别再按整块折叠去改

## 六、已知待办

- [ ] 气泡面板折叠消失（见上）
- [ ] 角色卡导出/导入（JSON + base64），便于团队复用同一批角色
- [ ] 生图参数再细化：OpenAI `gpt-image-1` / `dall-e-3` 的尺寸枚举不同，现在统一映射到 1792x1024 三档
- [ ] `?dbg=1` 可以看 `pages/idx/tabs/tpl` 四个状态，排查多页问题用
- [ ] 每格「重画」目前是重新调接口；可加"同种子重绘"

## 七、踩过的坑（别再踩）

- **改 .bat 必须纯 ASCII**：cmd 按 OEM 码页解析，中文字节会把结构搞崩
- **改 HTML 不要用文本锚点 replace 猜层级**：上次把 caret 插进了标题的 `<div>` 里，导致换行错位
- **PowerShell 里写 `node -e "..."` 遇中文/引号极易崩**：把脚本写成 `.mjs` 再 `node xxx.mjs`
- 用 `Get-Content` 看 UTF-8 中文会乱码，用 node 读
- 折叠动画用 `display:none` 会变成硬切（不可过渡），要用 `max-height`/`height` + `var(--ease)`
- GitHub Pages 对 `.css/.js` 有 10 分钟缓存：资源引用带 `?v=<随机>` 轮换
- Render/公网部署**不要**配 `LLM_API_KEY`（无鉴权会被白嫖）；`/api/proxy` 要求 `x-pf-client` 头 + 内网黑名单
