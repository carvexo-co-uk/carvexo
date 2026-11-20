import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { applyTrackingPose, createStudioFraming } from '../client/src/studioFraming.js';
import { advanceDrive, drivePose, readDriveWheel, wheelFrame } from '../client/src/studioDrive.js';
import { partSpread, showcaseMix, showcasePose } from '../client/src/studioShowcase.js';

// Geometry and pivots are exercised in Node without a browser image decoder.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

test('BMW studio model loads with independent door hinges, axles and lighting material', async () => {
  const buffer = await readFile(new URL('../client/public/scene/bmw-m4.glb', import.meta.url));
  const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '',
  );
  const model = asset.scene.getObjectByName('Vehicle');
  model.updateMatrixWorld(true);
  const left = model.getObjectByName('DoorLeft');
  const wheel = model.getObjectByName('WheelFL');
  assert.equal(left.parent, model);
  assert.equal(wheel.parent, model);
  const hinge = left.getWorldPosition(new Vector3());
  const axle = wheel.getWorldPosition(new Vector3());
  const doorTip = new Vector3(1.5, 0, 0).applyMatrix4(left.matrixWorld);
  const rimPoint = new Vector3(.4, 0, 0).applyMatrix4(wheel.matrixWorld);
  left.rotation.y = -.88;
  wheel.rotation.z = 2.25;
  model.updateMatrixWorld(true);
  assert.ok(hinge.distanceTo(left.getWorldPosition(new Vector3())) < .001);
  assert.ok(axle.distanceTo(wheel.getWorldPosition(new Vector3())) < .001);
  assert.ok(doorTip.distanceTo(new Vector3(1.5, 0, 0).applyMatrix4(left.matrixWorld)) > 1);
  assert.ok(rimPoint.distanceTo(new Vector3(.4, 0, 0).applyMatrix4(wheel.matrixWorld)) > .5);
  const materials = new Set();
  model.traverse((object) => { if (object.material) materials.add(object.material.name); });
  for (const material of ['Alloy_Paint', 'Smoked_Glass', 'Headlamp_Emitter']) assert.ok(materials.has(material));
  for (const group of ['Nose', 'Rear', 'Chassis', 'Bonnet', 'Glass', 'DoorRight', 'WheelRR', 'WheelRL', 'WheelFR']) {
    assert.ok(model.getObjectByName(group)?.children.length > 0, group);
  }
});


test('the animated BMW and separated parts stay inside the full stage at narrow and wide sizes', async () => {
  const buffer = await readFile(new URL('../client/public/scene/bmw-m4.glb', import.meta.url));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '',
  );
  const frame = createStudioFraming(scene);
  const car = scene.getObjectByName('Vehicle');
  car.getObjectByName('DoorLeft').rotation.y = -.88;
  car.getObjectByName('DoorRight').rotation.y = .88;
  car.getObjectByName('Bonnet').position.y += .62;
  car.getObjectByName('Nose').position.x -= 1;
  car.getObjectByName('Rear').position.x += .9;
  car.getObjectByName('WheelFL').position.z += .75;
  const corner = new Vector3();
  for (const [width, height] of [[320, 508], [393, 792], [1366, 696], [1904, 874]]) {
    const camera = new PerspectiveCamera(55, width / height, .15, 80);
    for (const [offset, cameraX, vertical] of [[0, -5.8, -.72], [-4.2, -1, .52], [-3, 3.45, .02]]) {
      car.position.x = offset;
      camera.position.set(cameraX, 1.34, 6.99);
      camera.lookAt(0, .71, 0);
      frame(camera, { mobile: width <= 820, vertical, drive: Math.abs(offset) / 4.2 });
      car.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const { min, max } = mesh.geometry.boundingBox;
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          corner.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
          assert.ok(Math.abs(corner.x) <= .941 && Math.abs(corner.y) <= .941, mesh.name);
        }
      });
    }
  }
});


test('a pixel-wheel burst holds the page at either speed boundary until a new gesture', () => {
  const wheel = (deltaY, timeStamp, speed, previous, deltaMode = 0) =>
    readDriveWheel({ deltaY, timeStamp, deltaMode }, speed, previous);

  let input = wheel(18, 100, .99, undefined);
  assert.equal(input.speed, 1);
  assert.equal(input.consume, true);
  input = wheel(200, 130, input.speed, input.gesture);
  assert.equal(input.consume, true);
  input = wheel(100, 400, input.speed, input.gesture);
  assert.equal(input.consume, false);
  input = wheel(-120, 420, input.speed, input.gesture);
  assert.equal(input.consume, true);
  assert.equal(input.speed, .85);

  input = wheel(-16, 500, .01, input.gesture);
  assert.equal(input.speed, 0);
  assert.equal(input.consume, true);
  assert.equal(wheel(-100, 550, 0, input.gesture).consume, true);
  assert.equal(wheel(-100, 750, 0, input.gesture).consume, false);

  const notch = wheel(3, 800, .98, undefined, 1);
  assert.equal(notch.speed, 1);
  assert.equal(notch.consume, true);
  assert.equal(wheel(3, 820, 1, notch.gesture, 1).consume, false);
});

test('the selected drive speed persists and drives forward distance and wheel rotation', () => {
  let state = { speed: 0, distance: 0 };
  for (let step = 0; step < 80; step++) state = advanceDrive(state, .5, .016);
  assert.equal(state.speed, .5);
  const cruise = advanceDrive(state, .5, .5);
  assert.equal(cruise.speed, .5);
  assert.ok(Math.abs(cruise.distance - state.distance - .85) < 1e-8);
  assert.notEqual(wheelFrame(state.distance), wheelFrame(cruise.distance));
  const stopped = advanceDrive(cruise, 0, .25);
  assert.equal(stopped.speed, 0);
  assert.ok(stopped.distance >= cruise.distance);
  assert.deepEqual(advanceDrive(stopped, 0, .25), stopped);
});

test('tracking creates real 3D travel with fixed body height, heading and projected scale', () => {
  const camera = new PerspectiveCamera(42, 16 / 9, .15, 80);
  const car = new Group();
  const base = camera.projectionMatrix.clone();
  function measure(distance) {
    const pose = drivePose(distance, false);
    applyTrackingPose(car, camera, base, pose);
    camera.updateMatrixWorld();
    const left = new Vector3(car.position.x - 1.4, .4, 0).project(camera);
    const right = new Vector3(car.position.x + 1.4, .4, 0).project(camera);
    return {
      x: car.position.x, y: car.position.y, yaw: car.rotation.y,
      viewWidth: right.x - left.x, viewY: left.y, viewX: left.x, wheel: pose.wheelAngle,
    };
  }
  const start = measure(0);
  const moving = measure(7);
  const later = measure(27);
  assert.ok(start.x > moving.x && moving.x > later.x);
  assert.ok(start.viewX > moving.viewX && moving.viewX > later.viewX);
  assert.equal(later.y, start.y);
  assert.equal(later.yaw, start.yaw);
  assert.ok(Math.abs(later.viewY - start.viewY) < 1e-10);
  assert.ok(Math.abs(later.viewWidth - start.viewWidth) < 1e-10);
  assert.notEqual(later.wheel, moving.wheel);
});

test('the BMW separates and reassembles on scroll, then completes one turn before the drive', () => {
  const closed = { split: 0, yaw: 0, pullback: 0 };
  assert.deepEqual(showcasePose(1, 0), closed);
  assert.deepEqual(showcasePose(1, 1), closed);
  const halfwayOpen = showcasePose(1, .20).split;
  assert.ok(partSpread('WheelFL', halfwayOpen) > partSpread('Body', halfwayOpen));
  assert.ok(showcasePose(1, .50).split >= .90);
  assert.ok(showcasePose(1, .80).split < showcasePose(1, .50).split);
  assert.deepEqual(showcasePose(2, 0), closed);
  const sideProfile = showcasePose(2, .28);
  assert.ok(sideProfile.yaw > 0 && sideProfile.yaw < Math.PI);
  assert.equal(showcasePose(2, 1).yaw, 2 * Math.PI);
  assert.equal(showcasePose(2, .50).split, 0);
  assert.equal(showcaseMix(0), 0);
  assert.equal(showcaseMix(.50), 1);
  assert.equal(showcaseMix(1), 0);
  assert.deepEqual(showcasePose(3, .5), closed);
});
