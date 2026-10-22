async(page)=>{
 const checks=[],errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 await page.addInitScript(()=>{const original=window.requestAnimationFrame;window.requestAnimationFrame=callback=>original(()=>setTimeout(()=>callback(performance.now()),60));});
 const began=Date.now();await page.goto('http://127.0.0.1:4173/');let switched=false;try{await page.waitForFunction(()=>document.body.classList.contains('static-mode'),null,{timeout:15000});switched=true;}catch{}
 const elapsedMs=Date.now()-began;checks.push({name:'持续低帧率15秒内自动降级静帧',pass:switched&&elapsedMs<15000,elapsedMs});
 if(switched)await page.waitForFunction(()=>{const img=document.querySelector('.poster.is-current');return img?.complete&&img.naturalWidth>0;},null,{timeout:5000});
 checks.push({name:'低帧率降级后的静帧图片加载',pass:await page.locator('.poster.is-current').evaluate(img=>img.complete&&img.naturalWidth>0)});checks.push({name:'低帧率降级提示可见',pass:await page.locator('.fallback-status').isVisible()});checks.push({name:'低帧率模拟无页面错误或失败资源',pass:errors.length===0&&failed.length===0});
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='production-performance.json';a.click();},{checks,errors,failed});await(await pending).saveAs('output/playwright/tripo/production-performance.json');
}
