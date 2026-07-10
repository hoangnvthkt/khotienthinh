import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const verifyVercelSpaRewrite = () => {
  const vercelPath = join(root, 'vercel.json');
  if (!existsSync(vercelPath)) {
    failures.push('Missing vercel.json with SPA fallback rewrite');
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(vercelPath, 'utf8'));
  } catch (error) {
    failures.push(`vercel.json must be valid JSON: ${error.message}`);
    return;
  }

  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  const hasSpaFallback = rewrites.some((rewrite) =>
    (rewrite.source === '/(.*)' || rewrite.source === '/:path*') &&
    (rewrite.destination === '/' || rewrite.destination === '/index.html')
  );

  if (!hasSpaFallback) {
    failures.push('vercel.json must rewrite all SPA routes to / or /index.html');
  }
};

const verifyServiceWorkerDeepLinkNormalization = (filePath, label) => {
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, 'utf8');
  const buildsHashRoute = source.includes('/#/') || source.includes('/#${');
  if (!source.includes('normalizeNotificationUrl') || !buildsHashRoute) {
    failures.push(`${label} must normalize notification app routes to hash routes`);
  }
};

const verifyChatPushActionUrlMigration = () => {
  const migrationsDir = join(root, 'supabase', 'migrations');
  if (!existsSync(migrationsDir)) return;

  const hasChatActionUrlMigration = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .some((name) => {
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      return sql.includes('create or replace function app_private.chat_v2_notify_message()') &&
        sql.includes("'/#/chat?conversation=' || new.conversation_id::text");
    });

  if (!hasChatActionUrlMigration) {
    failures.push('Missing Supabase migration that sets chat web-push action_url to /#/chat?...');
  }
};

const parseEnvFile = (filePath) => {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
};

const getBuildEnvValue = (key) => {
  if (process.env[key]) return process.env[key].trim();
  for (const envFile of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const value = parseEnvFile(join(root, envFile))[key];
    if (value) return value.trim();
  }
  return '';
};

const walkFiles = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const filePath = join(dir, name);
    return statSync(filePath).isDirectory() ? walkFiles(filePath) : [filePath];
  });
};

const verifyVapidPublicKey = () => {
  const vapidPublicKey = getBuildEnvValue('VITE_VAPID_PUBLIC_KEY');
  if (!vapidPublicKey) {
    failures.push('Missing VITE_VAPID_PUBLIC_KEY for the frontend build');
    return;
  }

  if (!/^[A-Za-z0-9_-]{80,120}$/.test(vapidPublicKey)) {
    failures.push('VITE_VAPID_PUBLIC_KEY must look like a URL-safe VAPID public key');
    return;
  }

  const jsAssets = walkFiles(join(dist, 'assets')).filter((filePath) => filePath.endsWith('.js'));
  const keyIsBundled = jsAssets.some((filePath) => readFileSync(filePath, 'utf8').includes(vapidPublicKey));
  if (!keyIsBundled) {
    failures.push('Built frontend bundle does not include VITE_VAPID_PUBLIC_KEY; rebuild with the production env configured');
  }
};

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

verifyVercelSpaRewrite();
verifyServiceWorkerDeepLinkNormalization(join(root, 'public', 'sw.js'), 'public/sw.js');
verifyServiceWorkerDeepLinkNormalization(join(dist, 'sw.js'), 'dist/sw.js');
verifyChatPushActionUrlMigration();
verifyVapidPublicKey();
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
