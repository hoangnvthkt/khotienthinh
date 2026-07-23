import {
  BusinessPartner,
  ContractCostItem,
  ProjectCostCategory,
  ProjectTransaction,
  ProjectTxSource,
  ProjectTxType,
} from '../types';
import {
  clearContractCostItemSnapshot,
  getContractCostItemSnapshot,
  inferProjectCostCategoryFromCostItem,
  resolveContractCostItem,
} from './contractCostItemOptions';

export const PROJECT_TRANSACTION_IMPORT_HEADERS = [
  'Loại giao dịch',
  'Mã khoản mục',
  'Số tiền',
  'Nội dung',
  'Ngày',
  'Mã đối tác',
  'Đối tác',
  'Số hóa đơn/chứng từ',
  'Ngày hóa đơn/chứng từ',
  'Mã tham chiếu',
] as const;

export const PROJECT_TRANSACTION_IMPORT_SAMPLE_ROWS = [
  {
    'Loại giao dịch': 'Chi phí',
    'Mã khoản mục': 'CPNC',
    'Số tiền': 12500000,
    'Nội dung': 'Thanh toán nhân công',
    'Ngày': '10/07/2026',
    'Mã đối tác': 'DOI-NC',
    'Đối tác': 'Đội nhân công B',
    'Số hóa đơn/chứng từ': 'PC-001',
    'Ngày hóa đơn/chứng từ': '10/07/2026',
    'Mã tham chiếu': 'PC-001',
  },
  {
    'Loại giao dịch': 'Thu',
    'Mã khoản mục': '',
    'Số tiền': 50000000,
    'Nội dung': 'Thu tiền chủ đầu tư',
    'Ngày': '10/07/2026',
    'Mã đối tác': '',
    'Đối tác': '',
    'Số hóa đơn/chứng từ': '',
    'Ngày hóa đơn/chứng từ': '',
    'Mã tham chiếu': 'PT-001',
  },
] as const;

interface BuildImportInput {
  projectId?: string | null;
  projectFinanceId: string;
  constructionSiteId: string;
  costItems: ContractCostItem[];
  partners: BusinessPartner[];
  createdBy?: string | null;
  now?: string;
  idFactory?: () => string;
}

export interface ProjectTransactionImportResult {
  transactions: ProjectTransaction[];
  skippedMissingCostItem: number;
  skippedInvalidAmount: number;
  modeMessage: string;
}

const lookup = (value: unknown) => String(value || '').trim();
const normalizeLookup = (value: unknown) => lookup(value).toLowerCase();

export const resolveProjectTransactionPartner = (
  partners: BusinessPartner[],
  value: unknown,
): BusinessPartner | null => {
  const normalized = normalizeLookup(value);
  if (!normalized) return null;
  return partners.find(partner =>
    normalizeLookup(partner.id) === normalized
    || normalizeLookup(partner.code) === normalized
    || normalizeLookup(partner.name) === normalized) || null;
};

const findCol = (row: Record<string, unknown>, patterns: string[]) => {
  const keys = Object.keys(row);
  const normalizedPatterns = patterns.map(normalizeLookup);
  for (const pattern of normalizedPatterns) {
    const exact = keys.find(key => normalizeLookup(key) === pattern);
    if (exact) return row[exact];
  }
  for (const pattern of normalizedPatterns) {
    const partial = keys.find(key => {
      const normalizedKey = normalizeLookup(key);
      return normalizedKey.includes(pattern) || pattern.includes(normalizedKey);
    });
    if (partial) return row[partial];
  }
  return undefined;
};

const parseDate = (value: unknown): string => {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'number') return new Date((value - 25569) * 86400 * 1000).toISOString().slice(0, 10);
  const raw = lookup(value);
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return raw || new Date().toISOString().slice(0, 10);
};

const parseAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number(cleaned) || 0;
};

const typeMap: Record<string, ProjectTxType> = {
  'chi phí': 'expense',
  'chi phi': 'expense',
  expense: 'expense',
  chi: 'expense',
  thu: 'revenue_received',
  'doanh thu': 'revenue_received',
  revenue: 'revenue_received',
  'chờ thu': 'revenue_pending',
  'cho thu': 'revenue_pending',
  pending: 'revenue_pending',
};

const totalKeywords = ['tổng số', 'tong so', 'tổng cộng', 'tong cong', 'tổng số tiền', 'tong so tien', 'total', 'tổng', 'tong', 'cộng', 'cong', 'sum', 'grand total', 'subtotal'];

const isTotalRow = (row: Record<string, unknown>) =>
  Object.values(row).some(value => {
    if (typeof value !== 'string') return false;
    const lower = normalizeLookup(value);
    return totalKeywords.some(keyword =>
      lower === keyword
      || lower.startsWith(`${keyword} `)
      || lower.startsWith(`${keyword}:`)
      || lower.startsWith(`${keyword}(`)
      || lower.endsWith(` ${keyword}`)
      || lower.includes('tổng')
      || lower.includes('total'));
  });

import { loadXlsx } from './loadXlsx';

export interface ProjectTransactionImportPreviewItem {
  rowNumber: number;
  selected: boolean;
  isTotal: boolean;
  status: 'valid' | 'warning_missing_cost_item' | 'invalid_amount';
  warningMessage?: string;
  rawCostItemInput: string;
  rawPartnerInput: string;
  tx: ProjectTransaction;
}

export interface ProjectTransactionImportPreviewResult {
  items: ProjectTransactionImportPreviewItem[];
  totalRows: number;
  totalExpenseCount: number;
  totalRevenueCount: number;
  totalExpenseAmount: number;
  totalRevenueAmount: number;
  warningCount: number;
}

export const downloadProjectTransactionImportTemplate = async () => {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.json_to_sheet([...PROJECT_TRANSACTION_IMPORT_SAMPLE_ROWS]);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 32 },
    { wch: 14 },
    { wch: 16 },
    { wch: 24 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau_Giao_Dich');
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Mau_Nhap_So_Giao_Dich_Tai_Chinh.xlsx';
  link.click();
  URL.revokeObjectURL(url);
};

export const parseProjectTransactionImportPreviewRows = (
  rows: Record<string, unknown>[],
  input: BuildImportInput,
): ProjectTransactionImportPreviewResult => {
  const now = input.now || new Date().toISOString();
  const idFactory = input.idFactory || (() => crypto.randomUUID());

  const items: ProjectTransactionImportPreviewItem[] = rows.map((row, index) => {
    const rawType = normalizeLookup(findCol(row, ['loại giao dịch', 'loai giao dich', 'loại', 'loai', 'type']));
    const type = typeMap[rawType] || 'expense';
    const amount = parseAmount(findCol(row, ['số tiền', 'so tien', 'amount', 'thành tiền', 'thanh tien', 'giá trị', 'gia tri', 'value']));
    const rawCostItem = lookup(findCol(row, ['mã khoản mục', 'ma khoan muc', 'khoản mục chi phí', 'khoan muc chi phi', 'cost_item', 'cost item', 'cost_item_symbol', 'cost item symbol', 'mã chi phí', 'ma chi phi']));
    const costItem = type === 'expense' ? resolveContractCostItem(input.costItems, rawCostItem) : null;
    const rawPartnerCode = lookup(findCol(row, ['mã đối tác', 'ma doi tac', 'mã đối tượng', 'ma doi tuong', 'partner code', 'partner_code', 'mã ncc', 'ma ncc']));
    const rawPartnerName = lookup(findCol(row, ['đối tác', 'doi tac', 'đối tượng', 'doi tuong', 'counterparty', 'nhà cung cấp', 'nha cung cap', 'ncc', 'khách hàng', 'khach hang']));
    const partner = resolveProjectTransactionPartner(input.partners, rawPartnerCode) || resolveProjectTransactionPartner(input.partners, rawPartnerName);
    const fallbackCounterpartyName = rawPartnerName || rawPartnerCode || null;
    const category: ProjectCostCategory = costItem ? inferProjectCostCategoryFromCostItem(costItem) : 'other';
    const rawInvoiceDate = findCol(row, ['ngày hóa đơn/chứng từ', 'ngay hoa don/chung tu', 'ngày hóa đơn', 'ngay hoa don', 'ngày chứng từ', 'ngay chung tu', 'invoice_date', 'invoice date', 'document_date', 'document date']);

    const isTotal = isTotalRow(row);
    const missingCostItem = type === 'expense' && !costItem;
    const invalidAmount = amount <= 0;

    let status: ProjectTransactionImportPreviewItem['status'] = 'valid';
    let warningMessage: string | undefined;

    if (invalidAmount) {
      status = 'invalid_amount';
      warningMessage = 'Số tiền <= 0';
    } else if (missingCostItem) {
      status = 'warning_missing_cost_item';
      warningMessage = rawCostItem ? `Không tìm thấy khoản mục "${rawCostItem}"` : 'Chưa nhập khoản mục chi phí';
    }

    return {
      rowNumber: index + 1,
      selected: !invalidAmount,
      isTotal,
      status,
      warningMessage,
      rawCostItemInput: rawCostItem,
      rawPartnerInput: rawPartnerName || rawPartnerCode,
      tx: {
        id: idFactory(),
        projectId: input.projectId || null,
        projectFinanceId: input.projectFinanceId,
        constructionSiteId: input.constructionSiteId,
        type,
        category,
        amount,
        description: lookup(findCol(row, ['nội dung', 'noi dung', 'mô tả', 'mo ta', 'description', 'diễn giải', 'dien giai', 'ghi chú', 'ghi chu', 'note'])),
        date: parseDate(findCol(row, ['ngày', 'ngay', 'date', 'ngày giao dịch', 'ngay giao dich'])),
        source: 'import' as ProjectTxSource,
        sourceRef: lookup(findCol(row, ['mã tham chiếu', 'ma tham chieu', 'source_ref', 'source ref', 'tham chiếu', 'tham chieu'])) || undefined,
        ...(costItem ? getContractCostItemSnapshot(costItem) : clearContractCostItemSnapshot()),
        counterpartyPartnerId: partner?.id || null,
        counterpartyName: partner?.name || fallbackCounterpartyName,
        invoiceNo: lookup(findCol(row, ['số hóa đơn/chứng từ', 'so hoa don/chung tu', 'số hóa đơn', 'so hoa don', 'số chứng từ', 'so chung tu', 'invoice_no', 'invoice no', 'document_no', 'document no', 'chứng từ', 'chung tu'])) || null,
        invoiceDate: rawInvoiceDate ? parseDate(rawInvoiceDate) : null,
        attachments: [],
        createdBy: input.createdBy || undefined,
        createdAt: now,
      } as ProjectTransaction,
    };
  });

  const validItems = items.filter(item => item.tx.amount > 0);
  const totalExpenseCount = validItems.filter(item => item.tx.type === 'expense').length;
  const totalRevenueCount = validItems.filter(item => item.tx.type !== 'expense').length;
  const totalExpenseAmount = validItems.filter(item => item.tx.type === 'expense').reduce((sum, item) => sum + Number(item.tx.amount || 0), 0);
  const totalRevenueAmount = validItems.filter(item => item.tx.type !== 'expense').reduce((sum, item) => sum + Number(item.tx.amount || 0), 0);
  const warningCount = validItems.filter(item => item.status === 'warning_missing_cost_item').length;

  return {
    items,
    totalRows: rows.length,
    totalExpenseCount,
    totalRevenueCount,
    totalExpenseAmount,
    totalRevenueAmount,
    warningCount,
  };
};

export const buildProjectTransactionsFromImportRows = (
  rows: Record<string, unknown>[],
  input: BuildImportInput,
): ProjectTransactionImportResult => {
  const preview = parseProjectTransactionImportPreviewRows(rows, input);
  const candidateItems = preview.items.filter(item => item.tx.amount > 0);
  const totalRows = candidateItems.filter(item => item.isTotal);
  const detailRows = candidateItems.filter(item => !item.isTotal);
  const activeItems = totalRows.length > 0 ? totalRows : detailRows;

  const validItems = activeItems.filter(item => item.tx.type === 'expense' && !item.tx.contractCostItemId ? false : true);
  const skippedMissingCostItem = activeItems.length - validItems.length;
  const skippedInvalidAmount = preview.totalRows - candidateItems.length;

  if (totalRows.length > 0) {
    const amount = validItems.reduce((sum, item) => sum + Number(item.tx.amount || 0), 0);
    const description = validItems.map(item => item.tx.description).filter(Boolean).join('; ') || 'Tổng import từ Excel';
    return {
      transactions: validItems.length > 0 ? [{ ...validItems[0].tx, amount, description }] : [],
      skippedMissingCostItem,
      skippedInvalidAmount,
      modeMessage: totalRows.length === 1
        ? `Tìm thấy 1 dòng tổng -> import dòng tổng (bỏ ${detailRows.length} dòng chi tiết)`
        : `Tìm thấy ${totalRows.length} dòng tổng -> cộng lại = ${amount.toLocaleString('vi-VN')}đ (bỏ ${detailRows.length} dòng chi tiết)`,
    };
  }

  return {
    transactions: validItems.map(item => item.tx),
    skippedMissingCostItem,
    skippedInvalidAmount,
    modeMessage: `Không có dòng tổng -> import ${validItems.length} dòng chi tiết`,
  };
};
