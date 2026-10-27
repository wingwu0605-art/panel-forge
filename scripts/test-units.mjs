/**
 * 纯函数单测（不启服务器、不连模型）：node scripts/test-units.mjs
 * 现在主要盯生图尺寸映射 —— 尺寸选错是最常见的一类「接口 400」。
 */
import { fitImageSize, resolveEndpoint, resolveImageEndpoint, baseRoot, isVersionedBase } from '../lib/llm-core.mjs';
import { BUBBLES, BUBBLE_IDS, bubbleSVG, pickBubbleForText } from '../lib/bubbles.mjs';
import { splitClauses, assignSegments, buildPlan } from '../lib/matcher.mjs';
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

console.log(`\n${fail ? '❌' : '✅'}  ${pass} 通过 / ${fail} 失败`);


process.exit(fail ? 1 : 0);
