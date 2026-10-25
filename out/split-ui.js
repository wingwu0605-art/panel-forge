(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 打开分镜标签
  [...document.querySelectorAll('#tabs button')].find((b) => /分镜|Sheet/.test(b.textContent))?.click();
  await wait(500);
  const btn = document.querySelector('#btnAiSplit');
  const vis = !!btn?.offsetParent;
  // 没 Key 时点一下：应当给明确提示而不是崩
  document.querySelector('#plot').value = '雨夜屋顶，他拔刀，反手斩断刀锋。';
  btn?.click();
  await wait(4000);
  return {
    按钮在: vis,
    按钮文字: btn?.textContent.trim(),
    提示: (document.querySelector('#scriptHint')?.textContent || '').slice(0, 70),
    仍有画布: !!document.querySelector('#canvas svg'),
  };
})()
