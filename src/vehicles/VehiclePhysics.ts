/**
 * Pure (rendering-free, Rapier-free) vehicle model: specs, engine, transmission, steering limits.
 * Everything here is deterministic and unit-testable in plain Node.
 */
import { clamp } from '../utils/math';

export type DrivingMode = 'arcade' | 'sport';
export type DriveType = 'rwd' | 'fwd' | 'awd';

export interface VehicleSpec {
  id: string;
  name: string;
  category: string;
  mass: number;
  /** Half extents of the chassis collider (x width, y height, z length). */
  halfExtents: [number, number, number];
  wheelRadius: number;
  wheelWidth: number;
  trackWidth: number;
  /** Z of the front axle (negative = forward) and rear axle, relative to the centre of mass. */
  frontAxleZ: number;
  rearAxleZ: number;
  /** Y of suspension mount relative to centre of mass. */
  mountY: number;
  suspension: {
    restLength: number;
    stiffness: number; // N/m per wheel
    damping: number; // Ns/m per wheel
    antiRoll: number; // N/m per axle
  };
  engine: {
    idleRpm: number;
    redlineRpm: number;
    peakTorque: number;
    launchRpm: number;
  };
  gearRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  drivetrainEfficiency: number;
  driveType: DriveType;
  brakeForce: number; // total N at full pedal
  brakeBiasFront: number;
  handbrakeForce: number;
  gripFront: number;
  gripRear: number;
  /** 0.5 * rho * Cd * A */
  dragCoeff: number;
  downforceCoeff: number;
  rollingResistance: number;
  maxSteerAngle: number;
  steerRate: number;
  maxReverseSpeed: number;
}

/** Starter car. Fictional model; original name. */
export const STARTER_SPEC: VehicleSpec = {
  id: 'kestrel-s1',
  name: 'Kestrel S1',
  category: 'Sports',
  mass: 1300,
  halfExtents: [0.9, 0.36, 2.15],
  wheelRadius: 0.34,
  wheelWidth: 0.24,
  trackWidth: 1.56,
  frontAxleZ: -1.38,
  rearAxleZ: 1.32,
  mountY: -0.05,
  suspension: { restLength: 0.3, stiffness: 36000, damping: 2900, antiRoll: 9000 },
  engine: { idleRpm: 900, redlineRpm: 7000, peakTorque: 420, launchRpm: 3200 },
  gearRatios: [3.45, 2.3, 1.68, 1.28, 1.0, 0.82],
  reverseRatio: 3.2,
  finalDrive: 3.7,
  drivetrainEfficiency: 0.85,
  driveType: 'rwd',
  brakeForce: 16500,
  brakeBiasFront: 0.62,
  handbrakeForce: 9000,
  gripFront: 1.3,
  gripRear: 1.25,
  dragCoeff: 0.4,
  downforceCoeff: 0.35,
  rollingResistance: 0.015,
  maxSteerAngle: 0.56,
  steerRate: 3.2,
  maxReverseSpeed: 9,
};

export interface ModeTuning {
  gripMul: number;
  /** Multiplier on the lateral acceleration the steering limit is computed against. */
  steerAssistFactor: number;
  lateralResponse: number;
  angularDamping: number;
  yawAssist: number;
  brakeMul: number;
}

export const MODE_TUNING: Record<DrivingMode, ModeTuning> = {
  arcade: {
    gripMul: 1.15,
    steerAssistFactor: 1.7,
    lateralResponse: 0.85,
    angularDamping: 1.6,
    yawAssist: 1.0,
    brakeMul: 1.0,
  },
  sport: {
    gripMul: 0.95,
    steerAssistFactor: 1.2,
    lateralResponse: 0.65,
    angularDamping: 0.35,
    yawAssist: 0.0,
    brakeMul: 0.9,
  },
};

/** Engine torque (Nm) at a given rpm; broad mid-range peak, tapering toward idle and redline. */
export function engineTorque(rpm: number, spec: VehicleSpec): number {
  const x = rpm / spec.engine.redlineRpm;
  const curve = clamp(1 - 1.7 * Math.pow(x - 0.62, 2), 0.35, 1);
  return spec.engine.peakTorque * curve;
}

/**
 * Maximum steering angle (rad) such that, at `speed`, the front tires are asked for roughly the
 * lateral acceleration the car can sustain. `assist` > 1 lets the player slightly over-steer (to
 * feel limits). `driftAngle` widens the limit so the player can counter-steer during slides.
 */
export function steerAngleLimit(
  speed: number,
  spec: VehicleSpec,
  maxLatAccel: number,
  assist: number,
  driftAngle = 0,
): number {
  const wheelBase = spec.rearAxleZ - spec.frontAxleZ;
  const v2 = Math.max(speed * speed, 9);
  const grip = Math.atan((wheelBase * maxLatAccel * assist) / v2);
  return clamp(Math.max(grip, 0.04) + Math.abs(driftAngle) * 0.9, 0.04, spec.maxSteerAngle);
}

export interface TransmissionState {
  gear: number; // -1 reverse, 0 neutral, 1..n
  shiftTimer: number;
  rpm: number;
}

export function createTransmission(spec: VehicleSpec): TransmissionState {
  return { gear: 1, shiftTimer: 0, rpm: spec.engine.idleRpm };
}

export function gearRatio(spec: VehicleSpec, gear: number): number {
  if (gear < 0) return spec.reverseRatio * spec.finalDrive;
  if (gear === 0) return 0;
  const r = spec.gearRatios[Math.min(gear, spec.gearRatios.length) - 1] ?? 1;
  return r * spec.finalDrive;
}

/** Engine rpm implied by the driven wheels' ground speed in a given gear. */
export function wheelRpm(wheelSpeed: number, gear: number, spec: VehicleSpec): number {
  const omega = Math.abs(wheelSpeed) / spec.wheelRadius;
  return (omega * Math.abs(gearRatio(spec, gear)) * 60) / (2 * Math.PI);
}

/**
 * Advance the automatic transmission. `direction` is +1 forward / -1 reverse. State is mutated in
 * place. Shifts use hysteresis and a short torque-cut timer.
 */
export function updateTransmission(
  t: TransmissionState,
  spec: VehicleSpec,
  dt: number,
  drivenWheelSpeed: number,
  throttle: number,
  direction: 1 | -1,
): void {
  const top = spec.gearRatios.length;
  t.shiftTimer = Math.max(0, t.shiftTimer - dt);

  if (direction < 0) {
    t.gear = -1;
  } else if (t.gear < 1) {
    t.gear = 1;
  }

  const rpmNow = wheelRpm(drivenWheelSpeed, t.gear, spec);

  if (t.gear > 0 && t.shiftTimer === 0) {
    const up = spec.engine.redlineRpm * 0.88;
    const down = spec.engine.redlineRpm * (0.34 + 0.12 * throttle);
    if (rpmNow > up && t.gear < top) {
      t.gear += 1;
      t.shiftTimer = 0.22;
    } else if (rpmNow < down && t.gear > 1) {
      const lowerRpm = wheelRpm(drivenWheelSpeed, t.gear - 1, spec);
      if (lowerRpm < spec.engine.redlineRpm * 0.85) {
        t.gear -= 1;
        t.shiftTimer = 0.15;
      }
    }
  }

  // Effective rpm: clutch slip lets the engine rev above wheel speed when launching.
  const launch = spec.engine.idleRpm + (spec.engine.launchRpm - spec.engine.idleRpm) * throttle;
  const target = Math.max(wheelRpm(drivenWheelSpeed, t.gear, spec), launch * (rpmNow < launch ? 1 : 0));
  t.rpm += (clamp(target, spec.engine.idleRpm, spec.engine.redlineRpm) - t.rpm) * Math.min(1, dt * 14);
}

/** Total drive force (N) at the contact patches for the current rpm/gear/throttle. */
export function driveForce(t: TransmissionState, spec: VehicleSpec, throttle: number): number {
  if (t.gear === 0 || t.shiftTimer > 0) return 0;
  if (t.rpm >= spec.engine.redlineRpm * 0.985) return 0; // rev limiter
  const torque = engineTorque(t.rpm, spec) * throttle;
  return (torque * gearRatio(spec, t.gear) * spec.drivetrainEfficiency) / spec.wheelRadius;
}
