/** Synthetic controller regression. This does not certify the Blender asset or appearance. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createCharacterMotion, STATION_CLIPS } from '../../src/motion.js';

function fixture(reducedMotion = false) {
  const model = new THREE.Group(), hips = new THREE.Bone(), chest = new THREE.Bone();
  hips.name = 'mixamorigHips'; chest.name = 'mixamorigSpine2';
  hips.position.y = 1; chest.position.y = .5; hips.add(chest); model.add(hips);
  const bones = new Map([['Hips', { bone: hips }], ['Spine2', { bone: chest }]]);
  const period = 4.8, lengths = { Idle: period, Walk: 4.4, Nod: 4.15, Wave: 5.2, Wait: 8 };
  const animations = Object.entries(lengths).map(([name, duration]) => {
    const times = [], rotations = [], positions = [], pelvis = [];
    for (let i = 0, count = Math.ceil(duration * 240); i <= count; i++) {
      const time = duration * i / count, phase = time / period * Math.PI * 2;
      const gesture = name === 'Idle' ? 0 : Math.sin(Math.PI * time / duration) ** 4 * .2;
      times.push(time);
      rotations.push(...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(phase) * .03 + gesture).toArray());
      positions.push(.01 * Math.sin(phase), .5, 0); pelvis.push(0, 1, 0);
    }
    return new THREE.AnimationClip(name, duration, [
      new THREE.VectorKeyframeTrack('mixamorigHips.position', times, pelvis),
      new THREE.VectorKeyframeTrack('mixamorigSpine2.position', times, positions),
      new THREE.QuaternionKeyframeTrack('mixamorigSpine2.quaternion', times, rotations),
    ]);
  });
  const source = JSON.stringify(animations.map(clip => clip.tracks.map(track => [Array.from(track.times), Array.from(track.values)])));
  return { motion: createCharacterMotion({ model, bones, animations, reducedMotion }), animations, source, hips, chest };
}
const checks = [];
function check(name, test) {
  try { test(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
for (const fps of [20, 30, 60, 120]) for (let station = 0; station < 4; station++) {
  const context = fixture(); context.motion.setStation(station);
  const duration = context.animations.find(clip => clip.name === STATION_CLIPS[station]).duration;
  const frames = Math.ceil((duration + .25) * fps);
  for (let i = 0; i < frames; i++) context.motion.update(1 / fps);
  check(`${STATION_CLIPS[station]}-${fps}fps-phase-matched-zero-fade-return-and-source-preservation`, () => {
    const state = context.motion.getState();
    assert.equal(state.action, 'Idle'); assert.equal(state.end, true);
    assert.equal(state.completedAction, STATION_CLIPS[station]); assert.equal(state.transition, null);
    assert.equal(state.idleMode, 'authored-idle'); assert.equal(state.posture.runtimeCorrection, false);
    assert.equal(state.breathing, undefined);
    assert.ok(Math.abs(state.idleAnimation.time - (frames / fps) % 4.8) < 1e-6);
    const returned = state.transitions.find(item => item.reason === 'authored-return');
    assert.equal(returned.fade, 0); assert.ok(Math.abs(returned.startTime - duration % 4.8) < 1e-8);
    assert.equal(JSON.stringify(context.animations.map(clip => clip.tracks.map(track => [Array.from(track.times), Array.from(track.values)]))), context.source);
  });
  context.motion.dispose();
}
const idle = fixture(), initial = idle.chest.quaternion.clone();
for (let i = 0; i < 144; i++) idle.motion.update(1 / 120);
check('Idle-actually-advances-an-independent-bone-rotation-clip', () => assert.ok(idle.chest.quaternion.angleTo(initial) > .02));
const pause = JSON.stringify(idle.motion.getState());
for (let i = 0; i < 200; i++) idle.motion.update(0);
check('zero-delta-presentation-pause-preserves-all-state', () => assert.equal(JSON.stringify(idle.motion.getState()), pause));
const frozen = idle.chest.quaternion.clone();
for (let i = 0; i < 200; i++) idle.motion.update(1 / 120, { dragging: true });
check('dragging-preserves-evaluated-bone-pose', () => assert.ok(idle.chest.quaternion.equals(frozen)));
const reduced = fixture(true), reducedPose = reduced.chest.quaternion.clone();
for (let station = 0; station < 4; station++) {
  reduced.motion.setStation(station);
  for (let i = 0; i < 200; i++) reduced.motion.update(1 / 120);
}
check('reduced-motion-holds-Idle-zero-across-all-stations', () => {
  assert.ok(reduced.chest.quaternion.equals(reducedPose)); assert.equal(reduced.motion.getState().action, 'Idle');
  assert.equal(reduced.motion.getState().idleAnimation.animated, false);
});
const rapid = fixture();
for (let i = 0; i < 100; i++) { rapid.motion.setStation(i % 4); rapid.motion.update(.1); }
for (let i = 0; i < 100; i++) rapid.motion.update(.1);
check('100-rapid-station-changes-retire-all-outgoing-actions', () => assert.deepEqual(rapid.motion.getState().weights.map(weight => weight.action), ['Idle']));
const click = fixture(); click.motion.setStation(0);
for (let i = 0; i < 60; i++) click.motion.update(.1);
check('station-01-click-plays-Nod-not-Walk', () => { assert.equal(click.motion.react(), true); assert.equal(click.motion.getState().action, 'Nod'); });
for (const context of [idle, reduced, rapid, click]) context.motion.dispose();
const motionSHA256 = createHash('sha256').update(await readFile(new URL('../../src/motion.js', import.meta.url))).digest('hex');
const result = {
  method: 'Independent synthetic two-bone controller fixture with deliberately nonstatic Idle and authored matching gesture endpoints.',
  limitations: 'Does not validate the real model, Blender edits, cloth intersections or browser appearance. Those require the separate authored-motion and clothing reports and screenshot review.',
  motionSHA256, passed: checks.filter(item => item.passed).length, total: checks.length, checks,
};
await writeFile(new URL('./player-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(`${result.passed}/${result.total} synthetic controller checks passed.`);
for (const item of checks.filter(item => !item.passed)) console.error(item.name, item.error);
process.exitCode = result.passed === result.total ? 0 : 1;
