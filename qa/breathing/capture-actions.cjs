async(page)=>{
 const records=[];
 for(const variant of ['desktop','mobile']){
  await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
  for(const [index,time] of [[1,.8],[2,1],[3,.8],[4,1.4]]){
   await page.goto(`http://127.0.0.1:5173/?angle=${index}`);await page.bringToFront();
   await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
   const scene=await page.evaluate(async time=>{
    for(let i=0;i<1500;i++){
     await new Promise(requestAnimationFrame);
     const scene=__WHYME__.getScene(),s=scene.getState();
     if(!s.presentationPaused&&s.animation.time>=time&&!s.animation.end){scene.setPresentationPaused(true);return scene.getState();}
    }
    throw Error('Action capture did not reach the requested frame');
   },time);
   const file=`output/playwright/breathing-posture/${variant}-0${index}-action.png`;
   await page.screenshot({path:file,scale:'css',fullPage:true});records.push({variant,index,file,scene});
  }
 }
 const pending=page.waitForEvent('download');await page.evaluate(records=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(records,null,2)],{type:'application/json'}));a.download='actions.json';a.click();},records);await(await pending).saveAs('qa/breathing/action-captures.json');await page.goto('about:blank');
}
