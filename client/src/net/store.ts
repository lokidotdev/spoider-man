import { create } from 'zustand';
import type {
  KillEvent,
  PickupSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  RoundState,
  ScoreEntry,
  SelfState,
  Vec3Tuple,
} from '@shared/protocol';
import { MAX_HP, STONE_STOCK } from '@shared/constants';

export type Phase = 'start' | 'connecting' | 'playing' | 'error';

export interface KillFeedItem extends KillEvent {
  key: number;
  at: number;
}

export interface ToastItem {
  key: number;
  text: string;
  at: number;
}

interface GameStore {
  phase: Phase;
  errorMessage: string | null;

  selfId: string | null;
  roomId: string | null;
  name: string;
  color: string;
  /**
   * Spawn point from the join handshake. It arrives before the 3D scene mounts,
   * so it is parked here for the player controller to apply once it exists.
   */
  spawn: Vec3Tuple | null;

  self: SelfState;
  round: RoundState;
  scores: ScoreEntry[];
  killFeed: KillFeedItem[];
  toasts: ToastItem[];

  /** Pickup the local player is standing on, if any — drives the swap prompt. */
  nearbyPickup: PickupSnapshot | null;

  setPhase: (phase: Phase, message?: string) => void;
  setIdentity: (
    id: string,
    roomId: string,
    name: string,
    color: string,
    spawn: Vec3Tuple
  ) => void;
  setSelf: (self: SelfState) => void;
  setRound: (round: RoundState) => void;
  setScores: (scores: ScoreEntry[]) => void;
  pushKill: (kill: KillEvent) => void;
  pushToast: (text: string) => void;
  expire: (now: number) => void;
  setNearbyPickup: (p: PickupSnapshot | null) => void;
  reset: () => void;
}

const emptySelf: SelfState = {
  hp: MAX_HP,
  shield: 0,
  alive: true,
  invuln: false,
  respawnInMs: 0,
  equipped: 'gloves',
  gun: null,
  mag: 0,
  reserve: 0,
  stones: STONE_STOCK,
  reloading: false,
};

const KILL_FEED_MS = 5000;
const TOAST_MS = 4000;

let keyCounter = 1;

/** Cheap field-wise compare — the board is at most five rows plus ghosts. */
function sameScoreboard(a: ScoreEntry[], b: ScoreEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.score !== y.score ||
      x.kills !== y.kills ||
      x.deaths !== y.deaths ||
      x.ghost !== y.ghost ||
      x.name !== y.name
    ) {
      return false;
    }
  }
  return true;
}

export const useGame = create<GameStore>((set) => ({
  phase: 'start',
  errorMessage: null,
  selfId: null,
  roomId: null,
  name: '',
  color: '#ffffff',
  spawn: null,
  self: emptySelf,
  round: { phase: 'waiting', msRemaining: null, winner: null },
  scores: [],
  killFeed: [],
  toasts: [],
  nearbyPickup: null,

  setPhase: (phase, message) => set({ phase, errorMessage: message ?? null }),
  setIdentity: (selfId, roomId, name, color, spawn) =>
    set({ selfId, roomId, name, color, spawn, phase: 'playing' }),
  setSelf: (self) => set({ self }),

  // Snapshots land 30 times a second, and both of these used to push a fresh
  // object into React on every one of them — re-rendering the whole HUD and
  // scoreboard 30x/sec for values that mostly hadn't changed. Returning the
  // existing state unchanged is how zustand is told to skip the notification.
  setRound: (round) =>
    set((s) => {
      const cur = s.round;
      // The clock only needs to reach React when the displayed second changes.
      const wasSecond = cur.msRemaining === null ? -1 : Math.floor(cur.msRemaining / 1000);
      const nowSecond = round.msRemaining === null ? -1 : Math.floor(round.msRemaining / 1000);
      if (
        cur.phase === round.phase &&
        wasSecond === nowSecond &&
        cur.winner?.name === round.winner?.name &&
        cur.winner?.score === round.winner?.score
      ) {
        return s;
      }
      return { round };
    }),

  setScores: (scores) =>
    set((s) => (sameScoreboard(s.scores, scores) ? s : { scores })),

  pushKill: (kill) =>
    set((s) => ({
      killFeed: [...s.killFeed, { ...kill, key: keyCounter++, at: performance.now() }].slice(-6),
    })),

  pushToast: (text) =>
    set((s) => ({
      toasts: [...s.toasts, { key: keyCounter++, text, at: performance.now() }].slice(-4),
    })),

  // Called from the render loop rather than per-item timers, so a paused tab
  // doesn't leave a pile of stale entries on screen.
  expire: (now) =>
    set((s) => {
      const killFeed = s.killFeed.filter((k) => now - k.at < KILL_FEED_MS);
      const toasts = s.toasts.filter((t) => now - t.at < TOAST_MS);
      if (killFeed.length === s.killFeed.length && toasts.length === s.toasts.length) return s;
      return { killFeed, toasts };
    }),

  setNearbyPickup: (nearbyPickup) => set({ nearbyPickup }),

  reset: () =>
    set({
      phase: 'start',
      selfId: null,
      roomId: null,
      spawn: null,
      self: emptySelf,
      scores: [],
      killFeed: [],
      toasts: [],
      nearbyPickup: null,
    }),
}));

/**
 * High-frequency world state lives outside React: snapshots arrive 30x/second
 * and re-rendering the tree at that rate would tank the frame budget. The
 * render loop reads this directly via useFrame.
 */
export interface WorldBuffer {
  /** Snapshot history per remote player, used for interpolation. */
  remote: Map<string, { t: number; s: PlayerSnapshot }[]>;
  /**
   * Where each living remote player is *drawn* this frame — the interpolated
   * position, not the newest packet. Aiming has to test against what the player
   * can actually see under their crosshair, so the renderer publishes it here
   * rather than every consumer re-deriving it.
   */
  rendered: Map<string, Vec3Tuple>;
  pickups: PickupSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Server clock offset estimate, so interpolation uses a comparable timeline. */
  lastSnapshotAt: number;
}

export const world: WorldBuffer = {
  remote: new Map(),
  rendered: new Map(),
  pickups: [],
  projectiles: [],
  lastSnapshotAt: 0,
};

export function resetWorld(): void {
  world.remote.clear();
  world.rendered.clear();
  world.pickups = [];
  world.projectiles = [];
  world.lastSnapshotAt = 0;
}
