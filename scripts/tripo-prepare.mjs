/**
 * Attach the supplied Tripo animations to the original web character.
 * The original mesh, face, materials, textures, rig, and compressed binary bytes
 * are retained verbatim. Animation accessors are compressed losslessly.
 * Run: node scripts/tripo-prepare.mjs
 * Verify reproducibility without writing: node scripts/tripo-prepare.mjs --check
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const baselineURL = new URL('../public/models/person.glb', import.meta.url);
const outputURL = new URL('../public/models/person-animated.glb', import.meta.url);
const metadataURL = new URL('../public/models/person-animated-info.json', import.meta.url);
const sourceDefinitions = [
  { path:'动作素材/human+character+3d+model.glb', names:['Idle','Greet','Box','Walk','Nod','Wave'],
    sourceNames:['角色自然站立.001','人物主动向面前的人打招呼，精神饱满，反应利','box_01.001','角色正常走路.001','人物认真听完一句话后，给出明确、自信的肯定','角色小幅挥手，别有气无力的.001'] },
  { path:'动作素材/human+character+3d+model+huangu.glb', names:['LookAround'], sourceNames:['look_around.001'] },
];
const checkOnly = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const align4 = n => (n + 3) & ~3;
function parseGLB(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2.0.');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error('Expected embedded binary chunk.');
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart)) };
}
function encodeGLB(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(align4(text.length), 0x20); text.copy(jsonChunk);
  const binChunk = Buffer.alloc(align4(bin.length)); bin.copy(binChunk);
  const bytes = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonChunk.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(bytes, 20);
  const offset = 20 + jsonChunk.length; bytes.writeUInt32LE(binChunk.length, offset); bytes.writeUInt32LE(0x004e4942, offset + 4); binChunk.copy(bytes, offset + 8);
  return bytes;
}
const [sources,baselineBytes] = await Promise.all([
  Promise.all(sourceDefinitions.map(async definition=>{
    const url=new URL(`../${definition.path}`,import.meta.url), bytes=await readFile(url), parsed=parseGLB(bytes);
    if (parsed.json.animations.length!==definition.names.length || parsed.json.animations.some((animation,index)=>animation.name!==definition.sourceNames[index])) throw new Error(`The supplied clip order or names changed in ${definition.path}. Inspect them before assigning web actions.`);
    return {...definition,...parsed,url,bytes,sha256:hash(bytes),accessorMap:new Map()};
  })),
  readFile(baselineURL),
]);
const baseline = parseGLB(baselineBytes);
const json = structuredClone(baseline.json);
const nodesByName = new Map(json.nodes.map((node,index)=>[node.name,index]));
const baselineSkin = json.skins[0];
if (baselineSkin.joints.length !== 65) throw new Error('Unexpected baseline skeleton; retargeting must be reviewed.');
const boneParents = (document,skin) => {
  const jointNames = new Set(skin.joints.map(index=>document.nodes[index].name)), parents = new Map();
  for (const node of document.nodes) for (const child of node.children || []) if (jointNames.has(document.nodes[child].name)) parents.set(document.nodes[child].name,jointNames.has(node.name)?node.name:null);
  return parents;
};
const baselineParents = boneParents(json,baselineSkin);
const distance = (a,b) => Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
let maxTranslation = 0, maxQuaternion = 0, maxScale = 0;
for (const source of sources) {
  const sourceSkin=source.json.skins[0];
  if (sourceSkin.joints.length!==65) throw new Error(`Unexpected skeleton in ${source.path}.`);
  const sourceParents=boneParents(source.json,sourceSkin);
  let translation=0,quaternion=0,scale=0;
  for (const joint of sourceSkin.joints) {
    const a = source.json.nodes[joint], b = json.nodes[nodesByName.get(a.name)];
    if (!b) throw new Error(`Missing original bone ${a.name}.`);
    if (sourceParents.get(a.name)!==baselineParents.get(a.name)) throw new Error(`Bone hierarchy differs for ${a.name} in ${source.path}.`);
    translation = Math.max(translation,distance(a.translation || [0,0,0],b.translation || [0,0,0]));
    const aq = a.rotation || [0,0,0,1], bq = b.rotation || [0,0,0,1];
    quaternion = Math.max(quaternion,Math.min(distance(aq,bq),distance(aq,bq.map(x=>-x))));
    scale = Math.max(scale,distance(a.scale || [1,1,1],b.scale || [1,1,1]));
  }
  source.skeletonComparison={jointCount:65,maxRestTranslation:translation,maxRestQuaternion:quaternion,maxRestScale:scale};
  maxTranslation=Math.max(maxTranslation,translation);maxQuaternion=Math.max(maxQuaternion,quaternion);maxScale=Math.max(maxScale,scale);
}
if (maxTranslation > 1e-5 || maxQuaternion > 1e-4 || maxScale > 1e-4) throw new Error('Rest skeleton differs too much for a direct animation transfer.');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const baselineBinLength = json.buffers[0].byteLength;
const chunks = [baseline.bin.subarray(0,baselineBinLength)];
let binLength = baselineBinLength;
const fallbackIndex = json.buffers.findIndex(b=>b.extensions?.EXT_meshopt_compression?.fallback);
if (fallbackIndex < 0) throw new Error('Expected the preserved meshopt baseline.');
let fallbackLength = json.buffers[fallbackIndex].byteLength;
const componentCounts = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
function appendAccessor(source,index) {
  if (source.accessorMap.has(index)) return source.accessorMap.get(index);
  const accessor = source.json.accessors[index], view = source.json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126 || accessor.sparse || view.buffer !== 0 || view.extensions) throw new Error('Unexpected animation accessor encoding.');
  const stride = componentCounts[accessor.type] * 4;
  if (!stride) throw new Error(`Unsupported animation type ${accessor.type}.`);
  const raw = Buffer.alloc(accessor.count * stride), start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  for(let row = 0; row < accessor.count; row++) source.bin.copy(raw, row * stride, start + row * (view.byteStride || stride), start + row * (view.byteStride || stride) + stride);
  const compressed = Buffer.from(MeshoptEncoder.encodeGltfBuffer(raw,accessor.count,stride,'ATTRIBUTES'));
  const pad = align4(binLength)-binLength;
  if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
  const viewIndex = json.bufferViews.length;
  json.bufferViews.push({buffer:fallbackIndex,byteOffset:fallbackLength,byteLength:raw.length,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:binLength,byteLength:compressed.length,byteStride:stride,count:accessor.count,mode:'ATTRIBUTES'}}});
  chunks.push(compressed); binLength += compressed.length; fallbackLength += raw.length;
  const destination = {...structuredClone(accessor),bufferView:viewIndex,byteOffset:0};
  const destinationIndex = json.accessors.length; json.accessors.push(destination); source.accessorMap.set(index,destinationIndex);
  return destinationIndex;
}
const animationSources=sources.flatMap(source=>source.json.animations.map((animation,index)=>({source,animation,index,name:source.names[index]})));
json.animations = animationSources.map(({source,animation,index,name})=>({
  name, extras:{sourceName:animation.name,sourceIndex:index},
  samplers:animation.samplers.map(s=>({...s,input:appendAccessor(source,s.input),output:appendAccessor(source,s.output)})),
  channels:animation.channels.map(c=>{
    const sourceName = source.json.nodes[c.target.node].name, node = nodesByName.get(sourceName);
    if (node === undefined) throw new Error(`Unknown animated bone ${sourceName}.`);
    return {...c,target:{...c.target,node}};
  })
}));
json.buffers[0].byteLength = binLength; json.buffers[fallbackIndex].byteLength = fallbackLength;
const output = encodeGLB(json,Buffer.concat(chunks));
const encoded = parseGLB(output);
if (!encoded.bin.subarray(0,baselineBinLength).equals(baseline.bin.subarray(0,baselineBinLength))) throw new Error('Original mesh binary was changed.');
for (const field of ['nodes','meshes','skins','materials','textures','images','samplers','scenes']) {
  if (JSON.stringify(encoded.json[field]) !== JSON.stringify(baseline.json[field])) throw new Error(`Original ${field} changed.`);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const [sourceDocuments, outputDocument] = await Promise.all([Promise.all(sources.map(source=>io.readBinary(source.bytes))),io.readBinary(output)]);
const originalClips = sourceDocuments.flatMap(document=>document.getRoot().listAnimations()), newClips = outputDocument.getRoot().listAnimations();
const clips = [];
for (let index = 0; index < newClips.length; index++) {
  const actual = newClips[index], expected = originalClips[index], actualChannels = actual.listChannels(), expectedChannels = expected.listChannels();
  if (actualChannels.length !== expectedChannels.length) throw new Error('Animation channel count changed.');
  for (let channel = 0; channel < actualChannels.length; channel++) {
    const a = actualChannels[channel], b = expectedChannels[channel];
    if (a.getTargetNode().getName() !== b.getTargetNode().getName() || a.getTargetPath() !== b.getTargetPath()) throw new Error('Animation target changed.');
    for (const method of ['getInput','getOutput']) {
      const aa = a.getSampler()[method]().getArray(), bb = b.getSampler()[method]().getArray();
      if (aa.length !== bb.length || aa.some((value,i)=>value!==bb[i] || !Number.isFinite(value))) throw new Error('Animation samples changed during compression.');
    }
  }
  const hips = actualChannels.find(c=>c.getTargetNode().getName()==='mixamorig:Hips' && c.getTargetPath()==='translation').getSampler().getOutput().getArray();
  const start = Array.from(hips.slice(0,3)), end = Array.from(hips.slice(-3)), delta = end.map((v,i)=>v-start[i]);
  const provenance=animationSources[index];
  clips.push({name:provenance.name,source:provenance.source.path,sourceName:expected.getName(),sourceIndex:provenance.index,duration:Math.max(...actual.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),channels:actualChannels.length,
    rootMotion:{bone:'mixamorig:Hips',start,end,delta,worldDelta:delta.map(v=>v*json.nodes.find(n=>n.name==='PersonRig').scale[0])},
    recommendation:provenance.name==='Walk'?'真实根运动；镜头与场景锚点跟随。不要直接首尾跳回循环。':provenance.name==='Box'?'拳击动作；默认不启用。':provenance.name==='Greet'?'大幅招手已由用户撤回，不绑定或播放。':provenance.name==='Idle'?'站立包含侧向漂移，避免直接硬循环。':provenance.name==='LookAround'?'用户新增环顾原片段；保留原采样，播放区间与构图另行验收。':'原地短动作；进入和退出时交叉淡化。'});
}
const metadata = {version:2,source:sources[0].path,sources:sources.map(source=>({path:source.path,sha256:source.sha256,bytes:source.bytes.length,clips:[...source.names],skeletonComparison:source.skeletonComparison})),baseline:'public/models/person.glb',output:'public/models/person-animated.glb',
  sourceSHA256:sources[0].sha256,baselineSHA256:hash(baselineBytes),outputSHA256:hash(output),bytes:output.length,
  preserved:{originalFace:true,originalMeshBytes:true,originalMaterials:true,originalTextures:true,originalSkeleton:true,newMorphTargets:false},
  skeletonComparison:{jointCount:65,maxRestTranslation:maxTranslation,maxRestQuaternion:maxQuaternion,maxRestScale:maxScale},
  validation:'Original mesh/texture bytes and all scene object definitions match the baseline exactly; all animation channels and floating-point samples match the supplied Tripo clips exactly after reopening the compressed GLB.',clips};
for (const source of sources) if (hash(await readFile(source.url))!==source.sha256) throw new Error(`Source file changed during conversion: ${source.path}.`);
if (hash(await readFile(baselineURL)) !== metadata.baselineSHA256) throw new Error('The baseline changed during conversion.');
const metadataBytes = Buffer.from(JSON.stringify(metadata,null,2)+'\n');
if (checkOnly) {
  if (!(await readFile(outputURL)).equals(output) || !(await readFile(metadataURL)).equals(metadataBytes)) throw new Error('Committed derived assets differ from reproducible conversion output.');
} else {
  // Publish only after both preservation and animation round-trip checks pass.
  await writeFile(outputURL,output);
  await writeFile(metadataURL,metadataBytes);
}
console.log(JSON.stringify({...metadata,checkOnly},null,2));
