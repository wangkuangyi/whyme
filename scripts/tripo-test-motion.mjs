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
function rig({reducedMotion=false,yaw=0,scale=1,rootMotionFixture=false}={}) {
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
  // Walk2 is authored in place. A separate, explicitly synthetic root track
  // keeps the parent-transform check meaningful instead of comparing 0 to 0.
  // Only this test rig receives it; the production/source arrays stay intact.
  if(rootMotionFixture){
    const track=animations.find(clip=>clip.name==='Walk').tracks.find(track=>/Hips\.position$/.test(track.name));
    for(let i=0;i<track.times.length;i++){track.values[i*3]+=.3*track.times[i];track.values[i*3+2]+=.8*track.times[i];}
  }
  outer.updateMatrixWorld(true);
  const sourceSnapshot=animations.map(clip=>clip.tracks.map(track=>({times:Array.from(track.times),values:Array.from(track.values)})));
  return {motion:createCharacterMotion({model,animations,bones,reducedMotion}),bones,model,outer,animations,sourceSnapshot};
}
const reports = [], check=(name,test)=>{test();reports.push({name,passed:true});};
const tick=(context,seconds,options={})=>{for(let i=0;i<Math.round(seconds*120);i++) {context.motion.update(1/120,options);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}};
const finishEntry=(context)=>{const state=context.motion.getState();tick(context,Math.max(0,(state.duration-state.time)/Math.max(state.speed,.001))+.8);};
const savePose=context=>[...context.bones].map(([name,{bone}])=>({name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
const poseError=(context,saved)=>Math.max(...saved.map(value=>{const bone=context.bones.get(value.name).bone;return Math.max(bone.position.distanceTo(value.position),bone.quaternion.clone().normalize().angleTo(value.quaternion.clone().normalize()),bone.scale.distanceTo(value.scale));}));
const sample = rig(), unchanged = sample.sourceSnapshot;
check('reviewed-station-map',()=>{assert.deepEqual(STATION_CLIPS,['Walk','Nod','Wave','LookAround']);assert.equal(WALK_STATION,0);assert.equal(NOD_STATION,1);assert.equal(WAVE_STATION,2);assert.equal(LOOK_AROUND_STATION,3);assert.equal(Object.isFrozen(STATION_CLIPS),true);});
const suppliedWalk=sample.animations.find(clip=>clip.name==='Walk'), walkSourceDuration=suppliedWalk?.duration,walkDuration=sample.motion.getState().walkPlayback.duration;
check('walk2-keeps-the-complete-2_375-second-source',()=>{assert.ok(suppliedWalk);assert.equal(walkSourceDuration,2.375);});
check('walk2-runtime-is-extended-to-3_6-seconds',()=>{assert.equal(walkDuration,3.6);assert.equal(sample.motion.getState().walkPlayback.sourceDuration,walkSourceDuration);});
const sourceRoot=suppliedWalk.tracks.find(track=>/Hips\.position$/.test(track.name));
const sourceRootStart=new THREE.Vector3().fromArray(sourceRoot.values), sourceRootTransform=new THREE.Matrix3().setFromMatrix4(sample.bones.get('Hips').bone.parent.matrixWorld);
const sourceRootOffsets=Array.from(sourceRoot.times,(_,i)=>{const delta=new THREE.Vector3().fromArray(sourceRoot.values,i*3).sub(sourceRootStart);delta.y=0;return delta.applyMatrix3(sourceRootTransform);});
const sourceRootMaxExcursion=Math.max(...sourceRootOffsets.map(offset=>offset.length()));
check('walk2-source-is-in-place-without-invented-travel',()=>assert.ok(sourceRootMaxExcursion<1e-5,`source horizontal excursion ${sourceRootMaxExcursion} m`));
const suppliedLookAround=sample.animations.find(clip=>clip.name==='LookAround');
const suppliedIdle=sample.animations.find(clip=>clip.name==='Idle');
check('look-around-exists-in-supplied-glb',()=>{assert.ok(suppliedLookAround);assert.ok(suppliedLookAround.duration>0);assert.ok(suppliedLookAround.tracks.some(track=>/Head.*quaternion/.test(track.name)));assert.ok(suppliedLookAround.tracks.some(track=>/Spine2.*quaternion/.test(track.name)));});
for (let station=0;station<STATION_CLIPS.length;station++) {
  sample.motion.setStation(station);
  check(`station-${station+1}-uses-reviewed-action`,()=>assert.equal(sample.motion.getState().action,STATION_CLIPS[station]));
  finishEntry(sample);
  check(`station-${station+1}-settles-to-idle`,()=>{assert.equal(sample.motion.getState().action,'Idle');assert.equal(sample.motion.getState().end,true);assert.equal(sample.motion.getState().walking,false);});
  check(`station-${station+1}-uses-its-own-idle-mode`,()=>{const state=sample.motion.getState();assert.equal(state.idleMode,station===WALK_STATION?'walk-source-hold':'source-loop');assert.equal(state.idleSourceTime,station===WALK_STATION?2.5:null);});
  check(`station-${station+1}-hips-horizontal-rest`,()=>{const [x,z]=sample.motion.getState().rootMotion.horizontalRest;assert.ok(Math.abs(sample.bones.get('Hips').bone.position.x-x)<1e-7);assert.ok(Math.abs(sample.bones.get('Hips').bone.position.z-z)<1e-7);});
}
check('source-animation-arrays-preserved-from-before-motion-creation',()=>sample.animations.forEach((clip,c)=>clip.tracks.forEach((track,t)=>{assert.deepEqual(Array.from(track.times),unchanged[c][t].times);assert.deepEqual(Array.from(track.values),unchanged[c][t].values);})));
check('boxing-never-bound',()=>assert.ok(!sample.motion.getState().clips.includes('Box')));
check('withdrawn-cross-arms-never-bound-or-played',()=>{const state=sample.motion.getState();assert.ok(!state.clips.includes('CrossArms'));assert.ok(state.transitions.every(t=>t.to!=='CrossArms'&&!t.from.includes('CrossArms')));});
check('large-greet-never-bound-or-played',()=>{const state=sample.motion.getState();assert.ok(!state.clips.includes('Greet'));assert.ok(state.rejected.includes('Greet'));assert.ok(state.transitions.every(t=>t.to!=='Greet'&&!t.from.includes('Greet')));});
const walk = rig(); walk.motion.setStation(WALK_STATION,{immediate:true});
check('walk2-plays-at-original-speed',()=>{const state=walk.motion.getState();assert.equal(state.speed,1);assert.equal(state.duration,walkDuration);});
finishEntry(walk); const end = walk.motion.position.clone();
check('walk2-retains-authored-in-place-root-motion',()=>assert.ok(end.length()<1e-5,`world displacement ${end.length()} m`));
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
const interrupted = rig(); interrupted.motion.setStation(WALK_STATION);tick(interrupted,walkDuration*.4);const partial=interrupted.motion.position.clone();
check('interruption-occurs-during-walk2',()=>assert.equal(interrupted.motion.getState().action,'Walk'));
interrupted.motion.setStation(NOD_STATION);tick(interrupted,5);
check('interrupted-walk-keeps-current-position',()=>assert.ok(interrupted.motion.position.distanceTo(partial)<1e-10));
const paused = rig();paused.motion.setStation(WALK_STATION);tick(paused,1);const frozen=paused.motion.getState();tick(paused,2,{dragging:true});
check('dragging-freezes-action-and-root-motion',()=>{assert.equal(paused.motion.getState().time,frozen.time);assert.deepEqual(paused.motion.getState().position,frozen.position);});
const rootFixture=rig({rootMotionFixture:true});rootFixture.motion.setStation(WALK_STATION,{immediate:true});finishEntry(rootFixture);
const fixtureEnd=rootFixture.motion.position.clone();
const rotated = rig({yaw:Math.PI/2,scale:2,rootMotionFixture:true});rotated.motion.setStation(WALK_STATION,{immediate:true});finishEntry(rotated);
check('nonzero-root-fixture-includes-parent-scale-and-rotation',()=>{assert.ok(fixtureEnd.length()>1);assert.ok(Math.abs(rotated.motion.position.x-fixtureEnd.z*2)<1e-5);assert.ok(Math.abs(rotated.motion.position.z+fixtureEnd.x*2)<1e-5);});
const reduced = rig({reducedMotion:true}), rest = [...reduced.bones].map(([name,{bone}])=>[name,bone.position.clone(),bone.quaternion.clone(),bone.scale.clone()]);
for (let station=0;station<STATION_CLIPS.length;station++){reduced.motion.setStation(station);tick(reduced,3);}
check('reduced-motion-keeps-original-rest-pose',()=>{assert.deepEqual(reduced.motion.position.toArray(),[0,0,0]);for(const [name,position,quaternion,scale]of rest){const bone=reduced.bones.get(name).bone;assert.ok(bone.position.equals(position));assert.ok(bone.quaternion.equals(quaternion));assert.ok(bone.scale.equals(scale));}});
const rapid = rig();for(let i=0;i<40;i++){rapid.motion.setStation(i%STATION_CLIPS.length);tick(rapid,.12);}finishEntry(rapid);
check('rapid-switches-retire-fading-actions',()=>{assert.equal(rapid.motion.getState().weights.length,1);assert.equal(rapid.motion.getState().action,'Idle');assert.ok(rapid.motion.getState().weights.every(w=>Number.isFinite(w.weight)));});
const reaction=rig();reaction.motion.setStation(WALK_STATION);finishEntry(reaction);const reactionPosition=reaction.motion.position.clone();
check('walk-station-click-uses-nod-not-more-travel',()=>{assert.equal(reaction.motion.react(),true);assert.equal(reaction.motion.getState().action,'Nod');});tick(reaction,4);
check('reaction-keeps-travel',()=>assert.ok(reaction.motion.position.distanceTo(reactionPosition)<1e-10));
const ending = rig(), endingSamples=[];ending.motion.setStation(WALK_STATION,{immediate:true});
const endingSampleFrames=new Set([-.55,-.3,-.1,-1/240,.025,.2].map(offset=>Math.round((walkDuration+offset)*240)));
let previousPosition=ending.motion.position.clone(), previousBones=null, maxEndingBoneStep=0, maxWeightError=0;
for(let frame=1;frame<=Math.round((walkDuration+.6)*240);frame++){
  ending.motion.update(1/240);ending.outer.position.copy(ending.motion.position);ending.outer.updateMatrixWorld(true);
  const state=ending.motion.getState(), time=frame/240, speed=ending.motion.position.distanceTo(previousPosition)*240;
  const currentBones=[...ending.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3()).sub(ending.motion.position));
  if(time>walkDuration-.6&&previousBones)maxEndingBoneStep=Math.max(maxEndingBoneStep,...currentBones.map((p,i)=>p.distanceTo(previousBones[i])));
  maxWeightError=Math.max(maxWeightError,Math.abs(state.weights.reduce((sum,w)=>sum+w.weight,0)-1));
  if(endingSampleFrames.has(frame))endingSamples.push({time,speed,position:state.position,weights:state.weights});
  previousPosition.copy(ending.motion.position);previousBones=currentBones;
}
check('walk2-ending-keeps-zero-root-speed',()=>{assert.ok(endingSamples.find(s=>s.time>walkDuration-.01&&s.time<walkDuration).speed<.02);assert.equal(endingSamples.find(s=>s.time>walkDuration).speed,0);});
check('walk2-completes-once-and-releases-to-idle',()=>{const state=ending.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.walking,false);assert.equal(state.completedAction,'Walk');assert.deepEqual(state.weights.map(weight=>weight.action),['Idle']);});
check('walk-ending-has-no-bone-position-pop',()=>assert.ok(maxEndingBoneStep<.02,`240 Hz step ${maxEndingBoneStep} m`));
check('crossfade-weights-stay-normalized',()=>assert.ok(maxWeightError<.00011,`weight error ${maxWeightError}`));
const longIdle=rig(), initialIdle=savePose(longIdle);
tick(longIdle,300);const idlePoseError=poseError(longIdle,initialIdle);
check('five-minute-idle-has-no-root-drift',()=>assert.equal(longIdle.motion.position.length(),0));
check('five-minute-idle-returns-to-the-same-pose',()=>assert.ok(idlePoseError<1e-5,`pose error ${idlePoseError}`));
check('initial-idle-does-not-trigger-repeated-settling',()=>{const state=longIdle.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.idleMode,'source-loop');assert.equal(state.idleSourceTime,null);assert.equal(state.end,true);assert.equal(state.transition,null);assert.equal(state.weights.length,1);assert.equal(state.transitions.length,1);});
const idleBeforeClick=longIdle.motion.getState();
check('idle-before-any-station-does-not-add-a-reaction',()=>{assert.equal(longIdle.motion.react(),false);assert.deepEqual(longIdle.motion.getState(),idleBeforeClick);});

const lookAround=rig();lookAround.motion.setStation(LOOK_AROUND_STATION,{immediate:true});tick(lookAround,1/120);
const lookAroundStart=lookAround.motion.getState(), lookAroundDuration=lookAroundStart.duration/lookAroundStart.speed;
check('look-around-is-reviewed-5_8-second-excerpt-at-original-speed',()=>{assert.deepEqual(lookAroundStart.lookAroundRange,[1.2,7]);assert.ok(Math.abs(lookAroundDuration-5.8)<1e-6);assert.equal(lookAroundStart.speed,1);assert.ok(suppliedLookAround.duration>15);});
// Compare live bone transforms with independent interpolation of the original
// GLB. Checking both the entry and replay guards against an offset/retiming bug.
const sourcePoseError=(context,sourceTime,source=suppliedLookAround)=>{
  let maximum=0;
  for(const track of source.tracks){
    const binding=THREE.PropertyBinding.parseTrackName(track.name), name=binding.nodeName.replace(/^mixamorig[:_]?/i,''), bone=context.bones.get(name)?.bone;
    if(!bone)continue;
    const expected=Array.from(track.createInterpolant().evaluate(sourceTime)).slice(0,track.getValueSize());
    if(binding.propertyName==='position'&&name==='Hips'){const[x,z]=context.motion.getState().rootMotion.horizontalRest;expected[0]=x;expected[2]=z;}
    const actual=bone[binding.propertyName].toArray();
    maximum=Math.max(maximum,...actual.map((v,i)=>Math.abs(v-expected[i])));
  }
  return maximum;
};
const footPose=(context)=>{
  const hips=context.bones.get('Hips').bone.getWorldPosition(new THREE.Vector3());
  const positions=Object.fromEntries(['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(name=>[name,context.bones.get(name).bone.getWorldPosition(new THREE.Vector3()).sub(hips).toArray()]));
  return {positions,depthDifference:positions.RightFoot[2]-positions.LeftFoot[2],ankleHeightDifference:positions.RightFoot[1]-positions.LeftFoot[1],toeHeightDifference:positions.RightToeBase[1]-positions.LeftToeBase[1]};
};
// Inspect the unmodified source independently of the runtime Idle variants.
const idleSourceProbe=rig();idleSourceProbe.motion.dispose();
const idleSourceMixer=new THREE.AnimationMixer(idleSourceProbe.model);idleSourceMixer.clipAction(suppliedIdle).play();
const idleSourceFeet=[1.5,2.5,3.5].map(time=>{idleSourceMixer.setTime(time);idleSourceProbe.outer.updateMatrixWorld(true);return {time,...footPose(idleSourceProbe)};});
check('old-idle-loop-includes-the-forward-right-foot-step',()=>assert.ok(idleSourceFeet[0].depthDifference>.30));
check('selected-source-frame-has-both-feet-planted-together',()=>{const feet=idleSourceFeet[1];assert.ok(Math.abs(feet.depthDifference)<.035);assert.ok(Math.abs(feet.ankleHeightDifference)<.002);assert.ok(Math.abs(feet.toeHeightDifference)<.001);});
const stableWalk=rig();stableWalk.motion.setStation(WALK_STATION,{immediate:true});finishEntry(stableWalk);
const stableState=stableWalk.motion.getState(),stableFeet=footPose(stableWalk),stablePose=savePose(stableWalk),stableSourceError=sourcePoseError(stableWalk,2.5,suppliedIdle);
check('walk-settles-to-the-complete-authored-idle-pose',()=>{assert.equal(stableState.action,'Idle');assert.equal(stableState.idleMode,'walk-source-hold');assert.equal(stableState.idleSourceTime,2.5);assert.ok(stableSourceError<3e-6,`whole-body source error ${stableSourceError}`);});
check('walk-settled-feet-match-the-selected-source-frame',()=>{const expected=idleSourceFeet[1];for(const name of Object.keys(stableFeet.positions))assert.ok(new THREE.Vector3().fromArray(stableFeet.positions[name]).distanceTo(new THREE.Vector3().fromArray(expected.positions[name]))<1e-6);});
tick(stableWalk,300);const stableLongIdleError=poseError(stableWalk,stablePose),stableLongIdleFeet=footPose(stableWalk);
check('five-minute-walk-idle-keeps-all-bones-and-feet-still',()=>{assert.ok(stableLongIdleError<1e-6);assert.deepEqual(stableLongIdleFeet,stableFeet);assert.equal(stableWalk.motion.getState().action,'Idle');assert.equal(stableWalk.motion.getState().idleMode,'walk-source-hold');});
check('walk-stable-idle-reselect-does-not-restart-the-step',()=>{assert.equal(stableWalk.motion.setStation(WALK_STATION),false);assert.equal(stableWalk.motion.getState().action,'Idle');});
check('walk-stable-idle-still-allows-the-reviewed-nod',()=>{assert.equal(stableWalk.motion.react(),true);assert.equal(stableWalk.motion.getState().action,'Nod');});
finishEntry(stableWalk);const postNodSourceError=sourcePoseError(stableWalk,2.5,suppliedIdle);
check('walk-nod-returns-to-the-same-stable-whole-body-pose',()=>{const state=stableWalk.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.completedAction,'Nod');assert.equal(state.idleMode,'walk-source-hold');assert.ok(postNodSourceError<3e-6);assert.ok(poseError(stableWalk,stablePose)<1e-6);});
stableWalk.motion.setStation(NOD_STATION);finishEntry(stableWalk);const normalIdlePose=savePose(stableWalk);tick(stableWalk,.4);const resumedIdlePoseChange=poseError(stableWalk,normalIdlePose);
check('leaving-walk-restores-the-other-station-idle-animation',()=>{assert.equal(stableWalk.motion.getState().idleMode,'source-loop');assert.equal(stableWalk.motion.getState().idleSourceTime,null);assert.ok(resumedIdlePoseChange>.001,`restored Idle pose change ${resumedIdlePoseChange}`);});
const interruptedHold=rig();interruptedHold.motion.setStation(WALK_STATION);tick(interruptedHold,walkDuration-.25);
check('walk-idle-blend-is-active-before-interruption',()=>{assert.equal(interruptedHold.motion.getState().transition?.to,'Idle');assert.equal(interruptedHold.motion.getState().idleMode,'walk-source-hold');});
interruptedHold.motion.setStation(WAVE_STATION);finishEntry(interruptedHold);
const interruptedHoldState=interruptedHold.motion.getState(),interruptedLoopSourceError=sourcePoseError(interruptedHold,1.5+interruptedHoldState.time,suppliedIdle);
check('interrupting-walk-idle-blend-does-not-freeze-the-next-station',()=>{assert.equal(interruptedHoldState.completedAction,'Wave');assert.equal(interruptedHoldState.idleMode,'source-loop');assert.deepEqual(interruptedHoldState.weights.map(weight=>weight.action),['Idle']);assert.ok(interruptedLoopSourceError<3e-6);});
idleSourceMixer.stopAllAction();idleSourceMixer.uncacheRoot(idleSourceProbe.model);
const walkPoseProbe=rig();walkPoseProbe.motion.setStation(WALK_STATION,{immediate:true});walkPoseProbe.motion.update(0);
const walkOpeningSourceError=sourcePoseError(walkPoseProbe,2.5,suppliedIdle),walkOpeningFeet=footPose(walkPoseProbe),walkOpeningPose=savePose(walkPoseProbe);
check('initial-walk-dt0-shows-the-complete-planted-idle-source-pose',()=>{assert.ok(walkOpeningSourceError<3e-6);assert.ok(Math.abs(walkOpeningFeet.depthDifference)<.035);assert.ok(Math.abs(walkOpeningFeet.ankleHeightDifference)<.002);assert.ok(Math.abs(walkOpeningFeet.toeHeightDifference)<.001);assert.deepEqual(walkPoseProbe.motion.getState().weights.map(w=>w.action),['Idle']);});
for(let frame=0;frame<600;frame++)walkPoseProbe.motion.update(0);
check('paused-intro-never-advances-the-walk-or-unplants-the-feet',()=>{assert.equal(walkPoseProbe.motion.getState().time,0);assert.ok(poseError(walkPoseProbe,walkOpeningPose)<1e-6);});
const walkSourcePoseSamples=[];
for(const time of [.5,.75,1.5,2.25,2.5,2.75,3]){tick(walkPoseProbe,time-walkPoseProbe.motion.getState().time);const currentTime=walkPoseProbe.motion.getState().time,sourceTime=currentTime>walkSourceDuration?currentTime-walkSourceDuration:currentTime;walkSourcePoseSamples.push({time:currentTime,sourceTime,error:sourcePoseError(walkPoseProbe,sourceTime,suppliedWalk)});}
check('walk2-original-and-repeated-cycles-keep-source-pose-and-rate',()=>assert.ok(walkSourcePoseSamples.every(sample=>sample.error<3e-6),JSON.stringify(walkSourcePoseSamples)));
const initialDefault=rig();initialDefault.motion.setStation(WALK_STATION);initialDefault.motion.update(0);
check('default-initial-selection-also-starts-in-the-planted-source-pose',()=>assert.ok(sourcePoseError(initialDefault,2.5,suppliedIdle)<3e-6));
const openingFirstStep=savePose(initialDefault);initialDefault.motion.update(1/240);
check('first-unpaused-frame-fades-away-from-standing-without-a-pose-snap',()=>{assert.ok(poseError(initialDefault,openingFirstStep)<.002);assert.equal(initialDefault.motion.getState().action,'Walk');assert.ok(initialDefault.motion.getState().time>0);});
const entryContinuity=rig();entryContinuity.motion.setStation(WALK_STATION);entryContinuity.motion.update(0);
let previousEntryBones=[...entryContinuity.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3())),maxOpeningBoneStep=0,maxSeamBoneStep=0,maxSeamRootStep=0;
const seamSamples=[];
for(let frame=1;frame<=Math.round((walkSourceDuration+.2)*240);frame++){
  const previousRoot=entryContinuity.motion.position.clone();entryContinuity.motion.update(1/240);entryContinuity.outer.position.copy(entryContinuity.motion.position);entryContinuity.outer.updateMatrixWorld(true);
  const time=frame/240,currentBones=[...entryContinuity.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3())),step=Math.max(...currentBones.map((p,i)=>p.distanceTo(previousEntryBones[i])));
  if(time<.6)maxOpeningBoneStep=Math.max(maxOpeningBoneStep,step);
  if(Math.abs(time-walkSourceDuration)<.1){maxSeamBoneStep=Math.max(maxSeamBoneStep,step);maxSeamRootStep=Math.max(maxSeamRootStep,entryContinuity.motion.position.distanceTo(previousRoot));}
  if([Math.round((walkSourceDuration-1/240)*240),Math.round(walkSourceDuration*240),Math.round((walkSourceDuration+1/240)*240)].includes(frame))seamSamples.push({time,step,feet:footPose(entryContinuity),state:entryContinuity.motion.getState()});
  previousEntryBones=currentBones;
}
check('standing-to-walk-startup-has-no-bone-position-pop',()=>assert.ok(maxOpeningBoneStep<.02,`240Hz startup step ${maxOpeningBoneStep}m`));
check('walk-repeat-seam-has-no-bone-or-root-pop',()=>{assert.ok(maxSeamBoneStep<.02,`240Hz seam step ${maxSeamBoneStep}m`);assert.ok(maxSeamRootStep<1e-6);assert.ok(seamSamples.every(sample=>sample.state.action==='Walk'&&sample.state.walking&&!sample.state.end));});
const seamRootFixture=rig({rootMotionFixture:true});seamRootFixture.motion.setStation(WALK_STATION);let lastFixtureRoot=seamRootFixture.motion.position.clone(),minFixtureForwardStep=Infinity,maxFixtureForwardStep=0;
for(let frame=1;frame<=Math.round((walkSourceDuration+.2)*240);frame++){seamRootFixture.motion.update(1/240);const currentRoot=seamRootFixture.motion.position;if(Math.abs(frame/240-walkSourceDuration)<.1){const forwardStep=currentRoot.z-lastFixtureRoot.z;minFixtureForwardStep=Math.min(minFixtureForwardStep,forwardStep);maxFixtureForwardStep=Math.max(maxFixtureForwardStep,forwardStep);}lastFixtureRoot.copy(currentRoot);}
check('nonzero-root-fixture-continues-forward-across-repeat-seam',()=>{assert.ok(minFixtureForwardStep>=-1e-6);assert.ok(maxFixtureForwardStep<.02);});
const initialNonWalk=rig(),initialNonWalkPose=savePose(initialNonWalk);initialNonWalk.motion.setStation(NOD_STATION);initialNonWalk.motion.update(0);
check('initial-non-walk-station-retains-its-original-entry-pose',()=>assert.ok(poseError(initialNonWalk,initialNonWalkPose)<1e-6));
initialNonWalk.motion.setStation(WALK_STATION,{immediate:true,prepareOpening:true});initialNonWalk.motion.update(0);
check('switching-to-walk-during-paused-intro-primes-the-planted-pose',()=>{assert.ok(sourcePoseError(initialNonWalk,2.5,suppliedIdle)<3e-6);assert.equal(initialNonWalk.motion.getState().time,0);assert.deepEqual(initialNonWalk.motion.getState().weights.map(w=>w.action),['Idle']);});
const resumedDrag=rig();resumedDrag.motion.setStation(WALK_STATION);tick(resumedDrag,walkSourceDuration-.05);const beforeSeamDrag=savePose(resumedDrag),beforeSeamDragTime=resumedDrag.motion.getState().time;tick(resumedDrag,2,{dragging:true});
check('dragging-near-repeat-seam-keeps-pose-and-time-paused',()=>{assert.equal(resumedDrag.motion.getState().time,beforeSeamDragTime);assert.ok(poseError(resumedDrag,beforeSeamDrag)<1e-6);});
tick(resumedDrag,.2);check('releasing-drag-continues-the-extended-forward-gait',()=>{assert.ok(resumedDrag.motion.getState().time>walkSourceDuration);assert.equal(resumedDrag.motion.getState().action,'Walk');assert.equal(resumedDrag.motion.getState().speed,1);});
resumedDrag.motion.setStation(WAVE_STATION);finishEntry(resumedDrag);check('interrupting-the-repeated-cycle-retires-walk-and-keeps-next-idle',()=>{assert.equal(resumedDrag.motion.getState().completedAction,'Wave');assert.equal(resumedDrag.motion.getState().idleMode,'source-loop');assert.equal(resumedDrag.motion.getState().walking,false);assert.deepEqual(resumedDrag.motion.getState().weights.map(w=>w.action),['Idle']);});
const excerptProbe=rig();excerptProbe.motion.setStation(LOOK_AROUND_STATION,{immediate:true});excerptProbe.motion.update(0);
const sourcePoseSamples=[{time:0,error:sourcePoseError(excerptProbe,1.2)}];
for(const time of [.1,1.3,2.4,3.8,5.2]){tick(excerptProbe,time-excerptProbe.motion.getState().time);sourcePoseSamples.push({time:excerptProbe.motion.getState().time,error:sourcePoseError(excerptProbe,1.2+excerptProbe.motion.getState().time)});}
check('look-around-preserves-original-source-samples-through-excerpt',()=>assert.ok(sourcePoseSamples.every(s=>s.error<3e-6),JSON.stringify(sourcePoseSamples)));
tick(excerptProbe,.8);
check('look-around-is-finished-within-six-seconds',()=>{const state=excerptProbe.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.completedAction,'LookAround');assert.deepEqual(state.weights.map(item=>item.action),['Idle']);});
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
check('clicking-after-look-around-replays-the-entry',()=>{assert.equal(lookAround.motion.react(),true);const state=lookAround.motion.getState();assert.equal(state.action,'LookAround');assert.equal(state.time,0);assert.equal(state.duration,lookAroundStart.duration);assert.deepEqual(state.lookAroundRange,lookAroundStart.lookAroundRange);assert.equal(state.speed,1);assert.equal(state.end,false);assert.equal(state.transitions.at(-1).reason,'reaction');});
tick(lookAround,1.3);const replaySourceError=sourcePoseError(lookAround,2.5);
check('look-around-replay-uses-the-same-source-pose',()=>assert.ok(replaySourceError<3e-6,`source pose error ${replaySourceError}`));
finishEntry(lookAround);
check('look-around-reaction-also-settles-once',()=>{const state=lookAround.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.completedAction,'LookAround');assert.equal(state.end,true);assert.equal(state.weights.length,1);assert.equal(lookAround.motion.position.length(),0);});
const fadeInterrupt=rig();fadeInterrupt.motion.setStation(WALK_STATION);tick(fadeInterrupt,walkDuration-.25);const atFade=fadeInterrupt.motion.position.clone();
check('walk2-settle-check-occurs-during-idle-blend',()=>assert.equal(fadeInterrupt.motion.getState().transition?.to,'Idle'));
fadeInterrupt.motion.setStation(WAVE_STATION);tick(fadeInterrupt,5);
check('switching-during-walk-settle-preserves-position',()=>assert.ok(fadeInterrupt.motion.position.distanceTo(atFade)<1e-10));
const frameRates=[];
for(const fps of[20,30,60,120]){
  const context=rig();context.motion.setStation(WALK_STATION,{immediate:true});for(let frame=0;frame<Math.ceil(fps*(walkDuration+.8));frame++){context.motion.update(1/fps);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}
  frameRates.push({fps,position:context.motion.position.toArray(),action:context.motion.getState().action,idleMode:context.motion.getState().idleMode,feet:footPose(context)});context.motion.dispose();
}
check('walk-settles-at-20-through-120-fps',()=>{assert.ok(frameRates.every(r=>r.action==='Idle'));assert.ok(Math.max(...frameRates.map(r=>r.position[2]))-Math.min(...frameRates.map(r=>r.position[2]))<.001);});
check('walk-idle-feet-stay-planted-at-20-through-120-fps',()=>assert.ok(frameRates.every(r=>r.idleMode==='walk-source-hold'&&Math.abs(r.feet.depthDifference)<.035&&Math.abs(r.feet.toeHeightDifference)<.001)));
for(const context of[sample,walk,interrupted,paused,rootFixture,rotated,reduced,rapid,reaction,ending,longIdle,lookAround,fadeInterrupt,excerptProbe,walkPoseProbe,stableWalk,interruptedHold,initialDefault,entryContinuity,seamRootFixture,initialNonWalk,resumedDrag])context.motion.dispose();
const result={checks:reports,stationClips:STATION_CLIPS,walkStation:WALK_STATION,walkOpening:{sourceTime:2.5,wholeBody:true,walkOpeningSourceError,walkOpeningFeet,maxOpeningBoneStep},walkIdle:{sourceTime:2.5,mode:'whole-body-source-hold',idleSourceFeet,stableFeet,stableSourceError,stableLongIdleError,postNodSourceError,resumedIdlePoseChange,interruptedLoopSourceError},walk2:{sourceDuration:walkSourceDuration,runtimeDuration:walkDuration,speed:1,inPlace:true,sourceHorizontalExcursion:sourceRootMaxExcursion,sourcePoseSamples:walkSourcePoseSamples,nonzeroRootFixtureEnd:fixtureEnd.toArray(),seam:{at:walkSourceDuration,maxSeamBoneStep,maxSeamRootStep,minFixtureForwardStep,maxFixtureForwardStep,samples:seamSamples}},lookAround:{station:LOOK_AROUND_STATION,sourceDuration:suppliedLookAround.duration,sourceRange:lookAroundStart.lookAroundRange,runtimeDuration:lookAroundStart.duration,speed:lookAroundStart.speed,sourcePoseSamples,replaySourceError,turnExcursionRadians:Object.fromEntries(turnNames.map((name,i)=>[name,turnExcursion[i]])),postIdlePoseError:postLookAroundIdlePoseError},walkWorldEnd:end.toArray(),interruptedWorldEnd:partial.toArray(),endingSamples,maxEndingBoneStep,maxWeightError,idlePoseError,frameRates,notes:'Actual GLB animation arrays used, except the explicitly labelled nonzero parent-transform fixtures. Walk initial and settled poses hold the entire supplied Idle source at2.5sec. Walk duration extends from2.375 to3.6sec by continuing its forward cycle at unchanged rate1; source arrays and GLB are not modified. Other station entries and idle loops are retained. Walk2 remains authored in place; no extra travel is added. No browser rendering asserted by this test.'};
await mkdir(new URL('../qa/tripo/',import.meta.url),{recursive:true});await writeFile(new URL('../qa/tripo/walk-entry-motion.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
