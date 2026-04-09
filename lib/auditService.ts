import { supabase } from './supabase';

// ══════════════════════════════════════════
//  AUDIT TRAIL SERVICE
//  Tracks all master data changes across ERP
// ══════════════════════════════════════════

export interface AuditEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changes: Record<string, { from: any; to: any }>;
  oldData: Record<string, any>;
  newData: Record<string, any>;
  userId: string;
  userName: string;
  module: string;
  description: string;
  createdAt: string;
}

const toCamel = (row: any): AuditEntry => ({
  id: row.id,
  tableName: row.table_name,
  recordId: row.record_id,
  action: row.action,
  changes: row.changes || {},
  oldData: row.old_data || {},
  newData: row.new_data || {},
  userId: row.user_id || '',
  userName: row.user_name || '',
  module: row.module || '',
  description: row.description || '',
  createdAt: row.created_at,
});

// Module mapping from table name
const TABLE_MODULE_MAP: Record<string, string> = {
  items: 'WMS',
  warehouses: 'WMS',
  categories: 'WMS',
  suppliers: 'WMS',
  transactions: 'WMS',
  requests: 'WMS',
  employees: 'HRM',
  hrm_attendance: 'HRM',
  hrm_leave_requests: 'HRM',
  hrm_payrolls: 'HRM',
  hrm_labor_contracts: 'HRM',
  hrm_positions: 'HRM',
  hrm_offices: 'HRM',
  hrm_construction_sites: 'HRM',
  org_units: 'HRM',
  hrm_shift_types: 'HRM',
  assets: 'TS',
  asset_assignments: 'TS',
  asset_maintenances: 'TS',
  asset_categories: 'TS',
  project_finances: 'DA',
  project_tasks: 'DA',
  project_contracts: 'DA',
  material_budget_items: 'DA',
  project_material_requests: 'DA',
  purchase_orders: 'DA',
  daily_logs: 'DA',
  acceptance_records: 'DA',
  workflow_templates: 'WF',
  workflow_instances: 'WF',
  request_instances: 'RQ',
  request_categories: 'RQ',
  cash_funds: 'TC',
  cash_vouchers: 'TC',
  budget_entries: 'TC',
  users: 'SYSTEM',
  app_settings: 'SYSTEM',
};

// Human-readable table names
export const TABLE_LABELS: Record<string, string> = {
  items: 'Vật tư',
  warehouses: 'Kho bãi',
  categories: 'Danh mục',
  suppliers: 'Nhà cung cấp',
  transactions: 'Phiếu kho',
  requests: 'Đề xuất vật tư',
  employees: 'Nhân viên',
  hrm_attendance: 'Chấm công',
  hrm_leave_requests: 'Đơn nghỉ phép',
  hrm_payrolls: 'Bảng lương',
  hrm_labor_contracts: 'Hợp đồng LĐ',
  hrm_positions: 'Chức danh',
  hrm_offices: 'Văn phòng',
  hrm_construction_sites: 'Công trường',
  org_units: 'Đơn vị tổ chức',
  assets: 'Tài sản',
  asset_assignments: 'Cấp phát TS',
  asset_maintenances: 'Bảo trì TS',
  project_finances: 'Tài chính DA',
  project_tasks: 'Công việc DA',
  project_contracts: 'Hợp đồng DA',
  material_budget_items: 'Dự toán VT',
  project_material_requests: 'Đề xuất VT (DA)',
  purchase_orders: 'Đơn mua hàng',
  daily_logs: 'Nhật ký CT',
  acceptance_records: 'Nghiệm thu',
  workflow_templates: 'Mẫu quy trình',
  workflow_instances: 'Phiếu quy trình',
  request_instances: 'Phiếu yêu cầu',
  cash_funds: 'Quỹ tiền mặt',
  cash_vouchers: 'Phiếu thu/chi',
  budget_entries: 'Mục ngân sách',
  users: 'Người dùng',
  app_settings: 'Cài đặt hệ thống',
};

// Field labels for common fields across tables
const FIELD_LABELS: Record<string, string> = {
  name: 'Tên',
  full_name: 'Họ tên',
  sku: 'Mã SKU',
  price_in: 'Giá nhập',
  price_out: 'Giá xuất',
  min_stock: 'Tồn kho tối thiểu',
  unit: 'Đơn vị tính',
  category: 'Danh mục',
  status: 'Trạng thái',
  description: 'Mô tả',
  email: 'Email',
  phone: 'Số điện thoại',
  role: 'Vai trò',
  position_id: 'Chức danh',
  department_id: 'Phòng ban',
  salary: 'Lương',
  start_date: 'Ngày bắt đầu',
  end_date: 'Ngày kết thúc',
  contract_value: 'Giá trị HĐ',
  progress_percent: 'Tiến độ (%)',
  budget: 'Ngân sách',
  quantity: 'Số lượng',
  amount: 'Số tiền',
  due_date: 'Hạn thanh toán',
  title: 'Tiêu đề',
  note: 'Ghi chú',
  type: 'Loại',
  location: 'Vị trí',
  serial_number: 'Số serial',
  purchase_date: 'Ngày mua',
  purchase_price: 'Giá mua',
};

export const getFieldLabel = (field: string): string =>
  FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

// Compute diff between old and new objects (only changed fields)
export function computeChanges(oldObj: Record<string, any>, newObj: Record<string, any>): Record<string, { from: any; to: any }> {
  const changes: Record<string, { from: any; to: any }> = {};
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  // Skip metadata/system fields
  const SKIP = new Set(['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt', 'stockByWarehouse']);

  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    // Skip if both are null/undefined
    if (oldVal == null && newVal == null) continue;

    // Compare as JSON for objects/arrays
    const oldStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal ?? '');
    const newStr = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal ?? '');

    if (oldStr !== newStr) {
      changes[key] = { from: oldVal, to: newVal };
    }
  }
  return changes;
}

export const auditService = {
  /** Log an audit entry */
  async log(params: {
    tableName: string;
    recordId: string;
    action: 'INSERT' | 'UPDATE' | 'DELETE';
    oldData?: Record<string, any>;
    newData?: Record<string, any>;
    userId: string;
    userName: string;
    description?: string;
  }): Promise<void> {
    const { tableName, recordId, action, oldData, newData, userId, userName, description } = params;
    const module = TABLE_MODULE_MAP[tableName] || 'OTHER';
    const changes = action === 'UPDATE' ? computeChanges(oldData || {}, newData || {}) : {};

    // Skip if UPDATE but no actual changes
    if (action === 'UPDATE' && Object.keys(changes).length === 0) return;

    // Generate description if not provided
    let desc = description || '';
    if (!desc) {
      const tableLabel = TABLE_LABELS[tableName] || tableName;
      const recordName = newData?.name || newData?.full_name || newData?.title || newData?.sku || recordId;
      switch (action) {
        case 'INSERT':
          desc = `Thêm ${tableLabel}: ${recordName}`;
          break;
        case 'UPDATE':
          const changedFields = Object.keys(changes).map(k => getFieldLabel(k)).join(', ');
          desc = `Sửa ${tableLabel} "${recordName}": ${changedFields}`;
          break;
        case 'DELETE':
          desc = `Xóa ${tableLabel}: ${recordName}`;
          break;
      }
    }

    try {
      await supabase.from('audit_trail').insert({
        table_name: tableName,
        record_id: recordId,
        action,
        changes,
        old_data: oldData || {},
        new_data: newData || {},
        user_id: userId,
        user_name: userName,
        module,
        description: desc,
      });
    } catch (err) {
      console.error('Audit trail log error:', err);
    }
  },

  /** List audit entries with filters */
  async list(filters?: {
    tableName?: string;
    recordId?: string;
    module?: string;
    userId?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    let query = supabase
      .from('audit_trail')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filters?.limit || 100);

    if (filters?.tableName) query = query.eq('table_name', filters.tableName);
    if (filters?.recordId) query = query.eq('record_id', filters.recordId);
    if (filters?.module) query = query.eq('module', filters.module);
    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.action) query = query.eq('action', filters.action);
    if (filters?.from) query = query.gte('created_at', filters.from);
    if (filters?.to) query = query.lte('created_at', filters.to);

    const { data } = await query;
    return (data || []).map(toCamel);
  },

  /** Get history for a specific record */
  async getRecordHistory(tableName: string, recordId: string): Promise<AuditEntry[]> {
    return this.list({ tableName, recordId, limit: 50 });
  },
};
