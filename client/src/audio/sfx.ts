/**
 * All sound is synthesised at runtime with the Web Audio API — no licensed or
 * downloaded assets. Each weapon gets a distinct timbre so players can identify
 * what is being fired by ear.
 */

import type { WeaponId } from '@shared/constants';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Browsers require a user gesture before audio can start. */
export function initAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // One second of white noise, reused as the source for every percussive sound.
  const length = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
}

export function setVolume(v: number): void {
  if (master) master.gain.value = v;
}

function now(): number {
  return ctx?.currentTime ?? 0;
}

/** A pitched tone with an exponential decay envelope. */
function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  freqEnd?: number
): void {
  if (!ctx || !master) return;
  const t = now();
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Filtered noise burst — the backbone of gunshots, impacts and explosions. */
function noise(
  duration: number,
  gain: number,
  filterType: BiquadFilterType,
  freq: number,
  freqEnd?: number,
  q = 1
): void {
  if (!ctx || !master || !noiseBuffer) return;
  const t = now();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, t);
  filter.Q.value = q;
  if (freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(env).connect(master);
  src.start(t);
  src.stop(t + duration + 0.02);
}

// --- swing loop: a continuous filtered-noise "wind" while a web is attached ---
let swingSource: AudioBufferSourceNode | null = null;
let swingGain: GainNode | null = null;

function startSwingLoop(): void {
  if (!ctx || !master || !noiseBuffer || swingSource) return;
  const t = now();
  swingSource = ctx.createBufferSource();
  swingSource.buffer = noiseBuffer;
  swingSource.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 620;
  filter.Q.value = 0.8;
  swingGain = ctx.createGain();
  swingGain.gain.setValueAtTime(0.0001, t);
  swingGain.gain.exponentialRampToValueAtTime(0.09, t + 0.18);
  swingSource.connect(filter).connect(swingGain).connect(master);
  swingSource.start(t);
}

function stopSwingLoop(): void {
  if (!swingSource || !swingGain || !ctx) return;
  const t = now();
  const src = swingSource;
  const env = swingGain;
  // Detach first: whatever happens below, this loop is no longer the live one,
  // so a stray failure can never strand a looping source with no way to stop it.
  swingSource = null;
  swingGain = null;
  // An exponential ramp from exactly zero never moves, hence the floor.
  env.gain.cancelScheduledValues(t);
  env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  // Stop slightly after the fade so it never clicks, and hard-mute on end in
  // case the ramp was still audible.
  env.gain.setValueAtTime(0, t + 0.12);
  src.stop(t + 0.14);
}

// --- footsteps ---
let lastFootstep = 0;

export const sfx = {
  shoot(weapon: WeaponId): void {
    switch (weapon) {
      case 'pistol':
        noise(0.09, 0.42, 'highpass', 1400, 500);
        tone(320, 0.07, 'square', 0.14, 90);
        break;
      case 'm16a4':
        // Tighter, snappier crack than the M416.
        noise(0.07, 0.44, 'bandpass', 2200, 800, 1.4);
        tone(420, 0.05, 'sawtooth', 0.12, 130);
        break;
      case 'm416':
        // Flatter and buzzier, so a spray is audibly different from a burst.
        noise(0.06, 0.34, 'highpass', 1000, 420);
        tone(240, 0.05, 'sawtooth', 0.11, 80);
        break;
      case 'shotgun':
        noise(0.28, 0.62, 'lowpass', 2200, 240);
        tone(120, 0.22, 'square', 0.2, 45);
        break;
      case 'grenadeLauncher':
        tone(180, 0.16, 'sine', 0.28, 70);
        noise(0.12, 0.24, 'lowpass', 800, 200);
        break;
      case 'rocketLauncher':
        noise(0.55, 0.5, 'lowpass', 1600, 180);
        tone(90, 0.5, 'sawtooth', 0.24, 40);
        break;
      case 'stones':
        noise(0.08, 0.16, 'bandpass', 900, 500);
        break;
      case 'gloves':
        // Melee whoosh, no report.
        noise(0.14, 0.2, 'bandpass', 700, 260, 0.7);
        break;
      default:
        noise(0.08, 0.3, 'highpass', 1200, 400);
    }
  },

  explosion(): void {
    noise(0.75, 0.75, 'lowpass', 900, 60);
    tone(70, 0.6, 'sine', 0.35, 28);
    tone(140, 0.3, 'square', 0.16, 40);
  },

  hitMarker(): void {
    tone(1500, 0.06, 'square', 0.16, 1100);
  },

  takeDamage(): void {
    noise(0.16, 0.32, 'lowpass', 500, 120);
    tone(180, 0.14, 'sawtooth', 0.14, 90);
  },

  meleeHit(): void {
    noise(0.12, 0.4, 'lowpass', 900, 180);
    tone(200, 0.1, 'square', 0.2, 70);
  },

  webAttach(): void {
    tone(900, 0.11, 'triangle', 0.2, 260);
    noise(0.09, 0.16, 'highpass', 2200, 900);
  },

  webRelease(): void {
    tone(420, 0.07, 'triangle', 0.1, 200);
  },

  webMiss(): void {
    // Deliberately subtle: a miss should be felt, not announced.
    tone(220, 0.06, 'sine', 0.05, 160);
  },

  swingLoop(on: boolean): void {
    if (on) startSwingLoop();
    else stopSwingLoop();
  },

  jump(): void {
    tone(360, 0.08, 'sine', 0.08, 520);
  },

  land(): void {
    noise(0.13, 0.24, 'lowpass', 420, 110);
  },

  footstep(): void {
    const t = performance.now();
    if (t - lastFootstep < 300) return;
    lastFootstep = t;
    noise(0.06, 0.09, 'lowpass', 380, 150);
  },

  death(): void {
    tone(300, 0.5, 'sawtooth', 0.22, 55);
    noise(0.4, 0.24, 'lowpass', 700, 90);
  },

  pickupWeapon(): void {
    tone(520, 0.07, 'square', 0.13);
    setTimeout(() => tone(780, 0.09, 'square', 0.13), 60);
  },

  pickupHealth(): void {
    tone(660, 0.09, 'sine', 0.16);
    setTimeout(() => tone(990, 0.12, 'sine', 0.14), 70);
  },

  pickupShield(): void {
    tone(440, 0.12, 'triangle', 0.16);
    setTimeout(() => tone(660, 0.14, 'triangle', 0.14), 80);
  },

  switchWeapon(): void {
    tone(700, 0.05, 'square', 0.09, 900);
  },

  reload(): void {
    tone(300, 0.05, 'square', 0.1);
    setTimeout(() => tone(220, 0.06, 'square', 0.1), 110);
  },

  joi