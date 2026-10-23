/** Validate the wide-shot revision against real bones and the current scene profiles. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STATION_CLIPS } from '../../src/motion.js';
import { lerp, wrapStation } from '../../src/scene-math.js';

const root = new URL('../../', import.meta.url), checks = [];
const sha = data => createHash('sha256').update(data).digest('hex');
const bytes = await readFile(new URL('public/models/person-authored-animated.glb', root));
const sceneSource = await readFile(new URL('src/scene.js', root), 'utf8');
const check = (name, test) => { try { test(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
function numericArray(name) {
  const text = sceneSource.match(new RegExp(`(?:const |, )${name} = \\[([^\\]]+)\\]`))?.[1];
  assert.ok(text, `Missing ${name} array.`);
  return text.split(',').map(Number);
}
function profiles(name) {
  const text = sceneSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1];
  assert.ok(text, `Missing ${name} profiles.`);
  return [...text.matchAll(/\{([^}]+)\}/g)].map(([, body]) => Object.fromEntries([...body.matchAll(/(\w+)\s*:\s*(-?[.\d]+)/g)].map(([, key, value]) => [key, Number(value)])));
}
const SHOTS = profiles('SHOTS'), STATIONS = profiles('STATIONS');
const REST_FILLS = numericArray('REST_FILLS'), REST_LOOK_Y = numericArray('REST_LOOK_Y');
const REST_HALO_Y = numericArray('REST_HALO_Y'), MOBILE_REST_FILLS = numericArray('MOBILE_REST_FILLS');
assert.equal(SHOTS.length, STATION_CLIPS.length);
// Execute the repository's real profile-selection function, including mobile
// gesture scaling and rest lookY. Keep the independent projection below.
const profileSource = sceneSource.slice(sceneSource.indexOf('  function sampleProfile('), sceneSource.indexOf('  function updateCamera('));
assert.ok(profileSource.startsWith('  function sampleProfile('));
const sampleProfile = new Function('context', 'progress', `const { wrapStation, lerp, HEIGHT, STATIONS, SHOTS, restClose, REST_FILLS, REST_LOOK_Y, REST_HALO_Y, MOBILE_REST_FILLS, USE_ANIMATIONS, WALK_STATION, WAIT_STATION, NOD_STATION, WAVE_STATION, mobile, width, height } = context; ${profileSource}; return sampleProfile(progress);`);
const profileFor = (station, phase, viewport) => sampleProfile({
  wrapStation, lerp, HEIGHT, STATIONS, SHOTS, REST_FILLS, REST_LOOK_Y, REST_HALO_Y, MOBILE_REST_FILLS,
  restClose: SHOTS.map(() => phase === 'idle' ? 1 : 0), USE_ANIMATIONS: true,
  WALK_STATION: STATION_CLIPS.indexOf('Walk'), WAIT_STATION: STATION_CLIPS.indexOf('Wait'),
  NOD_STATION: STATION_CLIPS.indexOf('Nod'), WAVE_STATION: STATION_CLIPS.indexOf('Wave'), ...viewport,
}, station);

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
function cameraFor(profile, viewport) {
  const camera = new THREE.PerspectiveCamera(profile.fov, viewport.width / viewport.height, .02, 100);
  const target = new THREE.Vector3(0, HEIGHT * profile.lookY, 0), azimuth = THREE.MathUtils.degToRad(profile.azimuth);
  const elevation = (profile.camY - profile.lookY) / profile.dist;
  let distance = HEIGHT / (2 * Math.tan(THREE.MathUtils.degToRad(profile.fov / 2)) * profile.fill);
  for (let iteration = 0; iteration < 4; iteration++) {
    camera.position.set(Math.sin(azimuth) * distance, HEIGHT * profile.lookY + elevation * distance, Math.cos(azimuth) * distance);
    camera.lookAt(target); camera.updateMatrixWorld();
    const top = new THREE.Vector3(0, HEIGHT, 0).project(camera), bottom = new THREE.Vector3().project(camera);
    distance *= Math.abs(top.y - bottom.y) / (profile.fill * 2);
  }
  return { camera, target, distance: camera.position.distanceTo(target) };
}
function delta(camera, viewport, point, direction) {
  const start = point.clone().project(camera), end = point.clone().addScaledVector(direction, .3).project(camera);
  return [(end.x - start.x) * viewport.width / 2, -(end.y - start.y) * viewport.height / 2];
}
sample('Idle', 0);
const landmarks = Object.fromEntries(['LeftShoulder', 'RightShoulder', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(name => [name, position(name).toArray()]));
check('rest rig: anatomical left is +X and toe forward is +Z', () => {
  assert.ok(landmarks.LeftShoulder[0] > landmarks.RightShoulder[0]);
  for (const side of ['Left', 'Right']) assert.ok(landmarks[`${side}ToeBase`][2] > landmarks[`${side}Foot`][2]);
});
check('station mapping selects Walk at 01 and Wait at 03', () => { assert.equal(STATION_CLIPS[0], 'Walk'); assert.equal(STATION_CLIPS[2], 'Wait'); });
check('final asset contains seven-second Wait and no active LookAround', () => { assert.ok(clips.has('Wait')); assert.ok(!clips.has('LookAround')); assert.ok(Math.abs(clips.get('Wait').duration - 7) < 1e-5); });
// These are scene-canvas test sizes, not whole-document screenshots. Actual
// browser framing and card heights are checked separately by verify-framing.
const viewports = [
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
  { name: 'mobile', width: 390, height: 627, mobile: true },
  { name: 'narrow', width: 320, height: 583, mobile: true },
];
const sequences = [], shotComparisons = [];
for (const viewport of viewports) {
  for (const phase of ['gesture', 'idle']) {
    const allShots = SHOTS.map((_, station) => {
      const profile = profileFor(station, phase, viewport), { camera, target, distance } = cameraFor(profile, viewport);
      return { station: station + 1, profile, camera: camera.position.toArray(), target: target.toArray(), distance };
    });
    check(`${viewport.name}/${phase}: 01 and 03 are wider and farther than 02 and 04`, () => {
      for (const wide of [0, 2]) for (const close of [1, 3]) {
        assert.ok(allShots[wide].profile.fill < allShots[close].profile.fill, `${wide + 1} fill must be smaller than ${close + 1}`);
        assert.ok(allShots[wide].distance > allShots[close].distance, `${wide + 1} distance must be greater than ${close + 1}`);
      }
    });
    shotComparisons.push({ viewport, phase, allShots });
  }
  for (const [name, station] of [['Walk', 0], ['Wait', 2]]) for (const phase of ['gesture', 'idle']) {
    const clipName = phase === 'idle' ? 'Idle' : name;
    const duration = clips.get(clipName).duration, profile = profileFor(station, phase, viewport);
    const { camera, target } = cameraFor(profile, viewport), towardCamera = camera.position.clone().sub(target).normalize(), records = [];
    for (let index = 0; index <= Math.ceil(duration * 60); index++) {
      const time = Math.min(duration, index / 60); sample(clipName, time);
      const torso = frame('LeftShoulder', 'RightShoulder'), pelvis = frame('LeftUpLeg', 'RightUpLeg');
      const torsoDelta = delta(camera, viewport, position('Spine2'), torso.forward), pelvisDelta = delta(camera, viewport, position('Hips'), pelvis.forward);
      const leftDot = torso.left.dot(towardCamera), frontDot = torso.forward.dot(towardCamera);
      const relativeAzimuthDegrees = ((profile.azimuth - torso.headingDegrees + 540) % 360) - 180;
      records.push({ time, torsoHeadingDegrees: torso.headingDegrees, relativeAzimuthDegrees, torsoDeltaPx: torsoDelta, pelvisDeltaPx: pelvisDelta, leftDot, frontDot,
        passed: name === 'Walk'
          ? torsoDelta[0] < 0 && torsoDelta[1] > 0 && pelvisDelta[0] < 0 && pelvisDelta[1] > 0 && camera.position.y > target.y
          : torsoDelta[0] > 0 && pelvisDelta[0] > 0 && leftDot < 0 && frontDot > 0 && relativeAzimuthDegrees < 0 && relativeAzimuthDegrees > -90 && camera.position.y < target.y });
    }
    check(`${viewport.name}/${name}/${phase}: every actual bone sample has requested camera direction`, () => assert.equal(records.filter(row => !row.passed).length, 0));
    sequences.push({ viewport, name, phase, clipName, profile, duration, sampleCount: records.length, camera: camera.position.toArray(), target: target.toArray(),
      ranges: Object.fromEntries(['torsoHeadingDegrees', 'relativeAzimuthDegrees', 'leftDot', 'frontDot'].map(key => [key, [Math.min(...records.map(row => row[key])), Math.max(...records.map(row => row[key]))]])), records });
  }
  for (const station of [0, 2]) check(`${viewport.name}/0${station + 1}: no camera push-in on return to Idle`, () => {
    const gesture = profileFor(station, 'gesture', viewport), idle = profileFor(station, 'idle', viewport);
    for (const key of ['fill', 'lookY', 'camY', 'azimuth', 'fov']) assert.equal(gesture[key], idle[key], key);
  });
}
const result = { generatedAt: new Date().toISOString(), assetSHA256: sha(bytes), sceneSHA256: sha(sceneSource), landmarks, checks, shotComparisons, sequences,
  method: 'Actual GLB decoded by Three.GLTFLoader. Full Walk, Wait and Idle bone transforms sampled at 60 Hz. Anatomical directions use animated shoulder/pelvis landmarks. The actual scene sampleProfile function supplies desktop/mobile gesture/rest configurations. An independent perspective projection with the same four-pass distance fit measures 0.3 m forward screen deltas and camera-to-target distances.',
  limitations: 'This validates screen direction, wide/close profile ordering and no rest zoom, not animation contact, model bounds or card occlusion. Walk is authored in place. Mobile sizes are representative canvas dimensions, not viewport dimensions. View offsets do not affect projection-delta signs. Browser screenshots separately verify framing and exposed right-hand contact. Sampling does not prove every continuous instant.' };
await writeFile(new URL('./direction-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ assetSHA256: result.assetSHA256, sceneSHA256: result.sceneSHA256, passed: checks.filter(item => item.passed).length, total: checks.length, failures: checks.filter(item => !item.passed), shotComparisons: shotComparisons.map(({ viewport, phase, allShots }) => ({ viewport: viewport.name, phase, shots: allShots.map(({ station, profile, distance }) => ({ station, fill: profile.fill, distance })) })) }, null, 2));
if (checks.some(item => !item.passed)) process.exitCode = 1;
