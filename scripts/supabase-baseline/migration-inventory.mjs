import { existsSync, readdirSync } from 'node:fs';

const MIGRATION_PATTERN = /^(\d{14})_[a-z0-9][a-z0-9_-]*\.sql$/u;

const sqlFiles = directory => existsSync(directory)
  ? readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
  : [];

const uniqueSorted = values => [...new Set(values)].sort();

export const parseMigrationFilename = filename => {
  const match = MIGRATION_PATTERN.exec(filename);
  return match ? { filename, version: match[1] } : null;
};

export const buildMigrationInventory = ({ activeDir, archiveDir, remoteVersions = [] }) => {
  const activeFiles = sqlFiles(activeDir);
  const parsed = activeFiles.map(parseMigrationFilename);
  const valid = parsed.filter(Boolean);
  const versions = valid.map(item => item.version);
  const validUniqueActiveVersions = uniqueSorted(versions);
  const remote = uniqueSorted(remoteVersions.filter(version => /^\d{14}$/u.test(version)));
  const remoteSet = new Set(remote);
  const localSet = new Set(validUniqueActiveVersions);
  const counts = new Map();
  for (const version of versions) counts.set(version, (counts.get(version) ?? 0) + 1);

  return {
    activeSqlCount: activeFiles.length,
    archiveSqlCount: sqlFiles(archiveDir).length,
    validUniqueActiveVersions,
    invalidActiveFiles: activeFiles.filter((_, index) => parsed[index] === null),
    duplicateActiveVersions: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([version]) => version)
      .sort(),
    localOnlyVersions: validUniqueActiveVersions.filter(version => !remoteSet.has(version)),
    remoteOnlyVersions: remote.filter(version => !localSet.has(version)),
    commonVersions: validUniqueActiveVersions.filter(version => remoteSet.has(version)),
  };
};

