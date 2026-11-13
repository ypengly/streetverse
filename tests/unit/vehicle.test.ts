import { describe, it, expect } from 'vitest';
import { createSim } from './harness';
import { STARTER_SPEC } from '../../src/vehicles/VehiclePhysics';

async function atSpeed(mode: 'arcade' | 'sport', kmh: number, walls = false, gripAt?: (x: number, z: number) => number) {
  const s = await createSim(mode, undefined, walls, gripAt);
  s.run(1.5, {});
  for (let i = 0; i < 3000 && s.car.telemetry.speedKmh < kmh; i++) {
    s.run(1 / 120, { throttle: s.car.telemetry.speedKmh < kmh - 3 ? 1 : 0.15 });
  }
  return s;
}

describe('vehicle: suspension and rest', () => {
  it('settles on its springs at a sensible ride height with all wheels grounded', async () => {
    const s = await createSim();
    s.run(2, {});
    expect(s.pos().y).toBeGreaterThan(0.55);
    expect(s.pos().y).toBeLessThan(0.66);
    expect(s.car.telemetry.groundedWheels).toBe(4);
    expect(s.car.telemetry.speed).toBeLessThan(0.1);
  });

  it('is deterministic for identical inputs (fixed timestep)', async () => {
    const a = await createSim();
    const b = await createSim();
    const script = (t: number) => ({ throttle: 1, steer: Math.sin(t * 2) });
    a.run(4, script);
    b.run(4, script);
    expect(a.pos().x).toBeCloseTo(b.pos().x, 6);
    expect(a.pos().z).toBeCloseTo(b.pos().z, 6);
  });
});

describe('vehicle: longitudinal', () => {
  it('accelerates forward (-Z) and reaches 100 km/h in under 6 s', async () => {
    const s = await createSim();
    s.run(1.5, {});
    const start = s.time;
    let t100 = Infinity;
    for (let i = 0; i < 1200 && t100 === Infinity; i++) {
      s.run(1 / 120, { throttle: 1 });
      if (s.car.telemetry.speedKmh >= 100) t100 = s.time - start;
    }
    expect(t100).toBeLessThan(6);
    expect(s.car.telemetry.forwardSpeed).toBeGreaterThan(0);
    expect(s.pos().z).toBeLessThan(-20);
  });

  it('shifts up through the gears as speed rises', async () => {
    const s = await createSim();
    s.run(1, {});
    const seen = new Set<number>();
    for (let i = 0; i < 1200; i++) {
      s.run(1 / 120, { throttle: 1 });
      seen.add(s.car.telemetry.gear);
    }
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(4);
    expect(seen.has(1) && seen.has(2) && seen.has(3)).toBe(true);
  });

  it('brakes from 100 km/h to a stop in under 60 m without reversing', async () => {
    const s = await atSpeed('arcade', 100);
    const z0 = s.pos().z;
    let minForward = Infinity;
    for (let i = 0; i < 1200 && s.car.telemetry.speed > 0.3; i++) {
      s.run(1 / 120, { brake: 1 });
      minForward = Math.min(minForward, s.car.telemetry.forwardSpeed);
    }
    expect(z0 - s.pos().z).toBeLessThan(60);
    expect(minForward).toBeGreaterThan(-0.5);
  });

  it('reverses when brake is held at a standstill, capped near the reverse speed limit', async () => {
    const s = await createSim();
    s.run(1, {});
    s.run(5, { brake: 1 });
    const t = s.car.telemetry;
    expect(t.forwardSpeed).toBeLessThan(-3);
    expect(t.gear).toBe(-1);
    expect(Math.abs(t.forwardSpeed)).toBeLessThan(STARTER_SPEC.maxReverseSpeed + 1.5);
  });

  it('holds still on flat ground with no input (no creeping)', async () => {
    const s = await createSim();
    s.run(6, {});
    expect(Math.hypot(s.pos().x, s.pos().z)).toBeLessThan(0.3);
  });

  it('braking distance grows on low-grip surfaces', async () => {
    const dist = async (gripWhileBraking: number) => {
      let grip = 1; // normal grip while accelerating, then switch before braking
      const s = await atSpeed('arcade', 100, false, () => grip);
      grip = gripWhileBraking;
      const z0 = s.pos().z;
      for (let i = 0; i < 1500 && s.car.telemetry.speed > 0.3; i++) s.run(1 / 120, { brake: 1 });
      return z0 - s.pos().z;
    };
    const normal = await dist(1);
    const slippery = await dist(0.5);
    expect(slippery).toBeGreaterThan(normal * 1.3);
  });
});

describe('vehicle: lateral handling', () => {
  it('steers right with D (negative yaw rate) and left with A at multiple speeds', async () => {
    for (const kmh of [40, 100]) {
      const r = await atSpeed('arcade', kmh);
      r.run(1.2, { throttle: 0.2, steer: 1 });
      expect(r.car.telemetry.yawRate).toBeLessThan(-0.2);
      const l = await atSpeed('arcade', kmh);
      l.run(1.2, { throttle: 0.2, steer: -1 });
      expect(l.car.telemetry.yawRate).toBeGreaterThan(0.2);
    }
  });

  it('turns less sharply at high speed than at low speed (speed-sensitive steering)', async () => {
    const slow = await atSpeed('arcade', 40);
    slow.run(1.5, { throttle: 0.2, steer: 1 });
    const fast = await atSpeed('arcade', 160);
    fast.run(1.5, { throttle: 0.2, steer: 1 });
    expect(Math.abs(fast.car.telemetry.yawRate)).toBeLessThan(Math.abs(slow.car.telemetry.yawRate) * 0.6);
  });

  it('never rolls over under full steering lock at any speed', async () => {
    for (const mode of ['arcade', 'sport'] as const) {
      for (const kmh of [40, 100, 160]) {
        const s = await atSpeed(mode, kmh);
        let minUp = 1;
        for (let i = 0; i < 360; i++) {
          s.run(1 / 120, { throttle: 0.2, steer: 1 });
          minUp = Math.min(minUp, s.car.telemetry.upright);
        }
        expect(minUp).toBeGreaterThan(0.9);
      }
    }
  });

  it('sustains roughly 1 g of cornering grip', async () => {
    const s = await atSpeed('arcade', 100);
    let peak = 0;
    for (let i = 0; i < 360; i++) {
      s.run(1 / 120, { throttle: 0.2, steer: 1 });
      peak = Math.max(peak, Math.abs(s.car.telemetry.lateralG));
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan(2);
  });

  it('handbrake + steer produces a real drift (large slip angle) and flags drifting', async () => {
    const s = await atSpeed('arcade', 90);
    let maxDrift = 0;
    let sawDrifting = false;
    for (let i = 0; i < 90; i++) {
      s.run(1 / 120, { steer: 1, handbrake: true });
      maxDrift = Math.max(maxDrift, Math.abs(s.car.telemetry.driftAngle));
      sawDrifting ||= s.car.telemetry.drifting;
    }
    expect(maxDrift).toBeGreaterThan(0.3);
    expect(sawDrifting).toBe(true);
  });

  it('handbrake alone locks the rears and sheds speed faster than coasting', async () => {
    const a = await atSpeed('arcade', 90);
    const b = await atSpeed('arcade', 90);
    a.run(1.5, { handbrake: true });
    b.run(1.5, {});
    expect(a.car.telemetry.speed).toBeLessThan(b.car.telemetry.speed - 3);
  });

  it('Sport mode punishes aggressive input more than Arcade (greater slip angle)', async () => {
    const worst = async (mode: 'arcade' | 'sport') => {
      const s = await atSpeed(mode, 60);
      let w = 0;
      for (let i = 0; i < 360; i++) {
        s.run(1 / 120, { throttle: 1, steer: 1 });
        w = Math.max(w, Math.abs(s.car.telemetry.driftAngle));
      }
      return w;
    };
    expect(await worst('sport')).toBeGreaterThan(await worst('arcade'));
  });
});

describe('vehicle: collisions and recovery', () => {
  it('stops at a wall without tunnelling and reports an impact', async () => {
    const s = await atSpeed('arcade', 100, true);
    for (let i = 0; i < 1200; i++) {
      s.run(1 / 120, { throttle: 1 });
      if (s.pos().z < -151.5) break;
    }
    expect(s.pos().z).toBeGreaterThan(-150); // wall face at z = -149.5; car centre stays this side
    expect(s.impacts.length).toBeGreaterThan(0);
    expect(Math.max(...s.impacts)).toBeGreaterThan(10);
    expect(s.car.telemetry.speed).toBeLessThan(3);
  });

  it('a gentle bump does not trigger a collision', async () => {
    const s = await atSpeed('arcade', 20, true);
    s.run(1, { throttle: 0.1 });
    expect(s.impacts.length).toBe(0);
  });

  it('flags an overturned car, and recovery restores an upright, stationary car', async () => {
    const s = await createSim();
    s.run(1, {});
    s.car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down
    s.car.body.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    s.run(2.5, {});
    expect(s.car.telemetry.upright).toBeLessThan(0);
    expect(s.car.telemetry.overturnedTime).toBeGreaterThan(1.5);

    s.car.placeAt(5, 0.8, 5, 0.7);
    s.run(1.5, {});
    expect(s.car.telemetry.upright).toBeGreaterThan(0.98);
    expect(s.car.telemetry.groundedWheels).toBe(4);
    expect(s.car.telemetry.overturnedTime).toBe(0);
    expect(s.car.telemetry.speed).toBeLessThan(0.3);
  });
});
