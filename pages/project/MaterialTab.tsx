import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import SupplyChainTab from './SupplyChainTab';
import MaterialPlanningPanel from '../../components/project/MaterialPlanningPanel';
import {
    Plus, Edit2, Trash2, X, Save, Package, AlertTriangle, TrendingUp,
    CheckCircle2, Clock, ChevronDown, ChevronUp,
    BarChart3, Search, RefreshCcw, Download, Upload,
    FileSpreadsheet, GitBranch, ListTree, MinusCircle
} from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { MaterialBudgetItem, InventoryItem, MaterialRequest, RequestStatus, ProjectTask, ProjectWorkBoqItem, ContractItem, TaskContractItem, MaterialRequestFulfillmentSummary, MaterialRequestFulfillmentBatch, MaterialRequestEvent, MaterialRequestKanbanStage, MaterialRequestWorkflowStep, ProjectSubmissionTarget, Role, PurchaseOrder, MaterialPlanningRule, MaterialPlanningDraftPo, PlanningCurveTemplate } from '../../types';
import { boqService, taskService, workBoqService, WorkBoqSyncPreview, poService } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { useApp } from '../../context/AppContext';
import RequestModal from '../../components/RequestModal';
import MaterialRequestKanbanBoard from '../../components/project/MaterialRequestKanbanBoard';
import ProjectSubmissionDialog from '../../components/project/ProjectSubmissionDialog';
import BoqReconciliationPanel from '../../components/project/BoqReconciliationPanel';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { taskContractItemService } from '../../lib/taskContractItemService';
import { contractItemService } from '../../lib/contractItemService';
import { loadXlsx } from '../../lib/loadXlsx';
import { PROJECT_MATERIAL_TAB_PERMISSIONS, type ProjectMaterialTabKey, type ProjectMaterialTabPermissionMap } from '../../lib/projectTabPermissions';
import { materialRequestService } from '../../lib/materialRequestService';
import { projectSubmissionService } from '../../lib/projectSubmissionService';
import { projectStaffService } from '../../lib/projectStaffService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { isGlobalWarehouseKeeper, isWarehouseKeeperFor } from '../../lib/wmsPermissions';
import { getMaterialPlanningScopeKey, materialPlanningCurveService, materialPlanningRuleService } from '../../lib/projectMaterialPlanningService';

interface MaterialTabProps {
    constructionSiteId?: string;
    projectId?: string;
    siteWarehouseId?: string; // ID kho công trường
    canManageTab?: boolean;
    materialPermissions?: ProjectMaterialTabPermissionMap;
}

const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
    return n.toLocaleString('vi-VN');
};

type WorkBoqImportPreview = {
    workRows: Array<{ rowNumber: number; item: ProjectWorkBoqItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
    materialRows: Array<{ rowNumber: number; item: MaterialBudgetItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
};

const WORK_BOQ_SHEET_NAME = 'Dau_muc';
const MATERIAL_BOQ_SHEET_NAME = 'Vat_tu';
const WORK_BOQ_HEADERS = ['Mã WBS', 'Mã cha', 'Tên đầu mục', 'ĐVT', 'KL dự toán', 'Đơn giá', 'Ghi chú'];
const MATERIAL_BOQ_HEADERS = ['WBS đầu mục', 'Mã vật tư/SKU', 'Tên vật tư', 'Nhóm', 'ĐVT', 'KL dự toán', 'Đơn giá', 'Ngưỡng hao hụt (%)', 'Ghi chú'];

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
const rowHasAnyValue = (row: Record<string, unknown>) =>
    Object.values(row).some(value => String(value ?? '').trim() !== '');
const pickImportValue = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
        const value = row[key];
        if (String(value ?? '').trim() !== '') return value;
    }
    return '';
};
const importText = (row: Record<string, unknown>, keys: string[]) =>
    String(pickImportValue(row, keys) ?? '').trim();
const normalizeLookupText = (value?: string | null) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
const SITE_WAREHOUSE_STOP_WORDS = new Set(['kho', 'cong', 'truong', 'du', 'an', 'ct', 'tai', 'khu']);

const summarizeSync = (preview: WorkBoqSyncPreview) =>
    `Thêm mới ${preview.created}, cập nhật ${preview.updated}, bỏ qua ${preview.skipped}, đánh dấu orphan ${preview.orphaned}.`;

const BOQ_WRITE_PERMISSION_MESSAGE = 'Bạn không có quyền chỉnh sửa, vui lòng liên hệ admin.';

const formatBoqWriteError = (error: any, fallback = 'Vui lòng thử lại.') => {
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

const MaterialTab: React.FC<MaterialTabProps> = ({ constructionSiteId, projectId, siteWarehouseId, canManageTab = true, materialPermissions }) => {
    const { items: inventoryItems, requests: allRequests, warehouses, users, user, transactions, hrmConstructionSites, loadModuleData } = useApp();
    const toast = useToast();
    const confirm = useConfirm();
    const effectiveId = projectId || constructionSiteId || '';
    const planningScopeKey = useMemo(
        () => getMaterialPlanningScopeKey(projectId || null, constructionSiteId || null),
        [constructionSiteId, projectId],
    );
    const [activeSubTab, setActiveSubTab] = useState<ProjectMaterialTabKey>('summary');
    const materialAccess = useMemo<ProjectMaterialTabPermissionMap>(() => {
        const hasScopedPermissions = Boolean(materialPermissions);
        return PROJECT_MATERIAL_TAB_PERMISSIONS.reduce<ProjectMaterialTabPermissionMap>((acc, tab) => {
            const scoped = materialPermissions?.[tab.key];
            const canManage = canManageTab || Boolean(scoped?.canManage);
            acc[tab.key] = {
                canView: canManage || (hasScopedPermissions ? Boolean(scoped?.canView) : true),
                canManage,
            };
            return acc;
        }, {} as ProjectMaterialTabPermissionMap);
    }, [canManageTab, materialPermissions]);
    const canManageBoq = materialAccess.boq.canManage;
    const canManagePlanning = materialAccess.planning.canManage;
    const canManageRequest = materialAccess.request.canManage;
    const canManagePo = materialAccess.po.canManage;
    const visibleMaterialTabs = useMemo(
        () => PROJECT_MATERIAL_TAB_PERMISSIONS.filter(tab => materialAccess[tab.key].canView),
        [materialAccess],
    );

    useEffect(() => {
        if (visibleMaterialTabs.length > 0 && !materialAccess[activeSubTab].canView) {
            setActiveSubTab(visibleMaterialTabs[0].key);
        }
    }, [activeSubTab, materialAccess, visibleMaterialTabs]);

    // BOQ Data
    const [boqItems, setBoqItems] = useState<MaterialBudgetItem[]>([]);
    const [workBoqItems, setWorkBoqItems] = useState<ProjectWorkBoqItem[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [planningRules, setPlanningRules] = useState<MaterialPlanningRule[]>([]);
    const [planningCurveTemplates, setPlanningCurveTemplates] = useState<PlanningCurveTemplate[]>([]);
    const [planningLoading, setPlanningLoading] = useState(false);
    const [planningDraftPo, setPlanningDraftPo] = useState<MaterialPlanningDraftPo | null>(null);
    const [planningDraftPoKey, setPlanningDraftPoKey] = useState(0);
    const [contractItems, setContractItems] = useState<ContractItem[]>([]);
    const [taskContractLinks, setTaskContractLinks] = useState<Record<string, string[]>>({});
    const [syncingBoq, setSyncingBoq] = useState(false);
    const [importPreview, setImportPreview] = useState<WorkBoqImportPreview | null>(null);
    const [importingBoq, setImportingBoq] = useState(false);
    const boqImportRef = useRef<HTMLInputElement>(null);
    const loadedBoqScopeRef = useRef<string | null>(null);
    const [projectRequests, setProjectRequests] = useState<MaterialRequest[]>([]);
    const [canSubmitProjectRequest, setCanSubmitProjectRequest] = useState(false);
    const [canApproveProjectRequest, setCanApproveProjectRequest] = useState(false);
    const [requestEventsByRequest, setRequestEventsByRequest] = useState<Record<string, MaterialRequestEvent[]>>({});
    const [requestFulfillmentBatches, setRequestFulfillmentBatches] = useState<Record<string, MaterialRequestFulfillmentBatch[]>>({});
    const [submissionTransition, setSubmissionTransition] = useState<{
        request: MaterialRequest;
        toStep: MaterialRequestWorkflowStep;
        status: RequestStatus;
        action: string;
        title: string;
        subtitle: string;
        recipientHint?: string;
        source?: string;
    } | null>(null);
    const [terminalTransition, setTerminalTransition] = useState<{ request: MaterialRequest; fromStage: MaterialRequestKanbanStage } | null>(null);
    const [terminalAction, setTerminalAction] = useState<'return' | 'reject'>('return');
    const [terminalNote, setTerminalNote] = useState('');
    const [transitioningRequestId, setTransitioningRequestId] = useState<string | null>(null);

    useEffect(() => {
        loadModuleData('wms-core');
    }, [loadModuleData]);

    useEffect(() => {
        let cancelled = false;
        const loadProjectRequestPermissions = async () => {
            if (!projectId || user.role === Role.ADMIN || canManageRequest) {
                if (!cancelled) {
                    setCanSubmitProjectRequest(user.role === Role.ADMIN || canManageRequest);
                    setCanApproveProjectRequest(user.role === Role.ADMIN || canManageRequest);
                }
                return;
            }
            try {
                const [submitPerm, approvePerm] = await Promise.all([
                    projectStaffService.checkProjectPermission(user.id, projectId, 'submit', constructionSiteId || undefined),
                    projectStaffService.checkProjectPermission(user.id, projectId, 'approve', constructionSiteId || undefined),
                ]);
                if (!cancelled) {
                    setCanSubmitProjectRequest(submitPerm.allowed);
                    setCanApproveProjectRequest(approvePerm.allowed);
                }
            } catch (error) {
                console.warn('Failed to check project material request permissions', error);
                if (!cancelled) {
                    setCanSubmitProjectRequest(false);
                    setCanApproveProjectRequest(false);
                }
            }
        };
        void loadProjectRequestPermissions();
        return () => { cancelled = true; };
    }, [canManageRequest, constructionSiteId, projectId, user.id, user.role]);

    const loadProjectRequests = useCallback(async () => {
        if (!projectId) {
            setProjectRequests([]);
            return;
        }
        try {
            setProjectRequests(await materialRequestService.listByProject(projectId));
        } catch (error: any) {
            console.error('Failed to load project material requests', error);
            toast.error('Không tải được phiếu vật tư dự án', error?.message || 'Vui lòng thử lại.');
        }
    }, [projectId]);

    useEffect(() => {
        void loadProjectRequests();
    }, [loadProjectRequests]);

    const closeRequestModal = () => {
        setReqModalOpen(false);
        setSelectedRequest(undefined);
        setRequestModalInitialAction(undefined);
        void loadProjectRequests();
    };

    const defaultSiteWarehouseId = useMemo(() => {
        if (siteWarehouseId) return siteWarehouseId;
        const activeSiteWarehouses = warehouses.filter(warehouse => !warehouse.isArchived && warehouse.type === 'SITE');
        const site = constructionSiteId ? hrmConstructionSites.find(item => item.id === constructionSiteId) : undefined;
        const siteName = normalizeLookupText(site?.name);
        if (!siteName) return undefined;
        const exactName = activeSiteWarehouses.find(warehouse => normalizeLookupText(warehouse.name).includes(siteName));
        if (exactName) return exactName.id;
        const tokens = siteName.split(' ').filter(token => token.length > 1 && !SITE_WAREHOUSE_STOP_WORDS.has(token));
        if (tokens.length === 0) return undefined;
        const allTokenMatch = activeSiteWarehouses.find(warehouse => {
            const warehouseName = normalizeLookupText(warehouse.name);
            return tokens.every(token => warehouseName.includes(token));
        });
        if (allTokenMatch) return allTokenMatch.id;
        return activeSiteWarehouses.find(warehouse => {
            const warehouseName = normalizeLookupText(warehouse.name);
            return tokens.some(token => warehouseName.includes(token));
        })?.id;
    }, [constructionSiteId, hrmConstructionSites, siteWarehouseId, warehouses]);

    // Material Requests — project screens only show rows explicitly tied to this project.
    const requests = useMemo(() => {
        if (!projectId) return [];
        const byId = new Map<string, MaterialRequest>();
        allRequests
            .filter(request => request.requestOrigin === 'project' && request.projectId === projectId)
            .forEach(request => byId.set(request.id, request));
        projectRequests.forEach(request => byId.set(request.id, request));
        return [...byId.values()];
    }, [allRequests, projectId, projectRequests]);

    const canCreateMaterialRequest = canManageRequest || canSubmitProjectRequest || user.role === Role.ADMIN;

    const sortedRequests = useMemo(
        () => [...requests].sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || '')),
        [requests],
    );

    const inventoryItemById = useMemo(
        () => new Map(inventoryItems.map(item => [item.id, item])),
        [inventoryItems],
    );
    const inventoryItemBySku = useMemo(
        () => new Map(inventoryItems.filter(item => item.sku).map(item => [normalizeKey(item.sku), item])),
        [inventoryItems],
    );
    const workBoqItemById = useMemo(
        () => new Map(workBoqItems.map(item => [item.id, item])),
        [workBoqItems],
    );
    const contractItemById = useMemo(
        () => new Map(contractItems.map(item => [item.id, item])),
        [contractItems],
    );
    const userById = useMemo(
        () => new Map(users.map(item => [item.id, item])),
        [users],
    );

    // Request Modal state
    const [isReqModalOpen, setReqModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);
    const [requestModalInitialAction, setRequestModalInitialAction] = useState<'createFulfillmentBatch' | undefined>(undefined);
    const [requestFulfillmentSummaries, setRequestFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});
    const [requestFulfillmentBatchCounts, setRequestFulfillmentBatchCounts] = useState<Record<string, number>>({});
    const selectedRequestLive = useMemo(
        () => selectedRequest ? requests.find(request => request.id === selectedRequest.id) || selectedRequest : undefined,
        [requests, selectedRequest],
    );

    const requestFulfillmentLineSummaries = useMemo(() => {
        const map: Record<string, Map<string, MaterialRequestFulfillmentSummary['lineSummaries'][number]>> = {};
        Object.entries(requestFulfillmentSummaries).forEach(([requestId, summary]) => {
            map[requestId] = new Map((summary.lineSummaries || []).map(line => [line.requestLineId, line]));
        });
        return map;
    }, [requestFulfillmentSummaries]);

    const loadBoqData = React.useCallback(async () => {
        if (!effectiveId) return;
        const [boq, workItems, taskRows, contractRows, linkRows, poRows] = await Promise.all([
            boqService.list(effectiveId, constructionSiteId || null),
            workBoqService.list(effectiveId, constructionSiteId || null),
            taskService.list(effectiveId, constructionSiteId || null),
            contractItemService.listBySite(effectiveId, 'customer', constructionSiteId || null),
            taskContractItemService.listBySite(effectiveId, constructionSiteId || null),
            poService.list(effectiveId, constructionSiteId || null).catch(() => [] as PurchaseOrder[]),
        ]);
        setBoqItems(boq);
        setWorkBoqItems(workItems);
        setTasks(taskRows);
        setPurchaseOrders(poRows);
        setContractItems(contractRows);
        setTaskContractLinks(linkRows.reduce<Record<string, string[]>>((acc, link: TaskContractItem) => {
            if (!acc[link.taskId]) acc[link.taskId] = [];
            acc[link.taskId].push(link.contractItemId);
            return acc;
        }, {}));
    }, [constructionSiteId, effectiveId]);

    const loadPlanningData = useCallback(async () => {
        if (!effectiveId) {
            setPlanningRules([]);
            setPlanningCurveTemplates([]);
            setPurchaseOrders([]);
            return;
        }
        setPlanningLoading(true);
        try {
            const [rules, curves] = await Promise.all([
                planningScopeKey ? materialPlanningRuleService.listByScope(planningScopeKey) : Promise.resolve([]),
                materialPlanningCurveService.listTemplates(),
                loadBoqData(),
            ]);
            setPlanningRules(rules);
            setPlanningCurveTemplates(curves);
        } catch (error: any) {
            console.error('Failed to load material planning data', error);
            toast.error('Không tải được kế hoạch vật tư', error?.message || 'Vui lòng thử lại.');
        } finally {
            setPlanningLoading(false);
        }
    }, [effectiveId, loadBoqData, planningScopeKey, toast]);

    useEffect(() => {
        if (!materialAccess[activeSubTab].canView) return;
        if (activeSubTab === 'po' || activeSubTab === 'planning') return;
        const boqScopeKey = `${effectiveId || ''}:${constructionSiteId || ''}`;
        if (loadedBoqScopeRef.current === boqScopeKey) return;
        loadedBoqScopeRef.current = boqScopeKey;
        loadBoqData().catch(err => {
            loadedBoqScopeRef.current = null;
            console.error(err);
        });
    }, [activeSubTab, constructionSiteId, effectiveId, loadBoqData, materialAccess]);

    useEffect(() => {
        if (!materialAccess.planning.canView || activeSubTab !== 'planning') return;
        void loadPlanningData();
    }, [activeSubTab, loadPlanningData, materialAccess.planning.canView]);

    useEffect(() => {
        let cancelled = false;
        const loadFulfillment = async () => {
            if (requests.length === 0) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
                setRequestFulfillmentBatches({});
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
            setRequestFulfillmentBatches(batchesByRequest);
            setRequestFulfillmentSummaries(summaries);
            setRequestFulfillmentBatchCounts(counts);
        };
        loadFulfillment().catch(err => {
            console.warn('Failed to load material request fulfillment summaries:', err);
            if (!cancelled) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
                setRequestFulfillmentBatches({});
            }
        });
        return () => { cancelled = true; };
    }, [requests]);

    useEffect(() => {
        let cancelled = false;
        const loadEvents = async () => {
            if (requests.length === 0) {
                setRequestEventsByRequest({});
                return;
            }
            const events = await materialRequestService.listEventsByRequestIds(requests.map(req => req.id));
            if (!cancelled) setRequestEventsByRequest(events);
        };
        loadEvents().catch(err => {
            console.warn('Failed to load material request events:', err);
            if (!cancelled) setRequestEventsByRequest({});
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

    const ensureCanManage = (allowed: boolean, scopeLabel: string, action: string) => {
        if (allowed) return true;
        toast.warning('Không có quyền quản trị', `Bạn cần quyền quản trị "${scopeLabel}" để ${action}.`);
        return false;
    };

    const refreshMaterialRequestWorkflow = async () => {
        await Promise.all([
            loadProjectRequests(),
            loadModuleData('wms-core', true),
        ]);
    };

    const canActOnProjectRequest = (request: MaterialRequest) =>
        user.role === Role.ADMIN ||
        (canApproveProjectRequest && request.submittedToUserId === user.id);

    const hasOverBudgetLines = (request: MaterialRequest) =>
        (request.items || []).some(line => Number((line as any).overBudgetQtySnapshot || 0) > 0);

    const canApproveOverBudgetRequest = (request: MaterialRequest) =>
        !hasOverBudgetLines(request) || user.role === Role.ADMIN || isGlobalWarehouseKeeper(user);

    const warnOverBudgetApprovalRequired = () => {
        toast.warning('Cần duyệt vượt BOQ', 'Phiếu có vật tư vượt KL dự toán. Chỉ admin hoặc thủ kho tổng được duyệt qua bước tạo đợt cấp.');
    };

    const canMoveMaterialRequest = (request: MaterialRequest, toStage: MaterialRequestKanbanStage, fromStage: MaterialRequestKanbanStage) => {
        if (toStage === 'closed') {
            return ['site_manager_review', 'material_department_review'].includes(fromStage) && canActOnProjectRequest(request);
        }
        if (fromStage === 'draft' && toStage === 'site_manager_review') {
            return canCreateMaterialRequest && (request.requesterId === user.id || user.role === Role.ADMIN);
        }
        if (fromStage === 'site_manager_review' && toStage === 'material_department_review') {
            return canActOnProjectRequest(request);
        }
        if (fromStage === 'material_department_review' && toStage === 'batch_planning') {
            return canActOnProjectRequest(request);
        }
        if (fromStage === 'batch_planning' && toStage === 'site_quality_check') {
            return request.status === RequestStatus.APPROVED
                && (
                    user.role === Role.ADMIN
                    || isGlobalWarehouseKeeper(user)
                    || isWarehouseKeeperFor(user, request.sourceWarehouseId)
                    || canActOnProjectRequest(request)
                );
        }
        return false;
    };

    const upsertProjectRequest = (request: MaterialRequest) => {
        setProjectRequests(prev => {
            const exists = prev.some(item => item.id === request.id);
            if (!exists) return [request, ...prev];
            return prev.map(item => item.id === request.id ? request : item);
        });
    };

    const performRequestTransition = async (params: {
        request: MaterialRequest;
        toStep: MaterialRequestWorkflowStep;
        status: RequestStatus;
        action: string;
        target?: ProjectSubmissionTarget | null;
        note?: string | null;
        metadata?: Record<string, any>;
    }) => {
        setTransitioningRequestId(params.request.id);
        try {
            const updated = await materialRequestService.transitionProjectRequestStep({
                request: params.request,
                toStep: params.toStep,
                status: params.status,
                action: params.action,
                actorUserId: user.id,
                target: params.target,
                note: params.note,
                metadata: params.metadata,
            });
            upsertProjectRequest(updated);
            const events = await materialRequestService.listEventsByRequestIds([updated.id]);
            setRequestEventsByRequest(prev => ({ ...prev, ...events }));
            if (params.target?.userId) {
                void projectSubmissionService.notifyTarget({
                    target: params.target,
                    actorId: user.id,
                    category: 'material',
                    title: 'Phiếu vật tư cần xử lý',
                    message: `Phiếu ${updated.code} đang chờ bạn xử lý.`,
                    sourceType: 'material_request',
                    sourceId: updated.id,
                    constructionSiteId: updated.constructionSiteId || undefined,
                    link: `/da?projectId=${updated.projectId || ''}&siteId=${updated.constructionSiteId || ''}&tab=material&materialTab=request`,
                    metadata: { requestId: updated.id, workflowStep: updated.workflowStep },
                });
            }
            await refreshMaterialRequestWorkflow();
            toast.success('Đã cập nhật luồng vật tư', `Phiếu ${updated.code} đã chuyển bước.`);
        } catch (error: any) {
            logApiError('materialTab.requestTransition', error);
            toast.error('Không thể chuyển bước', getApiErrorMessage(error, 'Không cập nhật được luồng phiếu vật tư.'));
            throw error;
        } finally {
            setTransitioningRequestId(null);
        }
    };

    const handleMoveMaterialRequest = (request: MaterialRequest, toStage: MaterialRequestKanbanStage, fromStage: MaterialRequestKanbanStage) => {
        if (!canMoveMaterialRequest(request, toStage, fromStage)) {
            toast.warning('Không thể chuyển bước', 'Bạn không có quyền hoặc bước này không cho phép kéo thả.');
            return;
        }
        if (toStage === 'site_manager_review') {
            setSubmissionTransition({
                request,
                toStep: 'site_manager_review',
                status: RequestStatus.PENDING,
                action: 'SUBMITTED',
                title: 'Gửi quản lý công trường duyệt',
                subtitle: 'Phiếu sẽ chuyển sang Chờ quản lý CT duyệt.',
            });
            return;
        }
        if (toStage === 'material_department_review') {
            setSubmissionTransition({
                request,
                toStep: 'material_department_review',
                status: RequestStatus.PENDING,
                action: 'FORWARDED',
                title: 'Gửi phòng vật tư xử lý',
                subtitle: 'Phiếu vẫn ở trạng thái Chờ duyệt và chuyển người xử lý sang phòng vật tư.',
            });
            return;
        }
        if (toStage === 'batch_planning') {
            if (!canApproveOverBudgetRequest(request)) {
                warnOverBudgetApprovalRequired();
                return;
            }
            setSubmissionTransition({
                request,
                toStep: 'batch_planning',
                status: RequestStatus.APPROVED,
                action: 'APPROVED',
                title: 'Duyệt và giao người tạo đợt cấp',
                subtitle: 'Phiếu sẽ chuyển sang Chờ tạo đợt cấp. Chọn người phụ trách lập đợt cấp tiếp theo.',
                recipientHint: 'Chọn người phòng vật tư/phụ trách cấp hàng để tạo đợt cấp. Người này có thể khác người duyệt phiếu.',
                source: 'kanban_drag',
            });
            return;
        }
        if (toStage === 'site_quality_check') {
            setSelectedRequest(request);
            setRequestModalInitialAction('createFulfillmentBatch');
            setReqModalOpen(true);
            return;
        }
        if (toStage === 'closed') {
            setTerminalTransition({ request, fromStage });
            setTerminalAction('return');
            setTerminalNote('');
        }
    };

    const closeWorkflowRequestModal = () => {
        setReqModalOpen(false);
        setSelectedRequest(undefined);
        setRequestModalInitialAction(undefined);
    };

    const handleProjectWorkflowApproveFromModal = (request: MaterialRequest) => {
        const currentStep = request.workflowStep;
        if (!canActOnProjectRequest(request)) {
            toast.warning('Không thể xử lý phiếu', 'Bạn không phải người đang được giao xử lý phiếu này.');
            return;
        }
        if (currentStep === 'site_manager_review') {
            closeWorkflowRequestModal();
            setSubmissionTransition({
                request,
                toStep: 'material_department_review',
                status: RequestStatus.PENDING,
                action: 'FORWARDED',
                title: 'Gửi phòng vật tư xử lý',
                subtitle: 'Phiếu vẫn ở trạng thái Chờ duyệt và chuyển người xử lý sang phòng vật tư.',
            });
            return;
        }
        if (currentStep === 'material_department_review') {
            if (!canApproveOverBudgetRequest(request)) {
                warnOverBudgetApprovalRequired();
                return;
            }
            closeWorkflowRequestModal();
            setSubmissionTransition({
                request,
                toStep: 'batch_planning',
                status: RequestStatus.APPROVED,
                action: 'APPROVED',
                title: 'Duyệt và giao người tạo đợt cấp',
                subtitle: 'Phiếu sẽ chuyển sang Chờ tạo đợt cấp. Chọn người phụ trách lập đợt cấp tiếp theo.',
                recipientHint: 'Chọn người phòng vật tư/phụ trách cấp hàng để tạo đợt cấp. Người này có thể khác người duyệt phiếu.',
                source: 'request_modal',
            });
            return;
        }
        toast.warning('Không thể xử lý phiếu', 'Bước hiện tại không hỗ trợ duyệt từ chi tiết phiếu.');
    };

    const handleProjectWorkflowReturnFromModal = (request: MaterialRequest) => {
        if (!canActOnProjectRequest(request)) {
            toast.warning('Không thể xử lý phiếu', 'Bạn không phải người đang được giao xử lý phiếu này.');
            return;
        }
        const fromStage = request.workflowStep === 'material_department_review' ? 'material_department_review' : 'site_manager_review';
        closeWorkflowRequestModal();
        setTerminalTransition({ request, fromStage });
        setTerminalAction('return');
        setTerminalNote('');
    };

    const handleSubmitTransitionTarget = async (target: ProjectSubmissionTarget) => {
        if (!submissionTransition) return;
        await performRequestTransition({
            request: submissionTransition.request,
            toStep: submissionTransition.toStep,
            status: submissionTransition.status,
            action: submissionTransition.action,
            target,
            note: target.note,
            metadata: { source: submissionTransition.source || 'kanban_drag' },
        });
        setSubmissionTransition(null);
    };

    const handleTerminalTransition = async () => {
        if (!terminalTransition) return;
        const note = terminalNote.trim();
        if (!note) {
            toast.warning('Thiếu ghi chú', 'Vui lòng nhập lý do trả lại hoặc từ chối.');
            return;
        }
        const request = terminalTransition.request;
        const isReturn = terminalAction === 'return';
        await performRequestTransition({
            request,
            toStep: isReturn ? 'returned_to_creator' : 'rejected',
            status: isReturn ? RequestStatus.DRAFT : RequestStatus.REJECTED,
            action: isReturn ? 'RETURNED' : 'REJECTED',
            target: isReturn
                ? { userId: request.requesterId, name: userById.get(request.requesterId)?.name || request.requesterId, permissionCode: 'edit', note }
                : null,
            note,
            metadata: { fromStage: terminalTransition.fromStage, source: 'kanban_drag' },
        });
        setTerminalTransition(null);
        setTerminalNote('');
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
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'sửa BOQ vật tư')) return;
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

    // Compute actualQty from successful site receipts; legacy completed requests fall back to approvedQty.
    const computedBoqItems = useMemo(() => {
        return boqItems.map(b => {
            let totalReceived = 0;
            let totalRequested = 0;
            requests.filter(r => r.status !== RequestStatus.REJECTED).forEach(r => {
                const rItems = r.items || [];
                const requestSummary = requestFulfillmentSummaries[r.id];
                const hasFulfillmentBatches = (requestFulfillmentBatchCounts[r.id] || 0) > 0;
                const summaryByLine = requestFulfillmentLineSummaries[r.id];
                rItems.forEach((ri: any, index: number) => {
                    const sameBudgetLine = ri.materialBudgetItemId && ri.materialBudgetItemId === b.id;
                    const legacySameItem = !!b.inventoryItemId && !ri.materialBudgetItemId && ri.itemId === b.inventoryItemId;
                    if (sameBudgetLine || legacySameItem) {
                        totalRequested += (ri.requestQty || 0);
                        const requestLineId = getRequestLineId(r, ri, index);
                        const lineSummary = summaryByLine?.get(requestLineId);
                        if (hasFulfillmentBatches && lineSummary) {
                            totalReceived += lineSummary.receivedQty;
                        } else if (r.status === RequestStatus.COMPLETED) {
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
    }, [boqItems, requestFulfillmentBatchCounts, requestFulfillmentLineSummaries, requests]);

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
            [...items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).forEach(item => {
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
        const linkedContractItems = linkedIds.map(id => contractItemById.get(id)).filter(Boolean) as ContractItem[];
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

    const sortedWasteBoqItems = useMemo(
        () => [...computedBoqItems].sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)),
        [computedBoqItems],
    );

    const handleSyncWithSchedule = async () => {
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'đồng bộ BOQ vật tư')) return;
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
            toast.error('Không thể đồng bộ BOQ', formatBoqWriteError(error));
        } finally {
            setSyncingBoq(false);
        }
    };

    const handleSaveBoq = async () => {
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'lưu BOQ vật tư')) return;
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

        try {
            await boqService.upsert(item);
            await loadBoqData();
            toast.success(editingBoq ? 'Cập nhật BOQ' : 'Thêm mục BOQ thành công');
            resetBoqForm();
        } catch (error: any) {
            logApiError('MaterialTab.handleSaveBoq', error);
            toast.error('Không thể lưu BOQ vật tư', formatBoqWriteError(error));
        }
    };

    const handleDeleteBoq = async (id: string, name: string) => {
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'xoá BOQ vật tư')) return;
        const ok = await confirm({ targetName: name, title: 'Xoá mục BOQ' });
        if (!ok) return;
        try {
            await boqService.remove(id);
            await loadBoqData();
            toast.success('Xoá BOQ thành công');
        } catch (e: any) {
            logApiError('MaterialTab.handleDeleteBoq', e);
            toast.error('Lỗi xoá', formatBoqWriteError(e));
        }
    };

    const buildWorkBoqExcelRows = () => workBoqTree.map(({ item }) => ({
            'Mã WBS': item.wbsCode || '',
            'Mã cha': item.parentId ? workBoqItems.find(parent => parent.id === item.parentId)?.wbsCode || '' : '',
            'Tên đầu mục': item.name,
            'ĐVT': item.unit || '',
            'KL dự toán': item.plannedQty || 0,
            'Đơn giá': item.unitPrice || 0,
            'Ghi chú': item.notes || '',
        }));

    const buildMaterialBoqExcelRows = (includeActualColumns = true) => computedBoqItems.map(item => {
            const workItem = item.workBoqItemId ? workBoqItems.find(work => work.id === item.workBoqItemId) : undefined;
            const row: Record<string, string | number> = {
                'WBS đầu mục': workItem?.wbsCode || '',
                'Mã vật tư/SKU': item.materialCode || '',
                'Tên vật tư': item.itemName,
                'Nhóm': item.category,
                'ĐVT': item.unit,
                'KL dự toán': item.budgetQty,
                'Đơn giá': item.budgetUnitPrice,
                'Ngưỡng hao hụt (%)': item.wasteThreshold,
                'Ghi chú': item.notes || '',
            };
            if (includeActualColumns) {
                row['KL thực tế công trường'] = item.actualQty || 0;
                row['Giá trị thực tế công trường'] = item.actualTotal || 0;
                row['Chênh KL thực tế - dự toán'] = item.wasteQty || 0;
            }
            return row;
        });

    const buildWorkBoqWorkbook = (XLSX: any, workRows: Record<string, string | number>[], materialRows: Record<string, string | number>[], includeActualColumns = true) => {
        const wb = XLSX.utils.book_new();
        const helpRows = [
            { 'Nội dung': 'Sheet Dau_muc', 'Ghi chú': 'Mỗi dòng là một đầu mục/WBS. Mã WBS là khóa để cập nhật nếu import lại.' },
            { 'Nội dung': 'Sheet Vat_tu', 'Ghi chú': 'Nhập vật tư theo WBS đầu mục. Mã vật tư/SKU sẽ tự liên kết với danh mục kho nếu đã có.' },
            { 'Nội dung': 'Cột bắt buộc đầu mục', 'Ghi chú': 'Mã WBS, Tên đầu mục.' },
            { 'Nội dung': 'Cột bắt buộc vật tư', 'Ghi chú': 'WBS đầu mục, Tên vật tư, ĐVT, KL dự toán. Có thể chỉ nhập SKU nếu SKU đã tồn tại trong kho.' },
            { 'Nội dung': 'Import', 'Ghi chú': 'Hệ thống hiện preview trước: dòng hợp lệ được ghi, dòng lỗi sẽ báo lý do để sửa file.' },
        ];
        const helpSheet = XLSX.utils.json_to_sheet(helpRows);
        helpSheet['!cols'] = [{ wch: 26 }, { wch: 92 }];
        XLSX.utils.book_append_sheet(wb, helpSheet, 'Huong_dan');

        const makeSheet = (headers: string[], rows: Record<string, string | number>[]) => {
            const sheet = XLSX.utils.aoa_to_sheet([headers]);
            if (rows.length > 0) {
                XLSX.utils.sheet_add_json(sheet, rows, { header: headers, skipHeader: true, origin: 'A2' });
            }
            return sheet;
        };

        const workSheet = makeSheet(WORK_BOQ_HEADERS, workRows);
        workSheet['!cols'] = [12, 12, 38, 10, 14, 14, 36].map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(wb, workSheet, WORK_BOQ_SHEET_NAME);

        const materialHeaders = includeActualColumns
            ? [...MATERIAL_BOQ_HEADERS, 'KL thực tế công trường', 'Giá trị thực tế công trường', 'Chênh KL thực tế - dự toán']
            : MATERIAL_BOQ_HEADERS;
        const materialSheet = makeSheet(materialHeaders, materialRows);
        materialSheet['!cols'] = [14, 18, 34, 20, 10, 14, 14, 16, 36, 18, 24, 24].map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(wb, materialSheet, MATERIAL_BOQ_SHEET_NAME);
        return wb;
    };

    const handleDownloadWorkBoqTemplate = async () => {
        const XLSX = await loadXlsx();
        const currentWorkRows = buildWorkBoqExcelRows();
        const sampleWbs = currentWorkRows[0]?.['Mã WBS'] || '1.1';
        const workRows = currentWorkRows.length > 0 ? currentWorkRows : [{
            'Mã WBS': '1.1',
            'Mã cha': '1',
            'Tên đầu mục': 'Đào đất móng',
            'ĐVT': 'm3',
            'KL dự toán': 0,
            'Đơn giá': 0,
            'Ghi chú': '',
        }];
        const materialRows = currentWorkRows.length > 0 ? [] : [{
            'WBS đầu mục': sampleWbs,
            'Mã vật tư/SKU': 'VT001',
            'Tên vật tư': 'Xi măng PCB40',
            'Nhóm': 'Vật liệu xây dựng',
            'ĐVT': 'bao',
            'KL dự toán': 0,
            'Đơn giá': 0,
            'Ngưỡng hao hụt (%)': 5,
            'Ghi chú': '',
        }];
        const wb = buildWorkBoqWorkbook(XLSX, workRows, materialRows, false);
        XLSX.writeFile(wb, `Mau_import_BOQ_vat_tu_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleExportWorkBoq = async () => {
        const XLSX = await loadXlsx();
        const wb = buildWorkBoqWorkbook(XLSX, buildWorkBoqExcelRows(), buildMaterialBoqExcelRows(true), true);
        XLSX.writeFile(wb, `BOQ_trien_khai_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleImportWorkBoq = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'import BOQ vật tư')) {
            event.target.value = '';
            return;
        }
        const file = event.target.files?.[0];
        if (!file) return;
        setImportingBoq(true);
        try {
            const XLSX = await loadXlsx();
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const firstSheetName = wb.SheetNames[0];
            const firstSheet = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
            const firstRows = firstSheet
                ? XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: false }).filter(rowHasAnyValue)
                : [];
            const firstLooksMaterial = firstRows.some(row =>
                importText(row, ['WBS đầu mục', 'Mã WBS đầu mục', 'Mã vật tư/SKU', 'Mã vật tư', 'SKU', 'Tên vật tư']) !== ''
            );
            const namedWorkSheet = wb.Sheets[WORK_BOQ_SHEET_NAME] || wb.Sheets['BOQ_trien_khai'];
            const namedMaterialSheet = wb.Sheets[MATERIAL_BOQ_SHEET_NAME] || wb.Sheets['Vat tư'] || wb.Sheets['Vat tu'];
            const workSheet = namedWorkSheet || (!firstLooksMaterial ? firstSheet : undefined);
            const materialSheet = namedMaterialSheet || (firstLooksMaterial ? firstSheet : undefined);
            const rawWorkRows = workSheet
                ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workSheet, { defval: '', raw: false }).filter(rowHasAnyValue)
                : [];
            const rawMaterialRows = materialSheet
                ? XLSX.utils.sheet_to_json<Record<string, unknown>>(materialSheet, { defval: '', raw: false }).filter(rowHasAnyValue)
                : [];
            const existingWorkByWbs = new Map(workBoqItems.filter(item => item.wbsCode).map(item => [normalizeKey(item.wbsCode), item]));
            const seenWorkWbs = new Set<string>();

            const workRows: WorkBoqImportPreview['workRows'] = rawWorkRows.map((row, index) => {
                const wbs = importText(row, ['Mã WBS', 'WBS']);
                const name = importText(row, ['Tên đầu mục', 'Tên công việc', 'Đầu mục']);
                const wbsKey = normalizeKey(wbs);
                const errors: string[] = [];
                if (!wbs) errors.push('Thiếu Mã WBS.');
                else if (!isValidWbsCode(wbs)) errors.push('Mã WBS không hợp lệ.');
                else if (seenWorkWbs.has(wbsKey)) errors.push('Mã WBS bị trùng trong file.');
                if (!name) errors.push('Thiếu Tên đầu mục.');
                if (wbs) seenWorkWbs.add(wbsKey);
                const existing = existingWorkByWbs.get(normalizeKey(wbs));
                const plannedQty = importNumber(pickImportValue(row, ['KL dự toán', 'Khối lượng dự toán', 'Khối lượng']));
                const unitPrice = importNumber(pickImportValue(row, ['Đơn giá', 'Đơn giá dự toán']));
                const item: ProjectWorkBoqItem = {
                    id: existing?.id || crypto.randomUUID(),
                    projectId: effectiveId,
                    constructionSiteId: constructionSiteId || null,
                    sourceTaskId: existing?.sourceTaskId || null,
                    parentId: null,
                    wbsCode: wbs,
                    name,
                    unit: importText(row, ['ĐVT', 'Đơn vị']) || existing?.unit || '',
                    plannedQty,
                    unitPrice,
                    totalAmount: plannedQty * unitPrice,
                    sortOrder: existing?.sortOrder ?? index,
                    syncStatus: existing?.sourceTaskId ? existing.syncStatus : 'manual',
                    notes: importText(row, ['Ghi chú', 'Notes']) || existing?.notes || null,
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
                const parentWbs = source ? importText(source, ['Mã cha', 'Mã WBS cha', 'WBS cha']) : '';
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
            const existingMaterials = new Map<string, MaterialBudgetItem>();
            computedBoqItems.forEach(item => {
                const workKey = item.workBoqItemId || '';
                const inventory = item.inventoryItemId ? inventoryItemById.get(item.inventoryItemId) : undefined;
                [
                    item.materialCode,
                    inventory?.sku,
                    `${item.itemName}|${item.unit}`,
                ].filter(Boolean).forEach(key => {
                    existingMaterials.set(`${workKey}|${normalizeKey(key as string)}`, item);
                });
            });
            const materialRows = rawMaterialRows.map((row, index) => {
                const workWbs = importText(row, ['WBS đầu mục', 'Mã WBS đầu mục', 'Mã WBS']);
                const workItem = workByWbs.get(normalizeKey(workWbs));
                const materialCode = importText(row, ['Mã vật tư/SKU', 'Mã vật tư', 'SKU']);
                const matchedInventory = materialCode ? inventoryItemBySku.get(normalizeKey(materialCode)) : undefined;
                const itemName = importText(row, ['Tên vật tư', 'Tên hàng hóa', 'Tên hàng hoá']) || matchedInventory?.name || '';
                const unit = importText(row, ['ĐVT', 'Đơn vị']) || matchedInventory?.unit || '';
                const errors: string[] = [];
                if (!workItem) errors.push(`Không tìm thấy đầu mục WBS "${workWbs}".`);
                if (!itemName) errors.push('Thiếu Tên vật tư.');
                if (!unit) errors.push('Thiếu ĐVT.');
                const matchKeys = [
                    materialCode,
                    matchedInventory?.sku,
                    `${itemName}|${unit}`,
                ].filter(Boolean).map(key => `${workItem?.id || ''}|${normalizeKey(key as string)}`);
                const existing = matchKeys.map(key => existingMaterials.get(key)).find(Boolean);
                const budgetQty = importNumber(pickImportValue(row, ['KL dự toán', 'Khối lượng dự toán', 'Khối lượng']));
                const importedUnitPrice = importNumber(pickImportValue(row, ['Đơn giá', 'Đơn giá dự toán']));
                const budgetUnitPrice = importedUnitPrice || existing?.budgetUnitPrice || matchedInventory?.priceIn || 0;
                const wasteThreshold = importNumber(pickImportValue(row, ['Ngưỡng hao hụt (%)', 'Ngưỡng hao hụt', 'Định mức hao hụt'])) || existing?.wasteThreshold || 5;
                const item: MaterialBudgetItem = {
                    id: existing?.id || crypto.randomUUID(),
                    projectId: effectiveId,
                    constructionSiteId: constructionSiteId || null,
                    workBoqItemId: workItem?.id || null,
                    materialCode: materialCode || existing?.materialCode || matchedInventory?.sku,
                    category: importText(row, ['Nhóm', 'Nhóm vật tư', 'Category']) || existing?.category || matchedInventory?.category || 'Vật liệu xây dựng',
                    itemName,
                    unit,
                    budgetQty,
                    budgetUnitPrice,
                    budgetTotal: budgetQty * budgetUnitPrice,
                    actualQty: existing?.actualQty || 0,
                    wasteThreshold,
                    sortOrder: existing?.sortOrder ?? index,
                    notes: importText(row, ['Ghi chú', 'Notes']) || existing?.notes || undefined,
                    inventoryItemId: existing?.inventoryItemId || matchedInventory?.id,
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
        if (!ensureCanManage(canManageBoq, 'Vật tư: BOQ', 'áp dụng import BOQ vật tư')) return;
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
            toast.error('Không thể ghi import', formatBoqWriteError(error));
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

    const handlePlanningRuleSaved = useCallback((rule: MaterialPlanningRule) => {
        setPlanningRules(prev => {
            const sameTarget = (item: MaterialPlanningRule) =>
                item.id === rule.id ||
                (rule.inventoryItemId && item.inventoryItemId === rule.inventoryItemId && item.scopeKey === rule.scopeKey) ||
                (!rule.inventoryItemId && !item.inventoryItemId && item.scopeKey === rule.scopeKey && normalizeKey(item.category) === normalizeKey(rule.category));
            const exists = prev.some(sameTarget);
            return exists ? prev.map(item => sameTarget(item) ? rule : item) : [...prev, rule];
        });
    }, []);

    const handleCreatePlanningDraftPo = useCallback((draft: MaterialPlanningDraftPo) => {
        if (!materialAccess.po.canView || !canManagePo) {
            toast.warning('Không có quyền tạo PO', 'Bạn cần quyền quản trị Đơn hàng PO để tạo PO từ kế hoạch vật tư.');
            return;
        }
        setPlanningDraftPo(draft);
        setPlanningDraftPoKey(prev => prev + 1);
        setActiveSubTab('po');
    }, [canManagePo, materialAccess.po.canView, toast]);

    const materialTabLabels: Record<ProjectMaterialTabKey, string> = {
        summary: '🔗 Tổng hợp',
        boq: '📋 BOQ',
        planning: '🧭 Kế hoạch',
        request: '📦 Yêu cầu',
        po: '🛒 Đơn hàng (PO)',
        waste: '📊 Hao hụt',
        dashboard: '📈 Dashboard',
    };
    const materialTabCounts: Record<ProjectMaterialTabKey, number> = {
        summary: computedBoqItems.length,
        boq: workBoqItems.length + computedBoqItems.length,
        planning: 0,
        request: requests.length,
        po: 0,
        waste: stats.overWaste,
        dashboard: 0,
    };

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
                {visibleMaterialTabs.map(t => (
                    <button key={t.key} onClick={() => setActiveSubTab(t.key)}
                        className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeSubTab === t.key ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                            }`}>
                        {materialTabLabels[t.key]} {materialTabCounts[t.key] > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeSubTab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{materialTabCounts[t.key]}</span>}
                    </button>
                ))}
            </div>

            {visibleMaterialTabs.length === 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm">
                    <Package size={36} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm font-bold text-slate-500">Tài khoản chưa được cấp quyền xem phần Vật tư</p>
                    <p className="mt-1 text-[10px] text-slate-300">Admin có thể cấp quyền tại DA - Dự án / Vật tư.</p>
                </div>
            )}

            {/* ===== SUMMARY TAB - Bảng tổng hợp 1 dòng ===== */}
            {materialAccess.summary.canView && activeSubTab === 'summary' && (
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
            {materialAccess.boq.canView && activeSubTab === 'boq' && (
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
                                {canManageBoq && (
                                    <button onClick={handleSyncWithSchedule} disabled={syncingBoq}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
                                        <RefreshCcw size={12} className={syncingBoq ? 'animate-spin' : ''} /> Đồng bộ với tiến độ
                                    </button>
                                )}
                                <button onClick={handleDownloadWorkBoqTemplate}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100">
                                    <FileSpreadsheet size={12} /> File mẫu
                                </button>
                                <button onClick={handleExportWorkBoq}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100">
                                    <Download size={12} /> Xuất Excel
                                </button>
                                {canManageBoq && (
                                    <>
                                        <button onClick={() => boqImportRef.current?.click()} disabled={importingBoq}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                                            <Upload size={12} /> Nhập Excel
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
                                <table className="w-full text-xs min-w-[1500px]">
                                    <thead className="bg-slate-50/80">
                                        <tr className="text-[10px] font-bold text-slate-400 uppercase">
                                            <th className="text-left px-4 py-3">Đầu mục / Vật tư</th>
                                            <th className="text-center px-4 py-3">ĐVT</th>
                                            <th className="text-right px-4 py-3">KL Dự toán</th>
                                            <th className="text-right px-4 py-3">Đơn giá</th>
                                            <th className="text-right px-4 py-3">GT Triển khai</th>
                                            <th className="text-right px-4 py-3">KL Thực tế CT</th>
                                            <th className="text-right px-4 py-3">GT Thực tế CT</th>
                                            <th className="text-right px-4 py-3">Chênh KL</th>
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
                                                        <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-300">—</td>
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
                                                            {canManageBoq && (
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
                                                                <td className="px-4 py-2.5 text-right font-black text-cyan-700">{(mat.actualQty || 0).toLocaleString()}</td>
                                                                <td className="px-4 py-2.5 text-right font-bold text-cyan-700">{fmt(mat.actualTotal || 0)}</td>
                                                                <td className={`px-4 py-2.5 text-right font-black ${(mat.wasteQty || 0) > 0 ? 'text-red-500' : (mat.wasteQty || 0) < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                                                    {(mat.wasteQty || 0) > 0 ? '+' : ''}{(mat.wasteQty || 0).toLocaleString()}
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-300">—</td>
                                                                <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : (mat.wastePercent || 0) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                                    {(mat.wastePercent || 0) > 0 ? '+' : ''}{mat.wastePercent || 0}%
                                                                </td>
                                                                <td className="px-4 py-2.5 text-center">
                                                                    {isOver ? <AlertTriangle size={12} className="inline text-red-500" /> : <CheckCircle2 size={12} className="inline text-emerald-500" />}
                                                                </td>
                                                                <td className="px-4 py-2.5">
                                                                    {canManageBoq && (
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
                                                <td className="px-4 py-2.5 text-right font-black text-cyan-700">{(mat.actualQty || 0).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-cyan-700">{fmt(mat.actualTotal || 0)}</td>
                                                <td className={`px-4 py-2.5 text-right font-black ${(mat.wasteQty || 0) > 0 ? 'text-red-500' : (mat.wasteQty || 0) < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                                    {(mat.wasteQty || 0) > 0 ? '+' : ''}{(mat.wasteQty || 0).toLocaleString()}
                                                </td>
                                                <td colSpan={4}></td>
                                                <td className="px-4 py-2.5">
                                                    {canManageBoq && (
                                                        <button onClick={() => openEditBoq(mat)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500"><Edit2 size={11} /></button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50/80 font-bold">
                                        <tr className="text-xs">
                                            <td colSpan={4} className="px-4 py-3 text-slate-600">TỔNG CỘNG VẬT TƯ</td>
                                            <td className="px-4 py-3 text-right text-slate-700">{fmt(stats.totalBudget)} đ</td>
                                            <td className="px-4 py-3 text-right text-slate-300">—</td>
                                            <td className="px-4 py-3 text-right text-cyan-700">{fmt(stats.totalActual)} đ</td>
                                            <td className="px-4 py-3 text-right text-slate-300">—</td>
                                            <td colSpan={5}></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {materialAccess.planning.canView && activeSubTab === 'planning' && (
                <MaterialPlanningPanel
                    projectId={projectId || null}
                    constructionSiteId={constructionSiteId || null}
                    scopeKey={planningScopeKey}
                    siteWarehouseId={defaultSiteWarehouseId}
                    canManage={canManagePlanning}
                    userId={user.id}
                    tasks={tasks}
                    workBoqItems={workBoqItems}
                    materialBudgetItems={computedBoqItems}
                    inventoryItems={inventoryItems}
                    purchaseOrders={purchaseOrders}
                    transactions={transactions}
                    rules={planningRules}
                    curveTemplates={planningCurveTemplates}
                    loading={planningLoading}
                    onRefresh={loadPlanningData}
                    onRuleSaved={handlePlanningRuleSaved}
                    onCreateDraftPo={handleCreatePlanningDraftPo}
                />
            )}

            {/* Material Request Tab — using MaterialRequest from Inventory module */}
            {materialAccess.request.canView && activeSubTab === 'request' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-black text-slate-700 flex items-center gap-2"><Package size={16} className="text-purple-500" /> Đề xuất vật tư ({requests.length})</h3>
                            <p className="mt-1 text-[10px] font-bold text-slate-400">Kanban SLA theo luồng công trường - phòng vật tư - kho công trường</p>
                        </div>
                        {canCreateMaterialRequest && (
                            <button onClick={() => { setSelectedRequest(undefined); setReqModalOpen(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100">
                                <Plus size={12} /> Tạo đề xuất
                            </button>
                        )}
                    </div>
                    {!canCreateMaterialRequest && (
                        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-[11px] font-bold text-amber-700">
                            Tài khoản chỉ đang có quyền xem. Muốn tạo/gửi đề xuất cần quyền submit trong Tổ chức dự án.
                        </div>
                    )}
                    {transitioningRequestId && (
                        <div className="border-b border-indigo-100 bg-indigo-50 px-5 py-2 text-[11px] font-bold text-indigo-700">
                            Đang cập nhật luồng phiếu {transitioningRequestId.slice(-6)}...
                        </div>
                    )}
                    {requests.length === 0 ? (
                        <div className="p-12 text-center">
                            <Package size={36} className="mx-auto mb-2 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">Chưa có phiếu đề xuất vật tư</p>
                            <p className="text-[10px] text-slate-300 mt-1">Tạo đề xuất mới để yêu cầu vật tư từ Kho Tổng</p>
                        </div>
                    ) : (
                        <MaterialRequestKanbanBoard
                            requests={sortedRequests}
                            fulfillmentSummaries={requestFulfillmentSummaries}
                            fulfillmentBatches={requestFulfillmentBatches}
                            eventsByRequest={requestEventsByRequest}
                            transactions={transactions}
                            inventoryItemById={inventoryItemById}
                            workBoqItemById={workBoqItemById}
                            userById={userById}
                            canMoveRequest={canMoveMaterialRequest}
                            onMoveRequest={handleMoveMaterialRequest}
                            onOpenRequest={req => { setSelectedRequest(req); setRequestModalInitialAction(undefined); setReqModalOpen(true); }}
                        />
                    )}
                </div>
            )}

            {materialAccess.po.canView && activeSubTab === 'po' && (
                <SupplyChainTab
                    constructionSiteId={constructionSiteId}
                    projectId={projectId}
                    canManageTab={canManagePo}
                    initialDraftPo={planningDraftPo}
                    initialDraftPoKey={planningDraftPoKey}
                    compact
                />
            )}

            {/* Waste Comparison Tab */}
            {materialAccess.waste.canView && activeSubTab === 'waste' && (
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
                                            {sortedWasteBoqItems.map(item => {
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

            {submissionTransition && (
                <ProjectSubmissionDialog
                    title={submissionTransition.title}
                    actionLabel="Chuyển bước"
                    documentLabel="Đề xuất vật tư dự án"
                    documentName={submissionTransition.request.code}
                    documentSubtitle={submissionTransition.subtitle}
                    projectId={projectId || undefined}
                    constructionSiteId={constructionSiteId || null}
                    recipientPermissionCodes={['approve']}
                    recipientHint={submissionTransition.recipientHint || 'Chọn đích danh nhân sự dự án có quyền approve để xử lý bước tiếp theo.'}
                    details={[
                        { label: 'Kho nhận', value: warehouses.find(w => w.id === submissionTransition.request.siteWarehouseId)?.name || submissionTransition.request.siteWarehouseId },
                        { label: 'Số dòng vật tư', value: `${submissionTransition.request.items.length} dòng` },
                        { label: 'SLA bước mới', value: submissionTransition.toStep === 'batch_planning' ? '48h' : '24h' },
                        { label: 'Ghi chú phiếu', value: submissionTransition.request.note || '-' },
                    ]}
                    onCancel={() => setSubmissionTransition(null)}
                    onConfirm={handleSubmitTransitionTarget}
                />
            )}

            {terminalTransition && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 px-4 py-6">
                    <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
                        <div className="border-b border-slate-100 px-5 py-4">
                            <h3 className="text-base font-black text-slate-800">Trả lại / từ chối phiếu vật tư</h3>
                            <p className="mt-1 text-xs font-bold text-slate-400">{terminalTransition.request.code}</p>
                        </div>
                        <div className="space-y-4 p-5">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setTerminalAction('return')}
                                    className={`rounded-xl border px-4 py-3 text-left text-xs font-black ${terminalAction === 'return' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Trả lại người tạo
                                    <span className="mt-1 block text-[10px] font-bold opacity-70">Phiếu về Nháp để bổ sung.</span>
                                </button>
                                <button
                                    onClick={() => setTerminalAction('reject')}
                                    className={`rounded-xl border px-4 py-3 text-left text-xs font-black ${terminalAction === 'reject' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Từ chối hẳn
                                    <span className="mt-1 block text-[10px] font-bold opacity-70">Phiếu chuyển trạng thái Từ chối.</span>
                                </button>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Lý do bắt buộc</label>
                                <textarea
                                    rows={4}
                                    value={terminalNote}
                                    onChange={event => setTerminalNote(event.target.value)}
                                    placeholder="Nhập nội dung cần người tạo/phòng vật tư biết..."
                                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-300"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
                            <button onClick={() => setTerminalTransition(null)} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">
                                Hủy
                            </button>
                            <button
                                disabled={transitioningRequestId === terminalTransition.request.id}
                                onClick={handleTerminalTransition}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-60"
                            >
                                Xác nhận
                            </button>
                        </div>
                    </div>
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
            {materialAccess.dashboard.canView && activeSubTab === 'dashboard' && (
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
                    onClose={closeRequestModal}
                    request={selectedRequestLive}
                    defaultSiteWarehouseId={defaultSiteWarehouseId}
                    projectId={projectId || null}
                    constructionSiteId={constructionSiteId || null}
                    requestOrigin="project"
                    workBoqItems={workBoqItems}
                    materialBudgetItems={boqItems}
                    requestFulfillmentSummariesByRequestId={requestFulfillmentSummaries}
                    initialAction={requestModalInitialAction}
                    canProcessProjectWorkflow={selectedRequestLive ? canActOnProjectRequest(selectedRequestLive) : false}
                    onProjectWorkflowApprove={handleProjectWorkflowApproveFromModal}
                    onProjectWorkflowReturn={handleProjectWorkflowReturnFromModal}
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
                                        <tr><th className="px-3 py-2 text-left">Dòng</th><th className="px-3 py-2 text-left">WBS</th><th className="px-3 py-2 text-left">Mã/SKU</th><th className="px-3 py-2 text-left">Tên vật tư</th><th className="px-3 py-2 text-left">ĐVT</th><th className="px-3 py-2 text-right">KL</th><th className="px-3 py-2 text-right">Đơn giá</th><th className="px-3 py-2 text-left">Trạng thái</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                        {importPreview.materialRows.map(row => {
                                            const previewWork = workBoqItems.find(item => item.id === row.item.workBoqItemId)
                                                || importPreview.workRows.find(workRow => workRow.item.id === row.item.workBoqItemId)?.item;
                                            return (
                                                <tr key={`mat-${row.rowNumber}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                                                    <td className="px-3 py-2 font-mono text-slate-400">{row.rowNumber}</td>
                                                    <td className="px-3 py-2 font-mono text-indigo-500">{previewWork?.wbsCode || '-'}</td>
                                                    <td className="px-3 py-2 font-mono text-slate-500">{row.item.materialCode || '-'}</td>
                                                    <td className="px-3 py-2 font-bold text-slate-700">{row.item.itemName || '-'}</td>
                                                    <td className="px-3 py-2 text-slate-500">{row.item.unit || '-'}</td>
                                                    <td className="px-3 py-2 text-right font-bold">{row.item.budgetQty.toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-right font-bold">{fmt(row.item.budgetUnitPrice)}</td>
                                                    <td className="px-3 py-2">{row.errors.length ? row.errors.join(' | ') : row.status === 'create' ? 'Thêm mới' : 'Cập nhật'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setImportPreview(null)} disabled={importingBoq} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">Huỷ</button>
                            <button onClick={confirmImportWorkBoq} disabled={!canManageBoq || importingBoq || [...importPreview.workRows, ...importPreview.materialRows].every(row => row.status === 'error')}
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
