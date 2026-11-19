/**
 * 页内自检（只在 URL 带参数时按需加载，平时不进首屏）：
 *   ?keyselftest=1  派发真实 keydown，检查快捷键是否真的改了状态
 *   ?aiselftest=1   静态版「浏览器直连模型」整条链路（配合 scripts/mock-llm）
 * 结果贴在页面右下角，同时打到控制台（自动化测试读的是 .selftest 里的文字）。
 */
import { $ } from './util.mjs';
import { state, commit, resetHistory } from './state.mjs';
import { KEYS } from './storage.mjs';
import { app } from './ctx.mjs';

function report(title, rows) {
  const pass = rows.filter((r) => r.cond).length;
  const box = document.createElement('div');
  box.className = 'selftest';
  box.innerHTML = `<b>${title}：${pass}/${rows.length} 通过</b>` +
    rows.map((r) => `<div class="${r.cond ? '' : 'no'}">${r.cond ? '✅' : '❌'} ${r.name}${r.extra ? ' — ' + r.extra : ''}</div>`).join('');
  document.body.appendChild(box);
  console.log(box.textContent);
  return pass === rows.length;
}

/* ------------------------------------------------------------------ 快捷键 */
export async function runKeySelfTest() {
  const rows = [];
  const ok = (name, cond, extra = '') => rows.push({ name, cond: !!cond, extra });
  const press = (key, opts = {}) => {
    document.activeElement?.blur?.();
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true,
    }));
  };
  const slots = state.tpl.slots;
  const s0 = slots[0].id;
  const s1 = slots[1]?.id || s0;
  const sel = () => app.selectedBubble();

  state.images = {}; state.bubbles = []; state.lines = {};
  state.selBubble = null; state.selectedId = s0;
  resetHistory();

  // 撤销 / 重做
  commit();
  state.images[s0] = { href: 'data:image/png;base64,iVBORw0KGgo=', iw: 8, ih: 8, zoom: 1, panX: 0, panY: 0, mode: 'cover', name: 't' };
  ok('准备：第 1 格有图', !!state.images[s0]);
  press('z', { ctrl: true });
  ok('Ctrl+Z 撤销 → 图没了', !state.images[s0], `${Object.keys(state.images).length} 张`);
  press('z', { ctrl: true, shift: true });
  ok('Ctrl+Shift+Z 重做 → 图回来', !!state.images[s0]);

  // 复制 / 粘贴 / 删除
  state.selectedId = s0;
  press('c', { ctrl: true });
  ok('Ctrl+C 复制图片', state.clipboard?.kind === 'image');
  state.selectedId = s1;
  press('v', { ctrl: true });
  ok('Ctrl+V 粘贴到第 2 格', !!state.images[s1]);
  press('Delete');
  ok('Delete 移除第 2 格图片', !state.images[s1]);

  // 气泡：尺寸 / 微调 / 复制 / 删除
  state.selectedId = s0;
  app.addBubble('talk-ellipse', { noCommit: true });
  const b0 = sel();
  ok('气泡已添加', !!b0);
  if (b0) {
    const w0 = b0.w;
    press(']');
    ok('] 放大气泡', sel().w > w0, `${w0}→${sel().w}`);
    const w1 = sel().w;
    press('[');
    ok('[ 缩小气泡', sel().w < w1);
    const y0 = sel().y;
    press('ArrowDown', { shift: true });
    ok('Shift+↓ 下移 10', sel().y === y0 + 10, `${y0}→${sel().y}`);
    const n0 = state.bubbles.length;
    press('d', { ctrl: true });
    ok('Ctrl+D 复制气泡', state.bubbles.length === n0 + 1, `${n0}→${state.bubbles.length}`);
    press('Delete');
    ok('Delete 删除气泡', state.bubbles.length === n0);
  }

  // 视图开关 / 数字跳格 / 帮助
  const hollow0 = $('#chkHollow').checked;
  press('h');
  ok('H 切换镂空', $('#chkHollow').checked !== hollow0);
  press('h');
  const labels0 = $('#chkLabels').checked;
  press('g');
  ok('G 切换格号', $('#chkLabels').checked !== labels0);
  press('2');
  ok('数字键 2 跳到第 2 格', state.selectedId === s1);
  press('?');
  ok('? 打开快捷键表', $('#shortcuts').open === true);
  press('Escape');
  ok('Esc 关闭快捷键表', $('#shortcuts').open === false);

  return report('快捷键自检', rows);
}

/* ------------------------------------------------------------------ 静态版 AI 链路 */
export async function runAiSelfTest() {
  const rows = [];
  const ok = (name, cond, extra = '') => rows.push({ name, cond: !!cond, extra });
  try {
    await aiSelfTestBody(ok);
  } catch (e) {
    rows.push({ name: '自检过程异常：' + e.message, cond: false, extra: String(e.stack || '').slice(0, 160) });
  }
  return report('静态版 AI 自检', rows);
}

async function aiSelfTestBody(ok) {
  const { createStaticApi } = await import('./api-static.js');
  const sapi = createStaticApi();

  // 指向本地假模型（CORS 开放）
  state.llm = { protocol: 'openai', baseUrl: 'http://127.0.0.1:7399', apiKey: 'mock-key', model: 'mock-model' };
  localStorage.setItem(KEYS.llm, JSON.stringify(state.llm));

  const status = await sapi.llmStatus();
  ok('静态版 llmStatus 认得 Key', status.configured === true && status.staticMode === true);

  try {
    const t = await sapi.llmTest({ llm: state.llm });
    ok('llmTest 浏览器直连成功', t.ok === true, t.reply || t.error || '');
  } catch (e) {
    ok('llmTest 浏览器直连成功', false, e.message);
  }

  const plot = '雨夜的屋顶上，他缓缓拔出刀；敌人从背后偷袭，他反手一刀斩断对方的刀锋。';
  let decide = null;
  try {
    decide = await sapi.aiDecide({ plot, culture: 'all', ratio: 'auto', candidates: 8, pageWidth: 1600, llm: state.llm });
    ok('aiDecide 返回 ok', decide.ok === true, decide.error || '');
    ok('选中模板是合法 id', !decide.decision?.quality?.corrected, decide.decision?.pick || '');
    ok('生成的计划格数 > 0', (decide.plan?.panels?.length || 0) > 0, `${decide.plan?.panels?.length || 0} 格`);
    ok('每格都有画面内容', (decide.plan?.panels || []).every((p) => p.content), '');
  } catch (e) {
    ok('aiDecide 返回 ok', false, e.message);
  }

  if (decide?.ok) {
    try {
      const p = await sapi.prompts({ plot, templateId: decide.decision.pick, pageWidth: 1600, llm: state.llm });
      ok('prompts 返回 ok', p.ok === true, p.error || '');
      ok('优化生效的格数 > 0', (p.applied || 0) > 0, `${p.applied}/${p.total}`);
      const first = p.plan?.panels?.[0];
      ok('提示词已被替换为 AI 版', first?.aiOptimized === true, (first?.promptEn || '').slice(0, 46));
    } catch (e) {
      ok('prompts 返回 ok', false, e.message);
    }
  }

  localStorage.removeItem(KEYS.llm);
  const noKey = await sapi.aiDecide({ plot, llm: { apiKey: '' } });
  ok('无 Key 时给出友好提示', noKey.ok === false && (noKey.code === 'NO_LLM_KEY' || !!noKey.hint), noKey.code || '');
}
