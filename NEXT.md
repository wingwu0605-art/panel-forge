# NEXT.md · 交接单（给下一个会话的我）

> 现在这个仓库已经有几百个提交、功能很多。**新会话先读这个文件**，不要盲目全量读代码。
> 最近一轮：修好「这一格的分镜」段（它其实一直是空的）、角色卡可导出/导入、生图尺寸按模型枚举走、
> 新增零依赖目视检查工具。下面第五节是结论，别重复查。

## 一、跑起来（Windows，node 不在 PATH）

```powershell
$env:PATH = "D:\nodejs;$env:PATH"
cd "D:\harness workspace\新建文件夹\panel-forge"
node server.mjs                 # http://127.0.0.1:7311/
node scripts/build-static.mjs   # 生成 site/ 给 Pages（会自动给 css/js 打内容哈希版本号）
node scripts/validate.mjs       # 138 套模板版面体检
node scripts/test-units.mjs     # 25 项纯函数：生图尺寸映射（不启服务器）
node scripts/test-api.mjs       # 41 项（要先 node server.mjs）
node scripts/test-llm-mock.mjs  # 22 项（自己起 mock 在 7399，先确保 7399 没被占）
node scripts/visual-check.mjs   # 34 项目视检查：自己起 headless Chrome，截图到 out/shots/
```

线上：https://wingwu0605-art.github.io/panel-forge/
仓库：https://github.com/wingwu0605-art/panel-forge （Pages 从 main 自动构建，CI 跑 validate + test-units + build）

推送：`git push origin main` 即可（GitHub 凭据已缓存在 Windows 凭据管理器）。

## 二、目录速查

| 路径 | 内容 |
| --- | --- |
| `lib/library-*.mjs` | 138 套模板数据（jp 40 / cn 38 / kr 40 / core 20）|
| `lib/matcher.mjs` | 规则引擎 + `buildPlan()`（**提示词就是这里拼的**）|
| `lib/shapes.mjs` | 10 类格子形状 → `prefixEn/prefixZh/suffixEn/suffixZh` |
| `lib/llm-core.mjs` | 浏览器/Node 共用：prompt 常量、`chat()`、`aiDecide`、`optimizePrompts`、`generateImage`、`fitImageSize` |
| `lib/llm.mjs` | Node 入口：读 `LLM_*` 环境变量后转交 core |
| `web/app.js` | 前端全部逻辑（~3600 行，**原生 ES module，`state` 不挂在 window 上**）|
| `web/api-static.js` | 静态版 API（规则引擎在浏览器里跑 + 直连模型）|
| `server.mjs` | 零依赖 HTTP 服务：页面 + `/api/*` |
| `scripts/visual-check.mjs` | 目视检查：headless Chrome + CDP，按场景点按钮、量几何、截图（也能 `import` 出来当驱动用）|
| `scripts/page-eval.mjs` | 在真浏览器里临时跑一段 JS 查一件事（比 `?dbg=1` 灵活），**表达式请用 `--file=`** |

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
  - **导出 / 导入**：一键存 `角色卡-YYYY-MM-DD.json`（参考图以 base64 内嵌），队友导入即用；
    按「名字＋第一张参考图」去重，重复导入不会堆一份，坏文件只提示不动数据
- **AI 导演**：二级菜单管理多家 Key（DeepSeek/OpenAI/硅基流动/Anthropic/Moonshot/自定义），可切换
- **AI 生图**：三服务商、尺寸按模型枚举自适应、候选图（重画/换一张）、每格独立
- 静态版直连模型（浏览器直连，失败回落本机服务端）

## 五、上一轮「尚未目视验证」的三条 —— 已验完，结论如下

1. **「分镜表」标签页删掉、信息并入小框的「这一格的分镜」段** → 当时其实是**坏的**：
   `renderSlotBoard()` 写了但**从来没被调用**，所以那一段永远是空的。
   已修：在 `renderSlotPanel()` 里统一调用它（换格子、重新匹配、AI 排戏后都会自动刷新）。
   顺手去重：画幅比 / 整页占比 / 导出像素 / 建议出图 留在「图片」段的 `#slotKv`，
   景别 / 节拍 / 画面 / 台词 / 构图 + 中英提示词归「这一格的分镜」，两处不再重复。
2. **气泡面板收起后整个消失** → 现在**复现不出来**：桌面 1440 收起后 51px 仍在（标题行可见、
   内容高度归零、宽度撑满右栏），再点能展开；手机编辑页切到「气泡」模块也正常，
   点标题行不会把内容收没。当年那条 `min-height:46px` 兜底是有效的；
   线索里怀疑的「`data-mod` 被改走」**不成立**（收起不碰 `data-mod`）。
   `visual-check.mjs` 的 ②③ 场景已锁住这个行为，以后改样式会立刻红。
3. **小框是分段折叠**（`section.slot-sec` + `.sec-head` + `animateFold()`），不是整块折叠。
   分段折叠本身没问题 —— 上一轮看着像坏了（收起后再展开高度还是 0），
   其实是**第 1 条的连带**：那一段没内容，展开也没高度。修好第 1 条后一次通过。

## 六、已知待办

- [ ] 每格「重画」加「同种子重绘」：**先把限制说清** —— `dall-e-3` / `gpt-image-1` 都不收 `seed`，
      能用的只有硅基流动一部分模型和 Stability。要做就按服务商分叉，别给不支持的模型硬塞参数
- [ ] 角色卡的导入目前只认本工具导出的格式（宽松兼容数组），没做「从别的工具迁移」
- [ ] `?dbg=1` 现在能看到 `pages/idx/tabs/tpl/sel/view/mod/plan/chars`；要多页深挖可以再加 `pageIds`
- [ ] 生图失败时的提示还可以更细（内容审核 / 尺寸 / 模型名 现在分开了，但比例类错误还没分）

## 七、踩过的坑（别再踩）

- **PowerShell 调 node 传含双引号的 JS 参数会被吃掉引号**（`"#slotPanel"` 到了页面变成私有字段语法错误）。
  写 `node scripts/page-eval.mjs --file=out/dbg-xxx.js`，表达式放文件里；用完删掉（`out/dbg*.js` 已 gitignore）
- **改了函数不等于接通了**：`renderSlotBoard` 定义了却没调用，靠读代码看不出来，靠截图一眼就看出来。
  以后新写一个 `renderXxx()`，先搜一遍调用点
- **`renderStage()` 的入场动画回调会重写底栏 `#footMsg`**（setTimeout 900ms 之后），
  任何想长期留在底栏的信息都会被它冲掉。`?dbg=1` 因此在 renderStage 里也走 `showDbgLine()`
- **`web/app.js` 是 ES module**：`state` / 函数都不在 `window` 上，自动化只能走 DOM（点按钮、派发事件）
- **改 .bat 必须纯 ASCII**：cmd 按 OEM 码页解析，中文字节会把结构搞崩
- **改 HTML 不要用文本锚点 replace 猜层级**：上次把 caret 插进了标题的 `<div>` 里，导致换行错位
- 用 `Get-Content` 看 UTF-8 中文会乱码，用 node 读
- 折叠动画用 `display:none` 会变成硬切（不可过渡），要用 `max-height`/`height` + `var(--ease)`
- GitHub Pages 对 `.css/.js` 有 10 分钟缓存：`build-static.mjs` 已按内容哈希自动换 `?v=`，别再手改
- Render/公网部署**不要**配 `LLM_API_KEY`（无鉴权会被白嫖）；`/api/proxy` 要求 `x-pf-client` 头 + 内网黑名单
