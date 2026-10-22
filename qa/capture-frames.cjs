async (page) => {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
  const metadata={desktop:[],mobile:[]};
  for(const variant of ['desktop','mobile']){
    await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
    for(let i=0;i<4;i++){
      await page.keyboard.press(String(i+1));
      await page.waitForTimeout(1700);
      metadata[variant].push(await page.evaluate(()=>{
        const r=document.querySelector('#scene').getBoundingClientRect();
        return {width:r.width,height:r.height,nodes:[...document.querySelectorAll('.node')].map(el=>{
          const n=el.getBoundingClientRect();return {x:n.x+n.width/2-r.x,y:n.y+n.height/2-r.y,visible:!el.classList.contains('is-occluded')};
        })};
      }));
      const downloadPromise=page.waitForEvent('download');
      await page.evaluate(()=>{
        const a=document.createElement('a');a.href=window.__WHYME__.getScene().capture();a.download='frame.png';a.click();
      });
      const download=await downloadPromise;
      await download.saveAs(`public/images/${variant==='desktop'?'angle':'mobile'}-0${i+1}.png`);
    }
  }
  const downloadPromise=page.waitForEvent('download');
  await page.evaluate(data=>{
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='frames.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },metadata);
  await (await downloadPromise).saveAs('public/images/frames.json');
}
