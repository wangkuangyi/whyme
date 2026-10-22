async (page) => {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready,{timeout:30000});
  const report=[];
  for(const [width,height] of [[1440,1000],[1280,800],[1024,768],[768,1024],[390,844],[375,812],[320,740]]){
    await page.setViewportSize({width,height});
    for(let i=0;i<4;i++){
      await page.keyboard.press(String(i+1));
      await page.waitForTimeout(1900);
      const result=await page.evaluate(()=>{
        const api=window.__WHYME__,state=api.getScene()?.getState(),layout=api.getLayout();
        const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const panel=document.querySelector('.strength.is-active'),card=document.querySelector('.strengths'),dot=box(panel.querySelector('.color-dot')),node=state?.nodes[state.activeStation];
        const text=[...document.querySelectorAll('.identity,.contact,.strength.is-active,.directory')].flatMap(p=>[...p.querySelectorAll('*')]).filter(el=>el.firstChild?.nodeType===Node.TEXT_NODE&&getComputedStyle(el).display!=='none').map(el=>({text:el.textContent.trim(),size:parseFloat(getComputedStyle(el).fontSize),family:getComputedStyle(el).fontFamily,weight:getComputedStyle(el).fontWeight,spacing:getComputedStyle(el).letterSpacing}));
        return {viewport:[innerWidth,innerHeight],active:api.getActive(),layout,state,card:box(card),identity:box(document.querySelector('.identity')),contact:box(document.querySelector('.contact')),title:box(panel.querySelector('h2')),proofs:[...panel.querySelectorAll('.proofs li')].map(el=>({text:el.textContent,...box(el),lines:el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight)})),dotDistance:node?Math.hypot(dot.left+dot.width/2-node.x,dot.top+dot.height/2-node.y):null,notchX:parseFloat(getComputedStyle(card).getPropertyValue('--notch-x')),overflow:document.documentElement.scrollWidth>innerWidth,text};
      });
      report.push(result);
      await page.screenshot({path:`output/playwright/v2/${width}-0${i+1}.png`});
    }
  }
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='layout.json';a.click();},report);
  await (await pending).saveAs('output/playwright/v2/layout.json');
}
