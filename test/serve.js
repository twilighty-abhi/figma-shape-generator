// Tiny static server for previewing dist/ui.html in a browser during development.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'dist');
http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'ui.html' : path.normalize(req.url).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/plain', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(+process.env.PORT || 4310, () => console.log("ui preview ready"));
