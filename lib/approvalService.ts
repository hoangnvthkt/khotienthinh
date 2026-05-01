import { supabase } from './supabase';
import { User } from '../types';
import { projectStaffService } from './projectStaffService';

// ══════════════════════════════════════════════════════════════
//  APPROVAL SERVICE — Phân quyền duyệt
//  Priority: PBAC (project_staff_permissions) → approval_rules (fallback)
// ══════════════════════════════════════════════════════════════

export type ApprovalModule =
  | 'quantity_acceptance'
  | 'payment_certificate'
  | 'contract_variation'
  | 'purchase_order';

export type ApprovalAction = 'submit' | 'approve' | 'paid';

export interface ApprovalRule {
  id: string;
  constructionSiteId?: string;
  module: ApprovalModule;
  action: ApprovalAction;
  minAmount: number;
  maxAmount?: number;
  approverUserId?: string;
  approverRole?: string;
  approverModuleAdmin: boolean;
  name: string;
  description?: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalCheckParams {
  module: ApprovalModule;
  action: ApprovalAction;
  amount: number;           // Giá trị chứng từ
  constructionSiteId?: string;
  user: User;               // User đang thao tác
}

interface ApprovalCheckResult {
  allowed: boolean;
  reason: string;
  matchedRule?: ApprovalRule;
}

// ── DB ↔ App mapper ──
const fromDb = (row: any): ApprovalRule => ({
  id: row.id,
  constructionSiteId: row.construction_site_id,
  module: row.module,
  action: row.action,
  minAmount: Number(row.min_amount || 0),
  maxAmount: row.max_amount != null ? Number(row.max_amount) : undefined,
  approverUserId: row.approver_user_id,
  approverRole: row.approver_role,
  approverModuleAdmin: !!row.approver_module_admin,
  name: row.name,
  description: row.description,
  priority: row.priority || 0,
  isActive: row.is_active !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toDb = (rule: Partial<ApprovalRule>): any => {
  const r: any = {};
  if (rule.constructionSiteId !== undefined) r.construction_site_id = rule.constructionSiteId || null;
  if (rule.module !== undefined) r.module = rule.module;
  if (rule.action !== undefined) r.action = rule.action;
  if (rule.minAmount !== undefined) r.min_amount = rule.minAmount;
  if (rule.maxAmount !== undefined) r.max_amount = rule.maxAmount ?? null;
  if (rule.approverUserId !== undefined) r.approver_user_id = rule.approverUserId || null;
  if (rule.approverRole !== undefined) r.approver_role = rule.approverRole || null;
  if (rule.approverModuleAdmin !== undefined) r.approver_module_admin = rule.approverModuleAdmin;
  if (rule.name !== undefined) r.name = rule.name;
  if (rule.description !== undefined) r.description = rule.description;
  if (rule.priority !== undefined) r.priority = rule.priority;
  if (rule.isActive !== undefined) r.is_active = rule.isActive;
  r.updated_at = new Date().toISOString();
  return r;
};

export const approvalService = {
  /**
   * Kiểm tra user có quyền thực hiện action trên module với giá trị nhất định.
   * Algorithm:
   * 1. Load tất cả active rules khớp module + action
   * 2. Filter theo công trình (site-specific > global)
   * 3. Filter theo ngưỡng giá trị (min_amount ≤ amount ≤ max_amount)
   * 4. Sort theo priority DESC → lấy rule ưu tiên cao nhất
   * 5. Kiểm tra user có phù hợp rule đó không
   */
  async checkApproval(params: ApprovalCheckParams): Promise<ApprovalCheckResult> {
    const { module, action, amount, constructionSiteId, user } = params;

    // ── PBAC CHECK (Priority 1) ──
    // Nếu công trình đã setup project_staff → dùng position-based permissions
    if (constructionSiteId) {
      try {
        const hasSiteStaff = await projectStaffService.hasSiteStaff(constructionSiteId);
        if (hasSiteStaff) {
          // Map approval action → permission code
          const permCode = action === 'paid' ? 'approve' : action; // 'paid' maps to 'approve' permission
          const pbacResult = await projectStaffService.checkPermission(user.id, constructionSiteId, permCode);

          if (pbacResult.allowed) {
            return { allowed: true, reason: `Đủ quyền theo tổ chức dự án (PBAC).` };
          } else {
            return {
              allowed: false,
              reason: `Bạn không có quyền "${permCode}" tại công trường này. Liên hệ Giám đốc DA để được cấp quyền.`,
            };
          }
        }
      } catch {
        // Nếu PBAC bị lỗi → fallback sang approval_rules
      }
    }

    // ── LEGACY CHECK (Priority 2 — Fallback) ──
    // Load rules
    let query = supabase
      .from('approval_rules')
      .select('*')
      .eq('module', module)
      .eq('action', action)
      .eq('is_active', true)
      .lte('min_amount', amount)
      .order('priority', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    const allRules = (data || []).map(fromDb);

    // Filter theo max_amount (NULL = unlimited)
    const amountRules = allRules.filter(r =>
      r.maxAmount == null || amount <= r.maxAmount
    );

    // Chia thành site-specific và global
    const siteRules = amountRules.filter(r => r.constructionSiteId === constructionSiteId);
    const globalRules = amountRules.filter(r => !r.constructionSiteId);

    // Site-specific rules ưu tiên hơn global
    const applicableRules = siteRules.length > 0 ? siteRules : globalRules;

    if (applicableRules.length === 0) {
      // Không có rule nào → cho phép mặc định (backward compat)
      return { allowed: true, reason: 'Không có quy tắc phân quyền — cho phép mặc định.' };
    }

    // Lấy rule priority cao nhất
    const topRule = applicableRules[0];

    // Kiểm tra user phù hợp
    const allowed = this.userMatchesRule(user, topRule);

    if (allowed) {
      return {
        allowed: true,
        reason: `Đủ quyền theo: ${topRule.name}`,
        matchedRule: topRule,
      };
    }

    return {
      allowed: false,
      reason: this.buildDenialReason(topRule, amount),
      matchedRule: topRule,
    };
  },

  /** Kiểm tra user có phù hợp rule */
  userMatchesRule(user: User, rule: ApprovalRule): boolean {
    // Check 1: User cụ thể
    if (rule.approverUserId && rule.approverUserId === user.id) return true;

    // Check 2: Role
    if (rule.approverRole && user.role === rule.approverRole) return true;

    // Check 3: Module admin — user có quyền admin trên module "DA"
    if (rule.approverModuleAdmin) {
      const isModuleAdmin = user.role === 'ADMIN' ||
        (user.adminModules || []).includes('DA');
      if (isModuleAdmin) return true;
    }

    return false;
  },

  /** Tạo message từ chối rõ ràng */
  buildDenialReason(rule: ApprovalRule, amount: number): string {
    const fmtAmount = (n: number) => {
      if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
      if (n >= 1e6) return (n / 1e6).toFixed(0) + ' triệu';
      return n.toLocaleString('vi-VN') + ' đ';
    };

    let msg = `Bạn không đủ quyền ${rule.action === 'approve' ? 'duyệt' : rule.action === 'paid' ? 'xác nhận thanh toán' : 'gửi duyệt'}.`;

    if (rule.minAmount > 0) {
      msg += ` Chứng từ ${fmtAmount(amount)} vượt ngưỡng ${fmtAmount(rule.minAmount)}.`;
    }

    if (rule.approverRole) {
      msg += ` Yêu cầu vai trò: ${rule.approverRole}.`;
    }
    if (rule.approverUserId) {
      msg += ' Yêu cầu người duyệt cụ thể.';
    }

    msg += ` (Quy tắc: ${rule.name})`;
    return msg;
  },

  // ── CRUD cho admin UI ──
  async list(constructionSiteId?: string): Promise<ApprovalRule[]> {
    let query = supabase
      .from('approval_rules')
      .select('*')
      .order('priority', { ascending: false });

    if (constructionSiteId) {
      query = query.or(`construction_site_id.eq.${constructionSiteId},construction_site_id.is.null`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(rule: Partial<ApprovalRule> & { id?: string }): Promise<void> {
    const dbData = toDb(rule);
    if (rule.id) {
      const { error } = await supabase.from('approval_rules').update(dbData).eq('id', rule.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('approval_rules').insert(dbData);
      if (error) throw error;
    }
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('approval_rules').delete().eq('id', id);
    if (error) throw error;
  },

  async toggleActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('approval_rules')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};
