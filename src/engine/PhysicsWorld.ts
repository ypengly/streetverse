/** Thin wrapper over Rapier: initialisation, fixed stepping, static geometry helpers. */
import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_DT } from '../utils/constants';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<void> | null = null;

/** Initialise the Rapier WASM module exactly once. */
export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class PhysicsWorld {
  readonly RAPIER: Rapier = RAPIER;
  readonly world: RAPIER.World;
  private staticBodies: RAPIER.RigidBody[] = [];

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_DT;
  }

  static async create(): Promise<PhysicsWorld> {
    await initRapier();
    return new PhysicsWorld();
  }

  step(): void {
    this.world.step();
  }

  /** Add an immovable box. `yaw` rotates about the Y axis. */
  addStaticBox(
    center: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    yaw = 0,
    friction = 0,
  ): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, false);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction).setRestitution(0.15),
      body,
    );
    this.staticBodies.push(body);
    return collider;
  }

  /** Add many immovable boxes on a single fixed body (cheap for barriers, trees, poles). */
  addStaticBoxBatch(
    boxes: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw?: number }[],
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const b of boxes) {
      const yaw = b.yaw ?? 0;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
          .setTranslation(b.x, b.y, b.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setFriction(0)
          .setRestitution(0.15),
        body,
      );
    }
    this.staticBodies.push(body);
    return body;
  }

  /** Add an immovable triangle mesh (e.g. sidewalks/curbs). */
  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0), body);
    this.staticBodies.push(body);
    return collider;
  }

  dispose(): void {
    this.world.free();
    this.staticBodies = [];
  }
}
