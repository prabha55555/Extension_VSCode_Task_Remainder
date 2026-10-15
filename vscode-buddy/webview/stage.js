import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildCharacter } from './characters.js';
import { THEMES } from './themes.js';

const TARGET_HEIGHT = 2.3;

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}

/** Scale a model to TARGET_HEIGHT, stand it on y=0 and center it. Returns a wrapper group. */
function fit(object, height = TARGET_HEIGHT) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = height / (size.y || 1);
  const holder = new THREE.Group();
  object.position.set(-center.x, -box.min.y, -center.z);
  const inner = new THREE.Group();
  inner.add(object);
  inner.scale.setScalar(k);
  holder.add(inner);
  return holder;
}

const WHITE = new THREE.Color(0xffffff);

/** Materials that can take a coloured glow (ones with their own glow are left alone). */
function collectGlow(root) {
  const out = [];
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.emissive && !m.emissiveMap && m.emissive.getHex() === 0 && !out.some((g) => g.m === m)) out.push({ m });
    }
  });
  return out;
}

/** A soft, blurred copy of the picture a little way behind it; it slides against the figure for parallax depth. */
function backdrop(src, W, H, y) {
  const c = document.createElement('canvas');
  c.width = 160; c.height = Math.max(32, Math.round(160 * (H / W)));
  const g = c.getContext('2d');
  g.filter = 'blur(7px) saturate(1.5)';
  g.drawImage(src, 10, 10, c.width - 20, c.height - 20);
  g.filter = 'none';
  const fade = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, H * 1.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.45, depthWrite: false }));
  mesh.position.set(0, y, -0.8);
  mesh.userData.y0 = y;
  return mesh;
}

function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode the image'));
    img.src = src;
  });
}

/**
 * Find the figure in a picture. A PNG with transparency already has its outline; for an ordinary photo the
 * plain background is flood-filled away from the borders. Returns { canvas } with the background made
 * transparent, or null if no clear figure could be found (busy background) so the caller can show a photo card.
 */
function cutout(img) {
  const k = Math.min(1, 320 / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * k));
  const h = Math.max(2, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const image = g.getImageData(0, 0, w, h);
  const d = image.data;

  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) { hasAlpha = true; break; }
  if (!hasAlpha) {
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    let r = 0, gg = 0, b = 0;
    for (const p of border) { r += d[p * 4]; gg += d[p * 4 + 1]; b += d[p * 4 + 2]; }
    r /= border.length; gg /= border.length; b /= border.length;
    const dist = (p) => Math.hypot(d[p * 4] - r, d[p * 4 + 1] - gg, d[p * 4 + 2] - b);
    const TOL = 52;

    const gone = new Uint8Array(w * h);
    const stack = border.filter((p) => dist(p) < TOL);
    stack.forEach((p) => { gone[p] = 1; });
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !gone[q] && dist(q) < TOL) { gone[q] = 1; stack.push(q); }
      }
    }
    // shave one pixel off the edge so no background-coloured halo is left
    const edge = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!gone[p] && (gone[p - 1] || gone[p + 1] || gone[p - w] || gone[p + w])) edge[p] = 1;
    }
    let removed = 0;
    for (let p = 0; p < w * h; p++) if (gone[p] || edge[p]) { d[p * 4 + 3] = 0; removed++; }
    const ratio = removed / (w * h);
    if (ratio < 0.03 || ratio > 0.85) return null;      // nothing to separate, or the background was not plain
    g.putImageData(image, 0, 0);
  }
  return { canvas, data: d, w, h };
}

/** Blow the silhouette up into a closed, puffy 3D shape: front and back skins that meet at the outline. */
function puffyFigure({ canvas, data, w, h }) {
  const worldH = TARGET_HEIGHT - 0.2;
  const k = Math.min(1, 3.2 / (worldH * (w / h)));
  const H = worldH * k, W = H * (w / h);
  const gw = w >= h ? 96 : Math.max(24, Math.round(96 * w / h));
  const gh = h >= w ? 96 : Math.max(24, Math.round(96 * h / w));

  // inside-ness of each grid point, blurred so it rises smoothly from the outline to the middle
  let m = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const px = Math.min(w - 1, Math.round((i / (gw - 1)) * (w - 1)));
    const py = Math.min(h - 1, Math.round((j / (gh - 1)) * (h - 1)));
    m[j * gw + i] = data[(py * w + px) * 4 + 3] > 128 ? 1 : 0;
  }
  for (let pass = 0; pass < 10; pass++) {
    const n = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && ii < gw && jj >= 0 && jj < gh) { s += m[jj * gw + ii]; c++; }
      }
      n[j * gw + i] = s / c;
    }
    m = n;
  }
  const depth = Math.min(W, H) * 0.2;
  const z = new Float32Array(gw * gh);
  for (let i = 0; i < z.length; i++) z[i] = Math.pow(Math.max(0, (m[i] - 0.5) * 2), 0.55) * depth;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const skin = (sign, side, color) => {
    const geo = new THREE.PlaneGeometry(W, H, gw - 1, gh - 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, z[i] * sign);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side, color, roughness: 0.8, metalness: 0 }));
  };
  const root = new THREE.Group();
  root.add(skin(1, THREE.FrontSide, 0xd8d8d8), skin(-1, THREE.BackSide, 0x9a9fb8));
  const holder = new THREE.Group();
  root.position.y = H / 2 + 0.05;
  holder.add(root);
  holder.userData.backdrop = backdrop(canvas, W, H, root.position.y);
  holder.add(holder.userData.backdrop);
  return holder;
}

/** Fallback for pictures with a busy background: a rounded "polaroid" slab. */
function photoCard(img) {
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const h = TARGET_HEIGHT - 0.3;
  const w = Math.min(h * (img.width / img.height), 3.4);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w + 0.2, h + 0.2, 0.1, 4, 0.08),
    new THREE.MeshToonMaterial({ color: 0xffffff }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  pic.position.z = 0.052;
  const root = new THREE.Group();
  root.add(slab, pic);
  root.position.y = h / 2 + 0.1;
  const holder = new THREE.Group();
  holder.add(root);
  holder.userData.backdrop = backdrop(img, w, h, root.position.y);
  holder.add(holder.userData.backdrop);
  return holder;
}

const ENTER_DUR = 1.15;
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const rand = (a, b) => a + Math.random() * (b - a);

const spriteTextures = new Map();
/** Emoji / short text as a texture, drawn once and reused by every particle that uses it. */
function glyphTexture(str) {
  if (spriteTextures.has(str)) return spriteTextures.get(str);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (/^[\x20-\x7e]+$/.test(str)) {
    g.font = 'bold 56px ui-monospace, Consolas, monospace';
    g.shadowColor = 'rgba(160,130,255,.9)'; g.shadowBlur = 14;
    g.fillStyle = '#e6dcff';
  } else {
    g.font = '88px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  }
  g.fillText(str, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  spriteTextures.set(str, tex);
  return tex;
}

class Particles {
  constructor(scene) { this.scene = scene; this.list = []; }

  emit(glyph, pos, vel, { life = 1.6, size = 0.34, gravity = 0, spin = 0 } = {}) {
    if (this.list.length > 90) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(glyph), transparent: true, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(size * 0.01);
    this.scene.add(s);
    this.list.push({ s, vel, life, max: life, size, gravity, spin });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); this.list.splice(i, 1); continue; }
      p.vel.y += p.gravity * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.material.rotation += p.spin * dt;
      const age = p.max - p.life;
      p.s.material.opacity = Math.min(1, p.life / 0.5, age / 0.12);
      p.s.scale.setScalar(p.size * Math.min(1, 0.2 + age * 4));
    }
  }
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,.22)');
  grad.addColorStop(0.78, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.86, 'rgba(255,255,255,.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Stage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.5, 7.2);
    this.camera.lookAt(0, 1.75, 0);       // aim above the character so it sits low and leaves room for the speech bubble

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93b8, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(2.5, 4, 5);
    this.scene.add(sun);
    this.rim = new THREE.DirectionalLight(0x9db8ff, 1.4);     // coloured by the task theme while a reminder shows
    this.rim.position.set(-4, 2, -3);
    this.scene.add(this.rim);
    this.cursorLight = new THREE.PointLight(0xffffff, 0, 14);  // a highlight that follows the mouse
    this.cursorLight.position.set(0, 2, 3.5);
    this.scene.add(this.cursorLight);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.scene.add(this.shadow);

    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.scene.add(this.ring);

    this.fx = new Particles(this.scene);
    this.holder = null;       // current character (fitted wrapper)
    this.rig = null;          // { head, armL, armR, eyes } for built-in characters
    this.mixer = null;        // GLB animations
    this.actions = null;      // { idle, hello } GLB clips
    this.glowMats = [];
    this.kind = 'builtin';
    this.token = 0;           // guards against late async loads
    this.loading = 0;
    this.excited = false;
    this.theme = THEMES.task;
    this.themeColor = new THREE.Color(THEMES.task.color);
    this.enter = null;        // entrance flight from the left edge
    this.leaving = null;      // exit flight to the left edge
    this.away = false;        // parked off-screen after leaving
    this.squashT = 1; this.shake = 0; this.pulse = 0;
    this.emitAcc = 0; this.nextSpin = 0;
    this.hover = false;
    this.pointer = { x: 0, y: 0 };
    this.spin = 0; this.spinTarget = 0;
    this.jumpT = -1;
    this.blinkAt = 2;
    this.clock = new THREE.Clock();
    this.readImage = () => Promise.reject(new Error('no image source'));   // set by the webview: id -> data: URI

    this.bindPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let drag = null;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.hover = true;
      if (drag) {
        this.spinTarget += (e.clientX - drag.x) * 0.012;
        drag.x = e.clientX;
        drag.moved = true;
      }
    });
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, moved: false }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => {
      if (drag && !drag.moved) { this.jump(); this.burst(10); }
      drag = null;
      this.spinTarget = Math.round(this.spinTarget / (Math.PI * 2)) * Math.PI * 2;   // ease back to facing front
    });
    el.addEventListener('pointerleave', () => { this.pointer.x = 0; this.pointer.y = 0; this.hover = false; });
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // keep the whole character in frame on narrow sidebars
    this.camera.position.z = 7.2 * Math.max(1, 0.9 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  clear() {
    if (this.holder) { this.scene.remove(this.holder); disposeTree(this.holder); }
    this.holder = null; this.rig = null; this.mixer = null; this.actions = null; this.glowMats = [];
  }

  /** desc: { id, kind: 'builtin'|'glb'|'image', uri? } */
  async setCharacter(desc) {
    const token = ++this.token;
    this.loading++;
    try {
      let result;
      if (desc.kind === 'glb') result = await this.loadGlb(desc.uri);
      else if (desc.kind === 'image') result = await this.loadImage(desc);
      else result = this.loadBuiltin(desc.id);
      if (token !== this.token) { disposeTree(result.holder); return; }
      this.clear();
      this.holder = result.holder; this.rig = result.rig || null; this.mixer = result.mixer || null; this.actions = result.actions || null;
      this.kind = desc.kind;
      this.glowMats = collectGlow(this.holder);
      this.scene.add(this.holder);
      this.syncClips();
      if (this.excited) this.startEnter(); else this.jump();
    } catch (err) {
      if (token !== this.token) return;
      console.error(err);
      this.setCharacter({ id: 'bolt', kind: 'builtin' });
      throw err;
    } finally {
      this.loading--;
    }
  }

  loadBuiltin(id) {
    const rig = buildCharacter(id);
    return { holder: fit(rig.root), rig };
  }

  loadGlb(uri) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(uri, (gltf) => {
        const holder = fit(gltf.scene);
        let mixer = null, actions = null;
        if (gltf.animations && gltf.animations.length) {
          mixer = new THREE.AnimationMixer(gltf.scene);
          const find = (re) => gltf.animations.find((a) => re.test(a.name));
          const idle = find(/idle|stand|breath/i) || gltf.animations[0];
          const hello = find(/wave|hello|\bhi\b|greet|jump|dance|celebrat|happy|cheer|talk|attention/i);
          actions = { idle: mixer.clipAction(idle), hello: hello && hello !== idle ? mixer.clipAction(hello) : null };
          actions.idle.play();
        }
        resolve({ holder, mixer, actions });
      }, undefined, (e) => reject(new Error(e && e.message ? e.message : 'invalid or unsupported .glb')));
    });
  }

  async loadImage(desc) {
    // The extension host reads the file and sends it over as a data: URI, which keeps the canvas untainted.
    const img = await decodeImage(await this.readImage(desc.id));
    const cut = cutout(img);
    return { holder: cut ? puffyFigure(cut) : photoCard(img) };
  }

  /** A GLB's own animation: its hello/wave/jump clip while a reminder shows, otherwise its idle clip. */
  syncClips() {
    const a = this.actions;
    if (!a) return;
    if (this.excited && a.hello) {
      a.hello.reset().fadeIn(0.3).play();
      a.idle.fadeOut(0.3);
    } else {
      a.idle.reset().fadeIn(0.3).play();
      if (a.hello) a.hello.fadeOut(0.3);
      a.idle.timeScale = this.excited ? 1.7 : 1;
    }
  }

  setExcited(on, theme = 'task') {
    if (on === this.excited) return;
    this.excited = on;
    if (on) {
      this.theme = THEMES[theme] || THEMES.task;
      this.themeColor.setHex(this.theme.color);
      this.rim.color.copy(this.themeColor);
      if (!this.loading) this.startEnter();       // otherwise it starts when the character has loaded
    } else {
      this.enter = null;
      this.rim.color.setHex(0x9db8ff);
      this.burst(10);
      this.leaving = { t: 0 };
    }
    this.syncClips();
  }

  /** Bring a character that has left back into view. */
  comeBack() {
    if (this.away || this.leaving) this.startEnter();
  }

  startEnter() {
    this.leaving = null; this.away = false;
    this.enter = { t: 0, trail: 0 };
    this.nextSpin = 0;
    this.jumpT = -1;
  }

  /** Where particles come from: the middle of the character. */
  center() { return new THREE.Vector3(this.holder ? this.holder.position.x : 0, 1.2, 0.4); }

  burst(n) {
    const glyphs = this.theme.emoji;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(1.2, 3);
      this.fx.emit(glyphs[i % glyphs.length], this.center(),
        new THREE.Vector3(Math.cos(a) * sp, rand(1.2, 3.2), rand(-0.3, 1.2)),
        { life: rand(1.1, 1.9), size: rand(0.28, 0.46), gravity: -2.6, spin: rand(-2, 2) });
    }
  }

  landed() {
    this.squashT = 0; this.shake = 0.09; this.pulse = 1;
    this.burst(18);
    this.jump();
  }

  jump() { this.jumpT = 0; }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    if (this.holder) this.animate(t, dt);
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  animate(t, dt) {
    const h = this.holder;
    const m = this.theme.motion;
    const image = this.kind === 'image';
    const bob = Math.sin(t * 2.2) * 0.035;

    // ---- entrance: fly in from the left edge on an arc, spinning, then land with a squash
    let ox = 0, oy = 0, spinIn = 0, stretch = 1, grow = 1;
    if (this.enter) {
      const e = this.enter;
      e.t += dt;
      const p = Math.min(1, e.t / ENTER_DUR);
      ox = -4.4 * (1 - easeOutBack(p));
      oy = Math.sin(p * Math.PI) * 0.95 * (1 - p * 0.5);
      spinIn = -(1 - easeOutCubic(p)) * Math.PI * 2;
      stretch = 1 + (1 - p) * 0.22;
      grow = 0.6 + 0.4 * Math.min(1, p * 1.6);
      e.trail -= dt;
      if (e.trail <= 0 && p < 0.95) {                 // sparkle trail
        e.trail = 0.04;
        this.fx.emit(this.theme.emoji[(Math.random() * this.theme.emoji.length) | 0],
          new THREE.Vector3(ox - 0.3, 0.8 + Math.random() * 1.2 + oy, 0.2),
          new THREE.Vector3(rand(-1.2, -0.2), rand(-0.3, 0.6), 0), { life: 0.9, size: rand(0.2, 0.34), spin: rand(-3, 3) });
      }
      if (p >= 1) { this.enter = null; this.landed(); }
    }

    // ---- exit: spin and shrink out through the left edge, then wait there
    if (this.leaving) {
      const l = this.leaving;
      l.t += dt;
      const p = Math.min(1, l.t / 0.6);
      ox = -5.2 * p * p;
      oy = Math.sin(p * Math.PI) * 0.5;
      spinIn = p * Math.PI * 1.5;
      grow = 1 - 0.3 * p;
      if (p >= 1) { this.leaving = null; this.away = true; }
    } else if (this.away && !this.enter) ox = -6;

    // ---- hops
    let hop = 0;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      hop = Math.sin(Math.min(this.jumpT / 0.5, 1) * Math.PI) * (m === 'bounce' && this.excited ? 0.55 : 0.35);
      if (this.jumpT > 0.5) this.jumpT = this.excited && !this.enter ? 0 : -1;   // keep hopping while a reminder is showing
    }
    this.squashT += dt;
    const squash = this.squashT < 0.4 ? Math.sin((this.squashT / 0.4) * Math.PI) * 0.2 : 0;

    h.position.x = ox;
    h.position.y = bob + hop + oy;
    this.shadow.position.x = ox;
    this.shadow.scale.setScalar(Math.max(0.2, 1 - (bob + hop + oy) * 0.55));

    // ---- spin / sway / task-specific motion
    if (this.excited && !this.enter && m === 'spin' && t > this.nextSpin) { this.spinTarget += Math.PI * 2; this.nextSpin = t + 2.8; }
    this.spin += (this.spinTarget - this.spin) * Math.min(1, dt * 8);
    const sway = image ? Math.sin(t * 1.1) * 0.12 : Math.sin(t * 0.9) * 0.06;
    h.rotation.y = this.spin + spinIn + sway + this.pointer.x * (image ? 0.55 : 0.2);
    h.rotation.x = image ? this.pointer.y * 0.2 : 0;
    h.rotation.z = image ? Math.sin(t * 1.3) * 0.02 : 0;
    if (this.excited && !this.enter) {
      if (m === 'wiggle') h.rotation.z = Math.sin(t * 9) * 0.1;
      else if (m === 'shake') h.rotation.z = Math.sin(t * 3) > 0.3 ? Math.sin(t * 38) * 0.1 : 0;
      else if (m === 'sway') h.rotation.z = Math.sin(t * 2) * 0.12;
      else if (m === 'nod') h.rotation.x += Math.sin(t * 6) * 0.07;
    }
    const breathe = 1 + Math.sin(t * 2.2) * 0.012;
    h.scale.set(grow * stretch * (1 + squash) / breathe, grow * breathe * (1 - squash) / stretch, grow * (1 + squash) / breathe);

    // ---- parallax layer behind a 2D picture
    const back = h.userData.backdrop;
    if (back) {
      back.position.x = -this.pointer.x * 0.5;
      back.position.y = back.userData.y0 - this.pointer.y * 0.3;
      back.material.opacity = 0.45 + (this.excited ? 0.2 + Math.sin(t * 4) * 0.08 : 0);
    }

    if (this.mixer) this.mixer.update(dt);

    // ---- built-in character rig
    if (this.rig) {
      const { head, armL, armR, eyes } = this.rig;
      head.rotation.y += (this.pointer.x * 0.55 - head.rotation.y) * Math.min(1, dt * 6);
      head.rotation.x += (this.pointer.y * 0.3 - head.rotation.x) * Math.min(1, dt * 6);
      head.rotation.z = Math.sin(t * 1.3) * 0.03;
      const wave = this.excited ? 2.5 + Math.sin(t * 11) * 0.45 : 0.15 + Math.sin(t * 2.2) * 0.04;
      armR.rotation.z += (wave - armR.rotation.z) * Math.min(1, dt * 10);
      armL.rotation.z += (-0.15 - Math.sin(t * 2.2 + 1) * 0.04 - armL.rotation.z) * Math.min(1, dt * 10);
      if (t > this.blinkAt) {
        const k = (t - this.blinkAt) / 0.14;
        const s = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.9 : 1;
        eyes.forEach((e) => { e.userData.sy = e.userData.sy || e.scale.y; e.scale.y = e.userData.sy * s; });
        if (k >= 1) this.blinkAt = t + 2.5 + Math.random() * 3;
      }
    }

    // ---- theme glow on whatever is loaded (materials that already glow are skipped)
    const glow = this.excited ? 0.1 + 0.08 * Math.sin(t * 5) : 0;
    for (const g of this.glowMats) {
      g.m.emissive.copy(this.themeColor);
      g.m.emissiveIntensity = glow;
    }

    // ---- floor ring, cursor light, camera punch
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.ring.material.color.copy(this.themeColor);
    this.ring.material.opacity = this.excited ? 0.5 + Math.sin(t * 4) * 0.12 + this.pulse * 0.4 : 0.1;
    this.ring.scale.setScalar(0.85 + this.pulse * 0.5 + (this.excited ? Math.sin(t * 4) * 0.04 : 0));
    this.cursorLight.color.copy(this.excited ? this.themeColor : WHITE);
    this.cursorLight.position.set(this.pointer.x * 3.2, 1.8 - this.pointer.y * 2.2, 3.5);
    this.cursorLight.intensity += ((this.hover ? 22 : 0) - this.cursorLight.intensity) * Math.min(1, dt * 8);
    this.shake *= Math.exp(-dt * 7);
    this.camera.position.x = Math.sin(t * 70) * this.shake;
    this.camera.fov = 30 + this.shake * 40;
    this.camera.updateProjectionMatrix();

    // ---- ambient particles while a reminder is showing
    if (this.excited && !this.enter) {
      this.emitAcc += dt;
      const every = this.theme.rain ? 0.09 : 0.28;
      while (this.emitAcc > every) {
        this.emitAcc -= every;
        const g = this.theme.emoji[(Math.random() * this.theme.emoji.length) | 0];
        if (this.theme.rain) {
          this.fx.emit(g, new THREE.Vector3(rand(-1.9, 1.9), 4.2, rand(-0.5, 1)), new THREE.Vector3(0, -rand(0.6, 1.4), 0),
            { life: 3, size: rand(0.18, 0.32), gravity: -1.2 });
        } else {
          this.fx.emit(g, new THREE.Vector3(rand(-1.2, 1.2), 0.3, rand(-0.4, 0.8)), new THREE.Vector3(rand(-0.3, 0.3), rand(0.7, 1.3), 0),
            { life: 2.2, size: rand(0.2, 0.34), spin: rand(-1, 1) });
        }
      }
    }
  }
}
