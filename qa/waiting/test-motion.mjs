/** Verify Blender-authored performances against actual GLTFLoader bone samples. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacterMotion, STATION_CLIPS } from '../../src/motion.js';

const root = new URL('../../', import.meta.url);
const reportDirectory = process.argv.find(argument => argument.startsWith('--output-dir='))?.slice('--output-dir='.length) || 'qa/waiting';
const expectedWaitDuration = Number(process.argv.find(argument => argument.startsWith('--wait-duration='))?.slice('--wait-duration='.length) || 8);
if (!/^(?:qa|output)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(reportDirectory)) throw new Error('Output directory must be a project-relative qa/... or output/... path.');
if (!Number.isFinite(expectedWaitDuration) || expectedWaitDuration <= 0) throw new Error('Expected Wait duration must be positive.');
const reportURL = new URL(`${reportDirectory}/motion-results.json`, root);
const authoredBytes = await readFile(new URL('public/models/person-authored-animated.glb', root));
const originalBytes = await readFile(new URL('public/models/person-original-animated.glb', root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], check = (name, test) => { try { test(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
const limits = { endpointMetres: 1e-5, endpointRadians: 1e-5, velocityMismatchMetresPerSecond: .020,
  angularVelocityMismatchDegreesPerSecond: 2, boneStepMetresAt240Hz: .020, playbackError: 1e-5 };
const endpointResults = [], runtimeResults = [];
function decode(bytes) { const jsonLength = bytes.readUInt32LE(12); return { json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), binary: bytes.subarray(28 + jsonLength) }; }
const sourceGLB = decode(originalBytes), targetGLB = decode(authoredBytes);
// Independently fingerprinted from the previously published 28ddcb... asset.
// Fingerprints include bone target/path, interpolation, and all animation bytes,
// but not accessor indices or relocated offsets introduced by repacking Wait.
const previousPublishedAnimationSHA256 = {
  Idle: 'd842585b9163f4f2c43461579dc3407e5a5dd9e2d778867b2df23018607ea8c3',
  Walk: 'dad3381483068436f1fe7a9173459be6533d9d3ece1d274daee0a6e26cd37466',
  Nod: '25f4f31be903a20bb75096bcad3bd3888d44a7188162d89ef1b270185f187d2d',
  Wave: 'b6055635f1d1feae2a5e3d14408fba9d69e1b718bc88143b0ace6f092da22042',
};
function animationDigest(animation) {
  const accessor = index => {
    const data = targetGLB.json.accessors[index], view = targetGLB.json.bufferViews[data.bufferView];
    const offset = (view.byteOffset || 0) + (data.byteOffset || 0);
    return { type: data.type, count: data.count, componentType: data.componentType, data: targetGLB.binary.subarray(offset, offset + view.byteLength).toString('base64') };
  };
  return sha(JSON.stringify(animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler];
    return { node: targetGLB.json.nodes[channel.target.node].name, path: channel.target.path, interpolation: sampler.interpolation,
      input: accessor(sampler.input), output: accessor(sampler.output) };
  })));
}
const currentAnimationSHA256 = {};
for (const [name, expected] of Object.entries(previousPublishedAnimationSHA256)) {
  currentAnimationSHA256[name] = animationDigest(targetGLB.json.animations.find(animation => animation.name === name));
  check(`${name}-animation-targets-and-key-bytes-match-the-previous-published-version`, () => assert.equal(currentAnimationSHA256[name], expected));
}
check('original-animated-GLB-has-reviewed-immutable-SHA256', () => assert.equal(sha(originalBytes), 'fda0ce34395d895f6d18b39a40b65affd3f622401a2f76b1f2beaf152955a036'));
const originalBlendSHA256 = sha(await readFile(new URL('../person.blend', root)));
check('original-person-blend-remains-unmodified', () => assert.equal(originalBlendSHA256, '51363cd344cf3538e1b82a26b1e6921d52e3bbd734b5b78375844c679bd0f16d'));
check('original-binary-prefix-is-byte-identical-in-authored-asset', () => assert.ok(targetGLB.binary.subarray(0, sourceGLB.binary.length).equals(sourceGLB.binary)));
for (const key of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'scenes']) check(`original-${key}-JSON-is-unchanged`, () => assert.deepEqual(targetGLB.json[key], sourceGLB.json[key]));
for (const key of ['accessors', 'bufferViews']) check(`original-${key}-prefix-is-unchanged`, () => assert.deepEqual(targetGLB.json[key].slice(0, sourceGLB.json[key].length), sourceGLB.json[key]));
const images = [];
for (const image of targetGLB.json.images) {
  const view = targetGLB.json.bufferViews[image.bufferView], jpeg = targetGLB.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength), info = await sharp(jpeg).metadata();
  images.push({ sha256: sha(jpeg), width: info.width, height: info.height, bytes: jpeg.length });
}
check('original-JPEGs-still-4096-square-and-embedded-at-original-offsets', () => { assert.ok(images.length); images.forEach(image => { assert.equal(image.width, 4096); assert.equal(image.height, 4096); }); });
const arraySnapshot = clips => JSON.stringify(clips.map(clip => clip.tracks.map(track => [track.name, Array.from(track.times), Array.from(track.values)])));
async function rig({ runtime = false, reducedMotion = false } = {}) {
  const loader = new GLTFLoader();
  // No image decoder is available in Node. Only decoded Texture objects are
  // stubbed; the real loader builds every mesh, bone, track and inverse bind.
  loader.register(() => ({ name: 'HEADLESS_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(authoredBytes.buffer.slice(authoredBytes.byteOffset, authoredBytes.byteOffset + authoredBytes.byteLength), '');
  const model = gltf.scene, outer = new THREE.Group(), bones = new Map(), meshes = [];
  model.traverse(object => { if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i, ''), { bone: object, rest: object.quaternion.clone() }); if (object.isSkinnedMesh) meshes.push(object); });
  model.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(model); model.scale.multiplyScalar(1.83 / (bounds.max.y - bounds.min.y));
  outer.add(model); outer.updateMatrixWorld(true);
  const rest = new Map([...bones].map(([name, { bone }]) => [name, { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }]));
  const context = { gltf, model, outer, bones, meshes, rest, sourceSnapshot: arraySnapshot(gltf.animations) };
  if (runtime) context.motion = createCharacterMotion({ model, bones, animations: gltf.animations, reducedMotion });
  return context;
}
function pose(context) {
  context.outer.updateMatrixWorld(true);
  return new Map([...context.bones].map(([name, { bone }]) => [name, { p: bone.position.clone(), q: bone.quaternion.clone().normalize(), s: bone.scale.clone(), world: bone.getWorldPosition(new THREE.Vector3()), worldQ: bone.getWorldQuaternion(new THREE.Quaternion()).normalize() }]));
}
function sample(context, name, time) {
  for (const [boneName, initial] of context.rest) { const bone = context.bones.get(boneName).bone; bone.position.copy(initial.p); bone.quaternion.copy(initial.q); bone.scale.copy(initial.s); }
  const clip = context.gltf.animations.find(clip => clip.name === name);
  for (const track of clip.tracks) {
    const binding = THREE.PropertyBinding.parseTrackName(track.name), name = binding.nodeName.replace(/^mixamorig[:_]?/i, '');
    context.bones.get(name).bone[binding.propertyName].fromArray(track.createInterpolant().evaluate(Math.max(0, Math.min(clip.duration, time))));
  }
  return pose(context);
}
function errors(a, b) {
  const result = { world: 0, localPosition: 0, rotation: 0, scale: 0, worstWorldBone: null };
  for (const [name, actual] of a) {
    const expected = b.get(name), world = actual.world.distanceTo(expected.world);
    if (world > result.world) { result.world = world; result.worstWorldBone = name; }
    result.localPosition = Math.max(result.localPosition, actual.p.distanceTo(expected.p)); result.rotation = Math.max(result.rotation, actual.q.angleTo(expected.q)); result.scale = Math.max(result.scale, actual.s.distanceTo(expected.s));
  }
  return result;
}
function angularVelocity(a, b, dt) {
  const q = b.clone().multiply(a.clone().invert()).normalize(); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w))), sine = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  return sine < 1e-8 ? new THREE.Vector3() : new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(angle / (sine * dt));
}
function velocityMismatch(before, at, after, dt) {
  const result = { position: 0, angular: 0, positionBone: null, angularBone: null };
  for (const [name, current] of at) {
    const p = current.world.clone().sub(before.get(name).world).divideScalar(dt), n = after.get(name).world.clone().sub(current.world).divideScalar(dt), distance = p.distanceTo(n);
    const av = angularVelocity(before.get(name).worldQ, current.worldQ, dt), nv = angularVelocity(current.worldQ, after.get(name).worldQ, dt), rotation = THREE.MathUtils.radToDeg(av.distanceTo(nv));
    if (distance > result.position) { result.position = distance; result.positionBone = name; }
    if (rotation > result.angular) { result.angular = rotation; result.angularBone = name; }
  }
  return result;
}
function velocityDifference(a0, a1, b0, b1, dt) {
  const result = { position: 0, angular: 0, positionBone: null, angularBone: null };
  for (const [name, end] of a1) {
    const a = end.world.clone().sub(a0.get(name).world).divideScalar(dt), b = b1.get(name).world.clone().sub(b0.get(name).world).divideScalar(dt);
    const distance = a.distanceTo(b), rotation = THREE.MathUtils.radToDeg(angularVelocity(a0.get(name).worldQ, end.worldQ, dt).distanceTo(angularVelocity(b0.get(name).worldQ, b1.get(name).worldQ, dt)));
    if (distance > result.position) { result.position = distance; result.positionBone = name; }
    if (rotation > result.angular) { result.angular = rotation; result.angularBone = name; }
  }
  return result;
}
function step(context, dt = 1 / 240, options) { context.motion.update(dt, options); context.outer.position.copy(context.motion.position); context.outer.updateMatrixWorld(true); }
function tick(context, duration, options) { for (let i = 0; i < Math.ceil(duration * 240); i++) step(context, 1 / 240, options); }
function maxStep(a, b) { let value = 0, bone = null; for (const [name, p] of a) { const distance = p.world.distanceTo(b.get(name).world); if (distance > value) { value = distance; bone = name; } } return { value, bone }; }

const reference = await rig(), idle = reference.gltf.animations.find(clip => clip.name === 'Idle'), idlePeriod = idle.duration;
const idle0 = sample(reference, 'Idle', 0), idleEnd = sample(reference, 'Idle', idlePeriod);
check('actual-GLTFLoader-preserves-65-bones-and-original-topology', () => { assert.equal(reference.bones.size, 65); assert.equal(reference.meshes.length, 1); assert.equal(reference.meshes[0].geometry.attributes.position.count, 11922); assert.equal(reference.meshes[0].geometry.index.count / 3, 10892); });
check('exactly-five-approved-actions-without-facial-tracks', () => { assert.deepEqual(reference.gltf.animations.map(clip => clip.name), ['Idle', 'Walk', 'Nod', 'Wave', 'Wait']); for (const clip of reference.gltf.animations) assert.ok(clip.tracks.every(track => !track.name.includes('morphTarget'))); });
check(`Wait-has-the-requested-${expectedWaitDuration}-second-duration`, () => assert.ok(Math.abs(reference.gltf.animations.find(clip => clip.name === 'Wait').duration - expectedWaitDuration) < 1e-5));
check('Idle-loop-endpoint-matches-start-on-all-65-bones', () => { const difference = errors(idleEnd, idle0); assert.ok(difference.world < limits.endpointMetres); assert.ok(difference.rotation < limits.endpointRadians); });
const idleSeam = velocityMismatch(sample(reference, 'Idle', idlePeriod - 1 / 240), idle0, sample(reference, 'Idle', 1 / 240), 1 / 240);
check('Idle-loop-velocity-has-no-visible-splice', () => { assert.ok(idleSeam.position < limits.velocityMismatchMetresPerSecond, JSON.stringify(idleSeam)); assert.ok(idleSeam.angular < limits.angularVelocityMismatchDegreesPerSecond, JSON.stringify(idleSeam)); });
for (const clip of reference.gltf.animations.filter(clip => clip.name !== 'Idle')) {
  const phase = clip.duration % idlePeriod, first = sample(reference, clip.name, 0), last = sample(reference, clip.name, clip.duration), matchedIdle = sample(reference, 'Idle', phase);
  const entryError = errors(first, idle0), exitError = errors(last, matchedIdle);
  const entryVelocity = velocityMismatch(sample(reference, 'Idle', idlePeriod - 1 / 240), first, sample(reference, clip.name, 1 / 240), 1 / 240);
  const exitVelocity = velocityMismatch(sample(reference, clip.name, clip.duration - 1 / 240), last, sample(reference, 'Idle', phase + 1 / 240), 1 / 240);
  // A real 60Hz baked Idle is already piecewise linear. Compare against its
  // same-phase velocity on the same side, so ordinary Idle key acceleration
  // is not misclassified as a new gesture-to-Idle seam. Retain raw mismatches.
  const entryMatchedIdleVelocityError = velocityDifference(first, sample(reference, clip.name, 1 / 240), idle0, sample(reference, 'Idle', 1 / 240), 1 / 240);
  const exitMatchedIdleVelocityError = velocityDifference(sample(reference, clip.name, clip.duration - 1 / 240), last, sample(reference, 'Idle', phase - 1 / 240), matchedIdle, 1 / 240);
  const idleAtExitVelocity = velocityMismatch(sample(reference, 'Idle', phase - 1 / 240), matchedIdle, sample(reference, 'Idle', phase + 1 / 240), 1 / 240);
  endpointResults.push({ clip: clip.name, duration: clip.duration, idlePhase: phase, entryError, exitError, entryVelocity, exitVelocity, idleAtExitVelocity, entryMatchedIdleVelocityError, exitMatchedIdleVelocityError });
  check(`${clip.name}-first-frame-matches-real-Idle-zero`, () => { assert.ok(entryError.world < limits.endpointMetres, JSON.stringify(entryError)); assert.ok(entryError.rotation < limits.endpointRadians, JSON.stringify(entryError)); });
  check(`${clip.name}-last-frame-matches-its-corresponding-Idle-phase`, () => { assert.ok(exitError.world < limits.endpointMetres, JSON.stringify(exitError)); assert.ok(exitError.rotation < limits.endpointRadians, JSON.stringify(exitError)); });
  check(`${clip.name}-entry-and-return-velocity-matches-same-phase-Idle-at-240Hz`, () => { for (const mismatch of [entryMatchedIdleVelocityError, exitMatchedIdleVelocityError]) { assert.ok(mismatch.position < limits.velocityMismatchMetresPerSecond, JSON.stringify(mismatch)); assert.ok(mismatch.angular < limits.angularVelocityMismatchDegreesPerSecond, JSON.stringify(mismatch)); } });
}

const idleMotion = { rotations: {}, maximumPositionDelta: 0, maximumFootWorldDelta: 0, handExcursion: 0, frames: 0 };
for (let frame = 0; frame <= 4.8 * 240; frame++) {
  const current = sample(reference, 'Idle', frame / 240); idleMotion.frames++;
  for (const [name, value] of current) {
    idleMotion.rotations[name] = Math.max(idleMotion.rotations[name] || 0, THREE.MathUtils.radToDeg(value.q.angleTo(idle0.get(name).q)));
    idleMotion.maximumPositionDelta = Math.max(idleMotion.maximumPositionDelta, value.p.distanceTo(idle0.get(name).p));
    if (/Foot|Toe|Hips/.test(name)) idleMotion.maximumFootWorldDelta = Math.max(idleMotion.maximumFootWorldDelta, value.world.distanceTo(idle0.get(name).world));
    if (/Hand$/.test(name)) idleMotion.handExcursion = Math.max(idleMotion.handExcursion, value.world.distanceTo(idle0.get(name).world));
  }
}
check('Idle-is-real-rotation-motion-in-spine-neck-arms', () => {
  assert.ok(Math.max(...['Spine', 'Spine1', 'Spine2'].map(name => idleMotion.rotations[name])) > .1);
  assert.ok(Math.max(idleMotion.rotations.Neck, idleMotion.rotations.Head) > .1);
  assert.ok(Math.max(idleMotion.rotations.LeftArm, idleMotion.rotations.RightArm) > .1);
  assert.ok(idleMotion.handExcursion > .001);
});
check('Idle-does-not-fake-breathing-by-translating-bones', () => assert.ok(idleMotion.maximumPositionDelta < 1e-6, String(idleMotion.maximumPositionDelta)));
check('Idle-hips-feet-and-toes-stay-planted', () => assert.ok(idleMotion.maximumFootWorldDelta < 1e-5, String(idleMotion.maximumFootWorldDelta)));

for (let station = 0; station < 4; station++) {
  const context = await rig({ runtime: true }), name = STATION_CLIPS[station]; context.motion.setStation(station);
  const duration = context.motion.getState().duration, result = { clip: name, frames: 0, maximumStep: 0, maximumPlaybackError: 0, boundaryMaximumStep: 0, worstStep: null, rightWristToTorsoMinimum: Infinity };
  let previous = pose(context);
  for (let frame = 1; frame <= Math.ceil((duration + 2) * 240); frame++) {
    step(context); const current = pose(context), state = context.motion.getState(), time = frame / 240, jump = maxStep(previous, current);
    result.frames++; if (jump.value > result.maximumStep) { result.maximumStep = jump.value; result.worstStep = { time, bone: jump.bone, state: state.action }; }
    if (Math.abs(time - duration) < .05) result.boundaryMaximumStep = Math.max(result.boundaryMaximumStep, jump.value);
    if (state.weights.length === 1 && frame % 12 === 0) {
      const expected = sample(reference, state.action, state.time), error = errors(current, expected);
      result.maximumPlaybackError = Math.max(result.maximumPlaybackError, error.world, error.rotation, error.localPosition, error.scale);
    }
    if (name === 'Wave') {
      const line = new THREE.Line3(current.get('Hips').world, current.get('Neck').world), closest = line.closestPointToPoint(current.get('RightHand').world, true, new THREE.Vector3());
      result.rightWristToTorsoMinimum = Math.min(result.rightWristToTorsoMinimum, closest.distanceTo(current.get('RightHand').world));
    }
    previous = current;
  }
  runtimeResults.push(result);
  check(`${name}-runtime-returns-to-Idle-without-a-second-fade`, () => { const state = context.motion.getState(); assert.equal(state.action, 'Idle'); assert.equal(state.completedAction, name); assert.equal(state.weights.length, 1); assert.equal(state.transition, null); assert.ok(state.transitions.some(item => item.reason === 'authored-return' && item.fade === 0)); });
  check(`${name}-full-runtime-no-20mm-per-240Hz-bone-pop`, () => assert.ok(result.maximumStep < limits.boneStepMetresAt240Hz, JSON.stringify(result.worstStep) + ` ${result.maximumStep}`));
  check(`${name}-runtime-plays-authored-tracks-without-a-posture-solver`, () => { assert.ok(result.maximumPlaybackError < limits.playbackError, String(result.maximumPlaybackError)); assert.equal(context.motion.getState().posture.runtimeCorrection, false); });
  check(`${name}-runtime-does-not-modify-loaded-animation-arrays`, () => assert.equal(arraySnapshot(context.gltf.animations), context.sourceSnapshot));
  console.log(`${name}: ${result.frames} frames, maximum step ${(result.maximumStep * 1000).toFixed(3)} mm, return ${(result.boundaryMaximumStep * 1000).toFixed(3)} mm.`);
  context.motion.dispose();
}

const rapid = await rig({ runtime: true }), rapidResult = { frames: 0, maximumStep: 0, worstStep: null }; let previous = pose(rapid);
for (let frame = 1; frame <= 48 * 36; frame++) {
  if ((frame - 1) % 36 === 0) rapid.motion.setStation(Math.floor((frame - 1) / 36) % 4);
  step(rapid); const current = pose(rapid), jump = maxStep(previous, current); rapidResult.frames++;
  if (jump.value > rapidResult.maximumStep) { rapidResult.maximumStep = jump.value; rapidResult.worstStep = { frame, bone: jump.bone }; } previous = current;
}
check('48-rapid-interruptions-retain-the-existing-20mm-per-240Hz-bound', () => assert.ok(rapidResult.maximumStep < limits.boneStepMetresAt240Hz, JSON.stringify(rapidResult)));
tick(rapid, 10);
check('rapid-interruptions-eventually-retire-all-stale-actions', () => { assert.equal(rapid.motion.getState().action, 'Idle'); assert.equal(rapid.motion.getState().weights.length, 1); assert.equal(rapid.motion.getState().transition, null); });
const waitStation = STATION_CLIPS.indexOf('Wait'), waitInterruptions = [];
for (const from of STATION_CLIPS.keys()) for (const to of STATION_CLIPS.keys()) {
  if (from === to || (from !== waitStation && to !== waitStation)) continue;
  for (const fraction of [.25, .6, .9]) {
    const context = await rig({ runtime: true }); context.motion.setStation(from);
    tick(context, context.motion.getState().duration * fraction);
    let previous = pose(context); context.motion.setStation(to);
    const result = { from: STATION_CLIPS[from], to: STATION_CLIPS[to], fraction, maximumStep: 0, worst: null };
    for (let frame = 1; frame <= 240; frame++) {
      step(context); const current = pose(context), jump = maxStep(previous, current);
      if (jump.value > result.maximumStep) { result.maximumStep = jump.value; result.worst = { frame, bone: jump.bone }; }
      previous = current;
    }
    tick(context, context.motion.getState().duration + 1);
    check(`Wait-interruption-${result.from}-to-${result.to}-at-${fraction}-is-continuous-and-cleans-up`, () => {
      assert.ok(result.maximumStep < limits.boneStepMetresAt240Hz, JSON.stringify(result));
      assert.equal(context.motion.getState().action, 'Idle'); assert.equal(context.motion.getState().weights.length, 1);
    });
    waitInterruptions.push(result); context.motion.dispose();
  }
}
const frameRates = [];
for (const rate of [30, 60, 120, 'jitter']) {
  const context = await rig({ runtime: true }); context.motion.setStation(STATION_CLIPS.indexOf('Wait')); let elapsed = 0, frame = 0, firstIdle = null;
  while (elapsed < context.gltf.animations.find(clip => clip.name === 'Wait').duration + 1) {
    const dt = rate === 'jitter' ? [.008, .038, .016, .091][frame % 4] : 1 / rate; step(context, dt); elapsed += dt; frame++;
    const state = context.motion.getState();
    if (state.end && !firstIdle) firstIdle = { elapsed, phase: state.time, expectedPhase: elapsed % idlePeriod, difference: errors(pose(context), sample(reference, 'Idle', state.time)) };
  }
  frameRates.push({ rate, firstIdle });
  check(`${rate}-fps-return-splits-exactly-at-action-boundary`, () => { assert.ok(firstIdle); assert.ok(Math.abs(firstIdle.phase - firstIdle.expectedPhase) < 1e-5); assert.ok(firstIdle.difference.world < limits.endpointMetres); assert.ok(firstIdle.difference.rotation < limits.endpointRadians); });
}
const paused = await rig({ runtime: true }); paused.motion.setStation(2); tick(paused, 1.2); const beforePause = pose(paused), beforeState = paused.motion.getState();
tick(paused, 2, { paused: true }); tick(paused, 2, { dragging: true });
check('paused-or-dragging-freezes-action-and-all-bones', () => { assert.equal(paused.motion.getState().time, beforeState.time); assert.ok(errors(pose(paused), beforePause).world < 1e-12); });
const reduced = await rig({ runtime: true, reducedMotion: true });
for (let station = 0; station < 4; station++) { reduced.motion.setStation(station); tick(reduced, 1); }
check('reduced-motion-holds-authored-Idle-zero-not-bind-pose', () => { const difference = errors(pose(reduced), idle0); assert.ok(difference.world < limits.endpointMetres); assert.ok(difference.rotation < limits.endpointRadians); assert.equal(reduced.motion.getState().idleAnimation.animated, false); });
const long = await rig({ runtime: true }); tick(long, 300); const longState = long.motion.getState(), longError = errors(pose(long), sample(reference, 'Idle', longState.time));
check('five-minute-real-Idle-loop-has-no-transform-drift', () => { assert.equal(long.motion.position.length(), 0); assert.ok(longError.world < limits.endpointMetres); assert.ok(longError.rotation < limits.endpointRadians); });

const moduleHashes = {};
for (const path of ['src/motion.js', 'scripts/blender_edit_motion.py', 'qa/waiting/test-motion.mjs']) moduleHashes[path] = sha(await readFile(new URL(path, root)));
const finalAuthoredBytes = await readFile(new URL('public/models/person-authored-animated.glb', root));
check('authored-asset-remains-unchanged-through-the-entire-test', () => assert.equal(sha(finalAuthoredBytes), sha(authoredBytes)));
const report = { createdAt: new Date().toISOString(), method: 'Actual GLTFLoader, independent keyframe interpolation, 65-bone world positions and world quaternion finite differences at 240Hz; original binary and mesh/UV/texture metadata comparisons.',
  scope: 'Natural coordinated Blender Actions and animated Idle. No old exact-Rest upright-angle standard is applied.',
  limitations: ['Numeric bone continuity does not substitute for visible gesture review.', 'Wrist-to-torso-axis distance is diagnostic and is not mesh collision proof.', 'Baked linear 60Hz animation is piecewise differentiable; 240Hz velocity checks bound the two sides of each clip splice rather than claiming mathematical C1 for every key.'],
  limits, hashes: { original: sha(originalBytes), originalBlend: originalBlendSHA256, authored: sha(authoredBytes), modules: moduleHashes,
    previousPublishedAsset: '28ddcb8629174322495add57936bc27e8851dd7a5bb682602a46b728902bfda0', previousPublishedAnimationSHA256, currentAnimationSHA256 }, images,
  expectedWaitDuration, idlePeriod, idleSeam, endpointResults, idleMotion, runtimeResults, rapidResult, waitInterruptions, frameRates, longError,
  checks, passed: checks.filter(item => item.passed).length, total: checks.length };
await mkdir(new URL(`${reportDirectory}/`, root), { recursive: true }); await writeFile(reportURL, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.passed}/${report.total} authored-motion checks passed.`);
checks.filter(item => !item.passed).forEach(item => console.error(`${item.name}: ${item.error}`));
process.exitCode = report.passed === report.total ? 0 : 1;
