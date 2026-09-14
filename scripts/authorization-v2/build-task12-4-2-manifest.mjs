#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]),
  );
  return value;
};

const stableJson = value => JSON.stringify(stableValue(value));
const sha256 = value => createHash('sha256').update(stableJson(value)).digest('hex');
const normalizedSource = source => ({
  sourceId: String(source.sourceId),
  sourceType: String(source.sourceType).toUpperCase(),
  permissionCode: String(source.permissionCode),
  scopeType: source.scopeType || 'global',
  scopeId: source.scopeId || '*',
  expiresAt: source.expiresAt || null,
});

const isScopeExpansion = (before, after) => {
  if (before.scopeType === after.scopeType && before.scopeId === after.scopeId) return false;
  return after.scopeType === 'global'
    || (before.scopeType === 'own' && after.scopeType !== 'own')
    || (before.scopeId !== '*' && after.scopeId === '*');
};

export const buildTransitionManifest = input => {
  const now = new Date(input.now).getTime();
  const items = [];
  for (const user of [...input.users].sort((a, b) => a.userId.localeCompare(b.userId))) {
    const sources = [...new Map(user.sources.map(raw => {
      const item = normalizedSource(raw);
      return [item.sourceId, item];
    })).values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const expectedSourceHash = sha256(sources);
    const candidateSourceIds = user.candidateSourceIds
      ? new Set(user.candidateSourceIds.map(String))
      : null;

    for (const before of sources) {
      if (candidateSourceIds && !candidateSourceIds.has(before.sourceId)) continue;
      const mapping = input.mappings[`${before.sourceType}:${before.permissionCode}`];
      let disposition = mapping?.disposition;
      let reason = mapping?.reason || '';
      let after = null;

      if (before.expiresAt && Date.parse(before.expiresAt) <= now) {
        disposition = 'retain';
        reason = 'expired source retained without replacement; it must not be revived';
        after = before;
      } else if (!mapping) {
        disposition = before.permissionCode.startsWith('system.authorization.') ? 'retain' : 'manual_review';
        reason = disposition === 'retain'
          ? 'authorization control capability requires an explicit reviewed decision before removal'
          : 'no explicit source-to-capability mapping';
        after = disposition === 'retain' ? before : null;
      } else if (disposition === 'replace') {
        after = {
          ...before,
          sourceId: null,
          sourceType: mapping.sourceType || 'DIRECT',
          permissionCode: mapping.permissionCode,
          scopeType: mapping.scopeType || before.scopeType,
          scopeId: mapping.scopeId || before.scopeId,
          expiresAt: mapping.expiresAt === undefined ? before.expiresAt : mapping.expiresAt,
        };
        if (!after.permissionCode || isScopeExpansion(before, after)) {
          disposition = 'manual_review';
          reason = !after.permissionCode ? 'replacement permission is missing' : 'scope expansion requires operator review';
          after = null;
        }
      } else if (disposition === 'retain') {
        after = before;
      } else if (disposition === 'revoke' || disposition === 'manual_review') {
        after = null;
      } else {
        disposition = 'manual_review';
        reason = 'unsupported disposition';
      }

      items.push({
        batchId: input.batchId,
        userId: user.userId,
        sourceId: before.sourceId,
        sourceType: before.sourceType,
        before,
        after,
        disposition,
        reason,
        expectedSourceHash,
        expectedTargetVersion: user.targetVersion,
        mappingVersion: input.mappingVersion,
      });
    }
  }
  return stableValue({ batchId: input.batchId, mappingVersion: input.mappingVersion, generatedAt: input.now, items });
};

const main = async () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: build-task12-4-2-manifest.mjs <input.json> <output.json>');
  const manifest = buildTransitionManifest(JSON.parse(await readFile(inputPath, 'utf8')));
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ batchId: manifest.batchId, items: manifest.items.length })}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
