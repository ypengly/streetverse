/**
 * Raycast vehicle: one Rapier rigid body for the chassis plus four suspension rays.
 *
 * Each wheel casts a ray, applies a spring/damper load to the chassis, then produces tire force
 * limited by a friction ellipse (mu * load). Combining drive/brake force with lateral grip means
 * throttle reduces cornering grip (power oversteer) and the handbrake locks the rear wheels (drift).
 *
 * This class owns simulation only; rendering reads `wheels` and `telemetry`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import { GRAVITY } from '../utils/constants';
import { clamp, approach, msToKmh } from '../utils/math';
import {
  MODE_TUNING,
  type DrivingMode,
  type TransmissionState,
  type VehicleSpec,
  createTransmission,
  driveForce,
  steerAngleLimit,
  updateTransmission,
} from './VehiclePhysics';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  nitro: boolean;
}

export const NEUTRAL_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

export interface WheelState {
  grounded: boolean;
  /** Suspension compression in metres (0 = fully extended). */
  compression: number;
  /** Steering yaw of the wheel about the vertical axis (rad). */
  steerYaw: number;
  /** Accumulated spin angle (rad) for animation. */
  spin: number;
  /** 0..>1; values near/above 1 mean the tire is sliding. */
  slip: number;
  load: number;
  contact: THREE.Vector3;
  front: boolean;
  /** Local-space mount position. */
  mount: THREE.Vector3;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  driftAngle: number;
  drifting: boolean;
  lateralG: number;
  longitudinalG: number;
  yawRate: number;
  groundedWheels: number;
  upright: number;
  overturnedTime: number;
  impact: number;
  braking: boolean;
  reversing: boolean;
}

export interface ControllerOptions {
  /** Returns a grip multiplier for the surface at world (x, z). */
  gripAt?: (x: number, z: number) => number;
  onImpact?: (magnitude: number) => void;
}

export class VehicleController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: WheelState[] = [];
  readonly telemetry: VehicleTelemetry;
  readonly transmission: TransmissionState;

  private mode: DrivingMode = 'arcade';
  private steerAngle = 0;
  private prevHVel = new THREE.Vector3();
  private impactCooldown = 0;
  private readonly ray: RAPIER.Ray;
  private readonly inertiaY: number;

  // Scratch objects (avoid per-step allocation).
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly yawQ = new THREE.Quaternion();
  private readonly hits: {
    hit: boolean;
    normal: THREE.Vector3;
    spring: number;
    vel: THREE.Vector3;
  }[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    readonly spec: VehicleSpec,
    private readonly options: ControllerOptions = {},
  ) {
    const R = physics.RAPIER;
    const world = physics.world;

    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0),
    );
    const [hx, hy, hz] = spec.halfExtents;
    this.collider = world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setMass(spec.mass)
        .setFriction(0)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setRestitution(0.15),
      this.body,
    );
    this.inertiaY = (spec.mass / 12) * (4 * hx * hx + 4 * hz * hz);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    const half = spec.trackWidth / 2;
    const mounts: [number, number, boolean][] = [
      [-half, spec.frontAxleZ, true],
      [half, spec.frontAxleZ, true],
      [-half, spec.rearAxleZ, false],
      [half, spec.rearAxleZ, false],
    ];
    for (const [x, z, front] of mounts) {
      this.wheels.push({
        grounded: false,
        compression: 0,
        steerYaw: 0,
        spin: 0,
        slip: 0,
        load: 0,
        contact: new THREE.Vector3(),
        front,
        mount: new THREE.Vector3(x, spec.mountY, z),
      });
      this.hits.push({ hit: false, normal: new THREE.Vector3(0, 1, 0), spring: 0, vel: new THREE.Vector3() });
    }

    this.transmission = createTransmission(spec);
    this.telemetry = {
      speed: 0,
      forwardSpeed: 0,
      speedKmh: 0,
      rpm: spec.engine.idleRpm,
      gear: 1,
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      driftAngle: 0,
      drifting: false,
      lateralG: 0,
      longitudinalG: 0,
      yawRate: 0,
      groundedWheels: 0,
      upright: 1,
      overturnedTime: 0,
      impact: 0,
      braking: false,
      reversing: false,
    };
    this.setMode('arcade');
  }

  get drivingMode(): DrivingMode {
    return this.mode;
  }

  setMode(mode: DrivingMode): void {
    this.mode = mode;
    this.body.setAngularDamping(MODE_TUNING[mode].angularDamping);
  }

  /** Teleport to a position/heading and zero all motion. Used for spawning and recovery. */
  placeAt(x: number, y: number, z: number, yaw: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.telemetry.overturnedTime = 0;
    this.prevHVel.set(0, 0, 0);
    this.impactCooldown = 0.3;
  }

  /** Advance vehicle forces by one fixed step. Call before `physics.step()`. */
  update(dt: number, input: DriveInput): void {
    const { spec, body, wheels, telemetry: t } = this;
    const tuning = MODE_TUNING[this.mode];
    const tr = body.translation();
    const rot = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();

    this.pos.set(tr.x, tr.y, tr.z);
    this.q.set(rot.x, rot.y, rot.z, rot.w);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.vel.set(lv.x, lv.y, lv.z);

    const forwardSpeed = this.vel.dot(this.fwd);
    const lateralSpeed = this.vel.dot(this.right);
    const speed = this.vel.length();

    // ---- Impact detection: tires cannot change horizontal velocity this fast. ----
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    const dvx = lv.x - this.prevHVel.x;
    const dvz = lv.z - this.prevHVel.z;
    const dv = Math.hypot(dvx, dvz);
    t.impact = 0;
    if (dv > 1.1 && this.impactCooldown === 0) {
      t.impact = dv;
      this.impactCooldown = 0.25;
      this.options.onImpact?.(dv);
    }

    // ---- Pedal intent ----
    let driveAmount = 0;
    let brakeAmount = 0;
    let direction: 1 | -1 = 1;
    const throttleIn = clamp(input.throttle, 0, 1);
    const brakeIn = clamp(input.brake, 0, 1);
    if (throttleIn > 0 && brakeIn === 0) {
      if (forwardSpeed < -1.0) brakeAmount = throttleIn;
      else driveAmount = throttleIn;
    } else if (brakeIn > 0 && throttleIn === 0) {
      if (forwardSpeed > 1.0) brakeAmount = brakeIn;
      else {
        driveAmount = brakeIn;
        direction = -1;
      }
    } else if (throttleIn > 0 && brakeIn > 0) {
      driveAmount = throttleIn;
      brakeAmount = brakeIn;
    }
    const idleHold = speed < 0.6 && throttleIn === 0 && brakeIn === 0 && !input.handbrake;
    t.braking = brakeAmount > 0.05;
    t.reversing = direction < 0 && driveAmount > 0;

    // ---- Steering (speed-sensitive, drift-aware, optional arcade counter-steer) ----
    const driftAngle = forwardSpeed > 2 ? Math.atan2(lateralSpeed, Math.abs(forwardSpeed)) : 0;
    const maxLat = tuning.gripMul * spec.gripFront * GRAVITY * 0.9;
    const limit = steerAngleLimit(Math.abs(forwardSpeed), spec, maxLat, tuning.steerAssistFactor, driftAngle);
    let target = clamp(input.steer, -1, 1) * limit;
    if (tuning.yawAssist > 0 && !input.handbrake && speed > 6 && Math.abs(driftAngle) > 0.12) {
      target += clamp(driftAngle * 0.9, -0.22, 0.22) * tuning.yawAssist;
    }
    target = clamp(target, -limit, limit);
    const returning = Math.abs(target) < Math.abs(this.steerAngle) || Math.sign(target) !== Math.sign(this.steerAngle);
    const rate = (spec.steerRate * (returning ? 1.7 : 1)) / (1 + Math.abs(forwardSpeed) / 40);
    this.steerAngle = approach(this.steerAngle, target, rate * dt);
    const wheelYaw = -this.steerAngle; // + yaw about Y is a left turn

    // ---- Drivetrain ----
    const drivenIdx = spec.driveType === 'rwd' ? [2, 3] : spec.driveType === 'fwd' ? [0, 1] : [0, 1, 2, 3];
    const drivenSpeed =
      drivenIdx.reduce((s, i) => s + Math.abs(wheels[i]?.grounded ? this.wheelLongSpeed(i) : forwardSpeed), 0) /
      drivenIdx.length;
    updateTransmission(this.transmission, spec, dt, drivenSpeed, driveAmount, direction);
    let totalDrive = driveForce(this.transmission, spec, driveAmount);
    if (direction < 0) {
      totalDrive *= clamp(1 - Math.abs(forwardSpeed) / spec.maxReverseSpeed, 0, 1);
    }
    if (input.nitro) totalDrive *= 1.5;

    // ---- Pass A: ray casts, spring loads ----
    const R = this.physics.RAPIER;
    const rayLen = spec.suspension.restLength + spec.wheelRadius;
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const h = this.hits[i];
      if (!w || !h) continue;
      this.tmp.copy(w.mount).applyQuaternion(this.q).add(this.pos);
      this.ray.origin = { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z };
      this.ray.dir = { x: -this.up.x, y: -this.up.y, z: -this.up.z };
      const hit = this.physics.world.castRayAndGetNormal(
        this.ray,
        rayLen,
        true,
        R.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body,
      );
      h.hit = false;
      h.spring = 0;
      if (hit) {
        h.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        if (h.normal.dot(this.up) > 0.3) {
          h.hit = true;
          const compression = clamp(rayLen - hit.timeOfImpact, 0, spec.suspension.restLength + 0.04);
          w.contact.copy(this.tmp).addScaledVector(this.up, -hit.timeOfImpact);
          const v = body.velocityAtPoint({ x: w.contact.x, y: w.contact.y, z: w.contact.z });
          h.vel.set(v.x, v.y, v.z);
          const vu = h.vel.dot(this.up);
          let spring = spec.suspension.stiffness * compression - spec.suspension.damping * vu;
          const stop = spec.suspension.restLength * 0.95;
          if (compression > stop) spring += 160000 * (compression - stop);
          h.spring = Math.max(0, spring);
          w.compression = compression;
          grounded++;
        }
      }
      w.grounded = h.hit;
      if (!h.hit) {
        // Relax toward fully extended while airborne.
        w.compression = approach(w.compression, 0, dt * 1.5);
        w.load = 0;
        w.slip = 0;
      }
    }

    // Anti-roll bars (front axle then rear axle).
    for (const [l, r] of [
      [0, 1],
      [2, 3],
    ] as const) {
      const wl = wheels[l];
      const wr = wheels[r];
      const hl = this.hits[l];
      const hr = this.hits[r];
      if (!wl || !wr || !hl || !hr) continue;
      const diff = (hl.hit ? wl.compression : 0) - (hr.hit ? wr.compression : 0);
      const bar = spec.suspension.antiRoll * diff;
      if (hl.hit) hl.spring = Math.max(0, hl.spring + bar);
      if (hr.hit) hr.spring = Math.max(0, hr.spring - bar);
    }

    // ---- Pass B: tire forces (accumulate, then apply) ----
    const impulses: { p: THREE.Vector3; f: THREE.Vector3 }[] = [];
    let sumFy = 0;
    let sumFx = 0;
    const mEff = spec.mass / 4;
    const lift = 0.27; // apply tire forces slightly above ground to limit rollover torque
    const brakeForceTotal = spec.brakeForce * tuning.brakeMul;

    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const h = this.hits[i];
      if (!w || !h || !h.hit) continue;
      const isFront = w.front;
      const isDriven = drivenIdx.includes(i);
      const handbraked = input.handbrake && !isFront;

      // Wheel frame: forward rotated by steer, projected on contact plane.
      this.tmp.copy(this.fwd);
      if (isFront) {
        this.yawQ.setFromAxisAngle(this.up, wheelYaw);
        this.tmp.applyQuaternion(this.yawQ);
      }
      this.tmp.addScaledVector(h.normal, -this.tmp.dot(h.normal)).normalize();
      const f = this.tmp.clone();
      const r = this.tmp2.crossVectors(f, h.normal).normalize().clone();
      w.steerYaw = isFront ? wheelYaw : 0;

      const vlong = h.vel.dot(f);
      const vlat = h.vel.dot(r);
      const surface = this.options.gripAt ? this.options.gripAt(w.contact.x, w.contact.z) : 1;
      const mu = (isFront ? spec.gripFront : spec.gripRear) * tuning.gripMul * surface;
      const load = h.spring;
      w.load = load;
      const budget = mu * load;
      const stopForce = (mEff * Math.abs(vlong)) / dt;

      let fx: number;
      let fy: number;
      let slip: number;

      if (handbraked) {
        // Locked wheel: kinetic friction opposes the full contact velocity (this is what drifts the car).
        const vmag = Math.hypot(vlong, vlat);
        if (vmag > 0.5) {
          const kin = budget * 0.82;
          fx = (-kin * vlong) / vmag;
          fy = (-kin * vlat * 0.9) / vmag;
          slip = 1.4;
        } else {
          fx = clamp((-vlong * mEff) / dt, -budget, budget);
          fy = clamp((-vlat * mEff) / dt, -budget, budget);
          slip = 0;
        }
      } else {
        // Longitudinal: drive + brake + rolling resistance (never reverses the wheel's motion).
        let fxDrive = 0;
        if (isDriven && totalDrive !== 0) fxDrive = (totalDrive / drivenIdx.length) * direction;
        const brakeShare = isFront ? spec.brakeBiasFront / 2 : (1 - spec.brakeBiasFront) / 2;
        let brakeMag = brakeForceTotal * brakeAmount * brakeShare * 2 * 0.5;
        if (idleHold) brakeMag = stopForce;
        brakeMag = Math.min(brakeMag, stopForce);
        const rollMag = Math.min(spec.rollingResistance * load, stopForce);
        const sgn = Math.abs(vlong) > 0.02 ? Math.sign(vlong) : 0;
        fx = fxDrive - sgn * (brakeMag + rollMag);

        const fxClamped = clamp(fx, -budget, budget);
        const lateralBudget = Math.sqrt(Math.max(0, budget * budget - fxClamped * fxClamped));
        const desired = ((-vlat * mEff) / dt) * tuning.lateralResponse;
        if (Math.abs(desired) <= lateralBudget) {
          fy = desired;
          slip = lateralBudget > 1 ? Math.abs(desired) / lateralBudget : 0;
        } else {
          fy = Math.sign(desired) * lateralBudget * 0.9;
          slip = Math.abs(desired) / Math.max(lateralBudget, 1);
        }
        slip = Math.max(slip * 0.75, budget > 1 ? Math.abs(fx) / budget : 0);
        fx = fxClamped;
      }
      w.slip = slip;

      sumFy += fy;
      sumFx += fx;

      // Wheel spin animation.
      let wheelSurfaceSpeed = vlong;
      if (handbraked && Math.abs(vlong) > 0.5) wheelSurfaceSpeed = 0;
      else if (isDriven && totalDrive !== 0 && Math.abs(fx) >= budget * 0.98) {
        wheelSurfaceSpeed = vlong + 9 * direction;
      }
      w.spin += (wheelSurfaceSpeed / spec.wheelRadius) * dt;

      const force = f.clone().multiplyScalar(fx).addScaledVector(r, fy);
      const point = w.contact.clone().addScaledVector(this.up, lift);
      impulses.push({ p: point, f: force.multiplyScalar(dt) });

      // Suspension load pushes the chassis up from the contact point.
      impulses.push({
        p: w.contact.clone(),
        f: this.up.clone().multiplyScalar(h.spring * dt),
      });
    }

    for (const { p, f } of impulses) {
      body.applyImpulseAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
    }

    // ---- Aerodynamics ----
    if (speed > 0.1) {
      const drag = spec.dragCoeff * speed * dt;
      body.applyImpulse({ x: -lv.x * drag, y: -lv.y * drag * 0.2, z: -lv.z * drag }, true);
      const down = spec.downforceCoeff * speed * speed * dt;
      body.applyImpulse({ x: -this.up.x * down, y: -this.up.y * down, z: -this.up.z * down }, true);
    }

    // ---- Arcade yaw stabiliser: gently resists spins once the slide gets extreme ----
    if (tuning.yawAssist > 0 && !input.handbrake && grounded >= 3 && speed > 6) {
      const excess = Math.abs(driftAngle) - 0.5;
      if (excess > 0) {
        const alpha = -Math.sign(driftAngle) * excess * 5 * tuning.yawAssist;
        const torque = this.inertiaY * alpha * dt;
        body.applyTorqueImpulse({ x: this.up.x * torque, y: this.up.y * torque, z: this.up.z * torque }, true);
      }
    }

    // ---- Telemetry ----
    this.prevHVel.set(lv.x, 0, lv.z);
    t.speed = speed;
    t.forwardSpeed = forwardSpeed;
    t.speedKmh = msToKmh(Math.abs(forwardSpeed));
    t.rpm = this.transmission.rpm;
    t.gear = this.transmission.gear;
    t.throttle = driveAmount;
    t.brake = brakeAmount;
    t.steer = this.steerAngle / spec.maxSteerAngle;
    t.handbrake = input.handbrake;
    t.driftAngle = driftAngle;
    t.drifting = speed > 5 && (Math.abs(driftAngle) > 0.22 || (input.handbrake && speed > 8));
    t.lateralG = sumFy / (spec.mass * GRAVITY);
    t.longitudinalG = sumFx / (spec.mass * GRAVITY);
    t.yawRate = av.y;
    t.groundedWheels = grounded;
    t.upright = this.up.y;
    t.overturnedTime = this.up.y < 0.35 && speed < 6 ? t.overturnedTime + dt : 0;
  }

  /** Approximate longitudinal ground speed under a driven wheel. */
  private wheelLongSpeed(i: number): number {
    const h = this.hits[i];
    if (!h) return 0;
    return h.vel.dot(this.fwd);
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}
