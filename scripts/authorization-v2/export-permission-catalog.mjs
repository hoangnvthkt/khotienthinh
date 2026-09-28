// Refreshes lib/permissions/__tests__/fixtures/dbPermissionCatalog.json from the
// linked Supabase Cloud project, so the catalog contract test sees the real DB.
// Usage: node scripts/authorization-v2/export-permission-catalog.mjs <expected-project-ref>
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expectedProjectRef = process.argv[2];
if (!expectedProjectRef) throw new Error('Usage: export-permission-catalog.mjs <expected-project-ref>');
const linkedRef = readFileSync(resolve(projectRoot, 'supabase/.temp/project-ref'), 'utf8').trim();
if (linkedRef !== expectedProjectRef) throw new Error(`Cloud target mismatch: expected ${expectedProjectRef}, received ${linkedRef || '<unset>'}`);

const sql = 'select permission_code as "permissionCode", scope_modes as "scopeTypes" from public.permission_actions where is_active order by permission_code';
const query = spawnSync('npx', ['--yes', 'supabase@2.116.0', 'db', 'query', '--linked', '--agent=no', '--output', 'json', sql], {
  cwd: projectRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (query.status !== 0) throw new Error(`Catalog query failed: ${query.stderr.trim() || 'unknown error'}`);
const response = JSON.parse(query.stdout);
const rows = (Array.isArray(response) ? response : response.rows)
  .map(row => ({ permissionCode: row.permissionCode, scopeTypes: [...row.scopeTypes].sort() }));
const target = resolve(projectRoot, 'lib/permissions/__tests__/fixtures/dbPermissionCatalog.json');
writeFileSync(target, `${JSON.stringify({ projectRef: linkedRef, actions: rows }, null, 2)}\n`);
process.stdout.write(`Wrote ${rows.length} actions to ${target}\n`);
