export const buildProjectScopeFilter = (projectIdOrSiteId: string, constructionSiteId?: string | null): string => {
  const conditions = [`project_id.eq.${projectIdOrSiteId}`];
  const siteId = constructionSiteId === undefined ? projectIdOrSiteId : constructionSiteId;
  if (siteId) conditions.push(`construction_site_id.eq.${siteId}`);
  return conditions.join(',');
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
