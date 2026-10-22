async(page)=>{
 const captures=[],errors=[],failed=[],scripts=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});if(r.url().includes('/assets/scene-'))scripts.push(r.url());});
 const ready=()=>page.waitForFunction(()=>document.body.classList.contains('scene-ready')&&!document.body.classList.contains('static-mode'));
 async function capture(label,extra={}){const state=await page.evaluate(()=>({angle:document.body.dataset.angle,moving:document.body.classList.contains('is-moving'),static:document.body.classList.contains('static-mode'),viewport:[innerWidth,innerHeight],poster:document.querySelector('.poster.is-current')?.currentSrc,posterReady:document.querySelector('.poster.is-current')?.complete&&document.querySelector('.poster.is-current')?.naturalWidth>0}));captures.push({label,...extra,...state});await page.screenshot({path:`output/playwright/tripo/production-final-${label}.png`});}
 for(const w of [390,320]){
  await page.setViewportSize({width:w,height:w===390?844:740});await page.goto('http://127.0.0.1:4173/?angle=2');await ready();await page.waitForTimeout(1600);await page.keyboard.press('4');await page.waitForFunction(()=>!document.body.classList.contains('is-moving'));const ended=Date.now();
  for(const t of [.1,.3,.6,1.2]){await page.waitForTimeout(Math.max(0,t*1000-(Date.now()-ended)));await capture(`${w}-nod-wave-${String(t).replace('.','_')}`,{secondsAfterCamera:(Date.now()-ended)/1000});}
  await page.goto('http://127.0.0.1:4173/?angle=3');await ready();const start=Date.now();
  for(const t of [3.45,3.65,3.85,4.05,4.25,4.5]){await page.waitForTimeout(Math.max(0,t*1000-(Date.now()-start)));await capture(`${w}-walk-${String(t).replace('.','_')}`);}
  await page.goto('http://127.0.0.1:4173/?static=1&angle=1');await page.waitForFunction(()=>document.body.classList.contains('static-mode'));
  for(const key of ['1','2','3','4']){await page.keyboard.press(key);await page.waitForFunction(()=>{const p=document.querySelector('.poster.is-current');return p?.complete&&p.naturalWidth>0;});await page.waitForTimeout(450);await capture(`${w}-static-${key}`);}
 }
 const result={sceneBuild:[...new Set(scripts)],captures,errors,failed,visualReview:'pending-image-review'};
 const download=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='production-final-visual.json';a.click();},result);await(await download).saveAs('output/playwright/tripo/production-final-visual.json');
}
