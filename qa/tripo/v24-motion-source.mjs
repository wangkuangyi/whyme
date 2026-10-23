/** Inspect the authored LookAround curve; no retargeting or generated poses. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(fileURLToPath(new URL('../../public/models/person-animated.glb', import.meta.url)));
const animation = document.getRoot().listAnimations().find(item => item.getName() === 'LookAround');
const channels = animation.listChannels().filter(channel => channel.getTargetPath() === 'rotation');
const bones = ['Head', 'Neck', 'Spine', 'Spine1', 'Spine2'];
const tracks = bones.map(name => {
  const channel = channels.find(item => item.getTargetNode().getName().replace(/^mixamorig[:_]?/i, '') === name);
  const track = new THREE.QuaternionKeyframeTrack(name, channel.getSampler().getInput().getArray(), channel.getSampler().getOutput().getArray());
  return { name, interpolant: track.createInterpolant() };
});
const first = tracks.map(track => new THREE.Quaternion().fromArray(track.interpolant.evaluate(0)).normalize());
const samples = [];
for (let time = 0; time <= 15.5; time += .25) {
  const rotations = Object.fromEntries(tracks.map((track, index) => {
    const q = new THREE.Quaternion().fromArray(track.interpolant.evaluate(time)).normalize();
    const relative = first[index].clone().invert().multiply(q);
    const euler = new THREE.Euler().setFromQuaternion(relative, 'YXZ');
    return [track.name, { yaw: THREE.MathUtils.radToDeg(euler.y), pitch: THREE.MathUtils.radToDeg(euler.x), roll: THREE.MathUtils.radToDeg(euler.z), fromFirst: THREE.MathUtils.radToDeg(first[index].angleTo(q)) }];
  }));
  samples.push({ time, rotations });
}
await writeFile(new URL('./v24-motion-source.json', import.meta.url), JSON.stringify(samples, null, 2));
console.table(samples.filter((_,i) => i%2===0).map(sample => ({time: sample.time,...Object.fromEntries(['Head','Neck','Spine2'].map(name => [name, Object.values(sample.rotations[name]).map(x=>x.toFixed(1)).join(', ')]))})));
