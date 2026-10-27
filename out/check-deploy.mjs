import { execFileSync } from 'node:child_process';

const token = (() => {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
  }).toString();
  return out.split('\n').find((l) => l.startsWith('password=')).slice('password='.length).trim();
})();
const remote = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim();
const [, owner, repo] = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);

const api = async (path) => {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'panelforge-check',
    },
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const { json } = await api(`/repos/${owner}/${repo}/actions/runs?per_page=5`);
for (const r of json?.workflow_runs || []) {
  console.log(`${r.created_at} · ${r.head_sha.slice(0, 7)} · ${r.status} · ${r.conclusion || '—'}`);
}
const mine = (json?.workflow_runs || []).find((r) => r.head_sha === head);
console.log(`\nHEAD ${head.slice(0, 7)} 的 run：${mine ? `${mine.status} / ${mine.conclusion || '进行中'}` : '还没触发'}`);
if (mine && mine.conclusion !== 'success') {
  const { json: jobs } = await api(`/repos/${owner}/${repo}/actions/runs/${mine.id}/jobs`);
  for (const job of jobs?.jobs || []) {
    console.log(`  作业 ${job.name}: ${job.conclusion}`);
    for (const st of job.steps || []) if (st.conclusion && st.conclusion !== 'success') console.log(`    失败步骤：${st.name} (${st.conclusion})`);
  }
}
