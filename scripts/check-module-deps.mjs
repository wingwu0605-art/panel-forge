#!/usr/bin/env node
/**
 * 模块依赖自检（零依赖）：找「被调用了，但这个文件里既没声明、也没导入」的函数。
 *
 * 为什么要有它：拆模块时最容易犯的错是——函数搬走了，但调用点留在原文件、忘了 import。
 * 这类问题 `node --check` 抓不到（语法没问题），只在运行到那条路径时才炸：
 * `goCanvasOnCompact is not defined`（点模板库卡片）、`loadImgEl is not defined`（底稿丢失）、
 * 服务端 `cfgOf / llmFail is not defined`（/api/ai/lines 一调就 500）都是这么漏的。
 *
 * 实现：一个最小的 JS 词法器（正确跳过字符串 / 模板串 / 注释 / 正则字面量，模板串里的 ${} 当代码），
 * 收集「声明过的名字」（函数、变量、解构、参数、import、class、catch）和「被调用的名字」，
 * 两者相减再去掉宿主全局。按文件取并集（不做块级作用域），所以它只抓「整个文件都找不到」的名字；
 * 更细的作用域问题交给 CI 里的 ESLint（npm run lint）。
 *
 *   node scripts/check-module-deps.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

const FILES = [
  'web/app.js', 'web/api-static.js',
  ...readdirSync('web').filter((f) => f.endsWith('.mjs')).map((f) => 'web/' + f),
  ...readdirSync('lib').filter((f) => f.endsWith('.mjs')).map((f) => 'lib/' + f),
  'server.mjs',
];

const GLOBALS = new Set(`
Math Number String Object Array JSON Promise Date Boolean Map Set WeakMap WeakSet WeakRef Symbol BigInt
Error TypeError RangeError SyntaxError AggregateError RegExp Proxy Reflect Intl ArrayBuffer DataView
Uint8Array Uint8ClampedArray Uint16Array Int32Array Float32Array Float64Array
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
structuredClone queueMicrotask setTimeout clearTimeout setInterval clearInterval setImmediate
requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
fetch Request Response Headers FormData AbortController AbortSignal URL URLSearchParams Blob File FileReader
TextEncoder TextDecoder atob btoa crypto console performance globalThis process Buffer
window document navigator location history localStorage sessionStorage indexedDB matchMedia getComputedStyle
alert confirm prompt open close addEventListener removeEventListener dispatchEvent
Image Path2D OffscreenCanvas createImageBitmap DOMParser XMLSerializer WebSocket CSS Node NodeFilter
Event CustomEvent KeyboardEvent PointerEvent MouseEvent DragEvent ClipboardEvent
MutationObserver ResizeObserver IntersectionObserver PerformanceObserver Animation KeyframeEffect
HTMLElement HTMLInputElement HTMLDialogElement
import require super this`.split(/\s+/).filter(Boolean));

const KEYWORDS = new Set(`break case catch class const continue debugger default delete do else export extends
finally for function if import in instanceof let new return super switch this throw try typeof var void while
with yield async await of static get set true false null undefined NaN Infinity from as`.split(/\s+/));

/* ------------------------------------------------------------------ 词法 */
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  // 正则还是除号：看前一个「有意义」的记号
  const regexAllowed = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return false;
    if (p.t === 'id') return KEYWORDS.has(p.v) && !['this', 'super', 'true', 'false', 'null', 'undefined'].includes(p.v);
    return !(p.v === ')' || p.v === ']' || p.v === '}');
  };
  const readTemplate = () => {          // 进入时 src[i] === '`'
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        const start = i;
        // 找到配对的 }（中间可能还有字符串 / 模板串 / 对象字面量）
        while (i < n && depth) {
          const d = src[i];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (!depth) break; }
          else if (d === '\'' || d === '"') { const q = d; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
          else if (d === '`') { readTemplate(); continue; }
          i++;
        }
        out.push(...tokenize(src.slice(start, i)));
        i++;
        continue;
      }
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\'' || c === '"') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out.push({ t: 'str', v: '' }); continue;
    }
    if (c === '`') { readTemplate(); out.push({ t: 'tpl', v: '' }); continue; }
    if (c === '/' && regexAllowed()) {
      i++;
      let cls = false;
      while (i < n) {
        const e = src[i];
        if (e === '\\') { i += 2; continue; }
        if (e === '[') cls = true;
        else if (e === ']') cls = false;
        else if (e === '/' && !cls) break;
        else if (e === '\n') break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      out.push({ t: 're', v: '' });
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$À-￿]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(d))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out.push({ t: 'num', v: '' });
      i = j; continue;
    }
    if (c === '?' && d === '.') { out.push({ t: 'p', v: '?.' }); i += 2; continue; }
    if (c === '=' && d === '>') { out.push({ t: 'p', v: '=>' }); i += 2; continue; }
    if (c === '.' && d === '.' && src[i + 2] === '.') { out.push({ t: 'p', v: '...' }); i += 3; continue; }
    out.push({ t: 'p', v: c });
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ 分析 */
function analyze(src) {
  const tk = tokenize(src);
  const declared = new Set();
  const called = new Map();   // name → 次数
  const isId = (k) => tk[k]?.t === 'id';
  const val = (k) => tk[k]?.v;

  /** 从 k 开始收集一个绑定模式里的名字（标识符 / 解构），返回结束下标 */
  const collectPattern = (k) => {
    if (isId(k)) { declared.add(val(k)); return k + 1; }
    const open = val(k);
    if (open !== '{' && open !== '[') return k;
    let depth = 0;
    for (; k < tk.length; k++) {
      const v = val(k);
      if (v === '{' || v === '[') depth++;
      else if (v === '}' || v === ']') { depth--; if (!depth) return k + 1; }
      else if (isId(k) && depth) declared.add(v);
    }
    return k;
  };
  /** 括号里的参数列表（含默认值 / 解构） */
  const collectParams = (open) => {
    let depth = 0;
    for (let k = open; k < tk.length; k++) {
      const v = val(k);
      if (v === '(' || v === '[' || v === '{') depth++;
      else if (v === ')' || v === ']' || v === '}') { depth--; if (!depth) return k; }
      else if (isId(k)) declared.add(v);
    }
    return tk.length;
  };
  const matchParen = (open) => {
    let depth = 0;
    for (let k = open; k < tk.length; k++) {
      if (val(k) === '(') depth++;
      else if (val(k) === ')') { depth--; if (!depth) return k; }
    }
    return -1;
  };

  for (let k = 0; k < tk.length; k++) {
    const t = tk[k];
    if (t.t !== 'id') continue;
    const v = t.v;
    const prev = tk[k - 1]?.v;
    if (v === 'function' || v === 'class') {
      if (isId(k + 1)) declared.add(val(k + 1));
      const p = val(k + 1) === '(' ? k + 1 : (val(k + 2) === '(' ? k + 2 : -1);
      if (v === 'function' && p > 0) collectParams(p);
      continue;
    }
    if (v === 'const' || v === 'let' || v === 'var') {
      let j = collectPattern(k + 1);
      // const a = 1, b = 2
      let depth = 0;
      for (; j < tk.length; j++) {
        const w = val(j);
        if (w === '(' || w === '[' || w === '{') depth++;
        else if (w === ')' || w === ']' || w === '}') { if (!depth) break; depth--; }
        else if (w === ';' && !depth) break;
        else if (w === ',' && !depth) j = collectPattern(j + 1) - 1;
      }
      continue;
    }
    if (v === 'import') {
      for (let j = k + 1; j < tk.length && val(j) !== 'from' && val(j) !== ';'; j++) {
        if (isId(j) && val(j) !== 'as') declared.add(val(j));
      }
      continue;
    }
    if (v === 'catch' && val(k + 1) === '(') { collectParams(k + 1); continue; }
    // 箭头函数的单参数：x => ...
    if (val(k + 1) === '=>') { declared.add(v); continue; }
    if (KEYWORDS.has(v)) continue;
    if (prev === '.' || prev === '?.') continue;       // 方法 / 属性
    const next = val(k + 1);
    const isCall = next === '(' || (next === '?.' && val(k + 2) === '(');
    if (!isCall) continue;
    const open = next === '(' ? k + 1 : k + 2;
    const close = matchParen(open);
    // name(...) { … }：方法简写 / 类方法 / getter，是声明不是调用（「调用后紧跟代码块」在 JS 里不合法）
    if (close > 0 && val(close + 1) === '{') {
      declared.add(v);
      collectParams(open);
      continue;
    }
    called.set(v, (called.get(v) || 0) + 1);
  }
  // 箭头函数的括号参数：(a, b) => …
  for (let k = 0; k < tk.length; k++) {
    if (val(k) !== '=>' || val(k - 1) !== ')') continue;
    let depth = 0;
    for (let j = k - 1; j >= 0; j--) {
      const w = val(j);
      if (w === ')') depth++;
      else if (w === '(') { depth--; if (!depth) { collectParams(j); break; } }
    }
  }
  return { declared, called };
}

let problems = 0;
for (const file of FILES) {
  const { declared, called } = analyze(readFileSync(file, 'utf8'));
  const unknown = [...called.keys()].filter((name) => !declared.has(name) && !GLOBALS.has(name));
  if (unknown.length) {
    problems += unknown.length;
    console.log(`✗ ${file}: ${unknown.join(', ')}`);
  } else {
    console.log(`✓ ${file}`);
  }
}

console.log(problems ? `\n❌ ${problems} 处调用找不到声明 / 导入` : '\n✅ 依赖全部可解析');
process.exit(problems ? 1 : 0);
