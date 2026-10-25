'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'edge-extension', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions differ');
for (const directory of ['edge-extension', 'tests', 'scripts']) {
  for (const file of fs.readdirSync(path.join(root, directory))) {
    if (/\.(?:js|cjs|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, directory, file)], { stdio: 'inherit' });
  }
}
const entries = [manifest.background.service_worker, manifest.options_ui.page, ...manifest.content_scripts.flatMap(script => script.js)];
for (const file of entries) if (!fs.existsSync(path.join(root, 'edge-extension', file))) throw new Error(`Missing manifest entry: ${file}`);
console.log(`Syntax, manifest entries and version ${manifest.version}: OK`);
