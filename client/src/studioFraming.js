import { Box2, Matrix4, Vector3, MathUtils } from 'three';

export function createStudioFraming(model) {
  const meshes = [];
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    const corners = [];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) corners.push(new Vector3(x, y, z));
      }
    }
    meshes.push({ mesh, corners });
  });

  const bounds = new Box2();
  const point = new Vector3();
  const clip = new Matrix4();
  const meshToClip = new Matrix4();

  return function frame(camera, { mobile, vertical, drive, match }) {
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    model.updateMatrixWorld(true);
    clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    bounds.makeEmpty();
    for (const { mesh, corners } of meshes) {
      meshToClip.multiplyMatrices(clip, mesh.matrixWorld);
      for (const corner of corners) bounds.expandByPoint(point.copy(corner).applyMatrix4(meshToClip));
    }

    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const centerX = (bounds.max.x + bounds.min.x) / 2;
    const centerY = (bounds.max.y + bounds.min.y) / 2;
    const scale = match
      ? Math.min(1.35, match.width / width, (mobile ? .59 : 1.52) / height)
      : Math.min(1, (mobile ? 1.72 : 1.21) / width, (mobile ? .49 : 1.52) / height);
    const halfWidth = width * scale / 2;
    const halfHeight = height * scale / 2;
    const x = MathUtils.clamp(match?.x ?? (mobile ? centerX * .24 : .36 + centerX * .56 - drive * .31),
      -.94 + halfWidth, .94 - halfWidth);
    const y = MathUtils.clamp(match?.y ?? vertical, -.94 + halfHeight, .94 - halfHeight);
    clip.makeScale(scale, scale, 1).setPosition(x - centerX * scale, y - centerY * scale, 0);
    camera.projectionMatrix.premultiply(clip);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
}

export function placeTrackingCamera(camera, x) {
  camera.position.set(x - 5.8, 2.66, 6.43);
  camera.lookAt(x, .71, 0);
}

export function applyTrackingPose(model, camera, projection, pose) {
  model.position.set(pose.x, 0, 0);
  placeTrackingCamera(camera, pose.x);
  camera.projectionMatrix.copy(projection);
  camera.projectionMatrix.elements[8] -= pose.screenX;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
