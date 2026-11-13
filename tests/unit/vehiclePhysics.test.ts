import { describe, it, expect } from 'vitest';
import {
  STARTER_SPEC as S,
  createTransmission,
  driveForce,
  engineTorque,
  gearRatio,
  steerAngleLimit,
  updateTransmission,
  wheelRpm,
} from '../../src/vehicles/VehiclePhysics';

describe('engine', () => {
  it('peaks in the mid-range and tapers toward idle and redline', () => {
    const mid = engineTorque(S.engine.redlineRpm * 0.62, S);
    expect(mid).toBeCloseTo(S.engine.peakTorque, 0);
    expect(engineTorque(S.engine.idleRpm, S)).toBeLessThan(mid);
    expect(engineTorque(S.engine.redlineRpm, S)).toBeLessThan(mid);
    expect(engineTorque(S.engine.idleRpm, S)).toBeGreaterThan(0);
  });
});

describe('steering limit', () => {
  const lim = (v: number, d = 0) => steerAngleLimit(v, S, 12, 1.5, d);
  it('decreases monotonically with speed', () => {
    let prev = Infinity;
    for (const v of [3, 8, 15, 25, 40, 60]) {
      const l = lim(v);
      expect(l).toBeLessThanOrEqual(prev);
      prev = l;
    }
  });
  it('never exceeds the mechanical maximum and never reaches zero', () => {
    expect(lim(0)).toBeLessThanOrEqual(S.maxSteerAngle);
    expect(lim(80)).toBeGreaterThan(0.03);
  });
  it('widens during a slide so the player can counter-steer', () => {
    expect(lim(30, 0.4)).toBeGreaterThan(lim(30, 0));
  });
});

describe('transmission', () => {
  it('upshifts at high rpm and downshifts when slowing', () => {
    const t = createTransmission(S);
    updateTransmission(t, S, 0.01, 25, 1, 1);
    expect(t.gear).toBe(2);
    expect(t.shiftTimer).toBeGreaterThan(0);

    t.gear = 4;
    t.shiftTimer = 0;
    updateTransmission(t, S, 0.01, 6, 0.3, 1);
    expect(t.gear).toBeLessThan(4);
  });
  it('cuts torque during a shift and at the rev limiter', () => {
    const t = createTransmission(S);
    t.shiftTimer = 0.2;
    expect(driveForce(t, S, 1)).toBe(0);
    t.shiftTimer = 0;
    t.rpm = S.engine.redlineRpm;
    expect(driveForce(t, S, 1)).toBe(0);
    t.rpm = 4000;
    expect(driveForce(t, S, 1)).toBeGreaterThan(1000);
  });
  it('uses reverse in the reverse direction and never an invalid gear', () => {
    const t = createTransmission(S);
    updateTransmission(t, S, 0.01, 2, 1, -1);
    expect(t.gear).toBe(-1);
    expect(gearRatio(S, -1)).toBeGreaterThan(0);
    expect(wheelRpm(10, 3, S)).toBeGreaterThan(0);
  });
});
