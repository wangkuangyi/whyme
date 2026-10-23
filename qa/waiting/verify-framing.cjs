async page => {
  const records=[], checks=[], errors=[], assetHashes=[];
  const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/*',()=>{});
  for(const [variant,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,800]]) {
    await page.setViewportSize({width,height});
    for(const station of [1,3,2,4]) {
      await page.goto(`http://127.0.0.1:5173/?angle=${station}`); await page.bringToFront();
      await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready&&document.body.dataset.loadState==='ready');
      const assetSHA=await page.evaluate(async()=>{const url=performance.getEntriesByType('resource').find(r=>r.name.includes('person-authored-animated.glb')).name;const bytes=await(await fetch(url,{cache:'force-cache'})).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');});
      assetHashes.push(assetSHA);
      for(const phase of ['gesture','idle']) {
        const sample=await page.evaluate(async phase=>{
          const scene=__WHYME__.getScene(); scene.setPresentationPaused(false);
          let clippedHeads=0,clippedHands=0,frames=0;
          for(let i=0;i<2400;i++) {
            await new Promise(requestAnimationFrame);
            const s=scene.getState(),a=s.animation,b=s.protectedBounds.faceBounds;
            if(b.top<0||b.left<0||b.right>s.width)clippedHeads++;
            if(s.activeStation===1 && s.protectedBounds.handBounds.some(b=>b.left<0||b.right>s.width||b.top<0||b.bottom>s.height))clippedHands++;
            frames++;
            if(phase==='gesture' ? !a.end&&a.time>=a.duration*.5 : a.end&&!a.transition&&!s.moving&&s.camera.restClose[s.activeStation]>.999) {
              scene.setPresentationPaused(true);
              return {state:scene.getState(),clippedHeads,clippedHands,frames,title:document.querySelector('.strength.is-active h2').textContent,overflow:document.documentElement.scrollWidth>innerWidth};
            }
          }
          throw Error('Capture timed out');
        },phase);
        const file=`output/playwright/waiting/${variant}-0${station}-${phase}.png`;
        await page.screenshot({path:file,scale:'css',fullPage:true});
        const s=sample.state;
        check(`${variant}/${station}/${phase}: chapter and clip`,sample.title===['','随时出发','好看，也好用','上线只是开始','好队友'][station]&&(phase==='idle'?s.animation.completedAction:s.animation.action)===['','Walk','Nod','Wait','Wave'][station]);
        check(`${variant}/${station}/${phase}: head and page fit`,!sample.overflow&&sample.clippedHeads===0,{clippedHeads:sample.clippedHeads});
        if(station===2)check(`${variant}/${station}/${phase}: pointing hands remain visible`,sample.clippedHands===0,{clippedHands:sample.clippedHands});
        if(station===3)check(`${variant}/${station}/${phase}: left-front upshot`,s.camera.position[0]>s.camera.target[0]&&s.camera.position[2]>s.camera.target[2]&&s.camera.position[1]<s.camera.target[1],s.camera);
        if(station===1)check(`${variant}/${station}/${phase}: forward projects down-right`,s.camera.azimuth<0&&s.camera.azimuth>-90&&s.camera.position[1]>s.camera.target[1]&&s.camera.fill<.65,s.camera);
        records.push({variant,station,phase,file,assetSHA,...sample});
      }
    }
  }
  check('no browser errors',errors.length===0,errors);
  check('one identical asset used throughout all viewports',new Set(assetHashes).size===1,assetHashes);
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='framing-results.json';a.click();},{checks,records,errors});
  await(await pending).saveAs('qa/waiting/framing-results.json');
  await page.goto('about:blank');
  if(checks.some(c=>!c.pass))throw Error(checks.filter(c=>!c.pass).map(c=>c.name).join('; '));
}
