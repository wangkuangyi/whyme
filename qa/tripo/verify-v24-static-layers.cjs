async(page)=>{
  const checks=[],captures=[],errors=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>{const image=document.querySelector('.poster.is-current'),actions=document.querySelector('.strength.is-active .card-actions');return document.body.classList.contains('static-mode')&&document.body.classList.contains('card-open')&&image?.complete&&image.naturalWidth>0&&Number(getComputedStyle(actions).opacity)>.99;});
  const save=async name=>{const path=`output/playwright/v24-static-layers/${name}.png`;await page.screenshot({path,fullPage:true,animations:'disabled'});captures.push(path);};
  // A layer hidden behind the opaque poster contributes zero pixels. Compare
  // actual screenshots with that one element temporarily hidden, then restore.
  async function paintedPixels(selector,regionSelector=selector){
    const region=await page.locator(regionSelector).boundingBox();
    if(!region)return {pixels:0,reason:'no painted bounds'};
    const before=await page.screenshot({animations:'disabled'});
    const old=await page.locator(selector).evaluate(el=>{const value=el.style.visibility;el.style.visibility='hidden';return value;});
    const after=await page.screenshot({animations:'disabled'});
    await page.locator(selector).evaluate((el,value)=>{el.style.visibility=value;},old);
    return page.evaluate(async({first,second,region})=>{
      const load=async src=>{const image=new Image();image.src=`data:image/png;base64,${src}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context;};
      const [a,b]=await Promise.all([load(first),load(second)]);
      const x=Math.max(0,Math.floor(region.x)-3),y=Math.max(0,Math.floor(region.y)-3),width=Math.min(a.canvas.width-x,Math.ceil(region.width)+6),height=Math.min(a.canvas.height-y,Math.ceil(region.height)+6);
      if(width<=0||height<=0)return {pixels:0,reason:'outside viewport',region};
      const p=a.getImageData(x,y,width,height).data,q=b.getImageData(x,y,width,height).data;let pixels=0;
      for(let i=0;i<p.length;i+=4)if(Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]))>12)pixels++;
      return {pixels,region:{x,y,width,height}};
    },{first:before.toString('base64'),second:after.toString('base64'),region});
  }
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:4173/?static=1&angle=2');await ready();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
    const node=await paintedPixels('.node.is-active');
    check(`${viewport.width}px静帧节点真实绘制在海报之前`,node.pixels>=15,node);
    const connector=await paintedPixels('.node-connector','.node-connector path');
    check(`${viewport.width}px连线真实绘制可见`,connector.pixels>=5,connector);
    const card=await paintedPixels('.card-body','.strength.is-active h2');
    const hit=await page.locator('.strength.is-active h2').evaluate(el=>{const r=el.getBoundingClientRect();return !!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#strengths');});
    check(`${viewport.width}px卡片标题可见且处于交互前层`,card.pixels>=50&&hit,{...card,hit});
    await save(`${viewport.width}-static`);
    const stage=await page.locator('.stage').boundingBox(),start={x:stage.x+stage.width*.78,y:stage.y+stage.height*.6};
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.2,start.y,{steps:12});await page.waitForTimeout(450);
    const label=await paintedPixels('#drag-label');
    const labelText=await page.locator('#drag-label').innerText();
    check(`${viewport.width}px拖动标签真实绘制在海报之前`,label.pixels>=5&&labelText.trim().length>2,{...label,text:labelText});
    await save(`${viewport.width}-drag`);await page.mouse.up();await ready();
    check(`${viewport.width}px拖动后卡片恢复且角度一致`,await page.evaluate(()=>!document.body.classList.contains('is-dragging')&&new URL(location.href).searchParams.get('angle')===document.body.dataset.angle&&Number(document.querySelector('.strength.is-active').dataset.strength)+1===Number(document.body.dataset.angle)));
  }
  check('生产页面无未处理异常',errors.length===0,errors);
  const result={base:'http://127.0.0.1:4173',checks,captures,errors,method:'Actual screenshot pixel difference with a single UI layer temporarily hidden; no DEV helpers.'};
  const download=page.waitForEvent('download');await page.evaluate(result=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));a.download='v24-static-layers.json';a.click();},result);
  await(await download).saveAs('qa/tripo/v24-static-layers.json');
  if(checks.some(check=>!check.pass))throw new Error(checks.filter(check=>!check.pass).map(check=>check.name).join('; '));
}
