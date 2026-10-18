# web/klecks/ —— 外部绘画引擎的预构建产物

这里放的是 [Klecks](https://github.com/bitbof/klecks)（MIT，Kleki.com 的底座）的 **embed 构建产物**，
用 iframe 挂进「绘制这一格」，适配层在 `../paint-host.mjs`。

## 文件从哪来

| 文件 | 来源 |
| --- | --- |
| `embed.js` / `embed.*.css` / `main-embed.*.js` / `main-embed.*.css` / 语言包 / 字体 / 光标图 | Klecks `main` 分支的 `parcel build src/embed.ts --public-url . --no-content-hash` 产物 |
| `klecks-logo.9918d7e6.png` / `brush-sketchy.28f5d56d.png` | 这两个 Parcel 没自动吐出来，从源码 `src/app/img/` 手工按 bundle 里引用的文件名补的 |
| `embed.html` | **我们自己写的**引导页（不是 Klecks 的），负责建实例、喂底图、把 `getPNG()` 交给父页面 |

构建时的仓库：`bitbof/klecks`，clone 后先跑两个生成脚本（图标和语言包是生成的，缺了会构建失败）：

```bash
git clone --depth 1 https://github.com/bitbof/klecks.git
cd klecks && npm install
node src/languages/generate.js build
node src/icons/generate.js
npx parcel build src/embed.ts --public-url . --no-content-hash --dist-dir dist-embed
```

然后把 `dist-embed/*`（去掉 `.map`）拷到这里，再跑一次：

```bash
node scripts/strip-sourcemaps.mjs web/klecks   # 我们不分发 .map，去掉悬空引用免得控制台 404
```

## 升级时注意

- `embed.html` 依赖 Klecks 的两个运行时内部点：
  - `window.Klecks`（官方 embed 入口，稳定）
  - `window.__pfKlecks.embed.klApp.easel.fitTransform(true)` —— **TS private，不是公开 API**。
    用来把画布适配到视口（Klecks 的自动适配只在「画布 ≤ 视口 1/4」时才触发）。
    它改名了也不会画不了画，只是打开时可能只看到画布中间一块。
- Klecks 的 embed 是**单实例**、直接挂 `document.body`、没有销毁接口 ——
  所以每次绘制都新开一个 iframe（`web/paint-host.mjs`），一个 iframe 一份干净实例。
- 许可：MIT。升级时确认 `licenses.*.js` 跟着一起更新。

## 为什么不用 miniPaint

miniPaint 强在图像编辑（滤镜/选区/仿章），笔刷不读压感；画师版要的是清线手感，所以选 Klecks。
以后真要「修图」能力，可以把它作为**另一个模式**接进同一套壳（壳与引擎无关）。
