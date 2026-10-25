(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).getPropertyValue(prop).trim() : null; };
  const out = { 版本: window.__pfVersion?.(), 页面版本文本: document.querySelector('#appVersion')?.textContent };
  out.经典 = { 皮肤: window.__pfSkin?.(), 底: css('body', 'background-color'), 圆角: css('.card', 'border-radius'), 主色: getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() };
  document.querySelector('#skinSeg [data-skin="cute"]').click();
  await wait(700);
  out.灵动可爱 = { 皮肤: window.__pfSkin?.(), 底: css('body', 'background-color'), 圆角: css('.card', 'border-radius'), 按钮圆角: css('.btn', 'border-radius'), 主色: getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() };
  document.querySelector('#skinSeg [data-skin="minimal"]').click();
  await wait(700);
  out.高级简约 = { 皮肤: window.__pfSkin?.(), 底: css('body', 'background-color'), 圆角: css('.card', 'border-radius'), 主色: getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() };
  out.记住的皮肤 = localStorage.getItem('pf.skin');
  return out;
})()
