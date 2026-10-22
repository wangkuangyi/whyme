async (page) => {
  const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  for (const [width,height] of [[1440,1000],[1280,800],[1024,768],[768,1024],[320,740]]) {
    await page.setViewportSize({width,height});
    for(let angle=1;angle<=4;angle++) {
      await page.goto(`http://127.0.0.1:5173/?motion=1&angle=${angle}`);
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
      const samples=await page.evaluate(async()=>{
        const values=[]; const begin=performance.now();
        while(performance.now()-begin<5700){
          const s=window.__WHYME__.getScene().getState(),c=document.querySelector('.strengths').getBoundingClientRect(),visible=document.body.classList.contains('card-open');
          const overlap=b=>b&&c.left<b.right+3&&c.right>b.left-3&&c.top<b.bottom+3&&c.bottom>b.top-3;
          values.push({time:s.animation.time,action:s.animation.action,face:s.protectedBounds.faceBounds,hands:s.protectedBounds.handBounds,card:c.toJSON(),overlap:visible&&innerWidth>=901&&[s.protectedBounds.faceBounds,...s.protectedBounds.handBounds].some(overlap),position:s.animation.position,camera:s.camera.anchor,fallback:s.quality.fallbackTriggered});
          await new Promise(r=>setTimeout(r,100));
        }
        return values;
      });
      results.push({width,height,angle,samples});
      await page.screenshot({path:`output/playwright/tripo/layout-${width}-${angle}.png`});
    }
  }
  const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='layout.json';a.click();},{results,errors});await(await pending).saveAs('output/playwright/tripo/layout.json');
}
