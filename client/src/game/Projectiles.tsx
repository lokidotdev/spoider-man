import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WEAPONS } from '@shared/constants';
import { world } from '../net/store';

/**
 * Projectiles are simulated on the server; the client just draws whatever the
 * latest snapshot contains. A fixed pool is reused so a burst of grenades never
 * allocates during a frame.
 */

const POOL = 24;

// Reused every frame: this loop runs over every projectile in flight, and
// allocating vectors in it hands the GC a steady stream of garbage.
const _vel = new THREE.Vector3();
const _look = new THREE.Vector3();

export function Projectiles() {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<THREE.Mesh[]>([]);

  const shared = useMemo(
    () => ({
      rocket: new THREE.MeshStandardMaterial({
        color: '#c9542f',
        emissive: '#ff6a33',
        emissiveIntensity: 1.4,
      }),
      grenade: new THREE.MeshStandardMaterial({ color: '#4b5f3a', roughness: 0.6 }),
      stone: new THREE.MeshStandardMaterial({ color: '#8a8577', roughness: 0.95 }),
      geometry: new THREE.SphereGeometry(0.16, 10, 8),
    }),
    []
  );

  useFrame(() => {
    const list = world.projectiles;
    for (let i = 0; i < POOL; i++) {
      const mesh = meshes.current[i];
      if (!mesh) continue;
      const p = list[i];
      if (!p) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(p.p.x, p.p.y, p.p.z);

      mesh.material =
        p.weapon === 'rocketLauncher'
          ? shared.rocket
          : p.weapon === 'grenadeLauncher'
            ? shared.grenade
            : shared.stone;
      // Rockets read bigger, stones smaller.
      mesh.scale.setScalar(p.weapon === 'rocketLauncher' ? 1.6 : p.weapon === 'stones' ? 0.7 : 1.1);

      // Point along the direction of travel.
      _vel.set(p.v.x, p.v.y, p.v.z);
      if (_vel.lengthSq() > 1e-4) mesh.lookAt(_look.copy(mesh.position).add(_vel));
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) meshes.current[i] = m;
          }}
          geometry={shared.geometry}
          material={shared.stone}
          visible={false}
        />
      ))}
    </group>
  );
}
