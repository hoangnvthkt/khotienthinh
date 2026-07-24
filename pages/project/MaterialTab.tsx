import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Plus, Edit2, Trash2, Package,
    ChevronDown, ChevronRight,
    RefreshCcw, Download, Upload,
    FileSpreadsheet, GitBranch, ListTree, Loader2, BookOpen
} from 'lucide-react';
import { MaterialBudgetItem, InventoryItem, MaterialRequest, RequestStatus, ProjectTask, ProjectWorkBoqItem, ContractItem, TaskContractItem, MaterialRequestFulfillmentSummary, MaterialRequestFulfillmentBatch, MaterialRequestEvent, MaterialRequestKanbanLaneId, MaterialRequestKanbanStage, MaterialRequestWorkflowStep, ProjectSubmissionTarget, Role, PurchaseOrder, MaterialPlanningRule, MaterialPlanningDraftPo, PlanningCurveTemplate, ProjectWorkflowActionContext, ProjectWorkflowBoardFilter, ProjectWorkflowConfiguration, ProjectWorkflowRuntimeContext, ProjectWorkflowSubject, MaterialRequestWorkflowBoardCard, WorkflowNode, WorkflowNodeType, WorkflowStepAssignment, Project, ProjectFinance } from '../../types';
import { boqService, taskService, workBoqService, poService } from '../../lib/projectService';
import { materialRequestFulfillmentService, getRequestLineId } from '../../lib/materialRequestFulfillmentService';
import { useApp } from '../../context/AppContext';
import type { MaterialRequestInitialDraft } from '../../components/RequestModal';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { taskContractItemService } from '../../lib/taskContractItemService';
import { contractItemService } from '../../lib/contractItemService';
import { loadXlsx } from '../../lib/loadXlsx';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import type { ProjectMaterialTabKey, ProjectMaterialTabPermissionMap } from '../../lib/projectTabPermissions';
import { materialRequestService } from '../../lib/materialRequestService';
import { projectSubmissionService } from '../../lib/projectSubmissionService';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import { projectWorkflowBoardService } from '../../lib/projectWorkflowBoardService';
import { useWorkflow } from '../../context/WorkflowContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { isGlobalWarehouseKeeper, isWarehouseKeeperFor } from '../../lib/wmsPermissions';
import { getMaterialPlanningScopeKey, materialPlanningCurveService, materialPlanningRuleService, projectMaterialPlanningService } from '../../lib/projectMaterialPlanningService';
import { MaterialBoqFormModal } from '../../components/project/material/MaterialBoqFormModal';
import { CustomMaterialRequestTab } from '../../components/project/material/CustomMaterialRequestTab';
import { G8NormApplyModal } from '../../components/project/material/G8NormApplyModal';
import { MaterialBoqImportPreviewModal } from '../../components/project/material/MaterialBoqImportPreviewModal';
import { MaterialDashboardTab } from '../../components/project/material/MaterialDashboardTab';
import ProjectOpeningBalanceModal from '../../components/project/ProjectOpeningBalanceModal';
import { MaterialRequestTab } from '../../components/project/material/MaterialRequestTab';
import { MaterialSummaryTab } from '../../components/project/material/MaterialSummaryTab';
import { MaterialTabHeader } from '../../components/project/material/MaterialTabHeader';
import { MaterialWasteTab } from '../../components/project/material/MaterialWasteTab';
import {
    aggregateMaterialWasteRows,
    calculateMaterialBudgetQty,
    fmt,
    formatBoqWriteError,
    formatPercent,
    formatQuantity,
    formatVietnameseMoney,
    getValidMaterialTab,
    importNumber,
    importText,
    isValidWbsCode,
    MATERIAL_BOQ_HEADERS,
    MATERIAL_BOQ_SHEET_NAME,
    MATERIAL_REQUEST_BUDGET_HOLDING_STATUSES,
    normalizeKey,
    normalizeLookupText,
    parseVietnameseMoney,
    pickImportValue,
    PROJECT_REQUEST_DATA_TABS,
    PROJECT_REQUEST_FULFILLMENT_TABS,
    rowHasAnyValue,
    SITE_WAREHOUSE_STOP_WORDS,
    summarizeSync,
    WORK_BOQ_HEADERS,
    WORK_BOQ_SHEET_NAME,
    type WorkBoqImportPreview,
} from '../../lib/projectMaterialTabUtils';
import { useProjectMaterialAccess } from '../../hooks/project/material/useProjectMaterialAccess';

const SupplyChainTab = React.lazy(() => import('./SupplyChainTab'));
const MaterialPlanningPanel = React.lazy(() => import('../../components/project/MaterialPlanningPanel'));
const ProjectRoomSubmissionDialog = React.lazy(() => import('../../components/project/ProjectRoomSubmissionDialog'));
const ProjectWorkflowActionDialog = React.lazy(() => import('../../components/project/ProjectWorkflowActionDialog'));
const ProjectWorkflowStartDialog = React.lazy(() => import('../../components/project/ProjectWorkflowStartDialog'));
const BoqReconciliationPanel = React.lazy(() => import('../../components/project/BoqReconciliationPanel'));
const RequestModal = React.lazy(() => import('../../components/RequestModal'));

const LazyPanelFallback = ({ label = 'Đang tải dữ liệu...' }: { label?: string }) => (
    <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-slate-100 bg-white text-xs font-bold text-slate-400 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <Loader2 size={14} className="mr-2 animate-spin text-indigo-500" /> {label}
    </div>
);

const AGGREGATE_OUTSIDE_BOQ_REASON = 'Đề xuất ngoài BOQ theo tổng định mức vật tư';

interface MaterialTabProps {
    constructionSiteId?: string;
    projectId?: string;
    project?: Project;
    projectFinance?: ProjectFinance | null;
    siteName?: string;
    siteWarehouseId?: string; // ID kho công trường
    canManageTab?: boolean;
    materialPermissions?: ProjectMaterialTabPermissionMap;
}

const MATERIAL_REQUEST_APPROVE_PERMISSION = 'project.material_request.approve';
const MATERIAL_REQUEST_RETURN_PERMISSION = 'project.material_request.return';
const MATERIAL_REQUEST_SUBMIT_PERMISSION = 'project.material_request.submit';
const MATERIAL_REQUEST_CONFIRM_PERMISSION = 'project.material_request.confirm_fulfillment';
const MATERIAL_REQUEST_EDIT_OWN_PERMISSION = 'project.material_request.edit_own';

const normalizeMaterialRequestPermissionCodes = (codes?: string[] | null): string[] => {
    const normalized = (codes || []).map(code => {
        if (code.startsWith('project.')) return code;
        if (code === 'submit') return MATERIAL_REQUEST_SUBMIT_PERMISSION;
        if (code === 'return' || code === 'reject' || code === 'rejected' || code === 'returned') return MATERIAL_REQUEST_RETURN_PERMISSION;
        if (code === 'confirm' || code === 'confirm_fulfillment' || code === 'fulfill') return MATERIAL_REQUEST_CONFIRM_PERMISSION;
        if (code === 'edit') return MATERIAL_REQUEST_EDIT_OWN_PERMISSION;
        return MATERIAL_REQUEST_APPROVE_PERMISSION;
    });
    return [...new Set(normalized.length > 0 ? normalized : [MATERIAL_REQUEST_APPROVE_PERMISSION])];
};

const MaterialTab: React.FC<MaterialTabProps> = ({ constructionSiteId, projectId, project, projectFinance, siteName, siteWarehouseId, canManageTab = true, materialPermissions }) => {
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
    const [activeSubTab, setActiveSubTab] = useState<ProjectMaterialTabKey>(() =>
        getValidMaterialTab(new URLSearchParams(location.search).get('materialTab')) || 'summary'
    );
    const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
    const {
        materialAccess,
        visibleMaterialTabs,
        boqPbacLoaded,
        canEditBoq,
        canDeleteBoq,
        canApproveProjectRequest,
        canViewAvailableStock,
        canCreateMaterialRequest,
        canSubmitMaterialRequest,
        canReturnMaterialRequest,
        canConfirmFulfillment,
        canEditPlanning,
        canCreatePo,
        canApprovePo,
        canReceivePo,
        canDeletePo,
        canManagePoPermission,
        canViewDirectPurchase,
        canCreateDirectPurchase,
        canEditDirectPurchase,
        canDeleteDirectPurchase,
        canRecordDirectPurchaseAp,
        canViewSupplierDelivery,
        canCreateSupplierDelivery,
        canEditSupplierDelivery,
        canDeleteSupplierDelivery,
        canRecordSupplierDelivery,
        canUnrecordSupplierDelivery,
        canReconcileSupplierDelivery,
        canCreateCustomMaterial,
        canApproveCustomMaterial,
    } = useProjectMaterialAccess({
        materialPermissions,
        canManageTab,
        projectId,
        constructionSiteId,
        user,
    });

    useEffect(() => {
        if (visibleMaterialTabs.length > 0 && !materialAccess[activeSubTab].canView) {
            setActiveSubTab(visibleMaterialTabs[0].key);
        }
    }, [activeSubTab, materialAccess, visibleMaterialTabs]);

    useEffect(() => {
        const materialTab = getValidMaterialTab(new URLSearchParams(location.search).get('materialTab'));
        if (!materialTab) return;
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
    const [, setProjectRequestBoardHydrated] = useState(false);
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
    const [isReqModalOpen, setReqModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | undefined>(undefined);
    const [requestModalInitialAction, setRequestModalInitialAction] = useState<'createFulfillmentBatch' | undefined>(undefined);
    const [requestModalInitialDraft, setRequestModalInitialDraft] = useState<MaterialRequestInitialDraft | null>(null);
    const [selectedMaterialGroupKeys, setSelectedMaterialGroupKeys] = useState<Set<string>>(() => new Set());
    const [requestFulfillmentSummaries, setRequestFulfillmentSummaries] = useState<Record<string, MaterialRequestFulfillmentSummary>>({});
    const [requestFulfillmentBatchCounts, setRequestFulfillmentBatchCounts] = useState<Record<string, number>>({});
    const activeMaterialRequestDeepLinkId = useMemo(
        () => new URLSearchParams(location.search).get('requestId'),
        [location.search],
    );
    const activePurchaseOrderDeepLinkId = useMemo(
        () => new URLSearchParams(location.search).get('poId'),
        [location.search],
    );
    const needsProjectRequestData = PROJECT_REQUEST_DATA_TABS.has(activeSubTab) || isReqModalOpen || Boolean(activeMaterialRequestDeepLinkId);
    const needsProjectWorkflowBoard = activeSubTab === 'request' || Boolean(activeMaterialRequestDeepLinkId);
    const needsRequestFulfillmentDetails = PROJECT_REQUEST_FULFILLMENT_TABS.has(activeSubTab) || isReqModalOpen;

    const [expandedWorkBoqMaterialIds, setExpandedWorkBoqMaterialIds] = useState<Set<string>>(() => new Set());
    const [expandedWorkBoqNodeIds, setExpandedWorkBoqNodeIds] = useState<Set<string>>(() => new Set());

    const workBoqDescendantIdsByParent = useMemo(() => {
        const childrenByParent = new Map<string, ProjectWorkBoqItem[]>();
        workBoqItems.forEach(item => {
            if (!item.parentId) return;
            if (!childrenByParent.has(item.parentId)) childrenByParent.set(item.parentId, []);
            childrenByParent.get(item.parentId)!.push(item);
        });

        const descendantIdsByParent = new Map<string, string[]>();
        const collectDescendantIds = (itemId: string, visited = new Set<string>()): string[] => {
            if (visited.has(itemId)) return [];
            visited.add(itemId);
            const children = childrenByParent.get(itemId) || [];
            return children.flatMap(child => [child.id, ...collectDescendantIds(child.id, visited)]);
        };

        workBoqItems.forEach(item => {
            descendantIdsByParent.set(item.id, collectDescendantIds(item.id));
        });
        return descendantIdsByParent;
    }, [workBoqItems]);

    const toggleWorkBoqMaterials = useCallback((workBoqItemId: string, checked: boolean) => {
        setExpandedWorkBoqMaterialIds(prev => {
            const next = new Set(prev);
            const affectedIds = [workBoqItemId, ...(workBoqDescendantIdsByParent.get(workBoqItemId) || [])];
            affectedIds.forEach(id => {
                if (checked) next.add(id);
                else next.delete(id);
            });
            return next;
        });
    }, [workBoqDescendantIdsByParent]);

    const toggleWorkBoqNode = useCallback((id: string) => {
        setExpandedWorkBoqNodeIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const expandAllWorkBoqNodes = useCallback(() => {
        const parentIds = workBoqItems
            .filter(item => (workBoqDescendantIdsByParent.get(item.id) || []).length > 0)
            .map(item => item.id);
        setExpandedWorkBoqNodeIds(new Set(parentIds));
    }, [workBoqItems, workBoqDescendantIdsByParent]);

    const collapseAllWorkBoqNodes = useCallback(() => {
        setExpandedWorkBoqNodeIds(new Set());
    }, []);

    useEffect(() => {
        const existingWorkBoqIds = new Set(workBoqItems.map(item => item.id));
        setExpandedWorkBoqMaterialIds(prev => {
            const next = new Set([...prev].filter(id => existingWorkBoqIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
        setExpandedWorkBoqNodeIds(prev => {
            const next = new Set([...prev].filter(id => existingWorkBoqIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [workBoqItems]);

    useEffect(() => {
        if (activeSubTab === 'po') return;
        loadModuleData('wms-core');
    }, [activeSubTab, loadModuleData]);

    const loadProjectRequests = useCallback(async () => {
        if (!projectId) {
            setProjectRequests([]);
            setRequestWorkflowSubjects({});
            setRequestWorkflowAssignments({});
            setRequestWorkflowRuntimeContexts({});
            setRequestEventsByRequest({});
            setRequestFulfillmentSummaries({});
            setRequestFulfillmentBatchCounts({});
            setRequestFulfillmentBatches({});
            setProjectRequestBoardHydrated(false);
            setProjectRequestsLoaded(true);
            return;
        }
        try {
            const [rows, boardPage] = await Promise.all([
                materialRequestService.listByProject(projectId),
                needsProjectWorkflowBoard
                    ? projectWorkflowBoardService.listMaterialRequestCards({
                        projectId,
                        constructionSiteId: constructionSiteId || null,
                        filters: { filter: 'all' },
                        limit: 300,
                    }).catch(error => {
                        console.warn('Material request board RPC unavailable, falling back to legacy loaders:', error);
                        return null;
                    })
                    : Promise.resolve(null),
            ]);
            setProjectRequests(rows);
            const boardCards = (boardPage?.cards || []) as MaterialRequestWorkflowBoardCard[];
            const canHydrateFromBoard = Boolean(boardPage && !boardPage.nextCursor);
            if (canHydrateFromBoard && (boardCards.length > 0 || rows.length === 0)) {
                setProjectRequestBoardHydrated(true);
                const subjects = boardCards.reduce<Record<string, ProjectWorkflowSubject>>((acc, card) => {
                    if (!card.subject?.id) return acc;
                    const subject = {
                        ...card.subject,
                        id: card.subject.id,
                        subjectType: 'material_request',
                        subjectId: card.id,
                        projectId: card.projectId || projectId,
                        constructionSiteId: card.constructionSiteId || null,
                        currentRuntimeNode: card.currentRuntimeNode as any,
                        currentNode: card.currentRuntimeNode as any,
                        currentAssigneeUserIds: card.subject.currentAssigneeUserIds || card.currentAssignees?.map(item => item.id) || [],
                        participants: card.subject.participants || [],
                    } as ProjectWorkflowSubject;
                    acc[card.id] = subject;
                    return acc;
                }, {});
                setRequestWorkflowSubjects(subjects);
                setRequestWorkflowRuntimeContexts(Object.values(subjects).reduce<Record<string, ProjectWorkflowRuntimeContext>>((acc, subject) => {
                    if (subject.currentRuntimeNode) {
                        acc[subject.id] = {
                            subject,
                            nodes: [subject.currentRuntimeNode],
                            edges: [],
                        };
                    }
                    return acc;
                }, {}));
                setRequestFulfillmentSummaries(
                    boardCards.reduce<Record<string, MaterialRequestFulfillmentSummary>>((acc, card) => {
                        const summary = card.fulfillmentSummary;
                        if (!summary) return acc;
                        acc[card.id] = {
                            materialRequestId: card.id,
                            requestedQty: 0,
                            committedQty: Number(summary.committedQty || 0),
                            orderedQty: 0,
                            issuedQty: Number(summary.issuedQty || 0),
                            receivedQty: Number(summary.receivedQty || 0),
                            remainingToIssue: Math.max(Number(summary.committedQty || 0) - Number(summary.issuedQty || 0), 0),
                            remainingToReceive: Math.max(Number(summary.committedQty || 0) - Number(summary.receivedQty || 0), 0),
                            lineSummaries: [],
                        };
                        return acc;
                    }, {}),
                );
                setRequestFulfillmentBatchCounts(
                    boardCards.reduce<Record<string, number>>((acc, card) => {
                        acc[card.id] = Number(card.fulfillmentSummary?.batchCount || 0);
                        return acc;
                    }, {}),
                );
                setRequestFulfillmentBatches({});
                setRequestEventsByRequest(
                    boardCards.reduce<Record<string, MaterialRequestEvent[]>>((acc, card) => {
                        acc[card.id] = (card.eventPreview || []).map(event => ({
                            id: event.id,
                            requestId: card.id,
                            projectId: card.projectId || projectId,
                            fromStep: null,
                            toStep: null,
                            action: event.action,
                            actorUserId: event.actorUserId || '',
                            targetUserId: event.targetUserId || null,
                            targetPermission: null,
                            note: event.note || null,
                            slaHours: null,
                            dueAt: null,
                            metadata: {},
                            createdAt: event.createdAt || card.createdDate || '',
                        }));
                        return acc;
                    }, {}),
                );
                setRequestWorkflowAssignments(prev => {
                    const activeSubjectIds = new Set(Object.values(subjects).map(subject => subject.id));
                    return Object.entries(prev).reduce<Record<string, WorkflowStepAssignment[]>>((acc, [subjectId, rows]) => {
                        if (activeSubjectIds.has(subjectId)) acc[subjectId] = rows;
                        return acc;
                    }, {});
                });
            } else if (needsProjectWorkflowBoard) {
                setProjectRequestBoardHydrated(false);
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
            } else {
                setProjectRequestBoardHydrated(false);
            }
        } catch (error: any) {
            console.error('Failed to load project material requests', error);
            toast.error('Không tải được phiếu vật tư dự án', error?.message || 'Vui lòng thử lại.');
        } finally {
            setProjectRequestsLoaded(true);
        }
    }, [constructionSiteId, needsProjectWorkflowBoard, projectId, toast]);

    useEffect(() => {
        setProjectRequests([]);
        setProjectRequestsLoaded(false);
        setProjectRequestBoardHydrated(false);
        setRequestWorkflowSubjects({});
        setRequestWorkflowAssignments({});
        setRequestWorkflowRuntimeContexts({});
        setRequestEventsByRequest({});
        setRequestFulfillmentSummaries({});
        setRequestFulfillmentBatchCounts({});
        setRequestFulfillmentBatches({});
        projectWorkflowService.clearAssigneeCandidateCache();
    }, [constructionSiteId, projectId]);

    useEffect(() => {
        if (!needsProjectRequestData) return;
        setProjectRequestsLoaded(false);
        void loadProjectRequests();
    }, [loadProjectRequests, needsProjectRequestData]);

    const closeRequestModal = () => {
        setReqModalOpen(false);
        setSelectedRequest(undefined);
        setRequestModalInitialAction(undefined);
        setRequestModalInitialDraft(null);
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
        if (!nodeId) return [MATERIAL_REQUEST_APPROVE_PERMISSION];
        const runtimeNode = Object.values(requestWorkflowRuntimeContexts)
            .flatMap(context => context.nodes)
            .find(node => node.id === nodeId || node.templateNodeId === nodeId);
        const node = runtimeNode ? runtimeNodeToWorkflowNode(runtimeNode) : workflowNodeById.get(nodeId);
        const codes = node?.config?.eligiblePermissionCodes?.filter(Boolean);
        return normalizeMaterialRequestPermissionCodes(codes);
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
        const requestId = activeMaterialRequestDeepLinkId;
        if (!requestId || !projectRequestsLoaded || openedDeepLinkRequestRef.current === requestId) return;
        const target = requests.find(request => request.id === requestId);
        if (!target) return;
        openedDeepLinkRequestRef.current = requestId;
        setActiveSubTab('request');
        setSelectedRequest(target);
        setRequestModalInitialDraft(null);
        setReqModalOpen(true);
    }, [activeMaterialRequestDeepLinkId, projectRequestsLoaded, requests]);

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
        if (activeSubTab !== 'planning' && activeSubTab !== 'summary') return;
        if (activeSubTab === 'planning' && !materialAccess.planning.canView) return;
        if (activeSubTab === 'summary' && !materialAccess.summary.canView) return;
        void loadPlanningData();
    }, [activeSubTab, loadPlanningData, materialAccess.planning.canView, materialAccess.summary.canView]);

    useEffect(() => {
        if (!needsRequestFulfillmentDetails) return;
        let cancelled = false;
        const loadFulfillment = async () => {
            if (requests.length === 0) {
                setRequestFulfillmentSummaries({});
                setRequestFulfillmentBatchCounts({});
                setRequestFulfillmentBatches({});
                return;
            }
            const fulfillment = await materialRequestFulfillmentService.listSummariesByRequests(requests);
            if (cancelled) return;
            setRequestFulfillmentSummaries(fulfillment.summariesByRequestId);
            setRequestFulfillmentBatchCounts(fulfillment.batchCountsByRequestId);
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
    }, [needsRequestFulfillmentDetails, requests]);

    useEffect(() => {
        if (requests.length === 0) setRequestEventsByRequest({});
    }, [requests.length]);

    const [showBoqForm, setShowBoqForm] = useState(false);
    const [editingBoq, setEditingBoq] = useState<MaterialBudgetItem | null>(null);
    const [showG8NormModal, setShowG8NormModal] = useState(false);
    const [g8NormInitialWorkBoqItemId, setG8NormInitialWorkBoqItemId] = useState('');
    const [g8NormInitialMappingId, setG8NormInitialMappingId] = useState('');

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
        if (!boqPbacLoaded) {
            toast.info('Đang tải quyền', 'Vui lòng thử lại sau vài giây.');
            return false;
        }
        toast.warning(
            'Không có quyền BOQ',
            `Bạn cần quyền dự án "project.material_boq.${permissionCode}" để ${action}.`,
        );
        return false;
    };

    const refreshMaterialRequestWorkflow = async () => {
        await loadProjectRequests();
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
            || ((canApproveProjectRequest || canReturnMaterialRequest || canConfirmFulfillment) && getWorkflowAssigneeUserIds(request).includes(user.id));
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
                    && canSubmitMaterialRequest
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
            return canSubmitMaterialRequest && (request.requesterId === user.id || user.role === Role.ADMIN);
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
        const [updated, subject, eventPage] = await Promise.all([
            materialRequestService.getById(requestId),
            knownSubject !== undefined
                ? Promise.resolve(knownSubject)
                : projectWorkflowService.getSubjectByMaterialRequestId(requestId),
            materialRequestService.listEventsByRequest(requestId),
        ]);

        if (updated) upsertProjectRequest(updated);
        setRequestEventsByRequest(prev => ({ ...prev, [requestId]: eventPage.items }));

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

    const hydrateProjectRequestDetail = useCallback((detail: {
        request: MaterialRequest;
        workflowSubject?: ProjectWorkflowSubject | null;
        runtimeContext?: ProjectWorkflowRuntimeContext | null;
        assignments: WorkflowStepAssignment[];
        fulfillmentBatches: MaterialRequestFulfillmentBatch[];
        events: MaterialRequestEvent[];
    }) => {
        upsertProjectRequest(detail.request);
        setSelectedRequest(prev => prev?.id === detail.request.id ? detail.request : prev);
        if (detail.workflowSubject) {
            setRequestWorkflowSubjects(prev => ({ ...prev, [detail.request.id]: detail.workflowSubject as ProjectWorkflowSubject }));
            setRequestWorkflowAssignments(prev => ({
                ...prev,
                [detail.workflowSubject!.id]: detail.assignments,
            }));
            if (detail.runtimeContext) {
                setRequestWorkflowRuntimeContexts(prev => ({
                    ...prev,
                    [detail.workflowSubject!.id]: detail.runtimeContext as ProjectWorkflowRuntimeContext,
                }));
            }
        }
        setRequestFulfillmentBatches(prev => ({
            ...prev,
            [detail.request.id]: detail.fulfillmentBatches,
        }));
        setRequestFulfillmentSummaries(prev => ({
            ...prev,
            [detail.request.id]: materialRequestFulfillmentService.summarizeRequest(detail.request, detail.fulfillmentBatches),
        }));
        setRequestFulfillmentBatchCounts(prev => ({
            ...prev,
            [detail.request.id]: detail.fulfillmentBatches.length,
        }));
        setRequestEventsByRequest(prev => ({
            ...prev,
            [detail.request.id]: detail.events,
        }));
    }, []);

    const openProjectRequestDetail = useCallback((request: MaterialRequest, initialAction?: 'createFulfillmentBatch') => {
        setSelectedRequest(request);
        setRequestModalInitialAction(initialAction);
        setRequestModalInitialDraft(null);
        setReqModalOpen(true);
        projectWorkflowBoardService.getMaterialRequestDetail(request.id)
            .then(detail => {
                if (detail) hydrateProjectRequestDetail(detail);
            })
            .catch(error => {
                console.warn('Failed to lazy load material request detail:', error);
            });
    }, [hydrateProjectRequestDetail]);

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
            const eventPage = await materialRequestService.listEventsByRequest(updated.id);
            setRequestEventsByRequest(prev => ({ ...prev, [updated.id]: eventPage.items }));
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
            openProjectRequestDetail(request, 'createFulfillmentBatch');
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
                        ? MATERIAL_REQUEST_CONFIRM_PERMISSION
                        : getWorkflowNodePermissionCodes(nextNode.id)[0] || MATERIAL_REQUEST_APPROVE_PERMISSION,
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
                permissionCode: getWorkflowNodePermissionCodes(targetNode?.id)[0] || MATERIAL_REQUEST_APPROVE_PERMISSION,
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
                permissionCode: getWorkflowNodePermissionCodes(context.subject.currentNodeId)[0] || MATERIAL_REQUEST_APPROVE_PERMISSION,
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
                ? { userId: request.requesterId, name: userById.get(request.requesterId)?.name || request.requesterId, permissionCode: MATERIAL_REQUEST_EDIT_OWN_PERMISSION, note }
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
            matchesSearchQueryMultiple([i.name, i.sku], acQuery)
        ).slice(0, 8);
    }, [acQuery, inventoryItems]);

    const selectInventoryItem = (item: InventoryItem) => {
        setBInventoryItemId(item.id);
        setBMaterialCode(item.sku);
        setBName(item.name);
        setBCat(item.category);
        setBUnit(item.unit);
        setBPrice(formatVietnameseMoney(item.priceIn));
        setAcQuery(item.name);
        setAcOpen(false);
    };

    const resetBoqForm = () => {
        setEditingBoq(null); setShowBoqForm(false);
        setBCat('Vật liệu xây dựng'); setBName(''); setBUnit('');
        setBPrice(''); setBThreshold('0,5'); setBBudgetQtyInput(''); setBBudgetQtyManuallyEdited(false); setBNotes('');
        setBInventoryItemId(''); setBMaterialCode(''); setBWorkBoqItemId(''); setAcQuery('');
    };

    const openG8NormModal = (workBoqItemId = '', mappingId = '') => {
        setG8NormInitialWorkBoqItemId(workBoqItemId);
        setG8NormInitialMappingId(mappingId);
        setShowG8NormModal(true);
    };

    const closeG8NormModal = () => {
        setShowG8NormModal(false);
        setG8NormInitialWorkBoqItemId('');
        setG8NormInitialMappingId('');
    };

    const handleG8NormApplied = async () => {
        await loadBoqData();
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
        setBPrice(formatVietnameseMoney(item.budgetUnitPrice));
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

    const materialAggregateSummaryRows = useMemo(
        () => projectMaterialPlanningService.buildAggregateSummary({
            projectId: projectId || null,
            constructionSiteId: constructionSiteId || null,
            siteWarehouseId: defaultSiteWarehouseId,
            tasks,
            workBoqItems,
            materialBudgetItems: computedBoqItems,
            inventoryItems,
            purchaseOrders,
            transactions,
            rules: planningRules,
            curveTemplates: planningCurveTemplates,
            requests,
            requestFulfillmentLineSummaries,
            requestFulfillmentBatchCounts,
        }),
        [
            computedBoqItems,
            constructionSiteId,
            defaultSiteWarehouseId,
            inventoryItems,
            planningCurveTemplates,
            planningRules,
            projectId,
            purchaseOrders,
            requestFulfillmentBatchCounts,
            requestFulfillmentLineSummaries,
            requests,
            tasks,
            transactions,
            workBoqItems,
        ],
    );

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

    const visibleWorkBoqTree = useMemo(() => {
        const visibleIds = new Set<string>();
        return workBoqTree.filter(({ item }) => {
            if (!item.parentId) {
                visibleIds.add(item.id);
                return true;
            }
            if (visibleIds.has(item.parentId) && expandedWorkBoqNodeIds.has(item.parentId)) {
                visibleIds.add(item.id);
                return true;
            }
            return false;
        });
    }, [workBoqTree, expandedWorkBoqNodeIds]);

    const unassignedBoqItems = useMemo(
        () => computedBoqItems.filter(item => !item.workBoqItemId),
        [computedBoqItems]
    );

    const findBoqInventoryItem = useCallback((item: MaterialBudgetItem) => {
        if (item.inventoryItemId && inventoryItemById.has(item.inventoryItemId)) return inventoryItemById.get(item.inventoryItemId);
        if (item.materialCode) {
            const bySku = inventoryItemBySku.get(normalizeKey(item.materialCode));
            if (bySku) return bySku;
        }
        return inventoryItems.find(inventory => normalizeKey(inventory.name) === normalizeKey(item.itemName));
    }, [inventoryItemById, inventoryItemBySku, inventoryItems]);

    const getBoqMaterialRequestStats = useCallback((material: MaterialBudgetItem) => {
        let reservedQty = 0;
        let requestedQty = 0;
        let receivedQty = 0;
        requests.forEach(request => {
            const isCompleted = request.status === RequestStatus.COMPLETED;
            const isHolding = MATERIAL_REQUEST_BUDGET_HOLDING_STATUSES.has(request.status);
            if (!isCompleted && !isHolding) return;
            const summaryByLine = requestFulfillmentLineSummaries[request.id];
            (request.items || []).forEach((line: any, index: number) => {
                const sameBudgetLine = line.materialBudgetItemId && line.materialBudgetItemId === material.id;
                const legacySameItem = !!material.inventoryItemId && !line.materialBudgetItemId && line.itemId === material.inventoryItemId;
                if (!sameBudgetLine && !legacySameItem) return;
                requestedQty += Number(line.requestQty || 0);
                const requestLineId = getRequestLineId(request, line, index);
                const lineSummary = summaryByLine?.get(requestLineId);
                const completedQty = Number(lineSummary?.receivedQty ?? line.receivedQty ?? line.issuedQty ?? line.approvedQty ?? line.requestQty ?? 0);
                if (isCompleted) {
                    reservedQty += completedQty;
                    receivedQty += completedQty;
                } else {
                    reservedQty += Number(line.requestQty || 0);
                    receivedQty += Number(lineSummary?.receivedQty || 0);
                }
            });
        });
        const budgetQty = Number(material.budgetQty || 0);
        const availableQty = budgetQty - reservedQty;
        return {
            budgetQty,
            reservedQty,
            requestedQty,
            receivedQty,
            availableQty,
            requestableQty: Math.max(0, availableQty),
            inventoryItem: findBoqInventoryItem(material),
        };
    }, [findBoqInventoryItem, requestFulfillmentLineSummaries, requests]);

    const getWorkSupplyStatus = useCallback((materials: MaterialBudgetItem[]) => {
        if (materials.length === 0) return { label: 'Chưa kê khai', className: 'bg-slate-100 text-slate-500 border-slate-200' };
        const statsList = materials.map(getBoqMaterialRequestStats);
        const hasOver = materials.some(material => (material.budgetOverPercent || 0) > 0) || statsList.some(stats => stats.availableQty < 0);
        if (hasOver) return { label: 'Vượt', className: 'bg-red-50 text-red-600 border-red-200' };
        const allReceivedEnough = materials.every((material, index) => Number(material.budgetQty || 0) > 0 && statsList[index].receivedQty >= Number(material.budgetQty || 0));
        if (allReceivedEnough) return { label: 'Đủ', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
        const hasSupplyActivity = statsList.some(stats => stats.requestedQty > 0 || stats.receivedQty > 0);
        if (hasSupplyActivity) return { label: 'Đang cung ứng', className: 'bg-amber-50 text-amber-600 border-amber-200' };
        return { label: 'Chưa yêu cầu', className: 'bg-blue-50 text-blue-600 border-blue-200' };
    }, [getBoqMaterialRequestStats]);

    const clearMaterialGroupSelection = useCallback(() => {
        setSelectedMaterialGroupKeys(new Set());
    }, []);

    const handleMaterialRequestSaved = useCallback(() => {
        if (!requestModalInitialDraft) return;
        clearMaterialGroupSelection();
    }, [clearMaterialGroupSelection, requestModalInitialDraft]);

    useEffect(() => {
        const existingRowKeys = new Set(materialAggregateSummaryRows.map(row => row.key));
        setSelectedMaterialGroupKeys(prev => {
            const next = new Set([...prev].filter(key => existingRowKeys.has(key)));
            return next.size === prev.size ? prev : next;
        });
    }, [materialAggregateSummaryRows]);

    const toggleMaterialGroupSelection = useCallback((rowKey: string, checked: boolean) => {
        setSelectedMaterialGroupKeys(prev => {
            const next = new Set(prev);
            if (checked) next.add(rowKey);
            else next.delete(rowKey);
            return next;
        });
    }, []);

    const selectedMaterialGroupRows = useMemo(
        () => materialAggregateSummaryRows.filter(row => selectedMaterialGroupKeys.has(row.key)),
        [materialAggregateSummaryRows, selectedMaterialGroupKeys],
    );

    const createRequestFromSelectedMaterialGroups = useCallback(() => {
        if (!canCreateMaterialRequest) {
            toast.warning('Không có quyền tạo yêu cầu', 'Tài khoản chưa có quyền tạo/gửi đề xuất vật tư trong dự án.');
            return;
        }
        if (selectedMaterialGroupRows.length === 0) {
            toast.warning('Chưa chọn vật tư', 'Vui lòng chọn ít nhất một vật tư trong bảng tổng hợp.');
            return;
        }
        const validRows = selectedMaterialGroupRows.filter(row => row.inventoryItemId);
        const skippedCount = selectedMaterialGroupRows.length - validRows.length;
        if (validRows.length === 0) {
            toast.warning('Chưa có mã kho', 'Các vật tư đã chọn chưa liên kết mã kho nên chưa thể tạo đề xuất.');
            return;
        }
        if (skippedCount > 0) {
            toast.warning('Bỏ qua vật tư thiếu mã kho', `${skippedCount} vật tư chưa liên kết mã kho sẽ không đưa vào phiếu.`);
        }
        const neededDates = validRows.map(row => row.needDate).filter(Boolean).sort() as string[];
        setSelectedRequest(undefined);
        setRequestModalInitialAction(undefined);
        setRequestModalInitialDraft({
            title: 'Đề xuất vật tư ngoài BOQ',
            note: `Tạo từ bảng tổng hợp vật tư theo tổng định mức BOQ (${validRows.length} vật tư).`,
            neededDate: neededDates[0] || undefined,
            lines: validRows.map(row => ({
                itemId: row.inventoryItemId!,
                qty: 0,
                neededDate: row.needDate || neededDates[0] || undefined,
                note: `Từ tổng hợp vật tư: ${row.itemName}`,
                overBudgetReason: AGGREGATE_OUTSIDE_BOQ_REASON,
                materialGroupKey: row.key,
                materialGroupSource: 'summary_aggregate',
                materialGroupSnapshot: {
                    materialGroupKey: row.key,
                    inventoryItemId: row.inventoryItemId || null,
                    materialCodeSnapshot: row.sku || null,
                    itemNameSnapshot: row.itemName,
                    unitSnapshot: row.unit,
                    totalBoqQtySnapshot: row.totalBoqQty,
                    requestedBeforeQtySnapshot: row.cumulativeRequested,
                    remainingBoqQtySnapshot: row.remainingBoqQty,
                    sourceMaterialBudgetItemIds: row.sourceMaterialBudgetItemIds,
                },
            })),
        });
        setActiveSubTab('request');
        setReqModalOpen(true);
    }, [canCreateMaterialRequest, selectedMaterialGroupRows, toast]);

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

    const aggregatedWasteBoqItems = useMemo(
        () => aggregateMaterialWasteRows(computedBoqItems),
        [computedBoqItems],
    );

    const sortedWasteBoqItems = useMemo(
        () => [...aggregatedWasteBoqItems].sort((a, b) => (b.wastePercent || 0) - (a.wastePercent || 0)),
        [aggregatedWasteBoqItems],
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
            warningText: 'Hệ thống cập nhật mã WBS, tên, cấp cha, đơn vị và KL chính theo Tiến độ. Đơn giá, vật tư và ghi chú BOQ được giữ nguyên.',
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
        const budgetUnitPrice = parseVietnameseMoney(bPrice);

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
                const unitPrice = parseVietnameseMoney(pickImportValue(row, ['Đơn giá', 'Đơn giá dự toán']));
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
                const importedUnitPrice = parseVietnameseMoney(pickImportValue(row, ['Đơn giá', 'Đơn giá dự toán']));
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
        const totalBudget = aggregatedWasteBoqItems.reduce((s, b) => s + (b.budgetTotal || 0), 0);
        const totalActual = aggregatedWasteBoqItems.reduce((s, b) => s + (b.actualTotal || 0), 0);
        const overWaste = aggregatedWasteBoqItems.filter(b => (b.wasteQty || 0) > 0);
        const overBudget = aggregatedWasteBoqItems.filter(b => (b.budgetOverPercent || 0) > 0);
        const totalWasteValue = aggregatedWasteBoqItems.reduce((s, b) => s + Math.abs(b.wasteValue || 0), 0);
        const totalRequested = aggregatedWasteBoqItems.reduce((s, b) => s + (b.cumulativeRequested || 0) * (b.budgetUnitPrice || 0), 0);
        const pending = requests.filter(r => r.status === RequestStatus.PENDING).length;
        return { totalBudget, totalActual, diff: totalActual - totalBudget, overWaste: overWaste.length, overBudget: overBudget.length, totalWasteValue, totalRequested, pendingReq: pending, boqCount: computedBoqItems.length };
    }, [aggregatedWasteBoqItems, computedBoqItems.length, requests]);

    // Chart data for waste comparison
    const wasteChartData = useMemo(() => {
        return aggregatedWasteBoqItems.map(b => ({
            name: b.itemName.length > 8 ? b.itemName.slice(0, 8) + '…' : b.itemName,
            'Dự toán': b.budgetQty,
            'Thực tế': b.actualQty,
            waste: b.wastePercent || 0,
            threshold: b.wasteThreshold,
            isOver: (b.wasteQty || 0) > 0,
        }));
    }, [aggregatedWasteBoqItems]);

    const budgetCategoryChartData = useMemo(() => {
        const catMap: Record<string, number> = {};
        computedBoqItems.forEach(item => {
            catMap[item.category] = (catMap[item.category] || 0) + (item.budgetTotal || 0);
        });
        return Object.entries(catMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [computedBoqItems]);

    const topBudgetValueChartData = useMemo(() => {
        return [...computedBoqItems]
            .sort((a, b) => (b.budgetTotal || 0) - (a.budgetTotal || 0))
            .slice(0, 8)
            .map(item => ({
                name: item.itemName.length > 10 ? item.itemName.slice(0, 10) + '…' : item.itemName,
                'Dự toán': (item.budgetTotal || 0) / 1e6,
                'Thực tế': (item.actualTotal || 0) / 1e6,
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
        if (!materialAccess.po.canView || !canCreatePo) {
            toast.warning('Không có quyền tạo PO', 'Bạn cần quyền "project.material_po.create" để tạo PO từ kế hoạch vật tư.');
            return;
        }
        setPlanningDraftPo(draft);
        setPlanningDraftPoKey(prev => prev + 1);
        setActiveSubTab('po');
    }, [canCreatePo, materialAccess.po.canView, toast]);

    const materialTabLabels: Record<ProjectMaterialTabKey, string> = {
        summary: '🔗 Tổng hợp',
        boq: '📋 BOQ',
        planning: '🧭 Kế hoạch',
        request: '📦 Yêu cầu',
        custom: '🧩 Phi tiêu chuẩn',
        po: '🛒 Đơn hàng (PO)',
        waste: '📊 Hao hụt',
        dashboard: '📈 Dashboard',
    };
    const materialTabCounts: Record<ProjectMaterialTabKey, number> = {
        summary: materialAggregateSummaryRows.length,
        boq: workBoqItems.length + computedBoqItems.length,
        planning: 0,
        request: requests.length,
        custom: 0,
        po: 0,
        waste: stats.overWaste,
        dashboard: 0,
    };
    const canManageOpeningBalance = (user.role === Role.ADMIN || isGlobalWarehouseKeeper(user)) && Boolean(project);

    return (
        <div className="space-y-6">
            <MaterialTabHeader
                constructionSiteId={constructionSiteId}
                materialBoqStats={stats}
                totalRequestCount={requests.length}
                visibleMaterialTabs={visibleMaterialTabs}
                activeSubTab={activeSubTab}
                tabLabels={materialTabLabels}
                tabCounts={materialTabCounts}
                formatMoneyShort={fmt}
                onTabChange={setActiveSubTab}
                actions={canManageOpeningBalance ? (
                    <button
                        type="button"
                        onClick={() => setOpeningBalanceOpen(true)}
                        disabled={!constructionSiteId}
                        title={!constructionSiteId ? 'Cần liên kết công trường trước khi nhập đầu kỳ' : 'Nhập dữ liệu đầu kỳ vật tư'}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                        <FileSpreadsheet size={14} /> Nhập đầu kỳ
                    </button>
                ) : null}
            />

            {project && constructionSiteId && (
                <ProjectOpeningBalanceModal
                    open={openingBalanceOpen}
                    project={project}
                    constructionSiteId={constructionSiteId}
                    siteName={siteName}
                    finance={projectFinance}
                    onClose={() => setOpeningBalanceOpen(false)}
                    onApplied={() => { void loadBoqData(); }}
                />
            )}

            {visibleMaterialTabs.length === 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center shadow-sm">
                    <Package size={36} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm font-bold text-slate-500">Tài khoản chưa được cấp quyền xem phần Vật tư</p>
                    <p className="mt-1 text-[10px] text-slate-300">Admin có thể cấp quyền tại DA - Dự án / Vật tư.</p>
                </div>
            )}

            {/* ===== SUMMARY TAB - Bảng tổng hợp 1 dòng ===== */}
            {materialAccess.summary.canView && activeSubTab === 'summary' && (
                <MaterialSummaryTab
                    materialRows={materialAggregateSummaryRows}
                    selectedMaterialGroupKeys={selectedMaterialGroupKeys}
                    canCreateMaterialRequest={canCreateMaterialRequest}
                    onToggleMaterialGroup={toggleMaterialGroupSelection}
                    onCreateRequestFromSelection={createRequestFromSelectedMaterialGroups}
                    onClearSelection={clearMaterialGroupSelection}
                    formatQuantity={formatQuantity}
                    formatPercent={formatPercent}
                    formatMoneyShort={fmt}
                />
            )}

            {/* BOQ Tab */}
            {materialAccess.boq.canView && activeSubTab === 'boq' && (
                <div className="space-y-4">
                    <details className="group border-y border-zinc-200 dark:border-zinc-800">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    <GitBranch size={16} className="text-teal-700 dark:text-teal-400" /> Đối chiếu BOQ hợp đồng tham khảo
                                </h3>
                                <p className="mt-1 text-[10px] font-medium text-zinc-400">Không còn là điều kiện tạo nghiệm thu/thanh toán; mở ra khi cần so sánh BOQ hợp đồng với BOQ triển khai.</p>
                            </div>
                            <ChevronDown size={16} className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
                            <React.Suspense fallback={<LazyPanelFallback label="Đang tải đối chiếu BOQ..." />}>
                                <BoqReconciliationPanel projectId={projectId || null} constructionSiteId={constructionSiteId || null} />
                            </React.Suspense>
                        </div>
                    </details>
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"><ListTree size={16} className="text-teal-700 dark:text-teal-400" /> BOQ khối lượng triển khai theo tiến độ</h3>
                                <p className="text-[10px] text-zinc-400 mt-1">KL dự toán vật tư tự tính bằng KL dự toán đầu mục × Ngưỡng hao hụt.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canEditBoq && (
                                    <button onClick={handleSyncWithSchedule} disabled={syncingBoq}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-400 disabled:opacity-50">
                                        <RefreshCcw size={12} className={syncingBoq ? 'animate-spin' : ''} /> Đồng bộ với tiến độ
                                    </button>
                                )}
                                <button onClick={expandAllWorkBoqNodes}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                                    Mở rộng cây
                                </button>
                                <button onClick={collapseAllWorkBoqNodes}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                                    Thu gọn cây
                                </button>
                                <button onClick={handleDownloadWorkBoqTemplate}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                                    <FileSpreadsheet size={12} /> File mẫu
                                </button>
                                <button onClick={handleExportWorkBoq}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                                    <Download size={12} /> Xuất Excel
                                </button>
                                {canEditBoq && (
                                    <>
                                        <button onClick={() => boqImportRef.current?.click()} disabled={importingBoq}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300 disabled:opacity-50">
                                            <Upload size={12} /> Nhập Excel
                                        </button>
                                        <button onClick={() => { resetBoqForm(); setShowBoqForm(true); }}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-white bg-teal-700 hover:bg-teal-800 shadow-sm">
                                            <Plus size={12} /> Thêm vật tư
                                        </button>
                                        <button onClick={() => openG8NormModal()}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-400">
                                            <BookOpen size={12} /> Thêm định mức
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
                            <div className="space-y-4 p-4 bg-slate-100/60 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-700/40">
                                {visibleWorkBoqTree.map(({ item, level }) => {
                                    const comparison = getWorkComparison(item);
                                    const childMaterials = boqItemsByWork.get(item.id) || [];
                                    const showChildMaterials = expandedWorkBoqMaterialIds.has(item.id);
                                    const isNodeExpanded = expandedWorkBoqNodeIds.has(item.id);
                                    const hasChildren = (workBoqDescendantIdsByParent.get(item.id) || []).length > 0;
                                    const supplyStatus = getWorkSupplyStatus(childMaterials);
                                    const isOrphan = item.syncStatus === 'orphaned';
                                    const isLevel0 = level === 0;
                                    const materialTotal = childMaterials.reduce((sum, material) => sum + Number(material.budgetTotal || 0), 0);

                                    return (
                                        <section
                                            key={item.id}
                                            className={`overflow-hidden rounded-2xl border transition shadow-sm
                                                 ${isOrphan
                                                    ? 'border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/20 dark:border-amber-900/50 dark:bg-amber-950/5'
                                                    : isLevel0
                                                        ? 'border-blue-200 border-l-4 border-l-blue-600 bg-blue-50/50 dark:border-blue-900/40 dark:border-l-blue-500 dark:bg-slate-900/60'
                                                        : level === 1
                                                            ? 'border-indigo-200 border-l-4 border-l-indigo-400 bg-indigo-50/20 dark:border-indigo-950/60 dark:border-l-indigo-500 dark:bg-slate-900/40'
                                                            : 'border-slate-200 border-l-4 border-l-slate-400 bg-slate-50/40 dark:border-slate-800 dark:border-l-slate-600 dark:bg-slate-900/20'
                                                }
                                                 ${level > 0 ? 'ml-4 md:ml-8' : ''}
                                             `}
                                        >
                                            <div className={`
                                                 ${isOrphan
                                                    ? 'bg-amber-50/50 dark:bg-amber-950/20'
                                                    : isLevel0
                                                        ? 'bg-gradient-to-r from-blue-100/80 to-blue-50/30 dark:from-blue-950/60 dark:to-slate-900/40'
                                                        : level === 1
                                                            ? 'bg-gradient-to-r from-indigo-100/60 to-indigo-50/10 dark:from-indigo-950/40 dark:to-slate-900/30'
                                                            : 'bg-gradient-to-r from-slate-100 to-slate-50/20 dark:from-slate-900/60 dark:to-slate-900/20'
                                                } px-4 py-4
                                             `}>
                                                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={showChildMaterials}
                                                                onChange={event => toggleWorkBoqMaterials(item.id, event.target.checked)}
                                                                aria-label={`Hiển thị vật tư của ${item.name}`}
                                                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#2563EB] focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-800"
                                                            />
                                                            {hasChildren ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleWorkBoqNode(item.id)}
                                                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700 transition-colors"
                                                                    title={isNodeExpanded ? 'Thu gọn hạng mục con' : 'Mở rộng hạng mục con'}
                                                                >
                                                                    {isNodeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                                </button>
                                                            ) : (
                                                                <div className="w-5 h-5 shrink-0" />
                                                            )}
                                                            <span className="rounded-lg bg-white px-2 py-1 font-mono text-[11px] font-black text-[#2563EB] shadow-sm dark:bg-slate-800">{item.wbsCode || '-'}</span>
                                                            {isOrphan && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">ORPHAN</span>}
                                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${supplyStatus.className}`}>{supplyStatus.label}</span>
                                                        </div>
                                                        <h4 className="truncate text-base font-black text-[#0F172A] dark:text-white" title={item.name}>{item.name}</h4>
                                                        <p className="mt-1 text-[11px] font-bold text-[#64748B]">BOQ triển khai theo tiến độ • {childMaterials.length} dòng vật tư trực tiếp</p>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:min-w-[620px]">
                                                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
                                                            <div className="text-[9px] font-black uppercase text-[#64748B]">KL chính</div>
                                                            <div className="text-lg font-black text-[#2563EB]">{formatQuantity(Number(item.plannedQty || 0))}</div>
                                                            <div className="text-[10px] font-bold text-[#64748B]">{item.unit || '—'}</div>
                                                        </div>
                                                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
                                                            <div className="text-[9px] font-black uppercase text-[#64748B]">Vật tư</div>
                                                            <div className="text-lg font-black text-[#0F172A] dark:text-white">{childMaterials.length}</div>
                                                            <div className="text-[10px] font-bold text-[#64748B]">Dòng định mức</div>
                                                        </div>
                                                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
                                                            <div className="text-[9px] font-black uppercase text-[#64748B]">GT triển khai</div>
                                                            <div className="text-lg font-black text-[#0F172A] dark:text-white">{fmt(comparison.plannedValue)}</div>
                                                            <div className="text-[10px] font-bold text-[#64748B]">Vật tư {fmt(materialTotal)}</div>
                                                        </div>
                                                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
                                                            <div className="text-[9px] font-black uppercase text-[#64748B]">Hợp đồng</div>
                                                            <div className={`text-lg font-black ${comparison.hasLink ? comparison.valueDiff > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]' : 'text-[#64748B]'}`}>
                                                                {comparison.hasLink ? `${comparison.valueDiff > 0 ? '+' : ''}${fmt(comparison.valueDiff)}` : '—'}
                                                            </div>
                                                            <div className="text-[10px] font-bold text-[#64748B]">{comparison.hasLink ? 'Đã đối chiếu' : 'Chưa link'}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="text-[10px] font-bold text-[#64748B]">
                                                        BOQ là nguồn định mức tham chiếu; tạo đề xuất tại tab Tổng hợp theo mã vật tư.
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {canEditBoq && (
                                                            <>
                                                                <button onClick={() => { resetBoqForm(); setBWorkBoqItemId(item.id); setShowBoqForm(true); }}
                                                                    className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black text-[#2563EB] transition hover:bg-blue-50 dark:bg-slate-800">
                                                                    <Plus size={12} /> Thêm vật tư
                                                                </button>
                                                                <button onClick={() => openG8NormModal(item.id)}
                                                                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-50 dark:bg-slate-800">
                                                                    <BookOpen size={12} /> Thêm định mức
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {showChildMaterials && (
                                                <div className="border-t border-slate-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                                                    {childMaterials.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs font-bold text-[#64748B] dark:border-slate-700 dark:bg-slate-900/40">
                                                            Chưa kê khai vật tư cho đầu mục này
                                                        </div>
                                                    ) : (
                                                        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                                                            <table className="w-full min-w-[900px] text-xs">
                                                                <thead className="sticky top-0 bg-[#0F172A] text-[10px] font-black uppercase tracking-wider text-white">
                                                                    <tr>
                                                                        <th className="px-3 py-3 text-left">Tên vật tư</th>
                                                                        <th className="px-3 py-3 text-right">KL dự toán</th>
                                                                        <th className="px-3 py-3 text-center">ĐVT</th>
                                                                        <th className="px-3 py-3 text-center">Trạng thái</th>
                                                                        <th className="px-3 py-3 text-right">Giá trị</th>
                                                                        <th className="px-3 py-3 text-center">Thao tác</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y-4 divide-slate-50 bg-slate-50 dark:divide-slate-900 dark:bg-slate-900">
                                                                    {childMaterials.map(material => {
                                                                        const materialStats = getBoqMaterialRequestStats(material);
                                                                        const hasInventory = Boolean(materialStats.inventoryItem);
                                                                        const isOver = materialStats.availableQty < 0 || (material.budgetOverPercent || 0) > 0;
                                                                        const isEnough = Number(material.budgetQty || 0) > 0 && materialStats.receivedQty >= Number(material.budgetQty || 0);
                                                                        const lineStatus = !hasInventory
                                                                            ? { label: 'Chưa có mã kho', className: 'bg-red-50 text-[#DC2626] border-red-200' }
                                                                            : isOver
                                                                                ? { label: 'Vượt', className: 'bg-red-50 text-[#DC2626] border-red-200' }
                                                                                : isEnough
                                                                                    ? { label: 'Đủ', className: 'bg-emerald-50 text-[#16A34A] border-emerald-200' }
                                                                                    : materialStats.requestedQty > 0
                                                                                        ? { label: 'Đang cung ứng', className: 'bg-amber-50 text-[#F59E0B] border-amber-200' }
                                                                                        : { label: 'Chưa yêu cầu', className: 'bg-blue-50 text-[#2563EB] border-blue-200' };
                                                                        return (
                                                                            <tr key={material.id} className="bg-white align-middle shadow-sm transition hover:bg-blue-50/30 dark:bg-slate-800 dark:hover:bg-blue-950/20">
                                                                                <td className="px-3 py-3">
                                                                                    <div className="flex min-w-0 items-center gap-2">
                                                                                        <span className="truncate font-black text-[#0F172A] dark:text-white" title={material.itemName}>{material.itemName}</span>
                                                                                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-[#64748B] dark:bg-slate-900">{material.category}</span>
                                                                                    </div>
                                                                                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold text-[#64748B]">
                                                                                        <span>{material.materialCode || materialStats.inventoryItem?.sku || 'Chưa liên kết mã kho'}</span>
                                                                                        {material.sourceType === 'g8_norm' && material.sourceNormCodeSnapshot && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => openG8NormModal(material.workBoqItemId || item.id, material.sourceNormMappingId || '')}
                                                                                                className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-black text-emerald-700 hover:bg-emerald-100"
                                                                                            >
                                                                                                G8 {material.sourceNormCodeSnapshot}
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-3 py-3 text-right font-bold text-[#0F172A] dark:text-slate-200">{formatQuantity(material.budgetQty)}</td>
                                                                                <td className="px-3 py-3 text-center font-bold text-[#64748B]">{material.unit}</td>
                                                                                <td className="px-3 py-3 text-center">
                                                                                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${lineStatus.className}`}>{lineStatus.label}</span>
                                                                                </td>
                                                                                <td className="px-3 py-3 text-right font-bold text-[#0F172A] dark:text-slate-200">{fmt(material.budgetTotal || 0)}</td>
                                                                                <td className="px-3 py-3">
                                                                                    {(canEditBoq || canDeleteBoq) && (
                                                                                        <div className="flex items-center justify-center gap-1">
                                                                                            {canEditBoq && (
                                                                                                <button onClick={() => openEditBoq(material)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-[#2563EB] dark:hover:bg-blue-950/40"><Edit2 size={12} /></button>
                                                                                            )}
                                                                                            {canDeleteBoq && (
                                                                                                <button onClick={() => handleDeleteBoq(material.id, material.itemName)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-[#DC2626] dark:hover:bg-red-950/40"><Trash2 size={12} /></button>
                                                                                            )}
                                                                                        </div>
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
                                        </section>
                                    );
                                })}
                                {unassignedBoqItems.length > 0 && (
                                    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
                                        <div className="mb-3 flex items-center justify-between gap-2">
                                            <div>
                                                <h4 className="text-sm font-black text-amber-800 dark:text-amber-300">Vật tư chưa gắn đầu mục</h4>
                                                <p className="text-[10px] font-bold text-amber-600/80">{unassignedBoqItems.length} dòng cần gắn vào BOQ triển khai để tổng hợp đúng định mức vật tư.</p>
                                            </div>
                                        </div>
                                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                            {unassignedBoqItems.map(material => (
                                                <div key={material.id} className="rounded-xl border border-amber-100 bg-white p-3 shadow-sm dark:border-amber-900/40 dark:bg-slate-800">
                                                    <div className="font-black text-[#0F172A] dark:text-white">{material.itemName}</div>
                                                    <div className="mt-1 text-[11px] font-bold text-[#64748B]">{formatQuantity(material.budgetQty)} {material.unit} • {fmt(material.budgetTotal || 0)}</div>
                                                    {(canEditBoq || canDeleteBoq) && (
                                                        <div className="mt-2 flex gap-1">
                                                            {canEditBoq && <button onClick={() => openEditBoq(material)} className="rounded-lg px-2 py-1 text-[10px] font-black text-[#2563EB] hover:bg-blue-50">Sửa</button>}
                                                            {canDeleteBoq && <button onClick={() => handleDeleteBoq(material.id, material.itemName)} className="rounded-lg px-2 py-1 text-[10px] font-black text-[#DC2626] hover:bg-red-50">Xóa</button>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-[#0F172A] dark:border-slate-700 dark:bg-slate-900/40 dark:text-white md:flex-row md:items-center md:justify-between">
                                    <span>TỔNG CỘNG VẬT TƯ</span>
                                    <span>GT triển khai: <span className="font-black text-[#2563EB]">{fmt(stats.totalBudget)} đ</span></span>
                                    <span>GT thực tế CT: <span className="font-black text-[#16A34A]">{fmt(stats.totalActual)} đ</span></span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {materialAccess.planning.canView && activeSubTab === 'planning' && (
                <React.Suspense fallback={<LazyPanelFallback label="Đang tải kế hoạch vật tư..." />}>
                    <MaterialPlanningPanel
                        projectId={projectId || null}
                        constructionSiteId={constructionSiteId || null}
                        scopeKey={planningScopeKey}
                        siteWarehouseId={defaultSiteWarehouseId}
                        canManage={canEditPlanning}
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
                </React.Suspense>
            )}

            {/* Material Request Tab — using MaterialRequest from Inventory module */}
            {materialAccess.request.canView && activeSubTab === 'request' && (
                <MaterialRequestTab
                    projectId={projectId}
                    constructionSiteId={constructionSiteId}
                    requests={requests}
                    sortedRequests={sortedRequests}
                    canCreateMaterialRequest={canCreateMaterialRequest}
                    transitioningRequestId={transitioningRequestId}
                    workflowTemplates={workflowTemplates}
                    workflowConfiguration={workflowConfiguration}
                    workflowNodes={workflowNodes}
                    workflowRuntimeNodes={requestWorkflowRuntimeNodes}
                    requestWorkflowSubjects={requestWorkflowSubjects}
                    requestFulfillmentSummaries={requestFulfillmentSummaries}
                    requestFulfillmentBatches={requestFulfillmentBatches}
                    requestEventsByRequest={requestEventsByRequest}
                    transactions={transactions}
                    inventoryItemById={inventoryItemById}
                    workBoqItemById={workBoqItemById}
                    userById={userById}
                    users={users}
                    currentUserId={user.id}
                    workflowBoardFilter={workflowBoardFilter}
                    workflowBoardSearch={workflowBoardSearch}
                    hideEmptyWorkflowLanes={hideEmptyWorkflowLanes}
                    onCreateRequest={() => { setSelectedRequest(undefined); setRequestModalInitialAction(undefined); setRequestModalInitialDraft(null); setReqModalOpen(true); }}
                    onConfigurationChange={setWorkflowConfiguration}
                    onWorkflowBoardFilterChange={setWorkflowBoardFilter}
                    onWorkflowBoardSearchChange={setWorkflowBoardSearch}
                    onHideEmptyWorkflowLanesChange={setHideEmptyWorkflowLanes}
                    canMoveMaterialRequest={canMoveMaterialRequest}
                    onMoveMaterialRequest={handleMoveMaterialRequest}
                    onOpenRequest={openProjectRequestDetail}
                />
            )}

            {materialAccess.custom.canView && activeSubTab === 'custom' && (
                <CustomMaterialRequestTab
                    projectId={projectId}
                    constructionSiteId={constructionSiteId}
                    currentUserId={user.id}
                    currentUserName={user.name || user.username}
                    canCreate={canCreateCustomMaterial}
                    canApprove={canApproveCustomMaterial}
                />
            )}

            {materialAccess.po.canView && activeSubTab === 'po' && (
                <React.Suspense fallback={<LazyPanelFallback label="Đang tải đơn hàng PO..." />}>
                    <SupplyChainTab
                        constructionSiteId={constructionSiteId}
                        projectId={projectId}
                        canManageTab={canCreatePo || canApprovePo || canReceivePo || canDeletePo || canManagePoPermission || canCreateDirectPurchase || canEditDirectPurchase || canDeleteDirectPurchase || canRecordDirectPurchaseAp || canCreateSupplierDelivery || canEditSupplierDelivery || canDeleteSupplierDelivery || canRecordSupplierDelivery || canUnrecordSupplierDelivery || canReconcileSupplierDelivery}
                        poCapabilities={{
                            canCreatePo,
                            canApprovePo,
                            canReceivePo,
                            canDeletePo,
                            canManagePo: canManagePoPermission,
                        }}
                        directPurchaseCapabilities={{
                            canViewDirectPurchase,
                            canCreateDirectPurchase,
                            canEditDirectPurchase,
                            canDeleteDirectPurchase,
                            canRecordDirectPurchaseAp,
                        }}
                        supplierDeliveryCapabilities={{
                            canViewSupplierDelivery,
                            canCreateSupplierDelivery,
                            canEditSupplierDelivery,
                            canDeleteSupplierDelivery,
                            canRecordSupplierDelivery,
                            canUnrecordSupplierDelivery,
                            canReconcileSupplierDelivery,
                        }}
                        initialDraftPo={planningDraftPo}
                        initialDraftPoKey={planningDraftPoKey}
                        deepLinkPoId={activePurchaseOrderDeepLinkId}
                        compact
                    />
                </React.Suspense>
            )}

            {/* Waste Comparison Tab */}
            {materialAccess.waste.canView && activeSubTab === 'waste' && (
                <MaterialWasteTab
                    computedBoqItems={computedBoqItems}
                    sortedWasteBoqItems={sortedWasteBoqItems}
                    wasteChartData={wasteChartData}
                    formatQuantity={formatQuantity}
                    formatPercent={formatPercent}
                />
            )}

            {submissionTransition && (
                <React.Suspense fallback={<LazyPanelFallback label="Đang mở hộp thoại chuyển bước..." />}>
                    <ProjectRoomSubmissionDialog
                        title={submissionTransition.title}
                        actionLabel="Chuyển bước"
                        documentLabel="Đề xuất vật tư dự án"
                        documentName={submissionTransition.request.code}
                        documentSubtitle={submissionTransition.subtitle}
                        projectId={projectId || undefined}
                        constructionSiteId={constructionSiteId || null}
                        recipientRoomCode="material_request"
                        recipientAction={submissionTransition.toStep === 'batch_planning' ? 'confirm' : 'approve'}
                        recipientHint={submissionTransition.recipientHint || 'Chỉ hiển thị nhân sự thuộc Room Đề xuất vật tư phù hợp với bước xử lý.'}
                        details={[
                            { label: 'Kho nhận', value: warehouses.find(w => w.id === submissionTransition.request.siteWarehouseId)?.name || submissionTransition.request.siteWarehouseId },
                            { label: 'Số dòng vật tư', value: `${submissionTransition.request.items.length} dòng` },
                            { label: submissionTransition.dynamicWorkflow ? 'Bước kế tiếp' : 'SLA bước mới', value: submissionTransition.dynamicWorkflow ? (submissionTransition.nextNodeLabel || 'Theo mẫu workflow') : (submissionTransition.toStep === 'batch_planning' ? '48h' : '24h') },
                            { label: 'Ghi chú phiếu', value: submissionTransition.request.note || '-' },
                        ]}
                        onCancel={() => setSubmissionTransition(null)}
                        onConfirm={handleSubmitTransitionTarget}
                    />
                </React.Suspense>
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
                <MaterialBoqFormModal
                    editingBoq={editingBoq}
                    workBoqTree={workBoqTree}
                    bWorkBoqItemId={bWorkBoqItemId}
                    onWorkBoqItemChange={handleWorkBoqItemChange}
                    acRef={acRef}
                    acQuery={acQuery}
                    onAcQueryChange={setAcQuery}
                    acOpen={acOpen}
                    onAcOpenChange={setAcOpen}
                    acSuggestions={acSuggestions}
                    onSelectInventoryItem={selectInventoryItem}
                    bInventoryItemId={bInventoryItemId}
                    bName={bName}
                    onBNameChange={setBName}
                    bMaterialCode={bMaterialCode}
                    bCat={bCat}
                    onBCatChange={setBCat}
                    bUnit={bUnit}
                    onBUnitChange={setBUnit}
                    bPrice={bPrice}
                    onBPriceChange={setBPrice}
                    bThreshold={bThreshold}
                    onBThresholdChange={setBThreshold}
                    bBudgetQtyInput={bBudgetQtyInput}
                    onBudgetQtyChange={handleBudgetQtyChange}
                    selectedWorkBoqItem={selectedWorkBoqItem}
                    selectedWorkPlannedQty={selectedWorkPlannedQty}
                    hasValidThreshold={hasValidThreshold}
                    thresholdValue={thresholdValue}
                    autoBudgetQty={autoBudgetQty}
                    bBudgetQty={bBudgetQty}
                    bBudgetQtyManuallyEdited={bBudgetQtyManuallyEdited}
                    onResetBudgetQtyToFormula={resetBudgetQtyToFormula}
                    bNotes={bNotes}
                    onBNotesChange={setBNotes}
                    canSaveBoqItem={canSaveBoqItem}
                    onCancel={resetBoqForm}
                    onSave={handleSaveBoq}
                    formatQuantity={formatQuantity}
                    formatMoneyShort={fmt}
                />
            )}

            {showG8NormModal && (
                <G8NormApplyModal
                    workBoqTree={workBoqTree}
                    initialWorkBoqItemId={g8NormInitialWorkBoqItemId}
                    initialMappingId={g8NormInitialMappingId}
                    inventoryItems={inventoryItems}
                    canEdit={canEditBoq}
                    onClose={closeG8NormModal}
                    onApplied={handleG8NormApplied}
                    formatQuantity={formatQuantity}
                />
            )}

            {/* ===== DASHBOARD TAB ===== */}
            {materialAccess.dashboard.canView && activeSubTab === 'dashboard' && (
                <MaterialDashboardTab
                    computedBoqItems={computedBoqItems}
                    budgetCategoryChartData={budgetCategoryChartData}
                    topBudgetValueChartData={topBudgetValueChartData}
                    formatQuantity={formatQuantity}
                    formatPercent={formatPercent}
                    formatMoneyShort={fmt}
                />
            )}

            {/* Request Modal — Integrated from Inventory Module */}
            {isReqModalOpen && (
                <React.Suspense fallback={
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 backdrop-blur-sm">
                        <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-xl dark:bg-slate-900 dark:text-slate-200">
                            <Loader2 size={16} className="animate-spin text-blue-500" /> Đang mở phiếu...
                        </div>
                    </div>
                }>
                    <RequestModal
                        isOpen={isReqModalOpen}
                        onClose={closeRequestModal}
                        request={selectedRequestLive}
                        defaultSiteWarehouseId={defaultSiteWarehouseId}
                        projectId={projectId || null}
                        constructionSiteId={constructionSiteId || null}
                        requestOrigin="project"
                        workBoqItems={workBoqItems}
                        materialBudgetItems={computedBoqItems}
                        requestFulfillmentSummariesByRequestId={requestFulfillmentSummaries}
                        initialDraft={requestModalInitialDraft}
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
                        canViewAvailableStock={canViewAvailableStock}
                        onProjectWorkflowAction={handleProjectWorkflowActionFromModal}
                        onSaved={handleMaterialRequestSaved}
                        onDeleted={handleRequestDeleted}
                    />
                </React.Suspense>
            )}

            {startWorkflowRequest && (
                <React.Suspense fallback={<LazyPanelFallback label="Đang mở gửi duyệt..." />}>
                    <ProjectWorkflowStartDialog
                        requestId={startWorkflowRequest.id}
                        requestCode={startWorkflowRequest.code}
                        requesterUserId={startWorkflowRequest.requesterId}
                        projectId={startWorkflowRequest.projectId || projectId || null}
                        constructionSiteId={startWorkflowRequest.constructionSiteId || constructionSiteId || null}
                        users={users}
                        employees={employees}
                        orgUnits={orgUnits}
                        recipientRoomCode="material_request"
                        recipientAction="approve"
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
                </React.Suspense>
            )}

            {workflowActionTransition && (
                <React.Suspense fallback={<LazyPanelFallback label="Đang mở xử lý workflow..." />}>
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
                            eligiblePermissionCodes: [MATERIAL_REQUEST_CONFIRM_PERMISSION],
                            recipientAction: 'confirm',
                            assigneeLabel: 'Người phụ trách tạo đợt cấp / đặt mua',
                            helperText: 'Workflow phê duyệt sẽ hoàn thành. Phiếu vật tư chuyển sang Chờ tạo đợt cấp và giao cho người được chọn để cấp hàng hoặc đặt mua.',
                        }}
                        recipientRoomCode="material_request"
                        recipientAction="approve"
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
                </React.Suspense>
            )}

            {importPreview && (
                <MaterialBoqImportPreviewModal
                    importPreview={importPreview}
                    workBoqItems={workBoqItems}
                    importingBoq={importingBoq}
                    canEditBoq={canEditBoq}
                    onCancel={() => setImportPreview(null)}
                    onConfirm={confirmImportWorkBoq}
                    formatQuantity={formatQuantity}
                    formatMoneyShort={fmt}
                />
            )}
        </div>
    );
};

export default MaterialTab;
