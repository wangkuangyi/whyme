/** Reproducible geometry compression; run after prepare_person.py. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { copyFile, unlink, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const input = fileURLToPath(new URL('../public/models/person.glb', import.meta.url));
const output = fileURLToPath(new URL('../public/models/person.optimized.glb', import.meta.url));
const original = fileURLToPath(new URL('../qa/person-uncompressed.glb', import.meta.url));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
const sourceBytes = (await stat(input)).size;
await copyFile(input, original);
const document = await io.read(input);
await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, document);
const reopened = await io.read(output);
const materials = reopened.getRoot().listMaterials().map((material) => material.getName());
const skins = reopened.getRoot().listSkins();
if (!materials.includes('Hoodie') || skins.length !== 1 || skins[0].listJoints().length !== 65) {
  throw new Error('Compression validation failed: Hoodie or source rig did not survive.');
}
await copyFile(output, input);
await unlink(output);
const report = {
  sourceBytes,
  compressedBytes: (await stat(input)).size,
  materials,
  jointCount: skins[0].listJoints().length,
  extensions: reopened.getRoot().listExtensionsUsed().map((extension) => extension.extensionName),
  validation: 'Compressed GLB was reopened; independent Hoodie and 65-joint skin preserved.',
};
await writeFile(new URL('../qa/model-compression.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
