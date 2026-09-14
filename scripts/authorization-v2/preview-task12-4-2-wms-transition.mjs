#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTransitionManifest } from './build-task12-4-2-manifest.mjs';

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error('Usage: preview-task12-4-2-wms-transition.mjs <private-output-directory>');
}

const mappingPath = fileURLToPath(new URL('./task12-4-2-wms-mappings.json', import.meta.url));
const mappings = JSON.parse(await readFile(mappingPath, 'utf8'));
const generatedAt = new Date().toISOString();
const batchId = 'task12.4.2-wms-shell-20260914-preview-1';
const mappingVersion = '2026-09-14.wms-shell.v1';

const sql = `
with candidate_sources as (
  select
    grant_row.user_id,
    jsonb_agg(grant_row.id::text order by grant_row.id::text) as candidate_source_ids
  from public.user_permission_grants grant_row
  where grant_row.is_active
    and grant_row.permission_code in ('system.wms.view', 'system.wms.manage')
  group by grant_row.user_id
)
select jsonb_build_object(
  'users', coalesce(jsonb_agg(jsonb_build_object(
    'userId', target.id,
    'targetVersion', target.updated_at,
    'expectedSourceHash', app_private.authorization_transition_source_hash(target.id),
    'candidateSourceIds', candidate.candidate_source_ids,
    'sources', app_private.authorization_transition_source_snapshot(target.id)
  ) order by target.id), '[]'::jsonb)
) as payload
from candidate_sources candidate
join public.users target on target.id = candidate.user_id;
`;

const query = spawnSync(
  'npx',
  ['supabase', 'db', 'query', '--linked', '--agent=no', '--output', 'json', sql],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (query.status !== 0) {
  throw new Error(`Cloud preview query failed: ${query.stderr.trim() || 'unknown error'}`);
}

const rows = JSON.parse(query.stdout);
const users = rows[0]?.payload?.users;
if (!Array.isArray(users) || users.length === 0) {
  throw new Error('Cloud preview returned no active WMS shell sources');
}

const input = { batchId, mappingVersion, now: generatedAt, users, mappings };
const manifest = buildTransitionManifest(input);
const unresolved = manifest.items.filter(item => item.disposition === 'manual_review');
if (unresolved.length > 0) {
  throw new Error(`WMS preview contains ${unresolved.length} unresolved items`);
}

const targetDirectory = resolve(outputDirectory);
await mkdir(targetDirectory, { mode: 0o700, recursive: true });
await chmod(targetDirectory, 0o700);
await writeFile(resolve(targetDirectory, 'input.json'), `${JSON.stringify(input, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
await writeFile(resolve(targetDirectory, 'manifest.json'), `${JSON.stringify(manifest.items, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});

const dispositionCounts = Object.fromEntries(
  Object.entries(Object.groupBy(manifest.items, item => item.disposition))
    .map(([key, values]) => [key, values.length]),
);
const sourceCounts = Object.fromEntries(
  Object.entries(Object.groupBy(manifest.items, item => item.before.permissionCode))
    .map(([key, values]) => [key, values.length]),
);
const replacementReferences = manifest.items.reduce(
  (count, item) => count + (Array.isArray(item.after) ? item.after.length : (item.after ? 1 : 0)),
  0,
);
process.stdout.write(`${JSON.stringify({
  batchId,
  mappingVersion,
  users: users.length,
  sources: manifest.items.length,
  dispositionCounts,
  sourceCounts,
  replacementReferences,
  outputDirectory: targetDirectory,
})}\n`);
