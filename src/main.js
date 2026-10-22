import './style.css';
import { profile, advantages } from './content.js';
import { setupDialogs } from './dialogs.js';

const COLORS=['#C2603D','#3755A6','#327B60','#A44C76'];
const restored = new URLSearchParams(location.search).has('still');
const IMAGE_ROOT=restored?'/images-v2':'/images-tripo';
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const wrap=n=>((n%4)+4)%4;
const mobile=()=>innerWidth<901;
const availability=Date.now()<Date.parse(`${profile.availableFrom}T00:00:00+08:00`)?profile.availability:'现在即可到岗';
if(availability==='现在即可到岗')advantages[0].claim='现在即可到岗，用已有经验尽快上手。';
const param=Number(new URLSearchParams(location.search).get('angle')||1);
let active=Number.isFinite(param)?clamp(Math.round(param)-1,0,3):0;
let scene=null,controller=null,generation=0;
let staticMode=new URLSearchParams(location.search).has('static');
let reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let pointer=null,dragged=false,firstInput=false,moving=false;
let wheelLast=0,wheelAmount=0,wheelUsed=false;
let lineTimer,cardTimer,staticTimer,resizeTimer;
let frameMetadata=null,lastPositions=[],lastSettled=null;
const framePath=(i,variant=mobile()?'mobile':'desktop')=>`${IMAGE_ROOT}/${variant==='mobile'?'mobile':'angle'}-0${i+1}.png`;

document.title=`${profile.name} ${profile.nameEn} — Why me?`;
document.querySelector('#app').innerHTML=`
<a class="skip-link" href="#strengths">跳到文字介绍</a>
<main class="portfolio" aria-label="王匡义的四个角度">
  <div class="stage" id="stage" aria-label="人物展示，左右拖动切换角度">
    <div class="poster-stack" aria-hidden="true">${advantages.map((_,i)=>`<img class="poster ${i===active?'is-current':''}" src="${framePath(i)}" alt="" ${i===active?'fetchpriority="high"':'loading="lazy"'} draggable="false">`).join('')}</div>
    <canvas id="scene" aria-hidden="true"></canvas>
    <svg class="loading-halo" viewBox="0 0 1000 400" aria-hidden="true"><ellipse cx="500" cy="200" rx="370" ry="90" transform="rotate(-9 500 200)" pathLength="100"/></svg>
    <div class="nodes" aria-label="选择光环节点">${advantages.map((a,i)=>`<button class="node ${i===active?'is-active':''}" data-index="${i}" aria-label="角度 ${i+1}：${esc(a.category)}" aria-pressed="${i===active}"><span class="node-dot"></span><span class="node-index">0${i+1}</span><span class="node-tooltip">${esc(a.category)}</span></button>`).join('')}</div>
    <span id="drag-label" class="drag-label" aria-hidden="true"></span>
    <svg class="node-connector" aria-hidden="true"><path pathLength="1"/></svg>
  </div>
  <header class="identity"><a class="wordmark" href="#behind-the-scenes" aria-label="Why me? 网站幕后" title="了解这个网站">Why me?</a><h1>${esc(profile.name)}</h1><span class="print-name">${esc(profile.nameEn)}</span><p class="identity-line"><span>AI 系统 · Agent<span class="role-extra"> · 平台开发</span></span><span class="availability">${esc(availability)}</span></p></header>
  <nav class="contact" aria-label="简历与联系"><a href="#contact" class="contact-link">联系</a><a class="resume" href="${esc(profile.resume)}" target="_blank" rel="noopener noreferrer">简历 <span>↗</span></a></nav>
  <section id="strengths" class="strengths" aria-label="四个一起工作的理由" tabindex="-1" data-side="right">
    <span class="card-notch" aria-hidden="true"></span><div class="card-body">${advantages.map((a,i)=>`<article class="strength ${i===active?'is-active':''}" data-strength="${i}" aria-labelledby="title-${i}">
      <div class="card-label card-reveal"><span class="color-dot" style="--dot-color:${COLORS[i]}"></span><span><span class="card-number">0${i+1}</span>　${esc(a.category)}</span></div>
      <h2 class="card-reveal" id="title-${i}">${esc(a.title)}</h2><p class="claim card-reveal">${esc(a.claim)}</p>
      <ul class="proofs card-reveal">${a.proofs.slice(0,2).map((p,n)=>`<li ${n===1?`class="extra-proof" id="proof-${i}"`:''}>${esc(p)}</li>`).join('')}</ul>
      <div class="card-actions card-reveal"><a class="proof-link" href="${esc(a.link.href)}" ${a.link.href.startsWith('https:')?'target="_blank" rel="noopener noreferrer"':''}>${esc(a.link.label.replace(/\s*↗$/,''))} <span>↗</span></a>${a.proofs.length>1?`<button class="expand-proof" aria-expanded="false" aria-controls="proof-${i}">展开 <span>＋</span></button>`:''}</div>
    </article>`).join('')}</div>
    <nav class="mobile-directory" aria-label="选择角度">${advantages.map((a,i)=>`<button class="mobile-tab ${i===active?'is-active':''}" data-index="${i}" aria-label="${esc(a.category)}" aria-pressed="${i===active}"><span></span></button>`).join('')}</nav>
  </section>
  <div class="navigation"><p class="interaction-hint">左右拖动光环，换个角度看我 <span>↔</span></p><nav class="directory" aria-label="优点目录">${advantages.map((a,i)=>`<button class="directory-item ${i===active?'is-active':''}" data-index="${i}" aria-pressed="${i===active}">${esc(a.category)}</button>`).join('')}</nav></div>
  <p class="fallback-status" hidden>已为你切换到静帧展示 · <button id="retry-3d">重试 3D</button></p>
  <p class="sr-only" id="announcement" aria-live="polite" aria-atomic="true"></p>
</main>
<dialog id="detail-dialog" aria-labelledby="dialog-title"><header class="dialog-header"><span>关于这个作品</span><button id="close-dialog" aria-label="关闭说明">关闭 ×</button></header><div id="dialog-content"></div></dialog>`;

const stage=document.querySelector('#stage'),canvas=document.querySelector('#scene');
const card=document.querySelector('.strengths'),panels=[...document.querySelectorAll('.strength')];
const nodes=[...document.querySelectorAll('.node')],dialog=document.querySelector('#detail-dialog');
const connector=document.querySelector('.node-connector path');
const overlap=(a,b,pad=0)=>a&&b&&a.left<b.right+pad&&a.right>b.left-pad&&a.top<b.bottom+pad&&a.bottom>b.top-pad;
const rect=r=>r?{left:r.left??r.x,right:r.right??r.x+r.width,top:r.top??r.y,bottom:r.bottom??r.y+r.height}:null;
function applyActive(index,{announce=true}={}){
  active=wrap(index);if(staticMode||!scene)document.documentElement.style.setProperty('--accent',COLORS[active]);document.body.dataset.angle=active+1;
  document.querySelectorAll('[data-index]').forEach(el=>{const selected=Number(el.dataset.index)===active;el.classList.toggle('is-active',selected);el.setAttribute('aria-pressed',String(selected));});
  panels.forEach((p,i)=>{p.classList.toggle('is-active',i===active);p.classList.remove('is-expanded');p.querySelectorAll('a,button').forEach(el=>el.tabIndex=i===active?0:-1);const b=p.querySelector('.expand-proof');if(b){b.setAttribute('aria-expanded','false');b.innerHTML='展开 <span>＋</span>';}});
  document.querySelectorAll('.poster').forEach((p,i)=>p.classList.toggle('is-current',i===active));
  if(announce)document.querySelector('#announcement').textContent=`角度 ${active+1}，${advantages[active].title}。${advantages[active].claim}`;
  const url=new URL(location.href);url.searchParams.set('angle',active+1);history.replaceState(null,'',url);
}
function noteInput(){firstInput=true;document.body.classList.add('has-interacted');}
function beginMotion(){moving=true;clearTimeout(lineTimer);clearTimeout(cardTimer);clearTimeout(staticTimer);document.body.classList.add('is-moving');document.body.classList.remove('card-open','line-open');}
function settled(data){
  if(data?.index!==undefined&&wrap(data.index)!==active)return;if(pointer?.started)return;
  moving=false;lastSettled=data||lastSettled;if(data?.nodes)positionNodes(data.nodes);document.body.classList.remove('is-moving');layoutCard(lastSettled);
  nodes[active].classList.remove('node-arrive');void nodes[active].offsetWidth;nodes[active].classList.add('node-arrive');
  clearTimeout(lineTimer);lineTimer=setTimeout(()=>document.body.classList.add('line-open'),reducedMotion?0:240);
  clearTimeout(cardTimer);cardTimer=setTimeout(()=>document.body.classList.add('card-open'),reducedMotion?0:360);
}
function select(index,{immediate=false}={}){
  noteInput();const next=wrap(Math.round(index));if(next===active&&!dragged)return;beginMotion();applyActive(next);
  if(staticMode){positionStaticNodes();staticTimer=setTimeout(()=>settled(),reducedMotion?0:260);return;}
  if(reducedMotion&&!immediate){canvas.animate([{opacity:1},{opacity:0},{opacity:1}],{duration:250});setTimeout(()=>scene?.setStation(active,{immediate:true}),125);}else scene?.setStation(active,{immediate});
  if(!scene)layoutCard();
}
function positionNodes(positions){
  if(staticMode&&!positions.static)return;lastPositions=positions;
  positions.forEach((p,i)=>{const el=nodes[i];if(!el)return;el.style.transform=`translate(${p.x}px,${p.y}px)`;el.classList.toggle('is-occluded',!p.visible);el.tabIndex=p.visible?0:-1;el.setAttribute('aria-hidden',String(!p.visible));});
  if(pointer?.started){
    let nearest=positions.reduce((best,p,i)=>p.visible&&(!positions[best]?.visible||p.depth<positions[best].depth)?i:best,active);
    if(!Number.isFinite(positions[nearest]?.depth))nearest=wrap(Math.round(pointer.progress));const p=positions[nearest];
    if(p){const label=document.querySelector('#drag-label');label.textContent=`0${nearest+1} ${advantages[nearest].category}`;label.style.left=`${clamp(p.x,95,stage.clientWidth-95)}px`;label.style.top=`${p.y-38}px`;}
  }
  if(mobile())updateMobileConnection();
}
function updateMobileConnection(){
  const p=lastPositions[pointer?.started?wrap(Math.round(pointer.progress)):active];if(!p)return;
  const sr=stage.getBoundingClientRect(),cr=card.getBoundingClientRect(),x=clamp(p.x,20,stage.clientWidth-20);
  card.style.setProperty('--notch-x',`${x}px`);connector.setAttribute('d',`M ${x} ${p.y+11} V ${cr.top-sr.top-7}`);
}
function layoutCard(data){
  if(mobile()){card.style.removeProperty('left');card.style.removeProperty('top');card.style.removeProperty('width');delete card.dataset.nodeDistance;delete card.dataset.overlapsProtected;updateMobileConnection();return;}
  const w=stage.clientWidth,h=stage.clientHeight,p=data?.nodes?.[active]||lastPositions[active]||{x:w*.61,y:h*.51};
  const side=active===3?'left':'right';card.dataset.side=side;
  const frame=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame'))||32;
  let cw=w<1120?300:340,x=side==='right'?p.x+28:p.x-cw-28;
  if(x<frame||x+cw>w-frame){cw=300;x=side==='right'?p.x+28:p.x-cw-28;}
  x=clamp(x,frame,w-frame-cw);card.style.width=`${cw}px`;
  const ch=panels[active].getBoundingClientRect().height+24,tagOffset=23;
  let y=clamp(p.y-tagOffset,150,h-ch-85);
  const obstacles=[data?.faceBounds,...(Array.isArray(data?.handBounds)?data.handBounds:[data?.handBounds])].map(rect).filter(Boolean);
  const safe=[y,y+12,y-12,y+20,y-20].filter(v=>v>=150&&v+ch<h-70).find(v=>!obstacles.some(r=>overlap({left:x,right:x+cw,top:v,bottom:v+ch},r,8)));
  if(safe!==undefined)y=safe;
  card.style.left=`${x}px`;card.style.top=`${y}px`;
  const endpoint=side==='right'?x:x+cw,labelY=y+tagOffset;
  connector.setAttribute('d',`M ${p.x+(side==='right'?8:-8)} ${p.y} L ${endpoint} ${labelY}`);
  card.dataset.nodeDistance=String(Math.hypot(endpoint-p.x,labelY-p.y));
  card.dataset.overlapsProtected=String(obstacles.some(r=>overlap({left:x,right:x+cw,top:y,bottom:y+ch},r,3)));
}
function positionStaticNodes(){
  const variant=mobile()?'mobile':'desktop',w=stage.clientWidth,h=stage.clientHeight;
  document.querySelectorAll('.poster').forEach((img,i)=>{const src=framePath(i,variant);if(img.getAttribute('src')!==src)img.src=src;});
  const frame=frameMetadata?.[variant]?.[active];
  if(frame){const s=Math.min(w/frame.width,h/frame.height),ox=(w-frame.width*s)/2,oy=(h-frame.height*s)/2;const p=frame.nodes.map(n=>({...n,x:n.x*s+ox,y:n.y*s+oy}));const scaleBox=b=>b?{left:b.left*s+ox,right:b.right*s+ox,top:b.top*s+oy,bottom:b.bottom*s+oy}:null;p.static=true;positionNodes(p);lastSettled={index:active,nodes:p,faceBounds:scaleBox(frame.faceBounds),handBounds:frame.handBounds?.map(scaleBox)};layoutCard(lastSettled);return;}
  const p=advantages.map((_,i)=>i===active?{x:w*(active===3?.42:.6),y:h*.53,visible:true,depth:1}:{x:w*(i%2?.2:.8),y:h*.45,visible:i!==wrap(active+2),depth:3});p.static=true;positionNodes(p);layoutCard({index:active,nodes:p});
}

document.querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>{if(!dragged)select(Number(b.dataset.index));}));
nodes.forEach((node,i)=>{node.addEventListener('pointerenter',()=>scene?.hoverNode?.(i));node.addEventListener('pointerleave',()=>scene?.hoverNode?.(null));node.addEventListener('focus',()=>scene?.hoverNode?.(i));node.addEventListener('blur',()=>scene?.hoverNode?.(null));});
document.querySelectorAll('.expand-proof').forEach(b=>b.addEventListener('click',()=>{const expand=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(expand));b.innerHTML=expand?'收起 <span>−</span>':'展开 <span>＋</span>';b.closest('.strength').classList.toggle('is-expanded',expand);}));
document.addEventListener('keydown',event=>{if(dialog.open||event.altKey||event.ctrlKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(['ArrowLeft','ArrowRight','1','2','3','4'].includes(event.key)){event.preventDefault();select(event.key==='ArrowLeft'?active-1:event.key==='ArrowRight'?active+1:Number(event.key)-1);}});
function startDrag(e){if(e.button!==0||e.target.closest('a,.mobile-directory,.expand-proof'))return;pointer={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastTime:performance.now(),velocity:0,origin:active,progress:active,started:false};dragged=false;}
function moveDrag(e){
  const r=stage.getBoundingClientRect();if(e.pointerType==='mouse')scene?.setPointer?.((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);
  if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.startX,dy=e.clientY-pointer.startY;
  if(!pointer.started&&Math.abs(dy)>Math.abs(dx)+8){pointer=null;return;}
  if(!pointer.started&&Math.abs(dx)>6){
    // 接管正在移动的镜头时，从这一帧的位置开始，避免跳到目标站。
    pointer.origin=!staticMode&&!reducedMotion&&scene?scene.getState().currentProgress:active;
    pointer.originIndex=Math.round(pointer.origin);pointer.anchorX=e.clientX;
    pointer.started=true;dragged=true;noteInput();beginMotion();document.body.classList.add('is-dragging');e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  if(!pointer.started)return;const now=performance.now();pointer.velocity=(e.clientX-pointer.lastX)/Math.max(8,now-pointer.lastTime)*1000;pointer.lastX=e.clientX;pointer.lastTime=now;
  pointer.progress=pointer.origin-(e.clientX-pointer.anchorX)/(stage.clientWidth*(mobile()?.55:.3));if(!reducedMotion)scene?.setDragProgress(pointer.progress);
  if(staticMode){const n=wrap(Math.round(pointer.progress));if(n!==active){applyActive(n,{announce:false});positionStaticNodes();}}
}
function endDrag(e){
  if(!pointer||e.pointerId!==pointer.id)return;
  if(pointer.started){const fresh=performance.now()-pointer.lastTime<100;select(fresh&&Math.abs(pointer.velocity)>400?pointer.originIndex+(pointer.velocity<0?1:-1):Math.round(pointer.progress));}
  else if(e.currentTarget===stage&&!e.target.closest('button')){const r=stage.getBoundingClientRect();scene?.reactAt?.(e.clientX-r.left,e.clientY-r.top);}
  pointer=null;document.body.classList.remove('is-dragging');setTimeout(()=>dragged=false,0);
}
[stage,card].forEach(el=>{el.addEventListener('pointerdown',startDrag);el.addEventListener('pointermove',moveDrag);el.addEventListener('pointerup',endDrag);el.addEventListener('pointercancel',()=>{pointer=null;dragged=false;document.body.classList.remove('is-dragging');scene?.setStation(active);if(staticMode)settled();});});
stage.addEventListener('wheel',e=>{if(dialog.open||e.ctrlKey)return;e.preventDefault();const now=performance.now();if(now-wheelLast>160){wheelAmount=0;wheelUsed=false;}wheelLast=now;if(wheelUsed)return;wheelAmount+=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*(e.deltaMode===1?16:1);if(Math.abs(wheelAmount)>48){select(active+Math.sign(wheelAmount));wheelUsed=true;}},{passive:false});

async function bootScene(){
  if(staticMode){enableStatic('requested');return;}controller?.abort();controller=new AbortController();const own=++generation;
  try{const {createScene}=await import('./scene.js');if(own!==generation)return;
    const created=await createScene({canvas,reducedMotion,signal:controller.signal,
      onNodePositions:p=>{if(own===generation)positionNodes(p);},onColorChange:c=>{if(own===generation)document.documentElement.style.setProperty('--accent',c);},onSettled:d=>{if(own===generation)settled(d);},
      onFramingChange:d=>{if(own===generation&&!moving){lastSettled=d;layoutCard(d);}},
      onReady:()=>{if(own===generation){document.body.classList.add('scene-ready');document.body.classList.remove('scene-loading');}},onError:()=>{if(own===generation)enableStatic('unavailable');},onPerformanceFallback:()=>{if(own===generation)enableStatic('performance');}});
    if(own!==generation||staticMode){created?.dispose();return;}scene=created;scene?.setStation(active,{immediate:reducedMotion||firstInput||active!==0});
  }catch(error){if(own===generation){console.warn('3D 展示暂不可用，已启用静帧。',error);enableStatic('unavailable');}}
}
function syncModeButton(){const b=document.querySelector('#mode-toggle');if(b){b.textContent=staticMode?'启用 3D 展示':'切换到静帧展示';b.setAttribute('aria-pressed',String(staticMode));}}
function enableStatic(reason='requested'){++generation;controller?.abort();scene?.dispose();scene=null;staticMode=true;document.documentElement.style.setProperty('--accent',COLORS[active]);document.body.classList.add('static-mode','scene-ready');document.body.classList.remove('scene-loading');document.querySelector('.fallback-status').hidden=!['performance','unavailable'].includes(reason);positionStaticNodes();settled();syncModeButton();}
function retry3D(){staticMode=false;document.body.classList.remove('static-mode','scene-ready');document.body.classList.add('scene-loading');document.querySelector('.fallback-status').hidden=true;bootScene();syncModeButton();}
document.querySelector('#retry-3d').addEventListener('click',retry3D);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{reducedMotion=e.matches;controller?.abort();scene?.dispose();scene=null;if(!staticMode)bootScene();});
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(staticMode){positionStaticNodes();settled();}else{layoutCard(lastSettled);scene?.resize();}},120);});
setupDialogs({profile,availability,getStatic:()=>staticMode,toggleMode:()=>staticMode?retry3D():enableStatic('requested')});
applyActive(active,{announce:false});positionStaticNodes();document.body.classList.add('scene-loading','card-open');
fetch(`${IMAGE_ROOT}/frames.json`).then(r=>r.ok?r.json():null).then(d=>{frameMetadata=d;if(staticMode){positionStaticNodes();settled();}}).catch(()=>{});
bootScene();setTimeout(()=>document.body.classList.add('show-poster'),1500);setTimeout(()=>document.body.classList.add('show-directory'),6500);
if(import.meta.env.DEV)window.__WHYME__={getScene:()=>scene,select,getActive:()=>active,getLayout:()=>({moving,staticMode,active,lastSettled,lastPositions,nodeDistance:card.dataset.nodeDistance,overlapsProtected:card.dataset.overlapsProtected}),settled};

