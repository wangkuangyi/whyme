async page => {
  const records=[], checks=[], errors=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',()=>{});
  for(const [variant,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,800]]) {
    await page.setViewportSize({width,height});
    for(const station of [2,3,4]) {
      await page.goto(`http://127.0.0.1:5173/?angle=${station}`); await page.bringToFront();
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&document.body.dataset.loadState==='ready');
      for(const phase of ['gesture','idle']) {
        const sample=await page.evaluate(async phase=>{
          const scene=__WHYME__.getScene(); scene.setPresentationPaused(false);
          let clippedHands=0,frames=0,firstClipped=null;
          for(let i=0;i<1800;i++) {
            await new Promise(requestAnimationFrame);
            const s=scene.getState(),a=s.animation;
            if(s.activeStation===1 && s.protectedBounds.handBounds.some(b=>b.left<0||b.right>s.width||b.top<0||b.bottom>s.height)){clippedHands++;firstClipped??={time:a.time,hands:s.protectedBounds.handBounds,width:s.width,height:s.height};}
            frames++;
            if(phase==='gesture' ? !a.end&&a.time>=a.duration*.5 : a.end&&!a.transition&&!s.moving&&s.camera.restClose[s.activeStation]>.999) {
              scene.setPresentationPaused(true);
              return {state:scene.getState(),clippedHands,firstClipped,frames,title:document.querySelector('.strength.is-active h2').textContent,overflow:document.documentElement.scrollWidth>innerWidth};
            }
          }
          throw Error('Capture timed out');
        },phase);
        const file=`output/playwright/reframe/${variant}-0${station}-${phase}.png`;
        await page.screenshot({path:file,scale:'css',fullPage:true});
        const s=sample.state,b=s.protectedBounds.faceBounds;
        check(`${variant}/${station}/${phase}: correct chapter and clip`,sample.title===['','', '好看，也好用','上线只是开始','好队友'][station]&&(phase==='idle'?s.animation.completedAction:s.animation.action)===['','','Nod','LookAround','Wave'][station]);
        check(`${variant}/${station}/${phase}: page and head fit`,!sample.overflow&&b.top>=0&&b.left>=0&&b.right<=s.width);
        if(station===2)check(`${variant}/${station}/${phase}: hands remain within camera`,sample.clippedHands===0,{clipped:sample.clippedHands,firstClipped:sample.firstClipped,frames:sample.frames,hands:s.protectedBounds.handBounds,height:s.height});
        if(station===3)check(`${variant}/${station}/${phase}: camera looks upward`,s.camera.position[1]<s.camera.target[1],s.camera);
        records.push({variant,station,phase,file,...sample});
      }
    }
  }
  check('no browser errors',errors.length===0,errors);
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='framing-results.json';a.click();},{checks,records,errors});
  await(await pending).saveAs('qa/reframe/framing-results.json');
  await page.goto('about:blank');
  if(checks.some(c=>!c.pass))throw Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
}
