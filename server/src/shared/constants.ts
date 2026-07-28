/**
 * Gameplay tuning. Shared so the client can predict/display and the server can
 * enforce from the same numbers — the server is always the authority.
 */

export const MAX_HP = 100;

export const PLAYER_HEIGHT = 1.5;
export const PLAYER_RADIUS = 0.3;
/** Half-height of the capsule's cylindrical section (total = 2*half + 2*radius). */
export const PLAYER_CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

export const RESPAWN_DELAY_MS = 3000;
/** Spawns are random rooftops, so new arrivals get a moment of protection. */
export const SPAWN_INVULN_MS = 2500;

export const ROUND_DURATION_MS = 3 * 60 * 1000;
export const WINNER_OVERLAY_MS = 10 * 1000;

export const SCORE_PER_KILL = 10;
export const SCORE_PER_DEATH = -1;

export const MAX_PLAYERS_PER_ROOM = 5;
/** How long an empty room lingers in memory before teardown. */
export const ROOM_GRACE_MS = 60 * 1000;

export const SERVER_TICK_HZ = 30;
export const CLIENT_SEND_HZ = 20;
/** Remote players are rendered this far in the past so interpolation always has two samples. */
export const INTERP_DELAY_MS = 120;

// --- Swing ---
export const WEB_MAX_RANGE = 45;
export const WEB_MIN_LENGTH = 3;
/** Metres of rope reeled in per scroll notch. */
export const WEB_REEL_SPEED = 2.2;

// --- Movement ---
export const MOVE_SPEED = 7.5;
export const AIR_CONTROL_ACCEL = 14;
export const JUMP_VELOCITY = 6.4;
/** Sideways/forward force applied while swinging, for pumping the arc. */
export const SWING_INPUT_FORCE = 26;

// --- Pickups ---
export const HEALTH_PICKUP_AMOUNT = 50;
export const SHIELD_ABSORB = 50;
export const MAX_ACTIVE_PICKUPS = 15;
export const PICKUP_SPAWN_MIN_MS = 3000;
export const PICKUP_SPAWN_MAX_MS = 5500;
export const PICKUP_RADIUS = 1.4;
/** Minimum gap between two live pickups, so a freed spot is not instantly refilled. */
export const PICKUP_SPAWN_SEPARATION = 6;
/**
 * Share of pickups that spawn on the street instead of a rooftop. Kept low so
 * rooftops stay the reason to swing, while the ground is never fully empty.
 */
export const GROUND_PICKUP_CHANCE = 0.22;

export type WeaponId =
  | 'pistol'
  | 'm16a4'
  | 'm416'
  | 'shotgun'
  | 'grenadeLauncher'
  | 'rocketLauncher'
  | 'stones'
  | 'gloves';

export type WeaponKind = 'hitscan' | 'projectile' | 'melee';
export type FireMode = 'semi' | 'auto' | 'burst' | 'pump';
export type SlotId = 'gun' | 'gloves' | 'stones';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  slot: SlotId;
  kind: WeaponKind;
  fireMode: FireMode;
  /** Minimum seconds between shots. Enforced server-side. */
  fireInterval: number;
  damage: number;
  /** Rounds per magazine. 0 => no magazine (melee / throwable). */
  magSize: number;
  /** Total lifetime rounds for this weapon instance (mag + reserve). */
  ammoPool: number;
  reloadTime: number;
  /** Effective range for hitscan, or max travel for projectiles. */
  range: number;
  /** Cone half-angle in radians applied per bullet. */
  spread: number;
  pellets?: number;
  /** Hitscan damage multiplier reaches this floor at `range`. */
  damageFalloff?: number;
  /** Shots in a burst, for fireMode 'burst'. */
  burstCount?: number;
  burstInterval?: number;
  projectile?: {
    speed: number;
    /** Gravity applied to the projectile, m/s^2. 0 = flat trajectory. */
    gravity: number;
    explodes: boolean;
    splashDamage: number;
    splashRadius: number;
    /** Auto-detonate after this many seconds if nothing was hit. */
    fuse: number;
  };
  /** Rocket launcher is single-use: the instance is destroyed once fired dry. */
  despawnWhenEmpty?: boolean;
  color: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    slot: 'gun',
    kind: 'hitscan',
    fireMode: 'semi',
    fireInterval: 0.28,
    damage: 18,
    magSize: 12,
    ammoPool: 48,
    reloadTime: 1.1,
    range: 120,
    spread: 0.012,
    damageFalloff: 0.75,
    color: '#c9ccd4',
  },
  m16a4: {
    id: 'm16a4',
    name: 'M16A4',
    slot: 'gun',
    kind: 'hitscan',
    fireMode: 'burst',
    fireInterval: 0.42,
    burstCount: 3,
    burstInterval: 0.075,
    damage: 24,
    magSize: 30,
    ammoPool: 90,
    reloadTime: 1.8,
    range: 200,
    spread: 0.009,
    damageFalloff: 0.85,
    color: '#5a5f4a',
  },
  m416: {
    id: 'm416',
    name: 'M416',
    slot: 'gun',
    kind: 'hitscan',
    fireMode: 'auto',
    fireInterval: 0.09,
    damage: 16,
    magSize: 30,
    ammoPool: 120,
    reloadTime: 1.9,
    range: 160,
    spread: 0.022,
    damageFalloff: 0.8,
    color: '#3f4550',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    slot: 'gun',
    kind: 'hitscan',
    fireMode: 'pump',
    fireInterval: 0.85,
    damage: 11,
    pellets: 9,
    magSize: 6,
    ammoPool: 24,
    reloadTime: 2.2,
    range: 40,
    spread: 0.075,
    // Brutal up close, nearly useless at the far end of its range.
    damageFalloff: 0.15,
    color: '#6b4a32',
  },
  grenadeLauncher: {
    id: 'grenadeLauncher',
    name: 'Grenade Launcher',
    slot: 'gun',
    kind: 'projectile',
    fireMode: 'semi',
    fireInterval: 1.2,
    damage: 60,
    magSize: 1,
    ammoPool: 4,
    reloadTime: 1.6,
    range: 160,
    spread: 0,
    projectile: {
      speed: 32,
      gravity: 18,
      explodes: true,
      splashDamage: 55,
      splashRadius: 6,
      fuse: 3,
    },
    color: '#4b5f3a',
  },
  rocketLauncher: {
    id: 'rocketLauncher',
    name: 'Rocket Launcher',
    slot: 'gun',
    kind: 'projectile',
    fireMode: 'semi',
    fireInterval: 1.5,
    // A direct hit is exactly max HP: one rocket, one kill.
    damage: MAX_HP,
    magSize: 1,
    ammoPool: 1,
    reloadTime: 0,
    range: 220,
    spread: 0,
    projectile: {
      speed: 58,
      gravity: 0,
      explodes: true,
      splashDamage: 60,
      splashRadius: 8,
      fuse: 6,
    },
    despawnWhenEmpty: true,
    color: '#7a3b2e',
  },
  stones: {
    id: 'stones',
    name: 'Stones',
    slot: 'stones',
    kind: 'projectile',
    fireMode: 'semi',
    fireInterval: 0.6,
    damage: 20,
    magSize: 0,
    ammoPool: 3,
    reloadTime: 0,
    range: 90,
    spread: 0,
    projectile: {
      speed: 26,
      gravity: 20,
      explodes: false,
      splashDamage: 0,
      splashRadius: 0,
      fuse: 5,
    },
    color: '#8a8577',
  },
  gloves: {
    id: 'gloves',
    name: 'Gloves',
    slot: 'gloves',
    kind: 'melee',
    fireMode: 'semi',
    fireInterval: 0.5,
    damage: 25,
    magSize: 0,
    ammoPool: Infinity,
    reloadTime: 0,
    range: 2.6,
    spread: 0,
    color: '#b03a3a',
  },
};

/** Stones every player carries and gets back on respawn. */
export const STONE_STOCK = WEAPONS.stones.ammoPool;

export type PickupType = WeaponId | 'health' | 'shield';

/** Higher weight = more common. Rocket launcher is deliberately rare. */
export const PICKUP_WEIGHTS: Record<string, number> = {
  pistol: 22,
  m16a4: 14,
  m416: 14,
  shotgun: 10,
  health: 20,
  grenadeLauncher: 8,
  shield: 7,
  rocketLauncher: 3,
};

/** One clearly distinguishable colour per room slot. */
export const PLAYER_COLORS = ['#e2483d', '#3d8ce2', '#43c463', '#e0b23a', '#b45ce0'];

/** Server-authoritative fire-rate check tolerance for network jitter. */
export const FIRE_RATE_TOLERANCE = 0.04;
