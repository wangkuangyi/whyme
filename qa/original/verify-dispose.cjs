async (page) => {
  const errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',()=>{});
  await page.addInitScript(()=>{window.__closedBitmaps=0;const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){window.__closedBitmaps++;return close.call(this);};});
  for(const phase of ['glb','mask']){
    await page.emulateMedia({reducedMotion:'no-preference'});
    let release,seen,count=0;const gate=new Promise(r=>release=r),requested=new Promise(r=>seen=r);
    const pattern=phase==='glb'?'**/models/person-original-animated.glb*':'**/models/hoodie-mask.png*';
    await page.route(pattern,async route=>{if(count++===0){seen();await gate;}await route.continue().catch(()=>{});});
    await page.goto('http://127.0.0.1:5173/?angle=2');await requested;
    await page.emulateMedia({reducedMotion:'reduce'});release();
    await page.waitForFunction(()=>document.body.dataset.loadState==='ready'&&__WHYME__.getScene()?.getState().animation.reducedMotion);
    await page.waitForFunction(()=>window.__closedBitmaps>0);
    const state=await page.evaluate(()=>({closed:__closedBitmaps,generation:__WHYME__.getLoading().generation,ready:__WHYME__.getScene().getState().ready}));
    checks.push({name:`cancel during ${phase}: release source bitmap and keep replacement ready`,pass:state.closed>0&&state.ready&&state.generation>1,state});
    await page.unroute(pattern);
  }
  checks.push({name:'no unhandled browser errors',pass:errors.length===0,errors});
  const download=page.waitForEvent('download');await page.evaluate(report=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='dispose-results.json';a.click();},{checks});
  await(await download).saveAs('qa/original/dispose-results.json');
  if(checks.some(c=>!c.pass))throw Error('Resource cancellation regression');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('about:blank');
}
