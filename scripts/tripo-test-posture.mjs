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
const allowed = new Set(['Spine1', 'Spine2', 'Head']);
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
const entries = [{ name: 'Nod', start: 0 }, { name: 'Wave', start: 1.2, end: 4.3 }, { name: 'LookAround', start: 1.2, end: 7 }, { name: 'Walk', start: 0 }];
const sampling = [], examples = [];
let maxHeadError = 0, maxHeadLocalDegrees = 0, maxCorrectionStep = 0, unchanged = 0, frameCount = 0;
for (const entry of entries) {
  context.posture.reset(); context.mixer.stopAllAction();
  const clip = context.animations.find(clip => clip.name === entry.name), end = entry.end ?? clip.duration;
  const action = context.mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  let previousOffsets = null, clipFrames = 0, clipMax = 0, naturalFrames = 0;
  for (let frame = 0; frame <= Math.ceil((end - entry.start) * 240); frame++) {
    const time = Math.min(end, entry.start + frame / 240); context.posture.reset(); context.mixer.setTime(time); context.model.updateWorldMatrix(true, true);
    const before = localPose(context), beforeWorld = worldPose(context), head = direction(context); context.posture.update();
    const afterWorld = worldPose(context), state = context.posture.state();
    assertOriginalLocals(context, before, allowed);
    for (const name of ['Hips', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) assert.ok(beforeWorld.get(name).distanceTo(afterWorld.get(name)) < 1e-12, `${entry.name} ${time}: ${name} moved`);
    const error = direction(context).angleTo(head); maxHeadError = Math.max(maxHeadError, error);
    const headLocalDegrees = THREE.MathUtils.radToDeg(closeQuaternion(context.bones.get('Head').bone.quaternion, before.get('Head').quaternion)); maxHeadLocalDegrees = Math.max(maxHeadLocalDegrees, headLocalDegrees);
    assert.ok(state.correctionDegrees >= 0 && state.correctionDegrees <= 8); assert.ok(state.spine1Degrees >= 0 && state.spine1Degrees <= 3.6); assert.ok(state.spine2Degrees <= 0 && state.spine2Degrees >= -8);
    if (!state.active) { assertOriginalLocals(context, before); unchanged++; naturalFrames++; }
    const offsets = new Map([...afterWorld].map(([name, position]) => [name, position.clone().sub(beforeWorld.get(name))]));
    if (previousOffsets) for (const [name, offset] of offsets) maxCorrectionStep = Math.max(maxCorrectionStep, offset.distanceTo(previousOffsets.get(name)));
    previousOffsets = offsets; frameCount++; clipFrames++; clipMax = Math.max(clipMax, state.correctionDegrees);
    if (Math.abs(time - ({ Nod: 1, Wave: 2, LookAround: 2.6, Walk: 1.2 }[entry.name])) < 1e-8) examples.push({ clip: entry.name, time, ...state });
  }
  sampling.push({ clip: entry.name, start: entry.start, end, frames: clipFrames, maxCorrectionDegrees: clipMax, naturalFrames });
}
check('all-four-source-performances-only-change-three-authorized-local-rotations', () => assert.ok(frameCount > 2500));
check('hips-legs-and-feet-never-move-from-posture-correction', () => assert.ok(frameCount > 2500));
check('source-head-world-gaze-is-preserved-through-all-samples', () => assert.ok(maxHeadError < 1e-6, `${maxHeadError} radians`));
check('head-compensation-stays-within-the-4_4-degree-support-change', () => assert.ok(maxHeadLocalDegrees < 4.401, `${maxHeadLocalDegrees} degrees`));
check('correction-adds-no-5mm-pop-per-frame-at-240Hz', () => assert.ok(maxCorrectionStep < .005, `${maxCorrectionStep} m`));
check('naturally-upright-source-frames-are-untouched', () => { assert.ok(unchanged > 0); const natural = examples.filter(sample => sample.clip === 'LookAround' || sample.clip === 'Walk'); assert.equal(natural.length, 2); assert.ok(natural.every(sample => sample.correctionDegrees === 0)); });
context.posture.reset(); context.mixer.stopAllAction(); context.mixer.clipAction(context.animations.find(clip => clip.name === 'Nod')).play(); context.mixer.setTime(1); context.model.updateWorldMatrix(true, true);
const repeatedSource = localPose(context); context.posture.update(); const repeatedCorrected = localPose(context);
for (let frame = 0; frame < 1200; frame++) context.posture.update();
check('repeated-update-without-new-mixer-sample-does-not-accumulate', () => { for (const name of allowed) assert.ok(closeQuaternion(context.bones.get(name).bone.quaternion, repeatedCorrected.get(name).quaternion) < 1e-7); });
context.posture.reset(); check('reset-exactly-restores-the-uncorrected-source-frame', () => assertOriginalLocals(context, repeatedSource));
// A fixture deliberately omits all three corrected tracks, so the mixer cannot
// accidentally mask a missing-reset bug by overwriting the last frame's edits.
context.mixer.stopAllAction();
for (const [name, { bone }] of context.bones) { const source = repeatedSource.get(name); bone.position.copy(source.position); bone.quaternion.copy(source.quaternion); bone.scale.copy(source.scale); }
context.model.updateWorldMatrix(true, true);
const omittedTrackPose = localPose(context); const neck = context.bones.get('Neck').bone;
const fixture = new THREE.AnimationClip('NoCorrectedTracks', 1, [new THREE.QuaternionKeyframeTrack(`${neck.name}.quaternion`, [0, 1], [...neck.quaternion.toArray(), ...neck.quaternion.toArray()])]);
context.mixer.clipAction(fixture).play(); context.posture.update(); const missingTrackCorrected = localPose(context);
for (let frame = 0; frame < 1200; frame++) { context.posture.reset(); context.mixer.update(1 / 120); context.posture.update(); }
check('omitted-spine-and-head-tracks-cannot-accumulate-correction', () => { assert.ok(context.posture.state().correctionDegrees > 7); for (const name of allowed) assert.ok(closeQuaternion(context.bones.get(name).bone.quaternion, missingTrackCorrected.get(name).quaternion) < 1e-7); });
context.posture.reset(); context.mixer.stopAllAction(); check('omitted-track-fixture-restores-the-original-local-pose', () => assertOriginalLocals(context, omittedTrackPose));
const rotated = createRig({ yaw: .7, scale: 1.4 }); rotated.mixer.clipAction(rotated.animations.find(clip => clip.name === 'Nod')).play(); rotated.mixer.setTime(1); rotated.model.updateWorldMatrix(true, true); const rotatedHead = direction(rotated); rotated.posture.update();
check('parent-yaw-and-scale-preserve-head-direction-and-correction-limit', () => { assert.ok(direction(rotated).angleTo(rotatedHead) < 1e-6); assert.ok(Math.abs(rotated.posture.state().correctionDegrees - examples.find(sample => sample.clip === 'Nod').correctionDegrees) < 1e-6); });
check('original-animation-time-and-value-arrays-stay-byte-equivalent', () => context.animations.forEach((clip, index) => clip.tracks.forEach((track, trackIndex) => { assert.deepEqual(Array.from(track.times), originalSource[index][trackIndex].times); assert.deepEqual(Array.from(track.values), originalSource[index][trackIndex].values); })));
const result = { asset: 'public/models/person-original-animated.glb', sha256: createHash('sha256').update(assetBytes).digest('hex'), checks: reports, frameCount, sampling, unchangedFrames: unchanged, maxHeadDirectionErrorRadians: maxHeadError, maxHeadCompensationDegrees: maxHeadLocalDegrees, maxCorrectionOffsetChangePer240HzFrameMetres: maxCorrectionStep, examples, notes: 'Independent actual-GLB posture-module checks. Only local Spine1/Spine2/Head rotations may change; head world gaze and every lower-body transform remain unchanged. The test includes deliberately omitted corrected tracks and repeated update calls to detect cumulative corrections. Screenshot review is separate; this report does not assert all-frame cloth clearance.' };
await mkdir(new URL('../qa/posture/', import.meta.url), { recursive: true }); await writeFile(new URL('../qa/posture/correction-results.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checks: reports.length, frameCount, sampling, maxHeadError, maxHeadLocalDegrees, maxCorrectionStep }, null, 2));
