# 代码禁商用，产出物可商用

（English below）

## 一句话

| 对象 | 能不能商用 | 要不要授权 |
| --- | --- | --- |
| **这个软件本身（代码）** | ❌ 不能 | 商用需单独授权 |
| **用这个软件做出来的作品** | ✅ 能 | 不需要，永久免费 |

## 通俗解释

**1. 代码**

你可以：读、改、自用、给朋友用、拿去学习、教学、非营利组织内部用、放到自己的非商业网站上。
你**不可以**：把代码（或改过的版本）当作商品卖、打包进商业产品、或用它开一家收费的公司内部工具。

**2. 产出物（这是本条最想讲清楚的部分）**

你用 PanelForge 做的**任何东西都是你的**，随便商用：

- 分镜稿、漫画页、条漫、画面、图像 → 拿去投稿、接商稿、出版、卖给甲方、印周边
- 用 AI 生成并导出的图 → 同上，不额外收费、不需要署名
- 导出的提示词、分镜表、文本 → 同上
- 你的草稿数据 → 只在你自己的浏览器里，我们连看都看不到

**换句话说：软件是工具，工具不参与你的生意分成。**

## 需要商业授权的边界（说清楚，免得误会）

下面这些**属于"用软件本身做生意"，需要找我拿商业授权**：

1. 把 PanelForge（含修改版、改名版）作为商品出售或随硬件捆绑销售
2. 把它做成付费 SaaS / 订阅服务，或放进需要付费才能使用的产品里
3. 用「PanelForge 的代码能力」为第三方**批量代工**并收费（例如：为客户搭一套分镜系统并收开发费）
4. 在企业内部作为**收费工作流**的一环商业运营（免费内部试用不算）

下面这些**不需要授权**（容易混的几种，明确列出）：

- 你是自由画师 / 工作室，用 PanelForge 画自己的稿子然后卖 → ✅ 随便用
- 你在漫画机构上班，用它做**自己的**分镜产出 → ✅ 产出物商用没问题（但把软件本身部署成公司付费系统就是第 2 条）
- 你把它部署在自己的个人站，免费给所有人用、不赚钱 → ✅
- 你在 B 站/小红书出教程、录屏演示 → ✅
- 你把它编译成 APK 送给朋友 → ✅（非商业）

## 这是"源码可见"，不是 OSI 开源

严格意义上的 OSI 开源许可证（MIT、Apache-2.0、GPL 等）**不允许**禁止商用。
所以本项目的准确叫法是 **source-available（源码可见 / 非商业许可）**：
代码公开、可读可改、非商业免费，商业需授权。

如果你想让它成为严格开源（允许商用），只有两条路：
换成 MIT/Apache-2.0（放弃禁止商用），或保持现状（我们选的）。

## 商业授权怎么拿

在仓库开一个 issue，标题写「商业授权咨询」，说明你的场景（规模、是否对外收费），我会回复条款。
学生、个人爱好者、非营利、教学用途：**不用问，直接用**。

---

# English summary

**The code** is licensed under the PolyForm Noncommercial License 1.0.0:
free for any noncommercial purpose (personal, hobby, study, teaching, nonprofits, research),
**commercial use of the code requires a separate license**.

**The outputs** you create with the software — storyboards, pages, artwork, images, text,
exported prompts and sheets — are **yours**, and may be used for **any purpose, including
commercial**, with no fee and no attribution requirement. This is an additional permission
that overrides the noncommercial restriction with respect to outputs only.

Commercial licenses are required for: selling the software (or a modified version),
bundling it into a commercial product, offering it as a paid SaaS, or using its code to
deliver paid custom work for third parties. Using the app to produce and sell *your own*
artwork never requires a license.

To request a commercial license, open an issue titled "Commercial license inquiry".

PanelForge is **source-available**, not OSI open source: OSI-approved licenses cannot forbid
commercial use, which is exactly what this project does for its code.
