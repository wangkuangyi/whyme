async(page)=>{
  const base='https://whywky.website',checks=[],errors=[],requests=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/?angle=3`);
  await page.waitForFunction(()=>document.body.dataset.loadState==='ready');
  check('online serves the verified wide-shot production bundles',requests.some(u=>u.includes('index-CdfL1xVd.js'))&&requests.some(u=>u.includes('scene-90tuLe_x.js')));
  check('online loads authored GLB and precise mask',requests.some(u=>u.includes('person-authored-animated.glb'))&&requests.some(u=>u.includes('hoodie-mask.png')));
  const model = await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(r=>r.name.includes('person-authored-animated.glb')).name;
    const bytes=await(await fetch(url)).arrayBuffer();
    const length=new DataView(bytes).getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
    const wait=json.animations.find(a=>a.name==='Wait');
    const waitDuration=Math.max(...wait.samplers.map(s=>json.accessors[s.input].max[0]));
    return {sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''),animations:json.animations.map(a=>a.name),waitDuration,url};
  });
  check('online serves the verified Blender asset',model.sha==='7a4b7bebe8848a88bd10b83a04f50383651dfe039d73708647d0cb7b2de1a4fc',model);
  check('online asset includes Wait and excludes the withdrawn LookAround',model.animations.includes('Wait')&&!model.animations.includes('LookAround')&&model.url.includes('wide-shots-1'),model);
  check('online Wait is shortened to seven seconds',model.waitDuration===7,model.waitDuration);
  await page.waitForTimeout(2000);
  await page.screenshot({path:'output/playwright/wide-shots/online-wait.png',scale:'css'});
  check('online does not request old PNG or processed model',!requests.some(u=>/images-(intro|tripo|v2)\/.+\.png|\/models\/person(-animated)?\.glb/.test(u)));
  for(const index of [1,3,4,2]){
    await page.keyboard.press(String(index));
    await page.waitForFunction(i=>document.body.dataset.angle===String(i)&&document.body.classList.contains('card-open'),index);
    const chapter=await page.evaluate(()=>({title:document.querySelector('.strength.is-active h2').textContent,color:document.documentElement.style.getPropertyValue('--accent').trim().toLowerCase()}));
    check(`online chapter ${index} matches its new title and color`,chapter.title===['','随时出发','好看，也好用','上线只是开始','好队友'][index]&&chapter.color===['','#82756e','#3755a6','#327b60','#a44c76'][index],chapter);
  }
  await page.waitForTimeout(10000);
  const idleBefore=await page.locator('#scene').screenshot({path:'output/playwright/wide-shots/online-idle-before.png'});
  await page.waitForTimeout(1200);
  const idleAfter=await page.locator('#scene').screenshot({path:'output/playwright/wide-shots/online-idle-after.png'});
  check('online Idle continues to render motion after the performance',!idleBefore.equals(idleAfter));
  await page.goto(`${base}/?static=1&angle=3`);await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  const image=await page.locator('.poster.is-current').evaluate(i=>({src:i.src,width:i.naturalWidth,height:i.naturalHeight}));
  check('online fallback uses newly rendered 2x frame',image.width===2880&&image.height===2000&&image.src.includes('wide-shots-1'),image);
  await page.screenshot({path:'output/playwright/wide-shots/online-static.png',scale:'css'});
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/?angle=3`);await page.waitForFunction(()=>document.body.dataset.loadState==='ready');
  check('online mobile remains readable without overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&getComputedStyle(document.querySelector('.strengths')).opacity==='1'));
  await page.screenshot({path:'output/playwright/wide-shots/online-mobile.png',scale:'css'});
  check('no online browser error',errors.length===0,errors);
  const download=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='online-results.json';a.click();},{checks,errors});
  await(await download).saveAs('output/playwright/wide-shots/online-results.json');if(checks.some(c=>!c.pass))throw Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
  await page.goto('about:blank');
}
