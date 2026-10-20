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
  const LID_RADIUS = 3.5, LID_ANGLE = -1.8, CONTACT_EPS = .0001, CONTACT_SLOP = .002;
  const MAX_FLIGHT = 8, CONTACT_STEP = 1 / 240;
  const planCache = new WeakMap();
  const STONE_LAYOUT = Object.freeze([
    [48, 410, 8, 0, -.14], [114, 448, 10, 2, .19], [40, 489, 12, 1, -.26],
    [145, 488, 10, 2, -.11], [358, 484, 8, 0, .24],
    [100, 390, 12, 1, .13], [379, 434, 10, 2, -.21]
  ].map((row, index) => Object.freeze({ index, x: row[0], y: row[1], radius: row[2],
    spriteIndex: row[3], rotation: row[4], r: 24, active: true })));
  const STREAM_STONE_LAYOUT = Object.freeze([
    [350, 496, 8, 0, -.14], [285, 495, 10, 2, .19], [220, 493, 12, 1, -.26],
    [75, 395, 10, 2, -.11], [115, 330, 8, 0, .24],
    [35, 365, 12, 1, .13], [365, 320, 10, 2, -.21]
  ].map((row, index) => Object.freeze({ index, x: row[0], y: row[1], radius: row[2],
    spriteIndex: row[3], rotation: row[4], r: 24, active: true })));
  const CAMPAIGN_ID = 'compact-v1';
  const SCENES = Object.freeze([
    Object.freeze({ id: 'courtyard', title: '庭院', region: 0 }),
    Object.freeze({ id: 'rooftop', title: '屋檐', region: 1 }),
    Object.freeze({ id: 'stream', title: '溪边', region: 2 })
  ]);
  const EGG_IDS = Object.freeze(['flock', 'rainbow', 'meteor']);
  const rows = [
    ['先让乌鸦喝一口', 7, 0, 4.8, 0, 0, false, 36, 1, 0, 3],
    ['剩下的石子继续用', 7, 18, 6.8, .6, 0, false, 34, 1, 2, 4],
    ['留好最后几颗', 7, 24, 5.8, 0, 38, true, 32, .72, 1, 4]
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
    cfg.goal = integer(cfg.goal, 3, 3) || 3;
    cfg.scene = SCENES[cfg.region].id;
    cfg.support = cfg.scene === 'stream' ? 'raft' : 'rope';
    return cfg;
  }

  const OUTLINE = Object.freeze(rows.map((row, index) => Object.freeze(finishConfig({
    index, mode: 'journey', title: row[0], region: row[9],
    weather: row[5] ? 'wind' : 'calm', goal: 3, waterGoal: row[10],
    ammo: row[1], amplitude: row[2], period: row[3], phase: row[4], wind: row[5], gate: row[6],
    mouthRx: row[7], openRatio: row[8], previewTarget: index < 2
  }))));

  function config(index = 0, mode = 'journey', seed = 1) {
    return { ...OUTLINE[integer(index, 0, OUTLINE.length - 1)], mode: mode === 'practice' ? 'practice' : 'journey' };
  }

  function create(index = 0, mode = 'journey', seed = 1) {
    seed = integer(seed, 1, 0xffffffff) || 1;
    const cfg = config(index, mode, seed);
    return { index: cfg.index, mode: cfg.mode, seed, cfg, time: 0, phase: 'idle', phaseTime: 0,
      hits: 0, spent: 0, misses: 0, shots: [], water: 0, score: 0,
      runShots: [], runSpent: 0, runMisses: 0, runScore: 0, runWater: 0, runId: null, completedBottles: [],
      lossReason: null,
      scoreBreakdown: { hits: 0, accuracy: 0, stock: 0, perfect: 0, variety: 0 }, rescued: false,
      heldIndex: null, queuedRelease: false, shot: null, lastResult: null, wonAt: null,
      ammo: cfg.ammo, used: [], aim: zeroAim(),
      layout: (cfg.scene === 'stream' ? STREAM_STONE_LAYOUT : STONE_LAYOUT).map(stone => ({ ...stone, waterValue: stoneWater(stone) })) };
  }

  function zeroAim() { return { dx: 0, dy: 0, vx: 0, vy: 0, power: 0, valid: false }; }

  function copy(state) {
    return { ...state, cfg: { ...state.cfg }, aim: { ...state.aim }, scoreBreakdown: { ...state.scoreBreakdown }, used: state.used.slice(),
      completedBottles: (state.completedBottles || []).slice(),
      layout: state.layout.map(stone => ({ ...stone })),
      runShots: (state.runShots || []).map(cloneShot),
      shots: state.shots.map(shot => ({ ...shot, from: { ...shot.from }, origin: { ...shot.origin }, result: shot.result ? { ...shot.result } : null })),
      shot: state.shot ? { ...state.shot, from: { ...state.shot.from }, origin: { ...state.shot.origin } } : null,
      lastResult: state.lastResult ? { ...state.lastResult } : null };
  }

  function cloneShot(shot) {
    return { ...shot, from: { ...shot.from }, origin: { ...shot.origin }, result: shot.result ? { ...shot.result } : null };
  }

  function stoneWater(stone) {
    const r = stone && stone.radius;
    return r >= 12 ? 3 : r >= 10 ? 2 : 1;
  }

  function remainingWater(state) {
    return stones(state).reduce((total, stone) => total + stoneWater(stone), 0);
  }

  function remainingRequired(state) {
    const current = Math.max(0, state.cfg.waterGoal - state.water);
    return current + (state.mode === 'journey' ? OUTLINE.slice(state.index + 1).reduce((total, cfg) => total + cfg.waterGoal, 0) : 0);
  }

  function canFinishRun(state) {
    const needs = [Math.max(0, state.cfg.waterGoal - state.water)];
    if (state.mode === 'journey') needs.push(...OUTLINE.slice(state.index + 1).map(cfg => cfg.waterGoal));
    while (needs[0] === 0) needs.shift();
    if (!needs.length) return true;
    const values = stones(state).map(stoneWater), memo = new Map();
    if (values.reduce((sum, value) => sum + value, 0) < needs.reduce((sum, value) => sum + value, 0)) return false;
    // Stones cannot be split. Search the tiny bag (at most nine identities), including water lost to overflow.
    function place(mask, bottle, need) {
      if (bottle >= needs.length) return true;
      const key = mask + ':' + bottle + ':' + need;
      if (memo.has(key)) return memo.get(key);
      const tried = new Set();
      for (let index = 0; index < values.length; index++) {
        if (mask & (1 << index) || tried.has(values[index])) continue;
        tried.add(values[index]);
        const rest = need - values[index], nextMask = mask | (1 << index);
        if (rest <= 0 ? place(nextMask, bottle + 1, needs[bottle + 1]) : place(nextMask, bottle, rest)) {
          memo.set(key, true); return true;
        }
      }
      memo.set(key, false); return false;
    }
    return place(0, 0, needs[0]);
  }

  function mouth(state, offset = 0) {
    const cfg = state.cfg, time = state.time + (Number.isFinite(offset) ? offset : 0);
    const cycle = ((time % cfg.gatePeriod) + cfg.gatePeriod) % cfg.gatePeriod;
    return { x: 247 + cfg.amplitude * Math.sin(TAU * time / cfg.period + cfg.phase),
      y: 254, rx: cfg.mouthRx, open: !cfg.gate || cycle < cfg.gateOpen };
  }

  // This capsule is both the rendered plate and the collider. Opening has a
  // smooth, periodic hinge motion; mouth.open remains only a coarse UI hint.
  function lidGeometry(state, offset = 0) {
    if (!state.cfg.gate) return null;
    const cfg = state.cfg, time = state.time + (Number.isFinite(offset) ? offset : 0);
    const cycle = ((time % cfg.gatePeriod) + cfg.gatePeriod) % cfg.gatePeriod;
    const transition = Math.min(.6, (cfg.gatePeriod - cfg.gateOpen) * .45);
    let amount = 1, rate = 0, phase = 'open';
    if (cycle >= cfg.gateOpen && cycle < cfg.gateOpen + transition) {
      const u = (cycle - cfg.gateOpen) / transition;
      amount = 1 - u * u * (3 - 2 * u); rate = -6 * u * (1 - u) / transition; phase = 'closing';
    } else if (cycle >= cfg.gateOpen + transition && cycle < cfg.gatePeriod - transition) {
      amount = 0; phase = 'closed';
    } else if (cycle >= cfg.gatePeriod - transition) {
      const u = (cycle - (cfg.gatePeriod - transition)) / transition;
      amount = u * u * (3 - 2 * u); rate = 6 * u * (1 - u) / transition; phase = 'opening';
    }
    const target = mouth(state, offset), angle = LID_ANGLE * amount, angularVelocity = LID_ANGLE * rate;
    const a = { x: target.x - target.rx - 4, y: 250 }, length = 2 * target.rx + 8;
    const b = { x: a.x + length * Math.cos(angle), y: a.y + length * Math.sin(angle) };
    const velocityA = { vx: cfg.amplitude * TAU / cfg.period * Math.cos(TAU * time / cfg.period + cfg.phase), vy: 0 };
    const velocityB = { vx: velocityA.vx - angularVelocity * (b.y - a.y), vy: angularVelocity * (b.x - a.x) };
    return { a, b, radius: LID_RADIUS, angle, open: target.open, phase, angularVelocity, velocityA, velocityB };
  }

  function stones(state) {
    return state.layout.filter(stone => !state.used.includes(stone.index)).map(stone => ({ ...stone }));
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
      waterValue: stoneWater(stone),
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

  function ballistic(segment, seconds) {
    const t = seconds - segment.t0;
    if (segment.contact) {
      const u = Math.max(0, Math.min(1, t / (segment.t1 - segment.t0)));
      return { x: segment.x + (segment.end.x - segment.x) * u,
        y: segment.y + (segment.end.y - segment.y) * u,
        vx: segment.vx + (segment.end.vx - segment.vx) * u,
        vy: segment.vy + (segment.end.vy - segment.vy) * u, bounceCount: segment.bounceCount };
    }
    return { x: segment.x + segment.vx * t + .5 * segment.ax * t * t,
      y: segment.y + segment.vy * t + .5 * segment.ay * t * t,
      vx: segment.vx + segment.ax * t, vy: segment.vy + segment.ay * t, bounceCount: segment.bounceCount };
  }

  function samplePlan(plan, seconds) {
    const t = Math.max(0, Math.min(plan.duration, seconds));
    // After an impact, the segment beginning at that instant owns its sample.
    let lo = 0, hi = plan.segments.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (plan.segments[mid].t0 <= t) lo = mid; else hi = mid - 1; }
    return ballistic(plan.segments[lo], t);
  }

  function flight(state, seconds) {
    return samplePlan(trajectory(state), Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  }

  function positiveRoots(a, b, c) {
    if (Math.abs(a) < EPS) return Math.abs(b) < EPS ? [] : [-c / b].filter(t => t > EPS);
    const d = b * b - 4 * a * c;
    if (d < 0) return [];
    const root = Math.sqrt(d);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > EPS);
  }

  function capsuleDistance(point, lid, stoneRadius) {
    const dx = lid.b.x - lid.a.x, dy = lid.b.y - lid.a.y;
    const u = Math.max(0, Math.min(1, ((point.x - lid.a.x) * dx + (point.y - lid.a.y) * dy) / (dx * dx + dy * dy)));
    const center = { x: lid.a.x + dx * u, y: lid.a.y + dy * u };
    const nx = point.x - center.x, ny = point.y - center.y, distance = Math.hypot(nx, ny);
    const normal = distance > EPS ? { x: nx / distance, y: ny / distance } : { x: -Math.sin(lid.angle), y: Math.cos(lid.angle) };
    return { gap: distance - lid.radius - stoneRadius, normal, center,
      contact: { x: center.x + normal.x * lid.radius, y: center.y + normal.y * lid.radius },
      velocity: { vx: lid.velocityA.vx + (lid.velocityB.vx - lid.velocityA.vx) * u,
        vy: lid.velocityA.vy + (lid.velocityB.vy - lid.velocityA.vy) * u } };
  }

  function nextTerminal(segment, stoneRadius) {
    const ground = positiveRoots(.5 * GRAVITY, segment.vy, segment.y - (GROUND_Y - stoneRadius))[0] || Infinity;
    const boundaries = positiveRoots(.5 * segment.ax, segment.vx, segment.x - stoneRadius)
      .concat(positiveRoots(.5 * segment.ax, segment.vx, segment.x - (400 - stoneRadius)));
    const boundary = boundaries.length ? Math.min(...boundaries) : Infinity;
    const descents = positiveRoots(.5 * GRAVITY, segment.vy, segment.y - 254).filter(t => segment.vy + GRAVITY * t > EPS);
    const descent = descents.length ? Math.min(...descents) : Infinity;
    const remaining = MAX_FLIGHT - segment.t0, dt = Math.min(ground, boundary, descent, remaining);
    return { t: segment.t0 + dt, terminal: dt === descent ? 'mouth' : dt === boundary ? 'boundary' : dt === ground ? 'ground' : 'timeout' };
  }

  // Conservative advancement uses a bound on both the ball and every point of
  // the moving plate. It approaches first contact without stepping through it,
  // including the rounded end caps, upward hits and rotating plates.
  function firstContact(state, segment, end, stoneRadius) {
    if (!state.cfg.gate) return null;
    const cfg = state.cfg, transition = Math.min(.6, (cfg.gatePeriod - cfg.gateOpen) * .45);
    const wallSpeed = Math.abs(cfg.amplitude * TAU / cfg.period) + (2 * cfg.mouthRx + 8) * Math.abs(LID_ANGLE) * 1.5 / transition;
    let t = segment.t0;
    for (let iterations = 0; t <= end && iterations < 16000; iterations++) {
      const p = ballistic(segment, t), lid = lidGeometry(state, t), d = capsuleDistance(p, lid, stoneRadius);
      if (d.gap <= CONTACT_EPS) return { ...d, t, p, lid };
      if (t >= end) return null;
      const horizon = Math.min(.025, end - t);
      const speed = Math.hypot(p.vx, p.vy) + Math.hypot(segment.ax, GRAVITY) * horizon + wallSpeed;
      t += Math.min(horizon, Math.max(1e-9, .9 * d.gap / Math.max(1, speed)));
    }
    return null;
  }

  function passiveBounce(before, normal, wall) {
    const relative = (before.vx - wall.vx) * normal.x + (before.vy - wall.vy) * normal.y;
    const impulse = Math.max(0, -1.5 * relative);
    let vx = before.vx + impulse * normal.x, vy = before.vy + impulse * normal.y;
    const speed = Math.hypot(vx, vy), limit = Math.hypot(before.vx, before.vy);
    if (speed > limit && speed > EPS) { vx *= limit / speed; vy *= limit / speed; }
    return { vx, vy };
  }

  function freezePlan(value) {
    Object.values(value).forEach(child => { if (child && typeof child === 'object' && !Object.isFrozen(child)) freezePlan(child); });
    return Object.freeze(value);
  }

  function trajectory(state) {
    if (state.shot && state.shot.plan) return state.shot.plan;
    const v = motion(state), start = origin(state), stoneRadius = radius(state), segments = [], collisions = [];
    const cfg = state.cfg, key = [state.time, v.vx, v.vy, v.ax, start.x, start.y, stoneRadius,
      cfg.gate, cfg.amplitude, cfg.period, cfg.phase, cfg.gatePeriod, cfg.gateOpen, cfg.mouthRx].join('|');
    const cached = planCache.get(state);
    if (cached && cached.key === key) return cached.plan;
    let segment = { t0: 0, t1: 0, x: start.x, y: start.y, vx: v.vx, vy: v.vy, ax: v.ax, ay: GRAVITY, bounceCount: 0 };
    let duration = 0, terminal = 'timeout', contactRun = false;
    for (let guard = 0; guard < 5000 && segment.t0 < MAX_FLIGHT - EPS; guard++) {
      const ending = nextTerminal(segment, stoneRadius);
      const collision = firstContact(state, segment, ending.t, stoneRadius);
      if (!collision) {
        segment.t1 = ending.t; segments.push(segment); duration = ending.t; terminal = ending.terminal; break;
      }
      segment.t1 = collision.t;
      if (segment.t1 > segment.t0 + EPS) segments.push(segment);
      const { p, normal, contact, velocity } = collision;
      const before = { vx: p.vx, vy: p.vy }, after = passiveBounce(before, normal, velocity);
      if (!contactRun) collisions.push({ t: collision.t, x: p.x, y: p.y, contact, normal,
        before, after, phase: collision.lid.phase });
      const separation = (after.vx - velocity.vx) * normal.x + (after.vy - velocity.vy) * normal.y;
      segment = { t0: collision.t, t1: collision.t, x: p.x + normal.x * (CONTACT_SLOP - Math.min(0, collision.gap)),
        y: p.y + normal.y * (CONTACT_SLOP - Math.min(0, collision.gap)),
        vx: after.vx, vy: after.vy, ax: v.ax, ay: GRAVITY, bounceCount: collisions.length };
      contactRun = separation < 1 || Math.hypot(after.vx, after.vy) < 12;
      // A moving lid can sweep a nearly stationary ball. Surface transport is
      // positional only: never turn the lid motor into extra launch velocity.
      // Its short, explicit segments also prevent zero-time repeat impacts.
      if (contactRun) {
        const end = Math.min(MAX_FLIGHT, segment.t0 + CONTACT_STEP), p1 = ballistic(segment, end);
        const d = capsuleDistance(p1, lidGeometry(state, end), stoneRadius);
        if (d.gap < CONTACT_SLOP) {
          p1.x += d.normal.x * (CONTACT_SLOP - d.gap); p1.y += d.normal.y * (CONTACT_SLOP - d.gap);
          const vn = p1.vx * d.normal.x + p1.vy * d.normal.y;
          if (vn < 0) { p1.vx -= vn * d.normal.x; p1.vy -= vn * d.normal.y; }
        } else contactRun = false;
        segment.t1 = end; segment.contact = true; segment.end = p1; segments.push(segment);
        segment = { t0: end, t1: end, x: p1.x, y: p1.y, vx: p1.vx, vy: p1.vy, ax: v.ax, ay: GRAVITY, bounceCount: collisions.length };
      }
      duration = segment.t0;
    }
    if (!segments.length || segments[segments.length - 1].t1 < duration) {
      segment.t1 = duration; segments.push(segment);
    }
    const plan = { points: [], segments, collisions, crossing: null, duration, terminal, result: null };
    const p = samplePlan(plan, duration), target = mouth(state, duration), error = Math.abs(p.x - target.x);
    const hit = terminal === 'mouth' && error <= target.rx - stoneRadius + EPS;
    if (terminal === 'mouth') plan.crossing = { x: p.x, y: 254, t: duration, vx: p.vx, vy: p.vy };
    plan.result = { kind: hit ? 'hit' : 'miss', reason: hit ? null : collisions.length ? 'lid' : terminal === 'ground' ? 'short' : 'wide',
      x: p.x, y: terminal === 'mouth' ? 254 : p.y, vx: p.vx, vy: p.vy, t: duration,
      mouthX: target.x, error, open: target.open, bounceCount: collisions.length };
    const times = Array.from({ length: 33 }, (_, i) => duration * i / 32)
      .concat(collisions.map(c => c.t)).sort((a,b) => a-b);
    plan.points = times.map(t => { const value = samplePlan(plan, t); return { x: value.x, y: value.y, t }; });
    freezePlan(plan); planCache.set(state, { key, plan }); return plan;
  }

  function launch(next) {
    const plan = trajectory(next), start = origin(next);
    next.spent++; next.runSpent++; next.used.push(next.heldIndex);
    next.phase = 'falling'; next.phaseTime = 0; next.queuedRelease = false;
    Object.assign(next.shot, { progress: 0, x: start.x, y: start.y,
      vx0: next.aim.vx, vy0: next.aim.vy, vx: next.aim.vx, vy: next.aim.vy,
      ax: next.cfg.wind, flightTime: 0, duration: plan.duration, terminal: plan.terminal, launchedAt: next.time,
      plan, bounceCount: 0 });
    next.shots.push({ stoneIndex: next.heldIndex, from: { ...next.shot.from }, origin: { ...next.shot.origin },
      radius: next.shot.radius, spriteIndex: next.shot.spriteIndex, rotation: next.shot.rotation,
      waterValue: stoneWater(next.shot), bottleIndex: next.index,
      launchedAt: next.time, vx0: next.aim.vx, vy0: next.aim.vy, ax: next.cfg.wind, result: null });
    next.runShots.push(cloneShot(next.shots[next.shots.length - 1]));
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
    const planned = next.shot.plan.result, target = mouth(next), error = planned.error;
    const tolerance = target.rx - next.shot.radius;
    const atMouth = next.shot.terminal === 'mouth';
    const hit = planned.kind === 'hit', reason = planned.reason;
    const waterValue = stoneWater(next.shot);
    const waterAdded = hit ? Math.min(waterValue, Math.max(0, next.cfg.waterGoal - next.water)) : 0;
    // Reward useful displacement. More throws or overflowing the bottle cannot farm base points.
    const basePoints = waterAdded * 100;
    const precisionPoints = hit ? Math.round(waterAdded * 50 * Math.max(0, 1 - error / tolerance)) : 0;
    next.lastResult = { kind: hit ? 'hit' : 'miss', reason,
      x: next.shot.x, y: atMouth ? 254 : next.shot.y, vx: next.shot.vx, vy: next.shot.vy,
      time: next.shot.launchedAt + next.shot.duration, stoneIndex: next.shot.stoneIndex,
      radius: next.shot.radius, spriteIndex: next.shot.spriteIndex, rotation: next.shot.rotation,
      waterValue, waterAdded,
      mouthX: planned.mouthX, open: planned.open, error, basePoints, precisionPoints, bounceCount: planned.bounceCount };
    next.shots[next.shots.length - 1].result = { ...next.lastResult };
    next.runShots[next.runShots.length - 1].result = { ...next.lastResult };
    if (hit) {
      next.hits++;
      next.water += waterAdded; next.runWater += waterAdded;
      next.scoreBreakdown.hits += basePoints;
      next.scoreBreakdown.accuracy += precisionPoints;
      next.score = Object.values(next.scoreBreakdown).reduce((total, points) => total + points, 0);
      next.runScore = next.score;
    }
    else { next.misses++; next.runMisses++; }
    next.phase = 'feedback'; next.phaseTime = 0; next.heldIndex = null;
  }

  function afterFeedback(next) {
    next.lossReason = null;
    if (remainingWater(next) < remainingRequired(next)) {
      next.phase = 'lost'; next.lossReason = 'water_shortage';
    } else if (!canFinishRun(next)) {
      next.phase = 'lost'; next.lossReason = 'water_combination';
    } else if (next.water >= next.cfg.waterGoal) {
      next.phase = 'won'; next.wonAt = next.time;
      if (!next.completedBottles.includes(next.index)) next.completedBottles.push(next.index);
      if (next.mode === 'practice' || next.index === OUTLINE.length - 1) {
        next.scoreBreakdown.stock = next.rescued ? 0 : stones(next).length * 30;
        next.scoreBreakdown.perfect = next.runMisses === 0 && !next.rescued ? 150 : 0;
        const materials = new Set(next.runShots.filter(shot => shot.result && shot.result.kind === 'hit').map(shot => shot.spriteIndex));
        next.scoreBreakdown.variety = materials.size === 3 ? 50 : 0;
        next.score = Object.values(next.scoreBreakdown).reduce((total, points) => total + points, 0);
        next.runScore = next.score;
      }
    } else next.phase = 'idle';
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
      // Reuse two vacated positions, with fresh identities. Survivors never move.
      const slots = next.layout.filter(stone => stone.index < 7 && next.used.includes(stone.index)).slice(0, 2);
      if (slots.length !== 2) return next;
      const specs = [{ radius: 12, spriteIndex: 1 }, { radius: 10, spriteIndex: 2 }];
      slots.forEach((slot, i) => next.layout.push({ ...slot, ...specs[i], index: 7 + i, slotIndex: slot.index,
        y: Math.min(slot.y, GROUND_Y - specs[i].radius), waterValue: stoneWater(specs[i]) }));
      next.ammo += 2; next.rescued = true; next.phase = 'idle'; next.phaseTime = 0; next.lossReason = null;
      next.heldIndex = null; next.queuedRelease = false; next.shot = null;
      afterFeedback(next);
    }
    return next;
  }

  function continueRun(state) {
    if (state.phase !== 'won' || state.mode !== 'journey' || state.index >= OUTLINE.length - 1) return copy(state);
    const next = create(state.index + 1, state.mode, state.seed);
    next.used = state.used.slice();
    next.runShots = state.runShots.map(cloneShot);
    next.runSpent = state.runSpent; next.runMisses = state.runMisses; next.runScore = state.runScore;
    next.runWater = state.runWater; next.runId = state.runId; next.score = state.score;
    next.scoreBreakdown = { ...state.scoreBreakdown };
    next.completedBottles = state.completedBottles.slice();
    next.rescued = state.rescued; next.ammo = state.ammo;
    for (const rescued of state.layout.filter(stone => stone.index >= 7)) {
      const slot = next.layout.find(stone => stone.index === rescued.slotIndex);
      next.layout.push({ ...rescued, x: slot.x, y: Math.min(slot.y, GROUND_Y - rescued.radius) });
    }
    if (remainingWater(next) < remainingRequired(next)) { next.phase = 'lost'; next.lossReason = 'water_shortage'; }
    else if (!canFinishRun(next)) { next.phase = 'lost'; next.lossReason = 'water_combination'; }
    return next;
  }

  function retry(state) { return create(state.mode === 'practice' ? state.index : 0, state.mode, state.seed); }

  function normalizeSave(raw) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.version === 3 && raw.campaign === CAMPAIGN_ID ? raw : {};
    const validScore = value => Number.isInteger(value) && value > 0 && value <= 4000 ? value : 0;
    const practiceBest = {};
    for (let index = 0; index < OUTLINE.length; index++) {
      const score = validScore(raw.practiceBest && raw.practiceBest[index]);
      if (score) practiceBest[index] = score;
    }
    const bestScore = validScore(raw.bestScore);
    const runsCompleted = bestScore ? Math.max(1, integer(raw.runsCompleted, 1, Number.MAX_SAFE_INTEGER)) : 0;
    const medals = bestScore && Array.isArray(raw.medals) ? ['efficient', 'clean', 'variety'].filter(id => raw.medals.includes(id)) : [];
    const practicePerfect = Array.isArray(raw.practicePerfect) ? [...new Set(raw.practicePerfect.filter(index =>
      Number.isInteger(index) && index >= 0 && index < OUTLINE.length && practiceBest[index]))].sort((a, b) => a - b) : [];
    const practiceVariety = Array.isArray(raw.practiceVariety) ? [...new Set(raw.practiceVariety.filter(index =>
      Number.isInteger(index) && index >= 0 && index < OUTLINE.length && practiceBest[index]))].sort((a, b) => a - b) : [];
    const eggs = [];
    if (medals.includes('clean')) eggs.push('flock');
    if (runsCompleted) eggs.push('rainbow');
    if (medals.includes('variety')) eggs.push('meteor');
    return { version: 3, campaign: CAMPAIGN_ID, bestScore, runsCompleted, medals, practiceBest,
      practicePerfect, practiceVariety,
      lastRunId: typeof raw.lastRunId === 'string' ? raw.lastRunId.slice(0, 4096) : '',
      // Compatibility fields are derived; every practice scene is available from the beginning.
      unlocked: OUTLINE.length, best: { ...practiceBest }, perfect: practicePerfect.slice(), variety: practiceVariety.slice(),
      eggs, totalScore: bestScore, bestStreak: runsCompleted ? OUTLINE.length : 0 };
  }

  function award(save, state) {
    const next = normalizeSave(save);
    if (!state || state.phase !== 'won') return next;
    const clean = state.runMisses === 0 && !state.rescued;
    if (state.mode === 'practice') {
      next.practiceBest[state.index] = Math.max(next.practiceBest[state.index] || 0, Math.round(state.score));
      if (clean && !next.practicePerfect.includes(state.index)) next.practicePerfect.push(state.index);
      if (state.scoreBreakdown.variety > 0 && !next.practiceVariety.includes(state.index)) next.practiceVariety.push(state.index);
    } else {
      if (state.index !== OUTLINE.length - 1 || !OUTLINE.every(cfg => state.completedBottles.includes(cfg.index))) return next;
      // The browser supplies a distinct runId per new trip; replaying award for the same result is harmless.
      const runId = String(state.runId || JSON.stringify(state.runShots.map(shot =>
        [shot.bottleIndex, shot.stoneIndex, shot.launchedAt, shot.vx0, shot.vy0, shot.result && shot.result.kind])));
      if (next.lastRunId === runId) return next;
      next.lastRunId = runId;
      next.runsCompleted++;
      next.bestScore = Math.max(next.bestScore, Math.round(state.runScore));
      if (stones(state).length >= 2 && !state.rescued && !next.medals.includes('efficient')) next.medals.push('efficient');
      if (clean && !next.medals.includes('clean')) next.medals.push('clean');
      if (state.scoreBreakdown.variety > 0 && !next.medals.includes('variety')) next.medals.push('variety');
    }
    return normalizeSave(next);
  }

  return Object.freeze({ CAMPAIGN_ID, SCENES, OUTLINE, EGG_IDS, ORIGIN, GRAVITY, STONE_RADIUS, GROUND_Y, AIM_SCALE, MAX_DRAG, MIN_DRAG,
    config, create, mouth, lidGeometry, stones, origin, press, aim, flight, trajectory, release, cancel,
    tick, rescue, retry, normalizeSave, award, stoneWater, remainingWater, remainingRequired, canFinishRun, continueRun });
}));
