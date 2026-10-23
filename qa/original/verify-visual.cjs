async (page) => {
  const checks=[],records=[],errors=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  await page.routeWebSocket('**/*',()=>{});
  page.on('pageerror',error=>errors.push(error.message));
  for(const variant of ['desktop','mobile']){
    await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
    await page.goto('http://127.0.0.1:5173/?angle=1');await page.bringToFront();
    await page.waitForFunction(()=>document.body.dataset.loadState==='ready');
    for(let index=0;index<4;index++){
      if(index)await page.keyboard.press(String(index+1));
      await page.waitForFunction(index=>{const s=window.__WHYME__?.getScene()?.getState();return s?.activeStation===index&&s.animation.end&&!s.animation.transition&&!s.moving&&(!index||s.camera.restClose[index]>.999);},index,{timeout:20000});
      const data=await page.evaluate(()=>({scene:__WHYME__.getScene().getState(),title:document.querySelector('.strength.is-active h2').textContent,
        overflow:document.documentElement.scrollWidth>innerWidth, opacity:getComputedStyle(document.querySelector('#app')).opacity,
        label:document.querySelector('.strength.is-active').innerText,urls:performance.getEntriesByType('resource').map(r=>r.name)}));
      check(`${variant}/${index+1}: full 4K original surface`,data.scene.cloth.every(m=>m.textureSize[0]===4096&&m.textureSize[1]===4096&&m.colorMaskSize[0]===4096&&m.surface==='MeshBasicMaterial'));
      check(`${variant}/${index+1}: no synthetic face or resolution downgrade`,!data.scene.animation.faceAnimation&&data.scene.animation.eyes===0&&!data.scene.quality.automaticDowngrade&&data.scene.quality.level===0&&data.scene.dpr===2);
      check(`${variant}/${index+1}: current chapter and complete page`,!data.overflow&&data.opacity==='1'&&data.scene.activeStation===index&&data.label.length>20);
      check(`${variant}/${index+1}: no processed historical model request`,!data.urls.some(u=>/\/models\/person(-animated)?\.glb/.test(u)));
      const file=`output/playwright/original-quality/${variant}-0${index+1}-final.png`;
      await page.screenshot({path:file,scale:'css',fullPage:true});records.push({variant,index,file,scene:data.scene,title:data.title});
    }
  }
  check('no unhandled browser error',errors.length===0,errors);
  const report={date:'2026-10-23',checks,records,errors};
  const download=page.waitForEvent('download');await page.evaluate(report=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.download='visual-results.json';a.click();},report);
  await(await download).saveAs('qa/original/visual-results.json');
  if(checks.some(c=>!c.pass))throw Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
  await page.goto('about:blank');
}
