import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

const activeMigrationDir = path.resolve(process.cwd(), 'supabase', 'migrations');
const archivedMigrationDirs = [
  path.resolve(process.cwd(), 'supabase', 'migrations_archive', 'pre_baseline_20260720'),
];

const originalReaddirSync = fs.readdirSync;
const originalReadFileSync = fs.readFileSync;

const archivedMigrationNames = () => {
  const names: string[] = [];
  for (const archiveDir of archivedMigrationDirs) {
    if (!fs.existsSync(archiveDir)) continue;
    for (const file of originalReaddirSync(archiveDir)) {
      if (typeof file === 'string' && file.endsWith('.sql')) {
        names.push(file);
      }
    }
  }
  return names;
};

fs.readdirSync = ((target: fs.PathLike, options?: unknown) => {
  const result = originalReaddirSync(target, options as never);
  const targetPath = typeof target === 'string' ? path.resolve(target) : '';
  const withFileTypes = typeof options === 'object' && options !== null && 'withFileTypes' in options;
  const bufferEncoding = options === 'buffer' || (
    typeof options === 'object' &&
    options !== null &&
    'encoding' in options &&
    options.encoding === 'buffer'
  );

  if (targetPath !== activeMigrationDir || withFileTypes || bufferEncoding || !Array.isArray(result)) {
    return result;
  }

  return Array.from(new Set([
    ...result.filter((entry): entry is string => typeof entry === 'string'),
    ...archivedMigrationNames(),
  ])).sort();
}) as typeof fs.readdirSync;

fs.readFileSync = ((file: fs.PathOrFileDescriptor, options?: unknown) => {
  if (typeof file !== 'string') {
    return originalReadFileSync(file, options as never);
  }

  const requestedPath = path.resolve(file);
  if (path.dirname(requestedPath) !== activeMigrationDir || fs.existsSync(requestedPath)) {
    return originalReadFileSync(file, options as never);
  }

  const fileName = path.basename(requestedPath);
  for (const archiveDir of archivedMigrationDirs) {
    const archivedPath = path.join(archiveDir, fileName);
    if (fs.existsSync(archivedPath)) {
      return originalReadFileSync(archivedPath, options as never);
    }
  }

  return originalReadFileSync(file, options as never);
}) as typeof fs.readFileSync;

syncBuiltinESMExports();
