/** Validate actual GLTFLoader + drawstrings + upright posture + continuous breathing. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHoodieSkinning } from '../src/hoodie-skinning.js';
import { HOODIE_BASELINE, HOODIE_WEIGHT_ROWS } from '../src/hoodie-skinning-data.js';
import { createPostureCorrection } from '../src/posture.js';
import { createCharacterMotion, STATION_CLIPS } from '../src/motion.js';

const root = new URL('../', import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(new URL(HOODIE_BASELINE.source, root));
const sourceSHA256 = sha(bytes), checks = [];
const historicalReport = await readFile(new URL('qa/posture/hoodie-results.json', root));
const check = (name, test) => { test(); checks.push({ name, passed: true }); };
check('original-GLB-SHA256-is-the-reviewed-immutable-baseline', () => assert.equal(sourceSHA256, HOODIE_BASELINE.sourceSHA256));
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/hoodie-prepare.mjs', root)), '--check'], { cwd: root, stdio: 'pipe' });
checks.push({ name: 'table-reproduces-from-source-geometry-and-chest-projection', passed: true });

async function rig(assetBytes = bytes) {
  const loader = new GLTFLoader();
  // Node has no image decoder. Replace only the decoded Texture object, while
  // keeping the real GLTFLoader geometry, skeleton, animation and normalization.
  loader.register(() => ({ name: 'HEADLESS_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(assetBytes.buffer.slice(assetBytes.byteOffset, assetBytes.byteOffset + assetBytes.byteLength), '');
  let mesh; const bones = new Map();
  gltf.scene.traverse(object => {
    if (object.isSkinnedMesh) { assert.equal(mesh, undefined); mesh = object; }
    if (object.isBone) bones.set(object.name.replace(/^mixamorig[:_]?/i, ''), { bone: object, rest: object.quaternion.clone() });
  });
  // Breathing offsets are specified in world metres. Match scene.js before
  // creating posture/motion, so its inverse-parent conversion is also tested.
  mesh.geometry.computeBoundingBox();
  const height = mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y;
  gltf.scene.scale.setScalar(1.83 / height);
  gltf.scene.updateMatrixWorld(true);
  const rest = [...bones.values()].map(({ bone }) => [bone, bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]);
  return { gltf, model: gltf.scene, mesh, bones, rest };
}
const context = await rig(), { mesh, model, bones } = context, geometry = mesh.geometry;
const originalAttributes = { ...geometry.attributes }, originalIndex = geometry.index, originalMaterial = mesh.material, originalMap = mesh.material.map;
const beforeArrays = Object.fromEntries(Object.entries(originalAttributes).map(([key, attr]) => [key, attr.array.slice()]));
const selected = new Set(HOODIE_WEIGHT_ROWS.map(row => row[0]));
const vertex = new THREE.Vector3(), restBefore = [...selected].map(id => mesh.getVertexPosition(id, vertex).toArray());
const correction = applyHoodieSkinning(mesh), correctedIndex = geometry.getAttribute('skinIndex'), correctedWeight = geometry.getAttribute('skinWeight');
check('runtime-patches-exactly-180-vertices-in-the-two-cords', () => {
  const changed = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    if ([0, 1, 2, 3].some(k => correctedIndex.array[i * 4 + k] !== beforeArrays.skinIndex[i * 4 + k] || correctedWeight.array[i * 4 + k] !== beforeArrays.skinWeight[i * 4 + k])) changed.push(i);
  }
  assert.deepEqual(changed, [...selected]); assert.equal(changed.length, 180);
});
check('surface-normal-UV-index-and-texture-references-remain-untouched', () => {
  assert.equal(mesh.geometry, geometry); assert.equal(geometry.index, originalIndex);
  assert.equal(mesh.material, originalMaterial); assert.equal(mesh.material.map, originalMap);
  for (const name of ['position', 'normal', 'uv']) { assert.equal(geometry.attributes[name], originalAttributes[name]); assert.deepEqual(geometry.attributes[name].array, beforeArrays[name]); }
});
check('only-two-skin-attributes-are-cloned-and-source-arrays-are-unchanged', () => {
  assert.notEqual(correctedIndex, originalAttributes.skinIndex); assert.notEqual(correctedWeight, originalAttributes.skinWeight);
  assert.deepEqual(originalAttributes.skinIndex.array, beforeArrays.skinIndex); assert.deepEqual(originalAttributes.skinWeight.array, beforeArrays.skinWeight);
});
let maximumWeightError = 0;
check('corrected-weights-are-finite-nonnegative-normalized-and-valid', () => {
  for (const id of selected) {
    let sum = 0;
    for (let k = 0; k < 4; k++) { const w = correctedWeight.array[id * 4 + k], j = correctedIndex.array[id * 4 + k]; assert.ok(Number.isFinite(w) && w >= 0); assert.ok(j < mesh.skeleton.bones.length); sum += w; }
    maximumWeightError = Math.max(maximumWeightError, Math.abs(sum - 1));
  }
  assert.ok(maximumWeightError < 1e-7);
});
let restMaximumDisplacement = 0;
check('original-rest-surface-is-unchanged-to-float32-tolerance', () => {
  [...selected].forEach((id, i) => { restMaximumDisplacement = Math.max(restMaximumDisplacement, mesh.getVertexPosition(id, vertex).distanceTo(new THREE.Vector3().fromArray(restBefore[i]))); });
  assert.ok(restMaximumDisplacement < 2e-7, String(restMaximumDisplacement));
});
check('idempotent-second-call-reuses-both-cloned-buffers', () => {
  assert.equal(applyHoodieSkinning(mesh), correction); assert.equal(geometry.attributes.skinIndex, correctedIndex); assert.equal(geometry.attributes.skinWeight, correctedWeight);
});
for (const [label, mutate] of [
  ['wrong-position', c => { c.mesh.geometry.attributes.position.setX(1641, .123); }],
  ['wrong-original-weight', c => { c.mesh.geometry.attributes.skinWeight.setX(1641, .123); }],
  ['wrong-joint-order', c => { [c.mesh.skeleton.bones[0], c.mesh.skeleton.bones[1]] = [c.mesh.skeleton.bones[1], c.mesh.skeleton.bones[0]]; }],
  ['wrong-inverse-bind', c => { c.mesh.skeleton.boneInverses[12].elements[12] += .001; }],
]) {
  const wrong = await rig(); mutate(wrong);
  check(`guard-rejects-${label}-before-changing-attributes`, () => {
    const index = wrong.mesh.geometry.attributes.skinIndex, weight = wrong.mesh.geometry.attributes.skinWeight;
    assert.throws(() => applyHoodieSkinning(wrong.mesh), /does not match/);
    assert.equal(wrong.mesh.geometry.attributes.skinIndex, index); assert.equal(wrong.mesh.geometry.attributes.skinWeight, weight);
  });
}
const staticBytes = await readFile(new URL('public/models/person-original.glb', root)), staticContext = await rig(staticBytes);
check('same-guard-and-correction-accept-the-original-static-GLB', () => assert.equal(applyHoodieSkinning(staticContext.mesh).vertices, 180));

const positions = Array.from({ length: geometry.attributes.position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).toArray());
const sourceHeight = Math.max(...positions.map(p => p[1])) - Math.min(...positions.map(p => p[1]));
const millimetres = 1830 / sourceHeight, body = [], subset = new Set(selected);
for (let i = 0; i < originalIndex.count; i += 3) {
  const ids = [0, 1, 2].map(k => originalIndex.getX(i + k));
  if (ids.some(id => selected.has(id))) continue;
  const p = ids.map(id => positions[id]), center = [0, 1, 2].map(c => p.reduce((s, v) => s + v[c], 0) / 3);
  if (Math.abs(center[0]) > .12 || center[1] < .60 || center[1] > .82 || center[2] < .005) continue;
  body.push(ids); ids.forEach(id => subset.add(id));
}
function skinPositions(current, original = false) {
  const g = current.mesh.geometry, liveIndex = g.attributes.skinIndex, liveWeight = g.attributes.skinWeight;
  if (original) { g.setAttribute('skinIndex', originalAttributes.skinIndex); g.setAttribute('skinWeight', originalAttributes.skinWeight); }
  const values = new Map(); for (const id of subset) values.set(id, current.mesh.getVertexPosition(id, vertex).toArray());
  if (original) { g.setAttribute('skinIndex', liveIndex); g.setAttribute('skinWeight', liveWeight); }
  return values;
}
function depthStatistics(values, result, time) {
  // Precompute each deformed triangle's projected plane once per frame.
  const projected = body.map(ids => {
    const [a, b, c] = ids.map(id => values.get(id)), den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    return { a, b, c, den, minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) };
  });
  for (const id of selected) {
    const p = values.get(id); let z = -Infinity;
    for (const t of projected) {
      if (Math.abs(t.den) < 1e-10 || p[0] < t.minX - 1e-7 || p[0] > t.maxX + 1e-7 || p[1] < t.minY - 1e-7 || p[1] > t.maxY + 1e-7) continue;
      const { a, b, c, den } = t;
      const w0 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / den;
      const w1 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / den, w2 = 1 - w0 - w1;
      if (Math.min(w0, w1, w2) < -1e-6) continue;
      z = Math.max(z, a[2] * w0 + b[2] * w1 + c[2] * w2);
    }
    if (!Number.isFinite(z)) { result.missing++; continue; }
    const gap = (p[2] - z) * millimetres;
    if (gap < result.minimumGapMM) { result.minimumGapMM = gap; result.worst = { time, vertex: id }; }
    if (gap < -.1) result.penetratingSamples++;
    result.samples++;
  }
}
const empty = () => ({ minimumGapMM: Infinity, penetratingSamples: 0, missing: 0, samples: 0 });
const posture = createPostureCorrection({ model, bones }), sourceClips = [], runtimeClips = [];
const animationSnapshot = JSON.stringify(context.gltf.animations.map(clip => clip.tracks.map(track => [Array.from(track.times), Array.from(track.values)])));
for (const [name, start, end] of [['Walk', 0, 2.375], ['Nod', 0, 3], ['Wave', .9, 4.75], ['LookAround', 1.2, 7.4]]) {
  context.rest.forEach(([bone, p, q, s]) => { bone.position.copy(p); bone.quaternion.copy(q); bone.scale.copy(s); });
  const mixer = new THREE.AnimationMixer(model), clip = context.gltf.animations.find(clip => clip.name === name);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const report = { name, start, end, frames: 0, original: empty(), corrected: empty(), correctedWithPosture: empty() };
  for (let frame = 0; frame <= Math.ceil((end - start) * 60); frame++) {
    const time = Math.min(end, start + frame / 60); posture.reset();
    mixer.setTime(time); model.updateMatrixWorld(true);
    depthStatistics(skinPositions(context, true), report.original, time);
    depthStatistics(skinPositions(context), report.corrected, time);
    posture.update(['Nod', 'Wave'].includes(name) ? { support: 1 } : undefined); model.updateMatrixWorld(true);
    depthStatistics(skinPositions(context), report.correctedWithPosture, time); report.frames++;
  }
  posture.reset(); mixer.stopAllAction(); mixer.uncacheRoot(model);
  check(`${name}-all-180-cord-vertices-clear-actual-chest-at-60Hz`, () => {
    for (const key of ['corrected', 'correctedWithPosture']) { assert.equal(report[key].missing, 0); assert.equal(report[key].penetratingSamples, 0); assert.ok(report[key].minimumGapMM > 0); }
  });
  sourceClips.push(report); console.log(`${name} source: ${report.correctedWithPosture.minimumGapMM.toFixed(3)} mm minimum with posture.`);
}
for (let station = 0; station < STATION_CLIPS.length; station++) {
  const c = await rig(); applyHoodieSkinning(c.mesh);
  const motion = createCharacterMotion({ model: c.model, animations: c.gltf.animations, bones: c.bones });
  motion.setStation(station);
  const state = motion.getState(), seconds = state.duration / state.speed + 12.25;
  check(`${STATION_CLIPS[station]}-uses-reviewed-source-ranges-and-scene-scale`, () => {
    assert.deepEqual(state.waveRange, [.9, 4.75]); assert.deepEqual(state.lookAroundRange, [1.2, 7.4]);
    assert.ok(Math.abs(c.model.scale.y - millimetres / 1000) < 1e-12);
    assert.equal(state.posture.baked, true);
    assert.equal(state.posture.clips.Nod.forcedSupport, true); assert.equal(state.posture.clips.Wave.forcedSupport, true);
  });
  const report = { station: station + 1, name: STATION_CLIPS[station], seconds, frames: 0, corrected: empty(),
    idle: { frames: 0, firstTime: null, lastTime: null, minimumLiftMetres: Infinity, maximumLiftMetres: -Infinity, corrected: empty() } };
  for (let frame = 0; frame <= Math.ceil(seconds * 60); frame++) {
    if (frame) motion.update(1 / 60); c.model.updateMatrixWorld(true);
    const live = motion.getState(), positions = skinPositions(c);
    depthStatistics(positions, report.corrected, frame / 60); report.frames++;
    if (live.action === 'Idle' && live.end && !live.transition) {
      report.idle.frames++; report.idle.firstTime ??= live.breathing.time; report.idle.lastTime = live.breathing.time;
      report.idle.minimumLiftMetres = Math.min(report.idle.minimumLiftMetres, live.breathing.liftMetres);
      report.idle.maximumLiftMetres = Math.max(report.idle.maximumLiftMetres, live.breathing.liftMetres);
      depthStatistics(positions, report.idle.corrected, frame / 60);
    }
  }
  check(`${report.name}-actual-runtime-entry-action-exit-and-rest-clear-chest`, () => { assert.equal(report.corrected.missing, 0); assert.equal(report.corrected.penetratingSamples, 0); assert.ok(report.corrected.minimumGapMM > 0); assert.equal(motion.getState().action, 'Idle'); });
  report.idle.durationSeconds = report.idle.lastTime - report.idle.firstTime;
  check(`${report.name}-full-breathing-extremes-clear-chest-over-at-least-twelve-idle-seconds`, () => {
    const { idle } = report;
    assert.ok(idle.durationSeconds >= 12); assert.ok(idle.durationSeconds > motion.getState().breathing.periodSeconds * 2);
    assert.ok(idle.minimumLiftMetres < .000001); assert.ok(idle.maximumLiftMetres > .002799);
    assert.ok(idle.corrected.minimumGapMM > 0); assert.equal(idle.corrected.missing, 0); assert.equal(idle.corrected.penetratingSamples, 0);
  });
  runtimeClips.push(report); motion.dispose(); console.log(`${report.name} runtime: ${report.corrected.minimumGapMM.toFixed(3)} mm minimum.`);
}
check('source-animation-samples-remain-unchanged', () => assert.equal(JSON.stringify(context.gltf.animations.map(clip => clip.tracks.map(track => [Array.from(track.times), Array.from(track.values)]))), animationSnapshot));
const afterAnimated = await readFile(new URL(HOODIE_BASELINE.source, root)), afterStatic = await readFile(new URL('public/models/person-original.glb', root));
check('original-animated-and-static-GLB-files-remain-unchanged', () => {
  assert.equal(sha(afterAnimated), sourceSHA256); assert.equal(sha(afterStatic), sha(staticBytes));
});
const historicalReportAfter = await readFile(new URL('qa/posture/hoodie-results.json', root));
check('previous-posture-only-acceptance-report-is-retained-unchanged', () => assert.equal(sha(historicalReportAfter), sha(historicalReport)));
const report = {
  generatedAt: new Date().toISOString(), passed: checks.length, failed: 0, sourceSHA256, staticSHA256: sha(staticBytes),
  moduleSHA256: Object.fromEntries(await Promise.all(['src/hoodie-skinning.js', 'src/hoodie-skinning-data.js', 'src/posture.js', 'src/breathing.js', 'src/motion.js'].map(async path => [path, sha(await readFile(new URL(path, root)))]))),
  runtime: { loader: 'actual Three.js GLTFLoader; headless Texture placeholder only', sourceHeight, normalizationScale: millimetres / 1000, affectedVertices: selected.size, maximumWeightError, restMaximumDisplacementSourceUnits: restMaximumDisplacement },
  method: 'All 180 patched lower-drawstring vertices (front, back, sides and UV duplicates) projected against actual deformed chest triangles at 60 Hz; gap measured at 1.83 m avatar height. Both expanded source clips with forced Nod/Wave support and actual runtime entry/action/slowdown/settling are sampled. Runtime uses posture-corrected derived clips baked before Mixer blending, without a dynamic posture gate. Every station additionally covers at least twelve seconds of continuous Idle breathing including both full lift extremes.',
  limits: 'Front-direction chest depth test, not a proof of arbitrary mesh self-intersections or all viewing angles. Actual textured browser screenshots are reviewed separately.',
  checks, sourceClips, runtimeClips,
};
await mkdir(new URL('qa/breathing/', root), { recursive: true });
await writeFile(new URL('qa/breathing/hoodie-results.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(`Hoodie checks: ${checks.length}/${checks.length} passed.`);
