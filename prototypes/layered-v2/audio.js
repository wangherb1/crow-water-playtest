(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrowAudio = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // Authored for this prototype: a four-bar, 32-eighth-note C-major theme.
  // Sound is synthesized here; no recordings, external samples or music URLs.
  const BPM = 88, STEP_SECONDS = 60 / BPM / 2, PHRASE_STEPS = 32;
  const MELODY = [72, null, 76, 79, 76, null, 74, 72,
    69, null, 72, 76, 74, 72, 69, null,
    65, null, 69, 72, 74, 72, 69, 67,
    67, null, 71, 74, 72, 71, 67, null];
  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const REGIONS = [
    { name: 'courtyard', lead: 'triangle', partial: .12, attack: .009, decay: .25, pad: 'sine', drum: 5300, bass: 'sine' },
    { name: 'dusk', lead: 'sine', partial: .35, attack: .006, decay: .43, pad: 'triangle', drum: 3200, bass: 'triangle' },
    { name: 'night', lead: 'triangle', partial: .06, attack: .035, decay: .36, pad: 'sine', drum: 1800, bass: 'triangle' }
  ];
  const frequency = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const EFFECT_GAPS = Object.freeze({ pick: .065, throw: .065, lid: .045, water: .075, ground: .06, crow: .65, win: .7 });
  const effectKind = name => name === 'hit' ? 'water' : name === 'miss' ? 'ground' :
    Object.prototype.hasOwnProperty.call(EFFECT_GAPS, name) ? name : null;
  const bounded = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

  function makeGraph(context, scheduleWholeScore = false) {
    const music = context.createGain(), effects = context.createGain();
    music.gain.setValueAtTime(0, context.currentTime);
    effects.gain.setValueAtTime(0, context.currentTime);
    music.connect(context.destination); effects.connect(context.destination);
    const voices = new Set();
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .2), context.sampleRate);
    const noise = buffer.getChannelData(0);
    let seed = 831107;
    for (let i = 0; i < noise.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i] = seed / 2147483648 - 1;
    }

    function cleanup(voice) {
      if (voice.closed) return;
      voice.closed = true; voices.delete(voice);
      for (const node of voice.nodes) { try { node.disconnect(); } catch (_) {} }
    }
    function stopVoice(voice) {
      if (voice.closed) return;
      try { voice.envelope.gain.cancelScheduledValues(context.currentTime); voice.envelope.gain.setValueAtTime(0, context.currentTime); } catch (_) {}
      for (const source of voice.sources) { try { source.stop(context.currentTime); } catch (_) {} }
      cleanup(voice);
    }
    function stop(channel) {
      for (const voice of [...voices]) if (!channel || voice.channel === channel) stopVoice(voice);
    }
    function register(channel, sources, envelope, nodes, at, duration) {
      const limit = scheduleWholeScore ? Infinity : channel === 'effects' ? 16 : 64;
      const same = [...voices].filter(voice => voice.channel === channel);
      while (same.length >= limit) stopVoice(same.shift());
      const voice = { channel, sources, envelope, nodes, closed: false, ended: 0 };
      voices.add(voice);
      for (const source of sources) {
        source.onended = () => { voice.ended++; if (voice.ended === sources.length) cleanup(voice); };
        source.start(at); source.stop(at + duration + .025);
      }
    }
    function tone(channel, midi, at, duration, volume, wave = 'sine', options = {}) {
      const envelope = context.createGain(), sources = [], nodes = [envelope];
      const attack = Math.min(options.attack || .009, duration / 3);
      envelope.gain.setValueAtTime(.0001, at);
      envelope.gain.linearRampToValueAtTime(volume, at + attack);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      envelope.connect(channel === 'music' ? music : effects);
      const source = context.createOscillator(); source.type = wave;
      source.frequency.setValueAtTime(frequency(midi), at);
      if (options.endMidi != null) source.frequency.exponentialRampToValueAtTime(frequency(options.endMidi), at + duration);
      source.connect(envelope); sources.push(source); nodes.push(source);
      if (options.partial) {
        const partial = context.createOscillator(), mix = context.createGain();
        partial.type = 'sine'; partial.frequency.setValueAtTime(frequency(midi) * 2.003, at);
        mix.gain.setValueAtTime(options.partial, at); partial.connect(mix); mix.connect(envelope);
        sources.push(partial); nodes.push(partial, mix);
      }
      register(channel, sources, envelope, nodes, at, duration);
    }
    function brush(at, volume, cutoff) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
      source.buffer = buffer; filter.type = 'highpass'; filter.frequency.setValueAtTime(cutoff, at); filter.Q.setValueAtTime(.6, at);
      envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(volume, at + .006);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + .065);
      source.connect(filter); filter.connect(envelope); envelope.connect(music);
      register('music', [source], envelope, [source, filter, envelope], at, .075);
    }
    function texture(at, duration, volume, cutoff, options = {}) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
      source.buffer = buffer; filter.type = options.type || 'lowpass';
      filter.frequency.setValueAtTime(cutoff, at); filter.Q.setValueAtTime(options.q || .7, at);
      if (options.endCutoff) filter.frequency.exponentialRampToValueAtTime(options.endCutoff, at + duration);
      envelope.gain.setValueAtTime(.0001, at);
      envelope.gain.linearRampToValueAtTime(volume, at + Math.min(options.attack || .003, duration / 3));
      envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(filter); filter.connect(envelope); envelope.connect(effects);
      register('effects', [source], envelope, [source, filter, envelope], at, duration);
    }
    function mute(channel, muted) {
      const bus = channel === 'music' ? music : effects;
      bus.gain.cancelScheduledValues(context.currentTime);
      bus.gain.setValueAtTime(muted ? 0 : (channel === 'music' ? .42 : .45), context.currentTime);
    }
    function disconnect() {
      stop(); music.disconnect(); effects.disconnect();
    }
    return { tone, brush, texture, mute, stop, disconnect, voices };
  }

  function scheduleStep(graph, region, step, at) {
    const instrument = REGIONS[region], position = step % PHRASE_STEPS;
    const chord = CHORDS[Math.floor(position / 8)];
    if (position % 8 === 0) {
      chord.forEach((note, index) => graph.tone('music', note + 12, at + index * .025,
        STEP_SECONDS * 7.7, .019, instrument.pad, { attack: .13 }));
    }
    if (position % 4 === 0) graph.tone('music', chord[0] - 12, at, .48, .075, instrument.bass, { attack: .025 });
    const note = MELODY[position];
    if (note !== null) graph.tone('music', note, at, instrument.decay, .12, instrument.lead,
      { partial: instrument.partial, attack: instrument.attack });
    // A quiet off-beat brush and a low downbeat provide a real, light groove.
    if (position % 2 === 1) graph.brush(at, position % 4 === 3 ? .055 : .036, instrument.drum);
    if (position % 4 === 0) graph.tone('music', 38, at, .085, .045, 'sine', { endMidi: 28 });
    // Dusk: high answering drops. Night: lower, airy answering notes.
    if (region === 1 && position % 8 === 7) graph.tone('music', chord[2] + 24, at, .32, .045, 'sine', { partial: .25 });
    if (region === 2 && position % 8 === 6) graph.tone('music', chord[1] + 12, at, .52, .05, 'sine', { attack: .04 });
  }

  // Shared by live play and offline listening. Size changes only the sound's
  // weight; this module does not alter stone flight, wind, scoring or water rise.
  function scheduleEffect(graph, kind, at, detail = {}) {
    detail = detail && typeof detail === 'object' ? detail : {};
    const radius = bounded(detail.radius, 9, 4, 18), intensity = bounded(detail.intensity, 1, .15, 1.4);
    const pitch = (9 - radius) * .65;
    const note = (midi, delay, duration, volume, wave = 'sine', options = {}) =>
      graph.tone('effects', midi, at + delay, duration, volume * intensity, wave, options);
    const texture = (delay, duration, volume, cutoff, options = {}) =>
      graph.texture(at + delay, duration, volume * intensity, cutoff, options);
    if (kind === 'pick') {
      texture(0, .045, .075, 1600);
      note(91 + pitch, .003, .032, .045, 'triangle', { endMidi: 82 + pitch, attack: .002 });
    } else if (kind === 'throw') {
      texture(0, .14, .14, 550, { type: 'bandpass', endCutoff: 1700, q: .65, attack: .025 });
    } else if (kind === 'lid') {
      note(68 + pitch, 0, .13, .16, 'sine', { endMidi: 65 + pitch, attack: .002 });
      note(84 + pitch, .002, .055, .065, 'triangle', { attack: .002 });
      texture(0, .035, .085, 1900);
    } else if (kind === 'water') {
      // A low body, the water surface breaking, then one small answering drop.
      note(61 + pitch, 0, .19, .24, 'sine', { endMidi: 43 + pitch, attack: .003 });
      texture(.002, .085, .065, 2800, { endCutoff: 900 });
      note(76 + pitch, .026, .095, .085, 'sine', { endMidi: 88 + pitch, attack: .003 });
      note(89 + pitch, .105, .14, .057, 'sine', { endMidi: 75 + pitch, attack: .004 });
    } else if (kind === 'ground') {
      // A stone landing and a small second contact, without a failure jingle.
      texture(0, .055, .12, 2100);
      note(74 + pitch, .002, .04, .075, 'triangle', { endMidi: 64 + pitch, attack: .002 });
      note(82 + pitch, .065, .032, .035, 'sine', { endMidi: 78 + pitch, attack: .002 });
    } else if (kind === 'crow') {
      note(61, 0, .095, .065, 'triangle', { endMidi: 54, partial: .15, attack: .015 });
      texture(.008, .075, .035, 700, { type: 'bandpass', q: 1.1 });
      note(64, .12, .12, .055, 'triangle', { endMidi: 56, partial: .12, attack: .018 });
    } else if (kind === 'win') {
      [72, 76, 79, 84].forEach((midi, index) => note(midi, .035 + index * .095, index === 3 ? .39 : .27, .105, 'sine', { partial: .1, attack: .012 }));
      note(48, 0, .52, .085, 'sine', { attack: .025 });
      note(60, .04, .48, .045, 'sine', { attack: .035 });
    }
  }

  function create(deps = {}) {
    const Context = Object.prototype.hasOwnProperty.call(deps, 'AudioContext') ? deps.AudioContext : (root.AudioContext || root.webkitAudioContext);
    const repeat = deps.setInterval || root.setInterval || setInterval;
    const cancel = deps.clearInterval || root.clearInterval || clearInterval;
    const preference = { music: true, effects: true, paused: false, region: 0 };
    let context = null, graph = null, timer = null, nextAt = 0, step = 0, stepsScheduled = 0;
    let unlocked = false, disposed = false, resumePromise = null, lastError = null;
    const lastEffectAt = Object.create(null);
    const running = () => !disposed && unlocked && context && context.state === 'running';

    function stopMusic() {
      if (timer !== null) { cancel(timer); timer = null; }
      if (graph) graph.stop('music');
    }
    function scheduler() {
      if (!running() || preference.paused || !preference.music) return;
      // Never replay a background backlog or queue a burst after a delayed frame.
      if (nextAt < context.currentTime) nextAt = context.currentTime + .025;
      try {
        while (nextAt < context.currentTime + .18) {
          scheduleStep(graph, preference.region, step, nextAt);
          step = (step + 1) % PHRASE_STEPS; nextAt += STEP_SECONDS; stepsScheduled++;
        }
      } catch (_) { lastError = 'schedule_failed'; stopMusic(); graph.mute('music', true); }
    }
    function reconcile(restartMusic = false) {
      if (!graph) return;
      const active = running() && !preference.paused;
      graph.mute('music', !active || !preference.music);
      graph.mute('effects', !active || !preference.effects);
      if (!active || !preference.effects) graph.stop('effects');
      if (!active || !preference.music || restartMusic) stopMusic();
      if (active && preference.music && timer === null) {
        step = 0; nextAt = context.currentTime + .035;
        timer = repeat(scheduler, 80); scheduler();
      }
    }
    function snapshot() {
      const voices = graph ? [...graph.voices] : [];
      return { ...preference, supported: typeof Context === 'function', unlocked, disposed,
        contextState: context ? context.state : 'not_created', regionName: REGIONS[preference.region].name, schedulerActive: timer !== null,
        activeVoices: voices.length, musicVoices: voices.filter(v => v.channel === 'music').length,
        effectVoices: voices.filter(v => v.channel === 'effects').length,
        stepsScheduled, phraseStep: step, phraseSteps: PHRASE_STEPS, bpm: BPM, lastError };
    }
    function set(next = {}) {
      if (disposed) return snapshot();
      const oldRegion = preference.region;
      for (const key of ['music', 'effects', 'paused']) if (typeof next[key] === 'boolean') preference[key] = next[key];
      if (Number.isInteger(next.region) && next.region >= 0 && next.region < REGIONS.length) preference.region = next.region;
      reconcile(oldRegion !== preference.region);
      return snapshot();
    }
    function unlock() {
      if (disposed || typeof Context !== 'function') return Promise.resolve(false);
      if (resumePromise) return resumePromise;
      try {
        if (!context) { context = new Context(); graph = makeGraph(context); }
        if (context.state === 'running') { unlocked = true; lastError = null; reconcile(); return Promise.resolve(true); }
        // Invoke resume synchronously inside the caller's user gesture.
        const pending = context.resume();
        resumePromise = Promise.resolve(pending).then(() => {
          if (disposed) return false;
          unlocked = context.state === 'running';
          lastError = unlocked ? null : 'resume_blocked'; reconcile(); return unlocked;
        }).catch(() => { unlocked = false; lastError = 'resume_blocked'; reconcile(); return false; })
          .finally(() => { resumePromise = null; });
        return resumePromise;
      } catch (_) { unlocked = false; lastError = 'audio_unavailable'; if (graph) reconcile(); return Promise.resolve(false); }
    }
    function effect(name, detail = {}) {
      const kind = effectKind(name);
      if (!running() || preference.paused || !preference.effects || !kind) return false;
      // A lid contact and water entry can share a frame; only repeated events
      // of the same kind share a cooldown. Aliases share the underlying kind.
      if (lastEffectAt[kind] != null && context.currentTime - lastEffectAt[kind] < EFFECT_GAPS[kind]) return false;
      const at = context.currentTime + .004;
      try {
        scheduleEffect(graph, kind, at, detail); lastEffectAt[kind] = context.currentTime;
        return true;
      } catch (_) { lastError = 'effect_failed'; graph.stop('effects'); return false; }
    }
    function dispose() {
      if (disposed) return;
      disposed = true; unlocked = false; stopMusic();
      if (graph) graph.disconnect();
      if (context && context.state !== 'closed') {
        try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
      }
    }
    return Object.freeze({ unlock, set, effect, snapshot, dispose });
  }

  // Authoring utility: render the same score, orchestration and mix for an
  // offline listening artifact. It does not run or unlock live game audio.
  async function renderPreview(options = {}) {
    const Offline = options.OfflineAudioContext || root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext unavailable');
    const seconds = Math.max(1, Math.min(60, Number(options.seconds) || 12));
    const sampleRate = options.sampleRate === 44100 ? 44100 : 22050;
    const region = Number.isInteger(options.region) && options.region >= 0 && options.region <= 2 ? options.region : 0;
    const context = new Offline(1, Math.ceil(seconds * sampleRate), sampleRate), graph = makeGraph(context, true);
    graph.mute('music', false);
    for (let at = .04, step = 0; at < seconds; at += STEP_SECONDS, step++) scheduleStep(graph, region, step, at);
    try { return await context.startRendering(); } finally { graph.disconnect(); }
  }

  async function renderEffectPreview(options = {}) {
    const Offline = options.OfflineAudioContext || root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext unavailable');
    const kind = effectKind(options.name || 'water');
    if (!kind) throw new Error('Unknown effect name');
    const seconds = bounded(options.seconds, 1.4, .8, 8), sampleRate = options.sampleRate === 44100 ? 44100 : 22050;
    const context = new Offline(1, Math.ceil(seconds * sampleRate), sampleRate), graph = makeGraph(context, true);
    graph.mute('effects', false);
    scheduleEffect(graph, kind, .04, options.detail);
    try { return await context.startRendering(); } finally { graph.disconnect(); }
  }

  return Object.freeze({ create, renderPreview, renderEffectPreview });
});
