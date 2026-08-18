import type { InventoryItem, ProjectWorkBoqItem, RequestItem, Warehouse } from '../types';
import { loadXlsx } from './loadXlsx';
import {
    importNumber,
    importText,
    normalizeLookupText,
    rowHasAnyValue,
} from './projectMaterialTabUtils';

export interface MaterialRequestImportRow {
    rowNumber: number;
    requestCode: string;
    materialCode: string;
    materialName: string;
    specification: string;
    unit: string;
    requestQty: number;
    neededDate?: string;
    wbsCode?: string;
    siteWarehouseName?: string;
    note?: string;

    // Resolved references
    matchedInventoryItem?: InventoryItem;
    matchedWorkBoqItem?: ProjectWorkBoqItem;
    matchedSiteWarehouseId?: string;

    // Validation status & messages
    status: 'valid' | 'warning' | 'error';
    errors: string[];
    warnings: string[];

    // BOQ Overrun info
    boqRemainingQty?: number;
    isOverBoq?: boolean;
    overQty?: number;
}

export interface MaterialRequestImportGroup {
    requestCode: string;
    requestTitle: string;
    rows: MaterialRequestImportRow[];
    validRowsCount: number;
    errorRowsCount: number;
    warningRowsCount: number;
}

export interface MaterialRequestImportFields {
    requestCode?: string;
    materialCode?: string;
    materialName?: string;
    specification?: string;
    unit?: string;
    requestQty?: string;
    neededDate?: string;
    wbsCode?: string;
    siteWarehouseName?: string;
    note?: string;
}

export type MaterialRequestColumnMapping = Record<keyof MaterialRequestImportFields, string>;

export interface SystemFieldDefinition {
    key: keyof MaterialRequestImportFields;
    label: string;
    required?: boolean;
    description: string;
    synonyms: string[];
}

export interface RawExcelFileStructure {
    fileName: string;
    sheetName: string;
    availableHeaders: string[];
    sampleRow: Record<string, string>;
    headerRowIndex: number;
    autoMapping: MaterialRequestColumnMapping;
    isAutoMapped: boolean;
}

export interface MaterialRequestImportPreview {
    fileName: string;
    totalRows: number;
    validRowsCount: number;
    errorRowsCount: number;
    warningRowsCount: number;
    groups: MaterialRequestImportGroup[];
    rows: MaterialRequestImportRow[];
    fileStructure: RawExcelFileStructure;
    activeMapping: MaterialRequestColumnMapping;
}

export const SYSTEM_IMPORT_FIELDS: SystemFieldDefinition[] = [
    {
        key: 'materialName',
        label: 'Tên vật tư',
        required: true,
        description: 'Tên vật liệu, sản phẩm hoặc mô tả vật tư đề xuất',
        synonyms: ['tên trên đề xuất', 'tên theo chứng từ', 'tên vật tư', 'tên vật liệu', 'tên hàng', 'tên hàng hóa', 'tên sp', 'diễn giải', 'nội dung', 'vật tư', 'material', 'item name', 'description', 'vật liệu thi công', 'hạng mục hàng hóa', 'vật tư thiết bị', 'tên vật tư thiết bị'],
    },
    {
        key: 'specification',
        label: 'Quy cách/mô tả',
        required: false,
        description: 'Quy cách hoặc mô tả kỹ thuật riêng của dòng đề xuất',
        synonyms: ['quy cách/mô tả', 'quy cách', 'thông số', 'mô tả kỹ thuật', 'specification', 'spec'],
    },
    {
        key: 'requestQty',
        label: 'Số lượng đề xuất',
        required: true,
        description: 'Số lượng / Khối lượng vật tư cần đề xuất (> 0)',
        synonyms: ['số lượng', 'sl', 'sl đề xuất', 'sl cần', 'khối lượng', 'kl', 'qty', 'quantity', 'sl yêu cầu', 'khối lượng đề xuất', 'slyc', 'số lượng yc', 'khối lượng yc', 'sl xin cấp'],
    },
    {
        key: 'unit',
        label: 'Đơn vị tính (ĐVT)',
        required: false,
        description: 'Đơn vị tính (Bao, Tấn, m3, Kg, Cây, Bộ...)',
        synonyms: ['đvt', 'đơn vị', 'đơn vị tính', 'dvt', 'unit', 'quy cách đvt'],
    },
    {
        key: 'materialCode',
        label: 'Mã vật tư / SKU',
        required: false,
        description: 'Mã vật tư SKU trong danh mục kho hoặc kế toán',
        synonyms: ['mã vt', 'mã vật tư', 'sku', 'mã hàng', 'mã sản phẩm', 'mã sp', 'part no', 'code', 'item code', 'mã hiệu', 'mã/sku', 'mã vật tư/sku'],
    },
    {
        key: 'wbsCode',
        label: 'Mã Hạng mục (WBS BOQ)',
        required: false,
        description: 'Mã WBS công việc thuộc BOQ dự án (để trống nếu ngoài BOQ)',
        synonyms: ['wbs', 'mã wbs', 'hạng mục', 'mã hạng mục', 'đầu mục', 'boq', 'công việc', 'wbs code', 'mã công việc', 'hạng mục boq'],
    },
    {
        key: 'neededDate',
        label: 'Ngày cần hàng',
        required: false,
        description: 'Hạn cần vật tư về công trường (Định dạng DD/MM/YYYY)',
        synonyms: ['ngày cần', 'ngày cần hàng', 'hạn giao', 'thời gian cần', 'thời hạn', 'date', 'needed date', 'ngày giao', 'ngày giao hàng'],
    },
    {
        key: 'siteWarehouseName',
        label: 'Kho công trường nhận',
        required: false,
        description: 'Tên kho công trường nhận hàng (để trống sẽ dùng kho chọn mặc định)',
        synonyms: ['kho', 'kho nhận', 'kho công trường', 'kho nhận hàng', 'địa điểm', 'warehouse', 'site warehouse', 'nơi nhận'],
    },
    {
        key: 'requestCode',
        label: 'Mã / Tên Phiếu đề xuất',
        required: false,
        description: 'Tên hoặc số phiếu để gom nhiều vật tư vào chung 1 phiếu',
        synonyms: ['mã phiếu', 'tên phiếu', 'số phiếu', 'nhóm phiếu', 'tên đề xuất', 'đề xuất', 'stt phiếu', 'mr', 'request code', 'phiếu đề xuất', 'phiếu', 'mã/tên phiếu đề xuất'],
    },
    {
        key: 'note',
        label: 'Ghi chú vật tư',
        required: false,
        description: 'Ghi chú thêm quy cách, vị trí sử dụng, mục đích...',
        synonyms: ['ghi chú', 'lý do', 'nội dung đề xuất', 'diễn giải thêm', 'note', 'remark', 'ghi chú thêm', 'ghi chú vật tư'],
    },
];

/**
 * Helper to parse various Excel date formats (Date object, string, or Excel serial number)
 */
export const parseExcelDate = (value: unknown): { dateString?: string; error?: string } => {
    if (value === null || value === undefined || String(value).trim() === '') {
        return {};
    }

    // JS Date object
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return { dateString: value.toISOString().split('T')[0] };
    }

    // Number (Excel serial date)
    if (typeof value === 'number' && Number.isFinite(value) && value > 25000 && value < 60000) {
        const utcDays = Math.floor(value - 25569);
        const utcValue = utcDays * 86400;
        const dateObj = new Date(utcValue * 1000);
        if (!Number.isNaN(dateObj.getTime())) {
            return { dateString: dateObj.toISOString().split('T')[0] };
        }
    }

    const str = String(value).trim();

    // Match DD/MM/YYYY or D/M/YYYY
    const dmyMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);
        const dateObj = new Date(year, month - 1, day);
        if (
            dateObj.getFullYear() === year &&
            dateObj.getMonth() === month - 1 &&
            dateObj.getDate() === day
        ) {
            const formattedMonth = String(month).padStart(2, '0');
            const formattedDay = String(day).padStart(2, '0');
            return { dateString: `${year}-${formattedMonth}-${formattedDay}` };
        }
        return { error: `Ngày '${str}' không tồn tại trong lịch (ví dụ: 31/02)` };
    }

    // Match YYYY-MM-DD
    const ymdMatch = str.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const month = parseInt(ymdMatch[2], 10);
        const day = parseInt(ymdMatch[3], 10);
        const dateObj = new Date(year, month - 1, day);
        if (
            dateObj.getFullYear() === year &&
            dateObj.getMonth() === month - 1 &&
            dateObj.getDate() === day
        ) {
            const formattedMonth = String(month).padStart(2, '0');
            const formattedDay = String(day).padStart(2, '0');
            return { dateString: `${year}-${formattedMonth}-${formattedDay}` };
        }
        return { error: `Ngày '${str}' không hợp lệ` };
    }

    return { error: `Định dạng ngày '${str}' không hợp lệ (Cần dạng DD/MM/YYYY)` };
};

/**
 * Generate and download Excel Template for Material Request import
 */
export const generateMaterialRequestTemplate = async () => {
    const XLSX = await loadXlsx();
    const headers = [
        'Mã/Tên Phiếu đề xuất',
        'Mã vật tư/SKU',
        'Tên trên đề xuất',
        'Quy cách/mô tả',
        'Đơn vị tính',
        'Số lượng đề xuất',
        'Ngày cần hàng',
        'Mã Hạng mục (WBS)',
        'Kho nhận hàng',
        'Ghi chú',
    ];

    const sampleRows = [
        [
            'DX-VT-001',
            'VT-XI-MANG-01',
            'Xi măng Hà Tiên PCB40',
            'PCB40, bao 50kg',
            'Bao',
            100,
            '15/08/2026',
            '1.1',
            'Kho Công trường A',
            'Giao đợt 1 cho móng Tầng 1',
        ],
        [
            'DX-VT-001',
            'VT-THEP-CB300-10',
            'Thép phi 10 CB300-V',
            'D10, CB300-V',
            'Kg',
            500,
            '15/08/2026',
            '1.2',
            'Kho Công trường A',
            'Giao cùng đợt Xi măng',
        ],
        [
            'DX-VT-002',
            'VT-GIAO-GIAO-01',
            'Giàn giáo khung H 1.7m',
            'Khung H 1.7m',
            'Bộ',
            50,
            '20/08/2026',
            '2.1',
            'Kho Công trường B',
            'Thuê thêm 50 bộ',
        ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
    ws['!cols'] = [
        { wch: 22 },
        { wch: 18 },
        { wch: 30 },
        { wch: 28 },
        { wch: 12 },
        { wch: 18 },
        { wch: 15 },
        { wch: 18 },
        { wch: 22 },
        { wch: 35 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'De_Xuat_Vat_Tu');
    XLSX.writeFile(wb, 'Mau_De_Xuat_Vat_Tu.xlsx');
};

/**
 * Auto-detect system field column mapping for arbitrary Excel headers
 */
export const autoDetectColumnMapping = (availableHeaders: string[]): { mapping: MaterialRequestColumnMapping; isAutoMapped: boolean } => {
    const mapping: MaterialRequestColumnMapping = {
        requestCode: '',
        materialCode: '',
        materialName: '',
        specification: '',
        unit: '',
        requestQty: '',
        neededDate: '',
        wbsCode: '',
        siteWarehouseName: '',
        note: '',
    };

    const usedHeaders = new Set<string>();

    SYSTEM_IMPORT_FIELDS.forEach(field => {
        for (const synonym of field.synonyms) {
            const normSyn = normalizeLookupText(synonym);
            const matchedHeader = availableHeaders.find(h => {
                if (usedHeaders.has(h)) return false;
                const normH = normalizeLookupText(h);
                return normH === normSyn || normH.includes(normSyn) || normSyn.includes(normH);
            });

            if (matchedHeader) {
                mapping[field.key] = matchedHeader;
                usedHeaders.add(matchedHeader);
                break;
            }
        }
    });

    const isNameMapped = Boolean(mapping.materialName || mapping.materialCode);
    const isQtyMapped = Boolean(mapping.requestQty);

    return {
        mapping,
        isAutoMapped: isNameMapped && isQtyMapped,
    };
};

/**
 * Check if a row is a summary or footer row (e.g. "Tổng cộng", "Cộng:", "Người lập bảng"...)
 */
export const isSummaryOrFooterRow = (row: Record<string, unknown>): boolean => {
    const valuesStr = Object.values(row)
        .map(v => normalizeLookupText(String(v ?? '')))
        .join(' ');

    const summaryKeywords = ['tong cong', 'cong', 'total', 'nguoi lap', 'nguoi tao', 'thu kho', 'chi huy truong', 'ky ten'];
    return summaryKeywords.some(kw => valuesStr.startsWith(kw) || valuesStr.includes(kw));
};

/**
 * Parse an uploaded Excel file (arbitrary or template) with smart auto-detection & column mapping
 */
export const parseMaterialRequestExcel = async (
    fileBuffer: ArrayBuffer,
    fileName: string,
    inventoryItems: InventoryItem[],
    workBoqItems: ProjectWorkBoqItem[],
    warehouses: Warehouse[] = [],
    customMapping?: MaterialRequestColumnMapping
): Promise<MaterialRequestImportPreview> => {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames[0];

    if (!sheetName) {
        throw new Error('File Excel không có dữ liệu hoặc không có sheet nào.');
    }

    const ws = wb.Sheets[sheetName];
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

    if (!rawMatrix || rawMatrix.length === 0) {
        throw new Error('Sheet Excel rỗng, không chứa dữ liệu.');
    }

    // Smart Header Finder: Find row with most non-empty string cells in first 15 rows
    let headerRowIdx = 0;
    let maxHeaderHits = 0;

    for (let r = 0; r < Math.min(rawMatrix.length, 15); r++) {
        const rowArr = rawMatrix[r] || [];
        const hits = rowArr.filter(cell => String(cell ?? '').trim().length > 0).length;
        if (hits > maxHeaderHits) {
            maxHeaderHits = hits;
            headerRowIdx = r;
        }
    }

    const headerCells = (rawMatrix[headerRowIdx] || []).map((c, i) => String(c ?? '').trim() || `Cột ${i + 1}`);
    const availableHeaders = Array.from(new Set(headerCells));

    const { mapping: autoMapping, isAutoMapped } = autoDetectColumnMapping(availableHeaders);
    const activeMapping = customMapping || autoMapping;

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        range: headerRowIdx,
        defval: '',
    });

    const sampleRowObj: Record<string, string> = {};
    if (rawRows.length > 0) {
        Object.entries(rawRows[0] || {}).forEach(([k, v]) => {
            sampleRowObj[k] = String(v ?? '').trim();
        });
    }

    const fileStructure: RawExcelFileStructure = {
        fileName,
        sheetName,
        availableHeaders,
        sampleRow: sampleRowObj,
        headerRowIndex: headerRowIdx,
        autoMapping,
        isAutoMapped,
    };

    const inventoryByCodeMap = new Map<string, InventoryItem>();
    const inventoryByNameMap = new Map<string, InventoryItem>();
    inventoryItems.forEach(item => {
        if (item.sku) inventoryByCodeMap.set(normalizeLookupText(item.sku), item);
        if (item.accountingCode) inventoryByCodeMap.set(normalizeLookupText(item.accountingCode), item);
        if (item.name) inventoryByNameMap.set(normalizeLookupText(item.name), item);
    });

    const workBoqByWbsMap = new Map<string, ProjectWorkBoqItem>();
    const workBoqByNameMap = new Map<string, ProjectWorkBoqItem>();
    workBoqItems.forEach(boq => {
        if (boq.wbsCode) workBoqByWbsMap.set(normalizeLookupText(boq.wbsCode), boq);
        if (boq.name) workBoqByNameMap.set(normalizeLookupText(boq.name), boq);
    });

    const warehouseByNameMap = new Map<string, Warehouse>();
    warehouses.forEach(wh => {
        if (wh.name) warehouseByNameMap.set(normalizeLookupText(wh.name), wh);
        if (wh.id) warehouseByNameMap.set(normalizeLookupText(wh.id), wh);
    });

    const parsedRows: MaterialRequestImportRow[] = [];

    rawRows.forEach((row, idx) => {
        if (!rowHasAnyValue(row) || isSummaryOrFooterRow(row)) return;

        const rowNumber = headerRowIdx + idx + 2;

        const getCellVal = (fieldKey: keyof MaterialRequestImportFields): unknown => {
            const colName = activeMapping[fieldKey];
            if (!colName) return '';
            return row[colName] ?? '';
        };

        const requestCode = importText({ val: getCellVal('requestCode') }, ['val']);
        const materialCode = importText({ val: getCellVal('materialCode') }, ['val']);
        let materialName = importText({ val: getCellVal('materialName') }, ['val']);
        const specification = importText({ val: getCellVal('specification') }, ['val']);
        let unit = importText({ val: getCellVal('unit') }, ['val']);
        const rawQty = getCellVal('requestQty');
        const requestQty = importNumber(rawQty);
        const rawNeededDate = getCellVal('neededDate');
        const wbsCode = importText({ val: getCellVal('wbsCode') }, ['val']);
        const siteWarehouseName = importText({ val: getCellVal('siteWarehouseName') }, ['val']);
        const note = importText({ val: getCellVal('note') }, ['val']);

        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Validate Material Name & Code
        let matchedInventoryItem: InventoryItem | undefined;
        if (materialCode) {
            matchedInventoryItem = inventoryByCodeMap.get(normalizeLookupText(materialCode));
        }

        if (!matchedInventoryItem && !materialCode && materialName) {
            matchedInventoryItem = inventoryByNameMap.get(normalizeLookupText(materialName));
        }

        if (matchedInventoryItem) {
            if (
                unit
                && matchedInventoryItem.unit
                && normalizeLookupText(unit) !== normalizeLookupText(matchedInventoryItem.unit)
            ) {
                warnings.push(`ĐVT Excel '${unit}' khác ĐVT tồn kho '${matchedInventoryItem.unit}'; MR sẽ dùng ĐVT tồn kho.`);
            }
            if (!materialName && matchedInventoryItem.name) {
                materialName = matchedInventoryItem.name;
            }
            if (!unit && matchedInventoryItem.unit) {
                unit = matchedInventoryItem.unit;
            }
        } else {
            if (materialCode) {
                errors.push(`Mã vật tư '${materialCode}' không tồn tại trong danh mục kho hệ thống`);
            } else if (!materialName) {
                errors.push('Tên vật tư hoặc Mã vật tư không được để trống');
            } else {
                warnings.push('Vật tư chưa có trong danh mục kho (sẽ tạo vật tư tạm)');
            }
        }

        // 2. Validate Quantity
        if (String(rawQty).trim() === '') {
            errors.push('Số lượng đề xuất không được để trống');
        } else if (!Number.isFinite(requestQty) || requestQty <= 0) {
            errors.push(`Số lượng '${rawQty}' phải là số lớn hơn 0`);
        }

        // 3. Validate Needed Date
        let neededDate: string | undefined;
        if (rawNeededDate) {
            const { dateString, error } = parseExcelDate(rawNeededDate);
            if (error) {
                errors.push(error);
            } else {
                neededDate = dateString;
            }
        }

        // 4. Validate WBS / BOQ item
        let matchedWorkBoqItem: ProjectWorkBoqItem | undefined;
        let boqRemainingQty: number | undefined;
        let isOverBoq = false;
        let overQty: number | undefined;

        if (wbsCode) {
            matchedWorkBoqItem = workBoqByWbsMap.get(normalizeLookupText(wbsCode)) || workBoqByNameMap.get(normalizeLookupText(wbsCode));
            if (!matchedWorkBoqItem) {
                errors.push(`Mã WBS '${wbsCode}' không khớp với bất kỳ đầu mục BOQ nào trong dự án`);
            } else {
                if (typeof matchedWorkBoqItem.plannedQty === 'number') {
                    const boqLimit = matchedWorkBoqItem.plannedQty;
                    boqRemainingQty = Math.max(0, boqLimit);
                    if (requestQty > boqRemainingQty) {
                        isOverBoq = true;
                        overQty = requestQty - boqRemainingQty;
                        warnings.push(`Số lượng đề xuất vượt định mức BOQ kế hoạch (${boqRemainingQty.toLocaleString('vi-VN')} ${unit || ''})`);
                    }
                }
            }
        }

        // 5. Validate Site Warehouse
        let matchedSiteWarehouseId: string | undefined;
        if (siteWarehouseName) {
            const matchedWh = warehouseByNameMap.get(normalizeLookupText(siteWarehouseName));
            if (matchedWh) {
                matchedSiteWarehouseId = matchedWh.id;
            } else if (warehouses.length > 0) {
                warnings.push(`Không tìm thấy kho '${siteWarehouseName}', hệ thống sẽ dùng kho mặc định`);
            }
        }

        const status: 'valid' | 'warning' | 'error' = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

        parsedRows.push({
            rowNumber,
            requestCode: requestCode || 'Phiếu đề xuất mới',
            materialCode,
            materialName,
            specification,
            unit,
            requestQty,
            neededDate,
            wbsCode,
            siteWarehouseName,
            note,
            matchedInventoryItem,
            matchedWorkBoqItem,
            matchedSiteWarehouseId,
            status,
            errors,
            warnings,
            boqRemainingQty,
            isOverBoq,
            overQty,
        });
    });

    // Group rows by requestCode
    const groupMap = new Map<string, MaterialRequestImportRow[]>();
    parsedRows.forEach(row => {
        const key = row.requestCode || 'Phiếu đề xuất mới';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(row);
    });

    const groups: MaterialRequestImportGroup[] = Array.from(groupMap.entries()).map(([requestCode, rows]) => {
        const validRowsCount = rows.filter(r => r.status === 'valid').length;
        const warningRowsCount = rows.filter(r => r.status === 'warning').length;
        const errorRowsCount = rows.filter(r => r.status === 'error').length;
        return {
            requestCode,
            requestTitle: requestCode === 'Phiếu đề xuất mới' ? 'Đề xuất vật tư nhập từ Excel' : `Đề xuất vật tư ${requestCode}`,
            rows,
            validRowsCount,
            warningRowsCount,
            errorRowsCount,
        };
    });

    const validRowsCount = parsedRows.filter(r => r.status === 'valid').length;
    const warningRowsCount = parsedRows.filter(r => r.status === 'warning').length;
    const errorRowsCount = parsedRows.filter(r => r.status === 'error').length;

    return {
        fileName,
        totalRows: parsedRows.length,
        validRowsCount,
        warningRowsCount,
        errorRowsCount,
        groups,
        rows: parsedRows,
        fileStructure,
        activeMapping,
    };
};

export const buildImportedMaterialRequestItem = (
    row: MaterialRequestImportRow,
    lineId: string,
): RequestItem => ({
    lineId,
    itemId: row.matchedInventoryItem?.id || row.materialCode || `custom-${lineId}`,
    requestQty: row.requestQty,
    approvedQty: row.requestQty,
    workBoqItemId: row.matchedWorkBoqItem?.id || null,
    workBoqItemName: row.matchedWorkBoqItem?.name || null,
    neededDate: row.neededDate,
    note: row.note,
    isOverBoq: row.isOverBoq,
    overQty: row.overQty,
    isManualItem: !row.matchedInventoryItem,
    skuSnapshot: row.matchedInventoryItem?.sku || row.materialCode || undefined,
    itemNameSnapshot: row.materialName || row.matchedInventoryItem?.name || undefined,
    unitSnapshot: row.matchedInventoryItem?.unit || row.unit || undefined,
    specification: row.specification || undefined,
});
