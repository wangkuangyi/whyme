from pathlib import Path
import bpy, json, math, hashlib, struct
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'animation/character-actions.blend'
OUT = ROOT / 'qa/wide-shots/blender-source.json'
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
tracked = {'editableBlend': TARGET, 'originalPersonBlend': ROOT.parent / 'person.blend', 'originalGLB': ROOT / 'public/models/person-original-animated.glb', 'authoredGLB': ROOT / 'public/models/person-authored-animated.glb'}
before = {name: sha(path) for name, path in tracked.items()}
bpy.ops.wm.open_mainfile(filepath=str(TARGET), load_ui=False, use_scripts=False)
checks = []
def check(name, value, detail=None):
    checks.append({'name': name, 'passed': bool(value), **({'detail': detail} if detail is not None else {})})
fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
check('Blender-source-is-baked-at-60-fps', abs(fps - 60) < 1e-8, fps)
armatures = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
check('one-real-armature-with-65-bones', len(armatures) == 1 and len(armatures[0].data.bones) == 65)
expected = {'Idle': (289, 4.8), 'Walk': (265, 4.4), 'Nod': (250, 4.15), 'Wave': (313, 5.2), 'Wait': (421, 7.0)}
actions = []
for name, (frames, seconds) in expected.items():
    action = bpy.data.actions.get('Edited_' + name)
    check(name + '-edited-action-exists', action is not None)
    if action is None:
        continue
    curves = [curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
    curves_with_motion = []
    paths = set()
    key_counts = []
    interpolation = set()
    max_abs_value = 0
    all_finite = True
    keys_at_every_frame = True
    for curve in curves:
        paths.add(curve.data_path)
        points = list(curve.keyframe_points)
        key_counts.append(len(points))
        values = [float(point.co.y) for point in points]
        times = [float(point.co.x) for point in points]
        interpolation.update(point.interpolation for point in points)
        all_finite = all_finite and all(math.isfinite(value) for value in values + times)
        keys_at_every_frame = keys_at_every_frame and len(points) == frames and all(abs(t - (i + 1)) < 1e-5 for i, t in enumerate(times))
        if values:
            max_abs_value = max(max_abs_value, max(abs(value) for value in values))
            if max(values) - min(values) > 1e-5:
                curves_with_motion.append({'path': curve.data_path, 'component': curve.array_index, 'minimum': min(values), 'maximum': max(values)})
    frame_range = list(action.frame_range)
    duration = (frame_range[1] - frame_range[0]) / fps
    check(name + '-duration-and-frame-range-match-authored-action', abs(duration - seconds) < 1e-6 and frame_range == [1.0, float(frames)], {'frameRange': frame_range, 'duration': duration})
    check(name + '-has-all-650-real-bone-TRS-fcurves', len(curves) == 650 and len(paths) == 195, {'fcurves': len(curves), 'paths': len(paths)})
    check(name + '-has-dense-finite-linear-keyframes', keys_at_every_frame and all_finite and interpolation == {'LINEAR'})
    check(name + '-contains-real-nonconstant-animation', len(curves_with_motion) > 20, len(curves_with_motion))
    actions.append({'name': action.name, 'frameRange': frame_range, 'durationSeconds': duration, 'curveCount': len(curves), 'keyframeCount': sum(key_counts), 'keysPerCurve': [min(key_counts), max(key_counts)], 'interpolations': sorted(interpolation), 'nonconstantCurveCount': len(curves_with_motion), 'maximumAbsoluteKeyValue': max_abs_value, 'animatedCurveExamples': curves_with_motion[:12]})
source = (ROOT / 'public/models/person-original-animated.glb').read_bytes()
length = struct.unpack_from('<I', source, 12)[0]
gltf = json.loads(source[20:20+length]); binary = source[28+length:]
source_image_hashes = []
for image in gltf['images']:
    view = gltf['bufferViews'][image['bufferView']]; start = view.get('byteOffset', 0)
    source_image_hashes.append(hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest())
images = []
for image in bpy.data.images:
    if image.type == 'RENDER_RESULT':
        continue
    packed = image.packed_file
    image_hash = hashlib.sha256(bytes(packed.data)).hexdigest() if packed else None
    images.append({'name': image.name, 'size': list(image.size), 'packed': packed is not None, 'packedBytes': packed.size if packed else 0, 'packedSHA256': image_hash})
check('original-4096px-texture-is-packed-with-identical-JPEG-bytes', bool(images) and all(image['size'] == [4096, 4096] and image['packedSHA256'] in source_image_hashes for image in images), images)
meshes = [{'name': obj.name, 'vertices': len(obj.data.vertices), 'polygons': len(obj.data.polygons), 'triangles': sum(len(poly.vertices) - 2 for poly in obj.data.polygons), 'uvLayers': len(obj.data.uv_layers), 'armatureModifiers': [m.object.name if m.object else None for m in obj.modifiers if m.type == 'ARMATURE'], 'customShapeUsers': [b.name for armature in armatures for b in armature.pose.bones if b.custom_shape == obj]} for obj in bpy.data.objects if obj.type == 'MESH']
characters = [m for m in meshes if m['armatureModifiers']]
helpers = [m for m in meshes if not m['armatureModifiers']]
check('editable-character-has-original-topology-UVs-with-only-bone-shape-helpers', len(characters) == 1 and characters[0]['vertices'] == 11922 and characters[0]['triangles'] == 10892 and characters[0]['uvLayers'] >= 1 and all(m['customShapeUsers'] for m in helpers), meshes)
after = {name: sha(path) for name, path in tracked.items()}
check('read-only-Blender-inspection-did-not-modify-any-source-or-asset', before == after)
report = {'blenderVersion': bpy.app.version_string, 'method': 'Read-only Blender background open_mainfile with scripts disabled; inspected actual Action F-curves, dense keyframe values, packed image bytes and file hashes. No save operation performed.', 'source': 'animation/character-actions.blend', 'fps': fps, 'hashesBefore': before, 'hashesAfter': after, 'armatures': [{'name': obj.name, 'bones': len(obj.data.bones)} for obj in armatures], 'actions': actions, 'images': images, 'meshes': meshes, 'checks': checks, 'passed': sum(c['passed'] for c in checks), 'total': len(checks)}
OUT.write_text(json.dumps(report, indent=2), encoding='utf8')
print('BLENDER_SOURCE_QA', report['passed'], '/', report['total'], flush=True)
for result in checks:
    if not result['passed']:
        print('FAILED', result, flush=True)
if report['passed'] != report['total']:
    raise RuntimeError('Blender source inspection contains failed checks')
