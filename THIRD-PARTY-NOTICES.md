# 第三方组件声明

本仓库包含以下第三方开源组件。它们各自适用其**原许可**，不适用本仓库根目录的
`LICENSE`（PanelForge 非商业许可），且本仓库的许可不能被解释为限制它们。
按这些组件的原许可，任何人仍可单独提取并使用它们 —— 包括用于商业用途。

---

## Klecks

- 位置：`web/klecks/`（预构建产物）+ `web/klecks/embed.html`（我们自己写的引导页）
- 上游：https://github.com/bitbof/klecks
- 许可：**MIT License**，Copyright (c) bitbof
- 版本：`main` 分支的 `parcel build src/embed.ts` 产物（构建步骤见 `web/klecks/README.md`）
- 说明：仅作为「绘制这一格」的绘画引擎，通过同源 iframe 挂载。

## perfect-freehand

- 位置：`web/vendor/perfect-freehand.mjs`
- 上游：https://github.com/steveruizok/perfect-freehand
- 许可：**MIT License**，Copyright (c) 2021 Steve Ruiz
- 版本：1.2.2（压缩后的原样代码，未改动，许可证全文保留在文件头）
- 说明：兜底轻量笔（`web/paint.mjs`）的压感笔画轮廓算法。

---

MIT 许可全文（两个组件相同）：

```
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
