import { Project } from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const TABLE = 'projects';

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const normalizeCode = (name: string) => {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 18);
  const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `PRJ-${base || crypto.randomUUID().slice(0, 8).toUpperCase()}-${suffix}`;
};

const mapProject = (row: any): Project => fromDb(row) as Project;

export const projectMasterService = {
  async list(): Promise<Project[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapProject);
  },

  async create(input: {
    name: string;
    code?: string;
    description?: string;
    clientName?: string;
    projectType?: Project['projectType'];
    status?: Project['status'];
    constructionSiteId?: string | null;
    managerId?: string;
    startDate?: string;
    endDate?: string;
    progressCalculationMode?: Project['progressCalculationMode'];
    manualProgressPercent?: number;
    createdBy?: string;
  }): Promise<Project> {
    if (!isSupabaseConfigured) {
      return {
        id: crypto.randomUUID(),
        code: input.code || normalizeCode(input.name),
        name: input.name,
        description: input.description,
        clientName: input.clientName,
        projectType: input.projectType || 'construction',
        status: input.status || 'planning',
        constructionSiteId: input.constructionSiteId || null,
        managerId: input.managerId,
        startDate: input.startDate,
        endDate: input.endDate,
        progressCalculationMode: input.progressCalculationMode || 'gantt_weighted',
        manualProgressPercent: input.manualProgressPercent || 0,
        createdBy: input.createdBy,
        source: 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const payload = cleanUndefined(toDb({
      code: input.code || normalizeCode(input.name),
      name: input.name,
      description: input.description || null,
      clientName: input.clientName || null,
      projectType: input.projectType || 'construction',
      status: input.status || 'planning',
      constructionSiteId: input.constructionSiteId || null,
      managerId: input.managerId || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      progressCalculationMode: input.progressCalculationMode || 'gantt_weighted',
      manualProgressPercent: input.manualProgressPercent || 0,
      createdBy: input.createdBy || null,
      source: 'manual',
    }));

    const { data, error } = await supabase
      .from(TABLE)
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  },

  async update(project: Project): Promise<Project> {
    if (!isSupabaseConfigured) return { ...project, updatedAt: new Date().toISOString() };
    const payload = cleanUndefined(toDb({
      code: project.code,
      name: project.name,
      description: project.description || null,
      clientName: project.clientName || null,
      projectType: project.projectType || 'construction',
      status: project.status || 'planning',
      constructionSiteId: project.constructionSiteId || null,
      managerId: project.managerId || null,
      startDate: project.startDate || null,
      endDate: project.endDate || null,
      progressCalculationMode: project.progressCalculationMode || 'gantt_weighted',
      manualProgressPercent: project.manualProgressPercent || 0,
    }));

    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq('id', project.id)
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  },
};
