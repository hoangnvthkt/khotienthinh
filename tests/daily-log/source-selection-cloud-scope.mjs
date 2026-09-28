// A test-only staging tree prevents unrelated pending migrations being replayed.
export const migration = '20260926102824_daily_log_source_selection_v2.sql';
export function selectSourceSelectionMigrationFiles(history, files) {
  const selected = history.map(({ version, name }) => {
    const matches = files.filter(file => file === `${version}_${name}.sql`);
    if (matches.length !== 1) throw new Error(`Unreconciled recorded migration: ${version}`);
    return matches[0];
  });
  if (!files.includes(migration)) throw new Error('Daily Log migration missing');
  return [...new Set([...selected, migration])];
}

export function assertOnlySourceSelectionPending(output) {
  const pending = [...new Set(output.match(/\d{14}_[\w]+\.sql/g) ?? [])];
  if (pending.length !== 1 || pending[0] !== migration) {
    throw new Error('Dry-run did not select exactly the approved Daily Log migration');
  }
}
