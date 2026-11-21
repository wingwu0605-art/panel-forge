/**
 * i18n.mjs —— 界面语言切换（中文 / English / 日本語 / 其他语言：Bahasa Indonesia）
 *
 * 做法是「DOM 原文映射」而不是把全站改成 t('key')：
 * 源码里的界面文案保持中文，渲染后按词典把中文换成目标语言（MutationObserver 同步翻新插入的节点）。
 *   - 源码保持中文可读；加一条翻译 = 往 i18n/strings.tsv 加一行，再跑 scripts/i18n-build.mjs
 *   - 动态生成的界面（右栏、toast、弹窗、日志）自动跟着翻
 *   - 带变量的句子用占位符：{0} 任意文字（会再翻一遍）、{#0} 数字，例如「已填入 {#0} 格」
 *   - 词典里没有的串保持中文（scripts/visual-check 的 i18n 覆盖率用例会把漏网的列出来）
 *
 * 词典按语言拆成 web/i18n/<lang>.mjs，**只在用到时才下载**（中文用户一个字节都不多下）。
 */

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff60]/;
const MAX_DEPTH = 5;
const WORDY = /[\u3040-\u30ff\u3400-\u9fff]/;   // 有假名或汉字才算「一段要翻的字」（单独的「＋」「：」不算）   // 拆句 / 占位符递归的层数上限（「A；B：C、D · E」这种要好几层）

export const LANGS = [
  { id: 'zh', label: '中文', html: 'zh-CN' },
  { id: 'en', label: 'English', html: 'en' },
  { id: 'ja', label: '日本語', html: 'ja' },
  { id: 'id', label: 'Bahasa Indonesia', html: 'id', more: true },   // 收在「其他语言」里
];
const LOADERS = {
  en: () => import('./i18n/en.mjs'),
  ja: () => import('./i18n/ja.mjs'),
  id: () => import('./i18n/id.mjs'),
};
const packs = {};   // lang → { dict, patterns, title }

/** 编译一份词典：普通键进 Map；带 {0} / {#0} 占位符的键编成正则 */
function compile(table, title) {
  const dict = new Map();
  const same = new Set();   // 译文和原文一模一样的词（日文的「少年」「停止」「画面」）：认得，只是不用改
  const patterns = [];
  for (const [k, v] of Object.entries(table || {})) {
    if (!v) continue;
    if (/\{#?\d\}/.test(k)) {
      const body = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\{#(\d)\\\}/g, '(\\d+(?:[.,]\\d+)?)')
        .replace(/\\\{(\d)\\\}$/, '(.*?)')     // 句尾的占位可以是空的（「导入 3 张角色卡{1}」里的附注常常没有）
        .replace(/\\\{(\d)\\\}/g, '(.+?)');
      const order = [...k.matchAll(/\{#?(\d)\}/g)].map((m) => Number(m[1]));
      // 具体程度：固定文字越多越具体；同样多时数字占位（{#n}）比任意文字占位更具体
      const weight = k.replace(/\{#?\d\}/g, '').length * 4 + (k.match(/\{#\d\}/g) || []).length;
      patterns.push([new RegExp('^' + body + '$'), v, order, weight]);
    } else {
      dict.set(k, v);
      if (v === k) same.add(k);
    }
  }
  // 先试最具体的句式：不然「{0}生图」会抢先吞掉「第 3 格已生成，……不支持图生图」这种长句
  patterns.sort((a, b) => b[3] - a[3]);
  return { dict, patterns, title, same };
}

/** 先把某个语言的词典下载好（切换语言前 await 它，切换本身就是同步的一步） */
export async function ensureLang(lang) {
  if (lang === 'zh' || packs[lang] || !LOADERS[lang]) return;
  const mod = await LOADERS[lang]();
  packs[lang] = compile(mod.default, mod.TITLE);
}

/** 句首的中文标点：英文 / 印尼语里换成半角（「：后半句」→「: second half」），日文保持全角 */
const westPunct = (p, lang) => (lang === 'ja' ? p
  : p.replace(/：\s*/, ': ').replace(/，\s*/, ', ').replace(/、\s*/, ', ').replace(/；\s*/, '; '));

/**
 * 填完占位符后的收尾：
 *   - 英文单复数：「1 panels」→「1 panel」（只认我们自己用到的那几个名词，免得误伤）
 *   - 英文 / 印尼语：「cards(skipped …)」这种中文全角括号翻过来贴在一起的，补一个空格
 */
const PLURAL = /\b1 (panel|image|page|key|line|beat|character card|card|duplicate|sample|character|step|bubble|reference image|candidate|invalid slotId|item)s\b/g;
function polish(s, lang) {
  if (lang === 'ja') return s;
  let out = s.replace(/([\p{L}\p{N}])\(/gu, '$1 (');
  if (lang === 'en') out = out.replace(PLURAL, '1 $1');
  return out;
}

/*
 * 反查：译文 → 原文。应用里常见「const old = btn.textContent; btn.textContent = '生成中…'; … btn.textContent = old;」，
 * 恢复回去的是**译文**；不反查的话，这个新文本节点会把译文当原文，切回中文时它还停在英文 / 日文。
 */
const reverse = new Map();   // lang → Map(译文 → 原文)
function remember(lang, out, src) {
  let m = reverse.get(lang);
  if (!m) reverse.set(lang, (m = new Map()));
  if (m.size > 6000) m.clear();   // 动态串（带数字的 toast）会越攒越多，到量就清
  m.set(out, src);
}
/** 这段文字是不是我们翻出来的译文？是就给回原文（保留首尾空白） */
function originalOf(lang, cur) {
  const t = cur.trim();
  const back = t && reverse.get(lang)?.get(t);
  return back ? cur.replace(t, back) : null;
}

let subMiss = null;   // 收集模式下：这一次翻译里没翻成的子段（「·」两边、标签：值……）
/**
 * 把一条原文翻成目标语言；翻不了就原样返回。
 * 测试时把 globalThis.__pfI18nMiss 设成一个 Set，翻不了的原文会记进去（覆盖率用例靠它找漏网的串）。
 */
export function translate(text, lang, depth = 0) {
  const collect = lang !== 'zh' && globalThis.__pfI18nMiss instanceof Set
    && (!globalThis.__pfI18nLang || globalThis.__pfI18nLang === lang);
  if (!collect) {
    const out = translateInner(text, lang, depth);
    if (depth === 0 && out !== text && lang !== 'zh') remember(lang, out.trim(), text.trim());
    return out;
  }
  if (depth === 0) subMiss = [];
  const out = translateInner(text, lang, depth);
  if (depth === 0 && out !== text) remember(lang, out.trim(), text.trim());
  const raw = (text || '').trim();
  if (out === text && raw && WORDY.test(raw) && !knownSame(raw, packs[lang])) {
    if (depth === 0) globalThis.__pfI18nMiss.add(raw);
    else subMiss?.push(raw);
  }
  // 整句翻了一部分：剩在结果里的子段才是真漏的（试探性拆分失败的不算）
  if (depth === 0 && out !== text) for (const p of subMiss || []) if (out.includes(p)) globalThis.__pfI18nMiss.add(p);
  if (depth === 0) subMiss = null;
  return out;
}

/** 原文本身就是译文（日文里大量汉字词和中文同形）：整句或切开后的每一段都在「同形」表里 */
function knownSame(raw, pack) {
  if (!pack) return false;
  const norm = raw.replace(/\s+/g, ' ');
  if (pack.same.has(norm)) return true;
  const parts = norm.split(/\s*[·、；，]\s*/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => !WORDY.test(p) || pack.same.has(p));
}

/** 给不经过 DOM 的文字用（导出的文件、剪贴板、下载文件名……）：按当前界面语言翻 */
export const t = (text) => translate(text, current);

function translateInner(text, lang, depth) {
  if (!text || lang === 'zh') return text;
  const pack = packs[lang];
  if (!pack) return text;
  const raw = text.trim();
  if (!raw || !CJK.test(raw)) return text;
  // HTML 源码里折行的长句：文本节点里带着换行和缩进，查词典前把连续空白压成一个空格
  const norm = raw.replace(/\s+/g, ' ');
  const hit = pack.dict.get(raw) ?? (norm !== raw ? pack.dict.get(norm) : undefined);
  if (hit) return text.replace(raw, hit);
  // 句首就是分隔符：「<b>标题</b>：后半句」里的「：后半句」、日志里的「· 选到「만화·动作页」」。
  // 先剥掉分隔符整句翻（放在「·」切段之前，免得把名字里的「·」切开）；后半句可以是带数字的句式
  const sep = raw.match(/^([·|/、,，:：；;]\s*)(.+)$/s);
  if (sep) {
    const body = sep[2].trim();
    const inner = depth < MAX_DEPTH ? translate(body, lang, depth + 1) : (pack.dict.get(body) ?? body);
    if (inner !== body) return text.replace(raw, westPunct(sep[1], lang) + inner);
  }
  for (const [re, tpl, order] of pack.patterns) {
    const m = norm.match(re);
    if (!m) continue;
    const vals = {};
    order.forEach((idx, g) => { vals[idx] = m[g + 1]; });
    // 占位符里的文字也再翻一遍（「第 3 格 · 全景」里的「全景」）
    const out = tpl.replace(/\{(\d)\}/g, (_, d) => (depth < MAX_DEPTH ? translate(vals[d] ?? '', lang, depth + 1) : (vals[d] ?? '')));
    return text.replace(raw, polish(out, lang));
  }
  const dict = { get: (k) => pack.dict.get(k) };
  const deeper = depth < MAX_DEPTH;
  // 多行文字：逐行翻
  if (deeper && raw.includes('\n')) {
    const lines = raw.split('\n');
    const done = lines.map((l) => translate(l, lang, depth + 1));
    if (done.some((l, i) => l !== lines[i])) return text.replace(raw, done.join('\n'));
  }
  // 「戏路匹配「战斗」；画面气质命中：动作」这种分号连起来的几句：逐句翻
  if (deeper && raw.includes('；')) {
    const parts = raw.split('；');
    if (parts.length > 1 && parts.every((x) => x.trim())) {
      const done = parts.map((p) => translate(p.trim(), lang, depth + 1));
      if (done.some((p, i) => p !== parts[i].trim())) return text.replace(raw, done.join(lang === 'ja' ? '；' : '; '));
    }
  }
  // 「8 格 · A4 · 右→左 · 上→下 · 日式页漫」这类**多段信息行**：
  // 按「 · 」切开逐段翻再拼回去。必须排在 sep/tail 之前，否则会被 tail 提前截断
  // （tail 只会翻最后一段，结果就变成半中半英）。
  if (deeper && /·/.test(raw)) {
    const parts = raw.split(/\s*·\s*/);
    if (parts.length > 1) {
      const done = parts.map((p) => translate(p, lang, depth + 1).trim());
      if (done.some((p, i) => p !== parts[i].trim())) return text.replace(raw, done.join(' · '));
    }
  }
  // 「动作、斜切、大格」这种顿号列表：每一项都认得才翻（半中半外不如原样）
  if (deeper && raw.includes('、') && !/[。！？]/.test(raw)) {
    const items = raw.split('、');
    if (items.length > 1 && items.every((x) => x.trim())) {
      const done = items.map((x) => translate(x.trim(), lang, depth + 1));
      const ok = (x, i) => x !== items[i].trim() || !CJK.test(x) || pack.same.has(items[i].trim());
      if (done.every(ok) && done.some((x, i) => x !== items[i].trim())) return text.replace(raw, done.join(lang === 'ja' ? '、' : ', '));
    }
  }
  // 「阅读顺序：右→左」这种 标签：值
  if (deeper) {
    const kv = raw.match(/^([^：:|]{1,16})[：:]\s*(.+)$/);
    if (kv) {
      const label = translate(kv[1], lang, depth + 1).trim();
      const value = translate(kv[2], lang, depth + 1).trim();
      if (label !== kv[1].trim() || value !== kv[2].trim()) {
        return text.replace(raw, `${label}: ${value}`);
      }
    }
  }
  // 「· 交代关系」「| 旁白」这种把分隔符和正文放在同一个文本节点里的写法：
  // 拆出分隔符，翻剩下的部分再拼回去
  // 「wide shot· 交接关系」这种前半段已经是英文、只有尾巴是中文的
  const tail = raw.match(/^(.*[·|]\s*)(.+)$/);
  if (tail) {
    const inner = dict.get(tail[2].trim());
    if (inner) return text.replace(raw, tail[1] + inner);
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * DOM 层：记住原文 → 按语言重写
 * ------------------------------------------------------------------ */
const originals = new WeakMap();   // textNode → 原文
const written = new WeakMap();     // textNode → 我们最后一次写进去的译文
const attrOriginals = new WeakMap(); // element → { attr: 原文 }
const attrWritten = new WeakMap();   // element → { attr: 我们写进去的译文 }
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
let current = 'zh';
let installed = false;
let mo = null;

/** 标了 translate="no" 的地方不翻（中文提示词是发给模型的原文，翻了反而错） */
const NO_TR = '[translate="no"], .notranslate';
const skipEl = (el) => !!el?.closest?.(NO_TR);

function walkText(root, fn) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) { if (!skipEl(root.parentElement)) fn(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  // 不翻代码块 / 已经是我们自己注入的内容
  if (/^(SCRIPT|STYLE|CODE|PRE)$/i.test(root.tagName || '') || skipEl(root)) return;
  const doc = root.ownerDocument || document;
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const list = [];
  while (w.nextNode()) list.push(w.currentNode);
  for (const n of list) {
    const p = n.parentElement;
    if (p && (/^(SCRIPT|STYLE|CODE|PRE|TEXTAREA)$/i.test(p.tagName) || skipEl(p))) continue;
    fn(n);
  }
}

/*
 * 中文里「AI 会在……里<b>自己挑一套</b>（画面内容＋台词）」这种句子，片段之间没有空格；
 * 翻成英文 / 印尼语后要在片段交界处补空格，不然就成了「AI willpick one」。
 * 只看行内元素（b / span / a…）两侧，块级元素和按钮本来就分开显示。
 */
const SPACED = new Set(['en', 'id']);
const INLINE = /^(B|STRONG|EM|I|SPAN|A|SMALL|MARK|U|KBD|LABEL)$/;
function textBefore(node) {
  let n = node;
  while (n && !n.previousSibling && n.parentElement && INLINE.test(n.parentElement.tagName)) n = n.parentElement;
  const p = n?.previousSibling;
  if (!p) return '';
  if (p.nodeType === Node.TEXT_NODE) return p.nodeValue || '';
  return p.nodeType === Node.ELEMENT_NODE && INLINE.test(p.tagName) ? (p.textContent || '') : '';
}
function spaced(node, next, src) {
  if (!SPACED.has(current) || next === src) return next;
  return /[A-Za-z0-9.,;:!?)\]”’%]$/.test(textBefore(node)) && /^[A-Za-z0-9(“‘]/.test(next) ? ' ' + next : next;
}

function applyTextNodes(root) {
  walkText(root, (node) => {
    const cur = node.nodeValue;
    let src = originals.get(node);
    // 第一次见到，或者应用代码后来直接改了这段文字（不是我们写的那份译文）→ 现在的值才是原文
    if (src === undefined || (cur !== src && cur !== written.get(node))) {
      src = (current !== 'zh' && originalOf(current, cur)) || cur;
      originals.set(node, src);
    }
    const next = spaced(node, translate(src, current), src);
    if (cur !== next) node.nodeValue = next;
    written.set(node, next);
  });
}

function applyAttr(el, attr) {
  if (!el.hasAttribute(attr)) return;
  const cur = el.getAttribute(attr);
  let store = attrOriginals.get(el);
  if (!store) { store = {}; attrOriginals.set(el, store); }
  let mine = attrWritten.get(el);
  if (!mine) { mine = {}; attrWritten.set(el, mine); }
  // 同上：应用代码换了提示文字（比如「收起」↔「展开」）→ 新值才是原文，别用旧原文盖回去
  if (!(attr in store) || (cur !== store[attr] && cur !== mine[attr])) store[attr] = (current !== 'zh' && originalOf(current, cur)) || cur;
  const next = translate(store[attr], current);
  if (cur !== next) el.setAttribute(attr, next);
  mine[attr] = next;
}

function applyAttrs(root) {
  const els = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
  for (const el of els) {
    if (skipEl(el)) continue;
    for (const attr of TEXT_ATTRS) applyAttr(el, attr);
  }
}

/** 把整页（或某个子树）翻译成当前语言 */
export function retranslate(root = document.body) {
  applyTextNodes(root);
  applyAttrs(root);
  try { refitSlotLabels(root); } catch { /* ignore */ }
}

let translatingFlag = false;   // 防止"翻译 → 触发 mutation → 再翻译"的回环

function startObserver() {
  if (mo || typeof MutationObserver === 'undefined') return;
  mo = new MutationObserver((records) => {
    // 中文界面不需要翻译，别白跑
    if (current === 'zh' || translatingFlag) return;
    translatingFlag = true;
    try {
      // 同步翻译「新插入的节点」而不是等下一帧整页重扫：
      // 等 rAF 的话，滑动/切页的那一两帧里新内容还是中文 —— 用户看到的就是"闪中文"
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const node of rec.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) retranslate(node);
            else if (node.nodeType === Node.TEXT_NODE && node.parentElement) retranslate(node.parentElement);
          }
        } else if (rec.type === 'characterData' && rec.target.parentElement) {
          retranslate(rec.target.parentElement);
        } else if (rec.type === 'attributes' && rec.target.nodeType === Node.ELEMENT_NODE && !skipEl(rec.target)) {
          applyAttr(rec.target, rec.attributeName);
        }
      }
      refitSlotLabels();
    } finally {
      translatingFlag = false;
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TEXT_ATTRS });
}

/** SVG 里的格子标签：文字变长/变短后要重算底框宽度，否则英文会压在边框上 */
export function refitSlotLabels(root = document.body) {
  for (const tx of root.querySelectorAll?.('.slot-label-tx') || []) {
    const g = tx.closest('.slot-label');
    const bg = g?.querySelector('.slot-label-bg');
    if (!bg) continue;
    const pad = Number(bg.dataset.pad) || 0;
    let w = 0;
    try { w = tx.getComputedTextLength(); } catch { w = 0; }
    if (!w) {
      // 还没渲染出来（或测量失败）：退回到按字符估宽
      const fsz = Number(tx.getAttribute('font-size')) || 16;
      w = [...(tx.textContent || '')].reduce((acc, ch) => {
        if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) return acc + fsz;
        if (ch === ' ') return acc + fsz * 0.3;
        return acc + fsz * 0.56;
      }, 0);
    }
    bg.setAttribute('width', String(Math.round((w + pad * 2) * 10) / 10));
  }
}

export function getLang() { return current; }

let zhTitle = '';   // 页面原本的（中文）标题：切回中文时要还原，不能停在英文标题上

/** 切换语言（同步）。词典还没下载就先下载，到了再整页翻一遍 */
export function setLang(lang) {
  current = LANGS.some((l) => l.id === lang) ? lang : 'zh';
  const root = document.documentElement;
  root.lang = LANGS.find((l) => l.id === current).html;
  root.dataset.lang = current;
  if (!zhTitle) zhTitle = document.title;
  const apply = () => {
    if (current === 'zh') document.title = zhTitle;
    else {
      const t = translate(zhTitle, current);
      document.title = t !== zhTitle ? t : (packs[current]?.title || zhTitle);
    }
    if (installed) retranslate(document.body);
  };
  if (current !== 'zh' && !packs[current]) ensureLang(current).then(apply, () => {});
  else apply();
  return current;
}

/**
 * 装上（只装一次）：先等词典下载好再翻整页，然后摘掉启动脚本挂的「翻译中」标记
 * （非中文用户打开时不会先看到一屏中文再跳成目标语言）。返回卸载函数（测试用）。
 */
export async function installI18n(initial = 'zh') {
  try { await ensureLang(initial); } catch { /* 词典下载失败：退回中文也比白屏强 */ }
  installed = true;
  setLang(initial);
  startObserver();
  retranslate(document.body);
  delete document.documentElement.dataset.i18nPending;
  return () => { mo?.disconnect(); mo = null; installed = false; };
}

/** 覆盖率统计：当前语言下，还有多少条中文没翻（调试用） */
export function stats(root = document.body) {
  let total = 0, hit = 0;
  walkText(root, (node) => {
    const src = originals.get(node) ?? node.nodeValue;
    if (!/[\u4e00-\u9fa5]/.test(src)) return;
    total++;
    if (translate(src, current) !== src) hit++;
  });
  return { lang: current, chinese: total, translated: hit, missing: total - hit };
}
