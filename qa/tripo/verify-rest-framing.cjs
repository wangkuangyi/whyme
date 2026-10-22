async (page) => {
  const checks=[], samples=[], errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
    await page.setViewportSize({width,height});
    for(const angle of [1,2,3,4]){
      await page.goto(`http://127.0.0.1:5173/?angle=${angle}`);
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
      if(angle!==3){
        await page.waitForFunction(t=>{const s=window.__WHYME__.getScene().getState();return s.animation.action!=='Idle' && s.animation.time>=t;},angle===1?1.7:1.3);
        await page.screenshot({path:`output/playwright/refine-actions/${width}-action-${angle}.png`});
      }
      await page.waitForFunction(()=>{const s=window.__WHYME__.getScene().getState();return s.animation.action==='Idle' && s.camera.restClose[s.activeStation]===1;});
      const data=await page.evaluate(async()=>{
        const values=[];
        for(let i=0;i<20;i++){
          const s=window.__WHYME__.getScene().getState();
          values.push({height:s.height,width:s.width,action:s.animation.action,clips:s.animation.clips,camera:s.camera,...s.protectedBounds});
          await new Promise(r=>setTimeout(r,90));
        }
        return values;
      });
      samples.push({width,height,angle,data});
      check(`${width}px 第${angle}站静止不露手指`,data.every(s=>s.handBounds.every(b=>b.top>=s.height || b.bottom<=0 || b.right<=0 || b.left>=s.width)),data[0].handBounds);
      check(`${width}px 第${angle}站保留头顶`,data.every(s=>s.faceBounds.top>0));
      check(`${width}px 第${angle}站禁用大挥手`,!data[0].clips.includes('Greet')&&!data[0].clips.includes('Box'));
      await page.screenshot({path:`output/playwright/refine-actions/${width}-rest-${angle}.png`});
    }
  }
  check('页面无未处理脚本错误',errors.length===0,errors);
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='rest-framing.json';a.click();},{checks,samples});
  await(await pending).saveAs('output/playwright/refine-actions/rest-framing.json');
}
