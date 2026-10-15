// A small but strict mock of the Figma Plugin API — just the parts src/code.js touches, with Figma's
// rules enforced where getting them wrong would be a real bug: removed nodes throw on access, groups
// can't be empty and delete themselves when emptied, fonts must be loaded before text is edited,
// x/y must be finite, paints are frozen, reparenting moves nodes, figma.group keeps absolute positions.

const CONTAINER_TYPES = new Set(['PAGE', 'FRAME', 'GROUP', 'SECTION', 'COMPONENT']);
const fontKey = (f) => `${f.family}|${f.style}`;
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const finite = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`in set_${what}: Expected a finite number, got ${v}`); return v; };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16) / 255, g: parseInt(full.slice(2, 4), 16) / 255, b: parseInt(full.slice(4, 6), 16) / 255 };
}

function createFigma(opts = {}) {
  const {
    outlineMode = 'sibling',               // 'sibling': outlineStroke inserts above the original; 'detached': unparented
    viewportCenter = { x: 640, y: 480 },
    svgOrigin = { x: 37, y: 59 },          // where createNodeFromSvg drops its frame (deliberately not 0,0)
    tick = true,                           // async APIs resolve on a later macrotask, like real IPC
    styles = [], variables = [], collections = [],
    storage = {},
    availableFonts = [{ family: 'Inter', style: 'Regular' }, { family: 'Inter', style: 'Bold' }],
  } = opts;

  let nextId = 1;
  const registry = new Map();
  const log = {
    notify: [], posted: [], commitUndo: 0, svgBuilds: 0, outlineCalls: 0, fillStyleCalls: [],
    boundPaintCalls: [], scrollIntoView: [], showUI: null, fontLoads: [], console: [],
  };
  const loadedFonts = new Set([fontKey({ family: 'Inter', style: 'Regular' })]);
  const handlers = {};
  const later = () => new Promise((r) => (tick ? setImmediate(r) : r()));

  class Node {
    constructor(type, props = {}) {
      this._id = `${nextId++}:1`;
      this.type = type;
      this._removed = false;
      this._parent = null;
      this._children = CONTAINER_TYPES.has(type) ? [] : null;
      this._name = props.name || type.charAt(0) + type.slice(1).toLowerCase();
      this._x = 0; this._y = 0; this._w = props.width || 0; this._h = props.height || 0;
      this._fills = []; this._strokes = []; this.strokeWeight = 1;
      this._plugin = {}; this.relaunchData = {}; this.fillStyleId = '';
      registry.set(this._id, this);
    }
    _live() { if (this._removed) throw new Error(`The node with id "${this._id}" does not exist`); return this; }
    get id() { return this._id; }
    get removed() { return this._removed; }
    get parent() { return this._live()._parent; }
    get name() { return this._live()._name; }
    set name(v) { this._live()._name = String(v); }
    get x() { return this._live()._x; }
    set x(v) { this._live()._x = finite(v, 'x'); }
    get y() { return this._live()._y; }
    set y(v) { this._live()._y = finite(v, 'y'); }
    get width() { return this._live()._w; }
    get height() { return this._live()._h; }
    resize(w, h) { this._live(); this._w = finite(w, 'width'); this._h = finite(h, 'height'); }
    get fills() { return this._live()._fills; }
    set fills(v) {
      this._live();
      if (!Array.isArray(v)) throw new Error('fills must be an array');
      for (const p of v) if (!p || !p.type) throw new Error('invalid paint');
      this._fills = deepFreeze(clone(v)); this.fillStyleId = '';
    }
    get strokes() { return this._live()._strokes; }
    set strokes(v) { this._live(); this._strokes = deepFreeze(clone(v)); }

    _detach() {
      const p = this._parent;
      if (!p) return;
      p._children.splice(p._children.indexOf(this), 1);
      this._parent = null;
      if (p.type === 'GROUP' && p._children.length === 0 && !p._removed) p.remove(); // Figma deletes empty groups
    }
    remove() {
      this._live();
      if (this.type === 'PAGE') throw new Error('Cannot remove a page this way');
      this._detach();
      const kill = (n) => { n._removed = true; registry.delete(n._id); if (n._children) n._children.forEach(kill); };
      kill(this);
    }
    getPluginData(k) { this._live(); return Object.prototype.hasOwnProperty.call(this._plugin, k) ? this._plugin[k] : ''; }
    setPluginData(k, v) {
      this._live();
      if (typeof k !== 'string' || typeof v !== 'string') throw new Error('setPluginData expects strings');
      if (v === '') delete this._plugin[k]; else this._plugin[k] = v;
    }
    setRelaunchData(d) {
      this._live();
      if (!d || typeof d !== 'object') throw new Error('setRelaunchData expects an object');
      for (const v of Object.values(d)) if (typeof v !== 'string') throw new Error('relaunch descriptions must be strings');
      this.relaunchData = { ...d };
    }
    async setFillStyleIdAsync(id) {
      this._live();
      log.fillStyleCalls.push({ node: this._id, id });
      await later();
      const s = styles.find((x) => x.id === id);
      if (!s) throw new Error(`style ${id} not found`);
      this._fills = deepFreeze(clone(s.paints));
      this.fillStyleId = id;
    }
    outlineStroke() {
      this._live();
      log.outlineCalls++;
      if (this.type !== 'VECTOR' || !this._strokes.length || !this.strokeWeight) return null;
      const out = new Node('VECTOR', { name: this._name });
      const pad = this.strokeWeight / 2;
      out._x = this._x - pad; out._y = this._y - pad; out._w = this._w + 2 * pad; out._h = this._h + 2 * pad;
      out._fills = deepFreeze(clone(this._strokes));
      out._strokes = deepFreeze([]);
      if (outlineMode === 'sibling' && this._parent) this._parent.insertChild(this._parent._children.indexOf(this) + 1, out);
      return out;
    }
    toString() { return `${this.type}(${this._id} "${this._name}")`; }
  }

  // Only container types have children / appendChild / insertChild / findAll (VectorNode, TextNode don't).
  class ContainerNode extends Node {
    get children() { return Object.freeze([...this._live()._children]); }
    appendChild(child) { this._live(); return this.insertChild(this._children.length - (child._parent === this ? 1 : 0), child); }
    insertChild(index, child) {
      this._live(); child._live();
      if (!Number.isInteger(index) || index < 0) throw new Error(`insertChild: bad index ${index}`);
      for (let a = this; a; a = a._parent) if (a === child) throw new Error('Cannot insert a node into itself or its descendant');
      if (child.type === 'PAGE') throw new Error('Cannot reparent a page');
      if (index > this._children.length - (child._parent === this ? 1 : 0)) throw new Error(`insertChild: index ${index} out of range`);
      // Moving within the same parent must not trigger empty-group deletion.
      if (child._parent === this) this._children.splice(this._children.indexOf(child), 1);
      else child._detach();
      this._children.splice(index, 0, child);
      child._parent = this;
      return child;
    }
    findAll(cb = () => true) {
      this._live();
      const out = [];
      const walk = (n) => { for (const c of n._children) { if (cb(c)) out.push(c); if (c._children) walk(c); } };
      walk(this);
      return out;
    }
  }

  // Groups have no geometry of their own: bounds are the union of their children, which live in the
  // group's parent's coordinate space. Moving a group moves its children.
  class GroupNode extends ContainerNode {
    constructor() { super('GROUP', { name: 'Group' }); }
    _bounds() {
      const cs = this._children;
      const x0 = Math.min(...cs.map((c) => c.x)), y0 = Math.min(...cs.map((c) => c.y));
      const x1 = Math.max(...cs.map((c) => c.x + c.width)), y1 = Math.max(...cs.map((c) => c.y + c.height));
      return { x0, y0, w: x1 - x0, h: y1 - y0 };
    }
    get x() { return this._live()._bounds().x0; }
    set x(v) { const d = finite(v, 'x') - this.x; this._children.forEach((c) => { c.x += d; }); }
    get y() { return this._live()._bounds().y0; }
    set y(v) { const d = finite(v, 'y') - this.y; this._children.forEach((c) => { c.y += d; }); }
    get width() { return this._live()._bounds().w; }
    get height() { return this._live()._bounds().h; }
    resize() { throw new Error('Cannot resize a group'); }
  }
  // GroupNode has no fills / setFillStyleIdAsync / outlineStroke in Figma.
  for (const k of ['fills', 'strokes']) Object.defineProperty(GroupNode.prototype, k, { get() { return undefined; }, set() { throw new Error(`GroupNode has no ${k}`); } });
  GroupNode.prototype.setFillStyleIdAsync = undefined;

  class TextNode extends Node {
    constructor() {
      super('TEXT', { name: 'Text' });
      this._font = { family: 'Inter', style: 'Regular' };
      this._chars = ''; this._size = 12; this.textAutoResize = 'NONE'; this.textAlignHorizontal = 'LEFT';
      this._fills = deepFreeze([{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]);
      this._relayout();
    }
    _needFont(f) { if (!loadedFonts.has(fontKey(f))) throw new Error(`in set: Cannot write to node with unloaded font "${f.family} ${f.style}". Please call figma.loadFontAsync`); }
    _relayout() { this._w = this._chars.length * this._size * 0.6; this._h = this._size * 1.21; }
    get fontName() { return this._live()._font; }
    set fontName(f) { this._live(); this._needFont(f); this._font = { ...f }; }
    get characters() { return this._live()._chars; }
    set characters(v) { this._live(); this._needFont(this._font); this._chars = String(v); this._relayout(); }
    get fontSize() { return this._live()._size; }
    set fontSize(v) { this._live(); this._needFont(this._font); if (finite(v, 'fontSize') < 1) throw new Error('fontSize must be >= 1'); this._size = v; this._relayout(); }
  }

  class PageNode extends ContainerNode {
    constructor() { super('PAGE', { name: 'Page 1' }); this._selection = []; }
    get selection() { this._selection = this._selection.filter((n) => !n._removed); return Object.freeze([...this._selection]); }
    set selection(nodes) {
      if (!Array.isArray(nodes)) throw new Error('selection must be an array');
      for (const n of nodes) {
        n._live();
        let a = n; while (a._parent) a = a._parent;
        if (a !== this) throw new Error(`${n} is not on the current page`);
      }
      this._selection = [...nodes];
    }
  }

  const page = new PageNode();

  // Absolute origin of a container's child coordinate space (groups don't introduce one).
  const originOf = (n) => {
    if (!n || n.type === 'PAGE') return { x: 0, y: 0 };
    if (n.type === 'GROUP') return originOf(n._parent);
    const o = originOf(n._parent);
    return { x: o.x + n.x, y: o.y + n.y };
  };
  const absPos = (n) => { const o = originOf(n._parent); return { x: o.x + n.x, y: o.y + n.y }; };

  function parseSvg(svg) {
    if (typeof svg !== 'string' || !/^<svg[\s>][\s\S]*<\/svg>\s*$/.test(svg)) throw new Error('Failed to parse SVG');
    const head = svg.match(/^<svg[^>]*>/)[0];
    const attr = (s, a) => { const m = s.match(new RegExp(`\\s${a}="([^"]*)"`)); return m ? m[1] : null; };
    const w = parseFloat(attr(head, 'width')), h = parseFloat(attr(head, 'height'));
    if (!(w > 0 && h > 0)) throw new Error('Failed to parse SVG: missing size');
    const vb = (attr(head, 'viewBox') || `0 0 ${w} ${h}`).trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) throw new Error('Failed to parse SVG: bad viewBox');
    const sx = w / vb[2], sy = h / vb[3];
    const paths = [];
    for (const m of svg.matchAll(/<path\b[^>]*\/?>/g)) {
      const tag = m[0];
      const d = attr(tag, 'd');
      if (!d) continue;
      if (/[a-z]/.test(d.replace(/e-?\d/g, ''))) throw new Error('mock only understands absolute path commands');
      const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
      if (nums.length < 2 || nums.some((v) => !Number.isFinite(v))) throw new Error('Failed to parse SVG: bad path');
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      paths.push({
        x: (x0 - vb[0]) * sx, y: (y0 - vb[1]) * sy,
        w: (Math.max(...xs) - x0) * sx, h: (Math.max(...ys) - y0) * sy,
        fill: attr(tag, 'fill'), stroke: attr(tag, 'stroke'), strokeWidth: parseFloat(attr(tag, 'stroke-width') || '1') * Math.min(sx, sy),
      });
    }
    return { w, h, paths };
  }

  const solid = (hex) => { const c = hexToRgb(hex); return c ? { type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: c } : null; };

  const figma = {
    get currentPage() { return page; },
    command: opts.command || '',
    root: { children: [page] },
    showUI(html, options) { log.showUI = { html, options }; },
    on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    notify(message, options) { log.notify.push({ message, options: options || {} }); return { cancel() {} }; },
    commitUndo() { log.commitUndo++; },
    viewport: {
      get center() { return { ...viewportCenter }; },
      scrollAndZoomIntoView(nodes) { nodes.forEach((n) => n._live()); log.scrollIntoView.push(nodes.map((n) => n.id)); },
    },
    ui: {
      onmessage: undefined,
      postMessage(msg) { log.posted.push(clone(msg)); },
    },
    clientStorage: {
      async getAsync(k) { await later(); return k in storage ? clone(storage[k]) : undefined; },
      async setAsync(k, v) { await later(); storage[k] = clone(v); },
    },
    async getNodeByIdAsync(id) { await later(); return registry.get(id) || null; },
    getNodeById() { throw new Error('getNodeById is not allowed with documentAccess: dynamic-page; use getNodeByIdAsync'); },
    createNodeFromSvg(svg) {
      log.svgBuilds++;
      const parsed = parseSvg(svg);
      const frame = new ContainerNode('FRAME', { name: 'svg', width: parsed.w, height: parsed.h });
      frame._x = svgOrigin.x; frame._y = svgOrigin.y;
      page.appendChild(frame);
      for (const p of parsed.paths) {
        const v = new Node('VECTOR', { name: 'Vector' });
        v._x = p.x; v._y = p.y; v._w = p.w; v._h = p.h;
        const fill = p.fill === null ? '#000000' : p.fill; // SVG default fill is black
        v._fills = deepFreeze(fill === 'none' ? [] : [solid(fill)].filter(Boolean));
        v._strokes = deepFreeze(p.stroke && p.stroke !== 'none' ? [solid(p.stroke)].filter(Boolean) : []);
        v.strokeWeight = v._strokes.length ? p.strokeWidth : 0;
        frame.appendChild(v);
      }
      return frame;
    },
    createText() { const t = new TextNode(); page.appendChild(t); return t; },
    createFrame() { const f = new ContainerNode('FRAME', { name: 'Frame', width: 100, height: 100 }); page.appendChild(f); return f; },
    createRectangle() {
      const r = new Node('RECTANGLE', { name: 'Rectangle', width: 100, height: 100 });
      r._fills = deepFreeze([solid('#D9D9D9')]);
      page.appendChild(r); return r;
    },
    createSection() { const s = new ContainerNode('SECTION', { name: 'Section', width: 100, height: 100 }); page.appendChild(s); return s; },
    group(nodes, parent, index) {
      if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('First argument to group() must be an array of at least one node');
      parent._live();
      if (!(parent instanceof ContainerNode)) throw new Error(`${parent.type} cannot be a group parent`);
      nodes.forEach((n) => n._live());
      const abs = nodes.map(absPos);
      const g = new GroupNode();
      parent.insertChild(index === undefined ? parent._children.length : index, g);
      const o = originOf(parent);
      nodes.forEach((n, i) => {
        n._detach();
        g._children.push(n);
        n._parent = g;
        n._x = abs[i].x - o.x; n._y = abs[i].y - o.y;
      });
      return g;
    },
    async loadFontAsync(font) {
      log.fontLoads.push(fontKey(font));
      await later();
      if (!availableFonts.some((f) => fontKey(f) === fontKey(font))) throw new Error(`The font "${font.family} ${font.style}" could not be loaded`);
      loadedFonts.add(fontKey(font));
    },
    async getLocalPaintStylesAsync() { await later(); return styles.map((s) => ({ ...s, paints: deepFreeze(clone(s.paints)) })); },
    variables: {
      async getLocalVariablesAsync(type) { await later(); return variables.filter((v) => !type || v.resolvedType === type); },
      async getVariableByIdAsync(id) { await later(); return variables.find((v) => v.id === id) || null; },
      async getVariableCollectionByIdAsync(id) { await later(); return collections.find((c) => c.id === id) || null; },
      setBoundVariableForPaint(paint, field, variable) {
        if (field !== 'color') throw new Error('field must be "color"');
        if (!variable || variable.resolvedType !== 'COLOR') throw new Error('variable must be a COLOR variable');
        log.boundPaintCalls.push({ variable: variable.id });
        return { ...clone(paint), boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable.id } } };
      },
    },
  };

  const fire = (event, ...args) => (handlers[event] || []).forEach((cb) => cb(...args));
  const console_ = {
    log: (...a) => log.console.push(['log', a]), info: (...a) => log.console.push(['info', a]),
    warn: (...a) => log.console.push(['warn', a]), error: (...a) => log.console.push(['error', a]),
  };

  return { figma, page, log, handlers, fire, registry, console: console_, storage, absPos, hexToRgb };
}

module.exports = { createFigma };
