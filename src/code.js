// Figma main thread: turns SVG strings from the UI into native vector nodes, keeps generated shapes
// re-editable (settings stored as plugin data), scatters shapes into frames and binds document colors.
figma.showUI(__html__, { width: 760, height: 620, themeColors: true, title: 'Shape Maker' });

const KEY = 'shape';
const MAX_ITEMS = 300;
const GAP = 32;
const FONT = { family: 'Inter', style: 'Bold' };
const CONTAINERS = ['FRAME', 'SECTION', 'COMPONENT'];

// ---------- helpers ----------
const toHex = ({ r, g, b }) => '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const toRgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);
const isHexList = (v) => Array.isArray(v) && v.length <= 64 && v.every(isHex);

async function resolveVariableHex(variable, depth = 0) {
  const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
  const value = collection && variable.valuesByMode[collection.defaultModeId];
  if (value && value.type === 'VARIABLE_ALIAS') {
    if (depth > 5) return null;
    const target = await figma.variables.getVariableByIdAsync(value.id);
    return target ? resolveVariableHex(target, depth + 1) : null;
  }
  return value && typeof value.r === 'number' ? toHex(value) : null;
}

// Local solid paint styles and color variables, for the "Document" palette.
async function documentColors() {
  const out = [];
  try {
    for (const s of await figma.getLocalPaintStylesAsync()) {
      const p = s.paints[0];
      if (s.paints.length === 1 && p.type === 'SOLID') out.push({ hex: toHex(p.color), name: s.name, ref: { kind: 'style', id: s.id } });
    }
  } catch (e) { console.warn('Shape Maker: paint styles unavailable', e); }
  try {
    for (const v of await figma.variables.getLocalVariablesAsync('COLOR')) {
      const hex = await resolveVariableHex(v);
      if (hex) out.push({ hex, name: v.name, ref: { kind: 'variable', id: v.id } });
    }
  } catch (e) { console.warn('Shape Maker: variables unavailable', e); }
  return out.slice(0, 200);
}

async function sendDocColors() {
  figma.ui.postMessage({ type: 'doc-colors', colors: await documentColors() });
}

function selectionInfo() {
  const sel = figma.currentPage.selection;
  let shape = null, frame = null;
  if (sel.length === 1) {
    const n = sel[0];
    const data = n.getPluginData(KEY);
    if (data) {
      try { shape = { id: n.id, name: n.name, size: Math.round(Math.max(n.width, n.height)), meta: JSON.parse(data) }; } catch (e) { /* ignore corrupt data */ }
    } else if (CONTAINERS.includes(n.type)) {
      frame = { id: n.id, name: n.name, width: Math.round(n.width), height: Math.round(n.height) };
    }
  }
  return { type: 'selection', shape, frame };
}

// ---------- building nodes ----------
function svgToNode(svg, outline, parent) {
  const frame = figma.createNodeFromSvg(svg);
  try {
    if (outline) {
      for (const child of [...frame.children]) {
        if (child.type !== 'VECTOR' || !child.strokes.length || child.fills.length) continue;
        const outlined = child.outlineStroke();
        if (!outlined) continue;
        frame.insertChild(frame.children.indexOf(child), outlined);
        child.remove();
      }
    }
    const result = frame.children.length === 1 ? frame.children[0] : figma.group(frame.children, frame);
    parent.appendChild(result);
    return result;
  } finally {
    if (!frame.removed) frame.remove();
  }
}

async function addText(node, text) {
  await figma.loadFontAsync(FONT);
  const t = figma.createText();
  t.fontName = FONT;
  t.characters = text.content.slice(0, 200);
  t.fontSize = Math.max(1, text.size * Math.max(node.width, node.height));
  t.textAlignHorizontal = 'CENTER';
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (isHex(text.color)) t.fills = [{ type: 'SOLID', color: toRgb(text.color) }];
  node.parent.appendChild(t);
  t.x = node.x + text.cx * node.width - t.width / 2;
  t.y = node.y + text.cy * node.height - t.height / 2;
  return figma.group([node, t], node.parent);
}

// Re-link generated fills to the document's paint styles / color variables the user picked.
async function bindColors(root, colors) {
  if (!colors) return;
  const targets = [];
  for (const key of ['fill', 'accent']) {
    const c = colors[key];
    if (c && c.ref && isHex(c.hex)) targets.push({ hex: c.hex.toUpperCase(), ref: c.ref });
  }
  if (!targets.length) return;
  const nodes = [root, ...('findAll' in root ? root.findAll(() => true) : [])];
  const varCache = {};
  for (const n of nodes) {
    if (!('fills' in n) || !Array.isArray(n.fills) || n.fills.length !== 1 || n.fills[0].type !== 'SOLID') continue;
    const t = targets.find((x) => x.hex === toHex(n.fills[0].color));
    if (!t) continue;
    try {
      if (t.ref.kind === 'style') {
        await n.setFillStyleIdAsync(t.ref.id);
      } else if (t.ref.kind === 'variable') {
        const v = varCache[t.ref.id] || (varCache[t.ref.id] = await figma.variables.getVariableByIdAsync(t.ref.id));
        if (v) n.fills = [figma.variables.setBoundVariableForPaint(n.fills[0], 'color', v)];
      }
    } catch (e) { console.warn('Shape Maker: could not bind color', e); }
  }
}

async function buildShape(item, outline, parent) {
  let node = svgToNode(item.svg, outline, parent);
  try {
    if (item.text && item.text.content && item.text.content.trim()) node = await addText(node, item.text);
    node.name = String(item.name || 'Shape').slice(0, 64);
    await bindColors(node, item.colors);
    if (item.meta) {
      node.setPluginData(KEY, JSON.stringify(item.meta));
      node.setRelaunchData({ edit: 'Edit this shape in Shape Maker' });
    }
    return node;
  } catch (err) {
    if (!node.removed) node.remove(); // don't leave a half-built shape behind
    throw err;
  }
}

function validItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS)
    .filter((it) => it && typeof it.svg === 'string' && it.svg.startsWith('<svg'));
}

// ---------- insert / scatter ----------
function layoutGrid(nodes, container) {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const cell = Math.max(...nodes.map((n) => Math.max(n.width, n.height))) + GAP;
  const w = cols * cell - GAP, h = rows * cell - GAP;
  let cx, cy;
  if (container.type === 'PAGE') ({ x: cx, y: cy } = figma.viewport.center);
  else { cx = container.width / 2; cy = container.height / 2; }
  nodes.forEach((n, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    n.x = Math.round(cx - w / 2 + col * cell + (cell - GAP - n.width) / 2);
    n.y = Math.round(cy - h / 2 + row * cell + (cell - GAP - n.height) / 2);
  });
}

async function buildAll(items, outline, container) {
  const nodes = [], built = [];
  let failed = 0;
  for (const it of items) {
    try { nodes.push(await buildShape(it, outline, container)); built.push(it); }
    catch (err) { failed++; console.error('Shape Maker: could not create shape', err); }
  }
  return { nodes, built, failed };
}

async function insert(msg) {
  const items = validItems(msg.items);
  if (!items.length) return;
  const sel = figma.currentPage.selection;
  const container = sel.length === 1 && CONTAINERS.includes(sel[0].type) && !sel[0].getPluginData(KEY) ? sel[0] : figma.currentPage;
  const { nodes, failed } = await buildAll(items, !!msg.outline, container);
  if (!nodes.length) return figma.notify('Shape Maker could not create that shape. Try different settings.', { error: true });

  layoutGrid(nodes, container);
  figma.currentPage.selection = nodes;
  if (nodes.length > 1) figma.viewport.scrollAndZoomIntoView(nodes);
  figma.commitUndo();
  const where = container.type === 'PAGE' ? '' : ` into “${container.name}”`;
  figma.notify(`Inserted ${nodes.length === 1 ? nodes[0].name : nodes.length + ' shapes'}${where}` + (failed ? ` (${failed} skipped)` : ''));
}

async function scatter(msg) {
  const frame = await figma.getNodeByIdAsync(msg.frameId);
  if (!frame || frame.removed || !CONTAINERS.includes(frame.type)) return figma.notify('Select a frame to scatter shapes into.', { error: true });
  const items = validItems(msg.items).filter((it) => Number.isFinite(it.cx) && Number.isFinite(it.cy));
  if (!items.length) return figma.notify('No room for shapes — try a smaller size or allow overlap.', { error: true });
  const { nodes, built, failed } = await buildAll(items, !!msg.outline, frame);
  if (!nodes.length) return;
  nodes.forEach((n, i) => {
    n.x = Math.round(built[i].cx - n.width / 2);
    n.y = Math.round(built[i].cy - n.height / 2);
  });
  const group = figma.group(nodes, frame);
  group.name = 'Scattered shapes';
  if (msg.behind) frame.insertChild(0, group);
  figma.currentPage.selection = [group];
  figma.commitUndo();
  figma.notify(`Scattered ${nodes.length} shapes in “${frame.name}”` + (failed ? ` (${failed} skipped)` : ''));
}

// ---------- live editing ----------
// Updates arrive while sliders move; only the newest pending one per shape is applied.
const latestNode = {};       // meta.uid -> current node id (the node is replaced on every update)
let pending = null, running = false;

async function applyUpdate({ id, item, outline }) {
  const uid = item.meta && item.meta.uid;
  const old = await figma.getNodeByIdAsync((uid && latestNode[uid]) || id);
  if (!old || old.removed || !old.parent) return;
  const parent = old.parent, index = parent.children.indexOf(old);
  const cx = old.x + old.width / 2, cy = old.y + old.height / 2;
  const node = await buildShape(item, outline, parent);
  parent.insertChild(index, node);
  node.x = Math.round(cx - node.width / 2);
  node.y = Math.round(cy - node.height / 2);
  node.name = old.name;
  old.remove();
  if (uid) latestNode[uid] = node.id;
  figma.currentPage.selection = [node];
}

async function queueUpdate(msg) {
  pending = msg;
  if (running) return;
  running = true;
  try {
    while (pending) {
      const next = pending;
      pending = null;
      try { await applyUpdate(next); }
      catch (err) { console.error('Shape Maker: update failed', err); }
    }
  } finally {
    running = false;
  }
}

// ---------- wiring ----------
figma.on('selectionchange', () => figma.ui.postMessage(selectionInfo()));
figma.on('currentpagechange', () => figma.ui.postMessage(selectionInfo()));

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  try {
    switch (msg.type) {
      case 'ready': {
        const palette = await figma.clientStorage.getAsync('palette').catch(() => null);
        figma.ui.postMessage({ type: 'init', palette: isHexList(palette) ? palette : null, command: figma.command });
        figma.ui.postMessage(selectionInfo());
        await sendDocColors();
        break;
      }
      case 'refresh-doc-colors': await sendDocColors(); break;
      case 'save-palette': if (isHexList(msg.palette)) await figma.clientStorage.setAsync('palette', msg.palette); break;
      case 'insert': await insert(msg); break;
      case 'scatter': await scatter(msg); break;
      case 'update': if (msg.item && typeof msg.item.svg === 'string') await queueUpdate(msg); break;
      case 'notify': if (typeof msg.text === 'string') figma.notify(msg.text.slice(0, 120)); break;
    }
  } catch (err) {
    console.error('Shape Maker:', err);
    figma.notify('Something went wrong in Shape Maker. Please try again.', { error: true });
  }
};
