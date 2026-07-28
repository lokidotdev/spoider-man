/**
 * Server-side hit resolution. Nothing here trusts the client beyond the aim
 * ray it reports — every hit is re-traced against the server's own copy of the
 * world geometry and the last known player positions.
 */

import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  type WeaponSpec,
} from './shared/constants';
import { BUILDING_AABBS } from './shared/world';
import {
  add,
  applySpread,
  clamp,
  distance,
  normalize,
  rayAABB,
  rayCapsule,
  scale,
  vec,
  type Vec3,
} from './shared/math';

export interface HitTarget {
  id: string;
  /** Feet position (capsule base). */
  pos: Vec3;
}

/** Distance along the ray at which it first meets building geometry. */
export function traceWorld(origin: Vec3, dir: Vec3, maxDist: number): number {
  let nearest = maxDist;
  for (const box of BUILDING_AABBS) {
    const t = rayAABB(origin, dir, box, maxDist);
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest;
}

export interface RayHit {
  targetId: string | null;
  point: Vec3;
  distance: number;
}

/**
 * Single hitscan ray. Buildings block first — a target behind a wall is never
 * hit, which is what stops clients from shooting through geometry.
 */
export function traceRay(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  targets: HitTarget[]
): RayHit {
  const wallDist = traceWorld(origin, dir, maxDist);

  let bestId: string | null = null;
  let bestDist = wallDist;

  for (const target of targets) {
    // Cheap reject: skip anyone well outside the ray's reach.
    if (distance(origin, target.pos) > maxDist + PLAYER_HEIGHT) continue;
    const t = rayCapsule(origin, dir, target.pos, PLAYER_HEIGHT, PLAYER_RADIUS, bestDist);
    if (t !== null && t < bestDist) {
      bestDist = t;
      bestId = target.id;
    }
  }

  return {
    targetId: bestId,
    point: add(origin, scale(dir, bestDist)),
    distance: bestDist,
  };
}

/** Linear falloff from full damage at point blank to `spec.damageFalloff` at max range. */
export function damageAtRange(spec: WeaponSpec, dist: number): number {
  if (spec.damageFalloff === undefined) return spec.damage;
  const t = clamp(dist / spec.range, 0, 1);
  const mult = 1 + (spec.damageFalloff - 1) * t;
  return spec.damage * mult;
}

export interface ResolvedHit {
  targetId: string;
  damage: number;
  point: Vec3;
}

/** Fires one weapon's worth of hitscan rays (multiple for the shotgun). */
export function resolveHitscan(
  spec: WeaponSpec,
  origin: Vec3,
  aim: Vec3,
  targets: HitTarget[]
): { hits: Map<string, number>; impact: Vec3; hitPlayer: boolean } {
  const dir = normalize(aim);
  const pellets = spec.pellets ?? 1;
  const hits = new Map<string, number>();
  let impact = add(origin, scale(dir, spec.range));
  let hitPlayer = false;

  for (let i = 0; i < pellets; i++) {
    const pelletDir = applySpread(dir, spec.spread);
    const hit = traceRay(origin, pelletDir, spec.range, targets);
    if (i === 0) impact = hit.point;
    if (hit.targetId) {
      hitPlayer = true;
      impact = hit.point;
      const dmg = damageAtRange(spec, hit.distance);
      hits.set(hit.targetId, (hits.get(hit.targetId) ?? 0) + dmg);
    }
  }

  return { hits, impact, hitPlayer };
}

/**
 * Splash damage with linear falloff, blocked by walls: a target with no line of
 * sight to the blast centre takes nothing, so you can't nuke through a rooftop.
 */
export function resolveSplash(
  center: Vec3,
  radius: number,
  maxDamage: number,
  targets: HitTarget[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const target of targets) {
    // Aim at torso height rather than the feet so ground blasts read fairly.
    const torso = add(target.pos, vec(0, PLAYER_HEIGHT * 0.5, 0));
    const d = distance(center, torso);
    if (d > radius) continue;

    const toTarget = sub3(torso, center);
    const dir = normalize(toTarget);
    const wall = traceWorld(center, dir, d);
    // A little slack: the blast can sit fractionally inside a surface.
    if (wall < d - 0.6) continue;

    const falloff = 1 - d / radius;
    out.set(target.id, maxDamage * falloff);
  }
  return out;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Melee: short cone in front of the attacker. */
export function resolveMelee(
  spec: WeaponSpec,
  origin: Vec3,
  aim: Vec3,
  targets: HitTarget[]
): ResolvedHit | null {
  const hit = traceRay(origin, normalize(aim), spec.range, targets);
  if (!hit.targetId) return null;
  return { targetId: hit.targetId, damage: spec.damage, point: hit.point };
}
