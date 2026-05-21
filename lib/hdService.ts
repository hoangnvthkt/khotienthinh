import { supabase } from './supabase';
import { ContractAppendix, CustomerContract, SubcontractorContract, SupplierContract } from '../types';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';

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
const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

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

  async listBySite(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<CustomerContract[]> {
    const { data, error } = await supabase
      .from('customer_contracts')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return dedupeRowsById(data || []).map(fromDb);
  },

  async getById(id: string): Promise<CustomerContract | null> {
    const { data, error } = await supabase
      .from('customer_contracts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromDb(data) : null;
  },

  async upsert(item: CustomerContract): Promise<void> {
    const payload = cleanUndefined(toDb({
      ...item,
      updatedAt: new Date().toISOString(),
      createdAt: item.createdAt,
    }));
    const { error } = await supabase
      .from('customer_contracts')
      .upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  },

  async updateAttachments(id: string, attachments: CustomerContract['attachments']): Promise<void> {
    const { error } = await supabase
      .from('customer_contracts')
      .update({ attachments, updated_at: new Date().toISOString() })
      .eq('id', id);
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

  async listBySite(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<SubcontractorContract[]> {
    const { data, error } = await supabase
      .from('subcontractor_contracts')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return dedupeRowsById(data || []).map(fromDb);
  },

  async getById(id: string): Promise<SubcontractorContract | null> {
    const { data, error } = await supabase
      .from('subcontractor_contracts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromDb(data) : null;
  },

  async upsert(item: SubcontractorContract): Promise<void> {
    const { error } = await supabase
      .from('subcontractor_contracts')
      .upsert(cleanUndefined(toDb(item)), { onConflict: 'id' });
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

// ==================== PHỤ LỤC HỢP ĐỒNG ====================
export const contractAppendixService = {
  async listByContract(contractId: string, contractType: ContractAppendix['contractType']): Promise<ContractAppendix[]> {
    const { data, error } = await supabase
      .from('contract_appendices')
      .select('*')
      .eq('contract_id', contractId)
      .eq('contract_type', contractType)
      .order('signed_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(item: ContractAppendix): Promise<void> {
    const payload = cleanUndefined(toDb({
      ...item,
      variationIds: item.variationIds || [],
      attachments: item.attachments || [],
      updatedAt: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('contract_appendices')
      .upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('contract_appendices')
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

  async listBySite(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<SupplierContract[]> {
    const { data, error } = await supabase
      .from('supplier_contracts')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return dedupeRowsById(data || []).map(fromDb);
  },

  async upsert(item: SupplierContract): Promise<void> {
    const { error } = await supabase
      .from('supplier_contracts')
      .upsert(cleanUndefined(toDb(item)), { onConflict: 'id' });
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
