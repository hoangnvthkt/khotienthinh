#!/usr/bin/env node
import { resolve } from 'node:path';

import { runCloudRollbackTransaction } from './lib/supabase-cloud-transaction.mjs';

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : []).filter(Boolean);
const value = (flag) => values(flag).at(-1);

const migrationFile = value('--migration');
const expectedProjectRef = value('--expected-ref');
const smokeFiles = values('--smoke');

if (!migrationFile || !expectedProjectRef) {
  process.stderr.write('Usage: node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration <file> [--smoke <file>]\n');
  process.exitCode = 2;
} else {
  try {
    const output = runCloudRollbackTransaction({
      projectRoot: resolve('.'),
      expectedProjectRef,
      migrationFile,
      smokeFiles,
    });
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Supabase Cloud rollback transaction failed'}\n`);
    process.exitCode = 1;
  }
}
