/**
 * Wire protocol between client and server.
 *
 * Authority split: the client owns its own *position* (it runs the Rapier sim
 * locally so swinging feels responsive) and reports it. The server owns
 * everything competitive — HP, ammo, weapon ownership, pickups, kills, score,
 * round state — and the client only ever renders what the server tells it.
 */

import type { PickupType, SlotId, WeaponId } from './constants';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

/** Client -> server, at CLIENT_SEND_HZ. */
export interface PlayerStateUpdate {
  p: Vec3Tuple;
  /** Velocity, used to extrapolate between snapshots and to sanity-check motion. */
  v: Vec3Tuple;
  /** Body yaw in radians. */
  yaw: number;
  /** Aim pitch in radians. */
  pitch: number;
  swinging: boolean;
  grounded: boolean;
  /** World-space web anchor while swinging, for remote rope rendering. */
  anchor?: Vec3Tuple;
}

/** A player as broadcast to everyone in the room. */
export interface PlayerSnapshot {
  id: string;
  name: string;
  color: string;
  p: Vec3Tuple;
  v: Vec3Tuple;
  yaw: number;
  pitch: number;
  swinging: boolean;
  grounded: boolean;
  anchor?: Vec3Tuple;
  hp: number;
  shield: number;
  alive: boolean;
  invuln: boolean;
  /** Weapon currently held in the gun slot, if any. */
  gun: WeaponId | null;
  equipped: SlotId;
  /**
   * Server clock time of this player's last shot, so everyone else can play the
   * recoil or the punch. Compared against its own previous value rather than
   * read as an absolute — client and server clocks are unrelated.
   */
  firedAt: number;
}

export interface ScoreEntry {
  id: string;
  name: string;
  color: string;
  score: number;
  kills: number;
  deaths: number;
  /** True once the player disconnects; kept on the board until the round ends. */
  ghost: boolean;
}

export interface PickupSnapshot {
  id: string;
  type: PickupType;
  p: Vec3Tuple;
}

export interface ProjectileSnapshot {
  id: string;
  weapon: WeaponId;
  p: Vec3Tuple;
  v: Vec3Tuple;
}

export type RoundPhase = 'waiting' | 'active' | 'intermission';

export interface RoundState {
  phase: RoundPhase;
  /** Milliseconds left in the current round; null while waiting for a 2nd player. */
  msRemaining: number | null;
  winner: { name: string; score: number } | null;
}

/** Server -> client, every server tick. */
export interface Snapshot {
  t: number;
  players: PlayerSnapshot[];
  pickups: PickupSnapshot[];
  projectiles: ProjectileSnapshot[];
  round: RoundState;
  scores: ScoreEntry[];
}

/** Private, sent only to the owning client when it changes. */
export interface SelfState {
  hp: number;
  shield: number;
  alive: boolean;
  invuln: boolean;
  respawnInMs: number;
  equipped: SlotId;
  gun: WeaponId | null;
  /** Rounds in the current magazine. */
  mag: number;
  /** Rounds left in reserve (mag excluded). */
  reserve: number;
  stones: number;
  reloading: boolean;
}

export interface FireRequest {
  /** Muzzle origin in world space. */
  origin: Vec3Tuple;
  /** Normalized aim direction. */
  dir: Vec3Tuple;
  /** Client-side sequence number, for logging/debug only. */
  seq: number;
}

export interface HitEvent {
  /** Where the shot landed, for client-side impact FX. */
  p: Vec3Tuple;
  /** True if a player was hit (drives the hitmarker sound). */
  onPlayer: boolean;
  weapon: WeaponId;
  /** Set only on the shooter's own client. */
  damage?: number;
}

export interface KillEvent {
  killerName: string | null;
  victimName: string;
  weapon: WeaponId | 'fall';
}

export interface ExplosionEvent {
  p: Vec3Tuple;
  radius: number;
}

export interface JoinedPayload {
  selfId: string;
  roomId: string;
  name: string;
  color: string;
  spawn: Vec3Tuple;
}

/** Names of every event, so both ends stay in sync. */
export const EV = {
  // client -> server
  JOIN: 'join',
  STATE: 'state',
  FIRE: 'fire',
  RELOAD: 'reload',
  SWITCH: 'switch',
  PICKUP: 'pickup',
  FELL: 'fell',
  // server -> client
  JOINED: 'joined',
  SNAPSHOT: 'snapshot',
  SELF: 'self',
  HIT: 'hit',
  KILL: 'kill',
  EXPLOSION: 'explosion',
  PLAYER_JOINED: 'playerJoined',
  RESPAWN: 'respawn',
  ROOM_FULL: 'roomFull',
} as const;
