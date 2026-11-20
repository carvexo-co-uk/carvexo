"""Create the original unbranded Carvexo studio coupé and its fallback frame.

Usage: blender -b --threads 8 -P scripts/build-car.py -- client/public/scene
Lengths are in metres. X runs nose to tail, Z points up in Blender.
"""

from math import pi, cos, sin, sqrt, radians
from pathlib import Path
import os
import sys

import bpy
from mathutils import Vector

target = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
target.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, colour, metal=0, rough=.42, emission=0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*colour, 1)
    result.use_nodes = True
    surface = result.node_tree.nodes.get("Principled BSDF")
    surface.inputs["Base Color"].default_value = (*colour, 1)
    surface.inputs["Metallic"].default_value = metal
    surface.inputs["Roughness"].default_value = rough
    if emission:
        surface.inputs["Emission Color"].default_value = (*colour, 1)
        surface.inputs["Emission Strength"].default_value = emission
    return result


paint = material("Alloy_Paint", (.096, .120, .153), .79, .29)
paint.node_tree.nodes.get("Principled BSDF").inputs["Coat Weight"].default_value = .27
trim = material("Black_Trim", (.025, .033, .044), .54, .34)
rubber = material("Tread", (.017, .020, .024), .06, .65)
rim = material("Forged_Alloy", (.24, .27, .305), .83, .28)
brake = material("Brake_Rotor", (.15, .153, .15), .71, .43)
copper = material("Copper_Detail", (.51, .21, .112), .64, .30)
glass = material("Smoked_Glass", (.016, .026, .046), .34, .24)
glass.node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value = .28
seat = material("Cabin_Leather", (.095, .064, .052), .01, .55)
led = material("Headlamp_Emitter", (.73, .87, 1.0), .20, .25, 3.2)
tail_led = material("Rear_Light", (1.0, .105, .036), .15, .27, 2.1)
mark = material("Axle_Detail", (.33, .34, .34), .75, .24)


def parent_in_place(obj, parent):
    if parent:
        bpy.context.view_layer.update()
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = world


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    parent_in_place(obj, parent)
    return obj


car = empty("Vehicle")
body = empty("Body", parent=car)
bonnet = empty("Bonnet", parent=car)
nose = empty("Nose", parent=car)
rear = empty("Rear", parent=car)
glass_group = empty("Glass", parent=car)
chassis = empty("Chassis", parent=car)
lamps = empty("Lamps", parent=nose)


def mesh(name, vertices, faces, mat, parent=None, smooth=False):
    geometry = bpy.data.meshes.new(name)
    geometry.from_pydata(vertices, [], faces)
    geometry.update()
    obj = bpy.data.objects.new(name, geometry)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if smooth:
        for face in geometry.polygons:
            face.use_smooth = True
    parent_in_place(obj, parent)
    return obj


def grid(name, xs, ys, calculate, mat, parent, reverse=False):
    vertices = [calculate(x, y) for x in xs for y in ys]
    columns = len(ys)
    faces = []
    for i in range(len(xs) - 1):
        for j in range(columns - 1):
            k = i * columns + j
            face = (k, k + columns, k + columns + 1, k + 1)
            faces.append(face[::-1] if reverse else face)
    return mesh(name, vertices, faces, mat, parent, smooth=True)


def steps(start, end, count):
    return [start + (end - start) * i / count for i in range(count + 1)]


def box(name, location, size, mat, parent, rounding=.035, angle=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rounding:
        modifier = obj.modifiers.new("Radius", "BEVEL")
        modifier.width = rounding
        modifier.segments = 3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        normals = obj.modifiers.new("Surface normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=normals.name)
    obj.rotation_euler.y = angle
    obj.data.materials.append(mat)
    parent_in_place(obj, parent)
    return obj


def tube(name, points, radius, mat, parent, resolution=2):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = resolution
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    parent_in_place(obj, parent)
    return obj


# A swept centreline, cut-in flanks and separate crown / rocker surfaces.
stations = [
    (-2.39, .63, .55, .61),
    (-2.25, .85, .65, .71),
    (-2.03, .96, .78, .79),
    (-1.76, 1.015, .92, .865),
    (-1.45, 1.035, .995, .904),
    (-1.17, .985, .92, .922),
    (-.88, .915, .835, .935),
    (-.54, .905, .805, .895),
    (.02, .92, .81, .87),
    (.45, .96, .85, .91),
    (.80, 1.005, .927, .96),
    (1.43, 1.067, 1.035, .999),
    (1.74, 1.028, .981, .963),
    (2.04, .973, .866, .877),
    (2.28, .883, .787, .822),
    (2.355, .747, .718, .767),
]
front_axle, rear_axle, wheel_z, tread_radius = -1.48, 1.43, .465, .455


def catmull(a, b, c, d, t):
    return .5 * ((2 * b) + (-a + c) * t + (2*a - 5*b + 4*c - d) * t*t
                 + (-a + 3*b - 3*c + d) * t*t*t)


def profile(x):
    for index, right in enumerate(stations[1:]):
        if x <= right[0] + 1e-6:
            left = stations[index]
            before = stations[max(index - 1, 0)]
            after = stations[min(index + 2, len(stations) - 1)]
            t = (x - left[0]) / (right[0] - left[0])
            return [catmull(before[i], left[i], right[i], after[i], t) for i in (1, 2, 3)]
    return stations[-1][1:]


def top_surface(x, v):
    width, shoulder, crown = profile(x)
    offset = abs(v)
    ridge = (.068 if x < -.96 or x > .78 else .006)
    ridge *= max(0, min(1, (x + 2.39) / .50, (2.355 - x) / .42))
    z = (crown + (shoulder - crown) * offset**3
         + ridge * sin(pi * offset**2)**2 - .012 * offset**9)
    return (x, width * v, z)


for label, x0, x1, group in [
    ("Front_Deck", -2.39, -2.184, nose), ("Bonnet_Skin", -2.174, -.922, bonnet),
    ("Centre_Deck", -.913, .808, body), ("Rear_Deck", .818, 2.355, rear),
]:
    grid(label, steps(x0, x1, 32), steps(-1, 1, 26), top_surface, paint, group)


def arch_floor(x):
    base = .275 + .12 * max(0, (abs(x) - 1.89) / .5)
    for axle in (front_axle, rear_axle):
        distance = abs(x - axle)
        r = .501
        if distance < r:
            # The eased arch ends join the rocker without a sharp mesh jump.
            factor = min(1, max(0, (r - distance) / .040))
            ease = factor * factor * (3 - 2 * factor)
            curve = wheel_z + sqrt(max(0, r * r - distance * distance))
            return base + (curve - base) * ease
    return base


def flank(x, t, side):
    width, shoulder, _ = profile(x)
    upper = shoulder - .012
    lower = min(upper - .017, arch_floor(x))
    z = upper + (lower - upper) * t
    tuck = .075 * t * t * min(1, max(.12, (upper - lower) * 3.8))
    flare = .019 * sin(pi * t)
    sculpt = .043 * sin(pi * t)**3 if -.99 < x < .88 else 0
    return (x, side * (width + flare - tuck - sculpt), z)


doors = {}
for side, label in ((-1, "Left"), (1, "Right")):
    door = empty(f"Door{label}", (-.886, side * .865, .77), car)
    doors[side] = door
    for name, x0, x1, group in [
        ("Fender", -2.389, -.890, nose), ("Door_Skin", -.880, .741, door),
        ("Haunch", .752, 2.354, rear),
    ]:
        grid(f"{name}_{label}", steps(x0, x1, 44), steps(0, 1, 14),
             lambda x, t: flank(x, t, side), paint, group, reverse=side == 1)
    for tag, axle, group in (("Front", front_axle, nose), ("Rear", rear_axle, rear)):
        points = [flank(x, .98, side) for x in steps(axle - .50, axle + .50, 50)]
        tube(f"{tag}_Arch_{label}", points, .012, trim, group)
    tube(f"Shoulder_{label}", [flank(x, .065, side) for x in steps(-.84, .70, 27)],
         .0055, trim, door, resolution=1)
    tube(f"Door_Handle_{label}", [
        (x, flank(x, .19, side)[1] + side*.005, flank(x, .19, side)[2] + .009)
        for x in steps(.41, .62, 8)
    ], .011, trim, door)
    tube(f"Rocker_{label}", [
        (x, side * (.865 + .018 * sin(pi*t)), .312 + .035 * t)
        for t, x in zip(steps(0, 1, 20), steps(-.92, .88, 20))
    ], .033, trim, body)
    tube(f"Rocker_Accent_{label}", [(x, side*.875, .312) for x in steps(-.69, .56, 16)],
         .010, copper, body)
    mirror_shank = [( -.72, side*.82, 1.007), (-.70, side*1.002, 1.096)]
    tube(f"Mirror_Stem_{label}", mirror_shank, .022, trim, door)
    box(f"Mirror_{label}", (-.69, side*1.06, 1.106), (.212, .22, .095), paint, door, .038)

# Front and rear closures are separate shaped bumper surfaces.
for sign, group in ((-1, nose), (1, rear)):
    end = -2.39 if sign == -1 else 2.355
    close = profile(end)
    grid(f"Bumper_{sign}", steps(0, 1, 16), steps(-1, 1, 30),
         lambda t, v: (
             end + sign * (.025 * sin(pi*t) - .053 * abs(v)**3),
             (close[0] + .155 * sin(pi*t)) * v,
             close[1] + (close[2]-close[1])*(1-abs(v)**3)*(1-t) - (.246 + .04*abs(v)) * t,
         ), paint, group, reverse=sign == 1)
    box(f"Splitter_{sign}", (end - sign*.119, 0, .325), (.318, 1.54, .092), trim, group, .041)
    tube(f"Splitter_Edge_{sign}", [
        (end+sign*(.032-.16*abs(v)**3), .77*v, .341) for v in steps(-1, 1, 30)
    ], .010, copper, group)

# Sculpted front lights, intake blades and a wraparound rear light bar.
for side in (-1, 1):
    coords = [
        (-2.382, .43*side, .600), (-2.33, .665*side, .650),
        (-2.205, .864*side, .699), (-2.095, .91*side, .735),
    ]
    tube(f"Headlight_Bevel_{side}", coords, .036, trim, lamps, 3)
    tube(f"Headlight_{side}", [
        (x-.026, y+side*.009, z+.022) for x, y, z in coords
    ], .0115, led, lamps, 3)
    tube(f"Headlight_Return_{side}", [
        (-2.315, side*.656, .624), (-2.227, side*.804, .653),
        (-2.138, side*.88, .693)
    ], .008, led, lamps)
    tube(f"Corner_Intake_{side}", [
        (-2.334, side*.56, .490), (-2.296, side*.676, .490),
        (-2.229, side*.819, .514), (-2.132, side*.874, .560)
    ], .043, trim, nose)
    for i in range(3):
        box("Intake_Rib", (-2.364 + i*.033, side*(.563+i*.074), .482+i*.012),
            (.029, .012, .069), trim, nose, .004, radians(20))
    vent = [(x, side*(.565+.065*t), top_surface(x, side*.59)[2]+.005)
            for x, t in zip(steps(-1.89, -1.277, 28), steps(0, 1, 28))]
    tube(f"Bonnet_Extraction_{side}", vent, .017, trim, bonnet)
    tube(f"Taillight_{side}", [
        (2.361, side*.12, .724), (2.356, side*.42, .733),
        (2.319, side*.71, .741), (2.242, side*.869, .767)
    ], .015, tail_led, rear)
    box("Rear_Vent", (2.321, side*.43, .562), (.081, .49, .093), trim, rear, .022)
box("Main_Grille", (-2.424, 0, .462), (.073, 1.02, .124), trim, nose, .028)
for z in (.424, .459, .494):
    tube("Grille_Blade", [(-2.466+.039*(v*v), .47*v, z) for v in steps(-1, 1, 14)],
         .006, rim, nose, 1)
box("Nose_Accent", (-2.373, 0, .630), (.095, .063, .012), copper, nose, .004)
box("Rear_Ducktail", (2.125, 0, .886), (.225, 1.54, .079), paint, rear, .033, radians(-5))

# Roof and smoked glass leave a recognisable cockpit when the doors swing.
def span_grid(name, x0, x1, start_width, end_width, start_z, end_z, rise, mat, group):
    def panel(t, v):
        width = start_width + (end_width-start_width)*t
        z = start_z + (end_z-start_z)*t + rise*sin(pi*t) - .051 * abs(v)**2
        return (x0+(x1-x0)*t + .05*abs(v)*sin(pi*t), width*v, z)
    grid(name, steps(0, 1, 28), steps(-1, 1, 26), panel, mat, group)


span_grid("Windscreen", -1.048, -.414, .765, .621, .942, 1.449, .029, glass, glass_group)
span_grid("Roof", -.427, .631, .622, .593, 1.453, 1.437, .054, paint, body)
span_grid("Backlight", .619, 1.548, .598, .754, 1.436, 1.000, .056, glass, glass_group)

for side, door in doors.items():
    def window(u, v):
        lower = (-1.018 + 1.665*u, side*(.780+.052*u), .936+.021*u)
        upper = (-.417 + 1.018*u, side*(.622-.014*u), 1.400-.011*u+.037*sin(pi*u))
        return tuple(a + (b-a)*v for a,b in zip(lower, upper))
    def beltline(x, v):
        upper = (x, side*(.788+.052*(x+.88)/1.63), .937+.022*(x+.88)/1.63)
        edge = flank(x, 0, side)
        return tuple(a + (b-a)*v for a,b in zip(upper, edge))
    grid(f"Door_Window_{side}", steps(0, 1, 19), steps(0, 1, 8), window, glass, door,
         reverse=side == -1)
    grid(f"Door_Beltline_{side}", steps(-.879, .740, 27), steps(0, 1, 6),
         beltline, paint, door, reverse=side == -1)
    tube(f"Window_Rail_{side}", [window(t, .952) for t in steps(0, 1, 21)],
         .015, paint, door)
    tube(f"A_Pillar_{side}", [window(0, t) for t in steps(0, 1, 18)],
         .030, paint, body)
    tube(f"B_Pillar_{side}", [window(1, t) for t in steps(0, 1, 19)],
         .033, paint, body)
    mesh(f"Quarter_Glass_{side}", [window(1, 0), window(1, 1), (1.468, side*.745, .987)],
         [(0, 1, 2)], glass, glass_group)
    tube(f"Flying_Buttress_{side}", [
        (.608, side*.614, 1.385), (.873, side*.662, 1.27),
        (1.194, side*.729, 1.129), (1.503, side*.764, .998)
    ], .027, paint, rear)
    box("Cabin_Seat", (.24, side*.38, .653), (.64, .427, .21), seat, chassis, .076)
    box("Cabin_Backrest", (.499, side*.38, .902), (.166, .384, .56), seat, chassis, .066, radians(-18))
    box("Cabin_Headrest", (.60, side*.38, 1.147), (.132, .231, .173), seat, chassis, .05, radians(-12))
    box("Cabin_Sill", (-.01, side*.70, .59), (1.77, .135, .148), trim, chassis, .03)
box("Cabin_Dash", (-.80, 0, .898), (.37, 1.47, .22), trim, chassis, .07)
wheel_ring = [(-.67 + .06*sin(t), .377+.128*cos(t), .937+.135*sin(t))
              for t in steps(0, 2*pi, 35)]
tube("Steering_Wheel", wheel_ring, .017, mark, chassis)
box("Undertray", (0, 0, .259), (4.17, 1.55, .142), trim, chassis, .075)
box("Cockpit_Tunnel", (0, 0, .53), (1.80, .24, .28), trim, chassis, .036)
box("Mid_Power_Unit", (1.01, 0, .557), (.91, .81, .42), brake, chassis, .083)
for side in (-1, 1):
    for i in range(7):
        box("Power_Unit_Fin", (.66 + i*.101, side*.367, .758), (.046, .190, .056),
            rim, chassis, .010)
    tube("Power_Unit_Manifold", [(.54, side*.23, .662), (.76, side*.53, .70),
         (1.37, side*.58, .64), (1.81, side*.50, .43), (2.27, side*.48, .402)],
         .044, copper, chassis)

# Cross-sections are revolved about the actual wheel centre.
def lathe(name, centre, cross_section, side, mat, group, segments=54):
    x, y, z = centre
    outline = len(cross_section)
    vertices = []
    for i in range(segments):
        angle = 2*pi*i/segments
        for offset, radius in cross_section:
            vertices.append((x + radius*cos(angle), y+side*offset, z+radius*sin(angle)))
    faces = [
        (i*outline+j, ((i+1)%segments)*outline+j,
         ((i+1)%segments)*outline+(j+1)%outline, i*outline+(j+1)%outline)
        for i in range(segments) for j in range(outline)
    ]
    if side == 1:
        faces = [face[::-1] for face in faces]
    return mesh(name, vertices, faces, mat, group, smooth=True)


for side, label in ((-1, "L"), (1, "R")):
    for index, axle in enumerate((front_axle, rear_axle)):
        y = side * (.880 if index == 0 else .914)
        centre = (axle, y, wheel_z)
        ring = empty(f"Wheel{'F' if index == 0 else 'R'}{label}", centre, car)
        lathe("Performance_Tyre", centre, [
            (-.127, .310), (-.149, .400), (-.133, .442), (-.106, tread_radius),
            (.091, tread_radius), (.123, .442), (.145, .409), (.132, .365), (.116, .310)
        ], side, rubber, ring, 64)
        lathe("Rim_Barrel", centre, [
            (-.119, .302), (.095, .303), (.135, .314), (.148, .355),
            (.128, .370), (.092, .362), (-.128, .338)
        ], side, rim, ring, 64)
        lathe("Rotor", centre, [(0.032,.08), (.061,.08), (.067,.278), (.035,.282)],
              side, brake, ring, 45)
        lathe("Hub", centre, [(.07, 0), (.140, 0), (.149, .080), (.121, .099), (.08, .094)],
              side, trim, ring, 32)
        lathe("Hub_Copper_Ring", centre, [(.142,.047), (.15,.047), (.15,.062), (.141,.064)],
              side, copper, ring, 30)
        # The Y spokes share one geometry per wheel, with real openings between.
        verts, faces = [], []
        for i in range(7):
            angle = 2*pi*i/7
            for fork in (-1, 1):
                coordinates = [(.058, angle-.14), (.101, angle+.10), (.203, angle+fork*.08+.17),
                               (.348, angle+fork*.116+.215), (.350, angle+fork*.116+.118),
                               (.21, angle+fork*.08+.087)]
                for offset in (.096, .141):
                    verts.extend((axle+r*cos(a), y+side*offset, wheel_z+r*sin(a))
                                 for r,a in coordinates)
                j = len(verts) - 12
                faces.append(tuple(j+i for i in range(6)))
                faces.append(tuple(j+i for i in range(11, 5, -1)))
                faces.extend((j+i, j+(i+1)%6, j+6+(i+1)%6, j+6+i) for i in range(6))
        mesh("Forged_Spokes", verts, faces, rim, ring)
        box("Caliper", (axle+.218, y+side*.085, wheel_z+.073), (.106, .083, .191),
            copper, chassis, .021, radians(-17))
        coil = [(axle+.070*cos(t), side*(.71+.055*sin(t)), .44+.32*t/(2*pi*5))
                for t in steps(0, 2*pi*5, 64)]
        tube("Damper_Spring", coil, .012, copper, chassis, 1)

# Export only the original asset as GLB. Studio lights and floor live in the app.
def convert_curves():
    for obj in list(bpy.data.objects):
        if obj.type == "CURVE":
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.convert(target="MESH")

convert_curves()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(target / "carvexo-coupe.glb"), export_format="GLB",
                          use_selection=True, export_animations=False)

# Fallback rendered from the identical asset with a photographic studio rig.
if os.environ.get("CARVEXO_SKIP_STILL") == "1":
    sys.exit(0)

world = bpy.context.scene.world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (.12, .15, .19, 1)
background.inputs["Strength"].default_value = .43
floor = material("Studio_Floor", (.019, .025, .031), .25, .39)
bpy.ops.mesh.primitive_plane_add(size=2000, location=(0, 0, -.008))
bpy.context.object.data.materials.append(floor)


def aimed(obj, point):
    obj.rotation_euler = (Vector(point)-obj.location).to_track_quat("-Z", "Y").to_euler()


def area(name, position, point, power, colour, width, height):
    bpy.ops.object.light_add(type="AREA", location=position)
    obj = bpy.context.object
    obj.name = name
    obj.data.shape = "RECTANGLE"
    obj.data.size, obj.data.size_y = width, height
    obj.data.energy = power
    obj.data.color = colour
    aimed(obj, point)


area("Key softbox", (-3.8, -3.0, 5.2), (-.1, 0, .67), 970, (.83, .90, 1), 6.0, 2.3)
area("Raking strip", (1.2, -3.4, 2.7), (.3, -.31, .61), 260, (1, .72, .52), 5.0, .85)
area("Copper rim", (2.5, 3.54, 3.82), (.1, 0, .71), 1560, (1, .48, .31), 4.4, 1.0)
area("Top edge", (.42, .44, 5.8), (0, 0, .5), 810, (1, .90, .78), 4.8, .68)
area("Front grille fill", (-5.2, 1.24, 2.15), (-1.1, 0, .61), 550, (.69, .80, 1), 2.9, 1.5)
for side in (-1, 1):
    bpy.ops.object.light_add(type="SPOT", location=(-2.34, side*.65, .61))
    light = bpy.context.object
    light.data.energy = 28
    light.data.color = (.68, .81, 1)
    light.data.spot_size = radians(31)
    light.data.spot_blend = .75
    aimed(light, (-6.6, side*.78, .0))

scene = bpy.context.scene
bpy.ops.object.camera_add(location=(-5.80, -6.42, 2.73))
camera = bpy.context.object
camera.data.lens = 54
aimed(camera, (-.01, 0, .72))
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples = int(os.environ.get("CARVEXO_RENDER_SAMPLES", "32"))
scene.cycles.use_denoising = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.resolution_x = 1420
scene.render.resolution_y = 920
scene.render.resolution_percentage = int(os.environ.get("CARVEXO_RENDER_SCALE", "100"))
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(target / "studio-original.png")
bpy.ops.render.render(write_still=True)

if os.environ.get("CARVEXO_SNAPSHOTS") == "1":
    scene.render.resolution_percentage = 72
    scene.cycles.samples = 28

    def snapshot(name, position, focal_point, lens):
        camera.location = position
        camera.data.lens = lens
        aimed(camera, focal_point)
        scene.render.filepath = str(target / (name + "-original.png"))
        bpy.ops.render.render(write_still=True)

    doors[-1].rotation_euler.z = -.88
    doors[1].rotation_euler.z = .88
    snapshot("doors", (-5.80, -6.42, 2.73), (-.01, 0, .72), 54)
    doors[-1].rotation_euler.z = 0
    doors[1].rotation_euler.z = 0

    offsets = {
        "Nose": (-.91, 0, .08), "Bonnet": (-.20, 0, .67), "Rear": (.72, 0, .14),
        "Body": (.06, 0, .45), "Glass": (0, 0, .74), "DoorLeft": (.12, -.65, .14),
        "DoorRight": (.12, .66, .14), "WheelFL": (-.29, -.61, .02), "WheelFR": (-.29, .61, .02),
        "WheelRL": (.28, -.65, .02), "WheelRR": (.28, .65, .02),
    }
    originals = {name: bpy.data.objects[name].location.copy() for name in offsets}
    for name, offset in offsets.items():
        bpy.data.objects[name].location += Vector(offset)
    snapshot("coverage", (-4.2, -8.29, 3.02), (0, 0, .89), 48)
    for name, initial in originals.items():
        bpy.data.objects[name].location = initial

    def fade(material, amount):
        tree = material.node_tree
        shader = tree.nodes.get("Principled BSDF")
        output = tree.nodes.get("Material Output")
        mix = tree.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = amount
        tree.links.new(shader.outputs[0], mix.inputs[1])
        tree.links.new(tree.nodes.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs[0], output.inputs["Surface"])
        return shader

    fade(paint, .73)
    fade(glass, .91)
    snapshot("inspection", (-3.1, -6.9, 2.79), (.22, 0, .73), 49)
    for mat in (paint, glass):
        tree = mat.node_tree
        tree.links.new(tree.nodes.get("Principled BSDF").outputs[0], tree.nodes.get("Material Output").inputs["Surface"])
    snapshot("drive", (-4.7, -8.05, 1.79), (.02, 0, .63), 56)
