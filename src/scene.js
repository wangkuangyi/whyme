import * as THREE from 'three';
import { createCharacterMotion, WALK_STATION, STATION_CLIPS } from './motion.js';
import { applyHoodieSkinning } from './hoodie-skinning.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { clamp, lerp, nearestStation, stationAzimuth, wrapStation, linearToOKLab, oklabToLinear, labToLCH, lchToLab, interpolateLCH, interpolateDragLCH } from './scene-math.js';

const HEIGHT = 1.83, RAD = Math.PI / 180;
// 可见圆点与数字的范围，不包括 44 px 的透明点击区域。
const DOT_PROBES = [[-5, 0], [5, 0], [0, -5], [0, 5]];
const ACTIVE_DOT_PROBES = [[-11, 0], [11, 0], [0, -11], [0, 11]];
// 对应 .node-index 的右上角数字及其白色描边。
const LABEL_PROBES = [[7, -22], [23, -22], [7, -5], [23, -5], [15, -13.5]];
const NODE_REVEAL_DELAY = 250, WALK_NODE_REVEAL_DELAY = 650;
// Static and animated views share the same original-resolution Tripo surface.
const USE_ANIMATIONS = !new URLSearchParams(location.search).has('still');
const NOD_STATION = STATION_CLIPS.indexOf('Nod'), WAVE_STATION = STATION_CLIPS.indexOf('Wave');
const SHOTS = [
  { azimuth: 38, fill: .56, camY: 2.25, lookY: .52, dist: 2.8, fov: 31, haloY: .52 },
  { azimuth: 8, fill: 1.20, camY: 1.25, lookY: .68, dist: 2.8, fov: 28, haloY: .68 },
  { azimuth: -35, fill: 1.18, camY: .12, lookY: .64, dist: 2.8, fov: 30, haloY: .66 },
  { azimuth: 30, fill: 1.52, camY: .83, lookY: .69, dist: 2.8, fov: 28, haloY: .75 },
];
const REST_FILLS = [.56, 1.20, 1.24, 2.10];
const REST_LOOK_Y = [.52, .68, .64, .78], REST_HALO_Y = [.52, .68, .66, .83];
const MOBILE_REST_FILLS = [.56, 1.10, 1.16, 1.72];
const STATIONS = [
  { azimuth: 38, camY: 2.25, dist: 2.8, lookY: .52, fov: 31, shift: -.04, fill: .56, haloY: .52, width: .52, roll: 9, openness: .24, color: '#82756E', rib: '#6B5E58', floor: '#F8F5F3' },
  { azimuth: 8, camY: 1.25, dist: 2.8, lookY: .68, fov: 28, shift: -.05, fill: 1.20, haloY: .68, width: .64, roll: 11, openness: .26, color: '#3755A6', rib: '#28428A', floor: '#F3F7FF' },
  { azimuth: -35, camY: .12, dist: 2.8, lookY: .64, fov: 30, shift: -.03, fill: 1.18, haloY: .66, width: .58, roll: 6, openness: .30, color: '#327B60', rib: '#23664E', floor: '#F0F9F5' },
  { azimuth: -65, camY: .82, dist: 2.8, lookY: .66, fov: 16.1, shift: .06, fill: 1.22, haloY: .68, width: .52, roll: 8, openness: .24, color: '#A44C76', rib: '#893C61', floor: '#FEF4F8' },
];
const lch = (hex) => labToLCH(linearToOKLab(new THREE.Color(hex).toArray()));
const COLORS = STATIONS.map((s) => lch(s.color)), RIBS = STATIONS.map((s) => lch(s.rib)), FLOORS = STATIONS.map((s) => lch(s.floor));
const vector = () => new THREE.Vector3();
// At 600 ms, a one-second camera move is 65% complete, matching the color beat.
const ease = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Local WebGL studio. Position callbacks use canvas-local CSS pixels. */
export async function createScene({ canvas, signal, onNodePositions = () => {}, onSettled = () => {}, onFramingChange = () => {}, onColorChange = () => {}, onPosterLayout = () => {}, onReady = () => {}, onError = () => {}, reducedMotion = false, initialStation = 0, presentationPaused = false, onPerformanceFallback = () => {} }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch (error) { onError(error); throw error; }
  renderer.setClearColor(0xffffff, 0); renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  const cameraAnchor = new THREE.Vector3(), contactShadows = [], studioLights = [];
  let characterMotion = null;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(27, 1, .02, 100), modelGroup = new THREE.Group(); scene.add(modelGroup);
  // Tripo's albedo already contains the authored facial/fabric shading. Keep
  // that appearance directly; the studio light below only casts ground shadows.
  const key = new THREE.SpotLight(0xfffcf8, 72, 24, .76, .95, 2); key.position.set(-3.2, 6, 4.8); key.target.position.set(0, .4, 0); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = .2; key.shadow.camera.far = 18; key.shadow.bias = -.00008; key.shadow.normalBias = .015; key.shadow.radius = 8; key.shadow.blurSamples = 8; scene.add(key, key.target); studioLights.push({ light: key, rest: key.position.clone() });

  // A world-space light pool changes shape with the camera and has no hard horizon.
  const floorMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, uniforms: { tint: { value: new THREE.Color(STATIONS[0].floor) }, edgeColor: { value: new THREE.Color('#f3f3f5') }, viewport: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform vec3 tint; uniform vec3 edgeColor; uniform vec2 viewport; void main(){
      float r=length((vUv-.5)*2.0); float pool=1.0-smoothstep(.12,.56,r);
      vec2 frame=gl_FragCoord.xy/viewport; vec2 edge=min(frame,1.0-frame);
      float frameFade=smoothstep(0.0,.10,edge.x)*smoothstep(0.0,.12,edge.y);
      vec3 c=mix(edgeColor,tint,pool*.5); float a=(1.0-smoothstep(.22,.72,r))*.60*frameFade;
      gl_FragColor=vec4(c,a);
      #include <colorspace_fragment>
    }` });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HEIGHT * 5, HEIGHT * 5), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -.006; floor.renderOrder = -3; scene.add(floor);
  const shadowMaterial = new THREE.ShadowMaterial({ color: '#202027', opacity: .10, depthWrite: false });
  // Feather the distant cast shadow without weakening the feet's contact shadow.
  shadowMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.shadowCenter = { value: modelGroup.position };
    shader.vertexShader = `varying vec3 vShadowGround;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvShadowGround=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vShadowGround; uniform vec3 shadowCenter;\n${shader.fragmentShader}`.replace('opacity * ( 1.0 - getShadowMask() )', 'opacity * (1.0-smoothstep(.45,1.7,length(vShadowGround.xz-shadowCenter.xz))) * ( 1.0 - getShadowMask() )');
  };
  const shadowReceiver = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), shadowMaterial); shadowReceiver.rotation.x = -Math.PI / 2; shadowReceiver.receiveShadow = true; shadowReceiver.renderOrder = -2; scene.add(shadowReceiver);
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

  const firstStation = Number.isFinite(initialStation) ? Math.round(wrapStation(initialStation)) % 4 : 0;
  let width = 1, height = 1, mobile = false, disposed = false, ready = false, currentProgress = firstStation, targetProgress = firstStation, dragging = false, activeStation = firstStation, displayStation = firstStation;
  let previousTime = performance.now(), loadedTime = 0, animationFrame = 0, slowDuration = 0, degradeDuration = 0, qualityLevel = 0, fallbackTriggered = false;
  let presentationTime = previousTime, poseRevision = 0, boundsRevision = -1, occlusionPending = true;
  let cameraTransition = null, colorTransition = null, dragColorOrigin = null, settledPending = true, currentLCH = [...COLORS[firstStation]], currentRib = [...RIBS[firstStation]], currentFloor = [...FLOORS[firstStation]], lastCssColor = '';
  const meshes = [], skinnedBounds = [], skinBoundsByMesh = new Map(), clothMaterials = [], bones = new Map(), morphMeshes = [], eyes = [];
  let model = null, pendingModel = null, clothMask = null, nodePositions = [], lastProfile = STATIONS[0], posterLayout = null, lastPosterLayout = null;
  let framingPending = false, lastFramingAt = 0;
  // Wave settles on a portrait; Nod retains its hands and LookAround stays wider.
  const restClose = reducedMotion ? [1, 1, 1, 1] : [0, 0, 0, 0];
  const timings = { frameMs: 0, poseMs: 0, renderMs: 0, nodesMs: 0 };
  const occlusionCache = Array.from({ length: 4 }, () => ({ at: -Infinity, hidden: false, footprintHidden: false, visible: null, clearSince: null }));
  const lookAt = vector(), projectedTop = vector(), projectedBottom = vector(), cameraRight = vector(), cameraUp = vector(), cameraTowards = vector();
  const ringU = vector(), ringV = vector(), ringNormal = vector(), ringCenter = vector(), point = vector(), rayDirection = vector(), projected = vector();
  const raycaster = new THREE.Raycaster(), nodes = Array.from({ length: 4 }, vector), frontPoints = new Float32Array(65 * 3), backPoints = new Float32Array(65 * 3), tickPoints = new Float32Array(4 * 6);
  const boundMatrix = new THREE.Matrix4(), transformedBound = new THREE.Box3();
  const localRay = new THREE.Ray(), inverseMesh = new THREE.Matrix4(), worldSphere = new THREE.Sphere();
  const triangleA = vector(), triangleB = vector(), triangleC = vector(), intersection = vector(), occlusionProbe = vector();

  function refreshRaycastBounds() {
    if (boundsRevision === poseRevision) return;
    // A vertex is a weighted blend of its bone transforms. The union of every
    // influencing bone's transformed bounds conservatively contains that blend.
    // Updating O(bones) boxes avoids skinning every vertex before each raycast.
    for (const { mesh, influences } of skinnedBounds) {
      mesh.boundingBox.makeEmpty();
      for (const { bone, box } of influences) {
        boundMatrix.multiplyMatrices(mesh.bindMatrixInverse, bone.matrixWorld);
        mesh.boundingBox.union(transformedBound.copy(box).applyMatrix4(boundMatrix));
      }
      mesh.boundingBox.expandByScalar(.0001); mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    }
    boundsRevision = poseRevision;
  }
  function hitsCharacter() {
    // An occlusion ray only needs a yes/no answer. Test the same current skinned
    // triangles as Three's raycaster, but stop at the first hit and skip unused
    // UVs, normals, face records and sorting of every intersection.
    for (const mesh of meshes) {
      const geometry = mesh.geometry, bounds = mesh.isSkinnedMesh ? mesh : geometry;
      if (!bounds.boundingSphere) bounds.computeBoundingSphere();
      worldSphere.copy(bounds.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (!raycaster.ray.intersectsSphere(worldSphere)) continue;
      localRay.copy(raycaster.ray).applyMatrix4(inverseMesh.copy(mesh.matrixWorld).invert());
      if (bounds.boundingBox && !localRay.intersectsBox(bounds.boundingBox)) continue;
      const indices = geometry.index, count = indices ? indices.count : geometry.attributes.position.count;
      const rangeStart = geometry.drawRange.start, rangeEnd = Math.min(count, rangeStart + geometry.drawRange.count);
      const anyTriangle = (start, end, material) => {
        if (!material) return false;
        const skinBounds = skinBoundsByMesh.get(mesh);
        const clusters = skinBounds?.clusters || [{ start: 0, end: count }];
        for (const cluster of clusters) {
          const first = Math.max(rangeStart, start, cluster.start), last = Math.min(rangeEnd, end, cluster.end);
          if (first >= last) continue;
          if (skinBounds) {
            if (cluster.revision !== poseRevision) {
              cluster.box.makeEmpty();
              for (const { bone, box } of cluster.influences) {
                boundMatrix.multiplyMatrices(mesh.bindMatrixInverse, bone.matrixWorld);
                cluster.box.union(transformedBound.copy(box).applyMatrix4(boundMatrix));
              }
              cluster.box.expandByScalar(.0001); cluster.revision = poseRevision;
            }
            if (!localRay.intersectsBox(cluster.box)) continue;
          }
          for (let offset = first; offset < last; offset += 3) {
            mesh.getVertexPosition(indices ? indices.getX(offset) : offset, triangleA);
            mesh.getVertexPosition(indices ? indices.getX(offset + 1) : offset + 1, triangleB);
            mesh.getVertexPosition(indices ? indices.getX(offset + 2) : offset + 2, triangleC);
            const hit = material.side === THREE.BackSide ? localRay.intersectTriangle(triangleC, triangleB, triangleA, true, intersection)
              : localRay.intersectTriangle(triangleA, triangleB, triangleC, material.side !== THREE.DoubleSide, intersection);
            if (hit) {
              const distanceSquared = intersection.applyMatrix4(mesh.matrixWorld).distanceToSquared(raycaster.ray.origin);
              if (distanceSquared >= raycaster.near ** 2 && distanceSquared <= raycaster.far ** 2) return true;
            }
          }
        }
        return false;
      };
      if (Array.isArray(mesh.material)) {
        for (const group of geometry.groups) if (anyTriangle(group.start, group.start + group.count, mesh.material[group.materialIndex])) return true;
      } else if (anyTriangle(0, count, mesh.material)) return true;
    }
    return false;
  }

  function sampleProfile(progress) {
    const local = wrapStation(progress), from = Math.floor(local), to = (from + 1) % 4, t = local - from, profile = {};
    for (const key of Object.keys(STATIONS[0])) if (typeof STATIONS[0][key] === 'number') profile[key] = lerp(STATIONS[from][key], STATIONS[to][key], t);
    // Static shots retain their own orientations; cross 04→01 along the short arc.
    const azimuthDelta = ((STATIONS[to].azimuth - STATIONS[from].azimuth + 540) % 360) - 180;
    profile.azimuth = STATIONS[from].azimuth + azimuthDelta * t;
    if (USE_ANIMATIONS) {
      const shots = SHOTS.map((shot, i) => {
        if (i === WALK_STATION) return shot;
        return { ...shot, fill: lerp(shot.fill, REST_FILLS[i], restClose[i]), lookY: lerp(shot.lookY, REST_LOOK_Y[i], restClose[i]), haloY: lerp(shot.haloY, REST_HALO_Y[i], restClose[i]) };
      });
      for (const key of Object.keys(SHOTS[0])) profile[key] = lerp(shots[from][key], shots[to][key], t);
      profile.top = lerp(from === WALK_STATION ? .22 : .08, to === WALK_STATION ? .22 : .08, t);
    }
    if (mobile) {
      // Budget for the widest part of a gesture, including the incoming blend.
      // Width/height matters here: a tall 320px phone needs more horizontal room.
      const gestureScale = Math.min(1, width / 390 * 557 / height);
      const walkWide = Math.min(.56, Math.max(.35, (height - 149) / height));
      const activeFills = [walkWide, 1.10 * gestureScale, 1.10 * gestureScale, .98 * gestureScale];
      const fills = USE_ANIMATIONS ? activeFills.map((fill, i) => i === WALK_STATION ? fill : lerp(fill, MOBILE_REST_FILLS[i] * gestureScale, restClose[i])) : [walkWide, 1.10 * gestureScale, 1.10 * gestureScale, .70];
      profile.fill = lerp(fills[from], fills[to], t);
      if (!USE_ANIMATIONS && profile.fill < 1) profile.fill = Math.min(profile.fill, Math.max(.35, (height - 149) / height));
      const top = Math.max(135 / height, .25);
      const shotTop = (i) => USE_ANIMATIONS && i === WAVE_STATION ? lerp(top, Math.max(top, 1 - fills[i] * (1 - 1.08 / HEIGHT)), restClose[i]) : top;
      profile.top = lerp(shotTop(from), shotTop(to), t);
      // The pointing hand reaches screen-left early in Nod; reserve space for
      // that full arc instead of centering only the relaxed torso.
      profile.shift = USE_ANIMATIONS ? lerp(from === NOD_STATION ? .11 : 0, to === NOD_STATION ? .11 : 0, t) : 0;
      profile.width = lerp(from === WALK_STATION ? .78 : .84, to === WALK_STATION ? .78 : .84, t);
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
    const desiredCenter = mobile ? 1 - 2 * (mobileTop / height + profile.fill * .5) : USE_ANIMATIONS || profile.fill > 1 ? 1 - 2 * ((profile.top ?? .08) + profile.fill * .5) : .04;
    camera.setViewOffset(width, height, -profile.shift * width, (desiredCenter - currentCenter) * height / 2, width, height); camera.updateMatrixWorld(); cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize(); cameraTowards.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
    // Navigation remains one continuous orbit while each chapter gets its own shot.
    return stationAzimuth(currentProgress);
  }
  function updatePosterLayout() {
    // Use the final camera, including setViewOffset. These two world landmarks
    // register the character independently of the width-driven halo and floor.
    projectedTop.copy(cameraAnchor).add(new THREE.Vector3(0, HEIGHT, 0)).project(camera);
    projectedBottom.copy(cameraAnchor).project(camera);
    posterLayout = { width, height, top: { x: (projectedTop.x + 1) * width / 2, y: (1 - projectedTop.y) * height / 2 }, bottom: { x: (projectedBottom.x + 1) * width / 2, y: (1 - projectedBottom.y) * height / 2 } };
    if (presentationPaused || !ready) {
      const coordinates = [width, height, posterLayout.top.x, posterLayout.top.y, posterLayout.bottom.x, posterLayout.bottom.y];
      if (!lastPosterLayout || coordinates.some((value, index) => Math.abs(value - lastPosterLayout[index]) > .001)) {
        lastPosterLayout = coordinates; onPosterLayout({ ...posterLayout, top: { ...posterLayout.top }, bottom: { ...posterLayout.bottom } });
      }
    }
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
  function footprintOccluded(screenPoint, probes) {
    for (const [dx, dy] of probes) {
      // 保持节点的投影深度，把 CSS 像素偏移还原到同一相机平面。
      // 射线只到这个平面为止，人物在节点后方时不会误遮挡。
      occlusionProbe.set(screenPoint.x + 2 * dx / width, screenPoint.y - 2 * dy / height, screenPoint.z).unproject(camera);
      rayDirection.copy(occlusionProbe).sub(camera.position); const distance = rayDirection.length();
      raycaster.set(camera.position, rayDirection.divideScalar(distance)); raycaster.far = Math.max(0, distance - .018);
      if (hitsCharacter()) return true;
    }
    return false;
  }
  function updateNodes() {
    const now = performance.now();
    const face = USE_ANIMATIONS && ready ? boneBounds('Head', [.13, .17, .13]) : null;
    const motion = characterMotion?.getState(), performing = motion && motion.action !== 'Idle';
    const interval = !presentationPaused && (dragging || cameraTransition || performing) ? 0 : 170;
    // 行走摆动可能露出约半秒的缝隙；稳定跟拍时多等一拍，转镜头仍及时响应。
    const revealDelay = motion?.walking && !dragging && !cameraTransition ? WALK_NODE_REVEAL_DELAY : NODE_REVEAL_DELAY;
    nodePositions = nodes.map((node, index) => { projected.copy(node).project(camera); rayDirection.copy(node).sub(camera.position); const distance = rayDirection.length(), cache = occlusionCache[index];
      // Match every moving pose. Throttling during the walk left even correct
      // bounds displaying yesterday's visibility when a shoulder crossed a node.
      if (ready && (now - cache.at > interval || occlusionPending)) {
        refreshRaycastBounds(); raycaster.set(camera.position, rayDirection.divideScalar(distance)); raycaster.far = Math.max(0, distance - .018);
        cache.hidden = hitsCharacter();
        cache.footprintHidden = !cache.hidden && (footprintOccluded(projected, index === displayStation ? ACTIVE_DOT_PROBES : DOT_PROBES)
          || (index !== displayStation && footprintOccluded(projected, LABEL_PROBES)));
        cache.at = now;
      }
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      // DOM labels cannot be depth-tested with the skinned face. Suppress an
      // inactive node while its dot or number would cover the face in a close shot.
      const coversFace = face && index !== displayStation && x > face.left - 18 && x < face.right + 18 && y > face.top - 12 && y < face.bottom + 28;
      const blocked = cache.hidden || cache.footprintHidden || coversFace || Math.abs(projected.x) >= 1.1 || Math.abs(projected.y) >= 1.1 || projected.z >= 1;
      // 一旦遮住就立即收起；重新露出需稳定一小段时间，过滤步态造成的短暂缝隙。
      if (blocked) { cache.visible = false; cache.clearSince = null; }
      else if (cache.visible === null || presentationPaused || reducedMotion || index === displayStation) { cache.visible = true; cache.clearSince = null; }
      else if (!cache.visible) { cache.clearSince ??= now; if (now - cache.clearSince >= revealDelay) cache.visible = true; }
      return { x, y, visible: cache.visible, depth: distance }; }); occlusionPending = false; onNodePositions(nodePositions);
  }
  function applyColors() {
    for (const material of clothMaterials) material.userData.clothTint.fromArray(oklabToLinear(lchToLab(currentLCH)));
    floorMaterial.uniforms.tint.value.fromArray(oklabToLinear(lchToLab(currentFloor)));
    const css = `#${new THREE.Color().fromArray(oklabToLinear(lchToLab(currentLCH))).getHexString()}`; if (css !== lastCssColor) { lastCssColor = css; onColorChange(css); }
  }
  function updateColor(now) {
    if (dragging) {
      const { progress, color, rib, floor } = dragColorOrigin;
      currentLCH = interpolateDragLCH(currentProgress, progress, color, COLORS);
      currentRib = interpolateDragLCH(currentProgress, progress, rib, RIBS);
      currentFloor = interpolateDragLCH(currentProgress, progress, floor, FLOORS);
    }
    else if (colorTransition) { const t = clamp((now - colorTransition.started) / 600, 0, 1); currentLCH = interpolateLCH(colorTransition.from, COLORS[activeStation], t); currentRib = interpolateLCH(colorTransition.rib, RIBS[activeStation], t); currentFloor = interpolateLCH(colorTransition.floor, FLOORS[activeStation], t); if (t === 1) colorTransition = null; }
    applyColors();
  }
  function startPerformance(index) { characterMotion?.setStation(index, { prepareOpening: presentationPaused }); }
  function updatePose(dt) {
    if (characterMotion) {
      characterMotion.update(dt, { dragging });
      modelGroup.position.copy(characterMotion.position);
      cameraAnchor.lerp(characterMotion.position, 1 - Math.exp(-dt * 14));
      // walk2 is authored in place. Keep the full-body camera through its Idle
      // blend, while still following any root motion supplied by future clips.
      const motion = characterMotion.getState();
      // 行走期间卡片已展开，持续更新节点连线及手、脸的避让位置。
      if (motion.walking) framingPending = true;
      if (!dragging && motion.station >= 0) {
        const index = cameraTransition ? activeStation : motion.station;
        const target = reducedMotion ? 1 : !cameraTransition ? motion.settleProgress : 0;
        let next = lerp(restClose[index], target, 1 - Math.exp(-dt * 5));
        if (Math.abs(next - target) < .001) next = target;
        if (next !== restClose[index]) { restClose[index] = next; framingPending = true; }
      }
    } else {
      for (const entry of bones.values()) entry.bone.quaternion.copy(entry.rest);
    }
    // Facial geometry, textures and expressions remain exactly the supplied scan.
    for (const mesh of morphMeshes) mesh.morphTargetInfluences.fill(0);
    modelGroup.updateMatrixWorld(true);
    poseRevision += 1;
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
    // 镜头就位即可阅读，正文不再等待人物走完整段动作。
    if (!ready || presentationPaused || dragging || cameraTransition || !settledPending) return; settledPending = false;
    const box = new THREE.Box3().setFromObject(modelGroup), center = box.getCenter(vector()), half = box.getSize(vector()).multiplyScalar(.5);
    onSettled({ index: activeStation, nodes: nodePositions.map((node) => ({ ...node })), modelBounds: projectBounds(center, half), ...protectedBounds() });
  }
  function render(now, force = false) {
    if (disposed || (document.hidden && !force)) return; const rawDelta = Math.max(0, (now - previousTime) / 1000), dt = presentationPaused ? 0 : Math.min(rawDelta, .05); previousTime = now;
    if (!presentationPaused) presentationTime += rawDelta * 1000;
    if (cameraTransition && !dragging) { const t = clamp((presentationTime - cameraTransition.started) / 1000, 0, 1); currentProgress = lerp(cameraTransition.from, targetProgress, ease(t)); if (t === 1) { cameraTransition = null; currentProgress = targetProgress; startPerformance(activeStation); } }
    updateColor(presentationTime); const poseStart = performance.now(); updatePose(dt); lastProfile = sampleProfile(currentProgress); const azimuth = updateCamera(lastProfile); updatePosterLayout(); updateHalo(lastProfile, azimuth);
    renderer.getDrawingBufferSize(floorMaterial.uniforms.viewport.value);
    const renderStart = performance.now(); renderer.render(scene, camera); const nodesStart = performance.now(); updateNodes(); notifySettled();
    if (framingPending && ready && !presentationPaused && !dragging && !cameraTransition && now - lastFramingAt > 80) { onFramingChange({ index: activeStation, nodes: nodePositions.map((node) => ({ ...node })), ...protectedBounds() }); lastFramingAt = now; framingPending = false; }
    timings.frameMs = lerp(timings.frameMs, rawDelta * 1000, .1); timings.poseMs = lerp(timings.poseMs, renderStart - poseStart, .1); timings.renderMs = lerp(timings.renderMs, nodesStart - renderStart, .1); timings.nodesMs = lerp(timings.nodesMs, performance.now() - nodesStart, .1);
    // Loading waits for the full asset; runtime keeps the chosen source fidelity.
    if (ready && !presentationPaused && now - loadedTime > 3500) slowDuration = !dragging && rawDelta > 1 / 20 ? slowDuration + rawDelta : 0;
    animationFrame = requestAnimationFrame(render);
  }
  function resize() { const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); mobile = window.innerWidth < 901; renderer.setSize(width, height, false); for (const material of [frontMaterial, backMaterial, tickMaterial]) material.resolution.set(width, height); settledPending = true; occlusionPending = true; }
  function setStation(index, { immediate = false } = {}) {
    const nextStation = Math.round(wrapStation(index)) % 4;
    // DOM 高亮在松手选站时才更新，不随拖拽途中的镜头站点改变。
    displayStation = nextStation;
    // Initialization reselects A01 after createScene resolves; preserve its opening action.
    if (!dragging && !cameraTransition && nextStation === activeStation && Math.abs(currentProgress - targetProgress) < .00001) { settledPending = true; return; }
    activeStation = nextStation; targetProgress = nearestStation(activeStation, currentProgress); dragging = false; dragColorOrigin = null;
    const now = presentationTime; settledPending = true; occlusionPending = true;
    colorTransition = { from: [...currentLCH], rib: [...currentRib], floor: [...currentFloor], started: now }; cameraTransition = { from: currentProgress, started: now };
    if (immediate || reducedMotion) { currentProgress = targetProgress; cameraTransition = null; colorTransition = null; currentLCH = [...COLORS[activeStation]]; currentRib = [...RIBS[activeStation]]; currentFloor = [...FLOORS[activeStation]]; applyColors(); if (ready) startPerformance(activeStation); }
  }
  function setDragProgress(progress) {
    if (!Number.isFinite(progress)) return;
    if (!dragging) dragColorOrigin = { progress: currentProgress, color: [...currentLCH], rib: [...currentRib], floor: [...currentFloor] };
    dragging = true; currentProgress = progress; targetProgress = progress; cameraTransition = null; colorTransition = null; activeStation = wrapStation(Math.round(progress)); settledPending = true; slowDuration = 0;
  }
  function reactAt(x, y) {
    if (!ready || presentationPaused || dragging || cameraTransition) return false; refreshRaycastBounds(); raycaster.setFromCamera(new THREE.Vector2(x / width * 2 - 1, 1 - y / height * 2), camera); raycaster.far = 100;
    if (!hitsCharacter()) return false;
    if (!reducedMotion) characterMotion?.react(); return true;
  }
  function setPresentationPaused(paused) {
    if (presentationPaused === !!paused) return;
    presentationPaused = !!paused; previousTime = performance.now();
    loadedTime = previousTime; slowDuration = 0; degradeDuration = 0;
  }
  function onVisibilityChange() { cancelAnimationFrame(animationFrame); slowDuration = 0; degradeDuration = 0; if (!document.hidden && !disposed) { previousTime = performance.now(); animationFrame = requestAnimationFrame(render); } }
  function onContextLost(event) { event.preventDefault(); onPerformanceFallback({ reason: 'webgl-context-lost' }); }
  document.addEventListener('visibilitychange', onVisibilityChange); canvas.addEventListener('webglcontextlost', onContextLost); const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize();
  signal?.addEventListener('abort', dispose, { once: true }); if (signal?.aborted) { dispose(); return; } animationFrame = requestAnimationFrame(render);
  try {
    const url = new URL(USE_ANIMATIONS ? 'models/person-authored-animated.glb?v=blender-actions-1' : 'models/person-original.glb?v=original-4k', new URL(import.meta.env.BASE_URL, window.location.href)); const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url.href);
    pendingModel = gltf.scene;
    if (disposed) { disposeSceneResources([pendingModel]); pendingModel = null; return; }
    clothMask = await new THREE.TextureLoader().loadAsync(new URL('hoodie-mask.png?v=original-4k', url).href);
    clothMask.flipY = false; clothMask.colorSpace = THREE.NoColorSpace;
    clothMask.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (disposed) { disposeSceneResources([], [clothMask]); clothMask = null; return; }
    model = gltf.scene; model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model), dimensions = box.getSize(vector()); model.scale.multiplyScalar(HEIGHT / Math.max(dimensions.y, .001)); model.updateMatrixWorld(true); box.setFromObject(model); const center = box.getCenter(vector()); model.position.x -= center.x; model.position.y -= box.min.y; model.position.z -= center.z; modelGroup.add(model); pendingModel = null;
    model.traverse((object) => {
      if (object.isBone) { const name = object.name.replace(/^mixamorig[:_]?/i, ''); bones.set(name, { bone: object, rest: object.quaternion.clone(), base: object.quaternion.clone(), turn: 0 }); }
      if (/^Eye(Left|Right)$/i.test(object.name)) eyes.push({ object, rest: object.quaternion.clone() });
      if (!object.isMesh) return; object.frustumCulled = false; object.castShadow = true; object.receiveShadow = false; meshes.push(object); if (object.morphTargetDictionary && object.morphTargetInfluences) morphMeshes.push(object);
      if (object.isSkinnedMesh) {
        applyHoodieSkinning(object);
        const bounds = makeSkinnedBounds(object); skinnedBounds.push(bounds); skinBoundsByMesh.set(object, bounds);
        // Indexed triangles share most vertices, as do the four node rays.
        // Skin a requested vertex once per pose instead of once per triangle.
        const originalPosition = object.getVertexPosition, count = object.geometry.attributes.position.count;
        const cachedPositions = new Float64Array(count * 3), revisions = new Int32Array(count).fill(-1);
        object.getVertexPosition = (index, target) => {
          if (revisions[index] !== poseRevision) { originalPosition.call(object, index, target); target.toArray(cachedPositions, index * 3); revisions[index] = poseRevision; }
          return target.fromArray(cachedPositions, index * 3);
        };
      }
      const original = Array.isArray(object.material) ? object.material : [object.material], materials = original.map((source) => {
        // Source PBR settings remain in the GLB for interchange. For the website,
        // display its baked color directly instead of lighting the nose/lips twice.
        const material = new THREE.MeshBasicMaterial({ map: source.map, color: source.color, side: source.side,
          transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest, toneMapped: false });
        material.name = source.name; material.userData = { ...source.userData, sourceRoughness: source.roughness };
        source.dispose();
        if (material.map && material.userData.clothMask) {
          // The original surface is one unmodified indexed mesh. A full-size UV
          // mask recolors cloth pixels, including triangles shared with skin.
          // Never classify whole faces at the collar or replace the source map.
          const cloth = material;
          cloth.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          cloth.userData.clothTint = new THREE.Color();
          cloth.onBeforeCompile = shader => {
            shader.uniforms.clothSourceLuminance = { value: cloth.userData.sourceLuminance || .022 };
            shader.uniforms.clothMask = { value: clothMask };
            shader.uniforms.clothTint = { value: cloth.userData.clothTint };
            shader.fragmentShader = 'uniform float clothSourceLuminance; uniform sampler2D clothMask; uniform vec3 clothTint;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
              #ifdef USE_MAP
                vec4 fabric = texture2D(map, vMapUv);
                float detail = dot(fabric.rgb, vec3(.2126, .7152, .0722)) / clothSourceLuminance;
                float garment = texture2D(clothMask, vMapUv).r;
                diffuseColor *= vec4(mix(fabric.rgb, clothTint * detail, garment), fabric.a);
              #endif
            `);
          };
          cloth.customProgramCacheKey = () => 'original-fabric-mask-v2';
          clothMaterials.push(cloth); return cloth;
        }
        return material;
      }); object.material = Array.isArray(object.material) ? materials : materials[0];
    });
    if (USE_ANIMATIONS && gltf.animations.length) characterMotion = createCharacterMotion({ model, animations: gltf.animations, bones, reducedMotion });
    applyColors();
    await renderer.compileAsync(scene, camera); if (disposed) return;
    ready = true; loadedTime = performance.now(); settledPending = true; startPerformance(activeStation);
    // onReady means a complete, correctly framed t=0 image is already available.
    // The caller can decode capture() and hand off its poster before releasing time.
    cancelAnimationFrame(animationFrame); previousTime = loadedTime; occlusionPending = true; render(loadedTime, true);
    onReady({ modelHeight: HEIGHT, materials: clothMaterials.length, animations: characterMotion?.getState().clips || [], morphTargets: [...new Set(morphMeshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary)))], eyes: eyes.length });
  } catch (error) { onError(error); cancelAnimationFrame(animationFrame); dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(animationFrame); resizeObserver.disconnect(); document.removeEventListener('visibilitychange', onVisibilityChange); canvas.removeEventListener('webglcontextlost', onContextLost); signal?.removeEventListener('abort', dispose); characterMotion?.dispose();
    disposeSceneResources([scene, pendingModel], clothMask ? [clothMask] : []); pendingModel = null; clothMask = null;
    key.shadow.dispose(); renderer.dispose();
  }
  function capture({ characterOnly = false } = {}) {
    if (!characterOnly) { renderer.render(scene, camera); return canvas.toDataURL('image/png'); }
    const background = [floor, shadowReceiver, ...contactShadows, frontRing, backRing, ticks], visibility = background.map(object => object.visible);
    try {
      for (const object of background) object.visible = false;
      renderer.render(scene, camera); return canvas.toDataURL('image/png');
    } finally {
      background.forEach((object, index) => { object.visible = visibility[index]; });
      renderer.render(scene, camera);
    }
  }
  return { setStation, setDragProgress, setPresentationPaused, reactAt, resize, dispose,
    capture,
    getState: () => ({ currentProgress, targetProgress, activeStation, ready, presentationPaused, posterLayout: posterLayout && { ...posterLayout, top: { ...posterLayout.top }, bottom: { ...posterLayout.bottom } }, dragging, moving: !!cameraTransition || dragging, mobile, width, height, dpr: renderer.getPixelRatio(), triangles: renderer.info.render.triangles,
      colors: { hoodie: lastCssColor, rib: `#${new THREE.Color().fromArray(oklabToLinear(lchToLab(currentRib))).getHexString()}`, lch: [...currentLCH], durationMs: 600, throughBlack: false }, ring: { openness: lastProfile.openness, linewidth: 1.25, frontInk: .7, backDash: [3, 4], ticks: 4 }, camera: { azimuth: lastProfile.azimuth, shift: lastProfile.shift, fill: lastProfile.fill, restClose: [...restClose], position: camera.position.toArray(), target: lookAt.toArray(), anchor: cameraAnchor.toArray(), tracking: characterMotion?.getState().walking || false }, nodes: nodePositions,
      animation: { ...(characterMotion?.getState() || { action: 'OriginalRest', clips: [], walking: false, position: [0, 0, 0] }), reducedMotion, eyes: 0, morphs: {}, pose: Object.fromEntries(['Hips','Head','LeftHand','RightHand','LeftFoot','RightFoot'].map((name) => [name, bones.get(name)?.bone.getWorldPosition(vector()).toArray()])) }, protectedBounds: protectedBounds(),
      studio: { surface: 'original-baked-albedo', ambient: 0, shadowOpacity: .10, shadowWorldPosition: key.position.toArray(), shadowFade: [.45, 1.7], shadowEnabled: key.castShadow, mapSize: key.shadow.mapSize.x, floorTintStrength: .5, floorEdge: '#f3f3f5', floorRadiusH: 1.8 }, quality: { level: qualityLevel, slowDuration, fallbackTriggered, automaticDowngrade: false, timings: { ...timings } }, cloth: clothMaterials.map((material) => ({ name: material.name, normalMap: false, originalAlbedo: !!material.map, textureSize: [material.map?.image?.width, material.map?.image?.height], sourceRoughness: material.userData.sourceRoughness, surface: material.type, colorMaskSize: [clothMask?.image?.width, clothMask?.image?.height] })) }),
  };
}
function disposeSceneResources(roots, extraTextures = []) {
  const geometries = new Set(), materials = new Set(), textures = new Set(extraTextures), bitmaps = new Set(), skeletons = new Set();
  for (const root of roots) root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) if (texture.image?.close) bitmaps.add(texture.image);
  for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}
function makeSkinnedBounds(mesh) {
  const positions = mesh.geometry.attributes.position, indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const influences = mesh.skeleton.bones.map((bone, i) => ({ bone, box: new THREE.Box3(), toBone: new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[i], mesh.bindMatrix) }));
  const position = new THREE.Vector3(), local = new THREE.Vector3(), skinIndex = new THREE.Vector4(), skinWeight = new THREE.Vector4();
  for (let i = 0; i < positions.count; i += 1) {
    position.fromBufferAttribute(positions, i); skinIndex.fromBufferAttribute(indices, i); skinWeight.fromBufferAttribute(weights, i);
    for (let j = 0; j < 4; j += 1) if (skinWeight.getComponent(j) > 0) { const influence = influences[skinIndex.getComponent(j)]; influence.box.expandByPoint(local.copy(position).applyMatrix4(influence.toBone)); }
  }
  // Small triangle batches retain the authored topology. Each batch carries the
  // same conservative bone bounds, letting a ray reject distant limbs before
  // computing their skinned vertices. No simplified body proxy is used.
  const index = mesh.geometry.index, count = index ? index.count : positions.count, clusters = [];
  for (let start = 0; start < count; start += 96 * 3) {
    const end = Math.min(count, start + 96 * 3), byBone = new Map(), visited = new Set();
    for (let offset = start; offset < end; offset += 1) {
      const vertex = index ? index.getX(offset) : offset; if (visited.has(vertex)) continue; visited.add(vertex);
      position.fromBufferAttribute(positions, vertex); skinIndex.fromBufferAttribute(indices, vertex); skinWeight.fromBufferAttribute(weights, vertex);
      for (let j = 0; j < 4; j += 1) if (skinWeight.getComponent(j) > 0) {
        const boneIndex = skinIndex.getComponent(j), influence = influences[boneIndex];
        if (!byBone.has(boneIndex)) byBone.set(boneIndex, { bone: influence.bone, box: new THREE.Box3() });
        byBone.get(boneIndex).box.expandByPoint(local.copy(position).applyMatrix4(influence.toBone));
      }
    }
    clusters.push({ start, end, influences: [...byBone.values()], box: new THREE.Box3(), revision: -1 });
  }
  mesh.boundingBox = new THREE.Box3(); mesh.boundingSphere = new THREE.Sphere();
  return { mesh, influences: influences.filter(({ box }) => !box.isEmpty()), clusters };
}
function updateLine(geometry, positions) { if (!geometry.attributes.instanceStart) { geometry.setPositions(positions); return; } const data = geometry.attributes.instanceStart.data; for (let i = 0; i < positions.length / 3 - 1; i += 1) for (let component = 0; component < 3; component += 1) { data.array[i * 6 + component] = positions[i * 3 + component]; data.array[i * 6 + component + 3] = positions[i * 3 + component + 3]; } data.needsUpdate = true; }
function makeShadowTexture() { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const context = canvas.getContext('2d'), gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64); for (const [stop, alpha] of [[0, 1], [.18, .8], [.46, .35], [1, 0]]) gradient.addColorStop(stop, `rgba(255,255,255,${alpha})`); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(canvas); }



