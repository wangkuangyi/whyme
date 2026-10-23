/** Actual GLTFLoader/skinning checks for the Blender-authored runtime. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHoodieSkinning } from '../../src/hoodie-skinning.js';
import { HOODIE_BASELINE, HOODIE_WEIGHT_ROWS } from '../../src/hoodie-skinning-data.js';
import { createCharacterMotion, STATION_CLIPS } from '../../src/motion.js';

const root = new URL('../../', import.meta.url), sha = value => createHash('sha256').update(value).digest('hex');
const reportDirectory = process.argv.find(argument => argument.startsWith('--output-dir='))?.slice('--output-dir='.length) || 'qa/waiting';
if (!/^(?:qa|output)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(reportDirectory)) throw new Error('Output directory must be a project-relative qa/... or output/... path.');
const asset = 'public/models/person-authored-animated.glb';
const requestedClip = process.argv.find(argument => argument.startsWith('--clip='))?.slice('--clip='.length);
const interruptionsOnly = process.argv.includes('--interruptions-only');
if (requestedClip && interruptionsOnly) throw new Error('Use either --clip or --interruptions-only.');
if (requestedClip && !STATION_CLIPS.includes(requestedClip)) throw new Error(`Unknown clip filter: ${requestedClip}`);
const [bytes, originalBytes, staticBytes, historical] = await Promise.all([
  asset, HOODIE_BASELINE.source, 'public/models/person-original.glb', 'qa/breathing/hoodie-results.json',
].map(path => readFile(new URL(path, root))));
const checks = [], check = (name, fn) => { try { fn(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
function parse(bytes) {
  const length = bytes.readUInt32LE(12), offset = 20 + length;
  return { json: JSON.parse(bytes.subarray(20, offset)), bin: bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32LE(offset)) };
}
const source = parse(originalBytes), authored = parse(bytes);
check('source-asset-matches-reviewed-immutable-sha', () => assert.equal(sha(originalBytes), HOODIE_BASELINE.sourceSHA256));
check('all-original-binary-bytes-are-preserved-as-an-exact-prefix', () => assert.ok(authored.bin.subarray(0, source.json.buffers[0].byteLength).equals(source.bin.subarray(0, source.json.buffers[0].byteLength))));
check('original-mesh-skeleton-materials-images-and-scene-json-are-identical', () => {
  for (const name of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'scenes']) assert.deepEqual(authored.json[name], source.json[name], name);
});
const imageHashes = source.json.images.map(image => {
  const view = source.json.bufferViews[image.bufferView], current = authored.json.bufferViews[image.bufferView];
  const oldData = source.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const newData = authored.bin.subarray(current.byteOffset || 0, (current.byteOffset || 0) + current.byteLength);
  check('original-embedded-texture-bytes-identical', () => assert.ok(oldData.equals(newData)));
  return { mimeType: image.mimeType, bytes: oldData.length, sha256: sha(oldData) };
});
async function rig() {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'HEADLESS_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let mesh; const bones = new Map();
  gltf.scene.traverse(object => {
    if (object.isSkinnedMesh) { assert.equal(mesh, undefined); mesh = object; }
    if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i, ''), { bone: object, rest: object.quaternion.clone() });
  });
  mesh.geometry.computeBoundingBox();
  const height = mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y;
  gltf.scene.scale.setScalar(1.83 / height); gltf.scene.updateMatrixWorld(true);
  const originals = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
  applyHoodieSkinning(mesh);
  return { model: gltf.scene, gltf, mesh, bones, height, originals };
}
const initial = await rig(), geometry = initial.mesh.geometry, index = geometry.index;
const selected = new Set(HOODIE_WEIGHT_ROWS.map(row => row[0]));
const positions = Array.from({ length: geometry.attributes.position.count }, (_, id) => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, id).toArray());
const millimetres = 1830 / initial.height, subset = new Set(selected), chest = [], rightHand = [], leftHand = [], bodySide = [];
const normalize = name => name.replace(/^mixamorig[:_]?/i, '');
const jointNames = initial.mesh.skeleton.bones.map(bone => normalize(bone.name));
const dominantJoint = positions.map((_, id) => {
  let dominant = 0;
  for (let slot = 1; slot < 4; slot++) if (initial.originals.skinWeight[id * 4 + slot] > initial.originals.skinWeight[id * 4 + dominant]) dominant = slot;
  return jointNames[initial.originals.skinIndex[id * 4 + dominant]];
});
function weight(id, predicate) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) if (predicate(jointNames[initial.originals.skinIndex[id * 4 + slot]])) sum += initial.originals.skinWeight[id * 4 + slot];
  return sum;
}
for (let id = 0; id < positions.length; id++) if (weight(id, name => name.startsWith('RightHand')) >= .7) { rightHand.push(id); subset.add(id); }
for (let id = 0; id < positions.length; id++) if (weight(id, name => name.startsWith('LeftHand')) >= .7) { leftHand.push(id); subset.add(id); }
for (let i = 0; i < index.count; i += 3) {
  const ids = [0, 1, 2].map(k => index.getX(i + k)), p = ids.map(id => positions[id]);
  const center = [0, 1, 2].map(axis => p.reduce((sum, v) => sum + v[axis], 0) / 3);
  if (!ids.some(id => selected.has(id)) && Math.abs(center[0]) <= .12 && center[1] >= .60 && center[1] <= .82 && center[2] >= .005) {
    chest.push(ids); ids.forEach(id => subset.add(id));
  }
  // Waist, hoodie and upper legs only; exclude the tested hand and its sleeve.
  if (center[1] >= .25 && center[1] <= .72 && ids.every(id => weight(id, name => /^(Hips|Spine\d*|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg)$/.test(name)) >= .7)) {
    bodySide.push(ids); ids.forEach(id => subset.add(id));
  }
}
check('drawstring-and-hand-subsets-cover-real-mesh-vertices', () => { assert.equal(selected.size, 180); assert.ok(rightHand.length > 100); assert.ok(leftHand.length > 100); assert.ok(bodySide.length > 100); });
check('runtime-patch-only-changes-the-approved-180-skinning-rows', () => {
  const changed = [];
  for (let id = 0; id < positions.length; id++) if ([0, 1, 2, 3].some(k => ['skinIndex', 'skinWeight'].some(name => geometry.attributes[name].array[id * 4 + k] !== initial.originals[name][id * 4 + k]))) changed.push(id);
  assert.deepEqual(changed, [...selected]);
  for (const name of ['position', 'normal', 'uv']) assert.deepEqual(geometry.attributes[name].array, initial.originals[name]);
});
const vertex = new THREE.Vector3();
function skin(c) { const result = new Map(); for (const id of subset) result.set(id, c.mesh.getVertexPosition(id, vertex).toArray()); return result; }
const empty = () => ({ minimumGapMM: Infinity, penetratingSamples: 0, missing: 0, samples: 0, worst: null });
function projectedTriangles(ids, values, axes) {
  const [u, v] = axes;
  return ids.map(ids => {
    const [a, b, c] = ids.map(id => values.get(id)), den = (b[v] - c[v]) * (a[u] - c[u]) + (c[u] - b[u]) * (a[v] - c[v]);
    return { a, b, c, den, minU: Math.min(a[u], b[u], c[u]), maxU: Math.max(a[u], b[u], c[u]), minV: Math.min(a[v], b[v], c[v]), maxV: Math.max(a[v], b[v], c[v]) };
  });
}
function depth(values, ids, triangles, axes, depthAxis, minimum, result, time) {
  const [u, v] = axes, projected = projectedTriangles(triangles, values, axes);
  for (const id of ids) {
    const p = values.get(id); let surface = minimum ? Infinity : -Infinity;
    for (const t of projected) {
      if (Math.abs(t.den) < 1e-10 || p[u] < t.minU - 1e-7 || p[u] > t.maxU + 1e-7 || p[v] < t.minV - 1e-7 || p[v] > t.maxV + 1e-7) continue;
      const { a, b, c, den } = t;
      const w0 = ((b[v] - c[v]) * (p[u] - c[u]) + (c[u] - b[u]) * (p[v] - c[v])) / den;
      const w1 = ((c[v] - a[v]) * (p[u] - c[u]) + (a[u] - c[u]) * (p[v] - c[v])) / den, w2 = 1 - w0 - w1;
      if (Math.min(w0, w1, w2) < -1e-6) continue;
      const coordinate = a[depthAxis] * w0 + b[depthAxis] * w1 + c[depthAxis] * w2;
      surface = minimum ? Math.min(surface, coordinate) : Math.max(surface, coordinate);
    }
    if (!Number.isFinite(surface)) { result.missing++; continue; }
    const gap = (minimum ? surface - p[depthAxis] : p[depthAxis] - surface) * millimetres;
    if (gap < result.minimumGapMM) { result.minimumGapMM = gap; result.worst = { time, vertex: id }; }
    if (gap < -.1) result.penetratingSamples++;
    result.samples++;
    if (/Hand/.test(dominantJoint[id])) {
      result.byJoint ??= {};
      const joint = result.byJoint[dominantJoint[id]] ??= { minimumGapMM: Infinity, negativeSamples: 0, worst: null };
      if (gap < joint.minimumGapMM) { joint.minimumGapMM = gap; joint.worst = { time, vertex: id }; }
      if (gap < -.1) joint.negativeSamples++;
    }
  }
}
function closestSurfaceProbe(values, id) {
  const point = new THREE.Vector3().fromArray(values.get(id));
  const ray = new THREE.Ray(point, new THREE.Vector3(1, 0, 0)), intersection = new THREE.Vector3(), hits = [];
  let minimum = Infinity, nearest = null;
  for (const ids of bodySide) {
    const vertices = ids.map(id => new THREE.Vector3().fromArray(values.get(id))), triangle = new THREE.Triangle(...vertices);
    const closest = triangle.closestPointToPoint(point, new THREE.Vector3()), distance = point.distanceTo(closest);
    if (distance < minimum) {
      minimum = distance;
      nearest = { triangle: ids, distanceMM: distance * millimetres,
        signedDistanceMM: point.clone().sub(closest).dot(triangle.getNormal(new THREE.Vector3())) * millimetres };
    }
    if (ray.intersectTriangle(...vertices, false, intersection)) {
      const distance = point.distanceTo(intersection);
      if (distance > 1e-8 && !hits.some(other => Math.abs(other - distance) < 1e-6)) hits.push(distance);
    }
  }
  return { vertex: id, position: point.toArray(), nearest, positiveXRayIntersections: hits.length,
    insideByOddParity: hits.length % 2 === 1 };
}
const runtime = [];
for (let station = 0; station < STATION_CLIPS.length; station++) {
  if (interruptionsOnly) continue;
  if (requestedClip && STATION_CLIPS[station] !== requestedClip) continue;
  const c = await rig(), motion = createCharacterMotion({ model: c.model, animations: c.gltf.animations, bones: c.bones });
  motion.setStation(station);
  const initial = motion.getState(), idleDuration = initial.idleAnimation.duration, idleSeconds = idleDuration * 2 + .5;
  const seconds = initial.duration + idleSeconds;
  const report = { name: STATION_CLIPS[station], station: station + 1, seconds, frames: 0, cords: empty(), rightHandSide: empty(), leftHandSide: empty(),
    rightWristLateralFromHipsMM: { minimum: Infinity, maximum: -Infinity }, idle: { frames: 0, firstTime: null, lastTime: null, cords: empty(), rightHandSide: empty() } };
  check(`${report.name}-uses-blender-actions-with-no-runtime-posture-or-breathing-solver`, () => {
    assert.equal(initial.posture.mode, 'blender-authored'); assert.equal(initial.posture.runtimeCorrection, false);
    assert.equal(initial.idleMode, 'authored-idle'); assert.equal(initial.breathing, undefined);
    assert.ok(Math.abs(c.model.scale.y - millimetres / 1000) < 1e-12);
  });
  for (let frame = 0; frame <= Math.ceil(seconds * 60); frame++) {
    if (frame) motion.update(1 / 60); c.model.updateMatrixWorld(true);
    const live = motion.getState(), values = skin(c), time = frame / 60;
    depth(values, selected, chest, [0, 1], 2, false, report.cords, time); report.frames++;
    const settled = live.action === 'Idle' && live.end && !live.transition;
    if (settled) {
      report.idle.frames++; report.idle.firstTime ??= time; report.idle.lastTime = time;
      depth(values, selected, chest, [0, 1], 2, false, report.idle.cords, time);
    }
    if (frame % 2 === 0 || report.name === 'Wait') {
      depth(values, rightHand, bodySide, [1, 2], 0, true, report.rightHandSide, time);
      depth(values, leftHand, bodySide, [1, 2], 0, false, report.leftHandSide, time);
      if (settled) depth(values, rightHand, bodySide, [1, 2], 0, true, report.idle.rightHandSide, time);
      const hips = c.bones.get('Hips').bone.getWorldPosition(new THREE.Vector3()), hand = c.bones.get('RightHand').bone.getWorldPosition(new THREE.Vector3());
      const lateral = (hips.x - hand.x) * 1000;
      report.rightWristLateralFromHipsMM.minimum = Math.min(report.rightWristLateralFromHipsMM.minimum, lateral);
      report.rightWristLateralFromHipsMM.maximum = Math.max(report.rightWristLateralFromHipsMM.maximum, lateral);
    }
  }
  report.idle.durationSeconds = report.idle.lastTime - report.idle.firstTime;
  check(`${report.name}-all-180-cord-vertices-clear-chest-through-real-entry-action-exit-idle`, () => {
    assert.equal(report.cords.missing, 0); assert.equal(report.cords.penetratingSamples, 0); assert.ok(report.cords.minimumGapMM > 0);
  });
  check(`${report.name}-at-least-two-complete-real-idle-cycles-are-sampled`, () => {
    assert.ok(report.idle.durationSeconds >= idleDuration * 2); assert.equal(report.idle.cords.missing, 0);
    assert.equal(report.idle.cords.penetratingSamples, 0); assert.equal(motion.getState().action, 'Idle');
  });
  // A missing side projection means no tested body triangle lies on that
  // vertex's X ray. It is reported, not counted as a positive clearance.
  check(`${report.name}-right-hand-has-no-negative-side-clearance-against-tested-waist-geometry`, () => assert.equal(report.rightHandSide.penetratingSamples, 0));
  check(`${report.name}-left-hand-has-no-negative-side-clearance-against-tested-waist-geometry`, () => assert.equal(report.leftHandSide.penetratingSamples, 0));
  motion.dispose();
  if (report.rightHandSide.worst) {
    const probe = await rig(), probeMotion = createCharacterMotion({ model: probe.model, animations: probe.gltf.animations, bones: probe.bones });
    probeMotion.setStation(station);
    for (let frame = 0; frame < Math.round(report.rightHandSide.worst.time * 60); frame++) probeMotion.update(1 / 60);
    probe.model.updateMatrixWorld(true);
    report.rightHandWorst3D = { time: report.rightHandSide.worst.time, ...closestSurfaceProbe(skin(probe), report.rightHandSide.worst.vertex) };
    probeMotion.dispose();
  }
  if (report.leftHandSide.worst) {
    const probe = await rig(), probeMotion = createCharacterMotion({ model: probe.model, animations: probe.gltf.animations, bones: probe.bones });
    probeMotion.setStation(station);
    for (let frame = 0; frame < Math.round(report.leftHandSide.worst.time * 60); frame++) probeMotion.update(1 / 60);
    probe.model.updateMatrixWorld(true);
    report.leftHandWorst3D = { time: report.leftHandSide.worst.time, ...closestSurfaceProbe(skin(probe), report.leftHandSide.worst.vertex) };
    probeMotion.dispose();
  }
  runtime.push(report);
  console.log(`${report.name}: cords ${report.cords.minimumGapMM.toFixed(3)} mm; right hand ${report.rightHandSide.minimumGapMM.toFixed(3)} mm (${report.rightHandSide.penetratingSamples} negative); left hand ${report.leftHandSide.minimumGapMM.toFixed(3)} mm (${report.leftHandSide.penetratingSamples} negative).`);
}
const interruptions = [];
if (!requestedClip) for (const from of STATION_CLIPS.keys()) for (const to of STATION_CLIPS.keys()) {
  if (from === to || (STATION_CLIPS[from] !== 'Wait' && STATION_CLIPS[to] !== 'Wait')) continue;
  const c = await rig(), motion = createCharacterMotion({ model: c.model, animations: c.gltf.animations, bones: c.bones });
  motion.setStation(from);
  for (let frame = 0, count = Math.round(motion.getState().duration * .6 * 60); frame < count; frame++) motion.update(1 / 60);
  motion.setStation(to);
  const report = { from: STATION_CLIPS[from], to: STATION_CLIPS[to], interruptedFraction: .6,
    frames: 0, cords: empty(), rightHandSide: empty(), leftHandSide: empty() };
  for (let frame = 0; frame <= 60; frame++) {
    if (frame) motion.update(1 / 60); c.model.updateMatrixWorld(true);
    const values = skin(c), time = frame / 60;
    depth(values, selected, chest, [0, 1], 2, false, report.cords, time);
    depth(values, rightHand, bodySide, [1, 2], 0, true, report.rightHandSide, time);
    depth(values, leftHand, bodySide, [1, 2], 0, false, report.leftHandSide, time);
    report.frames++;
  }
  for (const side of ['right', 'left']) {
    const worst = report[`${side}HandSide`].worst;
    if (!worst) continue;
    const probe = await rig(), probeMotion = createCharacterMotion({ model: probe.model, animations: probe.gltf.animations, bones: probe.bones });
    probeMotion.setStation(from);
    for (let frame = 0, count = Math.round(probeMotion.getState().duration * .6 * 60); frame < count; frame++) probeMotion.update(1 / 60);
    probeMotion.setStation(to);
    for (let frame = 0; frame < Math.round(worst.time * 60); frame++) probeMotion.update(1 / 60);
    probe.model.updateMatrixWorld(true);
    report[`${side}HandWorst3D`] = { time: worst.time, ...closestSurfaceProbe(skin(probe), worst.vertex) };
    probeMotion.dispose();
  }
  check(`${report.from}-to-${report.to}-midperformance-interruption-retains-tested-cord-and-hand-clearance`, () => {
    assert.equal(report.cords.missing, 0); assert.equal(report.cords.penetratingSamples, 0);
    assert.equal(report.leftHandSide.penetratingSamples, 0, JSON.stringify(report.leftHandSide.worst));
    assert.equal(report.rightHandSide.penetratingSamples, 0, JSON.stringify(report.rightHandSide.worst));
  });
  interruptions.push(report); motion.dispose();
}
const unchanged = await Promise.all([HOODIE_BASELINE.source, 'public/models/person-original.glb', 'qa/breathing/hoodie-results.json'].map(path => readFile(new URL(path, root))));
check('source-and-static-and-historical-report-sha256-are-unchanged', () => [originalBytes, staticBytes, historical].forEach((value, index) => assert.equal(sha(value), sha(unchanged[index]))));
const finalAuthoredBytes = await readFile(new URL(asset, root));
check('authored-asset-remained-unchanged-during-the-test', () => assert.equal(sha(finalAuthoredBytes), sha(bytes)));
const report = {
  generatedAt: new Date().toISOString(), asset, assetSHA256: sha(bytes), sourceSHA256: sha(originalBytes), imageHashes,
  moduleSHA256: Object.fromEntries(await Promise.all(['src/motion.js', 'src/hoodie-skinning.js', 'src/hoodie-skinning-data.js', 'qa/waiting/test-clothing.mjs'].map(async path => [path, sha(await readFile(new URL(path, root)))]))),
  testedClips: runtime.map(item => item.name),
  passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, checks,
  method: 'Actual Three.GLTFLoader skeleton/geometry/animation; only headless texture decoding is replaced. Runtime entry/action/authored return followed by more than two full real Idle loops at 60 Hz. All 180 patched cord vertices use deformed front-chest triangle depth at every frame. All dominant LeftHand/RightHand and finger mesh vertices use actual waist/upper-leg side silhouette depth: Wait at 60 Hz, unchanged performances at 30 Hz. Six actual midperformance transitions involving Wait are separately sampled at 60 Hz for their first second. The worst sample per hand/station is separately replayed and measured with true 3D point-to-triangle distance, outward-normal signed distance, and deduplicated ray parity. No posture correction or synthetic breathing is imported or applied.',
  coverage: { heightMetres: 1.83, sourceHeight: initial.height, cordVertices: selected.size, chestTriangles: chest.length, rightHandVertices: rightHand.length, leftHandVertices: leftHand.length, bodySideTriangles: bodySide.length },
  limits: 'The waist/upper-leg bodySide triangle subset is an uncapped, open surface selected from rest-position height and skin weights; it is not a closed solid or a camera-facing-only surface. minimumGapMM and penetratingSamples mean directional side-depth gaps and the count below -0.1 mm, not certified penetration depth or collision count. nearest.signedDistanceMM is the point-to-nearest-tested-triangle vector projected on that triangle normal; it may concern a near or far side surface and is not a closed-volume penetration depth. insideByOddParity records parity of one +X ray against that same open subset, not a proof that the point lies inside a closed body. Six interruption assertions include Wait poses that already have the retained source hand/hip contact, so their negative-gap failures do not independently demonstrate six new transition defects. Side misses are unmeasured, not positive clearance. Finger/sleeve and other body regions are outside coverage. Visible hand silhouette, contact and cloth appearance require the selected camera and actual browser review.',
  runtime, interruptions,
};
await mkdir(new URL(`${reportDirectory}/`, root), { recursive: true });
await writeFile(new URL(`${reportDirectory}/clothing${requestedClip ? '-' + requestedClip.toLowerCase() : interruptionsOnly ? '-interruptions' : ''}-results.json`, root), JSON.stringify(report, null, 2) + '\n');
console.log(`Authored clothing checks: ${report.passed} passed, ${report.failed} failed.`);
if (report.failed) process.exitCode = 1;
