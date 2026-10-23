/** Check camera directions against the actual animated character, not azimuth signs alone. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STATION_CLIPS } from '../../src/motion.js';

const root = new URL('../../', import.meta.url), checks = [];
const sha = data => createHash('sha256').update(data).digest('hex');
const bytes = await readFile(new URL('public/models/person-authored-animated.glb', root));
const sceneSource = await readFile(new URL('src/scene.js', root), 'utf8');
const check = (name, test) => { try { test(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
// Read the real configured shots; do not keep a second independent set of angles.
const shotsText = sceneSource.match(/const SHOTS = \[([\s\S]*?)\];/)?.[1];
assert.ok(shotsText, 'SHOTS must remain a literal configuration array.');
const shots = [...shotsText.matchAll(/\{([^}]+)\}/g)].map(([, text]) => Object.fromEntries([...text.matchAll(/(\w+)\s*:\s*(-?[.\d]+)/g)].map(([, key, value]) => [key, Number(value)])));
assert.equal(shots.length, STATION_CLIPS.length);
const restFills = sceneSource.match(/const REST_FILLS = \[([^\]]+)\]/)?.[1].split(',').map(Number);
assert.equal(restFills.length, STATION_CLIPS.length);
const loader = new GLTFLoader();
loader.register(() => ({ name: 'HEADLESS_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = gltf.scene, bones = new Map();
model.traverse(object => { if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i, ''), object); });
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model), HEIGHT = 1.83;
model.scale.multiplyScalar(HEIGHT / (box.max.y - box.min.y)); model.updateMatrixWorld(true);
box.setFromObject(model); const center = box.getCenter(new THREE.Vector3());
model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); model.updateMatrixWorld(true);
const rest = new Map([...bones].map(([name, bone]) => [name, { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }]));
const position = name => bones.get(name).getWorldPosition(new THREE.Vector3());
const clips = new Map(gltf.animations.map(clip => [clip.name, {
  duration: clip.duration,
  tracks: clip.tracks.map(track => ({ binding: THREE.PropertyBinding.parseTrackName(track.name), interpolant: track.createInterpolant() })),
}]));
function sample(name, time) {
  for (const [boneName, pose] of rest) { const bone = bones.get(boneName); bone.position.copy(pose.p); bone.quaternion.copy(pose.q); bone.scale.copy(pose.s); }
  for (const { binding, interpolant } of clips.get(name).tracks) bones.get(binding.nodeName.replace(/^mixamorig[:_]?/i, ''))[binding.propertyName].fromArray(interpolant.evaluate(time));
  model.updateMatrixWorld(true);
}
function frame(leftName, rightName) {
  const left = position(leftName).sub(position(rightName)).normalize();
  const up = position('Spine2').sub(position('Hips')).normalize();
  const forward = left.clone().cross(up).normalize();
  return { left, forward, headingDegrees: THREE.MathUtils.radToDeg(Math.atan2(forward.x, forward.z)) };
}
function cameraFor(profile) {
  const camera = new THREE.PerspectiveCamera(profile.fov, 1440 / 1000, .02, 100);
  const target = new THREE.Vector3(0, HEIGHT * profile.lookY, 0), azimuth = THREE.MathUtils.degToRad(profile.azimuth);
  const elevation = (profile.camY - profile.lookY) / profile.dist;
  let distance = HEIGHT / (2 * Math.tan(THREE.MathUtils.degToRad(profile.fov / 2)) * profile.fill);
  for (let iteration = 0; iteration < 4; iteration++) {
    camera.position.set(Math.sin(azimuth) * distance, HEIGHT * profile.lookY + elevation * distance, Math.cos(azimuth) * distance);
    camera.lookAt(target); camera.updateMatrixWorld();
    const top = new THREE.Vector3(0, HEIGHT, 0).project(camera), bottom = new THREE.Vector3().project(camera);
    distance *= Math.abs(top.y - bottom.y) / (profile.fill * 2);
  }
  return { camera, target };
}
function delta(camera, point, direction) {
  const start = point.clone().project(camera), end = point.clone().addScaledVector(direction, .3).project(camera);
  return [(end.x - start.x) * 720, -(end.y - start.y) * 500];
}
sample('Idle', 0);
const landmarks = Object.fromEntries(['LeftShoulder', 'RightShoulder', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(name => [name, position(name).toArray()]));
check('rest rig: anatomical left is +X and toe forward is +Z', () => {
  assert.ok(landmarks.LeftShoulder[0] > landmarks.RightShoulder[0]);
  for (const side of ['Left', 'Right']) assert.ok(landmarks[`${side}ToeBase`][2] > landmarks[`${side}Foot`][2]);
});
check('station mapping selects Walk at 01 and Wait at 03', () => { assert.equal(STATION_CLIPS[0], 'Walk'); assert.equal(STATION_CLIPS[2], 'Wait'); });
check('final asset contains Wait and no active LookAround', () => { assert.ok(clips.has('Wait')); assert.ok(!clips.has('LookAround')); });
const sequences = [];
for (const [name, station] of [['Walk', 0], ['Wait', 2]]) for (const phase of ['gesture', 'idle']) {
  const clipName = phase === 'idle' ? 'Idle' : name;
  if (!clips.has(clipName)) continue;
  const duration = clips.get(clipName).duration, profile = { ...shots[station], fill: phase === 'idle' ? restFills[station] : shots[station].fill };
  const { camera, target } = cameraFor(profile), towardCamera = camera.position.clone().sub(target).normalize(), records = [];
  for (let index = 0; index <= Math.ceil(duration * 60); index++) {
    const time = Math.min(duration, index / 60); sample(clipName, time);
    const torso = frame('LeftShoulder', 'RightShoulder'), pelvis = frame('LeftUpLeg', 'RightUpLeg');
    const torsoDelta = delta(camera, position('Spine2'), torso.forward), pelvisDelta = delta(camera, position('Hips'), pelvis.forward);
    const leftDot = torso.left.dot(towardCamera), frontDot = torso.forward.dot(towardCamera);
    const relativeAzimuthDegrees = ((profile.azimuth - torso.headingDegrees + 540) % 360) - 180;
    records.push({ time, torsoHeadingDegrees: torso.headingDegrees, relativeAzimuthDegrees, torsoDeltaPx: torsoDelta, pelvisDeltaPx: pelvisDelta, leftDot, frontDot,
      passed: name === 'Walk' ? torsoDelta[0] > 0 && torsoDelta[1] > 0 && pelvisDelta[0] > 0 && pelvisDelta[1] > 0 : leftDot > 0 && frontDot > 0 && relativeAzimuthDegrees > 0 && relativeAzimuthDegrees < 90 && camera.position.y < target.y });
  }
  check(`${name}/${phase}: every actual bone sample has requested camera direction`, () => assert.equal(records.filter(row => !row.passed).length, 0));
  sequences.push({ name, phase, clipName, profile, duration, sampleCount: records.length, camera: camera.position.toArray(), target: target.toArray(),
    ranges: Object.fromEntries(['torsoHeadingDegrees', 'relativeAzimuthDegrees', 'leftDot', 'frontDot'].map(key => [key, [Math.min(...records.map(row => row[key])), Math.max(...records.map(row => row[key]))]])), records });
}
const result = { generatedAt: new Date().toISOString(), assetSHA256: sha(bytes), sceneSHA256: sha(sceneSource), landmarks, checks, sequences,
  method: 'Actual GLB decoded by Three.GLTFLoader. Bone transforms sampled at 60 Hz across complete Walk, Wait and Idle. Anatomical left and forward are reconstructed from animated shoulder/pelvis landmarks. Perspective camera uses the current src/scene.js shot definitions and distance fitting. Screen deltas correspond to 0.3 m projected forward at 1440 x 1000.',
  limitations: 'This verifies viewing direction and screen-axis signs, not foot travel or whole-mesh collision. Walk is authored in place. View offset and viewport scaling do not change these signs; browser screenshots separately verify framing and occlusion. A 60 Hz sample is not a proof for every continuous instant.' };
await writeFile(new URL('./direction-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ assetSHA256: result.assetSHA256, passed: checks.filter(item => item.passed).length, total: checks.length, failures: checks.filter(item => !item.passed), sequences: sequences.map(({ name, phase, sampleCount, ranges }) => ({ name, phase, sampleCount, ranges })) }, null, 2));
if (checks.some(item => !item.passed)) process.exitCode = 1;
