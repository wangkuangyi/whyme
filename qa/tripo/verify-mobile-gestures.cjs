async(page)=>{
 const results=[];
 for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
   for(const angle of [1,2,4,1,3,4]){
     await page.keyboard.press(String(angle));
     await page.waitForFunction(()=>!window.__WHYME__.getScene().getState().moving);
     const samples=await page.evaluate(async()=>{
       const result=[],begin=performance.now();while(performance.now()-begin<3300){const s=window.__WHYME__.getScene().getState();result.push({time:s.animation.time,action:s.animation.action,width:s.width,height:s.height,hands:s.protectedBounds.handBounds,face:s.protectedBounds.faceBounds});await new Promise(r=>setTimeout(r,60));}return result;
     });
     results.push({width,angle,samples});
   }
 }
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='mobile-gestures.json';a.click();},results);await(await pending).saveAs('output/playwright/tripo/mobile-gestures.json');
}
