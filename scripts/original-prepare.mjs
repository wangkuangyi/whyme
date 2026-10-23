/**
 * Restore the supplied Tripo surface without subdivision, geometry quantization,
 * image resizing/re-encoding, synthetic face features, or synthetic cloth maps.
 *
 * node scripts/original-prepare.mjs         write the reviewed derived assets
 * node scripts/original-prepare.mjs --check validate reproducibility, read-only
 *
 * The approved animated Tripo export supplies a valid bind skeleton. The earlier
 * static export has no joint transforms and invalid inverse-bind values; its
 * exact 4096px JPEG and original material settings are nevertheless identical / 
 * applicable to the supplied surface. See the generated provenance report.
 */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4} from 'three';

const root=new URL('../',import.meta.url), checkOnly=process.argv.includes('--check');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const align4=n=>(n+3)&~3;
const sourceDefinitions=[
  {path:'动作素材/human+character+3d+model.glb',names:['Idle','Greet','Box',null,'Nod','Wave'],sourceNames:['角色自然站立.001','人物主动向面前的人打招呼，精神饱满，反应利','box_01.001','角色正常走路.001','人物认真听完一句话后，给出明确、自信的肯定','角色小幅挥手，别有气无力的.001']},
  {path:'动作素材/human+character+3d+model+huangu.glb',names:['LookAround'],sourceNames:['look_around.001']},
  {path:'动作素材/human+character+3d+model+walk2.glb',names:['Walk'],sourceNames:['walk.001']},
];
const order=['Idle','Greet','Box','Walk','Nod','Wave','LookAround'];
const staticPath='public/models/person-original.glb', animatedPath='public/models/person-original-animated.glb';
function parse(bytes){
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);
  const n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n).toString('utf8')),offset=20+n;
  assert.equal(bytes.readUInt32LE(offset+4),0x004e4942);
  return {json,bin:bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset))};
}
function encode(json,bin){
  const text=Buffer.from(JSON.stringify(json)),j=Buffer.alloc(align4(text.length),0x20),b=Buffer.alloc(align4(bin.length));text.copy(j);bin.copy(b);
  const bytes=Buffer.alloc(28+j.length+b.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(j.length,12);bytes.writeUInt32LE(0x4e4f534a,16);j.copy(bytes,20);
  bytes.writeUInt32LE(b.length,20+j.length);bytes.writeUInt32LE(0x004e4942,24+j.length);b.copy(bytes,28+j.length);return bytes;
}
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},sizes={5121:1,5123:2,5125:4,5126:4};
function accessorBytes(source,index){
  const a=source.json.accessors[index],v=source.json.bufferViews[a.bufferView],stride=components[a.type]*sizes[a.componentType];
  assert.ok(stride);assert.equal(v.buffer,0);assert.ok(!a.sparse&&!v.extensions,'Only raw original accessor bytes are accepted.');
  const data=Buffer.alloc(a.count*stride),offset=(v.byteOffset||0)+(a.byteOffset||0);
  for(let i=0;i<a.count;i++)source.bin.copy(data,i*stride,offset+i*(v.byteStride||stride),offset+i*(v.byteStride||stride)+stride);
  return data;
}
function readValue(source,index,vertex,component=0){
  const a=source.json.accessors[index],stride=components[a.type]*sizes[a.componentType],v=source.json.bufferViews[a.bufferView],offset=(v.byteOffset||0)+(a.byteOffset||0)+vertex*(v.byteStride||stride)+component*sizes[a.componentType];
  return a.componentType===5126?source.bin.readFloatLE(offset):a.componentType===5125?source.bin.readUInt32LE(offset):a.componentType===5123?source.bin.readUInt16LE(offset):source.bin.readUInt8(offset);
}
const sources=await Promise.all(sourceDefinitions.map(async d=>{const bytes=await readFile(new URL(d.path,root)),p=parse(bytes);assert.deepEqual(p.json.animations.map(a=>a.name),d.sourceNames);return {...d,...p,bytes,sha256:sha(bytes)};}));
const earliestBytes=await readFile(new URL('../human character 3d model.glb',root)),earliest=parse(earliestBytes),base=sources[0];
const imageBytes=(s,index=0)=>{const image=s.json.images[index],view=s.json.bufferViews[image.bufferView];return s.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);};
assert.deepEqual(imageBytes(base),imageBytes(earliest),'The detailed original 4K JPEG must match the first Tripo export exactly.');
const decoded=await sharp(imageBytes(base)).removeAlpha().raw().toBuffer({resolveWithObject:true});
assert.equal(decoded.info.width,4096);assert.equal(decoded.info.height,4096);
const json=structuredClone(base.json);delete json.animations;
const originalMaterial=structuredClone(earliest.json.materials[earliest.json.meshes[0].primitives[0].material]);
// Both Tripo exports use the same sole base-color texture. Retain the validated
// source texture index while restoring the first export's original PBR settings.
originalMaterial.pbrMetallicRoughness.baseColorTexture.index=base.json.materials[0].pbrMetallicRoughness.baseColorTexture.index;
json.materials=[{...structuredClone(originalMaterial),name:'Original'}];
const chunks=[base.bin.subarray(0,json.buffers[0].byteLength)];let length=chunks[0].length;
function append(data,definition,target){
  const pad=align4(length)-length;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
  const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,...(target?{target}:{})});chunks.push(data);length+=data.length;
  const index=json.accessors.length;json.accessors.push({...definition,bufferView:view,byteOffset:0});return index;
}
const primitive=base.json.meshes[0].primitives[0],attrs=primitive.attributes,sourceTriangles=[];
const maskSize=4096,region=Buffer.alloc(maskSize*maskSize);let clothCandidateTriangles=0;
const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const smooth=(lo,hi,value)=>{const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));return t*t*(3-2*t);};
for(let index=0;index<base.json.accessors[primitive.indices].count;index+=3){
  const indices=[0,1,2].map(i=>readValue(base,primitive.indices,index+i)),positions=indices.map(v=>[0,1,2].map(c=>readValue(base,attrs.POSITION,v,c))),uvs=indices.map(v=>[0,1].map(c=>readValue(base,attrs.TEXCOORD_0,v,c)));
  sourceTriangles.push(indices.join(','));
  if(Math.max(...positions.map(p=>p[1]))<.458||Math.min(...positions.map(p=>p[1]))>.85)continue;
  clothCandidateTriangles++;
  const [a,b,c]=uvs.map(p=>p.map(v=>v*maskSize)),den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;
  const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(maskSize-1,Math.ceil(Math.max(a[0],b[0],c[0]))),minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(maskSize-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+.5,py=y+.5,w0=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,w1=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den,w2=1-w0-w1;if(Math.min(w0,w1,w2)<-1e-7)continue;
    const height=w0*positions[0][1]+w1*positions[1][1]+w2*positions[2][1],worldX=w0*positions[0][0]+w1*positions[1][0]+w2*positions[2][0];
    // Evaluate anatomical location per texel, not per whole triangle. The hood
    // extends to .84m, below the hair crown; skin pixels in shared triangles are
    // removed separately using their original 4K colour, preserving neck edges.
    if(height>.85||height<.465||(height<.471&&Math.abs(worldX)<.105))continue;
    region[y*maskSize+x]=255;
  }
}
// Two pixels of atlas padding avoid dark seams at existing UV islands. Apply
// skin exclusion after padding, so no coloured padding reaches skin texels.
const horizontal=Buffer.alloc(region.length),padded=Buffer.alloc(region.length);
for(let y=0;y<maskSize;y++)for(let x=0;x<maskSize;x++){
  const i=y*maskSize+x;for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<maskSize&&region[i+dx]){horizontal[i]=255;break;}
}
for(let y=0;y<maskSize;y++)for(let x=0;x<maskSize;x++){
  const i=y*maskSize+x;for(let dy=-2;dy<=2;dy++)if(y+dy>=0&&y+dy<maskSize&&horizontal[i+dy*maskSize]){padded[i]=255;break;}
}
const mask=Buffer.alloc(region.length),histogram=new Uint32Array(4096);let maskPixels=0,skinPixelsProtected=0;
for(let i=0;i<mask.length;i++){
  if(!padded[i])continue;const j=i*decoded.info.channels,r=decoded.data[j]/255,g=decoded.data[j+1]/255,b=decoded.data[j+2]/255;
  const warmth=smooth(.04,.10,(r-g)/Math.max(r,.01))*smooth(.07,.18,(r-b)/Math.max(r,.01));
  mask[i]=Math.round(255*(1-warmth));if(warmth>.99)skinPixelsProtected++;
  if(mask[i]>128){maskPixels++;const luma=.2126*linear(r)+.7152*linear(g)+.0722*linear(b);histogram[Math.min(4095,Math.floor(luma*4096))]++;}
}
assert.ok(maskPixels>100000&&skinPixelsProtected>10000);
const quantile=p=>{let sum=0;for(let i=0;i<histogram.length;i++){sum+=histogram[i];if(sum>=maskPixels*p)return(i+.5)/4096;}return 1;};
json.materials[0].extras={...json.materials[0].extras,sourceLuminance:quantile(.5),clothMask:'hoodie-mask.png'};
const maskPath='public/models/hoodie-mask.png',maskBytes=await sharp(mask,{raw:{width:maskSize,height:maskSize,channels:1}}).greyscale().png({compressionLevel:9,palette:false}).toBuffer();
json.buffers[0].byteLength=length;
const staticBytes=encode(json,Buffer.concat(chunks)),staticParsed=parse(staticBytes);
const nameToNode=new Map(json.nodes.map((n,i)=>[n.name,i]));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceDocs=await Promise.all(sources.map(s=>io.readBinary(s.bytes)));
const bones=sourceDocs[0].getRoot().listSkins()[0].listJoints(),parents=new Map(bones.map(n=>[n.getName(),n.getParentNode()?.getName()]));
let maxRestDelta=0;
for(const doc of sourceDocs)for(const joint of doc.getRoot().listSkins()[0].listJoints()){
  const ref=bones.find(n=>n.getName()===joint.getName());assert.ok(ref);assert.equal(joint.getParentNode()?.getName(),parents.get(joint.getName()));
  for(const method of ['getTranslation','getScale'])for(let i=0;i<3;i++)maxRestDelta=Math.max(maxRestDelta,Math.abs(joint[method]()[i]-ref[method]()[i]));
  const a=joint.getRotation(),b=ref.getRotation();maxRestDelta=Math.max(maxRestDelta,Math.min(Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),Math.max(...a.map((v,i)=>Math.abs(v+b[i])))));
}
assert.ok(maxRestDelta<1e-4);
const mapping=new Map(),provenance=[];
json.animations=sources.flatMap((source,sourceIndex)=>source.json.animations.map((animation,i)=>({source,sourceIndex,animation,i,name:source.names[i]})).filter(c=>c.name)).sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name)).map(c=>{
  provenance.push({name:c.name,source:c.source.path,sourceIndex:c.i,sourceName:c.animation.name});
  function mapped(index){if(c.sourceIndex===0)return index;const key=`${c.sourceIndex}:${index}`;if(mapping.has(key))return mapping.get(key);const a=structuredClone(c.source.json.accessors[index]);delete a.bufferView;delete a.byteOffset;const next=append(accessorBytes(c.source,index),a);mapping.set(key,next);return next;}
  return {...structuredClone(c.animation),name:c.name,extras:{sourceName:c.animation.name,sourceIndex:c.i},samplers:c.animation.samplers.map(s=>({...s,input:mapped(s.input),output:mapped(s.output)})),channels:c.animation.channels.map(ch=>{const node=nameToNode.get(c.source.json.nodes[ch.target.node].name);assert.notEqual(node,undefined);return {...ch,target:{...ch.target,node}};})};
});
assert.deepEqual(json.animations.map(a=>a.name),order);json.buffers[0].byteLength=length;
const animatedBytes=encode(json,Buffer.concat(chunks)),animated=parse(animatedBytes),animatedDoc=await io.readBinary(animatedBytes);
const checks=[],check=(name,fn)=>{fn();checks.push({name,passed:true});};
const reopenedMask=await sharp(maskBytes).greyscale().raw().toBuffer({resolveWithObject:true});
check('cloth-mask-is-lossless-4096px-grayscale',()=>{assert.equal(reopenedMask.info.width,4096);assert.equal(reopenedMask.info.height,4096);assert.equal(reopenedMask.info.channels,1);assert.deepEqual(reopenedMask.data,mask);});
const outputSkin=animatedDoc.getRoot().listSkins()[0];let maxRestBindIdentityError=0;
for(let i=0;i<outputSkin.listJoints().length;i++){
  const bind=new Matrix4().fromArray(outputSkin.listJoints()[i].getWorldMatrix()).multiply(new Matrix4().fromArray(outputSkin.getInverseBindMatrices().getElement(i,[])));
  for(let j=0;j<16;j++)maxRestBindIdentityError=Math.max(maxRestBindIdentityError,Math.abs(bind.elements[j]-(j%5===0?1:0)));
}
check('valid-rest-skeleton-times-inverse-bind-preserves-surface',()=>assert.ok(maxRestBindIdentityError<1e-4));
check('raw-source-binary-prefix-preserved',()=>assert.deepEqual(animated.bin.subarray(0,base.json.buffers[0].byteLength),base.bin.subarray(0,base.json.buffers[0].byteLength)));
check('original-mesh-primitives-and-index-accessor-preserved',()=>assert.deepEqual(animated.json.meshes,base.json.meshes));
for(const semantic of Object.keys(attrs))check(`original-${semantic}-accessor-bytes-preserved`,()=>{for(const p of animated.json.meshes[0].primitives)assert.deepEqual(accessorBytes(animated,p.attributes[semantic]),accessorBytes(base,attrs[semantic]));});
check('original-4k-jpeg-bytes-preserved',()=>assert.deepEqual(imageBytes(animated),imageBytes(earliest)));
check('original-triangle-multiset-and-winding-preserved',()=>{const triangles=[];for(const p of animated.json.meshes[0].primitives)for(let i=0;i<animated.json.accessors[p.indices].count;i+=3)triangles.push([0,1,2].map(c=>readValue(animated,p.indices,i+c)).join(','));assert.deepEqual(triangles.sort(),sourceTriangles.sort());});
for(const field of ['nodes','skins','textures','images','samplers','scenes'])check(`approved-source-${field}-preserved`,()=>assert.deepEqual(animated.json[field],base.json[field]));
for(const field of ['nodes','meshes','skins','materials','textures','images','samplers','scenes'])check(`animated-vs-static-${field}-identical`,()=>assert.deepEqual(animated.json[field],staticParsed.json[field]));
check('no-new-morph-targets-or-face-joints',()=>{assert.ok(animated.json.meshes.every(m=>m.primitives.every(p=>!p.targets?.length)));assert.ok(!bones.some(n=>/jaw|lip|mouth|eye/i.test(n.getName())));});
const clips=animatedDoc.getRoot().listAnimations().map((a,i)=>{const p=provenance[i],srcDoc=sourceDocs[sources.findIndex(s=>s.path===p.source)],expected=srcDoc.getRoot().listAnimations()[p.sourceIndex];
  check(`clip-${a.getName()}-samples-and-targets-identical`,()=>{assert.equal(a.listChannels().length,expected.listChannels().length);a.listChannels().forEach((ch,j)=>{const target=expected.listChannels()[j];assert.equal(ch.getTargetPath(),target.getTargetPath());assert.equal(ch.getTargetNode().getName(),target.getTargetNode().getName());for(const field of ['getInput','getOutput'])assert.deepEqual(ch.getSampler()[field]().getArray(),target.getSampler()[field]().getArray());});});
  return {...p,channels:a.listChannels().length,duration:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray())))};
});
for(const s of sources){const current=await readFile(new URL(s.path,root));check(`source-unchanged-${s.path}`,()=>assert.equal(sha(current),s.sha256));}
const earliestNow=await readFile(new URL('../human character 3d model.glb',root));check('earliest-static-source-unchanged',()=>assert.equal(sha(earliestNow),sha(earliestBytes)));
const metadata={version:1,source:base.path,sourceSHA256:base.sha256,sourceBytes:base.bytes.length,earliestSource:'../human character 3d model.glb',earliestSourceSHA256:sha(earliestBytes),baseline:staticPath,output:animatedPath,baselineSHA256:sha(staticBytes),outputSHA256:sha(animatedBytes),bytes:{static:staticBytes.length,animated:animatedBytes.length},
  preservation:{positions:true,normals:true,uvs:true,skinAttributes:true,originalTriangleWindingAndMultiset:true,jpegBytes:true,imageResolution:[4096,4096],newSubdivision:false,newDecimation:false,newQuantization:false,imageReencoding:false,syntheticFacialControls:false},
  topology:{sourceVertices:base.json.accessors[attrs.POSITION].count,triangles:sourceTriangles.length,originalIndexAccessorPreserved:true},
  materials:{cloth:'Original',remainder:'Original',pbrSource:'../human character 3d model.glb',roughness:originalMaterial.pbrMetallicRoughness.roughnessFactor,clothBaseColorTexturePreserved:true,clothLinearLuminance:{p10:quantile(.1),median:quantile(.5),p90:quantile(.9)},mask:{path:maskPath,bytes:maskBytes.length,sha256:sha(maskBytes),resolution:[maskSize,maskSize],clothCandidateTriangles,maskPixels,skinPixelsProtected},classification:'Single original primitive/material. Original UVs rasterized at 4096px with per-texel body-region and original-colour skin exclusion; no whole-triangle colour boundaries and no new vertices or UVs.'},
  skeleton:{joints:bones.length,restSource:base.path,maxRestDeltaBetweenApprovedClips:maxRestDelta,maxRestBindIdentityError,earliestStaticExportIssue:'Earliest static export contains no node TRS/matrix and its raw inverse-bind accessor contains invalid very large values. Use the supplied valid animated Tripo export as the geometry and rig baseline; no rig values are invented.',earliestExportEvidence:{nodesWithTransforms:earliest.json.nodes.filter(n=>n.matrix||n.translation||n.rotation||n.scale).length,firstRawInverseBindMatrix:Array.from({length:16},(_,i)=>readValue(earliest,earliest.json.skins[0].inverseBindMatrices,0,i))}},
  sources:sources.map(s=>({path:s.path,sha256:s.sha256,bytes:s.bytes.length})),clips,validation:{passed:checks.length,checks}};
const metadataBytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
if(checkOnly){assert.deepEqual(await readFile(new URL(staticPath,root)),staticBytes);assert.deepEqual(await readFile(new URL(animatedPath,root)),animatedBytes);assert.deepEqual(await readFile(new URL(maskPath,root)),maskBytes);assert.deepEqual(await readFile(new URL('public/models/person-original-info.json',root)),metadataBytes);}else{
  await writeFile(new URL(staticPath,root),staticBytes);await writeFile(new URL(animatedPath,root),animatedBytes);await writeFile(new URL(maskPath,root),maskBytes);await writeFile(new URL('public/models/person-original-info.json',root),metadataBytes);
  await mkdir(new URL('qa/tripo/',root),{recursive:true});await writeFile(new URL('qa/tripo/original-assets.json',root),metadataBytes);
}
console.log(JSON.stringify({checkOnly,output:animatedPath,bytes:metadata.bytes,topology:metadata.topology,materials:metadata.materials,checks:checks.length,clips:clips.map(c=>({name:c.name,duration:c.duration}))},null,2));
