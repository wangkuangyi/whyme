import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import * as THREE from 'three';
import { createPostureCorrection } from '../src/posture.js';

const assetURL = new URL('../public/models/person-original-animated.glb', import.meta.url);
const assetBytes = await readFile(assetURL), document = await new NodeIO().readBinary(assetBytes);
const bounds = getBounds(document.getRoot().listScenes()[0]), normalization = 1.83 / (bounds.max[1] - bounds.min[1]);
const allowed = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);
const reports = [], check = (name, test) => { test(); reports.push({ name, passed: true }); };
function createRig({ yaw = 0, scale = 1 } = {}) {
  const outer = new THREE.Group(), model = new THREE.Group(), mapping = new Map(), bones = new Map();
  outer.rotation.y = yaw; outer.scale.setScalar(scale); outer.add(model); model.scale.setScalar(normalization);
  const joints = new Set(document.getRoot().listSkins().flatMap(skin => skin.listJoints()));
  for (const node of document.getRoot().listNodes()) {
    const object = joints.has(node) ? new THREE.Bone() : new THREE.Group();
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.getName()); object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale()); mapping.set(node, object);
    if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i, ''), { bone: object });
  }
  for (const [node, object] of mapping) for (const child of node.listChildren()) object.add(mapping.get(child));
  for (const node of document.getRoot().listScenes()[0].listChildren()) model.add(mapping.get(node));
  const animations = document.getRoot().listAnimations().map(animation => new THREE.AnimationClip(animation.getName(), -1, animation.listChannels().map(channel => {
    const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[channel.getTargetPath()];
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${mapping.get(channel.getTargetNode()).name}.${property}`, channel.getSampler().getInput().getArray().slice(), channel.getSampler().getOutput().getArray().slice());
  })));
  model.updateWorldMatrix(true, true);
  return { model, outer, bones, animations, mixer: new THREE.AnimationMixer(model), posture: createPostureCorrection({ model, bones }) };
}
const localPose = context => new Map([...context.bones].map(([name, { bone }]) => [name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
const worldPose = context => new Map([...context.bones].map(([name, { bone }]) => [name, bone.getWorldPosition(new THREE.Vector3())]));
const direction = context => context.bones.get('Head').bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
const closeQuaternion = (a, b) => a.clone().normalize().angleTo(b.clone().normalize());
function assertOriginalLocals(context, before, ignore = new Set()) {
  for (const [name, { bone }] of context.bones) {
    const expected = before.get(name); assert.ok(bone.position.equals(expected.position), `${name} position changed`); assert.ok(bone.scale.equals(expected.scale), `${name} scale changed`);
    if (!ignore.has(name)) assert.ok(bone.quaternion.equals(expected.quaternion), `${name} quaternion changed`);
  }
}
const context = createRig(), originalRest = localPose(context), originalSource = context.animations.map(clip => clip.tracks.map(track => ({ times: Array.from(track.times), values: Array.from(track.values) })));
context.posture.update();
check('original-whole-body-rest-is-not-corrected', () => { assert.equal(context.posture.state().correctionDegrees, 0); assert.equal(context.posture.state().active, false); assertOriginalLocals(context, originalRest); });
const entries = [{ name: 'Nod', start: 0 }, { name: 'Wave', start: .9, end: 4.75 }, { name: 'LookAround', start: 1.2, end: 7.4 }, { name: 'Walk', start: 0 }];
const sampling = [], examples = [];
let maxHeadError = 0, maxHeadLocalDegrees = 0, maxCorrectionStep = 0, unchanged = 0, frameCount = 0, maxSupportedCurve = 0, maxSupportedReferenceError = 0;
for (const entry of entries) {
  context.posture.reset(); context.mixer.stopAllAction();
  const clip = context.animations.find(clip => clip.name === entry.name), end = entry.end ?? clip.duration;
  const action = context.mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  let previousOffsets = null, clipFrames = 0, clipMax = 0, naturalFrames = 0;
  for (let frame = 0; frame <= Math.ceil((end - entry.start) * 240); frame++) {
    const time = Math.min(end, entry.start + frame / 240); context.posture.reset(); context.mixer.setTime(time); context.model.updateWorldMatrix(true, true);
    const before = localPose(context), beforeWorld = worldPose(context), head = direction(context); context.posture.update(['Nod', 'Wave'].includes(entry.name) ? { support: 1 } : undefined);
    const afterWorld = worldPose(context), state = context.posture.state();
    assertOriginalLocals(context, before, allowed);
    for (const name of ['Hips', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) assert.ok(beforeWorld.get(name).distanceTo(afterWorld.get(name)) < 1e-12, `${entry.name} ${time}: ${name} moved`);
    const error = direction(context).angleTo(head); maxHeadError = Math.max(maxHeadError, error);
    const headLocalDegrees = THREE.MathUtils.radToDeg(closeQuaternion(context.bones.get('Head').bone.quaternion, before.get('Head').quaternion)); maxHeadLocalDegrees = Math.max(maxHeadLocalDegrees, headLocalDegrees);
    assert.ok(state.correctionDegrees >= 0 && state.correctionDegrees <= 20);
    for (const [key, limit] of [['spineDegrees', 14], ['spine1Degrees', 14], ['spine2Degrees', 20], ['neckDegrees', 15]]) assert.ok(Math.abs(state[key]) <= limit);
    if (state.activation === 1) {
      maxSupportedCurve = Math.max(maxSupportedCurve, state.after.curve);
      for (const key of ['lower', 'middle', 'upper', 'neck']) maxSupportedReferenceError = Math.max(maxSupportedReferenceError, Math.abs(state.after[key] - state.targets[key]));
    }
    if (!state.active) { assertOriginalLocals(context, before); unchanged++; naturalFrames++; }
    const offsets = new Map([...afterWorld].map(([name, position]) => [name, position.clone().sub(beforeWorld.get(name))]));
    if (previousOffsets) for (const [name, offset] of offsets) maxCorrectionStep = Math.max(maxCorrectionStep, offset.distanceTo(previousOffsets.get(name)));
    previousOffsets = offsets; frameCount++; clipFrames++; clipMax = Math.max(clipMax, state.correctionDegrees);
    if (Math.abs(time - ({ Nod: 1, Wave: 2, LookAround: 2.6, Walk: 1.2 }[entry.name])) < 1e-8) examples.push({ clip: entry.name, time, ...state });
  }
  sampling.push({ clip: entry.name, start: entry.start, end, frames: clipFrames, maxCorrectionDegrees: clipMax, naturalFrames });
}
check('all-four-source-performances-only-change-five-authorized-local-rotations', () => assert.ok(frameCount > 3500));
check('hips-legs-and-feet-never-move-from-posture-correction', () => assert.ok(frameCount > 2500));
check('source-head-world-gaze-is-preserved-through-all-samples', () => assert.ok(maxHeadError < 1e-6, `${maxHeadError} radians`));
check('head-compensation-is-bounded-by-the-15-degree-neck-support-limit', () => assert.ok(maxHeadLocalDegrees < 15.001, `${maxHeadLocalDegrees} degrees`));
check('fully-supported-nod-and-wave-reach-three-degree-chest-curve', () => assert.ok(maxSupportedCurve < 3.0001, `${maxSupportedCurve} degrees`));
check('fully-supported-segments-reach-rest-based-targets', () => assert.ok(maxSupportedReferenceError < .0001, `${maxSupportedReferenceError} degrees`));
check('correction-adds-no-5mm-pop-per-frame-at-240Hz', () => assert.ok(maxCorrectionStep < .005, `${maxCorrectionStep} m`));
check('naturally-upright-source-frames-are-untouched', () => { assert.ok(unchanged > 0); const natural = examples.filter(sample => sample.clip === 'LookAround' || sample.clip === 'Walk'); assert.equal(natural.length, 2); assert.ok(natural.every(sample => sample.correctionDegrees === 0)); });
context.posture.reset(); context.mixer.stopAllAction(); context.mixer.clipAction(context.animations.find(clip => clip.name === 'Nod')).play(); context.mixer.setTime(1); context.model.updateWorldMatrix(true, true);
const repeatedSource = localPose(context); context.posture.update(); const repeatedCorrected = localPose(context);
for (let frame = 0; frame < 1200; frame++) context.posture.update();
check('repeated-update-without-new-mixer-sample-does-not-accumulate', () => { for (const name of allowed) assert.ok(closeQuaternion(context.bones.get(name).bone.quaternion, repeatedCorrected.get(name).quaternion) < 1e-7); });
context.posture.reset(); check('reset-exactly-restores-the-uncorrected-source-frame', () => assertOriginalLocals(context, repeatedSource));
// A fixture deliberately omits all five corrected tracks, so the mixer cannot
// accidentally mask a missing-reset bug by overwriting the last frame's edits.
context.mixer.stopAllAction();
for (const [name, { bone }] of context.bones) { const source = repeatedSource.get(name); bone.position.copy(source.position); bone.quaternion.copy(source.quaternion); bone.scale.copy(source.scale); }
context.model.updateWorldMatrix(true, true);
const omittedTrackPose = localPose(context); const hand = context.bones.get('LeftHand').bone;
const fixture = new THREE.AnimationClip('NoCorrectedTracks', 1, [new THREE.QuaternionKeyframeTrack(`${hand.name}.quaternion`, [0, 1], [...hand.quaternion.toArray(), ...hand.quaternion.toArray()])]);
context.mixer.clipAction(fixture).play(); context.posture.update(); const missingTrackCorrected = localPose(context);
for (let frame = 0; frame < 1200; frame++) { context.posture.reset(); context.mixer.update(1 / 120); context.posture.update(); }
check('omitted-spine-and-head-tracks-cannot-accumulate-correction', () => { assert.ok(context.posture.state().correctionDegrees > 7); for (const name of allowed) assert.ok(closeQuaternion(context.bones.get(name).bone.quaternion, missingTrackCorrected.get(name).quaternion) < 1e-7); });
context.posture.reset(); context.mixer.stopAllAction(); check('omitted-track-fixture-restores-the-original-local-pose', () => assertOriginalLocals(context, omittedTrackPose));
const rotated = createRig({ yaw: .7, scale: 1.4 }); rotated.mixer.clipAction(rotated.animations.find(clip => clip.name === 'Nod')).play(); rotated.mixer.setTime(1); rotated.model.updateWorldMatrix(true, true); const rotatedHead = direction(rotated); rotated.posture.update();
check('parent-yaw-and-scale-preserve-head-direction-and-correction-limit', () => { assert.ok(direction(rotated).angleTo(rotatedHead) < 1e-6); assert.ok(Math.abs(rotated.posture.state().correctionDegrees - examples.find(sample => sample.clip === 'Nod').correctionDegrees) < 1e-6); });
check('original-animation-time-and-value-arrays-stay-byte-equivalent', () => context.animations.forEach((clip, index) => clip.tracks.forEach((track, trackIndex) => { assert.deepEqual(Array.from(track.times), originalSource[index][trackIndex].times); assert.deepEqual(Array.from(track.values), originalSource[index][trackIndex].values); })));

function restoreLocals(rig, pose) {
  rig.posture.reset();
  for (const [name, { bone }] of rig.bones) { const source = pose.get(name); bone.position.copy(source.position); bone.quaternion.copy(source.quaternion); bone.scale.copy(source.scale); }
  rig.model.updateWorldMatrix(true, true);
}
const gateRig = createRig(), gateRest = localPose(gateRig);
function probeGate(deviation) {
  restoreLocals(gateRig, gateRest);
  const joint = gateRig.bones.get('Spine1').bone;
  const axis = gateRig.bones.get('LeftUpLeg').bone.getWorldPosition(new THREE.Vector3()).sub(gateRig.bones.get('RightUpLeg').bone.getWorldPosition(new THREE.Vector3())); axis.y = 0; axis.normalize();
  const world = joint.getWorldQuaternion(new THREE.Quaternion()).normalize().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -THREE.MathUtils.degToRad(deviation)));
  joint.quaternion.copy(joint.parent.getWorldQuaternion(new THREE.Quaternion()).normalize().invert().multiply(world)).normalize();
  gateRig.model.updateWorldMatrix(true, true); gateRig.posture.update(); return gateRig.posture.state();
}
const gateSamples = [3.999, 4, 4.001, 8.999, 9, 9.001].map(deviation => ({ deviation, ...probeGate(deviation) }));
check('support-gate-has-continuous-value-velocity-and-acceleration-at-both-boundaries', () => {
  const h = .001;
  for (const endpoint of [4, 9]) {
    const [left, centre, right] = [endpoint - h, endpoint, endpoint + h].map(d => probeGate(d).activation);
    assert.ok(Math.abs(right - left) / (2 * h) < 1e-5, `gate velocity at ${endpoint}`);
    assert.ok(Math.abs(right - 2 * centre + left) / (h * h) < .001, `gate acceleration at ${endpoint}`);
  }
  assert.equal(probeGate(3.99).active, false); assert.equal(probeGate(9.01).activation, 1);
});
check('all-correction-parameters-remain-bounded-on-extreme-source-poses', () => {
  for (const deviation of [15, 30, 60, 90, -30]) {
    const state = probeGate(deviation);
    for (const [key, limit] of [['spineDegrees', 14], ['spine1Degrees', 14], ['spine2Degrees', 20], ['neckDegrees', 15]]) assert.ok(Number.isFinite(state[key]) && Math.abs(state[key]) <= limit);
  }
});

const blends = [];
for (const [name, sourceTime] of [['Nod', 3], ['Wave', 4.75]]) {
  const rig = createRig(), rest = localPose(rig), clip = rig.animations.find(clip => clip.name === name);
  const action = rig.mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); rig.mixer.setTime(sourceTime); rig.model.updateWorldMatrix(true, true);
  const rawSource = localPose(rig); rig.posture.update({ support: 1 }); const source = localPose(rig); rig.posture.reset(); rig.mixer.stopAllAction();
  check(`${name.toLowerCase()}-explicit-support-can-bake-source-without-changing-source-samples`, () => {
    restoreLocals(rig, rawSource); rig.posture.update({ support: 0 }); assertOriginalLocals(rig, rawSource);
    rig.posture.update({ support: 1 }); assert.ok(Math.abs(rig.posture.state().curveAfter - 3) < .0001);
    const applied = localPose(rig); const observed = rig.posture.inspect(); assert.equal(observed.mode, 'observed'); assertOriginalLocals(rig, applied);
    rig.posture.reset(); assertOriginalLocals(rig, rawSource);
  });
  let previous = null, maxStep = 0, maxCurve = 0, maxMiddleDeviation = 0, maxCurveStep = 0, previousCurve = null, last;
  // Source is corrected BEFORE blending. Reapplying the nonlinear support gate
  // to an already blended pose would incorrectly bend the chest halfway back.
  // Runtime tests separately cover the actual sampled clip tail and breathing.
  for (let frame = 0; frame <= 192; frame++) {
    const t = frame / 192, weight = t ** 3 * (t * (t * 6 - 15) + 10); rig.posture.reset();
    for (const [boneName, { bone }] of rig.bones) {
      const from = source.get(boneName), to = rest.get(boneName);
      bone.position.copy(from.position).lerp(to.position, weight); bone.quaternion.copy(from.quaternion).slerp(to.quaternion, weight); bone.scale.copy(from.scale).lerp(to.scale, weight);
      if (frame === 192) { bone.position.copy(to.position); bone.quaternion.copy(to.quaternion); bone.scale.copy(to.scale); }
    }
    rig.model.updateWorldMatrix(true, true); const before = worldPose(rig), gaze = direction(rig), locals = localPose(rig); const state = rig.posture.inspect(), after = worldPose(rig); assertOriginalLocals(rig, locals);
    assert.ok(direction(rig).angleTo(gaze) < 1e-6);
    for (const leg of ['Hips', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) assert.ok(before.get(leg).distanceTo(after.get(leg)) < 1e-12);
    if (previous) for (const [boneName, position] of after) maxStep = Math.max(maxStep, position.distanceTo(previous.get(boneName)));
    if (previousCurve !== null) maxCurveStep = Math.max(maxCurveStep, Math.abs(state.curveAfter - previousCurve));
    maxCurve = Math.max(maxCurve, state.curveAfter); maxMiddleDeviation = Math.max(maxMiddleDeviation, Math.abs(state.after.middle - state.reference.middle));
    previous = after; previousCurve = state.curveAfter; last = state;
  }
  check(`${name.toLowerCase()}-return-to-rest-has-no-pop-and-reaches-original-support`, () => {
    assert.ok(maxStep < .005, `${maxStep} m/frame`); assert.ok(maxCurveStep < .1, `${maxCurveStep} deg/frame`);
    assert.ok(maxCurve < 3.05, `${maxCurve} degree intermediate chest bend`); assert.ok(maxMiddleDeviation < .05, `${maxMiddleDeviation} degree support drift`);
    assert.equal(last.active, false); assert.ok(Math.abs(last.after.middle - last.reference.middle) < 1e-5); assertOriginalLocals(rig, rest);
  });
  blends.push({ clip: name, sourceTime, duration: .8, samples: 193, maxBoneStepMetres: maxStep, maxCurveStepDegrees: maxCurveStep, maxCurveDegrees: maxCurve, maxMiddleDeviationFromRestDegrees: maxMiddleDeviation, final: last });
}
const result = { asset: 'public/models/person-original-animated.glb', sha256: createHash('sha256').update(assetBytes).digest('hex'), moduleSha256: createHash('sha256').update(await readFile(new URL('../src/posture.js', import.meta.url))).digest('hex'), checks: reports, frameCount, sampling, unchangedFrames: unchanged, maxHeadDirectionErrorRadians: maxHeadError, maxHeadCompensationDegrees: maxHeadLocalDegrees, maxCorrectionOffsetChangePer240HzFrameMetres: maxCorrectionStep, maxSupportedCurveDegrees: maxSupportedCurve, maxSupportedReferenceErrorDegrees: maxSupportedReferenceError, examples, gateSamples, blends, notes: 'Independent actual-GLB posture-module checks. Only local Spine/Spine1/Spine2/Neck/Head rotations may change; head world gaze and every lower-body transform remain unchanged. The test includes deliberately omitted corrected tracks and repeated update calls to detect cumulative corrections. Return-to-rest fixtures blend PRECORRECTED source poses into Rest and use inspect() only; runtime clip baking, timing and breathing are covered separately. Screenshot review is separate; this report does not assert all-frame cloth clearance.' };
await mkdir(new URL('../qa/breathing/', import.meta.url), { recursive: true }); await writeFile(new URL('../qa/breathing/correction-results.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checks: reports.length, frameCount, sampling, maxHeadError, maxHeadLocalDegrees, maxCorrectionStep }, null, 2));
