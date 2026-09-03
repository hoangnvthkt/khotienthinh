import { supabase } from '../../lib/supabase';
import { fetchAllSupabaseRows } from '../../lib/supabaseCompleteRead';

export const loadSafePage = async (cursor: string | undefined, limit = 50) => {
  let query = supabase
    .from('activities')
    .select('id,timestamp,action')
    .order('timestamp', { ascending: false })
    .order('id', { ascending: false });

  if (cursor) query = query.lt('id', cursor);
  query = query.limit(limit + 1);
  return query;
};

export const loadSafeDetail = async (id: string) => supabase
  .from('requests')
  .select('id,code,status')
  .eq('id', id)
  .maybeSingle();

export const countSafeRows = async () => supabase
  .from('requests')
  .select('*', { count: 'exact', head: true });

export const loadSafeCatalog = async () => supabase
  .from('units')
  .select('id,name,symbol')
  .order('name', { ascending: true })
  .limit(101);

export const createSafeRow = async (name: string) => supabase
  .from('units')
  .insert({ name })
  .select('id,name,symbol')
  .single();

export const loadEverySafeRow = async () => fetchAllSupabaseRows(
  supabase.from('activities').select('id,timestamp,action'),
  { label: 'fixture activities', maxRows: 10_000, orderBy: ['timestamp', 'id'] },
);

export const loadEveryAssignedSafeRow = async () => {
  let query = supabase.from('activities').select('id,timestamp,action');
  query = query.eq('action', 'created');
  return fetchAllSupabaseRows(query, {
    label: 'fixture assigned activities',
    maxRows: 10_000,
    orderBy: ['timestamp', 'id'],
  });
};

export const createManySafeRows = async (names: string[]) => supabase
  .from('units')
  .insert(names.map(name => ({ name })))
  .select('id,name,symbol');
