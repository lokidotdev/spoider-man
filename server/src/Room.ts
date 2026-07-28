/**
 * One arena instance. Holds every authoritative piece of state for up to
 * MAX_PLAYERS_PER_ROOM players, entirely in memory — nothing here is persisted
 * and nothing is expected to survive a process restart.
 */

import type { Server } from 'socket.io';
import {
  FIRE_RATE_TOLERANCE,
  GROUND_PICKUP_CHANCE,
  HEALTH_PICKUP_AMOUNT,
  MAX_ACTIVE_PICKUPS,
  MAX_HP,
  MAX_PLAYERS_PER_ROOM,
  PICKUP_RADIUS,
  PICKUP_SPAWN_SEPARATION,
  PICKUP_SPAWN_MAX_MS,
  PICKUP_SPAWN_MIN_MS,
  PICKUP_WEIGHTS,
  PLAYER_COLORS,
  PLAYER_HEIGHT,
  RESPAWN_DELAY_MS,
  ROUND_DURATION_MS,
  SCORE_PER_DEATH,
  SCORE_PER_KILL,
  SHIELD_ABSORB,
  SPAWN_INVULN_MS,
  STONE_STOCK,
  WEAPONS,
  WINNER_OVERLAY_MS,
  type PickupType,
  type SlotId,
  type WeaponId,
} from './shared/constants';
import {
  EV,
  type FireRequest,
  type PickupSnapshot,
  type PlayerSnapshot,
  type PlayerStateUpdate,
  type ProjectileSnapshot,
  type RoundState,
  type ScoreEntry,
  type SelfState,
  type Snapshot,
} from './shared/protocol';
import {
  BUILDING_AABBS,
  DEATH_Y,
  randomGroundPoint,
  randomRooftopPoint,
} from './shared/world';
import {
  add,
  distance,
  length,
  normalize,
  rayAABB,
  rayCapsule,
  scale,
  vec,
  type Vec3,
} from './shared/math';
import {
  resolveHitscan,
  resolveMelee,
  resolveSplash,
  type HitTarget,
} from './combat';
import { randomName } from './names';

interface HeldGun {
  id: WeaponId;
  mag: number;
  reserve: number;
}

interface ServerPlayer {
  id: string;
  name: string;
  color: string;
  colorIndex: number;
  connected: boolean;

  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  swinging: boolean;
  grounded: boolean;
  anchor?: Vec3;

  hp: number;
  shield: number;
  alive: boolean;
  invulnUntil: number;
  respawnAt: number;

  gun: HeldGun | null;
  equipped: SlotId;
  stones: number;
  reloadingUntil: number;
  lastFireAt: number;

  score: number;
  kills: number;
  deaths: number;
  /** When the score last went up — used as the final tiebreak. */
  scoreReachedAt: number;
}

interface Pickup {
  id: string;
  type: PickupType;
  pos: Vec3;
  /** Preserved ammo for guns dropped by a player mid-swap. */
  mag?: number;
  reserve?: number;
}

interface Projectile {
  id: string;
  ownerId: string;
  weapon: WeaponId;
  pos: Vec3;
  vel: Vec3;
  expiresAt: number;
}

let nextId = 1;
const uid = (prefix: string) => `${prefix}${nextId++}`;

const PICKUP_TABLE: PickupType[] = Object.keys(PICKUP_WEIGHTS) as PickupType[];
const PICKUP_TOTAL_WEIGHT = Object.values(PICKUP_WEIGHTS).reduce((a, b) => a + b, 0);

function rollPickupType(): PickupType {
  let roll = Math.random() * PICKUP_TOTAL_WEIGHT;
  for (const type of PICKUP_TABLE) {
    roll -= PICKUP_WEIGHTS[type];
    if (roll <= 0) return type;
  }
  return 'pistol';
}

export class Room {
  readonly id: string;
  private io: Server;
  private players = new Map<string, ServerPlayer>();
  private pickups = new Map<string, Pickup>();
  private projectiles = new Map<string, Projectile>();

  private phase: RoundState['phase'] = 'waiting';
  private roundEndsAt = 0;
  /** Frozen remaining time while the room is below 2 players mid-round. */
  private pausedRemaining: number | null = null;
  private intermissionEndsAt = 0;
  private winner: RoundState['winner'] = null;

  private nextPickupAt = 0;
  private lastTick = Date.now();
  /** Set when the room empties; the manager tears it down after the grace period. */
  emptySince: number | null = Date.now();

  constructor(id: string, io: Server) {
    this.id = id;
    this.io = io;
    this.nextPickupAt = Date.now() + 1500;
    // Seed a few pickups so the first player has something to find immediately.
    for (let i = 0; i < 5; i++) this.spawnPickup();
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  // ---------------------------------------------------------------- players

  addPlayer(socketId: string): ServerPlayer {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    const usedColors = new Set([...this.players.values()].map((p) => p.colorIndex));
    let colorIndex = 0;
    while (usedColors.has(colorIndex) && colorIndex < PLAYER_COLORS.length - 1) colorIndex++;

    const spawn = randomRooftopPoint();
    const player: ServerPlayer = {
      id: socketId,
      name: randomName(taken),
      color: PLAYER_COLORS[colorIndex],
      colorIndex,
      connected: true,
      pos: vec(spawn.x, spawn.y, spawn.z),
      vel: vec(),
      yaw: 0,
      pitch: 0,
      swinging: false,
      grounded: true,
      hp: MAX_HP,
      shield: 0,
      alive: true,
      invulnUntil: Date.now() + SPAWN_INVULN_MS,
      respawnAt: 0,
      gun: null,
      equipped: 'gloves',
      stones: STONE_STOCK,
      reloadingUntil: 0,
      lastFireAt: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      scoreReachedAt: Date.now(),
    };

    this.players.set(socketId, player);
    this.emptySince = null;

    // Everyone already here gets the join toast.
    this.io.to(this.id).emit(EV.PLAYER_JOINED, { name: player.name });
    this.evaluateRoundStart();
    return player;
  }

  removePlayer(socketId: string): void {
    const player = this.players.get(socketId);
    if (!player) return;

    // Their body leaves the world immediately, but the scoreboard keeps a ghost
    // entry until the round resets so their score doesn't vanish mid-round.
    player.connected = false;
    player.alive = false;
    this.players.delete(socketId);
    this.ghosts.set(socketId, {
      id: player.id,
      name: player.name,
      color: player.color,
      score: player.score,
      kills: player.kills,
      deaths: player.deaths,
      ghost: true,
    });

    if (this.players.size === 0) this.emptySince = Date.now();
    this.evaluateRoundStart();
  }

  private ghosts = new Map<string, ScoreEntry>();

  getPlayer(socketId: string): ServerPlayer | undefined {
    return this.players.get(socketId);
  }

  spawnPointFor(player: ServerPlayer): Vec3 {
    const p = randomRooftopPoint();
    player.pos = vec(p.x, p.y, p.z);
    return player.pos;
  }

  // ----------------------------------------------------------------- input

  onState(socketId: string, update: PlayerStateUpdate): void {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;
    if (!isFiniteVec(update.p) || !isFiniteVec(update.v)) return;

    p.pos = vec(update.p.x, update.p.y, update.p.z);
    p.vel = vec(update.v.x, update.v.y, update.v.z);
    p.yaw = update.yaw;
    p.pitch = update.pitch;
    p.swinging = !!update.swinging;
    p.grounded = !!update.grounded;
    p.anchor = update.anchor ? vec(update.anchor.x, update.anchor.y, update.anchor.z) : undefined;
  }

  onFell(socketId: string): void {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;
    // Only honour the report if the server's own copy of their position agrees.
    if (p.pos.y > DEATH_Y + 2) return;
    this.killPlayer(p, null, 'fall');
  }

  onSwitch(socketId: string, slot: SlotId | 'cycle', pickupId?: string): void {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;

    let target: SlotId;
    if (slot === 'cycle') {
      const order: SlotId[] = ['gun', 'gloves', 'stones'];
      const start = order.indexOf(p.equipped);
      target = p.equipped;
      for (let i = 1; i <= order.length; i++) {
        const candidate = order[(start + i) % order.length];
        if (candidate === 'gun' && !p.gun) continue;
        if (candidate === 'stones' && p.stones <= 0) continue;
        target = candidate;
        break;
      }
    } else {
      target = slot;
    }

    // Pressing the gun-slot key while standing on a weapon pickup swaps for it.
    if (target === 'gun' && pickupId) {
      this.tryTakeWeapon(p, pickupId);
    }

    if (target === 'gun' && !p.gun) return;
    if (target === 'stones' && p.stones <= 0) return;

    if (p.equipped !== target) {
      p.equipped = target;
      p.reloadingUntil = 0;
    }
    this.sendSelf(p);
  }

  onReload(socketId: string): void {
    const p = this.players.get(socketId);
    if (!p || !p.alive || !p.gun || p.equipped !== 'gun') return;
    const spec = WEAPONS[p.gun.id];
    if (spec.magSize <= 0 || p.gun.reserve <= 0) return;
    if (p.gun.mag >= spec.magSize) return;
    if (Date.now() < p.reloadingUntil) return;

    p.reloadingUntil = Date.now() + spec.reloadTime * 1000;
    this.sendSelf(p);
  }

  private finishReloadIfDue(p: ServerPlayer): void {
    if (!p.gun || p.reloadingUntil === 0 || Date.now() < p.reloadingUntil) return;
    const spec = WEAPONS[p.gun.id];
    const needed = spec.magSize - p.gun.mag;
    const moved = Math.min(needed, p.gun.reserve);
    p.gun.mag += moved;
    p.gun.reserve -= moved;
    p.reloadingUntil = 0;
    this.sendSelf(p);
  }

  onPickup(socketId: string, pickupId: string): void {
    const p = this.players.get(socketId);
    const pickup = this.pickups.get(pickupId);
    if (!p || !p.alive || !pickup) return;
    // Range check: the client only ever *asks*, the server decides.
    if (distance(p.pos, pickup.pos) > PICKUP_RADIUS * 1.8) return;

    if (pickup.type === 'health') {
      if (p.hp >= MAX_HP) return;
      p.hp = Math.min(MAX_HP, p.hp + HEALTH_PICKUP_AMOUNT);
      this.consumePickup(pickupId);
      this.sendSelf(p);
      return;
    }

    if (pickup.type === 'shield') {
      if (p.shield >= SHIELD_ABSORB) return;
      p.shield = SHIELD_ABSORB;
      this.consumePickup(pickupId);
      this.sendSelf(p);
      return;
    }

    // Weapons only auto-equip when the player has no gun at all.
    if (p.gun) return;
    this.tryTakeWeapon(p, pickupId);
    this.sendSelf(p);
  }

  /** Binds a world weapon to a player, dropping whatever they held in its place. */
  private tryTakeWeapon(p: ServerPlayer, pickupId: string): void {
    const pickup = this.pickups.get(pickupId);
    if (!pickup) return;
    if (pickup.type === 'health' || pickup.type === 'shield') return;
    if (distance(p.pos, pickup.pos) > PICKUP_RADIUS * 1.8) return;

    const spec = WEAPONS[pickup.type as WeaponId];
    if (!spec || spec.slot !== 'gun') return;

    const previous = p.gun;
    p.gun = {
      id: pickup.type as WeaponId,
      mag: pickup.mag ?? Math.min(spec.magSize, spec.ammoPool),
      reserve: pickup.reserve ?? Math.max(0, spec.ammoPool - spec.magSize),
    };
    p.equipped = 'gun';
    p.reloadingUntil = 0;
    this.pickups.delete(pickupId);

    // The swapped-out gun stays available to everyone else, ammo intact, and
    // takes over the vacated spot. With nothing to leave behind, the spot is
    // freed for good and a replacement pickup rolls a fresh point elsewhere.
    if (previous && previous.mag + previous.reserve > 0) {
      const droppedId = uid('pk');
      this.pickups.set(droppedId, {
        id: droppedId,
        type: previous.id,
        pos: vec(pickup.pos.x, pickup.pos.y, pickup.pos.z),
        mag: previous.mag,
        reserve: previous.reserve,
      });
    } else {
      this.spawnPickup();
    }
  }

  // ------------------------------------------------------------------ fire

  onFire(socketId: string, req: FireRequest): void {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;
    if (!isFiniteVec(req.origin) || !isFiniteVec(req.dir)) return;

    const weaponId = this.equippedWeapon(p);
    if (!weaponId) return;
    const spec = WEAPONS[weaponId];
    const now = Date.now();

    // --- server-side fire-rate enforcement ---
    // A client firing faster than the weapon allows (macro, modified client)
    // simply has the extra requests dropped.
    if (now - p.lastFireAt < (spec.fireInterval - FIRE_RATE_TOLERANCE) * 1000) return;
    if (now < p.reloadingUntil) return;

    // --- ammo ---
    if (spec.slot === 'gun') {
      if (!p.gun || p.gun.id !== weaponId) return;
      if (p.gun.mag <= 0) return;
    } else if (spec.slot === 'stones') {
      if (p.stones <= 0) return;
    }

    p.lastFireAt = now;

    const origin = clampOriginToPlayer(p, vec(req.origin.x, req.origin.y, req.origin.z));
    const dir = normalize(vec(req.dir.x, req.dir.y, req.dir.z));
    if (length(dir) < 0.5) return;

    // Firing breaks any in-progress reload.
    p.reloadingUntil = 0;

    if (spec.kind === 'hitscan') {
      const shots = spec.fireMode === 'burst' ? spec.burstCount ?? 1 : 1;
      for (let i = 0; i < shots; i++) {
        if (!p.gun || p.gun.mag <= 0) break;
        p.gun.mag -= 1;
        this.fireHitscanShot(p, weaponId, origin, dir);
      }
    } else if (spec.kind === 'melee') {
      const hit = resolveMelee(spec, origin, dir, this.hitTargets(p.id));
      this.io.to(p.id).emit(EV.HIT, {
        p: hit?.point ?? add(origin, scale(dir, spec.range)),
        onPlayer: !!hit,
        weapon: weaponId,
        damage: hit?.damage,
      });
      if (hit) this.applyDamage(hit.targetId, hit.damage, p, weaponId);
    } else if (spec.kind === 'projectile') {
      if (spec.slot === 'stones') p.stones -= 1;
      else if (p.gun) p.gun.mag -= 1;

      const proj = spec.projectile!;
      this.projectiles.set(uid('pr'), {
        id: uid('prid'),
        ownerId: p.id,
        weapon: weaponId,
        pos: origin,
        // Inherit the shooter's velocity so shots fired mid-swing lead correctly.
        vel: add(scale(dir, proj.speed), scale(p.vel, 0.35)),
        expiresAt: now + proj.fuse * 1000,
      });
    }

    this.afterAmmoChange(p);
  }

  private fireHitscanShot(p: ServerPlayer, weaponId: WeaponId, origin: Vec3, dir: Vec3): void {
    const spec = WEAPONS[weaponId];
    const { hits, impact, hitPlayer } = resolveHitscan(spec, origin, dir, this.hitTargets(p.id));

    let dealt = 0;
    for (const [targetId, dmg] of hits) dealt += this.applyDamage(targetId, dmg, p, weaponId);

    this.io.to(p.id).emit(EV.HIT, {
      p: impact,
      onPlayer: hitPlayer,
      weapon: weaponId,
      damage: dealt,
    });
  }

  private equippedWeapon(p: ServerPlayer): WeaponId | null {
    if (p.equipped === 'gloves') return 'gloves';
    if (p.equipped === 'stones') return p.stones > 0 ? 'stones' : null;
    return p.gun?.id ?? null;
  }

  /** Drops a spent weapon and falls back to gloves so nobody is stuck holding nothing. */
  private afterAmmoChange(p: ServerPlayer): void {
    if (p.gun && p.gun.mag <= 0 && p.gun.reserve <= 0) {
      p.gun = null;
      if (p.equipped === 'gun') p.equipped = p.stones > 0 ? 'stones' : 'gloves';
    }
    if (p.equipped === 'stones' && p.stones <= 0) p.equipped = 'gloves';
    this.sendSelf(p);
  }

  private hitTargets(excludeId: string): HitTarget[] {
    const out: HitTarget[] = [];
    for (const p of this.players.values()) {
      if (p.id === excludeId || !p.alive) continue;
      if (Date.now() < p.invulnUntil) continue;
      out.push({ id: p.id, pos: p.pos });
    }
    return out;
  }

  // ---------------------------------------------------------------- damage

  /** Returns damage actually applied (after shield absorption). */
  private applyDamage(
    targetId: string,
    amount: number,
    attacker: ServerPlayer | null,
    weapon: WeaponId | 'fall'
  ): number {
    const target = this.players.get(targetId);
    if (!target || !target.alive) return 0;
    if (Date.now() < target.invulnUntil) return 0;

    let remaining = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;

    if (target.hp <= 0) {
      target.hp = 0;
      this.killPlayer(target, attacker, weapon);
    }
    this.sendSelf(target);
    return amount;
  }

  private killPlayer(
    victim: ServerPlayer,
    killer: ServerPlayer | null,
    weapon: WeaponId | 'fall'
  ): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.shield = 0;
    victim.respawnAt = Date.now() + RESPAWN_DELAY_MS;
    victim.deaths += 1;
    victim.score += SCORE_PER_DEATH;
    // The held weapon is destroyed with them.
    victim.gun = null;
    victim.equipped = 'gloves';
    victim.reloadingUntil = 0;

    if (killer && killer.id !== victim.id && killer.alive) {
      killer.kills += 1;
      killer.score += SCORE_PER_KILL;
      killer.scoreReachedAt = Date.now();
      this.sendSelf(killer);
    }

    this.io.to(this.id).emit(EV.KILL, {
      killerName: killer && killer.id !== victim.id ? killer.name : null,
      victimName: victim.name,
      weapon,
    });
    this.sendSelf(victim);
  }

  private respawn(p: ServerPlayer): void {
    const spawn = this.spawnPointFor(p);
    p.alive = true;
    p.hp = MAX_HP;
    p.shield = 0;
    p.vel = vec();
    p.gun = null;
    p.equipped = 'gloves';
    p.stones = STONE_STOCK;
    p.reloadingUntil = 0;
    p.lastFireAt = 0;
    p.invulnUntil = Date.now() + SPAWN_INVULN_MS;
    this.io.to(p.id).emit(EV.RESPAWN, { p: spawn });
    this.sendSelf(p);
  }

  // ----------------------------------------------------------- projectiles

  private stepProjectiles(dt: number): void {
    const now = Date.now();
    for (const [key, proj] of this.projectiles) {
      const spec = WEAPONS[proj.weapon];
      const cfg = spec.projectile!;

      const prev = proj.pos;
      proj.vel = add(proj.vel, vec(0, -cfg.gravity * dt, 0));
      const next = add(prev, scale(proj.vel, dt));

      const segment = distance(prev, next);
      const dir = segment > 1e-6 ? normalize(add(next, scale(prev, -1))) : vec(0, -1, 0);

      let hitDist = segment;
      let hitPlayerId: string | null = null;

      // Players first, then geometry — nearest wins.
      for (const p of this.players.values()) {
        if (p.id === proj.ownerId || !p.alive) continue;
        if (now < p.invulnUntil) continue;
        const t = rayCapsule(prev, dir, p.pos, PLAYER_HEIGHT, 0.55, hitDist);
        if (t !== null && t < hitDist) {
          hitDist = t;
          hitPlayerId = p.id;
        }
      }
      for (const box of BUILDING_AABBS) {
        const t = rayAABB(prev, dir, box, hitDist);
        if (t !== null && t < hitDist) {
          hitDist = t;
          hitPlayerId = null;
        }
      }

      const impact = add(prev, scale(dir, hitDist));
      const hitSomething = hitDist < segment - 1e-6 || hitPlayerId !== null;
      const belowWorld = next.y <= 0.1;
      const expired = now >= proj.expiresAt;

      if (hitSomething || belowWorld || expired) {
        const point = belowWorld && !hitSomething ? vec(next.x, 0.1, next.z) : impact;
        this.detonate(proj, point, hitPlayerId);
        this.projectiles.delete(key);
        continue;
      }

      proj.pos = next;
    }
  }

  private detonate(proj: Projectile, point: Vec3, directTargetId: string | null): void {
    const spec = WEAPONS[proj.weapon];
    const cfg = spec.projectile!;
    const owner = this.players.get(proj.ownerId) ?? null;

    if (directTargetId) this.applyDamage(directTargetId, spec.damage, owner, proj.weapon);

    if (cfg.explodes) {
      this.io.to(this.id).emit(EV.EXPLOSION, { p: point, radius: cfg.splashRadius });
      // Splash hits everyone in range including the shooter, minus the target
      // already charged full direct damage.
      const targets: HitTarget[] = [];
      for (const p of this.players.values()) {
        if (!p.alive || p.id === directTargetId) continue;
        if (Date.now() < p.invulnUntil) continue;
        targets.push({ id: p.id, pos: p.pos });
      }
      const splash = resolveSplash(point, cfg.splashRadius, cfg.splashDamage, targets);
      for (const [id, dmg] of splash) this.applyDamage(id, dmg, owner, proj.weapon);
    }
  }

  // ---------------------------------------------------------------- pickups

  /**
   * A fresh spawn point that no live pickup is already sitting on, so a
   * collected spot is genuinely vacated rather than immediately refilled.
   * Rejection-sampled; falls back to the last roll if the arena is crowded.
   */
  private freeSpawnPoint(): { x: number; y: number; z: number } {
    let spot = { x: 0, y: 0, z: 0 };
    for (let attempt = 0; attempt < 24; attempt++) {
      spot = Math.random() < GROUND_PICKUP_CHANCE ? randomGroundPoint() : randomRooftopPoint();
      let clear = true;
      for (const other of this.pickups.values()) {
        const dx = other.pos.x - spot.x;
        const dy = other.pos.y - (spot.y + 0.6);
        const dz = other.pos.z - spot.z;
        if (dx * dx + dy * dy + dz * dz < PICKUP_SPAWN_SEPARATION * PICKUP_SPAWN_SEPARATION) {
          clear = false;
          break;
        }
      }
      if (clear) return spot;
    }
    return spot;
  }

  private spawnPickup(): void {
    if (this.pickups.size >= MAX_ACTIVE_PICKUPS) return;
    const spot = this.freeSpawnPoint();
    const id = uid('pk');
    this.pickups.set(id, {
      id,
      type: rollPickupType(),
      pos: vec(spot.x, spot.y + 0.6, spot.z),
    });
  }

  /**
   * Called whenever a pickup is consumed: the spot it occupied is gone, and a
   * replacement appears somewhere else so the arena keeps its item density.
   */
  private consumePickup(pickupId: string): void {
    this.pickups.delete(pickupId);
    this.spawnPickup();
  }

  // ----------------------------------------------------------------- round

  private connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  /** Starts, pauses or resumes the round timer as the population changes. */
  private evaluateRoundStart(): void {
    const count = this.connectedCount();

    if (this.phase === 'intermission') return;

    if (count >= 2) {
      if (this.phase === 'waiting') {
        this.phase = 'active';
        // Resume a paused round rather than restarting it.
        this.roundEndsAt = Date.now() + (this.pausedRemaining ?? ROUND_DURATION_MS);
        this.pausedRemaining = null;
      }
    } else if (this.phase === 'active') {
      // Solo again: freeze the clock, keep playing untimed.
      this.pausedRemaining = Math.max(0, this.roundEndsAt - Date.now());
      this.phase = 'waiting';
    }
  }

  private endRound(): void {
    const board = this.scoreboard();
    const best = board[0];
    this.winner = best ? { name: best.name, score: best.score } : null;
    this.phase = 'intermission';
    this.intermissionEndsAt = Date.now() + WINNER_OVERLAY_MS;
  }

  private startNextRound(): void {
    // Scores reset and disconnected players fall off the board.
    this.ghosts.clear();
    for (const p of this.players.values()) {
      p.score = 0;
      p.kills = 0;
      p.deaths = 0;
      p.scoreReachedAt = Date.now();
    }
    this.winner = null;
    this.pausedRemaining = null;

    if (this.connectedCount() >= 2) {
      this.phase = 'active';
      this.roundEndsAt = Date.now() + ROUND_DURATION_MS;
    } else {
      this.phase = 'waiting';
    }
  }

  /**
   * Sorted best-first. Ties break on fewest deaths, then on who reached the
   * score first, so a winner is always unambiguous.
   */
  private scoreboard(): ScoreEntry[] {
    const live: ScoreEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      ghost: false,
    }));
    const all = [...live, ...this.ghosts.values()];

    const reachedAt = new Map<string, number>();
    for (const p of this.players.values()) reachedAt.set(p.id, p.scoreReachedAt);

    return all.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.deaths !== b.deaths) return a.deaths - b.deaths;
      return (reachedAt.get(a.id) ?? Infinity) - (reachedAt.get(b.id) ?? Infinity);
    });
  }

  private roundState(): RoundState {
    let msRemaining: number | null = null;
    if (this.phase === 'active') msRemaining = Math.max(0, this.roundEndsAt - Date.now());
    else if (this.phase === 'waiting' && this.pausedRemaining !== null)
      msRemaining = this.pausedRemaining;
    else if (this.phase === 'intermission') msRemaining = 0;

    return { phase: this.phase, msRemaining, winner: this.winner };
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const p of this.players.values()) {
      this.finishReloadIfDue(p);

      // Backstop for fall deaths in case the client never reports one.
      if (p.alive && p.pos.y < DEATH_Y) this.killPlayer(p, null, 'fall');

      if (!p.alive && now >= p.respawnAt) this.respawn(p);

      // Walk-over pickups: health and shield are collected automatically, and a
      // weapon is only auto-equipped when the player has nothing in the gun slot.
      if (p.alive) {
        for (const pickup of this.pickups.values()) {
          if (distance(p.pos, pickup.pos) > PICKUP_RADIUS) continue;
          const isWeapon = pickup.type !== 'health' && pickup.type !== 'shield';
          if (isWeapon && p.gun) continue;
          this.onPickup(p.id, pickup.id);
          break;
        }
      }
    }

    this.stepProjectiles(dt);

    if (now >= this.nextPickupAt) {
      this.spawnPickup();
      this.nextPickupAt =
        now + PICKUP_SPAWN_MIN_MS + Math.random() * (PICKUP_SPAWN_MAX_MS - PICKUP_SPAWN_MIN_MS);
    }

    if (this.phase === 'active' && now >= this.roundEndsAt) this.endRound();
    else if (this.phase === 'intermission' && now >= this.intermissionEndsAt) this.startNextRound();

    this.broadcast();
  }

  private broadcast(): void {
    const players: PlayerSnapshot[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      p: p.pos,
      v: p.vel,
      yaw: p.yaw,
      pitch: p.pitch,
      swinging: p.swinging,
      grounded: p.grounded,
      anchor: p.anchor,
      hp: p.hp,
      shield: p.shield,
      alive: p.alive,
      invuln: Date.now() < p.invulnUntil,
      gun: p.gun?.id ?? null,
      equipped: p.equipped,
      firedAt: p.lastFireAt,
    }));

    const pickups: PickupSnapshot[] = [...this.pickups.values()].map((pk) => ({
      id: pk.id,
      type: pk.type,
      p: pk.pos,
    }));

    const projectiles: ProjectileSnapshot[] = [...this.projectiles.values()].map((pr) => ({
      id: pr.id,
      weapon: pr.weapon,
      p: pr.pos,
      v: pr.vel,
    }));

    const snapshot: Snapshot = {
      t: Date.now(),
      players,
      pickups,
      projectiles,
      round: this.roundState(),
      scores: this.scoreboard(),
    };

    this.io.to(this.id).emit(EV.SNAPSHOT, snapshot);
  }

  sendSelf(p: ServerPlayer): void {
    const self: SelfState = {
      hp: Math.round(p.hp),
      shield: Math.round(p.shield),
      alive: p.alive,
      invuln: Date.now() < p.invulnUntil,
      respawnInMs: p.alive ? 0 : Math.max(0, p.respawnAt - Date.now()),
      equipped: p.equipped,
      gun: p.gun?.id ?? null,
      mag: p.gun ? p.gun.mag : 0,
      reserve: p.gun ? p.gun.reserve : 0,
      stones: p.stones,
      reloading: Date.now() < p.reloadingUntil,
    };
    this.io.to(p.id).emit(EV.SELF, self);
  }
}

function isFiniteVec(v: { x: number; y: number; z: number } | undefined): boolean {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Muzzle origins come from the client, so clamp them to the player's actual
 * position — otherwise a modified client could shoot from anywhere on the map.
 */
function clampOriginToPlayer(p: ServerPlayer, origin: Vec3): Vec3 {
  const head = add(p.pos, vec(0, PLAYER_HEIGHT * 0.9, 0));
  const offset = add(origin, scale(head, -1));
  const dist = length(offset);
  const MAX_MUZZLE_OFFSET = 2.5;
  if (dist <= MAX_MUZZLE_OFFSET) return origin;
  return add(head, scale(normalize(offset), MAX_MUZZLE_OFFSET));
}
