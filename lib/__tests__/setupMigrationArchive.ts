import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const activeDirectory = resolve(process.cwd(), 'supabase/migrations');
const archiveDirectory = resolve(
  process.cwd(),
  'supabase/migrations_archive/pre_baseline_20260903',
);

const originalExistsSync = fs.existsSync.bind(fs);
const originalReadFileSync = fs.readFileSync.bind(fs);
const originalReaddirSync = fs.readdirSync.bind(fs);

function toPath(value: fs.PathLike): string | null {
  if (value instanceof URL) return fileURLToPath(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return typeof value === 'string' ? value : null;
}

function archivedFallback(value: fs.PathLike): string | null {
  const rawPath = toPath(value);
  if (!rawPath) return null;

  const absolutePath = resolve(rawPath);
  if (normalize(dirname(absolutePath)) !== normalize(activeDirectory)) return null;

  const archivedPath = join(archiveDirectory, basename(absolutePath));
  return originalExistsSync(archivedPath) ? archivedPath : null;
}

fs.existsSync = ((path: fs.PathLike) => {
  return originalExistsSync(path) || archivedFallback(path) !== null;
}) as typeof fs.existsSync;

fs.readFileSync = ((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
  if (typeof path === 'number' || originalExistsSync(path)) {
    return originalReadFileSync(path, ...(args as []));
  }

  const fallback = archivedFallback(path);
  return originalReadFileSync(fallback ?? path, ...(args as []));
}) as typeof fs.readFileSync;

fs.readdirSync = ((path: fs.PathLike, options?: unknown) => {
  const rawPath = toPath(path);
  const isActiveDirectory = rawPath && normalize(resolve(rawPath)) === normalize(activeDirectory);
  const withFileTypes = typeof options === 'object'
    && options !== null
    && 'withFileTypes' in options
    && Boolean((options as { withFileTypes?: boolean }).withFileTypes);

  if (!isActiveDirectory || withFileTypes) {
    return originalReaddirSync(path, options as never);
  }

  const activeNames = originalExistsSync(activeDirectory)
    ? originalReaddirSync(activeDirectory, options as never) as string[]
    : [];
  const archivedNames = originalExistsSync(archiveDirectory)
    ? originalReaddirSync(archiveDirectory, options as never) as string[]
    : [];

  return [...new Set([...activeNames, ...archivedNames])].sort();
}) as typeof fs.readdirSync;

syncBuiltinESMExports();
