export const upsertRowsById = <T extends { id: string }>(
  current: T[],
  rows: T[],
  insertPosition: 'prepend' | 'append' = 'append',
): T[] => {
  const incoming = new Map<string, T>();
  rows.forEach(row => incoming.set(row.id, row));

  const seen = new Set<string>();
  const reconciled: T[] = [];

  current.forEach(row => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const updated = incoming.get(row.id);
    reconciled.push(updated || row);
    incoming.delete(row.id);
  });

  const newRows = Array.from(incoming.values());
  return insertPosition === 'prepend'
    ? [...newRows, ...reconciled]
    : [...reconciled, ...newRows];
};
