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
  Role,
  TransactionStatus,
  TransactionType,
} from '../types';
import { loadXlsx } from '../lib/loadXlsx';
import { useModuleData } from '../hooks/useModuleData';
import { useInventoryLedger } from '../hooks/useInventoryLedger';
import { buildDocumentTracePath } from '../lib/documentTraceService';

type ReportView = 'summary' | 'material_card' | 'warehouse_card' | 'history';

type StockReportRow = {
  id: string;
  sku: string;
  name: string;
  unit?: string;
  opening: number;
  inImport: number;
  inTransfer: number;
  inAdjustment: number;
  totalIn: number;
  outExport: number;
  outTransfer: number;
  outLiquidation: number;
  totalOut: number;
  closing: number;
  value: number;
};

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
];

const fmt = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} ₫`;
const REPORT_PAGE_SIZE = 10;

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
  const { items, transactions, warehouses, users, user } = useApp();
  useModuleData('wms');

  const isAdmin = user.role === Role.ADMIN;
  const hasAssignedWh = !!user.assignedWarehouseId;
  const assignedWarehouse = warehouses.find(w => w.id === user.assignedWarehouseId);

  const [activeView, setActiveView] = useState<ReportView>('summary');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedWh, setSelectedWh] = useState(user.assignedWarehouseId || 'ALL');
  const [selectedMaterialId, setSelectedMaterialId] = useState('ALL');
  const [selectedType, setSelectedType] = useState<InventoryLedgerTransactionType | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [traceEntry, setTraceEntry] = useState<InventoryLedgerEntry | null>(null);

  const ledgerFilters = useMemo(() => ({
    warehouseId: selectedWh,
    materialId: selectedMaterialId === 'ALL' ? undefined : selectedMaterialId,
    transactionType: selectedType,
    dateFrom: startDate,
    dateTo: endDate,
    search: searchTerm,
    limit: 500,
  }), [endDate, searchTerm, selectedMaterialId, selectedType, selectedWh, startDate]);

  const { entries: ledgerEntries, report: ledgerReport, available: ledgerAvailable, loading: ledgerLoading, error: ledgerError } = useInventoryLedger(ledgerFilters);

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const warehouseById = useMemo(() => new Map(warehouses.map(warehouse => [warehouse.id, warehouse])), [warehouses]);
  const userById = useMemo(() => new Map(users.map(appUser => [appUser.id, appUser])), [users]);

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

  const reportDataFromLedger = useMemo<StockReportRow[]>(() => {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);
    const search = searchTerm.trim().toLowerCase();
    const grouped = new Map<string, StockReportRow>();

    const ensureRow = (materialId: string): StockReportRow => {
      const item = itemById.get(materialId);
      const existing = grouped.get(materialId);
      if (existing) return existing;
      const row: StockReportRow = {
        id: materialId,
        sku: item?.sku || materialId,
        name: item?.name || materialId,
        unit: item?.unit,
        opening: 0,
        inImport: 0,
        inTransfer: 0,
        inAdjustment: 0,
        totalIn: 0,
        outExport: 0,
        outTransfer: 0,
        outLiquidation: 0,
        totalOut: 0,
        closing: 0,
        value: 0,
      };
      grouped.set(materialId, row);
      return row;
    };

    ledgerEntries.forEach(entry => {
      const item = itemById.get(entry.materialId);
      const txDate = new Date(entry.transactionDate);
      if (txDate > end) return;
      if (selectedWh !== 'ALL' && entry.warehouseId !== selectedWh) return;
      if (selectedMaterialId !== 'ALL' && entry.materialId !== selectedMaterialId) return;
      if (search && !`${item?.sku || ''} ${item?.name || ''}`.toLowerCase().includes(search)) return;

      const row = ensureRow(entry.materialId);
      const delta = Number(entry.quantityDelta || 0);
      if (txDate < start) {
        row.opening += delta;
        return;
      }

      if (selectedType !== 'all' && entry.transactionType !== selectedType) return;

      if (entry.movementDirection === 'in') {
        if (entry.transactionType === 'transfer_receipt') row.inTransfer += entry.quantityIn;
        else if (entry.transactionType === 'adjustment_in') row.inAdjustment += entry.quantityIn;
        else row.inImport += entry.quantityIn;
      } else {
        if (entry.transactionType === 'transfer_issue') row.outTransfer += entry.quantityOut;
        else if (entry.transactionType === 'loss_issue' || entry.transactionType === 'adjustment_out') row.outLiquidation += entry.quantityOut;
        else row.outExport += entry.quantityOut;
      }
    });

    grouped.forEach(row => {
      const item = itemById.get(row.id);
      row.totalIn = row.inImport + row.inTransfer + row.inAdjustment;
      row.totalOut = row.outExport + row.outTransfer + row.outLiquidation;
      row.closing = row.opening + row.totalIn - row.totalOut;
      row.value = row.closing * Number(item?.priceIn || 0);
    });

    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [endDate, itemById, ledgerEntries, searchTerm, selectedMaterialId, selectedType, selectedWh, startDate]);

  const fallbackReportData = useMemo<StockReportRow[]>(() => {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);
    const search = searchTerm.trim().toLowerCase();

    return items
      .filter(item => {
        if (hasAssignedWh && user.assignedWarehouseId) return user.assignedWarehouseId in item.stockByWarehouse;
        if (selectedMaterialId !== 'ALL') return item.id === selectedMaterialId;
        return true;
      })
      .map(item => {
        let opening = 0;
        let inImport = 0;
        let inTransfer = 0;
        let inAdjustment = 0;
        let outExport = 0;
        let outTransfer = 0;
        let outLiquidation = 0;

        transactions.forEach(tx => {
          if (tx.status !== TransactionStatus.COMPLETED) return;
          const txDate = new Date(tx.date);
          const txLine = tx.items.find(line => line.itemId === item.id);
          if (!txLine) return;
          const qty = Number(txLine.quantity || 0);
          const isRelatedToWh = selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh || tx.sourceWarehouseId === selectedWh;
          if (!isRelatedToWh) return;

          if (txDate < start) {
            if (tx.type === TransactionType.IMPORT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) opening += qty;
            else if (tx.type === TransactionType.EXPORT && (selectedWh === 'ALL' || tx.sourceWarehouseId === selectedWh)) opening -= qty;
            else if (tx.type === TransactionType.TRANSFER && selectedWh !== 'ALL') {
              if (tx.targetWarehouseId === selectedWh) opening += qty;
              if (tx.sourceWarehouseId === selectedWh) opening -= qty;
            } else if (tx.type === TransactionType.ADJUSTMENT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) opening += qty;
          } else if (txDate <= end) {
            if (tx.type === TransactionType.IMPORT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) inImport += qty;
            else if (tx.type === TransactionType.EXPORT && (selectedWh === 'ALL' || tx.sourceWarehouseId === selectedWh)) outExport += qty;
            else if (tx.type === TransactionType.TRANSFER && selectedWh !== 'ALL') {
              if (tx.targetWarehouseId === selectedWh) inTransfer += qty;
              if (tx.sourceWarehouseId === selectedWh) outTransfer += qty;
            } else if (tx.type === TransactionType.LIQUIDATION && (selectedWh === 'ALL' || tx.sourceWarehouseId === selectedWh)) outLiquidation += qty;
            else if (tx.type === TransactionType.ADJUSTMENT && (selectedWh === 'ALL' || tx.targetWarehouseId === selectedWh)) inAdjustment += qty;
          }
        });

        const totalIn = inImport + inTransfer + inAdjustment;
        const totalOut = outExport + outTransfer + outLiquidation;
        const closing = opening + totalIn - totalOut;
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          opening,
          inImport,
          inTransfer,
          inAdjustment,
          totalIn,
          outExport,
          outTransfer,
          outLiquidation,
          totalOut,
          closing,
          value: closing * Number(item.priceIn || 0),
        };
      })
      .filter(row => !search || `${row.sku} ${row.name}`.toLowerCase().includes(search));
  }, [endDate, hasAssignedWh, items, searchTerm, selectedMaterialId, selectedWh, startDate, transactions, user.assignedWarehouseId]);

  const reportData = ledgerAvailable && ledgerReport ? ledgerReport.stockRows : (ledgerAvailable ? reportDataFromLedger : fallbackReportData);

  const summary = useMemo(() => reportData.reduce(
    (acc, row) => ({
      opening: acc.opening + row.opening,
      closing: acc.closing + row.closing,
      totalValue: acc.totalValue + row.value,
      totalIn: acc.totalIn + row.totalIn,
      totalOut: acc.totalOut + row.totalOut,
    }),
    { opening: 0, closing: 0, totalValue: 0, totalIn: 0, totalOut: 0 },
  ), [reportData]);

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
    ledgerAvailable ? 'ledger' : 'fallback',
  ].join('|');
  const summaryPage = useClientPagination(reportData, paginationResetKey);
  const warehousePage = useClientPagination(warehouseCardRows, paginationResetKey);

  const handleExportExcel = async () => {
    const XLSX = await loadXlsx();
    const data = reportData.map(row => ({
      'Ma SKU': row.sku,
      'Ten vat tu': row.name,
      'DVT': row.unit,
      'Ton dau ky': row.opening,
      'Nhap mua': row.inImport,
      'Nhap chuyen kho': row.inTransfer,
      'Nhap khac': row.inAdjustment,
      'Tong nhap': row.totalIn,
      'Xuat cong trinh': row.outExport,
      'Xuat chuyen kho': row.outTransfer,
      'Xuat hao hut/huy': row.outLiquidation,
      'Tong xuat': row.totalOut,
      'Ton cuoi ky': row.closing,
      'Gia tri ton': row.value,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory Ledger');
    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TheKho_${startDate}_to_${endDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
            {hasAssignedWh && assignedWarehouse && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-400/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-100">
                <Warehouse size={13} /> Phạm vi: {assignedWarehouse.name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center px-4 py-2.5 bg-white/10 text-white rounded-xl hover:bg-white/15 transition font-bold text-sm border border-white/10"
            >
              <Printer size={18} className="mr-2" /> In PDF
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center px-4 py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition font-bold text-sm shadow-lg shadow-emerald-900/20"
            >
              <Download size={18} className="mr-2" /> Xuất Excel
            </button>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
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
              <select disabled={hasAssignedWh || !isAdmin} value={selectedWh} onChange={event => setSelectedWh(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-60">
                {isAdmin && <option value="ALL">Tất cả kho</option>}
                {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
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
            <div className="space-y-1">
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
                placeholder="Tìm mã vật tư, tên vật tư, mã phiếu..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </label>
            <div className="flex items-center gap-2 text-[11px] font-bold">
              {ledgerLoading && <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 size={13} className="animate-spin" /> Đang tải ledger</span>}
              {!ledgerLoading && ledgerAvailable && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 border border-emerald-200">Đang dùng Inventory Ledger</span>}
              {!ledgerLoading && !ledgerAvailable && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 border border-amber-200">Fallback từ transactions cũ</span>}
            </div>
          </div>
          {ledgerError && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} /> {ledgerError}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: 'Tồn đầu kỳ', value: fmt(summary.opening), icon: PieChart, tone: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Tổng nhập', value: fmt(summary.totalIn), icon: ArrowDownLeft, tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Tổng xuất', value: fmt(summary.totalOut), icon: ArrowUpRight, tone: 'text-orange-600 bg-orange-50 border-orange-100' },
          { label: 'Tồn cuối kỳ', value: fmt(summary.closing), icon: Package, tone: 'text-slate-700 bg-slate-50 border-slate-200' },
          { label: 'Giá trị tồn', value: money(summary.totalValue), icon: FileText, tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${card.tone}`}><Icon size={21} /></div>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</div>
                <div className="mt-0.5 text-base font-black text-slate-900 truncate">{card.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-slate-100 bg-slate-50/70">
          {[
            { key: 'summary', label: 'Tổng quan tồn kho', icon: PieChart },
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-left border-collapse">
              <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                <tr>
                  <th className="p-4 sticky left-0 bg-slate-50 z-10 border-r border-slate-100">Vật tư / SKU</th>
                  <th className="p-4 text-right bg-blue-50/40">Tồn đầu kỳ</th>
                  <th className="p-4 text-center">Nhập mua</th>
                  <th className="p-4 text-center">Nhập chuyển</th>
                  <th className="p-4 text-center">Nhập khác</th>
                  <th className="p-4 text-right bg-emerald-50/70 text-emerald-700">Tổng nhập</th>
                  <th className="p-4 text-center">Xuất CT</th>
                  <th className="p-4 text-center">Xuất chuyển</th>
                  <th className="p-4 text-center">Xuất huỷ/hao hụt</th>
                  <th className="p-4 text-right bg-orange-50/70 text-orange-700">Tổng xuất</th>
                  <th className="p-4 text-right bg-slate-900 text-white">Tồn cuối</th>
                  <th className="p-4 text-right">Giá trị</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {summaryPage.pageRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 group">
                    <td className="p-4 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                      <button
                        onClick={() => {
                          setSelectedMaterialId(row.id);
                          setActiveView('material_card');
                        }}
                        className="text-left"
                      >
                        <div className="font-black text-slate-800 hover:text-emerald-700">{row.name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{row.sku} • {row.unit || '-'}</div>
                      </button>
                    </td>
                    <td className="p-4 text-right font-bold text-slate-600 bg-blue-50/10">{fmt(row.opening)}</td>
                    <td className="p-4 text-center text-slate-500">{row.inImport ? fmt(row.inImport) : '-'}</td>
                    <td className="p-4 text-center text-slate-500">{row.inTransfer ? fmt(row.inTransfer) : '-'}</td>
                    <td className="p-4 text-center text-slate-500">{row.inAdjustment ? fmt(row.inAdjustment) : '-'}</td>
                    <td className="p-4 text-right font-black text-emerald-600 bg-emerald-50/20">{fmt(row.totalIn)}</td>
                    <td className="p-4 text-center text-slate-500">{row.outExport ? fmt(row.outExport) : '-'}</td>
                    <td className="p-4 text-center text-slate-500">{row.outTransfer ? fmt(row.outTransfer) : '-'}</td>
                    <td className="p-4 text-center text-slate-500">{row.outLiquidation ? fmt(row.outLiquidation) : '-'}</td>
                    <td className="p-4 text-right font-black text-orange-600 bg-orange-50/20">{fmt(row.totalOut)}</td>
                    <td className="p-4 text-right font-black text-slate-900 bg-slate-100/40">{fmt(row.closing)}</td>
                    <td className="p-4 text-right font-bold text-slate-600">{money(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reportData.length === 0 && (
              <div className="p-20 text-center text-slate-300">
                <Package size={48} className="mx-auto" />
                <p className="mt-4 text-sm font-bold">Không có dữ liệu cho bộ lọc hiện tại.</p>
              </div>
            )}
            {reportData.length > 0 && (
              <PaginationFooter
                page={summaryPage.page}
                pageCount={summaryPage.pageCount}
                pageStart={summaryPage.pageStart}
                pageEnd={summaryPage.pageEnd}
                total={summaryPage.total}
                noun="vật tư"
                onPageChange={summaryPage.setPage}
              />
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
