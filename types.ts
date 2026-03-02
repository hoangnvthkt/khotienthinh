
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
  unit: string;
  priceIn: number;
  priceOut: number;
  minStock: number;
  supplierId?: string; // Link to Supplier
  imageUrl?: string;
  stockByWarehouse: Record<string, number>; // warehouseId -> quantity
}

export interface TransactionItem {
  itemId: string;
  quantity: number;
  price?: number; // Snapshot of price at transaction time
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
