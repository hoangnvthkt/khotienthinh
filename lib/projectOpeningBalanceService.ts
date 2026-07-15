import {
  InventoryItem,
  ProjectFinance,
  ProjectOpeningBalance,
  ProjectOpeningBalanceImportRow,
  ProjectOpeningBalanceLine,
  ProjectTransaction,
  Transaction,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { getExcelCell, parseExcelRows } from './excelImport';
import { loadXlsx } from './loadXlsx';
import { parseVietnameseMoney, parseVietnameseNumber } from './projectMaterialTabUtils';
import { getWeekStart, projectWeeklyProgressService } from './projectWeeklyProgressService';
import { isSupabaseConfigured, supabase } from './supabase';

const BALANCE_TABLE = 'project_opening_balances';
const LINE_TABLE = 'project_opening_balance_lines';

export interface ProjectOpeningBalanceImportTotals {
  purchasedValue: number;
  issuedValue: number;
  usedValue: number;
  remainingQty: number;
  remainingValue: number;
}

export interface ProjectOpeningBalanceImportResult {
  rows: ProjectOpeningBalanceImportRow[];
  totals: ProjectOpeningBalanceImportTotals;
  errors: string[];
  warnings: string[];
}

const numberOrZero = (value: unknown): number => {
  return parseVietnameseNumber(value);
};

const moneyOrZero = (value: unknown): number => {
  return parseVietnameseMoney(value);
};

const isThousandScale = (larger: number, smaller: number): boolean => {
  if (larger <= 0 || smaller <= 0) return false;
  const ratio = larger / smaller;
  return ratio >= 999 && ratio <= 1001;
};

const reconcileAccountingQtyPrice = (
  qty: number,
  unitPrice: number,
  amount: number,
): { qty: number; unitPrice: number } => {
  let nextQty = Math.max(0, Number(qty || 0));
  let nextUnitPrice = Math.max(0, Number(unitPrice || 0));
  const totalAmount = Math.max(0, Number(amount || 0));

  if (totalAmount > 0 && nextQty > 0 && nextUnitPrice > 0) {
    const impliedUnitPrice = totalAmount / nextQty;
    const impliedQty = totalAmount / nextUnitPrice;

    if (isThousandScale(impliedUnitPrice, nextUnitPrice)) {
      nextUnitPrice = impliedUnitPrice;
    } else if (isThousandScale(nextUnitPrice, impliedUnitPrice)) {
      nextQty = impliedQty;
    }
  }

  if (totalAmount > 0 && nextQty > 0 && nextUnitPrice <= 0) {
    nextUnitPrice = totalAmount / nextQty;
  }
  if (totalAmount > 0 && nextUnitPrice > 0 && nextQty <= 0) {
    nextQty = totalAmount / nextUnitPrice;
  }

  return { qty: nextQty, unitPrice: nextUnitPrice };
};

const clampPercent = (value: unknown): number => Math.min(100, Math.max(0, numberOrZero(value)));

const cleanUndefined = <T extends Record<string, unknown>>(input: T): T =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;

const canonicalDecimalString = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new Error('Dữ liệu đầu kỳ chứa giá trị số không hợp lệ.');
  }
  if (Object.is(value, -0)) return '0';

  const text = String(value);
  if (!/[eE]/.test(text)) return text;

  const [coefficient, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const sign = coefficient.startsWith('-') ? '-' : '';
  const unsigned = coefficient.replace(/^[+-]/, '');
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const digits = `${integerPart}${fractionPart}`;
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
};

const canonicalizeCommandNumbers = (value: unknown): any => {
  if (typeof value === 'number') return canonicalDecimalString(value);
  if (Array.isArray(value)) return value.map(canonicalizeCommandNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, canonicalizeCommandNumbers(nested)]),
    );
  }
  return value;
};

export const calculateOpeningRecognizedValue = (
  purchasedValue: number,
  issuedValue: number,
  usedValue?: number,
): number => {
  const used = Math.max(0, Number(usedValue || 0));
  const issued = Math.max(0, Number(issuedValue || 0));
  const purchased = Math.max(0, Number(purchasedValue || 0));
  return used > 0 ? used : issued > 0 ? issued : purchased;
};

const accountingExpenseValue = (balance: ProjectOpeningBalance): number =>
  calculateOpeningRecognizedValue(balance.purchasedValue, balance.issuedValue, balance.usedValue);

const normalizeLookupText = (value: unknown): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeSkuPart = (value: unknown): string =>
  String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'D')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'OPEN';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isGeneratedVariantSku = (sku: unknown, accountingCode: unknown): boolean => {
  const normalizedSku = normalizeSkuPart(sku);
  const base = normalizeSkuPart(accountingCode);
  return new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(normalizedSku);
};

const trimInferredItemName = (value: string): string =>
  value.replace(/[\s\-–—_*.,;:\/\\]+$/g, '').trim();

const inferCommonItemName = (names: string[]): string => {
  const cleanNames = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  if (cleanNames.length === 0) return '';
  if (cleanNames.length === 1) return cleanNames[0];

  let prefix = cleanNames[0];
  for (const name of cleanNames.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < name.length && prefix[index] === name[index]) index += 1;
    prefix = prefix.slice(0, index);
    if (!prefix) break;
  }

  const inferred = trimInferredItemName(prefix);
  return inferred.length >= 3 ? inferred : cleanNames[0];
};

const emptyImportTotals = (): ProjectOpeningBalanceImportTotals => ({
  purchasedValue: 0,
  issuedValue: 0,
  usedValue: 0,
  remainingQty: 0,
  remainingValue: 0,
});

const summarizeImportRows = (rows: ProjectOpeningBalanceImportRow[]): ProjectOpeningBalanceImportTotals =>
  rows.reduce((totals, row) => {
    const unitPrice = Number(row.unitPrice || 0);
    const purchasedAmount = Number(row.purchasedAmount || 0) || Number(row.purchasedQty || 0) * unitPrice;
    const issuedAmount = Number(row.issuedAmount || 0) || Number(row.issuedQty || 0) * unitPrice;
    totals.purchasedValue += Math.max(0, purchasedAmount);
    totals.issuedValue += Math.max(0, issuedAmount);
    totals.usedValue += Math.max(0, issuedAmount);
    totals.remainingQty += Math.max(0, Number(row.remainingQty || 0));
    totals.remainingValue += Math.max(0, Number(row.remainingValue || 0));
    return totals;
  }, emptyImportTotals());

export const normalizeOpeningBalance = (
  balance: ProjectOpeningBalance,
): ProjectOpeningBalance => ({
  ...balance,
  contractValue: Math.max(0, Number(balance.contractValue || 0)),
  constructionProgressPercent: clampPercent(balance.constructionProgressPercent),
  purchasedValue: Math.max(0, Number(balance.purchasedValue || 0)),
  issuedValue: Math.max(0, Number(balance.issuedValue || 0)),
  usedValue: Math.max(0, Number(balance.usedValue || 0)),
  recognizedValue: calculateOpeningRecognizedValue(balance.purchasedValue, balance.issuedValue, balance.usedValue),
  stockTransactionIds: balance.stockTransactionIds || [],
});

const normalizeLine = (line: ProjectOpeningBalanceLine): ProjectOpeningBalanceLine => {
  const unitPrice = Math.max(0, Number(line.unitPrice || 0));
  const remainingQty = Math.max(0, Number(line.remainingQty || 0));
  return {
    id: line.id,
    openingBalanceId: line.openingBalanceId,
    inventoryItemId: line.inventoryItemId || null,
    accountingCode: String(line.accountingCode || '').trim() || null,
    sku: String(line.sku || '').trim(),
    itemName: String(line.itemName || '').trim(),
    unit: String(line.unit || 'Cái').trim() || 'Cái',
    warehouseId: String(line.warehouseId || '').trim(),
    purchasedQty: Math.max(0, Number(line.purchasedQty || 0)),
    issuedQty: Math.max(0, Number(line.issuedQty || 0)),
    usedQty: Math.max(0, Number(line.usedQty || 0)),
    remainingQty,
    unitPrice,
    remainingValue: Math.max(0, Number(line.remainingValue || remainingQty * unitPrice || 0)),
    note: line.note || null,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
};

const mapBalance = (row: any): ProjectOpeningBalance => ({
  ...(fromDb(row) as ProjectOpeningBalance),
  stockTransactionIds: row.stock_transaction_ids || row.stockTransactionIds || [],
  materialProjectTransactionId: row.material_project_transaction_id ?? row.materialProjectTransactionId ?? null,
});

const mapLine = (row: any): ProjectOpeningBalanceLine => fromDb(row) as ProjectOpeningBalanceLine;

const balanceToDb = (balance: ProjectOpeningBalance): Record<string, unknown> => {
  const normalized = normalizeOpeningBalance(balance);
  const payload = cleanUndefined(toDb({
    ...normalized,
    stockTransactionIds: normalized.stockTransactionIds || [],
  }));
  if (!payload.id) delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

const lineToDb = (line: ProjectOpeningBalanceLine, openingBalanceId: string): Record<string, unknown> => {
  const payload = cleanUndefined(toDb({
    ...normalizeLine(line),
    openingBalanceId,
  }));
  if (!payload.id) delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

const defaultFinance = (balance: ProjectOpeningBalance, financeId?: string): ProjectFinance => ({
  id: financeId || crypto.randomUUID(),
  projectId: balance.projectId || null,
  constructionSiteId: balance.constructionSiteId || '',
  contractValue: balance.contractValue,
  budgetMaterials: 0,
  budgetLabor: 0,
  budgetSubcontract: 0,
  budgetMachinery: 0,
  budgetOverhead: 0,
  actualMaterials: 0,
  actualLabor: 0,
  actualSubcontract: 0,
  actualMachinery: 0,
  actualOverhead: 0,
  revenueReceived: 0,
  revenuePending: 0,
  progressPercent: balance.constructionProgressPercent,
  actualProductionValue: 0,
  status: 'active',
  notes: balance.note || undefined,
  updatedAt: new Date().toISOString(),
});

const buildFinance = (
  balance: ProjectOpeningBalance,
  existingFinance?: ProjectFinance | null,
): ProjectFinance => {
  const base = existingFinance || defaultFinance(balance);
  return {
    ...base,
    projectId: balance.projectId || base.projectId || null,
    constructionSiteId: balance.constructionSiteId || base.constructionSiteId,
    contractValue: Number(balance.contractValue || base.contractValue || 0),
    progressPercent: base.progressPercent > 0 ? base.progressPercent : balance.constructionProgressPercent,
    status: base.status === 'planning' && balance.constructionProgressPercent > 0 ? 'active' : base.status,
    notes: [base.notes, balance.note ? `Đầu kỳ ${balance.asOfDate}: ${balance.note}` : 'Đầu kỳ dự án đã được chốt.']
      .filter(Boolean)
      .join('\n'),
    updatedAt: new Date().toISOString(),
  };
};

const buildItemsForLines = (
  lines: ProjectOpeningBalanceLine[],
  existingItems: InventoryItem[],
): { itemByLineKey: Map<string, InventoryItem>; createdItems: InventoryItem[]; updatedItems: InventoryItem[] } => {
  const byId = new Map(existingItems.map(item => [item.id, item]));
  const bySku = new Map(existingItems.map(item => [item.sku.trim().toLowerCase(), item]));
  const createdItems: InventoryItem[] = [];
  const updatedItems = new Map<string, InventoryItem>();
  const itemByLineKey = new Map<string, InventoryItem>();

  lines.forEach((line, index) => {
    const normalized = normalizeLine(line);
    const skuKey = normalized.sku.toLowerCase();
    let item = normalized.inventoryItemId ? byId.get(normalized.inventoryItemId) : undefined;
    if (!item && skuKey) item = bySku.get(skuKey);
    if (!item && normalized.accountingCode) {
      item = findExistingRootAccountingItem(existingItems, normalized.accountingCode, normalized.itemName);
    }
    if (!item) {
      const rootCode = normalized.accountingCode || normalized.sku;
      item = {
        id: normalized.inventoryItemId || crypto.randomUUID(),
        sku: normalized.sku || rootCode || `OPEN-${String(index + 1).padStart(4, '0')}`,
        accountingCode: normalized.accountingCode || normalized.sku || null,
        name: normalized.itemName || normalized.sku || `Vật tư đầu kỳ ${index + 1}`,
        category: 'Đầu kỳ',
        unit: normalized.unit || 'Cái',
        purchaseConversionFactor: 1,
        priceIn: normalized.unitPrice,
        priceOut: normalized.unitPrice,
        minStock: 0,
        stockByWarehouse: {},
      };
      createdItems.push(item);
      byId.set(item.id, item);
      bySku.set(item.sku.trim().toLowerCase(), item);
    } else if (normalized.unitPrice > 0 && (Number(item.priceIn || 0) <= 0 || Number(item.priceOut || 0) <= 0)) {
      item = {
        ...item,
        priceIn: Number(item.priceIn || 0) > 0 ? item.priceIn : normalized.unitPrice,
        priceOut: Number(item.priceOut || 0) > 0 ? item.priceOut : normalized.unitPrice,
      };
      updatedItems.set(item.id, item);
      byId.set(item.id, item);
      bySku.set(item.sku.trim().toLowerCase(), item);
    }
    itemByLineKey.set(String(index), item);
  });

  return { itemByLineKey, createdItems, updatedItems: Array.from(updatedItems.values()) };
};

interface ProjectOpeningBalanceImportOptions {
  existingItems?: InventoryItem[];
  defaultWarehouseId?: string;
}

interface AccountingColumnMap {
  accountingCode?: number;
  itemName?: number;
  unit?: number;
  importQty?: number;
  importUnitPrice?: number;
  importAmount?: number;
  exportQty?: number;
  exportUnitPrice?: number;
  exportAmount?: number;
}

interface AccountingRawRow {
  rowNumber: number;
  accountingCode: string;
  itemName: string;
  unit: string;
  importQty: number;
  importUnitPrice: number;
  importAmount: number;
  exportQty: number;
  exportUnitPrice: number;
  exportAmount: number;
  remainingValue: number;
  errors: string[];
  warnings: string[];
}

const getMatrixCell = (row: unknown[] | undefined, index?: number): unknown =>
  index === undefined || !row ? '' : row[index];

const rowHasValue = (row: unknown[] | undefined): boolean =>
  !!row && row.some(value => String(value ?? '').trim() !== '');

const findExistingRootAccountingItem = (
  existingItems: InventoryItem[],
  accountingCode: string,
  inferredName?: string,
): InventoryItem | undefined => {
  const codeKey = normalizeLookupText(accountingCode);
  const nameKey = normalizeLookupText(inferredName);
  const exactSku = existingItems.find(item => normalizeLookupText(item.sku) === codeKey);
  if (exactSku) return exactSku;

  const sameCodeItems = existingItems.filter(item => normalizeLookupText(item.accountingCode) === codeKey);
  if (nameKey) {
    const sameName = sameCodeItems.find(item => normalizeLookupText(item.name) === nameKey);
    if (sameName) return sameName;
  }

  return sameCodeItems.find(item => !isGeneratedVariantSku(item.sku, accountingCode));
};

const buildAccountingColumnMap = (topRow: unknown[], subRow: unknown[]): AccountingColumnMap => {
  const map: AccountingColumnMap = {};
  let activeGroup: 'import' | 'export' | null = null;
  const width = Math.max(topRow.length, subRow.length);

  for (let index = 0; index < width; index += 1) {
    const top = normalizeLookupText(topRow[index]);
    const sub = normalizeLookupText(subRow[index]);

    if (top.includes('ma hang') || top.includes('ma vat tu')) {
      map.accountingCode = index;
      activeGroup = null;
      continue;
    }
    if (top.includes('ten hang') || top.includes('ten vat tu')) {
      map.itemName = index;
      activeGroup = null;
      continue;
    }
    if (top === 'dvt' || top.includes('don vi')) {
      map.unit = index;
      activeGroup = null;
      continue;
    }
    if (top.includes('nhap kho')) {
      activeGroup = 'import';
    } else if (top.includes('xuat kho')) {
      activeGroup = 'export';
    } else if (top && !sub) {
      activeGroup = null;
    }

    if (!activeGroup || !sub) continue;
    if (sub.includes('so luong')) {
      if (activeGroup === 'import') map.importQty = index;
      else map.exportQty = index;
    } else if (sub.includes('don gia')) {
      if (activeGroup === 'import') map.importUnitPrice = index;
      else map.exportUnitPrice = index;
    } else if (sub.includes('thanh tien')) {
      if (activeGroup === 'import') map.importAmount = index;
      else map.exportAmount = index;
    }
  }

  return map;
};

const isAccountingColumnMap = (map: AccountingColumnMap): boolean =>
  map.accountingCode !== undefined
  && map.itemName !== undefined
  && map.unit !== undefined
  && (map.importQty !== undefined || map.importAmount !== undefined)
  && (map.exportQty !== undefined || map.exportAmount !== undefined);

const parseAccountingOpeningRows = (
  matrix: unknown[][],
  options: ProjectOpeningBalanceImportOptions = {},
): ProjectOpeningBalanceImportResult | null => {
  let headerIndex = -1;
  let columns: AccountingColumnMap | null = null;

  for (let index = 0; index < matrix.length - 1; index += 1) {
    const map = buildAccountingColumnMap(matrix[index] || [], matrix[index + 1] || []);
    if (isAccountingColumnMap(map)) {
      headerIndex = index;
      columns = map;
      break;
    }
  }

  if (headerIndex < 0 || !columns) return null;

  const existingItems = options.existingItems || [];
  const rawRows: AccountingRawRow[] = [];

  matrix.slice(headerIndex + 2).forEach((row, localIndex) => {
    if (!rowHasValue(row)) return;

    const rowNumber = headerIndex + 3 + localIndex;
    const accountingCode = String(getMatrixCell(row, columns!.accountingCode) || '').trim();
    const itemName = String(getMatrixCell(row, columns!.itemName) || '').trim();
    const unit = String(getMatrixCell(row, columns!.unit) || '').trim() || 'Cái';
    const rawImportQty = numberOrZero(getMatrixCell(row, columns!.importQty));
    const rawImportUnitPrice = moneyOrZero(getMatrixCell(row, columns!.importUnitPrice));
    const importAmount = moneyOrZero(getMatrixCell(row, columns!.importAmount)) || rawImportQty * rawImportUnitPrice;
    const importReconciled = reconcileAccountingQtyPrice(rawImportQty, rawImportUnitPrice, importAmount);
    const importQty = importReconciled.qty;
    const importUnitPrice = importReconciled.unitPrice;

    const rawExportQty = numberOrZero(getMatrixCell(row, columns!.exportQty));
    const rawExportUnitPrice = moneyOrZero(getMatrixCell(row, columns!.exportUnitPrice));
    const exportAmount = moneyOrZero(getMatrixCell(row, columns!.exportAmount))
      || rawExportQty * (rawExportUnitPrice || importUnitPrice);
    const exportReconciled = reconcileAccountingQtyPrice(rawExportQty, rawExportUnitPrice || importUnitPrice, exportAmount);
    const exportQty = exportReconciled.qty;
    const exportUnitPrice = exportReconciled.unitPrice;
    const unitPrice = importUnitPrice
      || (importQty > 0 ? importAmount / importQty : 0)
      || exportUnitPrice
      || (exportQty > 0 ? exportAmount / exportQty : 0);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!accountingCode) errors.push('Thiếu mã hàng kế toán.');
    if (!itemName) errors.push('Thiếu tên hàng/quy cách.');
    if (!unit) errors.push('Thiếu đơn vị tính.');
    if (exportQty > importQty) warnings.push('Số lượng xuất lớn hơn nhập, tồn được tính bằng 0.');
    if (importQty <= 0 && exportQty <= 0 && importAmount <= 0 && exportAmount <= 0) warnings.push('Dòng không có số lượng/giá trị nhập xuất.');

    rawRows.push({
      rowNumber,
      accountingCode,
      itemName,
      unit,
      importQty,
      importUnitPrice: unitPrice,
      importAmount: Math.max(0, importAmount),
      exportQty,
      exportUnitPrice: exportUnitPrice || unitPrice,
      exportAmount: Math.max(0, exportAmount),
      remainingValue: Math.max(0, importQty - exportQty) * unitPrice,
      errors,
      warnings,
    });
  });

  const nonEmptyRawRows = rawRows.filter(row =>
    row.accountingCode || row.itemName || row.importQty > 0 || row.exportQty > 0 || row.importAmount || row.exportAmount
  );
  const groupedRows = new Map<string, AccountingRawRow[]>();
  const invalidRows: ProjectOpeningBalanceImportRow[] = [];

  nonEmptyRawRows.forEach(row => {
    if (!row.accountingCode) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        inventoryItemId: null,
        accountingCode: null,
        sku: '',
        itemName: row.itemName,
        unit: row.unit,
        warehouseId: options.defaultWarehouseId || '',
        purchasedQty: row.importQty,
        issuedQty: row.exportQty,
        usedQty: row.exportQty,
        remainingQty: Math.max(0, row.importQty - row.exportQty),
        unitPrice: row.importUnitPrice || row.exportUnitPrice,
        remainingValue: row.remainingValue,
        purchasedAmount: row.importAmount,
        issuedAmount: row.exportAmount,
        note: null,
        errors: row.errors,
        warnings: row.warnings,
      });
      return;
    }

    const key = normalizeLookupText(row.accountingCode);
    const existing = groupedRows.get(key) || [];
    existing.push(row);
    groupedRows.set(key, existing);
  });

  const rows: ProjectOpeningBalanceImportRow[] = [
    ...invalidRows,
    ...Array.from(groupedRows.values()).map(groupRows => {
      const accountingCode = groupRows[0].accountingCode;
      const inferredName = inferCommonItemName(groupRows.map(row => row.itemName));
      const existingItem = findExistingRootAccountingItem(existingItems, accountingCode, inferredName);
      const purchasedQty = groupRows.reduce((sum, row) => sum + row.importQty, 0);
      const issuedQty = groupRows.reduce((sum, row) => sum + row.exportQty, 0);
      const purchasedAmount = groupRows.reduce((sum, row) => sum + row.importAmount, 0);
      const issuedAmount = groupRows.reduce((sum, row) => sum + row.exportAmount, 0);
      const remainingQty = Math.max(0, purchasedQty - issuedQty);
      const remainingValue = groupRows.reduce((sum, row) => sum + row.remainingValue, 0);
      const importAveragePrice = purchasedQty > 0 ? purchasedAmount / purchasedQty : 0;
      const exportAveragePrice = issuedQty > 0 ? issuedAmount / issuedQty : 0;
      const unitPrice = remainingQty > 0
        ? remainingValue / remainingQty
        : importAveragePrice || exportAveragePrice;
      const unit = groupRows.find(row => row.unit)?.unit || 'Cái';
      const groupedNote = groupRows.length > 1
        ? `Mã kế toán: ${accountingCode}. Đã gộp ${groupRows.length} dòng quy cách về mã vật tư gốc.`
        : `Mã kế toán: ${accountingCode}`;

      return {
        rowNumber: groupRows[0].rowNumber,
        inventoryItemId: existingItem?.id || null,
        accountingCode,
        sku: accountingCode,
        itemName: existingItem?.name || inferredName || accountingCode,
        unit,
        warehouseId: options.defaultWarehouseId || '',
        purchasedQty,
        issuedQty,
        usedQty: issuedQty,
        remainingQty,
        unitPrice,
        remainingValue,
        purchasedAmount: Math.max(0, purchasedAmount),
        issuedAmount: Math.max(0, issuedAmount),
        note: groupedNote,
        errors: groupRows.flatMap(row => row.errors),
        warnings: groupRows.flatMap(row => row.warnings),
      };
    }),
  ];
  const errors = nonEmptyRawRows.flatMap(row => row.errors.map(error => `Dòng ${row.rowNumber}: ${error}`));
  const warnings = nonEmptyRawRows.flatMap(row => row.warnings.map(warning => `Dòng ${row.rowNumber}: ${warning}`));

  return {
    rows,
    totals: summarizeImportRows(rows.filter(row => !(row.errors || []).length)),
    errors,
    warnings,
  };
};

const parseLegacyOpeningRows = async (
  file: File,
  options: ProjectOpeningBalanceImportOptions = {},
): Promise<ProjectOpeningBalanceImportResult> => {
  const rows = await parseExcelRows(file);
  const parsedRows = rows.map<ProjectOpeningBalanceImportRow>((row, index) => {
    const accountingCode = getExcelCell(row, ['Mã kế toán', 'Ma ke toan', 'Mã hàng kế toán', 'Ma hang ke toan', 'Mã hàng gốc', 'Ma hang goc']);
    const sku = getExcelCell(row, ['Mã vật tư', 'Ma vat tu', 'SKU', 'sku', 'Mã hàng', 'Ma hang']);
    const itemName = getExcelCell(row, ['Tên vật tư', 'Ten vat tu', 'Tên hàng', 'Ten hang', 'Item', 'itemName']);
    const unit = getExcelCell(row, ['Đơn vị', 'Don vi', 'Unit', 'unit']) || 'Cái';
    const warehouseId = getExcelCell(row, ['Kho', 'warehouseId', 'warehouse_id', 'Mã kho', 'Ma kho', 'Tên kho', 'Ten kho'])
      || options.defaultWarehouseId
      || '';
    const purchasedQty = numberOrZero(getExcelCell(row, ['SL đã mua', 'So luong da mua', 'Purchased Qty', 'purchasedQty']));
    const issuedQty = numberOrZero(getExcelCell(row, ['SL đã xuất', 'SL đã cấp', 'So luong da xuat', 'Issued Qty', 'issuedQty']));
    const usedQty = numberOrZero(getExcelCell(row, ['SL đã sử dụng', 'So luong da su dung', 'Used Qty', 'usedQty']));
    const remainingQty = numberOrZero(getExcelCell(row, ['SL tồn hiện tại', 'Ton hien tai', 'Remaining Qty', 'remainingQty', 'Tồn kho']));
    const unitPrice = moneyOrZero(getExcelCell(row, ['Đơn giá', 'Don gia', 'Unit Price', 'unitPrice']));
    const remainingValue = moneyOrZero(getExcelCell(row, ['Thành tiền tồn', 'Thanh tien ton', 'Remaining Value', 'remainingValue']));
    const note = getExcelCell(row, ['Ghi chú', 'Ghi chu', 'Note', 'note']);
    const errors: string[] = [];
    if (!sku) errors.push('Thiếu mã vật tư.');
    if (!itemName) errors.push('Thiếu tên vật tư.');
    if (!warehouseId) errors.push('Thiếu kho.');
    return {
      rowNumber: index + 2,
      inventoryItemId: null,
      accountingCode: accountingCode || null,
      sku,
      itemName,
      unit,
      warehouseId,
      purchasedQty,
      issuedQty,
      usedQty,
      remainingQty,
      unitPrice,
      remainingValue: remainingValue || remainingQty * unitPrice,
      purchasedAmount: remainingValue || remainingQty * unitPrice,
      issuedAmount: remainingValue || remainingQty * unitPrice,
      note,
      errors,
      warnings: [],
    };
  }).filter(row => row.sku || row.itemName || row.warehouseId || row.remainingQty > 0);

  return {
    rows: parsedRows,
    totals: summarizeImportRows(parsedRows),
    errors: parsedRows.flatMap(row => (row.errors || []).map(error => `Dòng ${row.rowNumber}: ${error}`)),
    warnings: parsedRows.flatMap(row => (row.warnings || []).map(warning => `Dòng ${row.rowNumber}: ${warning}`)),
  };
};

export interface ProjectOpeningBalanceLockResult {
  openingBalance: ProjectOpeningBalance;
  lines: ProjectOpeningBalanceLine[];
  projectFinance: ProjectFinance;
  materialProjectTransaction?: ProjectTransaction;
  stockTransactions: Transaction[];
  createdItems: InventoryItem[];
  updatedItems: InventoryItem[];
}

const mapLockResult = (value: any): ProjectOpeningBalanceLockResult => {
  if (!value || typeof value !== 'object') {
    throw new Error('Lệnh khóa đầu kỳ không trả về kết quả hợp lệ.');
  }

  const field = (snakeCase: string, camelCase: string): any =>
    value[snakeCase] ?? value[camelCase];
  const mapRow = <T>(row: any): T => fromDb(row) as T;
  const mapInventoryItem = (row: any): InventoryItem => {
    const source = row && typeof row === 'object' ? row : {};
    const stockByWarehouse = source.stock_by_warehouse ?? source.stockByWarehouse ?? {};
    const rowWithoutOpaqueMap = { ...source };
    delete rowWithoutOpaqueMap.stock_by_warehouse;
    delete rowWithoutOpaqueMap.stockByWarehouse;
    return {
      ...mapRow<InventoryItem>(rowWithoutOpaqueMap),
      // Warehouse ids are opaque identifiers, not database column names.
      stockByWarehouse: { ...stockByWarehouse },
    };
  };

  const openingBalance = field('opening_balance', 'openingBalance');
  const projectFinance = field('project_finance', 'projectFinance');
  if (!openingBalance || !projectFinance) {
    throw new Error('Lệnh khóa đầu kỳ trả về thiếu chứng từ bắt buộc.');
  }

  return {
    openingBalance: mapRow<ProjectOpeningBalance>(openingBalance),
    lines: (field('lines', 'lines') || []).map(mapRow<ProjectOpeningBalanceLine>),
    projectFinance: mapRow<ProjectFinance>(projectFinance),
    materialProjectTransaction: field('material_project_transaction', 'materialProjectTransaction')
      ? mapRow<ProjectTransaction>(field('material_project_transaction', 'materialProjectTransaction'))
      : undefined,
    stockTransactions: (field('stock_transactions', 'stockTransactions') || []).map(mapRow<Transaction>),
    createdItems: (field('created_items', 'createdItems') || []).map(mapInventoryItem),
    updatedItems: (field('updated_items', 'updatedItems') || []).map(mapInventoryItem),
  };
};

export const projectOpeningBalanceService = {
  async getOpeningBalanceByScope(scopeKey: string): Promise<ProjectOpeningBalance | null> {
    if (!isSupabaseConfigured || !scopeKey) return null;
    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .neq('status', 'void')
      .order('status', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('project opening balance unavailable', error.message);
      return null;
    }
    return data ? mapBalance(data) : null;
  },

  async getLockedByScope(scopeKey: string): Promise<ProjectOpeningBalance | null> {
    if (!isSupabaseConfigured || !scopeKey) return null;
    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .eq('status', 'locked')
      .maybeSingle();
    if (error) {
      console.warn('project opening balance unavailable', error.message);
      return null;
    }
    return data ? mapBalance(data) : null;
  },

  async listLines(openingBalanceId: string): Promise<ProjectOpeningBalanceLine[]> {
    if (!isSupabaseConfigured || !openingBalanceId) return [];
    const { data, error } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('opening_balance_id', openingBalanceId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('project opening balance lines unavailable', error.message);
      return [];
    }
    return (data || []).map(mapLine);
  },

  async saveOpeningBalanceDraft(input: {
    openingBalance: ProjectOpeningBalance;
    lines: ProjectOpeningBalanceLine[];
  }): Promise<{ openingBalance: ProjectOpeningBalance; lines: ProjectOpeningBalanceLine[] }> {
    const balance = normalizeOpeningBalance({ ...input.openingBalance, status: 'draft' });
    if (!isSupabaseConfigured) {
      const id = balance.id || crypto.randomUUID();
      return {
        openingBalance: { ...balance, id },
        lines: input.lines.map(line => ({ ...normalizeLine(line), openingBalanceId: id })),
      };
    }

    const { data, error } = await supabase
      .from(BALANCE_TABLE)
      .upsert(balanceToDb(balance), { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;

    const saved = mapBalance(data);
    if (!saved.id) throw new Error('Không tạo được bản đầu kỳ.');

    await supabase.from(LINE_TABLE).delete().eq('opening_balance_id', saved.id);
    const normalizedLines = input.lines.map(line => normalizeLine(line)).filter(line => line.sku && line.itemName && line.warehouseId);
    if (normalizedLines.length > 0) {
      const { data: lineRows, error: lineError } = await supabase
        .from(LINE_TABLE)
        .insert(normalizedLines.map(line => lineToDb(line, saved.id!)))
        .select();
      if (lineError) throw lineError;
      return { openingBalance: saved, lines: (lineRows || []).map(mapLine) };
    }

    return { openingBalance: saved, lines: [] };
  },

  async lockOpeningBalance(input: {
    commandId?: string;
    openingBalance: ProjectOpeningBalance;
    lines: ProjectOpeningBalanceLine[];
    existingItems: InventoryItem[];
    existingFinance?: ProjectFinance | null;
    actorUserId?: string;
  }): Promise<ProjectOpeningBalanceLockResult> {
    const balance = normalizeOpeningBalance(input.openingBalance);
    if (!balance.scopeKey) throw new Error('Thiếu scope dự án/công trường.');
    if (!balance.constructionSiteId && !balance.projectId) throw new Error('Thiếu dự án hoặc công trường.');

    const lines = input.lines.map(normalizeLine).filter(line => line.sku && line.itemName && line.warehouseId);
    if (lines.length === 0) {
      throw new Error('Chưa có dòng vật tư đầu kỳ hợp lệ. Vui lòng import Excel hoặc nhập ít nhất một dòng vật tư trước khi khóa.');
    }

    if (isSupabaseConfigured) {
      const command = {
        commandId: input.commandId || crypto.randomUUID(),
        openingBalance: canonicalizeCommandNumbers(cleanUndefined({
          ...balance,
          scopeKey: balance.scopeKey.trim(),
        })),
        lines: lines.map(line => canonicalizeCommandNumbers(cleanUndefined({ ...line }))),
        projectFinanceId: input.existingFinance?.id || null,
        financeSnapshot: input.existingFinance
          ? canonicalizeCommandNumbers(cleanUndefined({ ...input.existingFinance }))
          : null,
      };
      const { data, error } = await supabase.rpc('lock_project_opening_balance', {
        p_command: command,
      });
      if (error) throw error;

      const result = mapLockResult(data);
      await projectWeeklyProgressService.upsertSnapshot({
        scopeKey: result.openingBalance.scopeKey,
        projectId: result.openingBalance.projectId,
        constructionSiteId: result.openingBalance.constructionSiteId,
        weekStart: getWeekStart(result.openingBalance.asOfDate),
        constructionProgressPercent: result.openingBalance.constructionProgressPercent,
        valueMetric: {
          contractTotalValue: result.openingBalance.contractValue,
          purchasedValue: result.openingBalance.purchasedValue,
          issuedValue: result.openingBalance.issuedValue,
          actualProductionValue: result.openingBalance.recognizedValue,
          recognizedValue: result.openingBalance.recognizedValue,
          valueProgressPercent: result.openingBalance.contractValue > 0
            ? Math.min(100, Math.round((result.openingBalance.recognizedValue / result.openingBalance.contractValue) * 100))
            : 0,
        },
        progressMode: 'opening_balance',
        calculatedAt: new Date().toISOString(),
      });
      return result;
    }

    const projectFinance = buildFinance(balance, input.existingFinance);
    const { itemByLineKey, createdItems, updatedItems } = buildItemsForLines(lines, input.existingItems);
    const linesWithItems = lines.map((line, index) => {
      const item = itemByLineKey.get(String(index));
      return {
        ...line,
        inventoryItemId: item?.id || line.inventoryItemId || null,
        sku: item?.sku || line.sku,
        itemName: line.itemName || item?.name || '',
        unit: line.unit || item?.unit || 'Cái',
        accountingCode: line.accountingCode || item?.accountingCode || null,
      };
    });
    const stockTransactions: Transaction[] = [];
    let materialProjectTransaction: ProjectTransaction | undefined;

    const materialExpenseValue = accountingExpenseValue(balance);
    if (materialExpenseValue > 0) {
      materialProjectTransaction = {
        id: crypto.randomUUID(),
        projectId: balance.projectId || null,
        projectFinanceId: projectFinance.id,
        constructionSiteId: balance.constructionSiteId || '',
        type: 'expense',
        category: 'materials',
        amount: materialExpenseValue,
        description: `Chi phí vật tư đã sử dụng đầu kỳ đến ${balance.asOfDate}`,
        date: balance.asOfDate,
        source: 'import',
        sourceRef: `opening_balance:${balance.id || 'local'}:materials`,
        attachments: [],
        createdBy: input.actorUserId,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      openingBalance: {
        ...balance,
        id: balance.id || crypto.randomUUID(),
        status: 'locked',
        lockedBy: input.actorUserId,
        lockedAt: new Date().toISOString(),
      },
      lines: linesWithItems,
      projectFinance,
      materialProjectTransaction,
      stockTransactions,
      createdItems,
      updatedItems,
    };
  },

  async voidOpeningBalance(openingBalanceId: string): Promise<void> {
    if (!isSupabaseConfigured || !openingBalanceId) return;
    throw new Error(
      'Voiding atomic opening balances requires a controlled reversal and is temporarily unavailable.',
    );
  },

  async parseOpeningBalanceImport(
    file: File,
    options: ProjectOpeningBalanceImportOptions = {},
  ): Promise<ProjectOpeningBalanceImportResult> {
    const XLSX = await loadXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
    const accountingResult = parseAccountingOpeningRows(matrix, options);
    if (accountingResult) return accountingResult;
    return parseLegacyOpeningRows(file, options);
  },
};
