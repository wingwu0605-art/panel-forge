/**
 * 纯函数单测（不启服务器、不连模型）：node scripts/test-units.mjs
 * 现在主要盯生图尺寸映射 —— 尺寸选错是最常见的一类「接口 400」。
 */
import { estimateLayout, splitTextIntoPages, buildAutoSteps, imageQueueForPage, imageQueueAll, estimateCostHint, MAX_AUTO_PAGES } from '../lib/auto.mjs';
import { fitImageSize, resolveEndpoint, resolveImageEndpoint, baseRoot, isVersionedBase, chatErrorHint, normalizeCfg, imageHttpError, planImageRequest, imageRoute, normalizeLineItems } from '../lib/llm-core.mjs';
import { BUBBLES, BUBBLE_IDS, bubbleSVG, pickBubbleForText } from '../lib/bubbles.mjs';
import { splitClauses, assignSegments, buildPlan, matchTemplates, filterTemplatesByGenre, isGenreTag, GENRE_TAGS } from '../lib/matcher.mjs';
import { TEMPLATES } from '../lib/library.mjs';
import { analyzePlot } from '../lib/matcher.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}  → ${got}${ok ? '' : `（期望 ${want}）`}`);
};
const ok = (label, cond, extra = '') => {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
};

console.log('\nOpenAI 各家认的尺寸枚举');

// gpt-image-1：只认 1024x1024 / 1536x1024 / 1024x1536，喂 1792x1024 会 400
const GI = 'gpt-image-1';
for (const [want, size] of [
  ['1536x1024', '1792x1024'], ['1536x1024', '1280x1024'], ['1536x1024', '1536x1024'],
  ['1024x1536', '1024x1792'], ['1024x1536', '864x1152'], ['1024x1024', '1024x1024'],
  ['1024x1024', '1280x1200'],
]) eq(`gpt-image-1 ${size}`, fitImageSize('openai', size, GI), want);
ok('gpt-image-1 从不给 1792x1024', !['1792x1024', '1024x1792'].includes(fitImageSize('openai', '1792x1024', GI)));
ok('快照名也认（gpt-image-1-2025-04-15）', fitImageSize('openai', '1792x1024', 'gpt-image-1-2025-04-15') === '1536x1024');

// dall-e-3：只认三档，且不接受 1536x1024
const D3 = 'dall-e-3';
eq('dall-e-3 全景横', fitImageSize('openai', '1792x1024', D3), '1792x1024');
eq('dall-e-3 竖长', fitImageSize('openai', '1024x1792', D3), '1024x1792');
eq('dall-e-3 方', fitImageSize('openai', '1024x1024', D3), '1024x1024');
ok('dall-e-3 从不给 1536x1024', fitImageSize('openai', '1536x1024', D3) !== '1536x1024');

// dall-e-2：只有方的
eq('dall-e-2 竖图也回方格', fitImageSize('openai', '1024x1792', 'dall-e-2'), '1024x1024');

// 认不出模型：沿用旧的三档猜测，别把第三方兼容服务商搞崩
eq('未知模型 横', fitImageSize('openai', '1792x1024', 'some-model'), '1792x1024');
eq('未知模型 竖', fitImageSize('openai', '1024x1792', ''), '1024x1792');
eq('未知模型 不传模型', fitImageSize('openai', '1280x1024'), '1024x1024');

console.log('\n硅基流动 / Stability');
ok('硅基流动给合法枚举', ['1024x1024', '768x1024', '1024x768', '1280x720', '720x1280', '1152x864', '864x1152']
  .includes(fitImageSize('siliconflow', '1792x1024')));
eq('硅基流动 横长', fitImageSize('siliconflow', '1792x1024'), '1280x720');
eq('硅基流动 竖长', fitImageSize('siliconflow', '1024x1792'), '720x1280');
eq('Stability 用比例', fitImageSize('stability', '1792x1024'), '16:9');
eq('Stability 竖屏', fitImageSize('stability', '1024x1792'), '9:16');

console.log('\n乱七八糟的输入不许崩');
ok('空尺寸回默认', typeof fitImageSize('openai', '', GI) === 'string');
ok('坏尺寸回默认', fitImageSize('openai', 'abc', GI) === '1024x1024');
ok('× 与 * 也认', fitImageSize('openai', '1792×1024', GI) === '1536x1024');


console.log('\n气泡库：种类够多，且能按内容挑');
ok('气泡种类 ≥ 30', BUBBLE_IDS.length >= 30, BUBBLE_IDS.length + ' 种');
ok('每种都有中文名与提示', BUBBLE_IDS.every((id) => BUBBLES[id].zh && BUBBLES[id].hintZh));
ok('每种都能渲染出非空 SVG', BUBBLE_IDS.every((id) => {
  const svg = bubbleSVG({ type: id, x: 10, y: 10, w: 200, h: 120, text: '测试' }, {});
  return svg.length > 40 && svg.includes('<path') || svg.includes('<rect') || svg.includes('<ellipse');
}));
eq('拟声词 → 拟声牌', pickBubbleForText('砰！').type, 'note-sign');
eq('感叹号/喊叫 → 喊叫泡', pickBubbleForText('你竟敢拦我！').type, 'burst-spike');
eq('低语 → 波纹泡', pickBubbleForText('小声说：别出声……').type, 'whisper-wavy');
eq('心里想 → 思考泡', pickBubbleForText('心想：也许还有机会').type, 'thought-dashed');
eq('回忆 → 回忆框', pickBubbleForText('三年前的那个夏天').type, 'note-flashback');
eq('电话 → 屏幕泡', pickBubbleForText('电话那头：喂？').type, 'note-phone');
eq('旁白 → 旁白框', pickBubbleForText('旁白：第二天清晨').type, 'narration-box');
eq('短句 → 胶囊泡', pickBubbleForText('好').type, 'talk-capsule');
eq('长句 → 椭圆泡', pickBubbleForText('那就这样子吧，我们明天在门口见，别迟到了').type, 'talk-ellipse');
ok('空内容也有推荐（按景别）', !!pickBubbleForText('', { role: 'reaction' }).type);
ok('挑出来的类型都是真的存在', ['砰！', '你！', '小声……', '心想', '三年前', '电话', '旁白', '好', '长句子'.repeat(3)]
  .every((t) => BUBBLE_IDS.includes(pickBubbleForText(t).type)));


console.log('\n原文切分：规则模式也要把文章内容落到每格');
const plot = '雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋，两人在积水里僵持。';
const parts = splitClauses(plot);
ok('按句号/分号切开', parts.length === 2, parts.length + ' 句');
const seg = assignSegments(parts, 6);
ok('句子不够时按逗号切细，尽量填满', seg.filter(Boolean).length >= 5, seg.filter(Boolean).length + '/6 格有内容');
ok('切分保持原顺序、不丢句子', seg.join('').includes('雨夜的屋顶上')
  && seg.join('').includes('两人在积水里僵持'), seg.join(' / '));
ok('不编造内容：拼回去等于原文（去掉标点）', (() => {
  const strip = (x) => x.replace(/[，。；、,\s]/g, '');
  return strip(seg.join('')) === strip(plot);
})(), seg.join(''));

const longer = '第一幕：雨夜屋顶，他拔刀。第二幕：敌人偷袭。第三幕：反手斩断刀锋。第四幕：积水僵持。第五幕：收刀。第六幕：转身离开。第七幕：天亮。';
const seg7 = assignSegments(splitClauses(longer), 3);
ok('句子比格子多时按字数合并，且一格不漏', seg7.length === 3 && seg7.every(Boolean), seg7.map((x) => x.length).join('/'));

const tpl = TEMPLATES.find((t) => t.id === 'jp-shonen-3tier') || TEMPLATES[0];
const a = analyzePlot(plot, {});
const plan = buildPlan(tpl, a, { pageWidth: 1600, plot });
const withContent = plan.panels.filter((x) => x.content);
ok('buildPlan 把原文写进每格 content', withContent.length >= 2,
  plan.panels.map((x) => (x.content ? '有' : '空')).join(''));
ok('提示词里出现原文（中文版）', plan.panels[0].promptZh.includes('雨夜的屋顶上'), plan.panels[0].promptZh.slice(0, 60));
ok('提示词里出现原文（英文版 subject）', plan.panels[0].promptEn.includes('subject:'), plan.panels[0].promptEn.slice(-90));
ok('可复制的提示词里不再有 {{占位符}}', !/\{\{/.test(JSON.stringify(plan.panels)), '');
ok('没分到内容的格子用节拍提示兜底（不留空）',
  plan.panels.filter((x) => !x.content).every((x) => x.promptZh.includes('画面：')), '');

/* ------------------------------------------------------------------ *
 * 端点拼接：这类 bug 很隐蔽 —— 界面上看不出问题，只回报 404。
 * 真实踩过的坑：火山方舟是 /api/v3，只认 /v1 会拼成 /api/v3/v1/...；
 * 用户把完整端点粘进 Base URL 时，聊天和生图会各自拼错。
 * ------------------------------------------------------------------ */
const cfgOf = (baseUrl, extra = {}) => ({ baseUrl, protocol: 'openai', imageProvider: 'openai', ...extra });

ok('版本段识别：/api/v3 算已带版本',
  isVersionedBase('https://ark.cn-beijing.volces.com/api/v3') === true);
ok('版本段识别：裸域名不算',
  isVersionedBase('https://api.openai.com') === false);
ok('baseRoot 把完整生图端点截回版本段',
  baseRoot('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    === 'https://ark.cn-beijing.volces.com/api/v3',
  baseRoot('https://ark.cn-beijing.volces.com/api/v3/images/generations'));
ok('baseRoot 保留 /v1（不误删）',
  baseRoot('https://api.siliconflow.cn/v1') === 'https://api.siliconflow.cn/v1');

ok('火山方舟 chat 端点 = /api/v3/chat/completions',
  resolveEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3'))
    === 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  resolveEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3')));
ok('火山方舟 image 端点 = /api/v3/images/generations',
  resolveImageEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3'))
    === 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
  resolveImageEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3')));
ok('粘了完整生图端点时，chat 端点仍然正确',
  resolveEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3/images/generations'))
    === 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
ok('裸域名补 /v1（OpenAI 官方）',
  resolveEndpoint(cfgOf('https://api.openai.com')) === 'https://api.openai.com/v1/chat/completions');
ok('已带 /v1 不重复补',
  resolveEndpoint(cfgOf('https://api.deepseek.com/v1')) === 'https://api.deepseek.com/v1/chat/completions');
ok('Anthropic 走 /v1/messages',
  resolveEndpoint(cfgOf('https://api.anthropic.com', { protocol: 'anthropic' })) === 'https://api.anthropic.com/v1/messages');
ok('Stability 走 v2beta/stable-image/generate/core',
  resolveImageEndpoint(cfgOf('https://api.stability.ai', { imageProvider: 'stability' }))
    === 'https://api.stability.ai/v2beta/stable-image/generate/core');

// 火山方舟（Seedream）：一个端点同时管文生图/图生图；尺寸表不能用 OpenAI 那套
ok('火山方舟生图端点 = /api/v3/images/generations',
  resolveImageEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3', { imageProvider: 'volcengine' }))
    === 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
ok('火山方舟：光看域名也能认出来（即使用户把服务商选成 OpenAI）',
  resolveImageEndpoint(cfgOf('https://ark.cn-beijing.volces.com/api/v3'))
    === 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
ok('火山方舟尺寸不接受 OpenAI 的 1792x1024',
  fitImageSize('volcengine', '1600x900', 'doubao-seedream-5-0-pro-260628') !== '1792x1024',
  fitImageSize('volcengine', '1600x900', 'doubao-seedream-5-0-pro-260628'));
ok('火山方舟 1:1 走 1024x1024',
  fitImageSize('volcengine', '1024x1024', 'doubao-seedream-5-0-pro-260628') === '1024x1024');
ok('火山方舟竖图走 832x1248 或 720x1280',
  ['832x1248', '720x1280'].includes(fitImageSize('volcengine', '800x1200', 'doubao-seedream-5-0-pro-260628')),
  fitImageSize('volcengine', '800x1200', 'doubao-seedream-5-0-pro-260628'));

/* 报错文案：404 的三种原因必须分开说，否则用户只会一直改 Key */
const arkEp = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
ok('方舟 404 + 模型不存在 → 提示去「开通管理」开通',
  /开通管理/.test(chatErrorHint(404, 'The model or endpoint doubao-seed-1-6 does not exist', arkEp, 'doubao-seed-1-6')));
ok('方舟 404 提示里带上真实请求地址和模型名',
  chatErrorHint(404, 'model does not exist', arkEp, 'doubao-seed-1-6').includes('model=doubao-seed-1-6'));
ok('非方舟 404 不误导去开通管理',
  !/开通管理/.test(chatErrorHint(404, 'model not found', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini')));
ok('404 但内容不是模型问题时，指向 baseUrl 版本段',
  /baseUrl/.test(chatErrorHint(404, 'Not Found', 'https://x.com/v1/chat/completions', 'm')));
ok('401/403 指向 Key 与开通状态',
  /Key/.test(chatErrorHint(401, 'Unauthorized', arkEp, 'm')));
ok('429 提到额度/频率', /额度|频率/.test(chatErrorHint(429, 'rate limit', arkEp, 'm')));

/* 生图可以完全独立：文本用 A 家、生图用 B 家（两把 Key 两套地址） */
ok('生图 Base URL 优先于对话 Base URL',
  resolveImageEndpoint({ baseUrl: 'https://api.deepseek.com/v1', imgBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageProvider: 'volcengine' })
    === 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
ok('没填生图 Base URL 就回落用对话那条',
  resolveImageEndpoint({ baseUrl: 'https://api.openai.com/v1', imageProvider: 'openai' })
    === 'https://api.openai.com/v1/images/generations');
ok('两把 Key 都能被 normalizeCfg 保留',
  (() => {
    const c = normalizeCfg({ baseUrl: 'https://a/v1', apiKey: 'k1', imgKey: 'k2', imgBaseUrl: 'https://b/api/v3' });
    return c.apiKey === 'k1' && c.imgKey === 'k2' && c.imgBaseUrl === 'https://b/api/v3';
  })(),
  'imgKey 与 imgBaseUrl');

/* 生图报错必须「信息齐全」：用户报过「报错信息不全」——方舟 404 时响应体可能是空的 */
const arkImg = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const errEmpty = imageHttpError({ status: 404, bodyText: '', json: null, endpoint: arkImg, model: 'doubao-seedream-5-0-pro-260628', key: 'k', provider: 'volcengine' });
ok('空响应体也会写明原因，而不是留一个空冒号',
  errEmpty.message.includes('响应体为空'), errEmpty.message.split('\n')[0]);
ok('生图报错带上真实端点', errEmpty.message.includes('images/generations'));
ok('生图报错带上模型名', errEmpty.message.includes('doubao-seedream-5-0-pro-260628'));
ok('空响应体 + 方舟 → 提示去开通管理',
  /开通管理/.test(errEmpty.hint || ''), String(errEmpty.hint).slice(0, 40));

const body404 = { error: { message: 'The model or endpoint doubao-seedream-4-0 does not exist', request_id: 'req-9' } };
const errBody = imageHttpError({ status: 404, bodyText: JSON.stringify(body404), json: body404, endpoint: arkImg, model: 'doubao-seedream-4-0', key: 'k', provider: 'volcengine' });
ok('有响应体时把服务端原话带出来',
  errBody.message.includes('does not exist'));
ok('响应体里的 request_id 会被保留', errBody.requestId === 'req-9', String(errBody.requestId));

const b400 = { error: { message: 'invalid size: 1792x1024' } };
const err400 = imageHttpError({ status: 400, bodyText: JSON.stringify(b400), json: b400, endpoint: arkImg, model: 'm', key: 'k' });
ok('尺寸类 400 → 指向尺寸而不是 Key', /尺寸/.test(err400.hint || ''), String(err400.hint).slice(0, 30));

const errKey = imageHttpError({ status: 401, bodyText: 'Your api key: sk-secret-abcdef is invalid', json: null, endpoint: arkImg, model: 'm', key: 'sk-secret-abcdef' });
ok('401 报错里不泄露完整 Key', !errKey.message.includes('sk-secret-abcdef'), errKey.message.split('\n')[0]);

/* 回归：生图 Base URL 丢失时会打到对话那条 —— 用户报的
   「POST https://api.deepseek.com/images/generations · model=doubao-seedream-…」就是这个 */
const lost = planImageRequest({ baseUrl: 'https://api.deepseek.com/v1', imageProvider: 'volcengine' }, 'doubao-seedream-5-0-flash-260915');
ok('方舟模型 + 缺失生图 Base URL → 自动改回方舟地址',
  lost.endpoint === 'https://ark.cn-beijing.volces.com/api/v3/images/generations' && lost.corrected === true,
  `${lost.endpoint} corrected=${lost.corrected}`);
ok('配好的生图 Base URL 不会被改写',
  (() => {
    const p2 = planImageRequest({
      baseUrl: 'https://api.deepseek.com/v1',
      imgBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      imageProvider: 'volcengine',
    }, 'doubao-seedream-5-0-flash-260915');
    return p2.endpoint === 'https://ark.cn-beijing.volces.com/api/v3/images/generations' && p2.corrected === false;
  })());
ok('非方舟模型不受影响（OpenAI 仍走 /v1/images/generations）',
  planImageRequest({ baseUrl: 'https://api.openai.com/v1', imageProvider: 'openai' }, 'gpt-image-1').endpoint
    === 'https://api.openai.com/v1/images/generations');
ok('硅基流动仍走自己的地址',
  planImageRequest({ baseUrl: 'https://api.siliconflow.cn/v1', imageProvider: 'siliconflow' }, 'Kwai-Kolors/Kolors').endpoint
    === 'https://api.siliconflow.cn/v1/images/generations');

/* 参考图 / 无参考图：四条分支各自该打到哪、该带什么，全部用纯函数钉住 */
const arkCfg = { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageProvider: 'volcengine' };
ok('方舟无参考图 → 纯 generations', imageRoute(arkCfg, 'doubao-seedream-5-0-flash-260915', 0).mode === 'generations');
ok('方舟有参考图 → 同端点 + body.image（不去 /images/edits）',
  (() => { const r = imageRoute(arkCfg, 'doubao-seedream-5-0-flash-260915', 2); return r.mode === 'ark-image' && r.endpoint.includes('/api/v3/images/generations'); })());
ok('服务商误选 OpenAI 但模型是方舟 → 也走 ark-image（这次修的就是这条）',
  imageRoute({ baseUrl: 'https://api.deepseek.com/v1', imageProvider: 'openai' }, 'doubao-seedream-5-0-flash-260915', 2).mode === 'ark-image');
ok('OpenAI gpt-image 有参考图 → /images/edits',
  (() => { const r = imageRoute({ baseUrl: 'https://api.openai.com/v1', imageProvider: 'openai' }, 'gpt-image-1', 1); return r.mode === 'openai-edits' && r.endpoint.endsWith('/images/edits'); })());
ok('OpenAI dall-e-3 有参考图 → 忽略参考图而不是硬发 edits',
  (() => { const r = imageRoute({ baseUrl: 'https://api.openai.com/v1', imageProvider: 'openai' }, 'dall-e-3', 1); return r.mode === 'generations' && r.refsIgnored === 1 && r.refsUsed === 0; })());
ok('Stability 无参考图 → 走 aspect_ratio 模式', imageRoute({ baseUrl: 'https://api.stability.ai', imageProvider: 'stability' }, 'sd3', 0).mode === 'generations');
ok('Stability 有参考图 → init_image 模式',
  imageRoute({ baseUrl: 'https://api.stability.ai', imageProvider: 'stability' }, 'sd3', 1).mode === 'stability-init');
ok('硅基流动有参考图 → siliconflow-image',
  imageRoute({ baseUrl: 'https://api.siliconflow.cn/v1', imageProvider: 'siliconflow' }, 'Kwai-Kolors/Kolors', 1).mode === 'siliconflow-image');
ok('参考图数量超过 4 张时也不会崩（由分支内部 slice）',
  imageRoute(arkCfg, 'doubao-seedream-5-0-flash-260915', 9).refsUsed === 9);


/* 题材限制：用户「就喜欢日漫少年漫」→ 规则路和 AI 路都只在这一类里挑 */
ok('题材词表只含题材，不含版面标签', GENRE_TAGS.includes('少年') && !GENRE_TAGS.includes('大格'));
ok('isGenreTag 认题材、不认版面标签', isGenreTag('恐怖') === true && isGenreTag('斜切') === false);
ok('filterTemplatesByGenre 过滤生效', (() => {
  const all = [{ id: 'a', tags: ['少年'] }, { id: 'b', tags: ['少女'] }];
  return filterTemplatesByGenre(all, '少年').map((t) => t.id).join() === 'a';
})());
ok('filterTemplatesByGenre 命中为空时退回原池（不让人面对空白）', (() => {
  const all = [{ id: 'a', tags: ['少年'] }];
  return filterTemplatesByGenre(all, '恐怖').length === 1;
})());
ok('matchTemplates 按题材过滤（日式 + 恐怖 → 全是恐怖）', (() => {
  const r = matchTemplates('雨夜屋顶拔刀，敌人偷袭', { culture: 'jp', genre: '恐怖', limit: 5 });
  return r.results.length > 0 && r.results.every((t) => t.tags.includes('恐怖'));
})());
ok('matchTemplates 题材=不限时不受影响',
  matchTemplates('雨夜屋顶拔刀', { culture: 'jp', genre: 'all', limit: 5 }).results.length > 0);


/* AI 写台词：模型输出必须被归一化（防越界 slotId / 超长 / 假引号） */
const LINES = normalizeLineItems({
  lines: [
    { slotId: 'p1', text: '「别追了。」', kind: '台词', why: '收束' },
    { slotId: 'p9', text: '不存在的格子', kind: '台词' },
    { slotId: 'p2', text: '', kind: '台词' },
    { slotId: 'p3', text: '他说：走吧', kind: '瞎写' },
    { slotId: 'p4', text: '啊'.repeat(80), kind: '内心' },
  ],
}, ['p1', 'p2', 'p3', 'p4']);
ok('自动去掉模型加的引号', LINES.lines.p1.text === '别追了。', LINES.lines.p1.text);
ok('越界的 slotId 被丢掉并计数', LINES.dropped === 1 && !LINES.lines.p9);
ok('空句子的 kind 归为「空」', LINES.lines.p2.kind === '空' && LINES.lines.p2.text === '');
ok('非法 kind 回落成「台词」', LINES.lines.p3.kind === '台词');
ok('「他说：」前缀被剥掉', LINES.lines.p3.text === '走吧', LINES.lines.p3.text);
ok('超长句子被截断', LINES.lines.p4.text.length <= 40, String(LINES.lines.p4.text.length));


/* 全自动：页数估算 / 分页 / 步骤计划 / 队列（算错就是真金白银） */
ok('短文本至少 1 页', estimateLayout('一句话。').pages === 1);
ok('按字数估页数（260 字/页）', estimateLayout('字'.repeat(800)).pages === 4, String(estimateLayout('字'.repeat(800)).pages));
ok('超过上限会截断并标注', (() => { const e = estimateLayout('字'.repeat(260 * 30)); return e.pages === MAX_AUTO_PAGES && e.clamped === true; })());
ok('分页不切在句子中间（每页都以句末标点或为空）', (() => {
  const out = splitTextIntoPages('第一句。第二句！第三句？第四句。第五句。', 3);
  return out.length === 3 && out.slice(0, -1).every((t) => !t || /[。！？]$/.test(t));
})());
ok('story 模式不包含出图步骤', !buildAutoSteps({ mode: 'story', pages: 1 }).some((x) => x.cost === 'image'));
ok('full 模式包含出图步骤且排在最后', (() => {
  const st = buildAutoSteps({ mode: 'full', pages: 2 });
  return st[st.length - 1].cost === 'image' && st.some((x) => x.key === 'line-1');
})());
ok('队列跳过已经有图的格子', imageQueueForPage([{ id: 'p1' }, { id: 'p2' }], { p1: {} }).join() === 'p2');
ok('全部页队列带页码', (() => {
  const q = imageQueueAll([[{ id: 'a' }], [{ id: 'b' }]], [{}, {}]);
  return q.length === 2 && q[0].page === 0 && q[1].slotId === 'b';
})());
ok('花费提示给出区间与张数', (() => {
  const c = estimateCostHint({ images: 10 });
  return c.images === 10 && c.text.includes('10 张图') && /¥/.test(c.text);
})());

console.log(`\n${fail ? '❌' : '✅'}  ${pass} 通过 / ${fail} 失败`);



process.exit(fail ? 1 : 0);
