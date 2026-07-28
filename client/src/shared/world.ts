/**
 * Arena layout. This is the single source of truth for building geometry:
 * the client turns it into meshes + Rapier colliders, the server turns it into
 * AABBs for line-of-sight / projectile collision. Both must agree exactly or
 * shots will appear to pass through walls on one side and not the other.
 *
 * Scale reference: player capsule is 1.5m tall.
 */

export interface Building {
  id: string;
  /** Center of the footprint on the ground plane. */
  x: number;
  z: number;
  /** Footprint extents (full width/depth, not half). */
  width: number;
  depth: number;
  /** Roof height above the ground plane. */
  height: number;
  /** Base tint; the client adds per-building shading variation. */
  color: string;
}

export const GROUND_Y = 0;

/** Below this the player is unrecoverably falling and dies. */
export const DEATH_Y = -4;

export const BUILDINGS: Building[] = [
  // --- Central tower: tallest reference point at world origin ---
  { id: 'central', x: 0, z: 0, width: 15, depth: 15, height: 45, color: '#6a7484' },

  // --- Shorter neighbours, footprints touching central ---
  { id: 'west-low', x: -11.5, z: 0, width: 8, depth: 12, height: 26, color: '#5d6673' },
  { id: 'north-low', x: 0, z: 11, width: 12, depth: 7, height: 30, color: '#646d7c' },

  // --- Taller neighbours, also touching central: high-value swing anchors ---
  { id: 'east-tall', x: 12.5, z: 0, width: 10, depth: 14, height: 58, color: '#727c8c' },
  { id: 'south-tall', x: 0, z: -12, width: 14, depth: 9, height: 52, color: '#6d7686' },

  // --- Outer ring: separated by gaps that need a swing chain to cross ---
  { id: 'outer-sw', x: -30, z: -22, width: 11, depth: 11, height: 34, color: '#59616e' },
  { id: 'outer-se', x: 28, z: -26, width: 13, depth: 9, height: 28, color: '#616a78' },
  { id: 'outer-nw', x: -26, z: 26, width: 9, depth: 14, height: 38, color: '#5e6773' },
  { id: 'outer-ne', x: 30, z: 22, width: 12, depth: 12, height: 22, color: '#656e7b' },
];

/** Half-extent of the ground plane; also the outer bound of the playable area. */
export const ARENA_HALF_SIZE = 70;

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export function buildingAABB(b: Building): AABB {
  return {
    min: [b.x - b.width / 2, GROUND_Y, b.z - b.depth / 2],
    max: [b.x + b.width / 2, b.height, b.z + b.depth / 2],
  };
}

export const BUILDING_AABBS: AABB[] = BUILDINGS.map(buildingAABB);

/** Keeps spawns / pickups away from roof edges so nothing lands half off the ledge. */
const ROOF_INSET = 1.6;

/** A random point standing on a random rooftop. Used for spawns and pickups. */
export function randomRooftopPoint(rand: () => number = Math.random): {
  x: number;
  y: number;
  z: number;
} {
  const b = BUILDINGS[Math.floor(rand() * BUILDINGS.length)];
  const hw = Math.max(0.5, b.width / 2 - ROOF_INSET);
  const hd = Math.max(0.5, b.depth / 2 - ROOF_INSET);
  return {
    x: b.x + (rand() * 2 - 1) * hw,
    y: b.height,
    z: b.z + (rand() * 2 - 1) * hd,
  };
}

/** How far a street-level point must clear a building footprint. */
const STREET_CLEARANCE = 2.2;

/** Ground pickups stay in the built-up core rather than the empty outer plain. */
const STREET_HALF_SIZE = 42;

/**
 * A random point on the street between buildings. Rejection-sampled, so it can
 * fail on a pathological layout — the caller gets a rooftop point in that case.
 */
export function randomGroundPoint(rand: () => number = Math.random): {
  x: number;
  y: number;
  z: number;
} {
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = (rand() * 2 - 1) * STREET_HALF_SIZE;
    const z = (rand() * 2 - 1) * STREET_HALF_SIZE;
    let blocked = false;
    for (const b of BUILDINGS) {
      if (
        Math.abs(x - b.x) < b.width / 2 + STREET_CLEARANCE &&
        Math.abs(z - b.z) < b.depth / 2 + STREET_CLEARANCE
      ) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { x, y: GROUND_Y, z };
  }
  return randomRooftopPoint(rand);
}
