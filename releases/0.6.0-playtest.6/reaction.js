(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrowReaction = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This module observes the simulation. It never awards hits, alters the wind,
  // resolves flight collisions or writes into a core state.
  const STEP = 1 / 180, MAX_AGE = 1.2, EPS = 1e-9, WATER_RISE = 118 / 3;
  const stores = new WeakMap();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const number = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  function store(core) {
    if (!stores.has(core)) stores.set(core, { paths: new Map(), plans: new Map() });
    return stores.get(core);
  }
  function memo(map, key, factory, limit) {
    if (map.has(key)) return map.get(key);
    const value = factory();
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
    return value;
  }
  function configKey(state) {
    const c = state.cfg || {};
    return [state.index, state.mode, state.seed, c.amplitude, c.period, c.phase,
      c.mouthRx, c.wind, c.gate, c.gatePeriod, c.gateOpen, c.goal].join('|');
  }
  function spec(value, state) {
    const from = value.from || {}, index = value.stoneIndex ?? value.index ?? from.index ?? 0;
    const base = (state.layout || []).find(item => item.index === index) || {};
    return { index, radius: value.radius ?? from.radius ?? base.radius ?? 8,
      spriteIndex: value.spriteIndex ?? from.spriteIndex ?? base.spriteIndex ?? index % 3,
      rotation: value.rotation ?? from.rotation ?? base.rotation ?? 0 };
  }
  function waterRadius(y) { return y < 303 ? 17 : y < 345 ? lerp(17, 48, ease((y - 303) / 42)) : 48; }
  function innerRadius(y) { return y < 258 ? lerp(21, 17, clamp((y - 254) / 4, 0, 1)) : waterRadius(y); }
  function goal(state) { return clamp(number(state.cfg && state.cfg.goal, 3), 1, 3); }
  // A shorter opening round begins with more water. Every successful stone
  // still raises it by the same amount, and every bottle finishes at y=290.
  function initialWater(state) { return 408 - (3 - goal(state)) * WATER_RISE; }
  function insideStep(previous, dt, state, last, prior, radius, core) {
    const g = core.GRAVITY || 600, t = previous.t + dt;
    const m = core.mouth(state, last.time + t - state.time);
    const wallV = (m.x - previous.mouthX) / dt;
    let x = previous.x + previous.vx * dt;
    let y = previous.y + previous.vy * dt + .5 * g * dt * dt;
    let vx = previous.vx, vy = previous.vy + g * dt;
    const half = Math.max(1, innerRadius(y) * (m.rx / 21) - radius), relative = x - m.x;
    if (relative < -half) { x = m.x - half; vx = wallV + Math.abs(vx - wallV) * .20; }
    else if (relative > half) { x = m.x + half; vx = wallV - Math.abs(vx - wallV) * .20; }
    for (const old of prior) {
      const dx = x - (m.x + old.localX), separation = radius + old.radius;
      if (Math.abs(dx) < separation && y >= old.y - separation && y < old.y + radius && vy > 0) {
        const top = old.y - Math.sqrt(separation * separation - dx * dx);
        if (y > top) { y = top; vy = -Math.abs(vy) * .10; vx = wallV + (vx - wallV) * .55; }
      }
    }
    if (y >= 432 - radius) { y = 432 - radius; vy = Math.abs(vy) < 35 ? 0 : -Math.abs(vy) * .08; vx = wallV + (vx - wallV) * .7; }
    return { x, y, vx, vy, t, mouthX: m.x };
  }
  function containedPath(state, record, prior, core) {
    const last = record.result, material = spec({ ...record, ...last }, state), radius = material.radius;
    const signature = [configKey(state), last.time, last.x, last.y, last.vx, last.vy, last.mouthX,
      radius, prior.map(m => [m.localX, m.y, m.radius].join(',')).join(';')].join('|');
    return memo(store(core).paths, signature, () => {
      const samples = [{ x: last.x, y: last.y, vx: number(last.vx), vy: number(last.vy), t: 0,
        mouthX: number(last.mouthX, core.mouth(state, last.time - state.time).x) }];
      const surface = initialWater(state) - prior.length * WATER_RISE;
      let impact = null;
      for (let index = 1; index <= Math.round(MAX_AGE / STEP); index++) {
        const previous = samples[index - 1];
        const next = insideStep(previous, STEP, state, last, prior, radius, core);
        if (!impact && previous.y + radius < surface && next.y + radius >= surface) {
          // Interpolate within the 1/180 s display step so the sound and the
          // waterline begin at one stable timestamp, independent of frame rate.
          const u = clamp((surface - radius - previous.y) / (next.y - previous.y), 0, 1);
          impact = { t: previous.t + STEP * u, x: lerp(previous.x, next.x, u), y: surface,
            speed: Math.hypot(lerp(previous.vx, next.vx, u), lerp(previous.vy, next.vy, u)) };
        }
        samples.push(next);
      }
      return { samples, impact, surface };
    }, 48);
  }
  function bottleMotion(state, core) {
    const motions = [];
    (state.shots || []).forEach((record, shotIndex) => {
      const last = record.result;
      if (!last || last.kind !== 'hit' || last.time > state.time + EPS) return;
      const material = spec({ ...record, ...last }, state), age = Math.max(0, state.time - last.time);
      const path = containedPath(state, record, motions, core), duration = Math.min(age, MAX_AGE);
      const index = Math.min(path.samples.length - 1, Math.floor((duration + EPS) / STEP));
      const previous = path.samples[index], tail = duration - previous.t;
      const sample = tail > EPS ? insideStep(previous, tail, state, last, motions, material.radius, core) : previous;
      const occurred = path.impact && age + EPS >= path.impact.t;
      motions.push({ x: sample.x, y: sample.y, localX: sample.x - sample.mouthX,
        vx: sample.vx, vy: sample.vy, age, waterImpactAt: occurred ? path.impact.t : null,
        waterImpactX: occurred ? path.impact.x : null, waterImpactY: path.surface,
        impactSpeed: occurred ? path.impact.speed : 0, shotIndex, ...material });
    });
    const waterHits = motions.reduce((sum, m) => sum + (m.waterImpactAt === null ? 0 : ease((m.age - m.waterImpactAt) / .28)), 0);
    const newest = motions[motions.length - 1];
    return { motions, waterY: initialWater(state) - clamp(waterHits, 0, goal(state)) * WATER_RISE, waterHits,
      splashAge: newest && newest.waterImpactAt !== null ? newest.age - newest.waterImpactAt : Infinity, newest };
  }
  function recordPlan(state, record, index, core) {
    if (state.shot && state.shot.plan && index === (state.shots || []).length - 1 &&
        state.shot.launchedAt === record.launchedAt) return state.shot.plan;
    const start = record.origin || record.from || {};
    const key = [configKey(state), record.launchedAt, start.x, start.y, record.vx0, record.vy0,
      record.ax, record.radius, record.stoneIndex].join('|');
    // Core retains original launch values but drops shot.plan after feedback.
    // Reconstruct on a new object once per shot; never mutate a saved record.
    return memo(store(core).plans, key, () => core.trajectory({ ...state, time: record.launchedAt,
      heldIndex: record.stoneIndex, shot: { ...record, origin: { ...start }, plan: null } }), 48);
  }
  function events(state, core) {
    const out = [], records = state.shots || [], now = number(state.time), motion = bottleMotion(state, core);
    function add(event) {
      if (Number.isFinite(event.time) && event.time <= now + EPS) out.push(event);
    }
    records.forEach((record, shotIndex) => {
      if (!Number.isFinite(record.launchedAt) || record.launchedAt > now + EPS) return;
      const material = spec(record, state), radius = material.radius, start = record.origin || record.from || {};
      const prefix = 'shot:' + shotIndex + ':' + record.launchedAt + ':' + material.index + ':';
      const shared = { radius, shotIndex };
      add({ ...shared, id: prefix + 'throw', kind: 'throw', time: record.launchedAt,
        x: start.x, y: start.y, intensity: clamp(Math.hypot(number(record.vx0), number(record.vy0)) / 640, .2, 1) });
      const plan = recordPlan(state, record, shotIndex, core);
      (plan.collisions || []).forEach((collision, index) => {
        const p = collision.contact || collision, velocity = collision.before || {};
        add({ ...shared, id: prefix + 'lid:' + index, kind: 'lid', time: record.launchedAt + collision.t,
          x: p.x, y: p.y, intensity: clamp(Math.hypot(number(velocity.vx), number(velocity.vy)) / 600, .15, 1) });
      });
      const m = motion.motions.find(value => value.shotIndex === shotIndex);
      if (m && m.waterImpactAt !== null) {
        add({ ...shared, id: prefix + 'water', kind: 'water', time: record.result.time + m.waterImpactAt,
          x: m.waterImpactX, y: m.waterImpactY, intensity: clamp(m.impactSpeed / 600 * radius / 10, .25, 1) });
      }
      const last = record.result;
      if (last && last.kind === 'miss') {
        const gravity = core.GRAVITY || 600, ground = (core.GROUND_Y || 505) - radius;
        const vy = number(last.vy), distance = ground - last.y;
        const elapsed = distance <= EPS && vy >= 0 ? 0 : (Math.sqrt(Math.max(0, vy * vy + 2 * gravity * distance)) - vy) / gravity;
        const x = last.x + number(last.vx) * elapsed + .5 * number(record.ax, number(state.cfg.wind)) * elapsed * elapsed;
        // A stone that has left the frame does not create dust or an apparent
        // impact inside the visible scene.
        if (elapsed >= 0 && x >= -radius && x <= 400 + radius) add({ ...shared,
          id: prefix + 'ground', kind: 'ground', time: last.time + elapsed, x, y: core.GROUND_Y || 505,
          intensity: clamp(Math.abs(vy + gravity * elapsed) / 650 * radius / 10, .2, 1) });
      }
    });
    if (state.phase === 'won' && Number.isFinite(state.wonAt)) {
      const p = core.mouth(state, state.wonAt - now);
      add({ id: 'win:' + state.wonAt, kind: 'win', time: state.wonAt, x: p.x, y: p.y,
        radius: 0, intensity: 1, shotIndex: records.length - 1 });
    }
    return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }
  function createCursor(options) {
    // Core advances at most .25 s in one tick; retain that entire step while
    // still suppressing older events when a view attaches after a long gap.
    const freshness = number(options && options.maxAge, .30);
    let seen = new Set(), previousTime = null, previousCount = 0, previousConfig = null;
    function reset() { seen = new Set(); previousTime = null; previousCount = 0; previousConfig = null; }
    function read(state, core) {
      const now = number(state.time), count = (state.shots || []).length, cfg = configKey(state);
      if (previousTime !== null && (now < previousTime - EPS || count < previousCount || cfg !== previousConfig)) reset();
      const fresh = [];
      for (const event of events(state, core)) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        // Never replay a backlog after backgrounding or first attaching late.
        if (now - event.time <= Math.max(0, freshness) + EPS) fresh.push(event);
      }
      // At most seven stones are available in a run. Bound the set even if a
      // future mode adds arbitrarily many records.
      while (seen.size > 256) seen.delete(seen.values().next().value);
      previousTime = now; previousCount = count; previousConfig = cfg;
      return fresh;
    }
    return { read, reset };
  }
  return Object.freeze({ bottleMotion, events, createCursor });
}));
