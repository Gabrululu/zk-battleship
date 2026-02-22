let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

export function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(audioCtx.destination);
}

export function toggleMute(): boolean {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.6;
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

function getCtx(): { ctx: AudioContext; master: GainNode } | null {
  if (!audioCtx || !masterGain) return null;
  return { ctx: audioCtx, master: masterGain };
}

// ── 1. playPing — sonar ping when it's your turn ─────────────────────────────
export function playPing() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.4);
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 0.4);

  // Eco
  const eco = ctx.createOscillator();
  const ecoGain = ctx.createGain();
  eco.type = 'sine';
  eco.frequency.setValueAtTime(800, now + 0.1);
  eco.frequency.exponentialRampToValueAtTime(400, now + 0.5);
  ecoGain.gain.setValueAtTime(0.2, now + 0.1);
  ecoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  eco.connect(ecoGain);
  ecoGain.connect(master);
  eco.start(now + 0.1);
  eco.stop(now + 0.5);
}

// ── 2. playFire — when you fire a shot ───────────────────────────────────────
export function playFire() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // White noise whoosh
  const bufSize = ctx.sampleRate * 0.12;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;
  filter.Q.value = 0.8;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now);
  noise.stop(now + 0.12);

  // Descending tone
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(600, now + 0.08);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);
  oscGain.gain.setValueAtTime(0.3, now + 0.08);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(oscGain);
  oscGain.connect(master);
  osc.start(now + 0.08);
  osc.stop(now + 0.3);
}

// ── 3. playHit — confirmed hit ────────────────────────────────────────────────
export function playHit() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // Explosion burst
  const bufSize = ctx.sampleRate * 0.06;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const burst = ctx.createBufferSource();
  burst.buffer = buf;
  const burstGain = ctx.createGain();
  burstGain.gain.setValueAtTime(0.8, now);
  burstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  burst.connect(burstGain);
  burstGain.connect(master);
  burst.start(now);
  burst.stop(now + 0.06);

  // Rumble
  const rumble = ctx.createOscillator();
  const rumbleGain = ctx.createGain();
  const waveshaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
  }
  waveshaper.curve = curve;
  rumble.type = 'sine';
  rumble.frequency.setValueAtTime(80, now);
  rumble.frequency.exponentialRampToValueAtTime(40, now + 0.5);
  rumbleGain.gain.setValueAtTime(0.6, now + 0.02);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  rumble.connect(waveshaper);
  waveshaper.connect(rumbleGain);
  rumbleGain.connect(master);
  rumble.start(now + 0.02);
  rumble.stop(now + 0.5);
}

// ── 4. playMiss — water splash ────────────────────────────────────────────────
export function playMiss() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // Splash
  const bufSize = ctx.sampleRate * 0.3;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const splash = ctx.createBufferSource();
  splash.buffer = buf;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(800, now);
  lpf.frequency.exponentialRampToValueAtTime(200, now + 0.3);

  const splashGain = ctx.createGain();
  splashGain.gain.setValueAtTime(0.35, now);
  splashGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  splash.connect(lpf);
  lpf.connect(splashGain);
  splashGain.connect(master);
  splash.start(now);
  splash.stop(now + 0.3);

  // Glug
  const glug = ctx.createOscillator();
  const glugGain = ctx.createGain();
  glug.type = 'sine';
  glug.frequency.setValueAtTime(200, now + 0.05);
  glug.frequency.exponentialRampToValueAtTime(80, now + 0.2);
  glugGain.gain.setValueAtTime(0.25, now + 0.05);
  glugGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  glug.connect(glugGain);
  glugGain.connect(master);
  glug.start(now + 0.05);
  glug.stop(now + 0.22);
}

// ── 5. playProofGenerated — ZK proof complete ─────────────────────────────────
export function playProofGenerated() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // Ascending sweep
  const sweep = ctx.createOscillator();
  const sweepGain = ctx.createGain();
  sweep.type = 'sine';
  sweep.frequency.setValueAtTime(200, now);
  sweep.frequency.exponentialRampToValueAtTime(1200, now + 0.6);
  sweepGain.gain.setValueAtTime(0.3, now);
  sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  sweep.connect(sweepGain);
  sweepGain.connect(master);
  sweep.start(now);
  sweep.stop(now + 0.6);

  // Chord: tonic, fifth, octave (C5=523, G5=784, C6=1047)
  const freqs = [523, 784, 1047];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, now + 0.55);
    g.gain.linearRampToValueAtTime(0.18, now + 0.65 + i * 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc.connect(g);
    g.connect(master);
    osc.start(now + 0.55);
    osc.stop(now + 1.2);
  });
}

// ── 6. playVictory — game won ─────────────────────────────────────────────────
export function playVictory() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // Fanfare: C5, E5, G5, C6
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = now + i * 0.13;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.02);
    g.gain.setValueAtTime(0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.35);
  });

  // Reverb tail — repeated chord
  const reverbNotes = [523.25, 783.99, 1046.5];
  reverbNotes.forEach((freq) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + 0.55;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.8);
  });
}

// ── 7. playDefeat — game lost ─────────────────────────────────────────────────
export function playDefeat() {
  const c = getCtx();
  if (!c) return;
  const { ctx, master } = c;
  const now = ctx.currentTime;

  // Chromatic descent C5 → F4
  const waveshaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = (Math.PI + 100) * x / (Math.PI + 100 * Math.abs(x));
  }
  waveshaper.curve = curve;
  waveshaper.connect(master);

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(523.25, now);
  osc.frequency.exponentialRampToValueAtTime(349.23, now + 0.8);
  g.gain.setValueAtTime(0.4, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  osc.connect(g);
  g.connect(waveshaper);
  osc.start(now);
  osc.stop(now + 1.2);

  // Low drone
  const drone = ctx.createOscillator();
  const dg = ctx.createGain();
  drone.type = 'sine';
  drone.frequency.setValueAtTime(87, now);
  dg.gain.setValueAtTime(0.3, now);
  dg.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
  drone.connect(dg);
  dg.connect(master);
  drone.start(now);
  drone.stop(now + 1.4);
}
