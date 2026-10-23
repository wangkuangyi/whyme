"""Small FK-baking helpers for the original Tripo rig in Blender 5.1.

These functions edit the current pose only. They neither add constraints nor
insert keys, write a file, change a rest bone, or modify mesh data.
"""

import math
import re

import bpy
from mathutils import Matrix, Quaternion, Vector


def _pose_bone(armature, name):
    if not isinstance(name, str):
        return name
    direct = armature.pose.bones.get(name)
    if direct:
        return direct
    matches = [bone for bone in armature.pose.bones
               if re.sub(r"^mixamorig[:_]?", "", bone.name,
                         flags=re.IGNORECASE) == name]
    if len(matches) != 1:
        raise ValueError(f"Expected one {name} bone; found {len(matches)}")
    return matches[0]


def _world_matrix(armature, bone):
    return armature.matrix_world @ bone.matrix


def _set_world_rotation(armature, bone, rotation):
    """Set world orientation while keeping the current position/local scale."""
    world = _world_matrix(armature, bone)
    translation, _, world_scale = world.decompose()
    local_scale = bone.scale.copy()
    bone.matrix = armature.matrix_world.inverted() @ Matrix.LocRotScale(
        translation, rotation.normalized(), world_scale)
    bone.scale = local_scale
    bpy.context.view_layer.update()


def world_rotate_pose_bone(armature, bone, rotation):
    """Apply a world-space Quaternion increment, preserving local bone scale.

    ``bone`` can be a PoseBone or its exact/short Mixamo name. The caller owns
    animation sampling and key insertion. Children follow normal FK.
    """
    bone = _pose_bone(armature, bone)
    rotation = Quaternion(rotation)
    if not all(math.isfinite(value) for value in rotation):
        raise ValueError("World rotation must be finite")
    if rotation.magnitude < 1e-12:
        raise ValueError("World rotation must be a nonzero quaternion")
    before = _world_matrix(armature, bone).to_quaternion().normalized()
    _set_world_rotation(armature, bone, rotation.normalized() @ before)
    return bone


def solve_arm_to_target(armature, side, target_world, pole_world=None):
    """Analytically solve Arm -> ForeArm -> Hand and bake the current FK pose.

    A supplied pole is a world-space point defining the elbow's bend plane.
    Without one, the current elbow side is retained; a straight arm uses its
    current local X direction as a deterministic fallback. Unreachable targets
    are clamped to the actual chain reach, without stretching any bone. The
    hand's world orientation, all three local scales, and all finger locals are
    preserved. Returns both requested and clamped-target errors so a caller
    cannot mistake an unreachable target for a successful exact placement.
    """
    side = str(side).capitalize()
    if side not in {"Left", "Right"}:
        raise ValueError("side must be Left or Right")
    upper = _pose_bone(armature, side + "Arm")
    fore = _pose_bone(armature, side + "ForeArm")
    hand = _pose_bone(armature, side + "Hand")
    if fore.parent != upper or hand.parent != fore:
        raise ValueError("Expected the direct Arm -> ForeArm -> Hand chain")
    bpy.context.view_layer.update()
    target = Vector(target_world)
    pole = Vector(pole_world) if pole_world is not None else None
    if not all(math.isfinite(x) for x in target):
        raise ValueError("Arm target must be finite")
    if pole is not None and not all(math.isfinite(x) for x in pole):
        raise ValueError("Arm pole must be finite")
    shoulder = _world_matrix(armature, upper).translation.copy()
    elbow = _world_matrix(armature, fore).translation.copy()
    wrist = _world_matrix(armature, hand).translation.copy()
    hand_rotation = _world_matrix(armature, hand).to_quaternion().normalized()
    lengths = ((elbow - shoulder).length, (wrist - elbow).length)
    first, second = lengths
    if min(lengths) < 1e-8:
        raise ValueError("Arm segments must have positive length")
    direction = target - shoulder
    requested_distance = direction.length
    if requested_distance < 1e-10:
        direction = wrist - shoulder
    if direction.length < 1e-10:
        direction = _world_matrix(armature, upper).to_quaternion() @ Vector((0, 1, 0))
    direction.normalize()
    epsilon = max(1e-8, (first + second) * 1e-6)
    distance = min(first + second - epsilon,
                   max(abs(first - second) + epsilon, requested_distance))
    solved_target = shoulder + direction * distance
    bend = (pole - shoulder) if pole is not None else (elbow - shoulder)
    bend -= direction * bend.dot(direction)
    if bend.length < epsilon:
        bend = _world_matrix(armature, upper).to_quaternion() @ Vector((1, 0, 0))
        bend -= direction * bend.dot(direction)
    if bend.length < epsilon:
        candidate = Vector((0, 0, 1)) if abs(direction.z) < .9 else Vector((1, 0, 0))
        bend = candidate - direction * candidate.dot(direction)
    bend.normalize()
    along = (first * first - second * second + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, first * first - along * along))
    solved_elbow = shoulder + direction * along + bend * height
    scales = {bone.name: bone.scale.copy() for bone in (upper, fore, hand)}
    world_rotate_pose_bone(armature, upper,
                          (elbow - shoulder).rotation_difference(solved_elbow - shoulder))
    current_elbow = _world_matrix(armature, fore).translation.copy()
    current_wrist = _world_matrix(armature, hand).translation.copy()
    world_rotate_pose_bone(armature, fore,
                          (current_wrist - current_elbow).rotation_difference(solved_target - current_elbow))
    _set_world_rotation(armature, hand, hand_rotation)
    final_elbow = _world_matrix(armature, fore).translation.copy()
    final_wrist = _world_matrix(armature, hand).translation.copy()
    final_rotation = _world_matrix(armature, hand).to_quaternion().normalized()
    scale_error = max((bone.scale - scales[bone.name]).length for bone in (upper, fore, hand))
    return {
        "side": side,
        "target_world": list(target),
        "solved_target_world": list(solved_target),
        "wrist_world": list(final_wrist),
        "elbow_world": list(final_elbow),
        "requested_error": (final_wrist - target).length,
        "reachable_error": (final_wrist - solved_target).length,
        "elbow_error": (final_elbow - solved_elbow).length,
        "clamped": abs(distance - requested_distance) > epsilon * .5,
        "chain_lengths": list(lengths),
        "hand_direction_error_radians": hand_rotation.rotation_difference(final_rotation).angle,
        "local_scale_error": scale_error,
    }
