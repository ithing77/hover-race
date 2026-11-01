// 효과음. CC0 파일(assets/sfx)과 브라우저 합성을 섞어 쓴다. 계산에는 영향이 없다.
(function (root) {
  const MIN_GAP = { gun: 0.07, shock: 0.12, rocket: 0.12, missile: 0.15, hit: 0.06, crash: 0.1, wall: 0.2, miss: 0.12, boom: 0.1 };
  // 소리별 파일과 음량은 assets/sfx/sound.json 에 있다(작업실에서 고친다). 못 받으면 합성 소리만 난다.
  const BASE = root.HOVER_SOUND_BASE || '';
  let FILES = {};
  const buffers = {};
  let ctx = null;
  let master = null;
  let noise = null;
  let engine = null;
  let muted = false;
  const lastAt = {};
  try {
    muted = localStorage.getItem('hoverrace-mute') === '1';
  } catch (e) { /* 저장을 못 해도 소리는 난다 */ }

  // 브라우저는 사용자가 누른 뒤에만 소리를 허락한다.
  function unlock() {
    if (!ctx) {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      const limiter = ctx.createDynamicsCompressor();
      master.connect(limiter).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      startEngine();
      loadFiles();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function loadBuffers() {
    const names = new Set(Object.values(FILES).flatMap((f) => f.files || []));
    return Promise.all([...names].filter((n) => !buffers[n]).map((name) => fetch(`${BASE}assets/sfx/${encodeURIComponent(name)}`)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => { buffers[name] = buffer; })
      .catch(() => { /* 없으면 합성 소리로 낸다 */ })));
  }

  function loadFiles() {
    fetch(`${BASE}assets/sfx/sound.json`)
      .then((r) => r.json())
      .then((cfg) => {
        FILES = cfg;
        return loadBuffers();
      })
      .catch(() => { /* 없으면 합성 소리로 낸다 */ });
  }

  // 파일을 낸다. 같은 소리가 겹쳐도 질리지 않게 하나를 골라 높낮이를 조금 흔든다.
  function playFile(kind, v) {
    const file = FILES[kind];
    if (!file || !file.files) return false;
    const ready = file.files.filter((n) => buffers[n]);
    if (!ready.length) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffers[ready[Math.floor(Math.random() * ready.length)]];
    src.playbackRate.value = (file.rate || 1) * (0.92 + Math.random() * 0.16);
    const gain = ctx.createGain();
    const level = (file.gain === undefined ? 0.7 : file.gain) * v;
    gain.gain.value = level;
    src.connect(gain).connect(master);
    src.start();
    if (file.max) {
      // 긴 파일은 앞부분만 쓰고 부드럽게 줄인다.
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(level, t + file.max * 0.6);
      gain.gain.linearRampToValueAtTime(0.0001, t + file.max);
      src.stop(t + file.max + 0.02);
    }
    return true;
  }

  function startEngine() {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth';
    b.type = 'square';
    a.frequency.value = 60;
    b.frequency.value = 90;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.3;
    a.connect(filter);
    b.connect(bGain).connect(filter);
    filter.connect(gain).connect(master);
    a.start();
    b.start();
    engine = { a, b, filter, gain };
  }

  // 부유 엔진 소리. level은 0이면 꺼짐, 0~1은 속도.
  function setEngine(level) {
    if (!ctx) return;
    const t = ctx.currentTime;
    engine.gain.gain.setTargetAtTime(level <= 0 ? 0 : 0.035 + level * 0.05, t, 0.15);
    engine.a.frequency.setTargetAtTime(55 + level * 150, t, 0.1);
    engine.b.frequency.setTargetAtTime(82 + level * 225, t, 0.1);
    engine.filter.frequency.setTargetAtTime(220 + level * 900, t, 0.15);
  }

  function env(gainNode, t, peak, attack, length) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + length);
  }

  function tone(type, from, to, peak, length, delay = 0) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
    env(gain, t, peak, 0.005, length);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  function burst(filterType, from, to, peak, length, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
    const gain = ctx.createGain();
    env(gain, t, peak, 0.004, length);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, src.loopStart);
    src.stop(t + length + 0.05);
  }

  const SOUNDS = {
    gun(v) { burst('bandpass', 2400, 1000, 0.3 * v, 0.05); },
    rocket(v) { burst('lowpass', 1800, 500, 0.35 * v, 0.28); tone('sawtooth', 300, 90, 0.08 * v, 0.25); },
    missile(v) { burst('bandpass', 700, 2600, 0.42 * v, 0.55); tone('sawtooth', 120, 520, 0.09 * v, 0.5); },
    shock(v) { tone('square', 1700, 300, 0.1 * v, 0.1); burst('highpass', 3500, 5000, 0.14 * v, 0.1); },
    hit(v) { burst('bandpass', 3400, 1800, 0.24 * v, 0.04); },
    miss(v) { tone('sine', 2300, 1200, 0.04 * v, 0.08); },
    boom(v) { burst('lowpass', 1300, 90, 0.9 * v, 0.6); tone('sine', 110, 32, 0.7 * v, 0.5); },
    smallBoom(v) { burst('lowpass', 1900, 180, 0.55 * v, 0.28); tone('sine', 150, 50, 0.35 * v, 0.22); },
    crash(v) { burst('bandpass', 1000, 350, 0.6 * v, 0.14); tone('square', 170, 60, 0.14 * v, 0.1); },
    wall(v) { burst('highpass', 3000, 1600, 0.16 * v, 0.2); },
    shield(v) { tone('sine', 420, 980, 0.14 * v, 0.28); },
    shieldHit(v) { tone('sine', 1300, 700, 0.14 * v, 0.14); },
    reboot(v) { tone('sawtooth', 700, 70, 0.2 * v, 0.55); tone('square', 900, 900, 0.05 * v, 0.06, 0.6); tone('square', 900, 900, 0.05 * v, 0.06, 0.75); },
    blip() { tone('sine', 880, 1040, 0.09, 0.05); },
    release() { tone('sawtooth', 200, 720, 0.12, 0.35); },
    warn() { tone('square', 880, 880, 0.08, 0.1); tone('square', 880, 880, 0.08, 0.1, 0.18); },
    // 출발 신호: 낮은 음 셋, 높은 음 하나.
    start() {
      [0, 0.4, 0.8].forEach((d) => tone('square', 440, 440, 0.1, 0.15, d));
      tone('square', 880, 880, 0.14, 0.45, 1.2);
    },
    finish() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, i === 3 ? 0.5 : 0.16, i * 0.14)); },
    lap() { tone('triangle', 1175, 1175, 0.1, 0.1); tone('triangle', 1568, 1568, 0.1, 0.2, 0.09); },
  };

  // 내 차 일이면 크게, 남의 일이면 작게 낸다. mine을 안 주면 작은 쪽.
  function play(kind, mine = false) {
    if (!ctx || muted || ctx.state !== 'running' || !SOUNDS[kind]) return;
    const gap = MIN_GAP[kind] || 0;
    const now = ctx.currentTime;
    if (gap && now - (lastAt[kind] || -1) < gap * (mine ? 0.6 : 1)) return;
    lastAt[kind] = now;
    const v = mine ? 1 : 0.4;
    const fromFile = playFile(kind, v);
    if (!fromFile || FILES[kind].layer) SOUNDS[kind](fromFile ? v * 0.5 : v);
  }

  // 작업실에서 쓴다. 고친 설정을 바로 들어 볼 수 있게 한다.
  function configure(cfg) {
    FILES = cfg;
    if (ctx) loadBuffers();
  }

  async function preview(kind) {
    unlock();
    if (!ctx) return;
    await ctx.resume();
    await loadBuffers();
    lastAt[kind] = -1;
    play(kind, true);
  }

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem('hoverrace-mute', value ? '1' : '0');
    } catch (e) { /* 저장을 못 해도 이번 판은 적용된다 */ }
    if (master) master.gain.setTargetAtTime(value ? 0 : 0.5, ctx.currentTime, 0.02);
  }

  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  root.HoverSound = { play, setEngine, setMuted, isMuted: () => muted, configure, preview };
})(window);
