export const buildProjectScopeFilter = (projectIdOrSiteId: string, constructionSiteId?: string | null): string => {
  if (constructionSiteId !== undefined) return `project_id.eq.${projectIdOrSiteId}`;
  return `project_id.eq.${projectIdOrSiteId},construction_site_id.eq.${projectIdOrSiteId}`;
};

export const dedupeRowsById = <T extends { id?: string }>(rows: T[]): T[] => {
  const byId = new Map<string, T>();
  const withoutId: T[] = [];
  for (const row of rows) {
    if (row.id) byId.set(row.id, row);
    else withoutId.push(row);
  }
  return [...byId.values(), ...withoutId];
};
