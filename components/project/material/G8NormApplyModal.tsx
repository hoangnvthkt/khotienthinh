import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, Loader2, Search, Trash2, X } from 'lucide-react';
import type { InventoryItem, ProjectWorkBoqItem } from '../../../types';
import {
    g8NormConsumptionService,
    G8NormApplyPreview,
    G8NormSearchResult,
} from '../../../lib/costNorm/g8NormConsumptionService';
import { resourceTypeLabel } from '../../../lib/costNorm/import/normalize';
import { useToast } from '../../../context/ToastContext';

type G8NormApplyModalProps = {
    workBoqTree: Array<{ item: ProjectWorkBoqItem; level: number }>;
    initialWorkBoqItemId?: string;
    initialMappingId?: string;
    inventoryItems: InventoryItem[];
    canEdit: boolean;
    onClose: () => void;
    onApplied: () => Promise<void> | void;
    formatQuantity: (value: number) => string;
};

const RESOURCE_ORDER = ['material', 'labor', 'machine', 'adjustment', 'other'];

export const G8NormApplyModal: React.FC<G8NormApplyModalProps> = ({
    workBoqTree,
    initialWorkBoqItemId = '',
    initialMappingId = '',
    inventoryItems,
    canEdit,
    onClose,
    onApplied,
    formatQuantity,
}) => {
    const toast = useToast();
    const [workBoqItemId, setWorkBoqItemId] = useState(initialWorkBoqItemId);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<G8NormSearchResult[]>([]);
    const [selectedNorm, setSelectedNorm] = useState<G8NormSearchResult | null>(null);
    const [preview, setPreview] = useState<G8NormApplyPreview | null>(null);
    const [selectedComponentIds, setSelectedComponentIds] = useState<Set<string>>(new Set());
    const [searching, setSearching] = useState(false);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errorText, setErrorText] = useState('');

    const selectedWorkBoqItem = useMemo(
        () => workBoqTree.find(row => row.item.id === workBoqItemId)?.item,
        [workBoqItemId, workBoqTree],
    );

    const groupedComponents = useMemo(() => {
        const groups = new Map<string, G8NormApplyPreview['components']>();
        (preview?.components || []).forEach(component => {
            const rows = groups.get(component.resourceType) || [];
            rows.push(component);
            groups.set(component.resourceType, rows);
        });
        return RESOURCE_ORDER
            .filter(type => groups.has(type))
            .map(type => ({ type, rows: groups.get(type) || [] }));
    }, [preview]);

    useEffect(() => {
        if (!initialMappingId) return;
        let cancelled = false;
        setLoadingPreview(true);
        g8NormConsumptionService.getMappingDetails(initialMappingId)
            .then(details => {
                if (cancelled || !details) return;
                setPreview(details);
                setWorkBoqItemId(details.workBoqItem.id);
                setSelectedNorm({
                    id: details.normItem.id,
                    libraryId: details.library.id,
                    libraryName: details.library.name,
                    libraryCode: details.library.code,
                    code: details.normItem.code,
                    name: details.normItem.name,
                    unit: details.normItem.unit,
                    sourceRowStart: details.normItem.sourceRowStart,
                });
                setQuery(`${details.normItem.code} ${details.normItem.name}`);
                setSelectedComponentIds(new Set(details.components.filter(component => component.selected).map(component => component.componentId)));
            })
            .catch(error => {
                if (!cancelled) setErrorText(error?.message || 'Không tải được định mức đã áp dụng.');
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });
        return () => { cancelled = true; };
    }, [initialMappingId]);

    useEffect(() => {
        if (initialMappingId) return;
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            setSearching(true);
            g8NormConsumptionService.searchActiveNormItems(trimmed)
                .then(rows => {
                    if (!cancelled) setResults(rows);
                })
                .catch(error => {
                    if (!cancelled) setErrorText(error?.message || 'Không tìm được định mức G8.');
                })
                .finally(() => {
                    if (!cancelled) setSearching(false);
                });
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [initialMappingId, query]);

    const loadPreview = async (norm: G8NormSearchResult, nextWorkBoqItemId = workBoqItemId) => {
        if (!nextWorkBoqItemId) {
            setSelectedNorm(norm);
            return;
        }
        setSelectedNorm(norm);
        setLoadingPreview(true);
        setErrorText('');
        try {
            const nextPreview = await g8NormConsumptionService.previewApplyNorm(nextWorkBoqItemId, norm.id);
            setPreview(nextPreview);
            setSelectedComponentIds(new Set(nextPreview.components.filter(component => component.selected).map(component => component.componentId)));
        } catch (error: any) {
            setErrorText(error?.message || 'Không tải được chi tiết định mức.');
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleWorkBoqChange = (value: string) => {
        setWorkBoqItemId(value);
        if (selectedNorm) void loadPreview(selectedNorm, value);
    };

    const toggleComponent = (componentId: string, checked: boolean) => {
        setSelectedComponentIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(componentId);
            else next.delete(componentId);
            return next;
        });
    };

    const handleApply = async () => {
        if (!selectedNorm || !workBoqItemId) {
            setErrorText('Vui lòng chọn đầu mục BOQ và định mức G8.');
            return;
        }
        if (!canEdit) {
            toast.warning('Không có quyền BOQ', 'Bạn cần quyền chỉnh sửa BOQ để áp dụng định mức.');
            return;
        }
        setSaving(true);
        setErrorText('');
        try {
            await g8NormConsumptionService.applyNormToWorkBoq(workBoqItemId, selectedNorm.id, {
                selectedComponentIds: Array.from(selectedComponentIds),
                inventoryItems,
            });
            await onApplied();
            toast.success('Đã áp dụng định mức G8', selectedNorm.code);
            onClose();
        } catch (error: any) {
            setErrorText(error?.message || 'Không áp dụng được định mức G8.');
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async () => {
        const mappingId = preview?.mapping?.id;
        if (!mappingId || !canEdit) return;
        setSaving(true);
        setErrorText('');
        try {
            await g8NormConsumptionService.removeNormMapping(mappingId);
            await onApplied();
            toast.success('Đã gỡ định mức G8', preview?.normItem.code || '');
            onClose();
        } catch (error: any) {
            setErrorText(error?.message || 'Không gỡ được định mức G8.');
        } finally {
            setSaving(false);
        }
    };

    const selectedMaterialCount = preview?.components.filter(component => component.resourceType === 'material' && selectedComponentIds.has(component.componentId)).length || 0;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/45 px-3 py-6 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div className="min-w-0">
                        <h3 className="flex items-center gap-2 text-base font-black text-slate-800 dark:text-white">
                            <BookOpen size={18} className="text-indigo-500" /> Thêm định mức G8
                        </h3>
                        <p className="mt-1 text-[10px] font-bold text-slate-400">
                            {selectedWorkBoqItem ? `${selectedWorkBoqItem.wbsCode || ''} ${selectedWorkBoqItem.name}`.trim() : 'Chọn đầu mục BOQ triển khai'}
                        </p>
                    </div>
                    <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X size={18} />
                    </button>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
                    <aside className="space-y-4 overflow-y-auto border-b border-slate-100 p-4 dark:border-slate-800 lg:border-b-0 lg:border-r">
                        <div>
                            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">Đầu mục BOQ</label>
                            <select
                                value={workBoqItemId}
                                onChange={event => handleWorkBoqChange(event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800"
                            >
                                <option value="">Chọn đầu mục...</option>
                                {workBoqTree.map(({ item, level }) => (
                                    <option key={item.id} value={item.id}>
                                        {`${'— '.repeat(level)}${item.wbsCode || ''} ${item.name} (${formatQuantity(Number(item.plannedQty || 0))} ${item.unit || ''})`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">Tìm định mức G8</label>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                                <input
                                    value={query}
                                    onChange={event => setQuery(event.target.value)}
                                    placeholder="AF.11111, bê tông..."
                                    className="w-full rounded-xl border border-indigo-200 bg-indigo-50/40 py-2.5 pl-9 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-900 dark:bg-slate-800"
                                />
                                {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-400" />}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {results.map(result => (
                                <button
                                    key={result.id}
                                    type="button"
                                    onClick={() => loadPreview(result)}
                                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                                        selectedNorm?.id === result.id
                                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                    }`}
                                >
                                    <div className="font-mono text-xs font-black">{result.code}</div>
                                    <div className="mt-0.5 line-clamp-2 text-xs font-bold">{result.name}</div>
                                    <div className="mt-1 text-[10px] font-bold text-slate-400">{result.libraryName} • {result.unit || '-'}</div>
                                </button>
                            ))}
                            {!initialMappingId && query.trim() && !searching && results.length === 0 && (
                                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400 dark:border-slate-700">
                                    Không tìm thấy định mức active
                                </div>
                            )}
                        </div>
                    </aside>

                    <main className="min-h-0 overflow-y-auto bg-slate-50/60 p-4 dark:bg-slate-950/40">
                        {errorText && (
                            <div className="mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900/50 dark:bg-red-950/30">
                                {errorText}
                            </div>
                        )}

                        {loadingPreview ? (
                            <div className="flex min-h-[360px] items-center justify-center text-sm font-bold text-slate-400">
                                <Loader2 size={18} className="mr-2 animate-spin text-indigo-500" /> Đang tải định mức...
                            </div>
                        ) : preview ? (
                            <div className="space-y-4">
                                <div className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0">
                                            <div className="font-mono text-sm font-black text-indigo-600">{preview.normItem.code}</div>
                                            <h4 className="mt-1 text-lg font-black text-slate-800 dark:text-white">{preview.normItem.name}</h4>
                                            <div className="mt-1 text-xs font-bold text-slate-400">
                                                {preview.library.name} • KL BOQ {formatQuantity(Number(preview.workBoqItem.plannedQty || 0))} {preview.workBoqItem.unit || ''}
                                            </div>
                                            <div className="mt-2 text-xs font-bold text-indigo-600">
                                                Định mức hao phí được hiểu cho 1 {preview.normItem.unit || preview.workBoqItem.unit || 'đơn vị'} công tác {preview.normItem.code}.
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                            <div className="rounded-xl bg-indigo-50 px-3 py-2 text-center">
                                                <div className="text-[9px] font-black uppercase text-indigo-400">Vật liệu chọn</div>
                                                <div className="text-lg font-black text-indigo-700">{selectedMaterialCount}</div>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 px-3 py-2 text-center dark:bg-slate-800">
                                                <div className="text-[9px] font-black uppercase text-slate-400">Dòng hao phí</div>
                                                <div className="text-lg font-black text-slate-700 dark:text-white">{preview.components.length}</div>
                                            </div>
                                            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
                                                <div className="text-[9px] font-black uppercase text-emerald-500">Mapping</div>
                                                <div className="text-lg font-black text-emerald-700">{preview.mapping?.status === 'active' ? 'Có' : 'Mới'}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {groupedComponents.map(group => (
                                    <section key={group.type} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                                            <h5 className="text-xs font-black uppercase text-slate-500">{resourceTypeLabel(group.type as any)}</h5>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800">{group.rows.length} dòng</span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full min-w-[760px] text-xs">
                                                <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 dark:bg-slate-800/60">
                                                    <tr>
                                                        <th className="w-12 px-3 py-2 text-center">Chọn</th>
                                                        <th className="px-3 py-2 text-left">Nguồn lực</th>
                                                        <th className="px-3 py-2 text-center">ĐVT</th>
                                                        <th className="px-3 py-2 text-right">Định mức hao phí</th>
                                                        <th className="px-3 py-2 text-right">KL BOQ × ĐM</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {group.rows.map(component => (
                                                        <tr key={component.componentId} className="hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20">
                                                            <td className="px-3 py-2 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedComponentIds.has(component.componentId)}
                                                                    onChange={event => toggleComponent(component.componentId, event.target.checked)}
                                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <div className="font-bold text-slate-800 dark:text-white">{component.resourceName}</div>
                                                                <div className="mt-0.5 font-mono text-[10px] font-bold text-slate-400">{component.resourceCode || '-'}</div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center font-bold text-slate-500">{component.unit || '-'}</td>
                                                            <td className="px-3 py-2 text-right font-black text-slate-700 dark:text-slate-200">{formatQuantity(component.coefficient)}</td>
                                                            <td className="px-3 py-2 text-right font-black text-indigo-600">{formatQuantity(component.estimatedQty)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>
                                ))}
                            </div>
                        ) : (
                            <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                                Chọn định mức G8 để xem hao phí
                            </div>
                        )}
                    </main>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400">
                        {preview ? `Sinh vật tư từ ${selectedMaterialCount} dòng vật liệu đã chọn.` : ''}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {preview?.mapping?.id && canEdit && (
                            <button
                                type="button"
                                onClick={handleRemove}
                                disabled={saving}
                                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-600 hover:bg-red-100 disabled:opacity-50"
                            >
                                <Trash2 size={14} /> Gỡ định mức
                            </button>
                        )}
                        <button onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Huỷ</button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={saving || !preview || !workBoqItemId || selectedMaterialCount === 0}
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Áp dụng định mức
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
