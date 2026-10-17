/**
 * API 端到端自检：对着已启动的服务跑一遍全部端点
 * 用法：node scripts/test-api.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:7311';
let pass = 0, fail = 0;
const rows = [];

async function get(p) {
  const r = await fetch(base + p);
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, body: ct.includes('json') ? await r.json() : await r.text() };
}
async function post(p, body) {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, body: ct.includes('json') ? await r.json() : await r.text() };
}

function check(name, ok, detail = '') {
  rows.push([ok ? 'PASS' : 'FAIL', name, detail]);
  ok ? pass++ : fail++;
}

const plot = '雨夜的屋顶上，他缓缓拔出刀，敌人从背后偷袭，他反手一刀斩断对方的刀锋，两人在积水里僵持。';

// 1 基础
const health = await get('/api/health');
check('GET /api/health', health.status === 200 && health.body.ok, `${health.body.templates} 模板`);

const meta = await get('/api/meta');
check('GET /api/meta', meta.status === 200 && meta.body.intents.length >= 16,
  `${Object.keys(meta.body.cultures).length} 画风 / ${meta.body.intents.length} 意图`);

// 2 模板
const list = await get('/api/templates?limit=1000');
check('GET /api/templates', list.status === 200 && list.body.total >= 100, `共 ${list.body.total} 套`);

const jp = await get('/api/templates?culture=jp');
check('GET /api/templates?culture=jp', jp.status === 200 && jp.body.items.every((t) => t.culture === 'jp'),
  `${jp.body.total} 套日式`);

const one = await get('/api/templates/ref-4band-2col');
check('GET /api/templates/:id', one.status === 200 && one.body.slots.length === 15,
  `${one.body.slots.length} 格 · ${one.body.ratio}`);

const svg = await get('/api/templates/jp-shonen-3tier/svg?width=800&numbers=1');
check('GET /api/templates/:id/svg', svg.status === 200 && svg.ct.includes('svg') && svg.body.startsWith('<svg'),
  `${svg.body.length} 字节`);

const nf = await get('/api/templates/不存在');
check('GET 不存在模板 → 404', nf.status === 404, `status=${nf.status}`);

// 3 匹配
const match = await post('/api/match', { plot, culture: 'jp', limit: 5 });
check('POST /api/match', match.status === 200 && match.body.results.length === 5 && match.body.analysis.primary === 'action',
  `primary=${match.body.analysis.primary} top=${match.body.results[0].id} ${match.body.results[0].score}`);

const matchAll = await post('/api/match', { plot, limit: 3 });
check('POST /api/match（不限画风）', matchAll.status === 200 && matchAll.body.results.length === 3);

const badMatch = await post('/api/match', {});
check('POST /api/match 缺 plot → 400', badMatch.status === 400);

// 4 分镜表
const plan = await post('/api/plan', { plot, maxPages: 2, pageWidth: 1600 });
const p0 = plan.body.pages?.[0]?.plan;
check('POST /api/plan', plan.status === 200 && p0 && p0.panels.length > 0,
  `${plan.body.pages.length} 页 / 首页 ${p0?.panels.length} 格 / ${p0?.template.id}`);

const planTpl = await post('/api/plan', { plot: '', templateId: 'jp-shonen-3tier' });
check('POST /api/plan（指定模板）', planTpl.status === 200 && planTpl.body.pages[0].plan.panels.length === 6);

const p = p0.panels[0];
check('分镜表字段完整', !!(p.promptEn && p.negative && p.genSize && p.aspectLabel && p.clipPath),
  `${p.roleZh} / ${p.beat} / ${p.genSize}`);

// 5 拼图
const compose = await post('/api/compose?format=json', {
  templateId: 'ref-4band-2col',
  images: ['https://example.com/a.png', 'https://example.com/b.png'],
});
check('POST /api/compose（数组按序）', compose.status === 200 && compose.body.filled === 2 && compose.body.svg.includes('<svg'),
  `filled=${compose.body.filled}`);

const composeSvg = await post('/api/compose', { templateId: 'jp-shonen-3tier', images: {} });
check('POST /api/compose（返回 SVG）', composeSvg.status === 200 && composeSvg.ct.includes('svg'));

// 6 其它
const oas = await get('/api/openapi.json');
check('GET /api/openapi.json', oas.status === 200 && oas.body.openapi === '3.0.3', `${Object.keys(oas.body.paths).length} paths`);

const tools = await get('/api/ai-tools.json');
check('GET /api/ai-tools.json', tools.status === 200 && tools.body.tools.openai.length >= 6 && !!tools.body.systemPrompt,
  `${tools.body.tools.openai.length} 个工具`);

const sheet = await get('/api/sheet?culture=kr');
check('GET /api/sheet', sheet.status === 200 && String(sheet.body).includes('<svg'), `${String(sheet.body).length} 字节`);

const root = await get('/');
check('GET / 网页', root.status === 200 && String(root.body).includes('PanelForge'));

const lib = await get('/lib/svg.mjs');
check('GET /lib/svg.mjs（浏览器复用内核）', lib.status === 200 && lib.ct.includes('javascript'));

const cors = await fetch(base + '/api/health');
check('CORS 头', cors.headers.get('access-control-allow-origin') === '*');

// 7 规则库（v2）
const rules = await get('/api/rules');
check('GET /api/rules', rules.status === 200 && rules.body.stats.intents >= 24 && rules.body.stats.keywords >= 1000,
  `${rules.body.stats.intents} 戏路 / ${rules.body.stats.keywords} 关键词 / ${rules.body.stats.beats} 节拍`);

const meta2 = await get('/api/meta');
check('规则规模写进 meta', !!meta2.body.engine && meta2.body.engine.total >= 1000, `${meta2.body.engine?.total} 词条`);

// 8 硬约束：提到竖屏 → 只给条漫模板
const strip = await post('/api/match', { plot: '我要做成竖屏条漫，女孩在天台上回忆小时候的夏天，风吹起她的头发。' });
check('硬约束（竖屏）过滤生效',
  strip.body.filtered?.applied === true && strip.body.results.every((r) => r.page.kind === 'scroll'),
  `保留 ${strip.body.filtered?.kept} 套 / kind=${strip.body.filtered?.kind}`);

// 9 否定处理：说「没有打斗」不该判成战斗
const neg = await post('/api/analyze', { plot: '这段没有打斗，也没有血迹，只是两个人在便利店里安静地聊天。' });
check('否定词生效', neg.body.primary !== 'action' && neg.body.primary !== 'horror' && neg.body.negated.length > 0,
  `primary=${neg.body.primary} negated=${neg.body.negated.map((n) => n.kw).join(',')}`);

// 11 形状词库（异形格 → 构图开头词）
const shapes = await get('/api/shapes');
check('GET /api/shapes', shapes.status === 200 && shapes.body.shapes.length >= 10,
  `${shapes.body.shapes.map((s) => s.zh).join('/')}`);

const pref = await post('/api/prefix', { shape: 'triangle', role: 'impact', culture: 'jp' });
check('POST /api/prefix', pref.status === 200 && pref.body.snippet.startsWith('diagonal triangular'), pref.body.snippet.slice(0, 48) + '…');

const tplShapes = await get('/api/templates/jp-triangle-impact/shapes');
check('GET /api/templates/:id/shapes', tplShapes.status === 200 && tplShapes.body.summary.some((x) => x.id === 'triangle'),
  JSON.stringify(tplShapes.body.summary));

const tri = await get('/api/templates/jp-triangle-impact');
check('模板每格带 shape', tri.status === 200 && tri.body.slots.every((s) => s.shape && s.shape.prefixEn));

const triPlan = await post('/api/plan', { plot, templateId: 'jp-triangle-impact' });
const triPanels = triPlan.body.pages[0].plan.panels;
check('提示词以形状开头词起手', triPanels.every((p) => p.promptEn.startsWith(p.shape.prefixEn)));
check('提示词含精简版与去重负面词', triPanels.every((p) => p.promptShort && p.negative)
  && new Set(triPanels[0].negative.split(',').map((s) => s.trim().toLowerCase())).size === triPanels[0].negative.split(',').length);

const aiNoKey = await post('/api/ai/prompts', { plot, templateId: 'jp-triangle-impact' });
check('无 Key 时 /api/ai/prompts 返回 400', aiNoKey.status === 400 && aiNoKey.body.code === 'NO_LLM_KEY');

// 12 AI 导演状态
const llmStatus = await get('/api/llm/status');check('GET /api/llm/status', llmStatus.status === 200 && 'configured' in llmStatus.body && !('apiKey' in llmStatus.body));

if (!llmStatus.body.configured) {
  const noKey = await post('/api/ai/decide', { plot });
  check('无 Key 时 /api/ai/decide 返回 400 + 兜底', noKey.status === 400 && noKey.body.code === 'NO_LLM_KEY' && noKey.body.fallback?.top?.length > 0);
  const noKeyTest = await post('/api/llm/test', {});
  check('无 Key 时 /api/llm/test 返回 400', noKeyTest.status === 400 && noKeyTest.body.code === 'NO_LLM_KEY');
} else {
  check('AI 已配置（跳过无 Key 分支）', true, llmStatus.body.model);
}

// 输出
const w = Math.max(...rows.map((r) => r[1].length));
console.log('\n  PanelForge API 自检  ' + base + '\n');
for (const [st, name, detail] of rows) {
  console.log(`  ${st === 'PASS' ? '✅' : '❌'} ${name.padEnd(w)}  ${detail}`);
}
console.log(`\n  ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
