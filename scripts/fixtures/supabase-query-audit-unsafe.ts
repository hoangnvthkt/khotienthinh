import { supabase } from '../../lib/supabase';

export const loadUnsafeTransactions = async () => supabase
  .from('transactions')
  .select('*')
  .order('date', { ascending: false });

export const loadUnsafeNamedRows = async () => supabase
  .from('requests')
  .select('id,created_date,status')
  .order('created_date', { ascending: false });

