import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
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
import { MaterialBudgetItem, InventoryItem, MaterialRequest, RequestStatus, ProjectTask, ProjectWorkBoqItem, ContractItem, TaskContractItem, MaterialRequestFulfillmentSummary, MaterialRequestFulfillmentBatch, MaterialRequestEvent, MaterialRequestKanbanLaneId, MaterialRequestKanbanStage, MaterialRequestWorkflowStep, ProjectSubmissionTarget, Role, PurchaseOrder, MaterialPlanningRule, MaterialPlanningDraftPo, PlanningCurveTemplate, ProjectWorkflowActionContext, ProjectWorkflowBoardFilter, ProjectWorkflowConfiguration, ProjectWorkflowRuntimeContext, ProjectWorkflowSubject, WorkflowNode, WorkflowNodeType, WorkflowStepAssignment } from '../../types';
import { boqService, taskService, workBoqService, WorkBoqSyncPreview, poService } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { useApp } from '../../context/AppContext';
import RequestModal from '../../components/RequestModal';
import MaterialRequestKanbanBoard from '../../components/project/MaterialRequestKanbanBoard';
import ProjectWorkflowAnalyticsPanel from '../../components/project/ProjectWorkflowAnalyticsPanel';
import ProjectSubmissionDialog from '../../components/project/ProjectSubmissionDialog';
import ProjectWorkflowActionDialog from '../../components/project/ProjectWorkflowActionDialog';
import ProjectWorkflowBindingPanel from '../../components/project/ProjectWorkflowBindingPanel';
import ProjectWorkflowInbox from '../../components/project/ProjectWorkflowInbox';
import ProjectWorkflowStartDialog from '../../components/project/ProjectWorkflowStartDialog';
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
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import { useWorkflow } from '../../context/WorkflowContext';
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
    if (n >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
    if (n >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' tr';
    return n.toLocaleString('vi-VN');
};

type WorkBoqImportPreview = {
    workRows: Array<{ rowNumber: number; item: ProjectWorkBoqItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
    materialRows: Array<{ rowNumber: number; item: MaterialBudgetItem; status: 'create' | 'update' | 'unchanged' | 'error'; errors: string[] }>;
};

const WORK_BOQ_SHEET_NAME = 'Dau_muc';
const MATERIAL_BOQ_SHEET_NAME = 'Vat_tu';
const WORK_BOQ_HEADERS = ['Mã WBS', 'Mã cha', 'Tên đầu mục', 'ĐVT', 'KL dự toán', 'Đơn giá', 'Ghi chú'];
const MATERIAL_BOQ_HEADERS = ['WBS đầu mục', 'Mã vật tư/SKU', 'Tên vật tư', 'Nhóm', 'ĐVT', 'KL dự toán', 'Ngưỡng hao hụt', 'Đơn giá', 'Ghi chú'];
const MATERIAL_BUDGET_QTY_PRECISION = 6;

const calculateMaterialBudgetQty = (workPlannedQty: number, wasteThreshold: number) => {
    const value = Number(workPlannedQty) * Number(wasteThreshold);
    if (!Number.isFinite(value) || value < 0) return 0;
    const multiplier = 10 ** MATERIAL_BUDGET_QTY_PRECISION;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const formatQuantity = (value: number) =>
    Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: MATERIAL_BUDGET_QTY_PRECISION });

const formatPercent = (value: number) =>
    Number(value || 0).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
    const location = useLocation();
    const { items: inventoryItems, requests: allRequests, warehouses, users, employees, orgUnits, user, transactions, hrmConstructionSites, loadModuleData, isModuleAdmin } = useApp();
    const { templates: workflowTemplates, nodes: workflowNodes, edges: workflowEdges } = useWorkflow();
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
    const [boqPbacLoaded, setBoqPbacLoaded] = useState(false);
    const [canEditProjectBoq, setCanEditProjectBoq] = useState(false);
    const [canDeleteProjectBoq, setCanDeleteProjectBoq] = useState(false);
    const canEditBoq = canManageBoq || canEditProjectBoq;
    const canDeleteBoq = canManageBoq || canDeleteProjectBoq;
    const visibleMaterialTabs = useMemo(
        () => PROJECT_MATERIAL_TAB_PERMISSIONS.filter(tab => materialAccess[tab.key].canView),
        [materialAccess],
    );

    useEffect(() => {
        if (visibleMaterialTabs.length > 0 && !materialAccess[activeSubTab].canView) {
            setActiveSubTab(visibleMaterialTabs[0].key);
        }
    }, [activeSubTab, materialAccess, visibleMaterialTabs]);

    useEffect(() => {
        const materialTab = new URLSearchParams(location.search).get('materialTab') as ProjectMaterialTabKey | null;
        if (!materialTab || !PROJECT_MATERIAL_TAB_PERMISSIONS.some(tab => tab.key === materialTab)) return;
        if (materialAccess[materialTab].canView) setActiveSubTab(materialTab);
    }, [location.search, materialAccess]);

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
    const [projectRequestsLoaded, setProjectRequestsLoaded] = useState(false);
    const [canSubmitProjectRequest, setCanSubmitProjectRequest] = useState(false);
    const [canApproveProjectRequest, setCanApproveProjectRequest] = useState(false);
    const [requestEventsByRequest, setRequestEventsByRequest] = useState<Record<string, MaterialRequestEvent[]>>({});
    const [requestFulfillmentBatches, setRequestFulfillmentBatches] = useState<Record<string, MaterialRequestFulfillmentBatch[]>>({});
    const [requestWorkflowSubjects, setRequestWorkflowSubjects] = useState<Record<string, ProjectWorkflowSubject>>({});
    const [requestWorkflowAssignments, setRequestWorkflowAssignments] = useState<Record<string, WorkflowStepAssignment[]>>({});
    const [requestWorkflowRuntimeContexts, setRequestWorkflowRuntimeContexts] = useState<Record<string, ProjectWorkflowRuntimeContext>>({});
    const [workflowConfiguration, setWorkflowConfiguration] = useState<ProjectWorkflowConfiguration | null>(null);
    const [workflowBoardFilter, setWorkflowBoardFilter] = useState<ProjectWorkflowBoardFilter>('all');
    const [workflowBoardSearch, setWorkflowBoardSearch] = useState('');
    const [hideEmptyWorkflowLanes, setHideEmptyWorkflowLanes] = useState(false);
    const [startWorkflowRequest, setStartWorkflowRequest] = useState<MaterialRequest | null>(null);
    const [workflowActionTransition, setWorkflowActionTransition] = useState<{ request: MaterialRequest; subject: ProjectWorkflowSubject; nextNode: WorkflowNode } | null>(null);
    const [submissionTransition, setSubmissionTransition] = useState<{
        request: MaterialRequest;
        toStep: MaterialRequestWorkflowStep;
        status: RequestStatus;
        action: string;
        title: string;
        subtitle: string;
        recipientHint?: string;
        recipientPermissionCodes?: string[];
        dynamicWorkflow?: boolean;
        nextNodeId?: string | null;
        nextNodeLabel?: string | null;
        workflowTemplateId?: string | null;
        isCompletion?: boolean;
        source?: string;
    } | null>(null);
    const [terminalTransition, setTerminalTransition] = useState<{ request: MaterialRequest; fromStage: MaterialRequestKanbanLaneId } | null>(null);
    const [terminalAction, setTerminalAction] = useState<'return' | 'reject'>('return');
    const [terminalNote, setTerminalNote] = useState('');
    const [transitioningRequestId, setTransitioningRequestId] = useState<string | null>(null);
    const openedDeepLinkRequestRef = useRef<string | null>(null);

    // BOQ Resize Column Width
    const [boqNameColWidth, setBoqNameColWidth] = useState(380);
    const boqResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

    const handleBoqResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        boqResizeRef.current = {
            startX: e.clientX,
            startWidth: boqNameColWidth,
        };
        document.addEventListener('mousemove', handleBoqResizeMove);
        document.addEventListener('mouseup', handleBoqResizeEnd);
    }, [boqNameColWidth]);

    const handleBoqResizeMove = useCallback((e: MouseEvent) => {
        if (!boqResizeRef.current) return;
        const deltaX = e.clientX - boqResizeRef.current.startX;
        const newWidth = Math.max(200, Math.min(850, boqResizeRef.current.startWidth + deltaX));
        setBoqNameColWidth(newWidth);
    }, []);

    const handleBoqResizeEnd = useCallback(() => {
        boqResizeRef.current = null;
        document.removeEventListener('mousemove', handleBoqResizeMove);
        document.removeEventListener('mouseup', handleBoqResizeEnd);
    }, []);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleBoqResizeMove);
            document.removeEventListener('mouseup', handleBoqResizeEnd);
        };
    }, [handleBoqResizeMove, handleBoqResizeEnd]);

    useEffect(() => {
        loadModuleData('wms-core');
    }, [loadModuleData]);

    useEffect(() => {
        let cancelled = false;
        const loadBoqPermissions = async () => {
            setBoqPbacLoaded(false);
            if (user.role === Role.ADMIN || canManageBoq) {
                if (!cancelled) {
                    setCanEditProjectBoq(true);
                    setCanDeleteProjectBoq(true);
                    setBoqPbacLoaded(true);
                }
                return;
            }
            if (!user.id || (!projectId && !constructionSiteId)) {
                if (!cancelled) {
                    setCanEditProjectBoq(false);
                    setCanDeleteProjectBoq(false);
                    setBoqPbacLoaded(true);
                }
                return;
            }

            try {
                const [editPerm, deletePerm] = await Promise.all([
                    projectId
                        ? projectStaffService.checkProjectPermission(user.id, projectId, 'edit', constructionSiteId || undefined)
                        : constructionSiteId
                            ? projectStaffService.checkPermission(user.id, constructionSiteId, 'edit')
                            : Promise.resolve({ allowed: false }),
                    projectId
                        ? projectStaffService.checkProjectPermission(user.id, projectId, 'delete', constructionSiteId || undefined)
                        : constructionSiteId
                            ? projectStaffService.checkPermission(user.id, constructionSiteId, 'delete')
                            : Promise.resolve({ allowed: false }),
                ]);
                if (!cancelled) {
                    setCanEditProjectBoq(editPerm.allowed);
                    setCanDeleteProjectBoq(deletePerm.allowed);
                }
            } catch (error) {
                console.warn('Failed to check project BOQ permissions', error);
                if (!cancelled) {
                    setCanEditProjectBoq(false);
                    setCanDeleteProjectBoq(false);
                }
            } finally {
                if (!cancelled) setBoqPbacLoaded(true);
            }
        };
        void loadBoqPermissions();
        return () => { cancelled = true; };
    }, [canManageBoq, constructionSiteId, projectId, user.id, user.role]);

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
            setRequestWorkflowSubjects({});
            setRequestWorkflowAssignments({});
            setRequestWorkflowRuntimeContexts({});
            setProjectRequestsLoaded(true);
            return;
        }
        try {
            const rows = await materialRequestService.listByProject(projectId);
            setProjectRequests(rows);
            const subjects = await projectWorkflowService.listSubjectsByMaterialRequestIds(rows.map(row => row.id));
            setRequestWorkflowSubjects(subjects);
            const subjectIds = Object.values(subjects).map(subject => subject.id).filter(Boolean);
            const runtimeContexts = await projectWorkflowService.listRuntimeContextsBySubjects(Object.values(subjects));
            setRequestWorkflowAssignments(prev => {
                const activeSubjectIds = new Set(subjectIds);
                return Object.entries(prev).reduce<Record<string, WorkflowStepAssignment[]>>((acc, [subjectId, rows]) => {
                    if (activeSubjectIds.has(subjectId)) acc[subjectId] = rows;
                    return acc;
                }, {});
            });
            setRequestWorkflowRuntimeContexts(runtimeContexts);
        } catch (error: any) {
            console.error('Failed to load project material requests', error);
            toast.error('Không tải được phiếu vật tư dự án', error?.message || 'Vui lòng thử lại.');
        } finally {
            setProjectRequestsLoaded(true);
        }
    }, [projectId]);

    useEffect(() => {
        setProjectRequests([]);
        setProjectRequestsLoaded(false);
        projectWorkflowService.clearAssigneeCandidateCache();
        void loadProjectRequests();
    }, [loadProjectRequests]);

    const closeRequestModal = () => {
        setReqModalOpen(false);
        setSelectedRequest(undefined);
        setRequestModalInitialAction(undefined);
        void loadProjectRequests();
    };

    const handleRequestDeleted = useCallback((requestId: string) => {
        const deletedWorkflowSubjectId = requestWorkflowSubjects[requestId]?.id;
        setProjectRequests(prev => prev.filter(request => request.id !== requestId));
        setSelectedRequest(prev => prev?.id === requestId ? undefined : prev);
        setRequestEventsByRequest(prev => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        setRequestFulfillmentSummaries(prev => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        setRequestFulfillmentBatchCounts(prev => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        setRequestFulfillmentBatches(prev => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        setRequestWorkflowSubjects(prev => {
            const next = { ...prev };
            delete next[requestId];
            return next;
        });
        if (deletedWorkflowSubjectId) {
            setRequestWorkflowAssignments(prev => {
                const next = { ...prev };
                delete next[deletedWorkflowSubjectId];
                return next;
            });
        }
    }, [requestWorkflowSubjects]);

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
        const scopedProjectRequests = projectRequests.filter(request => request.requestOrigin === 'project' && request.projectId === projectId);
        if (projectRequestsLoaded) return scopedProjectRequests;
        const byId = new Map<string, MaterialRequest>();
        allRequests
            .filter(request => request.requestOrigin === 'project' && request.projectId === projectId)
            .forEach(request => byId.set(request.id, request));
        scopedProjectRequests.forEach(request => byId.set(request.id, request));
        return [...byId.values()];
    }, [allRequests, projectId, projectRequests, projectRequestsLoaded]);

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
    const workflowNodeById = useMemo(
        () => new Map(workflowNodes.map(node => [node.id, node])),
        [workflowNodes],
    );
    const requestWorkflowRuntimeNodes = useMemo(
        () => Object.values(requestWorkflowRuntimeContexts).flatMap(context => context.nodes),
        [requestWorkflowRuntimeContexts],
    );
    const workflowEdgesBySource = useMemo(() => {
        const map = new Map<string, typeof workflowEdges>();
        workflowEdges.forEach(edge => {
            map.set(edge.sourceNodeId, [...(map.get(edge.sourceNodeId) || []), edge]);
        });
        return map;
    }, [workflowEdges]);
    const runtimeNodeToWorkflowNode = useCallback((node?: ProjectWorkflowRuntimeContext['nodes'][number] | null): WorkflowNode | null => node ? ({
        id: node.templateNodeId || node.id,
        templateId: node.templateNodeId || node.templateVersionId || '',
        type: node.type,
        label: node.label,
        config: node.config,
        positionX: node.positionX,
        positionY: node.positionY,
    }) : null, []);
    const getRequestWorkflowSubject = useCallback(
        (request: MaterialRequest) => requestWorkflowSubjects[request.id],
        [requestWorkflowSubjects],
    );
    const getWorkflowNextNode = useCallback((subject?: ProjectWorkflowSubject) => {
        if (!subject) return null;
        const runtime = requestWorkflowRuntimeContexts[subject.id];
        if (runtime && subject.currentInstanceNodeId) {
            const nextEdge = runtime.edges
                .filter(edge => edge.sourceInstanceNodeId === subject.currentInstanceNodeId)
                .sort((a, b) => a.sortOrder - b.sortOrder)[0];
            return runtimeNodeToWorkflowNode(runtime.nodes.find(node => node.id === nextEdge?.targetInstanceNodeId));
        }
        if (!subject.currentNodeId) return null;
        const nextEdge = (workflowEdgesBySource.get(subject.currentNodeId) || [])[0];
        return nextEdge ? workflowNodeById.get(nextEdge.targetNodeId) || null : null;
    }, [requestWorkflowRuntimeContexts, runtimeNodeToWorkflowNode, workflowEdgesBySource, workflowNodeById]);
    const getWorkflowReturnTargetNode = useCallback((subject?: ProjectWorkflowSubject) => {
        if (!subject) return null;
        const runtime = requestWorkflowRuntimeContexts[subject.id];
        const runtimeTargetId = subject.returnToInstanceNodeId || subject.currentInstanceNodeId;
        if (runtime && runtimeTargetId) {
            return runtimeNodeToWorkflowNode(runtime.nodes.find(node => node.id === runtimeTargetId));
        }
        const targetNodeId = subject.returnToNodeId || subject.currentNodeId;
        return targetNodeId ? workflowNodeById.get(targetNodeId) || subject.currentNode || null : subject.currentNode || null;
    }, [requestWorkflowRuntimeContexts, runtimeNodeToWorkflowNode, workflowNodeById]);
    const getWorkflowNodePermissionCodes = useCallback((nodeId?: string | null): string[] => {
        if (!nodeId) return ['approve'];
        const runtimeNode = Object.values(requestWorkflowRuntimeContexts)
            .flatMap(context => context.nodes)
            .find(node => node.id === nodeId || node.templateNodeId === nodeId);
        const node = runtimeNode ? runtimeNodeToWorkflowNode(runtimeNode) : workflowNodeById.get(nodeId);
        const codes = node?.config?.eligiblePermissionCodes?.filter(Boolean);
        return codes && codes.length > 0 ? codes : ['approve'];
    }, [requestWorkflowRuntimeContexts, runtimeNodeToWorkflowNode, workflowNodeById]);
    const getWorkflowAssigneeUserIds = useCallback((request: MaterialRequest) => {
        const subject = getRequestWorkflowSubject(request);
        if (subject?.currentAssigneeUserIds?.length) return subject.currentAssigneeUserIds;
        if (subject?.currentAssigneeUserId) return [subject.currentAssigneeUserId];
        return request.submittedToUserId ? [request.submittedToUserId] : [];
    }, [getRequestWorkflowSubject]);
    const isWorkflowTemplateManager = useCallback((request: MaterialRequest) => {
        const subject = getRequestWorkflowSubject(request);
        if (subject?.workflowInstanceId) {
            return Boolean(subject.participants?.some(participant =>
                participant.isActive
                && participant.userId === user.id
                && participant.role === 'ADMIN'
            ));
        }
        const templateId = request.workflowTemplateId || subject?.workflowInstance?.templateId || null;
        if (!templateId) return false;
        return Boolean(workflowTemplates.find(template => template.id === templateId)?.managers?.includes(user.id));
    }, [getRequestWorkflowSubject, user.id, workflowTemplates]);

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

    useEffect(() => {
        const subject = selectedRequestLive ? requestWorkflowSubjects[selectedRequestLive.id] : null;
        if (!subject || requestWorkflowAssignments[subject.id]) return;
        let cancelled = false;
        projectWorkflowService.listAssignmentsBySubjectIds([subject.id])
            .then(assignments => {
                if (!cancelled) setRequestWorkflowAssignments(prev => ({ ...prev, ...assignments }));
            })
            .catch(error => {
                if (!cancelled) console.warn('Failed to lazy load workflow assignments', error);
            });
        return () => { cancelled = true; };
    }, [requestWorkflowAssignments, requestWorkflowSubjects, selectedRequestLive]);

    useEffect(() => {
        const requestId = new URLSearchParams(location.search).get('requestId');
        if (!requestId || !projectRequestsLoaded || openedDeepLinkRequestRef.current === requestId) return;
        const target = requests.find(request => request.id === requestId);
        if (!target) return;
        openedDeepLinkRequestRef.current = requestId;
        setActiveSubTab('request');
        setSelectedRequest(target);
        setReqModalOpen(true);
    }, [location.search, projectRequestsLoaded, requests]);

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
    const [bPrice, setBPrice] = useState('');
    const [bThreshold, setBThreshold] = useState('0,5');
    const [bBudgetQtyInput, setBBudgetQtyInput] = useState('');
    const [bBudgetQtyManuallyEdited, setBBudgetQtyManuallyEdited] = useState(false);
    const [bNotes, setBNotes] = useState('');
    const [bInventoryItemId, setBInventoryItemId] = useState('');
    const [bMaterialCode, setBMaterialCode] = useState('');
    const [bWorkBoqItemId, setBWorkBoqItemId] = useState('');
    const selectedWorkBoqItem = bWorkBoqItemId ? workBoqItemById.get(bWorkBoqItemId) : undefined;
    const selectedWorkPlannedQty = Number(selectedWorkBoqItem?.plannedQty || 0);
    const thresholdValue = importNumber(bThreshold);
    const hasValidThreshold = Number.isFinite(thresholdValue) && thresholdValue > 0;
    const autoBudgetQty = selectedWorkBoqItem && hasValidThreshold
        ? calculateMaterialBudgetQty(selectedWorkPlannedQty, thresholdValue)
        : 0;
    const bBudgetQty = importNumber(bBudgetQtyInput);
    const canSaveBoqItem = Boolean(
        bName
        && bUnit
        && bPrice !== ''
        && selectedWorkBoqItem
        && selectedWorkPlannedQty > 0
        && hasValidThreshold
        && bBudgetQty > 0
    );

    useEffect(() => {
        if (!showBoqForm || bBudgetQtyManuallyEdited) return;
        setBBudgetQtyInput(autoBudgetQty > 0 ? formatQuantity(autoBudgetQty) : '');
    }, [autoBudgetQty, bBudgetQtyManuallyEdited, showBoqForm]);

    const ensureCanManage = (allowed: boolean, scopeLabel: string, action: string) => {
        if (allowed) return true;
        toast.warning('Không có quyền quản trị', `Bạn cần quyền quản trị "${scopeLabel}" để ${action}.`);
        return false;
    };

    const ensureBoqPermission = (allowed: boolean, permissionCode: 'edit' | 'delete', action: string) => {
        if (allowed) return true;
        if (!boqPbacLoaded && !canManageBoq) {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
            return false;
        }
        toast.warning(
            'Không có quyền BOQ',
            `Bạn cần quyền dự án "${permissionCode}" hoặc quyền quản trị "Vật tư: BOQ" để ${action}.`,
        );
        return false;
    };

    const refreshMaterialRequestWorkflow = async () => {
        await Promise.all([
            loadProjectRequests(),
            loadModuleData('wms-core', true),
        ]);
    };

    const canManageProjectWorkflow = (request: MaterialRequest) =>
        user.role === Role.ADMIN ||
        isModuleAdmin('WF') ||
        isWorkflowTemplateManager(request);

    const canActOnProjectRequest = (request: MaterialRequest) => {
        const dynamicSubject = getRequestWorkflowSubject(request);
        if (dynamicSubject?.workflowInstanceId) {
            return dynamicSubject.status === 'RUNNING'
                && getWorkflowAssigneeUserIds(request).includes(user.id);
        }
        return canManageProjectWorkflow(request)
            || (canApproveProjectRequest && getWorkflowAssigneeUserIds(request).includes(user.id));
    };

    const canReassignProjectWorkflow = (request: MaterialRequest) =>
        canActOnProjectRequest(request) || canManageProjectWorkflow(request);

    const hasOverBudgetLines = (request: MaterialRequest) =>
        (request.items || []).some(line => Number((line as any).overBudgetQtySnapshot || 0) > 0);

    const canApproveOverBudgetRequest = (request: MaterialRequest) =>
        !hasOverBudgetLines(request) || user.role === Role.ADMIN || isGlobalWarehouseKeeper(user);

    const warnOverBudgetApprovalRequired = () => {
        toast.warning('Cần duyệt vượt BOQ', 'Phiếu có vật tư vượt KL dự toán. Chỉ admin hoặc thủ kho tổng được duyệt qua bước tạo đợt cấp.');
    };

    const canMoveMaterialRequest = (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => {
        const dynamicSubject = getRequestWorkflowSubject(request);
        if (toStage.startsWith('workflow:')) {
            if (fromStage === 'draft') {
                return Boolean(workflowConfiguration?.valid)
                    && canCreateMaterialRequest
                    && (request.requesterId === user.id || user.role === Role.ADMIN);
            }
            return dynamicSubject?.status === 'RUNNING' && canActOnProjectRequest(request);
        }
        if (toStage === 'batch_planning' && dynamicSubject?.status === 'RUNNING') {
            return getWorkflowNextNode(dynamicSubject)?.type === WorkflowNodeType.END && canActOnProjectRequest(request);
        }
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
                    || canManageProjectWorkflow(request)
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

    const refreshSingleProjectRequestWorkflow = async (
        requestId: string,
        knownSubject?: ProjectWorkflowSubject | null,
    ): Promise<MaterialRequest | null> => {
        const previousSubjectId = requestWorkflowSubjects[requestId]?.id;
        const [updated, subject, events] = await Promise.all([
            materialRequestService.getById(requestId),
            knownSubject !== undefined
                ? Promise.resolve(knownSubject)
                : projectWorkflowService.getSubjectByMaterialRequestId(requestId),
            materialRequestService.listEventsByRequestIds([requestId]),
        ]);

        if (updated) upsertProjectRequest(updated);
        setRequestEventsByRequest(prev => ({ ...prev, ...events }));

        if (subject) {
            setRequestWorkflowSubjects(prev => ({ ...prev, [requestId]: subject }));
            const [assignments, runtimeContexts] = await Promise.all([
                projectWorkflowService.listAssignmentsBySubjectIds([subject.id]),
                projectWorkflowService.listRuntimeContextsBySubjects([subject]),
            ]);
            setRequestWorkflowAssignments(prev => ({ ...prev, ...assignments }));
            setRequestWorkflowRuntimeContexts(prev => ({ ...prev, ...runtimeContexts }));
        } else {
            setRequestWorkflowSubjects(prev => {
                const next = { ...prev };
                delete next[requestId];
                return next;
            });
            if (previousSubjectId) {
                setRequestWorkflowAssignments(prev => {
                    const next = { ...prev };
                    delete next[previousSubjectId];
                    return next;
                });
                setRequestWorkflowRuntimeContexts(prev => {
                    const next = { ...prev };
                    delete next[previousSubjectId];
                    return next;
                });
            }
        }

        return updated;
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
                    link: `/da?projectId=${updated.projectId || ''}&siteId=${updated.constructionSiteId || ''}&tab=material&materialTab=request&requestId=${updated.id}`,
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

    const performDynamicRequestTransition = async (params: {
        request: MaterialRequest;
        action: 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'RESUBMITTED' | 'REASSIGNED' | 'ROLLED_BACK';
        target?: ProjectSubmissionTarget | null;
        note?: string | null;
        templateId?: string | null;
        metadata?: Record<string, any>;
    }) => {
        setTransitioningRequestId(params.request.id);
        try {
            let subject: ProjectWorkflowSubject | null = null;
            const targetUserIds = params.target?.userIds?.length
                ? params.target.userIds
                : params.target?.userId
                    ? [params.target.userId]
                    : [];
            if (params.action === 'SUBMITTED') {
                if (targetUserIds.length === 0) throw new Error('Chưa chọn người xử lý bước đầu.');
                subject = await projectWorkflowService.startMaterialRequestWorkflowV2({
                    requestId: params.request.id,
                    templateId: params.templateId || params.request.workflowTemplateId,
                    firstAssigneeUserIds: targetUserIds,
                    comment: params.note || params.target.note,
                });
            } else if (params.action === 'RETURNED') {
                subject = await projectWorkflowService.returnMaterialRequestWorkflow({
                    requestId: params.request.id,
                    comment: params.note || '',
                });
            } else if (params.action === 'REJECTED') {
                subject = await projectWorkflowService.rejectMaterialRequestWorkflow({
                    requestId: params.request.id,
                    comment: params.note || '',
                });
            } else if (params.action === 'RESUBMITTED') {
                subject = await projectWorkflowService.resubmitMaterialRequestWorkflowV2({
                    requestId: params.request.id,
                    assigneeUserIds: targetUserIds.length > 0 ? targetUserIds : null,
                    comment: params.note || params.target?.note || '',
                });
            } else if (params.action === 'REASSIGNED') {
                if (targetUserIds.length === 0) throw new Error('Chưa chọn người xử lý mới.');
                subject = await projectWorkflowService.reassignMaterialRequestWorkflowV2({
                    requestId: params.request.id,
                    newAssigneeUserIds: targetUserIds,
                    comment: params.note || params.target.note || '',
                });
            } else if (params.action === 'ROLLED_BACK') {
                subject = await projectWorkflowService.rollbackCompletedMaterialRequestWorkflow({
                    requestId: params.request.id,
                    comment: params.note || '',
                });
            } else {
                subject = await projectWorkflowService.advanceMaterialRequestWorkflowV2({
                    requestId: params.request.id,
                    nextAssigneeUserIds: targetUserIds,
                    comment: params.note || params.target?.note || '',
                });
            }

            const updated = await refreshSingleProjectRequestWorkflow(params.request.id, subject);

            if (targetUserIds.length > 0 && updated) {
                targetUserIds.forEach(targetUserId => {
                    const targetName = userById.get(targetUserId)?.name || targetUserId;
                    void projectSubmissionService.notifyTarget({
                        target: {
                            userId: targetUserId,
                            name: targetName,
                            permissionCode: params.target?.permissionCode,
                            note: params.target?.note,
                        },
                        actorId: user.id,
                        category: 'material',
                        title: 'Phiếu vật tư cần xử lý',
                        message: `Phiếu ${updated.code} đang chờ bạn xử lý.`,
                        sourceType: 'material_request',
                        sourceId: updated.id,
                        constructionSiteId: updated.constructionSiteId || undefined,
                        link: `/da?projectId=${updated.projectId || ''}&siteId=${updated.constructionSiteId || ''}&tab=material&materialTab=request&requestId=${updated.id}`,
                        metadata: { requestId: updated.id, workflowSubjectId: subject?.id, assigneeUserIds: targetUserIds, ...params.metadata },
                    });
                });
            }

            toast.success('Đã cập nhật luồng vật tư', `Phiếu ${(updated || params.request).code} đã chuyển bước.`);
        } catch (error: any) {
            logApiError('materialTab.dynamicRequestTransition', error);
            toast.error('Không thể chuyển bước', getApiErrorMessage(error, 'Không cập nhật được workflow động của phiếu vật tư.'));
            throw error;
        } finally {
            setTransitioningRequestId(null);
        }
    };

    const handleMoveMaterialRequest = (request: MaterialRequest, toStage: MaterialRequestKanbanLaneId, fromStage: MaterialRequestKanbanLaneId) => {
        if (!canMoveMaterialRequest(request, toStage, fromStage)) {
            toast.warning('Không thể chuyển bước', 'Bạn không có quyền hoặc bước này không cho phép kéo thả.');
            return;
        }
        const dynamicSubject = getRequestWorkflowSubject(request);
        if (fromStage === 'draft' && toStage.startsWith('workflow:')) {
            if (!workflowConfiguration?.valid) {
                toast.warning('Chưa cấu hình workflow', workflowConfiguration?.errors?.[0] || 'Cần cấu hình workflow đề xuất vật tư trước khi gửi.');
                return;
            }
            setStartWorkflowRequest(request);
            return;
        }
        if (dynamicSubject?.workflowInstanceId && dynamicSubject.status === 'RUNNING' && toStage.startsWith('workflow:')) {
            const nextNode = getWorkflowNextNode(dynamicSubject);
            if (!nextNode || toStage !== `workflow:${nextNode.id}`) {
                toast.warning('Không thể chuyển bước', 'Chỉ được chuyển sang đúng bước workflow kế tiếp.');
                return;
            }
            setWorkflowActionTransition({ request, subject: dynamicSubject, nextNode });
            return;
        }
        if (dynamicSubject?.workflowInstanceId && dynamicSubject.status === 'RUNNING' && ['site_manager_review', 'material_department_review', 'batch_planning'].includes(toStage)) {
            const nextNode = getWorkflowNextNode(dynamicSubject);
            if (!nextNode) {
                toast.warning('Không thể chuyển bước', 'Không tìm thấy bước kế tiếp trong mẫu workflow.');
                return;
            }
            if (nextNode.type === WorkflowNodeType.END) {
                setWorkflowActionTransition({ request, subject: dynamicSubject, nextNode });
                return;
            }
            setSubmissionTransition({
                request,
                toStep: 'material_department_review',
                status: RequestStatus.PENDING,
                action: 'APPROVED',
                title: `Duyệt, chuyển bước "${nextNode.label}"`,
                subtitle: `Phiếu sẽ chuyển sang bước ${nextNode.label}. Chọn người chịu trách nhiệm bước này.`,
                recipientHint: `Chọn người xử lý bước "${nextNode.label}".`,
                recipientPermissionCodes: getWorkflowNodePermissionCodes(nextNode.id),
                dynamicWorkflow: true,
                nextNodeId: nextNode.id,
                nextNodeLabel: nextNode.label,
                source: 'kanban_drag_dynamic',
            });
            return;
        }
        if (toStage === 'site_manager_review') {
            if (request.everSubmitted && !dynamicSubject) {
                setSubmissionTransition({
                    request,
                    toStep: 'site_manager_review',
                    status: RequestStatus.PENDING,
                    action: 'SUBMITTED',
                    title: 'Gửi quản lý công trường duyệt',
                    subtitle: 'Phiếu legacy tiếp tục sử dụng luồng duyệt cũ.',
                });
            } else {
                toast.warning('Cần workflow động', 'Phiếu mới phải gửi vào bước workflow đã cấu hình.');
            }
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
        const dynamicSubject = getRequestWorkflowSubject(request);
        if (dynamicSubject?.workflowInstanceId && dynamicSubject.status === 'RUNNING') {
            const nextNode = getWorkflowNextNode(dynamicSubject);
            if (!nextNode) {
                toast.warning('Không thể xử lý phiếu', 'Không tìm thấy bước kế tiếp trong mẫu workflow.');
                return;
            }
            if (nextNode.type === WorkflowNodeType.END) {
                void performDynamicRequestTransition({
                    request,
                    action: 'APPROVED',
                    note: 'Hoàn tất phê duyệt workflow động',
                    metadata: { source: 'request_modal', nextNodeId: nextNode.id },
                }).then(closeWorkflowRequestModal);
                return;
            }
            closeWorkflowRequestModal();
            setSubmissionTransition({
                request,
                toStep: 'material_department_review',
                status: RequestStatus.PENDING,
                action: 'APPROVED',
                title: `Duyệt, chuyển bước "${nextNode.label}"`,
                subtitle: `Phiếu sẽ chuyển sang bước ${nextNode.label}. Chọn người chịu trách nhiệm bước này.`,
                recipientHint: `Chọn người xử lý bước "${nextNode.label}".`,
                recipientPermissionCodes: getWorkflowNodePermissionCodes(nextNode.id),
                dynamicWorkflow: true,
                nextNodeId: nextNode.id,
                nextNodeLabel: nextNode.label,
                source: 'request_modal_dynamic',
            });
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

    const handleProjectWorkflowActionFromModal = async (context: ProjectWorkflowActionContext) => {
        const request = requests.find(item => item.id === context.subject.subjectId) || selectedRequestLive;
        if (!request) {
            toast.warning('Không thể xử lý phiếu', 'Không tìm thấy phiếu vật tư tương ứng workflow.');
            return;
        }

        if (context.action === 'approve' || context.action === 'return' || context.action === 'reject') {
            if (!canActOnProjectRequest(request)) {
                toast.warning('Không thể xử lý phiếu', 'Bạn không phải người đang được giao xử lý phiếu này.');
                return;
            }
        }
        if (context.action === 'reassign' && !canReassignProjectWorkflow(request)) {
            toast.warning('Không thể đổi người xử lý', 'Bạn không phải người đang xử lý hoặc quản trị workflow này.');
            return;
        }
        if (context.action === 'rollback' && !canManageProjectWorkflow(request)) {
            toast.warning('Không thể rollback', 'Chỉ quản trị workflow được rollback phiếu đã hoàn thành.');
            return;
        }

        if (context.action === 'approve') {
            const nextNode = context.nextNode || getWorkflowNextNode(context.subject);
            if (!nextNode) {
                toast.warning('Không thể xử lý phiếu', 'Không tìm thấy bước kế tiếp trong mẫu workflow.');
                return;
            }
            if (nextNode.type === WorkflowNodeType.END && !canApproveOverBudgetRequest(request)) {
                warnOverBudgetApprovalRequired();
                return;
            }
            const targetUserIds = context.assigneeUserIds || (context.assigneeUserId ? [context.assigneeUserId] : []);
            const target = targetUserIds.length > 0
                ? {
                    userId: targetUserIds[0],
                    userIds: targetUserIds,
                    name: userById.get(targetUserIds[0])?.name || targetUserIds[0],
                    names: targetUserIds.map(id => userById.get(id)?.name || id),
                    permissionCode: nextNode.type === WorkflowNodeType.END
                        ? 'approve'
                        : getWorkflowNodePermissionCodes(nextNode.id)[0] || 'approve',
                    note: context.comment,
                }
                : null;
            await performDynamicRequestTransition({
                request,
                action: 'APPROVED',
                target,
                note: context.comment,
                metadata: { source: 'request_modal_panel', nextNodeId: nextNode.id },
            });
            closeWorkflowRequestModal();
            return;
        }

        if (context.action === 'return') {
            await performDynamicRequestTransition({
                request,
                action: 'RETURNED',
                note: context.comment,
                metadata: { source: 'request_modal_panel' },
            });
            closeWorkflowRequestModal();
            return;
        }

        if (context.action === 'reject') {
            await performDynamicRequestTransition({
                request,
                action: 'REJECTED',
                note: context.comment,
                metadata: { source: 'request_modal_panel' },
            });
            closeWorkflowRequestModal();
            return;
        }

        if (context.action === 'resubmit') {
            const targetNode = context.nextNode || getWorkflowReturnTargetNode(context.subject);
            const assigneeUserIds = context.assigneeUserIds?.length
                ? context.assigneeUserIds
                : context.subject.returnToAssigneeUserIds?.length
                    ? context.subject.returnToAssigneeUserIds
                    : context.subject.returnToAssigneeUserId
                        ? [context.subject.returnToAssigneeUserId]
                        : [];
            const target = {
                userId: assigneeUserIds[0] || '',
                userIds: assigneeUserIds,
                name: userById.get(assigneeUserIds[0] || '')?.name
                    || assigneeUserIds[0]
                    || '',
                names: assigneeUserIds.map(id => userById.get(id)?.name || id),
                permissionCode: getWorkflowNodePermissionCodes(targetNode?.id)[0] || 'approve',
                note: context.comment,
            };
            await performDynamicRequestTransition({
                request,
                action: 'RESUBMITTED',
                target,
                note: context.comment,
                metadata: { source: 'request_modal_panel', nextNodeId: targetNode?.id },
            });
            closeWorkflowRequestModal();
            return;
        }

        if (context.action === 'rollback') {
            await performDynamicRequestTransition({
                request,
                action: 'ROLLED_BACK',
                note: context.comment,
                metadata: { source: 'request_modal_panel' },
            });
            closeWorkflowRequestModal();
            return;
        }

        if (context.action === 'reassign') {
            const assigneeUserIds = context.assigneeUserIds || (context.assigneeUserId ? [context.assigneeUserId] : []);
            const target = {
                userId: assigneeUserIds[0] || '',
                userIds: assigneeUserIds,
                name: userById.get(assigneeUserIds[0] || '')?.name || assigneeUserIds[0] || '',
                names: assigneeUserIds.map(id => userById.get(id)?.name || id),
                permissionCode: getWorkflowNodePermissionCodes(context.subject.currentNodeId)[0] || 'approve',
                note: context.comment,
            };
            await performDynamicRequestTransition({
                request,
                action: 'REASSIGNED',
                target,
                note: context.comment,
                metadata: { source: 'request_modal_panel', nodeId: context.subject.currentNodeId },
            });
            closeWorkflowRequestModal();
        }
    };

    const handleSubmitTransitionTarget = async (target: ProjectSubmissionTarget) => {
        if (!submissionTransition) return;
        if (submissionTransition.dynamicWorkflow) {
            await performDynamicRequestTransition({
                request: submissionTransition.request,
                action: submissionTransition.action === 'SUBMITTED' ? 'SUBMITTED' : 'APPROVED',
                target,
                note: target.note,
                templateId: submissionTransition.workflowTemplateId,
                metadata: { source: submissionTransition.source || 'dynamic_workflow', nextNodeId: submissionTransition.nextNodeId },
            });
            setSubmissionTransition(null);
            return;
        }
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
        const dynamicSubject = getRequestWorkflowSubject(request);
        if (dynamicSubject?.workflowInstanceId && ['RUNNING', 'RETURNED'].includes(dynamicSubject.status)) {
            await performDynamicRequestTransition({
                request,
                action: isReturn ? 'RETURNED' : 'REJECTED',
                note,
                metadata: { fromStage: terminalTransition.fromStage, source: 'dynamic_workflow_terminal' },
            });
            setTerminalTransition(null);
            setTerminalNote('');
            return;
        }
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
        setBCat('Vật liệu xây dựng'); setBName(''); setBUnit('');
        setBPrice(''); setBThreshold('0,5'); setBBudgetQtyInput(''); setBBudgetQtyManuallyEdited(false); setBNotes('');
        setBInventoryItemId(''); setBMaterialCode(''); setBWorkBoqItemId(''); setAcQuery('');
    };

    const handleWorkBoqItemChange = (value: string) => {
        setBWorkBoqItemId(value);
        setBBudgetQtyManuallyEdited(false);
    };

    const handleBudgetQtyChange = (value: string) => {
        setBBudgetQtyInput(value);
        setBBudgetQtyManuallyEdited(true);
    };

    const resetBudgetQtyToFormula = () => {
        setBBudgetQtyInput(autoBudgetQty > 0 ? formatQuantity(autoBudgetQty) : '');
        setBBudgetQtyManuallyEdited(false);
    };

    const openEditBoq = (item: MaterialBudgetItem) => {
        if (!ensureBoqPermission(canEditBoq, 'edit', 'sửa BOQ vật tư')) return;
        setEditingBoq(item);
        setBCat(item.category); setBName(item.itemName); setBUnit(item.unit);
        setBPrice(String(item.budgetUnitPrice));
        setBThreshold(formatQuantity(item.wasteThreshold));
        setBBudgetQtyInput(formatQuantity(item.budgetQty));
        setBBudgetQtyManuallyEdited(true);
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
            const linkedWorkItem = b.workBoqItemId ? workBoqItemById.get(b.workBoqItemId) : undefined;
            const formulaBudgetQty = linkedWorkItem && Number(linkedWorkItem.plannedQty || 0) > 0 && Number(b.wasteThreshold || 0) > 0
                ? calculateMaterialBudgetQty(Number(linkedWorkItem.plannedQty || 0), Number(b.wasteThreshold || 0))
                : 0;
            const derivedBudgetQty = Number(b.budgetQty || 0) > 0 ? Number(b.budgetQty || 0) : formulaBudgetQty;
            const budgetUnitPrice = Number(b.budgetUnitPrice || 0);
            const budgetTotal = derivedBudgetQty * budgetUnitPrice;
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
            const wasteQty = actualQty - derivedBudgetQty;
            const wastePercent = derivedBudgetQty > 0 ? Math.round((wasteQty / derivedBudgetQty) * 1000) / 10 : 0;
            const budgetOverPercent = derivedBudgetQty > 0 ? Math.round(((totalRequested - derivedBudgetQty) / derivedBudgetQty) * 1000) / 10 : 0;
            return {
                ...b,
                budgetQty: derivedBudgetQty,
                budgetTotal,
                actualQty,
                actualTotal: actualQty * budgetUnitPrice,
                wasteQty,
                wastePercent,
                wasteValue: wasteQty * budgetUnitPrice,
                cumulativeRequested: totalRequested,
                cumulativeExported: actualQty,
                budgetOverPercent: Math.max(0, budgetOverPercent),
                stockBalance: (b.cumulativeImported || 0) - actualQty,
                autoAlert: budgetOverPercent > 0 ? 'Vượt ngân sách' : wasteQty > 0 ? 'Vượt định mức hao hụt' : undefined,
            };
        });
    }, [boqItems, requestFulfillmentBatchCounts, requestFulfillmentLineSummaries, requests, workBoqItemById]);

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
        if (!ensureBoqPermission(canEditBoq, 'edit', 'đồng bộ BOQ vật tư')) return;
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
        if (!ensureBoqPermission(canEditBoq, 'edit', 'lưu BOQ vật tư')) return;
        if (!bWorkBoqItemId || !selectedWorkBoqItem) {
            toast.warning('Chưa chọn đầu mục BOQ', 'Vật tư cần gắn với đầu mục BOQ triển khai để tự tính KL dự toán.');
            return;
        }
        if (selectedWorkPlannedQty <= 0) {
            toast.warning('Đầu mục chưa có KL dự toán', 'Vui lòng cập nhật KL dự toán của đầu mục trước khi thêm vật tư.');
            return;
        }
        if (!hasValidThreshold) {
            toast.warning('Ngưỡng hao hụt chưa hợp lệ', 'Ngưỡng hao hụt phải là số lớn hơn 0.');
            return;
        }
        if (bBudgetQty <= 0) {
            toast.warning('KL dự toán vật tư chưa hợp lệ', 'KL dự toán vật tư phải là số lớn hơn 0.');
            return;
        }
        if (!bName || !bUnit || bPrice === '') return;
        const budgetQty = bBudgetQty;
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
            wasteThreshold: thresholdValue,
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
        if (!ensureBoqPermission(canDeleteBoq, 'delete', 'xoá BOQ vật tư')) return;
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
                'Ngưỡng hao hụt': item.wasteThreshold,
                'Đơn giá': item.budgetUnitPrice,
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
            { 'Nội dung': 'Cột bắt buộc vật tư', 'Ghi chú': 'WBS đầu mục, Tên vật tư, ĐVT, Ngưỡng hao hụt. Có thể chỉ nhập SKU nếu SKU đã tồn tại trong kho.' },
            { 'Nội dung': 'KL dự toán vật tư', 'Ghi chú': 'Nếu để trống, hệ thống tự tính bằng KL dự toán đầu mục × Ngưỡng hao hụt. Ví dụ 8,914 × 0,5 = 4,457. Có thể nhập tay để ghi đè kết quả tự tính.' },
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
        materialSheet['!cols'] = [14, 18, 34, 20, 10, 14, 16, 14, 36, 18, 24, 24].map(wch => ({ wch }));
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
            'KL dự toán': 100,
            'Đơn giá': 0,
            'Ghi chú': '',
        }];
        const materialRows = currentWorkRows.length > 0 ? [] : [{
            'WBS đầu mục': sampleWbs,
            'Mã vật tư/SKU': 'VT001',
            'Tên vật tư': 'Xi măng PCB40',
            'Nhóm': 'Vật liệu xây dựng',
            'ĐVT': 'bao',
            'KL dự toán': 50,
            'Ngưỡng hao hụt': '0,5',
            'Đơn giá': 0,
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
        if (!ensureBoqPermission(canEditBoq, 'edit', 'import BOQ vật tư')) {
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
                const thresholdRaw = pickImportValue(row, ['Ngưỡng hao hụt (%)', 'Ngưỡng hao hụt', 'Định mức hao hụt']);
                const wasteThreshold = importNumber(thresholdRaw);
                const budgetQtyRaw = pickImportValue(row, ['KL dự toán', 'Khối lượng dự toán', 'Khối lượng']);
                const importedBudgetQty = importNumber(budgetQtyRaw);
                const errors: string[] = [];
                if (!workItem) errors.push(`Không tìm thấy đầu mục WBS "${workWbs}".`);
                else if (Number(workItem.plannedQty || 0) <= 0) errors.push(`Đầu mục WBS "${workWbs}" chưa có KL dự toán lớn hơn 0.`);
                if (!itemName) errors.push('Thiếu Tên vật tư.');
                if (!unit) errors.push('Thiếu ĐVT.');
                if (String(thresholdRaw ?? '').trim() === '') errors.push('Thiếu Ngưỡng hao hụt.');
                else if (wasteThreshold <= 0) errors.push('Ngưỡng hao hụt phải lớn hơn 0.');
                if (String(budgetQtyRaw ?? '').trim() !== '' && importedBudgetQty <= 0) errors.push('KL dự toán vật tư phải lớn hơn 0.');
                const matchKeys = [
                    materialCode,
                    matchedInventory?.sku,
                    `${itemName}|${unit}`,
                ].filter(Boolean).map(key => `${workItem?.id || ''}|${normalizeKey(key as string)}`);
                const existing = matchKeys.map(key => existingMaterials.get(key)).find(Boolean);
                const formulaBudgetQty = workItem ? calculateMaterialBudgetQty(Number(workItem.plannedQty || 0), wasteThreshold) : 0;
                const budgetQty = importedBudgetQty > 0 ? importedBudgetQty : formulaBudgetQty;
                const importedUnitPrice = importNumber(pickImportValue(row, ['Đơn giá', 'Đơn giá dự toán']));
                const budgetUnitPrice = importedUnitPrice || existing?.budgetUnitPrice || matchedInventory?.priceIn || 0;
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
        if (!ensureBoqPermission(canEditBoq, 'edit', 'áp dụng import BOQ vật tư')) return;
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
        const overWaste = computedBoqItems.filter(b => (b.wasteQty || 0) > 0);
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
            isOver: (b.wasteQty || 0) > 0,
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
                                    <th className="p-2.5 text-right">Ngưỡng</th>
                                    <th className="p-2.5 text-right text-red-500">GT Hao hụt</th>
                                    <th className="p-2.5">Cảnh báo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40 text-xs">
                                {computedBoqItems.map(b => {
                                    const overBudget = (b.budgetOverPercent || 0) > 0;
                                    const overWaste = (b.wasteQty || 0) > 0;
                                    const negStock = (b.stockBalance || 0) < 0;
                                    return (
                                        <tr key={b.id} className={`hover:bg-slate-50 ${overWaste ? 'bg-red-50/40' : overBudget ? 'bg-amber-50/40' : ''}`}>
                                            <td className="p-2.5 font-mono text-[10px] text-indigo-500 font-bold sticky left-0 bg-white dark:bg-slate-900 z-10">{b.materialCode || '—'}</td>
                                            <td className="p-2.5 font-bold text-slate-800 max-w-[140px] truncate">{b.itemName}</td>
                                            <td className="p-2.5 text-slate-400">{b.unit}</td>
                                            <td className="p-2.5 text-right font-bold">{formatQuantity(b.budgetQty)}</td>
                                            <td className="p-2.5 text-right font-bold">{formatQuantity(b.cumulativeRequested || 0)}</td>
                                            <td className={`p-2.5 text-right font-black ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {(b.budgetOverPercent || 0) > 0 ? '+' : ''}{formatPercent(b.budgetOverPercent || 0)}%
                                            </td>
                                            <td className="p-2.5 text-right">{formatQuantity(b.cumulativeImported || 0)}</td>
                                            <td className="p-2.5 text-right">{formatQuantity(b.cumulativeExported || 0)}</td>
                                            <td className={`p-2.5 text-right font-bold ${negStock ? 'text-red-600' : 'text-emerald-600'}`}>{formatQuantity(b.stockBalance || 0)}</td>
                                            <td className={`p-2.5 text-right font-bold ${overWaste ? 'text-red-600' : 'text-slate-600'}`}>{formatPercent(b.wastePercent || 0)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{formatQuantity(b.wasteThreshold)}</td>
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
                                <p className="text-[10px] text-slate-400 mt-1">KL dự toán vật tư tự tính bằng KL dự toán đầu mục × Ngưỡng hao hụt.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canEditBoq && (
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
                                {canEditBoq && (
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
                                <table className="w-full text-xs min-w-[1760px] table-fixed">
                                    <thead className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700">
                                        <tr className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                            <th className="text-left px-4 py-3 relative select-none" style={{ width: boqNameColWidth, minWidth: boqNameColWidth, maxWidth: boqNameColWidth }}>
                                                <div className="flex items-center justify-between">
                                                    <span>Đầu mục / Vật tư</span>
                                                    {/* Resize Handle */}
                                                    <div
                                                        onMouseDown={handleBoqResizeStart}
                                                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-indigo-500 bg-slate-300/40 dark:bg-slate-700/50 transition-colors z-20"
                                                        title="Kéo để thay đổi độ rộng cột"
                                                    />
                                                </div>
                                            </th>
                                            <th className="text-center px-2 py-3 whitespace-nowrap" style={{ width: 70, minWidth: 70 }}>ĐVT</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 100, minWidth: 100 }}>KL Dự toán</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 120, minWidth: 120 }}>Ngưỡng hao hụt</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 110, minWidth: 110 }}>Đơn giá</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 130, minWidth: 130 }}>GT Triển khai</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 120, minWidth: 120 }}>KL Thực tế CT</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 130, minWidth: 130 }}>GT Thực tế CT</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 100, minWidth: 100 }}>Chênh KL</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 100, minWidth: 100 }}>KL HĐ</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 120, minWidth: 120 }}>GT HĐ</th>
                                            <th className="text-right px-3 py-3 whitespace-nowrap" style={{ width: 120, minWidth: 120 }}>Chênh lệch</th>
                                            <th className="text-center px-2 py-3 whitespace-nowrap" style={{ width: 80, minWidth: 80 }}>TT</th>
                                            <th className="text-center px-2 py-3" style={{ width: 80, minWidth: 80 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/40">
                                        {workBoqTree.map(({ item, level }) => {
                                            const comparison = getWorkComparison(item);
                                            const childMaterials = boqItemsByWork.get(item.id) || [];
                                            const isOrphan = item.syncStatus === 'orphaned';
                                            const isLevel0 = level === 0;
                                            
                                            // Phân cấp dòng (cha - con) tương phản cao
                                            const rowBgCls = isOrphan 
                                                ? 'bg-amber-100/50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/30' 
                                                : isLevel0 
                                                    ? 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/70 dark:hover:bg-slate-750 font-extrabold text-[13px] border-b border-slate-200 dark:border-slate-700' 
                                                    : 'bg-indigo-50/25 dark:bg-indigo-950/10 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 font-bold';
                                            const textCls = isLevel0 
                                                ? 'text-slate-900 dark:text-white' 
                                                : 'text-indigo-950 dark:text-indigo-300';

                                            return (
                                                <React.Fragment key={item.id}>
                                                    <tr className={`${rowBgCls} transition-colors group`}>
                                                        <td className="px-4 py-2.5" style={{ width: boqNameColWidth, minWidth: boqNameColWidth, maxWidth: boqNameColWidth }}>
                                                            <div className="flex items-center gap-2 truncate" style={{ paddingLeft: `${level * 18}px` }}>
                                                                <ListTree size={12} className={isOrphan ? 'text-amber-500 shrink-0' : isLevel0 ? 'text-slate-600 dark:text-slate-400 shrink-0' : 'text-indigo-500 shrink-0'} />
                                                                <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-bold shrink-0">{item.wbsCode || '-'}</span>
                                                                <span className={`${textCls} truncate`} title={item.name}>{item.name}</span>
                                                                {isOrphan && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black shrink-0">ORPHAN</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-2.5 text-center text-slate-500 dark:text-slate-400 font-bold whitespace-nowrap">{item.unit || '—'}</td>
                                                        <td className="px-3 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatQuantity(Number(item.plannedQty || 0))}</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">{fmt(Number(item.unitPrice || 0))}</td>
                                                        <td className="px-3 py-2.5 text-right font-black text-indigo-700 dark:text-indigo-450 whitespace-nowrap">{fmt(comparison.plannedValue)}</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">{comparison.hasLink ? formatQuantity(comparison.contractQty) : '—'}</td>
                                                        <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">{comparison.hasLink ? fmt(comparison.contractValue) : '—'}</td>
                                                        <td className={`px-3 py-2.5 text-right font-black whitespace-nowrap ${
                                                            comparison.hasLink 
                                                                ? comparison.valueDiff > 0 
                                                                    ? 'text-rose-600 dark:text-rose-400' 
                                                                    : comparison.valueDiff < 0 
                                                                        ? 'text-emerald-600 dark:text-emerald-400' 
                                                                        : 'text-slate-500 dark:text-slate-450' 
                                                                : 'text-slate-300 dark:text-slate-600'
                                                        }`}>
                                                            {comparison.hasLink ? `${comparison.valueDiff > 0 ? '+' : ''}${fmt(comparison.valueDiff)}` : 'Chưa đối chiếu'}
                                                        </td>
                                                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${comparison.hasLink ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                                                                {comparison.hasLink ? 'Đã link HĐ' : 'Chưa link'}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                                            {canEditBoq && (
                                                                <button onClick={() => { resetBoqForm(); setBWorkBoqItemId(item.id); setShowBoqForm(true); }}
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-950/40 transition-colors">
                                                                    <Plus size={10} /> Vật tư
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {childMaterials.map(mat => {
                                                        const isOver = (mat.wasteQty || 0) > 0;
                                                        const wasteQty = mat.wasteQty || 0;
                                                        const wastePercent = mat.wastePercent || 0;
                                                        return (
                                                            <tr key={mat.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors group">
                                                                <td className="px-4 py-2.5" style={{ width: boqNameColWidth, minWidth: boqNameColWidth, maxWidth: boqNameColWidth }}>
                                                                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-350 truncate" style={{ paddingLeft: `${(level + 1) * 18}px` }}>
                                                                        <MinusCircle size={10} className="text-slate-400 dark:text-slate-500 shrink-0" />
                                                                        <span className="font-semibold truncate text-slate-800 dark:text-slate-200" title={mat.itemName}>{mat.itemName}</span>
                                                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-bold shrink-0">{mat.category}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2.5 text-center text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">{mat.unit}</td>
                                                                <td className="px-3 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatQuantity(mat.budgetQty)}</td>
                                                                <td className="px-3 py-2.5 text-right font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{formatQuantity(mat.wasteThreshold)}</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmt(mat.budgetUnitPrice)}</td>
                                                                <td className="px-3 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{fmt(mat.budgetTotal || 0)}</td>
                                                                <td className="px-3 py-2.5 text-right font-black text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{formatQuantity(mat.actualQty || 0)}</td>
                                                                <td className="px-3 py-2.5 text-right font-bold text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{fmt(mat.actualTotal || 0)}</td>
                                                                <td className={`px-3 py-2.5 text-right font-black whitespace-nowrap ${
                                                                    wasteQty > 0 
                                                                        ? 'text-rose-600 dark:text-rose-450 font-extrabold' 
                                                                        : wasteQty < 0 
                                                                            ? 'text-emerald-600 dark:text-emerald-450' 
                                                                            : 'text-slate-500 dark:text-slate-450'
                                                                }`}>
                                                                    {wasteQty > 0 ? '+' : ''}{formatQuantity(wasteQty)}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                                <td className="px-3 py-2.5 text-right text-slate-300 dark:text-slate-600 whitespace-nowrap">—</td>
                                                                <td className={`px-3 py-2.5 text-right font-black whitespace-nowrap ${
                                                                    isOver 
                                                                        ? 'text-rose-600 dark:text-rose-450 font-extrabold' 
                                                                        : wastePercent > 0 
                                                                            ? 'text-amber-500 dark:text-amber-450' 
                                                                            : 'text-emerald-500 dark:text-emerald-450'
                                                                }`}>
                                                                    {wastePercent > 0 ? '+' : ''}{formatPercent(wastePercent)}%
                                                                </td>
                                                                <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                                                    {isOver ? <AlertTriangle size={12} className="inline text-rose-500" /> : <CheckCircle2 size={12} className="inline text-emerald-500" />}
                                                                </td>
                                                                <td className="px-2 py-2.5 whitespace-nowrap">
                                                                    {(canEditBoq || canDeleteBoq) && (
                                                                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            {canEditBoq && (
                                                                                <button onClick={() => openEditBoq(mat)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"><Edit2 size={11} /></button>
                                                                            )}
                                                                            {canDeleteBoq && (
                                                                                <button onClick={() => handleDeleteBoq(mat.id, mat.itemName)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"><Trash2 size={11} /></button>
                                                                            )}
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
                                            <tr key={mat.id} className="bg-amber-50/20 dark:bg-amber-950/5 hover:bg-amber-50/40 dark:hover:bg-amber-950/10 transition-colors group">
                                                <td className="px-4 py-2.5" style={{ width: boqNameColWidth, minWidth: boqNameColWidth, maxWidth: boqNameColWidth }}>
                                                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 truncate">
                                                        <MinusCircle size={10} className="text-amber-500 shrink-0" />
                                                        <span className="font-bold truncate text-slate-800 dark:text-slate-200" title={mat.itemName}>{mat.itemName}</span>
                                                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black shrink-0">Chưa gắn đầu mục</span>
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2.5 text-center text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">{mat.unit}</td>
                                                <td className="px-3 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatQuantity(mat.budgetQty)}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{formatQuantity(mat.wasteThreshold)}</td>
                                                <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-450 whitespace-nowrap">{fmt(mat.budgetUnitPrice)}</td>
                                                <td className="px-3 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{fmt(mat.budgetTotal || 0)}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{formatQuantity(mat.actualQty || 0)}</td>
                                                <td className="px-3 py-2.5 text-right font-bold text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{fmt(mat.actualTotal || 0)}</td>
                                                <td className={`px-3 py-2.5 text-right font-black whitespace-nowrap ${(mat.wasteQty || 0) > 0 ? 'text-rose-600 dark:text-rose-450 font-extrabold' : (mat.wasteQty || 0) < 0 ? 'text-emerald-600 dark:text-emerald-450' : 'text-slate-500'}`}>
                                                    {(mat.wasteQty || 0) > 0 ? '+' : ''}{formatQuantity(mat.wasteQty || 0)}
                                                </td>
                                                <td colSpan={4}></td>
                                                <td className="px-2 py-2.5 whitespace-nowrap">
                                                    {(canEditBoq || canDeleteBoq) && (
                                                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {canEditBoq && (
                                                                <button onClick={() => openEditBoq(mat)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"><Edit2 size={11} /></button>
                                                            )}
                                                            {canDeleteBoq && (
                                                                <button onClick={() => handleDeleteBoq(mat.id, mat.itemName)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"><Trash2 size={11} /></button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-100/90 dark:bg-slate-800/90 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                                        <tr className="text-xs">
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300" style={{ width: boqNameColWidth, minWidth: boqNameColWidth, maxWidth: boqNameColWidth }}>TỔNG CỘNG VẬT TƯ</td>
                                            <td className="px-2 py-3 text-center text-slate-400">—</td>
                                            <td className="px-3 py-3 text-right text-slate-400">—</td>
                                            <td className="px-3 py-3 text-right text-slate-400">—</td>
                                            <td className="px-3 py-3 text-right text-slate-400">—</td>
                                            <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">{fmt(stats.totalBudget)} đ</td>
                                            <td className="px-3 py-3 text-right text-slate-400">—</td>
                                            <td className="px-3 py-3 text-right text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{fmt(stats.totalActual)} đ</td>
                                            <td className="px-3 py-3 text-right text-slate-400">—</td>
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
                    <ProjectWorkflowBindingPanel
                        projectId={projectId || null}
                        constructionSiteId={constructionSiteId || null}
                        templates={workflowTemplates}
                        onConfigurationChange={setWorkflowConfiguration}
                    />
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
                    {requests.length > 0 && (
                        <>
                            <ProjectWorkflowInbox
                                requests={sortedRequests}
                                subjectsByRequestId={requestWorkflowSubjects}
                                users={users}
                                currentUserId={user.id}
                                onOpenRequest={req => { setSelectedRequest(req); setRequestModalInitialAction(undefined); setReqModalOpen(true); }}
                            />
                            <ProjectWorkflowAnalyticsPanel
                                requests={sortedRequests}
                                subjectsByRequestId={requestWorkflowSubjects}
                                users={users}
                            />
                            <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex flex-wrap gap-1.5">
                                    {([
                                        ['all', 'Tất cả'],
                                        ['mine', 'Của tôi'],
                                        ['overdue', 'Quá hạn'],
                                        ['returned', 'Đã trả lại'],
                                        ['watching', 'Theo dõi'],
                                    ] as Array<[ProjectWorkflowBoardFilter, string]>).map(([filter, label]) => (
                                        <button
                                            key={filter}
                                            type="button"
                                            onClick={() => setWorkflowBoardFilter(filter)}
                                            className={`rounded-lg border px-3 py-1.5 text-[10px] font-black transition ${workflowBoardFilter === filter ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
                                        <input
                                            type="checkbox"
                                            checked={hideEmptyWorkflowLanes}
                                            onChange={event => setHideEmptyWorkflowLanes(event.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                                        />
                                        Chỉ hiện bước có phiếu
                                    </label>
                                    <div className="flex min-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                        <Search size={14} className="shrink-0 text-slate-300" />
                                        <input
                                            value={workflowBoardSearch}
                                            onChange={event => setWorkflowBoardSearch(event.target.value)}
                                            placeholder="Tìm mã phiếu, người yêu cầu, người xử lý..."
                                            className="w-full border-none bg-transparent text-xs font-bold text-slate-600 outline-none placeholder:text-slate-300"
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
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
                            workflowSubjectsByRequestId={requestWorkflowSubjects}
                            workflowNodes={workflowConfiguration?.binding
                                ? workflowNodes.filter(node => node.templateId === workflowConfiguration.binding?.workflowTemplateId)
                                : []}
                            workflowRuntimeNodes={requestWorkflowRuntimeNodes}
                            currentUserId={user.id}
                            boardFilter={workflowBoardFilter}
                            searchTerm={workflowBoardSearch}
                            hideEmptyWorkflowLanes={hideEmptyWorkflowLanes}
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
                                                const isOver = (item.wasteQty || 0) > 0;
                                                const isNeg = (item.wastePercent || 0) <= 0;
                                                return (
                                                    <tr key={item.id} className={`${isOver ? 'bg-red-50/30' : ''}`}>
                                                        <td className="px-4 py-2.5 font-bold text-slate-700">{item.itemName}</td>
                                                        <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-600">{formatQuantity(item.budgetQty)}</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-slate-700">{formatQuantity(item.actualQty)}</td>
                                                        <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {(item.wasteQty || 0) > 0 ? '+' : ''}{formatQuantity(item.wasteQty || 0)}
                                                        </td>
                                                        <td className={`px-4 py-2.5 text-right font-black ${isOver ? 'text-red-500' : isNeg ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                            {(item.wastePercent || 0) > 0 ? '+' : ''}{formatPercent(item.wastePercent || 0)}%
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right text-slate-400">{formatQuantity(item.wasteThreshold)}</td>
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
                    recipientPermissionCodes={submissionTransition.recipientPermissionCodes?.length ? submissionTransition.recipientPermissionCodes as any : ['approve']}
                    recipientHint={submissionTransition.recipientHint || 'Chọn đích danh nhân sự dự án có quyền approve để xử lý bước tiếp theo.'}
                    details={[
                        { label: 'Kho nhận', value: warehouses.find(w => w.id === submissionTransition.request.siteWarehouseId)?.name || submissionTransition.request.siteWarehouseId },
                        { label: 'Số dòng vật tư', value: `${submissionTransition.request.items.length} dòng` },
                        { label: submissionTransition.dynamicWorkflow ? 'Bước kế tiếp' : 'SLA bước mới', value: submissionTransition.dynamicWorkflow ? (submissionTransition.nextNodeLabel || 'Theo mẫu workflow') : (submissionTransition.toStep === 'batch_planning' ? '48h' : '24h') },
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
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đầu mục BOQ triển khai *</label>
                                <select value={bWorkBoqItemId} onChange={e => handleWorkBoqItemChange(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
                                    <option value="">Chọn đầu mục để tính KL vật tư...</option>
                                    {workBoqTree.map(({ item, level }) => (
                                        <option key={item.id} value={item.id}>{`${'— '.repeat(level)}${item.wbsCode || ''} ${item.name} (KL: ${formatQuantity(Number(item.plannedQty || 0))})`}</option>
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
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngưỡng hao hụt *</label>
                                    <input type="text" inputMode="decimal" value={bThreshold} onChange={e => setBThreshold(e.target.value)} placeholder="0,5"
                                        className="w-full px-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-indigo-500 uppercase block mb-1">KL Dự toán vật tư *</label>
                                    <input type="text" inputMode="decimal" value={bBudgetQtyInput} onChange={e => handleBudgetQtyChange(e.target.value)} placeholder="Tự động hoặc nhập tay"
                                        className="w-full px-3 py-2.5 rounded-xl border border-indigo-200 text-sm font-black outline-none bg-white text-indigo-700 focus:ring-2 focus:ring-indigo-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn giá (VNĐ)</label>
                                    <input type="number" value={bPrice} onChange={e => setBPrice(e.target.value)} placeholder="0"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" readOnly={!!bInventoryItemId} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 text-blue-400">KL Thực xuất (tự động)</label>
                                    <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-400">
                                        Tự tính từ phiếu đề xuất đã duyệt
                                    </div>
                                </div>
                            </div>
                            <div className="px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-xs">
                                <div className="font-bold text-indigo-500">KL vật tư = KL dự toán đầu mục × Ngưỡng hao hụt</div>
                                {selectedWorkBoqItem ? (
                                    <div className="mt-1 text-indigo-700">
                                        <span className="font-black">{formatQuantity(selectedWorkPlannedQty)} × {hasValidThreshold ? formatQuantity(thresholdValue) : '—'} = {formatQuantity(autoBudgetQty)} {bUnit || ''}</span>
                                        {bBudgetQtyManuallyEdited && bBudgetQty > 0 && Math.abs(bBudgetQty - autoBudgetQty) > 0.000001 && (
                                            <span className="ml-2 font-bold text-amber-600">• KL đang nhập: {formatQuantity(bBudgetQty)} {bUnit || ''}</span>
                                        )}
                                        {bPrice !== '' && bBudgetQty > 0 && <span className="ml-2 text-indigo-400">• Giá trị: {fmt(bBudgetQty * Number(bPrice))} đ</span>}
                                        {hasValidThreshold && autoBudgetQty > 0 && (
                                            <button type="button" onClick={resetBudgetQtyToFormula}
                                                className="ml-2 rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[10px] font-black text-indigo-600 hover:bg-indigo-100">
                                                Dùng công thức
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mt-1 font-bold text-amber-600">Chọn đầu mục BOQ để hệ thống tự tính KL dự toán vật tư.</div>
                                )}
                                {selectedWorkBoqItem && selectedWorkPlannedQty <= 0 && (
                                    <div className="mt-1 font-bold text-red-500">Đầu mục đang có KL dự toán bằng 0, chưa thể thêm vật tư.</div>
                                )}
                                </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú</label>
                                <textarea value={bNotes} onChange={e => setBNotes(e.target.value)} rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={resetBoqForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
                            <button onClick={handleSaveBoq} disabled={!canSaveBoqItem}
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
                                    })()} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${formatQuantity(percent * 100)}%`}>
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
                                    <Tooltip formatter={(v: number) => `${Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} triệu`} />
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
                                            <td className="p-2.5 text-right">{formatQuantity(b.budgetQty)}</td>
                                            <td className="p-2.5 text-right font-bold">{formatQuantity(b.cumulativeRequested || 0)}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">+{formatPercent(b.budgetOverPercent || 0)}%</td>
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
                                    <th className="p-2.5 text-left">Vật tư</th><th className="p-2.5 text-right">HH%</th><th className="p-2.5 text-right">Ngưỡng</th><th className="p-2.5 text-right">GT Hao hụt</th>
                                </tr></thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                                    {computedBoqItems.filter(b => (b.wasteQty || 0) > 0).sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)).map(b => (
                                        <tr key={b.id} className="hover:bg-amber-50/50">
                                            <td className="p-2.5 font-bold text-slate-800">{b.itemName}</td>
                                            <td className="p-2.5 text-right font-black text-red-600">{formatPercent(b.wastePercent || 0)}%</td>
                                            <td className="p-2.5 text-right text-slate-400">{formatQuantity(b.wasteThreshold)}</td>
                                            <td className="p-2.5 text-right font-bold text-red-600">{fmt(Math.abs(b.wasteValue || 0))} đ</td>
                                        </tr>
                                    ))}
                                    {computedBoqItems.filter(b => (b.wasteQty || 0) > 0).length === 0 && (
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
                    canManageProjectWorkflow={selectedRequestLive ? canManageProjectWorkflow(selectedRequestLive) : false}
                    projectWorkflowSubject={selectedRequestLive ? requestWorkflowSubjects[selectedRequestLive.id] : undefined}
                    projectWorkflowAssignments={
                        selectedRequestLive && requestWorkflowSubjects[selectedRequestLive.id]
                            ? requestWorkflowAssignments[requestWorkflowSubjects[selectedRequestLive.id].id] || []
                            : []
                    }
                    projectWorkflowNodes={
                        selectedRequestLive && requestWorkflowSubjects[selectedRequestLive.id]
                            ? requestWorkflowRuntimeContexts[requestWorkflowSubjects[selectedRequestLive.id].id]?.nodes
                                .map(node => runtimeNodeToWorkflowNode(node))
                                .filter(Boolean) as WorkflowNode[] || workflowNodes
                            : workflowNodes
                    }
                    projectWorkflowNextNode={selectedRequestLive ? getWorkflowNextNode(requestWorkflowSubjects[selectedRequestLive.id]) : null}
                    projectWorkflowReturnTargetNode={selectedRequestLive ? getWorkflowReturnTargetNode(requestWorkflowSubjects[selectedRequestLive.id]) : null}
                    onProjectWorkflowAction={handleProjectWorkflowActionFromModal}
                    onDeleted={handleRequestDeleted}
                />
            )}

            {startWorkflowRequest && (
                <ProjectWorkflowStartDialog
                    requestId={startWorkflowRequest.id}
                    requestCode={startWorkflowRequest.code}
                    requesterUserId={startWorkflowRequest.requesterId}
                    projectId={startWorkflowRequest.projectId || projectId || null}
                    constructionSiteId={startWorkflowRequest.constructionSiteId || constructionSiteId || null}
                    users={users}
                    employees={employees}
                    orgUnits={orgUnits}
                    onCancel={() => setStartWorkflowRequest(null)}
                    onConfirm={async input => {
                        await performDynamicRequestTransition({
                            request: startWorkflowRequest,
                            action: 'SUBMITTED',
                            templateId: input.templateId,
                            target: {
                                userId: input.assigneeUserIds[0],
                                userIds: input.assigneeUserIds,
                                name: userById.get(input.assigneeUserIds[0])?.name || input.assigneeUserIds[0],
                                names: input.assigneeUserIds.map(id => userById.get(id)?.name || id),
                                note: input.comment,
                            },
                            note: input.comment,
                            metadata: { source: 'kanban_start_dynamic' },
                        });
                        setStartWorkflowRequest(null);
                    }}
                />
            )}

            {workflowActionTransition && (
                <ProjectWorkflowActionDialog
                    action="approve"
                    subject={workflowActionTransition.subject}
                    users={users}
                    employees={employees}
                    orgUnits={orgUnits}
                    currentNode={workflowActionTransition.subject.currentNode}
                    nextNode={workflowActionTransition.nextNode}
                    requesterUserId={workflowActionTransition.request.requesterId}
                    documentName={workflowActionTransition.request.code}
                    completionHandoff={{
                        required: true,
                        eligiblePermissionCodes: ['approve'],
                        assigneeLabel: 'Người phụ trách tạo đợt cấp / đặt mua',
                        helperText: 'Workflow phê duyệt sẽ hoàn thành. Phiếu vật tư chuyển sang Chờ tạo đợt cấp và giao cho người được chọn để cấp hàng hoặc đặt mua.',
                    }}
                    onCancel={() => setWorkflowActionTransition(null)}
                    onConfirm={async context => {
                        const assigneeUserIds = context.assigneeUserIds || [];
                        await performDynamicRequestTransition({
                            request: workflowActionTransition.request,
                            action: 'APPROVED',
                            target: assigneeUserIds.length > 0 ? {
                                userId: assigneeUserIds[0],
                                userIds: assigneeUserIds,
                                name: userById.get(assigneeUserIds[0])?.name || assigneeUserIds[0],
                                names: assigneeUserIds.map(id => userById.get(id)?.name || id),
                                note: context.comment,
                            } : null,
                            note: context.comment,
                            metadata: { source: 'kanban_dynamic_step', nextNodeId: workflowActionTransition.nextNode.id },
                        });
                        setWorkflowActionTransition(null);
                    }}
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
                                        <tr><th className="px-3 py-2 text-left">Dòng</th><th className="px-3 py-2 text-left">WBS</th><th className="px-3 py-2 text-left">Mã/SKU</th><th className="px-3 py-2 text-left">Tên vật tư</th><th className="px-3 py-2 text-left">ĐVT</th><th className="px-3 py-2 text-right">KL tự tính</th><th className="px-3 py-2 text-right">Ngưỡng</th><th className="px-3 py-2 text-right">Đơn giá</th><th className="px-3 py-2 text-left">Trạng thái</th></tr>
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
                                                    <td className="px-3 py-2 text-right font-bold">{formatQuantity(row.item.budgetQty)}</td>
                                                    <td className="px-3 py-2 text-right font-bold text-indigo-600">{formatQuantity(row.item.wasteThreshold)}</td>
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
                            <button onClick={confirmImportWorkBoq} disabled={!canEditBoq || importingBoq || [...importPreview.workRows, ...importPreview.materialRows].every(row => row.status === 'error')}
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
