async(page)=>{
 const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
  await page.setViewportSize({width,height});
  for(const angle of [1,2,3,4]){
   await page.goto(`http://127.0.0.1:5173/?angle=${angle}`);await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
   const data=await page.evaluate(async()=>{
    const values=[],start=performance.now();while(performance.now()-start<2800){const s=window.__WHYME__.getScene().getState();values.push({time:s.animation.time,action:s.animation.action,position:s.animation.position,clips:s.animation.clips,camera:s.camera,face:s.protectedBounds.faceBounds,hands:s.protectedBounds.handBounds});await new Promise(r=>setTimeout(r,80));}return values;
   });
   results.push({width,height,angle,samples:data});
   await page.screenshot({path:`output/playwright/refine-actions/${width}-angle-${angle}.png`});
   if(angle===1){await page.waitForTimeout(2400);results.push({width,height,angle,finished:await page.evaluate(()=>window.__WHYME__.getScene().getState())});await page.screenshot({path:`output/playwright/refine-actions/${width}-walk-end.png`});}
  }
 }
 // Check the tighter portrait during the actual nod, after an incoming walk.
 for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});await page.goto('http://127.0.0.1:5173/?angle=1');await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);await page.waitForTimeout(900);await page.keyboard.press('2');await page.waitForTimeout(1250);await page.screenshot({path:`output/playwright/refine-actions/${width}-nod-early.png`});await page.waitForTimeout(1100);await page.screenshot({path:`output/playwright/refine-actions/${width}-nod-hand.png`});
 }
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='stations.json';a.click();},{results,errors});await(await pending).saveAs('output/playwright/refine-actions/stations.json');
}
