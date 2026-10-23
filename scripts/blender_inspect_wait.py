"""Read-only Blender source inspection and textured pose contact frames.

Run blender --background --python scripts/blender_inspect_wait.py -- raw|edited.
Images are diagnostic, not a replacement for the final browser camera review.
"""
from pathlib import Path
import sys, json, math, hashlib
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
mode = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'raw'
OUT = ROOT / 'output/waiting' / mode
OUT.mkdir(parents=True, exist_ok=True)
if mode == 'raw':
    source = ROOT / '动作素材/human+character+3d+model+dengdai.glb'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    action_name, fps, times = 'wait.001', 24, [0, 1.5, 3, 4.5, 6.041666666666667]
else:
    source = ROOT / 'animation/character-actions.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    action_name, fps, times = 'Edited_Wait', 60, [0, .4, .7, 1, 3.7, 6.5, 7.3, 7.6, 8]

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
for track in arm.animation_data.nla_tracks:
    track.mute = True
action = bpy.data.actions[action_name]
arm.animation_data.action = action
arm.animation_data.action_slot = action.slots[0]
mesh = next(o for o in scene.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
# Emission reproduces the baked source texture without a second light/shadow pass.
for material in mesh.data.materials:
    nodes = material.node_tree.nodes
    texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    emission = nodes.new('ShaderNodeEmission')
    material.node_tree.links.new(texture.outputs['Color'], emission.inputs['Color'])
    material.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 600, 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('QA white')
scene.world.use_nodes = True
background = next((n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND'), None) or scene.world.node_tree.nodes.new('ShaderNodeBackground')
world_output = next((n for n in scene.world.node_tree.nodes if n.type == 'OUTPUT_WORLD'), None) or scene.world.node_tree.nodes.new('ShaderNodeOutputWorld')
background.inputs[0].default_value = (.92, .92, .92, 1)
scene.world.node_tree.links.new(background.outputs[0], world_output.inputs['Surface'])
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure, scene.view_settings.gamma = 0, 1
camera_data = bpy.data.cameras.new('QA camera')
camera = bpy.data.objects.new('QA camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 1.20
# In Blender X+ is the character's anatomical left, -Y is forward, Z is up.
target = Vector((0, 0, .5))
camera.location = (1.05, -2.25, 1.0)
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
samples = []
for time in times:
    frame = time * fps + (1 if mode == 'edited' else 0)
    scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
    bpy.context.view_layer.update()
    samples.append({'time': time, 'landmarks': {n: list((arm.matrix_world @ arm.pose.bones['mixamorig:' + n].matrix).translation) for n in ['Hips','Spine2','Head','LeftHand','RightHand','LeftFoot','RightFoot']}})
    scene.render.filepath = str(OUT / f'{time:05.2f}.png')
    bpy.ops.render.render(write_still=True)
report = {'source': str(source.relative_to(ROOT)), 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'action': action_name, 'fps': fps, 'samples': samples}
(OUT / 'samples.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print('WAIT_INSPECTION', json.dumps(report), flush=True)
