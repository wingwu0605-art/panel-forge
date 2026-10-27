const base = 'https://wingwu0605-art.github.io/panel-forge';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
for (let i = 0; i < 18; i++) {
  const html = await (await fetch(`${base}/index.html?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text();
  const ver = html.match(/app\.js\?v=([a-z0-9]+)/)?.[1];
  const app = await (await fetch(`${base}/app.js?v=${ver}&ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text();
  let rails = '';
  try { rails = await (await fetch(`${base}/rails.mjs?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text(); } catch { /* 可能还没发 */ }
  const css = await (await fetch(`${base}/styles.css?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text();
  const marks = {
    appInstall: app.includes('installRails'),
    railsFile: rails.includes('makeRail'),
    railsIcons: rails.includes('bubbles:'),
    cssStrip: css.includes('.rail-strip'),
  };
  const miss = Object.entries(marks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`[${i + 1}] app ${app.length}B · rails ${rails.length}B · 缺 ${miss.join(',') || '无'}`);
  if (!miss.length) { ok = true; break; }
  await wait(12000);
}
console.log(ok ? '\n✅ 线上已含侧栏图标条' : '\n⚠️ 线上还没跟上');
