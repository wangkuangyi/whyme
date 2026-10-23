async (page) => {
  // Keep independent source edits from resetting a partially captured scene.
  await page.routeWebSocket('**/*',()=>{});
  const metadata={desktop:[],mobile:[]};
  for(const variant of ['desktop','mobile']){
    await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
    for(let index=0;index<4;index++){
      await page.goto(`http://127.0.0.1:5173/?holdIntro=1&angle=${index+1}`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
      await page.evaluate(async()=>{
        await document.fonts.ready;
        let previous='',stable=0;
        while(stable<12){
          await new Promise(requestAnimationFrame);
          const r=document.querySelector('#scene').getBoundingClientRect();
          const next=`${r.width},${r.height}`;stable=next===previous?stable+1:0;previous=next;
        }
      });
      const pending=page.waitForEvent('download');
      const state=await page.evaluate(()=>{
        const scene=window.__WHYME__.getScene(),state=scene.getState();
        if(!state.presentationPaused)throw new Error('Capture requires presentationPaused');
        if(!state.posterLayout)throw new Error('Character-only capture requires posterLayout');
        const a=document.createElement('a');a.href=scene.capture({characterOnly:true});a.download='intro.png';a.click();
        const r=document.querySelector('#scene').getBoundingClientRect();
        return {width:r.width,height:r.height,posterLayout:state.posterLayout,animation:state.animation,camera:state.camera,presentationPaused:state.presentationPaused,nodes:state.nodes};
      });
      await(await pending).saveAs(`public/images-intro/${variant==='desktop'?'angle':'mobile'}-0${index+1}.png`);
      metadata[variant].push(state);
    }
  }
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='intro-capture.json';a.click();},metadata);
  const download=await pending;
  await download.saveAs('output/playwright/v24-ui/intro-capture.json');
  await download.saveAs('public/images-intro/frames.json');
}
