
import React, { useState, useMemo, useRef, useCallback } from 'react';
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
    Edit2, Trash2, Ban, Save, Upload, Paperclip, Table2, FileSpreadsheet, Eye, Download, Undo2
} from 'lucide-react';
import * as XLSX from 'xlsx';

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
    REOPENED: { label: 'Mở lại', color: 'text-purple-600' },
};

// ========== Excel Table Preview ==========
const ExcelTablePreview: React.FC<{
    sheets: Record<string, any[][]>;
    sheetNames: string[];
    editable?: boolean;
    onDataChange?: (sheets: Record<string, any[][]>, sheetNames: string[]) => void;
}> = ({ sheets, sheetNames, editable = false, onDataChange }) => {
    const [activeSheet, setActiveSheet] = useState(sheetNames[0] || '');
    const [localSheets, setLocalSheets] = useState<Record<string, any[][]>>(() =>
        JSON.parse(JSON.stringify(sheets))
    );
    const [changedCells, setChangedCells] = useState<Set<string>>(new Set());

    const data = localSheets[activeSheet] || [];
    if (!data.length) return <p className="text-xs text-slate-400 italic">Không có dữ liệu</p>;

    const headers = data[0] || [];
    const rows = data.slice(1);

    const handleCellChange = (rowIdx: number, colIdx: number, value: string) => {
        const newSheets = JSON.parse(JSON.stringify(localSheets));
        const sheetData = newSheets[activeSheet];
        if (!sheetData || !sheetData[rowIdx + 1]) return;
        sheetData[rowIdx + 1][colIdx] = value;
        setLocalSheets(newSheets);
        setChangedCells(prev => new Set(prev).add(`${activeSheet}_${rowIdx}_${colIdx}`));
        onDataChange?.(newSheets, sheetNames);
    };

    const isCellChanged = (rowIdx: number, colIdx: number) =>
        changedCells.has(`${activeSheet}_${rowIdx}_${colIdx}`);

    return (
        <div className={`mt-2 rounded-xl border overflow-hidden bg-white dark:bg-slate-900 ${editable
            ? 'border-amber-300 dark:border-amber-700 shadow-md shadow-amber-100/50 dark:shadow-amber-900/20'
            : 'border-emerald-200 dark:border-emerald-800/40'
            }`}>
            {/* Sheet tabs */}
            {sheetNames.length > 1 && (
                <div className={`flex gap-0 border-b overflow-x-auto ${editable ? 'border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10' : 'border-emerald-100 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-900/10'
                    }`}>
                    {sheetNames.map(name => (
                        <button key={name} onClick={() => setActiveSheet(name)}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border-b-2 ${activeSheet === name
                                ? (editable ? 'text-amber-700 dark:text-amber-300 border-amber-500 bg-white dark:bg-slate-800' : 'text-emerald-700 dark:text-emerald-300 border-emerald-500 bg-white dark:bg-slate-800')
                                : 'text-slate-400 border-transparent hover:text-slate-600'
                                }`}>
                            <Table2 size={10} className="inline mr-1" />{name}
                        </button>
                    ))}
                </div>
            )}
            {/* Editable banner */}
            {editable && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/30">
                    <Edit2 size={11} className="text-amber-500" />
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                        Chế độ chỉnh sửa — click vào ô để nhập dữ liệu
                    </span>
                    {changedCells.size > 0 && (
                        <span className="text-[10px] bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200 px-1.5 py-0.5 rounded-full font-bold ml-auto">
                            {changedCells.size} ô đã sửa
                        </span>
                    )}
                </div>
            )}
            {/* Table */}
            <div className="overflow-auto max-h-[350px]" style={{ maxWidth: '100%' }}>
                <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                        <tr className={editable ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-emerald-100 dark:bg-emerald-900/40'}>
                            {headers.map((h: any, i: number) => (
                                <th key={i} className={`px-3 py-2 text-left font-bold whitespace-nowrap border-b ${editable
                                    ? 'text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-700'
                                    : 'text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700'
                                    }`}>
                                    {h ?? `Col ${i + 1}`}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row: any[], ri: number) => (
                            <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'}>
                                {headers.map((_: any, ci: number) => (
                                    <td key={ci} className={`border-b border-slate-100 dark:border-slate-800 ${editable && isCellChanged(ri, ci)
                                        ? 'bg-amber-50 dark:bg-amber-900/20'
                                        : ''
                                        } ${editable ? 'p-0' : 'px-3 py-1.5'}`}>
                                        {editable ? (
                                            <input
                                                type="text"
                                                value={row[ci] ?? ''}
                                                onChange={e => handleCellChange(ri, ci, e.target.value)}
                                                className={`w-full px-2 py-1.5 text-xs bg-transparent outline-none text-slate-700 dark:text-slate-300 ${isCellChanged(ri, ci)
                                                    ? 'font-bold text-amber-700 dark:text-amber-300'
                                                    : ''
                                                    }`}
                                                style={{ minWidth: '80px' }}
                                            />
                                        ) : (
                                            <span className="text-slate-700 dark:text-slate-300 whitespace-nowrap">{row[ci] ?? ''}</span>
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className={`px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800 ${editable ? 'bg-amber-50/50 dark:bg-amber-900/10' : 'bg-slate-50 dark:bg-slate-800/50'
                }`}>
                <FileSpreadsheet size={10} className="inline mr-1" />
                {rows.length} dòng × {headers.length} cột
                {sheetNames.length > 1 && ` • ${sheetNames.length} sheet`}
                {editable && changedCells.size > 0 && (
                    <span className="ml-2 text-amber-500 font-bold">• {changedCells.size} thay đổi</span>
                )}
            </div>
        </div>
    );
};

// ========== File Download Helper ==========
const downloadFileFromBase64 = (base64: string, fileName: string, mimeType: string) => {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const getBase64DataUrl = (base64: string, mimeType: string) => `data:${mimeType};base64,${base64}`;

// ========== File Preview Modal ==========
const FilePreviewModal: React.FC<{
    file: any;
    onClose: () => void;
}> = ({ file, onClose }) => {
    if (!file) return null;

    const isImage = /^image\//i.test(file.fileType || '');
    const isPdf = /pdf/i.test(file.fileType || '') || /\.pdf$/i.test(file.fileName || '');
    const isExcel = /\.(xlsx|xls|csv)$/i.test(file.fileName || '');

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <Paperclip size={16} className="text-rose-400" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{file.fileName}</p>
                        <p className="text-[10px] text-slate-400">{file.fileType} • {(file.fileSize / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                        onClick={() => downloadFileFromBase64(file.data, file.fileName, file.fileType)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition shadow-md"
                    >
                        <Download size={13} /> Tải về
                    </button>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors">
                        <X size={18} />
                    </button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-auto p-4">
                    {isImage && file.data && (
                        <div className="flex items-center justify-center">
                            <img src={getBase64DataUrl(file.data, file.fileType)} alt={file.fileName} className="max-w-full max-h-[70vh] rounded-lg shadow-lg" />
                        </div>
                    )}
                    {isPdf && file.data && (
                        <iframe
                            src={getBase64DataUrl(file.data, 'application/pdf')}
                            className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700"
                            title={file.fileName}
                        />
                    )}
                    {isExcel && file.excelData && file.sheetNames && (
                        <ExcelTablePreview sheets={file.excelData} sheetNames={file.sheetNames} />
                    )}
                    {!isImage && !isPdf && !isExcel && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">Không thể xem trước loại file này</p>
                            <p className="text-xs mt-1">Nhấn "Tải về" để mở trên máy tính</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ========== File Field Input ==========
const FileFieldInput: React.FC<{
    fieldName: string;
    value: any;
    onChange: (val: any) => void;
    disabled: boolean;
}> = ({ fieldName, value, onChange, disabled }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const isExcelFile = (name: string) => /\.(xlsx|xls|csv)$/i.test(name);

    const parseExcel = useCallback((buffer: ArrayBuffer, fileName: string) => {
        try {
            const wb = XLSX.read(buffer, { type: 'array' });
            const sheetNames = wb.SheetNames;
            const excelData: Record<string, any[][]> = {};
            sheetNames.forEach(name => {
                excelData[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
            });
            return { excelData, sheetNames };
        } catch (err) {
            console.error('Error parsing Excel:', err);
            return null;
        }
    }, []);

    const handleFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            // Convert to base64 for storage
            const bytes = new Uint8Array(buffer);
            let binary = '';
            bytes.forEach(b => binary += String.fromCharCode(b));
            const base64 = btoa(binary);

            const fileData: any = {
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                data: base64,
            };

            if (isExcelFile(file.name)) {
                const parsed = parseExcel(buffer, file.name);
                if (parsed) {
                    fileData.excelData = parsed.excelData;
                    fileData.sheetNames = parsed.sheetNames;
                }
            }

            onChange(fileData);
        };
        reader.readAsArrayBuffer(file);
    }, [onChange, parseExcel]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !disabled) handleFile(file);
    }, [disabled, handleFile]);

    // If disabled and has value, show preview only
    if (disabled && value && typeof value === 'object' && value.fileName) {
        return (
            <div>
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-sm">
                    <Paperclip size={14} className="text-rose-400" />
                    <span className="font-medium text-slate-700 dark:text-slate-300 flex-1 truncate">{value.fileName}</span>
                    <span className="text-xs text-slate-400 shrink-0">({(value.fileSize / 1024).toFixed(1)} KB)</span>
                    <button onClick={() => setShowPreview(true)}
                        className="p-1 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-500 transition-colors" title="Xem trước">
                        <Eye size={14} />
                    </button>
                    {value.data && (
                        <button onClick={() => downloadFileFromBase64(value.data, value.fileName, value.fileType)}
                            className="p-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-800/30 text-emerald-500 transition-colors" title="Tải về">
                            <Download size={14} />
                        </button>
                    )}
                </div>
                {value.excelData && value.sheetNames && (
                    <ExcelTablePreview sheets={value.excelData} sheetNames={value.sheetNames} />
                )}
                {showPreview && <FilePreviewModal file={value} onClose={() => setShowPreview(false)} />}
            </div>
        );
    }

    return (
        <div>
            <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
            />
            {/* Upload zone */}
            {!value || typeof value !== 'object' ? (
                <div
                    onClick={() => !disabled && fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); !disabled && setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-all ${dragOver
                        ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
                        : 'border-slate-200 dark:border-slate-600 hover:border-emerald-300 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/5'
                        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Upload size={20} className={dragOver ? 'text-emerald-500' : 'text-slate-400'} />
                    <span className="text-xs text-slate-500 text-center">
                        <span className="font-bold text-emerald-600">Chọn file</span> hoặc kéo thả vào đây
                        <br /><span className="text-[10px] text-slate-400">Excel, PDF, Word, Ảnh (tối đa 5MB)</span>
                    </span>
                </div>
            ) : (
                <div>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-xl">
                        {isExcelFile(value.fileName) ? (
                            <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
                        ) : (
                            <Paperclip size={16} className="text-rose-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{value.fileName}</p>
                            <p className="text-[10px] text-slate-400">{(value.fileSize / 1024).toFixed(1)} KB</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            <button onClick={() => setShowPreview(true)}
                                className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-500 transition-colors" title="Xem trước">
                                <Eye size={14} />
                            </button>
                            {value.data && (
                                <button onClick={() => downloadFileFromBase64(value.data, value.fileName, value.fileType)}
                                    className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-800/30 text-emerald-500 transition-colors" title="Tải về">
                                    <Download size={14} />
                                </button>
                            )}
                            {!disabled && (
                                <>
                                    <button onClick={() => fileRef.current?.click()}
                                        className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-800/30 text-emerald-500 transition-colors" title="Chọn file khác">
                                        <Upload size={14} />
                                    </button>
                                    <button onClick={() => onChange('')}
                                        className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/30 text-red-400 transition-colors" title="Xoá file">
                                        <X size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    {/* Excel preview */}
                    {value.excelData && value.sheetNames && (
                        <ExcelTablePreview sheets={value.excelData} sheetNames={value.sheetNames} />
                    )}
                </div>
            )}
            {showPreview && value && typeof value === 'object' && (
                <FilePreviewModal file={value} onClose={() => setShowPreview(false)} />
            )}
        </div>
    );
};

const WorkflowInstances: React.FC = () => {
    const { templates, instances, nodes, edges, logs, createInstance, updateInstance, deleteInstance, cancelInstance, processInstance, reopenInstance, getInstanceLogs } = useWorkflow();
    const { user, users } = useApp();
    const [activeTab, setActiveTab] = useState<'mine' | 'pending'>('mine');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // File preview state
    const [previewFile, setPreviewFile] = useState<any>(null);

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

    // Reopen modal state (Admin can revert completed/rejected instances)
    const [reopenInstanceId, setReopenInstanceId] = useState<string | null>(null);
    const [reopenTargetNodeId, setReopenTargetNodeId] = useState('');
    const [reopenComment, setReopenComment] = useState('');

    // Step data editing state
    const [stepFormData, setStepFormData] = useState<Record<string, any>>({});
    const [stepExcelData, setStepExcelData] = useState<{ sheets: Record<string, any[][]>; sheetNames: string[] } | null>(null);

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
        if (instance) {
            const nodeId = instance.currentNodeId;
            const newFormData = { ...instance.formData };
            // Save step form fields (exclude _files which is handled separately)
            const formEntries = Object.entries(stepFormData).filter(([k]) => k !== '_files');
            if (formEntries.length > 0) {
                formEntries.forEach(([key, value]) => {
                    newFormData[`step_${nodeId}_${key}`] = value;
                });
            }
            // Save step file attachments
            if (stepFormData._files && stepFormData._files.length > 0) {
                newFormData[`step_${nodeId}_files`] = stepFormData._files;
            }
            // Save step-level Excel edits
            if (stepExcelData) {
                newFormData[`step_${nodeId}_excel_data`] = stepExcelData.sheets;
                newFormData[`step_${nodeId}_excel_sheets`] = stepExcelData.sheetNames;
            }
            if (formEntries.length > 0 || stepExcelData || (stepFormData._files && stepFormData._files.length > 0)) {
                await updateInstance(instanceId, { formData: newFormData });
            }
        }
        await processInstance(instanceId, action, user.id, actionComment);
        setActionComment('');
        setStepFormData({});
        setStepExcelData(null);
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
        // Allow creator to act on first step after REVISION_REQUESTED
        if (instance.createdBy === user.id) {
            const templateEdgesLocal = edges.filter(e => e.templateId === instance.templateId);
            const startNode = nodes.find(n => n.templateId === instance.templateId && n.type === WorkflowNodeType.START);
            if (startNode) {
                const firstEdge = templateEdgesLocal.find(e => e.sourceNodeId === startNode.id);
                if (firstEdge && firstEdge.targetNodeId === instance.currentNodeId) {
                    // Check if there was a REVISION_REQUESTED log for this instance
                    const instanceLogs = logs.filter(l => l.instanceId === instance.id);
                    const hasRevision = instanceLogs.some(l => l.action === WorkflowInstanceAction.REVISION_REQUESTED);
                    if (hasRevision) return true;
                }
            }
        }
        return false;
    };

    // Check if current step is the first step and was sent back for revision
    const isRevisionAtFirstStep = (instance: WorkflowInstance): boolean => {
        if (!instance.currentNodeId) return false;
        const startNode = nodes.find(n => n.templateId === instance.templateId && n.type === WorkflowNodeType.START);
        if (!startNode) return false;
        const templateEdgesLocal = edges.filter(e => e.templateId === instance.templateId);
        const firstEdge = templateEdgesLocal.find(e => e.sourceNodeId === startNode.id);
        if (!firstEdge || firstEdge.targetNodeId !== instance.currentNodeId) return false;
        const instanceLogs = logs.filter(l => l.instanceId === instance.id);
        return instanceLogs.some(l => l.action === WorkflowInstanceAction.REVISION_REQUESTED);
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
                    <FileFieldInput
                        fieldName={field.name}
                        value={data[field.name]}
                        onChange={(val: any) => onChange(field.name, val)}
                        disabled={disabled}
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
                                        {/* Admin revert button for COMPLETED/REJECTED */}
                                        {user.role === Role.ADMIN && (instance.status === WorkflowInstanceStatus.COMPLETED || instance.status === WorkflowInstanceStatus.REJECTED) && (
                                            <div onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => {
                                                        setReopenInstanceId(instance.id);
                                                        setReopenTargetNodeId('');
                                                        setReopenComment('');
                                                    }}
                                                    className="p-1.5 rounded-lg text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition"
                                                    title="Mở lại / Đảo ngược quy trình"
                                                >
                                                    <Undo2 size={14} />
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
                                                            {/* Step data and Excel hidden from timeline - shown in log section below */}
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
                                                    const v = value as any;
                                                    return (
                                                        <div key={key} className="py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                                                            <span className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">{displayLabel}:</span>
                                                            {typeof v === 'object' && v !== null && v.fileName ? (
                                                                <div className="mt-1.5">
                                                                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1">
                                                                        <Paperclip size={12} className="text-rose-400" />
                                                                        <span className="font-medium flex-1 truncate">{v.fileName}</span>
                                                                        <span className="text-slate-400 shrink-0">({(v.fileSize / 1024).toFixed(1)} KB)</span>
                                                                        <button onClick={() => setPreviewFile(v)}
                                                                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-500 transition-colors" title="Xem trước">
                                                                            <Eye size={12} />
                                                                        </button>
                                                                        {v.data && (
                                                                            <button onClick={() => downloadFileFromBase64(v.data, v.fileName, v.fileType)}
                                                                                className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-800/30 text-emerald-500 transition-colors" title="Tải về">
                                                                                <Download size={12} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    {v.excelData && v.sheetNames && (
                                                                        <ExcelTablePreview sheets={v.excelData} sheetNames={v.sheetNames} />
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="flex-1 ml-2">{String(value)}</span>
                                                            )}
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

                                            {/* Editable Excel from attached file */}
                                            {(() => {
                                                // Find Excel data from file fields in formData
                                                const tpl = templates.find(t => t.id === instance.templateId);
                                                const fileFields = (tpl?.customFields || []).filter(f => f.type === 'file');
                                                // Also check for step-level Excel from previous steps
                                                const allFormData = instance.formData || {};

                                                // Get the latest Excel data: check previous steps first, then original
                                                let excelSource: { sheets: Record<string, any[][]>; sheetNames: string[]; label: string } | null = null;

                                                // Check previous steps for Excel edits (latest first)
                                                const orderedNodeIds = nodes
                                                    .filter(n => n.templateId === instance.templateId)
                                                    .map(n => n.id);
                                                for (let i = orderedNodeIds.length - 1; i >= 0; i--) {
                                                    const nid = orderedNodeIds[i];
                                                    if (nid === instance.currentNodeId) continue; // skip current
                                                    const stepData = allFormData[`step_${nid}_excel_data`];
                                                    const stepSheets = allFormData[`step_${nid}_excel_sheets`];
                                                    if (stepData && stepSheets) {
                                                        const prevNode = nodes.find(n => n.id === nid);
                                                        excelSource = { sheets: stepData, sheetNames: stepSheets, label: `Dữ liệu từ bước "${prevNode?.label || nid}"` };
                                                        break;
                                                    }
                                                }

                                                // If no previous step edits, use original file attachment
                                                if (!excelSource) {
                                                    for (const ff of fileFields) {
                                                        const fv = allFormData[ff.name] as any;
                                                        if (fv && typeof fv === 'object' && fv.excelData && fv.sheetNames) {
                                                            excelSource = { sheets: fv.excelData, sheetNames: fv.sheetNames, label: `Dữ liệu từ "${ff.label}"` };
                                                            break;
                                                        }
                                                    }
                                                }

                                                if (!excelSource) return null;

                                                return (
                                                    <div className="mb-4 border-b border-amber-200 dark:border-amber-700 pb-4">
                                                        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">
                                                            <FileSpreadsheet size={11} className="inline mr-1" />
                                                            {excelSource.label} — Chỉnh sửa bảng Excel
                                                        </p>
                                                        <ExcelTablePreview
                                                            sheets={excelSource.sheets}
                                                            sheetNames={excelSource.sheetNames}
                                                            editable={true}
                                                            onDataChange={(newSheets, newSheetNames) => {
                                                                setStepExcelData({ sheets: newSheets, sheetNames: newSheetNames });
                                                            }}
                                                        />
                                                    </div>
                                                );
                                            })()}
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

                                            {/* Step file attachment */}
                                            <div className="mb-3">
                                                <label className="block text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1.5">
                                                    <Paperclip size={11} className="inline mr-1" />Tệp đính kèm bước này
                                                </label>
                                                {/* Show existing step files */}
                                                {(stepFormData._files || []).map((f: any, fi: number) => (
                                                    <div key={fi} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1 bg-white/60 dark:bg-slate-800/40 p-2 rounded-lg">
                                                        <Paperclip size={11} className="text-rose-400 shrink-0" />
                                                        <span className="truncate flex-1">{f.fileName}</span>
                                                        <span className="text-slate-400 shrink-0">({(f.fileSize / 1024).toFixed(1)} KB)</span>
                                                        <button onClick={() => setPreviewFile(f)} className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-500" title="Xem trước"><Eye size={11} /></button>
                                                        <button onClick={() => {
                                                            const newFiles = [...(stepFormData._files || [])];
                                                            newFiles.splice(fi, 1);
                                                            setStepFormData(prev => ({ ...prev, _files: newFiles }));
                                                        }} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-800/30 text-red-400" title="Xóa"><X size={11} /></button>
                                                    </div>
                                                ))}
                                                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-amber-300 dark:border-amber-700 rounded-xl cursor-pointer hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition">
                                                    <Upload size={14} className="text-amber-400" />
                                                    <span className="text-[10px] text-amber-500 font-bold">Chọn file đính kèm...</span>
                                                    <input type="file" className="hidden" multiple onChange={async (e) => {
                                                        const files = e.target.files;
                                                        if (!files) return;
                                                        const newFiles = [...(stepFormData._files || [])];
                                                        for (let i = 0; i < files.length; i++) {
                                                            const file = files[i];
                                                            const reader = new FileReader();
                                                            const fileData = await new Promise<string>((resolve) => {
                                                                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                                                                reader.readAsDataURL(file);
                                                            });
                                                            newFiles.push({
                                                                fileName: file.name,
                                                                fileType: file.type,
                                                                fileSize: file.size,
                                                                data: fileData,
                                                            });
                                                        }
                                                        setStepFormData(prev => ({ ...prev, _files: newFiles }));
                                                        e.target.value = '';
                                                    }} />
                                                </label>
                                            </div>

                                            <textarea
                                                value={actionComment}
                                                onChange={e => setActionComment(e.target.value)}
                                                placeholder="Ghi chú / lý do (tùy chọn)..."
                                                className="w-full px-3 py-2 bg-white/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-accent resize-none mb-3"
                                                rows={2}
                                            />
                                            <div className="flex gap-2 flex-wrap">
                                                {isRevisionAtFirstStep(instance) && isCreator(instance) ? (
                                                    <button
                                                        onClick={() => handleAction(instance.id, WorkflowInstanceAction.APPROVED)}
                                                        disabled={processingId === instance.id}
                                                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-bold hover:bg-blue-600 transition shadow-md shadow-blue-500/20 disabled:opacity-50"
                                                    >
                                                        <Send size={13} /> Gửi lại
                                                    </button>
                                                ) : (
                                                    <>
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
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Conversation History */}
                                    {getInstanceLogs(instance.id).length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                                                <MessageSquare size={11} /> Lịch sử trao đổi
                                            </p>
                                            <div className="space-y-3 max-h-[400px] overflow-y-auto">
                                                {getInstanceLogs(instance.id).slice().reverse().map(log => {
                                                    const actor = users.find(u => u.id === log.actedBy);
                                                    const node = nodes.find(n => n.id === log.nodeId);
                                                    const actionInfo = ACTION_MAP[log.action];
                                                    const isMe = log.actedBy === user.id;
                                                    // Get step files if any
                                                    const stepFiles = (instance.formData || {})[`step_${log.nodeId}_files`] as any[] | undefined;
                                                    return (
                                                        <div key={log.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                                                            {/* Avatar */}
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isMe ? 'bg-accent/20 text-accent' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                                                                {actor?.name?.charAt(0)?.toUpperCase() || '?'}
                                                            </div>
                                                            {/* Message bubble */}
                                                            <div className={`max-w-[75%] ${isMe ? 'text-right' : ''}`}>
                                                                <div className="flex items-center gap-1.5 mb-1 flex-wrap" style={{ justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                                                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{actor?.name}</span>
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${actionInfo?.color} bg-opacity-10`} style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
                                                                        {actionInfo?.label}
                                                                    </span>
                                                                </div>
                                                                <div className={`rounded-2xl px-3 py-2 text-xs ${isMe
                                                                    ? 'bg-accent/10 dark:bg-accent/20 text-slate-700 dark:text-slate-200 rounded-tr-sm'
                                                                    : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 rounded-tl-sm'
                                                                    }`}>
                                                                    <p className="text-[9px] text-slate-400 mb-0.5">tại "{node?.label}"</p>
                                                                    {log.comment ? (
                                                                        <p className="text-sm leading-relaxed">{log.comment}</p>
                                                                    ) : (
                                                                        <p className="text-slate-400 italic text-[10px]">Không có ghi chú</p>
                                                                    )}
                                                                    {/* Show step files in this log's node */}
                                                                    {stepFiles && stepFiles.length > 0 && (
                                                                        <div className="mt-2 space-y-1 border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5">
                                                                            {stepFiles.map((f: any, fi: number) => (
                                                                                <div key={fi} className="flex items-center gap-1.5 text-[10px]">
                                                                                    <Paperclip size={10} className="text-rose-400" />
                                                                                    <span className="truncate">{f.fileName}</span>
                                                                                    <button onClick={() => setPreviewFile(f)} className="text-blue-500 hover:underline">Xem</button>
                                                                                    {f.data && <button onClick={() => downloadFileFromBase64(f.data, f.fileName, f.fileType)} className="text-emerald-500 hover:underline">Tải</button>}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <p className="text-[9px] text-slate-300 dark:text-slate-600 mt-1" style={{ textAlign: isMe ? 'right' : 'left' }}>
                                                                    {new Date(log.createdAt).toLocaleString('vi-VN')}
                                                                </p>
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

            {/* Reopen/Revert Modal for Admin */}
            {reopenInstanceId && (() => {
                const inst = instances.find(i => i.id === reopenInstanceId);
                if (!inst) return null;
                const tplNodes = nodes.filter(n => n.templateId === inst.templateId && n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END);
                // Order nodes by edge sequence
                const tplEdges = edges.filter(e => e.templateId === inst.templateId);
                const startNode = nodes.find(n => n.templateId === inst.templateId && n.type === WorkflowNodeType.START);
                const orderedNodes: typeof tplNodes = [];
                if (startNode) {
                    let currentId: string | undefined = startNode.id;
                    while (currentId) {
                        const edge = tplEdges.find(e => e.sourceNodeId === currentId);
                        if (!edge) break;
                        const node = tplNodes.find(n => n.id === edge.targetNodeId);
                        if (node) orderedNodes.push(node);
                        currentId = edge.targetNodeId;
                    }
                }
                const displayNodes = orderedNodes.length > 0 ? orderedNodes : tplNodes;
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setReopenInstanceId(null)}>
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                                <Undo2 size={20} className="text-purple-500" /> Mở lại quy trình
                            </h2>
                            <p className="text-xs text-slate-400 mb-4">Chọn bước muốn quay lại để tiếp tục xử lý.</p>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Quay lại bước *</label>
                                    <select
                                        value={reopenTargetNodeId}
                                        onChange={e => setReopenTargetNodeId(e.target.value)}
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option value="">-- Chọn bước --</option>
                                        {displayNodes.map((n, idx) => (
                                            <option key={n.id} value={n.id}>Bước {idx + 1}: {n.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Lý do mở lại</label>
                                    <textarea
                                        value={reopenComment}
                                        onChange={e => setReopenComment(e.target.value)}
                                        placeholder="Nhập lý do mở lại quy trình..."
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setReopenInstanceId(null)}
                                        className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 transition"
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!reopenTargetNodeId) return;
                                            await reopenInstance(reopenInstanceId, reopenTargetNodeId, user.id, reopenComment);
                                            setReopenInstanceId(null);
                                            setReopenTargetNodeId('');
                                            setReopenComment('');
                                        }}
                                        disabled={!reopenTargetNodeId}
                                        className="px-4 py-2 bg-purple-500 text-white rounded-xl text-xs font-bold hover:bg-purple-600 transition shadow-md shadow-purple-500/20 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Undo2 size={13} /> Mở lại
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* File Preview Modal */}
            {previewFile && (
                <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
            )}
        </div>
    );
};

export default WorkflowInstances;
