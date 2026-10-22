/** Read-only inspection of supplied Tripo clips against the preserved web model. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const root = new URL('../', import.meta.url);
const input = new URL('../动作素材/human+character+3d+model.glb', import.meta.url);
const [source, baseline] = await Promise.all([io.read(fileURLToPath(input)), io.read(fileURLToPath(new URL('public/models/person.glb', root)))]);
const srcNodes = source.getRoot().listNodes();
const dstNodes = baseline.getRoot().listNodes();
const dstByName = new Map(dstNodes.map(node => [node.getName(), node]));
const delta = (a,b) => Math.max(...a.map((x,i) => Math.abs(x-b[i])));
const qDelta = (a,b) => Math.min(delta(a,b),delta(a,b.map(x => -x)));
const boneComparison = source.getRoot().listSkins()[0].listJoints().map(node => {
  const other = dstByName.get(node.getName());
  return { name:node.getName(), missing:!other, translation:other ? delta(node.getTranslation(),other.getTranslation()) : null,
    rotation:other ? qDelta(node.getRotation(),other.getRotation()) : null,
    scale:other ? delta(node.getScale(),other.getScale()) : null,
    sourceParent:node.getParentNode()?.getName(), targetParent:other?.getParentNode()?.getName() };
});
const summary = doc => ({
  nodes:doc.getRoot().listNodes().length, skins:doc.getRoot().listSkins().map(s => ({name:s.getName(), joints:s.listJoints().length})),
  roots:doc.getRoot().listScenes().flatMap(s=>s.listChildren().map(n=>({name:n.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()}))),
  materials:doc.getRoot().listMaterials().map(m=>m.getName()), meshes:doc.getRoot().listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({vertices:p.getAttribute('POSITION').getCount(),triangles:p.getIndices()?.getCount()/3}))}))
});
const clips = source.getRoot().listAnimations().map((a,index)=>({
  index, name:a.getName(), duration:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),
  channels:a.listChannels().length,
  tracks:a.listChannels().map(c=>{
    const array = c.getSampler().getOutput().getArray(); const size = c.getSampler().getOutput().getElementSize();
    const minimum = Array(size).fill(Infinity), maximum = Array(size).fill(-Infinity);
    for(let i=0;i<array.length;i++) { minimum[i%size] = Math.min(minimum[i%size],array[i]); maximum[i%size] = Math.max(maximum[i%size],array[i]); }
    return {node:c.getTargetNode().getName(),path:c.getTargetPath(),samples:array.length/size,first:Array.from(array.slice(0,size)),last:Array.from(array.slice(-size)),minimum,maximum,range:maximum.map((v,i)=>v-minimum[i])};
  })
}));
const result = { source:summary(source),baseline:summary(baseline),boneComparison,
  maxRestTranslation:Math.max(...boneComparison.map(b=>b.translation)),maxRestQuaternion:Math.max(...boneComparison.map(b=>b.rotation)),maxRestScale:Math.max(...boneComparison.map(b=>b.scale)), clips };
await mkdir(new URL('output/',root),{recursive:true});
await writeFile(new URL('output/tripo-inspection.json',root),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result, clips:clips.map(c=>({...c,tracks:c.tracks.filter(t=>t.node==='mixamorig:Hips' || t.node==='mixamorig:Head')})),boneComparison:undefined},null,2));
