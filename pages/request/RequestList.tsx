
import React, { useState, useMemo } from 'react';
import { useRequest } from '../../context/RequestContext';
import { useApp } from '../../context/AppContext';
import { RQStatus, RQPriority, Role, RequestInstance, WorkflowCustomField, RequestApprover } from '../../types';
import {
    Inbox, Plus, Search, Clock, CheckCircle, XCircle, AlertCircle,
    ArrowRight, User, FileText, Filter, X, ChevronDown, ChevronUp,
    Send, Eye, Trash2, Ban, MessageSquare, PlayCircle, Edit2, Save,
    Upload, Paperclip, Download, Table2, FileSpreadsheet, Zap, AlertTriangle, Shield
} from 'lucide-react';

const STATUS_MAP: Record<RQStatus, { label: string; color: string; icon: any }> = {
    DRAFT: { label: 'Nháp', color: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400', icon: FileText },
    PENDING: { label: 'Chờ duyệt', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: Clock },
    APPROVED: { label: 'Đã duyệt', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', icon: CheckCircle },
    IN_PROGRESS: { label: 'Đang xử lý', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: PlayCircle },
    DONE: { label: 'Hoàn thành', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle },
    REJECTED: { label: 'Từ chối', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: XCircle },
    CANCELLED: { label: 'Đã hủy', color: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400', icon: Ban },
};

const PRIORITY_MAP: Record<RQPriority, { label: string; color: string }> = {
    low: { label: 'Thấp', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400' },
    medium: { label: 'Trung bình', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
    high: { label: 'Cao', color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' },
    urgent: { label: 'Khẩn cấp', color: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
};

// File Field Input
const FileFieldInput: React.FC<{
    value: any; onChange: (val: any) => void; disabled: boolean;
}> = ({ value, onChange, disabled }) => {
    const fileRef = React.useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            const bytes = new Uint8Array(buffer);
            let binary = '';
            bytes.forEach(b => binary += String.fromCharCode(b));
            const base64 = btoa(binary);
            onChange({ fileName: file.name, fileType: file.type, fileSize: file.size, data: base64 });
        };
        reader.readAsArrayBuffer(file);
    };

    if (disabled && value?.fileName) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-sm">
                <Paperclip size={14} className="text-rose-400" />
                <span className="font-medium text-slate-700 dark:text-slate-300 flex-1 truncate">{value.fileName}</span>
                <span className="text-[10px] text-slate-400">({(value.fileSize / 1024).toFixed(1)} KB)</span>
            </div>
        );
    }

    return (
        <div>
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt" />
            {!value || typeof value !== 'object' ? (
                <div onClick={() => !disabled && fileRef.current?.click()}
                    className={`flex flex-col items-center gap-1 px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-all border-slate-200 dark:border-slate-600 hover:border-emerald-300 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Upload size={18} className="text-slate-400" />
                    <span className="text-[10px] text-slate-500"><span className="font-bold text-emerald-600">Chọn file</span> hoặc kéo thả</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-xl">
                    <Paperclip size={14} className="text-rose-400 shrink-0" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate flex-1">{value.fileName}</span>
                    {!disabled && <button onClick={() => onChange('')} className="p-1 text-red-400 hover:bg-red-100 dark:hover:bg-red-800/30 rounded transition"><X size={14} /></button>}
                </div>
            )}
        </div>
    );
};

// Approval Progress Component
const ApprovalProgress: React.FC<{ approvers: RequestApprover[]; users: any[] }> = ({ approvers, users }) => {
    if (!approvers || approvers.length === 0) return null;
    const sorted = [...approvers].sort((a, b) => a.order - b.order);
    return (
        <div className="flex items-center gap-1 flex-wrap">
            {sorted.map((step, idx) => {
                const u = users.find(usr => usr.id === step.userId);
                const isApproved = step.status === 'approved';
                const isRejected = step.status === 'rejected';
                const isWaiting = step.status === 'waiting';
                const isCurrent = isWaiting && (idx === 0 || sorted[idx - 1]?.status === 'approved');

                return (
                    <React.Fragment key={step.order}>
                        {idx > 0 && <ArrowRight size={10} className="text-slate-300 shrink-0" />}
                        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isApproved ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                            isRejected ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                            isCurrent ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 ring-1 ring-amber-300 animate-pulse' :
                            'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
                        }`} title={step.comment || ''}>
                            {isApproved ? <CheckCircle size={10} /> : isRejected ? <XCircle size={10} /> : <Clock size={10} />}
                            <span>B{step.order}: {u?.name || 'N/A'}</span>
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

const RequestList: React.FC = () => {
    const { categories, requests, createRequest, updateRequest, deleteRequest,
        approveRequest, rejectRequest, completeRequest, cancelRequest,
        getRequestLogs, getCurrentApproverStep } = useRequest();
    const { user, users } = useApp();

    const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'all'>('mine');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Create form
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [newTitle, setNewTitle] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newPriority, setNewPriority] = useState<RQPriority>('medium');
    const [newDueDate, setNewDueDate] = useState('');
    const [approverList, setApproverList] = useState<{ userId: string }[]>([]);
    const [customFormData, setCustomFormData] = useState<Record<string, any>>({});

    // Action state
    const [actionComment, setActionComment] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Toast
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const showToast = (type: 'success' | 'error', text: string) => {
        setToast({ type, text }); setTimeout(() => setToast(null), 4000);
    };

    // Delete/cancel confirm
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

    const activeCategories = categories.filter(c => c.isActive);
    const selectedCategory = categories.find(c => c.id === selectedCategoryId);
    const selectedFields: WorkflowCustomField[] = selectedCategory?.customFields || [];

    const canApprove = (r: RequestInstance): boolean => {
        if (r.status !== RQStatus.PENDING) return false;
        const currentStep = getCurrentApproverStep(r);
        return currentStep ? currentStep.userId === user.id : false;
    };

    const filteredRequests = useMemo(() => {
        let list = requests;

        if (activeTab === 'mine') {
            list = list.filter(r => r.createdBy === user.id);
        } else if (activeTab === 'pending') {
            list = list.filter(r => canApprove(r));
        }

        if (filterStatus !== 'ALL') list = list.filter(r => r.status === filterStatus);
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(r => r.code.toLowerCase().includes(term) || r.title.toLowerCase().includes(term));
        }
        return list;
    }, [requests, activeTab, filterStatus, searchTerm, user, categories]);

    const handleCreate = async () => {
        if (!selectedCategoryId || !newTitle.trim() || approverList.length === 0) return;
        for (const field of selectedFields) {
            if (field.required && !customFormData[field.name]) return;
        }
        const result = await createRequest({
            categoryId: selectedCategoryId,
            title: newTitle.trim(),
            description: newDesc.trim(),
            priority: newPriority,
            formData: customFormData,
            userId: user.id,
            approvers: approverList,
            dueDate: newDueDate || undefined,
        });
        if (result) {
            setShowCreateModal(false); setSelectedCategoryId(''); setNewTitle(''); setNewDesc('');
            setNewPriority('medium'); setCustomFormData({}); setNewDueDate(''); setApproverList([]);
            setActiveTab('mine');
            showToast('success', `Phiếu "${result.title}" đã được tạo!`);
        } else {
            showToast('error', 'Tạo phiếu thất bại');
        }
    };

    const handleAction = async (id: string, actionFn: (id: string, userId: string, comment?: string) => Promise<boolean>, label: string) => {
        setProcessingId(id);
        const ok = await actionFn(id, user.id, actionComment || undefined);
        setProcessingId(null);
        setActionComment('');
        if (ok) showToast('success', label);
        else showToast('error', 'Thao tác thất bại');
    };

    const handleDelete = async (id: string) => {
        const ok = await deleteRequest(id);
        setDeleteConfirmId(null); setExpandedId(null);
        if (ok) showToast('success', 'Đã xóa phiếu!');
        else showToast('error', 'Xóa phiếu thất bại');
    };

    const handleCancel = async (id: string) => {
        const ok = await cancelRequest(id, user.id, 'Hủy phiếu');
        setCancelConfirmId(null);
        if (ok) showToast('success', 'Đã hủy phiếu!');
        else showToast('error', 'Hủy phiếu thất bại');
    };

    const addApprover = (userId: string) => {
        if (!userId || approverList.some(a => a.userId === userId)) return;
        setApproverList(prev => [...prev, { userId }]);
    };

    const removeApprover = (idx: number) => {
        setApproverList(prev => prev.filter((_, i) => i !== idx));
    };

    const renderCustomFieldValue = (field: WorkflowCustomField, value: any) => {
        if (!value) return <span className="text-slate-400 italic text-xs">—</span>;
        if (field.type === 'file' && typeof value === 'object' && value.fileName) {
            return (
                <span className="flex items-center gap-1 text-xs text-rose-500">
                    <Paperclip size={10} /> {value.fileName}
                </span>
            );
        }
        return <span className="text-sm text-slate-700 dark:text-slate-300">{String(value)}</span>;
    };

    return (
        <div className="space-y-6">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-6 right-6 z-[60] px-5 py-3.5 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-fade-in-down ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    {toast.text}
                    <button onClick={() => setToast(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded"><X size={14} /></button>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Inbox className="text-accent" size={28} /> Phiếu yêu cầu
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Tạo và theo dõi các phiếu yêu cầu.</p>
                </div>
                <button onClick={() => setShowCreateModal(true)} disabled={activeCategories.length === 0}
                    className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                    <Plus size={18} className="mr-2" /> Tạo phiếu mới
                </button>
            </div>

            {/* Tabs & Filters */}
            <div className="glass-card p-4 rounded-xl space-y-3">
                <div className="flex gap-2">
                    {([
                        { id: 'mine', label: 'Phiếu của tôi', icon: User },
                        { id: 'pending', label: 'Chờ tôi duyệt', icon: Clock },
                        ...(user.role === Role.ADMIN ? [{ id: 'all', label: 'Tất cả', icon: Inbox }] : []),
                    ] as { id: string; label: string; icon: any }[]).map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab === tab.id
                                ? 'bg-accent text-white shadow-md'
                                : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700'
                                }`}>
                            <tab.icon size={15} /> {tab.label}
                            {tab.id === 'pending' && (() => {
                                const cnt = requests.filter(r => canApprove(r)).length;
                                return cnt > 0 ? <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[10px] font-black">{cnt}</span> : null;
                            })()}
                        </button>
                    ))}
                </div>
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input type="text" placeholder="Tìm theo mã hoặc tiêu đề..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" />
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto">
                        {['ALL', ...Object.keys(STATUS_MAP)].map(s => (
                            <button key={s} onClick={() => setFilterStatus(s)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition ${filterStatus === s
                                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                                    }`}>
                                {s === 'ALL' ? 'Tất cả' : STATUS_MAP[s as RQStatus].label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Request Cards */}
            <div className="space-y-3">
                {filteredRequests.map(req => {
                    const cat = categories.find(c => c.id === req.categoryId);
                    const creator = users.find(u => u.id === req.createdBy);
                    const status = STATUS_MAP[req.status] || STATUS_MAP.PENDING;
                    const priority = PRIORITY_MAP[req.priority] || PRIORITY_MAP.medium;
                    const isExpanded = expandedId === req.id;
                    const reqLogs = getRequestLogs(req.id);

                    return (
                        <div key={req.id} className="glass-card rounded-2xl overflow-hidden transition-all hover:shadow-md">
                            {/* Card Header */}
                            <div className="flex items-center gap-4 px-5 py-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : req.id)}>
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat?.color || 'from-slate-400 to-slate-600'} flex items-center justify-center text-white shadow-sm shrink-0`}>
                                    <Inbox size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className="font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-500">{req.code}</span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.color} flex items-center gap-1`}>
                                            <status.icon size={10} /> {status.label}
                                        </span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${priority.color}`}>{priority.label}</span>
                                        {cat && <span className="text-[10px] text-slate-400 font-medium">{cat.name}</span>}
                                    </div>
                                    <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{req.title}</h3>
                                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                                        <span className="flex items-center gap-1"><User size={10} /> {creator?.name || 'N/A'}</span>
                                        <span className="flex items-center gap-1"><Clock size={10} /> {new Date(req.createdAt).toLocaleDateString('vi-VN')}</span>
                                        {req.dueDate && (() => {
                                            const now = new Date();
                                            const due = new Date(req.dueDate);
                                            const isOverdue = now > due && !['DONE', 'CANCELLED', 'REJECTED'].includes(req.status);
                                            const isNearDue = !isOverdue && (due.getTime() - now.getTime()) < 2 * 60 * 60 * 1000 && !['DONE', 'CANCELLED', 'REJECTED'].includes(req.status);
                                            return (
                                                <span className={`flex items-center gap-1 font-bold ${
                                                    isOverdue ? 'text-red-500 animate-pulse' : isNearDue ? 'text-amber-500' : 'text-slate-400'
                                                }`}>
                                                    {isOverdue ? <AlertTriangle size={10} /> : <Clock size={10} />}
                                                    SLA: {due.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                                    {isOverdue && ' (QUÁ HẠN!)'}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    {/* Approval Progress */}
                                    {req.approvers && req.approvers.length > 0 && (
                                        <div className="mt-2">
                                            <ApprovalProgress approvers={req.approvers} users={users} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {canApprove(req) && (
                                        <span className="text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg animate-pulse">Chờ duyệt</span>
                                    )}
                                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {/* Expanded Detail */}
                            {isExpanded && (
                                <div className="border-t border-slate-100 dark:border-slate-700 px-5 py-4 space-y-4 animate-fade-in-down">
                                    {/* Description */}
                                    {req.description && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mô tả</p>
                                            <p className="text-sm text-slate-600 dark:text-slate-300">{req.description}</p>
                                        </div>
                                    )}

                                    {/* Custom Fields Data */}
                                    {cat?.customFields && cat.customFields.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Thông tin chi tiết</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {cat.customFields.map(field => (
                                                    <div key={field.id} className="flex items-start gap-2 p-2 bg-white/50 dark:bg-slate-800/30 rounded-lg">
                                                        <span className="text-[10px] font-bold text-slate-400 min-w-[80px] mt-0.5">{field.label}:</span>
                                                        {renderCustomFieldValue(field, req.formData[field.name])}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Due date / SLA */}
                                    {req.dueDate && (() => {
                                        const now = new Date();
                                        const due = new Date(req.dueDate);
                                        const isOverdue = now > due && !['DONE', 'CANCELLED', 'REJECTED'].includes(req.status);
                                        const diffMs = due.getTime() - now.getTime();
                                        const diffH = Math.abs(Math.round(diffMs / (1000 * 60 * 60) * 10) / 10);
                                        return (
                                            <div className={`flex items-center gap-2 text-xs p-2.5 rounded-xl ${
                                                isOverdue
                                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                                                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                                            }`}>
                                                {isOverdue ? <AlertTriangle size={14} className="shrink-0" /> : <Clock size={14} className="shrink-0" />}
                                                <div>
                                                    <span className="font-bold">
                                                        {isOverdue ? `Quá hạn ${diffH} giờ` : `Còn ${diffH} giờ`}
                                                    </span>
                                                    <span className="mx-1.5">•</span>
                                                    <span>Hạn: {due.toLocaleString('vi-VN')}</span>
                                                    {cat?.slaHours && <span className="text-[10px] opacity-70 ml-1">(SLA: {cat.slaHours}h)</span>}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Approval Chain Detail */}
                                    {req.approvers && req.approvers.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Chuỗi phê duyệt</p>
                                            <div className="space-y-1.5">
                                                {[...req.approvers].sort((a, b) => a.order - b.order).map(step => {
                                                    const approverUser = users.find(u => u.id === step.userId);
                                                    return (
                                                        <div key={step.order} className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                                                            step.status === 'approved' ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' :
                                                            step.status === 'rejected' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' :
                                                            'bg-white/50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700'
                                                        }`}>
                                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white ${
                                                                step.status === 'approved' ? 'bg-emerald-500' :
                                                                step.status === 'rejected' ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-600'
                                                            }`}>
                                                                {step.status === 'approved' ? <CheckCircle size={14} /> :
                                                                 step.status === 'rejected' ? <XCircle size={14} /> : step.order}
                                                            </div>
                                                            <div className="flex-1">
                                                                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{approverUser?.name || 'N/A'}</span>
                                                                <span className="text-[10px] text-slate-400 ml-1.5">({approverUser?.role || ''})</span>
                                                                {step.comment && <p className="text-xs text-slate-500 mt-0.5">"{step.comment}"</p>}
                                                            </div>
                                                            {step.actedAt && (
                                                                <span className="text-[10px] text-slate-400">{new Date(step.actedAt).toLocaleString('vi-VN')}</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Logs */}
                                    {reqLogs.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Lịch sử</p>
                                            <div className="space-y-1.5">
                                                {reqLogs.map(log => {
                                                    const actor = users.find(u => u.id === log.actedBy);
                                                    return (
                                                        <div key={log.id} className="flex items-start gap-2 text-xs">
                                                            <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                                                                <MessageSquare size={10} className="text-slate-400" />
                                                            </div>
                                                            <div>
                                                                <span className="font-bold text-slate-600 dark:text-slate-300">{actor?.name || 'N/A'}</span>
                                                                <span className="text-slate-400 mx-1">—</span>
                                                                <span className="font-bold text-blue-500">{log.action}</span>
                                                                {log.comment && <span className="text-slate-500 ml-1">"{log.comment}"</span>}
                                                                <span className="text-[10px] text-slate-400 ml-2">{new Date(log.createdAt).toLocaleString('vi-VN')}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Area */}
                                    <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-3">
                                        {/* Comment input for actions */}
                                        {canApprove(req) && (
                                            <div className="flex gap-2">
                                                <input type="text" value={actionComment} onChange={e => setActionComment(e.target.value)}
                                                    placeholder="Ghi chú (tùy chọn)..."
                                                    className="flex-1 px-3 py-2 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent" />
                                            </div>
                                        )}

                                        {/* Approve/Reject buttons */}
                                        {canApprove(req) && (
                                            <div className="flex gap-2">
                                                <button onClick={() => handleAction(req.id, approveRequest, 'Đã duyệt!')}
                                                    disabled={processingId === req.id}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                                    <CheckCircle size={15} /> Duyệt
                                                </button>
                                                <button onClick={() => handleAction(req.id, rejectRequest, 'Đã từ chối — phiếu bị hủy!')}
                                                    disabled={processingId === req.id}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20 disabled:opacity-50">
                                                    <XCircle size={15} /> Từ chối
                                                </button>
                                            </div>
                                        )}

                                        {/* Complete — for APPROVED requests */}
                                        {req.status === RQStatus.APPROVED && (user.role === Role.ADMIN || req.createdBy === user.id) && (
                                            <button onClick={() => handleAction(req.id, completeRequest, 'Hoàn thành!')}
                                                disabled={processingId === req.id}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                                <CheckCircle size={15} /> Hoàn thành
                                            </button>
                                        )}

                                        {/* Creator actions */}
                                        {req.createdBy === user.id && req.status === RQStatus.PENDING && (
                                            <div className="flex gap-2">
                                                <button onClick={() => setCancelConfirmId(req.id)}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl font-bold text-xs transition">
                                                    <Ban size={13} /> Hủy phiếu
                                                </button>
                                                <button onClick={() => setDeleteConfirmId(req.id)}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-bold text-xs transition">
                                                    <Trash2 size={13} /> Xóa
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {filteredRequests.length === 0 && (
                    <div className="text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <Inbox className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold">Không có phiếu yêu cầu nào.</p>
                        <p className="text-sm text-slate-300 dark:text-slate-500">Bấm "Tạo phiếu mới" để bắt đầu.</p>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Plus size={20} className="text-accent" /> Tạo phiếu yêu cầu
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Loại yêu cầu *</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {activeCategories.map(cat => (
                                        <button key={cat.id} onClick={() => { setSelectedCategoryId(cat.id); setCustomFormData({}); }}
                                            className={`flex items-center gap-2 p-3 rounded-xl border transition ${selectedCategoryId === cat.id
                                                ? 'border-accent bg-emerald-50 dark:bg-emerald-900/10 ring-2 ring-accent'
                                                : 'border-slate-200 dark:border-slate-600 hover:border-slate-400'}`}>
                                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center text-white`}>
                                                <Inbox size={14} />
                                            </div>
                                            <span className="font-bold text-sm text-slate-700 dark:text-slate-300 truncate">{cat.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề *</label>
                                <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="VD: Xin nghỉ ngày 20/03..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mô tả</label>
                                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Chi tiết yêu cầu..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none" rows={3} />
                            </div>

                            {/* Approver Chain */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                    <Shield size={12} className="inline mr-1" /> Người duyệt * <span className="text-[10px] normal-case font-medium">(theo thứ tự duyệt tuần tự)</span>
                                </label>
                                <div className="space-y-2">
                                    {approverList.map((a, idx) => {
                                        const u = users.find(usr => usr.id === a.userId);
                                        return (
                                            <div key={idx} className="flex items-center gap-2 p-2.5 bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 rounded-xl">
                                                <div className="w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center text-xs font-black">{idx + 1}</div>
                                                <span className="flex-1 text-sm font-bold text-slate-700 dark:text-slate-200">{u?.name || 'N/A'}</span>
                                                <span className="text-[10px] text-slate-400">{u?.role}</span>
                                                <button onClick={() => removeApprover(idx)} className="p-1 text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition">
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <div className="flex gap-2">
                                        <select id="approver-select"
                                            className="flex-1 px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                            defaultValue="">
                                            <option value="">-- Chọn người duyệt --</option>
                                            {users.filter(u => u.id !== user.id && !approverList.some(a => a.userId === u.id)).map(u => (
                                                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                                            ))}
                                        </select>
                                        <button onClick={() => {
                                            const sel = (document.getElementById('approver-select') as HTMLSelectElement);
                                            if (sel.value) { addApprover(sel.value); sel.value = ''; }
                                        }}
                                            className="px-4 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition shadow-lg shadow-violet-500/20">
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                    {approverList.length === 0 && (
                                        <p className="text-[10px] text-slate-400 text-center py-2">Chưa có người duyệt. Thêm ít nhất 1 người.</p>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mức ưu tiên</label>
                                    <select value={newPriority} onChange={e => setNewPriority(e.target.value as RQPriority)}
                                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm">
                                        <option value="low">Thấp</option>
                                        <option value="medium">Trung bình</option>
                                        <option value="high">Cao</option>
                                        <option value="urgent">Khẩn cấp</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Hạn xử lý</label>
                                    {selectedCategory?.slaHours ? (
                                        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700 rounded-xl text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
                                            <Clock size={14} />
                                            <span className="font-bold">Tự động: +{selectedCategory.slaHours} giờ</span>
                                        </div>
                                    ) : (
                                        <input type="datetime-local" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm" />
                                    )}
                                </div>
                            </div>

                            {/* Custom Fields */}
                            {selectedFields.length > 0 && (
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                                    <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider">Thông tin bổ sung</p>
                                    {selectedFields.map(field => (
                                        <div key={field.id}>
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                                {field.label} {field.required && <span className="text-red-500">*</span>}
                                            </label>
                                            {field.type === 'text' && (
                                                <input type="text" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" />
                                            )}
                                            {field.type === 'textarea' && (
                                                <textarea value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    placeholder={field.placeholder || ''} rows={2}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm resize-none" />
                                            )}
                                            {field.type === 'number' && (
                                                <input type="number" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm" />
                                            )}
                                            {field.type === 'date' && (
                                                <input type="date" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm" />
                                            )}
                                            {field.type === 'select' && (
                                                <select value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm">
                                                    <option value="">-- Chọn --</option>
                                                    {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                </select>
                                            )}
                                            {field.type === 'file' && (
                                                <FileFieldInput value={customFormData[field.name]} onChange={val => setCustomFormData(p => ({ ...p, [field.name]: val }))} disabled={false} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm transition">Hủy</button>
                            <button onClick={handleCreate} disabled={!selectedCategoryId || !newTitle.trim() || approverList.length === 0}
                                className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20">
                                <Send size={14} className="inline mr-1.5" /> Gửi yêu cầu
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirm */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa phiếu yêu cầu?</h2>
                        <p className="text-sm text-slate-500 mb-6">Hành động này không thể hoàn tác.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Confirm */}
            {cancelConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
                        <h2 className="text-lg font-bold text-amber-600 mb-2">Hủy phiếu yêu cầu?</h2>
                        <p className="text-sm text-slate-500 mb-6">Phiếu sẽ được đánh dấu là đã hủy.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setCancelConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm">Không</button>
                            <button onClick={() => handleCancel(cancelConfirmId)} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-600 transition shadow-lg shadow-amber-500/20">Hủy phiếu</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RequestList;
