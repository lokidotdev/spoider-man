import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Overcast sky: a vertical gradient on the inside of a large sphere, plus
 * slow-drifting cloud banding. Deliberately cool and desaturated — no sun
 * disc, no warm horizon.
 */
export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color('#8e9aab') },
          midColor: { value: new THREE.Color('#aab4c2') },
          horizonColor: { value: new THREE.Color('#c6ccd4') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 midColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPosition;

          // Cheap value noise, enough to break up the gradient into cloud banding.
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
              f.y
            );
          }

          void main() {
            vec3 dir = normalize(vWorldPosition);
            float h = clamp(dir.y, 0.0, 1.0);

            // Two-stage gradient: bright near the horizon, heavier overhead.
            vec3 base = mix(horizonColor, midColor, smoothstep(0.0, 0.35, h));
            base = mix(base, topColor, smoothstep(0.3, 0.9, h));

            // Layered cloud texture, strongest overhead where it reads best.
            vec2 uv = dir.xz / max(0.18, dir.y + 0.25) * 0.55;
            float clouds = noise(uv * 1.4) * 0.55 + noise(uv * 3.1) * 0.3 + noise(uv * 6.4) * 0.15;
            clouds = smoothstep(0.35, 0.85, clouds);

            vec3 color = mix(base, base * 0.86 + vec3(0.03), clouds * smoothstep(0.02, 0.4, h) * 0.75);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    []
  );

  return (
    <mesh material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}
