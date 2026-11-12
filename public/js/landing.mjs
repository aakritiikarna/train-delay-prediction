const MODEL_URL = '/models/traintrack-passenger-train.glb';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setupNavigation() {
  const host = document.querySelector('#siteNav');
  if (!host) return;

  const enhance = () => {
    const inner = host.querySelector('.nav-inner');
    const nav = inner?.querySelector('nav');
    const links = nav?.querySelector('.nav-links');
    if (!inner || !nav || !links) return;

    links.id = 'landingNavigation';
    const platformLink = document.createElement('a');
    platformLink.href = '#platform';
    platformLink.textContent = 'Platform';
    links.insertBefore(platformLink, links.querySelector('a[href="/passenger"]'));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Toggle navigation');
    toggle.setAttribute('aria-controls', links.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span>';
    inner.insertBefore(toggle, nav);

    const closeMenu = () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    });
    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    const updateHeader = () => host.classList.toggle('is-scrolled', window.scrollY > 24);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  };

  if (window.TT?.ready) {
    window.TT.ready.then(enhance);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.TT?.ready) window.TT.ready.then(enhance);
      else enhance();
    }, { once: true });
  }
}

function showFallback(message) {
  const loader = document.querySelector('#sceneLoader');
  const loaderMessage = document.querySelector('#loaderMessage');
  const progress = document.querySelector('#modelProgress');
  const orbit = loader?.querySelector('.loader-orbit');
  if (loaderMessage) loaderMessage.textContent = '3D scene unavailable';
  if (progress) progress.hidden = true;
  if (orbit) orbit.hidden = true;
  const fallbackMessage = document.querySelector('#fallbackMessage');
  if (fallbackMessage && message) fallbackMessage.textContent = message;
  const fallback = document.querySelector('#sceneFallback');
  if (fallback) fallback.hidden = false;
  const canvas = document.querySelector('#trainCanvas');
  if (canvas) canvas.hidden = true;
}

function hideLoader() {
  const loader = document.querySelector('#sceneLoader');
  if (!loader) return;
  loader.classList.add('is-hidden');
  window.setTimeout(() => { loader.hidden = true; }, 350);
}

function setupLandingAnimations() {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  if (reducedMotion) return;

  gsap.from('.hero-copy > *', {
    y: 22,
    autoAlpha: 0,
    duration: 0.85,
    stagger: 0.11,
    ease: 'power2.out',
    delay: 0.12,
  });

  document.querySelectorAll('.reveal').forEach((element) => {
    gsap.fromTo(element, { y: 24, autoAlpha: 0 }, {
      y: 0,
      autoAlpha: 1,
      duration: 0.75,
      ease: 'power2.out',
      scrollTrigger: { trigger: element, start: 'top 88%', once: true },
    });
  });
}

async function setupTrainScene() {
  const stage = document.querySelector('#trainScene');
  const canvas = document.querySelector('#trainCanvas');
  if (!stage || !canvas) return;

  try {
    const [{ default: THREE }, { GLTFLoader }] = await Promise.all([
      import('/vendor/three/three.module.js').then((module) => ({ default: module })),
      import('/vendor/three/loaders/GLTFLoader.js'),
    ]);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: window.innerWidth > 640,
      powerPreference: 'low-power',
    });
    const mobile = window.matchMedia('(max-width: 640px)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x080f1d, 40, 100);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 150);
    const cameraPose = {
      x: mobile ? 8 : 13.2,
      y: mobile ? 8.2 : 7.1,
      z: mobile ? 29 : 18,
      targetX: 2.6,
      targetY: 1.35,
    };
    const pointerPose = { x: 0, y: 0 };

    scene.add(new THREE.HemisphereLight(0xb9dcff, 0x101827, 2.05));
    const keyLight = new THREE.DirectionalLight(0xe4f3ff, 3.1);
    keyLight.position.set(-5, 14, 11);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x3da9ff, 2.3);
    rimLight.position.set(1, 8, -12);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 100),
      new THREE.MeshStandardMaterial({ color: 0x111b29, metalness: 0.28, roughness: 0.9 }),
    );
    floor.name = 'Illustrative track bed';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    const trackGroup = new THREE.Group();
    trackGroup.name = 'Illustrative railway tracks';
    scene.add(trackGroup);
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x65768b, metalness: 0.86, roughness: 0.32 });
    const railGeometry = new THREE.BoxGeometry(86, 0.105, 0.11);
    for (const z of [-1.22, 1.22]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.position.set(0, 0.12, z);
      rail.castShadow = false;
      rail.receiveShadow = false;
      trackGroup.add(rail);
    }

    const sleeperGeometry = new THREE.BoxGeometry(0.34, 0.1, 3.8);
    const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x293547, metalness: 0.24, roughness: 0.88 });
    const sleeperCount = 64;
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
    const sleeperTransform = new THREE.Object3D();
    for (let index = 0; index < sleeperCount; index += 1) {
      sleeperTransform.position.set(-36 + index * 1.15, 0.055, 0);
      sleeperTransform.updateMatrix();
      sleepers.setMatrixAt(index, sleeperTransform.matrix);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.castShadow = false;
    sleepers.receiveShadow = false;
    trackGroup.add(sleepers);

    const starPositions = new Float32Array(420);
    let seed = 41;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let index = 0; index < starPositions.length; index += 3) {
      starPositions[index] = (random() - 0.5) * 90;
      starPositions[index + 1] = 4 + random() * 25;
      starPositions[index + 2] = (random() - 0.5) * 62;
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: 0x8dbbff, size: 0.075, transparent: true, opacity: 0.48, sizeAttenuation: true }),
    );
    stars.name = 'Subtle scene lights';
    scene.add(stars);

    let train;
    let trainReady = false;
    let frameRequested = false;
    const render = () => {
      if (frameRequested || !renderer || !trainReady) return;
      frameRequested = true;
      window.requestAnimationFrame(() => {
        frameRequested = false;
        const width = Math.max(1, stage.clientWidth);
        const height = Math.max(1, stage.clientHeight);
        camera.aspect = width / height;
        camera.position.set(cameraPose.x + pointerPose.x, cameraPose.y + pointerPose.y, cameraPose.z);
        camera.lookAt(cameraPose.targetX, cameraPose.targetY, 0);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
      });
    };

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        train = gltf.scene;
        train.name = 'Interactive TrainTrack AI passenger train';
        train.position.set(-26, 0, 0);
        train.scale.setScalar(0.92);
        train.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
          object.frustumCulled = true;
        });
        scene.add(train);
        const wheels = [];
        train.traverse((object) => {
          if (object.name.startsWith('WheelSpin-')) wheels.push(object);
        });
        for (const side of [-1, 1]) {
          const headlight = new THREE.PointLight(0xc9f3ff, 15, 22, 2);
          headlight.position.set(6.6, 1.8, side * 0.8);
          train.add(headlight);
        }

        trainReady = true;
        hideLoader();
        const renderResize = new ResizeObserver(render);
        renderResize.observe(stage);
        window.addEventListener('orientationchange', render, { passive: true });

        if (window.gsap && !reducedMotion) {
          const entrance = window.gsap.timeline({ onUpdate: render, onComplete: render });
          entrance.to(train.position, { x: 2.6, duration: 2.35, ease: 'power3.out' }, 0);
          wheels.forEach((wheel) => {
            entrance.to(wheel.rotation, { z: -Math.PI * 3, duration: 2.2, ease: 'power2.out' }, 0);
          });
          entrance.fromTo(train.rotation, { y: -0.16 }, { y: 0.035, duration: 2.35, ease: 'power2.out' }, 0);
        } else {
          train.position.x = 2.6;
          render();
        }

        if (window.ScrollTrigger && window.gsap && !reducedMotion) {
          window.gsap.to(train.position, {
            x: 4.1,
            duration: 1,
            ease: 'none',
            onUpdate: render,
            scrollTrigger: { trigger: '.cinematic-hero', start: 'top top', end: 'bottom top', scrub: 1 },
          });
          window.gsap.to(cameraPose, {
            x: cameraPose.x + 1.7,
            y: cameraPose.y + 0.5,
            z: cameraPose.z + 2.3,
            duration: 1,
            ease: 'none',
            onUpdate: render,
            scrollTrigger: { trigger: '.cinematic-hero', start: 'top top', end: 'bottom top', scrub: 1 },
          });
        }
      },
      (event) => {
        const progress = document.querySelector('#modelProgress');
        if (progress && event.total > 0) progress.value = event.loaded / event.total;
        const message = document.querySelector('#loaderMessage');
        if (message && event.total > 0) message.textContent = `Loading train model ${Math.round((event.loaded / event.total) * 100)}%`;
      },
      (error) => {
        console.warn('Train model could not be loaded; showing the accessible fallback.', error);
        showFallback();
      },
    );

    const hero = document.querySelector('.cinematic-hero');
    if (hero && window.gsap && !reducedMotion && window.matchMedia('(pointer: fine)').matches) {
      hero.addEventListener('pointermove', (event) => {
        if (event.target.closest('a, button')) return;
        const bounds = hero.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.85;
        const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * -0.5;
        window.gsap.to(pointerPose, { x, y, duration: 0.8, ease: 'power2.out', onUpdate: render });
      }, { passive: true });
      hero.addEventListener('pointerleave', () => {
        window.gsap.to(pointerPose, { x: 0, y: 0, duration: 0.9, ease: 'power2.out', onUpdate: render });
      }, { passive: true });
    }
  } catch (error) {
    console.warn('Interactive train scene is unavailable; showing the accessible fallback.', error);
    showFallback('The interactive 3D scene is unavailable in this browser. You can still explore all TrainTrack AI features.');
  }
}

setupNavigation();
setupLandingAnimations();
setupTrainScene();
