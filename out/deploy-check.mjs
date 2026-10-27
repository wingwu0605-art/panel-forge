import { execFileSync } from 'node:child_process';

const token = (() => {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
  }).toString();
  return out.split('\n').find((l) => l.startsWith('password=')).slice('password='.length).trim();
})();
const remote = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim();
const [, owner, repo] = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (path) => {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pf-deploy-check' },
  });
  return await r.json().catch(() => null);
};

/* 1) 等 HEAD 的 Pages run 结束 */
let run = null;
for (let i = 0; i < 45; i++) {
  const j = await api(`/repos/${owner}/${repo}/actions/runs?per_page=8`);
  run = (j?.workflow_runs || []).find((r) => r.head_sha === head);
  if (run?.status === 'completed') break;
  console.log(`[${i + 1}] ${run ? run.status : '未触发'} · ${head.slice(0, 7)}`);
  await wait(12000);
}
console.log(`\nHEAD ${head.slice(0, 7)} → ${run ? `${run.status} / ${run.conclusion}` : '未触发'}`);
if (run && run.conclusion !== 'success') {
  const jobs = await api(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`);
  for (const job of jobs?.jobs || []) {
    console.log(`  作业 ${job.name}: ${job.conclusion}`);
    for (const st of job.steps || []) if (st.conclusion && st.conclusion !== 'success') console.log(`    失败步骤：${st.name} (${st.conclusion})`);
  }
}

/* 2) 线上验收：每一轮改动都要能在线上产物里找到 */
const HTML_MARKS = ['id="autoCard"', 'id="fabGenPage"', '分镜自动', '一键生成该页', '一键生成全部分镜'];
const APP_MARKS = ['startLongPress', 'confirmCharacters', 'acceptTextFiles', 'installContextMenu', 'openLightbox', 'aiWriteLines', 'imageRoute'];

const base = `https://${owner}.github.io/${repo}`;
let ok = false;
for (let i = 0; i < 15; i++) {
  const html = await (await fetch(`${base}/index.html?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text();
  const m = html.match(/app\.js\?v=([a-z0-9]+)/);
  const app = m ? await (await fetch(`${base}/app.js?v=${m[1]}&ts=${Date.now()}`)).text() : '';
  const missHtml = HTML_MARKS.filter((k) => !html.includes(k));
  const missApp = APP_MARKS.filter((k) => !app.includes(k));
  console.log(`[${i + 1}] index ${html.length}B · app ${app.length}B · 缺 html=${missHtml.join(',') || '无'} · 缺 app=${missApp.join(',') || '无'}`);
  if (!missHtml.length && !missApp.length) { ok = true; break; }
  await wait(12000);
}
console.log(ok ? '\n✅ 线上已是最新版本（全部标记都在）' : '\n⚠️ 线上还没跟上，稍后重试');

/* 3) 顺带确认站点几处入口可访问 */
for (const path of ['/', '/painter.html', '/lib/auto.mjs', '/lib/llm.mjs']) {
  try {
    const r = await fetch(`${base}${path}?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    console.log(`GET ${path} → ${r.status}`);
  } catch (e) { console.log(`GET ${path} → ERR ${e.message}`); }
}
