import { describe, it, expect } from 'vitest';
import { Circuit, ROAD_HALF_WIDTH, SIDEWALK_WIDTH, BARRIER_OFFSET } from '../../src/world/Circuit';

describe('Circuit', () => {
  const c = new Circuit();
  it('is a closed loop of sensible length that does not cross itself', () => {
    expect(c.length).toBeGreaterThan(900);
    expect(c.selfIntersects()).toBe(false);
  });
  it('has turns wide enough that road, sidewalks and barriers do not fold over themselves', () => {
    expect(c.minRadius()).toBeGreaterThan(BARRIER_OFFSET + 8);
  });
  it('classifies surfaces by lateral distance', () => {
    const p = c.points[40]!;
    const r = c.rights[40]!;
    expect(c.surfaceAt(p.x, p.z)).toBe('asphalt');
    expect(c.surfaceAt(p.x + r.x * (ROAD_HALF_WIDTH + 1), p.z + r.z * (ROAD_HALF_WIDTH + 1))).toBe('curb');
    expect(
      c.surfaceAt(p.x + r.x * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH + 3), p.z + r.z * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH + 3)),
    ).toBe('grass');
  });
  it('reports signed lateral offset (positive = right of travel)', () => {
    const p = c.points[100]!;
    const r = c.rights[100]!;
    expect(c.nearest(p.x + r.x * 2, p.z + r.z * 2).lateral).toBeGreaterThan(1.5);
    expect(c.nearest(p.x - r.x * 2, p.z - r.z * 2).lateral).toBeLessThan(-1.5);
  });
  it('recovery pose is on asphalt and faces along the road', () => {
    const pose = c.recoveryPose(10, 0); // somewhere off-road in the infield
    expect(c.surfaceAt(pose.x, pose.z)).toBe('asphalt');
    const n = c.nearest(pose.x, pose.z);
    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    expect(fx * n.tangent.x + fz * n.tangent.z).toBeGreaterThan(0.99);
  });
});
