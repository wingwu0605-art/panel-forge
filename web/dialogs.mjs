/**
 * 弹窗：统一用原生 <dialog>。
 *
 * 以前有 8 种手写弹层（Key 管理 / 面板管理 / 快捷键 / 危险确认 / 错误详情 / 角色确认 /
 * 分享目标 / 大图预览），各自一套遮罩、z-index、关闭逻辑和进出场动画；Esc、焦点、
 * 背景滚动都靠各自补丁。<dialog>.showModal() 把这些都交给浏览器：
 *   · 顶层渲染（不用排 z-index）· Esc 关闭（cancel 事件）· 打开时焦点进入、关闭后还原
 *   · 背后的页面自动 inert（键盘和读屏都不会跑到后面去）
 * 进出场动画在 CSS：@starting-style + transition-behavior: allow-discrete（不支持的浏览器就是直接出现）。
 */
import { escapeHtml } from './util.mjs';

/** 打开一个页面里写好的 <dialog>（index.html 里的静态弹窗） */
export function openModal(dlg) {
  if (!dlg || dlg.open) return;
  bindOnce(dlg);
  dlg.showModal();
}

export function closeModal(dlg, value = '') {
  if (dlg?.open) dlg.close(value);
}

/** 点遮罩关闭 + [data-close] 按钮关闭，每个 dialog 只绑一次 */
function bindOnce(dlg) {
  if (dlg.dataset.bound) return;
  dlg.dataset.bound = '1';
  dlg.addEventListener('click', (ev) => {
    // 点到的是 dialog 本身（而不是里面的面板）= 点了遮罩
    if (ev.target === dlg) { dlg.close('dismiss'); return; }
    const btn = ev.target.closest('[data-close]');
    if (btn && dlg.contains(btn)) dlg.close(btn.dataset.close || 'cancel');
  });
}

/**
 * 临时弹窗：建一个 <dialog>，关掉后自己移除。
 * @param {{id:string, title:string, sub?:string, body?:string|Node, width?:number, className?:string,
 *          closeLabel?:string}} o
 * @returns {{el:HTMLDialogElement, body:HTMLElement, close:(v?:string)=>void, closed:Promise<string>}}
 */
export function sheet({ id, title, sub = '', body = '', width = 560, className = '', closeLabel = '关闭' }) {
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = ('sheet ' + className).trim();
  dlg.innerHTML = `
    <div class="sheet-panel" style="--sheet-w:${Number(width) || 560}px">
      <header class="sheet-head">
        <b class="sheet-title">${escapeHtml(title)}</b>
        ${sub ? `<span class="sheet-sub">${escapeHtml(sub)}</span>` : ''}
        <button type="button" class="btn tiny" data-close>${escapeHtml(closeLabel)}</button>
      </header>
      <div class="sheet-body"></div>
    </div>`;
  const bodyEl = dlg.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  document.body.append(dlg);

  const closed = new Promise((res) => {
    dlg.addEventListener('close', () => {
      res(dlg.returnValue || '');
      // 立刻摘掉 id（调用方和测试用 #id 判断「已关闭」），节点等退场动画放完再移除
      dlg.removeAttribute('id');
      requestAnimationFrame(() => {
        const anims = dlg.getAnimations?.({ subtree: true }) || [];
        Promise.allSettled(anims.map((a) => a.finished)).then(() => dlg.remove());
      });
    }, { once: true });
  });
  openModal(dlg);
  return { el: dlg, body: bodyEl, close: (v = '') => closeModal(dlg, v), closed };
}
