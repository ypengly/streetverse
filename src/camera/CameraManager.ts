/**
 * Camera system: chase, close chase, and hood modes.
 *
 * The chase cameras smooth a *relative offset* (not a world position), so they never trail behind a
 * fast car, and they raycast against static geometry so they can't clip through walls.
 */
import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import { clamp, damp, wrapAngle } from '../utils/math';
import type { VehicleTelemetry } from '../vehicles/VehicleController';

export type CameraMode = 'chase' | 'close' | 'hood';
export const CAMERA_MODES: CameraMode[] = ['chase', 'close', 'hood'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  close: 'Close Chase',
  hood: 'Hood',
};

interface ChaseParams {
  distance: number;
  height: number;
  lookHeight: number;
  fov: number;
}

const PARAMS: Record<'chase' | 'close', ChaseParams> = {
  chase: { distance: 7.6, height: 2.7, lookHeight: 1.1, fov: 60 },
  close: { distance: 5.0, height: 1.7, lookHeight: 0.9, fov: 66 },
};

export interface CameraTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  telemetry: VehicleTelemetry;
}

export class CameraManager {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private yawInit = false;
  private offset = new THREE.Vector3();
  private fov = 60;
  private collisionScale = 1;
  private shakeAmount = 0;
  private time = 0;

  private readonly fwd = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly rapierRay: InstanceType<PhysicsWorld['RAPIER']['Ray']>;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    private readonly ignoreBody: RigidBody,
  ) {
    this.rapierRay = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.yawInit = false; // re-seat heading so mode switches don't swing
  }

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length] as CameraMode);
    return this.mode;
  }

  /** Add camera shake (impact magnitude in m/s of velocity change). */
  shake(magnitude: number): void {
    this.shakeAmount = Math.min(1, this.shakeAmount + clamp(magnitude / 25, 0.1, 1));
  }

  update(dt: number, target: CameraTarget): void {
    this.time += dt;
    const speed = target.telemetry.speed;

    this.fwd.set(0, 0, -1).applyQuaternion(target.quaternion).setY(0);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();

    // Target FOV widens with speed.
    const base = this.mode === 'hood' ? 76 : PARAMS[this.mode].fov;
    this.fov = damp(this.fov, base + clamp(speed / 55, 0, 1) * 16, 4, dt);

    if (this.mode === 'hood') this.updateHood(target);
    else this.updateChase(dt, target, PARAMS[this.mode]);

    // Impact shake (applied last).
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount * this.shakeAmount * 0.35;
      this.camera.position.x += Math.sin(this.time * 61) * s;
      this.camera.position.y += Math.sin(this.time * 73 + 1.3) * s;
      this.camera.position.z += Math.cos(this.time * 55) * s;
      this.shakeAmount = damp(this.shakeAmount, 0, 5, dt);
    }

    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateChase(dt: number, target: CameraTarget, p: ChaseParams): void {
    const t = target.telemetry;
    const speed = t.speed;

    // Heading: blend car heading with velocity heading (reveals drift angle); hold when reversing.
    let targetYaw = Math.atan2(this.fwd.x, this.fwd.z);
    if (speed > 3 && t.forwardSpeed > 0) {
      const vYaw = Math.atan2(target.velocity.x, target.velocity.z);
      const w = clamp(speed / 18, 0, 1) * 0.45;
      targetYaw += wrapAngle(vYaw - targetYaw) * w;
    }
    // Slight swing into the turn.
    targetYaw -= t.steer * 0.1 * clamp(speed / 20, 0, 1);

    if (!this.yawInit) {
      this.yaw = targetYaw;
      this.yawInit = true;
    } else {
      this.yaw += wrapAngle(targetYaw - this.yaw) * (1 - Math.exp(-5.5 * dt));
    }

    // Acceleration lag: camera drifts back when accelerating, forward when braking.
    const dist = p.distance + clamp(t.longitudinalG * 1.6, -1.1, 1.4);
    this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // direction the car faces
    const want = this.tmp.copy(this.dir).multiplyScalar(-dist).setY(p.height);
    const lambda = 9;
    this.offset.set(
      damp(this.offset.x, want.x, lambda, dt),
      damp(this.offset.y, want.y, lambda, dt),
      damp(this.offset.z, want.z, lambda, dt),
    );
    if (this.offset.lengthSq() < 0.01) this.offset.copy(want);

    this.look.copy(target.position).addScaledVector(this.dir, clamp(speed * 0.1, 0, 5));
    this.look.y += p.lookHeight;
    this.desired.copy(target.position).add(this.offset);

    // Collision avoidance: pull the camera in when a wall is between it and the car.
    const anchor = this.tmp.copy(target.position);
    anchor.y += p.lookHeight;
    this.toCam.copy(this.desired).sub(anchor);
    const full = this.toCam.length();
    let allowed = 1;
    if (full > 0.01) {
      this.toCam.divideScalar(full);
      this.rapierRay.origin = { x: anchor.x, y: anchor.y, z: anchor.z };
      this.rapierRay.dir = { x: this.toCam.x, y: this.toCam.y, z: this.toCam.z };
      const hit = this.physics.world.castRay(
        this.rapierRay,
        full,
        true,
        this.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        this.ignoreBody,
      );
      if (hit) allowed = clamp((hit.timeOfImpact - 0.5) / full, 0.12, 1);
    }
    // Snap in immediately, ease back out slowly.
    this.collisionScale = allowed < this.collisionScale ? allowed : damp(this.collisionScale, allowed, 2.5, dt);
    this.camera.position
      .copy(anchor)
      .add(this.toCam.set(this.desired.x - anchor.x, this.desired.y - anchor.y, this.desired.z - anchor.z).multiplyScalar(this.collisionScale));
    this.camera.lookAt(this.look);
  }

  private updateHood(target: CameraTarget): void {
    // Camera sits just above the bonnet, looking down the car's own axis.
    this.tmp.set(0, 0.46, -0.55).applyQuaternion(target.quaternion).add(target.position);
    this.camera.position.copy(this.tmp);
    this.camera.quaternion.copy(target.quaternion);
    this.camera.rotateX(-0.04);
  }
}
