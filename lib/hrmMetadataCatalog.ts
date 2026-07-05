export type HrmCatalogKey =
  | 'employment_status'
  | 'labor_contract_type'
  | 'education_level'
  | 'social_insurance_status'
  | 'employee_type'
  | 'marital_status';

export interface HrmCatalogSeedRow {
  catalogKey: HrmCatalogKey | string;
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

export interface HrmCatalogLookupItem {
  id: string;
  catalogKey: string;
  code?: string | null;
  name: string;
  isActive?: boolean | null;
}

export const normalizeHrmMetadataKey = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const dedupeHrmCatalogRows = <TRow extends HrmCatalogSeedRow>(rows: TRow[]): TRow[] => {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = [
      normalizeHrmMetadataKey(row.catalogKey),
      normalizeHrmMetadataKey(row.code),
      normalizeHrmMetadataKey(row.name),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const findHrmCatalogItem = (
  items: HrmCatalogLookupItem[],
  catalogKey: HrmCatalogKey | string,
  rawValue: unknown,
): HrmCatalogLookupItem | undefined => {
  const normalizedValue = normalizeHrmMetadataKey(rawValue);
  if (!normalizedValue) return undefined;
  const normalizedCatalogKey = normalizeHrmMetadataKey(catalogKey);
  const activeItems = items.filter(item =>
    normalizeHrmMetadataKey(item.catalogKey) === normalizedCatalogKey && item.isActive !== false
  );

  return activeItems.find(item => normalizeHrmMetadataKey(item.code) === normalizedValue)
    || activeItems.find(item => normalizeHrmMetadataKey(item.name) === normalizedValue);
};

export const validateHrmCatalogReference = (
  items: HrmCatalogLookupItem[],
  catalogKey: HrmCatalogKey | string,
  rawValue: unknown,
  label: string,
): { id?: string; error?: string } => {
  const value = String(rawValue ?? '').trim();
  if (!value) return {};

  const item = findHrmCatalogItem(items, catalogKey, value);
  if (item) return { id: item.id };

  return { error: `${label} "${value}" không tồn tại trong metadata HRM.` };
};
