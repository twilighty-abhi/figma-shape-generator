// Runs the built Figma main-thread code (dist/code.js) against test/figma-mock.js and checks what it
// does to the document. Each test gets a fresh mock and a fresh copy of the plugin code.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const E = require('../src/engine.js');
const { createFigma } = require('./figma-mock.js');

const ROOT = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'ignore' });
// CODE_FILE lets you point the suite at a modified copy (e.g. to check a test actually catches a bug).
const CODE = fs.readFileSync(process.env.CODE_FILE || path.join(ROOT, 'dist/code.js'), 'utf8');

// ---------- harness ----------
function boot(opts) {
  const m = createFigma(opts);
  const ctx = vm.createContext({ figma: m.figma, __html__: '<html>UI</html>', console: m.console, setTimeout, Promise });
  vm.runInContext(CODE, ctx, { filename: 'dist/code.js' });
  m.send = (msg) => m.figma.ui.onmessage(msg);
  m.shapes = (parent = m.page) => parent.children.filter((n) => n.getPluginData('shape'));
  m.errors = () => m.log.console.filter(([lvl]) => lvl === 'error');
  return m;
}

const sample = (type, opts = {}, params = {}, seed = 1) => E.render(E.generate(type, { ...E.defaultsFor(type), ...params }, seed), { size: 200, inlineText: false, ...opts });
function item(type, extra = {}, renderOpts = {}) {
  const { svg, text } = sample(type, renderOpts);
  const { meta, ...rest } = extra;
  return { name: type, svg, text: text || undefined, meta: { type, seed: 1, ...meta }, ...rest };
}
const center = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: expected ${b}±${tol}, got ${a}`);
const descendants = (n) => (n.children ? n.findAll(() => true) : []);
const hexOf = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const FILL = '#2B4ACB', ACCENT = '#F5C788';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- boot / ready ----------
test('boot: shows UI with __html__ and registers handlers', () => {
  const m = boot();
  assert.strictEqual(m.log.showUI.html, '<html>UI</html>');
  assert(m.log.showUI.options.width > 0 && m.log.showUI.options.height > 0);
  assert.strictEqual(typeof m.figma.ui.onmessage, 'function');
  assert(m.handlers.selectionchange && m.handlers.currentpagechange);
});

test('ready: init with stored palette, selection, then doc colors (styles + variables, aliases resolved)', async () => {
  const solid = (r, g, b) => ({ type: 'SOLID', color: { r, g, b } });
  const m = boot({
    command: 'edit',
    storage: { palette: ['#112233', '#AABBCC'] },
    styles: [
      { id: 'S:1', name: 'Brand/Blue', paints: [solid(0, 0, 1)] },
      { id: 'S:2', name: 'Two paints', paints: [solid(1, 0, 0), solid(0, 1, 0)] },
      { id: 'S:3', name: 'Gradient', paints: [{ type: 'GRADIENT_LINEAR', gradientStops: [] }] },
    ],
    collections: [{ id: 'C:1', defaultModeId: 'M:1' }],
    variables: [
      { id: 'V:1', name: 'color/red', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { r: 1, g: 0, b: 0, a: 1 } } },
      { id: 'V:2', name: 'color/alias', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { type: 'VARIABLE_ALIAS', id: 'V:1' } } },
      { id: 'V:3', name: 'color/dangling', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { type: 'VARIABLE_ALIAS', id: 'V:404' } } },
      { id: 'V:4', name: 'loop/a', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { type: 'VARIABLE_ALIAS', id: 'V:5' } } },
      { id: 'V:5', name: 'loop/b', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { type: 'VARIABLE_ALIAS', id: 'V:4' } } },
      { id: 'V:6', name: 'no collection', resolvedType: 'COLOR', variableCollectionId: 'C:404', valuesByMode: {} },
      { id: 'V:7', name: 'spacing', resolvedType: 'FLOAT', variableCollectionId: 'C:1', valuesByMode: { 'M:1': 8 } },
    ],
  });
  await m.send({ type: 'ready' });
  const [init, sel, doc] = m.log.posted;
  assert.deepStrictEqual(init, { type: 'init', palette: ['#112233', '#AABBCC'], command: 'edit' });
  assert.deepStrictEqual(sel, { type: 'selection', shape: null, frame: null });
  assert.strictEqual(doc.type, 'doc-colors');
  assert.deepStrictEqual(doc.colors, [
    { hex: '#0000FF', name: 'Brand/Blue', ref: { kind: 'style', id: 'S:1' } },
    { hex: '#FF0000', name: 'color/red', ref: { kind: 'variable', id: 'V:1' } },
    { hex: '#FF0000', name: 'color/alias', ref: { kind: 'variable', id: 'V:2' } },
  ]);
  assert.strictEqual(m.log.notify.length, 0);
});

test('ready: corrupt stored palette is sent as null; missing APIs only warn', async () => {
  const m = boot({ storage: { palette: ['#12', 'red'] } });
  m.figma.getLocalPaintStylesAsync = async () => { throw new Error('no access'); };
  await m.send({ type: 'ready' });
  assert.strictEqual(m.log.posted[0].palette, null);
  assert.deepStrictEqual(m.log.posted[2], { type: 'doc-colors', colors: [] });
  assert(m.log.console.some(([lvl]) => lvl === 'warn'));
});

// ---------- insert ----------
test('insert: fill-only scallop becomes one VECTOR at viewport center with plugin data', async () => {
  const m = boot();
  const it = item('scallop', { name: 'Scallop', meta: { uid: 'u1', params: { points: 12 } } });
  await m.send({ type: 'insert', items: [it], outline: true });
  const top = m.page.children;
  assert.strictEqual(top.length, 1, 'only the shape is left on the page (temp SVG frame removed)');
  const n = top[0];
  assert.strictEqual(n.type, 'VECTOR');
  assert.strictEqual(n.name, 'Scallop');
  assert.strictEqual(n.fills.length, 1);
  assert.strictEqual(hexOf(n.fills[0].color), FILL);
  assert.deepStrictEqual(JSON.parse(n.getPluginData('shape')), it.meta);
  assert.deepStrictEqual(n.relaunchData, { edit: 'Edit this shape in Shape Maker' });
  near(center(n).x, 640, 1, 'centered x'); near(center(n).y, 480, 1, 'centered y');
  assert.deepStrictEqual(m.page.selection.map((s) => s.id), [n.id]);
  assert.strictEqual(m.log.commitUndo, 1);
  assert.strictEqual(m.log.outlineCalls, 0, 'filled vectors are not outlined');
  assert.deepStrictEqual(m.log.notify.map((x) => x.message), ['Inserted Scallop']);
  assert.strictEqual(m.log.scrollIntoView.length, 0);
  assert.strictEqual(m.errors().length, 0);
});

test('insert: name is truncated to 64 chars and defaults to "Shape"', async () => {
  const m = boot();
  await m.send({ type: 'insert', items: [{ ...item('scallop'), name: 'x'.repeat(100) }, { ...item('scallop'), name: undefined }] });
  const names = m.page.children.map((n) => n.name);
  assert.deepStrictEqual(names, ['x'.repeat(64), 'Shape']);
});

for (const outlineMode of ['sibling', 'detached']) {
  test(`insert: squiggle stroke kept live with outline off, outlined with outline on (outlineStroke ${outlineMode})`, async () => {
    const m = boot({ outlineMode });
    await m.send({ type: 'insert', items: [item('squiggle')], outline: false });
    const live = m.page.children[0];
    assert.strictEqual(live.type, 'VECTOR');
    assert.strictEqual(live.fills.length, 0);
    assert.strictEqual(live.strokes.length, 1);
    assert.strictEqual(hexOf(live.strokes[0].color), FILL);

    const m2 = boot({ outlineMode });
    await m2.send({ type: 'insert', items: [item('squiggle')], outline: true });
    assert.strictEqual(m2.page.children.length, 1, 'no leftover original stroke or temp frame');
    const out = m2.page.children[0];
    assert.strictEqual(out.type, 'VECTOR');
    assert.strictEqual(out.strokes.length, 0);
    assert.strictEqual(out.fills.length, 1);
    assert.strictEqual(hexOf(out.fills[0].color), FILL);
    assert(out.width > live.width && out.height > live.height, 'outline includes stroke width');
    near(center(out).x, 640, 1, 'centered x'); near(center(out).y, 480, 1, 'centered y');
    assert.strictEqual(m2.log.outlineCalls, 1);
  });
}

test('insert: two-layer shapes (smiley, wobblyFlower) are grouped with fill + accent children', async () => {
  for (const type of ['smiley', 'wobblyFlower']) {
    const m = boot();
    const { svg } = sample(type);
    const paths = (svg.match(/<path /g) || []).length;
    assert(paths >= 2, `${type} has ${paths} paths`);
    await m.send({ type: 'insert', items: [item(type, { name: type })], outline: true });
    assert.strictEqual(m.page.children.length, 1);
    const g = m.page.children[0];
    assert.strictEqual(g.type, 'GROUP');
    assert.strictEqual(g.name, type);
    assert.strictEqual(g.children.length, paths);
    const colors = new Set(g.children.map((c) => hexOf((c.fills[0] || c.strokes[0]).color)));
    assert(colors.has(FILL) && colors.has(ACCENT), `${type} uses both colors`);
    assert(g.children.every((c) => c.strokes.length === 0), 'stroked layers were outlined');
    assert(g.getPluginData('shape'));
    near(center(g).x, 640, 1, `${type} centered x`); near(center(g).y, 480, 1, `${type} centered y`);
  }
});

test('insert: colors bind to paint styles and variables only where the hex matches', async () => {
  const m = boot({
    styles: [{ id: 'S:fill', name: 'Brand', paints: [{ type: 'SOLID', color: { r: 0x2b / 255, g: 0x4a / 255, b: 0xcb / 255 } }] }],
    collections: [{ id: 'C:1', defaultModeId: 'M:1' }],
    variables: [{ id: 'V:acc', name: 'accent', resolvedType: 'COLOR', variableCollectionId: 'C:1', valuesByMode: { 'M:1': { r: 1, g: 0.5, b: 0.5, a: 1 } } }],
  });
  const it = { ...item('smiley'), colors: { fill: { hex: FILL.toLowerCase(), ref: { kind: 'style', id: 'S:fill' } }, accent: { hex: ACCENT, ref: { kind: 'variable', id: 'V:acc' } } } };
  await m.send({ type: 'insert', items: [it], outline: true });
  const g = m.page.children[0];
  const fillKids = g.children.filter((c) => c.fillStyleId === 'S:fill');
  const accentKids = g.children.filter((c) => c.fills[0] && c.fills[0].boundVariables);
  assert(fillKids.length >= 1, 'fill layers linked to style');
  assert(accentKids.length >= 1, 'accent layers bound to variable');
  assert.strictEqual(fillKids.length + accentKids.length, g.children.length, 'every layer bound');
  accentKids.forEach((c) => assert.deepStrictEqual(c.fills[0].boundVariables.color, { type: 'VARIABLE_ALIAS', id: 'V:acc' }));
  assert.strictEqual(m.log.boundPaintCalls.length, accentKids.length);

  // A ref whose hex doesn't match the generated color (user changed it after picking) binds nothing.
  const m2 = boot({ styles: [{ id: 'S:fill', name: 'Brand', paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }] });
  await m2.send({ type: 'insert', items: [{ ...item('smiley'), colors: { fill: { hex: '#000000', ref: { kind: 'style', id: 'S:fill' } } } }] });
  assert.strictEqual(m2.log.fillStyleCalls.length, 0);
  // A dangling ref only warns; the shape is still inserted.
  const m3 = boot();
  await m3.send({ type: 'insert', items: [{ ...item('scallop'), colors: { fill: { hex: FILL, ref: { kind: 'style', id: 'S:gone' } }, accent: { hex: ACCENT, ref: { kind: 'variable', id: 'V:gone' } } } }] });
  assert.strictEqual(m3.page.children.length, 1);
  assert(m3.log.console.some(([lvl]) => lvl === 'warn'));
  assert(m3.log.notify[0].message.startsWith('Inserted'));
});

test('insert: text badge gets a real Inter Bold text layer grouped with the shape', async () => {
  const m = boot();
  const it = item('saleBadge', { name: 'Sale badge', meta: { uid: 'b1' } });
  assert(it.text && it.text.content === 'SALE', 'engine returns separate text');
  assert(!/<text/.test(it.svg));
  await m.send({ type: 'insert', items: [it], outline: true });
  assert.strictEqual(m.page.children.length, 1);
  const g = m.page.children[0];
  assert.strictEqual(g.type, 'GROUP');
  assert.strictEqual(g.name, 'Sale badge');
  assert.strictEqual(g.children.length, 2);
  const [shape, text] = g.children;
  assert.strictEqual(text.type, 'TEXT');
  assert.strictEqual(text.characters, 'SALE');
  assert.deepStrictEqual(text.fontName, { family: 'Inter', style: 'Bold' });
  assert.strictEqual(hexOf(text.fills[0].color), it.text.color);
  near(text.fontSize, it.text.size * 200, 0.5, 'font size scales with shape');
  near(center(text).x, center(shape).x, 1, 'text centered x'); near(center(text).y, center(shape).y, 1, 'text centered y');
  assert(g.getPluginData('shape') && !shape.getPluginData('shape'), 'meta on outer group only');
  near(center(g).x, 640, 1, 'group centered');
  assert.deepStrictEqual(m.log.fontLoads, ['Inter|Bold']);
});

test('insert: blank text content adds no text layer', async () => {
  const m = boot();
  await m.send({ type: 'insert', items: [{ ...item('saleBadge'), text: { content: '   ', color: '#000000', cx: 0.5, cy: 0.5, size: 0.2 } }] });
  assert(descendants(m.page).every((n) => n.type !== 'TEXT'));
  assert.strictEqual(m.log.fontLoads.length, 0);
});

test('insert: font load failure skips the shape without leaving a stray node', async () => {
  const m = boot({ availableFonts: [] });
  await m.send({ type: 'insert', items: [item('saleBadge')] });
  assert.strictEqual(m.page.children.length, 0, `left behind: ${m.page.children.map(String)}`);
  assert(m.log.notify[0].options.error);
});

test('insert: several items are laid out in a centered, non-overlapping grid', async () => {
  const m = boot({ viewportCenter: { x: -300, y: 1200 } });
  const items = ['scallop', 'squiggle', 'smiley', 'star', 'heart'].map((t) => item(t));
  await m.send({ type: 'insert', items, outline: true });
  const nodes = m.page.children;
  assert.strictEqual(nodes.length, 5);
  const x0 = Math.min(...nodes.map((n) => n.x)), x1 = Math.max(...nodes.map((n) => n.x + n.width));
  const y0 = Math.min(...nodes.map((n) => n.y)), y1 = Math.max(...nodes.map((n) => n.y + n.height));
  near((x0 + x1) / 2, -300, 101, 'grid centered x'); near((y0 + y1) / 2, 1200, 101, 'grid centered y');
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert(!overlap, `${a} overlaps ${b}`);
  }
  // 5 items -> 3 columns x 2 rows
  assert.strictEqual(new Set(nodes.map((n) => Math.round(center(n).y))).size, 2);
  assert.strictEqual(m.page.selection.length, 5);
  assert.strictEqual(JSON.stringify(m.log.scrollIntoView), JSON.stringify([nodes.map((n) => n.id)]));
  assert.strictEqual(m.log.notify[0].message, 'Inserted 5 shapes');
});

test('insert: into a single selected frame (centered in frame coordinates); not into shapes/rectangles', async () => {
  const m = boot();
  const frame = m.figma.createFrame();
  frame.name = 'Hero'; frame.x = 500; frame.y = 300; frame.resize(400, 300);
  m.page.selection = [frame];
  await m.send({ type: 'insert', items: [item('scallop', { name: 'S' })] });
  assert.strictEqual(frame.children.length, 1);
  const n = frame.children[0];
  near(center(n).x, 200, 1, 'frame-relative x'); near(center(n).y, 150, 1, 'frame-relative y');
  assert.strictEqual(m.log.notify[0].message, 'Inserted S into “Hero”');
  assert.deepStrictEqual(m.page.selection.map((s) => s.id), [n.id]);

  // section also counts as a container
  const m2 = boot();
  const sec = m2.figma.createSection(); sec.name = 'Sec'; sec.resize(1000, 800);
  m2.page.selection = [sec];
  await m2.send({ type: 'insert', items: [item('scallop')] });
  assert.strictEqual(sec.children.length, 1);

  // a selected rectangle, a selected shape, or two selected frames -> page
  const m3 = boot();
  const rect = m3.figma.createRectangle();
  m3.page.selection = [rect];
  await m3.send({ type: 'insert', items: [item('scallop')] });
  assert.strictEqual(m3.shapes().length, 1);
  const f1 = m3.figma.createFrame(), f2 = m3.figma.createFrame();
  m3.page.selection = [f1, f2];
  await m3.send({ type: 'insert', items: [item('scallop')] });
  assert.strictEqual(m3.shapes().length, 2);
  assert.strictEqual(f1.children.length + f2.children.length, 0);
});

test('insert: total failure notifies an error and leaves nothing behind; partial failure counts skips', async () => {
  const m = boot();
  await m.send({ type: 'insert', items: [{ name: 'bad', svg: '<svg broken' }, { name: 'bad2', svg: '<svg width="0" height="0"></svg>' }] });
  assert.strictEqual(m.page.children.length, 0);
  assert.strictEqual(m.log.notify.length, 1);
  assert(m.log.notify[0].options.error);
  assert.strictEqual(m.log.commitUndo, 0);

  // an SVG with no paths can't be grouped (figma.group([]) throws) -> skipped, temp frame removed
  const m2 = boot();
  await m2.send({ type: 'insert', items: [item('scallop'), { name: 'empty', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>' }] });
  assert.strictEqual(m2.page.children.length, 1);
  assert.strictEqual(m2.log.notify[0].message, `Inserted ${m2.page.children[0].name} (1 skipped)`);
});

// ---------- scatter ----------
function scatterSetup(opts) {
  const m = boot(opts);
  const frame = m.figma.createFrame();
  frame.name = 'Poster'; frame.x = 1000; frame.y = -200; frame.resize(800, 600);
  const bg = m.figma.createRectangle(); frame.appendChild(bg); bg.resize(800, 600);
  return { m, frame, bg };
}
const scatterItems = () => [
  { ...item('scallop', {}, { size: 60 }), cx: 100, cy: 100 },
  { ...item('squiggle', {}, { size: 80 }), cx: 400, cy: 300 },
  { ...item('saleBadge', {}, { size: 120 }), cx: 650, cy: 480 },
];

test('scatter: shapes centered on (cx, cy) inside the frame, grouped as "Scattered shapes" on top', async () => {
  const { m, frame, bg } = scatterSetup();
  const items = scatterItems();
  await m.send({ type: 'scatter', frameId: frame.id, items, outline: true, behind: false });
  assert.strictEqual(frame.children.length, 2);
  assert.strictEqual(frame.children[0], bg);
  const g = frame.children[1];
  assert.strictEqual(g.type, 'GROUP');
  assert.strictEqual(g.name, 'Scattered shapes');
  assert.strictEqual(g.children.length, 3);
  g.children.forEach((n, i) => {
    near(center(n).x, items[i].cx, 1, `item ${i} cx`); near(center(n).y, items[i].cy, 1, `item ${i} cy`);
    assert(n.getPluginData('shape'), 'each scattered shape stays editable');
  });
  assert(g.children[2].type === 'GROUP' && g.children[2].children.some((c) => c.type === 'TEXT'), 'badge kept its text');
  assert.strictEqual(m.page.children.length, 1, 'nothing stray on the page');
  assert.deepStrictEqual(m.page.selection.map((s) => s.id), [g.id]);
  assert.strictEqual(m.log.commitUndo, 1);
  assert.strictEqual(m.log.notify[0].message, 'Scattered 3 shapes in “Poster”');
});

test('scatter: behind=true puts the group at the back of the frame', async () => {
  const { m, frame, bg } = scatterSetup();
  await m.send({ type: 'scatter', frameId: frame.id, items: scatterItems(), behind: true });
  assert.strictEqual(frame.children[0].name, 'Scattered shapes');
  assert.strictEqual(frame.children[1], bg);
});

test('scatter: a failing item does not shift the positions of the others', async () => {
  const { m, frame } = scatterSetup();
  const items = scatterItems();
  items.splice(1, 0, { name: 'bad', svg: '<svg nope', cx: 10, cy: 10 });
  await m.send({ type: 'scatter', frameId: frame.id, items, outline: true });
  const g = frame.children.find((n) => n.name === 'Scattered shapes');
  assert.strictEqual(g.children.length, 3);
  const good = items.filter((it) => it.name !== 'bad');
  g.children.forEach((n, i) => { near(center(n).x, good[i].cx, 1, `item ${i} cx`); near(center(n).y, good[i].cy, 1, `item ${i} cy`); });
  assert(/\(1 skipped\)$/.test(m.log.notify[0].message));
});

test('scatter: missing/invalid frame and empty items notify errors; missing coordinates leave no strays', async () => {
  const { m, frame } = scatterSetup();
  const rect = m.figma.createRectangle();
  await m.send({ type: 'scatter', frameId: 'nope', items: scatterItems() });
  await m.send({ type: 'scatter', frameId: rect.id, items: scatterItems() });
  await m.send({ type: 'scatter', frameId: frame.id, items: [] });
  assert.strictEqual(m.log.notify.length, 3);
  assert(m.log.notify.every((n) => n.options.error));
  assert.strictEqual(frame.children.length, 1);

  await m.send({ type: 'scatter', frameId: frame.id, items: [{ ...item('scallop') }, { ...item('star'), cx: NaN, cy: 4 }] }); // no usable cx/cy
  assert.strictEqual(frame.children.length, 1, `stray nodes: ${frame.children.slice(1).map(String)}`);
  assert.strictEqual(m.page.children.length, 2, 'nothing stray on the page either');
  assert(m.log.notify[3].options.error);
});

// ---------- update ----------
async function insertedShape(m, type = 'scallop', uid = 'u1') {
  const before = m.figma.createRectangle(); before.name = 'before';
  await m.send({ type: 'insert', items: [item(type, { name: 'Original', meta: { uid, v: 0 } })], outline: true });
  const shape = m.shapes()[0];
  const after = m.figma.createRectangle(); after.name = 'after';
  return { shape, before, after };
}

test('update: replaces node in place keeping parent, index, center and name', async () => {
  const m = boot();
  const { shape } = await insertedShape(m);
  shape.x += 333; shape.y -= 77; shape.name = 'Renamed by user';
  const c0 = center(shape), id0 = shape.id;
  const idx0 = m.page.children.indexOf(shape);
  const next = { ...item('smiley', { name: 'Smiley', meta: { uid: 'u1', v: 1 } }, { size: 140 }) };
  await m.send({ type: 'update', id: id0, item: next, outline: true });
  assert(shape.removed, 'old node removed');
  const n = m.page.children[idx0];
  assert.notStrictEqual(n.id, id0);
  assert.strictEqual(n.type, 'GROUP');
  assert.strictEqual(n.name, 'Renamed by user');
  near(center(n).x, c0.x, 1, 'center x kept'); near(center(n).y, c0.y, 1, 'center y kept');
  assert.deepStrictEqual(m.page.children.map((x) => x.name), ['before', 'Renamed by user', 'after']);
  assert.strictEqual(JSON.parse(n.getPluginData('shape')).v, 1);
  assert.deepStrictEqual(m.page.selection.map((s) => s.id), [n.id]);
  assert.strictEqual(m.errors().length, 0);
});

test('update: stale id still targets the latest node for the same uid', async () => {
  const m = boot();
  const { shape } = await insertedShape(m);
  const id0 = shape.id;
  await m.send({ type: 'update', id: id0, item: item('scallop', { meta: { uid: 'u1', v: 1 } }) });
  await m.send({ type: 'update', id: id0, item: item('heart', { meta: { uid: 'u1', v: 2 } }) });
  const shapes = m.shapes();
  assert.strictEqual(shapes.length, 1);
  assert.strictEqual(JSON.parse(shapes[0].getPluginData('shape')).v, 2);
});

test('update: rapid updates coalesce (only newest pending is applied)', async () => {
  const m = boot();
  await insertedShape(m);
  const builds0 = m.log.svgBuilds;
  const id = m.shapes()[0].id;
  const sends = [1, 2, 3, 4, 5].map((v) => m.send({ type: 'update', id, item: item('scallop', { meta: { uid: 'u1', v } }, { size: 100 + v * 10 }) }));
  await Promise.all(sends);
  const builds = m.log.svgBuilds - builds0;
  assert(builds >= 1 && builds <= 2, `expected ≤2 builds, got ${builds}`);
  const shapes = m.shapes();
  assert.strictEqual(shapes.length, 1);
  assert.strictEqual(JSON.parse(shapes[0].getPluginData('shape')).v, 5, 'newest update wins');
  near(Math.max(shapes[0].width, shapes[0].height), 150, 1, 'final size from last update');
  assert.strictEqual(m.errors().length, 0);
});

test('update: shape inside a scattered group stays in the group (group survives)', async () => {
  const { m, frame } = scatterSetup();
  const items = scatterItems().map((it, i) => ({ ...it, meta: { ...it.meta, uid: 's' + i } }));
  await m.send({ type: 'scatter', frameId: frame.id, items });
  const g = frame.children[1];
  const target = g.children[0];
  const c0 = center(target);
  await m.send({ type: 'update', id: target.id, item: item('heart', { meta: { uid: 's0' } }, { size: 90 }) });
  assert(!g.removed, 'group not deleted');
  assert.strictEqual(g.children.length, 3);
  assert.strictEqual(JSON.parse(g.children[0].getPluginData('shape')).type, 'heart');
  near(center(g.children[0]).x, c0.x, 1, 'cx'); near(center(g.children[0]).y, c0.y, 1, 'cy');
});

test('update: text badge update keeps text grouped and centered', async () => {
  const m = boot();
  const { shape } = await insertedShape(m, 'saleBadge', 'b1');
  const c0 = center(shape);
  await m.send({ type: 'update', id: shape.id, item: item('saleBadge', { meta: { uid: 'b1', v: 1 } }, { size: 300 }) });
  const n = m.shapes()[0];
  assert.strictEqual(n.type, 'GROUP');
  assert(n.children.some((c) => c.type === 'TEXT'));
  near(center(n).x, c0.x, 1, 'cx'); near(center(n).y, c0.y, 1, 'cy');
  assert.strictEqual(descendants(m.page).filter((x) => x.type === 'TEXT').length, 1);
});

test('update: deleted target or broken svg is ignored without throwing or touching the document', async () => {
  const m = boot();
  const { shape } = await insertedShape(m);
  await m.send({ type: 'update', id: shape.id, item: { svg: '<svg bad', meta: { uid: 'u1' } } });
  assert(!shape.removed, 'failed rebuild keeps the original');
  assert.strictEqual(m.page.children.length, 3);
  shape.remove();
  await m.send({ type: 'update', id: shape.id, item: item('scallop', { meta: { uid: 'u1' } }) });
  assert.strictEqual(m.page.children.length, 2);
  assert(m.log.notify.every((n) => !n.options.error));
});

// ---------- palette / misc ----------
test('save-palette: stores valid hex lists only', async () => {
  const m = boot();
  await m.send({ type: 'save-palette', palette: ['#000000', '#ffFFff'] });
  assert.deepStrictEqual(m.storage.palette, ['#000000', '#ffFFff']);
  for (const bad of [['#fff'], ['red'], 'x', null, Array(65).fill('#000000'), ['#000000', 5]]) {
    await m.send({ type: 'save-palette', palette: bad });
  }
  assert.deepStrictEqual(m.storage.palette, ['#000000', '#ffFFff']);
});

test('selection messages describe shapes and frames', async () => {
  const m = boot();
  await m.send({ type: 'insert', items: [item('scallop', { meta: { uid: 'u9' } })] });
  m.log.posted.length = 0;
  m.fire('selectionchange');
  const s = m.log.posted[0];
  assert.strictEqual(s.type, 'selection');
  assert.strictEqual(s.shape.id, m.shapes()[0].id);
  assert.strictEqual(s.shape.meta.uid, 'u9');
  assert.strictEqual(s.shape.size, 200);
  const f = m.figma.createFrame(); f.name = 'F'; f.resize(300.4, 200.6);
  m.page.selection = [f];
  m.fire('currentpagechange');
  assert.deepStrictEqual(m.log.posted[1], { type: 'selection', shape: null, frame: { id: f.id, name: 'F', width: 300, height: 201 } });
  m.shapes()[0].setPluginData('shape', '{corrupt');
  m.page.selection = [m.shapes()[0]];
  m.fire('selectionchange');
  assert.deepStrictEqual(m.log.posted[2], { type: 'selection', shape: null, frame: null });
});

test('invalid messages are ignored without throwing', async () => {
  const m = boot();
  const junk = [null, undefined, 'insert', 42, {}, { type: 'nope' }, { type: 'insert' }, { type: 'insert', items: 'x' },
    { type: 'insert', items: [null, 1, { svg: 5 }, { svg: '<div/>' }] }, { type: 'update' }, { type: 'update', id: '1:1', item: { svg: 3 } },
    { type: 'scatter' }, { type: 'notify', text: 5 }, { type: 'save-palette' }, { type: 'refresh-doc-colors' }];
  for (const msg of junk) await m.send(msg);
  assert.strictEqual(m.page.children.length, 0);
  assert(m.log.notify.every((n) => n.message !== 'Something went wrong in Shape Maker. Please try again.'), JSON.stringify(m.log.notify));
  assert.strictEqual(m.log.commitUndo, 0);
});

test('notify: UI-requested toast is passed through and truncated', async () => {
  const m = boot();
  await m.send({ type: 'notify', text: 'y'.repeat(500) });
  assert.strictEqual(m.log.notify[0].message, 'y'.repeat(120));
});

test('insert: caps at 300 items', async () => {
  const m = boot();
  const one = item('star', {}, { size: 20 });
  await m.send({ type: 'insert', items: Array(305).fill(one) });
  assert.strictEqual(m.page.children.length, 300);
});

// ---------- run ----------
(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  ok   ${t.name}`); }
    catch (err) { failed++; console.log(`  FAIL ${t.name}\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`); }
  }
  console.log(`\ncode.test: ${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
