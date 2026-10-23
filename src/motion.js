import * as THREE from 'three';

export const STATION_CLIPS = Object.freeze(['Walk', 'Nod', 'Wait', 'Wave']);
export const WALK_STATION = STATION_CLIPS.indexOf('Walk');
const FADE_SECONDS = .35;
const WAIT_FADE_SECONDS = .45;
const AUTHORED_RETURN_SECONDS = .8;
const cleanName = name => name.replace(/^mixamorig[:_]?/i, '');
const smooth = value => value * value * (3 - 2 * value);
const smoother = value => value ** 3 * (value * (value * 6 - 15) + 10);

/**
 * Play the finished Blender performances, including their authored return to
 * the looping Idle. No posture solver, synthetic breath or runtime retiming.
 * World-space travel is kept outside the rig for the scene's following camera.
 */
export function createCharacterMotion({ model, animations, bones, reducedMotion = false }) {
  const position = new THREE.Vector3(), mixer = new THREE.AnimationMixer(model);
  const hips = bones.get('Hips')?.bone || [...bones.values()].find(({ bone }) => cleanName(bone.name) === 'Hips')?.bone;
  if (!hips) throw new Error('The supplied character has no Hips bone.');
  const rest = new Map([...bones.values()].map(({ bone }) => [bone, {
    position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
  }]));
  const sourceClips = new Map(animations.map(clip => [clip.name, clip]));
  const clips = new Map(), records = new Set(), history = [];
  for (const name of ['Idle', ...STATION_CLIPS]) {
    const source = sourceClips.get(name);
    if (!source || !(source.duration > 0)) throw new Error(`The authored character requires a nonempty ${name} clip.`);
    clips.set(name, source.clone());
  }
  const idleDuration = clips.get('Idle').duration;
  const hipsTrack = clip => clip.tracks.find(track => {
    const binding = THREE.PropertyBinding.parseTrackName(track.name);
    return cleanName(binding.nodeName || '') === 'Hips' && binding.propertyName === 'position';
  });
  const idleHipsTrack = hipsTrack(clips.get('Idle'));
  const idleHipsStart = idleHipsTrack ? new THREE.Vector3().fromArray(idleHipsTrack.createInterpolant().evaluate(0)) : rest.get(hips).position.clone();
  const walkHipsTrack = hipsTrack(clips.get('Walk'));
  const walkInterpolant = walkHipsTrack?.clone().createInterpolant();
  if (walkHipsTrack) for (let i = 0; i < walkHipsTrack.values.length; i += 3) {
    // Extract Walk travel only. The other authored clips retain their complete
    // pelvis motion, including the small weight shifts inside the real Idle.
    walkHipsTrack.values[i] = idleHipsStart.x;
    walkHipsTrack.values[i + 2] = idleHipsStart.z;
  }
  const linearTransform = new THREE.Matrix3(), rootDelta = new THREE.Vector3(), beforeSample = new THREE.Vector3(), afterSample = new THREE.Vector3();
  let current = null, entry = null, rootRecord = null, transition = null;
  let station = -1, elapsed = 0, serial = 0, disposed = false, entryEnded = true, completedAction = null, dragging = false;

  function release(record) {
    record.action.stop(); mixer.uncacheAction(record.clip); records.delete(record);
  }
  function start(name, fade = FADE_SECONDS, reason = 'station', startTime = 0) {
    const from = new Map([...records].map(record => [record, record.weight]));
    // Separate instances let an interrupted performance fade from its actual
    // current sample, even when a subsequent click starts the same clip again.
    const clip = clips.get(name).clone(); clip.name = `${name}:${serial++}`;
    const action = mixer.clipAction(clip).reset().setEffectiveTimeScale(1).setEffectiveWeight(fade ? 0 : 1);
    action.setLoop(name === 'Idle' ? THREE.LoopRepeat : THREE.LoopOnce, name === 'Idle' ? Infinity : 1);
    action.clampWhenFinished = name !== 'Idle'; action.time = startTime; action.play();
    const record = { name, action, clip, rate: 1, weight: fade ? 0 : 1 };
    records.add(record); current = record;
    history.push({ from: [...from].filter(([, weight]) => weight > .001).map(([record]) => record.name), to: name, at: elapsed, fade, reason, startTime });
    if (history.length > 12) history.shift();
    if (fade && from.size) transition = { from, to: record, elapsed: 0, duration: fade };
    else {
      for (const previous of from.keys()) release(previous);
      transition = null; record.weight = 1; action.setEffectiveWeight(1);
    }
    return record;
  }
  function enter(name, immediate, reason) {
    rootRecord = null; entryEnded = false; completedAction = null;
    // A raised waving arm needs more time to/from the hands-on-hips pose.
    // Walk keeps its shorter blend so its forward arm swing clears the waist.
    const involvesWait = name === 'Wait' || [...records].some(record => record.name === 'Wait' && record.weight > .001);
    entry = start(name, immediate ? 0 : involvesWait && name !== 'Walk' ? WAIT_FADE_SECONDS : FADE_SECONDS, reason);
    if (name === 'Walk') rootRecord = entry;
    return true;
  }
  function finishIntoIdle() {
    if (!entry || entryEnded) return;
    const completed = entry;
    entryEnded = true; completedAction = completed.name; rootRecord = null;
    // Blender already authored the return pose and velocity. Continue the real
    // Idle at that same phase, with no second full-body fade back to bind pose.
    start('Idle', 0, 'authored-return', completed.clip.duration % idleDuration);
    entry = null;
    mixer.update(0); model.updateMatrixWorld(true);
  }
  function setStation(index, { immediate = false, prepareOpening = false } = {}) {
    const next = ((Math.round(index) % STATION_CLIPS.length) + STATION_CLIPS.length) % STATION_CLIPS.length;
    if (!Number.isFinite(next) || disposed || next === station) return false;
    const opening = station < 0 || prepareOpening;
    station = next;
    if (reducedMotion) return false;
    // All performances start at Idle phase zero. The loading screen therefore
    // reveals a real relaxed idle sample, not an intermediate stride or Rest.
    if (opening) { start('Idle', 0, 'opening', 0); mixer.update(0); }
    return enter(STATION_CLIPS[next], immediate && !opening, 'station');
  }
  function advance(delta) {
    elapsed += delta;
    const walk = rootRecord, walkTime = walk?.action.time || 0, walkWeight = walk?.weight || 0;
    if (transition) {
      transition.elapsed += delta;
      const t = Math.min(1, transition.elapsed / transition.duration), weight = smooth(t);
      for (const [record, initial] of transition.from) { record.weight = initial * (1 - weight); record.action.setEffectiveWeight(record.weight); }
      transition.to.weight = weight; transition.to.action.setEffectiveWeight(weight);
      if (t === 1) {
        for (const previous of transition.from.keys()) if (previous !== transition.to) release(previous);
        transition = null;
      }
    }
    mixer.update(delta);
    if (walk && walkInterpolant) {
      beforeSample.fromArray(walkInterpolant.evaluate(walkTime));
      afterSample.fromArray(walkInterpolant.evaluate(walk.action.time));
      rootDelta.subVectors(afterSample, beforeSample); rootDelta.y = 0;
      hips.parent.updateWorldMatrix(true, false); linearTransform.setFromMatrix4(hips.parent.matrixWorld);
      rootDelta.applyMatrix3(linearTransform).multiplyScalar((walkWeight + walk.weight) * .5);
      rootDelta.y = 0; position.add(rootDelta);
    }
    for (const record of [...records]) if (record !== current && record.weight <= 1e-6 && !transition?.from.has(record)) release(record);
    model.updateMatrixWorld(true);
  }
  function update(dt, options = {}) {
    if (disposed) return;
    dragging = !!options.dragging;
    if (reducedMotion || dragging || options.paused) return;
    const delta = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const untilEnd = entry && !entryEnded ? Math.max(0, entry.clip.duration - entry.action.time) : Infinity;
    // Split exactly at the authored boundary, then advance the matching Idle
    // by this frame's remainder. This keeps the splice independent of frame rate.
    if (untilEnd <= delta) {
      advance(untilEnd); finishIntoIdle();
      if (delta > untilEnd) advance(delta - untilEnd);
    } else advance(delta);
  }
  function react() {
    if (disposed || reducedMotion || dragging || !entryEnded || rootRecord || station < 0) return false;
    return enter(station === WALK_STATION ? 'Nod' : STATION_CLIPS[station], false, 'reaction');
  }
  function getState() {
    const visible = !entryEnded && entry ? entry : current;
    const idle = [...records].find(record => record === current && record.name === 'Idle') || [...records].find(record => record.name === 'Idle');
    const returnSeconds = Math.min(AUTHORED_RETURN_SECONDS, visible?.clip.duration || AUTHORED_RETURN_SECONDS);
    const returnProgress = entry && !entryEnded ? Math.min(1, Math.max(0, (entry.action.time - entry.clip.duration + returnSeconds) / returnSeconds)) : 1;
    return {
      action: visible?.name || 'Idle', time: visible?.action.time || 0, duration: visible?.clip.duration || 0,
      speed: reducedMotion ? 0 : 1, walking: !!rootRecord, position: position.toArray(),
      station, reducedMotion, dragging, end: entryEnded, completedAction, clips: [...clips.keys()], rejected: ['Greet', 'Box', 'CrossArms'],
      transition: transition ? { to: transition.to.name, elapsed: transition.elapsed, duration: transition.duration } : null,
      transitions: history.map(item => ({ ...item, from: [...item.from] })),
      weights: [...records].filter(record => record.weight > .0001).map(record => ({ action: record.name, weight: record.weight, time: record.action.time })),
      rootMotion: { extracted: true, space: 'world', bone: hips.name, horizontalRest: [idleHipsStart.x, idleHipsStart.z] },
      idleRange: [0, idleDuration], idleMode: 'authored-idle', idleSourceTime: idle?.action.time ?? null,
      posture: { mode: 'blender-authored', runtimeCorrection: false },
      idleAnimation: { duration: idleDuration, time: idle?.action.time ?? null, animated: !reducedMotion, loop: 'repeat' },
      settleProgress: smoother(returnProgress),
      playbackTiming: { sourceRange: [0, visible?.clip.duration || idleDuration], authoredReturn: true, settleSeconds: visible?.name === 'Idle' ? 0 : returnSeconds },
      walkPlayback: { sourceDuration: sourceClips.get('Walk').duration, duration: clips.get('Walk').duration, speed: 1 },
      waveRange: [0, clips.get('Wave').duration], waitRange: [0, clips.get('Wait').duration], faceAnimation: false,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(model); records.clear(); transition = null; rootRecord = null;
    for (const [bone, pose] of rest) { bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale); }
    model.updateMatrixWorld(true);
  }
  start('Idle', 0, 'initial', 0); mixer.update(0);
  if (reducedMotion) current.action.paused = true;
  model.updateMatrixWorld(true);
  return { position, setStation, update, react, dispose, getState };
}
