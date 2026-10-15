// Inlines the shape engine into the plugin UI (Figma plugin UIs must be a single HTML file).
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/ui.html'), src('ui.html').replace('/*__ENGINE__*/', () => src('engine.js')).replace('/*__APP__*/', () => src('app.js')));
fs.copyFileSync(path.join(__dirname, 'src/code.js'), path.join(__dirname, 'dist/code.js'));
console.log('built dist/ui.html and dist/code.js');

if (process.argv.includes('--watch')) {
  fs.watch(path.join(__dirname, 'src'), () => require('child_process').execFileSync(process.execPath, [__filename], { stdio: 'inherit' }));
}
