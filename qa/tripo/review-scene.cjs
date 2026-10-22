async (page) => {
  const errors=[],report=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:1000});
  for(let i=0;i<4;i++){
    await page.goto(`http://127.0.0.1:5173/?motion=1&angle=${i+1}`);
    await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
    const begun=Date.now();
    for(const t of [.3,.9,1.5,2.3,3.6,5.8]){
      await page.waitForTimeout(Math.max(0,t*1000-(Date.now()-begun)));
      report.push(await page.evaluate(()=>({state:window.__WHYME__.getScene()?.getState(),layout:window.__WHYME__.getLayout(),card:document.querySelector('.strengths').getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]})));
      await page.screenshot({path:`output/playwright/tripo/desktop-${i+1}-${String(t).replace('.','_')}.png`});
    }
  }
  await page.setViewportSize({width:390,height:844});
  for(let i=0;i<4;i++){
    await page.goto(`http://127.0.0.1:5173/?motion=1&angle=${i+1}`);
    await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
    await page.waitForTimeout(1400);
    report.push(await page.evaluate(()=>({state:window.__WHYME__.getScene()?.getState(),layout:window.__WHYME__.getLayout(),card:document.querySelector('.strengths').getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]})));
    await page.screenshot({path:`output/playwright/tripo/mobile-${i+1}.png`});
  }
  const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='scene-review.json';a.click();},{report,errors});await(await pending).saveAs('output/playwright/tripo/scene-review.json');
}
