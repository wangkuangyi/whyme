async (page) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__WHYME__?.getScene()?.getState().ready);
  await page.waitForTimeout(1500);
  const summary=[];
  for(let i=1;i<=4;i++){
    await page.keyboard.press(String(i));
    await page.waitForTimeout(1600);
    await page.screenshot({path:`qa/desktop-0${i}.png`});
    summary.push(await page.evaluate(()=>({angle:document.body.dataset.angle,mode:document.body.className,state:window.__WHYME__.getScene()?.getState(),readout:document.querySelector('#readout').textContent})));
  }
  await page.setViewportSize({width:390,height:844});
  for(let i=1;i<=4;i++){
    await page.keyboard.press(String(i));
    await page.waitForTimeout(1500);
    await page.screenshot({path:`qa/mobile-0${i}.png`});
  }
  console.log(JSON.stringify(summary));
}
