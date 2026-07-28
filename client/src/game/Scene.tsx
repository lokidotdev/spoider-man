import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import * as THREE from 'three';
import { Lighting, World } from './World';
import { Player } from './Player';
import { RemotePlayers } from './RemotePlayers';
import { Pickups } from './Pickups';
import { Projectiles } from './Projectiles';
import { Effects } from './Effects';
import { Sky } from './Sky';
import { installInputHandlers } from './input';

/** Wires pointer lock and keyboard/mouse capture to the actual canvas element. */
function InputBridge() {
  const gl = useThree((s) => s.gl);
  useEffect(() => installInputHandlers(gl.domElement), [gl]);
  return null;
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 75, near: 0.1, far: 900, position: [0, 50, 12] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        // Cool haze tying the far buildings into the overcast sky.
        scene.fog = new THREE.Fog('#b3bcc8', 70, 340);
      }}
    >
      <InputBridge />
      <Sky />
      <Lighting />

      {/*
        Fixed timestep, deliberately not "vary". A variable step feeds the raw
        frame delta into the simulation, clamped only at half a second — so one
        stalled frame advances the world by that whole stall in a single step,
        and with gravity at -22 the player moves metres between two rendered
        frames. The camera follows the body, so it reads as the view teleporting.
        A fixed step turns the same stall into a burst of small catch-up steps
        that the rope constraint gets to act on individually.
      */}
      <Physics gravity={[0, -22, 0]} timeStep={1 / 60}>
        <World />
        <Player />
      </Physics>

      {/* Everything below is server-driven and needs no local physics body. */}
      <RemotePlayers />
      <Pickups />
      <Projectiles />
      <Effects />
    </Canvas>
  );
}
