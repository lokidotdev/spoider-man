import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '@shared/constants';

/**
 * Held weapons, built from primitives like everything else in the game. Each
 * model is authored with the **grip at the origin and the barrel running down
 * +Z**, so the hand can hold it without per-weapon fudge factors, and the
 * silhouette matches the pickup lying on the roof it came from.
 */

/** Distance from the grip to the muzzle, per weapon — where the flash goes. */
export const MUZZLE_Z: Record<WeaponId, number> = {
  pistol: 0.23,
  m16a4: 0.77,
  m416: 0.59,
  shotgun: 0.68,
  grenadeLauncher: 0.5,
  rocketLauncher: 0.72,
  stones: 0,
  gloves: 0,
};

// Materials are shared across every instance: five players holding pistols
// should not mean five copies of the same shader program.
const cache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
    cache.set(key, m);
  }
  return m;
}

const steel = () => mat('#33373f', 0.42, 0.75);
const dark = () => mat('#20232a', 0.75, 0.15);
const wood = () => mat('#6b4a32', 0.7, 0.05);
const shell = (color: string) => mat(color, 0.55, 0.35);

/** Pistol grip and trigger housing, shared by everything with a trigger. */
function Grip({ z = -0.02, tilt = 0.3, height = 0.17 }: { z?: number; tilt?: number; height?: number }) {
  return (
    <mesh position={[0, -height / 2 + 0.02, z]} rotation={[tilt, 0, 0]} material={dark()} castShadow>
      <boxGeometry args={[0.055, height, 0.075]} />
    </mesh>
  );
}

function Pistol() {
  const body = shell(WEAPONS.pistol.color);
  return (
    <group>
      {/* Slide */}
      <mesh position={[0, 0.075, 0.1]} material={body} castShadow>
        <boxGeometry args={[0.055, 0.075, 0.26]} />
      </mesh>
      {/* Frame under the slide */}
      <mesh position={[0, 0.025, 0.06]} material={steel()} castShadow>
        <boxGeometry args={[0.05, 0.05, 0.17]} />
      </mesh>
      <Grip height={0.15} />
    </group>
  );
}

function M16A4() {
  const body = shell(WEAPONS.m16a4.color);
  return (
    <group>
      {/* Receiver */}
      <mesh position={[0, 0.075, 0.1]} material={body} castShadow>
        <boxGeometry args={[0.06, 0.085, 0.34]} />
      </mesh>
      {/* Carry handle — the M16's most recognisable line */}
      <mesh position={[0, 0.135, 0.05]} material={body} castShadow>
        <boxGeometry args={[0.04, 0.045, 0.19]} />
      </mesh>
      {/* Handguard and barrel */}
      <mesh position={[0, 0.075, 0.4]} material={dark()} castShadow>
        <boxGeometry args={[0.055, 0.06, 0.28]} />
      </mesh>
      <mesh position={[0, 0.075, 0.62]} rotation={[Math.PI / 2, 0, 0]} material={steel()} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.3, 8]} />
      </mesh>
      {/* Front sight post */}
      <mesh position={[0, 0.125, 0.54]} material={steel()} castShadow>
        <boxGeometry args={[0.02, 0.05, 0.03]} />
      </mesh>
      {/* Magazine */}
      <mesh position={[0, -0.03, 0.13]} rotation={[-0.12, 0, 0]} material={dark()} castShadow>
        <boxGeometry args={[0.04, 0.17, 0.07]} />
      </mesh>
      {/* Fixed stock */}
      <mesh position={[0, 0.06, -0.19]} material={body} castShadow>
        <boxGeometry args={[0.055, 0.1, 0.24]} />
      </mesh>
      <Grip />
    </group>
  );
}

function M416() {
  const body = shell(WEAPONS.m416.color);
  return (
    <group>
      <mesh position={[0, 0.075, 0.08]} material={body} castShadow>
        <boxGeometry args={[0.06, 0.085, 0.3]} />
      </mesh>
      {/* Optic rail instead of a carry handle */}
      <mesh position={[0, 0.125, 0.1]} material={dark()} castShadow>
        <boxGeometry args={[0.035, 0.02, 0.26]} />
      </mesh>
      <mesh position={[0, 0.135, 0.14]} material={steel()} castShadow>
        <boxGeometry args={[0.045, 0.045, 0.08]} />
      </mesh>
      {/* Rail handguard */}
      <mesh position={[0, 0.075, 0.35]} material={dark()} castShadow>
        <boxGeometry args={[0.05, 0.055, 0.24]} />
      </mesh>
      <mesh position={[0, 0.075, 0.52]} rotation={[Math.PI / 2, 0, 0]} material={steel()} castShadow>
        <cylinderGeometry args={[0.013, 0.013, 0.14, 8]} />
      </mesh>
      <mesh position={[0, -0.03, 0.11]} rotation={[-0.1, 0, 0]} material={dark()} castShadow>
        <boxGeometry args={[0.042, 0.18, 0.075]} />
      </mesh>
      {/* Collapsible stock: thinner, with a visible tube */}
      <mesh position={[0, 0.07, -0.14]} material={steel()} castShadow>
        <boxGeometry args={[0.028, 0.035, 0.16]} />
      </mesh>
      <mesh position={[0, 0.06, -0.23]} material={body} castShadow>
        <boxGeometry args={[0.05, 0.1, 0.09]} />
      </mesh>
      <Grip />
    </group>
  );
}

function Shotgun() {
  const body = shell(WEAPONS.shotgun.color);
  return (
    <group>
      {/* Receiver */}
      <mesh position={[0, 0.075, 0.09]} material={steel()} castShadow>
        <boxGeometry args={[0.06, 0.085, 0.24]} />
      </mesh>
      {/* Fat barrel over a magazine tube */}
      <mesh position={[0, 0.095, 0.44]} rotation={[Math.PI / 2, 0, 0]} material={steel()} castShadow>
        <cylinderGeometry args={[0.026, 0.026, 0.48, 10]} />
      </mesh>
      <mesh position={[0, 0.04, 0.4]} rotation={[Math.PI / 2, 0, 0]} material={steel()} castShadow>
        <cylinderGeometry args={[0.019, 0.019, 0.38, 8]} />
      </mesh>
      {/* Pump — the shotgun's tell */}
      <mesh position={[0, 0.045, 0.32]} material={wood()} castShadow>
        <boxGeometry args={[0.07, 0.06, 0.14]} />
      </mesh>
      {/* Wooden stock, straight through to the shoulder */}
      <mesh position={[0, 0.045, -0.16]} rotation={[0.1, 0, 0]} material={wood()} castShadow>
        <boxGeometry args={[0.06, 0.11, 0.28]} />
      </mesh>
      <Grip z={0} tilt={0.45} height={0.13} />
      <mesh position={[0, -0.005, 0.09]} material={body} castShadow>
        <boxGeometry args={[0.065, 0.07, 0.12]} />
      </mesh>
    </group>
  );
}

function GrenadeLauncher() {
  const body = shell(WEAPONS.grenadeLauncher.color);
  return (
    <group>
      {/* Wide, stubby bore */}
      <mesh position={[0, 0.085, 0.34]} rotation={[Math.PI / 2, 0, 0]} material={body} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.32, 12]} />
      </mesh>
      <mesh position={[0, 0.085, 0.49]} rotation={[Math.PI / 2, 0, 0]} material={dark()} castShadow>
        <cylinderGeometry args={[0.052, 0.052, 0.04, 12]} />
      </mesh>
      {/* Revolver drum */}
      <mesh position={[0, 0.075, 0.11]} rotation={[Math.PI / 2, 0, 0]} material={steel()} castShadow>
        <cylinderGeometry args={[0.085, 0.085, 0.16, 10]} />
      </mesh>
      <mesh position={[0, 0.075, -0.03]} material={body} castShadow>
        <boxGeometry args={[0.07, 0.09, 0.14]} />
      </mesh>
      {/* Ladder sight */}
      <mesh position={[0, 0.16, 0.24]} material={dark()} castShadow>
        <boxGeometry args={[0.02, 0.07, 0.02]} />
      </mesh>
      <mesh position={[0, 0.02, -0.12]} rotation={[0.2, 0, 0]} material={body} castShadow>
        <boxGeometry args={[0.055, 0.1, 0.18]} />
      </mesh>
      <Grip z={0.01} />
    </group>
  );
}

function RocketLauncher() {
  const body = shell(WEAPONS.rocketLauncher.color);
  return (
    <group>
      {/* Full-length shoulder tube, open at both ends */}
      <mesh position={[0, 0.085, 0.24]} rotation={[Math.PI / 2, 0, 0]} material={body} castShadow>
        <cylinderGeometry args={[0.062, 0.062, 0.94, 12, 1, true]} />
      </mesh>
      {/* Blast cone at the rear */}
      <mesh position={[0, 0.085, -0.28]} rotation={[-Math.PI / 2, 0, 0]} material={dark()} castShadow>
        <coneGeometry args={[0.085, 0.16, 12, 1, true]} />
      </mesh>
      {/* Warhead sitting in the tube */}
      <mesh position={[0, 0.085, 0.64]} rotation={[Math.PI / 2, 0, 0]} material={dark()} castShadow>
        <coneGeometry args={[0.05, 0.16, 10]} />
      </mesh>
      {/* Optical sight on the side, and the shoulder rest */}
      <mesh position={[0.075, 0.13, 0.18]} material={dark()} castShadow>
        <boxGeometry args={[0.05, 0.06, 0.14]} />
      </mesh>
      <mesh position={[0, 0.015, -0.12]} material={dark()} castShadow>
        <boxGeometry args={[0.07, 0.05, 0.2]} />
      </mesh>
      <Grip z={0.06} />
    </group>
  );
}

/** A rock, held ready to throw. Lumpy on purpose — no two look machined. */
function Stone() {
  return (
    <mesh position={[0, 0.02, 0.04]} rotation={[0.4, 0.7, 0.2]} material={mat('#8a8577', 0.95, 0)} castShadow>
      <dodecahedronGeometry args={[0.085, 0]} />
    </mesh>
  );
}

/** Renders whatever the player is holding, or nothing for bare fists. */
export function WeaponModel({ id }: { id: WeaponId | null }) {
  switch (id) {
    case 'pistol':
      return <Pistol />;
    case 'm16a4':
      return <M16A4 />;
    case 'm416':
      return <M416 />;
    case 'shotgun':
      return <Shotgun />;
    case 'grenadeLauncher':
      return <GrenadeLauncher />;
    case 'rocketLauncher':
      return <RocketLauncher />;
    case 'stones':
      return <Stone />;
    default:
      return null;
  }
}

/** True for weapons the off hand should be supporting rather than hanging free. */
export function isTwoHanded(id: WeaponId | null): boolean {
  return (
    id === 'm16a4' || id === 'm416' || id === 'shotgun' || id === 'grenadeLauncher' || id === 'rocketLauncher'
  );
}
