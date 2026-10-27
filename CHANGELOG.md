# 变更日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

**唯一版本源是仓库根目录的 `VERSION` 文件**；`package.json` / Android `versionName`
由 `scripts/set-version.mjs` 同步，Android 构建脚本也会从 `VERSION` 读版本号。

---

## [Unreleased]

### 变更（许可）

- **重新开源**：仓库转回公开，恢复 GitHub Pages 自动部署
  （<https://wingwu0605-art.github.io/panel-forge/>）。
- **许可换成 PolyForm Noncommercial 1.0.0**：代码禁止商用；产出物可商用。
  新增 [LICENSE-OUTPUTS.md](LICENSE-OUTPUTS.md) 把「代码」与「产出物」彻底分开，
  并列出「需要商业授权 / 不需要」的边界清单。
- 明确说明：本项目是 **source-available（源码可见）**，不是 OSI 开源
  —— OSI 许可不允许禁止商用，二者不可兼得。
- CI 加固：Pages 工作流在发布前先跑单测 / 模板体检 / 配色对比度三道闸，任一失败不发布。
- 发布前做了敏感信息扫描（sk-/token/私钥/本地路径）：无命中。

---

## [0.9.0] — 2026-10-26

本轮主题：**收口 + 版本基建 + 两套配色皮肤**。

### 新增

- **产品报告** `docs/PRODUCT-REPORT-v0.9.md`：完成度审计、多平台画师功能清单
  （CLIP STUDIO PAINT / Procreate / ibisPaint + 分镜工具横评）、竞品可借鉴项、路线图。
- **版本体系**：`VERSION`（唯一真源）、本 `CHANGELOG.md`、`scripts/set-version.mjs`、
  Android `versionName/versionCode` 自动同步、应用内显示版本号、`window.__pfVersion()`。
- **皮肤「灵动可爱」**：莓红色系（色相 340）的品牌化中性色、药丸按钮、胖圆角（26/20/14/10）、
  回弹弹簧；亮/暗两套值。
- **皮肤「高级简约」**：低饱和靛蓝（色相 265）、发丝线、收圆角（16/12/9/6）、
  等宽数字、无回弹；亮/暗两套值。
- **配色质量闸** `scripts/check-contrast.mjs`：解析 CSS 令牌 → oklch/hex/rgba 转 sRGB →
  校验 60 对组合的 WCAG 2.2 AA 对比度，不达标非零退出。
- 皮肤切换入口：外观面板「皮肤」分段控件（经典 / 灵动可爱 / 高级简约），偏好存本机。

### 修复

- **对比度（原有主题，实测不达标）**：
  - 亮色主色 `#007aff` 上白字仅 4.02 → 压深为 `#0066cc`；
  - 暗色主色 `#0a84ff` 上白字仅 3.65 → 改用深墨字 `#0b0b0d`；
  - `--label-2` 4.47（差一点）、`--label-3` 2.38 → 抬到 4.5 / 3.0 以上；
  - 成功色 `--green-ink` `#248a3d` 3.94 → `#1d7a35`。
- **对比度脚本自身**：alpha 合成改到 sRGB（gamma）空间，否则半透明文字会被低估 2~3 倍；
  CSS 注释会吞掉紧随其后的令牌名，解析前先剥离注释。

### 变更

- 清洗流程固化：`validate` + `test-units` + `test-llm-mock` + `visual-check` + `check-contrast`
  五套全绿才提交（写进产品报告）。

---

## 更早（本 CHANGELOG 建立之前的压缩历史）

按主题归档，不再逐条展开：

- **原生壳（Android）**：Capacitor 6 工程、`ShareTargetPlugin`（接收分享）、
  `SaveImagePlugin`（存相册）、`ShareToPlugin`（列目标 + 直跳第三方 App）、
  壳性能档（关模糊/压动画/热区提层）、`install-sdk.ps1` / `build-android.ps1`、APK 构建通过。
- **绘制**：Klecks 引擎接入 + 兜底轻量笔、按格子多边形裁切、白底/透明可选、
  形状参考（格子外压灰）、手机工具列压高。
- **分镜与提示词**：AI 切原文切格、三源提示词（规则/AI/自己写）、提示词形状开头词开关。
- **气泡**：34 种样式、按内容自动选、就地换样式。
- **版面**：页面画幅可调（9 预设 + 自定义）、拉伸/留白两模式、可折叠「分镜表」标签页。
- **国际化**：中 / 英 / 印尼。
- **细节**：列表卡按行截断、手机底栏留白、模板库标签筛选与搜索。
- **许可**：转为专有许可（All Rights Reserved），输出物允许商用；仓库转私有、Pages 停用。
