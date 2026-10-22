/** Exercise the actual supplied animation samples without a rendering context. */
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { fileURLToPath } from 'node:url';
import { createCharacterMotion, STATION_CLIPS, WALK_STATION } from '../src/motion.js';

const NOD_STATION = STATION_CLIPS.indexOf('Nod'), IDLE_STATION = STATION_CLIPS.indexOf('Idle'), WAVE_STATION = STATION_CLIPS.indexOf('Wave');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const document = await io.read(fileURLToPath(new URL('../public/models/person-animated.glb',import.meta.url)));
function rig({reducedMotion=false,yaw=0,scale=1}={}) {
  const model = new THREE.Group(), outer = new THREE.Group(), mapping = new Map(), bones = new Map();
  outer.rotation.y = yaw; outer.scale.setScalar(scale); outer.add(model);
  const joints = new Set(document.getRoot().listSkins().flatMap(skin=>skin.listJoints()));
  for (const node of document.getRoot().listNodes()) {
    const object = joints.has(node) ? new THREE.Bone() : new THREE.Group(); object.name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
    object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale()); mapping.set(node,object);
    if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i,''),{bone:object,rest:object.quaternion.clone()});
  }
  for (const [node,object] of mapping) for (const child of node.listChildren()) object.add(mapping.get(child));
  for (const root of document.getRoot().listScenes()[0].listChildren()) model.add(mapping.get(root));
  const animations = document.getRoot().listAnimations().map(animation=>new THREE.AnimationClip(animation.getName(),-1,animation.listChannels().map(channel=>{
    const property = {translation:'position',rotation:'quaternion',scale:'scale'}[channel.getTargetPath()];
    const Track = property==='quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${mapping.get(channel.getTargetNode()).name}.${property}`,channel.getSampler().getInput().getArray().slice(),channel.getSampler().getOutput().getArray().slice());
  })));
  outer.updateMatrixWorld(true);
  return {motion:createCharacterMotion({model,animations,bones,reducedMotion}),bones,model,outer,animations};
}
const reports = [], check=(name,test)=>{test();reports.push({name,passed:true});};
const tick=(context,seconds,options={})=>{for(let i=0;i<Math.round(seconds*120);i++) {context.motion.update(1/120,options);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}};
const sample = rig(), unchanged = sample.animations.map(clip=>clip.tracks.map(track=>Array.from(track.values)));
check('reviewed-station-map',()=>{assert.deepEqual(STATION_CLIPS,['Walk','Nod','Idle','Wave']);assert.equal(WALK_STATION,0);assert.equal(Object.isFrozen(STATION_CLIPS),true);});
for (let station=0;station<STATION_CLIPS.length;station++) {
  sample.motion.setStation(station);
  check(`station-${station+1}-uses-reviewed-action`,()=>assert.equal(sample.motion.getState().action,STATION_CLIPS[station]));
  tick(sample,7);
  check(`station-${station+1}-settles-to-idle`,()=>{assert.equal(sample.motion.getState().action,'Idle');assert.equal(sample.motion.getState().end,true);assert.equal(sample.motion.getState().walking,false);});
  check(`station-${station+1}-hips-horizontal-rest`,()=>{const [x,z]=sample.motion.getState().rootMotion.horizontalRest;assert.ok(Math.abs(sample.bones.get('Hips').bone.position.x-x)<1e-7);assert.ok(Math.abs(sample.bones.get('Hips').bone.position.z-z)<1e-7);});
}
check('source-animation-arrays-preserved',()=>sample.animations.forEach((clip,c)=>clip.tracks.forEach((track,t)=>assert.deepEqual(Array.from(track.values),unchanged[c][t]))));
check('boxing-never-bound',()=>assert.ok(!sample.motion.getState().clips.includes('Box')));
check('large-greet-never-bound-or-played',()=>{const state=sample.motion.getState();assert.ok(!state.clips.includes('Greet'));assert.ok(state.rejected.includes('Greet'));assert.ok(state.transitions.every(t=>t.to!=='Greet'&&!t.from.includes('Greet')));});
const walk = rig(); walk.motion.setStation(WALK_STATION,{immediate:true}); tick(walk,5.8); const end = walk.motion.position.clone();
check('walk-travels-in-world-metres',()=>{assert.ok(end.z>7&&end.z<7.7,`z=${end.z}`);assert.ok(end.x>.2&&end.x<.6);});
tick(walk,12);
check('walk-holds-position-after-finish',()=>assert.ok(walk.motion.position.distanceTo(end)<1e-10));
walk.motion.setStation(NOD_STATION);tick(walk,4);
check('station-switch-preserves-travel',()=>assert.ok(walk.motion.position.distanceTo(end)<1e-10));
const interrupted = rig(); interrupted.motion.setStation(WALK_STATION);tick(interrupted,2);const partial=interrupted.motion.position.clone();interrupted.motion.setStation(NOD_STATION);tick(interrupted,5);
check('interrupted-walk-keeps-current-position',()=>{assert.ok(partial.z>1);assert.ok(interrupted.motion.position.distanceTo(partial)<1e-10);});
const paused = rig();paused.motion.setStation(WALK_STATION);tick(paused,1);const frozen=paused.motion.getState();tick(paused,2,{dragging:true});
check('dragging-freezes-action-and-root-motion',()=>{assert.equal(paused.motion.getState().time,frozen.time);assert.deepEqual(paused.motion.getState().position,frozen.position);});
const rotated = rig({yaw:Math.PI/2,scale:2});rotated.motion.setStation(WALK_STATION,{immediate:true});tick(rotated,5.8);
check('root-motion-includes-parent-scale-and-rotation',()=>{assert.ok(Math.abs(rotated.motion.position.x-end.z*2)<1e-5);assert.ok(Math.abs(rotated.motion.position.z+end.x*2)<1e-5);});
const reduced = rig({reducedMotion:true}), rest = [...reduced.bones].map(([name,{bone}])=>[name,bone.position.clone(),bone.quaternion.clone(),bone.scale.clone()]);
for (let station=0;station<STATION_CLIPS.length;station++){reduced.motion.setStation(station);tick(reduced,3);}
check('reduced-motion-keeps-original-rest-pose',()=>{assert.deepEqual(reduced.motion.position.toArray(),[0,0,0]);for(const [name,position,quaternion,scale]of rest){const bone=reduced.bones.get(name).bone;assert.ok(bone.position.equals(position));assert.ok(bone.quaternion.equals(quaternion));assert.ok(bone.scale.equals(scale));}});
const rapid = rig();for(let i=0;i<40;i++){rapid.motion.setStation(i%STATION_CLIPS.length);tick(rapid,.12);}tick(rapid,7);
check('rapid-switches-retire-fading-actions',()=>{assert.equal(rapid.motion.getState().weights.length,1);assert.equal(rapid.motion.getState().action,'Idle');assert.ok(rapid.motion.getState().weights.every(w=>Number.isFinite(w.weight)));});
const reaction=rig();reaction.motion.setStation(WALK_STATION);tick(reaction,7);const reactionPosition=reaction.motion.position.clone();
check('walk-station-click-uses-nod-not-more-travel',()=>{assert.equal(reaction.motion.react(),true);assert.equal(reaction.motion.getState().action,'Nod');});tick(reaction,4);
check('reaction-keeps-travel',()=>assert.ok(reaction.motion.position.distanceTo(reactionPosition)<1e-10));
const ending = rig(), endingSamples=[];ending.motion.setStation(WALK_STATION,{immediate:true});
let previousPosition=ending.motion.position.clone(), previousBones=null, maxEndingBoneStep=0, maxWeightError=0;
for(let frame=1;frame<=Math.round(5.6*240);frame++){
  ending.motion.update(1/240);ending.outer.position.copy(ending.motion.position);ending.outer.updateMatrixWorld(true);
  const state=ending.motion.getState(), time=frame/240, speed=ending.motion.position.distanceTo(previousPosition)*240;
  const currentBones=[...ending.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3()).sub(ending.motion.position));
  if(time>4.4&&previousBones)maxEndingBoneStep=Math.max(maxEndingBoneStep,...currentBones.map((p,i)=>p.distanceTo(previousBones[i])));
  maxWeightError=Math.max(maxWeightError,Math.abs(state.weights.reduce((sum,w)=>sum+w.weight,0)-1));
  if([4.45,4.7,4.9,4.99,5.02,5.2].some(at=>Math.abs(time-at)<1/480))endingSamples.push({time,speed,position:state.position,weights:state.weights});
  previousPosition.copy(ending.motion.position);previousBones=currentBones;
}
check('walk-ending-fades-to-zero-speed',()=>{assert.ok(endingSamples.find(s=>s.time>4.98&&s.time<5).speed<.02);assert.equal(endingSamples.find(s=>s.time>5).speed,0);});
check('walk-ending-has-no-bone-position-pop',()=>assert.ok(maxEndingBoneStep<.02,`240 Hz step ${maxEndingBoneStep} m`));
check('crossfade-weights-stay-normalized',()=>assert.ok(maxWeightError<.00011,`weight error ${maxWeightError}`));
const longIdle=rig();longIdle.motion.setStation(IDLE_STATION);
const initialIdle=[...longIdle.bones].map(([name,{bone}])=>({name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
tick(longIdle,300);let idlePoseError=0;
for(const saved of initialIdle){const bone=longIdle.bones.get(saved.name).bone;idlePoseError=Math.max(idlePoseError,bone.position.distanceTo(saved.position),bone.quaternion.clone().normalize().angleTo(saved.quaternion.clone().normalize()),bone.scale.distanceTo(saved.scale));}
check('five-minute-idle-has-no-root-drift',()=>assert.equal(longIdle.motion.position.length(),0));
check('five-minute-idle-returns-to-the-same-pose',()=>assert.ok(idlePoseError<1e-5,`pose error ${idlePoseError}`));
check('idle-station-does-not-trigger-repeated-settling',()=>{const state=longIdle.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.transition,null);assert.equal(state.weights.length,1);assert.equal(state.transitions.length,1);});
const idleBeforeClick=longIdle.motion.getState();
check('idle-station-click-does-not-add-a-reaction',()=>{assert.equal(longIdle.motion.react(),false);assert.deepEqual(longIdle.motion.getState(),idleBeforeClick);});
check('reselecting-idle-does-not-reset-its-phase',()=>{assert.equal(longIdle.motion.setStation(IDLE_STATION),false);assert.deepEqual(longIdle.motion.getState(),idleBeforeClick);});
longIdle.motion.setStation(NOD_STATION);tick(longIdle,4);const beforeReentry=longIdle.motion.getState();longIdle.motion.setStation(IDLE_STATION);
check('reentering-idle-reuses-the-existing-loop',()=>{const state=longIdle.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.time,beforeReentry.time);assert.equal(state.transitions.length,beforeReentry.transitions.length);assert.equal(state.end,true);});
tick(longIdle,30);
check('idle-remains-stable-after-reentry',()=>{const state=longIdle.motion.getState();assert.equal(state.weights.length,1);assert.equal(state.transition,null);assert.equal(state.action,'Idle');assert.equal(state.transitions.length,beforeReentry.transitions.length);});
const fadeInterrupt=rig();fadeInterrupt.motion.setStation(WALK_STATION);tick(fadeInterrupt,4.75);const atFade=fadeInterrupt.motion.position.clone();fadeInterrupt.motion.setStation(WAVE_STATION);tick(fadeInterrupt,5);
check('switching-during-walk-settle-preserves-position',()=>assert.ok(fadeInterrupt.motion.position.distanceTo(atFade)<1e-10));
const frameRates=[];
for(const fps of[20,30,60,120]){
  const context=rig();context.motion.setStation(WALK_STATION,{immediate:true});for(let frame=0;frame<fps*6;frame++){context.motion.update(1/fps);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}
  frameRates.push({fps,position:context.motion.position.toArray(),action:context.motion.getState().action});context.motion.dispose();
}
check('walk-settles-at-20-through-120-fps',()=>{assert.ok(frameRates.every(r=>r.action==='Idle'));assert.ok(Math.max(...frameRates.map(r=>r.position[2]))-Math.min(...frameRates.map(r=>r.position[2]))<.001);});
for(const context of[sample,walk,interrupted,paused,rotated,reduced,rapid,reaction,ending,longIdle,fadeInterrupt])context.motion.dispose();
const result={checks:reports,stationClips:STATION_CLIPS,walkStation:WALK_STATION,walkWorldEnd:end.toArray(),interruptedWorldEnd:partial.toArray(),endingSamples,maxEndingBoneStep,maxWeightError,idlePoseError,frameRates,notes:'Actual GLB animation arrays used. No browser rendering asserted by this test.'};
await mkdir(new URL('../qa/tripo/',import.meta.url),{recursive:true});await writeFile(new URL('../qa/tripo/motion-tests.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
