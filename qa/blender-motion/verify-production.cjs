async(page)=>{
  const base='http://127.0.0.1:4173',checks=[],errors=[],requests=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/?angle=2`);
  await page.waitForFunction(()=>document.body.dataset.loadState==='ready');
  check('production loads authored GLB and precise mask',requests.some(u=>u.includes('person-authored-animated.glb'))&&requests.some(u=>u.includes('hoodie-mask.png')));
  const modelSHA256 = await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(r=>r.name.includes('person-authored-animated.glb')).name;
    const bytes=await(await fetch(url)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  });
  check('production serves the verified Blender asset',modelSHA256==='28ddcb8629174322495add57936bc27e8851dd7a5bb682602a46b728902bfda0',modelSHA256);
  check('production does not request old PNG or processed model',!requests.some(u=>/images-(intro|tripo|v2)\/.+\.png|\/models\/person(-animated)?\.glb/.test(u)));
  for(const index of [1,3,4,2]){await page.keyboard.press(String(index));await page.waitForFunction(i=>document.body.dataset.angle===String(i)&&document.body.classList.contains('card-open'),index);check(`production chapter ${index}`,await page.locator('.strength.is-active h2').isVisible());}
  await page.waitForTimeout(10000);
  const idleBefore=await page.locator('#scene').screenshot({path:'output/playwright/blender-motion/production-idle-before.png'});
  await page.waitForTimeout(1200);
  const idleAfter=await page.locator('#scene').screenshot({path:'output/playwright/blender-motion/production-idle-after.png'});
  check('production Idle continues to render motion after the performance',!idleBefore.equals(idleAfter));
  await page.goto(`${base}/?static=1&angle=2`);await page.waitForFunction(()=>document.body.dataset.loadState==='static-ready');
  const image=await page.locator('.poster.is-current').evaluate(i=>({src:i.src,width:i.naturalWidth,height:i.naturalHeight}));
  check('production fallback uses newly rendered 2x frame',image.width===2880&&image.height===2000&&image.src.includes('blender-actions-1'),image);
  await page.screenshot({path:'output/playwright/blender-motion/production-static.png',scale:'css'});
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/?angle=2`);await page.waitForFunction(()=>document.body.dataset.loadState==='ready');
  check('production mobile remains readable without overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&getComputedStyle(document.querySelector('.strengths')).opacity==='1'));
  await page.screenshot({path:'output/playwright/blender-motion/production-mobile.png',scale:'css'});
  check('no production browser error',errors.length===0,errors);
  const download=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='production-results.json';a.click();},{checks,errors});
  await(await download).saveAs('qa/blender-motion/production-results.json');if(checks.some(c=>!c.pass))throw Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
  await page.goto('about:blank');
}
