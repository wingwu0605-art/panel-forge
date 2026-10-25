/**
 * 配色质量闸：把 styles.css 里每套皮肤（含亮/暗两态）的令牌解析出来，
 * 换算成 sRGB 后校验 WCAG 2.2 对比度。不达标直接非零退出 —— 配色不靠肉眼。
 *
 *   node scripts/check-contrast.mjs
 *
 * 校验的对（都是真实出现在界面上的组合）：
 *   正文 / 次级文字 / 三级文字  对 页面底色、卡片底
 *   按钮文字 对 主色底（on-tint / tint）
 *   主色、成功、警告、危险 ink 对 页面底色（链接、状态文字）
 */
import { readFileSync } from 'node:fs';

/* ---------------- oklch → sRGB ---------------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function oklchToLinearRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

function parseColor(str) {
  const t = String(str).trim();
  let m = t.match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i);
  if (m) {
    let L = parseFloat(m[1]);
    if (t.includes('%')) L = L / 100;
    const C = parseFloat(m[2]);
    const H = parseFloat(m[3]);
    const A = m[4] === undefined ? 1 : parseFloat(m[4]);
    return { lin: oklchToLinearRgb(L, C, H), a: A };
  }
  m = t.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    return { lin: srgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)), a: 1 };
  }
  m = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    const srgb = [m[1], m[2], m[3]].map((v) => parseFloat(v) / 255);
    return { lin: srgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)), a: m[4] === undefined ? 1 : parseFloat(m[4]) };
  }
  return null;
}

const lin2srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const srgb2lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** 半透明颜色合成到底色上。注意：alpha 混合必须发生在 **sRGB（gamma）空间**，
 *  直接在线性空间插值算出来的对比度是错的（会低报 2~3 倍）。 */
function composite(fg, bg) {
  if (!fg) return bg;
  const a = fg.a === undefined ? 1 : fg.a;
  if (a >= 1) return fg;
  const out = fg.lin.map((v, i) => srgb2lin(lin2srgb(v) * a + lin2srgb(bg.lin[i]) * (1 - a)));
  return { lin: out, a: 1 };
}

const lum = (c) => 0.2126 * c.lin[0] + 0.7152 * c.lin[1] + 0.0722 * c.lin[2];
const ratio = (fg, bg) => {
  const f = composite(fg, bg);
  const a = lum(f);
  const b = lum(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
};

/* ---------------- 解析 CSS ---------------- */
const css = readFileSync('web/styles.css', 'utf8');

function parseDecls(body) {
  const out = {};
  // 先去掉注释：否则 「/* 说明 */ --bg:...」 会让 key 变成注释文本，令牌被静默吞掉
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of clean.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k.startsWith('--')) out[k] = v;
  }
  return out;
}

/** 把 var(--x) 解引用到同一声明块里的具体值 */
function resolve(decls, name, depth = 0) {
  if (depth > 5) return null;
  let v = decls[name];
  if (!v) return null;
  const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) return resolve(decls, m[1], depth + 1);
  v = v.replace(/color-mix\([^)]*\)/gi, '').trim();
  return v || null;
}

const blocks = {};
// 基础主题（亮）
const baseLight = css.match(/^:root\{([\s\S]*?)\n\}/m);
if (baseLight) blocks['经典·亮'] = parseDecls(baseLight[1]);
// 基础主题（暗）
const baseDark = css.match(/:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/);
if (baseDark) blocks['经典·暗'] = { ...blocks['经典·亮'], ...parseDecls(baseDark[1]) };

for (const skin of ['cute', 'minimal']) {
  const light = css.match(new RegExp(`html\\[data-skin="${skin}"\\]\\{([\\s\\S]*?)\\n\\}`, 'm'));
  if (light) blocks[`${skin}·亮`] = parseDecls(light[1]);
  const darkMedia = css.match(new RegExp(`@media \\(prefers-color-scheme:dark\\)\\{\\s*html\\[data-skin="${skin}"\\]:not\\(\\[data-theme="light"\\]\\)\\{([^}]*)\\}`, 'm'));
  const darkManual = css.match(new RegExp(`html\\[data-skin="${skin}"\\]\\[data-theme="dark"\\]\\{([^}]*)\\}`, 'm'));
  const darkDecls = { ...(darkMedia ? parseDecls(darkMedia[1]) : {}) };
  if (darkManual) Object.assign(darkDecls, parseDecls(darkManual[1]));
  if (Object.keys(darkDecls).length) {
    blocks[`${skin}·暗`] = { ...blocks[`${skin}·亮`], ...darkDecls };
  }
}

/* ---------------- 校验 ---------------- */
// [前景, 背景, 最小对比度, 说明]
const PAIRS = [
  ['--label', '--bg', 4.5, '正文 / 页面底'],
  ['--label', '--bg-elev', 4.5, '正文 / 卡片'],
  ['--label-2', '--bg', 4.5, '次级文字 / 页面底'],
  ['--label-2', '--bg-elev', 4.5, '次级文字 / 卡片'],
  ['--label-3', '--bg', 3.0, '三级文字 / 页面底（大字面/图标）'],
  ['--on-tint', '--tint', 4.5, '按钮文字 / 主色底'],
  ['--tint', '--bg', 3.0, '主色 / 页面底（链接与控件）'],
  ['--green-ink', '--bg', 4.5, '成功文字 / 页面底'],
  ['--red-ink', '--bg', 4.5, '危险文字 / 页面底'],
  ['--orange-ink', '--bg', 4.5, '提醒文字 / 页面底'],
];

let fails = 0;
let checks = 0;
for (const [themeName, decls] of Object.entries(blocks)) {
  const rows = [];
  for (const [fgName, bgName, min, note] of PAIRS) {
    const fgStr = resolve(decls, fgName);
    const bgStr = resolve(decls, bgName);
    if (!fgStr || !bgStr) { rows.push({ ok: false, note: `${note}（令牌缺失 ${!fgStr ? fgName : bgName}）` }); fails++; continue; }
    const fg = parseColor(fgStr);
    const bg = parseColor(bgStr);
    if (!fg || !bg) { rows.push({ ok: false, note: `${note}（无法解析 ${fgStr} / ${bgStr}）` }); fails++; continue; }
    const r = ratio(fg, bg);
    checks++;
    const ok = r >= min;
    if (!ok) fails++;
    rows.push({ ok, note, r: r.toFixed(2), min });
  }
  console.log(`\n── ${themeName} ${'─'.repeat(Math.max(0, 46 - themeName.length))}`);
  for (const row of rows) {
    const mark = row.ok ? '✓' : '✗';
    console.log(`  ${mark} ${row.note.padEnd(30, ' ')} ${String(row.r ?? '—').padStart(6)}  ≥${row.min ?? '—'}`);
  }
}

console.log(`\n解析到 ${Object.keys(blocks).length} 套配色：${Object.keys(blocks).join(' · ')}`);
if (fails) {
  console.log(`\n❌ ${fails} / ${checks} 对不达 AA，先改配色再提交。`);
  process.exit(1);
}
console.log(`\n✅ ${checks} 对全部达标（WCAG 2.2 AA）`);
