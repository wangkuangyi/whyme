import * as THREE from 'three';

const MAX_CURVE_DEGREES = 8, MAX_CORRECTION_DEGREES = 8, LOWER_SHARE = .45;
const UP = new THREE.Vector3(0, 1, 0);
const degrees = radians => radians * 180 / Math.PI;

/** Reduce excessive upper-back curvature without changing the authored gaze. */
export function createPostureCorrection({ model, bones }) {
  const getBone = name => { const value = bones.get(name); return value?.bone || value; };
  const names = ['LeftUpLeg', 'RightUpLeg', 'Spine1', 'Spine2', 'Neck', 'Head'];
  const joints = Object.fromEntries(names.map(name => [name, getBone(name)]));
  for (const name of names) if (!joints[name]) throw new Error(`Posture correction requires ${name}.`);
  const affected = [joints.Spine1, joints.Spine2, joints.Head];
  const original = affected.map(() => new THREE.Quaternion());
  const right = new THREE.Vector3(), forward = new THREE.Vector3(), axis = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), segment = new THREE.Vector3();
  const world = new THREE.Quaternion(), parent = new THREE.Quaternion(), rotation = new THREE.Quaternion(), headWorld = new THREE.Quaternion();
  const maximum = { deltaDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, headDirectionError: 0 };
  let applied = false;
  let last = { active: false, curveBefore: 0, curveAfter: 0, deltaDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, headDirectionError: 0 };

  function measureCurve() {
    joints.RightUpLeg.getWorldPosition(a); joints.LeftUpLeg.getWorldPosition(b);
    right.subVectors(a, b); right.y = 0;
    if (right.lengthSq() < 1e-12) right.set(-1, 0, 0); else right.normalize();
    forward.crossVectors(UP, right); axis.copy(right).negate();
    const tilt = (top, bottom) => {
      top.getWorldPosition(a); bottom.getWorldPosition(b); segment.subVectors(a, b);
      return degrees(Math.atan2(segment.dot(forward), segment.y));
    };
    const middle = tilt(joints.Spine2, joints.Spine1), upper = tilt(joints.Neck, joints.Spine2);
    return ((upper - middle + 180) % 360 + 360) % 360 - 180;
  }
  function rotateInWorld(joint, angleDegrees) {
    joint.getWorldQuaternion(world).normalize();
    rotation.setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDegrees));
    world.premultiply(rotation);
    joint.parent.getWorldQuaternion(parent).normalize().invert();
    joint.quaternion.copy(parent.multiply(world)).normalize();
    model.updateWorldMatrix(true, true);
  }
  // Undo the previous rendered frame before the AnimationMixer samples again.
  // This is essential when a clip omits one of these tracks: no correction may
  // become the next frame's starting pose and accumulate over time.
  function reset() {
    if (!applied) return;
    affected.forEach((joint, index) => joint.quaternion.copy(original[index]));
    applied = false; last.active = false; model.updateWorldMatrix(true, true);
  }
  function update() {
    reset(); model.updateWorldMatrix(true, true);
    const curveBefore = measureCurve();
    const deltaDegrees = Math.min(MAX_CORRECTION_DEGREES, Math.max(0, curveBefore - MAX_CURVE_DEGREES));
    last = { active: false, curveBefore, curveAfter: curveBefore, deltaDegrees: 0, spine1Degrees: 0, spine2Degrees: 0, headDirectionError: 0 };
    if (deltaDegrees <= 1e-5) return;
    affected.forEach((joint, index) => original[index].copy(joint.quaternion));
    joints.Head.getWorldQuaternion(headWorld).normalize();
    const spine1Degrees = deltaDegrees * LOWER_SHARE, spine2Degrees = -deltaDegrees;
    rotateInWorld(joints.Spine1, spine1Degrees);
    rotateInWorld(joints.Spine2, spine2Degrees);
    // Counter only the inherited head rotation; preserve source nods and turns.
    joints.Head.parent.getWorldQuaternion(parent).normalize().invert();
    joints.Head.quaternion.copy(parent.multiply(headWorld)).normalize();
    model.updateWorldMatrix(true, true); applied = true;
    const headDirectionError = joints.Head.getWorldQuaternion(world).normalize().angleTo(headWorld);
    last = { active: true, curveBefore, curveAfter: measureCurve(), deltaDegrees, spine1Degrees, spine2Degrees, headDirectionError };
    maximum.deltaDegrees = Math.max(maximum.deltaDegrees, deltaDegrees);
    maximum.spine1Degrees = Math.max(maximum.spine1Degrees, Math.abs(spine1Degrees));
    maximum.spine2Degrees = Math.max(maximum.spine2Degrees, Math.abs(spine2Degrees));
    maximum.headDirectionError = Math.max(maximum.headDirectionError, headDirectionError);
  }
  function state() {
    return { ...last, correctionDegrees: last.deltaDegrees, max: { ...maximum, correctionDegrees: maximum.deltaDegrees }, limits: { curveDegrees: MAX_CURVE_DEGREES, correctionDegrees: MAX_CORRECTION_DEGREES }, bones: ['Spine1', 'Spine2', 'Head'] };
  }
  return { update, reset, state };
}
