async (page) => {
  const base='http://127.0.0.1:5173',out='output/playwright/original-loading';
  const checks=[],errors=[],requests=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  await page.routeWebSocket('**/*',()=>{});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  const state=()=>page.evaluate(()=>({
    phase:document.body.dataset.loadState,
    appOpacity:getComputedStyle(document.querySelector('#app')).opacity,
    inert:document.querySelector('#app').inert,
    busy:document.querySelector('#app').getAttribute('aria-busy'),
    label:document.querySelector('#page-loader').textContent,
    loaderHidden:document.querySelector('#page-loader').hidden,
    loaderBackground:getComputedStyle(document.querySelector('#page-loader')).backgroundColor,
    scene:window.__WHYME__?.getScene()?.getState(),
    staticMode:window.__WHYME__?.getLayout().staticMode,
    image:[...document.querySelectorAll('.poster')].find(image=>image.classList.contains('is-current'))?.naturalWidth,
  }));
  const white=s=>s.appOpacity==='0'&&s.inert&&s.busy==='true'&&!s.loaderHidden&&s.loaderBackground==='rgb(255, 255, 255)'&&s.label==='正在加载王匡义的形象…';
  let releaseModel;
  const gate=new Promise(resolve=>releaseModel=resolve);
  await page.route('**/models/*.glb*',async route=>{await gate;await route.abort();});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);
  const stalled=await state();check('模型下载停住2秒时仅显示白底加载文字',white(stalled),stalled);
  check('普通3D启动没有请求任何人物PNG',!requests.some(url=>/images-(intro|tripo|v2)\/.+\.png/.test(url)),requests.filter(url=>url.includes('images-')));
  await page.screenshot({path:`${out}/desktop-loading.png`,fullPage:true});
  await page.keyboard.press('3');check('加载期间键盘不能切换站点',await page.evaluate(()=>window.__WHYME__.getActive()===0));
  releaseModel();await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  const fallback=await state();check('模型失败后静帧解码完成再显示页面',fallback.image>0&&fallback.loaderHidden&&!fallback.inert&&fallback.busy==='false'&&fallback.staticMode,fallback);
  check('失败后出现可操作的重试入口',await page.locator('#retry-3d').isVisible());
  await page.screenshot({path:`${out}/desktop-model-fallback.png`,fullPage:true});
  await page.unroute('**/models/*.glb*');

  let releaseRetry;const retryGate=new Promise(resolve=>releaseRetry=resolve);
  await page.route('**/models/*.glb*',async route=>{await retryGate;await route.abort();});
  await page.locator('#retry-3d').click();await page.waitForTimeout(200);
  check('重试重新回到完整白色加载页',white(await state()));
  releaseRetry();await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  await page.unroute('**/models/*.glb*');

  let releaseImage;const imageGate=new Promise(resolve=>releaseImage=resolve);
  await page.route('**/images-tripo/*.png*',async route=>{await imageGate;await route.continue();});
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/?static=1&angle=2`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(300);
  check('主动静帧模式等待当前图片解码',white(await state()));
  await page.screenshot({path:`${out}/mobile-loading.png`,fullPage:true});
  // Resize while the requested image is still pending. The newly selected
  // desktop/mobile resource must win, rather than an older decode completion.
  await page.setViewportSize({width:1440,height:900});releaseImage();
  await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  check('静帧加载期间改变尺寸后使用正确版本',await page.evaluate(()=>{const image=document.querySelector('.poster.is-current');return image.src.includes('/angle-02.png')&&image.naturalWidth>0;}));
  await page.unroute('**/images-tripo/*.png*');

  await page.route('**/models/*.glb*',route=>route.abort());
  await page.route('**/images-tripo/*.png*',route=>route.abort());
  await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  check('模型及静帧均失败时仍显示正文和重试按钮',await page.evaluate(()=>document.querySelector('#page-loader').hidden&&!document.querySelector('#app').inert&&document.querySelector('.fallback-status').textContent.includes('可以先阅读文字介绍')));
  await page.unroute('**/models/*.glb*');await page.unroute('**/images-tripo/*.png*');

  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/?static=1&angle=3`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  check('减少动态模式不使用加载淡出',await page.evaluate(()=>getComputedStyle(document.querySelector('#app')).transitionDuration==='0s'));
  check('手机页面显示后正文立即可见',await page.evaluate(()=>Number(getComputedStyle(document.querySelector('.strengths')).opacity)===1));
  await page.screenshot({path:`${out}/mobile-static-ready.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  check('没有浏览器未处理异常',errors.length===0,errors);
  const report={checks,errors,stalled,fallback};
  const download=page.waitForEvent('download');
  await page.evaluate(report=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='loading-ui.json';a.click();},report);
  await(await download).saveAs(`${out}/loading-ui.json`);
  if(checks.some(result=>!result.pass))throw new Error(checks.filter(result=>!result.pass).map(result=>result.name).join('; '));
}
