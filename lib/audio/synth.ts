// Sound beds, synthesised live with Web Audio (section 17).
//
// Every bed is built from noise and oscillators, so nothing is downloaded,
// nothing is licensed and no loop ever repeats. Each builder wires its nodes
// into `out` and may return a `tick`, called a few times a second with the
// current time, to schedule events ahead (a bird call, a wave, a roll
// of thunder, a car passing). Builders only use standard Web Audio, so they also run in an
// OfflineAudioContext for testing.

import type { AmbienceBed } from '@/lib/rpg/ambience';

export type Bed = {
  /** Schedule events from `now` up to `until` (seconds, context time). */
  tick?: (now: number, until: number) => void;
  /** Stop every source; the engine disconnects `out` itself. */
  stop: () => void;
};

export type Noise = { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };

type Kit = {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: Noise;
  random: () => number;
};

const NOISE_SECONDS = 7;

/** Three stereo noise buffers, made once per context. */
export function makeNoise(ctx: BaseAudioContext, random: () => number = Math.random): Noise {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const make = () => ctx.createBuffer(2, length, ctx.sampleRate);
  const white = make();
  const pink = make();
  const brown = make();

  for (let channel = 0; channel < 2; channel += 1) {
    const w = white.getChannelData(channel);
    const p = pink.getChannelData(channel);
    const b = brown.getChannelData(channel);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let last = 0;

    for (let i = 0; i < length; i += 1) {
      const x = random() * 2 - 1;
      w[i] = x * 0.5;
      // Paul Kellet's pink filter.
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02;
      b[i] = last * 3.5;
    }

    // Fade the seam so the loop never clicks.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (const data of [w, p, b]) {
      for (let i = 0; i < fade; i += 1) {
        const k = i / fade;
        data[length - fade + i] = data[length - fade + i] * (1 - k) + data[i] * k;
      }
    }
  }

  return { white, pink, brown };
}

// ---------------------------------------------------------------------------
// Small helpers

function between(random: () => number, low: number, high: number) {
  return low + (high - low) * random();
}

function loop(kit: Kit, buffer: AudioBuffer, sources: AudioScheduledSourceNode[]) {
  const source = kit.ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(kit.ctx.currentTime, kit.random() * NOISE_SECONDS);
  sources.push(source);
  return source;
}

function filter(kit: Kit, type: BiquadFilterType, frequency: number, q = 0.7) {
  const node = kit.ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  // Anchor the timeline so later ramps start from here.
  node.frequency.setValueAtTime(frequency, kit.ctx.currentTime);
  return node;
}

function gain(kit: Kit, value: number) {
  const node = kit.ctx.createGain();
  node.gain.value = value;
  node.gain.setValueAtTime(value, kit.ctx.currentTime);
  return node;
}

function pan(kit: Kit, value: number): AudioNode {
  if (typeof kit.ctx.createStereoPanner !== 'function') return gain(kit, 1);
  const node = kit.ctx.createStereoPanner();
  node.pan.value = value;
  return node;
}

function chain(...nodes: AudioNode[]) {
  for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** A steady noise layer: noise → filters → gain → out. */
function layer(kit: Kit, sources: AudioScheduledSourceNode[], buffer: AudioBuffer, level: number, ...filters: BiquadFilterNode[]) {
  const level_ = gain(kit, level);
  chain(loop(kit, buffer, sources), ...filters, level_, kit.out);
  return level_;
}

/**
 * Moves a parameter to a new random value now and then, smoothly. Only
 * linear ramps are chained (every browser treats those the same).
 */
function drifter(param: AudioParam, random: () => number, low: number, high: number, minSeconds: number, maxSeconds: number) {
  let next = -1;

  return (now: number, until: number) => {
    if (next < now) next = now;
    while (next < until) {
      next += between(random, minSeconds, maxSeconds);
      param.linearRampToValueAtTime(between(random, low, high), next);
    }
  };
}

/**
 * A struck-noise voice: a noise source that stays connected through a
 * band-pass and a silent gain; `hit` opens the gain for a moment. Cheap enough
 * for dozens of raindrops or crackles a second.
 */
function striker(kit: Kit, sources: AudioScheduledSourceNode[], buffer: AudioBuffer, type: BiquadFilterType, q: number, panValue: number, dest: AudioNode = kit.out): Strike {
  const band = filter(kit, type, 2000, q);
  const env = gain(kit, 0);
  chain(loop(kit, buffer, sources), band, env, pan(kit, panValue), dest);
  let busy = 0;

  return (at: number, peak: number, decay: number, frequency: number) => {
    // One hit at a time per voice, so envelopes never overlap.
    if (at < busy) return false;
    const end = at + 0.002 + decay * 3;
    band.frequency.setValueAtTime(frequency, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.gain.setValueAtTime(0, end);
    busy = end + 0.001;
    return true;
  };
}

type Strike = (at: number, peak: number, decay: number, frequency: number) => boolean;

/** Hits whichever voice is free, starting from a random one. */
function strikeAny(strikes: Strike[], random: () => number, at: number, peak: number, decay: number, frequency: number) {
  const first = Math.floor(random() * strikes.length);
  for (let i = 0; i < strikes.length; i += 1) {
    if (strikes[(first + i) % strikes.length](at, peak, decay, frequency)) return;
  }
}

/** A short tone with its own envelope (bird notes, glasses, a horn, a phone). */
function tone(
  kit: Kit,
  at: number,
  options: {
    from: number;
    to?: number;
    length: number;
    peak: number;
    pan?: number;
    type?: OscillatorType;
    attack?: number;
    vibrato?: { rate: number; depth: number };
    dest?: AudioNode;
  },
) {
  const { ctx } = kit;
  const osc = ctx.createOscillator();
  const env = gain(kit, 0);
  const end = at + options.length;
  const attack = options.attack ?? Math.min(0.015, options.length / 4);
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.from, at);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, end);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(options.peak, at + attack);
  env.gain.linearRampToValueAtTime(options.peak * 0.8, Math.max(at + attack, end - options.length * 0.4));
  env.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
  env.gain.setValueAtTime(0, end + 0.05);

  const extra: AudioScheduledSourceNode[] = [];
  if (options.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = gain(kit, options.vibrato.depth);
    lfo.frequency.value = options.vibrato.rate;
    chain(lfo, depth);
    depth.connect(osc.frequency);
    lfo.start(at);
    lfo.stop(end + 0.1);
    extra.push(lfo);
  }

  chain(osc, env, pan(kit, options.pan ?? 0), options.dest ?? kit.out);
  osc.start(at);
  osc.stop(end + 0.1);
  osc.onended = () => {
    env.disconnect();
    for (const node of extra) node.disconnect();
  };
}

/** Calls `fire(at)` at random gaps between `low` and `high` seconds. */
function every(random: () => number, low: number, high: number, fire: (at: number) => void, startAfter = 0) {
  let next = -1;

  return (now: number, until: number) => {
    if (next < 0) next = now + startAfter + between(random, 0, low);
    if (next < now) next = now + between(random, 0, low);
    while (next < until) {
      fire(next);
      next += between(random, low, high);
    }
  };
}

function ticks(...parts: Array<(now: number, until: number) => void>) {
  return (now: number, until: number) => {
    for (const part of parts) part(now, until);
  };
}

function stopper(sources: AudioScheduledSourceNode[]) {
  return () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
  };
}

// ---------------------------------------------------------------------------
// The beds

function rainLight(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const hiss = layer(kit, s, noise.white, 0.22, filter(kit, 'highpass', 1200), filter(kit, 'lowpass', 9000));
  const drops = [-0.7, -0.25, 0.25, 0.7].map((side) => striker(kit, s, noise.white, 'bandpass', 2.5, side));

  return {
    tick: ticks(
      drifter(hiss.gain, random, 0.16, 0.26, 2, 5),
      every(random, 0.03, 0.12, (at) => {
        strikeAny(drops, random, at, between(random, 0.15, 0.6), between(random, 0.01, 0.03), between(random, 2500, 7500));
      }),
    ),
    stop: stopper(s),
  };
}

function rainHeavy(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const wash = layer(kit, s, noise.pink, 0.9, filter(kit, 'highpass', 250), filter(kit, 'lowpass', 6500));
  layer(kit, s, noise.brown, 0.25, filter(kit, 'lowpass', 500));
  layer(kit, s, noise.white, 0.12, filter(kit, 'highpass', 3000));

  return { tick: drifter(wash.gain, random, 0.7, 1, 3, 7), stop: stopper(s) };
}

function storm(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const low = filter(kit, 'lowpass', 200, 0.5);
  const env = gain(kit, 0);
  chain(loop(kit, noise.brown, s), low, env, kit.out);
  const crack = striker(kit, s, noise.white, 'lowpass', 0.5, between(random, -0.4, 0.4));

  const thunder = every(random, 18, 45, (at) => {
    const near = random() < 0.3;
    const peak = near ? between(random, 0.4, 0.55) : between(random, 0.15, 0.3);
    const length = between(random, 5, 9);
    const attack = near ? 0.05 : between(random, 0.4, 1.2);
    low.frequency.setValueAtTime(near ? 1400 : 600, at);
    low.frequency.exponentialRampToValueAtTime(near ? 160 : 110, at + length * 0.6);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    // The roll: two or three swells as it dies away.
    let t = at + attack;
    for (let i = 0; i < 3 && t < at + length - 2.5; i += 1) {
      t += between(random, 0.5, 1.2);
      env.gain.linearRampToValueAtTime(peak * between(random, 0.3, 0.6), t);
      t += between(random, 0.4, 1);
      env.gain.linearRampToValueAtTime(peak * between(random, 0.5, 0.9), t);
    }
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    env.gain.setValueAtTime(0, at + length);
    if (near) crack(at, 0.3, 0.25, 4000);
  }, 3);

  return { tick: thunder, stop: stopper(s) };
}

function wind(kit: Kit, strength: 'light' | 'strong'): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const strong = strength === 'strong';
  const parts: Array<(now: number, until: number) => void> = [];

  for (const side of [-0.5, 0.5]) {
    const band = filter(kit, 'bandpass', 500, strong ? 0.9 : 1.2);
    const level = gain(kit, 0.5);
    chain(loop(kit, noise.pink, s), band, level, pan(kit, side), kit.out);
    parts.push(
      drifter(band.frequency, random, strong ? 300 : 220, strong ? 1300 : 650, strong ? 1.5 : 2.5, strong ? 4 : 6),
      drifter(level.gain, random, strong ? 0.5 : 0.25, strong ? 1.6 : 0.8, strong ? 1 : 2, strong ? 3.5 : 6),
    );
  }
  if (strong) {
    const body = layer(kit, s, noise.brown, 0.5, filter(kit, 'lowpass', 300));
    parts.push(drifter(body.gain, random, 0.3, 0.8, 1.5, 4));
  }

  return { tick: ticks(...parts), stop: stopper(s) };
}

function snowQuiet(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const hush = layer(kit, s, kit.noise.brown, 0.25, filter(kit, 'lowpass', 260));
  layer(kit, s, kit.noise.pink, 0.02, filter(kit, 'bandpass', 3000, 0.5));
  return { tick: drifter(hush.gain, kit.random, 0.15, 0.3, 4, 9), stop: stopper(s) };
}

type Species = (at: number, side: number) => number;

/** A handful of birds for a park or a garden, each with its own song. */
function makeSpecies(kit: Kit): Species[] {
  const { random } = kit;
  const chirper = (base: number): Species => (at, side) => {
    const count = 2 + Math.floor(random() * 5);
    let t = at;
    for (let i = 0; i < count; i += 1) {
      const f = base * between(random, 0.95, 1.05);
      tone(kit, t, { from: f, to: f * between(random, 1.25, 1.5), length: between(random, 0.05, 0.08), peak: 0.12, pan: side });
      t += between(random, 0.08, 0.14);
    }
    return t - at;
  };
  const whistler = (high: number, low: number): Species => (at, side) => {
    const repeats = 2 + Math.floor(random() * 2);
    let t = at;
    for (let i = 0; i < repeats; i += 1) {
      tone(kit, t, { from: high, to: high * 0.97, length: 0.14, peak: 0.1, pan: side, attack: 0.02 });
      tone(kit, t + 0.17, { from: low, to: low * 0.95, length: 0.16, peak: 0.09, pan: side, attack: 0.02 });
      t += 0.42;
    }
    return t - at;
  };
  const warbler = (base: number): Species => (at, side) => {
    const length = between(random, 0.6, 1.3);
    tone(kit, at, { from: base, to: base * between(random, 0.85, 1.2), length, peak: 0.07, pan: side, attack: 0.05, vibrato: { rate: between(random, 9, 16), depth: between(random, 250, 550) } });
    return length;
  };
  const dove = (base: number): Species => (at, side) => {
    tone(kit, at, { from: base, to: base * 0.92, length: 0.45, peak: 0.08, pan: side, type: 'sine', attack: 0.08 });
    tone(kit, at + 0.6, { from: base * 0.88, to: base * 0.8, length: 0.6, peak: 0.07, pan: side, type: 'sine', attack: 0.1 });
    return 1.3;
  };

  return [
    chirper(between(random, 2800, 4200)),
    whistler(between(random, 3000, 3600), between(random, 2300, 2700)),
    warbler(between(random, 2200, 3000)),
    random() < 0.6 ? dove(between(random, 420, 560)) : chirper(between(random, 4500, 5500)),
  ];
}

/** Birds in a park, a garden or a quiet street, and leaves moving. */
function birds(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const leaves = layer(kit, s, noise.pink, 0.08, filter(kit, 'bandpass', 2500, 0.6));
  const species = makeSpecies(kit);
  // Each bird sits somewhere and keeps to its spot.
  const seats = species.map(() => between(random, -0.85, 0.85));

  return {
    tick: ticks(
      drifter(leaves.gain, random, 0.03, 0.12, 2, 5),
      every(random, 0.7, 3.5, (at) => {
        const which = Math.floor(random() * species.length);
        species[which](at, seats[which]);
      }),
    ),
    stop: stopper(s),
  };
}

function sea(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  layer(kit, s, noise.brown, 0.3, filter(kit, 'lowpass', 350));
  // Two lines of waves, each breaking, drawing back, then coming in again.
  const waves = [-0.4, 0.4].map((side, index) => {
    const low = filter(kit, 'lowpass', 350, 0.5);
    const env = gain(kit, 0.06);
    chain(loop(kit, noise.pink, s), low, env, pan(kit, side), kit.out);
    let next = -1;

    return (now: number, until: number) => {
      if (next < now) next = now + between(random, 0, 1.5) + index * between(random, 3, 5);
      while (next < until) {
        const rise = between(random, 2, 3.5);
        const fall = between(random, 3.5, 6);
        low.frequency.setValueAtTime(350, next);
        low.frequency.linearRampToValueAtTime(between(random, 1500, 2600), next + rise);
        low.frequency.linearRampToValueAtTime(350, next + rise + fall);
        env.gain.setValueAtTime(0.06, next);
        env.gain.linearRampToValueAtTime(between(random, 0.6, 1), next + rise);
        env.gain.linearRampToValueAtTime(0.06, next + rise + fall);
        next += rise + fall + between(random, 0.3, 2.5);
      }
    };
  });
  const swell = ticks(...waves);

  return { tick: swell, stop: stopper(s) };
}

function voices(kit: Kit, s: AudioScheduledSourceNode[], count: number, dest: AudioNode) {
  const { random } = kit;
  return Array.from({ length: count }, () => {
    const formant = filter(kit, 'bandpass', between(random, 450, 1300), 3.5);
    const env = gain(kit, 0);
    chain(loop(kit, kit.noise.pink, s), formant, env, pan(kit, between(random, -0.8, 0.8)), dest);
    let next = -1;
    return (now: number, until: number) => {
      if (next < now) next = now + between(random, 0, 3);
      while (next < until) {
        // A phrase: syllables at speech rate, then a pause.
        const syllables = 4 + Math.floor(random() * 16);
        let t = next;
        env.gain.setValueAtTime(0, t);
        formant.frequency.setValueAtTime(between(random, 400, 1400), t);
        for (let i = 0; i < syllables; i += 1) {
          const length = between(random, 0.1, 0.24);
          env.gain.linearRampToValueAtTime(between(random, 0.3, 1), t + 0.03);
          env.gain.linearRampToValueAtTime(between(random, 0, 0.15), t + length);
          formant.frequency.linearRampToValueAtTime(between(random, 400, 1400), t + length);
          t += length;
        }
        env.gain.linearRampToValueAtTime(0, t + 0.05);
        next = t + 0.05 + between(random, 0.8, 5);
      }
    };
  });
}

/** A city street on foot: people talking as they pass, footsteps, a shop door. */
function street(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { random } = kit;
  const distance = filter(kit, 'lowpass', 1500);
  const level = gain(kit, 0.6);
  chain(distance, level, kit.out);
  const steps = striker(kit, s, kit.noise.brown, 'lowpass', 0.7, between(random, -0.5, 0.5));
  const knocks = striker(kit, s, kit.noise.white, 'bandpass', 9, between(random, -0.7, 0.7));

  return {
    tick: ticks(
      ...voices(kit, s, 6, distance),
      // Someone walking past.
      every(random, 6, 18, (at) => {
        const count = 4 + Math.floor(random() * 8);
        const pace = between(random, 0.45, 0.6);
        for (let i = 0; i < count; i += 1) steps(at + i * pace, 0.5, 0.05, between(random, 350, 600));
      }),
      // A shop door, a shutter, a bike being locked.
      every(random, 3, 12, (at) => knocks(at, between(random, 0.3, 0.7), 0.04, between(random, 700, 1300))),
    ),
    stop: stopper(s),
  };
}

/** Voices in a café, a restaurant or a party: talk and a cup set down. */
function crowd(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { random } = kit;
  const room = filter(kit, 'lowpass', 1100);
  const level = gain(kit, 0.5);
  chain(room, level, kit.out);

  return {
    tick: ticks(
      ...voices(kit, s, 5, room),
      // A cup set down.
      every(random, 4, 14, (at) => {
        const f = between(random, 1800, 2600);
        const side = between(random, -0.6, 0.6);
        tone(kit, at, { from: f, length: 0.25, peak: 0.03, pan: side, attack: 0.002 });
        tone(kit, at, { from: f * 2.7, length: 0.15, peak: 0.015, pan: side, attack: 0.002 });
      }),
    ),
    stop: stopper(s),
  };
}

function fire(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const roar = layer(kit, s, noise.brown, 0.5, filter(kit, 'lowpass', 380));
  const hiss = layer(kit, s, noise.pink, 0.05, filter(kit, 'bandpass', 1400, 0.5));
  const cracks = [-0.3, 0, 0.3].map((side) => striker(kit, s, noise.white, 'bandpass', 1.5, side));
  const pop = striker(kit, s, noise.white, 'bandpass', 2, 0);

  return {
    tick: ticks(
      drifter(roar.gain, random, 0.3, 0.6, 0.3, 1.2),
      drifter(hiss.gain, random, 0.02, 0.07, 0.5, 2),
      // Crackles come in little clusters.
      every(random, 0.15, 0.9, (at) => {
        const count = 1 + Math.floor(random() * 5);
        for (let i = 0; i < count; i += 1) {
          strikeAny(cracks, random, at + i * 0.04 + between(random, 0, 0.03), between(random, 0.3, 1), between(random, 0.004, 0.012), between(random, 2000, 6500));
        }
      }),
      every(random, 3, 9, (at) => pop(at, between(random, 0.6, 1.1), 0.03, between(random, 600, 1100))),
    ),
    stop: stopper(s),
  };
}

/** A city street: a low traffic rumble, cars passing left to right, a horn now and then. */
function traffic(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { ctx, noise, random } = kit;
  const rumble = layer(kit, s, noise.brown, 0.35, filter(kit, 'lowpass', 220));
  const pass = filter(kit, 'bandpass', 500, 0.6);
  const env = gain(kit, 0);
  const side = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  chain(loop(kit, noise.pink, s), pass, env, ...(side ? [side] : []), kit.out);
  return {
    tick: ticks(
      drifter(rumble.gain, random, 0.25, 0.45, 1, 4),
      every(random, 2.5, 8, (at) => {
        const length = between(random, 1.6, 3.2);
        const peak = between(random, 0.12, 0.3);
        const from = random() < 0.5 ? -0.9 : 0.9;
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(peak, at + length / 2);
        env.gain.linearRampToValueAtTime(0, at + length);
        pass.frequency.setValueAtTime(between(random, 700, 1100), at);
        pass.frequency.linearRampToValueAtTime(between(random, 300, 500), at + length);
        if (side) {
          side.pan.setValueAtTime(from, at);
          side.pan.linearRampToValueAtTime(-from, at + length);
        }
      }),
      every(random, 25, 70, (at) => {
        const f = between(random, 380, 480);
        tone(kit, at, { from: f, length: between(random, 0.25, 0.6), peak: 0.035, type: 'square', pan: between(random, -0.7, 0.7) });
      }, 10),
    ),
    stop: stopper(s),
  };
}

/** A bar: voices, glasses touching, a bottle set down. */
function bar(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { random } = kit;
  const roomTone = filter(kit, 'lowpass', 1300);
  const level = gain(kit, 0.6);
  chain(roomTone, level, kit.out);
  layer(kit, s, kit.noise.brown, 0.12, filter(kit, 'lowpass', 180));
  return {
    tick: ticks(
      ...voices(kit, s, 7, roomTone),
      every(random, 1.5, 6, (at) => {
        const f = between(random, 2600, 3800);
        const side = between(random, -0.7, 0.7);
        tone(kit, at, { from: f, length: 0.35, peak: 0.025, pan: side, attack: 0.001 });
        tone(kit, at + 0.01, { from: f * 1.5, length: 0.25, peak: 0.012, pan: side, attack: 0.001 });
      }),
      every(random, 8, 20, (at) => tone(kit, at, { from: between(random, 160, 240), length: 0.12, peak: 0.05, pan: between(random, -0.5, 0.5), attack: 0.002 })),
    ),
    stop: stopper(s),
  };
}

/** A quiet apartment: the fridge hum, the room's own hush, the building settling now and then. */
function apartment(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { ctx, random } = kit;
  const buzz = ctx.createOscillator();
  buzz.type = 'sawtooth';
  buzz.frequency.value = 50;
  const soft = filter(kit, 'lowpass', 240);
  const level = gain(kit, 0.012);
  chain(buzz, soft, level, kit.out);
  buzz.start();
  s.push(buzz);
  layer(kit, s, kit.noise.brown, 0.18, filter(kit, 'lowpass', 150));
  layer(kit, s, kit.noise.pink, 0.012, filter(kit, 'lowpass', 900));
  return {
    tick: ticks(
      drifter(level.gain, random, 0.004, 0.016, 4, 12),
      every(random, 20, 60, (at) => tone(kit, at, { from: between(random, 90, 140), to: 70, length: 0.18, peak: 0.03, pan: between(random, -0.8, 0.8) }), 8),
    ),
    stop: stopper(s),
  };
}

/** Inside a car: the engine's drone and road noise under the tyres. */
function engine(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { ctx, noise, random } = kit;
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.value = 38;
  const tone_ = filter(kit, 'lowpass', 160);
  const level = gain(kit, 0.05);
  chain(motor, tone_, level, kit.out);
  motor.start();
  s.push(motor);
  const road = layer(kit, s, noise.brown, 0.45, filter(kit, 'lowpass', 420), filter(kit, 'highpass', 60));
  return {
    tick: ticks(
      drifter(motor.frequency, random, 32, 48, 2, 6),
      drifter(road.gain, random, 0.35, 0.55, 1, 3),
    ),
    stop: stopper(s),
  };
}

/** An office: air vents, a keyboard somewhere, a phone now and then. */
function office(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  layer(kit, s, noise.pink, 0.06, filter(kit, 'lowpass', 700), filter(kit, 'highpass', 120));
  const keys = [-0.4, 0.3].map((side) => striker(kit, s, noise.white, 'bandpass', 3, side));
  return {
    tick: ticks(
      every(random, 3, 10, (at) => {
        const count = 4 + Math.floor(random() * 14);
        for (let i = 0; i < count; i += 1) strikeAny(keys, random, at + i * between(random, 0.08, 0.2), between(random, 0.05, 0.1), 0.006, between(random, 2500, 4500));
      }),
      every(random, 40, 120, (at) => {
        for (let ring = 0; ring < 2; ring += 1) tone(kit, at + ring * 0.35, { from: 880, length: 0.25, peak: 0.015, type: 'triangle', pan: between(random, -0.6, 0.6) });
      }, 20),
    ),
    stop: stopper(s),
  };
}

/** Rain on the windows: soft taps on glass and runnels, from inside. */
function rainWindow(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  layer(kit, s, noise.pink, 0.08, filter(kit, 'bandpass', 1800, 0.4));
  layer(kit, s, noise.brown, 0.08, filter(kit, 'lowpass', 300));
  const taps = [-0.6, -0.2, 0.2, 0.6].map((side) => striker(kit, s, noise.white, 'bandpass', 4, side));
  return {
    tick: every(random, 0.03, 0.18, (at) => strikeAny(taps, random, at, between(random, 0.04, 0.14), between(random, 0.004, 0.01), between(random, 3000, 6000))),
    stop: stopper(s),
  };
}

/** A TV on in the room: voices through a small speaker, music now and then. */
function tv(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { random } = kit;
  const speaker = filter(kit, 'bandpass', 1400, 0.5);
  const thin = filter(kit, 'highpass', 280);
  const level = gain(kit, 0.55);
  chain(speaker, thin, level, kit.out);
  // The set's own faint hiss.
  layer(kit, s, kit.noise.white, 0.006, filter(kit, 'highpass', 6000));
  return {
    tick: ticks(
      ...voices(kit, s, 3, speaker),
      // A few bars of a score or a jingle.
      every(random, 18, 45, (at) => {
        const root = between(random, 220, 330);
        const steps = [1, 1.25, 1.5, 1.335, 1.125];
        for (let i = 0; i < 5; i += 1) {
          tone(kit, at + i * 0.32, { from: root * steps[Math.floor(random() * steps.length)], length: 0.3, peak: 0.02, type: 'triangle', dest: speaker });
        }
      }, 6),
    ),
    stop: stopper(s),
  };
}

/** A shower running: a steady hiss of water and drops on tile. */
function shower(kit: Kit): Bed {
  const s: AudioScheduledSourceNode[] = [];
  const { noise, random } = kit;
  const spray = layer(kit, s, noise.white, 0.22, filter(kit, 'highpass', 900), filter(kit, 'lowpass', 9000));
  layer(kit, s, noise.pink, 0.25, filter(kit, 'bandpass', 600, 0.4));
  const drops = [-0.3, 0, 0.3].map((side) => striker(kit, s, noise.white, 'bandpass', 5, side));
  return {
    tick: ticks(
      drifter(spray.gain, random, 0.18, 0.26, 0.8, 2.5),
      every(random, 0.05, 0.25, (at) => strikeAny(drops, random, at, between(random, 0.05, 0.15), between(random, 0.003, 0.008), between(random, 1500, 4000))),
    ),
    stop: stopper(s),
  };
}

export const BED_BUILDERS: Record<AmbienceBed, (kit: Kit) => Bed> = {
  'rain-light': rainLight,
  'rain-heavy': rainHeavy,
  'rain-window': rainWindow,
  storm,
  'wind-light': (kit) => wind(kit, 'light'),
  'wind-strong': (kit) => wind(kit, 'strong'),
  'snow-quiet': snowQuiet,
  birds,
  sea,
  street,
  traffic,
  crowd,
  bar,
  apartment,
  office,
  engine,
  tv,
  shower,
  fire,
};

export function buildBed(bed: AmbienceBed, ctx: BaseAudioContext, out: AudioNode, noise: Noise, random: () => number = Math.random): Bed {
  return BED_BUILDERS[bed]({ ctx, out, noise, random });
}
