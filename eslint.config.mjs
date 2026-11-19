/**
 * ESLint（只在开发 / CI 用，不进运行时；项目本身仍然零依赖）
 *
 *   npm run lint        # = npx --yes eslint@9 .
 *
 * 只开「会在运行时炸」和「死代码」这两类规则：
 *   no-undef        —— 调了没导入的函数（goCanvasOnCompact / loadImgEl 就是这么漏的）
 *   no-unused-vars  —— 搬完模块留下的死导入 / 死函数
 *   no-dupe-keys    —— i18n 词典里同一个原文写了两遍（后一条静默覆盖前一条）
 * 风格类规则一律不开：格式由人看，不由工具吵。
 */
const BROWSER = [
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'indexedDB', 'performance', 'console', 'fetch', 'Request', 'Response', 'Headers', 'AbortController',
  'AbortSignal', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Image',
  'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLDialogElement', 'Node', 'NodeFilter',
  'Element', 'Event', 'CustomEvent', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'DragEvent',
  'ClipboardEvent', 'DataTransfer', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'PerformanceObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'getComputedStyle', 'matchMedia', 'innerWidth', 'innerHeight', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'confirm', 'prompt', 'alert', 'atob', 'btoa', 'CSS',
  'createImageBitmap', 'OffscreenCanvas', 'Path2D', 'DOMParser', 'XMLSerializer', 'WebSocket',
  'structuredClone', 'queueMicrotask', 'crypto', 'TextEncoder', 'TextDecoder', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'Intl', 'Animation', 'KeyframeEffect',
];
const NODE = [
  'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'URL', 'URLSearchParams', 'fetch', 'AbortController', 'AbortSignal', 'TextEncoder',
  'TextDecoder', 'structuredClone', 'queueMicrotask', 'performance', 'Blob', 'Response', 'Headers',
  'Request', 'FormData', 'WebSocket', 'crypto', 'atob', 'btoa', 'Intl',
];
const asGlobals = (list) => Object.fromEntries(list.map((g) => [g, 'readonly']));

const RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unsafe-negation': 'error',
  'no-constant-binary-expression': 'error',
  'no-redeclare': 'error',
};

export default [
  { ignores: ['web/klecks/**', 'web/vendor/**', 'native/**', 'site/**', 'out/**', 'node_modules/**'] },
  {
    // 浏览器端
    files: ['web/**/*.js', 'web/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: asGlobals(BROWSER) },
    rules: RULES,
  },
  {
    // 同构内核（浏览器 + Node 共用）
    files: ['lib/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: asGlobals([...new Set([...BROWSER, ...NODE])]) },
    rules: RULES,
  },
  {
    // Node 端：服务、脚本、配置（脚本里的 page.evaluate 字符串不算代码，不受影响）
    files: ['*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: asGlobals([...NODE, 'document', 'window', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'PointerEvent', 'Event', 'navigator', 'location', 'Image']) },
    rules: RULES,
  },
];
