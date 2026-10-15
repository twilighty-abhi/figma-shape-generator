// Generates the Community listing artwork (cover) as HTML, then screenshots it with headless Chrome.
const E = require('../src/engine.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const P = { blue: '#2B4ACB', lilac: '#EFCBF4', peach: '#F5C788', coral: '#EE7B61', sage: '#5E8F7A', navy: '#14284B' };
const shape = (type, size, fill, accent = P.peach, params = {}, seed = 3) =>
  E.toSVG(E.generate(type, { ...E.defaultsFor(type), ...params }, seed), { fill, accent, size });
const page = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#F4F2F0;font-family:-apple-system,"SF Pro Display","Helvetica Neue",sans-serif}
  .abs{position:absolute;display:flex;align-items:center;justify-content:center}</style></head><body>${body}</body></html>`;

function shot(name, w, h, html) {
  const file = path.join(__dirname, `${name}.html`);
  fs.writeFileSync(file, html);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${path.join(__dirname, name + '.png')}`, `file://${file}`], { stdio: 'ignore' });
  fs.unlinkSync(file);
  console.log(`store/${name}.png`);
}

// The icon lives in store/icons.js (npm run store-icons).

// Cover (1920×1080)
const grid = [
  ['scallop', P.blue], ['heart', P.coral], ['starburst', P.sage], ['flowerSmiley', P.lilac, P.navy],
  ['petalRing', P.lilac], ['sparkle', P.navy], ['textBadge', P.blue], ['wobblyFlower', P.coral],
  ['bubble', P.sage], ['squiggle', P.blue], ['daisy', P.lilac], ['smiley', P.peach, P.navy],
  ['arrow', P.coral, P.peach, { thickness: 0.16, headSize: 0.4 }], ['splat', P.peach], ['curl', P.navy], ['roughStar', P.blue],
];
const cell = 210, gx = 1000, gy = 120;
const tiles = grid.map(([t, c, a = P.peach, params = {}], i) => {
  const x = gx + (i % 4) * cell, y = gy + Math.floor(i / 4) * cell;
  return `<div class="abs" style="left:${x}px;top:${y}px;width:${cell}px;height:${cell}px"><div style="width:150px;height:150px" class="abs">${shape(t, 150, c, a, params, i + 5)}</div></div>`;
}).join('');
shot('cover', 1920, 1080, page(1920, 1080, `
  ${tiles}
  <div style="position:absolute;left:140px;top:270px;width:760px">
    <div style="font-size:30px;font-weight:600;color:${P.coral};letter-spacing:.02em;margin-bottom:22px">FIGMA PLUGIN</div>
    <div style="font-size:132px;line-height:1;font-weight:800;color:${P.navy};letter-spacing:-.03em">Shape Maker</div>
    <div style="font-size:40px;line-height:1.3;color:#4a5068;margin-top:34px">42 editable shapes and stickers.<br>Tweak them anytime, or scatter<br>them across any frame.</div>
    <div style="display:flex;gap:14px;margin-top:48px">${[P.blue, P.lilac, P.peach, P.coral, P.sage, P.navy].map((c) => `<div style="width:44px;height:44px;border-radius:50%;background:${c}"></div>`).join('')}</div>
  </div>`));
