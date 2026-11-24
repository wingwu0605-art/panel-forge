/**
 * sheet-page.mjs — 「全部模板一览」页（静态版 sheet.html 和服务器版 /api/sheet 共用）
 *
 * 库里有几千套：页面不再把所有缩略图一次拼进 HTML（那会是十几 MB），
 * 而是在浏览器里读同一份模板库，按「全部 / 日 / 中 / 韩 / 通」+「只看精选」筛，往下滚一批批画出来。
 *
 * @param {object} o
 * @param {string} o.lib      lib 目录的 URL 前缀（静态版 './lib/'，服务器版 '/lib/'）
 * @param {string} o.i18n     i18n.mjs 的 URL
 * @param {string} o.v        版本号（静态版的 ?v=，服务器版留空）
 * @param {string} o.home     「回到编辑器」默认地址
 * @param {object} o.editions 画师版 / 纯粹版的地址（?ed=painter|pure 时回到那里）
 * @param {object} o.counts   lib/library.mjs 的 COUNTS
 */
export function sheetPageHTML({ lib, i18n, v = '', home = './index.html', editions = { pure: './pure.html', painter: './painter.html' }, counts }) {
  const q = v ? `?v=${v}` : '';
  const GROUPS = [['all', '全部'], ['jp', '日式页漫'], ['kr', '韩式条漫'], ['cn', '中式 / 国风'], ['core', '通用 / 跨界']];
  const num = (k) => (k === 'all' ? counts.total : counts.byCulture[k]?.total || 0);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>全部模板一览 · PanelForge 分镜坊</title>
<style>
  :root{--bg:#f4f2ec;--ink:#1b1c1f;--dim:#7a776e;--line:#d8d4c9;--accent:#c8402c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,'Microsoft YaHei',sans-serif;padding:26px 30px 60px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px}
  h1{font-size:20px;margin:0}
  .sub{color:var(--dim);font-size:12px}
  a.back{margin-left:auto;color:var(--accent);text-decoration:none;font-size:12.5px;border-bottom:1px solid currentColor}
  nav{position:sticky;top:0;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);z-index:5;margin-bottom:18px;
    display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  nav button{font:inherit;font-size:12.5px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:3px 11px;cursor:pointer}
  nav button i{font-style:normal;color:var(--dim);margin-left:4px}
  nav button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  nav button.on i{color:#cfcac0}
  nav label{margin-left:8px;color:var(--dim);font-size:12.5px;display:flex;align-items:center;gap:4px;cursor:pointer}
  nav .count{margin-left:auto;color:var(--dim);font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
  figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;transition:.15s;cursor:pointer;
    content-visibility:auto;contain-intrinsic-size:auto 320px}
  figure:hover{box-shadow:0 6px 18px #0002;transform:translateY(-2px)}
  .svg{height:250px;display:flex;align-items:center;justify-content:center;padding:10px;background:#fff}
  .svg svg{max-height:230px;width:auto;max-width:100%}
  figcaption{padding:7px 9px 9px;border-top:1px solid #eee;font-size:11.5px}
  figcaption b{display:block;font-size:12px;margin-bottom:2px}
  .meta{color:var(--dim);font-size:10.5px}
  .pick{color:var(--accent);font-weight:600}
  #more{display:block;margin:22px auto 0;font:inherit;font-size:12.5px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 16px;cursor:pointer}
  footer{margin-top:36px;color:var(--dim);font-size:11.5px}
</style></head><body>
<header>
  <h1>全部模板一览</h1>
  <span class="sub">${counts.total} 套（精选 ${counts.curated} 套 + 扩展 ${counts.generated} 套）· 格子里的数字就是阅读顺序</span>
  <a class="back" href="${home}">← 回到编辑器</a>
</header>
<nav id="tabs">
  ${GROUPS.map(([k, label]) => `<button type="button" data-c="${k}"${k === 'all' ? ' class="on"' : ''}><span>${label}</span><i>${num(k)}</i></button>`).join('\n  ')}
  <label><input type="checkbox" id="onlyPick"> <span>只看精选</span></label>
  <span class="count" id="count"></span>
</nav>
<main class="grid" id="grid"></main>
<button type="button" id="more" hidden></button>
<footer>点开任意一套即可在编辑器里使用。精选是手做的版式；扩展是按日漫、韩漫条漫、国风、通用各自的分镜规律生成、逐套体检过的版式。</footer>
<script type="module">
  import { TEMPLATES } from '${lib}library.mjs${q}';
  import { renderTemplateSVG } from '${lib}svg.mjs${q}';
  import { installI18n } from '${i18n}${q}';
  // 跟编辑器同一个语言设置（同源 localStorage）；?lang= 也认
  const qs = new URLSearchParams(location.search);
  let lang = qs.get('lang');
  try { lang = lang || localStorage.getItem('pf.lang.v1'); } catch { /* 隐私模式 */ }
  if (lang && lang !== 'zh') installI18n(lang);
  // 从哪个版本点进来就回哪个版本（?ed=pure|painter）：纯粹版的人不该被带回 AI 版
  const ED = ${JSON.stringify(editions)}[qs.get('ed')] || '${home}';
  document.querySelector('a.back').href = ED;
  const READ_ZH = { rtl: '右→左', ltr: '左→右', vertical: '上→下' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAGE = 60;
  const grid = document.getElementById('grid');
  const more = document.getElementById('more');
  let culture = qs.get('culture') || 'all', onlyPick = false, list = [], shown = 0;
  const card = (t) => '<figure data-id="' + esc(t.id) + '"><div class="svg">' + renderTemplateSVG(t, { width: 240, showNumbers: true })
    + '</div><figcaption><b>' + esc(t.name) + '</b><span class="meta">' + t.panels + ' 格 · ' + t.ratio + ' · '
    + (READ_ZH[t.reading] || t.reading) + ' · ' + esc(t.id) + (t.curated ? ' · <span class="pick">精选</span>' : '') + '</span></figcaption></figure>';
  function draw() {
    const end = Math.min(list.length, shown + PAGE);
    grid.insertAdjacentHTML('beforeend', list.slice(shown, end).map(card).join(''));
    shown = end;
    more.hidden = shown >= list.length;
    more.textContent = '再显示 ' + Math.min(PAGE, list.length - shown) + ' 套（还有 ' + (list.length - shown) + ' 套）';
  }
  function reset() {
    list = TEMPLATES.filter((t) => (culture === 'all' || t.culture === culture) && (!onlyPick || t.curated));
    shown = 0;
    grid.innerHTML = '';
    document.getElementById('count').textContent = list.length + ' 套';
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.c === culture));
    draw();
  }
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]');
    if (b) { culture = b.dataset.c; reset(); }
  });
  document.getElementById('onlyPick').addEventListener('change', (e) => { onlyPick = e.target.checked; reset(); });
  more.addEventListener('click', draw);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !more.hidden) draw(); }, { rootMargin: '0px 0px 900px 0px' }).observe(more);
  }
  grid.addEventListener('click', (e) => {
    const f = e.target.closest('figure');
    if (f) location.href = ED + (ED.includes('?') ? '&' : '?') + 'tpl=' + encodeURIComponent(f.dataset.id);
  });
  reset();
</script>
</body></html>`;
}
