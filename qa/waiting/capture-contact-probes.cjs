async page => {
  const records=[];
  await page.routeWebSocket('**/*',()=>{});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:5173/?angle=3');await page.bringToFront();
  await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&document.body.dataset.loadState==='ready');
  for(const time of [.7,1.42,2.17,7.25]) {
    const state=await page.evaluate(async time=>{
      const scene=__WHYME__.getScene();scene.setPresentationPaused(false);
      for(let i=0;i<1800;i++){
        await new Promise(requestAnimationFrame);const state=scene.getState();
        if(state.animation.time>=time){scene.setPresentationPaused(true);return scene.getState();}
      }
      throw Error('Contact capture timeout');
    },time);
    const file=`output/playwright/waiting/contact-${time}.png`;
    await page.screenshot({path:file,scale:'css'});records.push({requestedTime:time,sampledTime:state.animation.time,file});
  }
  const pending=page.waitForEvent('download');await page.evaluate(records=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({records},null,2)],{type:'application/json'}));a.download='contact-samples.json';a.click();},records);
  await(await pending).saveAs('qa/waiting/contact-samples.json');await page.goto('about:blank');
}
