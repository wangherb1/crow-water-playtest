(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrowCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FEEDBACK = .45, EPS = 1e-10, TAU = Math.PI * 2;
  const ORIGIN = Object.freeze({ x: 76, y: 420 });
  const GRAVITY = 600, STONE_RADIUS = 6, AIM_SCALE = 4, MAX_DRAG = 160, MIN_DRAG = 16;
  const GROUND_Y = 505;
  const STONE_LAYOUT = Object.freeze([
    [48, 410, 8, 0, -.14], [114, 448, 10, 2, .19], [40, 489, 12, 1, -.26],
    [145, 488, 10, 2, -.11], [358, 484, 8, 0, .24],
    [100, 390, 12, 1, .13], [379, 434, 10, 2, -.21]
  ].map((row, index) => Object.freeze({ index, x: row[0], y: row[1], radius: row[2],
    spriteIndex: row[3], rotation: row[4], r: 24, active: true })));
  const MAX_INDEX = Number.MAX_SAFE_INTEGER - 1;
  const EGG_IDS = Object.freeze(['flock', 'rainbow', 'meteor']);
  const rows = [
    ['宽口瓶', 5, 0, 4.8, 0, 0, false, 36, 1],
    ['瓶口变窄', 5, 0, 4.8, 0, 0, false, 32, 1],
    ['缓慢摆动', 5, 12, 7, .6, 0, false, 29, 1],
    ['风向右吹', 5, 0, 4.5, 0, 14, false, 26, 1],
    ['风中摆动', 5, 26, 6, .8, -14, false, 26, 1],
    ['微风练习', 5, 0, 4.8, 0, -10, false, 28, 1],
    ['瓶盖开合', 5, 0, 5, 0, 0, true, 26, .68],
    ['摆动和瓶盖', 5, 30, 5.5, 0, 0, true, 24, .6],
    ['综合挑战', 4, 40, 5, 0, 16, true, 23, .55]
  ];

  function integer(value, fallback, max) {
    return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : fallback;
  }

  function finishConfig(cfg) {
    cfg.gatePeriod = cfg.period;
    cfg.openRatio = Number.isFinite(cfg.openRatio) ? cfg.openRatio : .48;
    cfg.gateOpen = cfg.gate ? cfg.period * cfg.openRatio : cfg.period;
    if (cfg.gate && cfg.amplitude > 0) {
      // A genuine alignment occurs at the middle of every open interval.
      cfg.phase = Math.asin(Math.max(-1, Math.min(1, cfg.wind / cfg.amplitude))) - TAU * (cfg.gateOpen / 2) / cfg.period;
    }
    cfg.goal = 3;
    return cfg;
  }

  const OUTLINE = Object.freeze(rows.map((row, index) => Object.freeze(finishConfig({
    index, mode: 'journey', title: row[0], region: Math.floor(index / 3),
    weather: index < 3 ? 'calm' : index < 6 ? 'wind' : 'night',
    ammo: row[1], amplitude: row[2], period: row[3], phase: row[4], wind: row[5], gate: row[6],
    mouthRx: row[7], openRatio: row[8], previewTarget: index < 3
  }))));

  function config(index = 0, mode = 'journey', seed = 1) {
    if (mode !== 'endless') return { ...OUTLINE[integer(index, 0, 8)] };
    index = integer(index, 0, MAX_INDEX);
    seed = integer(seed, 1, 0xffffffff) || 1;
    const variant = ((Math.imul((index % 96) + 1, 1103515245) ^ seed) >>> 0) % 12;
    const tier = Math.min(8, Math.floor(index / 3));
    const gate = variant % 3 !== 0;
    return finishConfig({ index, mode: 'endless', title: '连续挑战 · 第' + (index + 1) + '关',
      region: gate ? 2 : 1, weather: gate ? 'night' : 'wind', ammo: 4,
      amplitude: Math.min(68, 48 + tier * 2 + variant % 3),
      period: Math.max(2.7, 3.9 - tier * .13 - (variant % 2) * .08),
      phase: variant * TAU / 12, wind: (variant % 2 ? 1 : -1) * (14 + variant % 5 * 3), gate,
      mouthRx: index < 6 ? 23 : 21, openRatio: .48, previewTarget: false });
  }

  function create(index = 0, mode = 'journey', seed = 1) {
    seed = integer(seed, 1, 0xffffffff) || 1;
    const cfg = config(index, mode, seed);
    return { index: cfg.index, mode: cfg.mode, seed, cfg, time: 0, phase: 'idle', phaseTime: 0,
      hits: 0, spent: 0, misses: 0, shots: [], score: 0,
      scoreBreakdown: { hits: 0, accuracy: 0, stock: 0, perfect: 0, variety: 0 }, rescued: false,
      heldIndex: null, queuedRelease: false, shot: null, lastResult: null, wonAt: null,
      ammo: cfg.ammo, used: [], aim: zeroAim(), layout: STONE_LAYOUT.map(stone => ({ ...stone })) };
  }

  function zeroAim() { return { dx: 0, dy: 0, vx: 0, vy: 0, power: 0, valid: false }; }

  function copy(state) {
    return { ...state, cfg: { ...state.cfg }, aim: { ...state.aim }, scoreBreakdown: { ...state.scoreBreakdown }, used: state.used.slice(),
      layout: state.layout.map(stone => ({ ...stone })),
      shots: state.shots.map(shot => ({ ...shot, from: { ...shot.from }, origin: { ...shot.origin }, result: shot.result ? { ...shot.result } : null })),
      shot: state.shot ? { ...state.shot, from: { ...state.shot.from }, origin: { ...state.shot.origin } } : null,
      lastResult: state.lastResult ? { ...state.lastResult } : null };
  }

  function mouth(state, offset = 0) {
    const cfg = state.cfg, time = state.time + (Number.isFinite(offset) ? offset : 0);
    const cycle = ((time % cfg.gatePeriod) + cfg.gatePeriod) % cfg.gatePeriod;
    return { x: 247 + cfg.amplitude * Math.sin(TAU * time / cfg.period + cfg.phase),
      y: 254, rx: cfg.mouthRx, open: !cfg.gate || cycle < cfg.gateOpen };
  }

  function stones(state) {
    return state.layout.filter(stone => (stone.index < state.cfg.ammo || state.rescued && stone.index >= 5) &&
      !state.used.includes(stone.index)).map(stone => ({ ...stone }));
  }

  function origin(state) {
    if (state.shot && state.shot.origin) return { ...state.shot.origin };
    const stone = state.layout.find(value => value.index === state.heldIndex) || stones(state)[0] || state.layout[0];
    return { x: stone.x, y: stone.y };
  }

  function radius(state) {
    if (state.shot && Number.isFinite(state.shot.radius)) return state.shot.radius;
    const stone = state.layout.find(value => value.index === state.heldIndex) || stones(state)[0] || state.layout[0];
    return stone.radius;
  }

  function press(state, stoneIndex) {
    const next = copy(state);
    if (next.phase !== 'idle') return next;
    const stone = stones(next).find(value => value.index === stoneIndex && value.active);
    if (!stone) return next;
    next.phase = 'held'; next.phaseTime = 0; next.heldIndex = stoneIndex; next.queuedRelease = false;
    next.aim = zeroAim();
    next.shot = { stoneIndex, from: { ...stone }, origin: { x: stone.x, y: stone.y },
      radius: stone.radius, spriteIndex: stone.spriteIndex, rotation: stone.rotation,
      progress: 0, x: stone.x, y: stone.y };
    return next;
  }

  function aim(state, dx, dy) {
    const next = copy(state);
    if (next.phase !== 'held') return next;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) { next.aim = zeroAim(); return next; }
    const length = Math.hypot(dx, dy), scale = length > MAX_DRAG ? MAX_DRAG / length : 1;
    dx *= scale; dy *= scale;
    next.aim = { dx, dy, vx: dx * AIM_SCALE, vy: dy * AIM_SCALE,
      power: Math.min(length, MAX_DRAG) / MAX_DRAG, valid: length >= MIN_DRAG && dy < 0 };
    return next;
  }

  function motion(state) {
    if (state.shot && Number.isFinite(state.shot.vx0)) return { vx: state.shot.vx0, vy: state.shot.vy0, ax: state.shot.ax };
    return { vx: state.aim.vx, vy: state.aim.vy, ax: state.cfg.wind };
  }

  function flight(state, seconds) {
    const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0, v = motion(state), start = origin(state);
    return { x: start.x + v.vx * t + .5 * v.ax * t * t,
      y: start.y + v.vy * t + .5 * GRAVITY * t * t,
      vx: v.vx + v.ax * t, vy: v.vy + GRAVITY * t };
  }

  function positiveRoots(a, b, c) {
    if (Math.abs(a) < EPS) return Math.abs(b) < EPS ? [] : [-c / b].filter(t => t > EPS);
    const d = b * b - 4 * a * c;
    if (d < 0) return [];
    const root = Math.sqrt(d);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > EPS);
  }

  function trajectory(state) {
    const v = motion(state), start = origin(state), stoneRadius = radius(state);
    const ground = (-v.vy + Math.sqrt(v.vy * v.vy + 2 * GRAVITY * (GROUND_Y - stoneRadius - start.y))) / GRAVITY;
    const boundaries = positiveRoots(.5 * v.ax, v.vx, start.x - stoneRadius)
      .concat(positiveRoots(.5 * v.ax, v.vx, start.x - (400 - stoneRadius)));
    const boundary = boundaries.length ? Math.min(...boundaries) : Infinity;
    const d = v.vy * v.vy - 2 * GRAVITY * (start.y - 254);
    const descent = v.vy < 0 && d > EPS ? (-v.vy + Math.sqrt(d)) / GRAVITY : Infinity;
    const duration = Math.min(ground, boundary, descent);
    const terminal = descent <= ground && descent <= boundary ? 'mouth' : boundary < ground ? 'boundary' : 'ground';
    let crossing = null;
    if (terminal === 'mouth') {
      const p = flight(state, descent);
      crossing = { x: p.x, y: 254, t: descent, vx: p.vx, vy: p.vy };
    }
    const points = Array.from({ length: 25 }, (_, i) => {
      const t = duration * i / 24, p = flight(state, t);
      return { x: p.x, y: p.y, t };
    });
    return { points, crossing, duration, terminal };
  }

  function launch(next) {
    const plan = trajectory(next), start = origin(next);
    next.spent++; next.used.push(next.heldIndex);
    next.phase = 'falling'; next.phaseTime = 0; next.queuedRelease = false;
    Object.assign(next.shot, { progress: 0, x: start.x, y: start.y,
      vx0: next.aim.vx, vy0: next.aim.vy, vx: next.aim.vx, vy: next.aim.vy,
      ax: next.cfg.wind, flightTime: 0, duration: plan.duration, terminal: plan.terminal, launchedAt: next.time });
    next.shots.push({ stoneIndex: next.heldIndex, from: { ...next.shot.from }, origin: { ...next.shot.origin },
      radius: next.shot.radius, spriteIndex: next.shot.spriteIndex, rotation: next.shot.rotation,
      launchedAt: next.time, vx0: next.aim.vx, vy0: next.aim.vy, ax: next.cfg.wind, result: null });
  }

  function release(state) {
    const next = copy(state);
    if (next.phase === 'held') {
      if (!next.aim.valid) return cancel(next);
      launch(next);
    }
    return next;
  }

  function cancel(state) {
    const next = copy(state);
    if (next.phase === 'held') {
      next.phase = 'idle'; next.phaseTime = 0; next.heldIndex = null;
      next.queuedRelease = false; next.shot = null; next.aim = zeroAim();
    }
    return next;
  }

  function impact(next) {
    const target = mouth(next), error = Math.abs(next.shot.x - target.x);
    const tolerance = target.rx - next.shot.radius;
    const atMouth = next.shot.terminal === 'mouth';
    const hit = atMouth && error <= tolerance + EPS && target.open;
    const reason = hit ? null : next.shot.terminal === 'ground' ? 'short' :
      !atMouth || error > tolerance + EPS ? 'wide' : 'closed';
    const basePoints = hit ? 100 : 0;
    const precisionPoints = hit ? Math.round(50 * Math.max(0, 1 - error / tolerance)) : 0;
    next.lastResult = { kind: hit ? 'hit' : 'miss', reason,
      x: next.shot.x, y: atMouth ? 254 : next.shot.y, vx: next.shot.vx, vy: next.shot.vy,
      time: next.time, stoneIndex: next.shot.stoneIndex,
      radius: next.shot.radius, spriteIndex: next.shot.spriteIndex, rotation: next.shot.rotation,
      mouthX: target.x, open: target.open, error, basePoints, precisionPoints };
    next.shots[next.shots.length - 1].result = { ...next.lastResult };
    if (hit) {
      next.hits++;
      next.scoreBreakdown.hits += basePoints;
      next.scoreBreakdown.accuracy += precisionPoints;
      next.score = Object.values(next.scoreBreakdown).reduce((total, points) => total + points, 0);
    }
    else next.misses++;
    next.phase = 'feedback'; next.phaseTime = 0; next.heldIndex = null;
  }

  function afterFeedback(next) {
    if (next.hits >= next.cfg.goal) {
      next.phase = 'won'; next.wonAt = next.time;
      next.scoreBreakdown.stock = next.rescued ? 0 : Math.max(0, next.cfg.ammo - next.spent) * 20;
      next.scoreBreakdown.perfect = next.misses === 0 && !next.rescued ? 150 : 0;
      const materials = new Set(next.shots.filter(shot => shot.result && shot.result.kind === 'hit').map(shot => shot.spriteIndex));
      next.scoreBreakdown.variety = materials.size === 3 ? 50 : 0;
      next.score = Object.values(next.scoreBreakdown).reduce((total, points) => total + points, 0);
    } else next.phase = next.ammo - next.spent < next.cfg.goal - next.hits ? 'lost' : 'idle';
    next.phaseTime = 0; next.shot = null;
  }

  function tick(state, dt) {
    const next = copy(state);
    let left = Number.isFinite(dt) ? Math.max(0, Math.min(.25, dt)) : 0;
    while (left > EPS) {
      const duration = next.phase === 'falling' ? next.shot.duration : next.phase === 'feedback' ? FEEDBACK : Infinity;
      const step = Math.min(left, 1 / 120, Math.max(0, duration - next.phaseTime));
      next.time += step; next.phaseTime += step; left -= step;
      if (next.phase === 'falling') {
        next.shot.flightTime = Math.min(next.phaseTime, next.shot.duration);
        Object.assign(next.shot, flight(next, next.shot.flightTime));
        next.shot.progress = Math.min(1, next.shot.flightTime / next.shot.duration);
        if (next.phaseTime + EPS >= next.shot.duration) {
          next.shot.flightTime = next.shot.duration;
          Object.assign(next.shot, flight(next, next.shot.duration));
          next.shot.progress = 1;
          impact(next);
        }
      } else if (next.phase === 'feedback' && next.phaseTime + EPS >= FEEDBACK) afterFeedback(next);
    }
    return next;
  }

  function rescue(state) {
    const next = copy(state);
    if (next.phase === 'lost' && !next.rescued) {
      next.ammo += 2; next.rescued = true; next.phase = 'idle'; next.phaseTime = 0;
      next.heldIndex = null; next.queuedRelease = false; next.shot = null;
    }
    return next;
  }

  function retry(state) { return create(state.index, state.mode, state.seed); }

  function normalizeSave(raw) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const source = raw.best && typeof raw.best === 'object' && !Array.isArray(raw.best) ? raw.best : {};
    const best = {};
    let unlocked = 0;
    while (unlocked < 9) {
      const score = source[unlocked];
      if (!Number.isInteger(score) || score <= 0 || score > 1000) break;
      best[unlocked] = score; unlocked++;
    }
    const perfect = Array.isArray(raw.perfect) ? [...new Set(raw.perfect.filter(index =>
      Number.isInteger(index) && index >= 0 && index < unlocked))].sort((a, b) => a - b) : [];
    const variety = Array.isArray(raw.variety) ? [...new Set(raw.variety.filter(index =>
      Number.isInteger(index) && index >= 0 && index < unlocked))].sort((a, b) => a - b) : [];
    const bestStreak = integer(raw.bestStreak, 0, Number.MAX_SAFE_INTEGER);
    const oldEggs = Array.isArray(raw.eggs) ? raw.eggs : [];
    const eggs = [];
    if (perfect.length || bestStreak > 0 && oldEggs.includes('flock')) eggs.push('flock');
    if (unlocked > 5) eggs.push('rainbow');
    if (bestStreak >= 3) eggs.push('meteor');
    return { version: 1, unlocked, best, perfect, variety, eggs,
      totalScore: Object.values(best).reduce((total, score) => total + score, 0), bestStreak };
  }

  function award(save, state) {
    const next = normalizeSave(save);
    if (!state || state.phase !== 'won') return next;
    const clean = state.hits === 3 && state.spent === 3 && state.misses === 0 && !state.rescued;
    if (state.mode === 'endless') {
      next.bestStreak = Math.max(next.bestStreak, state.index + 1);
      if (clean && !next.eggs.includes('flock')) next.eggs.push('flock');
    } else {
      if (state.index > next.unlocked || state.index < 0 || state.index > 8) return next;
      next.best[state.index] = Math.max(next.best[state.index] || 0, Math.round(state.score));
      if (clean && !next.perfect.includes(state.index)) next.perfect.push(state.index);
      if (state.scoreBreakdown.variety > 0 && !next.variety.includes(state.index)) next.variety.push(state.index);
    }
    return normalizeSave(next);
  }

  return Object.freeze({ OUTLINE, EGG_IDS, ORIGIN, GRAVITY, STONE_RADIUS, GROUND_Y, AIM_SCALE, MAX_DRAG, MIN_DRAG,
    config, create, mouth, stones, origin, press, aim, flight, trajectory, release, cancel,
    tick, rescue, retry, normalizeSave, award });
}));
