// Plugin UI logic. ShapeEngine is inlined before this script at build time.
const E = ShapeEngine;
const DEFAULT_PALETTE = ['#2B4ACB', '#EFCBF4', '#F5C788', '#EE7B61', '#5E8F7A', '#14284B'];
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9A-Fa-f]{6}$/;
// Colors can come from saved plugin data in shared files, so only accept well-formed values.
const cleanColor = (c, fallback) => {
  if (!c || !HEX.test(c.hex)) return fallback;
  const r = c.ref;
  const ref = r && (r.kind === 'style' || r.kind === 'variable') && typeof r.id === 'string' && r.id.length < 200 ? { kind: r.kind, id: r.id } : null;
  return { hex: c.hex.toUpperCase(), ref };
};
const CHEV = '<svg class="chev" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';

const state = {
  type: 'scallop',
  group: 'all',
  params: {},            // per-type tweaks, so switching types keeps your edits
  seeds: {},
  fill: { hex: DEFAULT_PALETTE[0], ref: null },   // ref = { kind: 'style'|'variable', id } for document colors
  accent: { hex: DEFAULT_PALETTE[2], ref: null },
  target: 'fill',
  source: 'palette',     // 'palette' | 'document'
  palette: DEFAULT_PALETTE.slice(),
  docColors: [],
  mix: true,
  variations: [],
  outline: true,
  editing: null,         // { uid, id, name, size } while a generated shape is selected on the canvas
  frame: null,           // { id, name, width, height } when a frame is selected
  scatter: { count: 30, min: 40, max: 120, overlap: false, bleed: true, rotate: true, behind: true, source: 'type' },
  open: { shape: true, texture: true, color: true, scatter: false },
};

const send = (msg) => parent.postMessage({ pluginMessage: msg }, '*');
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cur = () => state.params[state.type] || (state.params[state.type] = E.defaultsFor(state.type));
const seed = () => state.seeds[state.type] ?? (state.seeds[state.type] = newSeed());
const svgFor = (type, params, s, size, fill = state.fill.hex, accent = state.accent.hex) =>
  E.toSVG(E.generate(type, params, s), { fill, accent, size });
const size = () => Math.min(4000, Math.max(8, +$('size').value || 200));
const label = (type) => E.TYPE_MAP[type].label;
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const typesFor = (group) => E.TYPES.filter((t) => group === 'all' || t.group === group);

// Everything Figma needs to build (and later re-edit) one shape.
function makeItem(type, params, s, px, fill = state.fill, accent = state.accent, uid = newUid()) {
  const { svg, text } = E.render(E.generate(type, params, s), { fill: fill.hex, accent: accent.hex, size: px, inlineText: false });
  return {
    name: label(type), svg, text,
    colors: { fill, accent },
    meta: { v: 1, uid, type, params: { ...params }, seed: s, fill, accent, outline: state.outline },
  };
}

// ---------- change propagation ----------
let suppress = false, updateTimer = null;

function changed() {
  render();
  if (!state.editing || suppress) return;
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    const ed = state.editing;
    if (!ed) return;
    send({ type: 'update', id: ed.id, outline: state.outline, item: makeItem(state.type, cur(), seed(), ed.size, state.fill, state.accent, ed.uid) });
  }, 90);
}

// ---------- gallery ----------
function renderGallery() {
  const box = $('gallery');
  box.innerHTML = '';
  for (const group of E.GROUPS) {
    if (state.group !== 'all' && state.group !== group) continue;
    box.append(el('div', { className: 'group-title', textContent: group }));
    const tiles = el('div', { className: 'tiles' });
    for (const t of typesFor(group)) {
      const b = el('button', { className: 'tile' + (t.id === state.type ? ' on' : ''), title: t.label, innerHTML: svgFor(t.id, E.defaultsFor(t.id), 7, 40) });
      b.onclick = () => selectType(t.id);
      tiles.append(b);
    }
    box.append(tiles);
  }
}

function selectType(id) {
  state.type = id;
  renderGallery();
  renderInspector();
  makeVariations();
  changed();
  const on = document.querySelector('.tile.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

$('tabs').onclick = (e) => {
  const g = e.target.dataset.g;
  if (!g) return;
  state.group = g;
  [...$('tabs').children].forEach((b) => b.classList.toggle('on', b === e.target));
  renderGallery();
};

// ---------- inspector ----------
const fmt = (def, v) => (def.step >= 1 ? String(v) : Number(v).toFixed(2));
const pct = (def, v) => `${((v - def.min) / (def.max - def.min)) * 100}%`;

function section(key, title, ...fields) {
  const d = el('details', { open: state.open[key] });
  d.ontoggle = () => { state.open[key] = d.open; };
  d.append(el('summary', { innerHTML: `<span>${title}</span>${CHEV}` }), el('div', { className: 'fields' }, ...fields));
  return d;
}

function field(key) {
  const def = E.PARAMS[key], p = cur();
  const name = el('span', { className: 'name', textContent: def.label, title: 'Double-click to reset' });
  name.ondblclick = () => { p[key] = E.defaultsFor(state.type)[key]; renderInspector(); changed(); };
  const wrap = el('div', { className: 'field' }, name);

  if (def.text) {
    const input = el('input', { className: 'text-in', type: 'text', value: p[key] ?? '', maxLength: 40, placeholder: 'No text' });
    input.oninput = () => { p[key] = input.value; changed(); };
    wrap.append(input);
    return wrap;
  }
  if (def.options || def.toggle) {
    const seg = el('div', { className: 'seg' });
    for (const o of def.options || [0, 1]) {
      const b = el('button', { className: (p[key] ?? 0) == o ? 'on' : '', textContent: def.toggle ? (o ? 'On' : 'Off') : o });
      b.onclick = () => { p[key] = o; renderInspector(); changed(); };
      seg.append(b);
    }
    wrap.append(seg);
    return wrap;
  }

  const range = el('input', { type: 'range', min: def.min, max: def.max, step: def.step, value: p[key] });
  const num = el('input', { className: 'num', type: 'text', value: fmt(def, p[key]) });
  const sync = () => { range.value = p[key]; range.style.setProperty('--p', pct(def, p[key])); num.value = fmt(def, p[key]); };
  range.oninput = () => { p[key] = +range.value; sync(); changed(); };
  num.onchange = () => {
    const v = parseFloat(num.value);
    if (!isNaN(v)) p[key] = Math.min(def.max, Math.max(def.min, v));
    sync(); changed();
  };
  num.onkeydown = (e) => { if (e.key === 'Enter') num.blur(); };
  wrap.append(range, num);
  sync();
  return wrap;
}

const sameRef = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
const docName = (c) => (c.ref && (state.docColors.find((d) => sameRef(d.ref, c.ref)) || {}).name) || null;

function colorSection() {
  const source = el('div', { className: 'seg' });
  for (const [k, text] of [['palette', 'Palette'], ['document', `Document${state.docColors.length ? ` (${state.docColors.length})` : ''}`]]) {
    const b = el('button', { className: state.source === k ? 'on' : '', textContent: text });
    b.style.textTransform = 'none';
    b.onclick = () => { state.source = k; if (k === 'document') send({ type: 'refresh-doc-colors' }); renderInspector(); };
    source.append(b);
  }

  const targets = el('div', { className: 'targets' });
  for (const [t, name] of [['fill', 'Fill'], ['accent', 'Accent']]) {
    const c = state[t], linked = docName(c);
    const b = el('button', {
      className: 'target' + (state.target === t ? ' on' : ''),
      title: linked ? `Linked to ${linked}` : c.hex,
      innerHTML: `<i class="chip" style="background:${c.hex}"></i><span>${name}<small>${esc(linked ? '◆ ' + linked : c.hex)}</small></span>`,
    });
    b.onclick = () => { state.target = t; renderInspector(); };
    targets.append(b);
  }

  const sw = el('div', { className: 'swatches' });
  const current = state[state.target];
  if (state.source === 'document') {
    if (!state.docColors.length) {
      sw.append(el('div', { className: 'doc-empty', textContent: 'No local color styles or variables in this file. Shapes will use plain colors.' }));
    }
    for (const d of state.docColors) {
      const s = el('button', { className: 'sw' + (sameRef(d.ref, current.ref) ? ' sel' : ''), title: `${d.name} · ${d.hex}` });
      s.style.background = d.hex;
      s.onclick = () => setColor({ hex: d.hex, ref: d.ref });
      sw.append(s);
    }
  } else {
    state.palette.forEach((c, i) => {
      const s = el('button', { className: 'sw' + (c === current.hex && !current.ref ? ' sel' : ''), title: c });
      s.style.background = c;
      s.onclick = () => setColor({ hex: c, ref: null });
      const x = el('span', { className: 'x', textContent: '×', title: 'Remove' });
      x.onclick = (e) => { e.stopPropagation(); state.palette.splice(i, 1); savePalette(); renderInspector(); };
      s.append(x);
      sw.append(s);
    });
    const picker = el('input', { type: 'color', value: current.hex });
    picker.onchange = () => {
      const c = picker.value.toUpperCase();
      if (!state.palette.includes(c)) { state.palette.push(c); savePalette(); }
      setColor({ hex: c, ref: null });
    };
    sw.append(el('label', { className: 'add', title: 'Add a custom color', innerHTML: '+' }, picker));
  }

  const mix = el('label', { className: 'check', innerHTML: '<input type="checkbox"> Mix colors in sheets & scatter' });
  mix.querySelector('input').checked = state.mix;
  mix.querySelector('input').onchange = (e) => { state.mix = e.target.checked; };
  const action = state.source === 'document'
    ? el('button', { className: 'link', textContent: 'Refresh', onclick: () => send({ type: 'refresh-doc-colors' }) })
    : el('button', { className: 'link', textContent: 'Reset palette', onclick: () => { state.palette = DEFAULT_PALETTE.slice(); savePalette(); renderInspector(); } });
  return section('color', 'Color', source, targets, sw, el('div', { className: 'sub' }, mix, action));
}

function scatterSection() {
  const sc = state.scatter;
  const row = (labelText, ...kids) => el('div', { className: 'field' }, el('span', { className: 'name', textContent: labelText }), ...kids);
  const numIn = (key, min, max) => {
    const i = el('input', { type: 'number', className: 'count-in', min, max, value: sc[key] });
    i.onchange = () => { sc[key] = Math.min(max, Math.max(min, Math.round(+i.value || min))); i.value = sc[key]; };
    return i;
  };
  const count = row('Count', el('div', { className: 'range2' }, numIn('count', 1, 300), 'shapes'));
  const sizes = row('Size', el('div', { className: 'range2' }, numIn('min', 4, 2000), '–', numIn('max', 4, 2000), 'px'));
  const src = el('select');
  for (const [v, t] of [['type', 'This shape (varied)'], ['all', 'All shapes'], ...E.GROUPS.map((g) => [g, g])]) src.append(new Option(t, v, false, sc.source === v));
  src.onchange = () => { sc.source = src.value; };
  const checks = el('div', { className: 'checks' });
  for (const [k, t] of [['overlap', 'Allow overlap'], ['bleed', 'Bleed off edges'], ['rotate', 'Random rotation'], ['behind', 'Place behind']]) {
    const c = el('label', { className: 'check', innerHTML: `<input type="checkbox"> ${t}` });
    c.querySelector('input').checked = sc[k];
    c.querySelector('input').onchange = (e) => { sc[k] = e.target.checked; };
    checks.append(c);
  }
  const btn = el('button', { className: 'btn primary wide', id: 'scatterBtn' });
  const hint = el('div', { className: 'hint', id: 'scatterHint' });
  btn.onclick = doScatter;
  const s = section('scatter', 'Scatter into frame', count, sizes, row('Shapes', src), checks, btn, hint);
  return s;
}

function updateScatterButton() {
  const btn = $('scatterBtn'), hint = $('scatterHint');
  if (!btn) return;
  const f = state.frame;
  btn.disabled = !f;
  btn.textContent = f ? `Scatter into “${f.name.length > 22 ? f.name.slice(0, 21) + '…' : f.name}”` : 'Scatter into frame';
  hint.textContent = f ? `${f.width} × ${f.height} px` : 'Select a frame, section or component on the canvas.';
}

function renderInspector() {
  const keys = E.paramsFor(state.type);
  const shapeKeys = keys.filter((k) => !E.COMMON.includes(k));
  const box = $('inspector');
  const scroll = box.scrollTop;
  box.innerHTML = '';
  box.append(
    section('shape', 'Shape', ...shapeKeys.map(field)),
    section('texture', 'Transform & texture', ...E.COMMON.map(field)),
    colorSection(),
    scatterSection(),
  );
  updateScatterButton();
  box.scrollTop = scroll;
}

function setColor(c) {
  state[state.target] = c;
  renderInspector();
  renderGallery();
  renderVariations();
  changed();
}

function savePalette() { send({ type: 'save-palette', palette: state.palette }); }

// ---------- preview, variations, editing banner ----------
function render() {
  const t = E.TYPE_MAP[state.type];
  $('name').textContent = t.label;
  $('tag').textContent = t.group;
  const svg = svgFor(state.type, cur(), seed(), 220);
  $('shape').innerHTML = svg;
  const [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  const px = state.editing ? state.editing.size : size();
  const k = px / Math.max(+w, +h);
  $('dims').textContent = `${Math.round(w * k)} × ${Math.round(h * k)}`;
}

function renderEditing() {
  const ed = state.editing;
  $('editing').hidden = !ed;
  if (ed) { $("editingName").textContent = `Editing “${ed.name}”`; $("editingName").title = "Changes apply live to the selected shape. Press Esc or Done to stop."; }
}

function makeVariations() {
  const rand = E.rng(newSeed());
  state.variations = Array.from({ length: 8 }, () => ({ params: E.vary(state.type, cur(), rand), seed: newSeed() }));
  renderVariations();
}

function renderVariations() {
  const box = $('vars');
  box.innerHTML = '';
  for (const v of state.variations) {
    const b = el('button', { innerHTML: svgFor(state.type, v.params, v.seed, 52), title: 'Use this variation' });
    b.onclick = () => {
      state.params[state.type] = { ...v.params };
      state.seeds[state.type] = v.seed;
      renderInspector();
      changed();
    };
    box.append(b);
  }
}

// Load a generated shape's saved settings when it is selected on the canvas.
function startEditing(shape) {
  const m = shape.meta;
  if (!m || typeof m.type !== "string" || !Object.prototype.hasOwnProperty.call(E.TYPE_MAP, m.type)) return false;
  suppress = true;
  try {
    state.editing = { uid: m.uid || null, id: shape.id, name: shape.name, size: shape.size };
    state.type = m.type;
    state.params[m.type] = E.sanitize(m.type, m.params);
    state.seeds[m.type] = Number.isFinite(m.seed) ? m.seed >>> 0 : newSeed();
    state.fill = cleanColor(m.fill, state.fill);
    state.accent = cleanColor(m.accent, state.accent);
    state.outline = m.outline !== false;
    $('outline').classList.toggle('on', state.outline);
    renderEditing();
    renderGallery();
    renderInspector();
    makeVariations();
    render();
    const on = document.querySelector('.tile.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  } finally {
    suppress = false;
  }
  return true;
}

function stopEditing() {
  clearTimeout(updateTimer);
  state.editing = null;
  renderEditing();
  render();
}

$('doneEditing').onclick = stopEditing;
$('bgs').onclick = (e) => {
  const bg = e.target.dataset.bg;
  if (!bg) return;
  $('preview').dataset.bg = bg;
  [...$('bgs').children].forEach((b) => b.classList.toggle('on', b === e.target));
};
const shuffle = () => { state.seeds[state.type] = newSeed(); changed(); };
$('shuffle').onclick = shuffle;
$('reset').onclick = () => { state.params[state.type] = E.defaultsFor(state.type); renderInspector(); changed(); };
$('revary').onclick = makeVariations;
$('size').oninput = render;
$('outline').onclick = () => {
  state.outline = !state.outline;
  $('outline').classList.toggle('on', state.outline);
  $('outline').setAttribute('aria-checked', state.outline);
  changed();
};

// ---------- insert, sheet, scatter ----------
function colorPool() {
  if (state.source === 'document' && state.docColors.length) return state.docColors.map((d) => ({ hex: d.hex, ref: d.ref }));
  return state.palette.map((hex) => ({ hex, ref: null }));
}

function pickColors(rand) {
  const pool = colorPool();
  if (!state.mix || pool.length < 2) return [state.fill, state.accent];
  const fill = pick(pool, rand);
  const others = pool.filter((c) => c.hex !== fill.hex);
  return [fill, others.length ? pick(others, rand) : state.accent];
}

function insert() {
  send({ type: 'insert', outline: state.outline, items: [makeItem(state.type, cur(), seed(), size())] });
}

function insertSheet() {
  const n = Math.min(100, Math.max(2, +$('sheetCount').value || 12));
  const mode = $('sheetMode').value;
  const pool = typesFor(mode === 'type' ? 'all' : mode);
  const rand = E.rng(newSeed());
  const items = [];
  for (let i = 0; i < n; i++) {
    const type = mode === 'type' ? state.type : pool[i % pool.length].id;
    const params = mode === 'type' ? (i === 0 ? { ...cur() } : E.vary(type, cur(), rand)) : E.vary(type, null, rand);
    const [fill, accent] = pickColors(rand);
    items.push(makeItem(type, params, newSeed(), size(), fill, accent));
  }
  if (mode !== 'type') items.sort(() => rand() - 0.5);
  send({ type: 'insert', outline: state.outline, items });
}

function doScatter() {
  const F = state.frame, sc = state.scatter;
  if (!F) return;
  const rand = E.rng(newSeed());
  const lo = Math.min(sc.min, sc.max), hi = Math.max(sc.min, sc.max);
  const pool = typesFor(sc.source === 'type' ? 'all' : sc.source);
  const placed = [], items = [];
  for (let i = 0; i < sc.count; i++) {
    let spot = null;
    for (let tries = 0; tries < 80 && !spot; tries++) {
      const s = lo + rand() * (hi - lo), r = s / 2;
      const cx = sc.bleed ? rand() * F.width : r + rand() * Math.max(0, F.width - s);
      const cy = sc.bleed ? rand() * F.height : r + rand() * Math.max(0, F.height - s);
      if (!sc.overlap && placed.some((p) => Math.hypot(p.cx - cx, p.cy - cy) < (p.r + r) * 0.92)) continue;
      spot = { cx, cy, r, s };
    }
    if (!spot) continue;
    placed.push(spot);
    const type = sc.source === 'type' ? state.type : pick(pool, rand).id;
    const params = sc.source === 'type' ? E.vary(type, cur(), rand, 0.25) : E.vary(type, null, rand);
    if (sc.rotate) params.rotation = Math.round(rand() * 360);
    const [fill, accent] = pickColors(rand);
    const item = makeItem(type, params, newSeed(), Math.round(spot.s), fill, accent);
    item.cx = spot.cx;
    item.cy = spot.cy;
    items.push(item);
  }
  if (items.length < sc.count) send({ type: 'notify', text: `Placed ${items.length} of ${sc.count} — no room for the rest without overlapping.` });
  send({ type: 'scatter', frameId: F.id, behind: sc.behind, outline: state.outline, items });
}

$('insert').onclick = insert;
$('insertSheet').onclick = insertSheet;

// Space = shuffle, Enter = insert, V = variations, arrows = previous/next shape (when not typing)
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if ((tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
  if ((tag === 'BUTTON' || tag === 'SUMMARY') && (e.key === ' ' || e.key === 'Enter')) return; // let the focused control handle it
  const ids = E.TYPES.map((t) => t.id), i = ids.indexOf(state.type);
  if (e.key === ' ') { e.preventDefault(); shuffle(); }
  else if (e.key === 'Enter') { e.preventDefault(); insert(); }
  else if (e.key === 'v' || e.key === 'V') makeVariations();
  else if (e.key === 'Escape' && state.editing) stopEditing();
  else if (tag !== 'INPUT' && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) { e.preventDefault(); selectType(ids[(i + 1) % ids.length]); }
  else if (tag !== 'INPUT' && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) { e.preventDefault(); selectType(ids[(i - 1 + ids.length) % ids.length]); }
});

// ---------- messages from Figma ----------
window.onmessage = (e) => {
  const msg = e.data && e.data.pluginMessage;
  if (!msg) return;
  if (msg.type === 'init') {
    if (Array.isArray(msg.palette) && msg.palette.length) state.palette = msg.palette.filter((c) => HEX.test(c)).map((c) => c.toUpperCase());
    renderInspector();
  } else if (msg.type === 'doc-colors') {
    state.docColors = (Array.isArray(msg.colors) ? msg.colors : [])
      .map((d) => ({ ...cleanColor(d, null), name: String(d && d.name || '').slice(0, 80) }))
      .filter((d) => d.hex && d.ref);
    renderInspector();
  } else if (msg.type === 'selection') {
    const hadFrame = !!state.frame;
    state.frame = msg.frame || null;
    if (state.frame && !hadFrame && !state.open.scatter) { state.open.scatter = true; renderInspector(); }
    updateScatterButton();

    const shape = msg.shape;
    if (shape && shape.meta) {
      // Our own live update replaced the node: just follow the new id.
      if (state.editing && shape.meta.uid && shape.meta.uid === state.editing.uid) { state.editing.id = shape.id; return; }
      startEditing(shape);
    } else if (state.editing) {
      stopEditing();
    }
  }
};

renderGallery();
renderInspector();
makeVariations();
render();
send({ type: 'ready' });
