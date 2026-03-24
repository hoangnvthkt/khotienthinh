
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowCustomField, CustomFieldType, WorkflowPrintTemplate, Role } from '../../types';
import {
    ArrowLeft, Save, Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
    UserCheck, Settings2, X, Layers, FileText, ToggleLeft, ToggleRight,
    Zap, Play, Flag, Clock, Type, AlignLeft, Hash, Calendar, List, Paperclip, Printer, Upload, Download, Eye
} from 'lucide-react';

const FIELD_TYPE_CONFIG: Record<CustomFieldType, { label: string; icon: any; color: string }> = {
    text: { label: 'Văn bản ngắn', icon: Type, color: 'bg-blue-500' },
    textarea: { label: 'Văn bản dài', icon: AlignLeft, color: 'bg-indigo-500' },
    number: { label: 'Số', icon: Hash, color: 'bg-emerald-500' },
    date: { label: 'Ngày tháng', icon: Calendar, color: 'bg-amber-500' },
    select: { label: 'Danh sách chọn', icon: List, color: 'bg-violet-500' },
    file: { label: 'Tệp đính kèm', icon: Paperclip, color: 'bg-rose-500' },
};

const WorkflowBuilder: React.FC = () => {
    const { id: templateId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { templates, getTemplateNodes, getTemplateEdges, saveNodesAndEdges, updateTemplate, uploadPrintTemplate, deletePrintTemplate, getPrintTemplates } = useWorkflow();
    const { users } = useApp();

    const template = templates.find(t => t.id === templateId);

    const [activeTab, setActiveTab] = useState<'steps' | 'fields' | 'print'>('steps');
    const [localNodes, setLocalNodes] = useState<WorkflowNode[]>([]);
    const [localEdges, setLocalEdges] = useState<WorkflowEdge[]>([]);
    const [customFields, setCustomFields] = useState<WorkflowCustomField[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [editingStepId, setEditingStepId] = useState<string | null>(null);

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

    const generateId = () => crypto.randomUUID();

    // ========== STEPS (NODES) MANAGEMENT ==========

    // Get ordered steps (excluding START and END, which are auto-managed)
    const getOrderedSteps = (): WorkflowNode[] => {
        const steps = localNodes.filter(n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END);
        // Sort by positionY as ordering proxy
        return steps.sort((a, b) => a.positionY - b.positionY);
    };

    const addStep = () => {
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
        setLocalNodes(prev => prev.filter(n => n.id !== nodeId));
        setLocalEdges(prev => prev.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
        if (editingStepId === nodeId) setEditingStepId(null);
        setHasChanges(true);
    };

    const updateStepLabel = (nodeId: string, label: string) => {
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n));
        setHasChanges(true);
    };

    const updateStepConfig = (nodeId: string, key: string, value: any) => {
        setLocalNodes(prev => prev.map(n => {
            if (n.id !== nodeId) return n;
            return { ...n, config: { ...n.config, [key]: value || undefined } };
        }));
        setHasChanges(true);
    };

    const updateStepType = (nodeId: string, type: WorkflowNodeType) => {
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, type } : n));
        setHasChanges(true);
    };

    const moveStep = (nodeId: string, direction: 'up' | 'down') => {
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
        setCustomFields(prev => prev.filter(f => f.id !== fieldId));
        setHasChanges(true);
    };

    const toggleFieldRequired = (fieldId: string) => {
        setCustomFields(prev => prev.map(f => f.id === fieldId ? { ...f, required: !f.required } : f));
        setHasChanges(true);
    };

    const moveField = (fieldId: string, direction: 'up' | 'down') => {
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
        if (!templateId || !template) return;
        setIsSaving(true);

        // Ensure START and END nodes exist
        let nodesToSave = [...localNodes];
        let edgesToSave = [...localEdges];
        const orderedSteps = getOrderedSteps();

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

        // Auto-generate sequential edges: START -> step1 -> step2 -> ... -> END
        edgesToSave = [];
        const allInOrder = [startNode, ...orderedSteps, endNode];
        for (let i = 0; i < allInOrder.length - 1; i++) {
            edgesToSave.push({
                id: generateId(),
                templateId,
                sourceNodeId: allInOrder[i].id,
                targetNodeId: allInOrder[i + 1].id,
                label: '',
            });
        }

        await saveNodesAndEdges(templateId, nodesToSave, edgesToSave);

        // Save custom fields
        await updateTemplate({ ...template, customFields });

        setHasChanges(false);
        setIsSaving(false);
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
                        <p className="text-xs text-slate-400">{template.description || 'Chưa có mô tả'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {hasChanges && (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg animate-pulse">
                            • Chưa lưu
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        className="flex items-center px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                    >
                        <Save size={15} className="mr-2" /> {isSaving ? 'Đang lưu...' : 'Lưu'}
                    </button>
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
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Tên bước</label>
                                                    <input
                                                        type="text"
                                                        value={step.label}
                                                        onChange={e => updateStepLabel(step.id, e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                </div>
                                                <div>
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
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Phân công theo vai trò</label>
                                                    <select
                                                        value={step.config.assigneeRole || ''}
                                                        onChange={e => updateStepConfig(step.id, 'assigneeRole', e.target.value)}
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    >
                                                        <option value="">-- Không chỉ định --</option>
                                                        <option value={Role.ADMIN}>Quản trị</option>
                                                        <option value={Role.EMPLOYEE}>Nhân viên</option>
                                                    </select>
                                                </div>
                                                <div>
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
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">SLA (giờ)</label>
                                                    <input
                                                        type="number"
                                                        value={step.config.slaHours || ''}
                                                        onChange={e => updateStepConfig(step.id, 'slaHours', Number(e.target.value) || undefined)}
                                                        placeholder="VD: 24"
                                                        className="w-full px-3 py-2.5 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent"
                                                    />
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
