#!/usr/bin/env node
/**
 * 配色对比度检查（WCAG 2.x，零依赖）。
 *
 * 外观 = 风格（经典 / 液态玻璃 / 高级简约 / 灵动可爱）× 明暗 × 强调色（跟随风格 + 10 个）。
 * 这里把 web/styles.css 里所有 `:root[...]` 令牌块按浏览器的层叠规则（属性选择器个数 → 源码顺序）
 * 叠出每一种组合的最终令牌，解开 var()（含回退值），再逐对算对比度：
 *   4 风格 × 2 明暗 × 11 强调色 = 88 种组合，每种 13 对。任何一对不达标 → 退出码 1（CI 会挂）。
 *
 * 半透明的前景合成到背景上、半透明的背景合成到 --bg 上再算（液态玻璃的卡片是半透明的）。
 * 用法：node scripts/check-contrast.mjs [--verbose]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(ROOT, 'web/styles.css'), 'utf8');
const VERBOSE = process.argv.includes('--verbose');

const STYLES = ['classic', 'glass', 'minimal', 'cute'];
const SCHEMES = ['light', 'dark'];
const ACCENTS = ['default', 'blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'graphite'];

const PAIRS = [
  ['--label', '--bg', 4.5, '正文 / 页面底'],
  ['--label', '--bg-elev', 4.5, '正文 / 卡片'],
  ['--label', '--surface-2', 4.5, '正文 / 次级面'],
  ['--label-2', '--bg', 4.5, '次级文字 / 页面底'],
  ['--label-2', '--bg-elev', 4.5, '次级文字 / 卡片'],
  ['--label-3', '--bg', 3.0, '三级文字 / 页面底（大字 / 图标）'],
  ['--on-tint', '--tint', 4.5, '主按钮文字 / 主色'],
  ['--tint', '--bg', 3.0, '主色控件 / 页面底'],
  ['--tint', '--bg-elev', 3.0, '主色控件 / 卡片'],
  ['--green-ink', '--bg', 4.5, '成功文字 / 页面底'],
  ['--red-ink', '--bg', 4.5, '危险文字 / 页面底'],
  ['--red-ink', '--bg-elev', 4.5, '危险文字 / 卡片'],
  ['--orange-ink', '--bg', 4.5, '提醒文字 / 页面底'],
];

/* ------------------------------------------------------------------ 读令牌块 */
/** 只取顶层的 `:root…{}` 块（@supports / @media 里的是曲线和布局尺寸，不含颜色） */
function tokenBlocks(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const blocks = [];
  let depth = 0, i = 0, start = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (depth === 0) {
        const sel = text.slice(start, i).trim();
        let j = i + 1, d = 1;
        while (d && j < text.length) { if (text[j] === '{') d++; else if (text[j] === '}') d--; j++; }
        if (/^:root(\[[^\]]+\])*$/.test(sel.replace(/\s+/g, ''))) {
          blocks.push({ sel, body: text.slice(i + 1, j - 1), order: blocks.length });
        }
        i = j; start = j; continue;
      }
    } else if (c === ';' && depth === 0) start = i + 1;
    i++;
  }
  for (const b of blocks) {
    b.conds = [...b.sel.matchAll(/\[data-([a-z-]+)="([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
    b.decls = {};
    for (const m of b.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) b.decls[m[1]] = m[2].trim();
  }
  return blocks;
}

function tokensFor(blocks, attrs) {
  const hit = blocks.filter((b) => b.conds.every(([k, v]) => attrs[k] === v))
    .sort((a, b) => a.conds.length - b.conds.length || a.order - b.order);
  const out = {};
  for (const b of hit) Object.assign(out, b.decls);
  return out;
}

/** 解开 var(--x, 回退)（可嵌套） */
function resolve(tokens, value, seen = new Set()) {
  let v = value;
  for (let guard = 0; guard < 20 && v.includes('var('); guard++) {
    v = v.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/gi, (_, name, fb) => {
      if (name in tokens && !seen.has(name)) return resolve(tokens, tokens[name], new Set([...seen, name]));
      return fb !== undefined ? fb.trim() : 'UNDEFINED';
    });
  }
  return v.trim();
}

/* ------------------------------------------------------------------ 颜色 */
function parseColor(str) {
  const s = str.trim().toLowerCase();
  let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (k) => parseInt(h.slice(k, k + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] ?? 1 };
  }
  if ((m = s.match(/^oklch\(([^)]+)\)$/))) {
    const [main, alpha] = m[1].split('/');
    const [L, C, H] = main.trim().split(/\s+/).map(parseFloat);
    return { ...oklchToSrgb(L, C, H), a: alpha ? parseFloat(alpha) : 1 };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}
function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (x) => { const v = Math.min(1, Math.max(0, x)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return { r: enc(lin[0]), g: enc(lin[1]), b: enc(lin[2]) };
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});
const lum = (c) => {
  const f = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ------------------------------------------------------------------ 检查 */
const blocks = tokenBlocks(css);
if (!blocks.length) { console.error('✗ 没找到 :root 令牌块'); process.exit(1); }

let fails = 0, checks = 0, worst = null;
for (const style of STYLES) {
  for (const scheme of SCHEMES) {
    for (const accent of ACCENTS) {
      const attrs = { scheme };
      if (style !== 'classic') attrs.style = style;
      if (accent !== 'default') attrs.accent = accent;
      const tk = tokensFor(blocks, attrs);
      const get = (name) => {
        const raw = resolve(tk, `var(${name})`);
        const c = parseColor(raw);
        if (!c) throw new Error(`${style}/${scheme}/${accent}: ${name} = "${raw}" 解析不了`);
        return c;
      };
      const page = get('--bg');
      if (page.a < 1) throw new Error(`${style}/${scheme}: --bg 必须是不透明色（状态栏颜色也取它）`);
      for (const [fgName, bgName, min, note] of PAIRS) {
        let bg = get(bgName);
        if (bg.a < 1) bg = over(bg, page);
        let fg = get(fgName);
        if (fg.a < 1) fg = over(fg, bg);
        const r = ratio(fg, bg);
        checks++;
        const tag = `${style}·${scheme}·${accent}`;
        if (!worst || r - min < worst.margin) worst = { margin: r - min, tag, pair: `${fgName} / ${bgName}`, r };
        if (r < min) {
          fails++;
          console.log(`  ✗ ${tag.padEnd(26)} ${`${fgName} / ${bgName}`.padEnd(26)} ${r.toFixed(2)} < ${min}  ${note}`);
        } else if (VERBOSE) {
          console.log(`  ✓ ${tag.padEnd(26)} ${`${fgName} / ${bgName}`.padEnd(26)} ${r.toFixed(2)}`);
        }
      }
    }
  }
}
const combos = STYLES.length * SCHEMES.length * ACCENTS.length;
console.log(`对比度：${combos} 种外观组合 × ${PAIRS.length} 对 = ${checks} 项，${fails ? `${fails} 项不达标` : '全部达标'}` +
  `（余量最小：${worst.tag} ${worst.pair} = ${worst.r.toFixed(2)}）`);
process.exit(fails ? 1 : 0);
