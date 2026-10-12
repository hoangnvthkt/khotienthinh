import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Package, Plus, X, Search } from 'lucide-react';
import type {
    MaterialAggregateSummaryRow,
    MaterialBudgetItem,
} from '../../../types';

const PAGE_SIZE = 10;

type MaterialSummaryTabProps = {
    materialRows: MaterialAggregateSummaryRow[];
    /** Vật tư BOQ vượt ngân sách (lũy kế yêu cầu > ngân sách), nặng nhất trước. */
    overBudgetItems: MaterialBudgetItem[];
    /** Vật tư BOQ vượt ngưỡng hao hụt, nặng nhất trước. */
    overWasteItems: MaterialBudgetItem[];
    /** Bảng điều khiển → Vật tư lọc dự án này (đối chiếu nhập – xuất – tồn theo chứng từ). */
    dashboardLink?: string | null;
    selectedMaterialGroupKeys: Set<string>;
    canCreateMaterialRequest: boolean;
    onToggleMaterialGroup: (rowKey: string, checked: boolean) => void;
    onCreateRequestFromSelection: () => void;
    onClearSelection: () => void;
    formatQuantity: (value: number) => string;
    formatPercent: (value: number) => string;
    formatMoneyShort: (value: number) => string;
};

const formatDate = (value?: string | null) => value ? value.slice(0, 10).split('-').reverse().join('/') : '-';

const warningTone = (row: MaterialAggregateSummaryRow) => {
    if (row.remainingBoqQty < 0) return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50';
    if (row.shortageQty['7d'] > 0) return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50';
    if (row.shortageQty['30d'] > 0) return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50';
};

export const MaterialSummaryTab: React.FC<MaterialSummaryTabProps> = ({
    materialRows,
    overBudgetItems,
    overWasteItems,
    dashboardLink = null,
    selectedMaterialGroupKeys,
    canCreateMaterialRequest,
    onToggleMaterialGroup,
    onCreateRequestFromSelection,
    onClearSelection,
    formatQuantity,
    formatPercent,
    formatMoneyShort,
}) => {
    const [page, setPage] = useState(1);
    const [attention, setAttention] = useState<'budget' | 'waste' | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [vattuWidth, setVattuWidth] = useState(180);
    const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!resizingRef.current) return;
        const deltaX = e.clientX - resizingRef.current.startX;
        const newWidth = Math.max(120, resizingRef.current.startWidth + deltaX);
        setVattuWidth(newWidth);
    }, []);

    const handleMouseUp = useCallback(() => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        resizingRef.current = {
            startX: e.clientX,
            startWidth: vattuWidth,
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [vattuWidth, handleMouseMove, handleMouseUp]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);
    const removeVietnameseTones = useCallback((str: string): string => {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase();
    }, []);

    const filteredRows = useMemo(() => {
        if (!searchQuery.trim()) return materialRows;
        const terms = removeVietnameseTones(searchQuery).split(/\s+/).filter(Boolean);
        return materialRows.filter(row => {
            const combinedText = removeVietnameseTones(`${row.itemName || ''} ${row.sku || ''} ${row.unit || ''}`);
            return terms.every(term => combinedText.includes(term));
        });
    }, [materialRows, searchQuery, removeVietnameseTones]);

    const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    const pageItems = useMemo(
        () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filteredRows, page],
    );
    const selectedCount = selectedMaterialGroupKeys.size;
    const selectedRows = useMemo(
        () => materialRows.filter(row => selectedMaterialGroupKeys.has(row.key)),
        [materialRows, selectedMaterialGroupKeys],
    );
    const selectedReadyCount = selectedRows.filter(row => row.inventoryItemId).length;
    const selectedMissingInventoryCount = selectedRows.length - selectedReadyCount;
    const pageStart = filteredRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const pageEnd = Math.min(filteredRows.length, (page - 1) * PAGE_SIZE + pageItems.length);

    useEffect(() => {
        setPage(1);
    }, [materialRows, searchQuery]);

    useEffect(() => {
        if (page > pageCount) setPage(pageCount);
    }, [page, pageCount]);

    const toggleExpanded = (rowKey: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(rowKey)) next.delete(rowKey);
            else next.add(rowKey);
            return next;
        });
    };

    const renderWarning = (row: MaterialAggregateSummaryRow) => {
        const label = row.remainingBoqQty < 0
            ? 'Vượt Tổng BOQ'
            : row.shortageQty['7d'] > 0
                ? 'Thiếu 7D'
                : row.shortageQty['30d'] > 0
                    ? 'Thiếu 30D'
                    : row.warnings.length > 0
                        ? row.warnings[0]
                        : 'OK';
        return (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${warningTone(row)}`}>
                {label !== 'OK' && <AlertTriangle size={9} />}
                {label}
            </span>
        );
    };

    return (
        <div className="space-y-4">
            {/* Cần chú ý: vật tư vượt ngân sách / vượt hao hụt (trước là tab Hao hụt + Dashboard). Đối chiếu nhập – xuất – tồn theo chứng từ ở Bảng điều khiển. */}
            <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cần chú ý</span>
                        {overBudgetItems.length === 0 && overWasteItems.length === 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Không có vật tư vượt ngân sách hoặc vượt hao hụt</span>
                        ) : (<>
                            {overBudgetItems.length > 0 && <button type="button" aria-expanded={attention === 'budget'}
                                onClick={() => setAttention(current => current === 'budget' ? null : 'budget')}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-default disabled:opacity-60 ${attention === 'budget' ? 'border-rose-400 bg-rose-100 text-rose-800' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'}`}>
                                <AlertTriangle size={12} /> Vượt ngân sách <span className="tabular-nums">{overBudgetItems.length}</span>
                            </button>}
                            {overWasteItems.length > 0 && <button type="button" aria-expanded={attention === 'waste'}
                                onClick={() => setAttention(current => current === 'waste' ? null : 'waste')}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-default disabled:opacity-60 ${attention === 'waste' ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                                <AlertTriangle size={12} /> Vượt hao hụt <span className="tabular-nums">{overWasteItems.length}</span>
                            </button>}
                        </>)}
                    </div>
                    {dashboardLink && (
                        <a href={dashboardLink} title="Bảng điều khiển → Vật tư, lọc dự án này"
                            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-zinc-700 dark:text-zinc-200 md:self-auto">
                            Nhập – xuất – tồn theo chứng từ <ExternalLink size={12} className="text-zinc-400" />
                        </a>
                    )}
                </div>
                {attention && (
                    <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-800">
                        <table className="w-full min-w-[520px] text-xs">
                            <thead className="bg-zinc-50 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800/60">
                                {attention === 'budget' ? (
                                    <tr><th className="px-3 py-2 text-left">Vật tư</th><th className="px-3 py-2 text-right">Ngân sách</th><th className="px-3 py-2 text-right">Lũy kế yêu cầu</th><th className="px-3 py-2 text-right">Vượt</th></tr>
                                ) : (
                                    <tr><th className="px-3 py-2 text-left">Vật tư</th><th className="px-3 py-2 text-right">Hao hụt</th><th className="px-3 py-2 text-right">Ngưỡng</th><th className="px-3 py-2 text-right">Giá trị hao hụt</th></tr>
                                )}
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {attention === 'budget' ? overBudgetItems.map(item => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{item.itemName} <span className="text-zinc-400">{item.unit}</span></td>
                                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(item.budgetQty)}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatQuantity(item.cumulativeRequested || 0)}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-700">+{formatPercent(item.budgetOverPercent || 0)}%</td>
                                    </tr>
                                )) : overWasteItems.map(item => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{item.itemName} <span className="text-zinc-400">{item.unit}</span></td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{formatPercent(item.wastePercent || 0)}%</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{formatQuantity(item.wasteThreshold)}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{formatMoneyShort(Math.abs(item.wasteValue || 0))} đ</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        <Package size={15} className="text-teal-700 dark:text-teal-400" /> Nhu cầu & dự báo cung ứng
                    </h4>
                    <p className="mt-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">Đề xuất mới tạo ngoài BOQ theo mã vật tư tổng hợp, khối lượng nhập thủ công.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Ô tìm kiếm linh hoạt */}
                    <div className="relative w-64">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400 pointer-events-none">
                            <Search size={14} />
                        </span>
                        <input
                            type="text"
                            placeholder="Tìm kiếm vật tư, SKU..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl border border-zinc-200 bg-white placeholder-zinc-400 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {selectedCount} vật tư đã chọn
                    </span>
                    {selectedMissingInventoryCount > 0 && (
                        <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            {selectedMissingInventoryCount} chưa có mã kho
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onCreateRequestFromSelection}
                        disabled={!canCreateMaterialRequest || selectedReadyCount === 0}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 px-3 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={14} /> Tạo đề xuất
                    </button>
                    <button
                        type="button"
                        onClick={onClearSelection}
                        disabled={selectedCount === 0}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        <X size={14} /> Bỏ chọn
                    </button>
                </div>
            </div>

            <div className="grid gap-3 p-3 md:hidden">
                {pageItems.map(row => {
                    const expanded = expandedRows.has(row.key);
                    const checked = selectedMaterialGroupKeys.has(row.key);
                    return (
                        <div key={row.key} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                            <div className="flex items-start gap-3">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!row.inventoryItemId && !checked}
                                    onChange={event => onToggleMaterialGroup(row.key, event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-teal-700 focus:ring-teal-500 disabled:opacity-40"
                                />
                                <button type="button" onClick={() => toggleExpanded(row.key)} className="mt-0.5 rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <div className="font-mono text-[10px] font-semibold text-teal-700 dark:text-teal-400">{row.sku || 'Chưa có SKU'}</div>
                                    <h5 className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{row.itemName}</h5>
                                    <p className="mt-0.5 text-[10px] font-medium text-zinc-400">{row.unit}</p>
                                </div>
                                {renderWarning(row)}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-medium text-zinc-500">
                                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800"><span className="block text-zinc-400">Tổng BOQ</span>{formatQuantity(row.totalBoqQty)}</div>
                                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800"><span className="block text-zinc-400">LK yêu cầu</span>{formatQuantity(row.cumulativeRequested)}</div>
                                <div className={`rounded-lg p-2 ${row.remainingBoqQty < 0 ? 'bg-red-50 text-red-700 dark:bg-red-950/30' : 'bg-zinc-50 dark:bg-zinc-800'}`}><span className="block text-zinc-400">Còn cần</span>{formatQuantity(row.remainingBoqQty)}</div>
                                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800"><span className="block text-zinc-400">Tồn kho</span>{formatQuantity(row.stockBalance)}</div>
                            </div>
                            {expanded && (
                                <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                                    {row.details.map(detail => (
                                        <div key={detail.id} className="rounded-lg bg-zinc-50 p-2 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                                            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{detail.taskName}</div>
                                            <div className="mt-1 flex flex-wrap gap-2">
                                                <span>{detail.wbsCode || '-'}</span>
                                                <span>Ngày cần {formatDate(detail.needDate)}</span>
                                                <span>Còn cần KH {formatQuantity(detail.remainingDemandQty)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1500px] text-left">
                    <thead>
                        <tr className="bg-zinc-900 dark:bg-zinc-800 text-[11px] font-semibold uppercase tracking-wider text-zinc-100 border-b border-zinc-700">
                            <th 
                                className="sticky left-0 z-10 bg-zinc-900 dark:bg-zinc-800 py-3 px-2.5 font-semibold whitespace-nowrap text-left relative select-none group border-r border-zinc-700"
                                style={{ width: vattuWidth, minWidth: vattuWidth, maxWidth: vattuWidth }}
                            >
                                <div className="flex items-center justify-between">
                                    <span>Vật tư</span>
                                </div>
                                <div
                                    onMouseDown={handleMouseDown}
                                    className="absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize bg-zinc-700 opacity-40 hover:opacity-100 group-hover:opacity-100 hover:bg-white active:bg-white active:w-[6px] transition-all z-20"
                                    title="Kéo để đổi độ rộng cột Vật tư"
                                />
                            </th>
                            <th className="py-3 px-2.5 text-center whitespace-nowrap">ĐVT</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">Tổng BOQ</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">LK yêu cầu</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">Còn cần</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">LK nhập</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">LK xuất</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">Tồn kho</th>
                            <th className="py-3 px-2.5 text-center whitespace-nowrap">Ngày thi công</th>
                            <th className="py-3 px-2.5 text-center whitespace-nowrap">Ngày cần</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">7D</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">30D</th>
                            <th className="py-3 px-2.5 text-right whitespace-nowrap">90D</th>
                            <th className="py-3 px-2.5 whitespace-nowrap">Cảnh báo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
                        {pageItems.map(row => {
                            const expanded = expandedRows.has(row.key);
                            const checked = selectedMaterialGroupKeys.has(row.key);
                            return (
                                <React.Fragment key={row.key}>
                                    <tr className={`${row.remainingBoqQty < 0 ? 'bg-red-50/40 dark:bg-red-950/15' : row.shortageQty['7d'] > 0 ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''} hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors`}>
                                        <td 
                                            className="sticky left-0 z-10 bg-white p-2.5 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800"
                                            style={{ width: vattuWidth, minWidth: vattuWidth, maxWidth: vattuWidth }}
                                        >
                                            <div className="flex items-start gap-2 min-w-0 w-full">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={!row.inventoryItemId && !checked}
                                                    onChange={event => onToggleMaterialGroup(row.key, event.target.checked)}
                                                    title={row.inventoryItemId ? 'Chọn vật tư tạo đề xuất ngoài BOQ' : 'Cần liên kết mã kho trước khi tạo đề xuất'}
                                                    className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300 text-teal-700 focus:ring-teal-500 disabled:opacity-40"
                                                />
                                                <button type="button" onClick={() => toggleExpanded(row.key)} className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </button>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate font-semibold text-zinc-900 dark:text-zinc-100" title={row.itemName}>{row.itemName}</div>
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-zinc-400">
                                                        <span className="font-mono text-teal-700 dark:text-teal-400">{row.sku || 'Chưa có SKU'}</span>
                                                        <span className="shrink-0">{row.details.length} đầu mục</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-2.5 text-center font-medium text-zinc-600 dark:text-zinc-400">{row.unit || '-'}</td>
                                        <td className="p-2.5 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                                            {formatQuantity(row.totalBoqQty)}
                                            <div className="text-[9px] font-medium text-zinc-400">{formatMoneyShort(row.totalBoqValue)}</div>
                                        </td>
                                        <td className="p-2.5 text-right font-semibold text-teal-700 dark:text-teal-400">
                                            {formatQuantity(row.cumulativeRequested)}
                                            <div className="text-[9px] font-medium text-zinc-400">{formatPercent(row.requestedPercent)}%</div>
                                        </td>
                                        <td className={`p-2.5 text-right font-semibold ${row.remainingBoqQty < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{formatQuantity(row.remainingBoqQty)}</td>
                                        <td className="p-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400">{formatQuantity(row.cumulativeImported)}</td>
                                        <td className="p-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400">{formatQuantity(row.cumulativeExported)}</td>
                                        <td className={`p-2.5 text-right font-semibold ${row.stockBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-teal-700 dark:text-teal-400'}`}>{formatQuantity(row.stockBalance)}</td>
                                        <td className="p-2.5 text-center font-medium text-zinc-500 dark:text-zinc-400">{formatDate(row.startDate)} - {formatDate(row.endDate)}</td>
                                        <td className="p-2.5 text-center font-medium text-zinc-900 dark:text-zinc-100">{formatDate(row.needDate)}</td>
                                        <td className="p-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400">{formatQuantity(row.demandQty['7d'])}</td>
                                        <td className="p-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400">{formatQuantity(row.demandQty['30d'])}</td>
                                        <td className="p-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400">{formatQuantity(row.demandQty['90d'])}</td>
                                        <td className="p-2.5">{renderWarning(row)}</td>
                                    </tr>
                                    {expanded && (
                                        <tr className="bg-zinc-50/70 dark:bg-zinc-900/40">
                                            <td colSpan={14} className="px-10 py-3">
                                                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                                                    <table className="w-full min-w-[980px] text-[11px]">
                                                        <thead className="bg-zinc-100 text-[10px] font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left">Đầu mục triển khai</th>
                                                                <th className="px-3 py-2 text-left">Vật tư BOQ</th>
                                                                <th className="px-3 py-2 text-center">Ngày thi công</th>
                                                                <th className="px-3 py-2 text-center">Ngày cần</th>
                                                                <th className="px-3 py-2 text-right">Tổng BOQ</th>
                                                                <th className="px-3 py-2 text-right">LK yêu cầu</th>
                                                                <th className="px-3 py-2 text-right">Còn cần KH</th>
                                                                <th className="px-3 py-2 text-right">7D</th>
                                                                <th className="px-3 py-2 text-right">30D</th>
                                                                <th className="px-3 py-2 text-right">90D</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                                            {row.details.map(detail => (
                                                                <tr key={detail.id}>
                                                                    <td className="px-3 py-2">
                                                                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{detail.taskName}</div>
                                                                        <div className="font-mono text-[9px] font-semibold text-teal-700 dark:text-teal-400">{detail.wbsCode || '-'}</div>
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{detail.itemName}</div>
                                                                        <div className="font-mono text-[9px] font-medium text-zinc-400">{detail.materialCode || '-'}</div>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-center text-zinc-500">{formatDate(detail.startDate)} - {formatDate(detail.endDate)}</td>
                                                                    <td className="px-3 py-2 text-center font-semibold text-zinc-900 dark:text-zinc-100">{formatDate(detail.needDate)}</td>
                                                                    <td className="px-3 py-2 text-right font-semibold text-zinc-900 dark:text-zinc-100">{formatQuantity(detail.budgetQty)}</td>
                                                                    <td className="px-3 py-2 text-right font-semibold text-teal-700 dark:text-teal-400">{formatQuantity(detail.cumulativeRequested)}</td>
                                                                    <td className="px-3 py-2 text-right font-semibold text-zinc-900 dark:text-zinc-100">{formatQuantity(detail.remainingDemandQty)}</td>
                                                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatQuantity(detail.demandQty['7d'])}</td>
                                                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatQuantity(detail.demandQty['30d'])}</td>
                                                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatQuantity(detail.demandQty['90d'])}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {filteredRows.length === 0 && (
                            <tr>
                                <td colSpan={14} className="px-6 py-12 text-center">
                                    <Package size={32} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                                    {materialRows.length === 0 ? (
                                        <>
                                            <div className="text-sm font-semibold text-zinc-400">Chưa có dữ liệu vật tư BOQ</div>
                                            <div className="mt-1 text-[10px] font-medium text-zinc-400">Đồng bộ hoặc import BOQ triển khai để có tổng định mức vật tư.</div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-sm font-semibold text-zinc-400">Không tìm thấy vật tư phù hợp</div>
                                            <div className="mt-1 text-[10px] font-medium text-zinc-400">Vui lòng thử lại với từ khóa khác.</div>
                                        </>
                                    )}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-medium text-zinc-500">
                    Đang xem {pageStart}-{pageEnd} trên {filteredRows.length} vật tư
                    {searchQuery && ` (tìm thấy từ ${materialRows.length})`}
                </div>
                <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setPage(prev => Math.max(1, prev - 1))} disabled={page <= 1} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                        <ChevronLeft size={14} /> Trước
                    </button>
                    <span className="min-w-[82px] text-center text-xs font-semibold text-zinc-500">{page}/{pageCount}</span>
                    <button type="button" onClick={() => setPage(prev => Math.min(pageCount, prev + 1))} disabled={page >= pageCount} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                        Sau <ChevronRight size={14} />
                    </button>
                </div>
            </div>
            </section>
        </div>
    );
};
