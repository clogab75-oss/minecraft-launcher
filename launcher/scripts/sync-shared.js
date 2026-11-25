// Copie les réglages par défaut dans le launcher, et l'interface du launcher dans le site (aperçu).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const renderer = path.join(root, 'launcher', 'src', 'renderer');
const preview = path.join(root, 'docs', 'preview');

fs.mkdirSync(path.join(root, 'launcher', 'src', 'shared'), { recursive: true });
fs.copyFileSync(path.join(root, 'docs', 'defaults.json'), path.join(root, 'launcher', 'src', 'shared', 'defaults.json'));
fs.mkdirSync(preview, { recursive: true });
for (const file of ['style.css', 'app.js']) fs.copyFileSync(path.join(renderer, file), path.join(preview, file));
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>', '<script src="mock.js"></script>\n<script src="app.js"></script>');
fs.writeFileSync(path.join(preview, 'index.html'), html);
console.log('Fichiers partagés synchronisés.');
