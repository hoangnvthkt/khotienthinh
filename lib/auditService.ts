import { supabase } from './supabase';

// ══════════════════════════════════════════
//  AUDIT TRAIL SERVICE
//  Tracks all master data changes across ERP
// ══════════════════════════════════════════

export interface AuditEntry {
  id: string;
  tableName: string;
  recordId: string;
  recordLabel: string;
  entityType: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changes: Record<string, { from: any; to: any }>;
  changedFields: string[];
  changeCount: number;
  impactLevel: 'low' | 'normal' | 'high' | 'critical';
  oldData: Record<string, any>;
  newData: Record<string, any>;
  userId: string;
  userName: string;
  ipAddress: string;
  userAgent: string;
  module: string;
  description: string;
  context: Record<string, any>;
  createdAt: string;
}

const toCamel = (row: any): AuditEntry => ({
  id: row.id,
  tableName: row.table_name,
  recordId: row.record_id,
  recordLabel: row.record_label || '',
  entityType: row.entity_type || row.table_name,
  action: row.action,
  changes: row.changes || {},
  changedFields: row.changed_fields || Object.keys(row.changes || {}),
  changeCount: row.change_count ?? Object.keys(row.changes || {}).length,
  impactLevel: row.impact_level || 'normal',
  oldData: row.old_data || {},
  newData: row.new_data || {},
  userId: row.user_id || '',
  userName: row.user_name || '',
  ipAddress: row.ip_address || '',
  userAgent: row.user_agent || '',
  module: row.module || '',
  description: row.description || '',
  context: row.context || {},
  createdAt: row.created_at,
});

const TABLE_MODULE_MAP: Record<string, string> = {
  project_staff: 'PROJECT',
  project_staff_permissions: 'PROJECT',
  project_permission_types: 'PROJECT',
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
  daily_log_volumes: 'DA',
  quantity_acceptances: 'DA',
  payment_certificates: 'DA',
  contract_variations: 'DA',
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
  project_staff: 'Nhân sự dự án',
  project_staff_permissions: 'Quyền nhân sự dự án',
  project_permission_types: 'Loại quyền dự án',
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
  daily_log_volumes: 'Khối lượng nhật ký',
  quantity_acceptances: 'Nghiệm thu khối lượng',
  payment_certificates: 'Chứng từ thanh toán',
  contract_variations: 'Phát sinh hợp đồng',
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
  avatar: 'Ảnh đại diện',
  auth_id: 'Auth ID',
  username: 'Tên đăng nhập',
  assigned_warehouse_id: 'Kho được phân công',
  allowed_modules: 'Module được phép',
  admin_modules: 'Module quản trị',
  allowed_sub_modules: 'Phân hệ được phép',
  admin_sub_modules: 'Phân hệ quản trị',
  is_active: 'Đang hoạt động',
  payment_status: 'Trạng thái thanh toán',
  approval_status: 'Trạng thái duyệt',
  approved_by: 'Người duyệt',
  approved_at: 'Thời gian duyệt',
  submitted_by: 'Người trình',
  submitted_at: 'Thời gian trình',
  requester_id: 'Người yêu cầu',
  project_id: 'Dự án',
  warehouse_id: 'Kho',
  supplier_id: 'Nhà cung cấp',
};

export const getFieldLabel = (field: string): string =>
  FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /refresh/i,
  /access[_-]?key/i,
];

const HIGH_IMPACT_FIELD_PATTERNS = [
  /role/i,
  /permission/i,
  /admin/i,
  /status/i,
  /approved/i,
  /submitted/i,
  /amount/i,
  /price/i,
  /cost/i,
  /budget/i,
  /quantity/i,
  /qty/i,
  /contract/i,
  /payment/i,
  /salary/i,
  /stock/i,
];

const isSensitiveField = (field: string): boolean =>
  SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(field));

const maskValue = (field: string, value: any): any =>
  isSensitiveField(field) && value != null ? '[đã ẩn]' : value;

const sanitizeAuditData = (obj: Record<string, any> = {}): Record<string, any> => {
  const sanitized: Record<string, any> = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    sanitized[key] = maskValue(key, value);
  });
  return sanitized;
};

const getRecordLabel = (
  tableName: string,
  recordId: string,
  oldData?: Record<string, any>,
  newData?: Record<string, any>
): string => {
  const data = newData || oldData || {};
  return String(
    data.name ||
    data.full_name ||
    data.fullName ||
    data.title ||
    data.code ||
    data.sku ||
    data.email ||
    data.username ||
    recordId ||
    tableName
  );
};

const getBrowserContext = (): Record<string, any> => {
  if (typeof window === 'undefined') return {};
  return {
    path: window.location?.pathname || '',
    url: window.location?.href || '',
    origin: window.location?.origin || '',
    referrer: document.referrer || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    language: navigator.language || '',
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
};

const getUserAgent = (): string => {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
};

const getImpactLevel = (
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  changedFields: string[],
  tableName: string
): AuditEntry['impactLevel'] => {
  if (action === 'DELETE') return 'critical';
  if (tableName === 'users' && changedFields.some(field => /role|admin|is_active|auth_id/i.test(field))) return 'critical';
  if (changedFields.length >= 15) return 'critical';
  if (changedFields.length >= 8) return 'high';
  if (changedFields.some(field => HIGH_IMPACT_FIELD_PATTERNS.some(pattern => pattern.test(field)))) return 'high';
  if (action === 'INSERT') return 'normal';
  return changedFields.length <= 1 ? 'low' : 'normal';
};

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
      changes[key] = { from: maskValue(key, oldVal), to: maskValue(key, newVal) };
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
    context?: Record<string, any>;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void> {
    const { tableName, recordId, action, oldData, newData, userId, userName, description } = params;
    const module = TABLE_MODULE_MAP[tableName] || 'OTHER';
    const changes = action === 'UPDATE' ? computeChanges(oldData || {}, newData || {}) : {};
    const changedFields = Object.keys(changes);
    const changeCount = changedFields.length;
    const recordLabel = getRecordLabel(tableName, recordId, oldData, newData);
    const impactLevel = getImpactLevel(action, changedFields, tableName);
    const context = {
      ...getBrowserContext(),
      ...(params.context || {}),
      tableLabel: TABLE_LABELS[tableName] || tableName,
      actionLabel: action,
    };
    const safeOldData = sanitizeAuditData(oldData || {});
    const safeNewData = sanitizeAuditData(newData || {});

    // Skip if UPDATE but no actual changes
    if (action === 'UPDATE' && changeCount === 0) return;

    // Generate description if not provided
    let desc = description || '';
    if (!desc) {
      const tableLabel = TABLE_LABELS[tableName] || tableName;
      switch (action) {
        case 'INSERT':
          desc = `Thêm ${tableLabel}: ${recordLabel}`;
          break;
        case 'UPDATE':
          const changedFields = Object.keys(changes).map(k => getFieldLabel(k)).join(', ');
          desc = `Sửa ${tableLabel} "${recordLabel}": ${changedFields}`;
          break;
        case 'DELETE':
          desc = `Xóa ${tableLabel}: ${recordLabel}`;
          break;
      }
    }

    try {
      await supabase.from('audit_trail').insert({
        table_name: tableName,
        record_id: recordId,
        record_label: recordLabel,
        entity_type: TABLE_LABELS[tableName] || tableName,
        action,
        changes,
        changed_fields: changedFields,
        change_count: changeCount,
        impact_level: impactLevel,
        old_data: safeOldData,
        new_data: safeNewData,
        user_id: userId,
        user_name: userName,
        ip_address: params.ipAddress || null,
        user_agent: params.userAgent ?? getUserAgent(),
        module,
        description: desc,
        context,
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
