/**
 * Circuit: pure geometric description of the road loop (no rendering, no physics).
 * Provides nearest-point queries used for surface grip, recovery, and later routing/minimap.
 */
import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 7;
export const SIDEWALK_WIDTH = 3.5;
export const CURB_HEIGHT = 0.12;
export const BARRIER_OFFSET = ROAD_HALF_WIDTH + SIDEWALK_WIDTH + 0.5;

/** Control points (x, z) of the closed circuit, in metres. */
export const DEFAULT_CONTROL_POINTS: [number, number][] = [
  [-120, -170],
  [0, -195],
  [130, -170],
  [200, -90],
  [180, 10],
  [95, 60],
  [115, 145],
  [60, 205],
  [-40, 195],
  [-85, 125],
  [-175, 105],
  [-210, 10],
  [-180, -85],
];

export type SurfaceType = 'asphalt' | 'curb' | 'grass';

export interface NearestResult {
  index: number;
  distance: number;
  /** Signed lateral offset from centreline: positive = right of travel direction. */
  lateral: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
}

export const SURFACE_GRIP: Record<SurfaceType, number> = { asphalt: 1, curb: 0.9, grass: 0.62 };

export class Circuit {
  readonly points: THREE.Vector3[] = [];
  readonly tangents: THREE.Vector3[] = [];
  readonly rights: THREE.Vector3[] = [];
  readonly cumulative: number[] = [];
  readonly length: number;

  constructor(controlPoints: [number, number][] = DEFAULT_CONTROL_POINTS, samples = 480) {
    const curve = new THREE.CatmullRomCurve3(
      controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    const pts = curve.getSpacedPoints(samples);
    pts.pop(); // last duplicates the first on a closed curve
    this.points = pts;
    const n = pts.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i] as THREE.Vector3;
      const next = pts[(i + 1) % n] as THREE.Vector3;
      const prev = pts[(i - 1 + n) % n] as THREE.Vector3;
      const tan = next.clone().sub(prev).setY(0).normalize();
      this.tangents.push(tan);
      this.rights.push(new THREE.Vector3(-tan.z, 0, tan.x));
      this.cumulative.push(acc);
      acc += p.distanceTo(next);
    }
    this.length = acc;
  }

  /** Nearest point on the centreline polyline (projected onto segments). */
  nearest(x: number, z: number): NearestResult {
    const n = this.points.length;
    let best = Infinity;
    let bestI = 0;
    let bestT = 0;
    for (let i = 0; i < n; i++) {
      const a = this.points[i] as THREE.Vector3;
      const b = this.points[(i + 1) % n] as THREE.Vector3;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2)) : 0;
      const dx = a.x + abx * t - x;
      const dz = a.z + abz * t - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bestI = i;
        bestT = t;
      }
    }
    const a = this.points[bestI] as THREE.Vector3;
    const b = this.points[(bestI + 1) % n] as THREE.Vector3;
    const point = a.clone().lerp(b, bestT);
    const tangent = (this.tangents[bestI] as THREE.Vector3)
      .clone()
      .lerp(this.tangents[(bestI + 1) % n] as THREE.Vector3, bestT)
      .normalize();
    const rx = -tangent.z;
    const rz = tangent.x;
    const lateral = (x - point.x) * rx + (z - point.z) * rz;
    return { index: bestI, distance: Math.sqrt(best), lateral, point, tangent };
  }

  surfaceAt(x: number, z: number): SurfaceType {
    const d = Math.abs(this.nearest(x, z).lateral);
    if (d <= ROAD_HALF_WIDTH) return 'asphalt';
    if (d <= ROAD_HALF_WIDTH + SIDEWALK_WIDTH) return 'curb';
    return 'grass';
  }

  gripAt = (x: number, z: number): number => SURFACE_GRIP[this.surfaceAt(x, z)];

  /** Yaw (about +Y) that makes a car (forward = -Z) face along `tangent`. */
  static yawFor(tangent: THREE.Vector3): number {
    return Math.atan2(-tangent.x, -tangent.z);
  }

  spawnPose(): { x: number; y: number; z: number; yaw: number } {
    const p = this.points[0] as THREE.Vector3;
    const t = this.tangents[0] as THREE.Vector3;
    const r = this.rights[0] as THREE.Vector3;
    // Right lane, driving direction.
    return { x: p.x + r.x * 3.2, y: 0.7, z: p.z + r.z * 3.2, yaw: Circuit.yawFor(t) };
  }

  /** Safe nearby road pose for recovery: nearest road point, right lane, facing travel direction. */
  recoveryPose(x: number, z: number): { x: number; y: number; z: number; yaw: number } {
    const n = this.nearest(x, z);
    const r = new THREE.Vector3(-n.tangent.z, 0, n.tangent.x);
    return {
      x: n.point.x + r.x * 3.2,
      y: 0.8,
      z: n.point.z + r.z * 3.2,
      yaw: Circuit.yawFor(n.tangent),
    };
  }

  /** Smallest turning radius along the centreline (metres). */
  minRadius(): number {
    const n = this.points.length;
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      const a = this.points[(i - 3 + n) % n] as THREE.Vector3;
      const b = this.points[i] as THREE.Vector3;
      const c = this.points[(i + 3) % n] as THREE.Vector3;
      const ab = a.distanceTo(b);
      const bc = b.distanceTo(c);
      const ca = c.distanceTo(a);
      const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      if (area2 < 1e-6) continue;
      min = Math.min(min, (ab * bc * ca) / (2 * area2));
    }
    return min;
  }

  /** Does the centreline cross itself? (Checked with segment intersection.) */
  selfIntersects(): boolean {
    const n = this.points.length;
    const step = 4;
    for (let i = 0; i < n; i += step) {
      const a1 = this.points[i] as THREE.Vector3;
      const a2 = this.points[(i + step) % n] as THREE.Vector3;
      for (let j = i + step * 2; j < n; j += step) {
        if ((j + step) % n === i || j === i) continue;
        const b1 = this.points[j] as THREE.Vector3;
        const b2 = this.points[(j + step) % n] as THREE.Vector3;
        if (segmentsIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }
}

function segmentsIntersect(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3): boolean {
  const d = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number =>
    (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
