#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMigrationInventory, parseMigrationFilename } from './supabase-baseline/migration-inventory.mjs';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag >= 0 ? resolve(process.argv[rootFlag + 1]) : scriptRoot;
const activeDir = join(root, 'supabase', 'migrations');
const archiveDir = join(root, 'supabase', 'migrations_archive', 'pre_baseline_20260903');
const markerPath = join(root, 'supabase', 'baseline', 'current.json');

const errors = [];
const warnings = [];
const inventory = buildMigrationInventory({ activeDir, archiveDir });

const collectFiles = directory => {
  if (!existsSync(directory)) return [];
  const collected = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collected.push(...collectFiles(path));
    else collected.push(path);
  }
  return collected;
};

for (const file of [join(root, 'package.json'), ...collectFiles(join(root, '.github', 'workflows'))]) {
  if (existsSync(file) && readFileSync(file, 'utf8').includes('--include-all')) {
    errors.push(`forbidden --include-all in ${file.slice(root.length + 1)}`);
  }
}

if (!existsSync(markerPath)) {
  if (inventory.invalidActiveFiles.length || inventory.duplicateActiveVersions.length) {
    warnings.push(
      `pre-baseline warning: ${inventory.invalidActiveFiles.length} invalid filenames, `
      + `${inventory.duplicateActiveVersions.length} duplicate versions`,
    );
  }
} else {
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const baselineVersion = String(marker.baselineVersion ?? '');
  const baselineFilename = String(marker.baselineFilename ?? '');
  const allowedPostBaselineFiles = new Set(marker.allowedPostBaselineFiles ?? []);
  const activeFiles = existsSync(activeDir)
    ? readdirSync(activeDir).filter(name => name.endsWith('.sql')).sort()
    : [];

  for (const filename of inventory.invalidActiveFiles) {
    errors.push(`invalid migration filename: ${filename}`);
  }
  for (const version of inventory.duplicateActiveVersions) {
    errors.push(`duplicate migration version: ${version}`);
  }
  if (!/^\d{14}$/u.test(baselineVersion)) errors.push('invalid baselineVersion in current.json');
  if (!activeFiles.includes(baselineFilename)) errors.push(`baseline migration missing: ${baselineFilename}`);

  for (const filename of activeFiles) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) continue;
    if (filename === baselineFilename && parsed.version === baselineVersion) continue;
    if (parsed.version <= baselineVersion) {
      errors.push(`migration ${filename} is at or before baseline boundary ${baselineVersion}`);
      continue;
    }
    if (!allowedPostBaselineFiles.has(filename)) {
      errors.push(`post-baseline migration is not allowlisted: ${filename}`);
    }
  }
}

for (const warning of warnings) process.stdout.write(`${warning}\n`);
if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Supabase migration baseline check passed: ${inventory.activeSqlCount} active SQL files, `
    + `${inventory.archiveSqlCount} archived SQL files.\n`,
  );
}

