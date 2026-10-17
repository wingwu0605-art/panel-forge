/** 匹配引擎冒烟测试：看剧情 → 模板的选型是否合理 */
import { matchTemplates, analyzePlot, planStory } from '../lib/matcher.mjs';

const CASES = [
  ['战斗', '主角在雨夜的屋顶上拔刀，敌人从背后偷袭，反手一刀斩断对方的刀，两人在积水里僵持。'],
  ['言情', '她在便利店门口看见他撑着伞等她，脸一红，低头握紧了手里的塑料袋，半天说不出话。'],
  ['悬疑', '深夜走廊的灯忽明忽暗，脚步声越来越近，门缝里透出一线光，她屏住呼吸。'],
  ['韩式', '财阀少爷在会议室冷眼看着桌上的报告，脑海里闪过十年前那个雨夜，他握紧了钢笔。韩漫条漫风格。'],
  ['国风', '剑客立在竹林之巅，风起叶落，一剑刺出，剑气撕开雨幕。国风武侠。'],
  ['日常', '放学后教室里只剩两个人，她在黑板上写下明天的约定，转身笑得有点勉强。'],
  ['四格搞笑', '早上起床发现袜子穿反了，出门踩到水坑，到公司才发现裤子拉链没拉。四格。'],
];

for (const [label, plot] of CASES) {
  const a = analyzePlot(plot);
  const m = matchTemplates(plot, { limit: 4 });
  console.log(`\n=== ${label} === 意图: ${a.intents.slice(0, 3).map((i) => `${i.zh}(${i.conf})`).join(' / ')} | 格数≈${a.panelTarget} | 画风:${a.cultureHint || '-'} | 画幅:${a.ratioHint || '-'} | 节奏:${a.pace}`);
  for (const r of m.results) {
    console.log(`  ${String(r.score).padStart(5)} ${r.culture} ${r.id.padEnd(24)} ${r.panels}格 ${r.ratio.padEnd(6)} | ${r.why.join('；')}`);
  }
}

const one = '深夜走廊的灯忽明忽暗，脚步声越来越近，门缝里透出一线光，她屏住呼吸，握住门把。';
const m = matchTemplates(one, { limit: 1 });
const st = planStory(one, { maxPages: 2 });
console.log('\n=== 分镜表样例 ===');
const p = m.results[0];
console.log(p.id, p.score, p.why);
const plan = st.pages[0].plan;
for (const s of plan.panels) {
  console.log(`  ${s.order}. [${{}} ${s.roleZh}] ${s.beat || '过场'} | ${s.aspectLabel} | ${s.genSize}`);
  console.log(`       ${s.promptEn.slice(0, 150)}...`);
}
console.log('pages:', st.pages.length, st.pages.map((x) => x.plan.template.id));
