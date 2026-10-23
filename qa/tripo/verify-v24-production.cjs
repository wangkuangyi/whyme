async(page)=>{
 const checks=[],errors=[],failed=[],requests=[];
 const check=(name,pass,details)=>checks.push({name,pass:!!pass,...(details?{details}:{})});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});page.on('request',r=>requests.push(r.url()));
 const ready3d=()=>page.waitForFunction(()=>document.body.classList.contains('scene-ready')&&!document.body.classList.contains('static-mode'));
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:4173/');await ready3d();
 check('默认打开加载3D动画版本',requests.some(u=>u.includes('/models/person-animated.glb')));
 check('生产没有开发调试接口',await page.evaluate(()=>typeof window.__WHYME__==='undefined'));
 const first=await page.locator('#scene').screenshot();await page.waitForTimeout(800);const second=await page.locator('#scene').screenshot();check('默认人物画面随时间变化',!first.equals(second));
 await page.screenshot({path:'output/playwright/v24/production-desktop.png'});
 for(const key of ['2','3','4','1']){await page.keyboard.press(key);await page.waitForTimeout(1250);check(`键盘切换到角度${key}`,await page.evaluate(k=>document.body.dataset.angle===k&&document.querySelector('.node.is-active')?.dataset.index===String(Number(k)-1),key));}
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:315,y:350}]});
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:315-i*20,y:350}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1300);
 check('390px真实触摸横滑切换角度1到2',await page.evaluate(()=>document.body.dataset.angle==='2'));await cdp.detach();
 await page.keyboard.press('4');await page.waitForTimeout(1250);await page.screenshot({path:'output/playwright/v24/production-mobile.png'});
 await page.goto('http://127.0.0.1:4173/?static=1&angle=3');await page.waitForFunction(()=>document.body.classList.contains('static-mode')&&document.body.classList.contains('scene-ready'));
 check('static参数启用静帧模式',true);
 for(const key of ['1','2','3','4']){await page.keyboard.press(key);await page.waitForFunction(()=>{const i=document.querySelector('.poster.is-current');return i?.complete&&i.naturalWidth>0;});await page.waitForFunction(key=>document.querySelector('.poster.is-current')?.currentSrc.includes(`0${key}.png`),key);await page.waitForTimeout(220);check(`静帧角度${key}图片加载`,await page.locator('.poster.is-current').evaluate(img=>img.complete&&img.naturalWidth>0&&img.currentSrc.includes('/images-tripo/')));}
 await page.locator('.wordmark').click();await page.locator('#mode-toggle').click();await ready3d();check('幕后按钮从静帧启用3D',true);
 await page.locator('#mode-toggle').click();await page.waitForFunction(()=>document.body.classList.contains('static-mode'));check('幕后按钮从3D切换静帧',true);
 await page.locator('#mode-toggle').click();await ready3d();check('再次切回3D可恢复',true);
 await page.keyboard.press('Escape');check('Escape关闭幕后说明',await page.locator('#detail-dialog').evaluate(d=>!d.open));
 await page.waitForTimeout(400);check('全程无404或其他失败HTTP资源',failed.length===0,failed);check('全程无页面脚本错误',errors.length===0,errors);check('移动版无横向滚动溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const result={base:'http://127.0.0.1:4173',checks,errors,failed,passed:checks.filter(c=>c.pass).length,total:checks.length,animationModelRequested:requests.some(u=>u.includes('/models/person-animated.glb'))};
 const download=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='production.json';a.click();},result);await(await download).saveAs('output/playwright/v24/production.json');
}
