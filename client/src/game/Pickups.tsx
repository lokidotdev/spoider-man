import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WEAPONS, type PickupType } from '@shared/constants';
import type { PickupSnapshot } from '@shared/protocol';
import { world } from '../net/store';

/**
 * Pickups sit still on rooftops and only change when the server spawns or
 * removes one, so the list is polled at low frequency and rendered normally.
 * Only the bob/spin runs per frame.
 */

function pickupColor(type: PickupType): string {
  if (type === 'health') return '#4ad07a';
  if (type === 'shield') return '#4aa8d0';
  return WEAPONS[type]?.color ?? '#cccccc';
}

/** Distinct silhouette per category so type is readable from a rooftop away. */
function PickupShape({ type }: { type: PickupType }) {
  if (type === 'health') {
    return (
      <group>
        <mesh castShadow>
          <boxGeometry args={[0.52, 0.18, 0.18]} />
          <meshStandardMaterial color="#4ad07a" emissive="#2f8f52" emissiveIntensity={0.5} />
        </mesh>
        <mesh castShadow>
          <boxGeometry args={[0.18, 0.52, 0.18]} />
          <meshStandardMaterial color="#4ad07a" emissive="#2f8f52" emissiveIntensity={0.5} />
        </mesh>
      </group>
    );
  }

  if (type === 'shield') {
    return (
      <mesh castShadow>
        <octahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial
          color="#4aa8d0"
          emissive="#2b6f92"
          emissiveIntensity={0.5}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
    );
  }

  const spec = WEAPONS[type];
  const isLauncher = type === 'rocketLauncher' || type === 'grenadeLauncher';

  return (
    <group rotation={[0, 0, Math.PI / 12]}>
      {/* Barrel */}
      <mesh castShadow>
        <boxGeometry args={[isLauncher ? 0.9 : 0.68, 0.12, 0.12]} />
        <meshStandardMaterial color={spec?.color ?? '#bbb'} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Receiver */}
      <mesh position={[-0.1, -0.1, 0]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.16]} />
        <meshStandardMaterial color="#3a3f48" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Grip */}
      <mesh position={[-0.16, -0.26, 0]} castShadow>
        <boxGeometry args={[0.11, 0.24, 0.12]} />
        <meshStandardMaterial color="#2c3038" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Pickup({ data, seed }: { data: PickupSnapshot; seed: number }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.y = data.p.y + Math.sin(t * 2 + seed) * 0.14;
    g.rotation.y = t * 1.1 + seed;
  });

  return (
    <group ref={group} position={[data.p.x, data.p.y, data.p.z]}>
      <PickupShape type={data.type} />
      {/* Ground halo, so a pickup reads even when the shape is edge-on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
        <circleGeometry args={[0.75, 20]} />
        <meshBasicMaterial
          color={pickupColor(data.type)}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function Pickups() {
  const [list, setList] = useState<PickupSnapshot[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      const next = world.pickups;
      setList((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.id === next[i].id && p.type === next[i].type)
        ) {
          return prev;
        }
        // Copy: the buffer is replaced wholesale on every snapshot.
        return next.slice();
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {list.map((pk, i) => (
        <Pickup key={pk.id} data={pk} seed={i} />
      ))}
    </>
  );
}
