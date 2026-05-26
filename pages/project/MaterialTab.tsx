import React, { useState, useMemo, useEffect, useRef } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import SupplyChainTab from './SupplyChainTab';
import {
    Plus, Edit2, Trash2, X, Save, Package, AlertTriangle, TrendingUp,
    CheckCircle2, Clock, Ban, FileCheck, ChevronDown, ChevronUp,
    BarChart3, Search, Truck, ArrowRight, RefreshCcw, Download, Upload,
    FileSpreadsheet, GitBranch, ListTree, MinusCircle
} from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { MaterialBudgetItem, InventoryItem, MaterialRequest, RequestStatus, ProjectTask, ProjectWorkBoqItem, ContractItem, TaskContractItem, MaterialRequestFulfillmentSummary } from '../../types';
import { boqService, taskService, workBoqService, WorkBoqSyncPreview } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { useApp } from '../../context/AppContext';
import RequestModal from '../../components/RequestModal';
import BoqReconciliationPanel from '../../components/project/BoqReconciliationPanel';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { taskContractItemService } from '../../lib/taskContractItemService';
import { contractItemService } from '../../lib/contractItemService';
import { loadXlsx } from '../../lib/loadXlsx';

interface MaterialTabProps {
    constructionSiteId?: string;
    projectId?: string;
    siteWarehouseId?: string; // ID kho công trường
    canManageTab?: boolean;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

const REQ_STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    PENDING: { label: 'Chờ duyệt', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <Clock size={12} /> },
    APPROVED: { label: 'Chờ xuất kho', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: <CheckCircle2 size={12} /> },
    IN_TRANSIT: { label: 'Đang giao', color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200', icon: <Truck size={12} /> },
    COMPLETED: { label: 'Đã nhận', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <FileCheck size={12} /> },
    REJECTED: { label: 'Từ chối', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <Ban size={12} /> },
};

type WorkBoqImportPreview = {
    workRows: Array<{ rowNumber: number; item: ProjectWorkBoqItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
    materialRows: Array<{ rowNumber: number; item: MaterialBudgetItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
};

const importNumber = (value: unknown) => {
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return 0;
    let normalized = raw;
    if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
};

const normalizeKey = (value?: string | null) => String(value || '').trim().toLowerCase();
const isValidWbsCode = (value: string) => /^\d+(\.\d+)*$/.test(value.trim());

const summarizeSync = (preview: WorkBoqSyncPreview) =>
    `Thêm mới ${preview.created}, cập nhật ${preview.updated}, bỏ qua ${preview.skipped}, đánh dấu orphan ${preview.orphaned}.`;

const MaterialTab: React.FC<MaterialTabProps> = ({ constructionSiteId, projectId, siteWarehouseId, canManageTab = true }) => {
    const { items: inventoryItems, requests: allRequests, warehouses, users, loadModuleData } = useApp();
    const toast = useToast();
    const confirm = useConfirm();
    const effectiveId = projectId || constructionSiteId || '';
    const [activeSubTab, setActiveSubTab] = useState<'summary' | 'boq' | 'request' | 'po' | 'waste' | 'dashboard'>('summary');

    // BOQ Data
    const [boqItems, setBoqItems] = useState<MaterialBudgetItem[]>([]);
    const [workBoqItems, setWorkBoqItems] = useState<ProjectWorkBoqItem[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [contractItems, setContractItems] = useState<ContractItem[]>([]);
    const [taskContractLinks, setTaskContractLinks] = useState<Record<string, string[]>>({});
    const [syncingBoq, setSyncingBoq] = useState(false);
    const [importPreview, setImportPreview] = useState<WorkBoqImportPreview | null>(null);
    const [importingBoq, setImportingBoq] = useState(false);
    const boqImportRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadModuleData('wms');
    }, [loadModuleData]);

    // Resolve siteWarehouseId: use prop or find warehouse named 'RICO'
    const resolvedWhId = useMemo(() => {
        if (siteWarehouseId) return siteWarehouseId;
        const ricoWh = warehouses.find(w => w.name.toUpperCase().includes('RICO'));
        return ricoWh?.id || 'wh-1';
    }, [siteWarehouseId, warehouses]);

    // Material Requests — filtered to this site's warehouse
    const requests = useMemo(() => {
        const scoped = allRequests.filter(r => {
            const projectMatch = projectId && r.projectId === projectId;
            const siteMatch = constructionSiteId && r.constructionSiteId === constructionSiteId;
            if (r.requestOrigin === 'project' || r.projectId || r.constructionSiteId) return !!(projectMatch || siteMatch);
            return r.siteWarehouseId === resolvedWhId;
        });
        return scoped;
    }, [allRequests, constructionSiteId, projectId, resolvedWhId]);

    // Request Modal state
    const [isReqModalOpen, setReqModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);
    const [requestFulfillmentSummaries, setRequestFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});
    const [requestFulfillmentBatchCounts, setRequestFulfillmentBatchCounts] = useState<Record<string, number>>({});

    const loadBoqData = async () => {
        if (!effectiveId) return;
        const [boq, workItems, taskRows, contractRows, linkRows] = await Promise.all([
            boqService.list(effectiveId, constructionSiteId || null),
            workBoqService.list(effectiveId, constructionSiteId || null),
            taskService.list(effectiveId, constructionSiteId || null),
            contractItemService.listBySite(effectiveId, 'customer', constructionSiteId || null),
            taskContractItemService.listBySite(effectiveId, constructionSiteId || null),
        ]);
        setBoqItems(boq);
        setWorkBoqItems(workItems);
        setTasks(taskRows);
        setContractItems(contractRows);
        setTaskContractLinks(linkRows.reduce<Record<string, string[]>>((acc, link: TaskContractItem) => {
            if (!acc[link.taskId]) acc[link.taskId] = [];
            acc[link.taskId].push(link.contractItemId);
            return acc;
        }, {}));
    };

    useEffect(() => {
        loadBoqData().catch(console.error);
    }, [effectiveId, constructionSiteId]);

    useEffect(() => {
        let cancelled = false;
        const loadFulfillment = async () => {
            if (requests.length === 0) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
                return;
            }
            const batchesByRequest = await materialRequestFulfillmentService.listByRequests(requests.map(req => req.id));
            if (cancelled) return;
            const summaries = requests.reduce<Record<string, MaterialRequestFulfillmentSummary>>((acc, req) => {
                acc[req.id] = materialRequestFulfillmentService.summarizeRequest(req, batchesByRequest[req.id] || []);
                return acc;
            }, {});
            const counts = requests.reduce<Record<string, number>>((acc, req) => {
                acc[req.id] = (batchesByRequest[req.id] || []).length;
                return acc;
            }, {});
            setRequestFulfillmentSummaries(summaries);
            setRequestFulfillmentBatchCounts(counts);
        };
        loadFulfillment().catch(err => {
            console.warn('Failed to load material request fulfillment summaries:', err);
            if (!cancelled) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
            }
        });
        return () => { cancelled = true; };
    }, [requests]);

    const [showBoqForm, setShowBoqForm] = useState(false);
    const [editingBoq, setEditingBoq] = useState<MaterialBudgetItem | null>(null);
    // Unused old state removed — now using RequestModal from inventory module

    // BOQ Form
    const [bCat, setBCat] = useState('Vật liệu xây dựng');
    const [bName, setBName] = useState('');
    const [bUnit, setBUnit] = useState('');
    const [bBudgetQty, setBBudgetQty] = useState('');
    const [bPrice, setBPrice] = useState('');
    const [bThreshold, setBThreshold] = useState('5');
    const [bNotes, setBNotes] = useState('');
    const [bInventoryItemId, setBInventoryItemId] = useState('');
    const [bMaterialCode, setBMaterialCode] = useState('');
    const [bWorkBoqItemId, setBWorkBoqItemId] = useState('');

    const ensureCanManage = (action: string) => {
        if (canManageTab) return true;
        toast.warning('Không có quyền quản trị tab', `Bạn cần quyền quản trị "Vật tư" để ${action}.`);
        return false;
    };

    // Autocomplete state
    const [acQuery, setAcQuery] = useState('');
    const [acOpen, setAcOpen] = useState(false);
    const acRef = useRef<HTMLDivElement>(null);
    const acSuggestions = useMemo(() => {
        if (!acQuery || acQuery.length < 1) return [];
        const q = acQuery.toLowerCase();
        return inventoryItems.filter(i =>
            i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
        ).slice(0, 8);
    }, [acQuery, inventoryItems]);

    const selectInventoryItem = (item: InventoryItem) => {
        setBInventoryItemId(item.id);
        setBMaterialCode(item.sku);
        setBName(item.name);
        setBCat(item.category);
        setBUnit(item.unit);
        setBPrice(String(item.priceIn));
        setAcQuery(item.name);
        setAcOpen(false);
    };

    const resetBoqForm = () => {
        setEditingBoq(null); setShowBoqForm(false);
        setBCat('Vật liệu xây dựng'); setBName(''); setBUnit(''); setBBudgetQty('');
        setBPrice(''); setBThreshold('5'); setBNotes('');
        setBInventoryItemId(''); setBMaterialCode(''); setBWorkBoqItemId(''); setAcQuery('');
    };

    const openEditBoq = (item: MaterialBudgetItem) => {
        if (!ensureCanManage('sửa BOQ vật tư')) return;
        setEditingBoq(item);
        setBCat(item.category); setBName(item.itemName); setBUnit(item.unit);
        setBBudgetQty(String(item.budgetQty)); setBPrice(String(item.budgetUnitPrice));
        setBThreshold(String(item.wasteThreshold));
        setBNotes(item.notes || '');
        setBInventoryItemId(item.inventoryItemId || '');
        setBMaterialCode(item.materialCode || '');
        setBWorkBoqItemId(item.workBoqItemId || '');
        setAcQuery(item.itemName);
        setShowBoqForm(true);
    };

    // Compute actualQty from fulfillment batches; legacy completed requests fall back to approvedQty.
    const computedBoqItems = useMemo(() => {
        return boqItems.map(b => {
            if (!b.inventoryItemId) return b;
            let totalReceived = 0;
            let totalRequested = 0;
            requests.filter(r => r.status !== RequestStatus.REJECTED).forEach(r => {
                const rItems = r.items || [];
                const requestSummary = requestFulfillmentSummaries[r.id];
                const hasFulfillmentBatches = (requestFulfillmentBatchCounts[r.id] || 0) > 0;
                const summaryByLine = new Map((requestSummary?.lineSummaries || []).map(line => [line.requestLineId, line]));
                rItems.forEach((ri: any, index: number) => {
                    const sameBudgetLine = ri.materialBudgetItemId && ri.materialBudgetItemId === b.id;
                    const legacySameItem = !ri.materialBudgetItemId && ri.itemId === b.inventoryItemId;
                    if (sameBudgetLine || legacySameItem) {
                        totalRequested += (ri.requestQty || 0);
                        const requestLineId = getRequestLineId(r, ri, index);
                        const lineSummary = summaryByLine.get(requestLineId);
                        if (hasFulfillmentBatches && lineSummary) {
                            totalReceived += lineSummary.receivedQty;
                        } else if (r.status === RequestStatus.COMPLETED || r.status === RequestStatus.IN_TRANSIT) {
                            totalReceived += (ri.issuedQty || ri.approvedQty || 0);
                        }
                    }
                });
            });
            const actualQty = totalReceived;
            const wasteQty = actualQty - b.budgetQty;
            const wastePercent = b.budgetQty > 0 ? Math.round((wasteQty / b.budgetQty) * 1000) / 10 : 0;
            const budgetOverPercent = b.budgetQty > 0 ? Math.round(((totalRequested - b.budgetQty) / b.budgetQty) * 1000) / 10 : 0;
            return {
                ...b,
                actualQty,
                actualTotal: actualQty * b.budgetUnitPrice,
                wasteQty,
                wastePercent,
                wasteValue: wasteQty * b.budgetUnitPrice,
                cumulativeRequested: totalRequested,
                cumulativeExported: actualQty,
                budgetOverPercent: Math.max(0, budgetOverPercent),
                stockBalance: (b.cumulativeImported || 0) - actualQty,
                autoAlert: budgetOverPercent > 0 ? 'Vượt ngân sách' : wastePercent > b.wasteThreshold ? 'Vượt định mức hao hụt' : undefined,
            };
        });
    }, [boqItems, requestFulfillmentBatchCounts, requestFulfillmentSummaries, requests]);

    const boqItemsByWork = useMemo(() => {
        const map = new Map<string, MaterialBudgetItem[]>();
        computedBoqItems.forEach(item => {
            const key = item.workBoqItemId || 'unassigned';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(item);
        });
        return map;
    }, [computedBoqItems]);

    const workBoqTree = useMemo(() => {
        const children = new Map<string, ProjectWorkBoqItem[]>();
        const roots: ProjectWorkBoqItem[] = [];
        workBoqItems.forEach(item => {
            if (item.parentId) {
                if (!children.has(item.parentId)) children.set(item.parentId, []);
                children.get(item.parentId)!.push(item);
            } else {
                roots.push(item);
            }
        });
        const rows: Array<{ item: ProjectWorkBoqItem; level: number }> = [];
        const visit = (items: ProjectWorkBoqItem[], level: number) => {
            items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).forEach(item => {
                rows.push({ item, level });
                visit(children.get(item.id) || [], level + 1);
            });
        };
        visit(roots, 0);
        return rows;
    }, [workBoqItems]);

    const unassignedBoqItems = useMemo(
        () => computedBoqItems.filter(item => !item.workBoqItemId),
        [computedBoqItems]
    );

    const getWorkComparison = (workItem: ProjectWorkBoqItem) => {
        const linkedIds = workItem.sourceTaskId ? taskContractLinks[workItem.sourceTaskId] || [] : [];
        const linkedContractItems = linkedIds.map(id => contractItems.find(item => item.id === id)).filter(Boolean) as ContractItem[];
        const contractQty = linkedContractItems.reduce((sum, item) => sum + (item.revisedQuantity ?? item.quantity ?? 0), 0);
        const contractValue = linkedContractItems.reduce((sum, item) => sum + (item.revisedTotalPrice ?? item.totalPrice ?? 0), 0);
        const plannedQty = Number(workItem.plannedQty || 0);
        const plannedValue = Number(workItem.totalAmount ?? plannedQty * Number(workItem.unitPrice || 0));
        return {
            hasLink: linkedContractItems.length > 0,
            contractQty,
            contractValue,
            plannedQty,
            plannedValue,
            qtyDiff: plannedQty - contractQty,
            valueDiff: plannedValue - contractValue,
        };
    };

    const handleSyncWithSchedule = async () => {
        if (!ensureCanManage('đồng bộ BOQ vật tư')) return;
        if (tasks.length === 0) {
            toast.warning('Chưa có tiến độ', 'Cần tạo hoặc import tiến độ trước khi đồng bộ BOQ.');
            return;
        }
        const preview = workBoqService.previewSync(tasks, workBoqItems);
        const ok = await confirm({
            title: 'Đồng bộ với tiến độ',
            targetName: 'BOQ triển khai',
            subtitle: summarizeSync(preview),
            warningText: 'Hệ thống chỉ cập nhật mã WBS, tên, cấp cha và thứ tự. KL, đơn giá và vật tư đã nhập tay sẽ được giữ nguyên.',
            confirmText: 'Đồng bộ',
            intent: 'success',
            countdownSeconds: 0,
        });
        if (!ok) return;
        setSyncingBoq(true);
        try {
            const result = await workBoqService.syncFromTasks(effectiveId, constructionSiteId || null, tasks, workBoqItems);
            await loadBoqData();
            toast.success('Đồng bộ BOQ thành công', summarizeSync(result));
        } catch (error: any) {
            toast.error('Không thể đồng bộ BOQ', error?.message || 'Vui lòng thử lại.');
        } finally {
            setSyncingBoq(false);
        }
    };

    const handleSaveBoq = async () => {
        if (!ensureCanManage('lưu BOQ vật tư')) return;
        if (!bName || !bUnit || !bBudgetQty || !bPrice) return;
        const budgetQty = Number(bBudgetQty);
        const budgetUnitPrice = Number(bPrice);

        const item: MaterialBudgetItem = {
            id: editingBoq?.id || crypto.randomUUID(),
            projectId: projectId || constructionSiteId || null,
            constructionSiteId: constructionSiteId || null,
            workBoqItemId: bWorkBoqItemId || null,
            inventoryItemId: bInventoryItemId || undefined,
            materialCode: bMaterialCode || undefined,
            category: bCat, itemName: bName, unit: bUnit,
            budgetQty, budgetUnitPrice,
            budgetTotal: budgetQty * budgetUnitPrice,
            actualQty: 0,
            wasteThreshold: Number(bThreshold),
            sortOrder: editingBoq?.sortOrder ?? boqItems.filter(b => (b.workBoqItemId || '') === (bWorkBoqItemId || '')).length,
            notes: bNotes || undefined,
        };

        await boqService.upsert(item);
        await loadBoqData();
        toast.success(editingBoq ? 'Cập nhật BOQ' : 'Thêm mục BOQ thành công');
        resetBoqForm();
    };

    const handleDeleteBoq = async (id: string, name: string) => {
        if (!ensureCanManage('xoá BOQ vật tư')) return;
        const ok = await confirm({ targetName: name, title: 'Xoá mục BOQ' });
        if (!ok) return;
        try {
            await boqService.remove(id);
            await loadBoqData();
            toast.success('Xoá BOQ thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const handleExportWorkBoq = async () => {
        const XLSX = await loadXlsx();
        const workRows = workBoqTree.map(({ item }) => ({
            'Mã WBS': item.wbsCode || '',
            'Mã cha': item.parentId ? workBoqItems.find(parent => parent.id === item.parentId)?.wbsCode || '' : '',
            'Tên đầu mục': item.name,
            'ĐVT': item.unit || '',
            'KL dự toán': item.plannedQty || 0,
            'Đơn giá': item.unitPrice || 0,
            'Ghi chú': item.notes || '',
        }));
        const materialRows = computedBoqItems.map(item => {
            const workItem = item.workBoqItemId ? workBoqItems.find(work => work.id === item.workBoqItemId) : undefined;
            return {
                'WBS đầu mục': workItem?.wbsCode || '',
                'Mã vật tư': item.materialCode || '',
                'Tên vật tư': item.itemName,
                'Nhóm': item.category,
                'ĐVT': item.unit,
                'KL dự toán': item.budgetQty,
                'Đơn giá': item.budgetUnitPrice,
                'Ngưỡng hao hụt': item.wasteThreshold,
                'Ghi chú': item.notes || '',
            };
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workRows.length ? workRows : [{
            'Mã WBS': '1.1',
            'Mã cha': '1',
            'Tên đầu mục': 'Đào đất móng',
            'ĐVT': 'm3',
            'KL dự toán': 0,
            'Đơn giá': 0,
            'Ghi chú': '',
        }]), 'Dau_muc');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(materialRows.length ? materialRows : [{
            'WBS đầu mục': '1.1',
            'Mã vật tư': 'VT001',
            'Tên vật tư': 'Xi măng',
            'Nhóm': 'Vật liệu xây dựng',
            'ĐVT': 'bao',
            'KL dự toán': 0,
            'Đơn giá': 0,
            'Ngưỡng hao hụt': 5,
            'Ghi chú': '',
        }]), 'Vat_tu');
        XLSX.writeFile(wb, `BOQ_trien_khai_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleImportWorkBoq = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!ensureCanManage('import BOQ vật tư')) {
            event.target.value = '';
            return;
        }
        const file = event.target.files?.[0];
        if (!file) return;
        setImportingBoq(true);
        try {
            const XLSX = await loadXlsx();
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const workSheet = wb.Sheets['Dau_muc'] || wb.Sheets[wb.SheetNames[0]];
            const materialSheet = wb.Sheets['Vat_tu'];
            const rawWorkRows = workSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workSheet, { defval: '', raw: false }) : [];
            const rawMaterialRows = materialSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(materialSheet, { defval: '', raw: false }) : [];
            const existingWorkByWbs = new Map(workBoqItems.filter(item => item.wbsCode).map(item => [normalizeKey(item.wbsCode), item]));
            const seenWorkWbs = new Set<string>();

            const workRows: WorkBoqImportPreview['workRows'] = rawWorkRows.map((row, index) => {
                const wbs = String(row['Mã WBS'] || '').trim();
                const name = String(row['Tên đầu mục'] || '').trim();
                const wbsKey = normalizeKey(wbs);
                const errors: string[] = [];
                if (!wbs) errors.push('Thiếu Mã WBS.');
                else if (!isValidWbsCode(wbs)) errors.push('Mã WBS không hợp lệ.');
                else if (seenWorkWbs.has(wbsKey)) errors.push('Mã WBS bị trùng trong file.');
                if (!name) errors.push('Thiếu Tên đầu mục.');
                if (wbs) seenWorkWbs.add(wbsKey);
                const existing = existingWorkByWbs.get(normalizeKey(wbs));
                const item: ProjectWorkBoqItem = {
                    id: existing?.id || crypto.randomUUID(),
                    projectId: effectiveId,
                    constructionSiteId: constructionSiteId || null,
                    sourceTaskId: existing?.sourceTaskId || null,
                    parentId: null,
                    wbsCode: wbs,
                    name,
                    unit: String(row['ĐVT'] || existing?.unit || '').trim(),
                    plannedQty: importNumber(row['KL dự toán']),
                    unitPrice: importNumber(row['Đơn giá']),
                    totalAmount: importNumber(row['KL dự toán']) * importNumber(row['Đơn giá']),
                    sortOrder: existing?.sortOrder ?? index,
                    syncStatus: existing?.sourceTaskId ? existing.syncStatus : 'manual',
                    notes: String(row['Ghi chú'] || existing?.notes || '').trim() || null,
                };
                return {
                    rowNumber: index + 2,
                    item,
                    status: errors.length > 0 ? 'error' as const : existing ? 'update' as const : 'create' as const,
                    errors,
                };
            });

            workRows.forEach(previewRow => {
                const item = previewRow.item;
                const source = rawWorkRows[previewRow.rowNumber - 2];
                const parentWbs = String(source?.['Mã cha'] || '').trim();
                if (parentWbs) {
                    const importedParentRow = workRows.find(row => normalizeKey(row.item.wbsCode) === normalizeKey(parentWbs));
                    const parent = importedParentRow?.item || existingWorkByWbs.get(normalizeKey(parentWbs));
                    if (parent) item.parentId = parent.id;
                    else {
                        previewRow.errors.push(`Không tìm thấy Mã cha "${parentWbs}".`);
                        previewRow.status = 'error';
                    }
                }
            });
            let changedParentError = true;
            while (changedParentError) {
                changedParentError = false;
                const erroredIds = new Set(workRows.filter(row => row.status === 'error').map(row => row.item.id));
                workRows.forEach(row => {
                    if (row.status !== 'error' && row.item.parentId && erroredIds.has(row.item.parentId)) {
                        row.errors.push('Mã cha đang bị lỗi.');
                        row.status = 'error';
                        changedParentError = true;
                    }
                });
            }

            const validImportedWorkByWbs = new Map(workRows
                .filter(row => row.status !== 'error' && row.item.wbsCode)
                .map(row => [normalizeKey(row.item.wbsCode), row.item])
            );
            const workByWbs = new Map([...existingWorkByWbs, ...validImportedWorkByWbs]);
            const existingMaterials = new Map(
                computedBoqItems.map(item => [
                    `${item.workBoqItemId || ''}|${normalizeKey(item.materialCode || `${item.itemName}|${item.unit}`)}`,
                    item,
                ])
            );
            const materialRows = rawMaterialRows.map((row, index) => {
                const workWbs = String(row['WBS đầu mục'] || '').trim();
                const workItem = workByWbs.get(normalizeKey(workWbs));
                const materialCode = String(row['Mã vật tư'] || '').trim();
                const itemName = String(row['Tên vật tư'] || '').trim();
                const unit = String(row['ĐVT'] || '').trim();
                const errors: string[] = [];
                if (!workItem) errors.push(`Không tìm thấy đầu mục WBS "${workWbs}".`);
                if (!itemName) errors.push('Thiếu Tên vật tư.');
                if (!unit) errors.push('Thiếu ĐVT.');
                const matchKey = `${workItem?.id || ''}|${normalizeKey(materialCode || `${itemName}|${unit}`)}`;
                const existing = existingMaterials.get(matchKey);
                const budgetQty = importNumber(row['KL dự toán']);
                const budgetUnitPrice = importNumber(row['Đơn giá']);
                const item: MaterialBudgetItem = {
                    id: existing?.id || crypto.randomUUID(),
                    projectId: effectiveId,
                    constructionSiteId: constructionSiteId || null,
                    workBoqItemId: workItem?.id || null,
                    materialCode: materialCode || existing?.materialCode,
                    category: String(row['Nhóm'] || existing?.category || 'Vật liệu xây dựng').trim(),
                    itemName,
                    unit,
                    budgetQty,
                    budgetUnitPrice,
                    budgetTotal: budgetQty * budgetUnitPrice,
                    actualQty: existing?.actualQty || 0,
                    wasteThreshold: importNumber(row['Ngưỡng hao hụt']) || existing?.wasteThreshold || 5,
                    sortOrder: existing?.sortOrder ?? index,
                    notes: String(row['Ghi chú'] || existing?.notes || '').trim() || undefined,
                    inventoryItemId: existing?.inventoryItemId,
                };
                return {
                    rowNumber: index + 2,
                    item,
                    status: errors.length > 0 ? 'error' as const : existing ? 'update' as const : 'create' as const,
                    errors,
                };
            });
            setImportPreview({ workRows, materialRows });
        } catch (error: any) {
            toast.error('Không đọc được Excel', error?.message || 'Vui lòng dùng file mẫu BOQ triển khai.');
        } finally {
            setImportingBoq(false);
            if (boqImportRef.current) boqImportRef.current.value = '';
        }
    };

    const confirmImportWorkBoq = async () => {
        if (!ensureCanManage('áp dụng import BOQ vật tư')) return;
        if (!importPreview) return;
        const validWorkRows = importPreview.workRows.filter(row => row.status !== 'error');
        const validMaterialRows = importPreview.materialRows.filter(row => row.status !== 'error');
        if (validWorkRows.length === 0 && validMaterialRows.length === 0) {
            toast.warning('Không có dữ liệu hợp lệ', 'File import không có dòng nào có thể ghi.');
            return;
        }
        setImportingBoq(true);
        try {
            await workBoqService.upsertMany(validWorkRows.map(row => row.item));
            for (const row of validMaterialRows) await boqService.upsert(row.item);
            setImportPreview(null);
            await loadBoqData();
            toast.success('Import BOQ triển khai thành công', `${validWorkRows.length} đầu mục, ${validMaterialRows.length} vật tư.`);
        } catch (error: any) {
            toast.error('Không thể ghi import', error?.message || 'Vui lòng thử lại.');
        } finally {
            setImportingBoq(false);
        }
    };

    // Stats using computed data
    const stats = useMemo(() => {
        const totalBudget = computedBoqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const totalActual = computedBoqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const overWaste = computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold);
        const overBudget = computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0);
        const totalWasteValue = computedBoqItems.reduce((s, b) => s + Math.abs(b.wasteValue || 0), 0);
        const totalRequested = computedBoqItems.reduce((s, b) => s + (b.cumulativeRequested || 0) * (b.budgetUnitPrice || 0), 0);
        const pending = requests.filter(r => r.status === RequestStatus.PENDING).length;
        return { totalBudget, totalActual, diff: totalActual - totalBudget, overWaste: overWaste.length, overBudget: overBudget.length, totalWasteValue, totalRequested, pendingReq: pending, boqCount: computedBoqItems.length };
    }, [computedBoqItems, requests]);

    // Chart data for waste comparison
    const wasteChartData = useMemo(() => {
        return computedBoqItems.map(b => ({
            name: b.itemName.length > 8 ? b.itemName.slice(0, 8) + '…' : b.itemName,
            'Dự toán': b.budgetQty,
            'Thực tế': b.actualQty,
            waste: b.wastePercent || 0,
            threshold: b.wasteThreshold,
            isOver: (b.wastePercent || 0) > b.wasteThreshold,
        }));
    }, [computedBoqItems]);

    return (
        <div className="space-y-6">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Quản lý vật tư</h3>
                <AiInsightPanel module="material" siteId={constructionSiteId} />
            </div>
            {/* KPI Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Package size={10} /> Hạng mục</div>
                    <div className="text-2xl font-black text-slate-800">{stats.boqCount}</div>
                    <div className="text-[10px] text-slate-400">DT: {fmt(stats.totalBudget)} đ</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp size={10} /> Chi phí TT</div>
                    <div className={`text-xl font-black ${stats.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(stats.totalActual)} đ</div>
                    <div className={`text-[10px] font-bold ${stats.diff > 0 ? 'text-red-400' : 'text-emerald-500'}`}>{stats.diff > 0 ? '+' : ''}{fmt(stats.diff)} đ</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Vượt hao hụt</div>
                    <div className={`text-2xl font-black ${stats.overWaste > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{stats.overWaste}</div>
                    <div className="text-[10px] text-slate-400">/ {stats.overBudget} vượt NS</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">💰 GT Hao hụt</div>
                    <div className={`text-xl font-black ${stats.totalWasteValue > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(stats.totalWasteValue)} đ</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={10} /> YC chờ duyệt</div>
                    <div className="text-2xl font-black text-amber-600">{stats.pendingReq}</div>
                    <div className="text-[10px] text-slate-400">{requests.length} phiếu tổng</div>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-white dark:bg-slate-850 rounded-2xl p-1.5 border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {[
                    { key: 'summary' as const, label: '🔗 Tổng hợp', count: computedBoqItems.length },
                    { key: 'boq' as const, label: '📋 BOQ', count: workBoqItems.length + computedBoqItems.length },
                    { key: 'request' as const, label: '📦 Yêu cầu', count: requests.length },
                    { key: 'po' as const, label: '🛒 Đơn hàng (PO)', count: 0 },
                    { key: 'waste' as const, label: '📊 Hao hụt', count: stats.overWaste },
                    { key: 'dashboard' as const, label: '📈 Dashboard', count: 0 },
                ].map(t => (
                    <button key={t.key} onClick={() => setActiveSubTab(t.key)}
                        className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeSubTab === t.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                            }`}>
                        {t.label} {t.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeSubTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* ===== SUMMARY TAB - Bảng tổng hợp 1 dòng ===== */}
            {activeSubTab === 'summary' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <div><h4 className="text-sm font-black text-slate-800">📊 Bảng tổng hợp vật tư</h4><p className="text-[10px] text-slate-400">Toàn bộ chỉ số trên 1 dòng — liên kết BOQ↔YC↔PO↔Kho</p></div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[1200px]">
                            <thead>
                                <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase tracking-wider">
                                    <th className="p-2.5 sticky left-0 bg-slate-50 z-10">Mã VT</th>
                                    <th className="p-2.5">Vật tư</th>
                                    <th className="p-2.5">ĐVT</th>
                                    <th className="p-2.5 text-right">Ngân sách</th>
                                    <th className="p-2.5 text-right">LK Yêu cầu</th>
                                    <th className="p-2.5 text-right text-amber-600">% Vượt NS</th>
                                    <th className="p-2.5 text-right">LK Nhập</th>
                                    <th className="p-2.5 text-right">LK Xuất</th>
                                    <th className="p-2.5 text-right">Tồn kho</th>
                                    <th className="p-2.5 text-right">HH (%)</th>
                                    <th className="p-2.5 text-right">Định mức</th>
                                    <th className="p-2.5 text-right text-red-500">GT Hao hụt</th>
                                    <th className="p-2.5">Cảnh báo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40 text-xs">
                                {computedBoqItems.map(b => {
                                    const overBudget = (b.budgetOverPercent || 0) > 0;
                                    const overWaste = (b.wastePercent || 0) > b.wasteThreshold;
                                    const negStock = (b.stockBalance || 0) < 0;
                                    return (
                                        <tr key={b.id} className={`hover:bg-slate-50 ${overWaste ? 'bg-red-50/40' : overBudget ? 'bg-amber-50/40' : ''}`}>
                                            <td className="p-2.5 font-mono text-[10px] text-indigo-500 font-bold sticky left-0 bg-white dark:bg-slate-900 z-10">{b.materialCode || '—'}</td>
                                            <td className="p-2.5 font-bold text-slate-800 max-w-[140px] truncate">{b.itemName}</td>
                                            <td className="p-2.5 text-slate-400">{b.unit}</td>
                                            <td className="p-2.5 text-right font-bold">{b.budgetQty.toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-bold">{(b.cumulativeRequested || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-black ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {(b.budgetOverPercent || 0) > 0 ? '+' : ''}{(b.budgetOverPercent || 0).toFixed(1)}%
                                            </td>
                                            <td className="p-2.5 text-right">{(b.cumulativeImported || 0).toLocaleString()}</td>
                                            <td className="p-2.5 text-right">{(b.cumulativeExported || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-bold ${negStock ? 'text-red-600' : 'text-emerald-600'}`}>{(b.stockBalance || 0).toLocaleString()}</td>
                                            <td className={`p-2.5 text-right font-bold ${overWaste ? 'text-red-600' : 'text-slate-600'}`}>{(b.wastePercent || 0).toFixed(1)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{b.wasteThreshold}%</td>
                                            <td className={`p-2.5 text-right font-bold ${(b.wasteValue || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(Math.abs(b.wasteValue || 0))}</td>
                                            <td className="p-2.5">
                                                {b.autoAlert ? (
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${b.autoAlert.includes('Vượt') ? 'bg-red-100 text-red-700' : b.autoAlert.includes('Cận') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                        }`}>
                                                        <AlertTriangle size={9} /> {b.autoAlert}
                                                    </span>
                                                ) : <span className="text-[9px] text-emerald-500 font-bold">✓ OK</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* BOQ Tab */}
            {activeSubTab === 'boq' && (
                <div className="space-y-4">
                    <details className="group border-y border-slate-100 dark:border-slate-700/60">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-100">
                                    <GitBranch size={16} className="text-indigo-500" /> Đối chiếu BOQ hợp đồng tham khảo
                                </h3>
                                <p className="mt-1 text-[10px] font-bold text-slate-400">Không còn là điều kiện tạo nghiệm thu/thanh toán; mở ra khi cần so sánh BOQ hợp đồng với BOQ triển khai.</p>
                            </div>
                            <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-slate-100 p-4 dark:border-slate-700/60">
                            <BoqReconciliationPanel projectId={projectId || null} constructionSiteId={constructionSiteId || null} />
                        </div>
                    </details>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><ListTree size={16} className="text-indigo-500" /> BOQ khối lượng triển khai theo tiến độ</h3>
                                <p className="text-[10px] text-slate-400 mt-1">Đầu mục lấy từ tiến độ, vật tư dự toán nằm dưới từng đầu mục.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canManageTab && (
                                    <button onClick={handleSyncWithSchedule} disabled={syncingBoq}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
                                        <RefreshCcw size={12} className={syncingBoq ? 'animate-spin' : ''} /> Đồng bộ với tiến độ
                                    </button>
                                )}
                                <button onClick={handleExportWorkBoq}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100">
                                    <Download size={12} /> Export
                                </button>
                                {canManageTab && (
                                    <>
                                        <button onClick={() => boqImportRef.current?.click()} disabled={importingBoq}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                                            <Upload size={12} /> Import
                                        </button>
                                        <button onClick={() => { resetBoqForm(); setShowBoqForm(true); }}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100">
                                            <Plus size={12} /> Thêm vật tư
                                        </button>
                                    </>
                                )}
                                <input ref={boqImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportWorkBoq} />
                            </div>
                        </div>
                        {workBoqItems.length === 0 && computedBoqItems.length === 0 ? (
                            <div className="p-12 text-center">
                                <GitBranch size={36} className="mx-auto mb-2 text-slate-200" />
                                <p className="text-sm font-bold text-slate-400">Chưa có BOQ triển khai</p>
                                <p className="text-xs text-slate-300 mt-1">Bấm “Đồng bộ với tiến độ” để sinh cây đầu mục từ bảng tiến độ.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs min-w-[1180px]">
                                    <thead className="bg-slate-50/80">
                                        <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                            <th className="text-left px-4 py-3">Đầu mục / Vật tư</th>
                                            <th className="text-center px-4 py-3">ĐVT</th>
                                            <th className="text-right px-4 py-3">KL Dự toán</th>
                                            <th className="text-right px-4 py-3">Đơn giá</th>
                                            <th className="text-right px-4 py-3">GT Triển khai</th>
                                            <th className="text-right px-4 py-3">KL HĐ</th>
                                            <th className="text-right px-4 py-3">GT HĐ</th>
                                            <th className="text-right px-4 py-3">Chênh lệch</th>
                                            <th className="text-center px-4 py-3">TT</th>
                                            <th className="text-center px-4 py-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {workBoqTree.map(({ item, level }) => {
                                            const comparison = getWorkComparison(item);
                                            const childMaterials = boqItemsByWork.get(item.id) || [];
                                            const isOrphan = item.syncStatus === 'orphaned';
                                            return (
                                                <React.Fragment key={item.id}>
                                                    <tr className={`${isOrphan ? 'bg-amber-50/60' : 'bg-indigo-50/40'} hover:bg-indigo-50 group`}>
                                                        <td className="px-4 py-2.5 font-black text-slate-800">
                                                            <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                                                                <ListTree size={12} className={isOrphan ? 'text-amber-500' : 'text-indigo-500'} />
                                                                <span className="font-mono text-indigo-600">{item.wbsCode || '-'}</span>
                                                                <span>{item.name}</span>
                                                                {isOrphan && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black">ORPHAN</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center text-slate-500">{item.unit || '—'}</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-slate-700">{Number(item.plannedQty || 0).toLocaleString()}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-500">{fmt(Number(item.unitPrice || 0))}</td>
                                                        <td className="px-4 py-2.5 text-right font-black text-indigo-700">{fmt(comparison.plannedValue)}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-500">{comparison.hasLink ? comparison.contractQty.toLocaleString() : '—'}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-500">{comparison.hasLink ? fmt(comparison.contractValue) : '—'}</td>
                                                        <td className={`px-4 py-2.5 text-right font-black ${comparison.hasLink ? comparison.valueDiff > 0 ? 'text-red-500' : comparison.valueDiff < 0 ? 'text-emerald-600' : 'text-slate-500' : 'text-slate-300'}`}>
                                                            {comparison.hasLink ? `${comparison.valueDiff > 0 ? '+' : ''}${fmt(comparison.valueDiff)}` : 'Chưa đối chiếu'}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${comparison.hasLink ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                                                {comparison.hasLink ? 'Đã link HĐ' : 'Chưa link'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            {canManageTab && (
                                                                <button onClick={() => { resetBoqForm(); setBWorkBoqItemId(item.id); setShowBoqForm(true); }}
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold text-indigo-600 hover:bg-indigo-100">
                                                                    <Plus size={10} /> Vật tư
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {childMaterials.map(mat => {
                                                        const isOver = (mat.wastePercent || 0) > mat.wasteThreshold;
                                                        return (
                                                            <tr key={mat.id} className="hover:bg-slate-50/70 group">
                                                                <td className="px-4 py-2.5">
                                                                    <div className="flex items-center gap-2 text-slate-700" style={{ paddingLeft: `${(level + 1) * 18}px` }}>
                                                                        <MinusCircle size={11} className="text-slate-300" />
                                                                        <span className="font-bold">{mat.itemName}</span>
                                                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[9px] font-bold">{mat.category}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-2.5 text-center text-slate-500">{mat.unit}</td>
                                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{mat.budgetQty.toLocaleString()}</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-500">{fmt(mat.budgetUnitPrice)}</td>
                                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{fmt(mat.budgetTotal || 0)}</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                                <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : (mat.wastePercent || 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                                    {(mat.wastePercent || 0) > 0 ? '+' : ''}{mat.wastePercent || 0}%
                                                                </td>
                                                                <td className="px-4 py-2.5 text-center">
                                                                    {isOver ? <AlertTriangle size={12} className="inline text-red-500" /> : <CheckCircle2 size={12} className="inline text-emerald-500" />}
                                                                </td>
                                                                <td className="px-4 py-2.5">
                                                                    {canManageTab && (
                                                                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                                                            <button onClick={() => openEditBoq(mat)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                                            <button onClick={() => handleDeleteBoq(mat.id, mat.itemName)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500"><Trash2 size={11} /></button>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        })}
                                        {unassignedBoqItems.map(mat => (
                                            <tr key={mat.id} className="hover:bg-slate-50/70 group">
                                                <td className="px-4 py-2.5 font-bold text-slate-700">{mat.itemName}<span className="ml-2 text-[9px] text-amber-500">Chưa gắn đầu mục</span></td>
                                                <td className="px-4 py-2.5 text-center text-slate-500">{mat.unit}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{mat.budgetQty.toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-500">{fmt(mat.budgetUnitPrice)}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700">{fmt(mat.budgetTotal || 0)}</td>
                                                <td colSpan={4}></td>
                                                <td className="px-4 py-2.5"><button onClick={() => openEditBoq(mat)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50/80 font-bold">
                                        <tr className="text-xs">
                                            <td colSpan={4} className="px-4 py-3 text-slate-600">TỔNG CỘNG VẬT TƯ</td>
                                            <td className="px-4 py-3 text-right text-slate-700">{fmt(stats.totalBudget)} đ</td>
                                            <td className="px-4 py-3"></td>
                                            <td className={`px-4 py-3 text-right font-black ${stats.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                {stats.diff > 0 ? '+' : ''}{fmt(stats.diff)} đ
                                            </td>
                                            <td colSpan={3}></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Material Request Tab — using MaterialRequest from Inventory module */}
            {activeSubTab === 'request' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Package size={16} className="text-purple-500" /> Đề xuất vật tư ({requests.length})</h3>
                        {canManageTab && (
                            <button onClick={() => { setSelectedRequest(undefined); setReqModalOpen(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100">
                                <Plus size={12} /> Tạo đề xuất
                            </button>
                        )}
                    </div>
                    {requests.length === 0 ? (
                        <div className="p-12 text-center">
                            <Package size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có phiếu đề xuất vật tư</p>
                            <p className="text-[10px] text-slate-300 mt-1">Tạo đề xuất mới để yêu cầu vật tư từ Kho Tổng</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50/80">
                                    <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                        <th className="text-left px-4 py-3">Mã phiếu</th>
                                        <th className="text-left px-4 py-3">Ngày tạo</th>
                                        <th className="text-left px-4 py-3">Vật tư</th>
                                        <th className="text-center px-4 py-3">Trạng thái</th>
                                        <th className="text-left px-4 py-3">Ghi chú</th>
                                        <th className="text-center px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {requests.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || '')).map(req => {
                                        const stCfg = REQ_STATUS_MAP[req.status] || REQ_STATUS_MAP.PENDING;
                                        const fulfillment = requestFulfillmentSummaries[req.id];
                                        const progressPercent = fulfillment && fulfillment.committedQty > 0
                                            ? Math.min(100, Math.round((fulfillment.receivedQty / fulfillment.committedQty) * 100))
                                            : 0;
                                        const hasPartialFulfillment = fulfillment && fulfillment.receivedQty > 0 && fulfillment.receivedQty < fulfillment.committedQty;
                                        const hasIssuedFulfillment = fulfillment && fulfillment.issuedQty > 0 && fulfillment.receivedQty < fulfillment.committedQty;
                                        const reqUser = users.find(u => u.id === req.requesterId);
                                        const reqItems = (req.items || []) as any[];
                                        return (
                                            <tr key={req.id} className="hover:bg-slate-50/50 group">
                                                <td className="px-4 py-3">
                                                    <span className="font-mono font-bold text-indigo-600">{req.code}</span>
                                                </td>
                                                <td className="px-4 py-3 text-slate-500">
                                                    {req.createdDate ? new Date(req.createdDate).toLocaleDateString('vi-VN') : '—'}
                                                    <div className="text-[10px] text-slate-300 mt-0.5">{reqUser?.name || 'N/A'}</div>
                                                    {req.submittedToName && <div className="text-[10px] font-bold text-amber-500 mt-0.5">Gửi: {req.submittedToName}</div>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {reqItems.slice(0, 3).map((ri: any, idx: number) => {
                                                            const inv = inventoryItems.find(i => i.id === ri.itemId);
                                                            const work = ri.workBoqItemId ? workBoqItems.find(item => item.id === ri.workBoqItemId) : undefined;
                                                            return (
                                                                <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-50 border border-slate-100 text-slate-600 font-medium">
                                                                    {work?.wbsCode ? `${work.wbsCode} • ` : ''}{inv?.name || ri.itemId} ({ri.requestQty})
                                                                    {ri.overBudgetQtySnapshot > 0 ? <span className="ml-1 text-orange-600 font-black">Vượt</span> : null}
                                                                </span>
                                                            );
                                                        })}
                                                        {reqItems.length > 3 && <span className="text-[9px] text-slate-400">+{reqItems.length - 3}</span>}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[9px] font-bold border ${stCfg.bg} ${stCfg.color}`}>
                                                        {stCfg.icon} {hasPartialFulfillment ? 'Cấp một phần' : hasIssuedFulfillment ? 'Đang cấp' : stCfg.label}
                                                    </span>
                                                    {fulfillment && fulfillment.committedQty > 0 && (
                                                        <div className="mt-1.5 min-w-[120px]">
                                                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                                                <div className="h-full bg-emerald-500" style={{ width: `${progressPercent}%` }} />
                                                            </div>
                                                            <div className="mt-0.5 text-[9px] font-bold text-slate-400">
                                                                {fulfillment.receivedQty.toLocaleString('vi-VN')} / {fulfillment.committedQty.toLocaleString('vi-VN')}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">{req.note || '—'}</td>
                                                <td className="px-4 py-3 text-center">
                                                    {canManageTab && (
                                                        <button onClick={() => { setSelectedRequest(req); setReqModalOpen(true); }}
                                                            className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition">
                                                            <ArrowRight size={14} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {activeSubTab === 'po' && (
                <SupplyChainTab
                    constructionSiteId={constructionSiteId}
                    projectId={projectId}
                    canManageTab={canManageTab}
                    compact
                />
            )}

            {/* Waste Comparison Tab */}
            {activeSubTab === 'waste' && (
                <div className="space-y-4">
                    {computedBoqItems.length === 0 ? (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-12 text-center">
                            <BarChart3 size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Thêm dữ liệu BOQ để so sánh hao hụt</p>
                        </div>
                    ) : (
                        <>
                            {/* Bar chart: Budget vs Actual */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5">
                                <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-indigo-500" /> Dự toán vs Thực tế</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={wasteChartData} barGap={4}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Bar dataKey="Dự toán" fill="#818cf8" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="Thực tế" radius={[4, 4, 0, 0]}>
                                            {wasteChartData.map((entry, idx) => (
                                                <Cell key={idx} fill={entry.isOver ? '#ef4444' : '#10b981'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Waste detail table */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                                <div className="p-5 border-b border-slate-100">
                                    <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Chi tiết hao hụt</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50/80">
                                            <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                                <th className="text-left px-4 py-3">Vật tư</th>
                                                <th className="text-center px-4 py-3">ĐVT</th>
                                                <th className="text-right px-4 py-3">Dự toán</th>
                                                <th className="text-right px-4 py-3">Thực tế</th>
                                                <th className="text-right px-4 py-3">Chênh lệch</th>
                                                <th className="text-right px-4 py-3">% Hao hụt</th>
                                                <th className="text-right px-4 py-3">Ngưỡng</th>
                                                <th className="text-center px-4 py-3">Trạng thái</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                            {computedBoqItems.sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(item => {
                                                const isOver = (item.wastePercent || 0) > item.wasteThreshold;
                                                const isNeg = (item.wastePercent || 0) <= 0;
                                                return (
                                                    <tr key={item.id} className={`${isOver ? 'bg-red-50/30' : ''}`}>
                                                        <td className="px-4 py-2.5 font-bold text-slate-700">{item.itemName}</td>
                                                        <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-600">{item.budgetQty.toLocaleString()}</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-slate-700">{item.actualQty.toLocaleString()}</td>
                                                        <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {(item.wasteQty || 0) > 0 ? '+' : ''}{(item.wasteQty || 0).toLocaleString()}
                                                        </td>
                                                        <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : isNeg ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                            {(item.wastePercent || 0) > 0 ? '+' : ''}{item.wastePercent || 0}%
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right text-slate-400">{item.wasteThreshold}%</td>
                                                        <td className="px-4 py-2.5 text-center">
                                                            {isOver ? (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-red-50 border border-red-200 text-red-600"><AlertTriangle size={9} /> Vượt</span>
                                                            ) : isNeg ? (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-600"><CheckCircle2 size={9} /> Tốt</span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 border border-amber-200 text-amber-600"><Clock size={9} /> OK</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* BOQ Form Modal */}
            {showBoqForm && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2">
                                {editingBoq ? <><Edit2 size={18} /> Sửa BOQ</> : <><Plus size={18} /> Thêm BOQ</>}
                            </span>
                            <button onClick={resetBoqForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đầu mục BOQ triển khai</label>
                                <select value={bWorkBoqItemId} onChange={e => setBWorkBoqItemId(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
                                    <option value="">Chưa gắn đầu mục</option>
                                    {workBoqTree.map(({ item, level }) => (
                                        <option key={item.id} value={item.id}>{`${'— '.repeat(level)}${item.wbsCode || ''} ${item.name}`}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Autocomplete: Chọn vật tư từ Kho */}
                            <div ref={acRef} className="relative">
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">🔍 Tìm vật tư từ Kho (gõ mã SKU hoặc tên)</label>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                                    <input value={acQuery}
                                        onChange={e => { setAcQuery(e.target.value); setAcOpen(true); }}
                                        onFocus={() => acQuery && setAcOpen(true)}
                                        placeholder="VD: VT00040 hoặc Thép phi 22..."
                                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-indigo-50/30" />
                                </div>
                                {acOpen && acSuggestions.length > 0 && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                        {acSuggestions.map(item => (
                                            <button key={item.id} onClick={() => selectInventoryItem(item)}
                                                className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 flex items-center justify-between gap-2 border-b border-slate-50 last:border-b-0">
                                                <div>
                                                    <span className="text-xs font-bold text-slate-800">{item.name}</span>
                                                    <span className="text-[10px] text-slate-400 ml-2">({item.sku})</span>
                                                </div>
                                                <div className="text-[10px] text-right shrink-0">
                                                    <span className="text-slate-400">{item.unit}</span>
                                                    <span className="text-indigo-500 font-bold ml-2">{fmt(item.priceIn)} đ</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {bInventoryItemId && (
                                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs flex items-center gap-2">
                                    <CheckCircle2 size={12} className="text-emerald-500" />
                                    <span className="font-bold text-emerald-700">Đã chọn: {bName}</span>
                                    <span className="text-emerald-500">({bMaterialCode})</span>
                                    <span className="text-emerald-400 ml-auto">{bCat} • {bUnit} • {fmt(Number(bPrice))} đ</span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tên vật tư *</label>
                                    <input value={bName} onChange={e => setBName(e.target.value)} placeholder="Nhập tên vật tư"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nhóm</label>
                                    <input value={bCat} onChange={e => setBCat(e.target.value)} placeholder="Nhóm vật tư"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn vị</label>
                                    <input value={bUnit} onChange={e => setBUnit(e.target.value)} placeholder="kg, m3..."
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">KL Dự toán *</label>
                                    <input type="number" value={bBudgetQty} onChange={e => setBBudgetQty(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn giá (VNĐ)</label>
                                    <input type="number" value={bPrice} onChange={e => setBPrice(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng hao hụt (%)</label>
                                    <input type="number" value={bThreshold} onChange={e => setBThreshold(e.target.value)} placeholder="5"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 text-blue-400">KL Thực xuất (tự động)</label>
                                    <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-400">
                                        Tự tính từ phiếu đề xuất đã duyệt
                                    </div>
                                </div>
                            </div>
                            {bBudgetQty && bPrice && (
                                <div className="px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-xs">
                                    <span className="text-indigo-400">Dự toán:</span>
                                    <span className="font-black text-indigo-700 ml-1">{fmt(Number(bBudgetQty) * Number(bPrice))} đ</span>
                                </div>
                            )}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={bNotes} onChange={e => setBNotes(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetBoqForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveBoq} disabled={!bName || !bUnit || !bBudgetQty || !bPrice}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg hover:shadow-xl flex items-center gap-2 disabled:opacity-50">
                                <Save size={16} /> {editingBoq ? 'Lưu' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== DASHBOARD TAB ===== */}
            {activeSubTab === 'dashboard' && (
                <div className="space-y-6">
                    {/* Row 1: Pie + Bar */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Pie Chart - Budget by Category */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5">
                            <h4 className="text-sm font-black text-slate-800 mb-4">🥧 Ngân sách theo nhóm VT</h4>
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie data={(() => {
                                        const catMap: Record<string, number> = {};
                                        computedBoqItems.forEach(b => { catMap[b.category] = (catMap[b.category] || 0) + (b.budgetTotal || 0); });
                                        return Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
                                    })()} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'].map((c, i) => <Cell key={i} fill={c} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: number) => fmt(v) + ' đ'} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        {/* Bar Chart - Top 10 Value */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5">
                            <h4 className="text-sm font-black text-slate-800 mb-4">📊 Top giá trị DT cao nhất</h4>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={[...computedBoqItems].sort((a, b) => (b.budgetTotal || 0) - (a.budgetTotal || 0)).slice(0, 8).map(b => ({
                                    name: b.itemName.length > 10 ? b.itemName.slice(0, 10) + '…' : b.itemName,
                                    'Dự toán': (b.budgetTotal || 0) / 1e6,
                                    'Thực tế': (b.actualTotal || 0) / 1e6,
                                }))} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" tickFormatter={v => v + 'tr'} />
                                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                                    <Tooltip formatter={(v: number) => v.toFixed(0) + ' triệu'} />
                                    <Legend />
                                    <Bar dataKey="Dự toán" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                    <Bar dataKey="Thực tế" fill="#ec4899" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Row 2: Budget Overrun Ranking + Waste Alert Table */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Budget Overrun */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100"><h4 className="text-sm font-black text-slate-800">🔴 Vật tư VƯỢT ngân sách</h4></div>
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                                    <th className="p-2.5 text-left">Vật tư</th><th className="p-2.5 text-right">NS</th><th className="p-2.5 text-right">LK YC</th><th className="p-2.5 text-right">% Vượt</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0).sort((a, b) => (b.budgetOverPercent || 0) - (a.budgetOverPercent || 0)).map(b => (
                                        <tr key={b.id} className="hover:bg-red-50/50">
                                            <td className="p-2.5 font-bold text-slate-800">{b.itemName}</td>
                                            <td className="p-2.5 text-right">{b.budgetQty.toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-bold">{(b.cumulativeRequested || 0).toLocaleString()}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">+{(b.budgetOverPercent || 0).toFixed(1)}%</td>
                                        </tr>
                                    ))}
                                    {computedBoqItems.filter(b => (b.budgetOverPercent || 0) > 0).length === 0 && (
                                        <tr><td colSpan={4} className="p-6 text-center text-slate-300 text-[10px] font-bold uppercase">Không có vật tư vượt NS</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {/* Waste Alert */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100"><h4 className="text-sm font-black text-slate-800">⚠️ Vật tư VƯỢT hao hụt</h4></div>
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                                    <th className="p-2.5 text-left">Vật tư</th><th className="p-2.5 text-right">HH%</th><th className="p-2.5 text-right">Định mức</th><th className="p-2.5 text-right">GT Hao hụt</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold).sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(b => (
                                        <tr key={b.id} className="hover:bg-amber-50/50">
                                            <td className="p-2.5 font-bold text-slate-800">{b.itemName}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">{(b.wastePercent || 0).toFixed(1)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{b.wasteThreshold}%</td>
                                            <td className="p-2.5 text-right font-bold text-red-600">{fmt(Math.abs(b.wasteValue || 0))} đ</td>
                                        </tr>
                                    ))}
                                    {computedBoqItems.filter(b => (b.wastePercent || 0) > b.wasteThreshold).length === 0 && (
                                        <tr><td colSpan={4} className="p-6 text-center text-slate-300 text-[10px] font-bold uppercase">Tất cả trong định mức</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Request Modal — Integrated from Inventory Module */}
            {isReqModalOpen && (
                <RequestModal
                    isOpen={isReqModalOpen}
                    onClose={() => { setReqModalOpen(false); setSelectedRequest(undefined); }}
                    request={selectedRequest}
                    defaultSiteWarehouseId={resolvedWhId}
                    projectId={projectId || null}
                    constructionSiteId={constructionSiteId || null}
                    requestOrigin="project"
                    workBoqItems={workBoqItems}
                    materialBudgetItems={boqItems}
                />
            )}

            {importPreview && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-black text-slate-800">Preview import BOQ triển khai</h3>
                                <p className="text-xs font-bold text-slate-400 mt-0.5">
                                    {importPreview.workRows.length} đầu mục • {importPreview.materialRows.length} vật tư • {[
                                        ...importPreview.workRows,
                                        ...importPreview.materialRows,
                                    ].filter(row => row.status === 'error').length} lỗi
                                </p>
                            </div>
                            <button onClick={() => setImportPreview(null)} disabled={importingBoq} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-5 space-y-5">
                            <div>
                                <h4 className="text-xs font-black text-slate-500 uppercase mb-2">Đầu mục</h4>
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-400 uppercase text-[9px] font-black">
                                        <tr><th className="px-3 py-2 text-left">Dòng</th><th className="px-3 py-2 text-left">WBS</th><th className="px-3 py-2 text-left">Tên</th><th className="px-3 py-2 text-left">Trạng thái</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {importPreview.workRows.map(row => (
                                            <tr key={`work-${row.rowNumber}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                                                <td className="px-3 py-2 font-mono text-slate-400">{row.rowNumber}</td>
                                                <td className="px-3 py-2 font-bold text-indigo-600">{row.item.wbsCode || '-'}</td>
                                                <td className="px-3 py-2 font-bold text-slate-700">{row.item.name || '-'}</td>
                                                <td className="px-3 py-2">{row.errors.length ? row.errors.join(' | ') : row.status === 'create' ? 'Thêm mới' : 'Cập nhật'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <h4 className="text-xs font-black text-slate-500 uppercase mb-2">Vật tư</h4>
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-400 uppercase text-[9px] font-black">
                                        <tr><th className="px-3 py-2 text-left">Dòng</th><th className="px-3 py-2 text-left">Mã</th><th className="px-3 py-2 text-left">Tên vật tư</th><th className="px-3 py-2 text-right">KL</th><th className="px-3 py-2 text-left">Trạng thái</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {importPreview.materialRows.map(row => (
                                            <tr key={`mat-${row.rowNumber}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                                                <td className="px-3 py-2 font-mono text-slate-400">{row.rowNumber}</td>
                                                <td className="px-3 py-2 font-mono text-slate-500">{row.item.materialCode || '-'}</td>
                                                <td className="px-3 py-2 font-bold text-slate-700">{row.item.itemName || '-'}</td>
                                                <td className="px-3 py-2 text-right font-bold">{row.item.budgetQty.toLocaleString()}</td>
                                                <td className="px-3 py-2">{row.errors.length ? row.errors.join(' | ') : row.status === 'create' ? 'Thêm mới' : 'Cập nhật'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setImportPreview(null)} disabled={importingBoq} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">Huỷ</button>
                            <button onClick={confirmImportWorkBoq} disabled={!canManageTab || importingBoq || [...importPreview.workRows, ...importPreview.materialRows].every(row => row.status === 'error')}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-indigo-600 disabled:opacity-50 flex items-center gap-2">
                                <FileSpreadsheet size={15} /> Ghi dữ liệu hợp lệ
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MaterialTab;
