import { supabase } from '../../lib/supabase';

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

