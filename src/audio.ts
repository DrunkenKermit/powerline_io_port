// Powerline.io offline port — sound.
//
// The client's own config carries exactly three gameplay sounds and a music
// track: `lineLoopSound` (the hum of a line riding alongside another), 
// `crashSound` (the death), and `sparkSound` (the crackle between two snakes
// rubbing). `build/assets/music.ogg` is the client's track and nothing else
// survived, so the three effects are synthesised here — noise and low
// oscillators, filtered, which is what the originals are — and the port keeps
// that track for the death screen. There are no pellet, kill or lead cues: the
// client ships none, and chimes over a 1,500-pellet field are not its sound.
//
// Everything is gated on `enabled` (the settings panel's sound switch) and the
// context is created lazily on the first cue, because a browser only lets an
// AudioContext start inside a gesture. `unlock()` is that gesture.

/** Two detuned saws through a lowpass: the electric hum of a speeding line. */
interface Hum {
  oscillators: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  levels: number[];
}

export class Sound {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private hum: Hum | null = null;
  private lastSpark = 0;
  private lastCrash = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Called from the first pointer or key event: browsers need a gesture. */
  unlock() {
    const context = this.ensure();
    if (context && context.state === "suspended") void context.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.master) return;
    const context = this.context!;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, context.currentTime, 0.02);
    if (!on) this.setBoost(false);
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    const context = new Ctor();
    const master = context.createGain();
    master.gain.value = this.enabled ? 0.9 : 0;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  /** Half a second of white noise, reused by the crash and the sparks. */
  private noise(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const frames = Math.floor(context.sampleRate * 0.5);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** The death: a burst of noise swept down, over a low thump. */
  crash() {
    if (!this.enabled) return;
    // One crash per death: the wasKilled event and the respawn path can land in
    // the same frame, and two stacked bursts clip.
    const now = this.now();
    if (now - this.lastCrash < 200) return;
    this.lastCrash = now;
    const context = this.ensure();
    if (!context || !this.master) return;
    const at = context.currentTime;

    const source = context.createBufferSource();
    source.buffer = this.noise(context);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, at);
    filter.frequency.exponentialRampToValueAtTime(180, at + 0.4);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.32, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(at);
    source.stop(at + 0.45);

    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(84, at);
    thump.frequency.exponentialRampToValueAtTime(42, at + 0.3);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.26, at);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    thump.connect(thumpGain).connect(this.master);
    thump.start(at);
    thump.stop(at + 0.36);
  }

  /**
   * The electric crackle of two snakes rubbing.
   *
   * The client plays its `sparkSound` with `VOLUME_SPARK * lastDistVolume *
   * masterVolume` and only arms the spark above 40 speed, so a brush past a
   * rival is quiet and a charged powerslide is loud: `level` is that
   * lastDistVolume (0..1) and `speed` is 0..1 across the speed range.
   */
  spark(level = 1, speed = 1) {
    const time = this.now();
    // The client wraps its spark frame counter at 3: a crackle roughly every
    // third frame while the rub holds. Faster lines spark faster.
    if (time - this.lastSpark < 88 - 46 * speed) return;
    this.lastSpark = time;
    if (!this.enabled) return;
    const context = this.ensure();
    if (!context || !this.master) return;
    const at = context.currentTime;
    const strength = 0.018 + 0.07 * Math.max(0, Math.min(1, level)) * (0.4 + 0.6 * Math.max(0, Math.min(1, speed)));
    // Three snaps inside 50ms read as one crackle rather than a tone.
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.017 + Math.random() * 0.008;
      const source = context.createBufferSource();
      source.buffer = this.noise(context);
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      // A close, fast rub arcs brighter than a distant one.
      filter.frequency.value = 1500 + 900 * level + 1500 * speed + Math.random() * 900;
      const gain = context.createGain();
      const peak = strength * (0.7 + Math.random() * 0.6);
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(peak, at + offset + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.028);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(at + offset, Math.random() * 0.2, 0.04);
    }
  }

  /**
   * The speed hum — the client's `lineLoopSound`.
   *
   * It belongs to riding alongside another line, so its level is the rub's
   * proximity (`level`, the client's lastDistVolume) rather than a key press,
   * and its pitch rides the speed the rub is feeding (`speed`, 0..1). Every
   * change is a `setTargetAtTime` ramp on the live graph, so the hum swells and
   * falls instead of restarting and clicking.
   */
  setBoost(on: boolean, level = 1, speed = 0) {
    if (!this.enabled) on = false;
    if (on && !this.hum) {
      const context = this.ensure();
      if (!context || !this.master) return;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 520;
      const oscillators: OscillatorNode[] = [];
      const levels: number[] = [];
      for (const frequency of [62, 93]) {
        const osc = context.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency;
        osc.connect(filter);
        osc.start();
        oscillators.push(osc);
        levels.push(frequency);
      }
      filter.connect(gain).connect(this.master);
      this.hum = { oscillators, gain, filter, levels };
    }
    if (!this.hum) return;
    const context = this.context!;
    const hum = this.hum;
    if (!on) {
      this.hum = null;
      hum.gain.gain.cancelScheduledValues(context.currentTime);
      hum.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.04);
      for (const osc of hum.oscillators) osc.stop(context.currentTime + 0.25);
      return;
    }
    const closeness = Math.max(0, Math.min(1, level));
    const pace = Math.max(0, Math.min(1, speed));
    const at = context.currentTime;
    hum.gain.gain.setTargetAtTime(0.016 + 0.06 * closeness * (0.4 + 0.6 * pace), at, 0.06);
    hum.filter.frequency.setTargetAtTime(420 + 220 * closeness + 360 * pace, at, 0.08);
    for (let i = 0; i < hum.oscillators.length; i++) {
      hum.oscillators[i]!.frequency.setTargetAtTime(hum.levels[i]! * (1 + 0.35 * pace), at, 0.1);
    }
  }

  /** Called every frame: crackles while the two heads are within rubbing range. */
  rubbing(level = 0, speed = 0) {
    if (level > 0) this.spark(level, speed);
  }
}

export const sound = new Sound();
