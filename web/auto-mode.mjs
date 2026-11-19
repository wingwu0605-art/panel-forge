/**
 * 全自动模式
 *   off    关闭（原来的左栏：剧情 → 分镜）
 *   story  分镜全自动：粘贴全文 → 我们决定页数 / 切格 / 提示词
 *   full   真正全自动：再加上台词、气泡、以及批量出图
 *
 * 三条铁律（用户明确要求）：
 *   1. 花钱的动作必须先弹确认，勾选「我已知晓」才能继续；全部页还要二次确认
 *   2. 确认里必须写明「一旦开始就不会中途停」以及大概多少钱
 *   3. 全自动的所有动作都要在前台可见（每一步打进日志），且随时能停
 */
import { $, $$, escapeHtml } from './util.mjs';
import { state } from './state.mjs';
import { store, KEYS } from './storage.mjs';
import { toast } from './ui.mjs';
import { openModal, sheet } from './dialogs.mjs';
import { activeCharPayload } from './refs.mjs';
import { estimateLayout, splitTextIntoPages, buildAutoSteps, imageQueueForPage, imageQueueAll, estimateCostHint } from './lib/auto.mjs';
import { app } from './ctx.mjs';

const AUTO_KEY = KEYS.auto;

/** 危险确认：返回 Promise<boolean>，必须勾选「我已知晓」才能点「继续」 */
export function confirmDanger({ title, body, images = 0, llmCalls = 0 }) {
  const dlg = $('#dangerSheet');
  if (!dlg) return Promise.resolve(false);
  $('#dangerTitle').textContent = title;
  const bodyEl = $('#dangerBody');
  bodyEl.innerHTML = body;
  const tip = document.createElement('div');
  tip.className = 'callout warn danger-cost';
  tip.textContent = estimateCostHint({ images, llmCalls }).text;
  bodyEl.appendChild(tip);
  const ack = $('#dangerAck');
  const go = $('#dangerGo');
  ack.checked = false;
  go.disabled = true;
  return new Promise((res) => {
    const onAck = () => { go.disabled = !ack.checked; };
    const onGo = () => { if (ack.checked) dlg.close('go'); };
    ack.addEventListener('change', onAck);
    go.addEventListener('click', onGo);
    dlg.addEventListener('close', () => {
      ack.removeEventListener('change', onAck);
      go.removeEventListener('click', onGo);
      res(dlg.returnValue === 'go');
    }, { once: true });
    dlg.returnValue = '';
    openModal(dlg);
  });
}

/** 没启用角色参考图时，批量出图前要说一句（单格出图会单独问，批量只在这里问一次） */
const charsWarning = () => (activeCharPayload().block ? ''
  : '<li class="warn"><b>还没启用角色参考图</b>：每格的人可能长得不一样，建议先在左边「角色参考图」加一张</li>');

function autoLog(line, kind = '') {
  const box = $('#autoLog');
  if (!box) return;
  box.classList.remove('hidden');
  const row = document.createElement('div');
  row.className = 'al-row' + (kind ? ' al-' + kind : '');
  row.textContent = line;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function autoText() {
  return ($('#autoText')?.value || '').trim();
}

export function autoEstimate() {
  const text = autoText();
  if (!text) { toast('先把全文粘进来'); return null; }
  const est = estimateLayout(text);
  const st = $('#autoStat');
  if (st) {
    st.textContent = est.note;
    st.dataset.pages = String(est.pages);
    st.dataset.panels = String(est.panels);
  }
  return est;
}

/** 切换全自动模式：换左栏内容 + 显示悬浮按钮 */
export function setAutoMode(mode, opts = {}) {
  const m = ['off', 'story', 'full'].includes(mode) ? mode : 'off';
  state.autoMode = m;
  const root = document.documentElement;
  if (m === 'off') delete root.dataset.auto; else root.dataset.auto = m;
  const autoCard = $('#autoCard');
  const plotBox = $('#plot')?.closest('.card') || null;
  // 注意：两块是**并列的卡片**。曾经把全自动面板塞进剧情卡片里再隐藏卡片，面板跟着一起消失（bug）
  if (autoCard) autoCard.classList.toggle('hidden', m === 'off');
  if (plotBox) plotBox.classList.toggle('hidden', m !== 'off');
  $$('#autoSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.auto || 'off') === m));
  // 指示条要按模式变色：把当前模式写进 data-mode（纯 CSS 无法知道哪个按钮是激活态）
  const segEl = $('#autoSeg');
  if (segEl) segEl.dataset.mode = m;
  const name = $('#autoModeName');
  const title = $('#autoModeTitle');
  const desc = $('#autoModeDesc');
  if (name) name.textContent = m === 'full' ? '真正全自动' : '分镜自动';
  if (title) title.textContent = m === 'full' ? '真正全自动' : '分镜自动';
  if (desc) {
    desc.textContent = m === 'full'
      ? '从分镜、提示词、出图到台词与气泡全由 AI 完成，全程前台可见、随时可停'
      : '决定画几页、每页怎么切；你只改提示词和男女主形象';
  }
  const stack = $('#fabStack');
  if (stack) stack.classList.toggle('hidden', m === 'off');
  if (!opts.silent) store.set(AUTO_KEY, m === 'off' ? null : m);
}

/* ---------------- 批量出图（悬浮按钮） ---------------- */
async function currentPagePanels() {
  app.savePage();
  const page = app.pagePlan();
  return page?.panels || (state.tpl?.slots || []).map((sl) => ({ id: sl.id }));
}

/** 生成当前页所有还没有图的格子 */
async function genPageImages() {
  const panels = await currentPagePanels();
  const queue = imageQueueForPage(panels, state.images || {});
  if (!queue.length) { toast('这一页每格都有图了'); return 0; }
  const ok = await confirmDanger({
    title: '生成这一页的 ' + queue.length + ' 张图',
    body: '<ul class="danger-list">'
      + '<li><b>一键生成该页</b>：把这一页每个还没图的分镜依次生成</li>'
      + '<li>用的就是<b>每格现在的提示词</b> —— 你手改过的、规则生成的，都按原样发出去，'
      + '<b>不会</b>先做 AI 优化（要 AI 优化请用顶栏「全自动」）</li>'
      + '<li>点了就会一路做完，中途不会停（关掉页面会中断，但已发出的请求照样扣费）</li>'
      + '<li>每张图都会进候选，不满意的可以单独换</li>'
      + charsWarning()
      + '</ul>',
    images: queue.length,
  });
  if (!ok) return 0;
  return runImageQueue(queue.map((slotId) => ({ page: state.pageIdx, slotId })), '这一页');
}

/** 生成全部页所有还没有图的格子（二次确认） */
async function genAllImages() {
  app.savePage();
  const pagesOfPanels = [];
  for (let i = 0; i < state.pages.length; i++) {
    if (i === state.pageIdx) { pagesOfPanels.push(app.pagePlan()?.panels || []); continue; }
    const tpl = await app.fetchTemplate(state.pages[i].tplId);
    pagesOfPanels.push((tpl?.slots || []).map((sl) => ({ id: sl.id })));
  }
  const imagesByPage = state.pages.map((pg, i) => (i === state.pageIdx ? (state.images || {}) : (pg.images || {})));
  const queue = imageQueueAll(pagesOfPanels, imagesByPage);
  if (!queue.length) { toast('所有页面都有图了'); return 0; }
  const pagesTouched = new Set(queue.map((q) => q.page)).size;

  const first = await confirmDanger({
    title: '生成全部 ' + queue.length + ' 张图（跨 ' + pagesTouched + ' 页）',
    body: '<ul class="danger-list">'
      + '<li><b>一键生成全部分镜</b>：共 <b>' + state.pages.length + ' 页</b>，其中 <b>' + pagesTouched + ' 页</b>缺图，共 <b>' + queue.length + ' 张</b></li>'
      + '<li>用的是<b>每格现有提示词</b>（含你手改过的），<b>不会</b>先做 AI 优化</li>'
      + '<li><b>开始后不会停</b>，直到这 ' + queue.length + ' 张全部跑完</li>'
      + '<li>会花掉大量 token / 额度，这是本项目里最贵的一个按钮</li>'
      + charsWarning()
      + '</ul>',
    images: queue.length,
  });
  if (!first) return 0;

  const second = await confirmDanger({
    title: '你真的确定吗？',
    body: '<div class="danger-big">' + state.pages.length + ' 页 · ' + queue.length + ' 张图</div>'
      + '<ul class="danger-list">'
      + '<li>这是最终确认，点「继续」后立刻开始扣费</li>'
      + '<li>想反悔只有「停止」按钮（当前这张会跑完，后面的不再发）</li>'
      + '</ul>',
    images: queue.length,
  });
  if (!second) return 0;
  return runImageQueue(queue, '全部页');
}

/** 顺序跑队列：一次一张，失败重试 1 次，随时可停。失败原因写进日志（不再每张弹一个错误面板挡住流程） */
async function runImageQueue(queue, scopeLabel = '') {
  state.autoStop = false;
  const btnStop = $('#btnAutoStop');
  if (btnStop) btnStop.disabled = false;
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  const gen = async (slotId) => {
    try { await app.generateSlotImage(slotId, { askChars: false, quiet: true }); return ''; }
    catch (e) { return String(e?.message || e).slice(0, 80); }
  };
  autoLog('▶ 开始生成' + scopeLabel + '：' + queue.length + ' 张', 'start');
  for (const item of queue) {
    if (state.autoStop) { autoLog('■ 已停止（已发出的请求会跑完）', 'stop'); break; }
    if (item.page !== state.pageIdx) await app.switchPage(item.page);
    autoLog('· 第 ' + (item.page + 1) + ' 页 · ' + item.slotId + '：请求中…');
    let err = await gen(item.slotId);
    if (!err && state.images[item.slotId]) { done++; autoLog('✓ ' + item.slotId + ' 完成（' + done + '/' + queue.length + '）', 'ok'); continue; }
    autoLog('… ' + item.slotId + ' 失败（' + (err || '没有返回图') + '），重试 1 次');
    err = await gen(item.slotId);
    if (!err && state.images[item.slotId]) { done++; autoLog('✓ ' + item.slotId + ' 重试成功（' + done + '/' + queue.length + '）', 'ok'); }
    else { failed++; autoLog('✗ ' + item.slotId + ' 仍然失败：' + (err || '没有返回图'), 'bad'); }
  }
  if (btnStop) btnStop.disabled = true;
  const secs = Math.round((Date.now() - t0) / 1000);
  autoLog('完成：成功 ' + done + ' 张 · 失败 ' + failed + ' 张 · 用时 ' + secs + 's', done ? 'ok' : 'bad');
  toast('批量出图结束：成功 ' + done + (failed ? ' / 失败 ' + failed : ''));
  return done;
}

/* ---------------- 全自动工作流 ---------------- */
/** 全自动：把一份 plan 装进当前页（aiPlan 优先，其次 state.plan.pages[0]） */
function adoptAutoPlan(plan, segment) {
  if (!plan) return;
  if (state.aiPlan && state.aiPlan.template?.id === state.tpl?.id) state.aiPlan = plan;
  else {
    state.plan = {
      pages: [{ pageIndex: state.pageIdx + 1, segment: segment || '', analysis: null, templateScore: null, plan }],
    };
  }
  app.renderScript();
  app.renderSlotPanel();
}

/**
 * 角色确认（真正全自动专用）
 * 在花钱警示之后、开始生成之前，把「这一话会出现谁、设定是什么、有没有参考图」摊开确认。
 * 返回 Promise<boolean>：true = 角色没问题，可以开始。
 */
function confirmCharacters({ pages = 1, panels = 0 } = {}) {
  const chars = state.chars || [];
  const active = new Set(state.activeChars || []);
  const hero = ($('#autoHero')?.value || '').trim();
  const heroine = ($('#autoHeroine')?.value || '').trim();
  const brief = ($('#charSheet')?.value || '').trim()
    || [hero ? '男主：' + hero : '', heroine ? '女主：' + heroine : ''].filter(Boolean).join('；');
  const rows = chars.length
    ? chars.map((c) => {
      const on = active.has(c.id);
      const refs = (c.images || []).length;
      const warn = on && !refs;
      return `<div class="list-item cc-row${on ? ' on' : ''}${warn ? ' warn' : ''}">`
        + `<span class="cc-dot">${on ? '●' : '○'}</span><b>${escapeHtml(c.name || '未命名')}</b>`
        + (c.note ? `<span class="cc-note">${escapeHtml(c.note)}</span>` : '')
        + `<span class="cc-refs">${refs ? '参考图 ' + refs + ' 张' : '没有参考图'}</span>`
        + (on ? '' : '<span class="cc-off">未启用</span>')
        + (warn ? '<span class="cc-warn">⚠ 启用了但没有参考图，脸会飘</span>' : '')
        + '</div>';
    }).join('')
    : '<p class="muted small">还没有角色卡。这一话的人物形象只靠下面的文字设定 —— 建议至少给主角加一张参考图。</p>';
  const s = sheet({
    id: 'charConfirm',
    title: '先确认角色形象',
    sub: '这一步不花钱，但少了它后面几十张图的脸会不一致',
    body: `<div class="callout cc-sum">要做 ${pages} 页 · 约 ${panels} 个分镜、${panels} 张图</div>
      <div class="list">${rows}</div>
      <div class="callout cc-sheet">角色设定：${escapeHtml(brief || '（空）')}</div>
      <div class="row2">
        <button type="button" class="btn" id="ccGoFix">先去补角色</button>
        <button type="button" class="btn primary" id="ccGo">角色没问题，开始生成</button>
      </div>`,
  });
  s.body.addEventListener('click', (ev) => {
    if (ev.target.closest('#ccGo')) s.close('go');
    else if (ev.target.closest('#ccGoFix')) s.close('fix');
  });
  return s.closed.then((v) => {
    if (v === 'fix') {
      // 把角色卡滚进视野并聚焦到名字输入框，让用户直接开始补
      document.querySelector('.chars')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => document.querySelector('#charName')?.focus(), 400);
      toast('先去补角色：加参考图或改设定，再从「全自动」重新开始');
    }
    return v === 'go';
  });
}

async function autoRun() {
  const text = autoText();
  if (!text) { toast('先把全文粘进来'); return; }
  const mode = state.autoMode === 'full' ? 'full' : 'story';
  const est = autoEstimate();
  if (!est) return;

  const hero = ($('#autoHero')?.value || '').trim();
  const heroine = ($('#autoHeroine')?.value || '').trim();
  const sheet = [hero ? '男主：' + hero : '', heroine ? '女主：' + heroine : ''].filter(Boolean).join('；');
  if (sheet) {
    const el = $('#charSheet');
    if (el && !el.value.trim()) el.value = sheet;
    state.charSheet = (el?.value || sheet).trim();
  }

  const steps = buildAutoSteps({ mode, pages: est.pages, panelsPerPage: est.panelsPerPage });
  const imgCount = mode === 'full' ? est.panels : 0;
  const ok = await confirmDanger({
    title: mode === 'full' ? '真正全自动：全部交给 AI' : '分镜全自动：只做分镜与提示词',
    body: '<ul class="danger-list">'
      + '<li>分 <b>' + est.pages + ' 页</b>，约 <b>' + est.panels + ' 个分镜</b>'
      + (mode === 'full'
        ? '，约 <b>' + est.panels + ' 张图</b>、约 <b>' + est.panels + ' 句台词</b>（台词/旁白/内心由 AI 决定，气泡也由它布置）'
        : '；台词与出图不自动做（之后可用右下角悬浮按钮单独触发）')
      + '</li>'
      + '<li>共 ' + steps.length + ' 个步骤，每一步都打进下面的日志，你能看见内容是怎么一步步出来的</li>'
      + '<li><b>可以随时点「停止」</b>（已发出的请求会跑完，之后的不再发）</li>'
      + (mode === 'full' ? '<li>提示词用 AI 优化过的版本，不是规则模板</li>' : '')
      + '</ul>',
    images: imgCount,
    llmCalls: steps.filter((x) => x.cost === 'llm').length,
  });
  if (!ok) return;

  if (mode === 'full') {
    // 花钱警示之后、真正开始之前：再确认一次角色形象（用户要求）
    const charOk = await confirmCharacters({ pages: est.pages, panels: est.panels });
    if (!charOk) { autoLog('已取消：先确认角色形象'); return; }
  }

  state.autoStop = false;
  const btnStart = $('#btnAutoStart');
  const btnStop = $('#btnAutoStop');
  if (btnStart) btnStart.disabled = true;
  if (btnStop) btnStop.disabled = false;
  const t0 = Date.now();
  autoLog('▶ 全自动开始（' + (mode === 'full' ? '真正全自动' : '分镜自动') + '）：' + est.pages + ' 页', 'start');

  try {
    const pageTexts = splitTextIntoPages(text, est.pages);
    autoLog('① 全文 ' + est.chars + ' 字 → 切成 ' + est.pages + ' 页（每页约 ' + Math.round(est.chars / est.pages) + ' 字）');

    for (let i = 0; i < est.pages; i++) {
      if (state.autoStop) break;
      const pageText = pageTexts[i] || '';
      autoLog('② 第 ' + (i + 1) + ' 页：挑版式 + 切格…');
      let decided = false;
      if (i === 0) {
        try {
          const res = await app.api.match({
            plot: pageText,
            culture: $('#culture')?.value || 'all',
            genre: $('#genre')?.value || 'all',
            ratio: $('#ratio')?.value || 'auto',
            limit: 6,
          });
          const top = res?.results?.[0];
          if (top?.id) {
            await app.selectTemplate(top.id);
            autoLog('   · 选到「' + top.name + '」（' + top.panels + ' 格）', 'ok');
            decided = true;
          }
        } catch { /* ignore */ }
      } else {
        await app.addPage();
      }
      if (!decided && i === 0 && !state.tpl) throw new Error('还没有可用的版式');

      autoLog('③ 第 ' + (i + 1) + ' 页：把这一页的原文切成每格…');
      try {
        const cut = await app.api.aiSplit({
          plot: pageText || text,
          templateId: state.tpl.id,
          pageWidth: state.exportWidth,
          characterSheet: state.charSheet,
        });
        if (cut?.ok && cut.plan) { adoptAutoPlan(cut.plan, pageText); autoLog('   · AI 切分完成', 'ok'); }
        else throw new Error(cut?.error || '切分失败');
      } catch (e) {
        autoLog('   · AI 切分没成（' + String(e.message).slice(0, 40) + '），改用规则切分');
        try {
          const rp = await app.api.plan({ plot: pageText || text, templateId: state.tpl.id, pageWidth: state.exportWidth });
          if (rp?.plan) adoptAutoPlan(rp.plan, pageText);
        } catch { /* ignore */ }
      }

      autoLog('④ 第 ' + (i + 1) + ' 页：AI 优化逐格提示词…');
      try {
        await app.runAiPrompts({ silent: true });
        autoLog('   · 提示词已用 AI 优化过', 'ok');
      } catch (e) {
        autoLog('   · 提示词优化失败（保留规则版）：' + String(e.message).slice(0, 40), 'bad');
      }

      if (mode === 'full') {
        if (state.autoStop) break;
        autoLog('⑤ 第 ' + (i + 1) + ' 页：写台词/旁白并挂气泡…');
        try { await app.aiWriteLines('page', { silent: true }); autoLog('   · 台词与气泡布置完成', 'ok'); }
        catch (e) { autoLog('   · 台词失败：' + String(e.message).slice(0, 40), 'bad'); }
        if (state.autoStop) break;
        autoLog('⑥ 第 ' + (i + 1) + ' 页：逐格生成图片…');
        const panels = await currentPagePanels();
        const queue = imageQueueForPage(panels, state.images || {});
        await runImageQueue(queue.map((slotId) => ({ page: state.pageIdx, slotId })), '第 ' + (i + 1) + ' 页');
      }
      app.savePage();
      autoLog('— 第 ' + (i + 1) + ' 页完成 —', 'ok');
    }
  } catch (e) {
    autoLog('✗ 中断：' + e.message, 'bad');
    toast('全自动中断：' + e.message);
  } finally {
    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
    const secs = Math.round((Date.now() - t0) / 1000);
    autoLog(state.autoStop ? '■ 已停止 · 用时 ' + secs + 's' : '✓ 全自动结束 · 用时 ' + secs + 's', state.autoStop ? 'stop' : 'ok');
  }
}

/* ---------------- 绑定 ---------------- */
export function bindAutoUI() {
  setAutoMode(store.get(AUTO_KEY) || 'off', { silent: true });
  $$('#autoSeg button').forEach((b) => b.addEventListener('click', () => setAutoMode(b.dataset.auto || 'off')));
  $('#btnAutoEstimate')?.addEventListener('click', () => autoEstimate());
  $('#btnAutoFile')?.addEventListener('click', () => $('#autoFile').click());
  $('#autoFile')?.addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const t = await f.text();
      $('#autoText').value = t.slice(0, 200000);
      autoEstimate();
      toast('已读入：' + f.name);
    } catch { toast('文件读不出来（换 .txt 试试）'); }
    ev.target.value = '';
  });
  $('#btnAutoStart')?.addEventListener('click', () => autoRun());
  $('#btnAutoStop')?.addEventListener('click', () => {
    state.autoStop = true;
    autoLog('… 收到停止指令：当前请求会跑完，后面的不再发', 'stop');
  });
  $('#fabGenPage')?.addEventListener('click', () => genPageImages());
  $('#fabGenAll')?.addEventListener('click', () => genAllImages());
}

// 调试/自动化钩子
window.__pfAuto = () => ({
  mode: state.autoMode || 'off',
  running: !!(state.autoMode && state.autoStop === false && $('#btnAutoStart')?.disabled),
  log: [...document.querySelectorAll('#autoLog .al-row')].map((r) => r.className + '|' + r.textContent),
});

window.__pfAutoSet = (m) => setAutoMode(m);
