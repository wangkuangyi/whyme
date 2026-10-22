async (page) => {
  const metadata={desktop:[],mobile:[]};
  for(const variant of ['desktop','mobile']){
    await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
    for(let i=0;i<4;i++){
      await page.goto(`http://127.0.0.1:5173/?motion=1&angle=${i+1}`);
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
      await page.waitForFunction(time=>window.__WHYME__.getScene().getState().animation.time>=time,[1.35,1.4,1.7,1.3][i]);
      const pending=page.waitForEvent('download');
      metadata[variant].push(await page.evaluate(()=>{
        const scene=window.__WHYME__.getScene(),s=scene.getState(),r=document.querySelector('#scene').getBoundingClientRect();
        const a=document.createElement('a');a.href=scene.capture();a.download='frame.png';a.click();
        return {width:r.width,height:r.height,...s.protectedBounds,nodes:s.nodes,animation:s.animation.action,time:s.animation.time,camera:s.camera};
      }));
      await(await pending).saveAs(`public/images-tripo/${variant==='desktop'?'angle':'mobile'}-0${i+1}.png`);
    }
  }
  const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='frames.json';a.click();},metadata);await(await pending).saveAs('public/images-tripo/frames.json');
}
