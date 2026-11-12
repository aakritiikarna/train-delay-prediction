import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'public', 'models', 'traintrack-passenger-train.glb');

globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const scene = new THREE.Scene();
scene.name = 'TrainTrack AI original passenger train';
scene.userData = { asset: 'Original procedural TrainTrack AI passenger-train illustration', license: 'CC0-1.0' };

const materials = {
  body: new THREE.MeshStandardMaterial({ color: 0xd8e3ef, metalness: 0.72, roughness: 0.28 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x8798aa, metalness: 0.82, roughness: 0.3 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.56, roughness: 0.26 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x172638, metalness: 0.68, roughness: 0.38 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x142a43, metalness: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x273446, metalness: 0.86, roughness: 0.32 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x9cadbe, metalness: 0.9, roughness: 0.22 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xb9edff, emissiveIntensity: 3.2, roughness: 0.18 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd9284c, emissive: 0x3b0711, emissiveIntensity: 0.4, roughness: 0.28 }),
};

const train = new THREE.Group();
train.name = 'TrainTrack AI passenger train';
scene.add(train);

function addMesh(name, geometry, material, position, parent = train) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(name, size, material, position, parent = train) {
  return addMesh(name, new THREE.BoxGeometry(...size), material, position, parent);
}

const bodyShape = new THREE.Shape();
bodyShape.moveTo(-7.25, 1.08);
bodyShape.lineTo(5.05, 1.08);
bodyShape.lineTo(6.48, 1.25);
bodyShape.lineTo(6.92, 1.67);
bodyShape.lineTo(6.82, 2.35);
bodyShape.lineTo(5.55, 2.94);
bodyShape.lineTo(-6.08, 2.94);
bodyShape.lineTo(-7.18, 2.34);
bodyShape.closePath();
const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, {
  depth: 2.66,
  bevelEnabled: true,
  bevelSegments: 3,
  bevelSize: 0.08,
  bevelThickness: 0.07,
  curveSegments: 4,
});
bodyGeometry.translate(0, 0, -1.33);
addMesh('Aerodynamic silver passenger coach shell', bodyGeometry, materials.body, [0, 0, 0]);

box('Continuous roof cap', [11.4, 0.16, 2.42], materials.roof, [-0.25, 2.99, 0]);
box('Blue lower side belt', [12.5, 0.12, 0.055], materials.trim, [-0.62, 1.48, 1.41]);
box('Blue far lower side belt', [12.5, 0.12, 0.055], materials.trim, [-0.62, 1.48, -1.41]);
box('Front nose accent', [0.08, 0.12, 2.3], materials.trim, [6.97, 1.52, 0]);

for (const side of [-1, 1]) {
  const z = side * 1.425;
  box(`Panoramic window band ${side}`, [10.35, 0.78, 0.045], materials.glass, [-0.55, 2.35, z]);
  for (let x = -5.25; x <= 4.0; x += 1.16) {
    box(`Window mullion ${side} ${x}`, [0.055, 0.73, 0.07], materials.roof, [x, 2.35, side * 1.47]);
  }
  for (const x of [-4.78, 0.34]) {
    box(`Sliding passenger door ${side} ${x}`, [0.72, 1.42, 0.055], materials.roof, [x, 2.02, side * 1.43]);
    box(`Door glass ${side} ${x}`, [0.48, 0.56, 0.07], materials.glass, [x, 2.31, side * 1.48]);
    box(`Door handle ${side} ${x}`, [0.04, 0.16, 0.035], materials.rim, [x + 0.25, 1.86, side * 1.51]);
  }
  box(`Roof edge rail ${side}`, [10.9, 0.055, 0.06], materials.rim, [-0.25, 3.04, side * 1.18]);
  box(`Lower side skirt ${side}`, [9.6, 0.23, 0.1], materials.roof, [-0.1, 1.1, side * 1.34]);
}

for (const x of [-3.6, -1.3, 1.05, 3.35]) {
  box(`Roof air conditioner ${x}`, [1.28, 0.23, 1.25], materials.roof, [x, 3.19, 0]);
  for (const fin of [-0.36, -0.12, 0.12, 0.36]) {
    box(`Roof ventilation fin ${x} ${fin}`, [0.88, 0.035, 0.04], materials.dark, [x, 3.32, fin]);
  }
}

for (const x of [-5.45, -1.95, 2.05, 5.15]) {
  for (const side of [-1, 1]) {
    const axle = new THREE.Group();
    axle.name = `WheelSpin-${x}-${side}`;
    axle.position.set(x, 0.73, side * 1.22);
    train.add(axle);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.19, 28), materials.wheel);
    wheel.name = `Steel wheel ${x} ${side}`;
    wheel.rotation.x = Math.PI / 2;
    wheel.castShadow = true;
    axle.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.205, 20), materials.rim);
    hub.name = `Wheel hub ${x} ${side}`;
    hub.rotation.x = Math.PI / 2;
    hub.position.z = side * 0.015;
    axle.add(hub);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 16), materials.dark);
    center.name = `Axle cap ${x} ${side}`;
    center.rotation.x = Math.PI / 2;
    axle.add(center);
  }
  box(`Wheel bogie ${x}`, [2.05, 0.18, 1.72], materials.dark, [x, 0.98, 0]);
}

box('Main undercarriage beam', [10.8, 0.26, 1.8], materials.dark, [-0.25, 0.89, 0]);
box('Front coupler mount', [0.7, 0.28, 0.52], materials.dark, [6.7, 0.88, 0]);
box('Front coupler', [0.52, 0.12, 0.24], materials.rim, [7.03, 0.74, 0]);
box('Rear coupler mount', [0.7, 0.28, 0.52], materials.dark, [-7.15, 0.88, 0]);
box('Rear coupler', [0.52, 0.12, 0.24], materials.rim, [-7.48, 0.74, 0]);

const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.68), materials.glass);
frontGlass.name = 'Wide driver windscreen';
frontGlass.position.set(6.98, 2.39, 0);
frontGlass.rotation.y = Math.PI / 2;
train.add(frontGlass);
box('Windscreen central divider', [0.055, 0.72, 0.06], materials.roof, [7.0, 2.39, 0]);

for (const side of [-1, 1]) {
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), materials.lamp);
  lamp.name = `LED headlight ${side}`;
  lamp.position.set(6.98, 1.82, side * 0.89);
  train.add(lamp);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), materials.red);
  marker.name = `Red marker light ${side}`;
  marker.position.set(6.99, 1.78, side * 1.14);
  train.add(marker);
}

box('Front bumper', [0.3, 0.16, 1.55], materials.dark, [6.98, 1.16, 0]);

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  trs: true,
  animations: [],
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, Buffer.from(result));
console.log(`Wrote original passenger train GLB (${(result.byteLength / 1024).toFixed(1)} KiB).`);
