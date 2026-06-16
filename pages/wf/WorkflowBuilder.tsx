
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { WorkflowAssignmentTarget, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowCustomField, CustomFieldType, WorkflowPrintTemplate, Role } from '../../types';
import { projectWorkflowService } from '../../lib/projectWorkflowService';
import { usePermission } from '../../hooks/usePermission';
import {
    ArrowLeft, Save, Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
    UserCheck, Settings2, X, Layers, FileText, ToggleLeft, ToggleRight,
    Zap, Play, Flag, Clock, Type, AlignLeft, Hash, Calendar, List, Paperclip, Printer, Upload, Download, Eye,
    Search, Check
} from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

const FIELD_TYPE_CONFIG: Record<CustomFieldType, { label: string; icon: any; color: string }> = {
    text: { label: 'Văn bản ngắn', icon: Type, color: 'bg-blue-500' },
    textarea: { label: 'Văn bản dài', icon: AlignLeft, color: 'bg-indigo-500' },
    number: { label: 'Số', icon: Hash, color: 'bg-emerald-500' },
    date: { label: 'Ngày tháng', icon: Calendar, color: 'bg-amber-500' },
    select: { label: 'Danh sách chọn', icon: List, color: 'bg-violet-500' },
    file: { label: 'Tệp đính kèm', icon: Paperclip, color: 'bg-rose-500' },
};

interface SearchableCheckboxSelectProps {
    options: { id: string; label: string; sublabel?: string }[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    maxHeightClass?: string;
}

const SearchableCheckboxSelect: React.FC<SearchableCheckboxSelectProps> = ({
    options,
    selectedValues,
    onChange,
    placeholder = 'Tìm kiếm...',
    maxHeightClass = 'h-36',
}) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredOptions = options.filter(opt => {
        return matchesSearchQueryMultiple([opt.label, opt.sublabel], searchTerm);
    });

    const handleToggle = (id: string) => {
        if (selectedValues.includes(id)) {
            onChange(selectedValues.filter(val => val !== id));
        } else {
            onChange([...selectedValues, id]);
        }
    };

    const handleSelectAll = () => {
        const filteredIds = filteredOptions.map(opt => opt.id);
        const allFilteredSelected = filteredIds.every(id => selectedValues.includes(id));
        if (allFilteredSelected) {
            onChange(selectedValues.filter(id => !filteredIds.includes(id)));
        } else {
            onChange(Array.from(new Set([...selectedValues, ...filteredIds])));
        }
    };

    const isAllFilteredSelected = filteredOptions.length > 0 && filteredOptions.every(opt => selectedValues.includes(opt.id));

    return (
        <div className="flex flex-col border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white/80 dark:bg-slate-800/50 focus-within:ring-2 focus-within:ring-indigo-200 transition">
            {/* Search Bar */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50 px-3 py-2 bg-slate-50/50 dark:bg-slate-800/30">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-transparent border-none outline-none text-xs text-slate-700 dark:text-slate-300 placeholder-slate-400 font-medium"
                />
                {searchTerm && (
                    <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition p-0.5 rounded"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {/* Quick Actions */}
            {filteredOptions.length > 0 && (
                <div className="flex justify-between items-center px-3 py-1 bg-slate-50/20 dark:bg-slate-800/10 border-b border-slate-100 dark:border-slate-700/30 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>Kết quả: {filteredOptions.length}</span>
                    <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 transition"
                    >
                        {isAllFilteredSelected ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                    </button>
                </div>
            )}

            {/* Options List */}
            <div className={`overflow-y-auto divide-y divide-slate-100/50 dark:divide-slate-700/30 ${maxHeightClass} custom-scrollbar`}>
                {filteredOptions.length > 0 ? (
                    filteredOptions.map(opt => {
                        const isSelected = selectedValues.includes(opt.id);
                        return (
                            <div
                                key={opt.id}
                                onClick={() => handleToggle(opt.id)}
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition text-xs select-none ${
                                    isSelected 
                                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-bold' 
                                        : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30 text-slate-600 dark:text-slate-300 font-medium'
                                }`}
                            >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                                    isSelected 
                                        ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/20' 
                                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-transparent'
                                }`}>
                                    <Check size={11} className="stroke-[3]" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="truncate">{opt.label}</span>
                                    {opt.sublabel && (
                                        <span className={`text-[10px] truncate ${isSelected ? 'text-indigo-400 dark:text-indigo-500' : 'text-slate-400'}`}>
                                            {opt.sublabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="px-3 py-4 text-center text-xs text-slate-400 font-semibold">
                        Không tìm thấy kết quả phù hợp
                    </div>
                )}
            </div>
        </div>
    );
};

const WorkflowBuilder: React.FC = () => {
    const { id: templateId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { templates, getTemplateNodes, getTemplateEdges, updateTemplate, uploadPrintTemplate, deletePrintTemplate, getPrintTemplates, refreshData } = useWorkflow();
    const { users, orgUnits, user, loadModuleData, moduleLoadState, moduleLoadErrors } = useApp();
    const { canManage } = usePermission();

    const template = templates.find(t => t.id === templateId);
    const canManageWorkflowTemplates = canManage('/wf/templates');
    const canConfigureTemplate = canManageWorkflowTemplates || Boolean(template?.managers?.includes(user.id));

    const [activeTab, setActiveTab] = useState<'steps' | 'fields' | 'print'>('steps');
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

    useEffect(() => {
        if (templateId) {
            const tNodes = getTemplateNodes(templateId);
            setLocalNodes(tNodes);
            setLocalEdges(getTemplateEdges(templateId));
        }
    }, [templateId, templates]);

    useEffect(() => {
        if (template) {
            setCustomFields(template.customFields || []);
        }
    }, [template]);

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
    const peopleHydrationLoading = moduleLoadState.admin === 'loading' || moduleLoadState.hrm === 'loading';
    const peopleHydrationError = moduleLoadErrors.admin || moduleLoadErrors.hrm || null;

    useEffect(() => {
        if (!templateId || !peopleHydrationStale || peopleHydrationLoading) return;
        const reloadKey = `${users.length <= 1 ? 'few-users' : ''}|${[...missingSelectedUserIds].sort().join('|')}`;
        if (lastPeopleReloadKeyRef.current === reloadKey) return;
        lastPeopleReloadKeyRef.current = reloadKey;
        Promise.all([
            loadModuleData('admin', true),
            loadModuleData('hrm', orgUnits.length === 0),
        ]).catch(error => {
            console.warn('Workflow people reload failed:', error);
        });
    }, [loadModuleData, missingSelectedUserIds, orgUnits.length, peopleHydrationLoading, peopleHydrationStale, templateId, users.length]);

    const retryPeopleHydration = () => {
        lastPeopleReloadKeyRef.current = '';
        Promise.all([
            loadModuleData('admin', true),
            loadModuleData('hrm', true),
        ]).catch(error => {
            console.warn('Workflow people retry failed:', error);
        });
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
    const getOrderedSteps = (): WorkflowNode[] => {
        const steps = localNodes.filter(n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END);
        // Sort by positionY as ordering proxy
        return steps.sort((a, b) => a.positionY - b.positionY);
    };

    const addStep = () => {
        if (!canConfigureTemplate) return;
        const orderedSteps = getOrderedSteps();
        const newNode: WorkflowNode = {
            id: generateId(),
            templateId: templateId!,
            type: WorkflowNodeType.APPROVAL,
            label: `Giai đoạn ${orderedSteps.length + 1}`,
            config: {},
            positionX: 0,
            positionY: (orderedSteps.length + 1) * 100,
        };
        setLocalNodes(prev => [...prev, newNode]);
        setHasChanges(true);
        setEditingStepId(newNode.id);
    };

    const removeStep = (nodeId: string) => {
        if (!canConfigureTemplate) return;
        setLocalNodes(prev => prev.filter(n => n.id !== nodeId));
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

    const getTargetUserIds = (targets?: WorkflowAssignmentTarget[]) =>
        (targets || []).filter(target => target.type === 'user' && target.userId).map(target => target.userId!);

    const getTargetDepartmentIds = (targets?: WorkflowAssignmentTarget[]) =>
        (targets || []).filter(target => target.type === 'department' && target.orgUnitId).map(target => target.orgUnitId!);

    const updateStepTargets = (
        nodeId: string,
        key: 'assignmentTargets' | 'stepWatcherTargets',
        userIds: string[],
        departmentIds: string[],
    ) => {
        const targets: WorkflowAssignmentTarget[] = [
            ...userIds.map(userId => ({ type: 'user' as const, userId })),
            ...departmentIds.map(orgUnitId => ({ type: 'department' as const, orgUnitId })),
        ];
        updateStepConfig(nodeId, key, targets);
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

        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        const tempY = steps[idx].positionY;
        setLocalNodes(prev => prev.map(n => {
            if (n.id === steps[idx].id) return { ...n, positionY: steps[swapIdx].positionY };
            if (n.id === steps[swapIdx].id) return { ...n, positionY: tempY };
            return n;
        }));
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

        // Reorder by reassigning positionY values
        const reordered = [...steps];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);

        setLocalNodes(prev => prev.map(n => {
            const newIdx = reordered.findIndex(s => s.id === n.id);
            if (newIdx !== -1) return { ...n, positionY: (newIdx + 1) * 100 };
            return n;
        }));
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

    const addCustomField = () => {
        if (!canConfigureTemplate) return;
        if (!newFieldLabel.trim()) return;
        const field: WorkflowCustomField = {
            id: generateId(),
            name: newFieldLabel.trim().toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '_').replace(/_+/g, '_'),
            label: newFieldLabel.trim(),
            type: newFieldType,
            required: newFieldRequired,
            options: newFieldType === 'select' ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
            placeholder: '',
        };
        setCustomFields(prev => [...prev, field]);
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

    // ========== SAVE ==========

    const handleSave = async () => {
        if (!templateId || !template || !canConfigureTemplate) return;
        setIsSaving(true);
        try {
            let nodesToSave = [...localNodes];
            let startNode = nodesToSave.find(n => n.type === WorkflowNodeType.START);
            if (!startNode) {
                startNode = { id: generateId(), templateId, type: WorkflowNodeType.START, label: 'Bắt đầu', config: {}, positionX: 0, positionY: 0 };
                nodesToSave.push(startNode);
            }
            let endNode = nodesToSave.find(n => n.type === WorkflowNodeType.END);
            if (!endNode) {
                endNode = { id: generateId(), templateId, type: WorkflowNodeType.END, label: 'Kết thúc', config: {}, positionX: 0, positionY: 9999 };
                nodesToSave.push(endNode);
            }
            const orderedSteps = getOrderedSteps();
            const allInOrder = [startNode, ...orderedSteps, endNode];
            const edgesToSave: WorkflowEdge[] = allInOrder.slice(0, -1).map((node, index) => ({
                id: generateId(),
                templateId,
                sourceNodeId: node.id,
                targetNodeId: allInOrder[index + 1].id,
                label: '',
            }));
            await projectWorkflowService.saveTemplateStructure({
                template: { ...template, customFields },
                nodes: nodesToSave,
                edges: edgesToSave,
            });
            setLocalNodes(nodesToSave);
            setLocalEdges(edgesToSave);
            await refreshData();
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
        <div className="space-y-4">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 glass-card rounded-xl">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/wf/templates')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 className="font-bold text-lg text-slate-800 dark:text-white">{template.name}</h1>
                        <p className="text-xs text-slate-400">{template.description || 'Chưa có mô tả'} • Thay đổi chỉ áp dụng cho instance tạo mới</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canManageWorkflowTemplates && <button
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

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="glass-card rounded-xl p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-black uppercase text-slate-400">Quản trị quy trình</div>
                            <p className="text-[11px] font-medium text-slate-500">Có quyền cấu hình/gán lại workflow, trừ xoá template.</p>
                        </div>
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-600">{template.managers?.length || 0} người</span>
                    </div>
                    <SearchableCheckboxSelect
                        options={users.map(item => ({ id: item.id, label: item.name, sublabel: item.role }))}
                        selectedValues={template.managers || []}
                        onChange={values => void updateTemplateUserList('managers', values)}
                        placeholder="Tìm kiếm quản trị..."
                        maxHeightClass="h-32"
                    />
                </div>
                <div className="glass-card rounded-xl p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-black uppercase text-slate-400">Người theo dõi mặc định</div>
                            <p className="text-[11px] font-medium text-slate-500">Chỉ xem workflow, không có quyền duyệt hoặc chỉnh sửa.</p>
                        </div>
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">{template.defaultWatchers?.length || 0} người</span>
                    </div>
                    <SearchableCheckboxSelect
                        options={users.map(item => ({ id: item.id, label: item.name, sublabel: item.role }))}
                        selectedValues={template.defaultWatchers || []}
                        onChange={values => void updateTemplateUserList('defaultWatchers', values)}
                        placeholder="Tìm kiếm người theo dõi..."
                        maxHeightClass="h-32"
                    />
                </div>
            </div>

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
                                                    {step.config.assigneeRole && (
                                                        <span className="text-[10px] text-slate-400 font-medium">
                                                            👤 {step.config.assigneeRole}
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
                                onClick={() => { setShowAddField(true); setEditingFieldId(null); }}
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
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                            <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                        <Plus size={20} className="text-violet-500" /> Thêm trường mới
                                    </h2>
                                    <button onClick={() => setShowAddField(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"><X size={16} /></button>
                                </div>
                                <div className="space-y-4">
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

                                    {newFieldType === 'select' && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Các tùy chọn (phân cách bằng dấu phẩy)</label>
                                            <input
                                                type="text"
                                                value={newFieldOptions}
                                                onChange={e => setNewFieldOptions(e.target.value)}
                                                placeholder="VD: Công trường A, Công trường B, Văn phòng"
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
                                <div className="flex gap-3 mt-6">
                                    <button onClick={() => setShowAddField(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                                    <button
                                        onClick={addCustomField}
                                        disabled={!newFieldLabel.trim()}
                                        className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition disabled:opacity-50 shadow-lg shadow-violet-500/20"
                                    >
                                        Thêm trường
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
