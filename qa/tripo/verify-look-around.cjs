async(page)=>{
 const checks=[],errors=[],shots=[];page.on('pageerror',e=>errors.push(e.message));
 const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
 for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
  await page.setViewportSize({width,height});
  for(const angle of [1,2,3,4]){
   await page.goto(`http://127.0.0.1:5173/?angle=${angle}`);
   await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
   const phases=[];
   for(const time of angle===3?[1.5,4,7.5,11,14]:[angle===1?1.7:1.3]){
    await page.waitForFunction(t=>{const s=window.__WHYME__.getScene().getState();return s.animation.action!=='Idle'&&s.animation.time>=t;},time);
    phases.push(await page.evaluate(()=>{const s=window.__WHYME__.getScene().getState();return {time:s.animation.time,action:s.animation.action,camera:s.camera,...s.protectedBounds,height:s.height,width:s.width};}));
    await page.screenshot({path:`output/playwright/look-around/${width}-action-${angle}-${time}.png`});
   }
   await page.waitForFunction(()=>{const s=window.__WHYME__.getScene().getState();return s.animation.action==='Idle'&&s.camera.restClose[s.activeStation]===1;});
   const rest=await page.evaluate(()=>window.__WHYME__.getScene().getState());
   shots.push({width,height,angle,phases,rest});
   check(`${width}px第${angle}站动作正确`,phases[0].action===['Walk','Nod','LookAround','Wave'][angle-1]);
   check(`${width}px第${angle}站静止手指隐藏`,rest.protectedBounds.handBounds.every(b=>b.top>=rest.height));
   check(`${width}px第${angle}站头顶完整`,phases.every(s=>s.faceBounds.top>0)&&rest.protectedBounds.faceBounds.top>0);
   check(`${width}px第${angle}站不再绑定抱臂和大挥手`,!rest.animation.clips.includes('CrossArms')&&!rest.animation.clips.includes('Greet'));
   await page.screenshot({path:`output/playwright/look-around/${width}-rest-${angle}.png`});
  }
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:5173/?angle=1');await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().animation.action==='Idle');
 const before=await page.evaluate(()=>window.__WHYME__.getScene().getState().animation.position);
 await page.keyboard.press('3');await page.waitForTimeout(1700);
 const after=await page.evaluate(()=>window.__WHYME__.getScene().getState());
 check('行走后切换环顾保持世界位置',after.animation.action==='LookAround'&&Math.hypot(...before.map((v,i)=>v-after.animation.position[i]))<1e-8);
 await page.waitForFunction(()=>{const s=window.__WHYME__.getScene().getState();return s.animation.action==='Idle'&&s.camera.restClose[2]===1;});
 const replay=await page.evaluate(()=>{const s=window.__WHYME__.getScene(),b=s.getState().protectedBounds.faceBounds;s.reactAt((b.left+b.right)/2,(b.top+b.bottom)/2);return s.getState().animation.action;});
 check('点击人物重新环顾',replay==='LookAround');
 check('无页面脚本异常',errors.length===0,errors);
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='look-around.json';a.click();},{checks,shots});await(await pending).saveAs('output/playwright/look-around/results.json');
}
