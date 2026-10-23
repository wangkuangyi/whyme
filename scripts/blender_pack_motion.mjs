/** Append Blender-baked animation data without touching any model bytes. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('public/models/person-original-animated.glb', root));
const authored = JSON.parse(await readFile(new URL('output/blender-motion/authored-animations.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(source), authored.sourceSHA256);
const jsonSize = source.readUInt32LE(12), json = JSON.parse(source.subarray(20, 20 + jsonSize));
const originalJSON = structuredClone(json), binOffset = 20 + jsonSize;
const originalBin = source.subarray(binOffset + 8, binOffset + 8 + source.readUInt32LE(binOffset));
assert.equal(json.buffers.length, 1); assert.equal(json.buffers[0].uri, undefined);
const chunks = [originalBin], nodes = new Map(json.nodes.map((node, i) => [node.name, i]));
let length = originalBin.length;
function accessor(values, type) {
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const binary = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => { assert.ok(Number.isFinite(value)); binary.writeFloatLE(value, i * 4); });
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: binary.length });
  chunks.push(binary); length += binary.length;
  const index = json.accessors.length, item = { bufferView: view, componentType: 5126, count: values.length / width, type };
  if (type === 'SCALAR') { item.min = [values[0]]; item.max = [values.at(-1)]; }
  json.accessors.push(item); return index;
}
json.animations = authored.actions.map(action => {
  const animation = { name: action.name, channels: [], samplers: [] };
  const input = accessor(action.frames.map((_, i) => i / action.fps), 'SCALAR');
  for (const name of Object.keys(action.frames[0])) {
    const node = nodes.get(name); assert.notEqual(node, undefined);
    for (const path of name.endsWith('Hips') ? ['rotation', 'translation'] : ['rotation']) {
      const values = []; let previous;
      for (const frame of action.frames) {
        let value = [...frame[name][path]];
        if (path === 'rotation') {
          const norm = Math.hypot(...value); value = value.map(n => n / norm);
          if (previous && value.reduce((s, n, i) => s + n * previous[i], 0) < 0) value = value.map(n => -n);
          previous = value;
        }
        values.push(...value);
      }
      const output = accessor(values, path === 'rotation' ? 'VEC4' : 'VEC3');
      animation.channels.push({ sampler: animation.samplers.length, target: { node, path } });
      animation.samplers.push({ input, output, interpolation: 'LINEAR' });
    }
  }
  return animation;
});
json.buffers[0].byteLength = length;
const rawJSON = Buffer.from(JSON.stringify(json)), jsonBytes = Buffer.alloc((rawJSON.length + 3) & ~3, 0x20); rawJSON.copy(jsonBytes);
const bin = Buffer.concat(chunks), output = Buffer.alloc(28 + jsonBytes.length + bin.length);
output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(jsonBytes.length, 12); output.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(output, 20);
output.writeUInt32LE(bin.length, 20 + jsonBytes.length); output.writeUInt32LE(0x004e4942, 24 + jsonBytes.length); bin.copy(output, 28 + jsonBytes.length);
const preserved = ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'scenes'];
for (const key of preserved) assert.deepEqual(json[key], originalJSON[key]);
assert.ok(bin.subarray(0, originalBin.length).equals(originalBin));
await writeFile(new URL('public/models/person-authored-animated.glb', root), output);
await mkdir(new URL('qa/blender-motion/', root), { recursive: true });
await writeFile(new URL('qa/blender-motion/asset-preservation.json', root), JSON.stringify({
  sourceSHA256: hash(source), outputSHA256: hash(output), bytes: output.length, blender: authored.blender,
  originalBinaryPrefixPreserved: true, originalBinaryBytes: originalBin.length, preserved,
  actions: authored.actions.map(({ name, duration, fps, frames }) => ({ name, duration, fps, frames: frames.length })),
}, null, 2) + '\n');
console.log(`Preserved ${originalBin.length} original binary bytes; packed ${output.length} bytes of Blender-baked animation assets.`);
