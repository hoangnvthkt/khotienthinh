import { supabase } from './supabase';
import { CustomerContract, SubcontractorContract, SupplierContract } from '../types';

// ══════════════════════════════════════════════════════════════
//  HD SERVICE — CRUD cho 3 bảng Hợp Đồng
//  Dùng chung cho: module HD (pages/hd/) và module DA (ContractTab, SubcontractTab)
// ══════════════════════════════════════════════════════════════

// snake_case ↔ camelCase
const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
const mapKeys = (obj: any, fn: (k: string) => string): any => {
  if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
  }
  return obj;
};
const toDb = (obj: any) => mapKeys(obj, toSnake);
const fromDb = (obj: any) => mapKeys(obj, toCamel);

// ==================== HĐ KHÁCH HÀNG ====================
export const customerContractService = {
  async list(): Promise<CustomerContract[]> {
    const { data, error } = await supabase
      .from('customer_contracts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async listBySite(constructionSiteId: string): Promise<CustomerContract[]> {
    const { data, error } = await supabase
      .from('customer_contracts')
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(item: CustomerContract): Promise<void> {
    const { error } = await supabase
      .from('customer_contracts')
      .upsert(toDb(item), { onConflict: 'id' });
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('customer_contracts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

// ==================== HĐ THẦU PHỤ ====================
export const subcontractorContractService = {
  async list(): Promise<SubcontractorContract[]> {
    const { data, error } = await supabase
      .from('subcontractor_contracts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async listBySite(constructionSiteId: string): Promise<SubcontractorContract[]> {
    const { data, error } = await supabase
      .from('subcontractor_contracts')
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(item: SubcontractorContract): Promise<void> {
    const { error } = await supabase
      .from('subcontractor_contracts')
      .upsert(toDb(item), { onConflict: 'id' });
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('subcontractor_contracts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

// ==================== HĐ NHÀ CUNG CẤP ====================
export const supplierContractService = {
  async list(): Promise<SupplierContract[]> {
    const { data, error } = await supabase
      .from('supplier_contracts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(item: SupplierContract): Promise<void> {
    const { error } = await supabase
      .from('supplier_contracts')
      .upsert(toDb(item), { onConflict: 'id' });
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('supplier_contracts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
