// Built-in 3D characters, built from primitives with a toon (cel-shaded) look + ink outlines.
// Every builder returns { root, head, armL, armR, eyes[] } — the stage animates those parts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const INK = 0x1c1b33;
const OUTLINE = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
const glow = (color) => toon(color, { emissive: color, emissiveIntensity: 0.9 });

function part(geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0], outline = true } = {}) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? toon(material) : material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  if (outline) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(1.05);
    m.add(o);
  }
  return m;
}

const sphere = (r) => new THREE.SphereGeometry(r, 32, 24);
const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 8, 16);
const group = (x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };

function eye(x, y, z, r = 0.08) {
  const g = group(x, y, z);
  g.add(part(sphere(r), INK, { outline: false }));
  g.add(part(sphere(r * 0.38), 0xffffff, { pos: [r * 0.32, r * 0.38, r * 0.78], outline: false }));
  return g;
}

/** Arm hanging down from a shoulder pivot; rotate the returned group on z to wave. */
function arm(x, y, color, handColor = color, len = 0.45, r = 0.11) {
  const g = group(x, y, 0);
  g.add(part(capsule(r, len), color, { pos: [0, -len / 2 - r * 0.4, 0] }));
  g.add(part(sphere(r * 1.25), handColor, { pos: [0, -len - r * 0.9, 0] }));
  return g;
}

// ---------------------------------------------------------------- Bolt (robot)
function bolt() {
  const root = group();
  const orange = 0xff8a3d, steel = 0xdde6f2, dark = 0x10142a;
  root.add(part(new RoundedBoxGeometry(0.46, 0.5, 0.4, 3, 0.1), 0x4a5578, { pos: [-0.24, 0.3, 0] }));
  root.add(part(new RoundedBoxGeometry(0.46, 0.5, 0.4, 3, 0.1), 0x4a5578, { pos: [0.24, 0.3, 0] }));
  root.add(part(new RoundedBoxGeometry(0.95, 0.85, 0.7, 4, 0.2), orange, { pos: [0, 0.95, 0] }));
  root.add(part(new RoundedBoxGeometry(0.46, 0.3, 0.06, 3, 0.03), glow(0x2de2e6), { pos: [0, 0.95, 0.35], outline: false }));
  root.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), steel, { pos: [0, 1.42, 0] }));

  const head = group(0, 1.9, 0);
  head.add(part(new RoundedBoxGeometry(1.15, 0.85, 0.85, 4, 0.25), steel));
  head.add(part(new RoundedBoxGeometry(0.9, 0.55, 0.1, 3, 0.1), dark, { pos: [0, 0, 0.4], outline: false }));
  const eyes = [0xff, 0xff].map((_, i) => {
    const e = part(sphere(0.1), glow(0x4dffb5), { pos: [i ? 0.2 : -0.2, 0.06, 0.47], scale: [1, 1.3, 0.5], outline: false });
    head.add(e);
    return e;
  });
  const smile = part(new THREE.TorusGeometry(0.13, 0.03, 8, 20, Math.PI), glow(0x4dffb5), { pos: [0, -0.1, 0.46], rot: [0, 0, Math.PI], outline: false });
  head.add(smile);
  head.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 20), orange, { pos: [-0.62, 0, 0], rot: [0, 0, Math.PI / 2] }));
  head.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 20), orange, { pos: [0.62, 0, 0], rot: [0, 0, Math.PI / 2] }));
  head.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), steel, { pos: [0, 0.55, 0] }));
  head.add(part(sphere(0.1), glow(0xff5d9e), { pos: [0, 0.74, 0] }));
  root.add(head);

  const armL = arm(-0.62, 1.3, steel, orange, 0.4, 0.1);
  const armR = arm(0.62, 1.3, steel, orange, 0.4, 0.1);
  root.add(armL, armR);
  return { root, head, armL, armR, eyes };
}

// ---------------------------------------------------------------- Mochi (cat)
function mochi() {
  const root = group();
  const cream = 0xfff1e0, orange = 0xffa94d, pink = 0xff9fb2;
  root.add(part(sphere(0.55), cream, { pos: [0, 0.65, 0], scale: [1, 1.08, 0.88] }));
  root.add(part(sphere(0.3), 0xffffff, { pos: [0, 0.6, 0.38], scale: [1, 1.1, 0.4], outline: false }));
  root.add(part(sphere(0.2), cream, { pos: [-0.26, 0.12, 0.1], scale: [1, 0.6, 1.4] }));
  root.add(part(sphere(0.2), cream, { pos: [0.26, 0.12, 0.1], scale: [1, 0.6, 1.4] }));

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.1, 0.35, -0.45), new THREE.Vector3(0.55, 0.3, -0.65),
    new THREE.Vector3(0.85, 0.7, -0.5), new THREE.Vector3(0.8, 1.15, -0.3)
  ]);
  root.add(part(new THREE.TubeGeometry(curve, 24, 0.09, 10), orange));

  const head = group(0, 1.55, 0);
  head.add(part(sphere(0.62), cream, { scale: [1.16, 1, 1] }));
  head.add(part(sphere(0.3), orange, { pos: [-0.36, 0.38, 0.28], scale: [1, 0.7, 0.8], outline: false }));
  for (const s of [-1, 1]) {
    head.add(part(new THREE.ConeGeometry(0.24, 0.5, 4), cream, { pos: [s * 0.44, 0.62, 0], rot: [0, Math.PI / 4, -s * 0.35] }));
    head.add(part(new THREE.ConeGeometry(0.13, 0.3, 4), pink, { pos: [s * 0.44, 0.58, 0.1], rot: [0, Math.PI / 4, -s * 0.35], outline: false }));
    head.add(part(sphere(0.1), pink, { pos: [s * 0.45, -0.12, 0.5], scale: [1.3, 0.7, 0.4], outline: false }));
    for (const a of [-0.25, 0, 0.25]) {
      head.add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), 0x6b5a4a,
        { pos: [s * 0.78, -0.12 + a * 0.35, 0.28], rot: [0, 0, Math.PI / 2 + s * a], outline: false }));
    }
  }
  const eyes = [eye(-0.26, 0.04, 0.54, 0.1), eye(0.26, 0.04, 0.54, 0.1)];
  head.add(...eyes);
  head.add(part(sphere(0.06), pink, { pos: [0, -0.1, 0.62], scale: [1.2, 0.8, 0.8], outline: false }));
  root.add(head);

  const armL = arm(-0.5, 0.95, cream, cream, 0.28, 0.12);
  const armR = arm(0.5, 0.95, cream, cream, 0.28, 0.12);
  root.add(armL, armR);
  return { root, head, armL, armR, eyes };
}

// ---------------------------------------------------------------- Astro (astronaut)
function astro() {
  const root = group();
  const white = 0xf4f7ff, grey = 0x9aa6c4, orange = 0xff7a3d;
  root.add(part(capsule(0.2, 0.35), white, { pos: [-0.24, 0.42, 0] }));
  root.add(part(capsule(0.2, 0.35), white, { pos: [0.24, 0.42, 0] }));
  root.add(part(sphere(0.24), orange, { pos: [-0.24, 0.1, 0.06], scale: [1, 0.6, 1.3] }));
  root.add(part(sphere(0.24), orange, { pos: [0.24, 0.1, 0.06], scale: [1, 0.6, 1.3] }));
  root.add(part(capsule(0.45, 0.35), white, { pos: [0, 1.15, 0] }));
  root.add(part(new RoundedBoxGeometry(0.7, 0.85, 0.3, 3, 0.1), grey, { pos: [0, 1.15, -0.5] }));
  root.add(part(new RoundedBoxGeometry(0.4, 0.26, 0.05, 2, 0.02), 0x2d3560, { pos: [0, 1.2, 0.44], outline: false }));
  root.add(part(sphere(0.045), glow(0xff4d6d), { pos: [-0.1, 1.2, 0.48], outline: false }));
  root.add(part(sphere(0.045), glow(0x4dd2ff), { pos: [0.02, 1.2, 0.48], outline: false }));
  root.add(part(sphere(0.045), glow(0xffe14d), { pos: [0.14, 1.2, 0.48], outline: false }));

  const head = group(0, 1.95, 0);
  head.add(part(sphere(0.7), white));
  head.add(part(sphere(0.52), 0x1a2250, { pos: [0, 0, 0.28], scale: [1.0, 0.78, 0.9] }));
  head.add(part(sphere(0.1), 0xffffff, { pos: [-0.22, 0.14, 0.68], scale: [1.6, 0.8, 0.3], rot: [0, 0, 0.5], outline: false }));
  head.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), grey, { pos: [0.4, 0.78, 0], rot: [0, 0, -0.4] }));
  head.add(part(sphere(0.07), glow(0xff4d6d), { pos: [0.48, 0.93, 0], outline: false }));
  const eyes = [0xff, 0xff].map((_, i) => {
    const e = part(sphere(0.07), glow(0x7df9ff), { pos: [i ? 0.17 : -0.17, 0.0, 0.7], scale: [1, 1.4, 0.4], outline: false });
    head.add(e);
    return e;
  });
  root.add(head);

  const armL = arm(-0.58, 1.4, white, orange, 0.4, 0.14);
  const armR = arm(0.58, 1.4, white, orange, 0.4, 0.14);
  root.add(armL, armR);
  return { root, head, armL, armR, eyes };
}

// ---------------------------------------------------------------- Waddle (penguin)
function waddle() {
  const root = group();
  const navy = 0x2b3a67, orange = 0xffa733;
  root.add(part(sphere(0.2), orange, { pos: [-0.28, 0.08, 0.15], scale: [1.2, 0.5, 1.7] }));
  root.add(part(sphere(0.2), orange, { pos: [0.28, 0.08, 0.15], scale: [1.2, 0.5, 1.7] }));
  root.add(part(sphere(0.78), navy, { pos: [0, 0.95, 0], scale: [1, 1.2, 0.92] }));
  root.add(part(sphere(0.62), 0xffffff, { pos: [0, 0.88, 0.42], scale: [0.95, 1.15, 0.6], outline: false }));

  const head = group(0, 1.95, 0);
  head.add(part(sphere(0.55), navy));
  head.add(part(sphere(0.24), 0xffffff, { pos: [-0.2, -0.05, 0.42], scale: [1, 1.1, 0.55], outline: false }));
  head.add(part(sphere(0.24), 0xffffff, { pos: [0.2, -0.05, 0.42], scale: [1, 1.1, 0.55], outline: false }));
  head.add(part(new THREE.ConeGeometry(0.13, 0.28, 16), orange, { pos: [0, -0.12, 0.6], rot: [Math.PI / 2, 0, 0] }));
  const eyes = [eye(-0.2, 0.06, 0.54, 0.07), eye(0.2, 0.06, 0.54, 0.07)];
  head.add(...eyes);
  root.add(head);
  root.add(part(new THREE.TorusGeometry(0.46, 0.1, 12, 28), 0xe5484d, { pos: [0, 1.52, 0], rot: [Math.PI / 2, 0, 0] }));
  root.add(part(new RoundedBoxGeometry(0.16, 0.5, 0.12, 2, 0.04), 0xe5484d, { pos: [0.26, 1.28, 0.42], rot: [0, 0, 0.1] }));

  const flipper = (x) => {
    const g = group(x, 1.35, 0);
    g.add(part(sphere(0.2), navy, { pos: [0, -0.3, 0], scale: [0.55, 1.5, 0.8] }));
    return g;
  };
  const armL = flipper(-0.72), armR = flipper(0.72);
  root.add(armL, armR);
  return { root, head, armL, armR, eyes };
}

// ---------------------------------------------------------------- Bloop (water droplet)
function bloop() {
  const root = group();
  const blue = 0x4cc9f0;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(t) * Math.cos(t / 2) * 0.95), -Math.cos(t) * 0.95));
  }
  const head = group(0, 1.05, 0);                  // the whole drop is the "head" so it tilts toward the pointer
  head.add(part(new THREE.LatheGeometry(pts, 40), blue, { scale: [1, 1.05, 1] }));
  head.add(part(sphere(0.16), 0xd9f7ff, { pos: [-0.3, 0.2, 0.5], scale: [0.7, 1.4, 0.4], rot: [0, 0, 0.4], outline: false }));
  const eyes = [eye(-0.22, -0.12, 0.64, 0.1), eye(0.22, -0.12, 0.64, 0.1)];
  head.add(...eyes);
  head.add(part(sphere(0.09), 0xff8fb3, { pos: [-0.42, -0.34, 0.54], scale: [1.4, 0.7, 0.4], outline: false }));
  head.add(part(sphere(0.09), 0xff8fb3, { pos: [0.42, -0.34, 0.54], scale: [1.4, 0.7, 0.4], outline: false }));
  head.add(part(new THREE.TorusGeometry(0.1, 0.025, 8, 16, Math.PI), INK, { pos: [0, -0.3, 0.7], rot: [0, 0, Math.PI], outline: false }));
  root.add(head);
  root.add(part(sphere(0.16), 0x3aa9d1, { pos: [-0.25, 0.08, 0.1], scale: [1, 0.6, 1.3] }));
  root.add(part(sphere(0.16), 0x3aa9d1, { pos: [0.25, 0.08, 0.1], scale: [1, 0.6, 1.3] }));

  const armL = arm(-0.82, 0.85, blue, blue, 0.15, 0.1);
  const armR = arm(0.82, 0.85, blue, blue, 0.15, 0.1);
  head.add(armL, armR);
  armL.position.set(-0.82, -0.2, 0);
  armR.position.set(0.82, -0.2, 0);
  return { root, head, armL, armR, eyes };
}

const BUILDERS = { bolt, mochi, astro, waddle, bloop };

export function buildCharacter(id) {
  const build = BUILDERS[id] || bolt;
  return build();
}
