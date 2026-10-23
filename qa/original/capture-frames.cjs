async(page)=>{
 await page.bringToFront(); await page.routeWebSocket('**/*',()=>{});const metadata=Object.fromEntries(['images-intro','images-tripo','images-v2'].map(name=>[name,{desktop:[],mobile:[]} ])),records=[];
 const downloadJSON=async(data,path)=>{const pending=page.waitForEvent('download');await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='frames.json';a.click();},data);await(await pending).saveAs(path);};
 for(const variant of ['desktop','mobile']){
  await page.setViewportSize(variant==='desktop'?{width:1440,height:1000}:{width:390,height:844});
  for(const kind of ['intro','idle','still'])for(let index=0;index<4;index++){
   const directory=kind==='intro'?'images-intro':kind==='idle'?'images-tripo':'images-v2',query=kind==='intro'?'holdIntro=1':kind==='still'?'still=1':'motion=1';
   await page.goto(`http://127.0.0.1:5173/?${query}&angle=${index+1}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__WHYME__?.getScene()?.getState().ready);
   await page.evaluate(async()=>{await document.fonts.ready;let previous='',stable=0;while(stable<12){await new Promise(requestAnimationFrame);const r=document.querySelector('#scene').getBoundingClientRect(),next=`${r.width},${r.height}`;stable=next===previous?stable+1:0;previous=next;}});
   if(kind==='idle')await page.waitForFunction(()=>{const s=__WHYME__.getScene().getState();return s.animation.end&&!s.animation.walking&&!s.animation.transition&&!s.moving;},{},{timeout:20000});
   if(kind!=='intro'){
    await page.waitForFunction(()=>{const s=__WHYME__.getScene().getState();return !s.presentationPaused&&!s.moving&&document.body.classList.contains('card-open');});
    await page.evaluate(async()=>{let previous='',stable=0;while(stable<12){await new Promise(requestAnimationFrame);const s=__WHYME__.getScene().getState(),next=[...s.camera.position,...s.camera.target].map(v=>v.toFixed(4)).join(',');stable=next===previous?stable+1:0;previous=next;}});
   }
   const pending=page.waitForEvent('download');const capture=await page.evaluate(({kind,index})=>{const scene=__WHYME__.getScene(),s=scene.getState(),r=document.querySelector('#scene').getBoundingClientRect();if(s.activeStation!==index)throw Error('Wrong capture station');if(kind==='intro'&&(!s.presentationPaused||!s.posterLayout))throw Error('Intro must be paused and registered');const a=document.createElement('a');a.href=scene.capture({characterOnly:kind==='intro'});a.download='frame.png';a.click();return {metadata:kind==='intro'?{width:r.width,height:r.height,posterLayout:s.posterLayout,animation:s.animation,camera:s.camera,presentationPaused:s.presentationPaused,nodes:s.nodes}:{width:r.width,height:r.height,...s.protectedBounds,nodes:s.nodes,animation:s.animation.action,time:s.animation.time,camera:s.camera},colors:s.colors,idleMode:s.animation.idleMode,idleSourceTime:s.animation.idleSourceTime,title:document.querySelector('.strength.is-active h2').textContent};},{kind,index});
   const path=`public/${directory}/${variant==='desktop'?'angle':'mobile'}-0${index+1}.png`;await(await pending).saveAs(path);metadata[directory][variant][index]=capture.metadata;records.push({variant,kind,index,path,...capture});
  }
 }
 for(const [directory,data] of Object.entries(metadata))await downloadJSON(data,`public/${directory}/frames.json`);await downloadJSON({records},'output/playwright/original-quality/capture-all.json');await page.goto('about:blank');
}

