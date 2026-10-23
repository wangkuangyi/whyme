"""Edit and bake five coordinated Actions in Blender; never re-export the mesh.

Run D:/APP/blender/blender.exe --background --python scripts/blender_edit_motion.py.
The editable .blend goes to animation/; temporary sample data goes to output/.
"""
from pathlib import Path
import sys, json, math, struct, hashlib
import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from blender_motion_helpers import solve_arm_to_target
OUT = ROOT / 'output/blender-motion'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'public/models/person-original-animated.glb'
FPS, IDLE_SECONDS = 60, 4.8
DURATIONS = {'Idle': 4.8, 'Walk': 4.4, 'Nod': 4.15, 'Wave': 5.2, 'LookAround': 6.8}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE), import_pack_images=True)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in scene.objects if o.type == 'MESH')
source_actions = {name: bpy.data.actions[name] for name in DURATIONS}
for track in arm.animation_data.nla_tracks:
    track.mute = True
bones = {b.name.replace('mixamorig:', ''): b for b in arm.pose.bones}
names = list(bones)
IDENTITY = Quaternion((1, 0, 0, 0))

def update():
    bpy.context.view_layer.update()

def snapshot():
    return {name: (b.location.copy(), b.rotation_quaternion.copy(), b.scale.copy()) for name, b in bones.items()}

def apply(pose):
    for name, (p, q, s) in pose.items():
        b = bones[name]
        b.rotation_mode = 'QUATERNION'
        b.location = p
        b.rotation_quaternion = q
        b.scale = s
    update()

def source_pose(name, time):
    action = source_actions[name]
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]
    frame = time * 24
    scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
    update()
    return snapshot()

def mix(a, b, t):
    return {n: (a[n][0].lerp(b[n][0], t), a[n][1].slerp(b[n][1], t), a[n][2].lerp(b[n][2], t)) for n in names}

def average(poses):
    mean = poses[0]
    for i, pose in enumerate(poses[1:], 2):
        mean = mix(mean, pose, 1 / i)
    return mean

def smooth(t):
    t = max(0, min(1, t))
    return t * t * t * (t * (t * 6 - 15) + 10)

# The first half of the supplied Idle contains a step. Only its stable,
# genuinely animated last 1.75 s is reused for the independent idle Action.
neutral_ranges = {'Idle': [(3.25, 5)], 'Walk': [(0, 2.375)],
                  'Nod': [(0, 1 / 24)], 'Wave': [(.25, .8)],
                  'LookAround': [(0, .125), (15.375, 15.625)]}
neutral = {}
for name, ranges in neutral_ranges.items():
    samples = []
    for start, end in ranges:
        count = max(1, math.ceil((end - start) * 24))
        samples += [source_pose(name, start + (end - start) * i / count) for i in range(count + 1)]
    neutral[name] = average(samples)

# A relaxed shared base, between the real idle pose and the bind pose. Unlike
# the withdrawn runtime solution, this does not lock the spine to vertical.
common = {}
for n, (p, q, s) in neutral['Idle'].items():
    common[n] = (Vector((0, 0, 0)), q.slerp(IDENTITY, .68), Vector((1, 1, 1)))
lower = {n for n in names if any(key in n for key in ['UpLeg', 'Leg', 'Foot', 'Toe'])}
for n in lower | {'Hips'}:
    common[n] = (Vector((0, 0, 0)), IDENTITY.copy(), Vector((1, 1, 1)))

def motion_delta(name, source, gain=1):
    out = {}
    for n in names:
        p, q, s = source[n]
        np, nq, ns = neutral[name][n]
        cp, cq, cs = common[n]
        delta = nq.inverted() @ q
        if delta.w < 0:
            delta.negate()
        axis, angle = delta.to_axis_angle()
        out[n] = (cp + (p - np) * gain, cq @ Quaternion(axis, angle * gain), cs.copy())
    return out

# Cache all sampling before creating new actions. Pose-bone matrix_basis is the
# Blender rig's native animation space; these become editable keyed Actions.
idle_poses = []
for i in range(round(IDLE_SECONDS * FPS) + 1):
    t = i / FPS
    # Cosine retiming gives zero velocity at both ends of the source excursion.
    source_t = 3.25 + 1.75 * (.5 - .5 * math.cos(2 * math.pi * t / IDLE_SECONDS))
    pose = motion_delta('Idle', source_pose('Idle', source_t), 1.4)
    for n in lower | {'Hips'}:
        pose[n] = common[n]
    idle_poses.append(pose)

def idle_at(t):
    index = (t % IDLE_SECONDS) * FPS
    a = int(index)
    return mix(idle_poses[a], idle_poses[min(a + 1, len(idle_poses) - 1)], index - a)

poses_by_action = {'Idle': idle_poses}
for name in ['Walk', 'Nod', 'Wave', 'LookAround']:
    duration = DURATIONS[name]
    poses = []
    for i in range(round(duration * FPS) + 1):
        t = i / FPS
        if name == 'Walk':
            source_t = max(0, t - .2) % 2.375
        elif name == 'Wave':
            source_t = .25 + min(4.5, max(0, t - .3))
        elif name == 'LookAround':
            source_t = 1.2 + min(6.2, max(0, t - .2))
        else:
            active_t = max(0, t - .25)
            u = min(1, active_t / .75)
            # Start the original hand lift at zero velocity, reach original
            # speed after .4 source seconds, then preserve the main gesture.
            source_t = .4 * (1.125 * u * u - .125 * u * u * u) if active_t < .75 else min(3, .4 + active_t - .75)
        raw = source_pose(name, source_t)
        pose = motion_delta(name, raw)
        idle = idle_at(t)
        # Body motion remains animated, with its fixed source slouch removed.
        for n in ['Spine', 'Spine1', 'Spine2']:
            p, q, s = pose[n]
            pose[n] = (p, common[n][1].slerp(q, .65), s)
        if name == 'Walk':
            for n in lower | {'Hips'}:
                pose[n] = raw[n]
        else:
            for n in lower | {'Hips'}:
                pose[n] = idle[n]
        inactive = ['Right'] if name == 'Wave' else ['Left'] if name == 'Nod' else ['Left', 'Right'] if name == 'LookAround' else []
        for n in names:
            if any(n.startswith(side) and any(key in n for key in ['Shoulder', 'Arm', 'Hand']) for side in inactive):
                pose[n] = idle[n]
        entry = smooth(t / .5)
        exit_weight = 1 - smooth((t - (duration - .85)) / .85)
        poses.append(mix(idle, pose, entry * exit_weight))
    poses_by_action[name] = poses

arm.animation_data.action = None
for b in bones.values():
    b.matrix_basis.identity()
update()
rest_world = {b.name: arm.matrix_world @ b.bone.matrix_local for b in bones.values()}

# Original glTF node matrices are retained; Blender's rest-bone orientation is
# converted back analytically instead of re-exporting mesh/bind/UV data.
raw = SOURCE.read_bytes()
gltf = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
parents = {child: i for i, node in enumerate(gltf['nodes']) for child in node.get('children', [])}
node_by_name = {node['name']: i for i, node in enumerate(gltf['nodes']) if 'name' in node}
def node_matrix(n):
    if 'matrix' in n:
        return Matrix([n['matrix'][i::4] for i in range(4)])
    q = n.get('rotation', [0, 0, 0, 1])
    return Matrix.LocRotScale(Vector(n.get('translation', [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(n.get('scale', [1, 1, 1])))
rest_global = {}
def global_rest(i):
    if i not in rest_global:
        local = node_matrix(gltf['nodes'][i])
        rest_global[i] = global_rest(parents[i]) @ local if i in parents else local
    return rest_global[i]
for i in range(len(gltf['nodes'])):
    global_rest(i)
g2b = Matrix.Rotation(math.pi / 2, 4, 'X')
b2g = g2b.inverted()
scene.render.fps = FPS
scene.render.fps_base = 1
exports, summaries = [], []
for name, poses in poses_by_action.items():
    action = bpy.data.actions.new('Edited_' + name)
    action.use_fake_user = True
    arm.animation_data.action = action
    frames = []
    for i, pose in enumerate(poses):
        frame = i + 1
        scene.frame_set(frame)
        apply(pose)
        if name in ['Walk', 'LookAround']:
            t = i / FPS
            envelope = smooth(t / .5) * (1 - smooth((t - (DURATIONS[name] - .85)) / .85))
            # Preserve the arm's swing and hand orientation while giving the
            # non-gesturing hand clearance from the waist, measured in QA.
            wrist = arm.matrix_world @ bones['RightHand'].matrix
            source_units_per_metre = .9995117486 / 1.83
            offset = (.04 if name == 'Walk' else .015) * source_units_per_metre * envelope
            target = wrist.translation.copy() + Vector((-offset, 0, 0))
            solve_arm_to_target(arm, 'Right', target)
            update()
            if name == 'Walk':
                left_wrist = arm.matrix_world @ bones['LeftHand'].matrix
                left_target = left_wrist.translation.copy() + Vector((.01 * source_units_per_metre * envelope, 0, 0))
                solve_arm_to_target(arm, 'Left', left_target)
                update()
        # The inactive hand in Wave now follows the same comfortable stance as
        # Idle rather than the source's tucked-in, body-intersecting right arm.
        for n, b in bones.items():
            b.keyframe_insert('location', frame=frame, group=b.name)
            b.keyframe_insert('rotation_quaternion', frame=frame, group=b.name)
            b.keyframe_insert('scale', frame=frame, group=b.name)
        worlds = {}
        for b in bones.values():
            index = node_by_name[b.name]
            worlds[index] = b2g @ (arm.matrix_world @ b.matrix) @ rest_world[b.name].inverted() @ g2b @ rest_global[index]
        channels = {}
        for b in bones.values():
            index = node_by_name[b.name]
            parent = parents.get(index)
            world = worlds[index]
            local = worlds.get(parent, rest_global.get(parent)).inverted() @ world if parent is not None else world
            p, q, s = local.decompose()
            # Bone lengths and scale are original. The only translation channel
            # permitted to move is Hips; all others retain their exact rest TRS.
            p = p if b.name.endswith('Hips') else Vector(gltf['nodes'][index].get('translation', [0, 0, 0]))
            channels[b.name] = {'translation': list(p), 'rotation': [q.x, q.y, q.z, q.w], 'scale': gltf['nodes'][index].get('scale', [1, 1, 1])}
        frames.append(channels)
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        key.interpolation = 'LINEAR'
    exports.append({'name': name, 'duration': DURATIONS[name], 'fps': FPS, 'frames': frames})
    summaries.append({'name': name, 'blenderAction': action.name, 'frames': len(frames), 'duration': DURATIONS[name]})
    print('BAKED', name, len(frames), flush=True)

scene.frame_start = 1
scene.frame_end = len(idle_poses)
arm.animation_data.action = bpy.data.actions['Edited_Idle']
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
scene.frame_set(1)
EDITABLE = ROOT / 'animation/character-actions.blend'
EDITABLE.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(EDITABLE))
(OUT / 'authored-animations.json').write_text(json.dumps({'sourceSHA256': hashlib.sha256(raw).hexdigest(), 'blender': bpy.app.version_string, 'actions': exports}), encoding='utf8')
(OUT / 'editing-summary.json').write_text(json.dumps({'blender': bpy.app.version_string, 'actions': summaries, 'sourceSHA256': hashlib.sha256(raw).hexdigest(), 'originalMeshUnchanged': True, 'neutralRanges': neutral_ranges}, indent=2), encoding='utf8')
print('SAVED', EDITABLE, flush=True)
