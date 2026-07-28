import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CapsuleCollider,
  RigidBody,
  useAfterPhysicsStep,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import {
  AIR_CONTROL_ACCEL,
  CLIENT_SEND_HZ,
  JUMP_VELOCITY,
  MOVE_SPEED,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SWING_INPUT_FORCE,
  WEAPONS,
  WEB_MAX_RANGE,
  WEB_MIN_LENGTH,
  WEB_REEL_SPEED,
  type SlotId,
  type WeaponId,
} from '@shared/constants';
import { DEATH_Y } from '@shared/world';
import { rayCapsule } from '@shared/math';
import { clearEdges, input } from './input';
import { Character } from './Character';
import { useGame, world } from '../net/store';
import { listeners, sendFell, sendFire, sendReload, sendState, sendSwitch } from '../net/socket';
import { sfx } from '../audio/sfx';
import { WebRope } from './WebRope';

/** Distance from the capsule's centre down to the soles. */
const FEET_OFFSET = PLAYER_HEIGHT / 2;
const EYE_HEIGHT = 1.35;

const CAMERA_DISTANCE = 3.4;
const CAMERA_SHOULDER = 0.55;
const CAMERA_HEIGHT = 0.3;
const ADS_DISTANCE = 1.9;
const ADS_SHOULDER = 0.35;

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

/** How far down the crosshair ray to look for the point shots should converge on. */
const AIM_TRACE_DISTANCE = 300;
/**
 * How far past the camera the convergence point must stay. The lens sits behind
 * the player, so anything closer than the boom lands *behind* the muzzle and
 * sends the shot out backwards — which a short weapon range, or simply backing
 * into a wall, used to do.
 */
const MIN_AIM_LEAD = 1;

/** Radius the boom is treated as having when testing it against the world. */
const CAMERA_PADDING = 0.22;

// Scratch objects reused every frame — allocating inside useFrame would churn GC.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _desiredCam = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _rope = new THREE.Vector3();
const _boomU = new THREE.Vector3();
const _boomW = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _render = new THREE.Vector3();

/**
 * The single view basis everything else is derived from. Yaw and pitch *are*
 * where the player is looking: the camera orientation, the movement axes, the
 * body's facing and the aim ray all read from here, so none of them can drift
 * into its own convention.
 *
 * The formula is three.js's own YXZ Euler order, which is what lets
 * `camera.rotation.set(pitch, yaw, 0)` aim the camera down exactly this vector.
 */
function viewForward(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Horizontal right-hand axis of the same basis (pitch never rolls it). */
function viewRight(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export function Player() {
  const body = useRef<RapierRigidBody>(null);
  const modelRef = useRef<THREE.Group>(null);
  /**
   * Empty child of the rigid body, used purely to read its *interpolated*
   * transform. The physics runs at a fixed 60Hz while the screen may not, so
   * `translation()` alone steps in visible increments; the body's own group is
   * smoothed between steps, and anything parented to it inherits that.
   */
  const visual = useRef<THREE.Object3D>(null);
  const { rapier, world: physics } = useRapier();
  const camera = useThree((s) => s.camera);

  const color = useGame((s) => s.color);
  // Weapon identity changes on a pickup or a slot press, never per frame, so it
  // is the one piece of pose state that comes through React.
  const slot = useGame((s) => s.self.equipped);
  const heldGun = useGame((s) => s.self.gun);
  const inHand: WeaponId | null = slot === 'gun' ? heldGun : slot === 'stones' ? 'stones' : 'gloves';

  // All per-frame mutable state lives in refs: none of it should re-render React.
  const yaw = useRef(0);
  const pitch = useRef(0);
  const grounded = useRef(true);
  const attached = useRef(false);
  const anchorPoint = useRef(new THREE.Vector3());
  const ropeLength = useRef(0);
  const maxRopeLength = useRef(0);
  const lastFireTime = useRef(0);
  const lastSendTime = useRef(0);
  const fellReported = useRef(false);
  const cameraDistance = useRef(CAMERA_DISTANCE);
  const alive = useRef(true);
  const equipped = useRef<SlotId>('gloves');
  const gun = useRef<WeaponId | null>(null);
  const magRef = useRef(0);
  const stonesRef = useRef(0);
  const swingSoundOn = useRef(false);

  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier]);

  // The join handshake completes before this component exists, so the spawn it
  // carried is applied here on mount rather than through the respawn event.
  useEffect(() => {
    // Yaw before pitch, with no roll — the order the view basis above assumes.
    camera.rotation.order = 'YXZ';

    const spawn = useGame.getState().spawn;
    const rb = body.current;
    if (!spawn || !rb) return;
    rb.setTranslation({ x: spawn.x, y: spawn.y + FEET_OFFSET + 0.1, z: spawn.z }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // Face the middle of the arena on arrival instead of whatever -Z happens to
    // be, so a fresh spawn is never staring off the edge of the map.
    faceArenaCentre(spawn.x, spawn.z);
  }, [camera]);

  // --- server-driven state that the frame loop needs without a React read ---
  useEffect(() => {
    listeners.onSelf = (self) => {
      alive.current = self.alive;
      equipped.current = self.equipped;
      gun.current = self.gun;
      magRef.current = self.mag;
      stonesRef.current = self.stones;
    };
    listeners.onRespawn = (p) => {
      const rb = body.current;
      if (!rb) return;
      detach();
      rb.setTranslation({ x: p.x, y: p.y + FEET_OFFSET + 0.1, z: p.z }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      faceArenaCentre(p.x, p.z);
      fellReported.current = false;
      alive.current = true;
    };
    return () => {
      listeners.onSelf = undefined;
      listeners.onRespawn = undefined;
      // Unmounting mid-swing must not leave the wind loop playing forever.
      swingSoundOn.current = false;
      sfx.swingLoop(false);
    };
  }, []);

  /** Aims the view at the middle of the map from a rooftop spawn point. */
  function faceArenaCentre(x: number, z: number): void {
    // Inverse of viewForward: forward = (-sin yaw, 0, -cos yaw) should point at
    // the origin, i.e. along (-x, 0, -z).
    yaw.current = Math.atan2(x, z);
    pitch.current = 0;
  }

  function detach(): void {
    if (attached.current) sfx.webRelease();
    attached.current = false;
    ropeLength.current = 0;
    // The wind loop is stopped here rather than left to the frame loop: clearing
    // the flag alone would skip the stop branch and leave the loop running.
    if (swingSoundOn.current) {
      swingSoundOn.current = false;
      sfx.swingLoop(false);
    }
  }

  /**
   * The world point under the crosshair, which is what every shot is aimed at.
   * The muzzle sits below and left of the lens, so shots are aimed *at this
   * point* rather than fired parallel to the view — that is what makes the
   * reticle mean something in a third-person camera.
   *
   * Two things matter here:
   *
   * 1. The trace length is independent of the weapon. It answers "what is the
   *    player looking at", not "what can this gun reach". Tying it to weapon
   *    range put the gloves' aim point 2.6m ahead of the *camera*, which is
   *    behind the player's own head, and punches flew out backwards.
   *
   * 2. Players are traced, not just geometry. Converging on a distant wall — or
   *    on nothing at all, against open sky — leaves the shot running roughly
   *    parallel to the crosshair ray and about half a metre to the side of it,
   *    which is wider than a player is, so anyone skylined got missed cleanly.
   */
  function aimPointFromCrosshair(rb: RapierRigidBody, out: THREE.Vector3): void {
    camera.getWorldDirection(_forward);
    const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const dir = { x: _forward.x, y: _forward.y, z: _forward.z };

    ray.origin = origin;
    ray.dir = dir;
    // solid:false — if the lens has clipped inside geometry, an embedded ray
    // start must not report a hit at zero distance.
    const hit = physics.castRay(ray, AIM_TRACE_DISTANCE, false, undefined, undefined, undefined, rb);

    // The floor only has to clear the boom: any convergence point past the lens
    // by more than the camera trails is safely in front of the muzzle.
    const floor = cameraDistance.current + MIN_AIM_LEAD;
    let dist = Math.max(hit ? hit.timeOfImpact : AIM_TRACE_DISTANCE, floor);

    // A player under the crosshair wins over whatever is behind them. No floor
    // applies: the aim point lands on their capsule, so the muzzle ray meets it.
    for (const p of world.rendered.values()) {
      const t = rayCapsule(origin, dir, p, PLAYER_HEIGHT, PLAYER_RADIUS, dist);
      if (t !== null && t < dist) dist = t;
    }

    out.copy(camera.position).addScaledVector(_forward, dist);
  }

  /**
   * Finds a web anchor: a ray from the camera through the crosshair, accepting
   * only building surfaces. The ground plane is explicitly rejected — a miss
   * means no attachment at all rather than a fallback anchor.
   */
  function tryAttach(): boolean {
    const rb = body.current;
    if (!rb) return false;

    camera.getWorldDirection(_forward);
    ray.origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    ray.dir = { x: _forward.x, y: _forward.y, z: _forward.z };

    // Traced from the lens, so the boom length is added back — otherwise the
    // web would fall short of WEB_MAX_RANGE by however far the camera trails.
    const reach = WEB_MAX_RANGE + cameraDistance.current;
    const hit = physics.castRay(ray, reach, false, undefined, undefined, undefined, rb);
    if (!hit) return false;

    const t = hit.timeOfImpact;
    _anchor.copy(camera.position).addScaledVector(_forward, t);

    // Reject the ground plane and anything too low to swing from usefully.
    if (_anchor.y < 2) return false;

    const pos = rb.translation();
    const dist = _anchor.distanceTo(_v1.set(pos.x, pos.y, pos.z));
    if (dist < WEB_MIN_LENGTH * 0.5 || dist > WEB_MAX_RANGE) return false;

    anchorPoint.current.copy(_anchor);
    ropeLength.current = dist;
    maxRopeLength.current = dist;
    attached.current = true;
    sfx.webAttach();
    return true;
  }

  /**
   * The rope constraint runs after *every* simulation step, not once per
   * rendered frame. When a frame runs long the world catches up in several
   * steps, and solving only at the end would let the body swing a whole stall's
   * worth of arc unconstrained before being snapped back onto the rope — which
   * looks exactly like the camera teleporting.
   */
  useAfterPhysicsStep(() => {
    const rb = body.current;
    if (rb && attached.current) solveRope(rb);
  });

  /**
   * The swing itself: an inextensible rope solved as a position + velocity
   * constraint. Gravity comes from Rapier, so the arc, the speed gained on the
   * way down and the momentum carried into the next swing all fall out of the
   * simulation rather than being scripted.
   */
  function solveRope(rb: RapierRigidBody): void {
    const pos = rb.translation();
    _rope.set(pos.x - anchorPoint.current.x, pos.y - anchorPoint.current.y, pos.z - anchorPoint.current.z);
    const dist = _rope.length();
    // Rope slack: nothing to solve, the player is in free fall.
    if (dist <= ropeLength.current || dist < 1e-5) return;

    _rope.multiplyScalar(1 / dist); // now the unit vector anchor -> player

    // 1. Positional correction back onto the sphere of radius ropeLength.
    rb.setTranslation(
      {
        x: anchorPoint.current.x + _rope.x * ropeLength.current,
        y: anchorPoint.current.y + _rope.y * ropeLength.current,
        z: anchorPoint.current.z + _rope.z * ropeLength.current,
      },
      true
    );

    // 2. Remove the outward (radial) velocity component, keeping the tangential
    //    part untouched. That is what conserves swing momentum and lets chained
    //    swings build speed.
    const vel = rb.linvel();
    const radial = vel.x * _rope.x + vel.y * _rope.y + vel.z * _rope.z;
    if (radial > 0) {
      rb.setLinvel(
        {
          x: vel.x - _rope.x * radial,
          y: vel.y - _rope.y * radial,
          z: vel.z - _rope.z * radial,
        },
        true
      );
    }
  }

  function fire(): void {
    const rb = body.current;
    if (!rb || !alive.current) return;

    const weaponId: WeaponId | null =
      equipped.current === 'gloves'
        ? 'gloves'
        : equipped.current === 'stones'
          ? stonesRef.current > 0
            ? 'stones'
            : null
          : gun.current;
    if (!weaponId) return;

    const spec = WEAPONS[weaponId];
    const now = performance.now();
    if (now - lastFireTime.current < spec.fireInterval * 1000) return;
    if (spec.slot === 'gun' && magRef.current <= 0) return;
    lastFireTime.current = now;

    const pos = rb.translation();
    const origin = _v1.set(pos.x, pos.y + (EYE_HEIGHT - FEET_OFFSET), pos.z);

    // Aim from the muzzle toward whatever the crosshair is over, so shots
    // converge on the reticle instead of running parallel to the camera.
    aimPointFromCrosshair(rb, _aimPoint);
    const dir = _v2.copy(_aimPoint).sub(origin).normalize();

    sfx.shoot(weaponId);
    sendFire({
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      seq: Math.floor(now),
    });
  }

  /** Nearest pickup underfoot, used for the swap prompt and the swap request. */
  function nearestPickupId(px: number, py: number, pz: number): string | null {
    let best: string | null = null;
    let bestDist = 2.2;
    for (const pk of world.pickups) {
      const dx = pk.p.x - px;
      const dy = pk.p.y - py;
      const dz = pk.p.z - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bestDist) {
        bestDist = d;
        best = pk.id;
      }
    }
    return best;
  }

  useFrame((_, rawDelta) => {
    const rb = body.current;
    if (!rb) return;
    const delta = Math.min(rawDelta, 1 / 30);

    // ---------------------------------------------------------- look
    yaw.current -= input.mouseDX * MOUSE_SENSITIVITY;
    pitch.current -= input.mouseDY * MOUSE_SENSITIVITY;
    pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);

    const pos = rb.translation();
    const vel = rb.linvel();

    // ---------------------------------------------------------- ground check
    ray.origin = { x: pos.x, y: pos.y, z: pos.z };
    ray.dir = { x: 0, y: -1, z: 0 };
    const groundHit = physics.castRay(ray, FEET_OFFSET + 0.25, true, undefined, undefined, undefined, rb);
    const wasGrounded = grounded.current;
    grounded.current = !!groundHit && !attached.current;
    if (grounded.current && !wasGrounded && vel.y < -6) sfx.land();

    // ---------------------------------------------------------- web
    if (input.swingPressed && alive.current) {
      if (!tryAttach()) sfx.webMiss();
    }
    if (!input.swingDown && attached.current) detach();
    if (!alive.current && attached.current) detach();

    if (attached.current) {
      // Reeling in shortens the rope; it never extends past the attach distance,
      // so any height gained above the anchor comes from real pendulum energy.
      if (input.wheel !== 0) {
        ropeLength.current = THREE.MathUtils.clamp(
          ropeLength.current - input.wheel * WEB_REEL_SPEED,
          WEB_MIN_LENGTH,
          maxRopeLength.current
        );
      }

      if (!swingSoundOn.current) {
        swingSoundOn.current = true;
        sfx.swingLoop(true);
      }
    } else if (swingSoundOn.current) {
      swingSoundOn.current = false;
      sfx.swingLoop(false);
    }

    // ---------------------------------------------------------- movement
    const wish = _v1.set(0, 0, 0);
    if (input.forward) wish.z -= 1;
    if (input.back) wish.z += 1;
    if (input.left) wish.x -= 1;
    if (input.right) wish.x += 1;

    if (wish.lengthSq() > 0) {
      wish.normalize();
      // Movement runs on the same basis as the view, so W always goes where the
      // crosshair points. Pitch is dropped: looking up must not slow the walk.
      viewForward(yaw.current, 0, _forward);
      viewRight(yaw.current, _right);
      const wx = wish.x * _right.x - wish.z * _forward.x;
      const wz = wish.x * _right.z - wish.z * _forward.z;
      wish.set(wx, 0, wz);
    }

    if (alive.current) {
      if (attached.current) {
        // Pumping the swing: input pushes along the arc rather than overriding it.
        if (wish.lengthSq() > 0) {
          rb.applyImpulse(
            {
              x: wish.x * SWING_INPUT_FORCE * delta,
              y: 0,
              z: wish.z * SWING_INPUT_FORCE * delta,
            },
            true
          );
        }
      } else if (grounded.current) {
        rb.setLinvel({ x: wish.x * MOVE_SPEED, y: vel.y, z: wish.z * MOVE_SPEED }, true);
        if (input.jump) {
          rb.setLinvel({ x: wish.x * MOVE_SPEED, y: JUMP_VELOCITY, z: wish.z * MOVE_SPEED }, true);
          sfx.jump();
        }
      } else if (wish.lengthSq() > 0) {
        // Air control: accelerate, but never beyond normal ground speed.
        const targetX = vel.x + wish.x * AIR_CONTROL_ACCEL * delta;
        const targetZ = vel.z + wish.z * AIR_CONTROL_ACCEL * delta;
        const speed = Math.hypot(targetX, targetZ);
        const cap = Math.max(MOVE_SPEED, Math.hypot(vel.x, vel.z));
        const scale = speed > cap ? cap / speed : 1;
        rb.setLinvel({ x: targetX * scale, y: vel.y, z: targetZ * scale }, true);
      }
    }

    // ---------------------------------------------------------- weapons
    if (alive.current) {
      const weaponId =
        equipped.current === 'gloves' ? 'gloves' : equipped.current === 'stones' ? 'stones' : gun.current;
      const auto = weaponId ? WEAPONS[weaponId].fireMode === 'auto' : false;
      if (input.firePressed || (auto && input.fireDown)) fire();
      if (input.reloadPressed) sendReload();
      if (input.cyclePressed) sendSwitch('cycle');
      if (input.slotPressed !== null) {
        const slot: SlotId = input.slotPressed === 1 ? 'gun' : input.slotPressed === 2 ? 'gloves' : 'stones';
        // Pressing the gun slot while standing on a weapon swaps for it.
        const pickupId = slot === 'gun' ? nearestPickupId(pos.x, pos.y - FEET_OFFSET, pos.z) : null;
        sendSwitch(slot, pickupId ?? undefined);
      }
    }

    // ---------------------------------------------------------- fall death
    if (pos.y - FEET_OFFSET < DEATH_Y && !fellReported.current && alive.current) {
      fellReported.current = true;
      sfx.death();
      sendFell();
    }

    // ------------------------------------------------- model and camera
    // Both follow the smoothed transform rather than the raw physics one, so a
    // 60Hz simulation still looks continuous on a faster display. Everything
    // that has to agree with the server — aim, ground checks, the state we
    // report — keeps using the authoritative position above.
    if (visual.current) visual.current.getWorldPosition(_render);
    else _render.set(pos.x, pos.y, pos.z);

    if (modelRef.current) {
      modelRef.current.position.set(_render.x, _render.y - FEET_OFFSET, _render.z);
      // The body turns with the view. The Character's face (its eyes) sits on
      // local +Z, so the extra PI is what swings that side around to the front.
      modelRef.current.rotation.y = yaw.current + Math.PI;
    }

    _camTarget.set(_render.x, _render.y + (EYE_HEIGHT - FEET_OFFSET), _render.z);

    viewForward(yaw.current, pitch.current, _forward);
    viewRight(yaw.current, _right);

    const aiming = input.ads;
    const wantDistance = aiming ? ADS_DISTANCE : CAMERA_DISTANCE;
    const shoulder = aiming ? ADS_SHOULDER : CAMERA_SHOULDER;

    // The boom hangs *behind* the eye along the view vector, so the camera sits
    // on the line the player is looking down rather than orbiting on its own.
    _desiredCam
      .copy(_camTarget)
      .addScaledVector(_forward, -wantDistance)
      .addScaledVector(_right, shoulder)
      .addScaledVector(_v2.set(0, 1, 0), CAMERA_HEIGHT);

    // Pull the camera in if a building sits between it and the player.
    _v1.copy(_desiredCam).sub(_camTarget);
    const camDist = _v1.length();
    _v1.multiplyScalar(1 / camDist);

    // Four rays offset around the boom as well as the centre one, approximating
    // a cylinder. A single thin ray slips past building edges and corners, and
    // the camera pops in and out of the wall on alternate frames as it does.
    _boomU.set(-_v1.z, 0, _v1.x);
    if (_boomU.lengthSq() < 1e-6) _boomU.set(1, 0, 0);
    else _boomU.normalize();
    _boomW.crossVectors(_v1, _boomU).normalize();

    let nearest = camDist;
    for (let i = 0; i < 5; i++) {
      _probe.copy(_camTarget);
      if (i === 1) _probe.addScaledVector(_boomU, CAMERA_PADDING);
      else if (i === 2) _probe.addScaledVector(_boomU, -CAMERA_PADDING);
      else if (i === 3) _probe.addScaledVector(_boomW, CAMERA_PADDING);
      else if (i === 4) _probe.addScaledVector(_boomW, -CAMERA_PADDING);

      ray.origin = { x: _probe.x, y: _probe.y, z: _probe.z };
      ray.dir = { x: _v1.x, y: _v1.y, z: _v1.z };
      // solid:false so an eye point embedded in geometry doesn't report a hit
      // at distance zero and slam the camera into the player's head.
      const camHit = physics.castRay(ray, nearest, false, undefined, undefined, undefined, rb);
      if (camHit) nearest = Math.min(nearest, camHit.timeOfImpact);
    }
    const allowed = Math.max(0.6, nearest - CAMERA_PADDING);

    // Snap inward instantly (never clip through a wall), ease back out smoothly.
    cameraDistance.current =
      allowed < cameraDistance.current
        ? allowed
        : THREE.MathUtils.lerp(cameraDistance.current, allowed, 1 - Math.exp(-10 * delta));

    camera.position.copy(_camTarget).addScaledVector(_v1, cameraDistance.current);
    // Orientation comes straight from yaw/pitch rather than looking back at the
    // body. Looking *at* the player would tilt the view by however far the boom
    // is offset, which would put the crosshair somewhere the player is not
    // aiming; this way screen centre is exactly the aim direction, and moving
    // the camera is moving the player's view.
    camera.rotation.set(pitch.current, yaw.current, 0);

    // ---------------------------------------------------------- network
    const now = performance.now();
    if (now - lastSendTime.current > 1000 / CLIENT_SEND_HZ) {
      lastSendTime.current = now;
      sendState({
        p: { x: pos.x, y: pos.y - FEET_OFFSET, z: pos.z },
        v: { x: vel.x, y: vel.y, z: vel.z },
        yaw: yaw.current,
        pitch: pitch.current,
        swinging: attached.current,
        grounded: grounded.current,
        anchor: attached.current
          ? {
              x: anchorPoint.current.x,
              y: anchorPoint.current.y,
              z: anchorPoint.current.z,
            }
          : undefined,
      });
    }

    // Track the pickup underfoot for the HUD prompt.
    const nearId = nearestPickupId(pos.x, pos.y - FEET_OFFSET, pos.z);
    const store = useGame.getState();
    if ((store.nearbyPickup?.id ?? null) !== nearId) {
      store.setNearbyPickup(world.pickups.find((p) => p.id === nearId) ?? null);
    }
    store.expire(now);

    clearEdges();
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={[0, 60, 0]}
        mass={1}
        lockRotations
        // Zero damping: the pendulum must not bleed energy, or chained swings
        // would lose height instead of building speed.
        linearDamping={0}
        angularDamping={0}
        friction={0.2}
        restitution={0}
        ccd
      >
        <CapsuleCollider args={[PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} />
        <object3D ref={visual} />
      </RigidBody>

      {/* The visual body is decoupled from the collider so it can be posed freely. */}
      <group ref={modelRef}>
        <Character
          color={color}
          weapon={inHand}
          getSpeed={() => {
            const rb = body.current;
            if (!rb) return 0;
            const v = rb.linvel();
            return Math.hypot(v.x, v.z);
          }}
          getSwinging={() => attached.current}
          getGrounded={() => grounded.current}
          getInvuln={() => useGame.getState().self.invuln}
          getPitch={() => pitch.current}
          getFireAge={() => (performance.now() - lastFireTime.current) / 1000}
        />
      </group>

      <WebRope
        active={() => attached.current}
        from={(v) => {
          const rb = body.current;
          if (!rb) return;
          const p = rb.translation();
          v.set(p.x, p.y + 0.25, p.z);
        }}
        to={(v) => v.copy(anchorPoint.current)}
      />
    </>
  );
}
