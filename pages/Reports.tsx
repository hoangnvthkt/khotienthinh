import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  History,
  Layers,
  Loader2,
  Package,
  PieChart,
  Printer,
  QrCode,
  Search,
  Warehouse,
} from 'lucide-react';
import {
  InventoryLedgerEntry,
  InventoryLedgerTransactionType,
} from '../types';
import { loadXlsx } from '../lib/loadXlsx';
import { useModuleData } from '../hooks/useModuleData';
import { useInventoryLedger } from '../hooks/useInventoryLedger';
import { buildDocumentTracePath } from '../lib/documentTraceService';
import { getDefaultWmsWarehouseFilter, getWmsWarehouseAccess } from '../lib/wmsPermissions';
import { useInventoryNxtReport } from '../hooks/useInventoryNxtReport';
import {
  InventoryNxtRow,
  MISSING_ITEM_LABEL,
  NXT_EXCEL_HEADERS,
  buildNxtExcelRows,
  isNegativeStock,
  isValueMissing,
  rowMissingPrice,
  summarizeNxt,
} from '../lib/inventoryNxtReport';
import { Kpi, shortMoney } from '../components/finance/financeUi';
import { StateBox } from '../components/procurement/hub/hubUi';

type ReportView = 'summary' | 'material_card' | 'warehouse_card' | 'history';

const transactionTypeLabels: Record<InventoryLedgerTransactionType, string> = {
  purchase_receipt: 'Nhập mua hàng',
  transfer_receipt: 'Nhập điều chuyển',
  project_return_receipt: 'Nhập trả công trình',
  project_issue: 'Xuất cho công trình',
  transfer_issue: 'Xuất điều chuyển',
  loss_issue: 'Xuất hao hụt / huỷ',
  adjustment_in: 'Điều chỉnh tăng',
  adjustment_out: 'Điều chỉnh giảm',
  reversal: 'Đảo giao dịch',
};

const transactionTypeOptions: Array<{ value: InventoryLedgerTransactionType | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả giao dịch' },
  { value: 'purchase_receipt', label: 'Nhập mua hàng' },
  { value: 'transfer_receipt', label: 'Nhập điều chuyển' },
  { value: 'project_return_receipt', label: 'Nhập trả công trình' },
  { value: 'project_issue', label: 'Xuất cho công trình' },
  { value: 'transfer_issue', label: 'Xuất điều chuyển' },
  { value: 'loss_issue', label: 'Xuất hao hụt / huỷ' },
  { value: 'adjustment_in', label: 'Điều chỉnh tăng' },
  { value: 'adjustment_out', label: 'Điều chỉnh giảm' },
  { value: 'reversal', label: 'Đảo giao dịch' },
];

const fmt = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} ₫`;
const REPORT_PAGE_SIZE = 10;
const NXT_PAGE_SIZE = 50;
const wholeMoney = (value: number) => Math.round(Number(value || 0)).toLocaleString('vi-VN');
const QTY_EPS = 0.00005;

const startOfDay = (value: string) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value: string) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const getLedgerTypeTone = (entry: InventoryLedgerEntry) => {
  if (entry.transactionType.includes('adjustment')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (entry.movementDirection === 'in') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-orange-50 text-orange-700 border-orange-200';
};

const sourceLabel = (sourceType: string) => {
  if (sourceType === 'wms_transaction') return 'Phiếu WMS';
  if (sourceType === 'purchase_order') return 'Đơn mua hàng';
  if (sourceType === 'material_request') return 'Yêu cầu vật tư';
  return sourceType || 'Chứng từ';
};

function useClientPagination<T>(rows: T[], resetKey: string, pageSize = REPORT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, rows],
  );
  const pageStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(rows.length, (page - 1) * pageSize + pageRows.length);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return { page, setPage, pageCount, pageRows, pageStart, pageEnd, total: rows.length };
}

const PaginationFooter: React.FC<{
  page: number;
  pageCount: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  noun: string;
  onPageChange: React.Dispatch<React.SetStateAction<number>>;
}> = ({ page, pageCount, pageStart, pageEnd, total, noun, onPageChange }) => (
  <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="text-xs font-bold text-slate-500">Đang xem {pageStart}-{pageEnd} trên {total} {noun}</div>
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => onPageChange(prev => Math.max(1, prev - 1))}
        disabled={page <= 1}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeft size={14} /> Trước
      </button>
      <span className="min-w-[82px] text-center text-xs font-black text-slate-500">{page}/{pageCount}</span>
      <button
        type="button"
        onClick={() => onPageChange(prev => Math.min(pageCount, prev + 1))}
        disabled={page >= pageCount}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Sau <ChevronRight size={14} />
      </button>
    </div>
  </div>
);

const Reports: React.FC = () => {
  const navigate = useNavigate();
  const { items, warehouses, users, user } = useApp();
  useModuleData('wms');

  const assignedWarehouse = warehouses.find(w => w.id === user.assignedWarehouseId);
  const warehouseAccess = useMemo(
    () => getWmsWarehouseAccess(user, warehouses, 'wms.transaction.view'),
    [user, warehouses],
  );
  const warehouseAccessKey = warehouseAccess.warehouseIds.join('|');
  const defaultWarehouseFilter = useMemo(
    () => getDefaultWmsWarehouseFilter(user, warehouses, 'wms.transaction.view'),
    [user, warehouses],
  );
  const visibleWarehouses = useMemo(
    () => warehouseAccess.canViewAll
      ? warehouses.filter(warehouse => !warehouse.isArchived)
      : warehouses.filter(warehouse => warehouseAccess.warehouseIds.includes(warehouse.id)),
    [warehouseAccess.canViewAll, warehouseAccess.warehouseIds, warehouses],
  );
  const canSelectWarehouse = warehouseAccess.canViewAll || visibleWarehouses.length > 1;
  const scopeLabel = warehouseAccess.canViewAll
    ? 'Tất cả kho'
    : assignedWarehouse?.name || (visibleWarehouses.length > 1 ? `${visibleWarehouses.length} kho` : visibleWarehouses[0]?.name);

  const [activeView, setActiveView] = useState<ReportView>('summary');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedWh, setSelectedWh] = useState(() => getDefaultWmsWarehouseFilter(user, warehouses, 'wms.transaction.view'));
  const [selectedMaterialId, setSelectedMaterialId] = useState('ALL');
  const [selectedType, setSelectedType] = useState<InventoryLedgerTransactionType | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [traceEntry, setTraceEntry] = useState<InventoryLedgerEntry | null>(null);

  const ledgerFilters = useMemo(() => ({
    warehouseId: selectedWh,
    materialId: selectedMaterialId === 'ALL' ? undefined : selectedMaterialId,
    transactionType: selectedType,
    dateFrom: startDate,
    dateTo: endDate,
    search: debouncedSearch,
    limit: 500,
  }), [debouncedSearch, endDate, selectedMaterialId, selectedType, selectedWh, startDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const { entries: ledgerEntries, report: ledgerReport, available: ledgerAvailable, loading: ledgerLoading, error: ledgerError } = useInventoryLedger(ledgerFilters);

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const warehouseById = useMemo(() => new Map(warehouses.map(warehouse => [warehouse.id, warehouse])), [warehouses]);
  const userById = useMemo(() => new Map(users.map(appUser => [appUser.id, appUser])), [users]);
  const visibleWarehouseIdSet = useMemo(() => new Set(warehouseAccess.warehouseIds), [warehouseAccessKey]);

  useEffect(() => {
    setSelectedWh(prev => {
      if (warehouseAccess.canViewAll) {
        if (prev === 'ALL') return prev;
        if (!prev || prev === user.assignedWarehouseId || !warehouseAccess.warehouseIds.includes(prev)) return 'ALL';
        return prev;
      }
      if (prev !== 'ALL' && warehouseAccess.warehouseIds.includes(prev)) return prev;
      return defaultWarehouseFilter;
    });
  }, [defaultWarehouseFilter, user.assignedWarehouseId, warehouseAccess.canViewAll, warehouseAccess.warehouseIds, warehouseAccessKey]);

  const filteredLedgerEntries = useMemo(() => {
    if (ledgerAvailable && ledgerReport) return ledgerReport.entriesPage;
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);
    const search = searchTerm.trim().toLowerCase();
    return ledgerEntries.filter(entry => {
      const item = itemById.get(entry.materialId);
      const txDate = new Date(entry.transactionDate);
      if (txDate > end) return false;
      if (selectedWh !== 'ALL' && entry.warehouseId !== selectedWh) return false;
      if (selectedMaterialId !== 'ALL' && entry.materialId !== selectedMaterialId) return false;
      if (selectedType !== 'all' && entry.transactionType !== selectedType) return false;
      if (search && !`${item?.sku || ''} ${item?.name || ''} ${entry.documentCode} ${entry.sourceCode}`.toLowerCase().includes(search)) return false;
      return txDate >= start;
    });
  }, [endDate, itemById, ledgerAvailable, ledgerEntries, ledgerReport, searchTerm, selectedMaterialId, selectedType, selectedWh, startDate]);

  const nxtFilters = useMemo(() => ({
    warehouseId: selectedWh,
    materialId: selectedMaterialId === 'ALL' ? undefined : selectedMaterialId,
    dateFrom: startDate,
    dateTo: endDate,
    search: debouncedSearch,
  }), [debouncedSearch, endDate, selectedMaterialId, selectedWh, startDate]);
  const { rows: nxtRows, loading: nxtLoading, error: nxtError, reload: reloadNxt } = useInventoryNxtReport(nxtFilters);
  const [missingPriceOnly, setMissingPriceOnly] = useState(false);
  const nxtTotals = useMemo(() => summarizeNxt(nxtRows), [nxtRows]);
  const visibleNxtRows = useMemo(
    () => missingPriceOnly ? nxtRows.filter(rowMissingPrice) : nxtRows,
    [missingPriceOnly, nxtRows],
  );
  const visibleNxtTotals = useMemo(() => summarizeNxt(visibleNxtRows), [visibleNxtRows]);
  const showWarehouseColumn = selectedWh === 'ALL' || new Set(nxtRows.map(row => row.warehouseId)).size > 1;

  const warehouseCardRows = useMemo(() => {
    const grouped = new Map<string, {
      key: string;
      warehouseName: string;
      materialName: string;
      sku: string;
      unit?: string;
      inQty: number;
      outQty: number;
      balanceQty: number;
      lastDate?: string;
    }>();

    if (ledgerAvailable && ledgerReport) {
      return ledgerReport.warehouseRows.map(row => ({
        key: row.key || `${row.warehouseId}:${row.materialId}`,
        warehouseName: row.warehouseName || row.warehouseId,
        materialName: row.materialName || row.materialId,
        sku: row.sku || row.materialId,
        unit: row.unit || undefined,
        inQty: row.inQty,
        outQty: row.outQty,
        balanceQty: row.balanceQty,
        lastDate: row.lastDate || undefined,
      }));
    }

    const source = ledgerAvailable ? filteredLedgerEntries : [];
    source.forEach(entry => {
      const item = itemById.get(entry.materialId);
      const warehouse = warehouseById.get(entry.warehouseId);
      const key = `${entry.warehouseId}:${entry.materialId}`;
      const row = grouped.get(key) || {
        key,
        warehouseName: warehouse?.name || entry.warehouseId,
        materialName: item?.name || entry.materialId,
        sku: item?.sku || entry.materialId,
        unit: item?.unit,
        inQty: 0,
        outQty: 0,
        balanceQty: entry.balanceAfterQty,
        lastDate: entry.transactionDate,
      };
      row.inQty += entry.quantityIn;
      row.outQty += entry.quantityOut;
      row.balanceQty = entry.balanceAfterQty;
      row.lastDate = entry.transactionDate;
      grouped.set(key, row);
    });
    return Array.from(grouped.values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'vi') || a.materialName.localeCompare(b.materialName, 'vi'));
  }, [filteredLedgerEntries, itemById, ledgerAvailable, ledgerReport, warehouseById]);

  const selectedMaterial = selectedMaterialId !== 'ALL' ? itemById.get(selectedMaterialId) : null;
  const paginationResetKey = [
    activeView,
    startDate,
    endDate,
    selectedWh,
    selectedMaterialId,
    selectedType,
    searchTerm,
    missingPriceOnly ? 'missing' : 'all',
  ].join('|');
  const nxtPage = useClientPagination(visibleNxtRows, paginationResetKey, NXT_PAGE_SIZE);
  const warehousePage = useClientPagination(warehouseCardRows, paginationResetKey);

  const handleExportExcel = async () => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([[...NXT_EXCEL_HEADERS], ...buildNxtExcelRows(visibleNxtRows)]);
    // Định dạng số kiểu MISA: số lượng tới 3 số lẻ, giá trị số nguyên, số 0 hiện "-".
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = 1; r <= range.e.r; r += 1) {
      for (let c = 3; c <= 10; c += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') cell.z = c % 2 === 1 ? '#,##0.###;-#,##0.###;"-"' : '#,##0;-#,##0;"-"';
      }
    }
    ws['!cols'] = [12, 36, 8, 14, 16, 14, 16, 14, 16, 14, 16, 36].map(wch => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r, c: NXT_EXCEL_HEADERS.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nhap xuat ton');
    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NhapXuatTon_${startDate}_den_${endDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportDisabledReason = nxtLoading
    ? 'Đang tổng hợp số liệu'
    : nxtError
      ? 'Chưa tải được báo cáo nhập xuất tồn'
      : visibleNxtRows.length === 0 ? 'Không có dòng nào để xuất' : '';

  const openMaterialCard = (row: InventoryNxtRow) => {
    setSelectedMaterialId(row.materialId);
    if (canSelectWarehouse && visibleWarehouses.some(warehouse => warehouse.id === row.warehouseId)) setSelectedWh(row.warehouseId);
    setActiveView('material_card');
  };

  const openSourceDocument = (entry: InventoryLedgerEntry) => {
    if (entry.sourceType === 'wms_transaction') {
      navigate('/operations', { state: { tab: 'PENDING', transactionId: entry.sourceId } });
    }
  };

  const renderDocumentButton = (entry: InventoryLedgerEntry) => (
    <button
      onClick={() => setTraceEntry(entry)}
      className="font-mono text-[11px] font-black text-blue-700 hover:text-blue-900 underline decoration-blue-200 underline-offset-4"
    >
      {entry.documentCode || entry.sourceCode}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-900 px-6 py-6 text-white flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-200">
              <Layers size={13} /> Inventory Ledger
            </div>
            <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-tight">Thẻ kho / Báo cáo nhập xuất tồn</h1>
            <p className="mt-1 text-sm text-slate-300 font-medium">
              Sổ cái vật tư theo kho, vật tư, chứng từ và người thao tác.
            </p>
            {scopeLabel && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-400/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-100">
                <Warehouse size={13} /> Phạm vi: {scopeLabel}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* V1: Đồng bộ MISA không còn là menu riêng của Vật tư — mở từ Báo cáo (chỉ Admin). */}
            {user.role === 'ADMIN' && (
              <button
                onClick={() => navigate('/misa-export')}
                className="flex items-center px-4 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/15 transition font-bold text-sm border border-white/10"
              >
                <FileText size={18} className="mr-2" /> Đồng bộ MISA
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center px-4 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/15 transition font-bold text-sm border border-white/10"
            >
              <Printer size={18} className="mr-2" /> In PDF
            </button>
            <button
              onClick={handleExportExcel}
              disabled={Boolean(exportDisabledReason)}
              title={exportDisabledReason || 'Tải bảng nhập xuất tồn theo mẫu MISA'}
              className="flex items-center px-4 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={18} className="mr-2" /> Xuất Excel NXT
            </button>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200">
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${activeView === 'summary' ? 'xl:grid-cols-4' : 'xl:grid-cols-5'}`}>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Calendar size={12} /> Từ ngày
              </label>
              <input value={startDate} onChange={event => setStartDate(event.target.value)} type="date" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Calendar size={12} /> Đến ngày
              </label>
              <input value={endDate} onChange={event => setEndDate(event.target.value)} type="date" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Building size={12} /> Kho
              </label>
              <select disabled={!canSelectWarehouse} value={selectedWh} onChange={event => setSelectedWh(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-60">
                {warehouseAccess.canViewAll && <option value="ALL">Tất cả kho</option>}
                {visibleWarehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Package size={12} /> Vật tư
              </label>
              <select value={selectedMaterialId} onChange={event => setSelectedMaterialId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                <option value="ALL">Tất cả vật tư</option>
                {items.map(item => <option key={item.id} value={item.id}>{item.sku} - {item.name}</option>)}
              </select>
            </div>
            <div className={`space-y-1 ${activeView === 'summary' ? 'hidden' : ''}`}>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Filter size={12} /> Loại giao dịch
              </label>
              <select value={selectedType} onChange={event => setSelectedType(event.target.value as InventoryLedgerTransactionType | 'all')} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                {transactionTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <label className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                                placeholder={activeView === 'summary' ? 'Tìm mã hàng, tên hàng...' : 'Tìm mã vật tư, tên vật tư, mã phiếu...'}
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </label>
            <div className="flex items-center gap-2 text-[11px] font-bold">
              {(activeView === 'summary' ? nxtLoading : ledgerLoading) && <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 size={13} className="animate-spin" /> Đang tải số liệu</span>}
            </div>
          </div>
          {ledgerError && activeView !== 'summary' && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} /> {ledgerError}
            </div>
          )}
        </div>
      </div>

      <div className="no-scrollbar flex gap-3 overflow-x-auto md:grid md:grid-cols-5 md:overflow-visible">
        {[
          { label: 'Đầu kỳ', value: nxtTotals.openingValue, hint: 'giá trị tồn đầu kỳ', icon: PieChart, tone: 'text-sky-600' },
          { label: 'Nhập kho', value: nxtTotals.inValue, hint: 'giá trị nhập trong kỳ', icon: ArrowDownLeft, tone: 'text-leaf-700' },
          { label: 'Xuất kho', value: nxtTotals.outValue, hint: 'giá trị xuất trong kỳ', icon: ArrowUpRight, tone: 'text-teal-700' },
          { label: 'Cuối kỳ', value: nxtTotals.closingValue, hint: 'giá trị tồn cuối kỳ', icon: Package, tone: 'text-mint-700' },
        ].map(card => (
          <div key={card.label} className="min-w-[150px] flex-1 md:min-w-0 [&>button]:h-full [&>button]:w-full">
            <Kpi
              active={false}
              onClick={() => { setActiveView('summary'); setMissingPriceOnly(false); }}
              icon={card.icon}
              label={card.label}
              value={nxtLoading || nxtError ? '—' : shortMoney(card.value)}
              hint={nxtError ? 'chưa tải được' : card.hint}
              tone={card.tone}
            />
          </div>
        ))}
        <div className="min-w-[150px] flex-1 md:min-w-0 [&>button]:h-full [&>button]:w-full">
          <Kpi
            active={missingPriceOnly}
            onClick={() => { setActiveView('summary'); setMissingPriceOnly(value => !value); }}
            icon={AlertTriangle}
            label="Thiếu đơn giá"
            value={nxtLoading || nxtError ? '—' : `${nxtTotals.missingPriceRows} dòng`}
            hint={nxtError ? 'chưa tải được' : missingPriceOnly ? 'bấm để xem tất cả' : 'giá trị tồn chưa đủ, bấm để lọc'}
            tone={nxtTotals.missingPriceRows > 0 ? 'text-amber-600' : 'text-slate-500'}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-slate-100 bg-slate-50/70">
          {[
            { key: 'summary', label: 'Nhập xuất tồn', icon: PieChart },
            { key: 'material_card', label: 'Thẻ kho vật tư', icon: Package },
            { key: 'warehouse_card', label: 'Thẻ kho theo kho', icon: Warehouse },
            { key: 'history', label: 'Lịch sử giao dịch', icon: History },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveView(tab.key as ReportView)}
                className={`min-w-[170px] px-4 py-3 text-xs font-black uppercase tracking-widest border-b-2 flex items-center justify-center gap-2 transition ${activeView === tab.key ? 'border-emerald-500 bg-white text-emerald-700' : 'border-transparent text-slate-400 hover:text-slate-700'
                  }`}
              >
                <Icon size={15} /> {tab.label}
              </button>
            );
          })}
        </div>

        {activeView === 'summary' && (
          <div>
            {missingPriceOnly && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
                <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Đang xem {visibleNxtRows.length} dòng có số lượng nhưng phiếu nhập chưa có đơn giá.</span>
                <button type="button" onClick={() => setMissingPriceOnly(false)} className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 hover:bg-amber-100">Xem tất cả</button>
              </div>
            )}
            {nxtLoading ? (
              <div className="p-4"><StateBox kind="loading" title="Đang tổng hợp nhập xuất tồn…" /></div>
            ) : nxtError ? (
              <div className="p-4"><StateBox kind="error" title="Chưa tải được báo cáo nhập xuất tồn" message={nxtError} onRetry={reloadNxt} /></div>
            ) : visibleNxtRows.length === 0 ? (
              <div className="p-4"><StateBox kind="empty" title="Không có số liệu trong kỳ" message="Đổi khoảng ngày, kho hoặc từ khóa để xem." /></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] border-collapse text-sm">
                    <thead className="text-[11px] font-black text-slate-500">
                      <tr className="bg-slate-50">
                        <th rowSpan={2} className="sticky left-0 z-20 w-[112px] min-w-[112px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">Mã hàng</th>
                        <th rowSpan={2} className="z-20 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left md:sticky md:left-[112px]">Tên hàng</th>
                        <th rowSpan={2} className="border-b border-r border-slate-200 px-2 py-2 text-left">ĐVT</th>
                        <th colSpan={2} className="border-b border-r border-slate-200 bg-sky-50/70 px-3 py-1.5 text-center text-sky-800">Đầu kỳ</th>
                        <th colSpan={2} className="border-b border-r border-slate-200 bg-leaf-50 px-3 py-1.5 text-center text-leaf-800">Nhập kho</th>
                        <th colSpan={2} className="border-b border-r border-slate-200 bg-teal-50/70 px-3 py-1.5 text-center text-teal-800">Xuất kho</th>
                        <th colSpan={2} className="border-b border-r border-slate-200 bg-mint-50 px-3 py-1.5 text-center text-mint-800">Cuối kỳ</th>
                        {showWarehouseColumn && <th rowSpan={2} className="min-w-[180px] border-b border-slate-200 px-3 py-2 text-left">Tên kho</th>}
                      </tr>
                      <tr className="bg-slate-50">
                        {['sky', 'leaf', 'teal', 'mint'].flatMap(group => [
                          <th key={`${group}-qty`} className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-1.5 text-right font-bold">Số lượng</th>,
                          <th key={`${group}-value`} className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-1.5 text-right font-bold">Giá trị</th>,
                        ])}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {nxtPage.pageRows.map(row => {
                        const negative = isNegativeStock(row);
                        return (
                          <tr key={row.key} onClick={() => openMaterialCard(row)} className="group cursor-pointer hover:bg-slate-50" title="Bấm để xem thẻ kho vật tư">
                            <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 font-mono text-xs font-bold text-mint-700 group-hover:bg-slate-50" title={row.itemMissing ? row.materialId : undefined}>
                              {row.itemMissing ? <span className="text-slate-300">—</span> : row.sku}
                            </td>
                            <td className="z-10 border-r border-slate-100 bg-white px-3 py-2 font-semibold text-slate-800 group-hover:bg-slate-50 md:sticky md:left-[112px]">
                              {row.itemMissing
                                ? <span className="italic text-slate-400" title="Mã còn trên sổ kho nhưng đã bị xóa hoặc gộp trong Danh mục vật tư">{MISSING_ITEM_LABEL}</span>
                                : <span className="line-clamp-2">{row.name}</span>}
                            </td>
                            <td className="border-r border-slate-100 px-2 py-2 text-slate-500">{row.unit || '—'}</td>
                            <NxtQty value={row.openingQty} />
                            <NxtValue qty={row.openingQty} value={row.openingValue} />
                            <NxtQty value={row.inQty} />
                            <NxtValue qty={row.inQty} value={row.inValue} />
                            <NxtQty value={row.outQty} />
                            <NxtValue qty={row.outQty} value={row.outValue} />
                            <NxtQty value={row.closingQty} strong negative={negative} />
                            <NxtValue qty={row.closingQty} value={row.closingValue} strong />
                            {showWarehouseColumn && <td className="px-3 py-2 text-xs font-semibold text-slate-600">{row.warehouseName}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-black text-slate-800">
                      <tr>
                        <td colSpan={3} className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5">Tổng cộng · {visibleNxtRows.length} dòng</td>
                        <td className="px-3 py-2.5" />
                        <td className="border-r border-slate-200 px-3 py-2.5 text-right tabular-nums">{wholeMoney(visibleNxtTotals.openingValue)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="border-r border-slate-200 px-3 py-2.5 text-right tabular-nums text-leaf-700">{wholeMoney(visibleNxtTotals.inValue)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="border-r border-slate-200 px-3 py-2.5 text-right tabular-nums text-teal-700">{wholeMoney(visibleNxtTotals.outValue)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="border-r border-slate-200 px-3 py-2.5 text-right tabular-nums text-mint-700">{wholeMoney(visibleNxtTotals.closingValue)}</td>
                        {showWarehouseColumn && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <PaginationFooter
                  page={nxtPage.page}
                  pageCount={nxtPage.pageCount}
                  pageStart={nxtPage.pageStart}
                  pageEnd={nxtPage.pageEnd}
                  total={nxtPage.total}
                  noun="dòng"
                  onPageChange={nxtPage.setPage}
                />
              </>
            )}
          </div>
        )}

        {activeView === 'material_card' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Thẻ kho theo vật tư</div>
                <h2 className="text-lg font-black text-slate-900">{selectedMaterial ? selectedMaterial.name : 'Chọn vật tư để xem chi tiết'}</h2>
              </div>
              {!ledgerAvailable && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700">
                  Cần apply migration Inventory Ledger để xem từng dòng thẻ kho chuẩn.
                </div>
              )}
            </div>
            <LedgerEntryTable
              entries={filteredLedgerEntries}
              itemById={itemById}
              warehouseById={warehouseById}
              userById={userById}
              renderDocumentButton={renderDocumentButton}
              emptyText={ledgerAvailable ? 'Chưa có phát sinh ledger cho vật tư này.' : 'Ledger chưa sẵn sàng, đang fallback báo cáo tổng hợp.'}
            />
          </div>
        )}

        {activeView === 'warehouse_card' && (
          <div className="p-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400">
                <tr>
                  <th className="p-3">Kho</th>
                  <th className="p-3">Vật tư</th>
                  <th className="p-3 text-right">Nhập</th>
                  <th className="p-3 text-right">Xuất</th>
                  <th className="p-3 text-right">Tồn sau phát sinh gần nhất</th>
                  <th className="p-3">Phát sinh gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {warehousePage.pageRows.map(row => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="p-3 font-black text-slate-800">{row.warehouseName}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-800">{row.materialName}</div>
                      <div className="text-[10px] font-mono text-slate-400">{row.sku} • {row.unit || '-'}</div>
                    </td>
                    <td className="p-3 text-right font-black text-emerald-600">{fmt(row.inQty)}</td>
                    <td className="p-3 text-right font-black text-orange-600">{fmt(row.outQty)}</td>
                    <td className="p-3 text-right font-black text-slate-900">{fmt(row.balanceQty)}</td>
                    <td className="p-3 text-xs font-bold text-slate-500">{row.lastDate ? new Date(row.lastDate).toLocaleString('vi-VN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {warehouseCardRows.length === 0 && (
              <div className="p-16 text-center text-slate-300">
                <Warehouse size={46} className="mx-auto" />
                <p className="mt-3 text-sm font-bold">Chưa có phát sinh kho theo bộ lọc.</p>
              </div>
            )}
            {warehouseCardRows.length > 0 && (
              <PaginationFooter
                page={warehousePage.page}
                pageCount={warehousePage.pageCount}
                pageStart={warehousePage.pageStart}
                pageEnd={warehousePage.pageEnd}
                total={warehousePage.total}
                noun="dòng kho"
                onPageChange={warehousePage.setPage}
              />
            )}
          </div>
        )}

        {activeView === 'history' && (
          <div className="p-5">
            <LedgerEntryTable
              entries={filteredLedgerEntries}
              itemById={itemById}
              warehouseById={warehouseById}
              userById={userById}
              renderDocumentButton={renderDocumentButton}
              emptyText={ledgerAvailable ? 'Chưa có lịch sử giao dịch ledger.' : 'Ledger chưa sẵn sàng, đang fallback báo cáo tổng hợp.'}
            />
          </div>
        )}
      </div>

      {traceEntry && (
        <div className="fixed inset-0 z-[80] bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-300">Truy vết chứng từ</div>
                <h3 className="text-lg font-black">{traceEntry.documentCode}</h3>
              </div>
              <button onClick={() => setTraceEntry(null)} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-bold">Đóng</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TraceField label="Nguồn phát sinh" value={sourceLabel(traceEntry.sourceType)} />
                <TraceField label="Mã nguồn" value={traceEntry.sourceCode || traceEntry.sourceId} mono />
                <TraceField label="Loại giao dịch" value={transactionTypeLabels[traceEntry.transactionType]} />
                <TraceField label="Kho" value={warehouseById.get(traceEntry.warehouseId)?.name || traceEntry.warehouseId} />
                <TraceField label="Vật tư" value={itemById.get(traceEntry.materialId)?.name || traceEntry.materialId} />
                <TraceField label="Người tạo" value={userById.get(traceEntry.createdBy || '')?.name || traceEntry.createdBy || '-'} />
                <TraceField label="Người duyệt" value={userById.get(traceEntry.approvedBy || '')?.name || traceEntry.approvedBy || '-'} />
                <TraceField label="Ngày duyệt/ghi sổ" value={new Date(traceEntry.transactionDate).toLocaleString('vi-VN')} />
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diễn giải</div>
                <div className="mt-1 text-sm font-bold text-slate-700">{traceEntry.description || '-'}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Metadata truy vết</div>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-white p-3 text-[11px] text-slate-600">{JSON.stringify(traceEntry.metadata || {}, null, 2)}</pre>
              </div>
              <div className="flex justify-end gap-2">
                {['wms_transaction', 'purchase_order', 'material_request'].includes(traceEntry.sourceType) && (
                  <button
                    onClick={() => navigate(buildDocumentTracePath(traceEntry.sourceType as 'wms_transaction' | 'purchase_order' | 'material_request', traceEntry.sourceId))}
                    className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100"
                  >
                    <QrCode size={16} /> Trace graph
                  </button>
                )}
                {traceEntry.sourceType === 'wms_transaction' && (
                  <button
                    onClick={() => openSourceDocument(traceEntry)}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
                  >
                    <ExternalLink size={16} /> Mở phiếu WMS
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const NxtQty: React.FC<{ value: number; strong?: boolean; negative?: boolean }> = ({ value, strong, negative }) => (
  <td
    className={`px-3 py-2 text-right tabular-nums ${negative ? 'font-black text-rose-600' : strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}
    title={negative ? 'Âm kho: xuất nhiều hơn nhập, cần kiểm tra phiếu' : undefined}
  >
    {Math.abs(value) < QTY_EPS ? <span className="text-slate-300">–</span> : fmt(value)}
  </td>
);

const NxtValue: React.FC<{ qty: number; value: number; strong?: boolean }> = ({ qty, value, strong }) => (
  <td className={`border-r border-slate-100 px-3 py-2 text-right tabular-nums ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
    {isValueMissing(qty, value)
      ? <span className="whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700" title="Có số lượng nhưng phiếu chưa có đơn giá">Chưa có giá</span>
      : Math.round(value) === 0 ? <span className="text-slate-300">–</span> : wholeMoney(value)}
  </td>
);

const TraceField: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-xl border border-slate-100 bg-white p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
    <div className={`mt-1 text-sm font-black text-slate-800 break-words ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
);

const LedgerEntryTable: React.FC<{
  entries: InventoryLedgerEntry[];
  itemById: Map<string, any>;
  warehouseById: Map<string, any>;
  userById: Map<string, any>;
  renderDocumentButton: (entry: InventoryLedgerEntry) => React.ReactNode;
  emptyText: string;
}> = ({ entries, itemById, warehouseById, userById, renderDocumentButton, emptyText }) => {
  const entryPage = useClientPagination(entries, entries.map(entry => entry.id).join('|'));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-left">
          <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400">
            <tr>
              <th className="p-3">Ngày</th>
              <th className="p-3">Mã phiếu</th>
              <th className="p-3">Loại giao dịch</th>
              <th className="p-3">Kho / Vật tư</th>
              <th className="p-3">Diễn giải</th>
              <th className="p-3 text-right">Nhập</th>
              <th className="p-3 text-right">Xuất</th>
              <th className="p-3 text-right">Tồn sau GD</th>
              <th className="p-3 text-right">Đơn giá</th>
              <th className="p-3 text-right">Thành tiền</th>
              <th className="p-3">Người tạo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {entryPage.pageRows.map(entry => {
              const item = itemById.get(entry.materialId);
              const warehouse = warehouseById.get(entry.warehouseId);
              const creator = userById.get(entry.createdBy || '');
              return (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="p-3 text-xs font-bold text-slate-500 whitespace-nowrap">{new Date(entry.transactionDate).toLocaleString('vi-VN')}</td>
                  <td className="p-3 whitespace-nowrap">{renderDocumentButton(entry)}</td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${getLedgerTypeTone(entry)}`}>
                      {transactionTypeLabels[entry.transactionType] || entry.transactionType}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="font-black text-slate-800">{item?.name || entry.materialId}</div>
                    <div className="text-[10px] font-mono text-slate-400">{item?.sku || entry.materialId} • {warehouse?.name || entry.warehouseId}</div>
                  </td>
                  <td className="p-3 max-w-[260px]">
                    <div className="text-xs font-bold text-slate-700 line-clamp-2">{entry.description || sourceLabel(entry.sourceType)}</div>
                    {entry.relatedRequestId && <div className="mt-1 text-[10px] font-mono text-slate-400">MR: {entry.relatedRequestId.slice(-8)}</div>}
                  </td>
                  <td className="p-3 text-right font-black text-emerald-600">{entry.quantityIn ? fmt(entry.quantityIn) : '-'}</td>
                  <td className="p-3 text-right font-black text-orange-600">{entry.quantityOut ? fmt(entry.quantityOut) : '-'}</td>
                  <td className="p-3 text-right font-black text-slate-900">{fmt(entry.balanceAfterQty)}</td>
                  <td className="p-3 text-right text-slate-500">{money(entry.unitPrice)}</td>
                  <td className="p-3 text-right font-bold text-slate-700">{money(Math.abs(entry.amount))}</td>
                  <td className="p-3 text-xs font-bold text-slate-500">{creator?.name || entry.createdBy || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {entries.length === 0 ? (
        <div className="p-16 text-center text-slate-300">
          <Eye size={46} className="mx-auto" />
          <p className="mt-3 text-sm font-bold">{emptyText}</p>
        </div>
      ) : (
        <PaginationFooter
          page={entryPage.page}
          pageCount={entryPage.pageCount}
          pageStart={entryPage.pageStart}
          pageEnd={entryPage.pageEnd}
          total={entryPage.total}
          noun="giao dịch"
          onPageChange={entryPage.setPage}
        />
      )}
    </div>
  );
};

export default Reports;
