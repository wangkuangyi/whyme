async(page)=>{
 const checks=[],captures=[],errors=[];
 // Keep an explicit navigation's source snapshot stable while collaborators
 // edit files; this test session does not need Vite's live-reload websocket.
 await page.routeWebSocket('**',()=>{});
 page.on('pageerror',e=>errors.push(e.message));
 const check=(name,passed,detail)=>checks.push({name,passed:!!passed,detail});
 for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
  await page.setViewportSize({width,height});
  await page.goto('http://127.0.0.1:5173/?angle=3');
  await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
  for(const time of [.8,2.3,4.6,5.2]){
   await page.waitForFunction(t=>{const a=window.__WHYME__.getScene().getState().animation;return a.action==='LookAround'&&a.time>=t;},time);
   const state=await page.evaluate(()=>{const scene=window.__WHYME__.getScene(),s=scene.getState();scene.setDragProgress(s.currentProgress);return s;});
   captures.push({width,phase:'action',time:state.animation.time,animation:state.animation,face:state.protectedBounds.faceBounds});
   check(`${width}px 动作 ${time}s 头顶完整`,state.protectedBounds.faceBounds.top>0);
   await page.screenshot({path:`output/playwright/v24-motion/${width}-action-${time}.png`});
   await page.evaluate(()=>window.__WHYME__.getScene().setStation(2,{immediate:true}));
  }
  await page.waitForFunction(()=>{const s=window.__WHYME__.getScene().getState();return s.animation.action==='Idle'&&s.camera.restClose[2]===1;});
  const rest=await page.evaluate(()=>window.__WHYME__.getScene().getState());
  captures.push({width,phase:'idle',animation:rest.animation,face:rest.protectedBounds.faceBounds,hands:rest.protectedBounds.handBounds});
  check(`${width}px 5.8秒原速源片段`,rest.animation.lookAroundRange.join(',')==='1.2,7');
  check(`${width}px 完成后只保留待机`,rest.animation.completedAction==='LookAround'&&rest.animation.weights.length===1&&rest.animation.weights[0].action==='Idle');
  check(`${width}px 待机手指隐藏`,rest.protectedBounds.handBounds.every(b=>b.top>=rest.height));
  check(`${width}px 禁止动作未绑定`,['Greet','Box','CrossArms'].every(name=>!rest.animation.clips.includes(name)));
  await page.screenshot({path:`output/playwright/v24-motion/${width}-idle.png`});
  const replay=await page.evaluate(()=>{const scene=window.__WHYME__.getScene(),b=scene.getState().protectedBounds.faceBounds;scene.reactAt((b.left+b.right)/2,(b.top+b.bottom)/2);return scene.getState().animation;});
  check(`${width}px 点击重播同一5.8秒片段`,replay.action==='LookAround'&&replay.time===0&&replay.duration===5.8&&replay.speed===1&&replay.lookAroundRange.join(',')==='1.2,7');
  await page.waitForFunction(()=>{const a=window.__WHYME__.getScene().getState().animation;return a.action==='Idle'&&a.end;});
  check(`${width}px 重播后也回待机`,await page.evaluate(()=>window.__WHYME__.getScene().getState().animation.completedAction==='LookAround'));
 }
 check('页面无脚本错误',errors.length===0,errors);
 const result={checks,captures,errors};
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='v24-motion-browser.json';a.click();},result);
 await(await pending).saveAs('qa/tripo/v24-motion-browser.json');
}
