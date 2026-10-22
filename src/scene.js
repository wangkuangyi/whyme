import * as THREE from 'three';
import { createCharacterMotion, WALK_STATION } from './motion.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { clamp, lerp, nearestStation, stationAzimuth, wrapStation, linearToOKLab, oklabToLinear, labToLCH, lchToLab, interpolateLCH } from './scene-math.js';

const HEIGHT = 1.83, RAD = Math.PI / 180;
// Retain the original static 3D model as an explicit, reproducible fallback.
const USE_ANIMATIONS = !new URLSearchParams(location.search).has('still');
const SHOTS = [
  { azimuth: 50, fill: .80, camY: .95, lookY: .51, dist: 2.8, fov: 31, haloY: .55 },
  { azimuth: 28, fill: 2.30, camY: .92, lookY: .78, dist: 2.8, fov: 25, haloY: .83 },
  { azimuth: 25, fill: 1.35, camY: .90, lookY: .69, dist: 2.8, fov: 28, haloY: .75 },
  { azimuth: -24, fill: 1.52, camY: .90, lookY: .69, dist: 2.8, fov: 28, haloY: .75 },
];
const STATIONS = [
  { camY: .95, dist: 2.5, lookY: .50, fov: 27, shift: -.04, fill: .84, haloY: .55, width: .64, roll: 9, openness: .24, color: '#C2603D', rib: '#A64F2F', floor: '#FFF4F1' },
  { camY: .22, dist: 2, lookY: .58, fov: 37.8, shift: -.05, fill: .72, haloY: .55, width: .64, roll: 11, openness: .26, color: '#3755A6', rib: '#28428A', floor: '#F3F7FF' },
  { camY: 2.5, dist: 4.9, lookY: .50, fov: 19.5, shift: -.03, fill: .58, haloY: .55, width: .58, roll: 6, openness: .30, color: '#327B60', rib: '#23664E', floor: '#F0F9F5' },
  { camY: .82, dist: 2.8, lookY: .66, fov: 16.1, shift: .06, fill: 1.22, haloY: .68, width: .52, roll: 8, openness: .24, color: '#A44C76', rib: '#893C61', floor: '#FEF4F8' },
];
const lch = (hex) => labToLCH(linearToOKLab(new THREE.Color(hex).toArray()));
const COLORS = STATIONS.map((s) => lch(s.color)), RIBS = STATIONS.map((s) => lch(s.rib)), FLOORS = STATIONS.map((s) => lch(s.floor));
const vector = () => new THREE.Vector3();
// At 600 ms, a one-second camera move is 65% complete, matching the color beat.
const ease = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Local WebGL studio. Position callbacks use canvas-local CSS pixels. */
export async function createScene({ canvas, signal, onNodePositions = () => {}, onSettled = () => {}, onFramingChange = () => {}, onColorChange = () => {}, onReady = () => {}, onError = () => {}, reducedMotion = false, onPerformanceFallback = () => {} }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch (error) { onError(error); throw error; }
  renderer.setClearColor(0xffffff, 0); renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  RectAreaLightUniformsLib.init();
  const cameraAnchor = new THREE.Vector3(), contactShadows = [], studioLights = [];
  let characterMotion = null;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(27, 1, .02, 100), modelGroup = new THREE.Group(); scene.add(modelGroup);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9df, .4)); scene.add(new THREE.AmbientLight(0xffffff, .10));
  const key = new THREE.SpotLight(0xfffcf8, 72, 24, .76, .95, 2); key.position.set(-3.2, 4.3, 4.8); key.target.position.set(0, .4, 0); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = .2; key.shadow.camera.far = 18; key.shadow.bias = -.00008; key.shadow.normalBias = .015; key.shadow.radius = 8; key.shadow.blurSamples = 8; scene.add(key, key.target); studioLights.push({ light: key, rest: key.position.clone() });
  const addSoftbox = (intensity, w, h, position) => { const light = new THREE.RectAreaLight(0xffffff, intensity, w, h); light.position.set(...position); light.lookAt(0, 1, 0); scene.add(light); studioLights.push({ light, rest: light.position.clone() }); };
  addSoftbox(2.2, 3.2, 4, [-3, 4.5, 4]); addSoftbox(1.4, 4, 4, [3.8, 2.4, 3]); addSoftbox(2, 3, 1.2, [0, 4, -.2]); addSoftbox(2.5, .8, 3, [-2.6, 2, -3]); addSoftbox(2.2, .8, 3, [2.6, 2, -2.5]);

  // A world-space light pool changes shape with the camera and has no hard horizon.
  const floorMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, uniforms: { tint: { value: new THREE.Color(STATIONS[0].floor) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform vec3 tint; void main(){
      float r=length((vUv-.5)*2.0); float pool=1.0-smoothstep(.20,.72,r);
      vec3 c=mix(vec3(.8796,.8796,.8963),tint,pool); float a=(1.0-smoothstep(.64,1.0,r))*.86;
      gl_FragColor=vec4(c,a);
      #include <colorspace_fragment>
    }` });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HEIGHT * 5, HEIGHT * 5), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -.006; floor.renderOrder = -3; scene.add(floor);
  const shadowReceiver = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: '#202027', opacity: .16, depthWrite: false })); shadowReceiver.rotation.x = -Math.PI / 2; shadowReceiver.receiveShadow = true; shadowReceiver.renderOrder = -2; scene.add(shadowReceiver);
  const contactTexture = makeShadowTexture(), shadowGeometry = new THREE.PlaneGeometry(1, 1);
  for (const [x, z, sx, sz, opacity] of [[0, 0, 1.4, .85, .09], [-.14, .025, .44, .54, .32], [.14, .025, .44, .54, .32]]) {
    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({ map: contactTexture, color: '#29292e', transparent: true, opacity, depthWrite: false, toneMapped: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(sx, sz, 1); shadow.position.set(x, .002, z); shadow.renderOrder = -1; scene.add(shadow); contactShadows.push(shadow);
  }
  const frontGeometry = new LineGeometry(), backGeometry = new LineGeometry();
  const frontMaterial = new LineMaterial({ color: '#232329', transparent: true, opacity: .7, linewidth: 1.25, worldUnits: false, depthTest: true, depthWrite: false, toneMapped: false });
  const backMaterial = new LineMaterial({ color: '#232329', transparent: true, opacity: .42, linewidth: 1.25, worldUnits: false, depthTest: true, depthWrite: false, toneMapped: false, dashed: true, dashSize: 3, gapSize: 4 });
  const frontRing = new Line2(frontGeometry, frontMaterial), backRing = new Line2(backGeometry, backMaterial);
  for (const ring of [frontRing, backRing]) { ring.frustumCulled = false; ring.renderOrder = 2; scene.add(ring); }
  const tickGeometry = new LineSegmentsGeometry(), tickMaterial = new LineMaterial({ color: '#232329', transparent: true, opacity: .3, linewidth: 1, worldUnits: false, depthTest: true, depthWrite: false, toneMapped: false });
  const ticks = new LineSegments2(tickGeometry, tickMaterial); ticks.frustumCulled = false; ticks.renderOrder = 2; scene.add(ticks);

  let width = 1, height = 1, mobile = false, disposed = false, ready = false, currentProgress = 0, targetProgress = 0, dragging = false, activeStation = 0;
  let previousTime = performance.now(), loadedTime = 0, animationFrame = 0, slowDuration = 0, degradeDuration = 0, qualityLevel = 0, fallbackTriggered = false;
  let cameraTransition = null, colorTransition = null, settledPending = true, currentLCH = [...COLORS[0]], currentRib = [...RIBS[0]], currentFloor = [...FLOORS[0]], lastCssColor = '';
  const meshes = [], clothMaterials = [], bones = new Map(), morphMeshes = [], eyes = [];
  let model = null, nodePositions = [], lastProfile = STATIONS[0];
  let walkClose = 0, framingPending = false, lastFramingAt = 0;
  // Keep the authored hands visible during gestures; settle on a chest portrait.
  const restClose = reducedMotion ? [1, 1, 1, 1] : [0, 0, 1, 0];
  const timings = { frameMs: 0, poseMs: 0, renderMs: 0, nodesMs: 0 };
  const occlusionCache = Array.from({ length: 4 }, () => ({ at: -Infinity, hidden: false }));
  const lookAt = vector(), projectedTop = vector(), projectedBottom = vector(), cameraRight = vector(), cameraUp = vector(), cameraTowards = vector();
  const ringU = vector(), ringV = vector(), ringNormal = vector(), ringCenter = vector(), point = vector(), rayDirection = vector(), projected = vector();
  const raycaster = new THREE.Raycaster(), nodes = Array.from({ length: 4 }, vector), frontPoints = new Float32Array(65 * 3), backPoints = new Float32Array(65 * 3), tickPoints = new Float32Array(4 * 6);

  function sampleProfile(progress) {
    const local = wrapStation(progress), from = Math.floor(local), to = (from + 1) % 4, t = local - from, profile = {};
    for (const key of Object.keys(STATIONS[0])) if (typeof STATIONS[0][key] === 'number') profile[key] = lerp(STATIONS[from][key], STATIONS[to][key], t);
    profile.azimuth = stationAzimuth(progress) / RAD;
    if (USE_ANIMATIONS) {
      const shots = SHOTS.map((shot, i) => {
        const active = i !== WALK_STATION ? shot : { ...shot, azimuth: lerp(50, 32, walkClose), fill: lerp(.80, 2.05, walkClose), camY: lerp(.95, .90, walkClose), lookY: lerp(.51, .78, walkClose), fov: lerp(31, 28, walkClose), haloY: lerp(.55, .83, walkClose) };
        return { ...active, fill: lerp(active.fill, Math.max(active.fill, 2.05), restClose[i]), lookY: lerp(active.lookY, .78, restClose[i]), haloY: lerp(active.haloY, .83, restClose[i]) };
      });
      for (const key of Object.keys(SHOTS[0])) profile[key] = lerp(shots[from][key], shots[to][key], t);
      const shotWidth = (i) => i === WALK_STATION ? lerp(.58, .68, walkClose) : STATIONS[i].width;
      profile.width = lerp(shotWidth(from), shotWidth(to), t);
    }
    if (mobile) {
      // Budget for the widest part of a gesture, including the incoming blend.
      // Width/height matters here: a tall 320px phone needs more horizontal room.
      const gestureScale = Math.min(1, width / 390 * 557 / height);
      const walkWide = Math.min(.67, Math.max(.35, (height - 149) / height));
      const activeFills = [lerp(walkWide, 1.65 * gestureScale, walkClose), 1.80 * gestureScale, 1.02 * gestureScale, .86 * gestureScale];
      const fills = USE_ANIMATIONS ? activeFills.map((fill, i) => lerp(fill, Math.max(fill, 1.65 * gestureScale), restClose[i])) : [.68, .66, .68, .70];
      profile.fill = lerp(fills[from], fills[to], t);
      if (!USE_ANIMATIONS && profile.fill < 1) profile.fill = Math.min(profile.fill, Math.max(.35, (height - 149) / height));
      const top = Math.max(135 / height, .25);
      const shotTop = (i) => USE_ANIMATIONS ? lerp(top, Math.max(top, 1 - fills[i] * (1 - 1.08 / HEIGHT)), i === 1 ? 1 : Math.max(restClose[i], i === WALK_STATION ? walkClose : 0)) : top;
      profile.top = lerp(shotTop(from), shotTop(to), t);
      profile.shift = USE_ANIMATIONS ? lerp(from === 1 ? .08 : 0, to === 1 ? .08 : 0, t) : 0; profile.width = .84;
    }
    return profile;
  }
  function updateCamera(profile) {
    const azimuth = profile.azimuth * RAD; camera.clearViewOffset(); camera.fov = profile.fov; camera.aspect = width / height; camera.updateProjectionMatrix(); lookAt.copy(cameraAnchor).add(new THREE.Vector3(0, HEIGHT * profile.lookY, 0));
    const elevation = (profile.camY - profile.lookY) / profile.dist; let distance = HEIGHT / (2 * Math.tan(profile.fov * RAD / 2) * profile.fill);
    for (let iteration = 0; iteration < 4; iteration += 1) {
      camera.position.copy(cameraAnchor).add(new THREE.Vector3(Math.sin(azimuth) * distance, HEIGHT * profile.lookY + elevation * distance, Math.cos(azimuth) * distance)); camera.lookAt(lookAt); camera.updateMatrixWorld(); projectedTop.copy(cameraAnchor).add(new THREE.Vector3(0, HEIGHT, 0)).project(camera); projectedBottom.copy(cameraAnchor).project(camera); distance *= Math.abs(projectedTop.y - projectedBottom.y) / (profile.fill * 2);
    }
    const currentCenter = (projectedTop.y + projectedBottom.y) * .5;
    const mobileTop = profile.top * height;
    const desiredCenter = mobile ? 1 - 2 * (mobileTop / height + profile.fill * .5) : USE_ANIMATIONS || profile.fill > 1 ? 1 - 2 * (.08 + profile.fill * .5) : .04;
    camera.setViewOffset(width, height, -profile.shift * width, (desiredCenter - currentCenter) * height / 2, width, height); camera.updateMatrixWorld(); cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize(); cameraTowards.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
    // Navigation remains one continuous orbit while each chapter gets its own shot.
    return stationAzimuth(currentProgress);
  }
  function ringPoint(angle, radius, out) { return out.copy(ringCenter).addScaledVector(ringU, Math.sin(angle) * radius).addScaledVector(ringV, Math.cos(angle) * radius); }
  function updateHalo(profile, azimuth) {
    ringCenter.copy(cameraAnchor).add(new THREE.Vector3(0, profile.haloY * HEIGHT, 0)); const roll = profile.roll * RAD;
    ringU.copy(cameraRight).multiplyScalar(Math.cos(roll)).addScaledVector(cameraUp, Math.sin(roll)); ringV.copy(cameraRight).multiplyScalar(profile.openness * Math.sin(roll)).addScaledVector(cameraUp, -profile.openness * Math.cos(roll)).addScaledVector(cameraTowards, Math.sqrt(1 - profile.openness ** 2)); ringNormal.crossVectors(ringU, ringV).normalize();
    const centerDistance = camera.position.distanceTo(ringCenter); let radius = centerDistance * Math.tan(camera.fov * RAD / 2) * camera.aspect * profile.width;
    for (let pass = 0; pass < 3; pass += 1) { let minX = Infinity, maxX = -Infinity; for (let i = 0; i < 32; i += 1) { ringPoint(i / 32 * Math.PI * 2, radius, point).project(camera); minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); } radius *= 2 * profile.width / (maxX - minX); }
    for (let i = 0; i <= 64; i += 1) { ringPoint(-Math.PI / 2 + i / 64 * Math.PI, radius, point).toArray(frontPoints, i * 3); ringPoint(Math.PI / 2 + i / 64 * Math.PI, radius, point).toArray(backPoints, i * 3); }
    updateLine(frontGeometry, frontPoints); updateLine(backGeometry, backPoints); backRing.computeLineDistances();
    backMaterial.dashScale = height / (2 * centerDistance * Math.tan(camera.fov * RAD / 2)); const tickWorldLength = 4 / backMaterial.dashScale;
    for (let i = 0; i < 4; i += 1) { const theta = (45 + i * 90) * RAD - azimuth; ringPoint(theta, radius - tickWorldLength * .5, point).toArray(tickPoints, i * 6); ringPoint(theta, radius + tickWorldLength * .5, point).toArray(tickPoints, i * 6 + 3); ringPoint(i * Math.PI / 2 - azimuth, radius, nodes[i]); }
    if (!tickGeometry.attributes.instanceStart) tickGeometry.setPositions(tickPoints); else { tickGeometry.attributes.instanceStart.data.array.set(tickPoints); tickGeometry.attributes.instanceStart.data.needsUpdate = true; }
  }
  function updateNodes() {
    const now = performance.now();
    const face = USE_ANIMATIONS && ready ? boneBounds('Head', [.13, .17, .13]) : null;
    nodePositions = nodes.map((node, index) => { projected.copy(node).project(camera); rayDirection.copy(node).sub(camera.position); const distance = rayDirection.length(), cache = occlusionCache[index];
      // Exact skinned-triangle occlusion is expensive; positions remain 60 fps while
      // the small DOM hit targets refresh their occlusion at 14 Hz (idle: 6 Hz).
      if (ready && (now - cache.at > (dragging || cameraTransition ? 70 : 170) || (settledPending && !dragging && !cameraTransition))) { raycaster.set(camera.position, rayDirection.divideScalar(distance)); raycaster.far = Math.max(0, distance - .018); cache.hidden = raycaster.intersectObjects(meshes, false).length > 0; cache.at = now; }
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      // DOM labels cannot be depth-tested with the skinned face. Suppress an
      // inactive node while its dot or number would cover the face in a close shot.
      const coversFace = face && index !== activeStation && x > face.left - 18 && x < face.right + 18 && y > face.top - 12 && y < face.bottom + 28;
      return { x, y, visible: !cache.hidden && !coversFace && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1 && projected.z < 1, depth: distance }; }); onNodePositions(nodePositions);
  }
  function applyColors() {
    for (const material of clothMaterials) { material.color.fromArray(oklabToLinear(lchToLab(material.userData.rib ? currentRib : currentLCH))); material.sheenColor.copy(material.color).lerp(new THREE.Color('#ffffff'), .18); }
    floorMaterial.uniforms.tint.value.fromArray(oklabToLinear(lchToLab(currentFloor)));
    const css = `#${new THREE.Color().fromArray(oklabToLinear(lchToLab(currentLCH))).getHexString()}`; if (css !== lastCssColor) { lastCssColor = css; onColorChange(css); }
  }
  function updateColor(now) {
    if (dragging) { const local = wrapStation(currentProgress), from = Math.floor(local), to = (from + 1) % 4, t = local - from; currentLCH = interpolateLCH(COLORS[from], COLORS[to], t); currentRib = interpolateLCH(RIBS[from], RIBS[to], t); currentFloor = interpolateLCH(FLOORS[from], FLOORS[to], t); }
    else if (colorTransition) { const t = clamp((now - colorTransition.started) / 600, 0, 1); currentLCH = interpolateLCH(colorTransition.from, COLORS[activeStation], t); currentRib = interpolateLCH(colorTransition.rib, RIBS[activeStation], t); currentFloor = interpolateLCH(colorTransition.floor, FLOORS[activeStation], t); if (t === 1) colorTransition = null; }
    applyColors();
  }
  function startPerformance(index) { if (characterMotion?.setStation(index)) walkClose = 0; }
  function updatePose(dt) {
    if (characterMotion) {
      characterMotion.update(dt, { dragging });
      modelGroup.position.copy(characterMotion.position);
      cameraAnchor.lerp(characterMotion.position, 1 - Math.exp(-dt * 14));
      // The supplied walk has no authored stopping pose. Push in before its
      // legs blend to Idle, and retain the close shot after the person arrives.
      const motion = characterMotion.getState();
      if (!dragging && motion.station >= 0) {
        const index = cameraTransition ? activeStation : motion.station;
        const target = reducedMotion || (cameraTransition ? index === 2 : motion.action === 'Idle') ? 1 : 0;
        let next = lerp(restClose[index], target, 1 - Math.exp(-dt * 5));
        if (Math.abs(next - target) < .001) next = target;
        if (next !== restClose[index]) { restClose[index] = next; framingPending = true; }
        if (cameraTransition && index === WALK_STATION && motion.station !== WALK_STATION) walkClose *= Math.exp(-dt * 8);
      }
      if (!dragging && motion.station === WALK_STATION && motion.action === 'Walk') {
        const next = ease((motion.time - 3.55) / .85);
        if (next !== walkClose) { walkClose = next; framingPending = true; }
      }
    } else {
      for (const entry of bones.values()) entry.bone.quaternion.copy(entry.rest);
    }
    // Facial geometry, textures and expressions remain exactly the supplied scan.
    for (const mesh of morphMeshes) mesh.morphTargetInfluences.fill(0);
    modelGroup.updateMatrixWorld(true);
    for (const { light, rest } of studioLights) light.position.copy(rest).add(cameraAnchor);
    key.target.position.copy(cameraAnchor).add(new THREE.Vector3(0, .4, 0));
    floor.position.x = cameraAnchor.x; floor.position.z = cameraAnchor.z;
    shadowReceiver.position.x = cameraAnchor.x; shadowReceiver.position.z = cameraAnchor.z;
    if (contactShadows[0]) { contactShadows[0].position.x = modelGroup.position.x; contactShadows[0].position.z = modelGroup.position.z; }
    for (const [i, name] of ['LeftFoot', 'RightFoot'].entries()) {
      const foot = bones.get(name)?.bone, shadow = contactShadows[i + 1];
      if (foot && shadow) { foot.getWorldPosition(point); shadow.position.x = point.x; shadow.position.z = point.z; shadow.material.opacity = .32 * (1 - clamp((point.y - .10) * 5, 0, .90)); }
    }
  }
  function projectBounds(center, radius) {
    const corners = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) { projected.copy(center).add(new THREE.Vector3(x * radius.x, y * radius.y, z * radius.z)).project(camera); corners.push({ x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 }); }
    const left = Math.min(...corners.map((p) => p.x)), right = Math.max(...corners.map((p) => p.x)), top = Math.min(...corners.map((p) => p.y)), bottom = Math.max(...corners.map((p) => p.y)); return { x: left, y: top, left, right, top, bottom, width: right - left, height: bottom - top };
  }
  function boneBounds(name, radius) { const bone = bones.get(name)?.bone; return bone ? projectBounds(bone.getWorldPosition(vector()), new THREE.Vector3(...radius)) : null; }
  function handBounds(name) {
    const box = new THREE.Box3();
    for (const [key, { bone }] of bones) if (key.startsWith(name)) box.expandByPoint(bone.getWorldPosition(point));
    if (box.isEmpty()) return null;
    // Include finger tips and palm thickness, rather than treating the wrist
    // as a 20 cm cube that falsely intersects cards in close shots.
    box.expandByScalar(.025); return projectBounds(box.getCenter(vector()), box.getSize(vector()).multiplyScalar(.5));
  }
  function protectedBounds() { return { faceBounds: boneBounds('Head', [.13, .17, .13]), handBounds: ['LeftHand', 'RightHand'].map(handBounds).filter(Boolean) }; }
  function notifySettled() {
    if (!ready || dragging || cameraTransition || !settledPending) return; settledPending = false;
    const box = new THREE.Box3().setFromObject(modelGroup), center = box.getCenter(vector()), half = box.getSize(vector()).multiplyScalar(.5);
    onSettled({ index: activeStation, nodes: nodePositions.map((node) => ({ ...node })), modelBounds: projectBounds(center, half), ...protectedBounds() });
  }
  function render(now) {
    if (disposed || document.hidden) return; const rawDelta = Math.max(0, (now - previousTime) / 1000), dt = Math.min(rawDelta, .05); previousTime = now;
    if (cameraTransition && !dragging) { const t = clamp((now - cameraTransition.started) / 1000, 0, 1); currentProgress = lerp(cameraTransition.from, targetProgress, ease(t)); if (t === 1) { cameraTransition = null; currentProgress = targetProgress; startPerformance(activeStation); } }
    updateColor(now); const poseStart = performance.now(); updatePose(dt, now); lastProfile = sampleProfile(currentProgress); const azimuth = updateCamera(lastProfile); updateHalo(lastProfile, azimuth);
    const renderStart = performance.now(); renderer.render(scene, camera); const nodesStart = performance.now(); updateNodes(); notifySettled();
    if (framingPending && ready && !dragging && !cameraTransition && now - lastFramingAt > 80) { onFramingChange({ index: activeStation, nodes: nodePositions.map((node) => ({ ...node })), ...protectedBounds() }); lastFramingAt = now; framingPending = false; }
    timings.frameMs = lerp(timings.frameMs, rawDelta * 1000, .1); timings.poseMs = lerp(timings.poseMs, renderStart - poseStart, .1); timings.renderMs = lerp(timings.renderMs, nodesStart - renderStart, .1); timings.nodesMs = lerp(timings.nodesMs, performance.now() - nodesStart, .1);
    if (ready && now - loadedTime > 3500) {
      // Degrade resolution and shadow cost first; a single healthy frame resets the fallback clock.
      degradeDuration = !dragging && rawDelta > 1 / 28 ? degradeDuration + rawDelta : 0; slowDuration = !dragging && rawDelta > 1 / 20 ? slowDuration + rawDelta : 0;
      if (degradeDuration > 1.2 && qualityLevel === 0) { qualityLevel = 1; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); renderer.setSize(width, height, false); key.shadow.mapSize.set(512, 512); key.shadow.map?.dispose(); key.shadow.map = null; key.shadow.needsUpdate = true; degradeDuration = 0; }
      else if (degradeDuration > 1.2 && qualityLevel === 1) { qualityLevel = 2; renderer.setPixelRatio(1); renderer.setSize(width, height, false); key.castShadow = false; degradeDuration = 0; }
      if (slowDuration >= 5 && qualityLevel > 0 && !dragging && !fallbackTriggered) { fallbackTriggered = true; onPerformanceFallback({ reason: 'low-frame-rate', below20ForSeconds: slowDuration, qualityLevel }); }
    }
    animationFrame = requestAnimationFrame(render);
  }
  function resize() { const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); mobile = window.innerWidth < 901; renderer.setSize(width, height, false); for (const material of [frontMaterial, backMaterial, tickMaterial]) material.resolution.set(width, height); settledPending = true; }
  function setStation(index, { immediate = false } = {}) {
    const nextStation = Math.round(wrapStation(index)) % 4;
    // Initialization reselects A01 after createScene resolves; preserve its opening action.
    if (!dragging && !cameraTransition && nextStation === activeStation && Math.abs(currentProgress - targetProgress) < .00001) { settledPending = true; return; }
    activeStation = nextStation; targetProgress = nearestStation(activeStation, currentProgress); dragging = false;
    const now = performance.now(); settledPending = true;
    colorTransition = { from: [...currentLCH], rib: [...currentRib], floor: [...currentFloor], started: now }; cameraTransition = { from: currentProgress, started: now };
    if (immediate || reducedMotion) { currentProgress = targetProgress; cameraTransition = null; colorTransition = null; currentLCH = [...COLORS[activeStation]]; currentRib = [...RIBS[activeStation]]; currentFloor = [...FLOORS[activeStation]]; applyColors(); if (ready) startPerformance(activeStation); }
  }
  function setDragProgress(progress) { if (!Number.isFinite(progress)) return; dragging = true; currentProgress = progress; targetProgress = progress; cameraTransition = null; colorTransition = null; activeStation = wrapStation(Math.round(progress)); settledPending = true; slowDuration = 0; }
  function reactAt(x, y) {
    if (!ready || dragging || cameraTransition) return false; raycaster.setFromCamera(new THREE.Vector2(x / width * 2 - 1, 1 - y / height * 2), camera); raycaster.far = 100;
    if (!raycaster.intersectObjects(meshes, false).length) return false;
    if (!reducedMotion) characterMotion?.react(); return true;
  }
  function onVisibilityChange() { cancelAnimationFrame(animationFrame); slowDuration = 0; degradeDuration = 0; if (!document.hidden && !disposed) { previousTime = performance.now(); animationFrame = requestAnimationFrame(render); } }
  function onContextLost(event) { event.preventDefault(); onPerformanceFallback({ reason: 'webgl-context-lost' }); }
  document.addEventListener('visibilitychange', onVisibilityChange); canvas.addEventListener('webglcontextlost', onContextLost); const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize();
  signal?.addEventListener('abort', dispose, { once: true }); if (signal?.aborted) { dispose(); return; } animationFrame = requestAnimationFrame(render);
  try {
    const url = new URL(USE_ANIMATIONS ? 'models/person-animated.glb' : 'models/person.glb', new URL(import.meta.env.BASE_URL, window.location.href)); const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url.href); if (disposed) return;
    model = gltf.scene; model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model), dimensions = box.getSize(vector()); model.scale.multiplyScalar(HEIGHT / Math.max(dimensions.y, .001)); model.updateMatrixWorld(true); box.setFromObject(model); const center = box.getCenter(vector()); model.position.x -= center.x; model.position.y -= box.min.y; model.position.z -= center.z; modelGroup.add(model);
    const clothNoise = makeClothTextures();
    model.traverse((object) => {
      if (object.isBone) { const name = object.name.replace(/^mixamorig[:_]?/i, ''); bones.set(name, { bone: object, rest: object.quaternion.clone(), base: object.quaternion.clone(), turn: 0 }); }
      if (/^Eye(Left|Right)$/i.test(object.name)) eyes.push({ object, rest: object.quaternion.clone() });
      if (!object.isMesh) return; object.frustumCulled = false; object.castShadow = true; object.receiveShadow = false; meshes.push(object); if (object.morphTargetDictionary && object.morphTargetInfluences) morphMeshes.push(object);
      const original = Array.isArray(object.material) ? object.material : [object.material], materials = original.map((material) => {
        material.side = THREE.FrontSide;
        if (/hoodie|sweatshirt|卫衣/i.test(material.name)) {
          const cloth = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(cloth, material); cloth.defines = { STANDARD: '', PHYSICAL: '' }; cloth.name = material.name; cloth.userData.rib = /rib/i.test(material.name); cloth.map = clothNoise.color; cloth.normalMap = clothNoise.normal; cloth.normalScale.set(.16, .16); cloth.roughness = .92; cloth.metalness = 0; cloth.sheen = .7; cloth.sheenRoughness = .85; clothMaterials.push(cloth); return cloth;
        }
        // The original scan shares a few finger triangles with the trousers
        // material. Preserve its albedo until the corrected material split lands.
        if (/trousers|pants/i.test(material.name)) { if (!material.map) material.color.set('#22232b'); material.roughness = .96; material.normalMap = clothNoise.twill; material.normalScale.set(.12, .12); }
        if (/drawstring/i.test(material.name)) { material.map = null; material.color.set('#e8e1d3'); material.roughness = .78; }
        if (/iris/i.test(material.name)) material.roughness = .3; return material;
      }); object.material = Array.isArray(object.material) ? materials : materials[0];
    });
    if (USE_ANIMATIONS && gltf.animations.length) characterMotion = createCharacterMotion({ model, animations: gltf.animations, bones, reducedMotion });
    ready = true; loadedTime = performance.now(); settledPending = true; applyColors(); startPerformance(activeStation);
    onReady({ modelHeight: HEIGHT, materials: clothMaterials.length, animations: characterMotion?.getState().clips || [], morphTargets: [...new Set(morphMeshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary)))], eyes: eyes.length });
  } catch (error) { onError(error); cancelAnimationFrame(animationFrame); dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(animationFrame); resizeObserver.disconnect(); document.removeEventListener('visibilitychange', onVisibilityChange); canvas.removeEventListener('webglcontextlost', onContextLost); signal?.removeEventListener('abort', dispose); characterMotion?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set(); scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); } }); for (const item of [...geometries, ...materials, ...textures]) item.dispose(); renderer.dispose();
  }
  return { setStation, setDragProgress, reactAt, resize, dispose,
    capture: () => { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    getState: () => ({ currentProgress, targetProgress, activeStation, ready, dragging, moving: !!cameraTransition || dragging, mobile, width, height, dpr: renderer.getPixelRatio(), triangles: renderer.info.render.triangles,
      colors: { hoodie: lastCssColor, rib: `#${new THREE.Color().fromArray(oklabToLinear(lchToLab(currentRib))).getHexString()}`, lch: [...currentLCH], durationMs: 600, throughBlack: false }, ring: { openness: lastProfile.openness, linewidth: 1.25, frontInk: .7, backDash: [3, 4], ticks: 4 }, camera: { azimuth: lastProfile.azimuth, shift: lastProfile.shift, fill: lastProfile.fill, walkClose, restClose: [...restClose], position: camera.position.toArray(), target: lookAt.toArray(), anchor: cameraAnchor.toArray(), tracking: characterMotion?.getState().walking || false }, nodes: nodePositions,
      animation: { ...(characterMotion?.getState() || { action: 'OriginalRest', clips: [], walking: false, position: [0, 0, 0] }), reducedMotion, eyes: 0, morphs: {}, pose: Object.fromEntries(['Hips','Head','LeftHand','RightHand','LeftFoot','RightFoot'].map((name) => [name, bones.get(name)?.bone.getWorldPosition(vector()).toArray()])) }, protectedBounds: protectedBounds(),
      studio: { ambient: .5, shadowOpacity: .16, shadowWorldPosition: key.position.toArray(), shadowEnabled: key.castShadow, mapSize: key.shadow.mapSize.x, floorRadiusH: 1.2 }, quality: { level: qualityLevel, slowDuration, fallbackTriggered, staticThresholdSeconds: 5, staticThresholdFps: 20, timings: { ...timings } }, cloth: clothMaterials.map((material) => ({ name: material.name, rib: !!material.userData.rib, normalMap: !!material.normalMap, aoMap: !!material.aoMap, sheen: `#${material.sheenColor.getHexString()}` })) }),
  };
}
function updateLine(geometry, positions) { if (!geometry.attributes.instanceStart) { geometry.setPositions(positions); return; } const data = geometry.attributes.instanceStart.data; for (let i = 0; i < positions.length / 3 - 1; i += 1) for (let component = 0; component < 3; component += 1) { data.array[i * 6 + component] = positions[i * 3 + component]; data.array[i * 6 + component + 3] = positions[i * 3 + component + 3]; } data.needsUpdate = true; }
function makeShadowTexture() { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const context = canvas.getContext('2d'), gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64); for (const [stop, alpha] of [[0, 1], [.18, .8], [.46, .35], [1, 0]]) gradient.addColorStop(stop, `rgba(255,255,255,${alpha})`); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(canvas); }
function makeClothTextures() {
  const size = 256, data = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4), twill = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) { const i = (y * size + x) * 4, noise = (Math.sin(x * .049 + Math.sin(y * .041)) + Math.cos(y * .071 - x * .027)) * .5, brightness = Math.round(250 + noise * 5); data.set([brightness, brightness, brightness, 255], i); const stitchX = Math.sin((x + Math.sin(y * Math.PI / 4) * 1.6) * Math.PI / 4), stitchY = Math.cos(y * Math.PI / 4); normal.set([128 + Math.round(stitchX * 28), 128 + Math.round(stitchY * 22), 250, 255], i); const diagonal = Math.sin((x + y) * Math.PI / 3); twill.set([128 + Math.round(diagonal * 23), 128 + Math.round(diagonal * 23), 252, 255], i); }
  const texture = (bytes, repeat, color = false) => { const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat); tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.needsUpdate = true; return tex; };
  return { color: texture(data, 2, true), normal: texture(normal, 5), twill: texture(twill, 6) };
}



