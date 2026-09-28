
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { WorkflowAssignmentTarget, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowCustomField, CustomFieldType, WorkflowPrintTemplate, WorkflowInstanceStatus, ProjectWorkflowNodeConfig, Role } from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import {
    appendStep,
    buildAssignmentTargets,
    buildLinearTemplateStructure,
    createStep,
    moveStep as moveStepInDraft,
    moveStepTo,
    orderSteps,
    removeStep as removeStepFromDraft,
} from '../../lib/workflowStepDraft';
import {
    ArrowLeft, Save, Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
    UserCheck, Settings2, X, Layers, FileText, ToggleLeft, ToggleRight,
    Zap, Play, Flag, Clock, Type, AlignLeft, Hash, Calendar, List, Paperclip, Printer, Upload, Download, Eye,
    Check, Table2, Edit
} from 'lucide-react';
import SearchableCheckboxSelect from '../../components/workflow/SearchableCheckboxSelect';
import { canPerform } from '../../lib/permissions/permissionService';
import {
    buildUserNameById,
    describeAssignmentTargets,
    describeStepAssignment as describeStepAssignmentShared,
    getTargetDepartmentIds,
    getTargetUserIds,
} from '../../lib/workflowStepSummary';

const FIELD_TYPE_CONFIG: Record<CustomFieldType, { label: string; icon: any; color: string }> = {
    text: { label: 'Văn bản ngắn', icon: Type, color: 'bg-blue-500' },
    textarea: { label: 'Văn bản dài', icon: AlignLeft, color: 'bg-indigo-500' },
    number: { label: 'Số', icon: Hash, color: 'bg-emerald-500' },
    date: { label: 'Ngày tháng', icon: Calendar, color: 'bg-amber-500' },
    select: { label: 'Danh sách chọn', icon: List, color: 'bg-violet-500' },
    file: { label: 'Tệp đính kèm', icon: Paperclip, color: 'bg-rose-500' },
    table: { label: 'Bảng dữ liệu', icon: Table2, color: 'bg-teal-500' },
};

const WORKFLOW_BUILDER_DRAFT_VERSION = 1;

interface WorkflowBuilderDraft {
    version: number;
    templateId: string;
    savedAt: string;
    localNodes: WorkflowNode[];
    localEdges: WorkflowEdge[];
    customFields: WorkflowCustomField[];
    activeTab?: 'steps' | 'fields' | 'print';
    editingStepId?: string | null;
}

const getWorkflowBuilderDraftKey = (templateId?: string) =>
    templateId ? `vioo_wf_builder_draft_${templateId}` : '';

const readWorkflowBuilderDraft = (templateId?: string): WorkflowBuilderDraft | null => {
    const key = getWorkflowBuilderDraftKey(templateId);
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as WorkflowBuilderDraft;
        if (
            parsed?.version !== WORKFLOW_BUILDER_DRAFT_VERSION ||
            parsed.templateId !== templateId ||
            !Array.isArray(parsed.localNodes) ||
            !Array.isArray(parsed.localEdges) ||
            !Array.isArray(parsed.customFields)
        ) {
            localStorage.removeItem(key);
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn('Cannot read workflow builder draft:', error);
        localStorage.removeItem(key);
        return null;
    }
};

const writeWorkflowBuilderDraft = (draft: WorkflowBuilderDraft) => {
    const key = getWorkflowBuilderDraftKey(draft.templateId);
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(draft));
    } catch (error) {
        console.warn('Cannot save workflow builder draft:', error);
    }
};

const clearWorkflowBuilderDraft = (templateId?: string) => {
    const key = getWorkflowBuilderDraftKey(templateId);
    if (key) localStorage.removeItem(key);
};

interface WorkflowRoleRowProps {
    label: string;
    hint: string;
    userIds: string[];
    users: { id: string; name: string; role?: Role; avatar?: string }[];
    editing: boolean;
    onChange: (values: string[]) => void;
    emptyLabel: string;
}

/**
 * One "vai trò" row of Base's roles panel: label + hint on the left, an avatar
 * cluster on the right, expanding into a picker while the section is in edit mode.
 */
const WorkflowRoleRow: React.FC<WorkflowRoleRowProps> = ({
    label, hint, userIds, users, editing, onChange, emptyLabel,
}) => {
    const selected = userIds
        .map(id => users.find(item => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return (
        <div className="px-5 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>{label}</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>{hint}</p>
                </div>
                {selected.length === 0 ? (
                    <span className="shrink-0 text-[13px]" style={{ color: 'var(--wf-text-faint)' }}>
                        {emptyLabel}
                    </span>
                ) : (
                    <div className="flex shrink-0 items-center gap-2">
                        <div className="flex -space-x-1.5">
                            {selected.slice(0, 5).map(item => (
                                <span
                                    key={item.id}
                                    title={item.name}
                                    className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 text-[9px] font-bold uppercase text-white"
                                    style={{
                                        borderColor: 'var(--wf-surface)',
                                        backgroundColor: 'var(--wf-green-dark)',
                                    }}
                                >
                                    {item.avatar
                                        ? <img src={item.avatar} alt={item.name} className="h-full w-full object-cover" />
                                        : item.name.slice(0, 2)}
                                </span>
                            ))}
                        </div>
                        <span className="text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                            {selected.length} người
                        </span>
                    </div>
                )}
            </div>

            {editing && (
                <div className="mt-3">
                    <SearchableCheckboxSelect
                        options={users.map(item => ({ id: item.id, label: item.name, sublabel: item.role }))}
                        selectedValues={userIds}
                        onChange={onChange}
                        placeholder={`Tìm kiếm cho "${label}"...`}
                        maxHeightClass="h-32"
                    />
                </div>
            )}
        </div>
    );
};

const WorkflowBuilder: React.FC = () => {
    const { id: templateId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { templates, instances, getTemplateNodes, getTemplateEdges, updateTemplate, uploadPrintTemplate, deletePrintTemplate, getPrintTemplates, refreshData } = useWorkflow();
    const { users, orgUnits, user, loadModuleData, moduleLoadState, moduleLoadErrors } = useApp();

    const template = templates.find(t => t.id === templateId);
    const canConfigureTemplate = user.role === Role.ADMIN
        || canPerform(user, 'workflow.template.edit', { scopeType: 'global', scopeId: '*' });

    const [activeTab, setActiveTab] = useState<'steps' | 'fields' | 'print'>('steps');
    // Base keeps the roles block read-only until you hit "Chỉnh sửa".
    const [rolesEditing, setRolesEditing] = useState(false);
    const [localNodes, setLocalNodes] = useState<WorkflowNode[]>([]);
    const [localEdges, setLocalEdges] = useState<WorkflowEdge[]>([]);
    const [customFields, setCustomFields] = useState<WorkflowCustomField[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [editingStepId, setEditingStepId] = useState<string | null>(null);
    const [stepConfigTabs, setStepConfigTabs] = useState<Record<string, 'info' | 'assignee' | 'watchers' | 'actions'>>({});
    const lastPeopleReloadKeyRef = useRef('');

    // Drag and drop state for steps
    const [dragStepId, setDragStepId] = useState<string | null>(null);
    const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);
    // Drag and drop state for custom fields
    const [dragFieldId, setDragFieldId] = useState<string | null>(null);
    const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null);

    // Custom field form state
    const [showAddField, setShowAddField] = useState(false);
    const [newFieldLabel, setNewFieldLabel] = useState('');
    const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
    const [newFieldRequired, setNewFieldRequired] = useState(false);
    const [newFieldOptions, setNewFieldOptions] = useState('');
    const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
    const [isMaterialRequestDefault, setIsMaterialRequestDefault] = useState(false);
    const [bindingSaving, setBindingSaving] = useState(false);
    const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
    const [serverRefreshSkippedAt, setServerRefreshSkippedAt] = useState<string | null>(null);
    const hydratedTemplateIdRef = useRef<string | null>(null);
    const lastSavedDraftSignatureRef = useRef('');
    const lastTemplatesRef = useRef<unknown>(null);

    useEffect(() => {
        const hasActiveOverlay = showAddField || !!editingFieldId;
        if (hasActiveOverlay) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [showAddField, editingFieldId]);

    useEffect(() => {
        if (!templateId) return;

        const templatesChanged = lastTemplatesRef.current !== templates;
        lastTemplatesRef.current = templates;
        const isNewTemplate = hydratedTemplateIdRef.current !== templateId;
        if (isNewTemplate) {
            const draft = readWorkflowBuilderDraft(templateId);
            hydratedTemplateIdRef.current = templateId;
            lastSavedDraftSignatureRef.current = '';
            setServerRefreshSkippedAt(null);
            if (draft) {
                setLocalNodes(draft.localNodes);
                setLocalEdges(draft.localEdges);
                setCustomFields(draft.customFields);
                if (draft.activeTab) setActiveTab(draft.activeTab);
                setEditingStepId(draft.editingStepId || null);
                setDraftRestoredAt(draft.savedAt);
                setHasChanges(true);
                return;
            }
            setEditingStepId(null);
        }

        if (hasChanges && !isNewTemplate) {
            if (templatesChanged) setServerRefreshSkippedAt(new Date().toISOString());
            return;
        }

        const tNodes = getTemplateNodes(templateId);
        setLocalNodes(tNodes);
        setLocalEdges(getTemplateEdges(templateId));
        setCustomFields(template?.customFields || []);
        setDraftRestoredAt(null);
        if (isNewTemplate) setHasChanges(false);
    }, [hasChanges, templateId, templates]);

    useEffect(() => {
        if (!templateId || !hasChanges) return;
        const draft: WorkflowBuilderDraft = {
            version: WORKFLOW_BUILDER_DRAFT_VERSION,
            templateId,
            savedAt: new Date().toISOString(),
            localNodes,
            localEdges,
            customFields,
            activeTab,
            editingStepId,
        };
        const signature = JSON.stringify(draft);
        if (signature === lastSavedDraftSignatureRef.current) return;
        lastSavedDraftSignatureRef.current = signature;
        writeWorkflowBuilderDraft(draft);
        setDraftRestoredAt(draft.savedAt);
    }, [activeTab, customFields, editingStepId, hasChanges, localEdges, localNodes, templateId]);

    useEffect(() => {
        if (!hasChanges) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasChanges]);

    const selectedWorkflowUserIds = useMemo(() => {
        const ids = new Set<string>();
        template?.managers?.forEach(id => ids.add(id));
        template?.defaultWatchers?.forEach(id => ids.add(id));
        localNodes.forEach(node => {
            if (node.config?.assigneeUserId) ids.add(node.config.assigneeUserId);
            (node.config?.assignmentTargets || []).forEach((target: WorkflowAssignmentTarget) => {
                if (target.type === 'user' && target.userId) ids.add(target.userId);
            });
            (node.config?.stepWatcherTargets || []).forEach((target: WorkflowAssignmentTarget) => {
                if (target.type === 'user' && target.userId) ids.add(target.userId);
            });
        });
        return Array.from(ids).filter(Boolean);
    }, [localNodes, template?.defaultWatchers, template?.managers]);

    const missingSelectedUserIds = useMemo(() => {
        const loadedUserIds = new Set(users.map(item => item.id));
        return selectedWorkflowUserIds.filter(id => !loadedUserIds.has(id));
    }, [selectedWorkflowUserIds, users]);

    const peopleHydrationStale = users.length <= 1 || missingSelectedUserIds.length > 0;
    const peopleHydrationLoading = moduleLoadState['workflow-people'] === 'loading';
    const peopleHydrationError = moduleLoadErrors['workflow-people'] || null;

    useEffect(() => {
        if (!templateId || !peopleHydrationStale || peopleHydrationLoading) return;
        const reloadKey = `${users.length <= 1 ? 'few-users' : ''}|${[...missingSelectedUserIds].sort().join('|')}`;
        if (lastPeopleReloadKeyRef.current === reloadKey) return;
        lastPeopleReloadKeyRef.current = reloadKey;
        loadModuleData('workflow-people', true).catch(error => {
            console.warn('Workflow people reload failed:', error);
        });
    }, [loadModuleData, missingSelectedUserIds, orgUnits.length, peopleHydrationLoading, peopleHydrationStale, templateId, users.length]);

    const retryPeopleHydration = () => {
        lastPeopleReloadKeyRef.current = '';
        loadModuleData('workflow-people', true).catch(error => {
            console.warn('Workflow people retry failed:', error);
        });
    };

    const reloadSavedTemplateState = () => {
        if (!templateId) return;
        setLocalNodes(getTemplateNodes(templateId));
        setLocalEdges(getTemplateEdges(templateId));
        setCustomFields(template?.customFields || []);
        setEditingStepId(null);
        setHasChanges(false);
        setDraftRestoredAt(null);
        setServerRefreshSkippedAt(null);
        clearWorkflowBuilderDraft(templateId);
        lastSavedDraftSignatureRef.current = '';
    };

    const discardDraft = () => {
        if (hasChanges && !window.confirm('Bỏ toàn bộ thay đổi chưa lưu và tải lại dữ liệu đã lưu trên server?')) return;
        reloadSavedTemplateState();
    };

    const goBackToTemplates = () => {
        if (hasChanges && !window.confirm('Quy trình đang có thay đổi chưa lưu. Bản nháp vẫn được giữ trên máy này nếu anh rời trang. Tiếp tục quay lại?')) return;
        navigate('/wf/templates');
    };

    useEffect(() => {
        let alive = true;
        if (!templateId) return;
        projectWorkflowService.resolveBinding('material_request', null, null)
            .then(binding => {
                if (alive) setIsMaterialRequestDefault(binding?.workflowTemplateId === templateId);
            })
            .catch(() => {
                if (alive) setIsMaterialRequestDefault(false);
            });
        return () => { alive = false; };
    }, [templateId]);

    const generateId = () => crypto.randomUUID();

    const toggleMaterialRequestDefaultBinding = async () => {
        if (!templateId) return;
        setBindingSaving(true);
        try {
            if (!isMaterialRequestDefault) {
                await projectWorkflowService.setBinding({
                    subjectType: 'material_request',
                    workflowTemplateId: templateId,
                    projectId: null,
                    constructionSiteId: null,
                });
                setIsMaterialRequestDefault(true);
            } else {
                await projectWorkflowService.removeBinding({
                    subjectType: 'material_request',
                    projectId: null,
                    constructionSiteId: null,
                });
                setIsMaterialRequestDefault(false);
            }
        } catch (error) {
            console.error('Cannot update material request workflow binding:', error);
            throw error;
        } finally {
            setBindingSaving(false);
        }
    };

    // ========== STEPS (NODES) MANAGEMENT ==========

    // Get ordered steps (excluding START and END, which are auto-managed)
    const getOrderedSteps = (): WorkflowNode[] => orderSteps(localNodes);

    const addStep = () => {
        if (!canConfigureTemplate) return;
        const newNode = createStep({ id: generateId(), templateId: templateId!, existingSteps: getOrderedSteps().length });
        setLocalNodes(prev => appendStep(prev, newNode));
        setHasChanges(true);
        setEditingStepId(newNode.id);
    };

    const removeStep = (nodeId: string) => {
        if (!canConfigureTemplate) return;
        setLocalNodes(prev => removeStepFromDraft(prev, nodeId));
        setLocalEdges(prev => prev.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
        if (editingStepId === nodeId) setEditingStepId(null);
        setHasChanges(true);
    };

    const updateStepLabel = (nodeId: string, label: string) => {
        if (!canConfigureTemplate) return;
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n));
        setHasChanges(true);
    };

    const updateStepConfig = (nodeId: string, key: string, value: any) => {
        if (!canConfigureTemplate) return;
        setLocalNodes(prev => prev.map(n => {
            if (n.id !== nodeId) return n;
            return { ...n, config: { ...n.config, [key]: value === '' ? undefined : value } };
        }));
        setHasChanges(true);
    };

    const selectedOptions = (event: React.ChangeEvent<HTMLSelectElement>) =>
        Array.from(event.target.selectedOptions).map(option => option.value).filter(Boolean);

    const updateStepTargets = (
        nodeId: string,
        key: 'assignmentTargets' | 'stepWatcherTargets',
        userIds: string[],
        departmentIds: string[],
    ) => {
        updateStepConfig(nodeId, key, buildAssignmentTargets(userIds, departmentIds));
    };

    const updateTemplateUserList = async (key: 'managers' | 'defaultWatchers', userIds: string[]) => {
        if (!template || !canConfigureTemplate) return;
        await updateTemplate({ ...template, [key]: userIds });
    };

    const updateStepType = (nodeId: string, type: WorkflowNodeType) => {
        if (!canConfigureTemplate) return;
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, type } : n));
        setHasChanges(true);
    };

    const moveStep = (nodeId: string, direction: 'up' | 'down') => {
        if (!canConfigureTemplate) return;
        const steps = getOrderedSteps();
        const idx = steps.findIndex(s => s.id === nodeId);
        if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= steps.length - 1)) return;
        setLocalNodes(prev => moveStepInDraft(prev, nodeId, direction));
        setHasChanges(true);
    };

    // Drag and drop handlers for steps
    const handleStepDragStart = (e: React.DragEvent, stepId: string) => {
        setDragStepId(stepId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', stepId);
    };

    const handleStepDragOver = (e: React.DragEvent, stepId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragStepId && stepId !== dragStepId) {
            setDragOverStepId(stepId);
        }
    };

    const handleStepDrop = (e: React.DragEvent, targetStepId: string) => {
        e.preventDefault();
        if (!dragStepId || dragStepId === targetStepId) {
            setDragStepId(null);
            setDragOverStepId(null);
            return;
        }
        const steps = getOrderedSteps();
        const fromIdx = steps.findIndex(s => s.id === dragStepId);
        const toIdx = steps.findIndex(s => s.id === targetStepId);
        if (fromIdx === -1 || toIdx === -1) return;
        setLocalNodes(prev => moveStepTo(prev, dragStepId, toIdx));
        setHasChanges(true);
        setDragStepId(null);
        setDragOverStepId(null);
    };

    const handleStepDragEnd = () => {
        setDragStepId(null);
        setDragOverStepId(null);
    };

    // Drag and drop handlers for custom fields
    const handleFieldDragStart = (e: React.DragEvent, fieldId: string) => {
        setDragFieldId(fieldId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', fieldId);
    };

    const handleFieldDragOver = (e: React.DragEvent, fieldId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragFieldId && fieldId !== dragFieldId) {
            setDragOverFieldId(fieldId);
        }
    };

    const handleFieldDrop = (e: React.DragEvent, targetFieldId: string) => {
        e.preventDefault();
        if (!dragFieldId || dragFieldId === targetFieldId) {
            setDragFieldId(null);
            setDragOverFieldId(null);
            return;
        }
        setCustomFields(prev => {
            const fromIdx = prev.findIndex(f => f.id === dragFieldId);
            const toIdx = prev.findIndex(f => f.id === targetFieldId);
            if (fromIdx === -1 || toIdx === -1) return prev;
            const reordered = [...prev];
            const [moved] = reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, moved);
            return reordered;
        });
        setHasChanges(true);
        setDragFieldId(null);
        setDragOverFieldId(null);
    };

    const handleFieldDragEnd = () => {
        setDragFieldId(null);
        setDragOverFieldId(null);
    };

    // ========== CUSTOM FIELDS MANAGEMENT ==========

    const resetFieldForm = () => {
        setNewFieldLabel('');
        setNewFieldType('text');
        setNewFieldRequired(false);
        setNewFieldOptions('');
        setEditingFieldId(null);
        setShowAddField(false);
    };

    const startEditCustomField = (field: WorkflowCustomField) => {
        if (!canConfigureTemplate) return;
        setEditingFieldId(field.id);
        setNewFieldLabel(field.label);
        setNewFieldType(field.type);
        setNewFieldRequired(field.required);
        setNewFieldOptions(field.options ? field.options.join(', ') : '');
        setShowAddField(true);
    };

    const addCustomField = () => {
        if (!canConfigureTemplate) return;
        if (!newFieldLabel.trim()) return;

        if (editingFieldId) {
            setCustomFields(prev => prev.map(f => {
                if (f.id === editingFieldId) {
                    return {
                        ...f,
                        label: newFieldLabel.trim(),
                        type: newFieldType,
                        required: newFieldRequired,
                        options: (newFieldType === 'select' || newFieldType === 'table') ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
                    };
                }
                return f;
            }));
            setEditingFieldId(null);
        } else {
            const field: WorkflowCustomField = {
                id: generateId(),
                name: newFieldLabel.trim().toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '_').replace(/_+/g, '_'),
                label: newFieldLabel.trim(),
                type: newFieldType,
                required: newFieldRequired,
                options: (newFieldType === 'select' || newFieldType === 'table') ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
                placeholder: '',
            };
            setCustomFields(prev => [...prev, field]);
        }

        setNewFieldLabel('');
        setNewFieldType('text');
        setNewFieldRequired(false);
        setNewFieldOptions('');
        setShowAddField(false);
        setHasChanges(true);
    };

    const removeCustomField = (fieldId: string) => {
        if (!canConfigureTemplate) return;
        setCustomFields(prev => prev.filter(f => f.id !== fieldId));
        setHasChanges(true);
    };

    const toggleFieldRequired = (fieldId: string) => {
        if (!canConfigureTemplate) return;
        setCustomFields(prev => prev.map(f => f.id === fieldId ? { ...f, required: !f.required } : f));
        setHasChanges(true);
    };

    const moveField = (fieldId: string, direction: 'up' | 'down') => {
        if (!canConfigureTemplate) return;
        setCustomFields(prev => {
            const idx = prev.findIndex(f => f.id === fieldId);
            if ((direction === 'up' && idx <= 0) || (direction === 'down' && idx >= prev.length - 1)) return prev;
            const next = [...prev];
            const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
            [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
            return next;
        });
        setHasChanges(true);
    };

    // ========== BASE-STYLE CONFIG OVERVIEW ==========

    // Live task count per stage, so the stage list reads like Base's
    // "<SLA> Giờ · N Công việc" instead of a static outline.
    const stageTaskCounts = useMemo(() => {
        const counts = new Map<string, number>();
        instances
            .filter(instance => instance.templateId === templateId
                && instance.status === WorkflowInstanceStatus.RUNNING)
            .forEach(instance => {
                if (!instance.currentNodeId) return;
                counts.set(instance.currentNodeId, (counts.get(instance.currentNodeId) || 0) + 1);
            });
        return counts;
    }, [instances, templateId]);

    const terminalStageCounts = useMemo(() => {
        let done = 0;
        let failed = 0;
        instances
            .filter(instance => instance.templateId === templateId)
            .forEach(instance => {
                if (instance.status === WorkflowInstanceStatus.COMPLETED) done += 1;
                if (instance.status === WorkflowInstanceStatus.REJECTED) failed += 1;
            });
        return { done, failed };
    }, [instances, templateId]);

    const userNameById = useMemo(() => buildUserNameById(users), [users]);

    const stepSummaryLookups = useMemo(
        () => ({ userNameById, orgUnits }),
        [orgUnits, userNameById],
    );

    const describeTargets = (targets?: WorkflowAssignmentTarget[]) =>
        describeAssignmentTargets(targets, stepSummaryLookups);

    const describeStepAssignment = (config: ProjectWorkflowNodeConfig): string =>
        describeStepAssignmentShared(config, stepSummaryLookups);

    // Base's "Tùy chỉnh quy trình" grid. Every row reports what this workflow
    // actually does today — derived from step config, never a decorative toggle
    // that has nothing behind it.
    const workflowSettingSummary = useMemo(() => {
        const steps = localNodes
            .filter(node => node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END)
            .sort((a, b) => a.positionY - b.positionY);
        const stepCount = steps.length || 1;

        const withSla = steps.filter(step => step.config.slaHours).length;
        const poolSteps = steps.filter(step =>
            (step.config.assignmentTargets || []).length > 0
            || step.config.assignmentMode === 'permission_pool'
        ).length;
        const multiSteps = steps.filter(step => step.config.assigneeSelectionMode === 'multiple').length;
        const rejectSteps = steps.filter(step => step.config.allowReject !== false).length;
        const reassignSteps = steps.filter(step => step.config.allowReassign !== false).length;
        const stepWatcherSteps = steps.filter(step => (step.config.stepWatcherTargets || []).length > 0).length;
        const requiredFieldCount = customFields.filter(field => field.required).length;

        return [
            {
                label: 'Ghi chú những việc đã hoàn thành',
                value: 'Không bắt buộc',
                hint: 'Ô ghi chú luôn hiện khi chuyển giai đoạn nhưng có thể để trống.',
            },
            {
                label: 'Chữ ký điện tử',
                value: 'Không cho phép',
                hint: 'Chưa hỗ trợ trong module Quy trình.',
            },
            {
                label: 'Cách gán người xử lý từng giai đoạn',
                value: poolSteps > 0
                    ? `${poolSteps}/${stepCount} giai đoạn dùng pool`
                    : 'Chỉ định trực tiếp từng người',
                hint: poolSteps > 0
                    ? 'Với pool (nhóm/phòng ban), chỉ cần một người trong pool chuyển giai đoạn là đủ.'
                    : 'Mở tab "Người xử lý" của từng giai đoạn để thêm pool nhóm hoặc phòng ban.',
            },
            {
                label: 'Cho phép chọn nhiều người cho một giai đoạn',
                value: multiSteps > 0 ? `${multiSteps}/${stepCount} giai đoạn` : 'Không',
                hint: 'Duyệt đồng thời: một người trong danh sách duyệt là giai đoạn đi tiếp.',
            },
            {
                label: 'Người theo dõi riêng theo giai đoạn',
                value: stepWatcherSteps > 0 ? `${stepWatcherSteps}/${stepCount} giai đoạn` : 'Không',
                hint: 'Ngoài người giám sát toàn quy trình, mỗi giai đoạn có thể có người theo dõi riêng.',
            },
            {
                label: 'Cho phép người xử lý trả nhiệm vụ về giai đoạn trước',
                value: rejectSteps > 0 ? `${rejectSteps}/${stepCount} giai đoạn` : 'Không',
                hint: 'Kéo card sang cột liền trước, hoặc dùng nút Trả lại trong chi tiết nhiệm vụ.',
            },
            {
                label: 'Cho phép gán lại người xử lý',
                value: reassignSteps > 0 ? `${reassignSteps}/${stepCount} giai đoạn` : 'Không',
                hint: 'Khi chuyển giai đoạn, người xử lý chọn lại người nhận ở giai đoạn kế tiếp.',
            },
            {
                label: 'Thời hạn xử lý (SLA)',
                value: withSla > 0 ? `${withSla}/${stepCount} giai đoạn có SLA` : 'Chưa đặt',
                hint: 'Quá hạn được đánh dấu bằng viền đỏ và badge trên bảng Kanban.',
            },
            {
                label: 'Trường dữ liệu bắt buộc khi tạo nhiệm vụ',
                value: requiredFieldCount > 0
                    ? `${requiredFieldCount}/${customFields.length} trường`
                    : 'Không có',
                hint: 'Cấu hình ở tab "Trường tùy chỉnh".',
            },
            {
                label: 'Chặn cập nhật khi nhiệm vụ đã Hoàn thành hoặc Thất bại',
                value: 'Có',
                hint: 'Chỉ người có quyền mở lại nhiệm vụ mới đưa được card về một giai đoạn xử lý.',
            },
        ];
    }, [customFields, localNodes]);

    // ========== SAVE ==========

    const handleSave = async () => {
        if (!templateId || !template || !canConfigureTemplate) return;
        setIsSaving(true);
        try {
            const { nodes: nodesToSave, edges: edgesToSave } = buildLinearTemplateStructure(templateId, localNodes, generateId);
            await projectWorkflowService.saveTemplateStructure({
                template: { ...template, customFields },
                nodes: nodesToSave,
                edges: edgesToSave,
            });
            setLocalNodes(nodesToSave);
            setLocalEdges(edgesToSave);
            await refreshData();
            clearWorkflowBuilderDraft(templateId);
            lastSavedDraftSignatureRef.current = '';
            setDraftRestoredAt(null);
            setServerRefreshSkippedAt(null);
            setHasChanges(false);
        } finally {
            setIsSaving(false);
        }
    };

    if (!template) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <Layers size={48} className="mb-4 opacity-20" />
                <h2 className="text-xl font-black">Không tìm thấy quy trình</h2>
                <button onClick={() => navigate('/wf/templates')} className="mt-4 text-accent hover:underline font-bold text-sm">← Quay lại</button>
            </div>
        );
    }

    const orderedSteps = getOrderedSteps();

    return (
        <div className="wf-base flex w-full items-start gap-4">
            {/* ===== Stage sidebar (Base: numbered stages + terminal outcomes) ===== */}
            <aside
                className="wf-surface sticky top-0 hidden w-[264px] shrink-0 flex-col self-start rounded-lg border lg:flex"
                style={{ borderColor: 'var(--wf-border)' }}
            >
                <button
                    onClick={goBackToTemplates}
                    className="flex items-center gap-2 border-b px-4 py-3 text-[13px] font-medium transition hover:underline"
                    style={{ borderColor: 'var(--wf-border)', color: 'var(--wf-text-muted)' }}
                >
                    <ArrowLeft size={15} /> Quay lại
                </button>

                <div className="border-b px-4 py-3" style={{ borderColor: 'var(--wf-border)' }}>
                    <p
                        className="text-[14px] font-semibold leading-snug"
                        style={{ color: 'var(--wf-text)' }}
                        title={template.name}
                    >
                        {template.name}
                    </p>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                        {orderedSteps.length} giai đoạn
                    </p>
                </div>

                <div className="wf-scroll max-h-[calc(100vh-280px)] overflow-y-auto py-2">
                    <p
                        className="px-4 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--wf-text-faint)' }}
                    >
                        Giai đoạn
                    </p>
                    {orderedSteps.length === 0 && (
                        <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                            Chưa có giai đoạn nào.
                        </p>
                    )}
                    {orderedSteps.map((step, idx) => {
                        const isActive = editingStepId === step.id;
                        const taskCount = stageTaskCounts.get(step.id) || 0;
                        return (
                            <button
                                key={step.id}
                                onClick={() => {
                                    setActiveTab('steps');
                                    setEditingStepId(isActive ? null : step.id);
                                }}
                                className="flex w-full items-start gap-2.5 px-4 py-2 text-left transition"
                                style={{
                                    backgroundColor: isActive ? 'var(--wf-green-soft)' : 'transparent',
                                }}
                            >
                                <span
                                    className="mt-0.5 shrink-0 text-[12px] font-semibold tabular-nums"
                                    style={{ color: isActive ? 'var(--wf-green-text)' : 'var(--wf-text-faint)' }}
                                >
                                    {String(idx + 1).padStart(2, '0')}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span
                                        className="block truncate text-[13px] font-medium"
                                        style={{ color: isActive ? 'var(--wf-green-text)' : 'var(--wf-text)' }}
                                        title={step.label}
                                    >
                                        {step.label}
                                    </span>
                                    <span className="block text-[11px]" style={{ color: 'var(--wf-text-faint)' }}>
                                        {step.config.slaHours ? `${step.config.slaHours.toFixed(2)} Giờ` : 'Không đặt SLA'}
                                        {' · '}
                                        {taskCount > 0 ? `${taskCount} Công việc` : 'Không có công việc'}
                                    </span>
                                </span>
                            </button>
                        );
                    })}

                    {/* Terminal outcomes — Base pins these below the stage list */}
                    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--wf-border)' }}>
                        <div className="flex items-start gap-2.5 px-4 py-2">
                            <span
                                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
                                style={{ backgroundColor: 'var(--wf-green)' }}
                            >
                                <Check size={10} className="stroke-[3]" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>
                                    Done
                                </span>
                                <span className="block text-[11px]" style={{ color: 'var(--wf-text-faint)' }}>
                                    Hoàn thành tất cả các giai đoạn
                                    {terminalStageCounts.done > 0 && ` · ${terminalStageCounts.done} Công việc`}
                                </span>
                            </span>
                        </div>
                        <div className="flex items-start gap-2.5 px-4 py-2">
                            <span
                                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
                                style={{ backgroundColor: 'var(--wf-overdue)' }}
                            >
                                <X size={10} className="stroke-[3]" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>
                                    Failed
                                </span>
                                <span className="block text-[11px]" style={{ color: 'var(--wf-text-faint)' }}>
                                    Thất bại ở một giai đoạn bất kì
                                    {terminalStageCounts.failed > 0 && ` · ${terminalStageCounts.failed} Công việc`}
                                </span>
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ===== Main panel ===== */}
            <div className="min-w-0 flex-1 space-y-4">
            {/* Top Bar */}
            <div
                className="wf-surface flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                style={{ borderColor: 'var(--wf-border)' }}
            >
                <div className="flex min-w-0 items-center gap-3">
                    <button
                        onClick={goBackToTemplates}
                        className="rounded-lg p-2 transition hover:bg-slate-100 dark:hover:bg-slate-700 lg:hidden"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="truncate text-[17px] font-semibold" style={{ color: 'var(--wf-text)' }}>
                            {template.name}
                        </h1>
                        <p className="truncate text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                            {template.description || 'Chưa có mô tả'} • Thay đổi chỉ áp dụng cho nhiệm vụ tạo mới
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {canConfigureTemplate && <button
                        onClick={toggleMaterialRequestDefaultBinding}
                        disabled={bindingSaving}
                        className={`flex items-center px-4 py-2.5 rounded-xl text-xs font-black border transition disabled:opacity-50 ${
                            isMaterialRequestDefault
                                ? 'border-purple-200 bg-purple-50 text-purple-700'
                                : 'border-slate-200 bg-white/70 text-slate-500 hover:bg-slate-50'
                        }`}
                    >
                        <Zap size={14} className="mr-1.5" />
                        {bindingSaving ? 'Đang lưu...' : isMaterialRequestDefault ? 'Mặc định phiếu vật tư' : 'Gán cho phiếu vật tư'}
                    </button>}
                    {hasChanges && (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg animate-pulse">
                            • Chưa lưu
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges || !canConfigureTemplate}
                        className="flex items-center px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                    >
                        <Save size={15} className="mr-2" /> {isSaving ? 'Đang lưu...' : 'Lưu'}
                    </button>
                </div>
            </div>

            {hasChanges && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            Đang giữ bản nháp chưa lưu trên máy này.
                            {draftRestoredAt && (
                                <span className="ml-1 font-semibold opacity-80">
                                    Lưu nháp lúc {new Date(draftRestoredAt).toLocaleTimeString('vi-VN')}.
                                </span>
                            )}
                            {serverRefreshSkippedAt && (
                                <span className="ml-1 font-semibold opacity-80">
                                    Dữ liệu server vừa refresh nhưng không ghi đè bản đang sửa.
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={discardDraft}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-amber-700 shadow-sm hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                        >
                            Bỏ bản nháp
                        </button>
                    </div>
                </div>
            )}

            {(peopleHydrationLoading || peopleHydrationError || peopleHydrationStale) && (
                <div className={`rounded-xl border px-4 py-3 text-xs font-bold ${
                    peopleHydrationError
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-indigo-100 bg-indigo-50 text-indigo-700'
                }`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            {peopleHydrationLoading
                                ? 'Đang đồng bộ danh sách người dùng và phòng ban...'
                                : peopleHydrationError
                                    ? `Không tải được danh sách người: ${peopleHydrationError}`
                                    : 'Danh sách người trên máy này chưa đầy đủ, hệ thống đang tải lại dữ liệu mới nhất.'}
                        </div>
                        <button
                            type="button"
                            onClick={retryPeopleHydration}
                            disabled={peopleHydrationLoading}
                            className="rounded-lg border border-white/70 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                            {peopleHydrationLoading ? 'Đang tải...' : 'Tải lại'}
                        </button>
                    </div>
                </div>
            )}

            {/* ===== Section 1 — Các vai trò trong quy trình ===== */}
            <section
                className="wf-surface rounded-lg border"
                style={{ borderColor: 'var(--wf-border)' }}
            >
                <div
                    className="flex items-start justify-between gap-3 border-b px-5 py-3.5"
                    style={{ borderColor: 'var(--wf-border)' }}
                >
                    <div>
                        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--wf-text)' }}>
                            Các vai trò trong quy trình
                        </h2>
                        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                            Những người liên quan tới quy trình
                        </p>
                    </div>
                    {canConfigureTemplate && (
                        <button
                            type="button"
                            onClick={() => setRolesEditing(prev => !prev)}
                            className="shrink-0 text-[13px] font-medium transition hover:underline"
                            style={{ color: 'var(--wf-green-text)' }}
                        >
                            {rolesEditing ? 'Xong' : 'Chỉnh sửa'}
                        </button>
                    )}
                </div>

                <div className="divide-y" style={{ borderColor: 'var(--wf-border)' }}>
                    <WorkflowRoleRow
                        label="Người quản trị quy trình"
                        hint="Toàn quyền với quy trình: cấu hình, duyệt, trả lại và gán lại mọi giai đoạn."
                        userIds={template.managers || []}
                        users={users}
                        editing={rolesEditing}
                        onChange={values => void updateTemplateUserList('managers', values)}
                        emptyLabel="Chưa chỉ định"
                    />
                    <WorkflowRoleRow
                        label="Người giám sát workflow"
                        hint="Được tag mặc định vào mọi nhiệm vụ mới và theo dõi toàn bộ quy trình."
                        userIds={template.defaultWatchers || []}
                        users={users}
                        editing={rolesEditing}
                        onChange={values => void updateTemplateUserList('defaultWatchers', values)}
                        emptyLabel="Chưa có người theo dõi"
                    />
                    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                            <p className="text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>
                                Tùy chọn quyền xem các nhiệm vụ
                            </p>
                            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                                Quản trị viên module, người quản trị quy trình, người theo dõi, người tạo và người được giao
                                giai đoạn đều nhìn thấy nhiệm vụ.
                            </p>
                        </div>
                        <span className="shrink-0 text-[13px]" style={{ color: 'var(--wf-text-muted)' }}>
                            Theo phân quyền hệ thống
                        </span>
                    </div>
                    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                            <p className="text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>
                                Nhóm thành viên có thể tạo các nhiệm vụ mới
                            </p>
                            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                                Do quyền <code className="text-[11px]">workflow.instance.create</code> quyết định, không đặt riêng ở đây.
                            </p>
                        </div>
                        <span className="shrink-0 text-[13px]" style={{ color: 'var(--wf-text-muted)' }}>
                            Theo phân quyền hệ thống
                        </span>
                    </div>
                </div>
            </section>

            {/* ===== Section 2 — Tùy chỉnh quy trình ===== */}
            <section
                className="wf-surface rounded-lg border"
                style={{ borderColor: 'var(--wf-border)' }}
            >
                <div
                    className="border-b px-5 py-3.5"
                    style={{ borderColor: 'var(--wf-border)' }}
                >
                    <h2 className="text-[15px] font-semibold" style={{ color: 'var(--wf-text)' }}>
                        Tùy chỉnh quy trình
                    </h2>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--wf-text-faint)' }}>
                        Quy trình nên hoạt động như thế nào
                    </p>
                </div>

                <dl className="divide-y" style={{ borderColor: 'var(--wf-border)' }}>
                    {workflowSettingSummary.map(row => (
                        <div
                            key={row.label}
                            className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4"
                        >
                            <dt className="text-[13px]" style={{ color: 'var(--wf-text-muted)' }}>
                                {row.label}
                            </dt>
                            <dd className="text-[13px] font-medium" style={{ color: 'var(--wf-text)' }}>
                                {row.value}
                                {row.hint && (
                                    <span className="mt-0.5 block text-[11px] font-normal" style={{ color: 'var(--wf-text-faint)' }}>
                                        {row.hint}
                                    </span>
                                )}
                            </dd>
                        </div>
                    ))}
                </dl>
            </section>

            {/* Tabs */}
            <div className="flex gap-2">
                <button
                    onClick={() => setActiveTab('steps')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition ${activeTab === 'steps'
                        ? 'bg-accent text-white shadow-md'
                        : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700'
                        }`}
                >
                    <Layers size={15} /> Giai đoạn ({orderedSteps.length})
                </button>
                <button
                    onClick={() => setActiveTab('fields')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition ${activeTab === 'fields'
                        ? 'bg-violet-600 text-white shadow-md'
                        : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700'
                        }`}
                >
                    <FileText size={15} /> Trường tùy chỉnh ({customFields.length})
                </button>
                <button
                    onClick={() => setActiveTab('print')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition ${activeTab === 'print'
                        ? 'bg-rose-600 text-white shadow-md'
                        : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700'
                        }`}
                >
                    <Printer size={15} /> Mẫu in ({templateId ? getPrintTemplates(templateId).length : 0})
                </button>
            </div>

            {/* ==================== TAB: STEPS ==================== */}
            {activeTab === 'steps' && (
                <div className="space-y-3">
                    {/* START indicator */}
                    <div className="flex items-center gap-3 px-4 py-3 glass-card rounded-xl border-l-4 border-emerald-400">
                        <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 rounded-full flex items-center justify-center">
                            <Play size={14} />
                        </div>
                        <div>
                            <p className="font-bold text-sm text-emerald-700 dark:text-emerald-300">Bắt đầu</p>
                            <p className="text-[10px] text-slate-400">Người tạo phiếu gửi yêu cầu</p>
                        </div>
                    </div>

                    {/* Connector line */}
                    {orderedSteps.length > 0 && (
                        <div className="flex justify-center">
                            <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-600" />
                        </div>
                    )}

                    {/* Steps */}
                    {orderedSteps.map((step, idx) => {
                        const isEditing = editingStepId === step.id;
                        const stepTypeIcon = step.type === WorkflowNodeType.APPROVAL ? UserCheck : Zap;
                        const StepIcon = stepTypeIcon;
                        const stepColor = step.type === WorkflowNodeType.APPROVAL
                            ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/10'
                            : 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10';
                        const activeStepConfigTab = stepConfigTabs[step.id] || 'info';

                        return (
                            <React.Fragment key={step.id}>
                                <div
                                    className={`glass-card rounded-xl overflow-hidden border-l-4 ${stepColor} transition-all ${dragStepId === step.id ? 'opacity-40 scale-[0.98]' : ''} ${dragOverStepId === step.id ? 'ring-2 ring-accent ring-offset-2 dark:ring-offset-slate-900' : ''}`}
                                    draggable
                                    onDragStart={e => handleStepDragStart(e, step.id)}
                                    onDragOver={e => handleStepDragOver(e, step.id)}
                                    onDrop={e => handleStepDrop(e, step.id)}
                                    onDragEnd={handleStepDragEnd}
                                    onDragLeave={() => setDragOverStepId(null)}
                                >
                                    {/* Step Header */}
                                    <div
                                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/30 dark:hover:bg-slate-700/20 transition"
                                        onClick={() => setEditingStepId(isEditing ? null : step.id)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-600/30 transition flex flex-col items-center"
                                                title="Kéo để thay đổi thứ tự"
                                            >
                                                <GripVertical size={16} className="text-slate-400" />
                                            </div>
                                            <div className="flex flex-col gap-0.5">
                                                <button onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'up'); }}
                                                    disabled={idx === 0}
                                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition">
                                                    <ChevronUp size={12} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'down'); }}
                                                    disabled={idx === orderedSteps.length - 1}
                                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition">
                                                    <ChevronDown size={12} />
                                                </button>
                                            </div>
                                            <div className="w-8 h-8 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center shadow-sm border border-slate-200 dark:border-slate-600">
                                                <span className="text-xs font-black text-slate-500">{String(idx + 1).padStart(2, '0')}</span>
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm text-slate-800 dark:text-white">{step.label}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${step.type === WorkflowNodeType.APPROVAL
                                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                                        }`}>
                                                        <StepIcon size={9} className="inline mr-0.5" />
                                                        {step.type === WorkflowNodeType.APPROVAL ? 'Duyệt' : 'Hành động'}
                                                    </span>
                                                    <span
                                                        className="max-w-[240px] truncate text-[10px] font-medium text-slate-400"
                                                        title={describeStepAssignment(step.config)}
                                                    >
                                                        👤 {describeStepAssignment(step.config)}
                                                    </span>
                                                    {step.config.assigneeSelectionMode === 'multiple' && (
                                                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                                            Duyệt đồng thời
                                                        </span>
                                                    )}
                                                    {step.config.slaHours && (
                                                        <span className="text-[10px] text-slate-400 font-medium">
                                                            ⏱ {step.config.slaHours}h
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                                                className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                                                title="Xóa bước"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>

                                    {/* Step Config Panel */}
                                    {isEditing && (
                                        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-700/50 space-y-4 animate-fade-in-down">
                                            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-100 bg-white/70 p-1 dark:border-slate-700 dark:bg-slate-800/40">
                                                {([
                                                    ['info', 'Thông tin'],
                                                    ['assignee', 'Người xử lý'],
                                                    ['watchers', 'Theo dõi/SLA'],
                                                    ['actions', 'Quyền hành động'],
                                                ] as Array<[typeof activeStepConfigTab, string]>).map(([tab, label]) => (
                                                    <button
                                                        key={tab}
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setStepConfigTabs(prev => ({ ...prev, [step.id]: tab }));
                                                        }}
                                                        className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition ${activeStepConfigTab === tab ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className={activeStepConfigTab === 'info' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Tên bước</label>
                                                    <input
                                                        type="text"
                                                        value={step.label}
                                                        onChange={e => updateStepLabel(step.id, e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'info' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Loại bước</label>
                                                    <select
                                                        value={step.type}
                                                        onChange={e => updateStepType(step.id, e.target.value as WorkflowNodeType)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value={WorkflowNodeType.APPROVAL}>Phê duyệt</option>
                                                        <option value={WorkflowNodeType.ACTION}>Hành động</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Phân công theo vai trò</label>
                                                    <select
                                                        value={step.config.assigneeRole || ''}
                                                        onChange={e => updateStepConfig(step.id, 'assigneeRole', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="">-- Không chỉ định --</option>
                                                        <option value={Role.ADMIN}>Quản trị</option>
                                                        <option value={Role.WAREHOUSE_KEEPER}>Thủ kho</option>
                                                        <option value={Role.EMPLOYEE}>Nhân viên</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Hoặc chỉ định cụ thể</label>
                                                    <select
                                                        value={step.config.assigneeUserId || ''}
                                                        onChange={e => updateStepConfig(step.id, 'assigneeUserId', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="">-- Không chỉ định --</option>
                                                        {users.map(u => (
                                                            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'watchers' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">SLA (giờ)</label>
                                                    <input
                                                        type="number"
                                                        value={step.config.slaHours || ''}
                                                        onChange={e => updateStepConfig(step.id, 'slaHours', Number(e.target.value) || undefined)}
                                                        placeholder="VD: 24"
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Cách gán người</label>
                                                    <select
                                                        value={step.config.assignmentMode || 'select_on_transition'}
                                                        onChange={e => updateStepConfig(step.id, 'assignmentMode', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="select_on_submit">Chọn khi gửi</option>
                                                        <option value="select_on_transition">Chọn khi chuyển bước</option>
                                                        <option value="fixed_user">Người cố định</option>
                                                        <option value="permission_pool">Theo nhóm quyền</option>
                                                        <option value="previous_assignee">Người đã xử lý trước</option>
                                                        <option value="creator">Người tạo phiếu</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Rule duyệt</label>
                                                    <select
                                                        value={step.config.approvalPolicy || 'ANY_ONE'}
                                                        onChange={e => updateStepConfig(step.id, 'approvalPolicy', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="ANY_ONE">Một người duyệt là qua</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Chế độ chọn người khi chuyển bước</label>
                                                    <select
                                                        value={step.config.assigneeSelectionMode || 'single'}
                                                        onChange={e => updateStepConfig(step.id, 'assigneeSelectionMode', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="single">Chọn một người</option>
                                                        <option value="multiple">Chọn nhiều người</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Quyền được chọn</label>
                                                    <input
                                                        type="text"
                                                        value={(step.config.eligiblePermissionCodes || []).join(', ')}
                                                        onChange={e => updateStepConfig(step.id, 'eligiblePermissionCodes', e.target.value.split(',').map(code => code.trim()).filter(Boolean))}
                                                        placeholder="VD: approve, verify"
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'actions' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Khi trả lại</label>
                                                    <select
                                                        value={step.config.returnPolicy || 'to_creator'}
                                                        onChange={e => updateStepConfig(step.id, 'returnPolicy', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="to_creator">Về người tạo</option>
                                                    </select>
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Pool người mặc định</label>
                                                    <SearchableCheckboxSelect
                                                        options={users.map(item => ({ id: item.id, label: item.name, sublabel: item.role }))}
                                                        selectedValues={getTargetUserIds(step.config.assignmentTargets)}
                                                        onChange={values => updateStepTargets(
                                                            step.id,
                                                            'assignmentTargets',
                                                            values,
                                                            getTargetDepartmentIds(step.config.assignmentTargets),
                                                        )}
                                                        placeholder="Tìm kiếm người..."
                                                        maxHeightClass="h-28"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'assignee' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Pool phòng ban mặc định</label>
                                                    <SearchableCheckboxSelect
                                                        options={orgUnits.filter(unit => unit.type === 'department').map(unit => ({ id: unit.id, label: unit.name }))}
                                                        selectedValues={getTargetDepartmentIds(step.config.assignmentTargets)}
                                                        onChange={values => updateStepTargets(
                                                            step.id,
                                                            'assignmentTargets',
                                                            getTargetUserIds(step.config.assignmentTargets),
                                                            values,
                                                        )}
                                                        placeholder="Tìm kiếm phòng ban..."
                                                        maxHeightClass="h-28"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'watchers' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Theo dõi bước - người</label>
                                                    <SearchableCheckboxSelect
                                                        options={users.map(item => ({ id: item.id, label: item.name, sublabel: item.role }))}
                                                        selectedValues={getTargetUserIds(step.config.stepWatcherTargets)}
                                                        onChange={values => updateStepTargets(
                                                            step.id,
                                                            'stepWatcherTargets',
                                                            values,
                                                            getTargetDepartmentIds(step.config.stepWatcherTargets),
                                                        )}
                                                        placeholder="Tìm kiếm người..."
                                                        maxHeightClass="h-24"
                                                    />
                                                </div>
                                                <div className={activeStepConfigTab === 'watchers' ? '' : 'hidden'}>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Theo dõi bước - phòng ban</label>
                                                    <SearchableCheckboxSelect
                                                        options={orgUnits.filter(unit => unit.type === 'department').map(unit => ({ id: unit.id, label: unit.name }))}
                                                        selectedValues={getTargetDepartmentIds(step.config.stepWatcherTargets)}
                                                        onChange={values => updateStepTargets(
                                                            step.id,
                                                            'stepWatcherTargets',
                                                            getTargetUserIds(step.config.stepWatcherTargets),
                                                            values,
                                                        )}
                                                        placeholder="Tìm kiếm phòng ban..."
                                                        maxHeightClass="h-24"
                                                    />
                                                </div>
                                                <div className={`items-center gap-2 pt-5 ${activeStepConfigTab === 'actions' ? 'flex' : 'hidden'}`}>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStepConfig(step.id, 'allowReject', step.config.allowReject === false)}
                                                        className={`rounded-xl border px-3 py-2 text-xs font-black ${step.config.allowReject !== false ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-400'}`}
                                                    >
                                                        Từ chối
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStepConfig(step.id, 'allowReassign', step.config.allowReassign === false)}
                                                        className={`rounded-xl border px-3 py-2 text-xs font-black ${step.config.allowReassign !== false ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-400'}`}
                                                    >
                                                        Đổi người xử lý
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Connector line */}
                                <div className="flex justify-center">
                                    <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-600" />
                                </div>
                            </React.Fragment>
                        );
                    })}

                    {/* Add Step Button */}
                    <button
                        onClick={addStep}
                        disabled={!canConfigureTemplate}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-400 hover:text-accent hover:border-accent transition group"
                    >
                        <Plus size={16} className="group-hover:scale-110 transition-transform" /> Thêm giai đoạn
                    </button>

                    {/* Connector line */}
                    <div className="flex justify-center">
                        <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-600" />
                    </div>

                    {/* END indicator */}
                    <div className="flex items-center gap-3 px-4 py-3 glass-card rounded-xl border-l-4 border-red-400">
                        <div className="w-8 h-8 bg-red-100 dark:bg-red-900/40 text-red-600 rounded-full flex items-center justify-center">
                            <Flag size={14} />
                        </div>
                        <div>
                            <p className="font-bold text-sm text-red-700 dark:text-red-300">Kết thúc</p>
                            <p className="text-[10px] text-slate-400">Quy trình hoàn tất</p>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== TAB: CUSTOM FIELDS ==================== */}
            {activeTab === 'fields' && (
                <div className="space-y-4">
                    <div className="glass-card rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="font-bold text-lg text-slate-800 dark:text-white">Trường tùy chỉnh</h2>
                                <p className="text-xs text-slate-400">Thêm các trường dữ liệu mà người tạo phiếu cần điền khi gửi yêu cầu.</p>
                            </div>
                            <button
                                onClick={() => {
                                    setNewFieldLabel('');
                                    setNewFieldType('text');
                                    setNewFieldRequired(false);
                                    setNewFieldOptions('');
                                    setEditingFieldId(null);
                                    setShowAddField(true);
                                }}
                                className="flex items-center px-4 py-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition font-bold text-sm shadow-lg shadow-violet-500/20"
                            >
                                <Plus size={15} className="mr-1.5" /> Thêm
                            </button>
                        </div>

                        {/* Existing Fields */}
                        {customFields.length === 0 ? (
                            <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                <FileText className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                                <p className="text-slate-400 font-bold text-sm">Chưa có trường tùy chỉnh nào</p>
                                <p className="text-[10px] text-slate-300 dark:text-slate-500 mt-1">Bấm &quot;+ Thêm&quot; để tạo trường mới</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {customFields.map((field, idx) => {
                                    const ftConfig = FIELD_TYPE_CONFIG[field.type];
                                    const FieldIcon = ftConfig.icon;
                                    return (
                                        <div
                                            key={field.id}
                                            className={`flex items-center gap-3 p-3 bg-white/50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700 group hover:shadow-sm transition ${dragFieldId === field.id ? 'opacity-40 scale-[0.98]' : ''} ${dragOverFieldId === field.id ? 'ring-2 ring-violet-400 ring-offset-2 dark:ring-offset-slate-900' : ''}`}
                                            draggable
                                            onDragStart={e => handleFieldDragStart(e, field.id)}
                                            onDragOver={e => handleFieldDragOver(e, field.id)}
                                            onDrop={e => handleFieldDrop(e, field.id)}
                                            onDragEnd={handleFieldDragEnd}
                                            onDragLeave={() => setDragOverFieldId(null)}
                                        >
                                            {/* Drag handle */}
                                            <div
                                                className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-600/30 transition"
                                                title="Kéo để thay đổi thứ tự"
                                            >
                                                <GripVertical size={14} className="text-slate-400" />
                                            </div>

                                            {/* Reorder arrows */}
                                            <div className="flex flex-col gap-0.5">
                                                <button onClick={() => moveField(field.id, 'up')} disabled={idx === 0}
                                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition">
                                                    <ChevronUp size={11} />
                                                </button>
                                                <button onClick={() => moveField(field.id, 'down')} disabled={idx === customFields.length - 1}
                                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition">
                                                    <ChevronDown size={11} />
                                                </button>
                                            </div>

                                            {/* Field info */}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{field.label}</p>
                                                {field.type === 'select' && field.options && (
                                                    <p className="text-[10px] text-slate-400 truncate">
                                                        Tùy chọn: {field.options.join(', ')}
                                                    </p>
                                                )}
                                                {field.type === 'table' && field.options && (
                                                    <p className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold truncate">
                                                        Cột: {field.options.join(', ')}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Required toggle */}
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => toggleFieldRequired(field.id)}
                                                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg transition flex items-center gap-1 ${field.required
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                        : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
                                                        }`}
                                                >
                                                    {field.required ?
                                                        <><ToggleRight size={12} /> Bắt buộc</> :
                                                        <><ToggleLeft size={12} /> Không bắt buộc</>
                                                    }
                                                </button>
                                            </div>

                                            {/* Type badge */}
                                            <span className={`text-[10px] font-bold text-white px-2.5 py-1 rounded-lg ${ftConfig.color} flex items-center gap-1`}>
                                                <FieldIcon size={10} /> {ftConfig.label}
                                            </span>

                                            {/* Edit */}
                                            <button
                                                onClick={() => startEditCustomField(field)}
                                                className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition opacity-0 group-hover:opacity-100 animate-fade-in"
                                                title="Chỉnh sửa"
                                            >
                                                <Edit size={14} />
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => removeCustomField(field.id)}
                                                className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Add Field Modal */}
                    {showAddField && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4">
                            <div className="glass-card bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh] overflow-hidden relative">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                        {editingFieldId ? <Edit size={20} className="text-violet-500" /> : <Plus size={20} className="text-violet-500" />}
                                        {editingFieldId ? 'Chỉnh sửa trường tùy chỉnh' : 'Thêm trường mới'}
                                    </h2>
                                    <button onClick={resetFieldForm} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"><X size={16} /></button>
                                </div>
                                <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -webkit-overflow-scrolling-touch pr-1">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tên trường *</label>
                                        <input
                                            type="text"
                                            value={newFieldLabel}
                                            onChange={e => setNewFieldLabel(e.target.value)}
                                            placeholder="VD: Bộ phận/Công trường, Mục đích cấp..."
                                            className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Loại trường</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {(Object.entries(FIELD_TYPE_CONFIG) as [CustomFieldType, typeof FIELD_TYPE_CONFIG[CustomFieldType]][]).map(([type, config]) => {
                                                const Icon = config.icon;
                                                return (
                                                    <button
                                                        key={type}
                                                        onClick={() => setNewFieldType(type)}
                                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition border ${newFieldType === type
                                                            ? `${config.color} text-white border-transparent shadow-md`
                                                            : 'bg-white/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-400'
                                                            }`}
                                                    >
                                                        <Icon size={12} /> {config.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {(newFieldType === 'select' || newFieldType === 'table') && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                                {newFieldType === 'select' ? 'Các tùy chọn (phân cách bằng dấu phẩy)' : 'Tên các cột của bảng (phân cách bằng dấu phẩy)'}
                                            </label>
                                            <input
                                                type="text"
                                                value={newFieldOptions}
                                                onChange={e => setNewFieldOptions(e.target.value)}
                                                placeholder={newFieldType === 'select' ? 'VD: Công trường A, Công trường B, Văn phòng' : 'VD: Tên vật tư, ĐVT, Số lượng đề xuất, Ghi chú'}
                                                className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                            />
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setNewFieldRequired(!newFieldRequired)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition border ${newFieldRequired
                                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                                : 'bg-slate-50 dark:bg-slate-700/50 text-slate-500 border-slate-200 dark:border-slate-600'
                                                }`}
                                        >
                                            {newFieldRequired ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                            {newFieldRequired ? 'Bắt buộc' : 'Không bắt buộc'}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-6 border-t border-slate-100 dark:border-slate-700/50 pt-4">
                                    <button onClick={resetFieldForm} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                                    <button
                                        onClick={addCustomField}
                                        disabled={!newFieldLabel.trim()}
                                        className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition disabled:opacity-50 shadow-lg shadow-violet-500/20"
                                    >
                                        {editingFieldId ? 'Cập nhật' : 'Thêm trường'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

                {/* ==================== TAB: PRINT TEMPLATES ==================== */}
                {activeTab === 'print' && templateId && (
                    <PrintTemplateTab templateId={templateId} customFields={customFields} />
                )}
            </div>
        </div>
    );
};

// ==================== Print Template Tab Component ====================
const PrintTemplateTab: React.FC<{ templateId: string; customFields: WorkflowCustomField[] }> = ({ templateId, customFields }) => {
    const { uploadPrintTemplate, deletePrintTemplate, getPrintTemplates } = useWorkflow();
    const [uploading, setUploading] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const printTemplates = getPrintTemplates(templateId);

    const handleUpload = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const name = prompt('Nhập tên mẫu in:', file.name.replace(/\.docx$/i, ''));
            if (!name) return;
            setUploading(true);
            await uploadPrintTemplate(templateId, name.trim(), file);
            setUploading(false);
        };
        input.click();
    };

    const handleDelete = async (pt: WorkflowPrintTemplate) => {
        await deletePrintTemplate(pt.id, pt.storagePath);
        setDeleteConfirmId(null);
    };

    const systemPlaceholders = [
        { key: 'code', desc: 'Mã phiếu (VD: WF-2026-001)' },
        { key: 'title', desc: 'Tiêu đề phiếu' },
        { key: 'creator_name', desc: 'Tên người tạo' },
        { key: 'creator_email', desc: 'Email người tạo' },
        { key: 'created_at_day', desc: 'Ngày tạo (số)' },
        { key: 'created_at_month', desc: 'Tháng tạo (số)' },
        { key: 'created_at_year', desc: 'Năm tạo' },
        { key: 'created_at_full', desc: 'Ngày tạo đầy đủ' },
        { key: 'template_name', desc: 'Tên mẫu quy trình' },
        { key: 'status', desc: 'Trạng thái phiếu' },
    ];

    return (
        <div className="space-y-4">
            {/* Upload button */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-sm text-slate-700 dark:text-white">Mẫu in (.docx)</h3>
                    <p className="text-xs text-slate-400">Upload file Word với placeholder {'${tên_trường}'} để tự động điền dữ liệu khi xuất.</p>
                </div>
                <button onClick={handleUpload} disabled={uploading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-rose-500 text-white rounded-xl text-xs font-bold hover:bg-rose-600 transition shadow-lg shadow-rose-500/20 disabled:opacity-50">
                    <Upload size={14} /> {uploading ? 'Đang tải...' : 'Thêm mẫu in'}
                </button>
            </div>

            {/* List */}
            {printTemplates.length === 0 ? (
                <div className="text-center py-16 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <Printer className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-400 font-bold text-sm">Chưa có mẫu in nào.</p>
                    <p className="text-xs text-slate-300 dark:text-slate-500 mt-1">Tạo file Word (.docx), chèn placeholder {'${...}'} rồi upload.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {printTemplates.map(pt => (
                        <div key={pt.id} className="glass-card rounded-xl p-4 flex items-center gap-3 group">
                            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 text-rose-500 flex items-center justify-center shrink-0">
                                <FileText size={18} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm text-slate-700 dark:text-white truncate">{pt.name}</p>
                                <p className="text-[10px] text-slate-400">{pt.fileName} · {new Date(pt.createdAt).toLocaleDateString('vi-VN')}</p>
                            </div>
                            {deleteConfirmId === pt.id ? (
                                <div className="flex items-center gap-1">
                                    <button onClick={() => handleDelete(pt)} className="px-2.5 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold">Xóa</button>
                                    <button onClick={() => setDeleteConfirmId(null)} className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 rounded-lg text-[10px] font-bold">Hủy</button>
                                </div>
                            ) : (
                                <button onClick={() => setDeleteConfirmId(pt.id)}
                                    className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition opacity-0 group-hover:opacity-100">
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Placeholder reference */}
            <div className="glass-card rounded-2xl p-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Danh sách Placeholder có sẵn</h4>
                <p className="text-[10px] text-slate-400 mb-3">Chèn các placeholder dưới đây vào file Word. Khi xuất, hệ thống sẽ tự thay thế bằng dữ liệu thực.</p>

                <div className="mb-3">
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1.5">Trường hệ thống</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                        {systemPlaceholders.map(p => (
                            <div key={p.key} className="flex items-center gap-2 px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/10">
                                <code className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400">${'{' + p.key + '}'}</code>
                                <span className="text-[10px] text-slate-400">— {p.desc}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {customFields.length > 0 && (
                    <div>
                        <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-1.5">Trường tùy chỉnh (Form Data)</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                            {customFields.map(f => (
                                <div key={f.id} className="flex items-center gap-2 px-2 py-1 rounded bg-violet-50 dark:bg-violet-900/10">
                                    <code className="text-[10px] font-mono font-bold text-violet-600 dark:text-violet-400">${'{' + f.name + '}'}</code>
                                    <span className="text-[10px] text-slate-400">— {f.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkflowBuilder;
