async(page)=>{
 // Archival selection probe: run against the full, uncut v2.3.3 LookAround.
 // The v2.4 runtime is intentionally shorter; use v24-motion-browser.cjs there.
 const samples=[];
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:5173/?angle=3');
 await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
 if(await page.evaluate(()=>window.__WHYME__.getScene().getState().animation.duration)!==15.625)throw new Error('Source selection probe requires the uncut v2.3.3 runtime.');
 for(const t of [1.3,2.5,3.5,5.0,6.8,7.2,8.5,10.0,11.8,12.5,15.0]){
  await page.waitForFunction(time=>{const a=window.__WHYME__.getScene().getState().animation;return a.action==='LookAround'&&a.time>=time;},t);
  samples.push(await page.evaluate(()=>{const scene=window.__WHYME__.getScene(),state=scene.getState();scene.setDragProgress(state.currentProgress);return state.animation;}));
  await page.screenshot({path:`output/playwright/v24-motion/source-${t}.png`});
  await page.evaluate(()=>window.__WHYME__.getScene().setStation(2,{immediate:true}));
 }
 console.log(samples.map(s=>({time:s.time,duration:s.duration})));
}
