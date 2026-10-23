async page => {
  const records=[];
  await page.routeWebSocket('**/*',()=>{});
  for(const [variant,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:5173/?angle=3'); await page.bringToFront();
    await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&document.body.dataset.loadState==='ready');
    for(const portion of [.05,.12,.25,.4,.55,.7,.85,.92,.97,1.1]) {
      const s=await page.evaluate(async portion=>{
        const scene=__WHYME__.getScene();scene.setPresentationPaused(false);
        for(let i=0;i<2400;i++){
          await new Promise(requestAnimationFrame);const s=scene.getState(),a=s.animation;
          if(portion>1 ? a.end&&!a.transition : !a.end&&a.time>=portion*a.duration){scene.setPresentationPaused(true);return scene.getState();}
        }
        throw Error('Sequence timeout');
      },portion);
      const file=`output/playwright/wide-shots/${variant}-wait-${Math.round(portion*100)}.png`;
      await page.screenshot({path:file,scale:'css'});records.push({variant,portion,file,state:s});
    }
  }
  const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='sequence.json';a.click();},{records});await(await pending).saveAs('qa/wide-shots/sequences.json');await page.goto('about:blank');
}
