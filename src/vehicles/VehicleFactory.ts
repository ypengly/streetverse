/**
 * Procedural vehicle model. Used as the built-in asset and as the fallback when a GLB is missing.
 * Local space matches the physics body: origin = centre of mass, forward = -Z, right = +X.
 */
import * as THREE from 'three';
import type { VehicleSpec } from './VehiclePhysics';

export interface WheelRig {
  /** Positioned at the suspension mount; moves up/down with compression. */
  anchor: THREE.Group;
  /** Rotates about Y for steering. */
  steer: THREE.Group;
  /** Rotates about X for rolling. */
  spin: THREE.Group;
}

export interface VehicleModel {
  root: THREE.Group;
  /** Receives cosmetic roll/pitch. Wheels are siblings so they stay planted. */
  body: THREE.Group;
  wheels: WheelRig[];
  paint: THREE.MeshPhysicalMaterial;
  brakeLights: THREE.MeshStandardMaterial;
  reverseLights: THREE.MeshStandardMaterial;
  headlights: THREE.MeshStandardMaterial;
  /** Everything allocated here, for disposal. */
  disposables: { dispose(): void }[];
}

function extrudeProfile(pts: [number, number][], width: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  // Profile x (rear -> front) becomes -Z (front is -Z); width axis becomes X.
  geo.rotateY(Math.PI / 2);
  return geo;
}

export function buildVehicleModel(spec: VehicleSpec, paintColor = '#c9301f'): VehicleModel {
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = own(
    new THREE.MeshPhysicalMaterial({
      color: paintColor,
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
  );
  const glass = own(new THREE.MeshPhysicalMaterial({ color: '#10161d', metalness: 0.9, roughness: 0.05, opacity: 0.92, transparent: true }));
  const trim = own(new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6, metalness: 0.3 }));
  const chrome = own(new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.2, metalness: 1 }));
  const brakeLights = own(new THREE.MeshStandardMaterial({ color: '#4a0808', emissive: '#ff1010', emissiveIntensity: 0.25, roughness: 0.3 }));
  const reverseLights = own(new THREE.MeshStandardMaterial({ color: '#cfcfcf', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.3 }));
  const headlights = own(new THREE.MeshStandardMaterial({ color: '#e8f0ff', emissive: '#bcd6ff', emissiveIntensity: 0.3, roughness: 0.2 }));

  const [hx, , hz] = spec.halfExtents;
  const L = hz * 2;
  const W = hx * 2 - 0.04;

  // Lower body (side profile: x runs rear -> front, y up).
  const lowerGeo = own(
    extrudeProfile(
      [
        [-L / 2, -0.3],
        [-L / 2, 0.02],
        [-L / 2 + 0.35, 0.16],
        [-0.3, 0.2],
        [0.55, 0.2],
        [L / 2 - 0.55, 0.12],
        [L / 2 - 0.05, -0.02],
        [L / 2, -0.12],
        [L / 2, -0.3],
      ],
      W,
      0.07,
    ),
  );
  const lower = new THREE.Mesh(lowerGeo, paint);
  lower.castShadow = true;
  body.add(lower);

  // Greenhouse (glass) + roof plate.
  const cabinGeo = own(
    extrudeProfile(
      [
        [-1.05, 0.17],
        [-0.55, 0.6],
        [0.4, 0.6],
        [0.98, 0.17],
      ],
      W - 0.22,
      0.04,
    ),
  );
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.castShadow = true;
  body.add(cabin);
  const roof = new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.3, 0.035, 0.86)), paint);
  roof.position.set(0, 0.615, 0.07);
  body.add(roof);

  // Front splitter, rear diffuser, spoiler.
  const splitter = new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.1, 0.05, 0.28)), trim);
  splitter.position.set(0, -0.31, -L / 2 + 0.05);
  body.add(splitter);
  const diffuser = new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.3, 0.07, 0.3)), trim);
  diffuser.position.set(0, -0.28, L / 2 - 0.1);
  body.add(diffuser);
  const spoiler = new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.15, 0.04, 0.3)), paint);
  spoiler.position.set(0, 0.28, L / 2 - 0.3);
  body.add(spoiler);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(own(new THREE.BoxGeometry(0.04, 0.1, 0.12)), trim);
    strut.position.set(sx * (W / 2 - 0.35), 0.22, L / 2 - 0.3);
    body.add(strut);
  }

  // Grille, lights, mirrors, exhaust.
  const grille = new THREE.Mesh(own(new THREE.BoxGeometry(0.7, 0.12, 0.04)), trim);
  grille.position.set(0, -0.12, -L / 2 - 0.01);
  body.add(grille);
  const lightGeo = own(new THREE.BoxGeometry(0.42, 0.09, 0.06));
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(lightGeo, headlights);
    head.position.set(sx * (W / 2 - 0.34), -0.03, -L / 2 + 0.02);
    body.add(head);
    const tail = new THREE.Mesh(lightGeo, brakeLights);
    tail.position.set(sx * (W / 2 - 0.34), 0.03, L / 2 - 0.02);
    body.add(tail);
    const rev = new THREE.Mesh(own(new THREE.BoxGeometry(0.14, 0.05, 0.05)), reverseLights);
    rev.position.set(sx * 0.4, -0.14, L / 2 - 0.005);
    body.add(rev);
    const mirror = new THREE.Mesh(own(new THREE.BoxGeometry(0.16, 0.09, 0.08)), paint);
    mirror.position.set(sx * (W / 2 - 0.02), 0.26, -0.45);
    body.add(mirror);
    const exhaust = new THREE.Mesh(own(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12)), chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(sx * 0.45, -0.26, L / 2 + 0.01);
    body.add(exhaust);
  }

  // Wheels.
  const tireGeo = own(new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, spec.wheelWidth, 28));
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = own(new THREE.CylinderGeometry(spec.wheelRadius * 0.66, spec.wheelRadius * 0.66, spec.wheelWidth + 0.02, 24));
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = own(new THREE.BoxGeometry(spec.wheelWidth + 0.04, spec.wheelRadius * 1.1, 0.045));
  const tireMat = own(new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }));
  const rimMat = own(new THREE.MeshStandardMaterial({ color: '#b7bcc4', metalness: 1, roughness: 0.25 }));
  const hubMat = own(new THREE.MeshStandardMaterial({ color: '#2a2d31', metalness: 0.6, roughness: 0.4 }));

  const wheels: WheelRig[] = [];
  const half = spec.trackWidth / 2;
  const positions: [number, number][] = [
    [-half, spec.frontAxleZ],
    [half, spec.frontAxleZ],
    [-half, spec.rearAxleZ],
    [half, spec.rearAxleZ],
  ];
  for (const [x, z] of positions) {
    const anchor = new THREE.Group();
    anchor.position.set(x, spec.mountY, z);
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spin.add(tire);
    spin.add(new THREE.Mesh(rimGeo, hubMat));
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (i / 5) * Math.PI;
      spin.add(spoke);
    }
    steer.add(spin);
    anchor.add(steer);
    root.add(anchor);
    wheels.push({ anchor, steer, spin });
  }

  return { root, body, wheels, paint, brakeLights, reverseLights, headlights, disposables };
}
