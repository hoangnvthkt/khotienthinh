import { supabase } from './supabase';
import { Role, type User } from '../types';
import { canPerformInAnyScope } from './permissions/permissionService';

export type AssetCondition = 'good' | 'damaged' | 'lost' | 'wrong_location';

export interface AssetAuditItem {
  assetId: string;
  assetName: string;
  assetCode: string;
  categoryName: string;
  expectedStatus: string;
  actualCondition: AssetCondition;
  expectedLocation: string;
  actualLocation?: string;
  note?: string;
}

export interface AssetAuditSession {
  id: string;
  date: string;
  auditorName: string;
  items: AssetAuditItem[];
  totalItems: number;
  totalGood: number;
  totalDamaged: number;
  totalLost: number;
  totalWrongLocation: number;
}

const COLUMNS = 'id,audited_at,auditor_name,items,total_items,total_good,total_damaged,total_lost,total_wrong_location';
const HISTORY_LIMIT = 200;

const fromRow = (row: any): AssetAuditSession => ({
  id: row.id,
  date: row.audited_at,
  auditorName: row.auditor_name,
  items: Array.isArray(row.items) ? row.items : [],
  totalItems: row.total_items,
  totalGood: row.total_good,
  totalDamaged: row.total_damaged,
  totalLost: row.total_lost,
  totalWrongLocation: row.total_wrong_location,
});

const count = (items: readonly AssetAuditItem[], condition: AssetCondition) =>
  items.filter(item => item.actualCondition === condition).length;

/** Can see past audits (server: asset.audit.view or asset.audit.perform, any scope). */
export const canViewAssetAudits = (user: User | null | undefined): boolean => Boolean(user)
  && (user!.role === Role.ADMIN || canPerformInAnyScope(user!, 'asset.audit.view') || canPerformInAnyScope(user!, 'asset.audit.perform'));

/** Can record a new audit (server: asset.audit.perform, any scope). */
export const canRecordAssetAudit = (user: User | null | undefined): boolean => Boolean(user)
  && (user!.role === Role.ADMIN || canPerformInAnyScope(user!, 'asset.audit.perform'));

export const assetAuditService = {
  /** Most recent audits first. */
  async list(): Promise<AssetAuditSession[]> {
    const { data, error } = await supabase
      .from('asset_audit_sessions')
      .select(COLUMNS)
      .order('audited_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    return (data || []).map(fromRow);
  },

  /** Saves a finished audit; the server records who did it and when. */
  async create(items: readonly AssetAuditItem[]): Promise<AssetAuditSession> {
    const { data, error } = await supabase
      .from('asset_audit_sessions')
      .insert({
        items,
        total_items: items.length,
        total_good: count(items, 'good'),
        total_damaged: count(items, 'damaged'),
        total_lost: count(items, 'lost'),
        total_wrong_location: count(items, 'wrong_location'),
        // auditor_user_id / auditor_name are set by the server from the signed-in account.
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return fromRow(data);
  },
};
