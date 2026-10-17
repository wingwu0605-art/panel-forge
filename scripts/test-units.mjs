/**
 * 纯函数单测（不启服务器、不连模型）：node scripts/test-units.mjs
 * 现在主要盯生图尺寸映射 —— 尺寸选错是最常见的一类「接口 400」。
 */
import { fitImageSize } from '../lib/llm-core.mjs';

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

console.log(`\n${fail ? '❌' : '✅'}  ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
