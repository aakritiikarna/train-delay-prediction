'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');
const threeRoot = path.join(root, 'node_modules', 'three');
const gsapRoot = path.join(root, 'node_modules', 'gsap');

function copyThreeModule(source, destination) {
  const contents = fs.readFileSync(source, 'utf8').replaceAll("from 'three'", "from '../three.module.js'");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

fs.mkdirSync(path.join(vendor, 'three', 'loaders'), { recursive: true });
fs.mkdirSync(path.join(vendor, 'three', 'utils'), { recursive: true });
fs.copyFileSync(path.join(threeRoot, 'build', 'three.module.js'), path.join(vendor, 'three', 'three.module.js'));
fs.copyFileSync(path.join(threeRoot, 'build', 'three.core.js'), path.join(vendor, 'three', 'three.core.js'));
copyThreeModule(path.join(threeRoot, 'examples', 'jsm', 'loaders', 'GLTFLoader.js'), path.join(vendor, 'three', 'loaders', 'GLTFLoader.js'));
copyThreeModule(path.join(threeRoot, 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'), path.join(vendor, 'three', 'utils', 'BufferGeometryUtils.js'));
copyThreeModule(path.join(threeRoot, 'examples', 'jsm', 'utils', 'SkeletonUtils.js'), path.join(vendor, 'three', 'utils', 'SkeletonUtils.js'));
fs.copyFileSync(path.join(threeRoot, 'LICENSE'), path.join(vendor, 'THREE-LICENSE.txt'));
fs.copyFileSync(path.join(gsapRoot, 'dist', 'gsap.min.js'), path.join(vendor, 'gsap.min.js'));
fs.copyFileSync(path.join(gsapRoot, 'dist', 'ScrollTrigger.min.js'), path.join(vendor, 'ScrollTrigger.min.js'));
fs.writeFileSync(
  path.join(vendor, 'GSAP-LICENSE.txt'),
  'GSAP is distributed under its Standard (no-charge) license. License terms: https://gsap.com/standard-license.\n'
);

console.log('Locally vendored Three.js, GLTFLoader, GSAP and ScrollTrigger.');
