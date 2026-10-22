from pathlib import Path
import bpy, json
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent / 'person.blend'))
result={'objects':[], 'images':[], 'materials':[]}
for o in bpy.data.objects:
    item={'name':o.name,'type':o.type,'location':list(o.location),'rotation':list(o.rotation_euler),'scale':list(o.scale),'matrix':[list(r) for r in o.matrix_world]}
    if o.type == 'MESH':
        coords=[o.matrix_world @ v.co for v in o.data.vertices]
        item.update({'bounds':[[min(v[i] for v in coords),max(v[i] for v in coords)] for i in range(3)],'vertices':len(o.data.vertices),'faces':len(o.data.polygons),'materials':[m.name for m in o.data.materials],'groups':[g.name for g in o.vertex_groups],'modifiers':[(m.name,m.type) for m in o.modifiers]})
    if o.type == 'ARMATURE':
        item['bones']=[{'name':b.name,'head':list(o.matrix_world @ b.head_local),'tail':list(o.matrix_world @ b.tail_local),'matrix':[list(r) for r in b.matrix_local]} for b in o.data.bones]
    result['objects'].append(item)
for m in bpy.data.materials:
    result['materials'].append({'name':m.name,'nodes':[{'name':n.name,'type':n.type,'image':getattr(n.image,'name',None) if n.type=='TEX_IMAGE' else None} for n in m.node_tree.nodes] if m.use_nodes else []})
for im in bpy.data.images:
    result['images'].append({'name':im.name,'size':list(im.size),'filepath':im.filepath,'packed':bool(im.packed_file)})
(ROOT/'qa'/'source-model-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
