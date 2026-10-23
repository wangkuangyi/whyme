async(page)=>{
 const checks=[],snapshots=[],errors=[],out='output/playwright/v24-intro-interruption';
 const check=(name,passed,detail)=>checks.push({name,passed:!!passed,detail});
 await page.routeWebSocket('**',()=>{});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__introBoundaryTrace=[];
  const tick=()=>{
   const scene=window.__WHYME__?.getScene(),s=scene?.getState(),overlay=document.querySelector('.poster-stack');
   if(s&&overlay){window.__introBoundaryTrace.push({t:performance.now(),active:window.__WHYME__.getActive(),station:s.activeStation,paused:s.presentationPaused,progress:s.currentProgress,dragging:s.dragging,action:s.animation.action,actionTime:s.animation.time,overlay:Number(getComputedStyle(overlay).opacity),static:document.body.classList.contains('static-mode')});if(window.__introBoundaryTrace.length>600)window.__introBoundaryTrace.shift();}
   requestAnimationFrame(tick);
  };requestAnimationFrame(tick);
 });
 const state=()=>page.evaluate(()=>({layout:window.__WHYME__.getLayout(),scene:window.__WHYME__.getScene()?.getState(),classes:document.body.className,posterTransition:[...document.querySelectorAll('.poster')].map(el=>({inline:el.style.transition,computed:getComputedStyle(el).transitionDuration,opacity:Number(getComputedStyle(el).opacity),current:el.classList.contains('is-current')}))}));
 const handoff=()=>page.waitForFunction(()=>{const s=window.__WHYME__?.getScene()?.getState();return s?.ready&&s.presentationPaused&&document.body.classList.contains('scene-ready');});
 const released=()=>page.waitForFunction(()=>{const s=window.__WHYME__?.getScene()?.getState();return s?.ready&&!s.presentationPaused&&!document.body.classList.contains('static-mode');});
 const save=async(name)=>{snapshots.push({name,...await state(),trace:await page.evaluate(()=>window.__introBoundaryTrace)});await page.screenshot({path:`${out}/${name}.png`});};

 await page.setViewportSize({width:1440,height:900});
 let releaseDownload;const downloadGate=new Promise(resolve=>releaseDownload=resolve);
 await page.route('**/models/*.glb',async route=>{await downloadGate;await route.continue();});
 await page.goto('http://127.0.0.1:5173/?angle=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const image=document.querySelector('.intro-poster');return image?.complete&&image.naturalWidth>0&&image.style.width!=='';});
 const pendingBefore=await page.evaluate(()=>({src:document.querySelector('.intro-poster').src,style:document.querySelector('.intro-poster').getAttribute('style'),rect:document.querySelector('.intro-poster').getBoundingClientRect().toJSON()}));
 await page.keyboard.press('2');await page.waitForTimeout(120);
 const pendingAfter=await page.evaluate(()=>({src:document.querySelector('.intro-poster').src,style:document.querySelector('.intro-poster').getAttribute('style'),rect:document.querySelector('.intro-poster').getBoundingClientRect().toJSON(),active:window.__WHYME__.getActive(),sceneAssigned:!!window.__WHYME__.getScene()}));
 snapshots.push({name:'pending-switch',before:pendingBefore,after:pendingAfter});
 check('下载中换站没有沿用旧站的配准样式',!pendingAfter.style,{before:pendingBefore,after:pendingAfter});
 await page.screenshot({path:`${out}/pending-switch.png`});
 releaseDownload();await released();await page.unroute('**/models/*.glb');
 const pendingResult=await state();check('下载中换站最终场景为第二站',!pendingResult.layout.staticMode&&pendingResult.layout.active===1&&pendingResult.scene.activeStation===1);

 await page.goto('http://127.0.0.1:5173/?angle=1');await handoff();
 const keysStart=await state();
 for(const key of ['2','4','3']){await page.keyboard.press(key);await page.waitForTimeout(25);}
 await released();await page.waitForTimeout(150);
 const keys=await state();
 check('快速2/4/3确实从开场交接中开始',keysStart.scene.presentationPaused);
 check('快速换站后保持3D且最终第三站一致',!keys.layout.staticMode&&keys.layout.active===2&&keys.scene.activeStation===2&&!keys.scene.presentationPaused);
 await save('rapid-stations');

 await page.goto('http://127.0.0.1:5173/?angle=1');await handoff();
 const dragBefore=await state();
 await page.mouse.move(350,650);await page.mouse.down();await page.mouse.move(360,650);await page.mouse.move(560,650,{steps:2});
 const dragging=await state();
 check('交接中拖拽不改变实时机位',dragBefore.scene.presentationPaused&&dragging.scene.presentationPaused&&dragging.scene.currentProgress===dragBefore.scene.currentProgress&&!dragging.scene.dragging,{before:dragBefore.scene.currentProgress,after:dragging.scene.currentProgress,paused:dragging.scene.presentationPaused});
 await page.mouse.up();const dragTarget=(await state()).layout.active;
 await released();const dragAfter=await state();
 check('松手后切到最终目标且无误降级',!dragAfter.layout.staticMode&&dragAfter.scene.activeStation===dragTarget&&dragAfter.layout.active===dragTarget);
 await save('intro-drag');

 await page.goto('http://127.0.0.1:5173/?angle=2');await handoff();
 const resizeStart=await state();
 await page.setViewportSize({width:1000,height:760});await page.setViewportSize({width:390,height:844});
 await released();await page.waitForTimeout(180);const resized=await state();
 check('resize从交接中开始',resizeStart.scene.presentationPaused);
 check('交接时跨断点resize后维持第二站3D',!resized.layout.staticMode&&resized.layout.active===1&&resized.scene.activeStation===1&&resized.scene.width===390&&resized.scene.mobile);
 await save('intro-resize');

 await page.locator('.wordmark').click();await page.locator('#mode-toggle').click();await page.keyboard.press('Escape');
 for(const key of ['2','4','3'])await page.keyboard.press(key);
 await page.waitForTimeout(420);const staticAfter=await state();
 check('刚切静帧后快速换站最终第三站一致',staticAfter.layout.staticMode&&staticAfter.layout.active===2&&staticAfter.posterTransition.filter(p=>p.current).length===1&&staticAfter.posterTransition[2].current);
 check('静帧内联transition没有残留none',staticAfter.posterTransition.every(p=>p.inline===''),staticAfter.posterTransition);
 check('静帧CSS淡入淡出时长仍生效',staticAfter.posterTransition.every((p,i)=>p.computed===(i===2?'0.2s':'0.12s')),staticAfter.posterTransition);
 await save('static-rapid');
 check('无页面异常或未处理拒绝',errors.length===0,errors);
 const result={checks,snapshots,errors};
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='intro-interruption.json';a.click();},result);
 await(await pending).saveAs('qa/tripo/v24-intro-interruption.json');
}
