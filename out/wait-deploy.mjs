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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pf' },
  });
  return await r.json().catch(() => null);
};

// 等 HEAD 的 Pages 部署完成
let run = null;
for (let i = 0; i < 40; i++) {
  const j = await api(`/repos/${owner}/${repo}/actions/runs?per_page=6`);
  run = (j?.workflow_runs || []).find((r) => r.head_sha === head);
  if (run?.status === 'completed') break;
  console.log(`第 ${i + 1} 次：${run ? run.status : '未触发'}`);
  await wait(12000);
}
console.log(`\nHEAD ${head.slice(0, 7)} → ${run ? `${run.status} / ${run.conclusion}` : '未触发'}`);

// 线上验收：等 CDN 跟上（最多 3 分钟）
const need = ['id="autoCard"', 'id="autoPanel"', 'id="fabGenPage"', '分镜自动'];
let okAll = false;
for (let i = 0; i < 15; i++) {
  const r = await fetch(`https://${owner}.github.io/${repo}/index.html?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
  const html = await r.text();
  const miss = need.filter((k) => !html.includes(k));
  const appMatch = html.match(/app\.js\?v=([a-z0-9]+)/);
  const app = appMatch ? await (await fetch(`https://${owner}.github.io/${repo}/app.js?v=${appMatch[1]}&ts=${Date.now()}`)).text() : '';
  const hasAutoCard = app.includes('autoCard');
  console.log(`第 ${i + 1} 次：index ${html.length}B · 缺 ${miss.length ? miss.join(',') : '无'} · app 含 autoCard=${hasAutoCard}`);
  if (!miss.length && hasAutoCard) { okAll = true; break; }
  await wait(12000);
}
console.log(okAll ? '\n✅ 线上已是新版本（autoCard / fabGenPage / 分镜自动 都在）' : '\n⚠️ 线上仍未更新完全，稍后重试或强制刷新');
