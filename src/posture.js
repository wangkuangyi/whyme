import * as THREE from 'three';

const SUPPORT_START = 4, SUPPORT_FULL = 9, TARGET_CURVE = 3, NECK_ALLOWANCE = 1;
const LIMITS = { Spine: 14, Spine1: 14, Spine2: 20, Neck: 15 };
const AFFECTED = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
const UP = new THREE.Vector3(0, 1, 0);
const degrees = THREE.MathUtils.radToDeg;
const smootherstep = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Create before animation starts, so the reference is the original bind/rest pose. */
export function createPostureCorrection({ model, bones }) {
  const getBone = name => { const value = bones.get(name); return value?.bone || value; };
  const names = ['LeftUpLeg', 'RightUpLeg', ...AFFECTED];
  const joints = Object.fromEntries(names.map(name => [name, getBone(name)]));
  for (const name of names) if (!joints[name]) throw new Error(`Posture correction requires ${name}.`);
  const affected = AFFECTED.map(name => joints[name]), original = affected.map(() => new THREE.Quaternion());
  const right = new THREE.Vector3(), forward = new THREE.Vector3(), axis = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), segment = new THREE.Vector3();
  const world = new THREE.Quaternion(), parent = new THREE.Quaternion(), rotation = new THREE.Quaternion(), headWorld = new THREE.Quaternion();
  const maximum = { deltaDegrees: 0, spineDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, neckDegrees: 0, headDirectionError: 0 };
  let applied = false, last;

  function setBodyAxes() {
    joints.RightUpLeg.getWorldPosition(a); joints.LeftUpLeg.getWorldPosition(b);
    right.subVectors(a, b); right.y = 0;
    if (right.lengthSq() < 1e-12) right.set(-1, 0, 0); else right.normalize();
    forward.crossVectors(UP, right); axis.copy(right).negate();
  }
  function tilt(top, bottom) {
    joints[top].getWorldPosition(a); joints[bottom].getWorldPosition(b); segment.subVectors(a, b);
    return degrees(Math.atan2(segment.dot(forward), segment.y));
  }
  function measure() {
    const lower = tilt('Spine1', 'Spine'), middle = tilt('Spine2', 'Spine1'), upper = tilt('Neck', 'Spine2');
    return { lower, middle, upper, neck: tilt('Head', 'Neck'), curve: ((upper - middle + 180) % 360 + 360) % 360 - 180 };
  }
  model.updateWorldMatrix(true, true); setBodyAxes();
  const reference = measure();
  const targets = { lower: reference.lower, middle: reference.middle, upper: reference.middle + TARGET_CURVE, neck: reference.neck + NECK_ALLOWANCE };

  function rotateInWorld(joint, angleDegrees) {
    joint.getWorldQuaternion(world).normalize();
    rotation.setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDegrees)); world.premultiply(rotation);
    joint.parent.getWorldQuaternion(parent).normalize().invert();
    joint.quaternion.copy(parent.multiply(world)).normalize(); model.updateWorldMatrix(true, true);
  }
  // Restore before mixer sampling, including when that clip omits these tracks.
  function reset() {
    if (!applied) return;
    affected.forEach((joint, index) => joint.quaternion.copy(original[index]));
    applied = false; last.active = false; model.updateWorldMatrix(true, true);
  }
  function update({ support } = {}) {
    reset(); model.updateWorldMatrix(true, true); setBodyAxes();
    const before = measure(), backwardDeviation = reference.middle - before.middle;
    // Explicit support is for source-clip baking, before the mixer crossfades.
    // Applying a nonlinear gate after a crossfade can bend the torso halfway
    // back down while its source weight fades, even with a smooth gate.
    const activation = support === undefined ? smootherstep((backwardDeviation - SUPPORT_START) / (SUPPORT_FULL - SUPPORT_START)) : THREE.MathUtils.clamp(support, 0, 1);
    last = { active: false, activation, curveBefore: before.curve, curveAfter: before.curve, before, after: { ...before }, deltaDegrees: 0, spineDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, neckDegrees: 0, headDirectionError: 0 };
    if (activation === 0) return;
    affected.forEach((joint, index) => original[index].copy(joint.quaternion));
    joints.Head.getWorldQuaternion(headWorld).normalize();
    // Align each supporting segment. A single backward torso tilt would deepen
    // the source's lumbar arch instead of straightening the chest.
    const corrections = {};
    for (const [name, top, bottom, target] of [
      ['Spine', 'Spine1', 'Spine', targets.lower],
      ['Spine1', 'Spine2', 'Spine1', targets.middle],
      ['Spine2', 'Neck', 'Spine2', targets.upper],
      ['Neck', 'Head', 'Neck', targets.neck],
    ]) {
      const delta = THREE.MathUtils.clamp((target - tilt(top, bottom)) * activation, -LIMITS[name], LIMITS[name]);
      corrections[name] = delta; rotateInWorld(joints[name], delta);
    }
    // Preserve the authored nod/turn in world space while realigning its support.
    joints.Head.parent.getWorldQuaternion(parent).normalize().invert();
    joints.Head.quaternion.copy(parent.multiply(headWorld)).normalize();
    model.updateWorldMatrix(true, true); applied = true;
    const after = measure(), deltaDegrees = Math.max(...Object.values(corrections).map(Math.abs));
    const headDirectionError = joints.Head.getWorldQuaternion(world).normalize().angleTo(headWorld);
    last = { ...last, active: true, after, curveAfter: after.curve, deltaDegrees, spineDegrees: corrections.Spine, spine1Degrees: corrections.Spine1, spine2Degrees: corrections.Spine2, neckDegrees: corrections.Neck, headDirectionError };
    for (const key of Object.keys(maximum)) maximum[key] = Math.max(maximum[key], Math.abs(last[key]));
  }
  function state() {
    return { ...last, correctionDegrees: last?.deltaDegrees || 0, max: { ...maximum, correctionDegrees: maximum.deltaDegrees }, reference: { ...reference }, targets: { ...targets }, limits: { curveDegrees: TARGET_CURVE, correctionDegrees: 20, perJoint: { ...LIMITS }, supportStartDegrees: SUPPORT_START, supportFullDegrees: SUPPORT_FULL }, bones: [...AFFECTED] };
  }
  function inspect() {
    model.updateWorldMatrix(true, true); setBodyAxes(); const current = measure();
    return { ...state(), mode: 'observed', active: false, activation: 0, curveBefore: current.curve, curveAfter: current.curve, before: { ...current }, after: { ...current }, correctionDegrees: 0, deltaDegrees: 0, spineDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, neckDegrees: 0, headDirectionError: 0 };
  }
  return { update, reset, state, inspect };
}
