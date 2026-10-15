// Renders every type (row 1 = defaults, rows 2-3 = variations) into an HTML contact sheet.
const E = require('../src/engine.js');
const fs = require('fs');
const pal = ['#2B4ACB', '#EFCBF4', '#F5C788', '#EE7B61', '#5E8F7A', '#14284B'];
let cells = '', bad = 0;
E.TYPES.forEach((t, i) => {
  const rand = E.rng(i + 7);
  for (let v = 0; v < 3; v++) {
    const params = v === 0 ? E.defaultsFor(t.id) : E.vary(t.id, null, rand, 0.5);
    const svg = E.toSVG(E.generate(t.id, params, 1000 + i * 3 + v), { fill: pal[(i + v) % 6], accent: pal[(i + v + 2) % 6], size: 110 });
    if (/NaN|Infinity/.test(svg)) { bad++; console.log('BAD', t.id, JSON.stringify(params)); }
    cells += `<div class=c>${svg}<span>${t.label}${v ? ' v' + v : ''}</span></div>`;
  }
});
fs.writeFileSync(process.argv[2], `<html><body style="margin:0;background:#F4F2F0;font:10px sans-serif"><div style="display:grid;grid-template-columns:repeat(12,130px);gap:4px;padding:8px">${cells}</div><style>.c{height:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #ccc}span{margin-top:4px}</style></body></html>`);
console.log('types', E.TYPES.length, 'bad', bad);
