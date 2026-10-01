'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(projectRoot, '../front-end');

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

const files = [
  path.join(projectRoot, 'server.js'),
  ...javascriptFiles(path.join(projectRoot, 'src')),
  ...javascriptFiles(frontendRoot),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const html = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
for (const asset of ['style.css', 'config.js', 'panelRules.js', 'logica.js', 'assets/LOGOWFS-COI.png']) {
  if (!html.includes(asset)) throw new Error(`Asset não referenciado no HTML: ${asset}`);
}

console.log(`Build validado: ${files.length} arquivos JavaScript e assets do frontend.`);
