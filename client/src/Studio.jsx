import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { audio } from './audio.js';
import { applyTrackingPose, createStudioFraming, placeTrackingCamera } from './studioFraming.js';
import { drivePose } from './studioDrive.js';
import { partSpread, separation, showcasePose } from './studioShowcase.js';

const lerp = THREE.MathUtils.lerp;
const rad = THREE.MathUtils.degToRad;
const modelUrl = '/scene/bmw-m4.glb';

function reflectionMap(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#313845');
  const panels = [
    [[-4.5, 5.2, 2.8], [5.8, 2.1], '#d7e9ff', 4.1],
    [[-.3, 4.5, -.8], [5.4, 1.09], '#ffe2d0', 4.5],
    [[3.6, 2.75, -3.3], [4.7, 1.92], '#ff8d61', 5.0],
    [[1.0, 1.2, 5.8], [4.2, 1.3], '#a4b4ce', 1.45],
    [[-5.1, 1.48, -.9], [2.7, 1.45], '#9eb7db', 2.0],
  ];
  for (const [position, size, colour, strength] of panels) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour).multiplyScalar(strength),
      side: THREE.DoubleSide,
    }));
    mesh.position.set(...position);
    mesh.lookAt(0, .70, 0);
    scene.add(mesh);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const map = generator.fromScene(scene, .062, .1, 50);
  for (const mesh of scene.children) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  generator.dispose();
  return map;
}

function floorLayer() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { drive: { value: 0 }, distance: { value: 0 }, lamp: { value: 0 } },
    vertexShader: `
      varying vec2 floorUv;
      void main() {
        floorUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 floorUv;
      uniform float drive;
      uniform float distance;
      uniform float lamp;
      void main() {
        vec2 vec = (floorUv - .5) * vec2(2.0, 2.55);
        float surface = exp(-6.8 * dot(vec, vec));
        float copper = exp(-19.0 * dot(vec - vec2(.1,-.11), vec - vec2(.1,-.11)));
        float lines = 1.0 - smoothstep(.002, .01, abs(floorUv.y - .678));
        lines += (1.0 - smoothstep(.002, .008, abs(floorUv.y - .323))) * .48;
        float dashes = smoothstep(.40, .44, fract(floorUv.x * 13.0 + distance * 20.0));
        float beams = exp(-28.0 * pow(floorUv.x - .27, 2.0) - 111.0 * pow(floorUv.y - .48, 2.0)) * lamp;
        vec3 colour = vec3(.13,.15,.177) + copper * vec3(.062,.034,.021) + beams * vec3(.055,.074,.106);
        colour += vec3(.48,.33,.18)*lines*dashes*drive;
        gl_FragColor = vec4(colour, min(.62, surface*.62 + beams*.1));
      }
    `,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(25, 14), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.013;
  floor.renderOrder = -2;
  return floor;
}

function groundShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(48, 48, 7, 48, 48, 47);
  gradient.addColorStop(0, 'rgba(0,0,0,0.97)');
  gradient.addColorStop(.46, 'rgba(0,0,0,0.84)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity: .86, depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.76, 3.68), material);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -.006;
  shadow.renderOrder = -1;
  return shadow;
}

function indexModel(asset) {
  const nodes = new Map();
  const translucent = new Set();
  const lamps = new Set();
  const glass = new Set();
  asset.traverse((object) => {
    if (separation[object.name]) nodes.set(object.name, {
      object, rest: object.position.clone(),
    });
    if (!object.isMesh || !object.material) return;
    object.material.side = THREE.DoubleSide;
    const name = object.material.name;
    if (name === 'Alloy_Paint') translucent.add(object.material);
    if (name === 'Smoked_Glass') glass.add(object.material);
    if (name === 'Headlamp_Emitter') lamps.add(object.material);
  });
  return { nodes, translucent, glass, lamps };
}

function animateModel(parts, split, inspection, wheelAngle) {
  for (const [key, { object, rest }] of parts.nodes) {
    const [x, y, z] = separation[key];
    const spread = partSpread(key, split);
    object.position.set(rest.x + x * spread, rest.y + y * spread, rest.z + z * spread);
    if (key === 'DoorLeft') object.rotation.y = -spread * .55;
    if (key === 'DoorRight') object.rotation.y = spread * .55;
    if (key.startsWith('Wheel')) object.rotation.z = wheelAngle;
  }
  for (const material of [...parts.translucent, ...parts.glass]) {
    const transparent = inspection > .015;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
    material.opacity = 1 - inspection * (parts.glass.has(material) ? .87 : .68);
  }
  for (const material of parts.lamps) material.emissiveIntensity = .55;
}

export default function Studio({ motion, inspectionChapter, orbit, onReady }) {
  const host = useRef(null);
  const orbitOn = useRef(orbit);
  const inspectionOn = useRef(inspectionChapter);
  useEffect(() => { inspectionOn.current = inspectionChapter; }, [inspectionChapter]);
  const drag = useRef({ pointer: null, x: 0, angle: 0 });
  useEffect(() => {
    orbitOn.current = orbit;
    if (!orbit) drag.current.angle = 0;
  }, [orbit]);

  useEffect(() => {
    const container = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      onReady(false);
      return;
    }
    let disposed = false;
    let model;
    let parts;
    let frameModel;
    let frame;
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.04;
    const canvas = renderer.domElement;
    container.appendChild(canvas);
    const scene = new THREE.Scene();
    const env = reflectionMap(renderer);
    scene.environment = env.texture;
    const hemi = new THREE.HemisphereLight(0xbdcafa, 0x30271f, 1.25);
    scene.add(hemi);
    const rim = new THREE.DirectionalLight(0xff9e77, 2.9);
    rim.position.set(2.5, 3.4, -4.0);
    scene.add(rim);
    const key = new THREE.DirectionalLight(0xe5edff, 2.9);
    key.position.set(-5.0, 4.6, 5.6);
    scene.add(key);
    const floor = floorLayer();
    const shadow = groundShadow();
    scene.add(floor, shadow);
    const camera = new THREE.PerspectiveCamera(28, 1, .15, 80);
    let angle = 0;
    let mobile = false;
    let rendered = false;
    let redraw = true;
    let lastChapter = -1;
    let lastPosition;
    let lastInspection;
    let lastDrive;
    let wasVisible = false;
    let primaryDirty = true;
    const primaryProjection = new THREE.Matrix4();

    function size() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const cap = width < 670 ? 1.25 : 1.55;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
      renderer.setSize(width, height, false);
      mobile = width <= 820;
      camera.aspect = width / height;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(rad(36.8) / 2) / Math.min(camera.aspect, 1.86)));
      camera.updateProjectionMatrix();
      redraw = true;
      primaryDirty = true;
    }
    const watcher = new ResizeObserver(size);
    watcher.observe(container);
    size();

    function disposeModel(asset) {
      const geometry = new Set();
      const materials = new Set();
      asset.traverse((object) => {
        if (object.geometry) geometry.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      for (const item of geometry) item.dispose();
      const textures = new Set();
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        material.dispose();
      }
      for (const texture of textures) {
        texture.source.data?.close?.();
        texture.dispose();
      }
    }

    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(modelUrl, ({ scene: asset }) => {
      if (disposed) { disposeModel(asset); return; }
      model = asset;
      scene.add(model);
      parts = indexModel(asset);
      frameModel = createStudioFraming(asset);
      frame = requestAnimationFrame(render);
    }, undefined, () => {
      if (!disposed) onReady(false);
    });

    function render() {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const current = motion.current;
      if (!current.visible || document.hidden || !model) {
        wasVisible = false;
        return;
      }
      if (!wasVisible) redraw = true;
      wasVisible = true;
      const inspectingChapter = inspectionOn.current === current.chapter;
      const orbitAngle = inspectingChapter && orbitOn.current ? drag.current.angle : 0;
      const drive = current.drive;
      const distance = drive?.distance ?? 0;
      const speed = current.chapter === 3 ? drive?.speed ?? 0 : 0;
      const chapterChanged = current.chapter !== lastChapter;
      if (!chapterChanged && lastPosition === current.position && !redraw && lastInspection === inspectingChapter && lastDrive === drive
        && Math.abs(orbitAngle - angle) < .001) return;
      redraw = false;

      const pose = drivePose(distance, mobile);
      const position = current.position - current.chapter;
      const auto = showcasePose(current.chapter, position);
      const show = inspectingChapter && current.chapter === 1
        ? { split: .9, yaw: .31, pullback: .27 }
        : auto;
      const inspection = inspectingChapter && current.chapter === 2 ? .76 : 0;
      if (primaryDirty || chapterChanged && mobile) {
        animateModel(parts, 0, 0, 0);
        model.position.set(0, 0, 0);
        model.rotation.y = 0;
        placeTrackingCamera(camera, 0);
        const poster = container.parentElement.querySelector('img.studio-poster');
        const width = container.clientWidth;
        const height = container.clientHeight;
        const match = poster && width && height ? {
          x: (poster.offsetLeft - poster.offsetWidth * .027) / width * 2 - 1,
          y: 1 - (poster.offsetTop + poster.offsetHeight * .059) / height * 2,
          width: poster.offsetWidth * .625 / width * 2,
        } : undefined;
        frameModel(camera, { mobile, vertical: .02, drive: 0, match });
        primaryProjection.copy(camera.projectionMatrix);
        primaryDirty = false;
      }
      angle = current.chapter === 3 ? 0 : lerp(angle, orbitAngle, .15);
      animateModel(parts, show.split, inspection, pose.wheelAngle);
      applyTrackingPose(model, camera, primaryProjection, pose);
      model.rotation.y = -show.yaw + angle;
      if (show.pullback) {
        const pullback = 1 + show.pullback;
        camera.position.set(pose.x - 5.8 * pullback, .71 + 1.95 * pullback, 6.43 * pullback);
        camera.lookAt(pose.x, .71, 0);
      }
      scene.environmentIntensity = 1.04;
      key.intensity = 2.75;
      rim.intensity = 2.88;
      floor.position.x = model.position.x;
      floor.material.uniforms.lamp.value = 0;
      floor.material.uniforms.drive.value = speed;
      floor.material.uniforms.distance.value = (distance * .52 % 1) / 20;
      shadow.position.x = model.position.x;
      shadow.scale.setScalar(1 + show.split * .20);
      renderer.render(scene, camera);
      lastChapter = current.chapter;
      lastPosition = current.position;
      lastInspection = inspectingChapter;
      lastDrive = drive;
      if (!rendered) {
        rendered = true;
        onReady(true);
      }
    }

    function contextLost(event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      onReady(false, true);
      audio.update(0, false);
    }
    function contextRestored() {
      redraw = true;
      frame = requestAnimationFrame(render);
      rendered = false;
    }
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      watcher.disconnect();
      if (model) disposeModel(model);
      floor.geometry.dispose();
      floor.material.dispose();
      shadow.geometry.dispose();
      shadow.material.map.dispose();
      shadow.material.dispose();
      env.dispose();
      renderer.dispose();
      canvas.remove();
      audio.update(0, false);
    };
  }, [motion, onReady]);

  return <div className={'studio-canvas' + (orbit ? ' orbit-active' : '')} ref={host}
    onPointerDown={(event) => {
      if (!orbit) return;
      drag.current.pointer = event.pointerId;
      drag.current.x = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (drag.current.pointer !== event.pointerId) return;
      drag.current.angle += (event.clientX - drag.current.x) * .009;
      drag.current.x = event.clientX;
    }}
    onLostPointerCapture={() => { drag.current.pointer = null; }}
    onPointerUp={() => { drag.current.pointer = null; }}
    onPointerCancel={() => { drag.current.pointer = null; }} />;
}
