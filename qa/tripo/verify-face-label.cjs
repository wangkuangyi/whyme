async(page)=>{
 const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390]){
   await page.setViewportSize({width,height:740});await page.goto('http://127.0.0.1:4173/?angle=3');
   await page.waitForFunction(()=>document.body.classList.contains('scene-ready')&&!document.body.classList.contains('static-mode'));
   await page.waitForTimeout(4500);
   results.push({width,inactiveNodeHidden:await page.locator('.node').nth(0).evaluate(e=>e.classList.contains('is-occluded')&&e.getAttribute('aria-hidden')==='true'),activeNodeVisible:await page.locator('.node').nth(2).evaluate(e=>!e.classList.contains('is-occluded'))});
   await page.screenshot({path:`output/playwright/tripo/production-face-clear-${width}.png`});
 }
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='face-label.json';a.click();},{results,errors});await(await pending).saveAs('output/playwright/tripo/face-label.json');
}
