// Stress test: every type at defaults, at slider extremes, and with random params must yield valid, finite SVG.
const E = require('../src/engine.js');
const assert = require('assert');

assert.strictEqual(new Set(E.TYPES.map((t) => t.id)).size, E.TYPES.length, 'duplicate type ids');
let count = 0;
function check(type, params, seed) {
  const svg = E.toSVG(E.generate(type, params, seed), { size: 200 });
  count++;
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${type}: malformed svg`);
  assert(!/NaN|Infinity|undefined/.test(svg), `${type}: non-finite output for ${JSON.stringify(params)}`);
  const [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/).map(Number);
  assert(w > 0 && h > 0 && Math.max(w, h) <= 200.01, `${type}: bad size ${w}x${h}`);
  assert(svg.length < 400000, `${type}: svg too large (${svg.length})`);
}

for (const t of E.TYPES) {
  const keys = E.paramsFor(t.id);
  check(t.id, E.defaultsFor(t.id), 1);
  // each numeric param at min and max
  for (const k of keys) {
    const def = E.PARAMS[k];
    if (def.text) continue;
    if (def.options) for (const o of def.options) check(t.id, { ...E.defaultsFor(t.id), [k]: o }, 2);
    else if (def.toggle) for (const o of [0, 1]) check(t.id, { ...E.defaultsFor(t.id), [k]: o }, 2);
    else for (const v of [def.min, def.max]) check(t.id, { ...E.defaultsFor(t.id), [k]: v }, 3);
  }
  // random combos across the full range
  const rand = E.rng(t.id.length * 977);
  for (let i = 0; i < 150; i++) {
    const p = {};
    for (const k of keys) {
      const def = E.PARAMS[k];
      if (def.text) continue;
      p[k] = def.options ? def.options[Math.floor(rand() * def.options.length)]
        : def.toggle ? (rand() < 0.5 ? 0 : 1)
        : def.min + rand() * (def.max - def.min);
      if (def.step >= 1 && !def.options) p[k] = Math.round(p[k]);
    }
    check(t.id, p, i);
  }
  // vary() must stay within bounds
  for (let i = 0; i < 50; i++) {
    const v = E.vary(t.id, null, rand, 1);
    for (const k of keys) {
      const def = E.PARAMS[k];
      if (!def.options && !def.toggle && !def.text) assert(v[k] >= def.min - 1e-9 && v[k] <= def.max + 1e-9, `${t.id}.${k} out of range: ${v[k]}`);
    }
    check(t.id, v, i);
  }
}
console.log(`ok — ${E.TYPES.length} types, ${count} shapes generated`);

// Hostile params (e.g. plugin data from someone else's file) must be clamped, not hang or crash.
for (const t of E.TYPES) {
  const evil = {};
  for (const k of E.paramsFor(t.id)) evil[k] = [1e9, -1e9, NaN, 'x', null, { a: 1 }, '<script>'][k.length % 7];
  const clean = E.sanitize(t.id, evil);
  for (const k of E.paramsFor(t.id)) {
    const def = E.PARAMS[k];
    if (!def.options && !def.toggle && !def.text) assert(clean[k] >= def.min && clean[k] <= def.max, `${t.id}.${k} not clamped`);
  }
  const started = Date.now();
  check(t.id, evil, 1);
  assert(Date.now() - started < 1000, `${t.id}: hostile params too slow`);
}
console.log('ok — hostile params are sanitized');
