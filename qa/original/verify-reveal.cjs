async (page) => {
  const base='http://127.0.0.1:5173',out='output/playwright/original-loading';
  const checks=[],traces={},errors=[],requests=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  await page.routeWebSocket('**/*',()=>{});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.addInitScript(()=>{
    window.__revealTrace=[];
    const sample=()=>{
      const app=document.querySelector('#app'),scene=window.__WHYME__?.getScene()?.getState();
      if(app)window.__revealTrace.push({t:performance.now(),phase:document.body.dataset.loadState,appOpacity:getComputedStyle(app).opacity,inert:app.inert,busy:app.getAttribute('aria-busy'),fontStatus:document.fonts.status,loaderHidden:document.querySelector('#page-loader')?.hidden,
        sceneReady:scene?.ready,paused:scene?.presentationPaused,action:scene?.animation.action,animationTime:scene?.animation.time,end:scene?.animation.end,
        cardOpen:document.body.classList.contains('card-open'),cardOpacity:document.querySelector('.strengths')?getComputedStyle(document.querySelector('.strengths')).opacity:null});
    };
    const tick=()=>{sample();requestAnimationFrame(tick);};requestAnimationFrame(tick);
    new MutationObserver(sample).observe(document,{subtree:true,attributes:true,attributeFilter:['data-load-state']});
  });
  for(const [label,width,height] of [['desktop',1440,900],['mobile',390,844]]){
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/models/*.glb*',async route=>{await gate;await route.continue().catch(()=>{});});
    await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(250);release();
    await page.waitForFunction(()=>document.body.dataset.loadState==='ready',null,{timeout:30000});
    await page.waitForTimeout(350);
    traces[label]=await page.evaluate(()=>window.__revealTrace);
    const fade=traces[label].filter(frame=>frame.phase==='revealing'),ready=traces[label].find(frame=>frame.phase==='ready');
    check(`${label}: 淡入之前人物完整就绪`,fade.length>0&&fade.every(frame=>frame.sceneReady),fade.length);
    check(`${label}: 淡入全程人物动作暂停`,fade.length>0&&fade.every(frame=>frame.paused&&frame.animationTime===0),fade.map(frame=>({time:frame.animationTime,paused:frame.paused})));
    check(`${label}: 淡入全程禁止操作`,fade.length>0&&fade.every(frame=>frame.inert&&frame.busy==='true'));
    check(`${label}: 揭幕后才从开头播放走路`,ready&&!ready.paused&&ready.animationTime<.15&&!ready.end,ready);
    check(`${label}: 动作解冻前页面已完全显现`,ready&&Number(ready.appOpacity)>.99,ready);
    check(`${label}: 正文在走路开始时显示`,ready&&ready.cardOpen&&Number(ready.cardOpacity)>.99,ready);
    check(`${label}: 字体已就绪才开始正常揭幕`,fade.every(frame=>frame.fontStatus==='loaded'));
    await page.screenshot({path:`${out}/${label}-3d-revealed.png`,fullPage:true});
    await page.unroute('**/models/*.glb*');
  }
  check('两次正常3D加载未请求旧PNG首屏',!requests.some(url=>/images-(intro|tripo|v2)\/.+\.png/.test(url)),requests.filter(url=>url.includes('images-')));

  let releaseFonts;const fontGate=new Promise(resolve=>releaseFonts=resolve);
  await page.route('**/*.woff2*',async route=>{await fontGate;await route.continue().catch(()=>{});});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.loadState==='ready',null,{timeout:30000});
  traces.fontStall=await page.evaluate(()=>window.__revealTrace);
  const loaded=traces.fontStall.find(frame=>frame.sceneReady),fade=traces.fontStall.find(frame=>frame.phase==='revealing');
  check('字体一直不返回时使用后备字体继续展示',loaded&&fade&&fade.t-loaded.t<2600,loaded&&fade?{wait:fade.t-loaded.t,fontStatus:fade.fontStatus}:null);
  check('等待字体时没有提前消费动作',traces.fontStall.filter(frame=>frame.sceneReady&&frame.phase==='loading').every(frame=>frame.paused&&frame.animationTime===0));
  releaseFonts();await page.waitForTimeout(350);await page.unroute('**/*.woff2*');

  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`${base}/?angle=2`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.loadState==='ready',null,{timeout:30000});
  check('减少动态3D保持原静姿并立即揭幕',await page.evaluate(()=>window.__WHYME__.getScene().getState().animation.reducedMotion&&getComputedStyle(document.querySelector('#app')).transitionDuration==='0s'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  check('无浏览器未处理异常',errors.length===0,errors);
  const report={checks,traces,errors};
  const download=page.waitForEvent('download');
  await page.evaluate(report=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='reveal-ui.json';a.click();},report);
  await(await download).saveAs(`${out}/reveal-ui.json`);
  if(checks.some(result=>!result.pass))throw new Error(checks.filter(result=>!result.pass).map(result=>result.name).join('; '));
}
