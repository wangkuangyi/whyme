async (page) => {
  // Run with playwright-cli run-code --filename. Output is evidence, not a
  // substitute for visually reviewing the saved handoff and mobile screenshots.
  const base='http://127.0.0.1:5173',out='output/playwright/v24-ui';
  const checks=[],traces={},screenshots=[],errors=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  await page.routeWebSocket('**/*',()=>{});
  const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`,fullPage:true});screenshots.push(`${out}/${name}.png`);};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const alpha=el=>{
      if(!el)return 0;let opacity=1;
      for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return 0;opacity*=Number(s.opacity);}
      const r=el.getBoundingClientRect();return r.width&&r.height?opacity:0;
    };
    window.__v24Trace=[];
    window.__v24Clear=()=>{window.__v24Trace=[];};
    const tick=()=>{
      const stage=document.querySelector('.stage');
      if(stage){
        const images=[...stage.querySelectorAll('img')].map(el=>({src:(el.currentSrc||el.src).startsWith('data:')?'captured-canvas-frame':el.currentSrc||el.src,loaded:el.complete&&el.naturalWidth>0,opacity:alpha(el),current:el.classList.contains('is-current')}));
        window.__v24Trace.push({t:performance.now(),angle:document.body.dataset.angle,classes:document.body.className,images,canvas:alpha(stage.querySelector('canvas')),hint:alpha(document.querySelector('.interaction-hint')),directory:alpha(document.querySelector('.directory'))});
        if(window.__v24Trace.length>2400)window.__v24Trace.shift();
      }
      requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  });
  const trace=async name=>traces[name]=await page.evaluate(()=>window.__v24Trace);
  const clear=()=>page.evaluate(()=>window.__v24Clear());
  const currentLoaded=()=>page.waitForFunction(()=>[...document.querySelectorAll('.stage img')].some(el=>el.complete&&el.naturalWidth>0));
  const sceneReady=()=>page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready,{},{timeout:25000});
  const sceneState=()=>page.evaluate(()=>window.__WHYME__?.getScene()?.getState());
  const waitCurrent=()=>page.waitForFunction(()=>{const el=document.querySelector('.poster.is-current');return el?.complete&&el.naturalWidth>0;});
  const cardVisible=()=>page.waitForFunction(()=>{const el=document.querySelector('.strength.is-active .card-actions');return document.body.classList.contains('card-open')&&el&&Number(getComputedStyle(el).opacity)>.99;});
  const noDoubleImage=series=>series.every(frame=>frame.images.filter(image=>image.loaded&&image.opacity>.02).length<=1);

  // Slow model download: the first useful character image must stay opaque.
  let releaseModel;const modelGate=new Promise(resolve=>releaseModel=resolve);
  await page.route('**/models/*.glb',async route=>{await modelGate;await route.continue();});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
  await currentLoaded();await page.waitForTimeout(150);await shot('intro-model-pending');
  await page.waitForTimeout(1100);
  const pending=await trace('introPending');
  const firstVisible=pending.findIndex(frame=>frame.images.some(image=>image.loaded&&image.opacity>.99));
  check('模型延迟下载时已有完整静图',firstVisible>=0&&pending.at(-1)?.images.some(image=>image.loaded&&image.opacity>.99));
  check('模型尚未下载时没有播放走路',!(await sceneState())?.ready);
  releaseModel();await sceneReady();await shot('intro-handoff-start');
  await page.waitForTimeout(150);await shot('intro-handoff-middle');
  await page.waitForTimeout(350);await shot('intro-handoff-complete');
  await page.unroute('**/models/*.glb');
  const intro=await trace('introComplete');
  const usefulStart=intro.findIndex(frame=>frame.images.some(image=>image.loaded&&image.opacity>.99)||frame.canvas>.99);
  check('首个完整人物出现后没有把所有人物层一起降为半透明',usefulStart>=0&&intro.slice(usefulStart).every(frame=>Math.max(frame.canvas,...frame.images.filter(image=>image.loaded).map(image=>image.opacity))>.98));
  check('接管后3D已完全显示',intro.at(-1)?.canvas>.99);

  // No interaction: exercise the automatic hint retirement path as well.
  await page.waitForTimeout(6700);
  const auto=await trace('hintAutomatic');
  check('提示与目录自动交接没有同帧叠字',auto.every(frame=>!(frame.hint>.02&&frame.directory>.02)));
  check('目录最终出现',auto.at(-1)?.directory>.99);

  // The portrait aspect ratio also needs an actual poster-to-canvas review.
  let releasePhone;const phoneGate=new Promise(resolve=>releasePhone=resolve);
  await page.route('**/models/*.glb',async route=>{await phoneGate;await route.continue();});
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/?angle=1`,{waitUntil:'domcontentloaded'});
  await currentLoaded();await page.waitForTimeout(250);await shot('mobile-intro-model-pending');
  releasePhone();await sceneReady();await shot('mobile-intro-handoff-start');
  await page.waitForTimeout(150);await shot('mobile-intro-handoff-middle');
  await page.waitForTimeout(350);await shot('mobile-intro-handoff-complete');
  await page.unroute('**/models/*.glb');await trace('mobileIntro');
  await page.setViewportSize({width:1440,height:900});

  // Actual user navigation in static mode, including interruption before fade-out ends.
  await page.goto(`${base}/?static=1&angle=1`,{waitUntil:'domcontentloaded'});
  await waitCurrent();await page.waitForTimeout(450);await clear();
  await page.keyboard.press('2');await page.waitForTimeout(55);
  await page.keyboard.press('4');await page.waitForTimeout(70);
  await page.keyboard.press('3');await page.waitForTimeout(650);
  const rapid=await trace('staticRapid');await shot('static-rapid-final');
  check('静帧连续切换没有两张人物同时可见',noDoubleImage(rapid));
  check('手动操作触发提示与目录交接不叠字',rapid.every(frame=>!(frame.hint>.02&&frame.directory>.02)));
  check('快速切换最终URL、卡片与图一致',await page.evaluate(()=>{const image=document.querySelector('.poster.is-current');return new URL(location.href).searchParams.get('angle')==='3'&&document.querySelector('.strength.is-active')?.dataset.strength==='2'&&image?.src.includes('03.')&&image.complete&&image.naturalWidth>0;}));
  await clear();await page.keyboard.press('4');await page.waitForTimeout(480);
  const single=await trace('staticSingle');
  check('静帧先淡到空白再显示下一张',noDoubleImage(single)&&single.some(frame=>frame.images.every(image=>image.opacity<.03)));

  // Content-driven layout: measure the actual article and its final actions,
  // including expanded evidence, instead of asserting a prescribed height.
  const measurements=[];
  for(const viewport of [{width:390,height:844},{width:320,height:640}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(300);
    for(let angle=1;angle<=4;angle++){
      await page.locator('.mobile-tab').nth(angle-1).click();await cardVisible();
      const measure=()=>page.evaluate(()=>{
        const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,left:r.left,right:r.right};};
        const body=document.querySelector('.card-body'),article=document.querySelector('.strength.is-active'),strengths=document.querySelector('.strengths'),stage=document.querySelector('.stage'),actions=article.querySelector('.card-actions');
        return {stage:box(stage),strengths:box(strengths),body:box(body),article:box(article),actions:box(actions),paddingBottom:parseFloat(getComputedStyle(body).paddingBottom),bodyScrollHeight:body.scrollHeight,bodyClientHeight:body.clientHeight,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,viewportHeight:innerHeight};
      });
      const collapsed=await measure();
      check(`${viewport.width}px第${angle}站内容下方无额外空白`,collapsed.body.bottom-collapsed.article.bottom-collapsed.paddingBottom<8,collapsed);
      check(`${viewport.width}px第${angle}站无横向溢出及内容内部滚动`,collapsed.documentWidth<=collapsed.viewportWidth+1&&collapsed.bodyScrollHeight<=collapsed.bodyClientHeight+2,collapsed);
      const expand=page.locator('.strength.is-active .expand-proof');
      if(await expand.count()){
        await expand.click();await page.waitForTimeout(250);const expanded=await measure();
        check(`${viewport.width}px第${angle}站展开后说明区随内容增长`,expanded.strengths.height>collapsed.strengths.height+8, {collapsed:collapsed.strengths.height,expanded:expanded.strengths.height});
        measurements.push({viewport,angle,collapsed,expanded});
        if(angle===3)await shot(`mobile-${viewport.width}-expanded`);
        await expand.click();await page.waitForTimeout(120);
      }else measurements.push({viewport,angle,collapsed});
      if(angle===1)await shot(`mobile-${viewport.width}-collapsed`);
    }
  }

  // Fail actual model loading, then retry from the visible recovery control.
  await page.setViewportSize({width:390,height:844});
  await page.route('**/models/*.glb',route=>route.abort('failed'));
  await page.goto(`${base}/?angle=3`,{waitUntil:'domcontentloaded'});
  await page.locator('.fallback-status').waitFor({state:'visible'});await cardVisible();
  await shot('mobile-fallback');
  const fallback=await page.evaluate(()=>{const a=document.querySelector('.fallback-status').getBoundingClientRect(),b=document.querySelector('.stage').getBoundingClientRect();return {top:a.top,bottom:a.bottom,stageTop:b.top,stageBottom:b.bottom};});
  check('手机降级提示位于舞台之外',fallback.top>=fallback.stageBottom-1||fallback.bottom<=fallback.stageTop+1,fallback);
  await page.keyboard.press('4');await page.waitForTimeout(400);
  await page.unroute('**/models/*.glb');
  await page.locator('#retry-3d').click();await page.keyboard.press('2');
  await sceneReady();await page.waitForTimeout(1500);
  check('降级后切站和重试期间切站保留最后选择',await page.evaluate(()=>window.__WHYME__.getActive()===1&&window.__WHYME__.getScene().getState().activeStation===1&&document.body.dataset.angle==='2'));
  check('重试成功后降级提示消失',!await page.locator('.fallback-status').isVisible());

  // Reduced motion is checked both on a fresh load and while on another station.
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().animation.reducedMotion);await page.waitForTimeout(450);
  check('运行时减少动态保留当前站',await page.evaluate(()=>window.__WHYME__.getActive()===1&&window.__WHYME__.getScene().getState().animation.reducedMotion));
  await page.goto(`${base}/?angle=4`,{waitUntil:'domcontentloaded'});await sceneReady();await page.waitForTimeout(450);
  await shot('mobile-reduced-motion');
  check('减少动态首次打开仍在指定站',await page.evaluate(()=>window.__WHYME__.getActive()===3&&window.__WHYME__.getScene().getState().activeStation===3&&window.__WHYME__.getScene().getState().animation.reducedMotion));
  await page.emulateMedia({reducedMotion:'no-preference'});
  check('浏览器没有未处理异常',errors.length===0,errors);

  const report={checks,traces,measurements,screenshots,errors,visualReviewRequired:['intro-model-pending','intro-handoff-start','intro-handoff-middle','intro-handoff-complete','mobile-intro-model-pending','mobile-intro-handoff-start','mobile-intro-handoff-middle','mobile-fallback','mobile-390-expanded','mobile-320-expanded']};
  const download=page.waitForEvent('download');
  await page.evaluate(report=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='v24-ui.json';a.click();},report);
  await(await download).saveAs(`${out}/results.json`);
  if(checks.some(result=>!result.pass))throw new Error(checks.filter(result=>!result.pass).map(result=>result.name).join('; '));
}
