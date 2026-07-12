import { ProjectGroup, ProjectMasterCategory, ProjectSector, ProjectTypeMaster } from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

type CategoryTable = 'project_groups' | 'project_types' | 'project_sectors';
type CategoryKind = 'group' | 'type' | 'sector';

type CategoryInput = {
  code?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
};

const DEFAULT_GROUPS: ProjectGroup[] = [
  {
    id: 'default-project-group-construction',
    code: 'construction',
    name: 'Dự án thi công',
    description: 'Nhóm mặc định cho các dự án thi công',
    sortOrder: 10,
    isActive: true,
  },
];

const DEFAULT_TYPES: ProjectTypeMaster[] = [
  { id: 'default-project-type-actual', code: 'actual', name: 'Dự án thực tế', sortOrder: 10, isActive: true },
  { id: 'default-project-type-template', code: 'template', name: 'Dự án mẫu', sortOrder: 20, isActive: true },
  { id: 'default-project-type-construction', code: 'construction', name: 'Thi công xây dựng', sortOrder: 30, isActive: true },
  { id: 'default-project-type-infrastructure', code: 'infrastructure', name: 'Hạ tầng', sortOrder: 40, isActive: true },
  { id: 'default-project-type-maintenance', code: 'maintenance', name: 'Bảo trì', sortOrder: 50, isActive: true },
  { id: 'default-project-type-other', code: 'other', name: 'Khác', sortOrder: 90, isActive: true },
];

const DEFAULT_SECTORS: ProjectSector[] = [
  { id: 'default-project-sector-civil', code: 'civil', name: 'Dân dụng', sortOrder: 10, isActive: true },
  { id: 'default-project-sector-industrial', code: 'industrial', name: 'Công nghiệp', sortOrder: 20, isActive: true },
  { id: 'default-project-sector-infrastructure', code: 'infrastructure', name: 'Hạ tầng', sortOrder: 30, isActive: true },
  { id: 'default-project-sector-mep', code: 'mep', name: 'MEP', sortOrder: 40, isActive: true },
  { id: 'default-project-sector-interior', code: 'interior', name: 'Nội thất', sortOrder: 50, isActive: true },
  { id: 'default-project-sector-transport', code: 'transport', name: 'Giao thông', sortOrder: 60, isActive: true },
  { id: 'default-project-sector-irrigation', code: 'irrigation', name: 'Thủy lợi', sortOrder: 70, isActive: true },
  { id: 'default-project-sector-other', code: 'other', name: 'Khác', sortOrder: 90, isActive: true },
];

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const normalizeCode = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 48) || crypto.randomUUID().slice(0, 8);

const mapCategory = <T extends ProjectMasterCategory>(row: any): T => ({
  ...fromDb(row),
  sortOrder: row.sort_order ?? row.sortOrder ?? 0,
  isActive: row.is_active ?? row.isActive ?? true,
}) as T;

const categoryKindByTable: Record<CategoryTable, CategoryKind> = {
  project_groups: 'group',
  project_types: 'type',
  project_sectors: 'sector',
};

const listCategories = async <T extends ProjectMasterCategory>(table: CategoryTable, fallback: T[]): Promise<T[]> => {
  if (!isSupabaseConfigured) return fallback;
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => mapCategory<T>(row));
};

const createCategory = async <T extends ProjectMasterCategory>(table: CategoryTable, input: CategoryInput): Promise<T> => {
  const item = {
    code: input.code?.trim() || normalizeCode(input.name),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  };

  if (!isSupabaseConfigured) {
    return {
      id: crypto.randomUUID(),
      code: item.code,
      name: item.name,
      description: item.description || undefined,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      createdAt: new Date().toISOString(),
    } as T;
  }

  const { data, error } = await supabase.rpc('upsert_project_category', {
    p_category_kind: categoryKindByTable[table],
    p_category: cleanUndefined(toDb(item)),
  });
  if (error) throw error;
  return mapCategory<T>(data);
};

const updateCategory = async <T extends ProjectMasterCategory>(table: CategoryTable, item: T): Promise<T> => {
  if (!isSupabaseConfigured) return { ...item, updatedAt: new Date().toISOString() };
  const payload = cleanUndefined(toDb({
    id: item.id,
    code: item.code?.trim() || normalizeCode(item.name),
    name: item.name.trim(),
    description: item.description?.trim() || null,
    sortOrder: item.sortOrder ?? 0,
    isActive: item.isActive,
  }));
  const { data, error } = await supabase.rpc('upsert_project_category', {
    p_category_kind: categoryKindByTable[table],
    p_category: payload,
  });
  if (error) throw error;
  return mapCategory<T>(data);
};

const archiveCategory = async (table: CategoryTable, id: string): Promise<void> => {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.rpc('upsert_project_category', {
    p_category_kind: categoryKindByTable[table],
    p_category: { id, is_active: false },
  });
  if (error) throw error;
};

const removeCategory = async (table: CategoryTable, id: string): Promise<void> => {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.rpc('delete_project_category', {
    p_category_kind: categoryKindByTable[table],
    p_category_id: id,
  });
  if (error) throw error;
};

export const projectMasterDataService = {
  listGroups: () => listCategories<ProjectGroup>('project_groups', DEFAULT_GROUPS),
  createGroup: (input: CategoryInput) => createCategory<ProjectGroup>('project_groups', input),
  updateGroup: (item: ProjectGroup) => updateCategory<ProjectGroup>('project_groups', item),
  archiveGroup: (id: string) => archiveCategory('project_groups', id),
  removeGroup: (id: string) => removeCategory('project_groups', id),

  listTypes: () => listCategories<ProjectTypeMaster>('project_types', DEFAULT_TYPES),
  createType: (input: CategoryInput) => createCategory<ProjectTypeMaster>('project_types', input),
  updateType: (item: ProjectTypeMaster) => updateCategory<ProjectTypeMaster>('project_types', item),
  archiveType: (id: string) => archiveCategory('project_types', id),
  removeType: (id: string) => removeCategory('project_types', id),

  listSectors: () => listCategories<ProjectSector>('project_sectors', DEFAULT_SECTORS),
  createSector: (input: CategoryInput) => createCategory<ProjectSector>('project_sectors', input),
  updateSector: (item: ProjectSector) => updateCategory<ProjectSector>('project_sectors', item),
  archiveSector: (id: string) => archiveCategory('project_sectors', id),
  removeSector: (id: string) => removeCategory('project_sectors', id),
};
