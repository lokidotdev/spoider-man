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

/**
 * How far the marker beam runs upward. Well past the far plane in practice, so
 * it reads as going up forever from any angle a player can look from.
 */
const BEAM_HEIGHT = 500;

/**
 * Hollow glow: every layer is either an inside-out shell or an open tube, drawn
 * additively with depth writes off. The item stays fully visible through it —
 * the light reads as an aura around the pickup rather than a solid blob over it.
 */
function PickupGlow({ color, seed }: { color: string; seed: number }) {
  const shell = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Slow breathing pulse, offset per pickup so a cluster never throbs in sync.
    const pulse = 1 + Math.sin(t * 2.2 + seed * 1.7) * 0.07;
    shell.current?.scale.setScalar(pulse);
    if (ring.current) {
      ring.current.rotation.z = t * 0.9 + seed;
      ring.current.position.y = Math.sin(t * 1.6 + seed) * 0.12;
    }
  });

  return (
    <group>
      {/* Outer shell, back faces only: just the rim catches light. */}
      <mesh ref={shell}>
        <sphereGeometry args={[0.8, 20, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.17}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Faint inner haze so the centre is not a hole. */}
      <mesh>
        <sphereGeometry args={[0.44, 16, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Hovering ring: the crisp edge that makes the glow read as deliberate. */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.66, 0.018, 6, 36]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Marker beam: a straight, untapered column running to the sky. Two open
          tubes — a tight bright core inside a wider halo — so it stays legible
          against both a light facade and open sky. Never culled, since the
          bounding sphere of a 500m tube is huge but the beam is always wanted. */}
      <mesh position={[0, BEAM_HEIGHT / 2, 0]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, BEAM_HEIGHT, 16, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, BEAM_HEIGHT / 2, 0]} frustumCulled={false}>
        <cylinderGeometry args={[0.17, 0.17, BEAM_HEIGHT, 12, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Bright base flare where the beam meets the item — anchors it to the roof. */}
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.26, 0.72, 1.8, 16, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Pickup({ data, seed }: { data: PickupSnapshot; seed: number }) {
  const group = useRef<THREE.Group>(null);
  const color = pickupColor(data.type);

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
      <PickupGlow color={color} seed={seed} />
      {/* Ground halo, so a pickup reads even when the shape is edge-on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
        <circleGeometry args={[0.75, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
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
