import { readFileSync, writeFileSync } from 'node:fs';

const p = 'web/app.js';
let src = readFileSync(p, 'utf8');

function cut(text, label) {
  if (!src.includes(text)) throw new Error('找不到块: ' + label);
  src = src.replace(text, '');
  return text;
}

/* ---------- 1) 从 app.js 搬出视图相关常量 ---------- */
const viewOrder = cut("const VIEW_ORDER = ['library', 'story', 'canvas', 'edit', 'output'];\n", 'VIEW_ORDER');
const viewAlias = cut("const VIEW_ALIAS = { inspect: 'edit' };\n", 'VIEW_ALIAS');
const zoomVars = cut("let zoomT = { tx: 0, ty: 0, k: 1 };   // #canvas 当前的变换\nlet zoomKey = '';\n", 'zoomT/zoomKey');
const compactMQ = cut("const compactMQ = window.matchMedia('(max-width:1024px)');\n", 'compactMQ');

/* ---------- 2) 把一整段视图函数搬出来 ---------- */
const blockStart = 'function setView(view, opts = {}) {';
const blockEndMarker = '\nfunction syncSlotFab(has) {';
const i = src.indexOf(blockStart);
const j = src.indexOf(blockEndMarker, i);
if (i < 0 || j < 0) throw new Error('找不到视图函数块');
const viewFns = src.slice(i, j);
src = src.slice(0, i) + src.slice(j + 1);

/* ---------- 3) withTransition 移到 util（主题和视图都要用） ---------- */
const wtStart = '/** 用 View Transitions 包一层；不支持或用户要求减弱动效时直接执行 */';
const wtEndMarker = '\n}\n';
const wi = src.indexOf(wtStart);
const wj = src.indexOf(wtEndMarker, wi);
if (wi < 0 || wj < 0) throw new Error('找不到 withTransition');
const withTransition = src.slice(wi, wj + wtEndMarker.length).trim();
src = src.slice(0, wi) + src.slice(wj + wtEndMarker.length);

/* ---------- 4) 写 mobile.mjs ---------- */
const mobileModule = `/**
 * 手机视图与「进/出这一格编辑」的动画。
 *
 * 从 app.js 抽出：setView / applyView / enterEdit / exitEdit + FLIP 缩放那套，
 * 以及底部的视图切换绑定 initViews。
 *
 * 为什么值得独立：这块是今天改得最多的（双击进编辑、抽屉滑入、窄屏禁用收起），
 * 逻辑集中在一个文件里才能保证"只在手机断点生效"之类的判断不被散落修改。
 *
 * 依赖注入（避免和 app.js 循环引用）：
 *   renderStage / renderSlotPanel —— 视图切换后需要重绘
 */
import { $, $$, clamp, withTransition } from './util.mjs';
import { state } from './state.mjs';

let deps = { renderStage: () => {}, renderSlotPanel: () => {} };
export function installViewDeps(next) { deps = { ...deps, ...next }; }

${viewOrder}${viewAlias}${compactMQ.replace(/\n/g, '')}${zoomVars}
${viewFns.replace(/\brenderStage\(\)/g, 'deps.renderStage()').replace(/\brenderSlotPanel\(\)/g, 'deps.renderSlotPanel()')}
`;

writeFileSync('web/mobile.mjs', mobileModule);

/* ---------- 5) withTransition 追加到 util.mjs ---------- */
{
  const u = readFileSync('web/util.mjs', 'utf8');
  if (!u.includes('withTransition')) {
    writeFileSync('web/util.mjs', u.replace(/\s*$/, '') + '\n\nexport ' + withTransition + '\n');
  }
}

/* ---------- 6) app.js：加 import + 注入依赖 ---------- */
const anchor = "import { autoPromptOf, promptParts, effectivePrompt, buildImagePrompt, setPromptEdit, installPromptDeps } from './prompt.mjs';";
if (!src.includes(anchor)) throw new Error('找不到 prompt import');
const mImport = "import { setView, applyView, initViews, setEditMod, syncEditHead, syncEditZoom, clearEditZoom, stepSlot, enterEdit, exitEdit, installViewDeps } from './mobile.mjs';";
src = src.replace(anchor, () => anchor + '\n' + mImport);

src = src.replace('  installPromptDeps({ pagePlan, activeCharPayload, queueSave });\n',
  () => '  installPromptDeps({ pagePlan, activeCharPayload, queueSave });\n  installViewDeps({ renderStage, renderSlotPanel });\n');

src = src.replace(/\n{3,}/g, '\n\n');
writeFileSync(p, src);
console.log('mobile.mjs 已生成；app.js 行数:', src.split('\n').length);
console.log('withTransition 已移入 util.mjs');
