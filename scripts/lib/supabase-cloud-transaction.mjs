import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const assertCloudTarget = (projectRef, expectedRef) => {
  const actual = String(projectRef ?? '').trim();
  const expected = String(expectedRef ?? '').trim();
  if (!actual || !expected || actual !== expected) {
    throw new Error(`Cloud target mismatch: expected ${expected || '<unset>'}, received ${actual || '<unset>'}`);
  }
};

const stripTransactionBoundary = (sql) => String(sql ?? '')
  .trim()
  .replace(/^begin\s*;\s*/i, '')
  .replace(/\s*rollback\s*;\s*$/i, '')
  .trim();

export const buildRollbackSql = (migrationSql, smokeSql = []) => [
  'begin;',
  String(migrationSql ?? '').trim(),
  ...smokeSql.map(stripTransactionBoundary),
  'rollback;',
].filter(Boolean).join('\n\n');

const readSqlFiles = (projectRoot, files) => files.map(file =>
  readFileSync(resolve(projectRoot, file), 'utf8')
);

export const runCloudRollbackTransaction = ({
  projectRoot,
  expectedProjectRef,
  migrationFile,
  smokeFiles = [],
  env = process.env,
  command = process.platform === 'win32' ? 'npx.cmd' : 'npx',
}) => {
  const root = resolve(projectRoot);
  const linkedRef = readFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  assertCloudTarget(linkedRef, expectedProjectRef);

  const migrationSql = readFileSync(resolve(root, migrationFile), 'utf8');
  const smokeSql = readSqlFiles(root, smokeFiles);
  const scratchDir = mkdtempSync(join(tmpdir(), 'vioo-supabase-cloud-'));
  const transactionFile = join(scratchDir, 'rollback.sql');

  try {
    writeFileSync(transactionFile, buildRollbackSql(migrationSql, smokeSql), { mode: 0o600 });
    const result = spawnSync(command, [
      '--no-install',
      'supabase',
      'db',
      'query',
      '--linked',
      '--agent=no',
      '--file',
      transactionFile,
    ], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      const diagnostic = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .replaceAll(env.SUPABASE_DB_PASSWORD || '__NO_PASSWORD__', '[REDACTED]')
        .replaceAll(env.SUPABASE_ACCESS_TOKEN || '__NO_TOKEN__', '[REDACTED]');
      throw new Error(`Supabase Cloud rollback transaction failed${diagnostic ? `:\n${diagnostic}` : ''}`);
    }

    return result.stdout.trim();
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
};
