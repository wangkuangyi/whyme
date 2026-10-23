/** Reproduce the reviewed drawstring skinning table; never rewrites either GLB. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { MathUtils, BufferGeometry, BufferAttribute, SkinnedMesh } from 'three';

const root = new URL('../', import.meta.url);
const source = 'public/models/person-original-animated.glb';
const expectedSHA256 = 'fda0ce34395d895f6d18b39a40b65affd3f622401a2f76b1f2beaf152955a036';
const bytes = await readFile(new URL(source, root));
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, expectedSHA256, 'Review a new source before deriving another correction.');
const document = await new NodeIO().readBinary(bytes), documentRoot = document.getRoot();
const primitive = documentRoot.listMeshes()[0].listPrimitives()[0], skin = documentRoot.listSkins()[0];
const attribute = name => primitive.getAttribute(name);
const positions = Array.from({ length: attribute('POSITION').getCount() }, (_, i) => attribute('POSITION').getElement(i, []));
const joints = positions.map((_, i) => attribute('JOINTS_0').getElement(i, []));
const weights = positions.map((_, i) => attribute('WEIGHTS_0').getElement(i, []));
const triangles = primitive.getIndices().getArray();

// Cutting below both attachments separates the two cords from the hoodie body.
// Weld coincident UV-seam vertices only for component discovery; never weld or
// otherwise change the actual source mesh, topology or attribute arrays.
const eligible = positions.map(([x, y, z]) => y > .65 && y < .756 && Math.abs(x) < .07 && z > .015);
const parent = positions.map((_, i) => i);
const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
const weld = new Map();
positions.forEach((position, i) => {
  if (!eligible[i]) return;
  const key = position.map(v => v.toFixed(6)).join(',');
  if (weld.has(key)) union(i, weld.get(key)); else weld.set(key, i);
});
for (let t = 0; t < triangles.length; t += 3) {
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const ia = triangles[t + a], ib = triangles[t + b];
    if (eligible[ia] && eligible[ib]) union(ia, ib);
  }
}
const components = new Map();
positions.forEach((_, i) => { if (eligible[i]) { const key = find(i); if (!components.has(key)) components.set(key, []); components.get(key).push(i); } });
const cords = [...components.values()].filter(ids => {
  const ys = ids.map(i => positions[i][1]), xs = ids.map(i => positions[i][0]);
  return Math.max(...ys) - Math.min(...ys) > .09 && Math.max(...xs) - Math.min(...xs) < .012;
}).sort((a, b) => positions[a[0]][0] - positions[b[0]][0]);
assert.deepEqual(cords.map(ids => ids.length), [92, 88], 'Both reviewed cords, including UV seams, must be found.');
const selected = new Set(cords.flat());
const rows = [];
for (const id of [...selected].sort((a, b) => a - b)) {
  const point = positions[id]; let nearest = null;
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = Array.from(triangles.subarray(t, t + 3));
    if (ids.some(i => selected.has(i))) continue;
    const [a, b, c] = ids.map(i => positions[i]);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-10) continue;
    const w0 = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
    const w1 = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
    const barycentric = [w0, w1, 1 - w0 - w1];
    if (Math.min(...barycentric) < -1e-6) continue;
    const z = a[2] * w0 + b[2] * w1 + c[2] * barycentric[2];
    if (z > point[2] + .006 || z < .01) continue;
    if (!nearest || z > nearest.z) nearest = { ids, barycentric, z };
  }
  assert.ok(nearest, `No chest surface for cord vertex ${id}.`);
  const blend = 1 - MathUtils.smoothstep(point[1], .74, .756), total = new Map();
  const add = (joint, weight) => total.set(joint, (total.get(joint) || 0) + weight);
  nearest.ids.forEach((i, corner) => weights[i].forEach((weight, k) => add(joints[i][k], weight * nearest.barycentric[corner] * blend)));
  weights[id].forEach((weight, k) => add(joints[id][k], weight * (1 - blend)));
  const strongest = [...total].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = strongest.reduce((s, [, weight]) => s + weight, 0);
  // [vertex id, four joint indices, four weights]. Float32 is the actual runtime
  // storage, so record precisely the values that will be applied there.
  rows.push([id, ...strongest.map(([joint]) => joint), ...strongest.map(([, weight]) => Math.fround(weight / sum))]);
}
const fingerprint = array => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const attributes = Object.fromEntries(Object.entries({ position: 'POSITION', normal: 'NORMAL', uv: 'TEXCOORD_0', skinIndex: 'JOINTS_0', skinWeight: 'WEIGHTS_0' }).map(([name, semantic]) => {
  const value = attribute(semantic), array = value.getArray();
  return [name, { type: array.constructor.name, itemSize: value.getElementSize(), count: value.getCount(), hash: fingerprint(array) }];
}));
// GLTFLoader normalizes this array on import, even for normalized source sums.
// Record that exact Three.js result as a second accepted baseline. This is not
// a correction to the public asset, which remains byte-for-byte unchanged.
const weightGeometry = new BufferGeometry();
weightGeometry.setAttribute('skinWeight', new BufferAttribute(attribute('WEIGHTS_0').getArray().slice(), 4));
const weightMesh = new SkinnedMesh(weightGeometry); weightMesh.normalizeSkinWeights();
attributes.skinWeight.loaderHash = fingerprint(weightGeometry.getAttribute('skinWeight').array);
weightGeometry.dispose(); weightMesh.material.dispose();
const jointNodes = skin.listJoints(), indices = primitive.getIndices().getArray();
const baseline = {
  version: 'chest-surface-weights-v1', source, sourceSHA256: sha256, vertexCount: positions.length, affectedVertices: rows.length,
  attributes, index: { type: indices.constructor.name, count: indices.length, hash: fingerprint(indices) },
  bones: jointNodes.map(node => node.getName().replace(/^mixamorig[:_]?/i, '')),
  parents: jointNodes.map(node => jointNodes.findIndex(parent => parent.listChildren().includes(node))),
  inverseBindHash: fingerprint(skin.getInverseBindMatrices().getArray()),
  rule: 'Original chest-triangle barycentric weights below y=0.74; smoothstep back to original weights over y=0.74..0.756. Four strongest influences, normalized. Positions and all non-skin attributes unchanged.',
};
const generated = `// Generated by node scripts/hoodie-prepare.mjs; do not hand edit.\nexport const HOODIE_BASELINE = ${JSON.stringify(baseline)};\n// Rows: vertex id, joint[4], weight[4]. Include every UV-seam duplicate.\nexport const HOODIE_WEIGHT_ROWS = [\n${rows.map(row => `  ${JSON.stringify(row)},`).join('\n')}\n];\n`;
const output = new URL('src/hoodie-skinning-data.js', root);
// Git's Windows checkout may convert LF to CRLF; compare the generated source
// content independently of that transport-only line-ending conversion.
if (process.argv.includes('--check')) assert.equal((await readFile(output, 'utf8')).replace(/\r\n/g, '\n'), generated, 'The checked-in table must be exactly reproducible.');
else await writeFile(output, generated);
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${rows.length} drawstring weights from ${sha256}.`);
