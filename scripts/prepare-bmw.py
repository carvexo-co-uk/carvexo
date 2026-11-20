"""Prepare the attributed BMW GLB and matching browser fallback frames with Blender."""
import bpy
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from mathutils import Vector

arguments = sys.argv[sys.argv.index('--') + 1:]
source, destination = map(Path, arguments[:2])
showcase = '--showcase' in arguments[2:]
render_motion = showcase or '--motion' in arguments[2:]
destination.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
originals = list(bpy.context.scene.objects)
scale = .237


def convert(point):
    x, y, z = point
    return Vector(((y - .65) * scale, -(x + .674) * scale, z * scale))


def group(name, at=(0, 0, 0), parent=None):
    item = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(item)
    item.parent = parent
    item.location = at
    return item


vehicle = group('Vehicle')
pivots = {name: group(name, parent=vehicle) for name in (
    'Body', 'Chassis', 'Nose', 'Bonnet', 'Rear', 'Glass', 'DoorLeft', 'DoorRight',
    'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR',
)}
for name, position in {
    'DoorLeft': (2.87, -2.88, 2.7), 'DoorRight': (-4.22, -2.88, 2.7),
    'WheelFL': (2.59, -5.69, 1.57), 'WheelFR': (-3.94, -5.69, 1.57),
    'WheelRL': (2.70, 6.10, 1.54), 'WheelRR': (-4.05, 6.10, 1.54),
}.items():
    pivots[name].location = convert(position)


def material(name, colour, roughness, metal=0, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*colour, 1)
    node.inputs['Metallic'].default_value = metal
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Emission Color'].default_value = (*colour, 1)
    node.inputs['Emission Strength'].default_value = emission
    return mat


paint = material('Alloy_Paint', (.21, .255, .31), .25, .69)
glass = material('Smoked_Glass', (.021, .031, .046), .15, .41)
lamp = material('Headlamp_Emitter', (.71, .86, 1), .21, 0, 3.1)
dark = material('Interior trim', (.028, .031, .036), .45)
rubber = material('Tyre rubber', (.019, .024, .027), .65)
metal = material('Wheel alloy', (.16, .179, .205), .23, .77)


def components(mesh, points):
    parents = list(range(len(points)))
    seen = {}

    def root(vertex):
        while vertex != parents[vertex]:
            parents[vertex] = parents[parents[vertex]]
            vertex = parents[vertex]
        return vertex

    for index, point in enumerate(points):
        key = tuple(round(value, 3) for value in point)
        parents[index] = seen.setdefault(key, index)
    for edge in mesh.edges:
        start, end = edge.vertices
        parents[root(start)] = root(end)
    result = defaultdict(list)
    for face in mesh.polygons:
        result[root(face.vertices[0])].append(face)
    return result.values()


def classify(number, lo, hi, centre):
    x, y, _ = centre
    side = 'L' if x > -.674 else 'R'
    if number in (32, 33, 34):
        if number == 32:
            return 'Chassis', dark
        return 'Wheel' + ('F' if y < 0 else 'R') + side, rubber if number == 34 else metal
    if number == 27 or number == 22 and hi[1] < 0:
        return 'Nose', lamp
    lateral = lo[0] > 1.65 or hi[0] < -3.0
    if lateral and lo[1] >= -3.1 and hi[1] <= 3.02 and hi[2] >= 2.6:
        if number in (4, 6, 7, 11, 12, 24, 25, 28):
            door_material = glass if number == 25 else paint if number in (6, 7) else dark
            return 'DoorLeft' if side == 'L' else 'DoorRight', door_material
    if number == 25:
        return 'Glass', glass
    if number == 6 and lo[1] < -8 and -3.1 < hi[1] < -2.7 and hi[0] - lo[0] > 5:
        return 'Bonnet', paint
    factory_paint = paint if number in (6, 7, 23, 28) else None
    if hi[1] < -6.55 or number in (5, 9, 20, 30):
        return 'Nose', factory_paint
    if lo[1] > 7.55:
        return 'Rear', factory_paint
    if number in (8, 10, 15, 18, 19, 21):
        return 'Chassis', None
    return 'Body', factory_paint


def attach_mesh(source, key, material_override, faces, points):
    original = source.data
    vertex_map = {}
    vertices = []
    polygons = []
    owner = pivots[key]
    for face in faces:
        indices = []
        for vertex in face.vertices:
            if vertex not in vertex_map:
                vertex_map[vertex] = len(vertices)
                vertices.append(convert(points[vertex]) - owner.location)
            indices.append(vertex_map[vertex])
        polygons.append(indices)
    mesh = bpy.data.meshes.new(source.name + '-' + key)
    mesh.from_pydata(vertices, [], polygons)
    mat = material_override or original.materials[0]
    mesh.materials.append(mat)
    if original.uv_layers.active and not material_override:
        uv = mesh.uv_layers.new()
        source_uv = original.uv_layers.active.data
        for old, new in zip(faces, mesh.polygons):
            for old_loop, new_loop in zip(old.loop_indices, new.loop_indices):
                uv.data[new_loop].uv = source_uv[old_loop].uv
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    mesh.update()
    transform = source.matrix_world.to_3x3()
    normals = [None] * len(vertices)
    for old, new in vertex_map.items():
        normal = (transform @ original.vertices[old].normal).normalized()
        normals[new] = (normal.y, -normal.x, normal.z)
    if all(normal is not None for normal in normals):
        mesh.normals_split_custom_set_from_vertices(normals)
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = owner


for original in originals:
    if original.type != 'MESH':
        continue
    number = int(original.name.rsplit('_', 1)[1])
    points = [original.matrix_world @ vertex.co for vertex in original.data.vertices]
    targets = defaultdict(list)
    for faces in components(original.data, points):
        verts = {vertex for face in faces for vertex in face.vertices}
        lo = [min(points[vertex][axis] for vertex in verts) for axis in range(3)]
        hi = [max(points[vertex][axis] for vertex in verts) for axis in range(3)]
        centre = [(low + high) / 2 for low, high in zip(lo, hi)]
        targets[classify(number, lo, hi, centre)].extend(faces)
    for (key, override), faces in targets.items():
        attach_mesh(original, key, override, faces, points)

for original in originals:
    bpy.data.objects.remove(original, do_unlink=True)

vehicle['model_source'] = 'https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b'
vehicle['model_license'] = 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'
vehicle['model_author'] = 'SRT Performance'
vehicle['modifications'] = 'Materials, scale, orientation and animation pivots adapted for Carvexo'
if not render_motion:
    bpy.ops.export_scene.gltf(filepath=str(destination / 'bmw-m4.glb'), export_format='GLB', export_extras=True)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.025))
bpy.context.object.data.materials.append(material('Studio floor', (.024, .029, .035), .3, .22))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new('Studio atmosphere')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.15, .185, .24, 1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = .24
scene.render.resolution_x = 1050
scene.render.resolution_y = 682
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, at, power, colour, width, height):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy, data.color, data.shape = power, colour, 'RECTANGLE'
    data.size, data.size_y = width, height
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = at
    aim(obj, (0, 0, .65))


light('Key strip', (-3, -4, 5), 1850, (.73, .83, 1), 5, 1.9)
light('Roof strip', (.7, .4, 5.2), 1800, (1, .81, .68), 6, 1.6)
light('Copper rim', (2, 3.7, 2.8), 1350, (1, .41, .22), 4, 1.8)
light('Nose fill', (-5.5, -1, 1.9), 430, (.68, .80, 1), 3, 1.2)
camera = bpy.data.objects.new('Studio camera', bpy.data.cameras.new('Studio camera'))
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera.data.lens = 46

frame_poses = {
    'studio': (-5.9, -7.0, 2.55),
    'doors': (-5.9, -7.0, 2.55),
    'coverage': (-3.55, -8.9, 2.62),
    'inspection': (-4.3, -7.35, 2.85),
    'drive': (-4.5, -6.9, 1.86),
}
rest = {name: obj.location.copy() for name, obj in pivots.items()}
for frame, camera_position in (() if render_motion else frame_poses.items()):
    for name, obj in pivots.items():
        obj.location = rest[name]
        obj.rotation_euler = (0, 0, 0)
    if frame in ('doors', 'coverage'):
        pivots['DoorLeft'].rotation_euler.z = -.7 if frame == 'doors' else -.23
        pivots['DoorRight'].rotation_euler.z = .7 if frame == 'doors' else .23
    if frame in ('coverage', 'inspection'):
        offset = .64 if frame == 'coverage' else .20
        for name in ('Bonnet', 'Nose', 'Rear', 'Glass'):
            pivots[name].location.z += offset * (.85 if name in ('Bonnet', 'Glass') else .15)
        pivots['Nose'].location.x -= offset
        pivots['Rear'].location.x += offset
        for name in ('DoorLeft', 'DoorRight', 'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR'):
            pivots[name].location.y += offset * (-1 if name.endswith('L') or name == 'DoorLeft' else 1)
    camera.location = camera_position
    aim(camera, (0, 0, .65))
    scene.render.filepath = str(destination / (frame + '.png'))
    bpy.ops.render.render(write_still=True)


if render_motion:
    camera.location = (-5.8, -6.43, 2.66)
    aim(camera, (0, 0, .71))
    camera.data.lens = 47
    scene.render.resolution_x = 840
    scene.render.resolution_y = 544
    scene.cycles.samples = 10
    scene.cycles.use_animated_seed = False
    scene.render.fps = 24
    scene.render.image_settings.compression = 13
    paint_node = paint.node_tree.nodes.get('Principled BSDF')
    paint_node.inputs['Base Color'].default_value = (.075, .104, .151, 1)
    paint_node.inputs['Metallic'].default_value = .51
    glass_node = glass.node_tree.nodes.get('Principled BSDF')
    glass_node.inputs['Base Color'].default_value = (.022, .038, .069, 1)
    glass_node.inputs['Metallic'].default_value = 0
    glass_node.inputs['Specular IOR Level'].default_value = 0
    glass_node.inputs['Roughness'].default_value = .38
    bpy.data.lights['Key strip'].energy = 620
    bpy.data.lights['Roof strip'].energy = 930
    bpy.data.lights['Roof strip'].color = (1, .62, .45)
    bpy.data.lights['Copper rim'].energy = 900
    bpy.data.lights['Nose fill'].energy = 330
    lamp.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = .48

    if showcase:
        shots = json.loads(Path(arguments[arguments.index('--showcase') + 1]).read_text())
        scene.render.resolution_x = 630
        scene.render.resolution_y = 408
        scene.cycles.samples = 32
        for shot in shots:
            for index, pose in enumerate(shot['frames']):
                vehicle.rotation_euler.z = -pose['yaw']
                for name, data in pose['parts'].items():
                    x, y, z = data['offset']
                    pivots[name].location = rest[name] + Vector((x, -z, y))
                    if name in ('DoorLeft', 'DoorRight'):
                        pivots[name].rotation_euler.z = data['spread'] * (-.55 if name == 'DoorLeft' else .55)
                pullback = 1 + pose['pullback']
                camera.location = (-5.8 * pullback, -6.43 * pullback, .71 + 1.95 * pullback)
                aim(camera, (0, 0, .71))
                scene.render.filepath = str(destination / f"{shot['name']}-{index:04d}.png")
                bpy.ops.render.render(write_still=True)
        sys.exit(0)

    # Render one full turn. The browser selects a frame based on the distance travelled.
    count = 32
    for index in range(1 if "--poster-only" in arguments[2:] else count):
        angle = -2 * math.pi * index / count
        for name in ('WheelFL', 'WheelFR', 'WheelRL', 'WheelRR'):
            pivots[name].rotation_euler.y = angle
        scene.render.filepath = str(destination / f'wheels-{index:04d}.png')
        bpy.ops.render.render(write_still=True)
