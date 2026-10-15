// Shape engine: builds bezier paths for every shape type and serialises them to SVG.
// Pure JS, no DOM — shared by the plugin UI and the Node test script.
const ShapeEngine = (() => {
  const TAU = Math.PI * 2;
  const R = 100; // nominal shape radius; final output is rescaled to the requested size
  const K = 0.5523; // bezier circle constant

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- path primitives ----------
  // A path is { nodes, closed, hole? }; a node is { x, y, hi, ho } with absolute bezier handles.
  const node = (x, y, hi = null, ho = null) => ({ x, y, hi, ho });
  const polar = (r, a, cx = 0, cy = 0) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const jitter = (rand, amt) => (rand() * 2 - 1) * amt;

  // Catmull-Rom through points; points flagged `corner` stay sharp.
  function smooth(pts, closed, tension = 1) {
    const n = pts.length;
    return pts.map((p, i) => {
      const nd = node(p.x, p.y);
      if (p.corner) return nd;
      const a = closed ? pts[(i - 1 + n) % n] : pts[i - 1];
      const b = closed ? pts[(i + 1) % n] : pts[i + 1];
      if (!a || !b) return nd;
      const tx = ((b.x - a.x) / 6) * tension, ty = ((b.y - a.y) / 6) * tension;
      nd.hi = { x: p.x - tx, y: p.y - ty };
      nd.ho = { x: p.x + tx, y: p.y + ty };
      return nd;
    });
  }

  // Closed polygon with a fillet radius per corner (0 = sharp).
  function rounded(pts, radii) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], r = radii[i];
      if (!r) { out.push(node(p.x, p.y)); continue; }
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const da = dist(a, p), db = dist(b, p);
      const t = Math.min(r, da / 2, db / 2);
      const p1 = lerp(p, a, t / da), p2 = lerp(p, b, t / db);
      out.push(node(p1.x, p1.y, null, lerp(p1, p, K)));
      out.push(node(p2.x, p2.y, lerp(p2, p, K), null));
    }
    return out;
  }

  // Circular arc from angle a0 to a1 (either direction) as bezier nodes.
  function arc(cx, cy, r, a0, a1) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const d = (a1 - a0) / n, k = (4 / 3) * Math.tan(d / 4) * r;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + d * i, p = polar(r, a, cx, cy);
      const tx = -Math.sin(a) * k, ty = Math.cos(a) * k;
      out.push(node(p.x, p.y,
        i > 0 ? { x: p.x - tx, y: p.y - ty } : null,
        i < n ? { x: p.x + tx, y: p.y + ty } : null));
    }
    return out;
  }

  // Concatenate node runs, merging coincident endpoints (including the closing one).
  function join(pieces) {
    const out = [];
    for (const piece of pieces) {
      for (const nd of piece) {
        const last = out[out.length - 1];
        if (last && dist(last, nd) < 1e-4) last.ho = nd.ho;
        else out.push({ ...nd });
      }
    }
    if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-4) {
      out[0].hi = out[out.length - 1].hi;
      out.pop();
    }
    return out;
  }

  const circle = (cx, cy, r) => join([arc(cx, cy, r, 0, TAU)]);

  function reverse(nodes) {
    return nodes.slice().reverse().map((nd) => node(nd.x, nd.y, nd.ho, nd.hi));
  }

  function signedArea(nodes) {
    let s = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  const orient = (nodes, positive) => ((signedArea(nodes) > 0) === positive ? nodes : reverse(nodes));

  function rotate(nodes, angle) {
    if (!angle) return nodes;
    const c = Math.cos(angle), s = Math.sin(angle);
    const f = (p) => p && { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
    return nodes.map((nd) => ({ ...f(nd), hi: f(nd.hi), ho: f(nd.ho) }));
  }

  function segments(path) {
    const ns = path.nodes, n = ns.length, m = path.closed ? n : n - 1, out = [];
    for (let i = 0; i < m; i++) {
      const a = ns[i], b = ns[(i + 1) % n];
      out.push([a, a.ho || a, b.hi || b, b]);
    }
    return out;
  }

  function bez(s, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return {
      x: a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x,
      y: a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y,
    };
  }

  // Sample a path into a polyline; anchor points without two handles are flagged as corners.
  function densify(path, step) {
    const out = [];
    for (const s of segments(path)) {
      const len = (dist(s[0], s[1]) + dist(s[1], s[2]) + dist(s[2], s[3]) + dist(s[0], s[3])) / 2;
      const k = Math.max(1, Math.ceil(len / step));
      for (let j = 0; j < k; j++) {
        const q = bez(s, j / k);
        q.corner = j === 0 && !(s[0].hi && s[0].ho);
        out.push(q);
      }
    }
    if (!path.closed) {
      const l = path.nodes[path.nodes.length - 1];
      out.push({ x: l.x, y: l.y, corner: true });
    }
    return out;
  }

  // Hand-drawn effect: low-frequency wobble plus high-frequency jag along the normal.
  function roughen(path, wobble, jag, rand) {
    if (wobble <= 0 && jag <= 0) return path;
    const pts = densify(path, R / 30), n = pts.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum[n - 1] + (path.closed ? dist(pts[n - 1], pts[0]) : 0) || 1;
    const base = Math.max(2, Math.round(total / (R * 1.2)));
    // integer frequencies keep closed paths seamless
    const harmonics = [0, 1, 2, 3].map((h) => ({
      f: Math.round(base * (1 + h * 0.8)), a: jitter(rand, 1) / (1 + h), ph: rand() * TAU,
    }));
    let walk = 0;
    const out = pts.map((q, i) => {
      const a = pts[path.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = pts[path.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const nx = a.y - b.y, ny = b.x - a.x, l = Math.hypot(nx, ny) || 1;
      const u = cum[i] / total;
      let w = 0;
      for (const h of harmonics) w += h.a * Math.sin(TAU * h.f * u + h.ph);
      walk = walk * 0.55 + jitter(rand, 1) * 0.45;
      const d = wobble * R * 0.09 * w + jag * R * 0.025 * walk;
      return { x: q.x + (nx / l) * d, y: q.y + (ny / l) * d, corner: q.corner };
    });
    if (jag > 0) return { ...path, nodes: out.map((p) => node(p.x, p.y)) };
    const kept = out.filter((p, i) => p.corner || i % 3 === 0 || (!path.closed && i === n - 1));
    return { ...path, nodes: smooth(kept, path.closed) };
  }

  // ---------- shape generators ----------
  // Each returns layers: { kind: 'fill'|'stroke', color: 'main'|'accent', paths, width?, cap? }

  function radialLayers(contour, p) {
    const paths = [{ closed: true, nodes: contour(1) }];
    if (p.hole > 0) paths.push({ closed: true, nodes: contour(p.hole), hole: true });
    const layers = [{ kind: 'fill', color: 'main', paths }];
    if (p.dot > 0) layers.push({ kind: 'fill', color: 'accent', paths: [{ closed: true, nodes: circle(0, 0, R * p.dot) }] });
    return layers;
  }

  function stick(angle, r0, r1, w, roundEnds) {
    const pts = [{ x: r0, y: -w / 2 }, { x: r1, y: -w / 2 }, { x: r1, y: w / 2 }, { x: r0, y: w / 2 }];
    const radii = [roundEnds[0], roundEnds[1], roundEnds[1], roundEnds[0]].map((v) => v * w / 2);
    return rotate(rounded(pts, radii), angle);
  }

  const GENS = {
    radial: {
      params: ['lobes', 'depth', 'petal', 'irregular', 'hole', 'dot'],
      defaults: { lobes: 16, depth: 0.12, petal: 0.8, irregular: 0, hole: 0, dot: 0 },
      build(p, rand) {
        const n = p.lobes, m = 10;
        const widths = Array.from({ length: n }, () => 1 + jitter(rand, p.irregular * 0.45));
        const heights = Array.from({ length: n }, () => 1 + jitter(rand, p.irregular * 0.4));
        const tw = widths.reduce((s, v) => s + v, 0);
        const contour = (scale) => {
          const pts = [];
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const a0 = (acc / tw) * TAU;
            acc += widths[i];
            const a1 = (acc / tw) * TAU;
            for (let j = 0; j < m; j++) {
              const u = j / m;
              const v = Math.pow(Math.sin(Math.PI * u), p.petal);
              const r = R * (1 - p.depth) + R * p.depth * v * heights[i];
              pts.push({ ...polar(r * scale, a0 + (a1 - a0) * u - Math.PI / 2), corner: j === 0 && p.petal < 1 });
            }
          }
          return smooth(pts, true);
        };
        return radialLayers(contour, p);
      },
    },

    burst: {
      params: ['points', 'inner', 'tipRound', 'valleyRound', 'irregular', 'hole', 'dot'],
      defaults: { points: 16, inner: 0.78, tipRound: 0, valleyRound: 0, irregular: 0, hole: 0, dot: 0 },
      build(p, rand) {
        const n = p.points, edge = (TAU * R) / n;
        const jit = Array.from({ length: n * 2 }, () => ({
          r: 1 + jitter(rand, p.irregular * 0.35), a: jitter(rand, p.irregular * 0.35),
        }));
        const contour = (s) => {
          const pts = [], radii = [];
          for (let i = 0; i < n * 2; i++) {
            const tip = i % 2 === 0;
            const a = ((i + jit[i].a) / (n * 2)) * TAU - Math.PI / 2;
            pts.push(polar((tip ? R : R * p.inner) * jit[i].r * s, a));
            radii.push((tip ? p.tipRound : p.valleyRound) * edge * 0.5 * s);
          }
          return rounded(pts, radii);
        };
        return radialLayers(contour, p);
      },
    },

    sparkle: {
      params: ['points', 'inner', 'irregular', 'dot'],
      defaults: { points: 4, inner: 0.12, irregular: 0, dot: 0 },
      build(p, rand) {
        const n = p.points;
        const tips = Array.from({ length: n }, (_, i) => ({
          r: R * (1 + jitter(rand, p.irregular * 0.3)),
          a: ((i + jitter(rand, p.irregular * 0.15)) / n) * TAU - Math.PI / 2,
        }));
        const mid = (a, b) => a + ((((b - a) % TAU) + TAU) % TAU) / 2;
        const contour = (s) => tips.map((t, i) => {
          const P = polar(t.r * s, t.a);
          const prev = tips[(i - 1 + n) % n], next = tips[(i + 1) % n];
          const cPrev = polar(R * p.inner * s, mid(prev.a, t.a));
          const cNext = polar(R * p.inner * s, mid(t.a, next.a));
          return node(P.x, P.y, lerp(P, cPrev, 2 / 3), lerp(P, cNext, 2 / 3));
        });
        return radialLayers(contour, { ...p, hole: 0 });
      },
    },

    asterisk: {
      params: ['spokes', 'thickness', 'capRound', 'irregular'],
      defaults: { spokes: 6, thickness: 0.22, capRound: 0, irregular: 0 },
      build(p, rand) {
        const w = R * p.thickness, paths = [];
        for (let i = 0; i < p.spokes; i++) {
          const a = ((i + jitter(rand, p.irregular * 0.25)) / p.spokes) * TAU - Math.PI / 2;
          const len = R * (1 + jitter(rand, p.irregular * 0.25));
          paths.push({ closed: true, nodes: stick(a, 0, len, w, [0, p.capRound]) });
        }
        paths.push({ closed: true, nodes: circle(0, 0, w / 2) });
        return [{ kind: 'fill', color: 'main', paths }];
      },
    },

    bar: {
      params: ['waves', 'amplitude', 'aspect', 'edge', 'mode', 'irregular'],
      defaults: { waves: 3, amplitude: 0.12, aspect: 0.5, edge: 'wave', mode: 'mirror', irregular: 0 },
      build(p, rand) {
        const k = p.waves, N = Math.max(2, Math.round(k * 12));
        const W = 2 * R * p.aspect;
        let A = p.amplitude * R;
        if (p.mode === 'mirror' && p.edge !== 'scallop') A = Math.min(A, W * 0.45);
        const amps = Array.from({ length: Math.ceil(k * 2) + 2 }, () => 1 + jitter(rand, p.irregular * 0.5));
        const f = (u) => {
          if (p.edge === 'wave') return Math.sin(TAU * u) * amps[Math.floor(u * 2)];
          const v = Math.abs(Math.sin(Math.PI * u)) * amps[Math.floor(u)];
          return p.edge === 'scallop' ? v : -v;
        };
        const right = [], left = [];
        for (let i = 0; i <= N; i++) {
          const u = (i / N) * k, y = -R + (2 * R * i) / N, fv = f(u);
          const corner = i === 0 || i === N || (p.edge !== 'wave' && Math.abs(u - Math.round(u)) < 1e-9);
          right.push({ x: W / 2 + A * fv, y, corner });
          left.push({ x: p.mode === 'mirror' ? -W / 2 - A * fv : -W / 2 + A * fv, y, corner });
        }
        return [{ kind: 'fill', color: 'main', paths: [{ closed: true, nodes: smooth(right.concat(left.reverse()), true) }] }];
      },
    },

    squiggle: {
      params: ['waves', 'amplitude', 'thickness', 'form', 'irregular'],
      defaults: { waves: 2, amplitude: 0.35, thickness: 0.22, form: 'sine', irregular: 0 },
      build(p, rand) {
        const k = p.waves, N = Math.max(2, Math.round(k * 16)), A = p.amplitude * R;
        const amps = Array.from({ length: Math.ceil(k * 2) + 2 }, () => 1 + jitter(rand, p.irregular * 0.5));
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const u = (i / N) * k, x = -R + (2 * R * i) / N, s = Math.sin(TAU * u);
          let y, corner = i === 0 || i === N;
          if (p.form === 'bumps') {
            y = (A - 2 * A * Math.abs(Math.sin(Math.PI * u))) * amps[Math.floor(u)];
            corner = corner || Math.abs(u - Math.round(u)) < 1e-9;
          } else if (p.form === 'zigzag') {
            y = A * (2 / Math.PI) * Math.asin(Math.max(-1, Math.min(1, s))) * amps[Math.floor(u * 2)];
            corner = corner || Math.abs(Math.abs(s) - 1) < 1e-9;
          } else {
            y = A * s * amps[Math.floor(u * 2)];
          }
          pts.push({ x, y, corner });
        }
        return [{ kind: 'stroke', color: 'main', width: p.thickness * R, cap: 'round', paths: [{ closed: false, nodes: smooth(pts, false) }] }];
      },
    },

    curl: {
      params: ['loops', 'loopSize', 'thickness'],
      defaults: { loops: 3, loopSize: 2.2, thickness: 0.14 },
      build(p) {
        const n = p.loops, N = n * 20, b = p.loopSize, raw = [];
        for (let i = 0; i <= N; i++) {
          const t = Math.PI + (i / N) * n * TAU;
          raw.push({ x: t - b * Math.sin(t), y: -b * Math.cos(t), corner: i === 0 || i === N });
        }
        const xs = raw.map((q) => q.x), mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        const s = (2 * R) / (Math.max(...xs) - Math.min(...xs));
        const pts = raw.map((q) => ({ x: (q.x - mid) * s, y: q.y * s, corner: q.corner }));
        return [{ kind: 'stroke', color: 'main', width: p.thickness * R, cap: 'round', paths: [{ closed: false, nodes: smooth(pts, false) }] }];
      },
    },

    arch: {
      params: ['sweep', 'thickness', 'capRound'],
      defaults: { sweep: 180, thickness: 0.35, capRound: 0 },
      build(p) {
        const w = Math.min(1, p.thickness) * R, ri = R - w, rm = R - w / 2;
        if (p.sweep >= 360) {
          const paths = [{ closed: true, nodes: circle(0, 0, R) }];
          if (ri > 0.5) paths.push({ closed: true, nodes: circle(0, 0, ri), hole: true });
          return [{ kind: 'fill', color: 'main', paths }];
        }
        const sw = (p.sweep * Math.PI) / 180, a0 = -Math.PI / 2 - sw / 2, a1 = a0 + sw;
        const caps = p.capRound && ri > 0.5;
        const pieces = [arc(0, 0, R, a0, a1)];
        if (caps) { const c = polar(rm, a1); pieces.push(arc(c.x, c.y, w / 2, a1, a1 + Math.PI)); }
        pieces.push(ri > 0.5 ? arc(0, 0, ri, a1, a0) : [node(0, 0)]);
        if (caps) { const c = polar(rm, a0); pieces.push(arc(c.x, c.y, w / 2, a0 + Math.PI, a0 + TAU)); }
        return [{ kind: 'fill', color: 'main', paths: [{ closed: true, nodes: join(pieces) }] }];
      },
    },

    sunburst: {
      params: ['rays', 'sweep', 'rayWidth', 'core', 'tipRound'],
      defaults: { rays: 9, sweep: 180, rayWidth: 0.55, core: 0.45, tipRound: 1 },
      build(p) {
        const sw = (p.sweep * Math.PI) / 180, a0 = -Math.PI / 2 - sw / 2, full = p.sweep >= 360;
        const rc = R * p.core, r0 = p.core > 0 ? rc + R * 0.1 : R * 0.25;
        const w = p.rayWidth * (sw / p.rays) * ((r0 + R) / 2);
        const paths = [];
        for (let i = 0; i < p.rays; i++) {
          const a = a0 + ((i + 0.5) * sw) / p.rays;
          paths.push({ closed: true, nodes: stick(a, r0, R, w, [p.tipRound, p.tipRound]) });
        }
        if (rc > 0) {
          paths.push({ closed: true, nodes: full ? circle(0, 0, rc) : join([arc(0, 0, rc, a0, a0 + sw), [node(0, 0)]]) });
        }
        return [{ kind: 'fill', color: 'main', paths }];
      },
    },

    blob: {
      params: ['points', 'irregular', 'dot'],
      defaults: { points: 6, irregular: 0.5, dot: 0 },
      build(p, rand) {
        const pts = [];
        for (let i = 0; i < p.points; i++) {
          const a = ((i + jitter(rand, p.irregular * 0.35)) / p.points) * TAU;
          pts.push(polar(R * (1 - p.irregular * 0.55 * rand()), a));
        }
        return radialLayers(() => smooth(pts, true, 1.15), { ...p, hole: 0 });
      },
    },
  };

  // ---------- sticker generators ----------
  const ellipse = (rx, ry, cx = 0, cy = 0) =>
    circle(0, 0, 1).map((nd) => {
      const f = (q) => q && { x: cx + q.x * rx, y: cy + q.y * ry };
      return { ...f(nd), hi: f(nd.hi), ho: f(nd.ho) };
    });
  const textLayer = (p) => (p.text ? [{ kind: 'text', color: 'accent', content: String(p.text), size: p.textSize * R }] : []);

  Object.assign(GENS, {
    heart: {
      params: ['stretch', 'dot'],
      defaults: { stretch: 1, dot: 0 },
      build(p) {
        const N = 48, pts = [], s = R / 17;
        for (let i = 0; i < N; i++) {
          const t = (i / N) * TAU;
          pts.push({
            x: 16 * Math.sin(t) ** 3 * s * p.stretch,
            y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s,
            corner: i === 0 || i === N / 2,
          });
        }
        return radialLayers(() => smooth(pts, true), { ...p, hole: 0 });
      },
    },

    bubble: {
      params: ['body', 'tail', 'tailSize', 'stretch', 'text', 'textSize'],
      defaults: { body: 'round', tail: 'left', tailSize: 0.35, stretch: 1.2, text: '', textSize: 0.32 },
      build(p) {
        const W = R * p.stretch, H = R * 0.72;
        let body;
        if (p.body === 'box') {
          const r = H * 0.45;
          body = rounded([{ x: -W, y: -H }, { x: W, y: -H }, { x: W, y: H }, { x: -W, y: H }], [r, r, r, r]);
        } else if (p.body === 'cloud') {
          const n = 10, m = 8, pts = [];
          for (let i = 0; i < n * m; i++) {
            const u = (i % m) / m, a = (i / (n * m)) * TAU;
            const r = 0.86 + 0.14 * Math.pow(Math.sin(Math.PI * u), 0.6);
            pts.push({ x: Math.cos(a) * W * r, y: Math.sin(a) * H * r, corner: u === 0 });
          }
          body = smooth(pts, true);
        } else {
          body = ellipse(W, H);
        }
        const side = p.tail === 'left' ? -1 : p.tail === 'right' ? 1 : 0;
        const bx = side * W * 0.42, a = W * 0.16, by = H * 0.55;
        const tip = { x: bx + side * R * 0.28, y: H + p.tailSize * R };
        const tailNodes = [node(bx - a, by), node(bx + a, by), node(tip.x, tip.y)];
        return [
          { kind: 'fill', color: 'main', paths: [{ closed: true, nodes: body }, { closed: true, nodes: tailNodes }] },
          ...textLayer(p),
        ];
      },
    },

    arrow: {
      params: ['shaft', 'bend', 'headSize', 'head', 'thickness'],
      defaults: { shaft: 'curve', bend: 0.4, headSize: 0.35, head: 'open', thickness: 0.09 },
      build(p) {
        const pts = [];
        if (p.shaft === 'loop') {
          const b = 3, N = 48;
          const raw = Array.from({ length: N + 1 }, (_, i) => {
            const t = Math.PI * 0.55 + (i / N) * Math.PI * 2.9;
            return { x: t - b * Math.sin(t), y: -b * Math.cos(t) * (1 + p.bend * 0.5) };
          });
          const xs = raw.map((q) => q.x), x0 = Math.min(...xs), k = (2 * R) / (Math.max(...xs) - x0);
          raw.forEach((q) => pts.push({ x: (q.x - x0) * k - R, y: q.y * k }));
        } else {
          const N = 24;
          for (let i = 0; i <= N; i++) {
            const u = i / N, x = -R + 2 * R * u;
            const y = p.shaft === 'wave'
              ? Math.sin(u * Math.PI * 3) * p.bend * R * 0.3
              : -4 * u * (1 - u) * p.bend * R * 0.6;
            pts.push({ x, y });
          }
        }
        pts[0].corner = pts[pts.length - 1].corner = true;
        const end = pts[pts.length - 1], prev = pts[pts.length - 3];
        const l = dist(end, prev), dx = (end.x - prev.x) / l, dy = (end.y - prev.y) / l;
        const h = p.headSize * R, w = p.thickness * R;
        const at = (along, side) => ({ x: end.x - dx * along - dy * side, y: end.y - dy * along + dx * side });
        const layers = [{ kind: 'stroke', color: 'main', width: w, cap: 'round', paths: [{ closed: false, nodes: smooth(pts, false) }] }];
        if (p.head === 'solid') {
          const tri = [at(-h * 0.55, 0), at(h * 0.45, h * 0.55), at(h * 0.45, -h * 0.55)];
          layers.push({ kind: 'fill', color: 'main', paths: [{ closed: true, nodes: rounded(tri, [w * 0.4, w * 0.4, w * 0.4]) }] });
        } else {
          const c = { ...end, corner: true };
          layers[0].paths.push({ closed: false, nodes: polygonOpen([at(h, h * 0.7), c, at(h, -h * 0.7)]) });
        }
        return layers;
      },
    },

    leaf: {
      params: ['aspect', 'bend', 'vein'],
      defaults: { aspect: 0.42, bend: 0.3, vein: 1 },
      build(p) {
        const N = 24, right = [], left = [];
        const mid = (u) => p.bend * R * 0.5 * 4 * u * (1 - u);
        for (let i = 0; i <= N; i++) {
          const u = i / N, y = -R + 2 * R * u;
          const w = R * p.aspect * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.9);
          const corner = i === 0 || i === N;
          right.push({ x: mid(u) + w, y, corner });
          left.push({ x: mid(u) - w, y, corner });
        }
        const outline = right.concat(left.reverse().slice(1, -1));
        const layers = [{ kind: 'fill', color: 'main', paths: [{ closed: true, nodes: smooth(outline, true) }] }];
        if (p.vein) {
          const v = [];
          for (let i = 0; i <= 12; i++) {
            const u = 0.14 + (i / 12) * 0.8;
            v.push({ x: mid(u), y: -R + 2 * R * u, corner: i === 0 || i === 12 });
          }
          layers.push({ kind: 'stroke', color: 'accent', width: R * 0.05, cap: 'round', paths: [{ closed: false, nodes: smooth(v, false) }] });
        }
        return layers;
      },
    },

    smiley: {
      params: ['face', 'mood'],
      defaults: { face: 'circle', mood: 'smile' },
      build(p, rand) {
        let face;
        if (p.face === 'flower') face = GENS.radial.build({ ...GENS.radial.defaults, lobes: 8, depth: 0.28, petal: 0.55 }, rand)[0].paths[0].nodes;
        else if (p.face === 'scallop') face = GENS.radial.build({ ...GENS.radial.defaults, lobes: 14, depth: 0.1, petal: 0.7 }, rand)[0].paths[0].nodes;
        else face = circle(0, 0, R);
        const sw = R * 0.08;
        const eyes = [], strokes = [];
        const eye = (x) => ellipse(R * 0.075, R * 0.12, x, -R * 0.18);
        if (p.mood === 'wink') {
          eyes.push(eye(R * 0.3));
          strokes.push({ closed: false, nodes: arc(-R * 0.3, -R * 0.1, R * 0.11, Math.PI * 1.15, Math.PI * 1.85) });
        } else {
          eyes.push(eye(-R * 0.3), eye(R * 0.3));
        }
        if (p.mood === 'grin') eyes.push(join([arc(0, R * 0.12, R * 0.42, 0, Math.PI), [node(-R * 0.42, R * 0.12)]]));
        else if (p.mood === 'meh') strokes.push({ closed: false, nodes: [node(-R * 0.28, R * 0.32), node(R * 0.28, R * 0.32)] });
        else strokes.push({ closed: false, nodes: arc(0, R * 0.02, R * 0.42, Math.PI * 0.2, Math.PI * 0.8) });
        return [
          { kind: 'fill', color: 'main', paths: [{ closed: true, nodes: face }] },
          { kind: 'fill', color: 'accent', paths: eyes.map((nodes) => ({ closed: true, nodes })) },
          { kind: 'stroke', color: 'accent', width: sw, cap: 'round', paths: strokes },
        ];
      },
    },

    badge: {
      params: ['points', 'inner', 'tipRound', 'valleyRound', 'text', 'textSize'],
      defaults: { points: 14, inner: 0.82, tipRound: 0.2, valleyRound: 0.2, text: 'NEW', textSize: 0.42 },
      build(p, rand) {
        return [...GENS.burst.build({ ...p, irregular: 0, hole: 0, dot: 0 }, rand), ...textLayer(p)];
      },
    },
  });

  function polygonOpen(pts) {
    return pts.map((q) => node(q.x, q.y));
  }

  // ---------- parameters ----------
  const PARAMS = {
    lobes: { label: 'Lobes', min: 3, max: 32, step: 1 },
    depth: { label: 'Depth', min: 0.02, max: 0.8, step: 0.01 },
    petal: { label: 'Petal shape', min: 0.2, max: 5, step: 0.05 },
    points: { label: 'Points', min: 3, max: 32, step: 1 },
    inner: { label: 'Inner radius', min: 0, max: 0.95, step: 0.01 },
    tipRound: { label: 'Tip rounding', min: 0, max: 1, step: 0.01 },
    valleyRound: { label: 'Valley rounding', min: 0, max: 1, step: 0.01 },
    spokes: { label: 'Spokes', min: 2, max: 12, step: 1 },
    thickness: { label: 'Thickness', min: 0.04, max: 1, step: 0.01 },
    capRound: { label: 'Round ends', toggle: true },
    waves: { label: 'Waves', min: 0.5, max: 10, step: 0.5 },
    amplitude: { label: 'Amplitude', min: 0, max: 0.8, step: 0.01 },
    aspect: { label: 'Width', min: 0.1, max: 1, step: 0.01 },
    edge: { label: 'Edge', options: ['wave', 'scallop', 'bite'] },
    mode: { label: 'Sides', options: ['mirror', 'parallel'] },
    form: { label: 'Form', options: ['sine', 'bumps', 'zigzag'] },
    loops: { label: 'Loops', min: 1, max: 8, step: 1 },
    loopSize: { label: 'Loop size', min: 1, max: 5, step: 0.05 },
    sweep: { label: 'Sweep°', min: 20, max: 360, step: 1 },
    rays: { label: 'Rays', min: 3, max: 40, step: 1 },
    rayWidth: { label: 'Ray width', min: 0.1, max: 1, step: 0.01 },
    core: { label: 'Core', min: 0, max: 0.8, step: 0.01 },
    irregular: { label: 'Irregularity', min: 0, max: 1, step: 0.01 },
    hole: { label: 'Hole', min: 0, max: 0.85, step: 0.01 },
    dot: { label: 'Center dot', min: 0, max: 0.6, step: 0.01 },
    stretch: { label: 'Width', min: 0.5, max: 1.6, step: 0.01 },
    body: { label: 'Body', options: ['round', 'box', 'cloud'] },
    tail: { label: 'Tail', options: ['left', 'bottom', 'right'] },
    tailSize: { label: 'Tail length', min: 0.1, max: 0.7, step: 0.01 },
    shaft: { label: 'Shaft', options: ['curve', 'wave', 'loop'] },
    bend: { label: 'Bend', min: -1, max: 1, step: 0.01 },
    headSize: { label: 'Head size', min: 0.1, max: 0.7, step: 0.01 },
    head: { label: 'Head', options: ['open', 'solid'] },
    vein: { label: 'Vein', toggle: true },
    face: { label: 'Face', options: ['circle', 'flower', 'scallop'] },
    mood: { label: 'Mood', options: ['smile', 'grin', 'wink', 'meh'] },
    text: { label: 'Text', text: true },
    textSize: { label: 'Text size', min: 0.1, max: 0.9, step: 0.01 },
    rotation: { label: 'Rotation', min: 0, max: 360, step: 1 },
    wobble: { label: 'Wobble', min: 0, max: 1, step: 0.01 },
    jag: { label: 'Rough edge', min: 0, max: 1, step: 0.01 },
  };
  const COMMON = ['rotation', 'wobble', 'jag'];
  const COMMON_DEFAULTS = { rotation: 0, wobble: 0, jag: 0 };

  // ---------- types (presets over generators) ----------
  const TYPES = [
    // Geometric
    ['scallop', 'Scallop', 'Geometric', 'radial', { lobes: 16, depth: 0.12, petal: 0.7 }],
    ['scallopRing', 'Scallop ring', 'Geometric', 'radial', { lobes: 16, depth: 0.14, petal: 0.7, hole: 0.42 }],
    ['flower', 'Flower', 'Geometric', 'radial', { lobes: 6, depth: 0.42, petal: 0.55 }],
    ['petalRing', 'Petal ring', 'Geometric', 'radial', { lobes: 9, depth: 0.3, petal: 0.5, hole: 0.45 }],
    ['daisy', 'Daisy', 'Geometric', 'radial', { lobes: 10, depth: 0.6, petal: 2.6 }],
    ['clover', 'Clover', 'Geometric', 'radial', { lobes: 4, depth: 0.55, petal: 0.4, rotation: 45 }],
    ['starburst', 'Starburst', 'Geometric', 'burst', { points: 16, inner: 0.8 }],
    ['burstRing', 'Burst ring', 'Geometric', 'burst', { points: 14, inner: 0.78, hole: 0.4 }],
    ['badge', 'Soft badge', 'Geometric', 'burst', { points: 10, inner: 0.78, tipRound: 0.35, valleyRound: 0.35 }],
    ['star', 'Star', 'Geometric', 'burst', { points: 5, inner: 0.5, tipRound: 0.12, valleyRound: 0.05 }],
    ['spikyStar', 'Spiky star', 'Geometric', 'burst', { points: 8, inner: 0.38 }],
    ['sparkle', 'Sparkle', 'Geometric', 'sparkle', { points: 4, inner: 0.12 }],
    ['asterisk', 'Asterisk', 'Geometric', 'asterisk', { spokes: 6, thickness: 0.24 }],
    ['wavyBar', 'Wavy bar', 'Geometric', 'bar', { waves: 2, amplitude: 0.15, aspect: 0.55, edge: 'wave', mode: 'mirror' }],
    ['ribbon', 'Ribbon', 'Geometric', 'bar', { waves: 1.5, amplitude: 0.3, aspect: 0.5, edge: 'wave', mode: 'parallel' }],
    ['scallopBar', 'Scallop bar', 'Geometric', 'bar', { waves: 4, amplitude: 0.1, aspect: 0.6, edge: 'scallop', mode: 'mirror' }],
    ['biteBar', 'Bitten bar', 'Geometric', 'bar', { waves: 5, amplitude: 0.08, aspect: 0.4, edge: 'bite', mode: 'mirror' }],
    ['squiggle', 'Squiggle', 'Geometric', 'squiggle', { waves: 2, amplitude: 0.3, thickness: 0.22, form: 'sine' }],
    ['bumps', 'Bumps', 'Geometric', 'squiggle', { waves: 2, amplitude: 0.4, thickness: 0.3, form: 'bumps' }],
    ['zigzag', 'Zigzag', 'Geometric', 'squiggle', { waves: 3, amplitude: 0.25, thickness: 0.16, form: 'zigzag' }],
    ['arch', 'Arch', 'Geometric', 'arch', { sweep: 180, thickness: 0.38 }],
    ['quarterArch', 'Quarter arch', 'Geometric', 'arch', { sweep: 90, thickness: 0.4, rotation: 45 }],
    ['halfCircle', 'Half circle', 'Geometric', 'arch', { sweep: 180, thickness: 1 }],
    ['sunburst', 'Sunburst', 'Geometric', 'sunburst', { rays: 9, sweep: 180, rayWidth: 0.55, core: 0.45 }],
    // Freeform
    ['blob', 'Blob', 'Freeform', 'blob', { points: 6, irregular: 0.5 }],
    ['puff', 'Puff', 'Freeform', 'radial', { lobes: 9, depth: 0.28, petal: 0.5, irregular: 0.75 }],
    ['splat', 'Splat', 'Freeform', 'burst', { points: 9, inner: 0.55, tipRound: 0.12, valleyRound: 0.5, irregular: 0.8 }],
    ['wobblyFlower', 'Wobbly flower', 'Freeform', 'radial', { lobes: 7, depth: 0.45, petal: 0.7, irregular: 0.6, dot: 0.2 }],
    ['wildFlower', 'Wild flower', 'Freeform', 'radial', { lobes: 8, depth: 0.6, petal: 2.2, irregular: 0.7, wobble: 0.3 }],
    ['worm', 'Worm', 'Freeform', 'squiggle', { waves: 1.5, amplitude: 0.35, thickness: 0.2, form: 'sine', irregular: 0.7, wobble: 0.35 }],
    ['curl', 'Curl', 'Freeform', 'curl', { loops: 3, loopSize: 2.2, thickness: 0.12 }],
    ['roughStar', 'Hand-drawn star', 'Freeform', 'burst', { points: 5, inner: 0.48, tipRound: 0.05, irregular: 0.3, wobble: 0.25, jag: 0.35 }],
    // Stickers
    ['heart', 'Heart', 'Stickers', 'heart', {}],
    ['bubble', 'Speech bubble', 'Stickers', 'bubble', { body: 'round', tail: 'left' }],
    ['thought', 'Cloud bubble', 'Stickers', 'bubble', { body: 'cloud', tail: 'right', tailSize: 0.3 }],
    ['arrow', 'Arrow', 'Stickers', 'arrow', { shaft: 'curve', bend: 0.45 }],
    ['loopArrow', 'Loop arrow', 'Stickers', 'arrow', { shaft: 'loop', bend: 0.2, headSize: 0.3, thickness: 0.07 }],
    ['leaf', 'Leaf', 'Stickers', 'leaf', { rotation: 35 }],
    ['smiley', 'Smiley', 'Stickers', 'smiley', {}],
    ['flowerSmiley', 'Flower smiley', 'Stickers', 'smiley', { face: 'flower', mood: 'grin' }],
    ['textBadge', 'Text badge', 'Stickers', 'badge', { text: 'NEW' }],
    ['saleBadge', 'Sale burst', 'Stickers', 'badge', { points: 20, inner: 0.84, tipRound: 0, valleyRound: 0, text: 'SALE', textSize: 0.36, rotation: 351 }],
  ].map(([id, label, group, gen, defaults]) => ({ id, label, group, gen, defaults }));
  const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  function paramsFor(typeId) {
    return [...GENS[TYPE_MAP[typeId].gen].params, ...COMMON];
  }

  function defaultsFor(typeId) {
    const t = TYPE_MAP[typeId];
    return { ...COMMON_DEFAULTS, ...GENS[t.gen].defaults, ...t.defaults };
  }

  const snap = (v, def) => {
    const c = Math.min(def.max, Math.max(def.min, v));
    return Math.round(c / def.step) * def.step;
  };

  // Nudge params around `base` (default: type defaults); `amount` 0..1 sets how far.
  function vary(typeId, base, rand, amount = 0.35) {
    const out = { ...(base || defaultsFor(typeId)) };
    for (const key of paramsFor(typeId)) {
      const def = PARAMS[key];
      if (COMMON.includes(key)) continue;
      if (def.text) continue;
      if (def.options) { if (rand() < 0.25) out[key] = def.options[Math.floor(rand() * def.options.length)]; continue; }
      if (def.toggle) { if (rand() < 0.25) out[key] = out[key] ? 0 : 1; continue; }
      if ((key === 'hole' || key === 'dot') && !out[key]) continue; // don't add holes/dots out of nowhere
      if (def.step >= 1) {
        // counts vary proportionally and avoid collapsing to triangles
        const lo = Math.max(def.min, Math.min(out[key], 4));
        out[key] = Math.max(lo, snap(out[key] * (1 + jitter(rand, amount * 0.7)), def));
        continue;
      }
      const lo = key === 'amplitude' || key === 'depth' ? Math.max(def.min, Math.min(out[key], 0.08)) : def.min;
      out[key] = +Math.max(lo, snap(out[key] + jitter(rand, (def.max - def.min) * amount * 0.5), def)).toFixed(4);
    }
    return out;
  }

  // Coerce untrusted params (e.g. plugin data from someone else's file) into each param's valid range.
  function sanitize(typeId, params) {
    const defs = defaultsFor(typeId), out = {};
    for (const key of paramsFor(typeId)) {
      const def = PARAMS[key], v = params ? params[key] : undefined, d = defs[key];
      if (def.text) out[key] = typeof v === 'string' ? v.slice(0, 40) : d;
      else if (def.options) out[key] = def.options.includes(v) ? v : d;
      else if (def.toggle) out[key] = v === undefined ? d : v ? 1 : 0;
      else {
        const n = Number(v);
        if (v === undefined || v === null || v === '' || !isFinite(n)) out[key] = d;
        else out[key] = def.step >= 1 ? Math.round(Math.min(def.max, Math.max(def.min, n))) : Math.min(def.max, Math.max(def.min, n));
      }
    }
    return out;
  }

  function generate(typeId, params, seed) {
    const t = TYPE_MAP[typeId];
    const p = sanitize(typeId, params);
    const rand = rng(seed), roughRand = rng(seed ^ 0x9e3779b9);
    const rot = (p.rotation * Math.PI) / 180;
    return GENS[t.gen].build(p, rand).map((layer) => layer.kind === 'text' ? layer : ({
      ...layer,
      paths: layer.paths.map((path) => {
        let q = { ...path, nodes: rotate(path.nodes, rot) };
        q = roughen(q, p.wobble, p.jag, roughRand);
        if (layer.kind === 'fill' && q.closed) q.nodes = orient(q.nodes, !path.hole);
        return q;
      }),
    }));
  }

  const fmt = (v) => String(Math.round(v * 100) / 100);

  function pathData(path) {
    const ns = path.nodes;
    let d = `M ${fmt(ns[0].x)} ${fmt(ns[0].y)}`;
    for (const s of segments(path)) {
      d += s[0].ho || s[3].hi
        ? ` C ${fmt(s[1].x)} ${fmt(s[1].y)} ${fmt(s[2].x)} ${fmt(s[2].y)} ${fmt(s[3].x)} ${fmt(s[3].y)}`
        : ` L ${fmt(s[3].x)} ${fmt(s[3].y)}`;
    }
    return path.closed ? d + ' Z' : d;
  }

  function bounds(layers) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of layers) {
      if (l.kind === 'text') continue;
      const pad = l.kind === 'stroke' ? l.width / 2 : 0;
      for (const path of l.paths) {
        for (const q of densify(path, 2)) {
          x0 = Math.min(x0, q.x - pad); y0 = Math.min(y0, q.y - pad);
          x1 = Math.max(x1, q.x + pad); y1 = Math.max(y1, q.y + pad);
        }
      }
    }
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  }

  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Returns { svg, text }. With `inlineText: false` text is left out of the SVG and described in `text`
  // (center and font size as fractions of the output box) so Figma can add it as a real, editable text layer.
  function render(layers, { fill = '#2B4ACB', accent = '#F5C788', size = 200, inlineText = true } = {}) {
    const { x0, y0, w, h } = bounds(layers);
    const s = size / Math.max(w, h);
    let text = null;
    const body = layers.map((l) => {
      const c = l.color === 'accent' ? accent : fill;
      if (l.kind === 'text') {
        if (!l.content.trim()) return '';
        text = { content: l.content, color: c, cx: -x0 / w, cy: -y0 / h, size: l.size / Math.max(w, h) };
        return inlineText
          ? `<text x="0" y="0" fill="${c}" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="${fmt(l.size)}" text-anchor="middle" dominant-baseline="central">${esc(l.content)}</text>`
          : '';
      }
      const d = l.paths.map(pathData).join(' ');
      if (!d) return '';
      return l.kind === 'stroke'
        ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${fmt(l.width)}" stroke-linecap="${l.cap || 'round'}" stroke-linejoin="round"/>`
        : `<path d="${d}" fill="${c}"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w * s)}" height="${fmt(h * s)}" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}">${body}</svg>`;
    return { svg, text };
  }

  const toSVG = (layers, opts) => render(layers, opts).svg;

  const GROUPS = ['Geometric', 'Freeform', 'Stickers'];

  return { TYPES, TYPE_MAP, GROUPS, PARAMS, COMMON, rng, paramsFor, defaultsFor, sanitize, vary, generate, render, toSVG };
})();

if (typeof module !== 'undefined') module.exports = ShapeEngine;
