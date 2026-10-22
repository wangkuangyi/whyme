/** Exercise the actual supplied animation samples without a rendering context. */
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { fileURLToPath } from 'node:url';
import { createCharacterMotion, STATION_CLIPS, WALK_STATION } from '../src/motion.js';

const NOD_STATION = STATION_CLIPS.indexOf('Nod'), LOOK_AROUND_STATION = STATION_CLIPS.indexOf('LookAround'), WAVE_STATION = STATION_CLIPS.indexOf('Wave');

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
const finishEntry=(context)=>{const state=context.motion.getState();tick(context,Math.max(0,(state.duration-state.time)/Math.max(state.speed,.001))+.8);};
const savePose=context=>[...context.bones].map(([name,{bone}])=>({name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
const poseError=(context,saved)=>Math.max(...saved.map(value=>{const bone=context.bones.get(value.name).bone;return Math.max(bone.position.distanceTo(value.position),bone.quaternion.clone().normalize().angleTo(value.quaternion.clone().normalize()),bone.scale.distanceTo(value.scale));}));
const sample = rig(), unchanged = sample.animations.map(clip=>clip.tracks.map(track=>Array.from(track.values)));
check('reviewed-station-map',()=>{assert.deepEqual(STATION_CLIPS,['Walk','Nod','LookAround','Wave']);assert.equal(WALK_STATION,0);assert.equal(LOOK_AROUND_STATION,2);assert.equal(Object.isFrozen(STATION_CLIPS),true);});
const suppliedLookAround=sample.animations.find(clip=>clip.name==='LookAround');
check('look-around-exists-in-supplied-glb',()=>{assert.ok(suppliedLookAround);assert.ok(suppliedLookAround.duration>0);assert.ok(suppliedLookAround.tracks.some(track=>/Head.*quaternion/.test(track.name)));assert.ok(suppliedLookAround.tracks.some(track=>/Spine2.*quaternion/.test(track.name)));});
for (let station=0;station<STATION_CLIPS.length;station++) {
  sample.motion.setStation(station);
  check(`station-${station+1}-uses-reviewed-action`,()=>assert.equal(sample.motion.getState().action,STATION_CLIPS[station]));
  finishEntry(sample);
  check(`station-${station+1}-settles-to-idle`,()=>{assert.equal(sample.motion.getState().action,'Idle');assert.equal(sample.motion.getState().end,true);assert.equal(sample.motion.getState().walking,false);});
  check(`station-${station+1}-hips-horizontal-rest`,()=>{const [x,z]=sample.motion.getState().rootMotion.horizontalRest;assert.ok(Math.abs(sample.bones.get('Hips').bone.position.x-x)<1e-7);assert.ok(Math.abs(sample.bones.get('Hips').bone.position.z-z)<1e-7);});
}
check('source-animation-arrays-preserved',()=>sample.animations.forEach((clip,c)=>clip.tracks.forEach((track,t)=>assert.deepEqual(Array.from(track.values),unchanged[c][t]))));
check('boxing-never-bound',()=>assert.ok(!sample.motion.getState().clips.includes('Box')));
check('withdrawn-cross-arms-never-bound-or-played',()=>{const state=sample.motion.getState();assert.ok(!state.clips.includes('CrossArms'));assert.ok(state.transitions.every(t=>t.to!=='CrossArms'&&!t.from.includes('CrossArms')));});
check('large-greet-never-bound-or-played',()=>{const state=sample.motion.getState();assert.ok(!state.clips.includes('Greet'));assert.ok(state.rejected.includes('Greet'));assert.ok(state.transitions.every(t=>t.to!=='Greet'&&!t.from.includes('Greet')));});
const walk = rig(); walk.motion.setStation(WALK_STATION,{immediate:true}); tick(walk,5.8); const end = walk.motion.position.clone();
check('walk-travels-in-world-metres',()=>{assert.ok(end.z>7&&end.z<7.7,`z=${end.z}`);assert.ok(end.x>.2&&end.x<.6);});
tick(walk,12);
check('walk-holds-position-after-finish',()=>assert.ok(walk.motion.position.distanceTo(end)<1e-10));
walk.motion.setStation(NOD_STATION);tick(walk,4);
check('station-switch-preserves-travel',()=>assert.ok(walk.motion.position.distanceTo(end)<1e-10));
walk.motion.setStation(LOOK_AROUND_STATION);tick(walk,.8);
check('entering-look-around-preserves-walk-world-position',()=>{assert.equal(walk.motion.getState().action,'LookAround');assert.ok(walk.motion.position.distanceTo(end)<1e-10);});
finishEntry(walk);
check('look-around-completion-keeps-walk-world-position',()=>{assert.equal(walk.motion.getState().action,'Idle');assert.ok(walk.motion.position.distanceTo(end)<1e-10);});
walk.motion.setStation(WAVE_STATION);finishEntry(walk);
check('leaving-look-around-preserves-walk-world-position',()=>assert.ok(walk.motion.position.distanceTo(end)<1e-10));
const interrupted = rig(); interrupted.motion.setStation(WALK_STATION);tick(interrupted,2);const partial=interrupted.motion.position.clone();interrupted.motion.setStation(NOD_STATION);tick(interrupted,5);
check('interrupted-walk-keeps-current-position',()=>{assert.ok(partial.z>1);assert.ok(interrupted.motion.position.distanceTo(partial)<1e-10);});
const paused = rig();paused.motion.setStation(WALK_STATION);tick(paused,1);const frozen=paused.motion.getState();tick(paused,2,{dragging:true});
check('dragging-freezes-action-and-root-motion',()=>{assert.equal(paused.motion.getState().time,frozen.time);assert.deepEqual(paused.motion.getState().position,frozen.position);});
const rotated = rig({yaw:Math.PI/2,scale:2});rotated.motion.setStation(WALK_STATION,{immediate:true});tick(rotated,5.8);
check('root-motion-includes-parent-scale-and-rotation',()=>{assert.ok(Math.abs(rotated.motion.position.x-end.z*2)<1e-5);assert.ok(Math.abs(rotated.motion.position.z+end.x*2)<1e-5);});
const reduced = rig({reducedMotion:true}), rest = [...reduced.bones].map(([name,{bone}])=>[name,bone.position.clone(),bone.quaternion.clone(),bone.scale.clone()]);
for (let station=0;station<STATION_CLIPS.length;station++){reduced.motion.setStation(station);tick(reduced,3);}
check('reduced-motion-keeps-original-rest-pose',()=>{assert.deepEqual(reduced.motion.position.toArray(),[0,0,0]);for(const [name,position,quaternion,scale]of rest){const bone=reduced.bones.get(name).bone;assert.ok(bone.position.equals(position));assert.ok(bone.quaternion.equals(quaternion));assert.ok(bone.scale.equals(scale));}});
const rapid = rig();for(let i=0;i<40;i++){rapid.motion.setStation(i%STATION_CLIPS.length);tick(rapid,.12);}finishEntry(rapid);
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
const longIdle=rig(), initialIdle=savePose(longIdle);
tick(longIdle,300);const idlePoseError=poseError(longIdle,initialIdle);
check('five-minute-idle-has-no-root-drift',()=>assert.equal(longIdle.motion.position.length(),0));
check('five-minute-idle-returns-to-the-same-pose',()=>assert.ok(idlePoseError<1e-5,`pose error ${idlePoseError}`));
check('initial-idle-does-not-trigger-repeated-settling',()=>{const state=longIdle.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.transition,null);assert.equal(state.weights.length,1);assert.equal(state.transitions.length,1);});
const idleBeforeClick=longIdle.motion.getState();
check('idle-before-any-station-does-not-add-a-reaction',()=>{assert.equal(longIdle.motion.react(),false);assert.deepEqual(longIdle.motion.getState(),idleBeforeClick);});

const lookAround=rig();lookAround.motion.setStation(LOOK_AROUND_STATION,{immediate:true});tick(lookAround,1/120);
const lookAroundStart=lookAround.motion.getState(), lookAroundDuration=lookAroundStart.duration/lookAroundStart.speed;
const turnNames=['Head','Neck','Spine','Spine1','Spine2'];
const firstTurns=turnNames.map(name=>lookAround.bones.get(name).bone.quaternion.clone().normalize());
const turnExcursion=turnNames.map(()=>0);
// Sample only the supplied entry, excluding its final blend into Idle. This
// prevents an idle pose change from masquerading as a genuine looking-around gesture.
const actionSampleSeconds=Math.max(0,lookAroundDuration-.6-1/120);
for(let frame=0;frame<Math.floor(actionSampleSeconds*120);frame++){
  tick(lookAround,1/120);
  turnNames.forEach((name,i)=>{turnExcursion[i]=Math.max(turnExcursion[i],lookAround.bones.get(name).bone.quaternion.clone().normalize().angleTo(firstTurns[i]));});
}
check('look-around-has-real-head-and-chest-turning',()=>{assert.ok(turnExcursion.slice(0,2).some(angle=>angle>.04),`head/neck angles ${turnExcursion.slice(0,2)}`);assert.ok(turnExcursion.slice(2).some(angle=>angle>.01),`chest angles ${turnExcursion.slice(2)}`);});
check('look-around-does-not-introduce-world-travel',()=>assert.equal(lookAround.motion.position.length(),0));
const lookAroundPlaying=lookAround.motion.getState();
check('reselecting-look-around-does-not-restart-entry',()=>{assert.equal(lookAround.motion.setStation(LOOK_AROUND_STATION),false);assert.deepEqual(lookAround.motion.getState(),lookAroundPlaying);});
check('clicking-during-look-around-does-not-interrupt-it',()=>{assert.equal(lookAround.motion.react(),false);assert.deepEqual(lookAround.motion.getState(),lookAroundPlaying);});
finishEntry(lookAround);
check('look-around-plays-once-and-returns-to-idle',()=>{const state=lookAround.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.completedAction,'LookAround');assert.equal(state.end,true);assert.equal(state.transition,null);assert.deepEqual(state.weights.map(weight=>weight.action),['Idle']);});
const postLookAroundIdle=lookAround.motion.getState(), postLookAroundPose=savePose(lookAround);
tick(lookAround,300);const postLookAroundIdlePoseError=poseError(lookAround,postLookAroundPose);
check('five-minute-idle-after-look-around-keeps-pose-and-position',()=>{assert.ok(postLookAroundIdlePoseError<1e-5,`pose error ${postLookAroundIdlePoseError}`);assert.equal(lookAround.motion.position.length(),0);});
check('completed-look-around-does-not-replay-spontaneously',()=>{const state=lookAround.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.weights.length,1);assert.equal(state.transition,null);assert.deepEqual(state.transitions,postLookAroundIdle.transitions);});
const beforeCompletedReselect=lookAround.motion.getState();
check('reselecting-completed-look-around-keeps-idle-phase',()=>{assert.equal(lookAround.motion.setStation(LOOK_AROUND_STATION),false);assert.deepEqual(lookAround.motion.getState(),beforeCompletedReselect);});
check('clicking-after-look-around-replays-the-entry',()=>{assert.equal(lookAround.motion.react(),true);const state=lookAround.motion.getState();assert.equal(state.action,'LookAround');assert.equal(state.time,0);assert.equal(state.end,false);assert.equal(state.transitions.at(-1).reason,'reaction');});
finishEntry(lookAround);
check('look-around-reaction-also-settles-once',()=>{const state=lookAround.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.completedAction,'LookAround');assert.equal(state.end,true);assert.equal(state.weights.length,1);assert.equal(lookAround.motion.position.length(),0);});
const fadeInterrupt=rig();fadeInterrupt.motion.setStation(WALK_STATION);tick(fadeInterrupt,4.75);const atFade=fadeInterrupt.motion.position.clone();fadeInterrupt.motion.setStation(WAVE_STATION);tick(fadeInterrupt,5);
check('switching-during-walk-settle-preserves-position',()=>assert.ok(fadeInterrupt.motion.position.distanceTo(atFade)<1e-10));
const frameRates=[];
for(const fps of[20,30,60,120]){
  const context=rig();context.motion.setStation(WALK_STATION,{immediate:true});for(let frame=0;frame<fps*6;frame++){context.motion.update(1/fps);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}
  frameRates.push({fps,position:context.motion.position.toArray(),action:context.motion.getState().action});context.motion.dispose();
}
check('walk-settles-at-20-through-120-fps',()=>{assert.ok(frameRates.every(r=>r.action==='Idle'));assert.ok(Math.max(...frameRates.map(r=>r.position[2]))-Math.min(...frameRates.map(r=>r.position[2]))<.001);});
for(const context of[sample,walk,interrupted,paused,rotated,reduced,rapid,reaction,ending,longIdle,lookAround,fadeInterrupt])context.motion.dispose();
const result={checks:reports,stationClips:STATION_CLIPS,walkStation:WALK_STATION,lookAround:{station:LOOK_AROUND_STATION,sourceDuration:suppliedLookAround.duration,runtimeDuration:lookAroundStart.duration,speed:lookAroundStart.speed,turnExcursionRadians:Object.fromEntries(turnNames.map((name,i)=>[name,turnExcursion[i]])),postIdlePoseError:postLookAroundIdlePoseError},walkWorldEnd:end.toArray(),interruptedWorldEnd:partial.toArray(),endingSamples,maxEndingBoneStep,maxWeightError,idlePoseError,frameRates,notes:'Actual GLB animation arrays used. No browser rendering asserted by this test.'};
await mkdir(new URL('../qa/tripo/',import.meta.url),{recursive:true});await writeFile(new URL('../qa/tripo/motion-tests.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
