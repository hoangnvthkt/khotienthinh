
import React, { useState, useMemo } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role
} from '../../types';
import {
    GitBranch, Plus, Search, Clock, CheckCircle, XCircle, Circle,
    ArrowRight, User, MessageSquare, FileText, Send, RotateCcw,
    ChevronDown, ChevronUp, Filter, Inbox, AlertCircle, X
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
    const { templates, instances, nodes, edges, logs, createInstance, processInstance, getInstanceLogs } = useWorkflow();
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

    // Action state
    const [actionComment, setActionComment] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);

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

    const handleCreate = async () => {
        if (!selectedTemplateId || !newTitle.trim()) return;
        await createInstance(selectedTemplateId, newTitle.trim(), user.id, { note: newNote });
        setShowCreateModal(false);
        setSelectedTemplateId('');
        setNewTitle('');
        setNewNote('');
    };

    const handleAction = async (instanceId: string, action: WorkflowInstanceAction) => {
        setProcessingId(instanceId);
        await processInstance(instanceId, action, user.id, actionComment);
        setActionComment('');
        setProcessingId(null);
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
            return { node, logs: nodeLog, isCurrent, isPast };
        });
    };

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

    return (
        <div className="space-y-6">
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
                                    {instance.formData && Object.keys(instance.formData).length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Dữ liệu phiếu</p>
                                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300">
                                                {Object.entries(instance.formData).map(([key, value]) => (
                                                    <div key={key} className="flex items-center gap-2 py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
                                                        <span className="font-bold text-slate-400 uppercase text-[10px] w-24">{key}:</span>
                                                        <span>{String(value)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Panel */}
                                    {canAct && (
                                        <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-3">
                                                Hành động ({currentNode?.label})
                                            </p>
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
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Send size={20} className="text-accent" /> Tạo phiếu mới
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Chọn quy trình *</label>
                                <select
                                    value={selectedTemplateId}
                                    onChange={e => setSelectedTemplateId(e.target.value)}
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
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                <textarea
                                    value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    placeholder="Nội dung chi tiết..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button
                                onClick={handleCreate}
                                disabled={!selectedTemplateId || !newTitle.trim()}
                                className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                            >
                                Gửi phiếu
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowInstances;
