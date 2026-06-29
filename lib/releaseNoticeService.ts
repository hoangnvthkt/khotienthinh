import { isSupabaseConfigured, supabase } from './supabase';

export type ReleaseNoteEntry = string | {
  title: string;
  description?: string;
};

export interface AppRelease {
  id: string;
  version: string;
  title: string;
  releaseDate: string;
  summary: string;
  features: ReleaseNoteEntry[];
  improvements: ReleaseNoteEntry[];
  bugFixes: ReleaseNoteEntry[];
  isActive: boolean;
  createdAt: string;
}

export interface AppReleaseInput {
  version: string;
  title: string;
  releaseDate: string;
  summary: string;
  features: ReleaseNoteEntry[];
  improvements: ReleaseNoteEntry[];
  bugFixes: ReleaseNoteEntry[];
  isActive: boolean;
}

export interface AppReleaseWithStats extends AppRelease {
  readCount: number;
}

const RELEASE_COLUMNS = 'id, version, title, release_date, summary, features, improvements, bug_fixes, is_active, created_at';

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const normalizeReleaseList = (value: unknown): ReleaseNoteEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ReleaseNoteEntry | null => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return null;

      const record = item as Record<string, unknown>;
      const title = toText(record.title ?? record.label ?? record.name ?? record.text ?? record.content);
      const description = toText(record.description ?? record.detail ?? record.details ?? record.body);

      if (!title) return null;
      return description ? { title, description } : { title };
    })
    .filter((item): item is ReleaseNoteEntry => {
      if (!item) return false;
      if (typeof item === 'string') return item.length > 0;
      return item.title.length > 0;
    });
};

const mapReleaseFromDb = (row: any): AppRelease => ({
  id: row.id,
  version: row.version,
  title: row.title,
  releaseDate: row.release_date,
  summary: row.summary || '',
  features: normalizeReleaseList(row.features),
  improvements: normalizeReleaseList(row.improvements),
  bugFixes: normalizeReleaseList(row.bug_fixes),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
});

const isDuplicateReadError = (error: any): boolean =>
  error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate key');

const releaseInputToDbPayload = (input: AppReleaseInput) => ({
  version: input.version.trim(),
  title: input.title.trim(),
  release_date: input.releaseDate,
  summary: input.summary.trim(),
  features: input.features,
  improvements: input.improvements,
  bug_fixes: input.bugFixes,
  is_active: input.isActive,
});

export const releaseNoticeService = {
  async listReleasesWithStats(): Promise<AppReleaseWithStats[]> {
    if (!isSupabaseConfigured) return [];

    const [releaseResult, readsResult] = await Promise.all([
      supabase
        .from('app_releases')
        .select(RELEASE_COLUMNS)
        .order('release_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('user_release_reads')
        .select('release_id'),
    ]);

    if (releaseResult.error) throw releaseResult.error;
    if (readsResult.error) throw readsResult.error;

    const readCounts = (readsResult.data || []).reduce<Record<string, number>>((acc, row: any) => {
      if (row.release_id) acc[row.release_id] = (acc[row.release_id] || 0) + 1;
      return acc;
    }, {});

    return (releaseResult.data || []).map(row => {
      const release = mapReleaseFromDb(row);
      return {
        ...release,
        readCount: readCounts[release.id] || 0,
      };
    });
  },

  async getLatestActiveRelease(): Promise<AppRelease | null> {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase
      .from('app_releases')
      .select(RELEASE_COLUMNS)
      .eq('is_active', true)
      .order('release_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data ? mapReleaseFromDb(data) : null;
  },

  async createRelease(input: AppReleaseInput): Promise<AppRelease> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { data, error } = await supabase
      .from('app_releases')
      .insert(releaseInputToDbPayload(input))
      .select(RELEASE_COLUMNS)
      .single();

    if (error) throw error;
    return mapReleaseFromDb(data);
  },

  async updateRelease(releaseId: string, input: AppReleaseInput): Promise<AppRelease> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { data, error } = await supabase
      .from('app_releases')
      .update(releaseInputToDbPayload(input))
      .eq('id', releaseId)
      .select(RELEASE_COLUMNS)
      .single();

    if (error) throw error;
    return mapReleaseFromDb(data);
  },

  async setReleaseActive(releaseId: string, isActive: boolean): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { error } = await supabase
      .from('app_releases')
      .update({ is_active: isActive })
      .eq('id', releaseId);

    if (error) throw error;
  },

  async deleteRelease(releaseId: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { error } = await supabase
      .from('app_releases')
      .delete()
      .eq('id', releaseId);

    if (error) throw error;
  },

  async resetReleaseReads(releaseId: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');

    const { error } = await supabase
      .from('user_release_reads')
      .delete()
      .eq('release_id', releaseId);

    if (error) throw error;
  },

  async hasReadRelease(userId: string, releaseId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !userId || !releaseId) return true;

    const { data, error } = await supabase
      .from('user_release_reads')
      .select('id')
      .eq('user_id', userId)
      .eq('release_id', releaseId)
      .maybeSingle();

    if (error) throw error;
    return Boolean(data);
  },

  async markReleaseRead(userId: string, releaseId: string): Promise<void> {
    if (!isSupabaseConfigured || !userId || !releaseId) return;

    const { error } = await supabase
      .from('user_release_reads')
      .insert({
        user_id: userId,
        release_id: releaseId,
      });

    if (error && !isDuplicateReadError(error)) throw error;
  },
};
