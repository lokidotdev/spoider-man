import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface Props {
  active: () => boolean;
  from: (out: THREE.Vector3) => void;
  to: (out: THREE.Vector3) => void;
}

const SEGMENTS = 12;

/**
 * The visible web strand. Drawn as a slightly slack curve rather than a
 * straight line — the sag is cosmetic, the physics rope is rigid.
 */
export function WebRope({ active, from, to }: Props) {
  const start = useRef(new THREE.Vector3());
  const end = useRef(new THREE.Vector3());
  const sag = useRef(0);

  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3)
    );
    const material = new THREE.LineBasicMaterial({
      color: '#f4f7fb',
      transparent: true,
      opacity: 0.92,
    });
    const obj = new THREE.Line(geometry, material);
    obj.frustumCulled = false;
    return obj;
  }, []);

  useFrame((_, delta) => {
    const on = active();
    line.visible = on;
    if (!on) {
      sag.current = 0;
      return;
    }

    from(start.current);
    to(end.current);

    // Sag settles in quickly after attaching, then holds.
    sag.current = THREE.MathUtils.lerp(sag.current, 1, 1 - Math.exp(-12 * delta));
    const dist = start.current.distanceTo(end.current);
    const droop = Math.min(0.55, dist * 0.02) * sag.current;

    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const x = THREE.MathUtils.lerp(start.current.x, end.current.x, t);
      const y = THREE.MathUtils.lerp(start.current.y, end.current.y, t);
      const z = THREE.MathUtils.lerp(start.current.z, end.current.z, t);
      // Parabolic droop, zero at both ends.
      attr.setXYZ(i, x, y - Math.sin(t * Math.PI) * droop, z);
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  });

  return <primitive object={line} />;
}
