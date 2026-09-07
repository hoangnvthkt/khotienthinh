#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { assertCloudTarget } from './lib/supabase-cloud-transaction.mjs';

// Allocates 16 unused codes in two concurrent committed transactions. It creates
// no task, user, grant, calendar, event or notification. Gaps are intentional;
// restoring the shared counter would make a concurrent real allocation unsafe.
const run = promisify(execFile);
const expectedRef = 'ftciqmqhmfvjtwoycswe';
assertCloudTarget(readFileSync('supabase/.temp/project-ref', 'utf8'), expectedRef);
const sql = `begin;
select jsonb_agg(app_private.next_work_task_code()) as codes from generate_series(1,8);
commit;`;
try {
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => run('npx', [
    '--no-install', 'supabase', 'db', 'query', '--linked', '--agent=no', '--output', 'json', sql,
  ], { maxBuffer: 1024 * 1024 })));
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('One or more concurrent Cloud allocations failed; do not restore the counter.');
  }
  const codes = results.flatMap(result => JSON.parse(result.value.stdout)[0].codes);
  if (codes.length !== 16 || new Set(codes).size !== 16 || codes.some(code => !/^VW-\d{4}-\d{6,}$/.test(code))) {
    throw new Error('WORK_CODE_CONCURRENCY_FAILED');
  }
  process.stdout.write(`WORK_CODE_CONCURRENCY_PASSED: ${codes.length} unique codes, two concurrent Cloud transactions.\n`);
} catch (error) {
  // The CLI subprocess may include its environment in diagnostic objects.
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
