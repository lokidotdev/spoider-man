import { io, type Socket } from 'socket.io-client';
import {
  EV,
  type ExplosionEvent,
  type FireRequest,
  type HitEvent,
  type JoinedPayload,
  type KillEvent,
  type PlayerStateUpdate,
  type SelfState,
  type Snapshot,
  type Vec3Tuple,
} from '@shared/protocol';
import type { SlotId } from '@shared/constants';
import { resetWorld, useGame, world } from './store';

let socket: Socket | null = null;

/** Events the 3D layer subscribes to; kept out of React to avoid re-render churn. */
type Listeners = {
  onRespawn?: (p: Vec3Tuple) => void;
  onHit?: (e: HitEvent) => void;
  onKill?: (e: KillEvent) => void;
  onExplosion?: (e: ExplosionEvent) => void;
  onSelf?: (s: SelfState) => void;
};

export const listeners: Listeners = {};

export function connect(): void {
  if (socket) return;

  const store = useGame.getState();
  store.setPhase('connecting');
  resetWorld();

  // The game server is deployed separately from this static bundle, so its
  // origin is baked in at build time. Left unset (local dev), we connect to
  // our own origin and the Vite proxy forwards /socket.io onward.
  const serverUrl = import.meta.env.VITE_SERVER_URL;
  socket = serverUrl
    ? io(serverUrl, { transports: ['websocket', 'polling'] })
    : io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket?.emit(EV.JOIN);
  });

  socket.on('connect_error', (err) => {
    useGame.getState().setPhase('error', `Could not reach the game server (${err.message}).`);
  });

  socket.on('disconnect', () => {
    useGame.getState().setPhase('error', 'Disconnected from the game server.');
  });

  socket.on(EV.JOINED, (payload: JoinedPayload) => {
    const s = useGame.getState();
    // This also flips the phase to 'playing', which is what mounts the 3D
    // scene — so the spawn is stored rather than dispatched, because the
    // player controller does not exist yet to receive it.
    s.setIdentity(payload.selfId, payload.roomId, payload.name, payload.color, payload.spawn);
  });

  socket.on(EV.SNAPSHOT, (snap: Snapshot) => {
    const s = useGame.getState();
    const now = performance.now();
    world.lastSnapshotAt = now;
    world.pickups = snap.pickups;
    world.projectiles = snap.projectiles;

    const selfId = s.selfId;
    const seen = new Set<string>();
    for (const p of snap.players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let history = world.remote.get(p.id);
      if (!history) {
        history = [];
        world.remote.set(p.id, history);
      }
      history.push({ t: now, s: p });
      // Two seconds of history is far more than the interpolation delay needs.
      while (history.length > 2 && now - history[0].t > 2000) history.shift();
    }
    // Drop anyone no longer in the room (disconnected or moved rooms).
    for (const id of world.remote.keys()) if (!seen.has(id)) world.remote.delete(id);

    s.setRound(snap.round);
    s.setScores(snap.scores);
  });

  socket.on(EV.SELF, (self: SelfState) => {
    useGame.getState().setSelf(self);
    listeners.onSelf?.(self);
  });

  socket.on(EV.RESPAWN, (payload: { p: Vec3Tuple }) => {
    listeners.onRespawn?.(payload.p);
  });

  socket.on(EV.HIT, (e: HitEvent) => listeners.onHit?.(e));
  socket.on(EV.EXPLOSION, (e: ExplosionEvent) => listeners.onExplosion?.(e));

  socket.on(EV.KILL, (e: KillEvent) => {
    useGame.getState().pushKill(e);
    listeners.onKill?.(e);
  });

  socket.on(EV.PLAYER_JOINED, (payload: { name: string }) => {
    useGame.getState().pushToast(`${payload.name} joined`);
  });
}

export function sendState(update: PlayerStateUpdate): void {
  socket?.emit(EV.STATE, update);
}

export function sendFire(req: FireRequest): void {
  socket?.emit(EV.FIRE, req);
}

export function sendReload(): void {
  socket?.emit(EV.RELOAD);
}

export function sendSwitch(slot: SlotId | 'cycle', pickupId?: string): void {
  socket?.emit(EV.SWITCH, { slot, pickupId });
}

export function sendPickup(id: string): void {
  socket?.emit(EV.PICKUP, { id });
}

export function sendFell(): void {
  socket?.emit(EV.FELL);
}
