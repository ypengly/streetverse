/**
 * Vehicle = simulation (VehicleController) + visuals (procedural model) + render interpolation.
 *
 * The simulation runs at a fixed timestep; `syncVisual` blends the last two physics states so the
 * rendered car moves smoothly at any display refresh rate.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import { clamp, damp } from '../utils/math';
import { VehicleController, type ControllerOptions } from './VehicleController';
import { buildVehicleModel, type VehicleModel } from './VehicleFactory';
import type { VehicleSpec } from './VehiclePhysics';

export class Vehicle {
  readonly controller: VehicleController;
  readonly model: VehicleModel;
  readonly renderPos = new THREE.Vector3();
  readonly renderQuat = new THREE.Quaternion();

  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currPos = new THREE.Vector3();
  private currQuat = new THREE.Quaternion();
  private roll = 0;
  private pitch = 0;
  private smoothCompression = [0.085, 0.085, 0.085, 0.085];

  constructor(
    physics: PhysicsWorld,
    readonly spec: VehicleSpec,
    options: ControllerOptions = {},
    paintColor?: string,
  ) {
    this.controller = new VehicleController(physics, spec, options);
    this.model = buildVehicleModel(spec, paintColor);
  }

  /** Teleport (spawn / recovery) without interpolation smearing. */
  teleport(x: number, y: number, z: number, yaw: number): void {
    this.controller.placeAt(x, y, z, yaw);
    this.captureState();
    this.captureState();
    this.renderPos.copy(this.currPos);
    this.renderQuat.copy(this.currQuat);
  }

  /** Record the post-step physics transform. Call exactly once per physics step. */
  captureState(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.controller.body.translation();
    const r = this.controller.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Update visuals for a rendered frame. `alpha` = fraction of the next physics step elapsed. */
  syncVisual(alpha: number, dt: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.currPos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const { root, body, wheels, brakeLights, reverseLights } = this.model;
    root.position.copy(this.renderPos);
    root.quaternion.copy(this.renderQuat);

    const c = this.controller;
    const t = c.telemetry;

    // Cosmetic body motion driven by real tire forces (weight transfer feel).
    const targetRoll = clamp(t.lateralG * 0.055, -0.1, 0.1);
    const targetPitch = clamp(t.longitudinalG * 0.05, -0.08, 0.08);
    this.roll = damp(this.roll, targetRoll, 9, dt);
    this.pitch = damp(this.pitch, targetPitch, 9, dt);
    body.rotation.set(this.pitch, 0, this.roll);
    body.position.y = 0;

    const { spec } = this;
    c.wheels.forEach((w, i) => {
      const rig = wheels[i];
      if (!rig) return;
      this.smoothCompression[i] = damp(this.smoothCompression[i] ?? 0, w.compression, 30, dt);
      const drop = spec.suspension.restLength - (this.smoothCompression[i] ?? 0);
      rig.anchor.position.y = spec.mountY - drop;
      rig.steer.rotation.y = w.steerYaw;
      rig.spin.rotation.x = -w.spin;
    });

    brakeLights.emissiveIntensity = t.braking || t.handbrake ? 2.2 : 0.25;
    reverseLights.emissiveIntensity = t.reversing ? 1.8 : 0;
  }

  dispose(): void {
    this.controller.dispose();
    this.model.disposables.forEach((d) => d.dispose());
  }
}
