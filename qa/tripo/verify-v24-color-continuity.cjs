async(page)=>{
 const checks=[],samples=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5173/?angle=1');
 await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&!window.__WHYME__.getScene().getState().presentationPaused);
 const immediate=await page.evaluate(()=>{
  const scene=window.__WHYME__.getScene(),before=scene.getState();window.__WHYME__.select(1);
  return {before:before.colors.hoodie,cloth:scene.getState().colors.hoodie,accent:document.documentElement.style.getPropertyValue('--accent')};
 });
 check('点击时节点不提前跳到目标色',immediate.accent.toLowerCase()===immediate.cloth.toLowerCase(),immediate);
 await page.waitForTimeout(1200);
 // Catch the first actual drag event during an in-flight camera/color move.
 await page.keyboard.press('1');await page.waitForTimeout(1200);
 await page.evaluate(()=>{
  window.__colorEvents=[];window.__colorProbe=new AbortController();
  const snapshot=()=>{const s=window.__WHYME__.getScene().getState();return {p:s.currentProgress,target:s.targetProgress,moving:s.moving,color:s.colors.lch,hex:s.colors.hoodie,accent:document.documentElement.style.getPropertyValue('--accent'),dragging:s.dragging};};
  document.addEventListener('pointermove',e=>{e.colorBefore=snapshot();},{capture:true,signal:window.__colorProbe.signal});
  document.addEventListener('pointermove',e=>{
   const after=snapshot();if(window.__colorEvents.length||!after.dragging)return;
   const event={before:e.colorBefore,after,frames:[]};window.__colorEvents.push(event);
   const sample=()=>{event.frames.push(snapshot());if(event.frames.length<3)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  },{signal:window.__colorProbe.signal});
 });
 await page.keyboard.press('2');await page.waitForTimeout(220);
 await page.mouse.move(710,420);await page.mouse.down();await page.mouse.move(700,420);await page.waitForTimeout(100);
 const drag=await page.evaluate(()=>window.__colorEvents[0]);
 check('拖拽确实接管尚未结束的镜头切换',drag&&drag.before.moving&&!drag.before.dragging&&drag.after.dragging&&Math.abs(drag.before.target-drag.before.p)>.01,drag);
 check('切换中接管拖拽不跳镜头',drag&&Math.abs(drag.after.p-drag.before.p)<1e-8,drag);
 const hueDelta=(a,b)=>Math.abs(((a-b+540)%360)-180);
 check('接管后连续三帧亮度、饱和度、色相不跳变',drag?.frames.length===3&&drag.frames.every(f=>Math.abs(f.color[0]-drag.before.color[0])<1e-8&&Math.abs(f.color[1]-drag.before.color[1])<1e-8&&hueDelta(f.color[2],drag.before.color[2])<1e-8&&f.hex===f.accent),drag);
 await page.evaluate(()=>window.__colorProbe.abort());
 await page.mouse.move(650,420,{steps:6});await page.waitForTimeout(100);await page.mouse.up();await page.waitForTimeout(1100);
 // This route covers all 12 directed station pairs, including the 4-to-1 seam.
 await page.evaluate(()=>window.__WHYME__.select(0,{immediate:true}));
 for(const index of [1,2,3,0,2,0,3,2,1,3,1,0]){
  const series=await page.evaluate(async(index)=>{
   window.__WHYME__.select(index);const series=[],start=performance.now();
   while(performance.now()-start<720){await new Promise(requestAnimationFrame);const s=window.__WHYME__.getScene().getState(),accent=document.documentElement.style.getPropertyValue('--accent');const probe=document.createElement('span');probe.style.color=accent;document.body.append(probe);const accentRGB=getComputedStyle(probe).color;probe.remove();series.push({t:performance.now()-start,color:s.colors,accent,node:getComputedStyle(document.querySelector('.node.is-active .node-dot')).backgroundColor,accentRGB});}
   return series;
  },index);
  check(`切到${index+1}期间卫衣、强调色和节点同步`,series.every(s=>s.accent.toLowerCase()===s.color.hoodie.toLowerCase()&&s.node===s.accentRGB));
  check(`切到${index+1}最终颜色正确`,series.at(-1).color.hoodie.toLowerCase()===['#c2603d','#3755a6','#327b60','#a44c76'][index]);
  samples.push({index,series});await page.waitForTimeout(350);
 }
 // Rapid interruptions must start from the color already on screen.
 const rapid=await page.evaluate(async()=>{
  const r=[];
  for(const index of [0,2,3,1,2]){const before=window.__WHYME__.getScene().getState();window.__WHYME__.select(index);const after=window.__WHYME__.getScene().getState();r.push({before:before.colors.hoodie,after:after.colors.hoodie,accent:document.documentElement.style.getPropertyValue('--accent')});await new Promise(resolve=>setTimeout(resolve,85));}return r;
 });
 check('连续快速切站沿用当前颜色',rapid.every(s=>s.before===s.after&&s.after.toLowerCase()===s.accent.toLowerCase()),rapid);
 await page.waitForTimeout(1300);
 await page.evaluate(()=>window.__WHYME__.select(0));await page.waitForTimeout(150);
 const fallback=await page.evaluate(()=>{
  const before=window.__WHYME__.getScene().getState().colors.hoodie;
  document.querySelector('.wordmark').click();document.querySelector('#mode-toggle').click();
  return {before,accent:document.documentElement.style.getPropertyValue('--accent'),angle:document.body.dataset.angle,static:document.body.classList.contains('static-mode')};
 });
 check('渐变中切静帧恢复该站准确颜色',fallback.static&&fallback.angle==='1'&&fallback.accent.toLowerCase()==='#c2603d',fallback);
 await page.locator('#mode-toggle').click();await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&!window.__WHYME__.getScene().getState().presentationPaused);
 await page.keyboard.press('Escape');
 check('静帧恢复3D颜色同步',await page.evaluate(()=>window.__WHYME__.getScene().getState().colors.hoodie===document.documentElement.style.getPropertyValue('--accent')));
 check('没有脚本异常',errors.length===0,errors);
 const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='color-continuity.json';a.click();},{checks,samples});await(await pending).saveAs('output/playwright/v24/color-continuity.json');
 if(checks.some(c=>!c.pass))throw new Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
}
