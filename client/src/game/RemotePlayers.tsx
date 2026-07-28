import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { INTERP_DELAY_MS, type WeaponId } from '@shared/constants';
import type { PlayerSnapshot } from '@shared/protocol';
import { world } from '../net/store';
import { Character } from './Character';
import { WebRope } from './WebRope';

/**
 * Remote players are rendered INTERP_DELAY_MS in the past and interpolated
 * between the two snapshots that straddle that time. Nothing is ever snapped
 * directly to the newest packet, which is what keeps movement smooth at a
 * 30Hz network tick instead of visibly stepping.
 */

/**
 * One body's interpolated state. Filled in place every frame rather than
 * rebuilt: this runs once per remote player per frame, and returning fresh
 * objects and vectors from here was handing the garbage collector a few hundred
 * allocations a second — which arrive as periodic frame hitches, and get worse
 * with every extra player in the room.
 */
interface RemoteState {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  swinging: boolean;
  grounded: boolean;
  invuln: boolean;
  alive: boolean;
  anchor: THREE.Vector3;
  hasAnchor: boolean;
  weapon: WeaponId | null;
  /** Server timestamp of their last shot; only ever compared with itself. */
  firedAt: number;
}

function makeRemoteState(): RemoteState {
  return {
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    speed: 0,
    swinging: false,
    grounded: true,
    invuln: false,
    alive: true,
    anchor: new THREE.Vector3(),
    hasAnchor: false,
    weapon: 'gloves',
    firedAt: 0,
  };
}

/** What a remote player's hands should be holding, from their slot and gun. */
function heldWeapon(s: PlayerSnapshot): WeaponId | null {
  if (s.equipped === 'gun') return s.gun;
  return s.equipped === 'stones' ? 'stones' : 'gloves';
}

function sampleInto(
  out: RemoteState,
  history: { t: number; s: PlayerSnapshot }[],
  renderTime: number
): boolean {
  if (history.length === 0) return false;

  // Older than anything we have: hold the oldest sample rather than guessing.
  if (renderTime <= history[0].t) {
    blend(out, history[0].s, history[0].s, 0);
    return true;
  }

  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i];
    const b = history[i + 1];
    if (renderTime >= a.t && renderTime <= b.t) {
      const span = b.t - a.t;
      blend(out, a.s, b.s, span > 1e-3 ? (renderTime - a.t) / span : 0);
      return true;
    }
  }

  // Ahead of the newest sample (a packet is late): extrapolate briefly using
  // the last known velocity, capped so a long stall can't fling the body away.
  const last = history[history.length - 1];
  const ahead = Math.min((renderTime - last.t) / 1000, 0.2);
  blend(out, last.s, last.s, 0);
  out.pos.x += last.s.v.x * ahead;
  out.pos.y += last.s.v.y * ahead;
  out.pos.z += last.s.v.z * ahead;
  return true;
}

function blend(out: RemoteState, a: PlayerSnapshot, b: PlayerSnapshot, alpha: number): void {
  out.pos.set(
    THREE.MathUtils.lerp(a.p.x, b.p.x, alpha),
    THREE.MathUtils.lerp(a.p.y, b.p.y, alpha),
    THREE.MathUtils.lerp(a.p.z, b.p.z, alpha)
  );
  // Shortest-arc yaw blend so crossing +/-PI doesn't spin the model around.
  let dYaw = b.yaw - a.yaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  out.yaw = a.yaw + dYaw * alpha;
  out.pitch = THREE.MathUtils.lerp(a.pitch, b.pitch, alpha);

  const src = alpha < 0.5 ? a : b;
  out.speed = Math.hypot(src.v.x, src.v.z);
  out.swinging = src.swinging;
  out.grounded = src.grounded;
  out.invuln = src.invuln;
  out.alive = src.alive;
  out.hasAnchor = !!src.anchor;
  if (src.anchor) out.anchor.set(src.anchor.x, src.anchor.y, src.anchor.z);
  out.weapon = heldWeapon(src);
  // Take the newest shot time in the pair: a shot that lands between the two
  // samples must not be dropped just because we're rendering the older one.
  out.firedAt = Math.max(a.firedAt, b.firedAt);
}

/**
 * Nameplate drawn into a canvas and shown as a sprite. Sprites always face the
 * camera for free, and unlike a text-mesh library this pulls no font over the
 * network — everything the game renders is generated locally.
 */
function useNameplate(name: string, color: string): THREE.Sprite {
  return useMemo(() => {
    const pad = 12;
    const font = '600 44px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif';

    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const width = Math.ceil(measure.measureText(name).width) + pad * 2;
    const height = 64;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Dark outline keeps the name legible against both sky and concrete.
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(12, 16, 22, 0.92)';
    ctx.strokeText(name, width / 2, height / 2);
    ctx.fillStyle = color;
    ctx.fillText(name, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true })
    );
    sprite.scale.set((width / height) * 0.42, 0.42, 1);
    return sprite;
  }, [name, color]);
}

function RemotePlayer({ id, name, color }: { id: string; name: string; color: string }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const nameplate = useNameplate(name, color);
  const state = useRef<RemoteState>(makeRemoteState());

  // The weapon selects meshes, so it has to reach React — but it changes on a
  // pickup, not per frame, so it is lifted out of the render loop on a timer.
  const [weapon, setWeapon] = useState<WeaponId | null>('gloves');
  useEffect(() => {
    const timer = setInterval(() => setWeapon(state.current.weapon), 200);
    return () => clearInterval(timer);
  }, []);

  // Their shot times arrive on the server clock; the moment we *noticed* a new
  // one is what the animation actually needs, so it is recorded locally.
  const lastFiredAt = useRef(-1);
  const firedLocally = useRef(-Infinity);
  const published = useRef({ x: 0, y: 0, z: 0 });

  useFrame(() => {
    const history = world.remote.get(id);
    if (!history || history.length === 0) return;

    const sampled = state.current;
    if (!sampleInto(sampled, history, performance.now() - INTERP_DELAY_MS)) return;

    if (sampled.firedAt !== lastFiredAt.current) {
      // Only a forward jump is a shot. The first sample is whatever they were
      // doing before we arrived, and a respawn resets the clock to zero —
      // neither should replay a punch.
      if (lastFiredAt.current >= 0 && sampled.firedAt > lastFiredAt.current) {
        firedLocally.current = performance.now();
      }
      lastFiredAt.current = sampled.firedAt;
    }

    if (group.current) {
      group.current.visible = sampled.alive;
      group.current.position.copy(sampled.pos);
      group.current.rotation.y = sampled.yaw + Math.PI;
    }
    if (label.current) {
      label.current.visible = sampled.alive;
      label.current.position.set(sampled.pos.x, sampled.pos.y + 1.95, sampled.pos.z);
    }

    // Publish where this body is actually drawn, so aiming can converge on it.
    // The entry is mutated in place — the map holds this exact object.
    if (sampled.alive) {
      published.current.x = sampled.pos.x;
      published.current.y = sampled.pos.y;
      published.current.z = sampled.pos.z;
      world.rendered.set(id, published.current);
    } else {
      world.rendered.delete(id);
    }
  });

  useEffect(() => () => void world.rendered.delete(id), [id]);

  return (
    <>
      <group ref={group}>
        <Character
          color={color}
          weapon={weapon}
          getSpeed={() => state.current.speed}
          getSwinging={() => state.current.swinging}
          getGrounded={() => state.current.grounded}
          getInvuln={() => state.current.invuln}
          getPitch={() => state.current.pitch}
          getFireAge={() => (performance.now() - firedLocally.current) / 1000}
        />
      </group>

      {/* Nameplate: a sprite, so it faces the camera without extra work. */}
      <group ref={label}>
        <primitive object={nameplate} />
      </group>

      <WebRope
        active={() => state.current.swinging && state.current.hasAnchor && state.current.alive}
        from={(v) => {
          const p = state.current.pos;
          v.set(p.x, p.y + 1.0, p.z);
        }}
        to={(v) => v.copy(state.current.anchor)}
      />
    </>
  );
}

export function RemotePlayers() {
  // The *set* of players changes rarely, so React only re-renders on join/leave
  // while positions update every frame via refs.
  const [roster, setRoster] = useState<{ id: string; name: string; color: string }[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const next: { id: string; name: string; color: string }[] = [];
      for (const [id, history] of world.remote) {
        const latest = history[history.length - 1];
        if (latest) next.push({ id, name: latest.s.name, color: latest.s.color });
      }
      setRoster((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.id === next[i].id && p.name === next[i].name)
        ) {
          return prev;
        }
        return next;
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {roster.map((p) => (
        <RemotePlayer key={p.id} id={p.id} name={p.name} color={p.color} />
      ))}
    </>
  );
}
