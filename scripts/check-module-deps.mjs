#!/usr/bin/env node
/**
 * 模块依赖自检：找"被调用但既没定义、也没导入"的标识符。
 *
 * 为什么要有它：拆模块时最容易犯的错是——函数搬走了，但它调用的另一个函数留在了
 * app.js。这类问题 node --check 抓不到（语法没问题），只在运行到那条路径时炸。
 * 今天 ZOOM_EASE / activateTab / replay 就是这样连着漏了三次。
 *
 *   node scripts/check-module-deps.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const MODULES = [
  'web/util.mjs', 'web/state.mjs', 'web/assets.mjs', 'web/prompt.mjs',
  'web/mobile.mjs', 'web/rails.mjs',
];

const BUILTINS = new Set(`if for while switch catch function return typeof new await async
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
Math Number String Object Array JSON Promise Date Boolean Map Set WeakMap WeakSet
void delete in of else try finally throw case do instanceof yield
document window navigator console location localStorage sessionStorage performance
parseInt parseFloat isNaN encodeURIComponent decodeURIComponent structuredClone fetch
URLSearchParams URL ResizeObserver MutationObserver IntersectionObserver CustomEvent
Event KeyboardEvent PointerEvent MouseEvent Image FileReader Blob File FormData AbortController
indexedDB matchMedia getComputedStyle requestIdleCallback queueMicrotask atob btoa
Node CSS TextEncoder TextDecoder Uint8Array Float32Array Intl RegExp Symbol Error TypeError
Path2D`.split(/\s+/));

/** 剥掉注释、字符串、模板串内容（保留插值里的表达式太麻烦，直接整段丢掉） */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      out += ' "" ';
      continue;
    }
    out += c; i++;
  }
  return out;
}

let problems = 0;
for (const file of MODULES) {
  if (!existsSync(file)) continue;
  const code = strip(readFileSync(file, 'utf8'));

  const own = new Set();
  const addAll = (re, group = 1) => { for (const m of code.matchAll(re)) if (m[group]) own.add(m[group]); };
  addAll(/function\s+([\w$]+)/g);
  addAll(/(?:const|let|var)\s+([\w$]+)\s*=/g);
  addAll(/class\s+([\w$]+)/g);
  addAll(/import\s+(?:(\w+)|\{([^}]+)\})\s+from/g);
  // import { a as b }
  for (const [, names] of code.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const n of names.split(',')) own.add(n.trim().split(/\s+as\s+/).pop());
  }
  // 函数/箭头函数参数
  for (const [, params] of code.matchAll(/(?:function\s*\w*|=>|\w+\s*)\s*\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of params.split(',')) {
      const name = p.trim().split(/[=:\s{[]/)[0];
      if (/^[\w$]+$/.test(name)) own.add(name);
    }
  }
  // 箭头函数参数（含 new Promise((res, rej) => ...) 这种）
  for (const [, params] of code.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const p2 of params.split(',')) {
      const name = p2.trim().split(/[=:\s{[]/)[0];
      if (/^[\w$]+$/.test(name)) own.add(name);
    }
  }
  // 对象字面量里的方法简写（例如 { addEventListener() {} } 这种）
  for (const [, name] of code.matchAll(/([\w$]+)\s*\([^()]*\)\s*\{\s*\}/g)) own.add(name);
  // 对象字面量里的方法简写 / 类方法
  for (const [, name] of code.matchAll(/^\s*([\w$]+)\s*\([^)]*\)\s*\{/gm)) own.add(name);
  // 解构
  for (const [, vars] of code.matchAll(/(?:const|let|var)\s*[[{]([^}\]]+)[}\]]\s*=/g)) {
    for (const v of vars.split(',')) {
      const name = v.trim().split(/[=:]/).pop().trim().split(/\s/)[0];
      if (/^\w+$/.test(name)) own.add(name);
    }
  }
  for (const [, v] of code.matchAll(/for\s*\(\s*(?:const|let)\s+(\w+)/g)) own.add(v);

  // 被调用但不是方法调用（前面不是 . 或 new）
  const calls = [...code.matchAll(/(?<![.\w$])(?!new\s)([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const unknown = [...new Set(calls)].filter((n) => !own.has(n) && !BUILTINS.has(n));

  if (unknown.length) {
    problems += unknown.length;
    console.log(`✗ ${file}: ${unknown.join(', ')}`);
  } else {
    console.log(`✓ ${file}`);
  }
}

console.log(problems ? `\n❌ ${problems} 处可能未定义` : '\n✅ 依赖全部可解析');
process.exit(problems ? 1 : 0);
