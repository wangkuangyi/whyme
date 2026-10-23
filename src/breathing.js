import * as THREE from 'three';

const PERIOD_SECONDS = 4.8;
// Millimetre-scale chest lift, without curling the spine or scaling the face.
const LIFTS = [['Spine1', .0016], ['Spine2', .0012]];

export function createIdleBreathing({ model, bones }) {
  const joints = LIFTS.map(([name, lift]) => {
    const entry = bones.get(name), bone = entry?.bone || entry;
    if (!bone) throw new Error(`Breathing requires ${name}.`);
    return { bone, lift, source: new THREE.Vector3() };
  });
  const inverse = new THREE.Matrix4(), linear = new THREE.Matrix3(), offset = new THREE.Vector3();
  let applied = false;
  let last = { time: 0, phase: 0, amount: 0, weight: 0, liftMetres: 0 };
  function reset() {
    if (!applied) return;
    for (const { bone, source } of joints) bone.position.copy(source);
    applied = false;
    model.updateWorldMatrix(true, true);
  }
  function update(time, weight = 1) {
    reset();
    const phase = ((time % PERIOD_SECONDS) + PERIOD_SECONDS) % PERIOD_SECONDS / PERIOD_SECONDS;
    const amount = .5 - .5 * Math.cos(phase * Math.PI * 2);
    const strength = THREE.MathUtils.clamp(weight, 0, 1);
    last = { time, phase, amount, weight: strength, liftMetres: .0028 * amount * strength };
    if (amount * strength < 1e-12) return;
    for (const { bone, source, lift } of joints) {
      source.copy(bone.position);
      // Convert a world-space chest lift into its parent's local coordinates.
      // The two translated joints preserve all bone rotations, including gaze.
      bone.parent.updateWorldMatrix(true, false);
      linear.setFromMatrix4(inverse.copy(bone.parent.matrixWorld).invert());
      offset.set(0, lift * amount * strength, 0).applyMatrix3(linear);
      bone.position.add(offset);
      bone.updateWorldMatrix(false, true);
    }
    applied = true;
  }
  function state() { return { ...last, periodSeconds: PERIOD_SECONDS, maximumLiftMetres: .0028, bones: LIFTS.map(([name]) => name) }; }
  return { reset, update, state };
}
