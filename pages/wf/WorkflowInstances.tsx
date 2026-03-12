
import React, { useState, useMemo } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role, WorkflowCustomField
} from '../../types';
import {
    GitBranch, Plus, Search, Clock, CheckCircle, XCircle, Circle,
    ArrowRight, User, MessageSquare, FileText, Send, RotateCcw,
    ChevronDown, ChevronUp, Filter, Inbox, AlertCircle, X,
    Edit2, Trash2, Ban, Save
} from 'lucide-react';

const STATUS_MAP: Record<WorkflowInstanceStatus, { label: string; color: string; icon: any }> = {
    RUNNING: { label: 'Đang xử lý', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: Clock },
    COMPLETED: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle },
    REJECTED: { label: 'Từ chối', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: XCircle },
    CANCELLED: { label: 'Đã hủy', color: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400', icon: XCircle },
};

const ACTION_MAP: Record<WorkflowInstanceAction, { label: string; color: string }> = {
    SUBMITTED: { label: 'Đã gửi', color: 'text-blue-600' },
    APPROVED: { label: 'Đã duyệt', color: 'text-emerald-600' },
    REJECTED: { label: 'Từ chối', color: 'text-red-600' },
    REVISION_REQUESTED: { label: 'Yêu cầu bổ sung', color: 'text-amber-600' },
};

const WorkflowInstances: React.FC = () => {
    const { templates, instances, nodes, edges, logs, createInstance, updateInstance, deleteInstance, cancelInstance, processInstance, getInstanceLogs } = useWorkflow();
    const { user, users } = useApp();
    const [activeTab, setActiveTab] = useState<'mine' | 'pending'>('mine');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Create form state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [newTitle, setNewTitle] = useState('');
    const [newNote, setNewNote] = useState('');
    const [customFormData, setCustomFormData] = useState<Record<string, any>>({});

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    const selectedCustomFields: WorkflowCustomField[] = selectedTemplate?.customFields || [];

    // Action state
    const [actionComment, setActionComment] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Edit instance state
    const [editingInstance, setEditingInstance] = useState<WorkflowInstance | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editFormData, setEditFormData] = useState<Record<string, any>>({});

    // Delete/Cancel confirm state
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

    // Step data editing state
    const [stepFormData, setStepFormData] = useState<Record<string, any>>({});

    const activeTemplates = templates.filter(t => t.isActive);

    // Filter instances based on active tab
    const filteredInstances = useMemo(() => {
        let list = instances;

        if (activeTab === 'mine') {
            list = list.filter(i => i.createdBy === user.id);
        } else {
            // "Chờ tôi duyệt": instances where current node is assigned to this user (by role or by userId)
            list = list.filter(i => {
                if (i.status !== WorkflowInstanceStatus.RUNNING || !i.currentNodeId) return false;
                const currentNode = nodes.find(n => n.id === i.currentNodeId);
                if (!currentNode) return false;
                if (currentNode.config.assigneeUserId === user.id) return true;
                if (currentNode.config.assigneeRole === user.role) return true;
                if (user.role === Role.ADMIN) return true; // admin sees all
                return false;
            });
        }

        if (filterStatus !== 'ALL') {
            list = list.filter(i => i.status === filterStatus);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(i => i.code.toLowerCase().includes(term) || i.title.toLowerCase().includes(term));
        }

        return list;
    }, [instances, activeTab, filterStatus, searchTerm, user, nodes]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const showToast = (type: 'success' | 'error', text: string) => {
        setSubmitMessage({ type, text });
        setTimeout(() => setSubmitMessage(null), 4000);
    };

    const handleCreate = async () => {
        if (!selectedTemplateId || !newTitle.trim()) return;
        // Check required custom fields
        for (const field of selectedCustomFields) {
            if (field.required && !customFormData[field.name]) return;
        }
        setIsSubmitting(true);
        try {
            const formData = { ...customFormData, note: newNote };
            const result = await createInstance(selectedTemplateId, newTitle.trim(), user.id, formData);
            if (!result) {
                setIsSubmitting(false);
                showToast('error', 'Tạo phiếu thất bại. Kiểm tra lại mẫu quy trình có đủ các bước (Bắt đầu/Kết thúc) chưa.');
                return;
            }
            setShowCreateModal(false);
            setSelectedTemplateId('');
            setNewTitle('');
            setNewNote('');
            setCustomFormData({});
            setActiveTab('mine');
            showToast('success', `Phiếu "${result.title}" đã được tạo thành công!`);
        } catch (err) {
            showToast('error', 'Đã xảy ra lỗi khi tạo phiếu. Vui lòng thử lại.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSelectTemplate = (tid: string) => {
        setSelectedTemplateId(tid);
        setCustomFormData({});
    };

    const handleAction = async (instanceId: string, action: WorkflowInstanceAction) => {
        setProcessingId(instanceId);
        // Save step data if any
        const instance = instances.find(i => i.id === instanceId);
        if (instance && Object.keys(stepFormData).length > 0) {
            const nodeId = instance.currentNodeId;
            const newFormData = { ...instance.formData };
            Object.entries(stepFormData).forEach(([key, value]) => {
                newFormData[`step_${nodeId}_${key}`] = value;
            });
            await updateInstance(instanceId, { formData: newFormData });
        }
        await processInstance(instanceId, action, user.id, actionComment);
        setActionComment('');
        setStepFormData({});
        setProcessingId(null);
    };

    // Edit instance handlers
    const openEditModal = (instance: WorkflowInstance) => {
        setEditingInstance(instance);
        setEditTitle(instance.title);
        // Extract only the original form data (non step_ prefixed)
        const originalFormData: Record<string, any> = {};
        Object.entries(instance.formData || {}).forEach(([key, value]) => {
            if (!key.startsWith('step_')) {
                originalFormData[key] = value;
            }
        });
        setEditFormData(originalFormData);
    };

    const handleEditSave = async () => {
        if (!editingInstance || !editTitle.trim()) return;
        setIsSubmitting(true);
        // Merge step data back in
        const stepData: Record<string, any> = {};
        Object.entries(editingInstance.formData || {}).forEach(([key, value]) => {
            if (key.startsWith('step_')) {
                stepData[key] = value;
            }
        });
        const mergedFormData = { ...editFormData, ...stepData };
        const ok = await updateInstance(editingInstance.id, { title: editTitle.trim(), formData: mergedFormData });
        setIsSubmitting(false);
        if (ok) {
            showToast('success', 'Phiếu đã được cập nhật thành công!');
            setEditingInstance(null);
        } else {
            showToast('error', 'Cập nhật phiếu thất bại.');
        }
    };

    const handleDelete = async (id: string) => {
        const ok = await deleteInstance(id);
        setDeleteConfirmId(null);
        if (ok) {
            showToast('success', 'Phiếu đã được xóa!');
            setExpandedId(null);
        } else {
            showToast('error', 'Xóa phiếu thất bại.');
        }
    };

    const handleCancel = async (id: string) => {
        const ok = await cancelInstance(id, user.id);
        setCancelConfirmId(null);
        if (ok) {
            showToast('success', 'Phiếu đã được hủy!');
        } else {
            showToast('error', 'Hủy phiếu thất bại.');
        }
    };

    const getNodeTimeline = (instance: WorkflowInstance) => {
        const templateNodes = nodes.filter(n => n.templateId === instance.templateId);
        const templateEdges = edges.filter(e => e.templateId === instance.templateId);
        const instanceLogs = getInstanceLogs(instance.id);

        // Build ordered path from START
        const orderedNodes: typeof templateNodes = [];
        let currentNode = templateNodes.find(n => n.type === WorkflowNodeType.START);
        const visited = new Set<string>();
        while (currentNode && !visited.has(currentNode.id)) {
            visited.add(currentNode.id);
            orderedNodes.push(currentNode);
            const nextEdge = templateEdges.find(e => e.sourceNodeId === currentNode!.id);
            if (nextEdge) {
                currentNode = templateNodes.find(n => n.id === nextEdge.targetNodeId);
            } else {
                break;
            }
        }

        return orderedNodes.map(node => {
            const nodeLog = instanceLogs.filter(l => l.nodeId === node.id);
            const isCurrent = instance.currentNodeId === node.id;
            const isPast = nodeLog.length > 0;
            // Extract step-specific data
            const stepData: Record<string, any> = {};
            Object.entries(instance.formData || {}).forEach(([key, value]) => {
                const prefix = `step_${node.id}_`;
                if (key.startsWith(prefix)) {
                    stepData[key.replace(prefix, '')] = value;
                }
            });
            return { node, logs: nodeLog, isCurrent, isPast, stepData };
        });
    };

    // Permission checks
    const isCreator = (instance: WorkflowInstance): boolean => instance.createdBy === user.id;
    const isRunning = (instance: WorkflowInstance): boolean => instance.status === WorkflowInstanceStatus.RUNNING;

    // Check if user can approve current node
    const canActOnInstance = (instance: WorkflowInstance): boolean => {
        if (instance.status !== WorkflowInstanceStatus.RUNNING || !instance.currentNodeId) return false;
        const currentNode = nodes.find(n => n.id === instance.currentNodeId);
        if (!currentNode) return false;
        if (currentNode.type === WorkflowNodeType.START || currentNode.type === WorkflowNodeType.END) return false;
        if (user.role === Role.ADMIN) return true;
        if (currentNode.config.assigneeUserId === user.id) return true;
        if (currentNode.config.assigneeRole === user.role) return true;
        return false;
    };

    // Render custom fields form (reused in create and edit modals)
    const renderCustomFieldInputs = (
        fields: WorkflowCustomField[],
        data: Record<string, any>,
        onChange: (key: string, value: any) => void,
        disabled = false
    ) => (
        fields.map(field => (
            <div key={field.id}>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.type === 'text' && (
                    <input
                        type="text"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-50"
                    />
                )}
                {field.type === 'textarea' && (
                    <textarea
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none disabled:opacity-50"
                        rows={3}
                    />
                )}
                {field.type === 'number' && (
                    <input
                        type="number"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-50"
                    />
                )}
                {field.type === 'date' && (
                    <input
                        type="date"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-50"
                    />
                )}
                {field.type === 'select' && (
                    <select
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-50"
                    >
                        <option value="">-- Chọn {field.label.toLowerCase()} --</option>
                        {(field.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                )}
                {field.type === 'file' && (
                    <input
                        type="text"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder="Nhập tài liệu đính kèm..."
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-50"
                    />
                )}
            </div>
        ))
    );

    return (
        <div className="space-y-6">
            {/* Toast Notification */}
            {submitMessage && (
                <div className={`fixed top-6 right-6 z-[60] px-5 py-3.5 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-fade-in-down ${submitMessage.type === 'success'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-red-500 text-white'
                    }`}>
                    {submitMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    {submitMessage.text}
                    <button onClick={() => setSubmitMessage(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded">
                        <X size={14} />
                    </button>
                </div>
            )}
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <GitBranch className="text-accent" size={28} /> Quy trình duyệt
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Tạo và theo dõi các phiếu yêu cầu theo quy trình.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    disabled={activeTemplates.length === 0}
                    className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                    <Plus size={18} className="mr-2" /> Tạo phiếu mới
                </button>
            </div>

            {/* Tabs & Filters */}
            <div className="glass-card p-4 rounded-xl space-y-3">
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('mine')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'mine' ? 'bg-accent text-white shadow-md' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                    >
                        <FileText size={13} /> Phiếu của tôi
                    </button>
                    <button
                        onClick={() => setActiveTab('pending')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'pending' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                    >
                        <Inbox size={13} /> Chờ tôi duyệt
                        {instances.filter(i => {
                            if (i.status !== WorkflowInstanceStatus.RUNNING || !i.currentNodeId) return false;
                            const cn = nodes.find(n => n.id === i.currentNodeId);
                            if (!cn) return false;
                            return user.role === Role.ADMIN || cn.config.assigneeUserId === user.id || cn.config.assigneeRole === user.role;
                        }).length > 0 && (
                                <span className="bg-white/30 px-1.5 py-0.5 rounded-full text-[10px]">
                                    {instances.filter(i => {
                                        if (i.status !== WorkflowInstanceStatus.RUNNING || !i.currentNodeId) return false;
                                        const cn = nodes.find(n => n.id === i.currentNodeId);
                                        if (!cn) return false;
                                        return user.role === Role.ADMIN || cn.config.assigneeUserId === user.id || cn.config.assigneeRole === user.role;
                                    }).length}
                                </span>
                            )}
                    </button>
                </div>

                <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                            type="text" placeholder="Tìm theo mã hoặc tiêu đề..."
                            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-xs"
                        />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {[
                            { id: 'ALL', label: 'Tất cả' },
                            { id: 'RUNNING', label: 'Đang xử lý' },
                            { id: 'COMPLETED', label: 'Hoàn thành' },
                            { id: 'REJECTED', label: 'Từ chối' },
                        ].map(s => (
                            <button
                                key={s.id} onClick={() => setFilterStatus(s.id)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition ${filterStatus === s.id ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Instance List */}
            <div className="space-y-3">
                {filteredInstances.map(instance => {
                    const template = templates.find(t => t.id === instance.templateId);
                    const creator = users.find(u => u.id === instance.createdBy);
                    const statusInfo = STATUS_MAP[instance.status];
                    const StatusIcon = statusInfo.icon;
                    const isExpanded = expandedId === instance.id;
                    const timeline = getNodeTimeline(instance);
                    const canAct = canActOnInstance(instance);
                    const currentNode = nodes.find(n => n.id === instance.currentNodeId);
                    const isOwner = isCreator(instance);
                    const running = isRunning(instance);

                    return (
                        <div key={instance.id} className="glass-card rounded-2xl overflow-hidden transition-all">
                            {/* Header Row */}
                            <div
                                className="p-4 cursor-pointer hover:bg-white/30 dark:hover:bg-slate-700/30 transition"
                                onClick={() => setExpandedId(isExpanded ? null : instance.id)}
                            >
                                <div className="flex items-start md:items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                            <span className="font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-500">{instance.code}</span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${statusInfo.color}`}>
                                                <StatusIcon size={10} /> {statusInfo.label}
                                            </span>
                                            {canAct && (
                                                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded animate-pulse flex items-center gap-1">
                                                    <AlertCircle size={10} /> Cần bạn xử lý
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{instance.title}</h3>
                                        <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-400">
                                            <span className="flex items-center gap-1"><User size={9} /> {creator?.name || 'N/A'}</span>
                                            <span className="flex items-center gap-1"><GitBranch size={9} /> {template?.name || 'N/A'}</span>
                                            <span className="flex items-center gap-1"><Clock size={9} /> {new Date(instance.createdAt).toLocaleString('vi-VN')}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                                            <span className="text-[10px] font-bold text-slate-500 bg-slate-50 dark:bg-slate-700 px-2 py-1 rounded hidden md:block">
                                                Bước: {currentNode.label}
                                            </span>
                                        )}
                                        {/* Creator action buttons */}
                                        {isOwner && (
                                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                                {running && (
                                                    <button
                                                        onClick={() => openEditModal(instance)}
                                                        className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                                                        title="Sửa phiếu"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                )}
                                                {running && (
                                                    <button
                                                        onClick={() => setCancelConfirmId(instance.id)}
                                                        className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition"
                                                        title="Hủy phiếu"
                                                    >
                                                        <Ban size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setDeleteConfirmId(instance.id)}
                                                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                                                    title="Xóa phiếu"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        )}
                                        {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Detail */}
                            {isExpanded && (
                                <div className="border-t border-slate-100 dark:border-slate-700 p-4 space-y-4 animate-fade-in-down">
                                    {/* Timeline */}
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Tiến trình</p>
                                        <div className="flex items-start gap-0 overflow-x-auto pb-2">
                                            {timeline.map((step, idx) => {
                                                const nodeColors = {
                                                    START: 'emerald', ACTION: 'blue', APPROVAL: 'amber', END: 'red'
                                                }[step.node.type] || 'slate';

                                                const isCompleted = step.isPast && !step.isCurrent;
                                                const isCurrent = step.isCurrent;
                                                const isFuture = !step.isPast && !step.isCurrent;

                                                return (
                                                    <React.Fragment key={step.node.id}>
                                                        <div className="flex flex-col items-center min-w-[100px]">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${isCompleted ? `bg-${nodeColors}-500 border-${nodeColors}-500 text-white` :
                                                                isCurrent ? `bg-white dark:bg-slate-800 border-${nodeColors}-400 text-${nodeColors}-600 ring-4 ring-${nodeColors}-100 dark:ring-${nodeColors}-900/30 animate-pulse` :
                                                                    `bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400`
                                                                }`}>
                                                                {isCompleted ? <CheckCircle size={14} /> :
                                                                    isCurrent ? <Clock size={14} /> :
                                                                        <Circle size={14} />}
                                                            </div>
                                                            <p className={`text-[9px] font-bold mt-1.5 text-center leading-tight ${isCurrent ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
                                                                {step.node.label}
                                                            </p>
                                                            {step.logs.length > 0 && (
                                                                <div className="mt-1 space-y-0.5">
                                                                    {step.logs.map(log => {
                                                                        const actor = users.find(u => u.id === log.actedBy);
                                                                        return (
                                                                            <div key={log.id} className="text-[8px] text-slate-400 text-center">
                                                                                <span className={ACTION_MAP[log.action]?.color || ''}>{ACTION_MAP[log.action]?.label}</span>
                                                                                <br />
                                                                                <span>{actor?.name}</span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            {/* Show step data (read-only for past steps) */}
                                                            {Object.keys(step.stepData).length > 0 && (
                                                                <div className="mt-1 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded text-[8px] text-blue-600 dark:text-blue-300 max-w-[120px]">
                                                                    {Object.entries(step.stepData).map(([k, v]) => (
                                                                        <div key={k} className="truncate">
                                                                            <span className="font-bold">{k}:</span> {String(v)}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {idx < timeline.length - 1 && (
                                                            <div className={`flex-shrink-0 w-8 h-0.5 mt-4 ${isCompleted ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Form Data */}
                                    {instance.formData && Object.keys(instance.formData).filter(k => !k.startsWith('step_') && (k !== 'note' || instance.formData[k])).length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Dữ liệu phiếu</p>
                                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300">
                                                {Object.entries(instance.formData).filter(([k, v]) => v && !k.startsWith('step_')).map(([key, value]) => {
                                                    const tpl = templates.find(t => t.id === instance.templateId);
                                                    const fieldDef = (tpl?.customFields || []).find(f => f.name === key);
                                                    const displayLabel = fieldDef ? fieldDef.label : key;
                                                    return (
                                                        <div key={key} className="flex items-start gap-2 py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                                                            <span className="font-bold text-slate-400 text-[10px] min-w-[100px] uppercase tracking-wider">{displayLabel}:</span>
                                                            <span className="flex-1">{String(value)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Panel - for step assignee */}
                                    {canAct && (
                                        <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-3">
                                                Hành động ({currentNode?.label})
                                            </p>

                                            {/* Step data input form */}
                                            {currentNode && currentNode.config.formFields && currentNode.config.formFields.length > 0 && (
                                                <div className="mb-4 space-y-3 border-b border-amber-200 dark:border-amber-700 pb-4">
                                                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Nhập dữ liệu bước này</p>
                                                    {currentNode.config.formFields.map((field: any) => (
                                                        <div key={field.name || field.label}>
                                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
                                                                {field.label || field.name}
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={stepFormData[field.name || field.label] || ''}
                                                                onChange={e => setStepFormData(prev => ({ ...prev, [field.name || field.label]: e.target.value }))}
                                                                placeholder={`Nhập ${(field.label || field.name).toLowerCase()}...`}
                                                                className="w-full px-3 py-2 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-accent"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Free-form step note */}
                                            <div className="mb-3">
                                                <label className="block text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1.5">Ghi chú bước này</label>
                                                <textarea
                                                    value={stepFormData._note || ''}
                                                    onChange={e => setStepFormData(prev => ({ ...prev, _note: e.target.value }))}
                                                    placeholder="Nhập ghi chú, dữ liệu bổ sung cho bước này..."
                                                    className="w-full px-3 py-2 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-accent resize-none"
                                                    rows={2}
                                                />
                                            </div>

                                            <textarea
                                                value={actionComment}
                                                onChange={e => setActionComment(e.target.value)}
                                                placeholder="Ghi chú / lý do (tùy chọn)..."
                                                className="w-full px-3 py-2 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-accent resize-none mb-3"
                                                rows={2}
                                            />
                                            <div className="flex gap-2 flex-wrap">
                                                <button
                                                    onClick={() => handleAction(instance.id, WorkflowInstanceAction.APPROVED)}
                                                    disabled={processingId === instance.id}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
                                                >
                                                    <CheckCircle size={13} /> Duyệt
                                                </button>
                                                <button
                                                    onClick={() => handleAction(instance.id, WorkflowInstanceAction.REJECTED)}
                                                    disabled={processingId === instance.id}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-600 transition shadow-md shadow-red-500/20 disabled:opacity-50"
                                                >
                                                    <XCircle size={13} /> Từ chối
                                                </button>
                                                <button
                                                    onClick={() => handleAction(instance.id, WorkflowInstanceAction.REVISION_REQUESTED)}
                                                    disabled={processingId === instance.id}
                                                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition shadow-md shadow-amber-500/20 disabled:opacity-50"
                                                >
                                                    <RotateCcw size={13} /> Yêu cầu bổ sung
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Log History */}
                                    {getInstanceLogs(instance.id).length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Lịch sử xử lý</p>
                                            <div className="space-y-1.5">
                                                {getInstanceLogs(instance.id).map(log => {
                                                    const actor = users.find(u => u.id === log.actedBy);
                                                    const node = nodes.find(n => n.id === log.nodeId);
                                                    return (
                                                        <div key={log.id} className="flex items-start gap-2 text-[10px] bg-slate-50 dark:bg-slate-800/30 p-2 rounded-lg">
                                                            <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${ACTION_MAP[log.action]?.color.replace('text-', 'bg-')}`} />
                                                            <div>
                                                                <span className="font-bold text-slate-600 dark:text-slate-300">{actor?.name}</span>
                                                                <span className={`font-bold ml-1 ${ACTION_MAP[log.action]?.color}`}>{ACTION_MAP[log.action]?.label}</span>
                                                                <span className="text-slate-400 ml-1">tại "{node?.label}"</span>
                                                                {log.comment && <p className="text-slate-400 mt-0.5 italic">"{log.comment}"</p>}
                                                                <p className="text-slate-300 dark:text-slate-600">{new Date(log.createdAt).toLocaleString('vi-VN')}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {filteredInstances.length === 0 && (
                    <div className="text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <FileText className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold">
                            {activeTab === 'mine' ? 'Bạn chưa có phiếu nào.' : 'Không có phiếu nào chờ bạn duyệt.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Create Instance Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Send size={20} className="text-accent" /> Tạo phiếu mới
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Chọn quy trình *</label>
                                <select
                                    value={selectedTemplateId}
                                    onChange={e => handleSelectTemplate(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                                >
                                    <option value="">-- Chọn quy trình --</option>
                                    {activeTemplates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder="VD: Thanh toán hạng mục móng CT5..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                                />
                            </div>

                            {/* Dynamic Custom Fields */}
                            {selectedCustomFields.length > 0 && (
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Thông tin bổ sung</p>
                                    {renderCustomFieldInputs(
                                        selectedCustomFields,
                                        customFormData,
                                        (key, value) => setCustomFormData(prev => ({ ...prev, [key]: value }))
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                <textarea
                                    value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    placeholder="Nội dung chi tiết..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
                                    rows={2}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button
                                onClick={handleCreate}
                                disabled={isSubmitting || !selectedTemplateId || !newTitle.trim() || selectedCustomFields.some(f => f.required && !customFormData[f.name])}
                                className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang gửi...</>
                                ) : (
                                    'Gửi phiếu'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Instance Modal */}
            {editingInstance && (() => {
                const editTemplate = templates.find(t => t.id === editingInstance.templateId);
                const editCustomFields = editTemplate?.customFields || [];
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditingInstance(null)}>
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Edit2 size={20} className="text-blue-500" /> Sửa phiếu
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mã phiếu</label>
                                    <input
                                        type="text" value={editingInstance.code} disabled
                                        className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={e => setEditTitle(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                                        autoFocus
                                    />
                                </div>

                                {/* Custom fields */}
                                {editCustomFields.length > 0 && (
                                    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Thông tin bổ sung</p>
                                        {renderCustomFieldInputs(
                                            editCustomFields,
                                            editFormData,
                                            (key, value) => setEditFormData(prev => ({ ...prev, [key]: value }))
                                        )}
                                    </div>
                                )}

                                {/* Note field */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                    <textarea
                                        value={editFormData.note || ''}
                                        onChange={e => setEditFormData(prev => ({ ...prev, note: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
                                        rows={2}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={() => setEditingInstance(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                                <button
                                    onClick={handleEditSave}
                                    disabled={isSubmitting || !editTitle.trim()}
                                    className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition disabled:opacity-50 shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? (
                                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Đang lưu...</>
                                    ) : (
                                        <><Save size={14} /> Lưu thay đổi</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Delete Confirm Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa phiếu?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Phiếu và tất cả lịch sử xử lý sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Confirm Modal */}
            {cancelConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setCancelConfirmId(null)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-amber-600 mb-2">Hủy phiếu?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Phiếu sẽ bị hủy và không thể tiếp tục xử lý. Bạn vẫn có thể xem lại phiếu đã hủy.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setCancelConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Đóng</button>
                            <button onClick={() => handleCancel(cancelConfirmId)} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-600 transition shadow-lg shadow-amber-500/20">Xác nhận hủy</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowInstances;
