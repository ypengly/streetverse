/**
 * WorldManager: builds the visible circuit and its collision geometry.
 *
 * Repeated objects (barriers, streetlights, trees) use InstancedMesh so draw calls stay constant, and
 * their colliders are batched onto a single fixed body each. Instance counts are fixed at build
 * time, so nothing grows during play.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import {
  AssetManager,
  createConcreteTexture,
  createGrassTexture,
  createRoadTexture,
} from '../engine/AssetManager';
import { WORLD_HALF_SIZE } from '../utils/constants';
import { createRng } from '../utils/math';
import { BARRIER_OFFSET, CURB_HEIGHT, Circuit, ROAD_HALF_WIDTH, SIDEWALK_WIDTH } from './Circuit';

interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw?: number;
}

export class WorldManager {
  readonly circuit: Circuit;
  readonly group = new THREE.Group();
  /** Counts for diagnostics / tests. */
  readonly stats = { barriers: 0, lights: 0, trees: 0, colliders: 0 };

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly assets: AssetManager,
    circuit: Circuit = new Circuit(),
  ) {
    this.circuit = circuit;
  }

  build(scene: THREE.Scene): void {
    this.buildGround();
    this.buildRoad();
    this.buildSidewalks();
    const colliders: Box[] = [];
    this.buildBarriers(colliders);
    this.buildStreetlights(colliders);
    this.buildTrees(colliders);
    this.buildBoundary(colliders);
    this.physics.addStaticBoxBatch(colliders);
    this.stats.colliders = colliders.length;
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ ground & boundary

  private buildGround(): void {
    const size = (WORLD_HALF_SIZE + 40) * 2;
    const tex = this.assets.texture('grass', createGrassTexture);
    tex.repeat.set(size / 6, size / 6);
    const geo = this.assets.track(new THREE.PlaneGeometry(size, size));
    const mat = this.assets.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: '#cfe0c0' }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // Flat ground collider with its top face at y = 0.
    this.physics.addStaticBox(
      { x: 0, y: -1, z: 0 },
      { x: WORLD_HALF_SIZE + 40, y: 1, z: WORLD_HALF_SIZE + 40 },
      0,
      1,
    );
  }

  private buildBoundary(colliders: Box[]): void {
    const h = WORLD_HALF_SIZE;
    const walls: Box[] = [
      { x: 0, y: 3, z: -h, hx: h + 2, hy: 3, hz: 1 },
      { x: 0, y: 3, z: h, hx: h + 2, hy: 3, hz: 1 },
      { x: -h, y: 3, z: 0, hx: 1, hy: 3, hz: h + 2 },
      { x: h, y: 3, z: 0, hx: 1, hy: 3, hz: h + 2 },
    ];
    const mat = this.assets.track(new THREE.MeshStandardMaterial({ color: '#2f4a2a', roughness: 1 }));
    for (const w of walls) {
      const geo = this.assets.track(new THREE.BoxGeometry(w.hx * 2, w.hy * 2, w.hz * 2));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(w.x, w.y, w.z);
      mesh.castShadow = true;
      this.group.add(mesh);
      colliders.push(w);
    }
  }

  // ------------------------------------------------------------------ road surface

  /** Build a strip following the centreline between two cross-section points (lateral, height). */
  private strip(l0: number, y0: number, l1: number, y1: number, tile: number): THREE.BufferGeometry {
    const { points, rights, cumulative, length } = this.circuit;
    const n = points.length;
    const repeats = Math.max(1, Math.round(length / tile));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const p = points[k] as THREE.Vector3;
      const r = rights[k] as THREE.Vector3;
      const v = i === n ? repeats : ((cumulative[k] ?? 0) / length) * repeats;
      pos.push(p.x + r.x * l0, y0, p.z + r.z * l0, p.x + r.x * l1, y1, p.z + r.z * l1);
      uv.push(0, v, 1, v);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildRoad(): void {
    const tex = this.assets.texture('road', createRoadTexture);
    const geo = this.assets.track(this.strip(-ROAD_HALF_WIDTH, 0.02, ROAD_HALF_WIDTH, 0.02, 18));
    const mat = this.assets.track(
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildSidewalks(): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const e0 = side * ROAD_HALF_WIDTH;
      const e1 = side * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH);
      parts.push(this.strip(e0, 0.02, e0, CURB_HEIGHT, 18)); // curb face
      parts.push(this.strip(e0, CURB_HEIGHT, e1, CURB_HEIGHT, 18)); // walking surface
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) throw new Error('Failed to merge sidewalk geometry');
    this.assets.track(merged);

    const tex = this.assets.texture('concrete', createConcreteTexture);
    tex.repeat.set(2, 1);
    const mat = this.assets.track(
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide, color: '#d8d6cf' }),
    );
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);

    // Exact collision for the curb/sidewalk surface.
    const position = merged.getAttribute('position');
    const index = merged.getIndex();
    if (!index) throw new Error('Sidewalk geometry is not indexed');
    this.physics.addStaticTrimesh(
      new Float32Array(position.array as ArrayLike<number>),
      new Uint32Array(index.array as ArrayLike<number>),
    );
  }

  // ------------------------------------------------------------------ instanced props

  private buildBarriers(colliders: Box[]): void {
    const { points, rights } = this.circuit;
    const n = points.length;
    const step = 2;
    const height = 1.1;
    const thick = 0.7;
    const entries: { m: THREE.Matrix4; color: THREE.Color }[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i += step) {
        const a = points[i] as THREE.Vector3;
        const b = points[(i + step) % n] as THREE.Vector3;
        const ra = rights[i] as THREE.Vector3;
        const rb = rights[(i + step) % n] as THREE.Vector3;
        const ax = a.x + ra.x * side * BARRIER_OFFSET;
        const az = a.z + ra.z * side * BARRIER_OFFSET;
        const bx = b.x + rb.x * side * BARRIER_OFFSET;
        const bz = b.z + rb.z * side * BARRIER_OFFSET;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) + 0.5; // overlap to avoid gaps on curves
        const yaw = Math.atan2(-dz, dx);
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;
        q.setFromAxisAngle(up, yaw);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(cx, height / 2, cz),
          q,
          new THREE.Vector3(len, height, thick),
        );
        const tint =
          (i / step) % 8 === 0 ? new THREE.Color('#c9442d') : new THREE.Color().setScalar(0.85 + ((i * 7) % 5) * 0.03);
        entries.push({ m, color: tint });
        colliders.push({ x: cx, y: height / 2, z: cz, hx: len / 2, hy: height / 2, hz: thick / 2, yaw });
      }
    }
    const geo = this.assets.track(new THREE.BoxGeometry(1, 1, 1));
    const tex = this.assets.texture('concrete', createConcreteTexture);
    const mat = this.assets.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    const inst = new THREE.InstancedMesh(geo, mat, entries.length);
    entries.forEach((e, i) => {
      inst.setMatrixAt(i, e.m);
      inst.setColorAt(i, e.color);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.stats.barriers = entries.length;
  }

  private buildStreetlights(colliders: Box[]): void {
    const { points, rights } = this.circuit;
    const n = points.length;
    const every = 10;
    const poleH = 8;
    const poleGeo = this.assets.track(new THREE.CylinderGeometry(0.1, 0.14, poleH, 8));
    const armGeo = this.assets.track(new THREE.BoxGeometry(2.4, 0.12, 0.18));
    const lampGeo = this.assets.track(new THREE.BoxGeometry(0.9, 0.1, 0.35));
    const metal = this.assets.track(new THREE.MeshStandardMaterial({ color: '#4b5058', roughness: 0.5, metalness: 0.8 }));
    const lamp = this.assets.track(new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd890', emissiveIntensity: 0.6 }));
    const count = Math.floor(n / every);
    const poles = new THREE.InstancedMesh(poleGeo, metal, count);
    const arms = new THREE.InstancedMesh(armGeo, metal, count);
    const lamps = new THREE.InstancedMesh(lampGeo, lamp, count);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const idx = i * every;
      const side = i % 2 === 0 ? 1 : -1;
      const p = points[idx] as THREE.Vector3;
      const r = rights[idx] as THREE.Vector3;
      const off = ROAD_HALF_WIDTH + SIDEWALK_WIDTH * 0.55;
      const px = p.x + r.x * side * off;
      const pz = p.z + r.z * side * off;
      const toRoadX = -r.x * side;
      const toRoadZ = -r.z * side;
      const yaw = Math.atan2(-toRoadZ, toRoadX);
      q.setFromAxisAngle(up, yaw);
      poles.setMatrixAt(k, new THREE.Matrix4().makeTranslation(px, poleH / 2, pz));
      arms.setMatrixAt(
        k,
        new THREE.Matrix4().compose(new THREE.Vector3(px + toRoadX * 1.2, poleH, pz + toRoadZ * 1.2), q, new THREE.Vector3(1, 1, 1)),
      );
      lamps.setMatrixAt(
        k,
        new THREE.Matrix4().compose(new THREE.Vector3(px + toRoadX * 2.2, poleH - 0.1, pz + toRoadZ * 2.2), q, new THREE.Vector3(1, 1, 1)),
      );
      colliders.push({ x: px, y: 2, z: pz, hx: 0.16, hy: 2, hz: 0.16 });
      k++;
    }
    for (const m of [poles, arms, lamps]) {
      m.castShadow = true;
      m.instanceMatrix.needsUpdate = true;
      this.group.add(m);
    }
    this.stats.lights = k;
  }

  private buildTrees(colliders: Box[]): void {
    const rng = createRng(1337);
    const limit = WORLD_HALF_SIZE - 12;
    const clearance = BARRIER_OFFSET + 6;
    const spots: { x: number; z: number; s: number }[] = [];
    for (let attempt = 0; attempt < 900 && spots.length < 260; attempt++) {
      const x = (rng() * 2 - 1) * limit;
      const z = (rng() * 2 - 1) * limit;
      if (this.circuit.nearest(x, z).distance < clearance) continue;
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 36)) continue;
      spots.push({ x, z, s: 0.8 + rng() * 0.9 });
    }
    const trunkGeo = this.assets.track(new THREE.CylinderGeometry(0.22, 0.32, 3, 6));
    const crownGeo = this.assets.track(new THREE.IcosahedronGeometry(2.1, 1));
    const trunkMat = this.assets.track(new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 1 }));
    const crownMat = this.assets.track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }));
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
    const q = new THREE.Quaternion();
    spots.forEach((t, i) => {
      trunks.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(t.x, 1.5 * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s)));
      crowns.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(t.x, 4.2 * t.s, t.z), q, new THREE.Vector3(t.s, t.s * 1.15, t.s)));
      crowns.setColorAt(i, new THREE.Color().setHSL(0.27 + (rng() - 0.5) * 0.05, 0.45, 0.28 + rng() * 0.1));
      colliders.push({ x: t.x, y: 2, z: t.z, hx: 0.3 * t.s, hy: 2, hz: 0.3 * t.s });
    });
    for (const m of [trunks, crowns]) {
      m.castShadow = true;
      m.instanceMatrix.needsUpdate = true;
      this.group.add(m);
    }
    this.stats.trees = spots.length;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    // Geometries/materials/textures are tracked by AssetManager and disposed there.
  }
}
