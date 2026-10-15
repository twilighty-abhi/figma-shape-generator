// Renders candidate plugin icons (128×128 for upload, 512×512 for review) with headless Chrome.
const E = require('../src/engine.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const P = { blue: '#2B4ACB', lilac: '#EFCBF4', peach: '#F5C788', coral: '#EE7B61', sage: '#5E8F7A', navy: '#14284B', paper: '#F4F2F0' };
const svg = (type, fill, accent, params = {}, seed = 3) =>
  E.toSVG(E.generate(type, { ...E.defaultsFor(type), ...params }, seed), { fill, accent, size: 100 });
// Each piece: [type, fill, accent, params, x, y, w] in a 100-unit canvas.
const at = ([type, fill, accent, params, x, y, w]) =>
  `<div style="position:absolute;left:${x}%;top:${y}%;width:${w}%;height:${w}%;display:flex;align-items:center;justify-content:center">${svg(type, fill, accent, params).replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>`;

const ICONS = {
  'a-scallop-sparkle': { bg: P.blue, pieces: [
    ['scallop', P.peach, P.peach, { lobes: 12, depth: 0.16 }, 11, 15, 74],
    ['sparkle', P.coral, P.coral, {}, 56, 6, 38],
  ] },
  'b-flower-smiley': { bg: P.coral, pieces: [
    ['flowerSmiley', P.lilac, P.navy, {}, 12, 12, 76],
  ] },
  'c-shape-cluster': { bg: P.navy, pieces: [
    ['scallop', P.peach, P.peach, { lobes: 14, depth: 0.14 }, 8, 10, 52],
    ['heart', P.coral, P.coral, {}, 50, 44, 44],
    ['sparkle', P.peach, P.peach, {}, 62, 8, 28],
    ['squiggle', P.lilac, P.lilac, { thickness: 0.32 }, 8, 63, 42],
  ] },
  'd-daisy-on-paper': { bg: P.paper, pieces: [
    ['daisy', P.blue, P.blue, { lobes: 9 }, 10, 10, 80],
    ['sparkle', P.coral, P.coral, {}, 62, 4, 30],
  ] },
};

function shot(file, px, html) {
  const tmp = file.replace(/\.png$/, '.html');
  fs.writeFileSync(tmp, html);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${px},${px}`, `--screenshot=${file}`, `file://${tmp}`], { stdio: 'ignore' });
  fs.unlinkSync(tmp);
}

const dir = path.join(__dirname, 'icon-options');
for (const [name, icon] of Object.entries(ICONS)) {
  for (const px of [128, 512]) {
    const html = `<!doctype html><html><body style="margin:0;width:${px}px;height:${px}px;overflow:hidden;background:${icon.bg};position:relative">${icon.pieces.map(at).join('')}</body></html>`;
    shot(path.join(dir, `${name}${px === 512 ? '@4x' : ''}.png`), px, html);
  }
  console.log(`store/icon-options/${name}.png`);
}
