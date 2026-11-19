/**
 * 模块之间共享的应用能力（依赖注入用的一个对象）。
 *
 * 功能模块（paint-ui / auto-mode / inbox / keys / refs …）需要调用 app.js 里的
 * renderStage()、selectTemplate() 这类核心函数；直接 import app.js 会成环。
 * 以前每个模块各自一个 installXxxDeps({...})，同一个函数要注册三四遍、漏一个就静默变空函数。
 * 现在 app.js 在模块求值时一次性把核心能力挂到这里，所有模块从这一个对象取。
 *
 * 约定：只在函数体里用 `app.xxx()`，不要在模块顶层调用（那时 app.js 还没填完）。
 */
export const app = {};
