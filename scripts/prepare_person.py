"""Create web assets from the supplied person.blend, without saving the source.

Run with Blender 5.1 --background --python scripts/prepare_person.py.
"""
from pathlib import Path
import bpy, json, math, sys, numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent/'person.blend'))
scene=bpy.context.scene
mesh=next(o for o in bpy.data.objects if o.type=='MESH')
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh.name='Person'
rig.name='PersonRig'
texture=next(i for i in bpy.data.images if i.size[0]==4096)
pixels=np.empty(len(texture.pixels),dtype=np.float32)
texture.pixels.foreach_get(pixels)
pixels=pixels.reshape((texture.size[1],texture.size[0],4))
uv=mesh.data.uv_layers.active.data

def sampled(poly):
    coords=[uv[i].uv for i in poly.loop_indices]
    coords.append(sum((v.copy() for v in coords),Vector((0,0)))/len(coords))
    cols=[pixels[min(int(v.y*4096),4095),min(int(v.x*4096),4095),:3] for v in coords]
    return np.median(cols,axis=0)

def material(name,roughness, color=None, texture_on=True, sheen=0):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Metallic'].default_value=0
    p.inputs['Sheen Weight'].default_value=sheen
    if color: p.inputs['Base Color'].default_value=(*color,1)
    if texture_on:
        n=m.node_tree.nodes.new('ShaderNodeTexImage'); n.image=texture
        m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
    return m

materials=[material('Hoodie',.92,(.0103,.0103,.0123),False,.65),material('Skin',.59),material('Hair',.46),material('Trousers',.88),material('Sneakers',.55)]
mesh.data.materials.clear()
for m in materials: mesh.data.materials.append(m)
counts={m.name:0 for m in materials}
hood_top=[]
head_group=mesh.vertex_groups.get('mixamorig:Head').index
for poly in mesh.data.polygons:
    x,y,z=poly.center
    r,g,b=sampled(poly)
    skin=(r>g*1.12 and r>b*1.3 and r>.15)
    head_weight=sum(g.weight for vi in poly.vertices for g in mesh.data.vertices[vi].groups if g.group==head_group)/len(poly.vertices)
    # The source is a unified Tripo surface. Assign actual polygons, never a UV mask.
    if z<.115: index=4
    elif skin and z>.43: index=1
    elif z>.855 or (z>.795 and head_weight>.48) or (z>.825 and abs(x)<.052 and y<.065): index=2
    elif z>.471 or (z>.465 and abs(x)>.105): index=0
    else: index=3
    poly.material_index=index
    poly.use_smooth=True
    counts[materials[index].name]+=1
    if index==0 and z>.795:hood_top.append({'id':poly.index,'center':list(poly.center),'headWeight':head_weight,'rgb':[float(r),float(g),float(b)]})
(ROOT/'qa'/'hood-top-report.json').write_text(json.dumps(hood_top,indent=2),encoding='utf-8')

# Apply subdivision before the armature so that skinning and live pose controls survive.
bpy.context.view_layer.objects.active=mesh
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True)
sub=mesh.modifiers.new('Web silhouette subdivision','SUBSURF'); sub.levels=1; sub.render_levels=1
bpy.ops.object.modifier_move_up(modifier=sub.name)
bpy.ops.object.modifier_apply(modifier=sub.name)

# Scale at the rig root, including mesh children; feet remain at the origin.
rig.scale=(1.830894,)*3
bpy.context.view_layer.update()

texture.scale(2048,2048)
texture.file_format='JPEG'
texture.filepath_raw=str(ROOT/'qa'/'person-albedo.jpg')
texture.save()
web_texture=bpy.data.images.load(texture.filepath_raw,check_existing=False)
for m in materials:
    for n in m.node_tree.nodes:
        if n.type=='TEX_IMAGE':n.image=web_texture
web_texture.pack()

for o in bpy.context.selected_objects:o.select_set(False)
rig.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active=rig
if '--render-only' not in sys.argv:
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public'/'models'/'person.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_yup=True,export_image_format='JPEG',export_jpeg_quality=90,export_apply=False)

coords=[mesh.matrix_world @ v.co for v in mesh.data.vertices]
info={'source':'person.blend','sourceModified':False,'heightMeters':max(v.z for v in coords)-min(v.z for v in coords),'forward':'+Z','up':'+Y','materials':counts,'vertexCount':len(mesh.data.vertices),'polygonCount':len(mesh.data.polygons),'animationClips':[], 'notes':['One subdivision level applied before skinning.','Hoodie is an independent polygon material with a pure base color.','Skin, hair, trousers and sneakers retain the original albedo.','No new blink, smile, fingers or independent eyeballs are claimed.'], 'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'restMatrix':[list(r) for r in b.matrix_local]} for b in rig.data.bones]}
(ROOT/'public'/'models'/'model-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
print('EXPORT_METADATA',json.dumps({k:v for k,v in info.items() if k!='bones'}))
if '--export-only' in sys.argv:sys.exit(0)

# A matching transparent studio image is useful before WebGL is ready and as fallback.
for o in list(bpy.data.objects):
    if o.type in {'LIGHT','CAMERA'}:bpy.data.objects.remove(o,do_unlink=True)
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.world.color=(.25,.25,.25)
scene.view_settings.view_transform='Khronos PBR Neutral'

def area(name,loc,power,size,target=(0,0,1)):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Large key',(-3,-4,5),500,4)
area('Soft fill',(4,-2,3),180,5)
area('Right rim',(3,3,4),350,3)
area('Left rim',(-3,2,3),240,2)
area('Top',(0,0,6),180,3)
camera=bpy.data.cameras.new('Poster camera'); cam=bpy.data.objects.new('Poster camera',camera);scene.collection.objects.link(cam);scene.camera=cam

def to_linear(c): return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def hex_color(value):return tuple(to_linear(int(value[i:i+2],16)/255) for i in (1,3,5))

views=[('angle-01',0,.95,2.5,.5,27,'#F04A15'),('angle-02',65,.22,2.0,.58,37.8,'#1D52DE'),('angle-03',160,2.5,4.9,.5,19.5,'#15A669'),('angle-04',295,.82,2.8,.66,16.1,'#D62A9F')]
if '--preview' in sys.argv:views=views[:1];scene.render.resolution_x=600;scene.render.resolution_y=750;scene.cycles.samples=12
for name,phi,camY,dist,lookY,vfov,color in views:
    a=math.radians(phi); H=1.83
    cam.location=(math.sin(a)*dist*H,-math.cos(a)*dist*H,camY*H)
    target=Vector((0,0,lookY*H));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    camera.sensor_fit='VERTICAL';camera.angle_y=math.radians(vfov)
    materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*hex_color(color),1)
    scene.render.filepath=str(ROOT/'public'/'images'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
print('ASSETS_COMPLETE')
