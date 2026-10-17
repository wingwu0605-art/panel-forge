# 模板 DSL 规范（怎么再加一套分镜）

一套模板 = 一个 `lib/library-*.mjs` 数组元素。写完跑 `node scripts/validate.mjs`，
它会替你检查：格子重叠 / 出界 / 过小 / 覆盖率不足 / 未知角色名 / 未知意图。

---

## 1. 最小可运行模板

```js
import { row, col, leaf } from './geometry.mjs';

export default [
  {
    id: 'jp-my-layout',              // 全局唯一，推荐 体系-题材-特征
    name: '少年漫·我的新页面',
    culture: 'jp',                    // jp | cn | kr | core
    reading: 'rtl',                   // rtl(右→左) | ltr | vertical(上→下)
    ratio: 'a4',                      // a4|b5|p34|square|wide|strip|tall|scroll
    frame: 'ink',                     // ink(墨线)|bold(重框)|hairline(细线)|none(无框)
    tags: ['少年', '大格', '斜切'],     // 气质标签，参与匹配
    intents: ['action', 'climax'],    // 戏路，参与匹配
    desc: '一句话说明这套版式的节奏。',
    margin: 28, gutter: 15,           // 可选，默认 28 / 15
    layout: row([0.30, 0.40, 0.30], [
      col([1.6, 1], ['wide', 'face']),
      'impact',                       // 字符串 = 默认叶子
      col([1, 1, 1], ['reaction', 'medium', 'close']),
    ]),
  },
];
```

---

## 2. 坐标系

- 页面宽固定 **1000**，高由 `ratio` 决定（A4 = 1414，条漫 9:16 = 1778，长条 = 2600）。
- 所有数字都是这个归一化单位；渲染时等比缩放，所以一套模板可以出 800px 也能出 4000px。
- 左上角是 (0,0)，y 向下。
- `margin` = 版心白边，`gutter` = 格与格之间的缝。

---

## 3. 盒子树

| 构造器 | 含义 | 子节点 |
| --- | --- | --- |
| `row([w…], [子…])` | **上下切分**（横带） | 每子占整宽、高度按权重 |
| `col([w…], [子…])` | **左右切分**（分栏） | 每子占整高、宽度按权重 |
| `'role'` | 叶子格（字符串简写） | — |
| `leaf('role', {…})` | 叶子格（带属性） | — |

**权重语义（重要）**：`col` 的权重与子节点都按**阅读顺序**书写。
- `ltr` / `vertical`：第 1 个 = 最左；
- `rtl`：第 1 个 = **最右**（引擎自动镜像几何，保证「第一格宽 1.6」时右边那格真的宽）。

`row` 永远是从上往下，不镜像。

### 嵌套

```js
col([1.5, 1, 1], [
  row([1, 1], ['wide', 'action']),          // 第 1 栏再上下切两格
  row([0.8, 1.2], ['action', 'medium']),
  row([1.1, 0.9], ['wide', 'silence']),
])
```

---

## 4. 叶子属性

```js
leaf('wide', {
  borderless: true,           // 不画框（少女漫留白格 / webtoon）
  bleed: true,                // 出血：只有本来贴着版心的边会扩到页面边缘
  bleed: ['top', 'left'],     // 或精确指定边
  pad: { left: 0.12 },        // 格内留白：该边收缩 12% 页宽（条漫错位的关键）
  rot: -3,                    // 旋转角度（一般只给插入格用）
  note: '瞳孔里映出对方',       // 给作者看的批注
})
```

**`pad` 的用法**（条漫最提气的一招，格子不满宽）：

```js
row([1.2, 1, 1.3, 0.9], [
  leaf('wide',    { pad: { left: 0.10 } }),
  leaf('medium',  { pad: { right: 0.18 } }),
  leaf('close',   { pad: { left: 0.06, right: 0.06 } }),
  leaf('silence', { pad: { left: 0.22 } }),
])
```

**`bleed: true` 的语义**：只把「本来就贴在版心白边上的那几条边」扩到页面边缘，
内部相邻的格子不会被吃掉（早期版本会误覆盖整页，已修正）。

---

## 5. 斜切

`col` 支持 `slant`（漫画的「ななめ割り」斜线格）：

```js
col([1, 1], ['action', 'reaction'], { slant: 0.14 })
```

- `slant` 单位是**格高的比例**：`0.14` ≈ 边界上下各错开 14% 高度，形成 ~16° 斜线。
- 正值：上端右移、下端左移；负值反向。
- `zigzag: true`：内部边界交替反向（扇形/锯齿格）。
- `flip: true`：整体反向。
- `row` 不做斜切（漫画横向切分线基本是水平的）。

多个 `col` 用同一个 `slant` 值时，斜线会跨带连成一条贯穿整页的对角线——这是「战斗页」的常用气势。

---

## 6. 叠盖插入格（insets）

压在别的格子上面、带白边抬起的小格：

```js
insets: [
  { x: 0.06, y: 0.36, w: 0.30, h: 0.13, role: 'eye',  rot: -2 },
  { x: 0.62, y: 0.60, w: 0.30, h: 0.13, role: 'hand', rot: 2 },
]
```

- 坐标是**页面比例**（0–1），不是归一化单位。
- `rot` 让插入格微微歪斜，这是「手贴上去的」关键手感。
- 插入格不参与重叠检测（它本来就叠着），但**溢出版心**会被检查。

---

## 7. 自定义多边形（三角格 / 破格）

DSL 表达不了的时候，直接写格子：

```js
{
  id: 'jp-triangle-impact', name: '破格·三角冲击', culture: 'jp', reading: 'rtl', ratio: 'a4',
  slots: [
    { id: 't1', order: 1, role: 'panorama', poly: [[28,28],[972,28],[972,330],[28,330]] },
    { id: 't2', order: 2, role: 'impact',   poly: [[28,345],[972,345],[972,830]] },   // 三角
    { id: 't3', order: 3, role: 'medium',   poly: [[28,357],[958,845],[28,845]] },
  ],
}
```

- 一旦给了 `slots`，`layout` 会被忽略，`order` 必须自己写。
- 多边形顶点顺序任意（顺/逆时针都行），必须是简单多边形。
- 自己算坐标时记住：**留 12–18 的斜切缝**，两条对边不要贴死。

---

## 8. 角色词汇（22 种）

`lib/taxonomy.mjs` 的 `ROLES`，写错角色名 validate 会报 `[未知角色]`。

| 类别 | 角色 |
| --- | --- |
| 场景 | `establish` 场景建立 · `panorama` 横长全景 · `wide` 全景 · `full` 全身 · `group` 群像 |
| 中景 | `medium` 中景 · `two` 双人 · `back` 背影 |
| 近景 | `close` 近景 · `face` 面部特写 · `eye` 眼部大特写 · `hand` 手部特写 · `object` 物件特写 · `cutin` 插入格 |
| 冲击 | `impact` 冲击大格 · `action` 动作格 · `low` 仰视 |
| 反应 | `reaction` 反应小格 |
| 静 | `silence` 静默留白 · `inner` 内心空镜 · `shadow` 剪影 |
| 视角 | `overhead` 俯视 |

角色决定：匹配时的节拍亲和度、编辑器里的标注、以及**没派到节拍时的兜底提示词**。

---

## 9. 标签与戏路的约定

`intents` 用固定 26 个（`action` `impact` `chase` `emotion` `dialogue` `reveal` `suspense` `horror` `romance` `gag` `inner` `montage` `silence` `daily` `climax` `scenery` `sport` `food` `war` `court` `work` `medical` `magic` `disaster` `investigate` `travel`），
`tags` 要尽量复用已有词汇，因为匹配引擎按 `wantTags` 命中数打分：

```
大格 小格 多格 三段落 四段落 斜切 无框 越界 对称 留白 速度线 横向 竖向 堆叠 插入格 叠盖
全景 特写 双人 群像 动作 日常 少女 少年 青年 恐怖 搞笑 对话 回忆 蒙太奇 对峙 静默 条漫 页漫 跨页
变形 暗部 不对称 柔和 网格 通用 密恐 快节奏 慢节奏 竖切 横向 台阶 长条 连载 电影感 大片感
```

---

## 10. 命名

```
{culture}-{题材或体系}-{特征}
jp-shonen-ladder       日式·少年·阶梯格
cn-strip-offset        中式·条漫·错位
kr-webtoon-cinema      韩式·webtoon·宽幅
core-diagonal-2        通用·对角二格
```

`id` 一旦发布就当 API 用，别随意改（会破别人的调用）。

---

## 11. 体检规则

`node scripts/validate.mjs` 会报：

| 问题 | 阈值 |
| --- | --- |
| `[重叠]` | 非插入格之间交叠 > 4% |
| `[出界]` | 格子超出页面 1 单位 |
| `[过小]` | 最短边 < 44（条漫 < 70） |
| `[覆盖率低]` | 页面被格子覆盖 < 72%（条漫 55%） |
| `[未知角色]` / `[未知意图]` / `[无意图标签]` / `[无题材标签]` | 字段缺失 |
| `[多边形退化]` / `[重复顶点]` | 顶点写错 |

覆盖率阈值是故意放宽的：漫画本来就有白边和留白。

---

## 12. 三个由浅入深的例子

### ① 三格（最中性）

```js
{
  id: 'core-3-tier', name: '通用·三段式', culture: 'core', reading: 'ltr', ratio: 'a4',
  intents: ['daily', 'dialogue'], tags: ['三段落', '通用'],
  layout: row([1, 1.3, 1], ['wide', 'impact', 'silence']),
}
```

### ② 条漫错位四格（用 pad 造节奏）

```js
{
  id: 'cn-strip-offset', name: '条漫·错位四格', culture: 'cn',
  reading: 'vertical', ratio: 'strip', frame: 'none', margin: 52, gutter: 46,
  intents: ['emotion', 'inner'], tags: ['条漫', '留白', '不对称'],
  layout: row([1.2, 1, 1.3, 0.9], [
    leaf('wide',    { pad: { left: 0.10 } }),
    leaf('medium',  { pad: { right: 0.18 } }),
    leaf('close',   { pad: { left: 0.06, right: 0.06 } }),
    leaf('silence', { pad: { left: 0.22 } }),
  ]),
}
```

### ③ 斜切打斗页 + 叠盖特写

```js
{
  id: 'cn-page-wuxia', name: '国风·武侠对决', culture: 'cn', reading: 'ltr', ratio: 'a4',
  frame: 'bold', margin: 30, gutter: 15,
  intents: ['action', 'climax'], tags: ['国风', '武侠', '斜切', '大格'],
  insets: [{ x: 0.62, y: 0.30, w: 0.26, h: 0.14, role: 'eye', rot: -3 }],
  layout: row([0.30, 0.40, 0.30], [
    col([1, 1.5], ['wide', 'low'], { slant: 0.09 }),
    leaf('impact'),
    col([1, 1, 1], ['action', 'reaction', 'silence']),
  ]),
}
```

---

## 13. 加完之后

```bash
node scripts/validate.mjs        # 必须全绿
node scripts/contact-sheet.mjs   # 生成 out/contact-*.html，浏览器打开肉眼看
node scripts/test-match.mjs      # 看新模板会不会被正确匹配到
```

若新模板在 `test-match` 里从来没排进前 3，多半是 `tags` 与 `intents` 选得不对——
去 `lib/taxonomy.mjs` 看对应意图的 `wantTags`，照着抄。
