import { forwardRef, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { WeaponId } from '@shared/constants';
import { MUZZLE_Z, WeaponModel, isTwoHanded } from './Weapon';

/**
 * Procedural humanoid built from primitives — no imported models. Origin sits
 * at the feet so it can be dropped straight onto a capsule's base position.
 * Identity reads purely from the body colour assigned by the server.
 *
 * The arms are a real two-bone rig (shoulder -> elbow -> hand) rather than a
 * single swinging box, because the hands have to hold a weapon and point it
 * where the player is aiming. The hold angles below were solved against the
 * rig's own proportions rather than guessed, which is why the off hand lands on
 * the weapon instead of somewhere near it.
 *
 * Pose inputs are *getters*, not values: animation state changes every frame
 * and passing it as props would re-render the scene graph 60 times a second.
 * `weapon` is the exception — it changes on a pickup, not per frame, and the
 * meshes it selects have to be built by React anyway.
 */

interface Props {
  color: string;
  /** What the hands are holding. `gloves` and `null` both mean bare fists. */
  weapon: WeaponId | null;
  /** Horizontal speed in m/s, drives the run cycle. */
  getSpeed?: () => number;
  getSwinging?: () => boolean;
  getGrounded?: () => boolean;
  /** Fades the body during spawn protection. */
  getInvuln?: () => boolean;
  /** View pitch in radians, so the aim tracks where the player is looking. */
  getPitch?: () => number;
  /** Seconds since this player last fired; Infinity if they never have. */
  getFireAge?: () => number;
}

const HALF_PI = Math.PI / 2;

// Rig proportions. The shoulders are deliberately narrower than the torso and
// the arms a little long: with a wider stance the off hand cannot physically
// reach across to the weapon, and a two-handed grip becomes impossible.
const SHOULDER_X = 0.22;
const SHOULDER_Y = 1.1;
const UPPER_ARM = 0.28;
const FOREARM = 0.28;

/** How long the melee swing and the stone throw take, in seconds. */
const PUNCH_TIME = 0.3;
const THROW_TIME = 0.42;
/** Muzzle flash lifetime. */
const FLASH_TIME = 0.055;

/** Shoulder-x, shoulder-z, elbow-x for each arm. */
interface Pose {
  rsx: number;
  rsz: number;
  rex: number;
  lsx: number;
  lsz: number;
  lex: number;
}

/**
 * Weapon up, both hands on it. The right shoulder's Z rotation is deliberately
 * zero: with the weapon arm a pure chain of X rotations, the barrel correction
 * below is exact, and the gun points precisely where the crosshair does. Any
 * sideways lean at the shoulder would throw the muzzle off by several degrees.
 */
const HOLD_GUN: Pose = {
  rsx: -0.336,
  rsz: 0,
  rex: -2.164,
  lsx: -0.752,
  lsz: 1.076,
  lex: -0.789,
};

/** Boxer's guard: fists up at the chin, close enough in that a punch has travel. */
const HOLD_FISTS: Pose = {
  rsx: -1.176,
  rsz: -0.229,
  rex: -2.128,
  lsx: -1.176,
  lsz: 0.229,
  lex: -2.128,
};

/** Stone cocked back past the ear. */
const HOLD_STONE: Pose = {
  rsx: -2.606,
  rsz: 0.213,
  rex: -1.726,
  lsx: -0.807,
  lsz: 0,
  lex: -1.82,
};

/** Hanging from the web, both arms overhead. */
const HOLD_SWING: Pose = {
  rsx: -2.5,
  rsz: 0.2,
  rex: -0.15,
  lsx: -2.5,
  lsz: -0.2,
  lex: -0.15,
};

/**
 * Scratch for the frame's target pose. Safe to share between characters: it is
 * overwritten in full and consumed before the next instance runs. The *damped*
 * pose is per-instance state and lives in a ref, or five players would blend
 * into each other's arms.
 */
const pose: Pose = { ...HOLD_FISTS };
const POSE_KEYS = Object.keys(pose) as (keyof Pose)[];

/**
 * Arms hang down local -Y, so a total X rotation of -PI/2 through the chain
 * points the limb along local +Z — which the parent group has aligned with the
 * view direction. Subtracting pitch on top follows the aim up and down.
 */
function aimAngle(pitch: number): number {
  return -HALF_PI - pitch;
}

/** Strike envelope: out fast, recover slower. Zero outside the window. */
function strike(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return t < 0.3 ? smooth(t / 0.3) : 1 - smooth((t - 0.3) / 0.7);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export const Character = forwardRef<THREE.Group, Props>(function Character(
  { color, weapon, getSpeed, getSwinging, getGrounded, getInvuln, getPitch, getFireAge },
  ref
) {
  const leftLeg = useRef<THREE.Mesh>(null);
  const rightLeg = useRef<THREE.Mesh>(null);
  const rightShoulder = useRef<THREE.Group>(null);
  const leftShoulder = useRef<THREE.Group>(null);
  const rightElbow = useRef<THREE.Group>(null);
  const leftElbow = useRef<THREE.Group>(null);
  const mount = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const phase = useRef(0);
  const wasInvuln = useRef(false);
  const posed = useRef(false);
  const held = useRef<Pose>({ ...HOLD_FISTS });

  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.55,
        metalness: 0.05,
      }),
    [color]
  );

  const darkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.45),
        roughness: 0.7,
      }),
    [color]
  );

  // Bare fists are the melee weapon, so they get padded knuckles in the glove
  // colour — the one cue that says "this player is in a fist fight".
  const gloveMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#b03a3a', roughness: 0.65 }),
    []
  );

  const gloved = weapon === null || weapon === 'gloves';
  const holdingGun = !gloved && weapon !== 'stones';

  useFrame((_, delta) => {
    const invuln = getInvuln?.() ?? false;
    // Only touch the materials on a transition; flipping `transparent` every
    // frame would force a shader recompile.
    if (invuln !== wasInvuln.current) {
      wasInvuln.current = invuln;
      for (const mat of [bodyMat, darkMat, gloveMat]) {
        mat.transparent = invuln;
        mat.opacity = invuln ? 0.5 : 1;
        mat.needsUpdate = true;
      }
    }

    const swinging = getSwinging?.() ?? false;
    const grounded = getGrounded?.() ?? true;
    const speed = getSpeed?.() ?? 0;
    const pitch = THREE.MathUtils.clamp(getPitch?.() ?? 0, -1.2, 1.2);
    const age = getFireAge?.() ?? Infinity;

    // ------------------------------------------------------------------ legs
    if (swinging || !grounded) {
      // Airborne: legs trail behind rather than running in mid-air.
      if (leftLeg.current) leftLeg.current.rotation.x = damp(leftLeg.current.rotation.x, 0.35, delta);
      if (rightLeg.current) rightLeg.current.rotation.x = damp(rightLeg.current.rotation.x, 0.1, delta);
    } else {
      phase.current += delta * Math.min(speed, 12) * 1.6;
      const swing = Math.sin(phase.current) * Math.min(speed / 7, 1) * 0.9;
      if (leftLeg.current) leftLeg.current.rotation.x = swing;
      if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    }

    // -------------------------------------------------------------- arm pose
    const base = swinging
      ? HOLD_SWING
      : weapon === 'stones'
        ? HOLD_STONE
        : gloved
          ? HOLD_FISTS
          : HOLD_GUN;
    Object.assign(pose, base);

    // The gun pose leans with the aim so the whole upper body reads as tracking
    // a target; the exact barrel angle is corrected on the mount further down.
    if (holdingGun && !swinging) {
      pose.rsx -= pitch * 0.5;
      pose.lsx -= pitch * 0.5;
      if (!isTwoHanded(weapon)) {
        // One hand is enough for a pistol; the off hand stays looser.
        pose.lsz -= 0.12;
        pose.lex += 0.1;
      }
    }

    // Ease into the pose so switching weapons doesn't teleport the arms. The
    // very first frame snaps, or every character unfolds out of a T-pose.
    const smoothed = held.current;
    if (!posed.current) {
      posed.current = true;
      Object.assign(smoothed, pose);
    } else {
      for (const k of POSE_KEYS) smoothed[k] = damp(smoothed[k], pose[k], delta, 13);
    }

    let rsx = smoothed.rsx;
    let rsz = smoothed.rsz;
    let rex = smoothed.rex;
    let lsx = smoothed.lsx;
    const lsz = smoothed.lsz;
    let lex = smoothed.lex;

    // Barrel alignment is measured against the *resting* pose, captured before
    // recoil is layered on. Correcting against the recoiled arm instead would
    // hold the muzzle pinned to the crosshair and cancel the kick out entirely.
    const restRsx = rsx;
    const restRex = rex;

    // ------------------------------------------------------- firing, on top
    // Strikes are layered over the damped pose rather than damped themselves:
    // a punch that eases in is a shove, not a punch.
    let flashing = false;
    if (Number.isFinite(age) && !swinging) {
      const extended = aimAngle(pitch);
      if (gloved) {
        // Straight right: the arm drives out along the line of aim and back.
        const e = strike(age / PUNCH_TIME);
        rsx = THREE.MathUtils.lerp(rsx, extended + 0.06, e);
        rex = THREE.MathUtils.lerp(rex, -0.06, e);
        rsz = THREE.MathUtils.lerp(rsz, -0.04, e);
      } else if (weapon === 'stones') {
        // Overarm throw: from behind the ear through to a follow-through.
        const e = strike(age / THROW_TIME);
        rsx = THREE.MathUtils.lerp(rsx, extended + 0.3, e);
        rex = THREE.MathUtils.lerp(rex, -0.1, e);
        rsz = THREE.MathUtils.lerp(rsz, -0.05, e);
      } else if (weapon !== null) {
        // Recoil: the muzzle climbs and settles. More negative = further up.
        const kick = Math.exp(-age * 16);
        rsx -= kick * 0.3;
        lsx -= kick * 0.22;
        rex -= kick * 0.1;
        flashing = age < FLASH_TIME;
      }
    }

    if (rightShoulder.current) {
      rightShoulder.current.rotation.x = rsx;
      rightShoulder.current.rotation.z = rsz;
    }
    if (leftShoulder.current) {
      leftShoulder.current.rotation.x = lsx;
      leftShoulder.current.rotation.z = lsz;
    }
    if (rightElbow.current) rightElbow.current.rotation.x = rex;
    if (leftElbow.current) leftElbow.current.rotation.x = lex;

    // The weapon is authored barrel-along-+Z. Laying it down the arm is a
    // quarter turn; the rest cancels out whatever the arm chain is doing, so
    // the barrel points down the line of aim no matter how the elbow is bent.
    // Without this the elbow bend alone threw the muzzle 12 degrees high.
    if (mount.current) {
      mount.current.rotation.x = holdingGun
        ? HALF_PI + aimAngle(pitch) - (restRsx + restRex)
        : HALF_PI;
    }
    if (flash.current) flash.current.visible = flashing;
  });

  const muzzle = weapon ? MUZZLE_Z[weapon] : 0;

  return (
    <group ref={ref}>
      {/* Torso */}
      <mesh position={[0, 0.95, 0]} material={bodyMat} castShadow>
        <capsuleGeometry args={[0.21, 0.34, 6, 12]} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.34, 0]} material={bodyMat} castShadow>
        <sphereGeometry args={[0.16, 16, 12]} />
      </mesh>

      {/* Eye lenses: the one non-body colour, and a readable facing cue. */}
      <mesh position={[-0.07, 1.36, 0.135]}>
        <sphereGeometry args={[0.055, 10, 8]} />
        <meshStandardMaterial color="#f2f4f8" roughness={0.25} />
      </mesh>
      <mesh position={[0.07, 1.36, 0.135]}>
        <sphereGeometry args={[0.055, 10, 8]} />
        <meshStandardMaterial color="#f2f4f8" roughness={0.25} />
      </mesh>

      {/* Right arm — the one that holds the weapon. */}
      <group ref={rightShoulder} position={[SHOULDER_X, SHOULDER_Y, 0]}>
        <mesh position={[0, -UPPER_ARM / 2, 0]} material={darkMat} castShadow>
          <boxGeometry args={[0.095, UPPER_ARM, 0.095]} />
        </mesh>
        <group ref={rightElbow} position={[0, -UPPER_ARM, 0]}>
          <mesh position={[0, -FOREARM / 2, 0]} material={darkMat} castShadow>
            <boxGeometry args={[0.085, FOREARM, 0.085]} />
          </mesh>
          {/* Hand, and everything it carries. */}
          <group position={[0, -FOREARM, 0]}>
            <mesh material={gloved ? gloveMat : darkMat} castShadow>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
            </mesh>
            <group ref={mount} rotation={[HALF_PI, 0, 0]}>
              <WeaponModel id={weapon} />
              {/* Muzzle flash, parked at the barrel tip. */}
              <mesh ref={flash} position={[0, 0.075, muzzle + 0.06]} visible={false}>
                <coneGeometry args={[0.07, 0.16, 6]} />
                <meshBasicMaterial color="#ffdc8a" transparent opacity={0.9} depthWrite={false} />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      {/* Left arm. */}
      <group ref={leftShoulder} position={[-SHOULDER_X, SHOULDER_Y, 0]}>
        <mesh position={[0, -UPPER_ARM / 2, 0]} material={darkMat} castShadow>
          <boxGeometry args={[0.095, UPPER_ARM, 0.095]} />
        </mesh>
        <group ref={leftElbow} position={[0, -UPPER_ARM, 0]}>
          <mesh position={[0, -FOREARM / 2, 0]} material={darkMat} castShadow>
            <boxGeometry args={[0.085, FOREARM, 0.085]} />
          </mesh>
          <group position={[0, -FOREARM, 0]}>
            <mesh material={gloved ? gloveMat : darkMat} castShadow>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
            </mesh>
          </group>
        </group>
      </group>

      {/* Legs */}
      <group position={[-0.1, 0.62, 0]}>
        <mesh ref={leftLeg} position={[0, -0.31, 0]} material={darkMat} castShadow>
          <boxGeometry args={[0.12, 0.62, 0.12]} />
        </mesh>
      </group>
      <group position={[0.1, 0.62, 0]}>
        <mesh ref={rightLeg} position={[0, -0.31, 0]} material={darkMat} castShadow>
          <boxGeometry args={[0.12, 0.62, 0.12]} />
        </mesh>
      </group>
    </group>
  );
});

/** Frame-rate independent approach toward a target. */
function damp(current: number, target: number, delta: number, rate = 10): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * delta));
}
