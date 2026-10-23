/** Independent measurements of the incoming, unedited waiting clip. Not an acceptance report. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHoodieSkinning } from '../../src/hoodie-skinning.js';
import { HOODIE_WEIGHT_ROWS } from '../../src/hoodie-skinning-data.js';
const root = new URL('../../', import.meta.url), file = '动作素材/human+character+3d+model+dengdai.glb';
const bytes = await readFile(new URL(file, root)), hash = b => createHash('sha256').update(b).digest('hex');
const loader = new GLTFLoader();
loader.register(() => ({ name:'HEADLESS_TEXTURE', loadTexture:()=>Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const bones = new Map(); let mesh;
gltf.scene.traverse(o=>{if(o.isBone)bones.set(o.name.replace(/^mixamorig[:_]?/i,''),o);if(o.isSkinnedMesh)mesh=o;});
mesh.geometry.computeBoundingBox(); const height = mesh.geometry.boundingBox.max.y-mesh.geometry.boundingBox.min.y;
const mm = 1830 / height, geometry = mesh.geometry, index = geometry.index;
const jointNames = mesh.skeleton.bones.map(b=>b.name.replace(/^mixamorig[:_]?/i,''));
const positions = Array.from({length:geometry.attributes.position.count},(_,id)=>new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,id).toArray());
const dominantJoint=positions.map((_,id)=>{let slot=0;for(let i=1;i<4;i++)if(geometry.attributes.skinWeight.array[id*4+i]>geometry.attributes.skinWeight.array[id*4+slot])slot=i;return jointNames[geometry.attributes.skinIndex.array[id*4+slot]];});
const weights = (id,predicate) => {let total=0;for(let slot=0;slot<4;slot++)if(predicate(jointNames[geometry.attributes.skinIndex.array[id*4+slot]]))total+=geometry.attributes.skinWeight.array[id*4+slot];return total;};
const cords=new Set(HOODIE_WEIGHT_ROWS.map(row=>row[0])),left=[],right=[],body=[],chest=[],subset=new Set(cords);
for(let id=0;id<positions.length;id++) {
  if(weights(id,n=>n.startsWith('LeftHand'))>=.7){left.push(id);subset.add(id);}
  if(weights(id,n=>n.startsWith('RightHand'))>=.7){right.push(id);subset.add(id);}
}
for(let i=0;i<index.count;i+=3){
 const ids=[0,1,2].map(k=>index.getX(i+k)), p=ids.map(id=>positions[id]),center=[0,1,2].map(axis=>p.reduce((s,v)=>s+v[axis],0)/3);
 if(!ids.some(id=>cords.has(id))&&Math.abs(center[0])<=.12&&center[1]>=.60&&center[1]<=.82&&center[2]>=.005){chest.push(ids);ids.forEach(id=>subset.add(id));}
 if(center[1]>=.25&&center[1]<=.72&&ids.every(id=>weights(id,n=>/^(Hips|Spine\d*|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg)$/.test(n))>=.7)){body.push(ids);ids.forEach(id=>subset.add(id));}
}
applyHoodieSkinning(mesh);
const empty=()=>({minimumGapMM:Infinity,penetratingSamples:0,samples:0,missing:0,worst:null});
function depth(values,ids,triangles,axes,depthAxis,minimum,result,time){
 const [u,v]=axes,ts=triangles.map(ids=>{const [a,b,c]=ids.map(id=>values.get(id));return {a,b,c,den:(b[v]-c[v])*(a[u]-c[u])+(c[u]-b[u])*(a[v]-c[v]),minU:Math.min(a[u],b[u],c[u]),maxU:Math.max(a[u],b[u],c[u]),minV:Math.min(a[v],b[v],c[v]),maxV:Math.max(a[v],b[v],c[v])};});
 for(const id of ids){const p=values.get(id);let surface=minimum?Infinity:-Infinity;
  for(const t of ts){if(Math.abs(t.den)<1e-10||p[u]<t.minU-1e-7||p[u]>t.maxU+1e-7||p[v]<t.minV-1e-7||p[v]>t.maxV+1e-7)continue;
   const {a,b,c,den}=t,w0=((b[v]-c[v])*(p[u]-c[u])+(c[u]-b[u])*(p[v]-c[v]))/den,w1=((c[v]-a[v])*(p[u]-c[u])+(a[u]-c[u])*(p[v]-c[v]))/den,w2=1-w0-w1;
   if(Math.min(w0,w1,w2)<-1e-6)continue;const d=a[depthAxis]*w0+b[depthAxis]*w1+c[depthAxis]*w2;surface=minimum?Math.min(surface,d):Math.max(surface,d);
  }
  if(!Number.isFinite(surface)){result.missing++;continue;}const gap=(minimum?surface-p[depthAxis]:p[depthAxis]-surface)*mm;
  if(gap<result.minimumGapMM){result.minimumGapMM=gap;result.worst={time,vertex:id};}if(gap<-.1)result.penetratingSamples++;result.samples++;
  if(/Hand/.test(dominantJoint[id])){result.byJoint??={};const j=result.byJoint[dominantJoint[id]]??={minimumGapMM:Infinity,negativeSamples:0,worst:null};if(gap<j.minimumGapMM){j.minimumGapMM=gap;j.worst={time,vertex:id};}if(gap<-.1)j.negativeSamples++;}
 }
}
const clip=gltf.animations[0], tracks=clip.tracks.map(t=>({binding:THREE.PropertyBinding.parseTrackName(t.name),interpolant:t.createInterpolant()}));
function sample(time){for(const {binding,interpolant} of tracks){const b=bones.get(binding.nodeName.replace(/^mixamorig[:_]?/i,''));b[binding.propertyName].fromArray(interpolant.evaluate(time));}gltf.scene.updateMatrixWorld(true);}
function snapshots(){return Object.fromEntries([...bones].map(([name,b])=>[name,{world:b.getWorldPosition(new THREE.Vector3()).toArray(),q:b.quaternion.toArray()}]));}
const report={generatedAt:new Date().toISOString(),source:file,sha256:hash(bytes),sourceSHA256:hash(bytes),clip:clip.name,duration:clip.duration,bones:bones.size,vertices:positions.length,triangles:index.count/3,frames:0,left:empty(),right:empty(),cords:empty(),pelvisRanges:{x:[Infinity,-Infinity],y:[Infinity,-Infinity],z:[Infinity,-Infinity]},forwardLeanDegrees:[Infinity,-Infinity],endpoints:null};
sample(0);const first=snapshots(),tmp=new THREE.Vector3();
for(let frame=0;frame<=Math.ceil(clip.duration*60);frame++){
 const time=Math.min(clip.duration,frame/60);sample(time);const values=new Map([...subset].map(id=>[id,mesh.getVertexPosition(id,tmp).toArray()]));
 depth(values,left,body,[1,2],0,false,report.left,time);depth(values,right,body,[1,2],0,true,report.right,time);depth(values,cords,chest,[0,1],2,false,report.cords,time);
 const hips=bones.get('Hips').getWorldPosition(new THREE.Vector3()),neck=bones.get('Neck').getWorldPosition(new THREE.Vector3()),direction=neck.clone().sub(hips),lean=THREE.MathUtils.radToDeg(Math.atan2(direction.z,direction.y));
 report.forwardLeanDegrees[0]=Math.min(report.forwardLeanDegrees[0],lean);report.forwardLeanDegrees[1]=Math.max(report.forwardLeanDegrees[1],lean);
 for(const axis of ['x','y','z']){report.pelvisRanges[axis][0]=Math.min(report.pelvisRanges[axis][0],hips[axis]*mm);report.pelvisRanges[axis][1]=Math.max(report.pelvisRanges[axis][1],hips[axis]*mm);}report.frames++;
}
sample(clip.duration);const last=snapshots();report.endpoints={maximumPositionDifferenceMM:0,maximumLocalRotationDegrees:0};
for(const name of bones.keys()){
 report.endpoints.maximumPositionDifferenceMM=Math.max(report.endpoints.maximumPositionDifferenceMM,new THREE.Vector3().fromArray(first[name].world).distanceTo(new THREE.Vector3().fromArray(last[name].world))*mm);
 report.endpoints.maximumLocalRotationDegrees=Math.max(report.endpoints.maximumLocalRotationDegrees,THREE.MathUtils.radToDeg(new THREE.Quaternion().fromArray(first[name].q).angleTo(new THREE.Quaternion().fromArray(last[name].q))));
}
for(const side of ['left','right']){
 for(const target of [report[side],...Object.values(report[side].byJoint)]){
 const worst=target.worst;sample(worst.time);const values=new Map([...subset].map(id=>[id,mesh.getVertexPosition(id,tmp).toArray()])),point=new THREE.Vector3().fromArray(values.get(worst.vertex));
 let minimum=Infinity,nearest=null;const hits=[],ray=new THREE.Ray(point,new THREE.Vector3(1,0,0)),intersection=new THREE.Vector3();
 for(const ids of body){const vs=ids.map(id=>new THREE.Vector3().fromArray(values.get(id))),triangle=new THREE.Triangle(...vs),closest=triangle.closestPointToPoint(point,new THREE.Vector3()),distance=point.distanceTo(closest);
  if(distance<minimum){minimum=distance;nearest={triangle:ids,distanceMM:distance*mm,signedDistanceMM:point.clone().sub(closest).dot(triangle.getNormal(new THREE.Vector3()))*mm};}
  if(ray.intersectTriangle(...vs,false,intersection)){const d=point.distanceTo(intersection);if(d>1e-8&&!hits.some(v=>Math.abs(v-d)<1e-6))hits.push(d);}
 }
 target.worst3D={...worst,position:point.toArray(),nearest,positiveXRayIntersections:hits.length,insideByOddParity:hits.length%2===1};
 }
}
const parityGLTF=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let parityMesh;
parityGLTF.scene.traverse(o=>{if(o.isSkinnedMesh)parityMesh=o;});applyHoodieSkinning(parityMesh);
const mixer=new THREE.AnimationMixer(parityGLTF.scene),action=mixer.clipAction(parityGLTF.animations[0]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
report.animationMixerParity={maximumVertexErrorMM:0};
for(const side of ['left','right']){const worst=report[side].worst;mixer.setTime(worst.time);parityGLTF.scene.updateMatrixWorld(true);const actual=parityMesh.getVertexPosition(worst.vertex,new THREE.Vector3());report.animationMixerParity.maximumVertexErrorMM=Math.max(report.animationMixerParity.maximumVertexErrorMM,actual.distanceTo(new THREE.Vector3().fromArray(report[side].worst3D.position))*mm);}
report.method='Source clip independently loaded with Three.GLTFLoader, 60 Hz sampling with current approved drawstring skinning patch. Directional hand/body and cord/front-chest measurements use actual deformed mesh vertices. Units normalized to 1.83 m character.';
report.limitations='Risk diagnostics only, not edited-asset acceptance. Body subset includes waist and upper legs, is open and uncapped, and is not limited to the camera-facing surface. Negative directional gaps and nearest-triangle normal projections are contact-risk diagnostics, not certified closed-volume penetration depths. Ray parity against this open subset does not prove inside/outside status. Missing projections are unmeasured, not positive clearance. Finger/sleeve and arbitrary mesh self intersections require visual or broader geometry review.';
await writeFile(new URL('./source-risk-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
