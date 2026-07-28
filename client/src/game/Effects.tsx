import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { listeners } from '../net/socket';
import { sfx } from '../audio/sfx';
import { useGame } from '../net/store';

/**
 * Transient world FX — bullet impacts and explosion blasts. Both use a fixed
 * pool driven by socket events, and also own the sound cue for each event.
 */

interface Puff {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

const IMPACT_POOL = 20;
const BLAST_POOL = 8;

export function Effects() {
  const impacts = useRef<Puff[]>([]);
  const blasts = useRef<Puff[]>([]);
  const impactIndex = useRef(0);
  const blastIndex = useRef(0);
  const lastHp = useRef(100);

  const geo = useMemo(() => new THREE.SphereGeometry(1, 12, 10), []);
  const impactMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffe4b0', transparent: true, depthWrite: false }),
    []
  );
  const blastMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff9046', transparent: true, depthWrite: false }),
    []
  );

  useEffect(() => {
    listeners.onHit = (e) => {
      const puff = impacts.current[impactIndex.current % IMPACT_POOL];
      impactIndex.current++;
      if (puff) {
        puff.mesh.position.set(e.p.x, e.p.y, e.p.z);
        puff.mesh.visible = true;
        puff.life = 0;
        puff.maxLife = 0.22;
        puff.maxScale = e.onPlayer ? 0.4 : 0.25;
      }
      if (e.onPlayer) {
        sfx.hitMarker();
        if (e.weapon === 'gloves') sfx.meleeHit();
      }
    };

    listeners.onExplosion = (e) => {
      const puff = blasts.current[blastIndex.current % BLAST_POOL];
      blastIndex.current++;
      if (puff) {
        puff.mesh.position.set(e.p.x, e.p.y, e.p.z);
        puff.mesh.visible = true;
        puff.life = 0;
        puff.maxLife = 0.5;
        puff.maxScale = e.radius;
      }
      sfx.explosion();
    };

    return () => {
      listeners.onHit = undefined;
      listeners.onExplosion = undefined;
    };
  }, []);

  // Damage-taken cue, driven off the authoritative HP the server reports.
  useEffect(() => {
    const unsub = useGame.subscribe((s) => {
      const hp = s.self.hp;
      if (hp < lastHp.current && s.self.alive) sfx.takeDamage();
      lastHp.current = hp;
    });
    return unsub;
  }, []);

  useFrame((_, delta) => {
    for (const pool of [impacts.current, blasts.current]) {
      for (const puff of pool) {
        if (!puff.mesh.visible) continue;
        puff.life += delta;
        const t = puff.life / puff.maxLife;
        if (t >= 1) {
          puff.mesh.visible = false;
          continue;
        }
        // Expand fast, fade out.
        const scale = puff.maxScale * (0.25 + 0.75 * easeOut(t));
        puff.mesh.scale.setScalar(scale);
        (puff.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
      }
    }
  });

  const register = (arr: React.MutableRefObject<Puff[]>, i: number, mat: THREE.Material) =>
    (m: THREE.Mesh | null) => {
      if (!m) return;
      // Each puff needs its own material instance so opacities animate apart.
      m.material = mat.clone();
      arr.current[i] = { mesh: m, life: 0, maxLife: 1, maxScale: 1 };
      m.visible = false;
    };

  return (
    <group>
      {Array.from({ length: IMPACT_POOL }, (_, i) => (
        <mesh key={`i${i}`} ref={register(impacts, i, impactMat)} geometry={geo} visible={false} />
      ))}
      {Array.from({ length: BLAST_POOL }, (_, i) => (
        <mesh key={`b${i}`} ref={register(blasts, i, blastMat)} geometry={geo} visible={false} />
      ))}
    </group>
  );
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
