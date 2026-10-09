// Dữ liệu Bảng điều khiển (Trung tâm điều hành). Một bộ dữ liệu cho cả 4 bảng; máy chủ chỉ trả dự án và con số
// người dùng được xem (Room dự án, công tắc xem tài chính, quyền Tài chính / Kho / Mua hàng). Con số chưa biết = null,
// không bao giờ thay bằng 0.

export type DashboardId = 'portfolio' | 'cashflow' | 'materials' | 'debt';

export type CostCategory = 'materials' | 'labor' | 'machinery' | 'subcontract' | 'overhead' | 'other';

/** Dữ liệu còn thiếu của một dự án (máy chủ tính) — bảng nhắc đi bổ sung. */
export type DashGap =
  | 'dates' | 'gantt' | 'baseline' | 'coords' | 'director'
  | 'contract' | 'budget' | 'unclassified' | 'ar_due' | 'ap_due'
  | 'material_budget' | 'material_price';

export interface DashProject {
  id: string;
  code: string;
  name: string;
  /** projects.status: planning | active | paused | completed … */
  status: string;
  createdAt: string | null;
  /** Giám đốc / chỉ huy dự án. */
  director: string | null;
  site: { name: string; address: string | null; lat: number | null; lng: number | null } | null;
  start: string | null;
  end: string | null;
  /** Tiến độ kế hoạch hôm nay (baseline Gantt) và thực tế (Gantt, có trọng số), 0–100. */
  plannedProgress: number | null;
  actualProgress: number | null;
  /** Lúc tổng hợp số liệu dự án. */
  updatedAt: string | null;
  /** null = người này không được xem tài chính dự án (công tắc xem tài chính). */
  finance: DashProjectFinance | null;
  /** estimated = phần giá trị nhập / xuất ước tính cho dòng sổ kho chưa có giá trị (số lượng × đơn giá dự toán / danh mục). */
  materials: { budget: number | null; purchased: number; imported: number; exported: number; estimated: number } | null;
  gaps: DashGap[];
}

export interface DashProjectFinance {
  /** Giá trị HĐ nhận thầu (chưa VAT, gồm phát sinh CĐT đã duyệt) và riêng phần phát sinh. */
  contractValue: number | null;
  variation: number;
  /** Ngân sách chi phí đã duyệt. */
  budget: number | null;
  /** Sản lượng thực hiện = giá trị HĐ × tiến độ thực tế; nghiệm thu = đợt CĐT đã xác nhận (chưa VAT). */
  output: number | null;
  accepted: number;
  /** Tiền CĐT đã trả, chi phí đã ghi nhận. */
  received: number;
  cost: number;
  costByCategory: Partial<Record<CostCategory, number>>;
  /** Phải thu CĐT (tiền thật, gồm VAT). flow: doanh thu chưa VAT tách thành đã thu / còn nợ / giữ lại / khấu trừ tạm ứng. */
  ar: {
    requested: number; retention: number; advance: number; advanceRecovered: number; outstanding: number; overdue: number;
    flow: { paid: number; outstanding: number; retention: number; recovered: number };
  };
  /** Phải trả thầu phụ + NCC (gồm VAT). */
  ap: {
    requested: number; retention: number; advance: number; outstanding: number; overdue: number; paid: number;
    subcontract: { total: number; paid: number };
    supplier: { total: number; paid: number };
  };
  /** Số chứng từ: 0 = chưa nhập (bảng hiện "Chưa có dữ liệu"), khác với số tiền 0 thật. */
  records: DashRecords;
}

export interface DashRecords { arRounds: number; apDocs: number; receipts: number; payments: number }

export interface DashMonth {
  /** yyyy-mm */
  month: string;
  projectId: string;
  /** Doanh thu nghiệm thu, chi phí ghi nhận, tiền vào / ra, giá trị nhập / xuất kho. */
  revenue: number;
  cost: number;
  cashIn: number;
  cashOut: number;
  matIn: number;
  matOut: number;
}

export interface DashMaterialItem {
  id: string;
  projectId: string;
  name: string;
  unit: string;
  budget: number;
  purchased: number;
}

export interface DashNeed {
  /** Một dòng của đề xuất (requestId:số dòng). */
  id: string;
  requestId: string;
  code: string;
  title: string;
  /** buy = cần mua (Mua hàng); issue = cấp từ kho. */
  kind: 'buy' | 'issue';
  material: string;
  unit: string;
  qty: number;
  neededDate: string | null;
  projectId: string;
}

export interface DashboardDataset {
  generatedAt: string;
  /** yyyy-mm-dd theo giờ Việt Nam. */
  today: string;
  /** Bảng người dùng được xem, theo thứ tự hiện. */
  access: DashboardId[];
  projects: DashProject[];
  months: DashMonth[];
  materialItems: DashMaterialItem[];
  needs: DashNeed[];
}
