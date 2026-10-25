'use strict';
/* 仓库自检：JS/MJS 语法、manifest 与 package 版本一致、manifest 引用文件齐全。 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'edge-extension');
/* 独立解压布局（扩展位于仓库根）也兼容。 */
const extensionRoot = fs.existsSync(path.join(ext, 'manifest.json')) ? ext : root;
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error(`Manifest (${manifest.version}) and package (${pkg.version}) versions differ`);
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.e2e-ext') continue;
    const absolute = path.join(dir, entry);
    if (fs.statSync(absolute).isDirectory()) walk(absolute);
    else if (/\.(?:js|cjs|mjs)$/.test(entry)) files.push(absolute);
  }
}
for (const dir of ['edge-extension', 'tests', 'scripts']) walk(path.join(root, dir));
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
const entries = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  manifest.action?.default_popup,
  ...manifest.content_scripts.flatMap(script => script.js),
  ...Object.values(manifest.icons || {})
].filter(Boolean);
for (const file of entries) if (!fs.existsSync(path.join(extensionRoot, file))) throw new Error(`Missing manifest entry: ${file}`);
console.log(`Syntax (${files.length} files), manifest entries and version ${manifest.version}: OK`);
