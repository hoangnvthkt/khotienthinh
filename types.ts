
export enum Role {
  ADMIN = 'ADMIN',
  KEEPER = 'KEEPER', // Thủ kho
  ACCOUNTANT = 'ACCOUNTANT', // Kế toán
  EMPLOYEE = 'EMPLOYEE', // Nhân viên
}

export enum TransactionType {
  IMPORT = 'IMPORT', // Nhập kho
  EXPORT = 'EXPORT', // Xuất kho
  TRANSFER = 'TRANSFER', // Chuyển kho
  ADJUSTMENT = 'ADJUSTMENT', // Kiểm kê/Điều chỉnh
  LIQUIDATION = 'LIQUIDATION', // Xuất hủy
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum RequestStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',       // Chờ duyệt
  APPROVED = 'APPROVED',     // Đã duyệt (Chờ xuất)
  REJECTED = 'REJECTED',     // Từ chối
  IN_TRANSIT = 'IN_TRANSIT', // Đã xuất kho (Đang vận chuyển)
  COMPLETED = 'COMPLETED',   // Đã nhận hàng
}

export type WarehouseType = 'GENERAL' | 'SITE' | 'OFFICE'; // Tổng | Công trường | Văn phòng

export interface User {
  id: string;
  name: string;
  email: string;
  username?: string; // Tên đăng nhập
  password?: string; // Mật khẩu
  phone?: string; // SĐT nhân viên
  role: Role;
  avatar?: string;
  assignedWarehouseId?: string; // ID kho được giao quản lý (null = Toàn quyền)
}

export interface Warehouse {
  id: string;
  name: string;
  address: string;
  type: WarehouseType;
  isArchived?: boolean; // Soft delete flag
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  debt: number; // Công nợ
}

// ==================== HRM MASTER DATA ====================

export interface HrmArea {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface HrmOffice {
  id: string;
  name: string;
  address?: string;
  createdAt?: string;
}

export interface HrmEmployeeType {
  id: string;
  name: string;
  createdAt?: string;
}

export interface HrmPosition {
  id: string;
  name: string;
  level?: number;
  createdAt?: string;
}

export interface HrmSalaryPolicy {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface HrmWorkSchedule {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

export interface HrmConstructionSite {
  id: string;
  name: string;
  address?: string;
  description?: string;
  createdAt?: string;
}

// ==================== DỰ ÁN (DA) ====================
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed';

export interface ProjectFinance {
  id: string;
  constructionSiteId: string;

  // Hợp đồng
  contractValue: number;
  contractSignDate?: string;
  estimatedEndDate?: string;

  // Ngân sách (Dự toán)
  budgetMaterials: number;
  budgetLabor: number;
  budgetSubcontract: number;
  budgetMachinery: number;
  budgetOverhead: number;

  // Chi phí thực tế
  actualMaterials: number;
  actualLabor: number;
  actualSubcontract: number;
  actualMachinery: number;
  actualOverhead: number;

  // Doanh thu
  revenueReceived: number;
  revenuePending: number;

  // Tiến độ
  progressPercent: number;
  status: ProjectStatus;

  notes?: string;
  updatedAt: string;
}

export type ProjectCostCategory = 'materials' | 'labor' | 'subcontract' | 'machinery' | 'overhead' | 'other';
export type ProjectTxType = 'expense' | 'revenue_received' | 'revenue_pending';
export type ProjectTxSource = 'manual' | 'import' | 'workflow';

export interface ProjectTransaction {
  id: string;
  projectFinanceId: string;
  constructionSiteId: string;
  type: ProjectTxType;
  category: ProjectCostCategory;
  amount: number;
  description: string;
  date: string;
  source: ProjectTxSource;
  sourceRef?: string;
  attachments?: { name: string; url: string; type: string }[];
  createdBy?: string;
  createdAt: string;
}

export type OrgUnitType = 'company' | 'department' | 'construction_site' | 'factory' | 'custom';

export interface OrgUnit {
  id: string;
  name: string;
  type: OrgUnitType;
  customTypeLabel?: string; // User-defined type label when type='custom'
  parentId?: string | null;
  description?: string;
  orderIndex: number;
  createdAt?: string;
}

export interface Employee {
  id: string;
  employeeCode: string; // Mã nhân sự TT00x
  fullName: string;
  title: string;
  gender: 'Nam' | 'Nữ' | 'Khác';
  phone: string;
  email: string;
  dateOfBirth?: string;
  startDate?: string;
  officialDate?: string;
  status: 'Đang làm việc' | 'Đã nghỉ việc';
  userId?: string; // Liên kết tới bảng users
  // HRM Master Data FK fields
  areaId?: string;
  officeId?: string;
  employeeTypeId?: string;
  positionId?: string;
  salaryPolicyId?: string;
  workScheduleId?: string;
  constructionSiteId?: string;
  departmentId?: string;
  factoryId?: string;
  maritalStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemCategory {
  id: string;
  name: string;
}

export interface ItemUnit {
  id: string;
  name: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;          // Đơn vị tồn kho & xuất kho (VD: Cây, Cái, Tấm)
  purchaseUnit?: string; // Đơn vị mua hàng (VD: KG, Tấn) - khác với unit nếu có
  priceIn: number;
  priceOut: number;
  minStock: number;
  supplierId?: string; // Link to Supplier
  imageUrl?: string;
  location?: string; // Vị trí trong kho, ví dụ: Kệ A-3, Ô 2
  stockByWarehouse: Record<string, number>; // warehouseId -> quantity (in base unit)
}

export interface TransactionItem {
  itemId: string;
  quantity: number;            // Số lượng theo đơn vị tồn kho (Cây, Cái...)
  price?: number;              // Snapshot giá tại thời điểm giao dịch
  // --- Thông tin kế toán (chỉ áp dụng khi NHẬP KHO với đơn vị mua khác) ---
  accountingQty?: number;      // Số lượng theo đơn vị mua (VD: 10.05 KG)
  accountingUnit?: string;     // Đơn vị mua (VD: 'KG') - snapshot tại thời điểm nhập
  accountingPrice?: number;    // Đơn giá theo đơn vị mua (VD: 15000 VNĐ/KG)
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  items: TransactionItem[];
  sourceWarehouseId?: string; // For Export/Transfer
  targetWarehouseId?: string; // For Import/Transfer
  supplierId?: string; // For Import
  requesterId: string; // User requesting
  approverId?: string; // User approving
  status: TransactionStatus;
  note?: string;
  relatedRequestId?: string; // Link to MaterialRequest
  pendingItems?: InventoryItem[]; // Full metadata for new items created during bulk import
}

export interface AuditLog {
  action: string;
  userId: string;
  timestamp: string;
  note?: string;
}

// ==================== LOSS MANAGEMENT ====================

export enum LossReason {
  NATURAL_LOSS = 'NATURAL_LOSS',       // Hao hụt tự nhiên
  DAMAGE = 'DAMAGE',                   // Hư hỏng
  THEFT = 'THEFT',                     // Thất thoát/mất cắp
  MEASUREMENT = 'MEASUREMENT',         // Sai lệch đo lường
  EXPIRED = 'EXPIRED',                 // Hết hạn/biến chất
  PROCESS_WASTE = 'PROCESS_WASTE',     // Hao hụt gia công
}

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  [LossReason.NATURAL_LOSS]: 'Hao hụt tự nhiên',
  [LossReason.DAMAGE]: 'Hư hỏng',
  [LossReason.THEFT]: 'Thất thoát / mất cắp',
  [LossReason.MEASUREMENT]: 'Sai lệch đo lường',
  [LossReason.EXPIRED]: 'Hết hạn / biến chất',
  [LossReason.PROCESS_WASTE]: 'Hao hụt gia công',
};

export interface MaterialLossNorm {
  id: string;
  itemId?: string;        // specific item (optional)
  categoryId?: string;    // or by category
  lossType: LossReason;
  allowedPercentage: number;  // % allowed loss
  period: 'monthly' | 'quarterly' | 'yearly';
  createdBy?: string;
  createdAt?: string;
}

export interface AuditSessionItem {
  itemId: string;
  itemName: string;
  sku: string;
  unit?: string;
  systemStock: number;
  actualStock: number;
  delta: number;
  lossReason?: LossReason;
  note?: string;
  exceedsNorm?: boolean;
  lossPercent?: number;
  normPercent?: number;
  lossValue?: number;
}

export interface AuditSession {
  id: string;
  warehouseId: string;
  warehouseName: string;
  date: string;
  auditorId: string;
  auditorName: string;
  items: AuditSessionItem[];
  totalItems: number;
  totalDiscrepancies: number;
  totalExceedNorm: number;
  totalLossValue: number;
  transactionId?: string;
}

// New Global Activity Structure
export type ActivityType = 'TRANSACTION' | 'INVENTORY' | 'REQUEST' | 'SYSTEM';

export interface GlobalActivity {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  type: ActivityType;
  action: string;
  description: string;
  timestamp: string;
  warehouseId?: string; // ID kho liên quan để lọc nhật ký
  status?: 'SUCCESS' | 'WARNING' | 'INFO' | 'DANGER';
}

export interface RequestItem {
  itemId: string;
  requestQty: number;
  approvedQty: number; // Thực xuất (Bộ phận tiếp nhận quyết định)
}

export interface MaterialRequest {
  id: string;
  code: string; // e.g., MR-2023-001
  siteWarehouseId: string; // Kho công trường yêu cầu
  sourceWarehouseId?: string; // Kho cung cấp (thường là kho tổng)
  requesterId: string;
  status: RequestStatus;
  items: RequestItem[];
  createdDate: string;
  expectedDate: string;
  note?: string;
  logs: AuditLog[];
}

export interface Stats {
  totalValue: number;
  lowStockCount: number;
  pendingRequests: number;
  monthlyFlow: { name: string; in: number; out: number }[];
}

// ==================== WORKFLOW MODULE ====================

export enum WorkflowNodeType {
  START = 'START',
  ACTION = 'ACTION',
  APPROVAL = 'APPROVAL',
  END = 'END',
}

export enum WorkflowInstanceStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum WorkflowInstanceAction {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  REOPENED = 'REOPENED',
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'file';

export interface WorkflowCustomField {
  id: string;
  name: string;        // key identifier (e.g., "bo_phan")
  label: string;       // Display label (e.g., "Bộ phận/Công trường")
  type: CustomFieldType;
  required: boolean;
  options?: string[];   // For 'select' type
  placeholder?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  createdBy: string; // user id
  isActive: boolean;
  customFields: WorkflowCustomField[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  templateId: string;
  type: WorkflowNodeType;
  label: string;
  config: {
    assigneeRole?: Role;       // Vai trò phụ trách duyệt bước này
    assigneeUserId?: string;   // Cụ thể user nào duyệt (ưu tiên hơn role)
    formFields?: { name: string; label: string; type: 'text' | 'number' | 'textarea'; required?: boolean }[];
    slaHours?: number;         // Thời gian tối đa xử lý (giờ)
  };
  positionX: number;
  positionY: number;
}

export interface WorkflowEdge {
  id: string;
  templateId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
}

export interface WorkflowInstance {
  id: string;
  templateId: string;
  code: string;
  title: string;
  createdBy: string; // user id
  currentNodeId: string | null;
  status: WorkflowInstanceStatus;
  formData: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstanceLog {
  id: string;
  instanceId: string;
  nodeId: string;
  action: WorkflowInstanceAction;
  actedBy: string; // user id
  comment: string;
  createdAt: string;
}

// ==================== CHAT ====================
export interface ChatConversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatarUrl?: string;
  createdBy?: string;
  createdAt: string;
  // Computed (local only)
  members?: ChatMember[];
  lastMessage?: ChatMessage;
  unreadCount?: number;
}

export interface ChatMember {
  id: string;
  conversationId: string;
  userId: string;
  role: 'admin' | 'member';
  lastReadAt: string;
  joinedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content?: string;
  type: 'text' | 'image' | 'file' | 'system';
  attachments?: { url: string; name: string; type: string; size?: number }[];
  reactions?: Record<string, string[]>; // emoji -> userIds
  createdAt: string;
}
