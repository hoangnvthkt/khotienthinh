import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const requiredFiles = [
  'manifest.json',
  'sw.js',
  'offline.html',
  'apple-touch-icon.png',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-120.png',
  'icons/icon-152.png',
  'icons/icon-167.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const failures = [];

const getPngSize = (filePath) => {
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const verifyPng = (relativePath, expectedSize) => {
  const filePath = join(dist, relativePath);
  if (!existsSync(filePath)) {
    failures.push(`Missing dist/${relativePath}`);
    return;
  }

  const size = getPngSize(filePath);
  if (!size) {
    failures.push(`dist/${relativePath} must be a real PNG file`);
    return;
  }

  if (expectedSize && (size.width !== expectedSize || size.height !== expectedSize)) {
    failures.push(`dist/${relativePath} must be ${expectedSize}x${expectedSize}, got ${size.width}x${size.height}`);
  }
};

for (const file of requiredFiles) {
  if (!existsSync(join(dist, file))) {
    failures.push(`Missing dist/${file}`);
  }
}

verifyPng('apple-touch-icon.png', 180);

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

  for (const icon of manifest.icons || []) {
    if (icon.type !== 'image/png') failures.push(`manifest icon ${icon.src} must declare image/png`);
    const sizeToken = String(icon.sizes || '').split(/\s+/).find(size => /^\d+x\d+$/.test(size));
    if (!sizeToken) {
      failures.push(`manifest icon ${icon.src} must declare pixel size`);
      continue;
    }
    const [width, height] = sizeToken.split('x').map(Number);
    if (width !== height) {
      failures.push(`manifest icon ${icon.src} must be square`);
      continue;
    }
    verifyPng(String(icon.src || '').replace(/^\//, ''), width);
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
