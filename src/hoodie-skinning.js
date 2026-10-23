import { HOODIE_BASELINE, HOODIE_WEIGHT_ROWS } from './hoodie-skinning-data.js';

const applied = new WeakMap();
const fingerprint = array => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const requireMatch = (condition, detail) => { if (!condition) throw new Error(`Drawstring correction does not match this original model: ${detail}.`); };

/**
 * Repair the two original hoodie cords' automatic arm weights. Keep the loaded
 * geometry object, its original surface, textures and animation samples intact.
 * Apply before sampling skinned bounds; no per-frame position offsets are used.
 */
export function applyHoodieSkinning(mesh) {
  requireMatch(mesh?.isSkinnedMesh && mesh.geometry && mesh.skeleton, 'expected a SkinnedMesh');
  const { geometry, skeleton } = mesh;
  requireMatch(skeleton.bones.length === HOODIE_BASELINE.bones.length, 'joint count');
  skeleton.bones.forEach((bone, i) => {
    requireMatch(bone.name.replace(/^mixamorig[:_]?/i, '') === HOODIE_BASELINE.bones[i], `joint ${i}`);
    requireMatch(skeleton.bones.indexOf(bone.parent) === HOODIE_BASELINE.parents[i], `joint parent ${i}`);
  });
  const inverses = new Float32Array(skeleton.boneInverses.flatMap(matrix => matrix.elements));
  requireMatch(fingerprint(inverses) === HOODIE_BASELINE.inverseBindHash, 'inverse bind matrices');
  const previous = applied.get(geometry);
  if (previous) {
    requireMatch(geometry.getAttribute('skinIndex') === previous.skinIndex && geometry.getAttribute('skinWeight') === previous.skinWeight, 'replaced corrected attributes');
    return previous.result;
  }
  // Byte fingerprints cover the full arrays, including every selected position.
  // The complete file SHA-256 is checked by the reproducible generator and QA;
  // these synchronous runtime guards also cover the static original GLB.
  for (const [name, expected] of Object.entries(HOODIE_BASELINE.attributes)) {
    const value = geometry.getAttribute(name);
    requireMatch(value && !value.isInterleavedBufferAttribute && !value.normalized, `${name} storage`);
    requireMatch(value.count === expected.count && value.itemSize === expected.itemSize && value.array.constructor.name === expected.type, `${name} layout`);
    const hash = fingerprint(value.array);
    requireMatch(hash === expected.hash || hash === expected.loaderHash, `${name} data`);
  }
  const index = geometry.getIndex();
  requireMatch(index && index.count === HOODIE_BASELINE.index.count && index.array.constructor.name === HOODIE_BASELINE.index.type && fingerprint(index.array) === HOODIE_BASELINE.index.hash, 'triangle indices');
  const skinIndex = geometry.getAttribute('skinIndex').clone(), skinWeight = geometry.getAttribute('skinWeight').clone();
  for (const row of HOODIE_WEIGHT_ROWS) {
    const [id, a, b, c, d, wa, wb, wc, wd] = row;
    skinIndex.setXYZW(id, a, b, c, d); skinWeight.setXYZW(id, wa, wb, wc, wd);
  }
  skinIndex.needsUpdate = true; skinWeight.needsUpdate = true;
  geometry.setAttribute('skinIndex', skinIndex); geometry.setAttribute('skinWeight', skinWeight);
  const result = Object.freeze({ version: HOODIE_BASELINE.version, vertices: HOODIE_WEIGHT_ROWS.length });
  applied.set(geometry, { skinIndex, skinWeight, result });
  return result;
}
