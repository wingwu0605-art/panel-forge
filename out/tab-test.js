(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tab = [...document.querySelectorAll('#tabs button')].find((b) => b.dataset.tab === 'script');
  tab?.click();
  await wait(600);
  const btn = document.querySelector('#btnAiSplit');
  return {
    tab存在: !!tab,
    tab文字: tab?.textContent.trim(),
    分镜表可见: !document.querySelector('#tabScript')?.classList.contains('hidden'),
    切原文按钮可见: !!btn?.offsetParent,
    按钮文字: btn?.textContent.trim(),
    也看到优化按钮: !!document.querySelector('#btnAiPrompts')?.offsetParent,
  };
})()
