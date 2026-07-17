import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useRequest } from '../../context/RequestContext';
import { useApp } from '../../context/AppContext';
import { RQStatus, RQPriority, Role, RequestInstance, WorkflowCustomField, RequestApprover, RequestPrintTemplate } from '../../types';
import {
    Inbox, Plus, Search, Clock, CheckCircle, XCircle, AlertCircle,
    ArrowRight, User, FileText, Filter, X, ChevronDown, ChevronUp,
    Send, Eye, Trash2, Ban, MessageSquare, PlayCircle, Edit2, Save,
    Upload, Paperclip, Download, Table2, FileSpreadsheet, Zap, AlertTriangle, Shield,
    LayoutGrid, List as ListIcon, GripVertical, Printer, CheckSquare, Square, Loader2
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { supabase } from '../../lib/supabase';
import { useCelebration } from '../../components/Celebration';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';

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
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-550 dark:bg-slate-800/50 rounded-xl text-sm">
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
                            isRejected ? 'bg-red-100 text-red-750 dark:bg-red-900/30 dark:text-red-300' :
                            isCurrent ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 ring-1 ring-amber-300 animate-pulse' :
                            'bg-slate-100 text-slate-450 dark:bg-slate-700 dark:text-slate-500'
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
    const location = useLocation();
    const { categories, requests, createRequest, updateRequest, deleteRequest,
        approveRequest, rejectRequest, completeRequest, cancelRequest,
        getRequestLogs, getCurrentApproverStep, getRQPrintTemplates } = useRequest();
    const { user, users } = useApp();
    const { celebrate, showToast: celebrationToast } = useCelebration();

    const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'all'>('mine');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
    const [boardSelectedId, setBoardSelectedId] = useState<string | null>(null);
    const requestRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // Batch operations
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchProcessing, setBatchProcessing] = useState(false);
    const [showBatchConfirm, setShowBatchConfirm] = useState<'approve' | 'reject' | null>(null);

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
        celebrationToast({ type, title: text });
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

    const targetRequestId = useMemo(() => new URLSearchParams(location.search).get('requestId'), [location.search]);

    useEffect(() => {
        if (!targetRequestId) return;
        const target = requests.find(request => request.id === targetRequestId);
        if (!target) return;

        setViewMode('list');
        setFilterStatus('ALL');
        setSearchTerm('');
        setExpandedId(target.id);

        if (canApprove(target)) setActiveTab('pending');
        else if (target.createdBy === user.id) setActiveTab('mine');
        else if (user.role === Role.ADMIN) setActiveTab('all');

        window.requestAnimationFrame(() => {
            requestRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, [requests, targetRequestId, user.id, user.role]);

    const filteredRequests = useMemo(() => {
        let list = requests;

        if (activeTab === 'mine') {
            list = list.filter(r => r.createdBy === user.id);
        } else if (activeTab === 'pending') {
            list = list.filter(r => canApprove(r));
        }

        if (filterStatus !== 'ALL') list = list.filter(r => r.status === filterStatus);
        if (searchTerm) {
            list = list.filter(r => matchesSearchQueryMultiple([r.code, r.title], searchTerm));
        }
        return list;
    }, [requests, activeTab, filterStatus, searchTerm, user, categories]);

    const activeRequestId = useMemo(() => {
        if (expandedId && filteredRequests.some(r => r.id === expandedId)) {
            return expandedId;
        }
        return filteredRequests[0]?.id || null;
    }, [expandedId, filteredRequests]);

    const activeRequest = useMemo(() => {
        return requests.find(r => r.id === activeRequestId) || null;
    }, [requests, activeRequestId]);

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
        if (ok) {
            // 🎉 Celebration for approval!
            if (label.includes('duyệt')) {
                celebrate({
                    variant: 'approve',
                    title: '✅ Đã Duyệt Thành Công!',
                    subtitle: requests.find(r => r.id === id)?.title || '',
                    confetti: true,
                });
            } else if (label.includes('từ chối')) {
                celebrationToast({ type: 'warning', title: label });
            } else {
                showToast('success', label);
            }
        } else {
            showToast('error', 'Thao tác thất bại');
        }
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

    // ==================== BATCH OPERATIONS ====================
    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        const approvable = filteredRequests.filter(r => canApprove(r));
        if (selectedIds.size === approvable.length && approvable.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(approvable.map(r => r.id)));
        }
    };

    const handleBatchAction = async (action: 'approve' | 'reject') => {
        setBatchProcessing(true);
        setShowBatchConfirm(null);
        let success = 0, fail = 0;
        const ids = Array.from(selectedIds);
        for (const id of ids) {
            const actionFn = action === 'approve' ? approveRequest : rejectRequest;
            const ok = await actionFn(id, user.id, action === 'approve' ? 'Duyệt hàng loạt' : 'Từ chối hàng loạt');
            if (ok) success++; else fail++;
        }
        setBatchProcessing(false);
        setSelectedIds(new Set());
        if (success > 0) {
            celebrate({
                variant: action === 'approve' ? 'approve' : 'reject',
                title: action === 'approve' ? `✅ Đã duyệt ${success} phiếu!` : `❌ Đã từ chối ${success} phiếu`,
                subtitle: fail > 0 ? `${fail} phiếu thất bại` : '',
                confetti: action === 'approve',
            });
        }
        if (fail > 0 && success === 0) showToast('error', 'Thao tác thất bại');
    };

    const addApprover = (userId: string) => {
        if (!userId || approverList.some(a => a.userId === userId)) return;
        setApproverList(prev => [...prev, { userId }]);
    };

    const removeApprover = (idx: number) => {
        setApproverList(prev => prev.filter((_, i) => i !== idx));
    };

    // ==================== WORD EXPORT ====================
    const handleRQExportWord = async (req: RequestInstance, pt: RequestPrintTemplate) => {
        try {
            const { data: fileData, error } = await supabase.storage.from('workflow-templates').download(pt.storagePath);
            if (error || !fileData) { alert('Không tải được file mẫu.'); return; }

            // Prepare image module for signatures
            let ImageModule: any = null;
            try { ImageModule = (await import('open-docxtemplater-image-module')).default; } catch { }

            const imageMap: Record<string, ArrayBuffer> = {};
            // Collect approver signatures
            if (req.approvers) {
                for (const a of req.approvers) {
                    const aUser = users.find(u => u.id === a.userId);
                    if (!aUser?.signatureUrl) continue;
                    try {
                        const sigRes = await fetch(aUser.signatureUrl);
                        if (sigRes.ok) imageMap[`signature_${a.order}`] = await sigRes.arrayBuffer();
                    } catch { }
                }
            }
            // Creator signature
            const creator = users.find(u => u.id === req.createdBy);
            if (creator?.signatureUrl) {
                try {
                    const sigRes = await fetch(creator.signatureUrl);
                    if (sigRes.ok) imageMap['signature_creator'] = await sigRes.arrayBuffer();
                } catch { }
            }

            const arrayBuffer = await fileData.arrayBuffer();
            const zip = new PizZip(arrayBuffer);

            const modules: any[] = [];
            if (ImageModule && Object.keys(imageMap).length > 0) {
                const imgModule = new ImageModule({
                    centered: false,
                    getImage: (tagValue: string) => imageMap[tagValue] || new ArrayBuffer(0),
                    getSize: () => [150, 60],
                });
                modules.push(imgModule);
            }

            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '${', end: '}' }, modules });

            const cat = categories.find(c => c.id === req.categoryId);
            const createdDate = new Date(req.createdAt);
            const statusLabels: Record<string, string> = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', IN_PROGRESS: 'Đang xử lý', DONE: 'Hoàn thành', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy' };

            const data: Record<string, any> = {
                code: req.code || '', title: req.title || '', description: req.description || '',
                creator_name: creator?.name || '', creator_email: creator?.email || '',
                created_at_day: String(createdDate.getDate()).padStart(2, '0'),
                created_at_month: String(createdDate.getMonth() + 1).padStart(2, '0'),
                created_at_year: String(createdDate.getFullYear()),
                created_at_full: createdDate.toLocaleDateString('vi-VN'),
                category_name: cat?.name || '', priority: req.priority || '',
                status: statusLabels[req.status] || req.status,
                due_date: req.dueDate ? new Date(req.dueDate).toLocaleDateString('vi-VN') : '',
            };

            // Add signature keys
            Object.keys(imageMap).forEach(key => { data[key] = key; });

            // Form data
            if (req.formData) {
                Object.entries(req.formData).forEach(([key, value]) => {
                    if (typeof value === 'object' && value !== null) { if ((value as any).fileName) data[key] = (value as any).fileName; }
                    else data[key] = String(value ?? '');
                });
            }

            // Approvers
            if (req.approvers) {
                req.approvers.forEach(a => {
                    const aUser = users.find(u => u.id === a.userId);
                    data[`approver_${a.order}`] = aUser?.name || '';
                    data[`approver_${a.order}_status`] = a.status === 'approved' ? 'Đã duyệt' : a.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt';
                    if ((a as any).approvedAt) data[`approved_date_${a.order}`] = new Date((a as any).approvedAt).toLocaleDateString('vi-VN');
                });
            }

            doc.render(data);
            const output = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            saveAs(output, `${req.code}_${pt.name}.docx`);
        } catch (err: any) {
            console.error('RQ Export Word error:', err);
            alert('Lỗi khi xuất Word: ' + (err.message || 'Không xác định'));
        }
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
        return <span className="text-sm text-slate-700 dark:text-slate-350">{String(value)}</span>;
    };

    return (
        <div className={viewMode === 'list' ? "h-full w-full flex bg-slate-100 dark:bg-slate-950 overflow-hidden relative select-none" : "space-y-6 p-4 sm:p-6 md:p-8"}>
            {/* Toast */}
            {toast && (
                <div className={`fixed top-6 right-6 z-[60] px-5 py-3.5 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-fade-in-down ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    {toast.text}
                    <button onClick={() => setToast(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded"><X size={14} /></button>
                </div>
            )}

            {/* ==================== LIST VIEW (3-PANEL WORKSPACE) ==================== */}
            {viewMode === 'list' && (
                <>
                    {/* PANEL 1: Categories & Status Sidebar (Width: 260px) */}
                    <aside className="w-[260px] bg-slate-50 border-r border-slate-200 dark:bg-[#2b2d31] dark:border-slate-800 flex flex-col h-full shrink-0">
                        {/* Title Header */}
                        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4">
                            <div className="flex items-center gap-2 min-w-0">
                                <Inbox className="text-accent shrink-0" size={18} />
                                <span className="text-sm font-black text-slate-800 dark:text-white truncate">Đề xuất & Phê duyệt</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedCategoryId('');
                                    setNewTitle('');
                                    setNewDesc('');
                                    setNewPriority('medium');
                                    setCustomFormData({});
                                    setNewDueDate('');
                                    setApproverList([]);
                                    setShowCreateModal(true);
                                }}
                                disabled={activeCategories.length === 0}
                                title="Tạo đề xuất mới"
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white hover:bg-emerald-600 transition disabled:opacity-50"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        {/* View Tabs */}
                        <div className="p-3 shrink-0 space-y-1">
                            {([
                                { id: 'mine', label: 'Phiếu của tôi', icon: User },
                                { id: 'pending', label: 'Chờ tôi duyệt', icon: Clock },
                                ...(user.role === Role.ADMIN ? [{ id: 'all', label: 'Tất cả đề xuất', icon: Inbox }] : []),
                            ] as { id: string; label: string; icon: any }[]).map(tab => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                const pendingCountVal = tab.id === 'pending' ? requests.filter(r => canApprove(r)).length : 0;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => { setActiveTab(tab.id as any); setExpandedId(null); }}
                                        className={`flex items-center justify-between w-full px-3 py-2 rounded-xl text-xs font-bold transition select-none ${
                                            isActive
                                                ? 'bg-indigo-50 dark:bg-[#35373c] text-indigo-650 dark:text-white font-black'
                                                : 'text-slate-600 dark:text-[#949ba4] hover:bg-slate-200/60 dark:hover:bg-[#2e3035] hover:text-slate-900 dark:hover:text-[#dbdee1]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Icon size={14} className="shrink-0" />
                                            <span className="truncate">{tab.label}</span>
                                        </div>
                                        {pendingCountVal > 0 && (
                                            <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black shrink-0">
                                                {pendingCountVal}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Status Filters */}
                        <div className="px-3 pb-3 border-b border-slate-200 dark:border-slate-800 shrink-0 space-y-1">
                            <p className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider px-2 py-1 select-none">Trạng thái</p>
                            <button
                                onClick={() => setFilterStatus('ALL')}
                                className={`w-full px-3 py-1.5 rounded-lg text-left text-[11px] font-bold transition flex items-center justify-between ${
                                    filterStatus === 'ALL'
                                        ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white'
                                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-800 dark:hover:text-slate-300'
                                }`}
                            >
                                <span>Tất cả</span>
                                <span className="text-[9px] opacity-60">({requests.filter(r => activeTab === 'all' || (activeTab === 'mine' && r.createdBy === user.id) || (activeTab === 'pending' && canApprove(r))).length})</span>
                            </button>
                            {Object.entries(STATUS_MAP).map(([s, config]) => {
                                const count = requests.filter(r => {
                                    let matchTab = true;
                                    if (activeTab === 'mine') matchTab = r.createdBy === user.id;
                                    else if (activeTab === 'pending') matchTab = canApprove(r);
                                    return matchTab && r.status === s;
                                }).length;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setFilterStatus(s)}
                                        className={`w-full px-3 py-1.5 rounded-lg text-left text-[11px] font-bold transition flex items-center justify-between ${
                                            filterStatus === s
                                                ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white'
                                                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-800 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        <span className="truncate">{config.label}</span>
                                        {count > 0 && <span className="text-[9px] opacity-60">({count})</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Categories List */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider px-2 py-1 select-none">
                                <span>Nhóm đề xuất</span>
                            </div>
                            {activeCategories.map(cat => {
                                const count = requests.filter(r => {
                                    let matchTab = true;
                                    if (activeTab === 'mine') matchTab = r.createdBy === user.id;
                                    else if (activeTab === 'pending') matchTab = canApprove(r);
                                    let matchStatus = filterStatus === 'ALL' ? true : r.status === filterStatus;
                                    return matchTab && matchStatus && r.categoryId === cat.id;
                                }).length;
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => {
                                            setSelectedCategoryId(selectedCategoryId === cat.id ? '' : cat.id);
                                        }}
                                        className={`w-full px-3 py-2 rounded-xl text-left text-xs font-bold transition flex items-center justify-between gap-2 ${
                                            selectedCategoryId === cat.id
                                                ? 'bg-indigo-50 dark:bg-[#35373c] text-indigo-655 dark:text-white font-bold shadow-sm'
                                                : 'text-slate-600 dark:text-[#949ba4] hover:bg-slate-200/60 dark:hover:bg-[#2e3035] hover:text-slate-900 dark:hover:text-[#dbdee1]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${cat.color} shrink-0`} />
                                            <span className="truncate text-xs">{cat.name}</span>
                                        </div>
                                        {count > 0 && (
                                            <span className="text-[9px] opacity-65 shrink-0">
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Switch to Kanban Button */}
                        <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
                            <button
                                onClick={() => setViewMode('board')}
                                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-355 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-xs font-bold transition"
                            >
                                <LayoutGrid size={13} /> Chuyển sang Kanban Board
                            </button>
                        </div>
                    </aside>

                    {/* PANEL 2: Master Request List (Width: 380px) */}
                    <section className="w-[380px] bg-white dark:bg-[#1e1f22] border-r border-slate-200 dark:border-slate-800 flex flex-col h-full shrink-0">
                        {/* Search and Batch Panel */}
                        <div className="p-3 shrink-0 border-b border-slate-200 dark:border-slate-800 space-y-2">
                            <div className="flex h-9 items-center gap-2 rounded-lg bg-slate-100 dark:bg-[#313338] px-2.5 text-slate-500 dark:text-slate-400">
                                <Search size={14} />
                                <input
                                    value={searchTerm}
                                    onChange={event => setSearchTerm(event.target.value)}
                                    placeholder="Tìm theo mã hoặc tiêu đề..."
                                    className="h-full min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-850 dark:text-[#dbdee1] outline-none placeholder:text-slate-400 dark:placeholder:text-slate-555"
                                />
                            </div>

                            {activeTab === 'pending' && filteredRequests.filter(r => canApprove(r)).length > 0 && (
                                <div className="flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 p-2 rounded-lg select-none">
                                    <button
                                        onClick={toggleSelectAll}
                                        className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300"
                                    >
                                        {selectedIds.size === filteredRequests.filter(r => canApprove(r)).length
                                            ? <CheckSquare size={16} className="text-indigo-500" />
                                            : <Square size={16} className="text-slate-300 dark:text-slate-600" />}
                                        <span>Chọn tất cả ({filteredRequests.filter(r => canApprove(r)).length})</span>
                                    </button>
                                    {selectedIds.size > 0 && (
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={() => setShowBatchConfirm('approve')}
                                                className="px-2.5 py-1 bg-emerald-500 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-650"
                                            >
                                                Duyệt
                                            </button>
                                            <button
                                                onClick={() => setShowBatchConfirm('reject')}
                                                className="px-2.5 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold hover:bg-red-650"
                                            >
                                                Từ chối
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Request Cards */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50/50 dark:bg-slate-900/10">
                            {filteredRequests.map(req => {
                                const cat = categories.find(c => c.id === req.categoryId);
                                const creator = users.find(u => u.id === req.createdBy);
                                const status = STATUS_MAP[req.status] || STATUS_MAP.PENDING;
                                const priority = PRIORITY_MAP[req.priority] || PRIORITY_MAP.medium;
                                const isActiveCard = req.id === activeRequestId;

                                // Sidebar category filter check
                                if (selectedCategoryId && req.categoryId !== selectedCategoryId) return null;

                                return (
                                    <div
                                        key={req.id}
                                        ref={el => { requestRefs.current[req.id] = el; }}
                                        onClick={() => setExpandedId(req.id)}
                                        className={`p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                                            isActiveCard
                                                ? 'bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-500 dark:border-indigo-650 shadow-md ring-1 ring-indigo-500/20'
                                                : 'bg-white hover:bg-slate-50/30 dark:bg-[#1e1f22] dark:hover:bg-[#2e3035] border-slate-200 dark:border-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                            <span className="font-mono text-[9px] font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{req.code}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${status.color} flex items-center gap-0.5`}>
                                                <status.icon size={8} /> {status.label}
                                            </span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${priority.color}`}>{priority.label}</span>
                                            {cat && <span className="text-[9px] text-slate-400 font-medium truncate max-w-[120px]">{cat.name}</span>}
                                        </div>
                                        <h3 className="font-bold text-xs text-slate-800 dark:text-white leading-snug mb-2 line-clamp-2">{req.title}</h3>
                                        
                                        <div className="flex items-center justify-between text-[10px] text-slate-450 dark:text-slate-400">
                                            <span className="flex items-center gap-1"><User size={9} /> {creator?.name || 'N/A'}</span>
                                            <span className="flex items-center gap-1"><Clock size={9} /> {new Date(req.createdAt).toLocaleDateString('vi-VN')}</span>
                                        </div>

                                        {req.dueDate && (() => {
                                            const now = new Date();
                                            const due = new Date(req.dueDate);
                                            const isOverdue = now > due && !['DONE', 'CANCELLED', 'REJECTED'].includes(req.status);
                                            return (
                                                <div className={`mt-2 text-[9px] font-bold ${isOverdue ? 'text-red-500 animate-pulse' : 'text-slate-450 dark:text-slate-400'}`}>
                                                    SLA Hạn: {due.toLocaleString('vi-VN')} {isOverdue && '(QUÁ HẠN!)'}
                                                </div>
                                            );
                                        })()}

                                        {/* Progress Circles */}
                                        {req.approvers && req.approvers.length > 0 && (
                                            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center gap-1 flex-wrap">
                                                {req.approvers.map((step, idx) => {
                                                    const isApproved = step.status === 'approved';
                                                    const isRejected = step.status === 'rejected';
                                                    const isWaiting = step.status === 'waiting';
                                                    const isCurrent = isWaiting && (idx === 0 || req.approvers[idx - 1]?.status === 'approved');
                                                    return (
                                                        <span
                                                            key={idx}
                                                            title={`Bước ${step.order}: ${users.find(u => u.id === step.userId)?.name}`}
                                                            className={`w-2 h-2 rounded-full border ${
                                                                isApproved ? 'bg-emerald-500 border-emerald-600' :
                                                                isRejected ? 'bg-red-500 border-red-600' :
                                                                isCurrent ? 'bg-amber-400 border-amber-500 animate-pulse' :
                                                                'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-650'
                                                            }`}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {filteredRequests.length === 0 && (
                                <div className="text-center py-20 opacity-60">
                                    <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                    <p className="text-xs text-slate-500 font-bold">Không tìm thấy phiếu yêu cầu nào</p>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* PANEL 3: Detailed Request & Actions View (Flex-1) */}
                    <main className="flex-1 bg-white dark:bg-[#313338] flex flex-col h-full overflow-hidden relative">
                        {activeRequest ? (() => {
                            const req = activeRequest;
                            const cat = categories.find(c => c.id === req.categoryId);
                            const creator = users.find(u => u.id === req.createdBy);
                            const status = STATUS_MAP[req.status] || STATUS_MAP.PENDING;
                            const priority = PRIORITY_MAP[req.priority] || PRIORITY_MAP.medium;
                            const reqLogs = getRequestLogs(req.id);
                            const isPending = canApprove(req);
                            const isOwner = req.createdBy === user.id;

                            return (
                                <>
                                    {/* Panel Header */}
                                    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="font-mono text-[10px] font-black text-slate-400">{req.code}</span>
                                                <span className="text-[10px] text-slate-400 font-bold">•</span>
                                                <span className="text-[10px] text-indigo-650 dark:text-indigo-400 font-black">{cat?.name}</span>
                                            </div>
                                            <h2 className="text-sm font-black text-slate-800 dark:text-white truncate">{req.title}</h2>
                                        </div>

                                        <div className="flex items-center gap-2 select-none">
                                            {/* Word template export */}
                                            {(() => {
                                                const templates = getRQPrintTemplates(req.categoryId);
                                                return templates.map(pt => (
                                                    <button
                                                        key={pt.id}
                                                        onClick={() => handleRQExportWord(req, pt)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 dark:bg-violet-900/20 text-violet-650 dark:text-violet-400 rounded-xl font-bold text-xs hover:bg-violet-100 dark:hover:bg-violet-900/40 transition border border-violet-200 dark:border-violet-850 shrink-0"
                                                    >
                                                        <Printer size={13} /> {pt.name}
                                                    </button>
                                                ));
                                            })()}

                                            {/* Recall/Cancel */}
                                            {isOwner && req.status === RQStatus.PENDING && (
                                                <button
                                                    onClick={() => setCancelConfirmId(req.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded-xl font-bold text-xs transition border border-amber-200 dark:border-amber-850"
                                                >
                                                    <Ban size={13} /> Hủy phiếu
                                                </button>
                                            )}

                                            {/* Delete */}
                                            {isOwner && (req.status === RQStatus.DRAFT || (req.status === RQStatus.PENDING && (user.role === Role.ADMIN || !req.approvers?.some(a => a.status === 'approved')))) && (
                                                <button
                                                    onClick={() => setDeleteConfirmId(req.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 text-red-650 dark:text-red-400 rounded-xl font-bold text-xs transition border border-red-200 dark:border-red-850"
                                                >
                                                    <Trash2 size={13} /> Xóa
                                                </button>
                                            )}
                                        </div>
                                    </header>

                                    {/* Scrollable Detailed Area */}
                                    <div className="flex-1 overflow-hidden flex divide-x divide-slate-200 dark:divide-slate-800">
                                        {/* Left half: Form info & details */}
                                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                            {/* General Metadata */}
                                            <div className="bg-slate-50 dark:bg-[#1e1f22] border border-slate-150 dark:border-slate-800/80 p-4 rounded-2xl grid grid-cols-2 gap-4 text-xs">
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-1">Người tạo đề xuất</span>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-650 dark:text-slate-355">
                                                            {creator?.name?.slice(0, 1) || 'U'}
                                                        </div>
                                                        <span className="font-bold text-slate-800 dark:text-slate-200">{creator?.name}</span>
                                                    </div>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-1">Thời gian tạo</span>
                                                    <span className="font-bold text-slate-700 dark:text-slate-200">{new Date(req.createdAt).toLocaleString('vi-VN')}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-1">Trạng thái đề xuất</span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} inline-flex items-center gap-1`}>
                                                        <status.icon size={10} /> {status.label}
                                                    </span>
                                                </div>
                                                {req.dueDate && (() => {
                                                    const now = new Date();
                                                    const due = new Date(req.dueDate);
                                                    const isOverdue = now > due && !['DONE', 'CANCELLED', 'REJECTED'].includes(req.status);
                                                    const diffMs = due.getTime() - now.getTime();
                                                    const diffH = Math.abs(Math.round(diffMs / (1000 * 60 * 60) * 10) / 10);
                                                    return (
                                                        <div>
                                                            <span className="text-slate-400 font-bold block mb-1">Hạn xử lý (SLA)</span>
                                                            <span className={`font-bold ${isOverdue ? 'text-red-500 animate-pulse' : 'text-amber-500'}`}>
                                                                {isOverdue ? `Quá hạn ${diffH}h` : `Còn ${diffH}h`} ({due.toLocaleDateString('vi-VN')})
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                            </div>

                                            {/* Description */}
                                            {req.description && (
                                                <div className="space-y-1.5">
                                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lý do đề xuất</h3>
                                                    <div className="text-sm text-slate-755 dark:text-slate-200 whitespace-pre-wrap bg-slate-50 dark:bg-[#1e1f22]/30 border border-slate-100 dark:border-slate-805 p-4 rounded-xl leading-relaxed">
                                                        {req.description}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Custom form fields */}
                                            {cat?.customFields && cat.customFields.length > 0 && (
                                                <div className="space-y-3">
                                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thông tin chi tiết</h3>
                                                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/20 dark:bg-slate-900/10">
                                                        {cat.customFields.map(field => (
                                                            <div key={field.id} className="p-3.5 flex items-start gap-4">
                                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-32 shrink-0">{field.label}:</span>
                                                                <div className="flex-1 text-xs text-slate-800 dark:text-slate-200 font-semibold break-words">
                                                                    {renderCustomFieldValue(field, req.formData[field.name])}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Timeline Audit Logs */}
                                            {reqLogs.length > 0 && (
                                                <div className="space-y-3">
                                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lịch sử hoạt động</h3>
                                                    <div className="space-y-3 bg-slate-50/50 dark:bg-[#1e1f22]/25 border border-slate-100 dark:border-slate-800/80 p-4 rounded-2xl">
                                                        {reqLogs.map(log => {
                                                            const actor = users.find(u => u.id === log.actedBy);
                                                            return (
                                                                <div key={log.id} className="flex gap-3 text-xs leading-normal">
                                                                    <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                                                                        <MessageSquare size={12} className="text-slate-555" />
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex justify-between items-center flex-wrap gap-1">
                                                                            <span className="font-bold text-slate-750 dark:text-slate-200">{actor?.name || 'Hệ thống'}</span>
                                                                            <span className="text-[10px] text-slate-400 font-medium">{new Date(log.createdAt).toLocaleString('vi-VN')}</span>
                                                                        </div>
                                                                        <p className="text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                                                            Hành động: <span className="font-bold text-blue-500">{log.action}</span>
                                                                            {log.comment && <span className="italic block mt-1 text-slate-650 dark:text-slate-350">"{log.comment}"</span>}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Right half: Approver flow and Action Box */}
                                        <div className="w-[340px] bg-slate-50/50 dark:bg-[#2b2d31]/30 flex flex-col h-full overflow-y-auto p-6 shrink-0 space-y-6">
                                            {/* Approvers Workflow timeline */}
                                            {req.approvers && req.approvers.length > 0 && (
                                                <div className="space-y-3.5">
                                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tiến trình phê duyệt</h3>
                                                    <div className="relative border-l-2 border-slate-200 dark:border-slate-750 pl-5 ml-3.5 space-y-5 py-1">
                                                        {[...req.approvers].sort((a, b) => a.order - b.order).map((step, idx) => {
                                                            const approverUser = users.find(u => u.id === step.userId);
                                                            const isApproved = step.status === 'approved';
                                                            const isRejected = step.status === 'rejected';
                                                            const isWaiting = step.status === 'waiting';
                                                            const isCurrent = isWaiting && (idx === 0 || req.approvers[idx - 1]?.status === 'approved');

                                                            return (
                                                                <div key={step.order} className="relative flex gap-3.5">
                                                                    <div className={`absolute -left-[30px] top-0.5 w-4.5 h-4.5 rounded-full flex items-center justify-center text-white ring-4 ring-slate-50 dark:ring-[#2b2d31]/50 ${
                                                                        isApproved ? 'bg-emerald-500' :
                                                                        isRejected ? 'bg-red-500' :
                                                                        isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-slate-300 dark:bg-slate-650'
                                                                    }`}>
                                                                        {isApproved ? <CheckCircle size={10} /> :
                                                                         isRejected ? <XCircle size={10} /> : <Clock size={10} />}
                                                                    </div>

                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="text-xs font-black text-slate-800 dark:text-white truncate">{approverUser?.name || 'N/A'}</span>
                                                                            <span className="text-[9px] text-slate-400 bg-slate-200/50 dark:bg-slate-800 px-1 rounded font-bold shrink-0">{step.order}</span>
                                                                        </div>
                                                                        <p className="text-[10px] text-slate-450 dark:text-slate-400 font-medium truncate">{approverUser?.role || 'Người duyệt'}</p>
                                                                        
                                                                        {isApproved && <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold">Đã duyệt</span>}
                                                                        {isRejected && <span className="text-[9px] text-red-500 font-bold">Từ chối</span>}
                                                                        {isCurrent && <span className="text-[9px] text-amber-500 font-bold animate-pulse">Đang chờ duyệt</span>}

                                                                        {step.comment && (
                                                                            <p className="text-xs text-slate-505 italic mt-1 bg-white dark:bg-slate-850 p-2 rounded-lg border border-slate-100 dark:border-slate-800/80">
                                                                                "{step.comment}"
                                                                            </p>
                                                                        )}
                                                                        {step.actedAt && (
                                                                            <div className="text-[9px] text-slate-400 mt-1">
                                                                                {new Date(step.actedAt).toLocaleString('vi-VN')}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Action Decision box */}
                                            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                                                {isPending && (
                                                    <div className="space-y-3 bg-white dark:bg-[#1e1f22] p-4 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">Đưa ý kiến phản hồi</p>
                                                        
                                                        <textarea
                                                            value={actionComment}
                                                            onChange={e => setActionComment(e.target.value)}
                                                            placeholder="Nhập ý kiến (tùy chọn)..."
                                                            className="w-full px-3 py-2 bg-slate-50 dark:bg-[#313338] border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-accent resize-none font-medium text-slate-800 dark:text-slate-200"
                                                            rows={3}
                                                        />

                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleAction(req.id, approveRequest, 'Đã duyệt!')}
                                                                disabled={processingId === req.id}
                                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-xs hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                                                            >
                                                                <CheckCircle size={13} /> Duyệt
                                                            </button>
                                                            <button
                                                                onClick={() => handleAction(req.id, rejectRequest, 'Đã từ chối!')}
                                                                disabled={processingId === req.id}
                                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-500 text-white rounded-xl font-bold text-xs hover:bg-[#b91c1c] transition shadow-lg shadow-red-500/20 disabled:opacity-50"
                                                            >
                                                                <XCircle size={13} /> Từ chối
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {req.status === RQStatus.APPROVED && (user.role === Role.ADMIN || req.createdBy === user.id) && (
                                                    <button
                                                        onClick={() => handleAction(req.id, completeRequest, 'Hoàn thành!')}
                                                        disabled={processingId === req.id}
                                                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-xs hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                                                    >
                                                        <CheckCircle size={14} /> Hoàn thành
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            );
                        })() : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-60 p-6 select-none">
                                <Inbox className="w-14 h-14 text-slate-300 dark:text-slate-700 mb-4" />
                                <p className="font-bold text-slate-500">Chưa chọn phiếu yêu cầu nào</p>
                                <p className="text-xs text-slate-400 mt-1">Vui lòng click vào các đề xuất từ danh sách ở giữa để hiển thị chi tiết.</p>
                            </div>
                        )}
                    </main>
                </>
            )}

            {/* ==================== KANBAN BOARD VIEW ==================== */}
            {viewMode === 'board' && (() => {
                const BOARD_COLUMNS: { status: RQStatus; label: string; color: string; headerBg: string }[] = [
                    { status: RQStatus.DRAFT, label: 'Nháp', color: 'border-slate-300', headerBg: 'from-slate-500 to-slate-600' },
                    { status: RQStatus.PENDING, label: 'Chờ duyệt', color: 'border-amber-300', headerBg: 'from-amber-500 to-orange-500' },
                    { status: RQStatus.APPROVED, label: 'Đã duyệt', color: 'border-blue-300', headerBg: 'from-blue-500 to-blue-600' },
                    { status: RQStatus.IN_PROGRESS, label: 'Đang xử lý', color: 'border-purple-300', headerBg: 'from-purple-500 to-violet-500' },
                    { status: RQStatus.DONE, label: 'Hoàn thành', color: 'border-emerald-300', headerBg: 'from-emerald-500 to-emerald-600' },
                    { status: RQStatus.REJECTED, label: 'Từ chối', color: 'border-red-300', headerBg: 'from-red-500 to-red-600' },
                ];

                const boardSelected = boardSelectedId ? requests.find(r => r.id === boardSelectedId) : null;

                return (
                    <div className="relative col-span-full">
                        {/* Header */}
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <div>
                                <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <Inbox className="text-accent" size={28} /> Phiếu yêu cầu
                                </h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Tạo và theo dõi các phiếu yêu cầu.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex bg-white/50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                                    <button onClick={() => setViewMode('list')}
                                        className={`px-3 py-2 flex items-center gap-1.5 text-xs font-bold transition ${(viewMode as string) === 'list' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                        <ListIcon size={14} /> Danh sách
                                    </button>
                                    <button onClick={() => setViewMode('board')}
                                        className={`px-3 py-2 flex items-center gap-1.5 text-xs font-bold transition ${(viewMode as string) === 'board' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                        <LayoutGrid size={14} /> Bảng
                                    </button>
                                </div>
                                <button onClick={() => setShowCreateModal(true)} disabled={activeCategories.length === 0}
                                    className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                    <Plus size={18} className="mr-2" /> Tạo phiếu mới
                                </button>
                            </div>
                        </div>

                        {/* Filters */}
                        <div className="glass-card p-4 rounded-xl space-y-3 mb-6">
                            <div className="flex gap-2">
                                {([
                                    { id: 'mine', label: 'Phiếu của tôi', icon: User },
                                    { id: 'pending', label: 'Chờ tôi duyệt', icon: Clock },
                                    ...(user.role === Role.ADMIN ? [{ id: 'all', label: 'Tất cả', icon: Inbox }] : []),
                                ] as { id: string; label: string; icon: any }[]).map(tab => (
                                    <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab === tab.id
                                            ? 'bg-accent text-white shadow-md'
                                            : 'bg-white/50 dark:bg-slate-800/50 text-slate-655 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700'
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

                        {/* Kanban Columns */}
                        <div className="flex gap-4 overflow-x-auto pb-4 px-1" style={{ minHeight: '60vh' }}>
                            {BOARD_COLUMNS.map(col => {
                                const colReqs = filteredRequests.filter(r => r.status === col.status);
                                return (
                                    <div key={col.status} className={`flex flex-col rounded-2xl overflow-hidden border ${col.color} dark:border-slate-700 shrink-0`}
                                        style={{ width: '300px', maxHeight: 'calc(100vh - 280px)' }}>
                                        {/* Column Header */}
                                        <div className={`px-4 py-3 bg-gradient-to-r ${col.headerBg} text-white`}>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-black uppercase tracking-wider">{col.label}</span>
                                                <span className="text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full">{colReqs.length}</span>
                                            </div>
                                        </div>
                                        {/* Cards */}
                                        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 bg-slate-50/50 dark:bg-slate-900/40">
                                            {colReqs.length === 0 && (
                                                <div className="flex flex-col items-center justify-center py-10 text-slate-300 dark:text-slate-600 opacity-50">
                                                    <FileText size={28} className="mb-2" />
                                                    <p className="text-[10px] font-bold uppercase tracking-wider">Không có phiếu</p>
                                                </div>
                                            )}
                                            {colReqs.map(req => {
                                                const cat = categories.find(c => c.id === req.categoryId);
                                                const creator = users.find(u => u.id === req.createdBy);
                                                const priority = PRIORITY_MAP[req.priority] || PRIORITY_MAP.medium;
                                                const isSelected = boardSelectedId === req.id;
                                                return (
                                                    <div key={req.id} onClick={() => setBoardSelectedId(isSelected ? null : req.id)}
                                                        className={`group rounded-xl border-l-4 bg-white dark:bg-slate-800 shadow-sm hover:shadow-lg cursor-pointer transition-all duration-200 hover:-translate-y-0.5 ${col.color} ${isSelected ? 'ring-2 ring-accent ring-offset-1' : ''}`}>
                                                        <div className="p-3.5">
                                                            <div className="flex items-start gap-2 mb-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <h4 className="text-[13px] font-bold text-slate-850 dark:text-white leading-tight line-clamp-2">{req.title}</h4>
                                                                    <span className="font-mono text-[9px] font-bold text-slate-400 mt-0.5 block">{req.code}</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center justify-between text-[10px] text-slate-450 dark:text-slate-400">
                                                                <span>{creator?.name}</span>
                                                                <span>{new Date(req.createdAt).toLocaleDateString('vi-VN')}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Footer */}
                                        <div className={`px-4 py-2 border-t ${col.color} dark:border-slate-700 bg-white/60 dark:bg-slate-800/60`}>
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{colReqs.length} phiếu</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Slide-in details Drawer */}
                        {boardSelected && (() => {
                            const cat = categories.find(c => c.id === boardSelected.categoryId);
                            const creator = users.find(u => u.id === boardSelected.createdBy);
                            const status = STATUS_MAP[boardSelected.status] || STATUS_MAP.PENDING;
                            const priority = PRIORITY_MAP[boardSelected.priority] || PRIORITY_MAP.medium;
                            const isPending = canApprove(boardSelected);
                            const isOwner = boardSelected.createdBy === user.id;

                            return (
                                <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setBoardSelectedId(null)}>
                                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
                                        {/* Panel Header */}
                                        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white flex items-center justify-between">
                                            <div>
                                                <p className="font-mono text-[10px] font-bold opacity-80">{boardSelected.code}</p>
                                                <h3 className="font-bold text-lg">{boardSelected.title}</h3>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isPending && (
                                                    <>
                                                        <button onClick={() => handleAction(boardSelected.id, approveRequest, 'Đã duyệt!')}
                                                            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold flex items-center gap-1 transition"><CheckCircle size={14} /> Duyệt</button>
                                                        <button onClick={() => handleAction(boardSelected.id, rejectRequest, 'Đã từ chối!')}
                                                            className="px-3 py-1.5 bg-red-500/60 hover:bg-red-550/80 rounded-lg text-xs font-bold flex items-center gap-1 transition"><XCircle size={14} /> Từ chối</button>
                                                    </>
                                                )}
                                                {isOwner && boardSelected.status === RQStatus.PENDING && (
                                                    <button onClick={() => setCancelConfirmId(boardSelected.id)}
                                                        className="px-3 py-1.5 bg-amber-500/60 hover:bg-amber-500/80 rounded-lg text-xs font-bold flex items-center gap-1 transition"><Ban size={14} /> Hủy</button>
                                                )}
                                                <button onClick={() => setBoardSelectedId(null)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition"><X size={18} /></button>
                                            </div>
                                        </div>
                                        {/* Panel Body */}
                                        <div className="p-6 space-y-4">
                                            <div className="flex flex-wrap gap-2">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.color} flex items-center gap-1`}><status.icon size={10} /> {status.label}</span>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${priority.color}`}>{priority.label}</span>
                                                {cat && <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded font-bold">{cat.name}</span>}
                                            </div>
                                            {boardSelected.description && <p className="text-sm text-slate-650 dark:text-slate-400">{boardSelected.description}</p>}
                                            <div className="grid grid-cols-2 gap-3 text-xs">
                                                <div><span className="text-slate-400 font-bold block mb-0.5">Người tạo</span><span className="font-bold text-slate-700 dark:text-slate-200">{creator?.name || 'N/A'}</span></div>
                                                <div><span className="text-slate-400 font-bold block mb-0.5">Ngày tạo</span><span className="font-bold text-slate-700 dark:text-slate-200">{new Date(boardSelected.createdAt).toLocaleString('vi-VN')}</span></div>
                                                {boardSelected.dueDate && <div><span className="text-slate-400 font-bold block mb-0.5">SLA</span><span className="font-bold text-slate-700 dark:text-slate-200">{new Date(boardSelected.dueDate).toLocaleString('vi-VN')}</span></div>}
                                            </div>
                                            {/* Word template export inside Board panel */}
                                            {(() => {
                                                const pts = getRQPrintTemplates(boardSelected.categoryId);
                                                if (pts.length === 0) return null;
                                                return (
                                                    <div className="flex flex-wrap gap-2">
                                                        {pts.map(pt => (
                                                            <button key={pt.id} onClick={() => handleRQExportWord(boardSelected, pt)}
                                                                className="flex items-center gap-1.5 px-3 py-2 bg-violet-50 dark:bg-violet-900/20 text-violet-650 dark:text-violet-400 rounded-xl font-bold text-xs hover:bg-violet-100 dark:hover:bg-violet-900/40 transition border border-violet-200 dark:border-violet-850">
                                                                <Printer size={13} /> {pt.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}

            {/* Shared Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto select-text">
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
                                                : 'border-slate-200 dark:border-slate-650 hover:border-slate-400'}`}>
                                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center text-white`}>
                                                <Inbox size={14} />
                                            </div>
                                            <span className="font-bold text-sm text-slate-750 dark:text-slate-300 truncate">{cat.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề *</label>
                                <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="VD: Xin nghỉ ngày 20/03..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm text-slate-850 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mô tả</label>
                                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Chi tiết yêu cầu..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none text-slate-855 dark:text-white" rows={3} />
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
                                            <div key={idx} className="flex items-center gap-2 p-2.5 bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-850 rounded-xl">
                                                <div className="w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center text-xs font-black">{idx + 1}</div>
                                                <span className="flex-1 text-sm font-bold text-slate-750 dark:text-slate-200">{u?.name || 'N/A'}</span>
                                                <span className="text-[10px] text-slate-450">{u?.role}</span>
                                                <button onClick={() => removeApprover(idx)} className="p-1 text-red-400 hover:bg-red-105 dark:hover:bg-red-900/20 rounded transition">
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <div className="flex gap-2">
                                        <select id="approver-select"
                                            className="flex-1 px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 text-sm text-slate-850 dark:text-white"
                                            onChange={e => { addApprover(e.target.value); e.target.value = ''; }}>
                                            <option value="">-- Thêm người duyệt --</option>
                                            {users.filter(u => u.id !== user.id).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {selectedCategory?.slaHours && (
                                <div className="p-2.5 bg-slate-50 dark:bg-slate-750/30 rounded-xl text-[10px] text-slate-500 font-bold">
                                    Hạn xử lý (SLA) mặc định: {selectedCategory.slaHours} giờ làm việc
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Hạn chót mong muốn (tùy chọn)</label>
                                <input type="datetime-local" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm text-slate-850 dark:text-white" />
                            </div>

                            {selectedFields.length > 0 && (
                                <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-650">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thông tin đặc thù</h3>
                                    {selectedFields.map(field => (
                                        <div key={field.id}>
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                                {field.label} {field.required && '*'}
                                            </label>
                                            {field.type === 'text' && (
                                                <input type="text" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    placeholder={field.placeholder || ''}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-850 dark:text-white" />
                                            )}
                                            {field.type === 'textarea' && (
                                                <textarea value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    placeholder={field.placeholder || ''} rows={2}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm resize-none text-slate-850 dark:text-white" />
                                            )}
                                            {field.type === 'number' && (
                                                <input type="number" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-850 dark:text-white" />
                                            )}
                                            {field.type === 'date' && (
                                                <input type="date" value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-750/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-850 dark:text-white" />
                                            )}
                                            {field.type === 'select' && (
                                                <select value={customFormData[field.name] || ''} onChange={e => setCustomFormData(p => ({ ...p, [field.name]: e.target.value }))}
                                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-850 dark:text-white">
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
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={handleCreate} disabled={!selectedCategoryId || !newTitle.trim() || approverList.length === 0}
                                className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20">
                                <Send size={14} className="inline mr-1.5" /> Gửi yêu cầu
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Delete Confirm */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-scale-in">
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa phiếu yêu cầu?</h2>
                        <p className="text-sm text-slate-550 mb-6">Hành động này không thể hoàn tác.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-355 hover:bg-slate-50 dark:hover:bg-slate-700">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Cancel Confirm */}
            {cancelConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-scale-in">
                        <h2 className="text-lg font-bold text-amber-600 mb-2">Hủy phiếu yêu cầu?</h2>
                        <p className="text-sm text-slate-555 mb-6">Phiếu sẽ được đánh dấu là đã hủy.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setCancelConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-355 hover:bg-slate-50 dark:hover:bg-slate-700">Không</button>
                            <button onClick={() => handleCancel(cancelConfirmId)} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-650 transition shadow-lg shadow-amber-500/20">Hủy phiếu</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RequestList;
