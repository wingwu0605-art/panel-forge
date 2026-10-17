/**
 * test-llm-mock.mjs — 用一个本地假模型把「AI 导演」整条链路跑通
 * （不需要真 key：验证 endpoint 解析、鉴权头、JSON 解析、id 校验、逐格排戏合并）
 *
 * 用法：node scripts/test-llm-mock.mjs
 */
import http from 'node:http';

const PF = process.env.PF_BASE || 'http://127.0.0.1:7311';
const MOCK_PORT = 7399;

let seenAuth = null;
let seenBody = null;

const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || '{}');
  seenAuth = req.headers.authorization || req.headers['x-api-key'];
  seenBody = body;

  // 从用户消息里取出候选清单，按第一个候选生成合法回答
  const userMsg = body.messages?.[1]?.content || body.messages?.[0]?.content || '{}';
  let brief = {};
  try { brief = JSON.parse(userMsg); } catch { /* ignore */ }
  const cands = brief['候选模板'] || [];
  const pick = cands[Math.min(1, cands.length - 1)] || { id: 'x', slots: [] };

  const panels = (pick.slots || []).map((s) => ({
    slotId: s.id,
    beat: s.order === 1 ? '开场定调' : '推进',
    content: `第 ${s.order} 格：mock 画面内容，${s.roleZh || s.role}镜头`,
    dialogue: s.order === 1 ? 'mock 台词' : '',
  }));

  const payload = {
    pick: pick.id,
    confidence: 0.91,
    reason: 'mock：这套版式的格数与节拍顺序最贴剧情（本地假模型，仅用于链路验证）',
    alternatives: cands.slice(0, 2).map((c) => ({ id: c.id, reason: 'mock 备选' })),
    panels,
  };

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'chatcmpl-mock',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 400, total_tokens: 1600 },
  }));
});

await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
console.log(`mock 模型已启动：http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

try {
  const plot = '雨夜屋顶，他拔刀，反手斩断对方刀锋，两人在积水里僵持。';

  // 1. 连通性测试
  const test = await fetch(PF + '/api/llm/test', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ llm: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'sk-mock', model: 'mock-1' } }),
  }).then((r) => r.json());
  check('POST /api/llm/test', test.ok === true, `${test.latencyMs}ms · ${test.model}`);

  // 2. AI 导演
  const res = await fetch(PF + '/api/ai/decide', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plot, culture: 'jp', pageWidth: 1600, candidates: 8,
      llm: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'sk-mock', model: 'mock-1' },
    }),
  }).then((r) => r.json());

  check('POST /api/ai/decide 返回 ok', res.ok === true, res.error || '');
  check('鉴权头已带上', seenAuth === 'Bearer sk-mock', String(seenAuth));
  check('endpoint 自动补 /v1/chat/completions', seenBody?.model === 'mock-1');
  check('决策含 pick/理由/置信度', !!(res.decision?.pick && res.decision?.reason && res.decision?.confidence >= 0),
    `${res.decision?.pick} ${res.decision?.confidence}`);
  check('pick 是合法候选 id', (res.candidates || []).some((c) => c.id === res.decision?.pick));

  const panels = res.plan?.panels || [];
  check('分镜表已合并 AI 排戏', panels.length > 0 && panels.every((p) => p.content && p.beat));
  check('提示词注入了 AI 画面内容', panels[0]?.promptEn?.includes('mock 画面内容'));
  check('台词透传到分镜表', panels[0]?.dialogue === 'mock 台词');
  check('没有 invalid slotId 被丢弃', (res.decision?.quality?.dropped || []).length === 0);
  check('usage 已回传', !!res.llm?.usage?.total_tokens, `${res.llm?.usage?.total_tokens} tokens`);

  // 3. 模型编造非法 id 时应被纠正
  mock.removeAllListeners('request');
  mock.on('request', async (req, res2) => {
    for await (const _ of req) { /* drain */ }
    const bad = { pick: 'completely-made-up-template', confidence: 0.5, reason: 'bad id', panels: [{ slotId: 'nope', beat: 'x', content: 'y', dialogue: '' }] };
    res2.writeHead(200, { 'content-type': 'application/json' });
    res2.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] }));
  });
  const res2 = await fetch(PF + '/api/ai/decide', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plot, llm: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'sk-mock', model: 'mock-1' } }),
  }).then((r) => r.json());
  check('非法 pick 被纠正为合法候选', res2.ok === true && res2.decision?.quality?.corrected === true, res2.decision?.pick);
  check('无效 slotId 被丢弃', (res2.decision?.quality?.dropped || []).length > 0);
  check('缺格回落规则节拍（不崩）', (res2.plan?.panels || []).every((p) => p.roleZh));
} finally {
  await new Promise((r) => mock.close(r));
}

console.log(`\n  AI 导演链路：${pass} 通过 / ${fail} 失败\n`);
process.exitCode = fail ? 1 : 0;
