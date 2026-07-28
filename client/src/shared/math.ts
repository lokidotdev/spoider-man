/**
 * Dependency-free geometry helpers. The server has no Three.js and no Rapier,
 * so every server-side spatial query (line of sight, projectile collision,
 * splash falloff) is resolved with these.
 */

import type { AABB } from './world';

export type Vec3 = { x: number; y: number; z: number };

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lengthSq = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : vec(0, 0, 0);
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Slab-method ray/AABB intersection.
 * Returns the entry distance along `dir` (assumed normalized), or null.
 */
export function rayAABB(origin: Vec3, dir: Vec3, box: AABB, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;

  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      // Ray runs parallel to this slab: it can only miss.
      if (o[i] < box.min[i] || o[i] > box.max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (box.min[i] - o[i]) * inv;
    let t2 = (box.max[i] - o[i]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/**
 * Ray against a vertical capsule (the player collider): the segment
 * `base`..`base + height` swept by `radius`. Returns the entry distance, 0 if
 * the ray starts inside, or null for a miss. `dir` must be normalized.
 *
 * Solved in closed form rather than by sampling the ray. A sampler has to
 * choose a step size, and the only honest one here is a fraction of the
 * *radius* — but the ray can be 200m long, so that is thousands of steps per
 * pellet. Sampling across the full range instead means a 0.3m-wide body is
 * simply stepped over: nearly every long shot registers as a clean miss even
 * when it goes straight through someone.
 */
export function rayCapsule(
  origin: Vec3,
  dir: Vec3,
  base: Vec3,
  height: number,
  radius: number,
  maxDist: number
): number | null {
  const y0 = base.y;
  const y1 = base.y + height;
  const r2 = radius * radius;

  const ox = origin.x - base.x;
  const oz = origin.z - base.z;

  // Muzzle already inside the body: point blank.
  {
    const cy = clamp(origin.y, y0, y1);
    const dy = origin.y - cy;
    if (ox * ox + dy * dy + oz * oz <= r2) return 0;
  }

  let best = Infinity;

  // Side wall: an infinite vertical cylinder, then keep only the part of the
  // hit that falls between the segment's ends.
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 1e-12) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - r2;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (t < 0 || t > maxDist || t >= best) continue;
        const y = origin.y + dir.y * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }

  // Rounded ends. Only the hemisphere past each end belongs to the capsule —
  // the rest of each sphere is inside the cylinder and already covered.
  for (const cy of [y0, y1]) {
    const oy = origin.y - cy;
    // `dir` is normalized, so the quadratic's leading coefficient is 1.
    const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
    const c = ox * ox + oy * oy + oz * oz - r2;
    const disc = b * b - 4 * c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [(-b - root) / 2, (-b + root) / 2]) {
      if (t < 0 || t > maxDist || t >= best) continue;
      const y = origin.y + dir.y * t;
      if (cy === y0 ? y <= y0 : y >= y1) best = t;
    }
  }

  return best === Infinity ? null : best;
}

/** Closest distance from a point to an AABB (0 if inside). */
export function pointAABBDistance(p: Vec3, box: AABB): number {
  const dx = Math.max(box.min[0] - p.x, 0, p.x - box.max[0]);
  const dy = Math.max(box.min[1] - p.y, 0, p.y - box.max[1]);
  const dz = Math.max(box.min[2] - p.z, 0, p.z - box.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function pointInAABB(p: Vec3, box: AABB, pad = 0): boolean {
  return (
    p.x >= box.min[0] - pad &&
    p.x <= box.max[0] + pad &&
    p.y >= box.min[1] - pad &&
    p.y <= box.max[1] + pad &&
    p.z >= box.min[2] - pad &&
    p.z <= box.max[2] + pad
  );
}

/** Deterministic-ish spread: rotates `dir` by a random angle within `spread` radians. */
export function applySpread(dir: Vec3, spread: number, rand: () => number = Math.random): Vec3 {
  if (spread <= 0) return dir;
  // Build an orthonormal basis around dir, then offset within the cone.
  const up = Math.abs(dir.y) > 0.99 ? vec(1, 0, 0) : vec(0, 1, 0);
  const right = normalize(cross(dir, up));
  const realUp = normalize(cross(right, dir));
  const angle = rand() * Math.PI * 2;
  const radius = Math.tan(spread) * Math.sqrt(rand());
  const offset = add(scale(right, Math.cos(angle) * radius), scale(realUp, Math.sin(angle) * radius));
  return normalize(add(dir, offset));
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
