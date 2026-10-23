/** Exercise the actual supplied animation samples without a rendering context. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { createCharacterMotion, STATION_CLIPS, WALK_STATION } from '../src/motion.js';

const NOD_STATION = STATION_CLIPS.indexOf('Nod'), LOOK_AROUND_STATION = STATION_CLIPS.indexOf('LookAround'), WAVE_STATION = STATION_CLIPS.indexOf('Wave');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const assetPath = '../public/models/person-original-animated.glb';
const assetBytes = await readFile(new URL(assetPath,import.meta.url));
const assetSHA256 = createHash('sha256').update(assetBytes).digest('hex');
const document = await io.readBinary(assetBytes);
// The restored Tripo mesh remains at its authored unit scale in the file.
// Match scene.js's whole-model normalization before measuring any world-space
// feet/continuity tolerances, so the existing metre thresholds stay meaningful.
const sourceBounds = getBounds(document.getRoot().listScenes()[0]);
const sourceHeight = sourceBounds.max[1] - sourceBounds.min[1];
const sceneHeight = 1.83, normalizationScale = sceneHeight / Math.max(sourceHeight, .001);
function rig({reducedMotion=false,yaw=0,scale=1,rootMotionFixture=false}={}) {
  const model = new THREE.Group(), outer = new THREE.Group(), mapping = new Map(), bones = new Map();
  model.scale.setScalar(normalizationScale);
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
  // Capture expected transforms directly from GLB nodes before the runtime
  // creates or samples any action. This is independent of its generated Idle.
  const restPose=[...bones].map(([name,{bone}])=>({name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
  const sourceSnapshot=animations.map(clip=>clip.tracks.map(track=>({times:Array.from(track.times),values:Array.from(track.values)})));
  return {motion:createCharacterMotion({model,animations,bones,reducedMotion}),bones,model,outer,animations,sourceSnapshot,restPose};
}
const reports = [], check=(name,test)=>{try{test();reports.push({name,passed:true});}catch(error){reports.push({name,passed:false,error:error.message});}};
const tick=(context,seconds,options={})=>{for(let i=0;i<Math.round(seconds*120);i++) {context.motion.update(1/120,options);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}};
const finishEntry=(context)=>{const state=context.motion.getState();tick(context,Math.max(0,(state.duration-state.time)/Math.max(state.speed,.001))+.8);};
const savePose=context=>[...context.bones].map(([name,{bone}])=>({name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
const poseError=(context,saved)=>Math.max(...saved.map(value=>{const bone=context.bones.get(value.name).bone;return Math.max(bone.position.distanceTo(value.position),bone.quaternion.clone().normalize().angleTo(value.quaternion.clone().normalize()),bone.scale.distanceTo(value.scale));}));
const BREATHING_LIFTS={Spine1:.0016,Spine2:.0012},BREATHING_PERIOD=4.8;
// Independent analytical baseline: never call the production breathing module.
const expectedBreathAmount=time=>(1-Math.cos(2*Math.PI*time/BREATHING_PERIOD))*.5;
function expectedBreathLocal(context,name){
  const state=context.motion.getState().breathing,lift=BREATHING_LIFTS[name]||0;
  const bone=context.bones.get(name).bone;
  bone.parent.updateWorldMatrix(true,false);
  return new THREE.Vector3(0,lift*expectedBreathAmount(state.time)*state.weight,0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(bone.parent.matrixWorld.clone().invert()));
}
function idlePoseErrorAgainstSource(context){
  context.outer.updateMatrixWorld(true);
  return Math.max(...context.restPose.map(expected=>{
    const bone=context.bones.get(expected.name).bone,position=bone.position.clone().sub(expectedBreathLocal(context,expected.name));
    return Math.max(position.distanceTo(expected.position),bone.quaternion.clone().normalize().angleTo(expected.quaternion.clone().normalize()),bone.scale.distanceTo(expected.scale));
  }));
}
const sample = rig(), unchanged = sample.sourceSnapshot;
check('original-surface-rig-has-all-65-unique-joint-bindings',()=>{assert.equal(sample.bones.size,65);const names=document.getRoot().listNodes().map(node=>THREE.PropertyBinding.sanitizeNodeName(node.getName()));assert.equal(new Set(names).size,names.length);});
check('all-source-animation-channels-bind-to-existing-body-bones',()=>{for(const animation of document.getRoot().listAnimations())for(const channel of animation.listChannels()){const name=THREE.PropertyBinding.sanitizeNodeName(channel.getTargetNode().getName()).replace(/^mixamorig[:_]?/i,'');assert.ok(sample.bones.has(name),`${animation.getName()} target ${name}`);assert.ok(['translation','rotation','scale'].includes(channel.getTargetPath()),`${animation.getName()} path ${channel.getTargetPath()}`);}});
check('runtime-does-not-create-face-or-morph-animation',()=>{assert.equal(sample.motion.getState().faceAnimation,false);for(const animation of document.getRoot().listAnimations())assert.ok(animation.listChannels().every(channel=>channel.getTargetPath()!=='weights'));});
check('world-space-tests-use-scene-height-without-changing-source-scale',()=>{assert.ok(Number.isFinite(normalizationScale)&&normalizationScale>0);assert.ok(Math.abs(sourceHeight*normalizationScale-sceneHeight)<1e-12);assert.ok(Math.abs(sample.model.scale.y-normalizationScale)<1e-12);});
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
  check(`station-${station+1}-uses-whole-original-upright-rest`,()=>{const state=sample.motion.getState();assert.equal(state.idleMode,'upright-breathing');assert.equal(state.idleSourceTime,null);assert.equal(state.idleRange,null);assert.ok(idlePoseErrorAgainstSource(sample)<1e-6);});
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
  if(time>walkDuration-1.05&&previousBones)maxEndingBoneStep=Math.max(maxEndingBoneStep,...currentBones.map((p,i)=>p.distanceTo(previousBones[i])));
  maxWeightError=Math.max(maxWeightError,Math.abs(state.weights.reduce((sum,w)=>sum+w.weight,0)-1));
  if(endingSampleFrames.has(frame))endingSamples.push({time,speed,position:state.position,weights:state.weights});
  previousPosition.copy(ending.motion.position);previousBones=currentBones;
}
check('walk2-ending-keeps-zero-root-speed',()=>{assert.ok(endingSamples.find(s=>s.time>walkDuration-.01&&s.time<walkDuration).speed<.02);assert.equal(endingSamples.find(s=>s.time>walkDuration).speed,0);});
check('walk2-completes-once-and-releases-to-idle',()=>{const state=ending.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.walking,false);assert.equal(state.completedAction,'Walk');assert.deepEqual(state.weights.map(weight=>weight.action),['Idle']);});
check('walk-ending-has-no-bone-position-pop',()=>assert.ok(maxEndingBoneStep<.02,`240 Hz step ${maxEndingBoneStep} m`));
check('crossfade-weights-stay-normalized',()=>assert.ok(maxWeightError<.00011,`weight error ${maxWeightError}`));
const longIdle=rig(), initialIdle=savePose(longIdle);
tick(longIdle,300);const idlePoseError=idlePoseErrorAgainstSource(longIdle);
check('five-minute-idle-has-no-root-drift',()=>assert.equal(longIdle.motion.position.length(),0));
check('five-minute-idle-stays-on-independent-breathing-baseline',()=>assert.ok(idlePoseError<1e-5,`pose error ${idlePoseError}`));
check('initial-idle-does-not-trigger-repeated-settling',()=>{const state=longIdle.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.idleMode,'upright-breathing');assert.equal(state.idleSourceTime,null);assert.equal(state.end,true);assert.equal(state.transition,null);assert.equal(state.weights.length,1);assert.equal(state.transitions.length,1);assert.ok(idlePoseErrorAgainstSource(longIdle)<1e-6);});
const idleBeforeClick=longIdle.motion.getState();
check('idle-before-any-station-does-not-add-a-reaction',()=>{assert.equal(longIdle.motion.react(),false);assert.deepEqual(longIdle.motion.getState(),idleBeforeClick);});

const lookAround=rig();lookAround.motion.setStation(LOOK_AROUND_STATION,{immediate:true});tick(lookAround,1/120);
const lookAroundStart=lookAround.motion.getState(), lookAroundDuration=lookAroundStart.duration/lookAroundStart.speed;
check('look-around-keeps-reviewed-range-and-extends-only-source-tail',()=>{assert.deepEqual(lookAroundStart.lookAroundRange,[1.2,7.4]);assert.ok(Math.abs(lookAroundDuration-6.6)<1e-6);assert.equal(lookAroundStart.speed,1);assert.ok(suppliedLookAround.duration>15);});
// Compare live bone transforms with independent interpolation of the original
// GLB. Checking both the entry and replay guards against an offset/retiming bug.
// Only the three explicitly permitted local quaternion corrections are excluded
// from source equality; their bounds and world-space gaze are checked separately.
const sourceReference=rig();sourceReference.motion.dispose();
const postureSourceComparisons=[],permittedPostureBones=new Set(['Spine','Spine1','Spine2','Neck','Head']);
const sourcePoseError=(context,sourceTime,source=suppliedLookAround,restWeight=0)=>{
  let maximum=0;
  for(const pose of sourceReference.restPose){const bone=sourceReference.bones.get(pose.name).bone;bone.position.copy(pose.position);bone.quaternion.copy(pose.quaternion);bone.scale.copy(pose.scale);}
  sourceReference.outer.quaternion.copy(context.outer.quaternion);sourceReference.outer.scale.copy(context.outer.scale);
  for(const track of source.tracks){
    const binding=THREE.PropertyBinding.parseTrackName(track.name), name=binding.nodeName.replace(/^mixamorig[:_]?/i,''), bone=sourceReference.bones.get(name)?.bone;
    if(!bone)continue;
    const expected=Array.from(track.createInterpolant().evaluate(sourceTime)).slice(0,track.getValueSize());
    if(binding.propertyName==='position'&&name==='Hips'){const[x,z]=context.motion.getState().rootMotion.horizontalRest;expected[0]=x;expected[2]=z;}
    bone[binding.propertyName].fromArray(expected);
  }
  if(restWeight)for(const pose of sourceReference.restPose){const bone=sourceReference.bones.get(pose.name).bone;bone.position.lerp(pose.position,restWeight);bone.quaternion.slerp(pose.quaternion,restWeight);bone.scale.lerp(pose.scale,restWeight);}
  sourceReference.outer.updateMatrixWorld(true);context.outer.updateMatrixWorld(true);
  const corrections={};
  for(const[name,{bone}]of context.bones){
    const expected=sourceReference.bones.get(name).bone;
    for(const property of['position','quaternion','scale']){
      if(property==='quaternion'&&permittedPostureBones.has(name)){corrections[name]=bone.quaternion.clone().normalize().angleTo(expected.quaternion.clone().normalize())*180/Math.PI;continue;}
      const actual=(property==='position'?bone.position.clone().sub(expectedBreathLocal(context,name)):bone[property]).toArray(),reference=expected[property].toArray();maximum=Math.max(maximum,...actual.map((v,i)=>Math.abs(v-reference[i])));
    }
  }
  const actualGaze=context.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize(),expectedGaze=sourceReference.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
  postureSourceComparisons.push({clip:source.name,sourceTime,restWeight,unchangedLocalError:maximum,localCorrectionDegrees:corrections,headWorldDirectionError:actualGaze.angleTo(expectedGaze),runtime:context.motion.getState().posture});
  return maximum;
};
const footPose=(context)=>{
  const hips=context.bones.get('Hips').bone.getWorldPosition(new THREE.Vector3());
  const positions=Object.fromEntries(['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(name=>[name,context.bones.get(name).bone.getWorldPosition(new THREE.Vector3()).sub(hips).toArray()]));
  return {positions,depthDifference:positions.RightFoot[2]-positions.LeftFoot[2],ankleHeightDifference:positions.RightFoot[1]-positions.LeftFoot[1],toeHeightDifference:positions.RightToeBase[1]-positions.LeftToeBase[1]};
};
const sourceRestProbe=rig();sourceRestProbe.motion.dispose();
const restFeet=footPose(sourceRestProbe);
check('original-bind-rest-feet-are-parallel-and-planted',()=>{assert.ok(Math.abs(restFeet.depthDifference)<.035);assert.ok(Math.abs(restFeet.ankleHeightDifference)<.002);assert.ok(Math.abs(restFeet.toeHeightDifference)<.001);});
// Retain historical evidence of why the old Idle animation was withdrawn.
// Its least-stepped sample is no longer the expected runtime posture.
const idleSourceProbe=rig();idleSourceProbe.motion.dispose();
const idleSourceMixer=new THREE.AnimationMixer(idleSourceProbe.model);idleSourceMixer.clipAction(suppliedIdle).play();
const idleSourceFeet=[1.5,2.5,3.5].map(time=>{idleSourceMixer.setTime(time);idleSourceProbe.outer.updateMatrixWorld(true);return {time,...footPose(idleSourceProbe)};});
check('old-idle-loop-includes-the-forward-right-foot-step',()=>assert.ok(idleSourceFeet[0].depthDifference>.30));
check('historical-idle-2_5-second-sample-had-planted-feet',()=>{const feet=idleSourceFeet[1];assert.ok(Math.abs(feet.depthDifference)<.035);assert.ok(Math.abs(feet.ankleHeightDifference)<.002);assert.ok(Math.abs(feet.toeHeightDifference)<.001);});
const stableWalk=rig();stableWalk.motion.setStation(WALK_STATION,{immediate:true});finishEntry(stableWalk);
const stableState=stableWalk.motion.getState(),stableFeet=footPose(stableWalk),stablePose=savePose(stableWalk),stableRestError=idlePoseErrorAgainstSource(stableWalk);
check('walk-settles-to-original-bind-rest-with-breathing-only',()=>{assert.equal(stableState.action,'Idle');assert.equal(stableState.idleMode,'upright-breathing');assert.equal(stableState.idleSourceTime,null);assert.ok(stableRestError<1e-6,`whole-body rest error ${stableRestError}`);});
check('walk-settled-feet-match-the-original-bind-rest',()=>{for(const name of Object.keys(stableFeet.positions))assert.ok(new THREE.Vector3().fromArray(stableFeet.positions[name]).distanceTo(new THREE.Vector3().fromArray(restFeet.positions[name]))<1e-6);});
tick(stableWalk,300);const stableLongIdleError=idlePoseErrorAgainstSource(stableWalk),stableLongIdleFeet=footPose(stableWalk);
check('five-minute-walk-idle-keeps-breathing-baseline-and-feet-still',()=>{assert.ok(stableLongIdleError<1e-6);assert.deepEqual(stableLongIdleFeet,stableFeet);assert.equal(stableWalk.motion.getState().action,'Idle');assert.equal(stableWalk.motion.getState().idleMode,'upright-breathing');});
check('walk-stable-idle-reselect-does-not-restart-the-step',()=>{assert.equal(stableWalk.motion.setStation(WALK_STATION),false);assert.equal(stableWalk.motion.getState().action,'Idle');});
check('walk-stable-idle-still-allows-the-reviewed-nod',()=>{assert.equal(stableWalk.motion.react(),true);assert.equal(stableWalk.motion.getState().action,'Nod');});
finishEntry(stableWalk);const postNodRestError=idlePoseErrorAgainstSource(stableWalk);
check('walk-nod-returns-to-the-same-stable-whole-body-pose',()=>{const state=stableWalk.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.completedAction,'Nod');assert.equal(state.idleMode,'upright-breathing');assert.ok(postNodRestError<1e-6);assert.ok(idlePoseErrorAgainstSource(stableWalk)<1e-6);});
stableWalk.motion.setStation(NOD_STATION);finishEntry(stableWalk);const normalIdlePose=savePose(stableWalk);tick(stableWalk,.4);const resumedIdlePoseChange=idlePoseErrorAgainstSource(stableWalk);
check('leaving-walk-keeps-upright-rest-plus-continuous-breathing',()=>{assert.equal(stableWalk.motion.getState().idleMode,'upright-breathing');assert.equal(stableWalk.motion.getState().idleSourceTime,null);assert.ok(resumedIdlePoseChange<1e-6,`rest Idle pose change ${resumedIdlePoseChange}`);assert.ok(idlePoseErrorAgainstSource(stableWalk)<1e-6);});
const interruptedHold=rig();interruptedHold.motion.setStation(WALK_STATION);tick(interruptedHold,walkDuration-.25);
check('walk-idle-blend-is-active-before-interruption',()=>{assert.equal(interruptedHold.motion.getState().transition?.to,'Idle');assert.equal(interruptedHold.motion.getState().idleMode,'upright-breathing');});
interruptedHold.motion.setStation(WAVE_STATION);finishEntry(interruptedHold);
const interruptedHoldState=interruptedHold.motion.getState(),interruptedRestError=idlePoseErrorAgainstSource(interruptedHold);
check('interrupting-walk-idle-blend-plays-next-action-then-restores-rest',()=>{assert.equal(interruptedHoldState.completedAction,'Wave');assert.equal(interruptedHoldState.idleMode,'upright-breathing');assert.deepEqual(interruptedHoldState.weights.map(weight=>weight.action),['Idle']);assert.ok(interruptedRestError<1e-6);});
idleSourceMixer.stopAllAction();idleSourceMixer.uncacheRoot(idleSourceProbe.model);
const walkPoseProbe=rig();walkPoseProbe.motion.setStation(WALK_STATION,{immediate:true});walkPoseProbe.motion.update(0);
const walkOpeningRestError=poseError(walkPoseProbe,walkPoseProbe.restPose),walkOpeningFeet=footPose(walkPoseProbe),walkOpeningPose=savePose(walkPoseProbe);
check('initial-walk-dt0-shows-the-complete-original-bind-rest',()=>{assert.ok(walkOpeningRestError<1e-6);assert.ok(Math.abs(walkOpeningFeet.depthDifference)<.035);assert.ok(Math.abs(walkOpeningFeet.ankleHeightDifference)<.002);assert.ok(Math.abs(walkOpeningFeet.toeHeightDifference)<.001);assert.deepEqual(walkPoseProbe.motion.getState().weights.map(w=>w.action),['Idle']);});
for(let frame=0;frame<600;frame++)walkPoseProbe.motion.update(0);
check('paused-intro-never-advances-the-walk-or-unplants-the-feet',()=>{assert.equal(walkPoseProbe.motion.getState().time,0);assert.ok(poseError(walkPoseProbe,walkOpeningPose)<1e-6);});
const walkSourcePoseSamples=[];
for(const time of [.5,.75,1.5,2.25,2.5]){tick(walkPoseProbe,time-walkPoseProbe.motion.getState().time);const currentTime=walkPoseProbe.motion.getState().time,sourceTime=currentTime>walkSourceDuration?currentTime-walkSourceDuration:currentTime;walkSourcePoseSamples.push({time:currentTime,sourceTime,error:sourcePoseError(walkPoseProbe,sourceTime,suppliedWalk)});}
check('walk2-original-and-repeated-cycles-preserve-source-except-bounded-posture',()=>assert.ok(walkSourcePoseSamples.every(sample=>sample.error<3e-6),JSON.stringify(walkSourcePoseSamples)));
const initialDefault=rig();initialDefault.motion.setStation(WALK_STATION);initialDefault.motion.update(0);
check('default-initial-selection-also-starts-in-original-bind-rest',()=>assert.ok(poseError(initialDefault,initialDefault.restPose)<1e-6));
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
check('initial-non-walk-station-retains-original-bind-rest',()=>{assert.ok(poseError(initialNonWalk,initialNonWalkPose)<1e-6);assert.ok(poseError(initialNonWalk,initialNonWalk.restPose)<1e-6);});
initialNonWalk.motion.setStation(WALK_STATION,{immediate:true,prepareOpening:true});initialNonWalk.motion.update(0);
check('switching-to-walk-during-paused-intro-primes-original-bind-rest',()=>{assert.ok(poseError(initialNonWalk,initialNonWalk.restPose)<1e-6);assert.equal(initialNonWalk.motion.getState().time,0);assert.deepEqual(initialNonWalk.motion.getState().weights.map(w=>w.action),['Idle']);});
const resumedDrag=rig();resumedDrag.motion.setStation(WALK_STATION);tick(resumedDrag,walkSourceDuration-.05);const beforeSeamDrag=savePose(resumedDrag),beforeSeamDragTime=resumedDrag.motion.getState().time;tick(resumedDrag,2,{dragging:true});
check('dragging-near-repeat-seam-keeps-pose-and-time-paused',()=>{assert.equal(resumedDrag.motion.getState().time,beforeSeamDragTime);assert.ok(poseError(resumedDrag,beforeSeamDrag)<1e-6);});
tick(resumedDrag,.2);check('releasing-drag-continues-the-extended-forward-gait',()=>{assert.ok(resumedDrag.motion.getState().time>walkSourceDuration);assert.equal(resumedDrag.motion.getState().action,'Walk');assert.equal(resumedDrag.motion.getState().speed,1);});
resumedDrag.motion.setStation(WAVE_STATION);finishEntry(resumedDrag);check('interrupting-the-repeated-cycle-retires-walk-and-keeps-next-idle',()=>{assert.equal(resumedDrag.motion.getState().completedAction,'Wave');assert.equal(resumedDrag.motion.getState().idleMode,'upright-breathing');assert.equal(resumedDrag.motion.getState().walking,false);assert.deepEqual(resumedDrag.motion.getState().weights.map(w=>w.action),['Idle']);});
const excerptProbe=rig();excerptProbe.motion.setStation(LOOK_AROUND_STATION,{immediate:true});excerptProbe.motion.update(0);
const sourcePoseSamples=[{time:0,error:sourcePoseError(excerptProbe,1.2)}];
for(const time of [.1,1.3,2.4,3.8,5.2]){tick(excerptProbe,time-excerptProbe.motion.getState().time);sourcePoseSamples.push({time:excerptProbe.motion.getState().time,error:sourcePoseError(excerptProbe,1.2+excerptProbe.motion.getState().time)});}
check('look-around-preserves-source-except-bounded-posture-through-excerpt',()=>assert.ok(sourcePoseSamples.every(s=>s.error<3e-6),JSON.stringify(sourcePoseSamples)));
tick(excerptProbe,1.8);
check('look-around-completes-reviewed-6_6-second-performance',()=>{const state=excerptProbe.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.completedAction,'LookAround');assert.deepEqual(state.weights.map(item=>item.action),['Idle']);});
const turnNames=['Head','Neck','Spine','Spine1','Spine2'];
const firstTurns=turnNames.map(name=>lookAround.bones.get(name).bone.quaternion.clone().normalize());
const turnExcursion=turnNames.map(()=>0);
// Sample only the supplied entry, excluding its final blend into Idle. This
// prevents an idle pose change from masquerading as a genuine looking-around gesture.
const actionSampleSeconds=Math.max(0,lookAroundDuration-lookAroundStart.playbackTiming.settleSeconds-1/120);
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
tick(lookAround,300);const postLookAroundIdlePoseError=idlePoseErrorAgainstSource(lookAround);
check('five-minute-idle-after-look-around-keeps-breathing-baseline-and-position',()=>{assert.ok(postLookAroundIdlePoseError<1e-5,`pose error ${postLookAroundIdlePoseError}`);assert.equal(lookAround.motion.position.length(),0);});
check('completed-look-around-does-not-replay-spontaneously',()=>{const state=lookAround.motion.getState();assert.equal(state.action,'Idle');assert.equal(state.end,true);assert.equal(state.weights.length,1);assert.equal(state.transition,null);assert.deepEqual(state.transitions,postLookAroundIdle.transitions);});
const beforeCompletedReselect=lookAround.motion.getState();
check('reselecting-completed-look-around-keeps-idle-phase',()=>{assert.equal(lookAround.motion.setStation(LOOK_AROUND_STATION),false);assert.deepEqual(lookAround.motion.getState(),beforeCompletedReselect);});
check('clicking-after-look-around-replays-the-entry',()=>{assert.equal(lookAround.motion.react(),true);const state=lookAround.motion.getState();assert.equal(state.action,'LookAround');assert.equal(state.time,0);assert.equal(state.duration,lookAroundStart.duration);assert.deepEqual(state.lookAroundRange,lookAroundStart.lookAroundRange);assert.equal(state.speed,1);assert.equal(state.end,false);assert.equal(state.transitions.at(-1).reason,'reaction');});
tick(lookAround,1.3);const replaySourceError=sourcePoseError(lookAround,2.5);
check('look-around-replay-preserves-source-except-bounded-posture',()=>assert.ok(replaySourceError<3e-6,`source pose error ${replaySourceError}`));
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
check('walk-idle-feet-stay-planted-at-20-through-120-fps',()=>assert.ok(frameRates.every(r=>r.idleMode==='upright-breathing'&&Math.abs(r.feet.depthDifference)<.035&&Math.abs(r.feet.toeHeightDifference)<.001)));
for(const station of[NOD_STATION,WAVE_STATION]){
  const probe=rig();probe.motion.setStation(station,{immediate:true});probe.motion.update(0);
  const source=probe.animations.find(clip=>clip.name===STATION_CLIPS[station]),state=probe.motion.getState(),sourceOffset=station===WAVE_STATION?.9:0;
  const sampleEnd=Math.max(0,state.duration-state.speed*state.playbackTiming.settleSeconds);
  for(const fraction of[0,.2,.4,.65,.9]){const target=sampleEnd*fraction;tick(probe,(target-probe.motion.getState().time)/state.speed);const error=sourcePoseError(probe,sourceOffset+probe.motion.getState().time,source);check(`${source.name.toLowerCase()}-source-tracks-preserved-at-${fraction}`,()=>assert.ok(error<3e-6,`unchanged local error ${error}`));}
  probe.motion.dispose();
}
const tailTimingSamples=[];
for(const station of[NOD_STATION,WAVE_STATION,LOOK_AROUND_STATION]){
  const probe=rig();probe.motion.setStation(station,{immediate:true});probe.motion.update(0);
  const initial=probe.motion.getState(),timing=initial.playbackTiming,source=probe.animations.find(clip=>clip.name===STATION_CLIPS[station]);
  const sourceLength=timing.sourceRange[1]-timing.sourceRange[0],tailStart=sourceLength-.4;
  check(`${source.name}-only-extends-final-0_4-source-seconds`,()=>{assert.equal(timing.tailSourceSeconds,.4);assert.equal(timing.tailPlaybackSeconds,.8);assert.ok(Math.abs(timing.settleSeconds-.8/initial.speed)<1e-10);assert.ok(Math.abs(initial.duration-(sourceLength+.4))<1e-7);});
  for(const fraction of[0,.125,.25,.5,.75,.875]){
    const target=tailStart+.8*fraction,remaining=(target-probe.motion.getState().time)/initial.speed;
    const steps=Math.floor(remaining*240);for(let step=0;step<steps;step++)probe.motion.update(1/240);probe.motion.update(Math.max(0,(target-probe.motion.getState().time)/initial.speed));probe.outer.updateMatrixWorld(true);
    const state=probe.motion.getState(),u=Math.max(0,Math.min(1,(state.time-tailStart)/.8));
    const sourceTime=timing.sourceRange[0]+tailStart+.4*(2*u-2*u**3+u**4),weight=u**3*(u*(u*6-15)+10);
    const error=sourcePoseError(probe,sourceTime,source,weight);tailTimingSamples.push({clip:source.name,fraction:u,sourceTime,restWeight:weight,error,settleProgress:state.settleProgress});
    check(`${source.name}-tail-${fraction}-preserves-decelerated-source-and-smooth-rest-blend`,()=>{assert.ok(error<3e-6,`source/blend error ${error}`);assert.ok(Math.abs(state.settleProgress-weight)<1e-7);});
  }
  probe.motion.dispose();
}
check('posture-integration-only-lists-authorized-five-bones',()=>{assert.ok(postureSourceComparisons.length>20);assert.ok(postureSourceComparisons.every(sample=>sample.runtime&&JSON.stringify(sample.runtime.bones)===JSON.stringify([...permittedPostureBones])));});
check('posture-integration-preserves-all-other-local-transforms',()=>assert.ok(postureSourceComparisons.every(sample=>sample.unchangedLocalError<3e-6)));
check('posture-integration-keeps-spine-corrections-within-reviewed-bounds',()=>{for(const sample of postureSourceComparisons){for(const[name,limit]of Object.entries({Spine:14,Spine1:14,Spine2:20,Neck:15}))assert.ok(sample.localCorrectionDegrees[name]<=limit+.00001,JSON.stringify(sample));assert.ok(sample.localCorrectionDegrees.Head<=63.00001,JSON.stringify(sample));}});
check('full-weight-action-retains-original-world-head-direction',()=>{const full=postureSourceComparisons.filter(sample=>sample.restWeight<1e-8);assert.ok(full.length>20);assert.ok(full.every(sample=>sample.headWorldDirectionError<1e-5),JSON.stringify(full.map(({clip,sourceTime,headWorldDirectionError})=>({clip,sourceTime,headWorldDirectionError}))));});
check('posture-is-baked-before-blending-with-no-live-correction-gate',()=>{for(const sample of postureSourceComparisons){const state=sample.runtime;assert.equal(state.baked,true);assert.equal(state.mode,'observed');assert.equal(state.active,false);assert.equal(state.correctionDegrees,0);assert.equal(state.clips.Nod.forcedSupport,true);assert.equal(state.clips.Wave.forcedSupport,true);assert.equal(state.clips.Walk.forcedSupport,false);assert.equal(state.clips.LookAround.forcedSupport,false);}});
const initialStationRest=[];
for(let station=0;station<STATION_CLIPS.length;station++){
  const probe=rig();probe.motion.setStation(station);for(let frame=0;frame<600;frame++)probe.motion.update(0);
  const error=poseError(probe,probe.restPose),state=probe.motion.getState();initialStationRest.push({station,action:state.action,error,feet:footPose(probe),posture:state.posture});
  check(`station-${station+1}-paused-first-frame-stays-original-rest`,()=>{assert.ok(error<1e-6);assert.equal(state.time,0);assert.equal(state.posture.active,false);assert.equal(state.posture.correctionDegrees,0);});
  probe.motion.dispose();
}
// The upper-back adjustment is active in Nod/Wave, so test their integration
// boundaries as well as Walk's existing detailed startup/ending regression.
const stationContinuity=[];
for(let station=0;station<STATION_CLIPS.length;station++){
  const probe=rig();probe.motion.setStation(station);probe.motion.update(0);probe.outer.updateMatrixWorld(true);
  const initial=probe.motion.getState(),duration=initial.duration/initial.speed;
  let previous=[...probe.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3())),maxOpeningStep=0,maxEndingStep=0,openingWorst=null,endingWorst=null;
  for(let frame=1;frame<=Math.ceil((duration+.6)*240);frame++){
    probe.motion.update(1/240);probe.outer.position.copy(probe.motion.position);probe.outer.updateMatrixWorld(true);
    const now=[...probe.bones.values()].map(({bone})=>bone.getWorldPosition(new THREE.Vector3())),step=Math.max(...now.map((point,index)=>point.distanceTo(previous[index]))),time=frame/240;
    const worstIndex=now.findIndex((point,index)=>point.distanceTo(previous[index])===step),worst={time,bone:[...probe.bones.keys()][worstIndex],step,posture:probe.motion.getState().posture};
    if(time<=.6&&step>maxOpeningStep){maxOpeningStep=step;openingWorst=worst;}
    if(time>=duration-initial.playbackTiming.settleSeconds-.05&&step>maxEndingStep){maxEndingStep=step;endingWorst=worst;}
    previous=now;
  }
  const finalRestError=idlePoseErrorAgainstSource(probe);
  stationContinuity.push({station,clip:STATION_CLIPS[station],duration,maxOpeningStep,maxEndingStep,finalRestError,openingWorst,endingWorst});
  check(`station-${station+1}-startup-stays-below-20mm-per-240hz-frame`,()=>assert.ok(maxOpeningStep<.02,`${STATION_CLIPS[station]} startup ${maxOpeningStep} m`));
  check(`station-${station+1}-ending-stays-below-20mm-per-240hz-frame`,()=>{assert.ok(maxEndingStep<.02,`${STATION_CLIPS[station]} ending ${maxEndingStep} m`);assert.ok(finalRestError<1e-6);});
  probe.motion.dispose();
}
const breathingSamples=[],breathingProbe=rig(),breathingBaseFeet=footPose(breathingProbe);
const breathingBaseHead=breathingProbe.bones.get('Head').bone.getWorldPosition(new THREE.Vector3()),breathingBaseHeadDirection=breathingProbe.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
for(const time of[0,1.2,2.4,3.6,4.8,9.6,300]){
  tick(breathingProbe,time-breathingProbe.motion.getState().breathing.time);
  const state=breathingProbe.motion.getState(),breath=state.breathing,head=breathingProbe.bones.get('Head').bone.getWorldPosition(new THREE.Vector3()),lift=head.y-breathingBaseHead.y;
  const error=idlePoseErrorAgainstSource(breathingProbe),expectedLift=.0028*expectedBreathAmount(breath.time),headDirection=breathingProbe.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
  breathingSamples.push({time:breath.time,phase:breath.phase,amount:breath.amount,lift,expectedLift,baselineError:error});
  check(`idle-breathing-${time}-matches-independent-4_8sec-cosine`,()=>{assert.equal(breath.periodSeconds,4.8);assert.equal(breath.maximumLiftMetres,.0028);assert.equal(breath.weight,time===0?0:1);assert.ok(Math.abs(breath.time-time)<1e-7);assert.ok(Math.abs(breath.amount-expectedBreathAmount(breath.time))<1e-10);assert.ok(Math.abs(lift-expectedLift)<1e-7);assert.ok(error<1e-6);});
  check(`idle-breathing-${time}-keeps-feet-root-and-head-direction-fixed`,()=>{assert.deepEqual(footPose(breathingProbe),breathingBaseFeet);assert.equal(breathingProbe.motion.position.length(),0);assert.ok(Math.abs(head.x-breathingBaseHead.x)<1e-8);assert.ok(Math.abs(head.z-breathingBaseHead.z)<1e-8);assert.ok(headDirection.angleTo(breathingBaseHeadDirection)<1e-6);assert.equal(state.posture.active,false);});
}
check('idle-breathing-is-subtle-but-not-a-frozen-pose',()=>{assert.ok(Math.max(...breathingSamples.map(sample=>sample.lift))>.00279);assert.ok(Math.min(...breathingSamples.map(sample=>sample.lift))<1e-8);assert.ok(breathingSamples.every(sample=>sample.lift>=-1e-8&&sample.lift<=.00280001));});
const phaseProbe=rig(),phaseEvents=[];tick(phaseProbe,1.1);
for(const station of[WALK_STATION,NOD_STATION,WAVE_STATION,LOOK_AROUND_STATION]){
  const before=phaseProbe.motion.getState().breathing;phaseProbe.motion.setStation(station);phaseProbe.motion.update(0);const entered=phaseProbe.motion.getState().breathing;
  phaseEvents.push({event:'station',station,before:before.time,after:entered.time,phase:entered.phase});
  check(`station-${station+1}-does-not-reset-breathing-phase`,()=>{assert.equal(entered.time,before.time);assert.equal(entered.phase,before.phase);});
  tick(phaseProbe,.75);const playing=phaseProbe.motion.getState();
  check(`station-${station+1}-retains-low-level-breathing-during-action`,()=>{assert.ok(Math.abs(playing.breathing.weight-.2)<1e-10);assert.ok(playing.breathing.time>entered.time);assert.ok(Math.abs(playing.breathing.liftMetres-.0028*.2*expectedBreathAmount(playing.breathing.time))<1e-10);});
  finishEntry(phaseProbe);const ready=phaseProbe.motion.getState().breathing;
  check(`station-${station+1}-reaction-is-available-after-smooth-settle`,()=>assert.equal(phaseProbe.motion.react(),true));phaseProbe.motion.update(0);
  const reacted=phaseProbe.motion.getState().breathing;phaseEvents.push({event:'reaction',station,before:ready.time,after:reacted.time,phase:reacted.phase});
  check(`station-${station+1}-click-does-not-reset-breathing-phase`,()=>{assert.equal(reacted.time,ready.time);assert.equal(reacted.phase,ready.phase);});
  finishEntry(phaseProbe);
}
tick(phaseProbe,.25);const beforeBreathingPause=phaseProbe.motion.getState(),beforeBreathingPausePose=savePose(phaseProbe);
for(let frame=0;frame<480;frame++)phaseProbe.motion.update(0);
check('paused-presentation-freezes-breathing-time-phase-and-pose',()=>{assert.deepEqual(phaseProbe.motion.getState().breathing,beforeBreathingPause.breathing);assert.ok(poseError(phaseProbe,beforeBreathingPausePose)<1e-6);});
tick(phaseProbe,2,{dragging:true});
check('dragging-freezes-breathing-time-phase-and-pose',()=>{assert.deepEqual(phaseProbe.motion.getState().breathing,beforeBreathingPause.breathing);assert.ok(poseError(phaseProbe,beforeBreathingPausePose)<1e-6);});
phaseProbe.motion.update(1/120);
check('resuming-increments-existing-breathing-clock-without-restart',()=>assert.ok(Math.abs(phaseProbe.motion.getState().breathing.time-beforeBreathingPause.breathing.time-1/120)<1e-10));
check('reduced-motion-never-adds-breathing',()=>{const state=reduced.motion.getState();assert.equal(state.breathing.time,0);assert.equal(state.breathing.weight,0);assert.equal(state.breathing.liftMetres,0);assert.ok(poseError(reduced,reduced.restPose)<1e-6);});
// Compare each endpoint against an independently running Idle at the same
// presentation time. Breathing velocity must not be mistaken for a stop error.
const settleKinematics=[];
for(let station=0;station<STATION_CLIPS.length;station++){
  const probe=rig(),idle=rig();probe.motion.setStation(station);probe.motion.update(0);
  const initial=probe.motion.getState(),duration=initial.duration/initial.speed,settleStart=duration-initial.playbackTiming.settleSeconds,names=[...probe.bones.keys()];
  let previousOffsets=null,previousVelocity=null,maxEndpointVelocity=0,maxEndpointAcceleration=0,maxEndpointResidual=0,maxSettleWristSpeed=0,previousHands=null;
  const endpointSamples=[];let maxSettleCurve=-Infinity,maxSettleMiddleDeviation=0,maxSettleHeadStep=0,previousHead=probe.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
  for(let frame=1;frame<=Math.ceil((duration+.05)*240);frame++){
    for(const context of[probe,idle]){context.motion.update(1/240);context.outer.position.copy(context.motion.position);context.outer.updateMatrixWorld(true);}
    const time=frame/240,state=probe.motion.getState(),offsets=names.map(name=>probe.bones.get(name).bone.getWorldPosition(new THREE.Vector3()).sub(idle.bones.get(name).bone.getWorldPosition(new THREE.Vector3())));
    const head=probe.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
    if(time>=settleStart){maxSettleCurve=Math.max(maxSettleCurve,state.posture.after.curve);maxSettleMiddleDeviation=Math.max(maxSettleMiddleDeviation,Math.abs(state.posture.after.middle-state.posture.reference.middle));maxSettleHeadStep=Math.max(maxSettleHeadStep,head.angleTo(previousHead));}
    const velocity=previousOffsets?offsets.map((value,index)=>value.clone().sub(previousOffsets[index]).multiplyScalar(240)):offsets.map(()=>new THREE.Vector3());
    const acceleration=previousVelocity?velocity.map((value,index)=>value.clone().sub(previousVelocity[index]).multiplyScalar(240)):offsets.map(()=>new THREE.Vector3());
    const hands=['LeftHand','RightHand'].map(name=>probe.bones.get(name).bone.getWorldPosition(new THREE.Vector3()));
    if(previousHands&&time>=settleStart)maxSettleWristSpeed=Math.max(maxSettleWristSpeed,...hands.map((point,index)=>point.distanceTo(previousHands[index])*240));
    if(time>=duration-.025){
      maxEndpointVelocity=Math.max(maxEndpointVelocity,...velocity.map(value=>value.length()));maxEndpointAcceleration=Math.max(maxEndpointAcceleration,...acceleration.map(value=>value.length()));maxEndpointResidual=Math.max(maxEndpointResidual,...offsets.map(value=>value.length()));
      endpointSamples.push({time,residual:Math.max(...offsets.map(value=>value.length())),velocity:Math.max(...velocity.map(value=>value.length())),acceleration:Math.max(...acceleration.map(value=>value.length()))});
    }
    previousOffsets=offsets;previousVelocity=velocity;previousHands=hands;previousHead.copy(head);
  }
  const completedSamples=endpointSamples.filter(sample=>sample.time>=duration),afterOneFrame=endpointSamples.filter(sample=>sample.time>=duration+1/240);
  const completedAcceleration=Math.max(...completedSamples.map(sample=>sample.acceleration)),afterOneFrameAcceleration=Math.max(...afterOneFrame.map(sample=>sample.acceleration));
  settleKinematics.push({station,clip:STATION_CLIPS[station],duration,settleStart,settleSeconds:initial.playbackTiming.settleSeconds,maxEndpointVelocity,maxEndpointAcceleration,completedAcceleration,afterOneFrameAcceleration,maxEndpointResidual,maxSettleWristSpeed,maxSettleCurve,maxSettleMiddleDeviation,maxSettleHeadStep,endpointSamples});
  check(`station-${station+1}-endpoint-converges-to-same-phase-idle-position`,()=>assert.ok(maxEndpointResidual<.0001,`${STATION_CLIPS[station]} final25ms residual ${maxEndpointResidual} m`));
  check(`station-${station+1}-endpoint-velocity-converges-without-snap`,()=>assert.ok(maxEndpointVelocity<.01,`${STATION_CLIPS[station]} final25ms residual velocity ${maxEndpointVelocity} m/s`));
  check(`station-${station+1}-endpoint-acceleration-converges-smoothly`,()=>{assert.ok(completedAcceleration<.12,`${STATION_CLIPS[station]} completed residual acceleration ${completedAcceleration} m/s2`);assert.ok(afterOneFrameAcceleration<.02,`${STATION_CLIPS[station]} after one frame ${afterOneFrameAcceleration} m/s2`);assert.ok(completedAcceleration<endpointSamples[0].acceleration*.25,`${STATION_CLIPS[station]} acceleration did not converge through final25ms`);});
  check(`station-${station+1}-head-direction-has-no-angular-pop-during-settle`,()=>assert.ok(maxSettleHeadStep<THREE.MathUtils.degToRad(2),`${STATION_CLIPS[station]} head step ${THREE.MathUtils.radToDeg(maxSettleHeadStep)} deg/240Hz frame`));
  if(station===NOD_STATION||station===WAVE_STATION)check(`station-${station+1}-never-rehunches-while-returning-to-breathing-idle`,()=>{assert.ok(maxSettleCurve<=3.2,`curve ${maxSettleCurve}`);assert.ok(maxSettleMiddleDeviation<.3,`middle deviation ${maxSettleMiddleDeviation}`);});
  probe.motion.dispose();idle.motion.dispose();
}
for(const[index,context]of[sample,walk,interrupted,paused,rootFixture,rotated,reduced,rapid,reaction,ending,longIdle,lookAround,fadeInterrupt,excerptProbe,walkPoseProbe,stableWalk,interruptedHold,initialDefault,entryContinuity,seamRootFixture,initialNonWalk,resumedDrag,breathingProbe,phaseProbe].entries()){
  context.motion.dispose();check(`fixture-${index}-dispose-restores-original-local-transforms`,()=>assert.ok(poseError(context,context.restPose)<1e-6));
}
const finalAssetBytes=await readFile(new URL(assetPath,import.meta.url));
check('original-glb-bytes-are-unchanged',()=>assert.equal(createHash('sha256').update(finalAssetBytes).digest('hex'),assetSHA256));
const result={behavior:'upright-rest-all-stations',asset:{path:assetPath,bytes:assetBytes.length,sha256:assetSHA256,sourceBounds,sourceHeight,sceneHeight,normalizationScale,joints:sample.bones.size},checks:reports,stationClips:STATION_CLIPS,walkStation:WALK_STATION,walkOpening:{sourceTime:null,wholeBody:true,mode:'upright-breathing',walkOpeningRestError,walkOpeningFeet,maxOpeningBoneStep},uprightIdle:{sourceTime:null,mode:'upright-breathing',expected:'complete original GLB bind/rest transforms captured before runtime construction',restFeet,historicalIdleSourceFeet:idleSourceFeet,stableFeet,stableRestError,stableLongIdleError,postNodRestError,resumedIdlePoseChange,interruptedRestError},walk2:{sourceDuration:walkSourceDuration,runtimeDuration:walkDuration,speed:1,inPlace:true,sourceHorizontalExcursion:sourceRootMaxExcursion,sourcePoseSamples:walkSourcePoseSamples,nonzeroRootFixtureEnd:fixtureEnd.toArray(),seam:{at:walkSourceDuration,maxSeamBoneStep,maxSeamRootStep,minFixtureForwardStep,maxFixtureForwardStep,samples:seamSamples}},lookAround:{station:LOOK_AROUND_STATION,sourceDuration:suppliedLookAround.duration,sourceRange:lookAroundStart.lookAroundRange,runtimeDuration:lookAroundStart.duration,speed:lookAroundStart.speed,sourcePoseSamples,replaySourceError,turnExcursionRadians:Object.fromEntries(turnNames.map((name,i)=>[name,turnExcursion[i]])),postIdlePoseError:postLookAroundIdlePoseError},walkWorldEnd:end.toArray(),interruptedWorldEnd:partial.toArray(),endingSamples,maxEndingBoneStep,maxWeightError,idlePoseError,frameRates,notes:'Actual restored original-resolution GLB animation arrays used. All four stations and the Walk initial frame now use the complete original bind/rest posture, independently captured from GLB nodes before runtime construction. Historical Idle samples remain only as evidence of the old forward-foot step. World-space thresholds are unchanged: 1.83m character scale and <0.02m bone displacement per 240Hz frame for startup, ending and repeated gait seam. Walk extends2.375 to3.6sec at original rate1. Source animation arrays and GLB are not modified. Only explicitly labelled root fixtures add synthetic displacement. This report does not assert browser appearance or absence of drawstring intersections.'};
result.posture={permittedLocalQuaternionBones:[...permittedPostureBones],sourceComparisons:postureSourceComparisons,initialStationRest,stationContinuity,maxUnchangedLocalError:Math.max(...postureSourceComparisons.map(sample=>sample.unchangedLocalError)),maxHeadWorldDirectionError:Math.max(...postureSourceComparisons.map(sample=>sample.headWorldDirectionError))};
result.behavior='upright-breathing-with-baked-support-and-smooth-settle';
result.breathing={periodSeconds:BREATHING_PERIOD,liftsMetres:BREATHING_LIFTS,totalMaximumLift:.0028,samples:breathingSamples,phaseEvents};
result.settling={tailTimingSamples,kinematics:settleKinematics,endpointWindowSeconds:.025,thresholds:{positionMetres:.0001,velocityMetresPerSecond:.01,completedAccelerationMetresPerSecondSquared:.12,afterOneFrameAccelerationMetresPerSecondSquared:.02,headStepDegreesAt240Hz:2}};
result.notes='Actual original-resolution GLB and independently captured raw GLB bind/rest transforms are used. The original files and animation arrays remain unchanged. Breathing is checked against an independent4.8-second cosine with1.6mm/1.2mm world-Y translations, phase continuity, frozen pause/drag/reduced-motion and stable feet/root. Only Spine/Spine1/Spine2/Neck/Head local rotations may differ through bounded source-clip baking. Full-weight actions retain source world head direction; mixed poses are assessed as corrected-source-to-Rest blends, not incorrectly described as identical to the raw source. Baking before mixing prevents the live nonlinear posture gate from bending the chest again during settling. Nod/Wave settling checks enforce curvature<=3.2deg and middle deviation<0.3deg from Rest. The final0.4 source seconds of Nod/Wave/LookAround are retimed to0.8 clip seconds and mixed into breathing Rest with a quintic curve. Endpoint kinematics compare against a separate Idle rig at identical presentation time. Existing1.83m normalization and20mm/240Hz continuity thresholds are unchanged. This report does not assert browser appearance or absence of drawstring intersections.';
await mkdir(new URL('../qa/breathing/',import.meta.url),{recursive:true});await writeFile(new URL('../qa/breathing/motion-results.json',import.meta.url),JSON.stringify(result,null,2));
const failures=reports.filter(check=>!check.passed);
console.log(JSON.stringify({report:'qa/breathing/motion-results.json',passed:reports.length-failures.length,total:reports.length,failures,assetSHA256,maxOpeningBoneStep,maxEndingBoneStep,maxSeamBoneStep,stableRestError,walkOpeningRestError},null,2));
if(failures.length)process.exitCode=1;
