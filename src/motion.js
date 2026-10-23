import * as THREE from 'three';
import { createPostureCorrection } from './posture.js';

export const STATION_CLIPS = Object.freeze(['Walk', 'Nod', 'Wave', 'LookAround']);
export const WALK_STATION = STATION_CLIPS.indexOf('Walk');
const SPEEDS = { Idle: 1, Nod: 1.1, Walk: 1, Wave: 1.05, LookAround: 1 };
const FADE_SECONDS = .5;
const WALK_PLAYBACK_SECONDS = 3.6;
// The reviewed first glance returns toward the camera before the next long
// side-look. Keep its source timing; do not speed up or synthesize a gesture.
const LOOK_AROUND_RANGE = Object.freeze([1.2, 7.0]);
const cleanName = (name) => name.replace(/^mixamorig[:_]?/i, '');
const smooth = (value) => value * value * (3 - 2 * value);

/** Use exact samples at both cut boundaries, including quaternion interpolation. */
function excerpt(source, name, start, end) {
  const tracks = source.tracks.map((track) => {
    const size = track.getValueSize(), times = [start];
    for (const time of track.times) if (time > start && time < end) times.push(time);
    times.push(end);
    const interpolant = track.createInterpolant(), values = [];
    for (const time of times) values.push(...Array.from(interpolant.evaluate(time)).slice(0, size));
    const result = track.clone(); result.times = new Float32Array(times.map((time) => time - start)); result.values = new Float32Array(values);
    return result;
  });
  return new THREE.AnimationClip(name, end - start, tracks, source.blendMode);
}

function uprightRestClip(rest) {
  const tracks = [];
  for (const [bone, pose] of rest) for (const property of ['position', 'quaternion', 'scale']) {
    const values = pose[property].toArray();
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(`${bone.name}.${property}`, [0, 1], [...values, ...values]));
  }
  return new THREE.AnimationClip('Idle', 1, tracks);
}

/** Continue the authored forward gait at its original speed, without reversing it. */
function extendWalk(source) {
  const duration = Math.max(source.duration, WALK_PLAYBACK_SECONDS);
  const tracks = source.tracks.map((track) => {
    const size = track.getValueSize(), interpolant = track.createInterpolant();
    const first = Array.from(interpolant.evaluate(0)).slice(0, size);
    const last = Array.from(interpolant.evaluate(source.duration)).slice(0, size);
    const binding = THREE.PropertyBinding.parseTrackName(track.name);
    const rootPosition = cleanName(binding.nodeName || '') === 'Hips' && binding.propertyName === 'position';
    const times = [], values = [];
    function append(time, sourceTime, cycle) {
      const value = Array.from(interpolant.evaluate(sourceTime)).slice(0, size);
      // Keep real horizontal travel continuous if a future source contains it.
      // Walk2 is in place; this adds no movement to its existing root track.
      if (rootPosition) for (const axis of [0, 2]) value[axis] += (last[axis] - first[axis]) * cycle;
      times.push(time); values.push(...value);
    }
    append(0, 0, 0);
    for (let cycle = 0; cycle * source.duration < duration; cycle++) {
      for (const time of track.times) {
        const at = cycle * source.duration + time;
        if (at > times.at(-1) && at < duration) append(at, time, cycle);
      }
      // The source's final pose is within 0.9 mm of its first pose. Retain that
      // final key and interpolate into the repeated first key over one source
      // frame, avoiding a hard reset at the cycle boundary.
      const boundary = (cycle + 1) * source.duration;
      if (boundary > times.at(-1) && boundary < duration) append(boundary, source.duration, cycle);
    }
    const cycle = Math.ceil(duration / source.duration) - 1;
    append(duration, duration - cycle * source.duration, cycle);
    const result = track.clone(); result.times = new Float32Array(times); result.values = new Float32Array(values);
    return result;
  });
  return new THREE.AnimationClip(source.name, duration, tracks, source.blendMode);
}

/**
 * Play the supplied body animation with a bounded upper-back correction.
 * Facial geometry, gaze and original rest transforms remain untouched.
 * `position` is world-space travel; the scene applies it to
 * the character group and follows it with the camera, lights and ground pool.
 */
export function createCharacterMotion({ model, animations, bones, reducedMotion = false }) {
  const position = new THREE.Vector3(), mixer = new THREE.AnimationMixer(model);
  const hips = bones.get('Hips')?.bone || [...bones.values()].find(({ bone }) => cleanName(bone.name) === 'Hips')?.bone;
  if (!hips) throw new Error('The supplied character has no Hips bone.');
  const rest = new Map([...bones.values()].map(({ bone, rest: quaternion }) => [bone, {
    position: bone.position.clone(), quaternion: quaternion?.clone() || bone.quaternion.clone(), scale: bone.scale.clone(),
  }]));
  const restHips = rest.get(hips).position;
  const posture = createPostureCorrection({ model, bones });
  const sourceClips = new Map(animations.map((clip) => [clip.name, clip]));
  const clips = new Map(), records = new Set(), history = [];
  const linearTransform = new THREE.Matrix3(), rootDelta = new THREE.Vector3(), beforeSample = new THREE.Vector3(), afterSample = new THREE.Vector3();
  let walkInterpolant = null, current = null, entry = null, rootRecord = null, transition = null;
  let station = -1, elapsed = 0, serial = 0, disposed = false, entryEnded = true, completedAction = null, dragging = false;

  for (const name of new Set(['Idle', ...STATION_CLIPS])) {
    const source = sourceClips.get(name);
    if (!source) continue;
    // Preserve the authored hand/head movement. No additive gestures or face
    // tracks are generated here. Rejected Greet, Box and CrossArms are never bound.
    // The supplied bind pose has a relaxed straight shoulder line and parallel
    // feet. The old Idle clip curls the chest and shoulders, even at its best
    // planted frame, so all chapters now return to the complete original pose.
    const clip = name === 'Idle' ? uprightRestClip(rest)
      : name === 'Wave' ? excerpt(source, name, 1.2, Math.min(4.3, source.duration))
      : name === 'LookAround' ? excerpt(source, name, LOOK_AROUND_RANGE[0], Math.min(LOOK_AROUND_RANGE[1], source.duration))
      : name === 'Walk' ? extendWalk(source) : source.clone();
    clip.name = name;
    for (const track of clip.tracks) {
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      if (cleanName(binding.nodeName || '') !== 'Hips' || binding.propertyName !== 'position') continue;
      if (name === 'Walk') walkInterpolant = track.clone().createInterpolant();
      // The authored vertical bounce is retained. Horizontal motion is moved
      // out of the skeleton so every pose blends around one stable origin.
      for (let i = 0; i < track.values.length; i += 3) { track.values[i] = restHips.x; track.values[i + 2] = restHips.z; }
    }
    clips.set(name, clip);
  }
  if (!reducedMotion && !clips.has('Idle')) throw new Error('A reviewed Idle clip is required.');

  function restoreRest() {
    posture.reset();
    for (const [bone, value] of rest) { bone.position.copy(value.position); bone.quaternion.copy(value.quaternion); bone.scale.copy(value.scale); }
    model.updateMatrixWorld(true);
    posture.update();
  }
  function release(record) {
    record.action.stop(); mixer.uncacheAction(record.clip); records.delete(record);
  }
  function start(name, fade = FADE_SECONDS, reason = 'station') {
    if (disposed || reducedMotion || !clips.has(name)) return false;
    const from = new Map([...records].map((record) => [record, record.weight]));
    // Each performance gets its own action, so rapid station changes never
    // reset a still-visible, fading action to its first frame.
    const clip = clips.get(name).clone(); clip.name = `${name}:${serial++}`;
    const action = mixer.clipAction(clip).reset().setEffectiveTimeScale(SPEEDS[name]).setEffectiveWeight(fade ? 0 : 1);
    action.setLoop(name === 'Idle' ? THREE.LoopPingPong : THREE.LoopOnce, name === 'Idle' ? Infinity : 1);
    action.clampWhenFinished = name !== 'Idle'; action.play();
    const record = { name, action, clip, rate: SPEEDS[name], weight: fade ? 0 : 1,
      idleMode: name === 'Idle' ? 'upright-rest' : null };
    records.add(record); current = record;
    history.push({ from: [...from].filter(([, weight]) => weight > .001).map(([r]) => r.name), to: name, at: elapsed, fade, reason });
    if (history.length > 12) history.shift();
    if (fade && from.size) transition = { from, to: record, elapsed: 0, duration: fade };
    else { for (const previous of from.keys()) release(previous); transition = null; record.weight = 1; action.setEffectiveWeight(1); }
    return record;
  }
  function enter(name, immediate, reason) {
    rootRecord = null; entryEnded = false; completedAction = null;
    if (name === 'Idle') {
      // Idle is a continuous station, not a one-shot entry. Reuse an existing
      // idle action so revisiting this station never restarts its loop phase.
      entry = null; entryEnded = true;
      return current?.name === 'Idle' || !!start('Idle', immediate ? 0 : FADE_SECONDS, reason);
    }
    entry = start(name, immediate ? 0 : FADE_SECONDS, reason);
    if (!entry) { entryEnded = true; return false; }
    if (name === 'Walk') rootRecord = entry;
    return true;
  }
  function finishIntoIdle(reason) {
    if (current?.name !== 'Idle') start('Idle', entry?.name === 'Walk' ? .55 : FADE_SECONDS, reason);
  }
  function setStation(index, { immediate = false, prepareOpening = false } = {}) {
    const next = ((Math.round(index) % 4) + 4) % 4;
    if (!Number.isFinite(next) || disposed || next === station) return false;
    const openingWalk = next === WALK_STATION && (station < 0 || prepareOpening);
    station = next;
    if (reducedMotion) { restoreRest(); return false; }
    // At dt=0 the outgoing action is still fully visible. Prime that action
    // with the upright original rest pose before the paused intro render;
    // once presentation time resumes, the existing fade starts the forward gait.
    if (openingWalk) { posture.reset(); start('Idle', 0, 'walk-opening'); mixer.update(0); posture.update(); }
    return enter(STATION_CLIPS[next], immediate && !openingWalk, 'station');
  }
  function update(dt, options = {}) {
    if (disposed) return;
    dragging = !!options.dragging;
    if (reducedMotion) { restoreRest(); return; }
    if (dragging) return;
    const delta = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const fade = entry?.name === 'Walk' ? .55 : FADE_SECONDS;
    const untilFade = entry && !entryEnded && current === entry ? (entry.clip.duration - entry.action.time) / entry.rate - fade : Infinity;
    // Split the frame at the authored-to-idle transition. Waiting for the next
    // rendered frame would delay deceleration at low frame rates.
    if (untilFade > 1e-7 && untilFade < delta) {
      advance(untilFade);
      if (current === entry) finishIntoIdle('settle');
      advance(delta - untilFade);
    } else {
      if (untilFade <= 1e-7 && current === entry) finishIntoIdle('settle');
      advance(delta);
    }
  }
  function advance(delta) {
    elapsed += delta;
    const walk = rootRecord, walkTime = walk?.action.time || 0, walkWeight = walk?.weight || 0;
    if (transition) {
      transition.elapsed += delta;
      const t = Math.min(1, transition.elapsed / transition.duration), weight = smooth(t);
      for (const [record, initial] of transition.from) { record.weight = initial * (1 - weight); record.action.setEffectiveWeight(record.weight); }
      transition.to.weight = weight; transition.to.action.setEffectiveWeight(weight);
      if (t === 1) { for (const previous of transition.from.keys()) if (previous !== transition.to && previous !== rootRecord && (previous !== entry || entryEnded)) release(previous); transition = null; }
    }
    posture.reset();
    mixer.update(delta);
    posture.update();
    // Transform a displacement (not a point) through the Hips parent. This
    // includes the preserved rig scale and any parent rotation, but never
    // re-adds the already accumulated character translation.
    if (walk && walkInterpolant) {
      beforeSample.fromArray(walkInterpolant.evaluate(walkTime));
      afterSample.fromArray(walkInterpolant.evaluate(walk.action.time));
      rootDelta.subVectors(afterSample, beforeSample); rootDelta.y = 0;
      hips.parent.updateWorldMatrix(true, false); linearTransform.setFromMatrix4(hips.parent.matrixWorld);
      rootDelta.applyMatrix3(linearTransform).multiplyScalar((walkWeight + walk.weight) * .5);
      rootDelta.y = 0; position.add(rootDelta);
      if (walk.action.time >= walk.clip.duration - 1e-6) rootRecord = null;
    }
    if (entry && !entryEnded) {
      const remaining = (entry.clip.duration - entry.action.time) / entry.rate;
      const fade = entry.name === 'Walk' ? .55 : FADE_SECONDS;
      if (remaining <= fade + 1e-7 && current === entry) finishIntoIdle('settle');
      if (remaining <= 1e-6) { entryEnded = true; completedAction = entry.name; }
    }
    for (const record of [...records]) if (record !== current && record !== rootRecord && (record !== entry || entryEnded) && record.weight <= 1e-6 && !transition?.from.has(record)) release(record);
    model.updateMatrixWorld(true);
  }
  function react() {
    if (disposed || reducedMotion || dragging || !entryEnded || rootRecord || station < 0 || STATION_CLIPS[station] === 'Idle') return false;
    // Keep the reviewed Walk-station response: click to nod, then return to its
    // upright original rest pose instead of replaying the walking entry.
    return enter(station === WALK_STATION ? 'Nod' : STATION_CLIPS[station], false, 'reaction');
  }
  function getState() {
    const visible = !entryEnded && entry ? entry : current;
    return { action: reducedMotion ? 'Rest' : visible?.name || 'Rest', time: visible?.action.time || 0,
      duration: visible?.clip.duration || 0, speed: visible?.rate || 0, walking: !!rootRecord, position: position.toArray(),
      station, reducedMotion, dragging, end: entryEnded, completedAction, clips: [...clips.keys()], rejected: ['Greet', 'Box', 'CrossArms'],
      transition: transition ? { to: transition.to.name, elapsed: transition.elapsed, duration: transition.duration } : null,
      transitions: history.map((item) => ({ ...item, from: [...item.from] })),
      weights: [...records].filter((record) => record.weight > .0001).map((record) => ({ action: record.name, weight: record.weight, time: record.action.time })),
      rootMotion: { extracted: true, space: 'world', bone: hips.name, horizontalRest: [restHips.x, restHips.z] },
      idleRange: null, idleMode: current?.idleMode || null, idleSourceTime: null, posture: posture.state(),
      walkPlayback: { sourceDuration: sourceClips.get('Walk')?.duration || 0, duration: clips.get('Walk')?.duration || 0, speed: SPEEDS.Walk },
      waveRange: [1.2, 4.3], lookAroundRange: [...LOOK_AROUND_RANGE], faceAnimation: false };
  }
  function dispose() { if (disposed) return; disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(model); records.clear(); transition = null; rootRecord = null; restoreRest(); }
  if (reducedMotion) restoreRest(); else { start('Idle', 0, 'initial'); mixer.update(0); posture.update(); }
  return { position, setStation, update, react, dispose, getState };
}
