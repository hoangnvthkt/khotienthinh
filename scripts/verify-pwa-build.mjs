import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'sw.js',
  'offline.html',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(dist, file))) {
    failures.push(`Missing dist/${file}`);
  }
}

const manifestPath = join(dist, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = {
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  };

  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) failures.push(`manifest.${key} must be ${value}`);
  }

  const shortcuts = new Set((manifest.shortcuts || []).map((shortcut) => shortcut.url));
  for (const url of ['/#/inventory', '/#/hrm/employees', '/#/da', '/#/rq']) {
    if (!shortcuts.has(url)) failures.push(`Missing manifest shortcut ${url}`);
  }

  const maskableIcon = (manifest.icons || []).some((icon) =>
    String(icon.purpose || '').includes('maskable') && String(icon.sizes || '').includes('512x512')
  );
  if (!maskableIcon) failures.push('Missing 512x512 maskable icon');
}

if (failures.length > 0) {
  console.error('PWA build verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PWA build verification passed.');
