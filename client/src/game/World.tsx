import { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { ARENA_HALF_SIZE, BUILDINGS, type Building } from '@shared/world';

/**
 * Buildings are simple boxes so the client's Rapier colliders line up exactly
 * with the AABBs the server uses for line-of-sight. Character comes from
 * proportion and surface detail, not from imported geometry.
 */

/** Window grid painted into a canvas texture — cheap, and reads as a city at range. */
function useFacadeTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const cols = 8;
    const rows = 8;
    const pad = 6;
    const cw = size / cols;
    const ch = size / rows;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Overcast day: windows read as dark, slightly varied glass.
        const shade = 92 + Math.floor(Math.random() * 46);
        ctx.fillStyle = `rgb(${shade - 8}, ${shade - 2}, ${shade + 10})`;
        ctx.fillRect(x * cw + pad, y * ch + pad, cw - pad * 2, ch - pad * 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }, []);
}

function BuildingMesh({ b, facade }: { b: Building; facade: THREE.Texture }) {
  // One texture instance per building so each can repeat at its own scale
  // without the window grid stretching on taller silhouettes.
  const tex = useMemo(() => {
    const t = facade.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(b.width / 4)), Math.max(1, Math.round(b.height / 4)));
    return t;
  }, [facade, b.width, b.height]);

  return (
    <RigidBody type="fixed" colliders="cuboid" position={[b.x, b.height / 2, b.z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[b.width, b.height, b.depth]} />
        <meshStandardMaterial color={b.color} map={tex} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Roof cap: a mid-grey slab, darker than the facades so rooftops still
          read as walkable surfaces without dropping back to a dark city. */}
      <mesh position={[0, b.height / 2 + 0.06, 0]} receiveShadow>
        <boxGeometry args={[b.width + 0.3, 0.12, b.depth + 0.3]} />
        <meshStandardMaterial color="#9aa3ae" roughness={0.95} />
      </mesh>

      {/* Parapet trim around the roof edge, purely visual (collider stays a clean box). */}
      <mesh position={[0, b.height / 2 + 0.3, 0]}>
        <boxGeometry args={[b.width + 0.34, 0.55, b.depth + 0.34]} />
        <meshStandardMaterial color="#848d9a" roughness={0.9} transparent opacity={0.55} />
      </mesh>
    </RigidBody>
  );
}

/** Rooftop clutter: vents and AC units, adds scale cues without new colliders. */
function RoofProps({ b }: { b: Building }) {
  const props = useMemo(() => {
    // Deterministic per-building so props don't shuffle between renders.
    let seed = b.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const count = 2 + Math.floor(rand() * 3);
    return Array.from({ length: count }, () => ({
      x: (rand() * 2 - 1) * (b.width / 2 - 2),
      z: (rand() * 2 - 1) * (b.depth / 2 - 2),
      w: 0.8 + rand() * 1.4,
      h: 0.5 + rand() * 1.1,
      d: 0.8 + rand() * 1.4,
    }));
  }, [b]);

  return (
    <group>
      {props.map((p, i) => (
        <mesh key={i} position={[b.x + p.x, b.height + p.h / 2, b.z + p.z]} castShadow>
          <boxGeometry args={[p.w, p.h, p.d]} />
          <meshStandardMaterial color="#aab2bd" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function World() {
  const facade = useFacadeTexture();

  return (
    <group>
      {/* Ground plane: lava rules — touching it is death, handled by the controller. */}
      <RigidBody type="fixed" colliders="cuboid" position={[0, -0.5, 0]}>
        <mesh receiveShadow>
          <boxGeometry args={[ARENA_HALF_SIZE * 2, 1, ARENA_HALF_SIZE * 2]} />
          <meshStandardMaterial color="#2b303a" roughness={1} />
        </mesh>
      </RigidBody>

      {/* Faint street grid so the drop below reads as ground, not void. */}
      <gridHelper
        args={[ARENA_HALF_SIZE * 2, 40, '#3d434e', '#343a44']}
        position={[0, 0.02, 0]}
      />

      {BUILDINGS.map((b) => (
        <BuildingMesh key={b.id} b={b} facade={facade} />
      ))}
      {BUILDINGS.map((b) => (
        <RoofProps key={`props-${b.id}`} b={b} />
      ))}
    </group>
  );
}

/**
 * Overcast daylight: soft, diffused, cool blue-grey. No hard sun, no warm key.
 */
export function Lighting() {
  return (
    <>
      {/* Sky/ground hemisphere bounce carries most of the cloudy look. */}
      <hemisphereLight args={['#c3ccd8', '#4a5058', 0.95]} />
      {/* Weak, soft-shadowed key standing in for sun behind cloud. */}
      <directionalLight
        position={[38, 70, 22]}
        intensity={0.55}
        color="#dfe5ee"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
      />
      <ambientLight intensity={0.25} color="#aeb9c8" />
    </>
  );
}
