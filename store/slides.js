// Renders the Community thumbnail and carousel images (1920×1080) into store/slides/.
// Uses the real shape engine and real screenshots of the plugin UI (dist/ui.html — run `npm run build` first).
// Run: node store/slides.js   → store/slides/01-hero.png … 06-made-with.png, and store/thumbnail.png (= 01)
const E = require('../src/engine.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const P = { blue: '#2B4ACB', lilac: '#EFCBF4', peach: '#F5C788', coral: '#EE7B61', sage: '#5E8F7A', navy: '#14284B', paper: '#F4F2F0' };
const OUT = path.join(__dirname, 'slides');
const TMP = path.join(__dirname, '_tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const chrome = (args) => execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', ...args], { stdio: 'ignore' });
const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

// ---------- building blocks ----------
function svg(type, fill, accent = P.peach, params = {}, seed = 11) {
  return E.toSVG(E.generate(type, { ...E.defaultsFor(type), ...params }, seed), { fill, accent, size: 100 })
    .replace('<svg ', '<svg style="width:100%;height:100%;overflow:visible" ');
}
// Absolutely positioned shape; `w` is the box size, centered content.
function shape(type, fill, accent, params, x, y, w, rot = 0, extra = '') {
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${w}px;transform:rotate(${rot}deg);display:flex;align-items:center;justify-content:center;${extra}">${svg(type, fill, accent, params)}</div>`;
}

// Screenshot of the real plugin UI after running `stage` (JS executed in the page) — returns a data URL.
let uiCount = 0;
function captureUI(stage, { w = 760, h = 620, crop = null } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dist', 'ui.html'), 'utf8');
  const html = src.replace('</body>', `<script>
    const fromFigma = (m) => window.onmessage({ data: { pluginMessage: m } });
    setTimeout(() => { ${stage} }, 30);
  </script></body>`);
  const file = path.join(TMP, `ui${uiCount++}.html`), png = file.replace('.html', '.png');
  fs.writeFileSync(file, html);
  chrome(['--force-device-scale-factor=2', '--virtual-time-budget=2000', `--window-size=${w},${h}`, `--screenshot=${png}`, `file://${file}`]);
  if (crop) execFileSync('sips', ['-c', String(crop.h * 2), String(crop.w * 2), '--cropOffset', String(crop.y * 2), String(crop.x * 2), png], { stdio: 'ignore' });
  return dataUrl(png);
}

const window_ = (img, x, y, w, h, extra = '') =>
  `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:18px;overflow:hidden;
    box-shadow:0 40px 90px rgba(10,18,40,.4),0 0 0 1px rgba(0,0,0,.08);${extra}"><img src="${img}" style="width:100%;height:100%;display:block"></div>`;

function page(bg, body, color = P.paper) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${bg};position:relative;color:${color};
    font-family:-apple-system,"SF Pro Display","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
    .eyebrow{font-size:26px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
    .h{font-size:92px;line-height:1;font-weight:800;letter-spacing:-.035em}
    .p{font-size:34px;line-height:1.35}
    .abs{position:absolute}
    .chip{display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 10px;border-radius:999px;background:#fff;color:${P.navy};font-size:20px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.12)}
    .chip i{width:22px;height:22px;border-radius:6px;display:inline-block}
    .sticker{filter:drop-shadow(5px 0 0 #fff) drop-shadow(-5px 0 0 #fff) drop-shadow(0 5px 0 #fff) drop-shadow(0 -5px 0 #fff) drop-shadow(0 10px 14px rgba(20,40,75,.18))}
  </style></head><body>${body}</body></html>`;
}

function render(name, html) {
  const file = path.join(TMP, `${name}.html`);
  fs.writeFileSync(file, html);
  chrome(['--window-size=1920,1080', `--screenshot=${path.join(OUT, name + '.png')}`, `file://${file}`]);
  console.log(`store/slides/${name}.png`);
}

// Collapses inspector sections by title (used to bring the Scatter / Color panels into view).
const collapse = (...titles) => titles.map((t) =>
  `[...document.querySelectorAll('details')].forEach(d => { if (d.querySelector('summary').textContent.trim() === '${t}') d.open = false; });`).join('');
const tile = (title) => `document.querySelector('.tile[title="${title}"]').click(); document.getElementById('gallery').parentElement.scrollTop = 0;`;
const color = (target, swatchIndex) =>
  `document.querySelectorAll('.target')[${target === 'fill' ? 0 : 1}].click(); document.querySelectorAll('.swatches .sw')[${swatchIndex}].click();`;

// ---------- 01 hero ----------
{
  const ui = captureUI(`${color('accent', 5)} ${color('fill', 3)} ${tile('Flower smiley')}`);
  const deco = [
    ['scallop', P.peach, P.peach, { lobes: 14, depth: 0.14 }, 1700, -70, 300],
    ['heart', P.coral, P.coral, {}, 1745, 700, 210, 12],
    ['sparkle', P.lilac, P.lilac, {}, 930, 60, 110],
    ['squiggle', P.lilac, P.lilac, { thickness: 0.3 }, 120, 900, 260, -8],
    ['daisy', P.blue, P.blue, { lobes: 9 }, -90, -80, 300],
    ['starburst', P.sage, P.sage, {}, 760, 880, 220],
    ['sparkle', P.peach, P.peach, {}, 640, 150, 70],
    ['wobblyFlower', P.coral, P.peach, {}, 1660, 400, 170, -10],
  ].map((d) => shape(...d)).join('');
  render('01-hero', page(P.navy, `${deco}
    <div class="abs" style="left:150px;top:300px;width:620px">
      <div class="eyebrow" style="color:${P.peach};margin-bottom:24px">Figma plugin</div>
      <div class="h" style="font-size:124px;line-height:.95">Shape<br>Maker</div>
      <div class="p" style="margin-top:36px;font-size:38px;color:#C9CFE3">42 editable shapes &amp; stickers.<br>Tweak them anytime, or scatter<br>them across any frame.</div>
    </div>
    ${window_(ui, 850, 205, 836, 682)}`));
}

// ---------- 02 all shapes ----------
{
  const colors = [P.blue, P.coral, P.peach, P.sage, P.navy, P.lilac];
  let body = '';
  const groups = E.GROUPS.map((g) => [g, E.TYPES.filter((t) => t.group === g)]);
  // Layout: three labeled bands, up to 12 per row.
  let y = 250, i = 0;
  const cell = 128, gap = 16, cols = 12, left = 104;
  for (const [g, types] of groups) {
    body += `<div class="abs eyebrow" style="left:${left}px;top:${y - 44}px;color:${P.sage};font-size:20px">${g} · ${types.length}</div>`;
    types.forEach((t, k) => {
      const x = left + (k % cols) * (cell + gap), yy = y + Math.floor(k / cols) * (cell + gap);
      const fill = colors[i % colors.length], accent = fill === P.navy || fill === P.blue ? P.peach : P.navy;
      body += `<div class="abs" style="left:${x}px;top:${yy}px;width:${cell}px;height:${cell}px;border-radius:20px;background:#fff;display:flex;align-items:center;justify-content:center">
        <div style="width:96px;height:96px">${svg(t.id, fill, accent, {}, 7 + i)}</div></div>`;
      i++;
    });
    y += Math.ceil(types.length / cols) * (cell + gap) + 70;
  }
  render('02-all-shapes', page(P.paper, `
    <div class="abs" style="left:104px;top:80px;color:${P.navy}">
      <div class="h" style="font-size:72px">42 shapes. Endless variations.</div>
    </div>
    <div class="abs p" style="left:1216px;top:96px;width:600px;color:#5a6178;font-size:26px;text-align:right">Every shape has its own sliders, a hand-drawn mode, and one-click variations.</div>
    ${body}`, P.navy));
}

// ---------- 03 scatter ----------
{
  const ui = captureUI(`
    ${tile('Puff')}
    fromFigma({ type: 'selection', shape: null, frame: { id: '1:2', name: 'Summer poster', width: 1080, height: 1350 } });
    ${collapse('Shape', 'Transform & texture', 'Color')}`, { crop: { x: 469, y: 0, w: 291, h: 330 } });
  // Poster frame (scaled 1080×1350 → 540×675) filled with scattered shapes from the engine.
  const W = 540, H = 675, rand = E.rng(42), placed = [];
  const pool = ['scallop', 'flower', 'daisy', 'sparkle', 'heart', 'blob', 'starburst', 'squiggle', 'puff', 'smiley', 'clover', 'wobblyFlower'];
  const cols = [P.blue, P.coral, P.peach, P.lilac, P.sage];
  let shapes = '';
  for (let n = 0; n < 34; n++) {
    for (let t = 0; t < 80; t++) {
      const s = 50 + rand() * 80, cx = rand() * W, cy = rand() * H;
      if (placed.some((p) => Math.hypot(p.cx - cx, p.cy - cy) < (p.s + s) / 2 * 0.95)) continue;
      placed.push({ cx, cy, s });
      const type = pool[Math.floor(rand() * pool.length)];
      shapes += shape(type, cols[Math.floor(rand() * cols.length)], P.navy, {}, cx - s / 2, cy - s / 2, s, Math.round(rand() * 360));
      break;
    }
  }
  const poster = `<div class="abs" style="left:820px;top:230px;width:${W}px;height:${H}px;background:${P.paper};overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.35)">
      ${shapes}
      <div class="abs" style="left:0;right:0;top:250px;text-align:center;color:${P.navy}">
        <div style="display:inline-block;background:${P.paper};padding:18px 30px;border-radius:24px">
          <div style="font-size:22px;font-weight:700;letter-spacing:.2em">JULY 12 – 14</div>
          <div style="font-size:84px;font-weight:900;line-height:.9;letter-spacing:-.04em">Summer<br>Fest</div>
        </div>
      </div>
    </div>
    <div class="abs" style="left:822px;top:196px;color:#9aa3bd;font-size:18px;font-weight:600">Summer poster</div>`;
  render('03-scatter', page(P.navy, `
    <div class="abs" style="left:150px;top:300px;width:560px">
      <div class="eyebrow" style="color:${P.peach};margin-bottom:22px">Scatter</div>
      <div class="h">Fill any frame<br>in one click</div>
      <div class="p" style="margin-top:32px;color:#C9CFE3">Pick a count and size range, allow overlap or bleed, add random rotation, and drop it all behind your content.</div>
    </div>
    ${poster}
    ${window_(ui, 1400, 330, 437, 495)}
    <div class="abs" style="left:1340px;top:560px;width:80px;height:3px;background:${P.peach}"></div>`));
}

// ---------- 04 edit anytime ----------
{
  const meta = { uid: 'demo', type: 'wobblyFlower', params: { lobes: 7, depth: 0.45, petal: 0.7, irregular: 0.6, dot: 0.22 }, seed: 9, fill: { hex: P.coral, ref: null }, accent: { hex: P.peach, ref: null } };
  const ui = captureUI(`fromFigma({ type: 'selection', shape: { id: '9:9', name: 'Wobbly flower', size: 320, meta: ${JSON.stringify(meta)} }, frame: null });
    setTimeout(() => { document.getElementById('gallery').parentElement.scrollTop = 0; }, 50);`);
  // Canvas mock: dotted canvas, selected shape with handles, a properties panel with the "Edit shape" relaunch button.
  const sel = (x, y, s) => `<div class="abs" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;border:2px solid #0D99FF">
      ${[[-6, -6], [s - 6, -6], [-6, s - 6], [s - 6, s - 6]].map(([a, b]) => `<i class="abs" style="left:${a}px;top:${b}px;width:10px;height:10px;background:#fff;border:2px solid #0D99FF"></i>`).join('')}
      <div class="abs" style="left:50%;bottom:-34px;transform:translateX(-50%);background:#0D99FF;color:#fff;font-size:14px;font-weight:600;padding:3px 8px;border-radius:4px;white-space:nowrap">${s} × ${s}</div></div>`;
  const canvas = `<div class="abs" style="left:80px;top:150px;width:880px;height:780px;border-radius:24px;overflow:hidden;background:#F5F5F5;
      background-image:radial-gradient(#d9d9d9 1.2px,transparent 1.2px);background-size:22px 22px;box-shadow:0 30px 70px rgba(0,0,0,.3)">
      ${shape('wobblyFlower', P.coral, P.peach, meta.params, 120, 210, 320, 0)}
      ${sel(120, 210, 320)}
      ${shape('heart', P.lilac, P.lilac, {}, 120, 600, 120, -8)}
      ${shape('sparkle', P.blue, P.blue, {}, 490, 120, 90)}
      <div class="abs" style="right:0;top:0;bottom:0;width:300px;background:#fff;border-left:1px solid #e6e6e6;padding:22px;color:#1e1e1e;font-size:15px">
        <div style="font-weight:700;margin-bottom:14px">Wobbly flower</div>
        <div style="display:flex;gap:8px;margin-bottom:22px">
          <div style="flex:1;padding:8px 10px;background:#f5f5f5;border-radius:6px;color:#666">W&nbsp; 320</div>
          <div style="flex:1;padding:8px 10px;background:#f5f5f5;border-radius:6px;color:#666">H&nbsp; 320</div></div>
        <div style="font-weight:700;margin-bottom:10px">Plugin</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e6e6e6;border-radius:8px;box-shadow:0 0 0 3px rgba(13,153,255,.25)">
          <span style="display:flex;align-items:center;gap:8px"><img src="${dataUrl(path.join(__dirname, 'icon.png'))}" style="width:22px;height:22px;border-radius:5px">Shape Maker</span>
          <span style="background:#0D99FF;color:#fff;font-weight:600;padding:5px 10px;border-radius:6px">Edit shape</span></div>
        <div style="font-weight:700;margin:24px 0 10px">Fill</div>
        <div style="display:flex;align-items:center;gap:10px;color:#444"><i style="width:22px;height:22px;border-radius:4px;background:${P.coral}"></i>EE7B61</div>
      </div>
    </div>`;
  render('04-edit-anytime', page(P.paper, `
    ${canvas}
    ${window_(ui, 1020, 360, 760, 620)}
    <div class="abs" style="left:1210px;top:120px;width:560px;color:${P.navy}">
      <div class="eyebrow" style="color:${P.coral};margin-bottom:18px">Edit anytime</div>
      <div class="h" style="font-size:76px">Change it later,<br>right on canvas</div>
    </div>`, P.navy));
}

// ---------- 05 document colors ----------
{
  const doc = [
    { hex: '#6C3BFF', name: 'Brand/Primary', ref: { kind: 'style', id: 'S:1' } },
    { hex: '#FF6B4A', name: 'Brand/Accent', ref: { kind: 'style', id: 'S:2' } },
    { hex: '#FFD23F', name: 'Brand/Highlight', ref: { kind: 'style', id: 'S:3' } },
    { hex: '#0E1A2B', name: 'color/ink', ref: { kind: 'variable', id: 'V:1' } },
    { hex: '#2EC4B6', name: 'color/teal', ref: { kind: 'variable', id: 'V:2' } },
    { hex: '#FDECEF', name: 'color/blush', ref: { kind: 'variable', id: 'V:3' } },
  ];
  const ui = captureUI(`
    fromFigma({ type: 'doc-colors', colors: ${JSON.stringify(doc)} });
    ${collapse('Shape', 'Transform & texture')}
    [...document.querySelectorAll('.seg button')].find(b => b.textContent.startsWith('Document')).click();
    document.querySelectorAll('.target')[1].click(); document.querySelectorAll('.swatches .sw')[2].click();
    document.querySelectorAll('.target')[0].click(); document.querySelectorAll('.swatches .sw')[0].click();
    ${tile('Text badge')}`);
  const row = [
    ['textBadge', doc[0], doc[2], { text: 'NEW' }],
    ['flowerSmiley', doc[1], doc[3], {}],
    ['scallop', doc[4], doc[4], { lobes: 14 }],
    ['heart', doc[2], doc[2], {}],
  ];
  const chips = row.map(([t, f, a, p], k) => {
    const x = 150 + k * 210;
    return `${shape(t, f.hex, a.hex, p, x, 620, 170)}
      <div class="abs" style="left:${x - 10}px;top:812px;width:190px;text-align:center"><span class="chip" style="font-size:15px;padding:6px 12px 6px 8px"><i style="background:${f.hex};width:16px;height:16px;border-radius:4px"></i>${f.name}</span></div>`;
  }).join('');
  render('05-document-colors', page(P.navy, `
    <div class="abs" style="left:150px;top:150px;width:820px">
      <div class="eyebrow" style="color:${P.peach};margin-bottom:22px">Your colors</div>
      <div class="h">On brand,<br>automatically</div>
      <div class="p" style="margin-top:30px;color:#C9CFE3;width:760px">Pick from your file's color styles and variables. Shapes stay linked, so a style change updates every one of them.</div>
    </div>
    ${chips}
    ${window_(ui, 1060, 230, 760, 620)}`));
}

// ---------- 06 made with ----------
{
  // Social post
  const post = `<div class="abs" style="left:110px;top:250px;width:520px;height:520px;background:${P.coral};border-radius:28px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.25)">
      ${shape('daisy', P.peach, P.peach, { lobes: 9 }, -60, -60, 240, 10)}
      ${shape('sparkle', P.paper, P.paper, {}, 400, 50, 80)}
      ${shape('squiggle', P.navy, P.navy, { thickness: 0.28 }, 330, 380, 170, -10)}
      ${shape('saleBadge', P.navy, P.peach, { text: '-40%' }, 300, 150, 200, 8)}
      <div class="abs" style="left:46px;top:300px;color:${P.navy}">
        <div style="font-size:24px;font-weight:700;letter-spacing:.14em">THIS WEEKEND</div>
        <div style="font-size:92px;font-weight:900;line-height:.9;letter-spacing:-.04em">Big<br>Sale</div></div>
    </div>`;
  // Poster
  const poster = `<div class="abs" style="left:700px;top:180px;width:520px;height:660px;background:${P.paper};overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.25)">
      ${shape('sunburst', P.peach, P.peach, { rays: 13 }, 60, 330, 400)}
      ${shape('arch', P.blue, P.blue, { thickness: 0.32 }, 80, 420, 360)}
      ${shape('wobblyFlower', P.coral, P.navy, {}, 330, 40, 160, 14)}
      ${shape('leaf', P.sage, P.peach, {}, 40, 60, 140, -30)}
      <div class="abs" style="left:0;right:0;top:220px;text-align:center;color:${P.navy}">
        <div style="font-size:20px;font-weight:700;letter-spacing:.24em">GARDEN CLUB</div>
        <div style="font-size:70px;font-weight:900;line-height:.92;letter-spacing:-.04em">Grow<br>together</div></div>
    </div>`;
  // Sticker sheet
  const st = [
    ['flowerSmiley', P.peach, P.navy, {}, 1300, 210, 190, -8],
    ['bubble', P.blue, P.paper, { text: 'hi!' }, 1520, 200, 220, 6],
    ['heart', P.coral, P.coral, {}, 1310, 440, 170, 10],
    ['textBadge', P.sage, P.paper, { text: 'WOW' }, 1520, 450, 200, -6],
    ['star', P.peach, P.peach, {}, 1320, 640, 170, -12],
    ['loopArrow', P.navy, P.navy, {}, 1510, 620, 230, -8],
  ].map((d) => shape(...d.slice(0, 8), 'filter:drop-shadow(5px 0 0 #fff) drop-shadow(-5px 0 0 #fff) drop-shadow(0 5px 0 #fff) drop-shadow(0 -5px 0 #fff) drop-shadow(0 10px 14px rgba(20,40,75,.18))')).join('');
  const sheet = `<div class="abs" style="left:1270px;top:180px;width:530px;height:660px;background:#E9E5F2;border-radius:28px;box-shadow:0 30px 70px rgba(0,0,0,.2)"></div>${st}`;
  const label = (x, t) => `<div class="abs" style="left:${x}px;top:880px;color:#5a6178;font-size:24px;font-weight:600">${t}</div>`;
  render('06-made-with', page('#DCE3F2', `
    <div class="abs" style="left:110px;top:80px;color:${P.navy}">
      <div class="h" style="font-size:72px">Made with Shape Maker</div></div>
    ${post}${poster}${sheet}
    ${label(110, 'Social posts')}${label(700, 'Posters')}${label(1270, 'Sticker sheets')}`, P.navy));
}

fs.copyFileSync(path.join(OUT, '01-hero.png'), path.join(__dirname, 'thumbnail.png'));
fs.rmSync(TMP, { recursive: true, force: true });
console.log('store/thumbnail.png (= 01-hero)');
