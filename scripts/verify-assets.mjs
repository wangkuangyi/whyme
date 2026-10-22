import { readFile, stat, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = new URL('../', import.meta.url);
const bytes = await readFile(new URL('public/models/person.glb', base));
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
assert.equal(bytes.readUInt32LE(8), bytes.length);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
const hoodie = gltf.materials.find((m) => m.name === 'Hoodie');
assert(hoodie, 'Hoodie must remain independently addressable.');
assert(!hoodie.pbrMetallicRoughness.baseColorTexture, 'Hoodie color must be a parameter, not the Tripo albedo.');
assert.equal(gltf.skins.length, 1);
assert.equal(gltf.skins[0].joints.length, 65);
assert(bytes.length <= 3_000_000, 'Model must meet the mobile size budget.');
assert(gltf.extensionsUsed.includes('EXT_meshopt_compression'));
const triangles = gltf.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
const images = [];
for (const name of ['angle-01', 'angle-02', 'angle-03', 'angle-04','mobile-01','mobile-02','mobile-03','mobile-04']) {
  const path = new URL(`public/images/${name}.png`, base);
  const png = await readFile(path);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png[25], 6, 'Fallback must have alpha (RGBA).');
  images.push({ name, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: (await stat(path)).size, rgba: true });
}
const report = { glbBytes: bytes.length, triangles, joints: 65, materials: gltf.materials.map((m) => m.name), hoodieHasColorTexture: false, fallbacks: images, result: 'pass' };
await writeFile(new URL('qa/assets-verification.json', base), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
