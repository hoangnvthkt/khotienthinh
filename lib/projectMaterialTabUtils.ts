import type { MaterialBudgetItem, ProjectWorkBoqItem, RequestStatus } from '../types';
import { PROJECT_MATERIAL_TAB_PERMISSIONS, type ProjectMaterialTabKey } from './projectTabPermissions';
import type { WorkBoqSyncPreview } from './projectService';

export const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' tr';
    return n.toLocaleString('vi-VN');
};

export type WorkBoqImportPreview = {
    workRows: Array<{ rowNumber: number; item: ProjectWorkBoqItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
    materialRows: Array<{ rowNumber: number; item: MaterialBudgetItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
};

export const WORK_BOQ_SHEET_NAME = 'Dau_muc';
export const MATERIAL_BOQ_SHEET_NAME = 'Vat_tu';
export const WORK_BOQ_HEADERS = ['Mã WBS', 'Mã cha', 'Tên đầu mục', 'ĐVT', 'KL dự toán', 'Đơn giá', 'Ghi chú'];
export const MATERIAL_BOQ_HEADERS = ['WBS đầu mục', 'Mã vật tư/SKU', 'Tên vật tư', 'Nhóm', 'ĐVT', 'KL dự toán', 'Ngưỡng hao hụt', 'Đơn giá', 'Ghi chú'];
export const MATERIAL_BUDGET_QTY_PRECISION = 6;
export const PROJECT_REQUEST_DATA_TABS = new Set<ProjectMaterialTabKey>(['summary', 'boq', 'request', 'waste', 'dashboard']);
export const PROJECT_REQUEST_FULFILLMENT_TABS = new Set<ProjectMaterialTabKey>(['summary', 'boq', 'request', 'waste', 'dashboard']);

export const getValidMaterialTab = (value?: string | null): ProjectMaterialTabKey | null =>
    PROJECT_MATERIAL_TAB_PERMISSIONS.some(tab => tab.key === value)
        ? value as ProjectMaterialTabKey
        : null;

export const calculateMaterialBudgetQty = (workPlannedQty: number, wasteThreshold: number) => {
    const value = Number(workPlannedQty) * Number(wasteThreshold);
    if (!Number.isFinite(value) || value < 0) return 0;
    const multiplier = 10 ** MATERIAL_BUDGET_QTY_PRECISION;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

export const formatQuantity = (value: number) =>
    Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: MATERIAL_BUDGET_QTY_PRECISION });

export const formatPercent = (value: number) =>
    Number(value || 0).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const parseVietnameseNumber = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '')
        .trim()
        .replace(/[\s\u00a0]/g, '')
        .replace(/[^\d,.-]/g, '');
    if (!raw) return 0;
    const sign = raw.startsWith('-') ? '-' : '';
    const unsigned = raw.replace(/-/g, '');
    const normalized = unsigned.includes(',')
        ? unsigned.replace(/\./g, '').replace(',', '.')
        : unsigned.replace(/\./g, '');
    const n = Number(`${sign}${normalized}`);
    return Number.isFinite(n) ? n : 0;
};

export const formatVietnameseNumber = (value: unknown, maximumFractionDigits = MATERIAL_BUDGET_QTY_PRECISION) =>
    parseVietnameseNumber(value).toLocaleString('vi-VN', { maximumFractionDigits });

export const parseVietnameseMoney = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '')
        .trim()
        .replace(/[\s\u00a0]/g, '')
        .replace(/[^\d,.-]/g, '');
    if (!raw) return 0;
    const sign = raw.startsWith('-') ? '-' : '';
    const unsigned = raw.replace(/-/g, '');
    if (!unsigned.includes('.') && /^\d{1,3}(,\d{3})+$/.test(unsigned)) {
        const n = Number(`${sign}${unsigned.replace(/,/g, '')}`);
        return Number.isFinite(n) ? n : 0;
    }
    return parseVietnameseNumber(raw);
};

export const formatVietnameseMoney = (value: unknown) =>
    parseVietnameseMoney(value).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const importNumber = (value: unknown) => {
    return parseVietnameseNumber(value);
};

export const normalizeKey = (value?: string | null) => String(value || '').trim().toLowerCase();
export const isValidWbsCode = (value: string) => /^\d+(\.\d+)*$/.test(value.trim());
export const rowHasAnyValue = (row: Record<string, unknown>) =>
    Object.values(row).some(value => String(value ?? '').trim() !== '');

export const pickImportValue = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
        const value = row[key];
        if (String(value ?? '').trim() !== '') return value;
    }
    return '';
};

export const importText = (row: Record<string, unknown>, keys: string[]) =>
    String(pickImportValue(row, keys) ?? '').trim();

export const normalizeLookupText = (value?: string | null) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

export const SITE_WAREHOUSE_STOP_WORDS = new Set(['kho', 'cong', 'truong', 'du', 'an', 'ct', 'tai', 'khu']);

export const summarizeSync = (preview: WorkBoqSyncPreview) =>
    `Thêm mới ${preview.created}, cập nhật ${preview.updated}, bỏ qua ${preview.skipped}, đánh dấu orphan ${preview.orphaned}.`;

export const BOQ_WRITE_PERMISSION_MESSAGE = 'Bạn không có quyền chỉnh sửa, vui lòng liên hệ admin.';
export const MATERIAL_REQUEST_BUDGET_HOLDING_STATUSES = new Set<RequestStatus | string>([
    'DRAFT',
    'PENDING',
    'APPROVED',
    'IN_TRANSIT',
    'LEGACY_PENDING',
    'LEGACY_APPROVED',
]);

export const formatBoqWriteError = (error: any, fallback = 'Vui lòng thử lại.') => {
    const errorText = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint,
    ].filter(Boolean).join(' ').toLowerCase();

    const isMaterialBudgetPermissionError = errorText.includes('material_budget_items')
        && (
            errorText.includes('row-level security')
            || errorText.includes('permission denied')
            || errorText.includes('42501')
        );

    return isMaterialBudgetPermissionError
        ? BOQ_WRITE_PERMISSION_MESSAGE
        : error?.message || fallback;
};
