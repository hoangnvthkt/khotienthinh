
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import {
    WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceAction,
    WorkflowNodeType, Role, WorkflowCustomField, WorkflowPrintTemplate
} from '../../types';
import {
    GitBranch, Plus, Search, Clock, CheckCircle, XCircle, Circle,
    ArrowRight, User, MessageSquare, FileText, Send, RotateCcw,
    ChevronDown, ChevronUp, Filter, Inbox, AlertCircle, X,
    Edit2, Trash2, Ban, Save, Upload, Paperclip, Table2, FileSpreadsheet, Eye, Download, Undo2,
    LayoutGrid, List, Printer, Shield, UserPlus
} from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import KanbanBoard from '../../components/KanbanBoard';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { supabase } from '../../lib/supabase';
import { useCelebration } from '../../components/Celebration';
import { loadXlsx } from '../../lib/loadXlsx';
import { isWorkflowStepAssignedToUser } from '../../lib/workflowAssignmentResolver';
import { canSeeMaterialRequestWorkflowOnKanban, isMaterialRequestWorkflowTemplate } from '../../lib/workflowVisibility';
import WorkflowInstanceDetail from './WorkflowInstanceDetail';

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
const WORKFLOW_ATTACHMENT_BUCKET = 'workflow-attachments';

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

const sanitizeStorageFileName = (name: string) =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'attachment';

const getAttachmentBucket = (file: any) => file?.storageBucket || WORKFLOW_ATTACHMENT_BUCKET;

const hasDownloadableFile = (file: any) => Boolean(file?.data || file?.storagePath);

const uploadWorkflowAttachment = async (file: File) => {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const storagePath = `${new Date().getFullYear()}/${id}-${sanitizeStorageFileName(file.name)}`;
    const { error } = await supabase.storage.from(WORKFLOW_ATTACHMENT_BUCKET).upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
    });
    if (error) throw error;

    return {
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storageBucket: WORKFLOW_ATTACHMENT_BUCKET,
        storagePath,
    };
};

const downloadWorkflowFile = async (file: any) => {
    try {
        if (file?.data) {
            downloadFileFromBase64(file.data, file.fileName, file.fileType);
            return;
        }

        if (file?.storagePath) {
            const { data, error } = await supabase.storage.from(getAttachmentBucket(file)).download(file.storagePath);
            if (error || !data) throw error || new Error('Không tải được file');
            saveAs(data, file.fileName || 'attachment');
        }
    } catch (err) {
        console.error('downloadWorkflowFile error:', err);
        alert('Không tải được file đính kèm. Vui lòng thử lại.');
    }
};

// ========== File Preview Modal ==========
const FilePreviewModal: React.FC<{
    file: any;
    onClose: () => void;
}> = ({ file, onClose }) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState('');
    const isImage = /^image\//i.test(file?.fileType || '');
    const isPdf = /pdf/i.test(file?.fileType || '') || /\.pdf$/i.test(file?.fileName || '');
    const isExcel = /\.(xlsx|xls|csv)$/i.test(file?.fileName || '');

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        setPreviewUrl(null);
        setPreviewError('');

        const loadPreview = async () => {
            if (!file || (!isImage && !isPdf)) return;
            if (file.data) {
                setPreviewUrl(getBase64DataUrl(file.data, isPdf ? 'application/pdf' : file.fileType));
                return;
            }
            if (!file.storagePath) {
                setPreviewError('File cũ chỉ còn thông tin đính kèm, không còn dữ liệu xem trước');
                return;
            }

            const { data, error } = await supabase.storage.from(getAttachmentBucket(file)).download(file.storagePath);
            if (cancelled) return;
            if (error || !data) {
                console.error('File preview download error:', error);
                setPreviewError('Không tải được bản xem trước');
                return;
            }
            objectUrl = URL.createObjectURL(data);
            setPreviewUrl(objectUrl);
        };

        loadPreview();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file, isImage, isPdf]);

    if (!file) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <Paperclip size={16} className="text-rose-400" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{file.fileName}</p>
                        <p className="text-xs font-medium text-slate-450 dark:text-slate-500">{file.fileType} • {(file.fileSize / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                        onClick={() => downloadWorkflowFile(file)}
                        disabled={!hasDownloadableFile(file)}
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
                    {isImage && previewUrl && (
                        <div className="flex items-center justify-center">
                            <img src={previewUrl} alt={file.fileName} className="max-w-full max-h-[70vh] rounded-lg shadow-lg" />
                        </div>
                    )}
                    {isPdf && previewUrl && (
                        <iframe
                            src={previewUrl}
                            className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700"
                            title={file.fileName}
                        />
                    )}
                    {(isImage || isPdf) && !previewUrl && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">{previewError || 'Đang tải bản xem trước...'}</p>
                        </div>
                    )}
                    {isExcel && file.excelData && file.sheetNames && (
                        <ExcelTablePreview sheets={file.excelData} sheetNames={file.sheetNames} />
                    )}
                    {isExcel && (!file.excelData || !file.sheetNames) && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileSpreadsheet size={48} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">File Excel đã được lưu trong Storage</p>
                            <p className="text-xs mt-1">Nhấn "Tải về" để mở và chỉnh sửa trên máy tính</p>
                        </div>
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
export const FileFieldInput: React.FC<{
    fieldName: string;
    value: any;
    onChange: (val: any) => void;
    disabled: boolean;
}> = ({ fieldName, value, onChange, disabled }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const isExcelFile = (name: string) => /\.(xlsx|xls|csv)$/i.test(name);

    const parseExcel = useCallback(async (buffer: ArrayBuffer, fileName: string) => {
        try {
            const XLSX = await loadXlsx();
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

    const handleFile = useCallback(async (file: File) => {
        setIsUploading(true);
        try {
            const fileData: any = await uploadWorkflowAttachment(file);
            if (isExcelFile(file.name)) {
                const buffer = await file.arrayBuffer();
                const parsed = await parseExcel(buffer, file.name);
                if (parsed) {
                    fileData.sheetNames = parsed.sheetNames;
                }
            }

            onChange(fileData);
        } catch (err) {
            console.error('Workflow attachment upload error:', err);
            alert('Không upload được file đính kèm. Vui lòng thử lại.');
        } finally {
            setIsUploading(false);
        }
    }, [onChange, parseExcel]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !disabled && !isUploading) handleFile(file);
    }, [disabled, handleFile, isUploading]);

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
                    {hasDownloadableFile(value) && (
                        <button onClick={() => downloadWorkflowFile(value)}
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
                disabled={disabled || isUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
            />
            {/* Upload zone */}
            {!value || typeof value !== 'object' ? (
                <div
                    onClick={() => !disabled && !isUploading && fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); !disabled && !isUploading && setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center gap-3 px-6 py-8 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${dragOver
                        ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
                        : 'border-slate-200 dark:border-slate-600 hover:border-emerald-300 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/5'
                        } ${disabled || isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Upload size={24} className={dragOver ? 'text-emerald-500' : 'text-slate-400'} />
                    <span className="text-sm text-slate-500 text-center">
                        <span className="font-bold text-emerald-600">{isUploading ? 'Đang tải file...' : 'Chọn file'}</span>{!isUploading && ' hoặc kéo thả vào đây'}
                        <br /><span className="text-xs text-slate-400">Excel, PDF, Word, Ảnh (tối đa 5MB)</span>
                    </span>
                </div>
            ) : (
                <div>
                    <div className="flex items-center gap-3 px-5 py-3.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-2xl">
                        {isExcelFile(value.fileName) ? (
                            <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
                        ) : (
                            <Paperclip size={16} className="text-rose-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-slate-750 dark:text-slate-300 truncate">{value.fileName}</p>
                            <p className="text-xs font-medium text-slate-450 dark:text-slate-500">{(value.fileSize / 1024).toFixed(1)} KB</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            <button onClick={() => setShowPreview(true)}
                                className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-500 transition-colors" title="Xem trước">
                                <Eye size={14} />
                            </button>
                            {hasDownloadableFile(value) && (
                                <button onClick={() => downloadWorkflowFile(value)}
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

// ========== Table Field Input ==========
interface TableFieldInputProps {
    fieldName: string;
    columns: string[];
    value: string[][] | null | undefined;
    onChange: (val: string[][]) => void;
    disabled?: boolean;
}

export const TableFieldInput: React.FC<TableFieldInputProps> = ({ fieldName, columns, value, onChange, disabled = false }) => {
    // Ensure value is initialized with at least one row if empty
    const rows = React.useMemo(() => {
        if (Array.isArray(value) && value.length > 0) return value;
        return [Array(columns.length).fill('')];
    }, [value, columns.length]);

    const handleCellChange = (rowIndex: number, colIndex: number, text: string) => {
        const updated = rows.map((r, ri) => {
            if (ri !== rowIndex) return r;
            const newRow = [...r];
            newRow[colIndex] = text;
            return newRow;
        });
        onChange(updated);
    };

    const addRow = () => {
        const updated = [...rows, Array(columns.length).fill('')];
        onChange(updated);
    };

    const removeRow = (rowIndex: number) => {
        if (rows.length <= 1) {
            onChange([Array(columns.length).fill('')]);
            return;
        }
        const updated = rows.filter((_, ri) => ri !== rowIndex);
        onChange(updated);
    };

    return (
        <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left" style={{ minWidth: Math.max(600, columns.length * 150) }}>
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                            <th className="px-4 py-3 text-center w-12">#</th>
                            {columns.map((col, idx) => (
                                <th key={idx} className="px-4 py-3">{col}</th>
                            ))}
                            {!disabled && <th className="px-3 py-2 text-center w-12"></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((row, ri) => (
                            <tr key={ri} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="px-4 py-3 text-center text-slate-400 font-semibold align-middle">
                                    {String(ri + 1).padStart(2, '0')}
                                </td>
                                {columns.map((_, ci) => (
                                    <td key={ci} className="px-3 py-2 align-middle">
                                        <input
                                            type="text"
                                            value={row[ci] ?? ''}
                                            onChange={e => handleCellChange(ri, ci, e.target.value)}
                                            disabled={disabled}
                                            className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-transparent focus:ring-1 focus:ring-accent outline-none text-slate-700 dark:text-slate-200 text-sm font-semibold"
                                            placeholder="..."
                                        />
                                    </td>
                                ))}
                                {!disabled && (
                                    <td className="px-2 py-1 text-center align-middle">
                                        <button
                                            type="button"
                                            onClick={() => removeRow(ri)}
                                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                                            title="Xóa dòng"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!disabled && (
                <div className="p-2 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <button
                        type="button"
                        onClick={addRow}
                        className="inline-flex items-center gap-1.5 px-6 py-2.5 bg-accent hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition shadow-sm"
                    >
                        <Plus size={13} /> Thêm dòng
                    </button>
                    <span className="text-[10px] text-slate-400 font-medium">
                        Tổng cộng: {rows.length} dòng
                    </span>
                </div>
            )}
        </div>
    );
};

const WorkflowInstances: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { templates, instances, nodes, edges, logs, createInstance, loadInstanceFormData, updateInstance, deleteInstance, cancelInstance, processInstance, reopenInstance, getInstanceLogs, getPrintTemplates, updateInstanceWatchers } = useWorkflow();
    const { user, users, employees, orgUnits } = useApp();
    const { celebrate, showToast: celebrationToast } = useCelebration();
    const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'watching'>('mine');
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
    const [boardTemplateId, setBoardTemplateId] = useState<string>('');
    const [boardDetailInstanceId, setBoardDetailInstanceId] = useState<string | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const targetInstanceId = useMemo(() => {
        return searchParams.get('id') || searchParams.get('wf') || searchParams.get('instanceId');
    }, [searchParams]);
    const [expandedId, setExpandedId] = useState<string | null>(() => targetInstanceId);
    const [selectedTemplateIdFilter, setSelectedTemplateIdFilter] = useState('');
    const instanceRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const loadedFormDataIdsRef = useRef<Set<string>>(new Set());

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
    const [uploadingStepFiles, setUploadingStepFiles] = useState(false);

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

    useEffect(() => {
        const hasActiveOverlay = showCreateModal || !!editingInstance || !!boardDetailInstanceId || !!deleteConfirmId || !!cancelConfirmId || !!reopenInstanceId;
        if (hasActiveOverlay) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [showCreateModal, editingInstance, boardDetailInstanceId, deleteConfirmId, cancelConfirmId, reopenInstanceId]);

    // Step data editing state
    const [stepFormData, setStepFormData] = useState<Record<string, any>>({});
    const [stepExcelData, setStepExcelData] = useState<{ sheets: Record<string, any[][]>; sheetNames: string[] } | null>(null);

    const activeTemplates = templates.filter(t => t.isActive);
    const nonMaterialActiveTemplates = activeTemplates.filter(t => !isMaterialRequestWorkflowTemplate(t));
    const boardTemplates = activeTemplates.filter(t =>
        !isMaterialRequestWorkflowTemplate(t) || canSeeMaterialRequestWorkflowOnKanban(user)
    );
    const templateById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
    const isMaterialWorkflowInstance = useCallback(
        (instance: WorkflowInstance) => isMaterialRequestWorkflowTemplate(templateById.get(instance.templateId)),
        [templateById],
    );
    const visibleListInstances = useMemo(
        () => instances.filter(instance => !isMaterialWorkflowInstance(instance)),
        [instances, isMaterialWorkflowInstance],
    );
    const visibleBoardInstances = useMemo(
        () => canSeeMaterialRequestWorkflowOnKanban(user) ? instances : visibleListInstances,
        [instances, user, visibleListInstances],
    );
    useEffect(() => {
        if (boardTemplateId && !boardTemplates.some(template => template.id === boardTemplateId)) {
            setBoardTemplateId('');
        }
    }, [boardTemplateId, boardTemplates]);
    const getEffectiveAssigneeUserId = useCallback((instance: WorkflowInstance, node?: { id: string; config: any } | null) => {
        if (!node) return undefined;
        return instance.stepAssignees?.[node.id] || node.config.assigneeUserId;
    }, []);

    // Filter instances based on active tab
    const filteredInstances = useMemo(() => {
        let list = visibleListInstances;

        if (activeTab === 'mine') {
            list = list.filter(i => i.createdBy === user.id);
        } else if (activeTab === 'watching') {
            // Show instances where user is a watcher (instance-level or default template-level)
            list = list.filter(i => {
                if (i.watchers?.includes(user.id)) return true;
                const tmpl = templates.find(t => t.id === i.templateId);
                if (tmpl?.defaultWatchers?.includes(user.id)) return true;
                return false;
            });
        } else {
            // "Chờ tôi duyệt": instances where current node is assigned to this user (by role or by userId)
            list = list.filter(i => {
                if (i.status !== WorkflowInstanceStatus.RUNNING || !i.currentNodeId) return false;
                const currentNode = nodes.find(n => n.id === i.currentNodeId);
                if (!currentNode) return false;
                if (isWorkflowStepAssignedToUser(i, currentNode, user)) return true;
                if (user.role === Role.ADMIN) return true; // admin sees all
                // Managers can also see pending instances for their templates
                const tmpl = templates.find(t => t.id === i.templateId);
                if (tmpl?.managers?.includes(user.id)) return true;
                return false;
            });
        }

        if (selectedTemplateIdFilter) {
            list = list.filter(i => i.templateId === selectedTemplateIdFilter);
        }

        if (filterStatus !== 'ALL') {
            list = list.filter(i => i.status === filterStatus);
        }

        if (searchTerm) {
            list = list.filter(i => matchesSearchQueryMultiple([i.code, i.title], searchTerm));
        }

        return list;
    }, [visibleListInstances, activeTab, filterStatus, searchTerm, user, nodes, templates, selectedTemplateIdFilter]);

    const activeInstanceId = useMemo(() => {
        if (expandedId && filteredInstances.some(i => i.id === expandedId)) {
            return expandedId;
        }
        return null;
    }, [expandedId, filteredInstances]);

    const activeInstance = useMemo(() => {
        return instances.find(i => i.id === activeInstanceId) || null;
    }, [instances, activeInstanceId]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const showToast = (type: 'success' | 'error', text: string) => {
        celebrationToast({ type, title: text });
    };

    const ensureInstanceFormData = useCallback(async (instance: WorkflowInstance): Promise<WorkflowInstance> => {
        if (Object.keys(instance.formData || {}).length > 0 || loadedFormDataIdsRef.current.has(instance.id)) {
            return instance;
        }

        const formData = await loadInstanceFormData(instance.id);
        loadedFormDataIdsRef.current.add(instance.id);
        return { ...instance, formData: formData || {} };
    }, [loadInstanceFormData]);

    const handleToggleExpand = useCallback(async (instance: WorkflowInstance) => {
        if (expandedId === instance.id) {
            setExpandedId(null);
            setSearchParams({}, { replace: true });
            return;
        }
        setExpandedId(instance.id);
        setSearchParams({ id: instance.id }, { replace: true });
        await ensureInstanceFormData(instance);
    }, [expandedId, ensureInstanceFormData, setSearchParams]);

    const handleStepFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadingStepFiles(true);
        try {
            const uploadedFiles = [];
            for (let i = 0; i < files.length; i++) {
                uploadedFiles.push(await uploadWorkflowAttachment(files[i]));
            }
            setStepFormData(prev => ({ ...prev, _files: [...(prev._files || []), ...uploadedFiles] }));
        } catch (err) {
            console.error('Step attachment upload error:', err);
            alert('Không upload được file đính kèm. Vui lòng thử lại.');
        } finally {
            setUploadingStepFiles(false);
        }
    }, []);

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
            loadedFormDataIdsRef.current.add(result.id);
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

    // ==================== WORD EXPORT ====================
    const handleExportWord = async (instance: WorkflowInstance, printTemplate: WorkflowPrintTemplate) => {
        try {
            instance = await ensureInstanceFormData(instance);
            // 1. Download .docx from Supabase Storage
            const { data: fileData, error } = await supabase.storage.from('workflow-templates').download(printTemplate.storagePath);
            if (error || !fileData) { alert('Không tải được file mẫu. Vui lòng thử lại.'); return; }

            // 2. Prepare image module for signatures
            let ImageModule: any = null;
            try { ImageModule = (await import('open-docxtemplater-image-module')).default; } catch { }

            const imageMap: Record<string, ArrayBuffer> = {};
            // Collect approver signatures
            const instanceLogs = logs.filter(l => l.instanceId === instance.id);
            for (const log of instanceLogs) {
                const node = nodes.find(n => n.id === log.nodeId);
                if (!node) continue;
                const actor = users.find(u => u.id === log.actedBy);
                if (!actor?.signatureUrl) continue;
                const safeLabel = node.label.replace(/\s+/g, '_').toLowerCase();
                try {
                    const sigRes = await fetch(actor.signatureUrl);
                    if (sigRes.ok) imageMap[`signature_${safeLabel}`] = await sigRes.arrayBuffer();
                } catch { }
            }
            // Creator signature
            const creator = users.find(u => u.id === instance.createdBy);
            if (creator?.signatureUrl) {
                try {
                    const sigRes = await fetch(creator.signatureUrl);
                    if (sigRes.ok) imageMap['signature_creator'] = await sigRes.arrayBuffer();
                } catch { }
            }

            // 3. Parse with PizZip + Docxtemplater
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

            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '${', end: '}' },
                modules,
            });

            // 4. Build data object
            const template = templates.find(t => t.id === instance.templateId);
            const createdDate = new Date(instance.createdAt);
            const statusLabels: Record<string, string> = {
                RUNNING: 'Đang xử lý', COMPLETED: 'Hoàn thành',
                REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
            };

            const data: Record<string, any> = {
                code: instance.code || '',
                title: instance.title || '',
                creator_name: creator?.name || '',
                creator_email: creator?.email || '',
                created_at_day: String(createdDate.getDate()).padStart(2, '0'),
                created_at_month: String(createdDate.getMonth() + 1).padStart(2, '0'),
                created_at_year: String(createdDate.getFullYear()),
                created_at_full: createdDate.toLocaleDateString('vi-VN'),
                template_name: template?.name || '',
                status: statusLabels[instance.status] || instance.status,
            };

            // Add signature keys for image module
            Object.keys(imageMap).forEach(key => { data[key] = key; });

            // Form data fields (auto-map)
            if (instance.formData) {
                Object.entries(instance.formData).forEach(([key, value]) => {
                    if (typeof value === 'object' && value !== null) {
                        if ((value as any).fileName) data[key] = (value as any).fileName;
                    } else {
                        data[key] = String(value ?? '');
                    }
                });
            }

            // Approver fields from logs
            instanceLogs.forEach(log => {
                const node = nodes.find(n => n.id === log.nodeId);
                if (node) {
                    const actor = users.find(u => u.id === log.actedBy);
                    const safeLabel = node.label.replace(/\s+/g, '_').toLowerCase();
                    data[`approver_${safeLabel}`] = actor?.name || '';
                    const logDate = new Date(log.createdAt);
                    data[`approved_date_${safeLabel}`] = logDate.toLocaleDateString('vi-VN');
                }
            });

            // 5. Replace placeholders
            doc.render(data);

            // 6. Generate and download
            const output = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            saveAs(output, `${instance.code}_${printTemplate.name}.docx`);
        } catch (err: any) {
            console.error('Export Word error:', err);
            alert('Lỗi khi xuất Word: ' + (err.message || 'Không xác định'));
        }
    };

    const handleAction = async (instanceId: string, action: WorkflowInstanceAction) => {
        setProcessingId(instanceId);
        let instance = instances.find(i => i.id === instanceId);
        try {
            // Save step data if any
            if (instance) {
                instance = await ensureInstanceFormData(instance);
                const nodeId = instance.currentNodeId;
                const newFormData = { ...(instance.formData || {}) };
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
                    const saved = await updateInstance(instanceId, { formData: newFormData });
                    if (!saved) throw new Error('Không lưu được dữ liệu bước');
                    instance = { ...instance, formData: newFormData };
                }
            }

            const ok = await processInstance(instanceId, action, user.id, actionComment);
            if (!ok) {
                showToast('error', 'Thao tác quy trình thất bại. Vui lòng thử lại.');
                return;
            }

            // 🎉 Celebration!
            if (action === WorkflowInstanceAction.APPROVED) {
                celebrate({
                    variant: 'approve',
                    title: '✅ Đã Duyệt Thành Công!',
                    subtitle: instance?.title || '',
                    confetti: true,
                });
            } else if (action === WorkflowInstanceAction.REJECTED) {
                celebrationToast({ type: 'warning', title: 'Phiếu đã bị từ chối', message: instance?.title || '' });
            } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
                celebrationToast({ type: 'info', title: 'Yêu cầu chỉnh sửa đã gửi', message: instance?.title || '' });
            }

            setActionComment('');
            setStepFormData({});
            setStepExcelData(null);
        } catch (err) {
            console.error('handleAction error:', err);
            showToast('error', 'Không xử lý được phiếu. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    // Edit instance handlers
    const openEditModal = async (instance: WorkflowInstance) => {
        const readyInstance = await ensureInstanceFormData(instance);
        setEditingInstance(readyInstance);
        setEditTitle(readyInstance.title);
        // Extract only the original form data (non step_ prefixed)
        const originalFormData: Record<string, any> = {};
        Object.entries(readyInstance.formData || {}).forEach(([key, value]) => {
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

    // Check if instance has any approval actions (approved by someone other than creator)
    const hasBeenApproved = (instance: WorkflowInstance): boolean => {
        const instanceLogs = getInstanceLogs(instance.id);
        return instanceLogs.some(l => l.action === 'APPROVED');
    };

    // Non-admin: can only delete own instances that have NOT been approved by anyone
    // Admin: can always delete
    const canDeleteInstance = (instance: WorkflowInstance): boolean => {
        if (user.role === Role.ADMIN) return true;
        return isCreator(instance) && !hasBeenApproved(instance);
    };

    // Check if user can approve current node
    const canActOnInstance = (instance: WorkflowInstance): boolean => {
        if (instance.status !== WorkflowInstanceStatus.RUNNING || !instance.currentNodeId) return false;
        const currentNode = nodes.find(n => n.id === instance.currentNodeId);
        if (!currentNode) return false;
        if (currentNode.type === WorkflowNodeType.START || currentNode.type === WorkflowNodeType.END) return false;
        if (user.role === Role.ADMIN) return true;
        // Managers can act on all instances of their templates
        const tmpl = templates.find(t => t.id === instance.templateId);
        if (tmpl?.managers?.includes(user.id)) return true;
        if (isWorkflowStepAssignedToUser(instance, currentNode, user)) return true;
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

    useEffect(() => {
        if (!targetInstanceId) return;
        const target = instances.find(instance => instance.id === targetInstanceId);
        if (!target) return;

        setViewMode('list');
        setFilterStatus('ALL');
        setSearchTerm('');
        setExpandedId(target.id);

        if (canActOnInstance(target)) setActiveTab('pending');
        else if (target.watchers?.includes(user.id)) setActiveTab('watching');
        else setActiveTab('mine');

        ensureInstanceFormData(target).catch(console.error);
        window.requestAnimationFrame(() => {
            instanceRefs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, [ensureInstanceFormData, instances, targetInstanceId, user.id]);

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
                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.type === 'text' && (
                    <input
                        type="text"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'textarea' && (
                    <textarea
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none disabled:opacity-50"
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
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'date' && (
                    <input
                        type="date"
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    />
                )}
                {field.type === 'select' && (
                    <select
                        value={data[field.name] || ''}
                        onChange={e => onChange(field.name, e.target.value)}
                        disabled={disabled}
                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold disabled:opacity-50"
                    >
                        <option value="">-- Chọn {field.label.toLowerCase()} --</option>
                        {(field.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                )}
                {field.type === 'table' && (
                    <TableFieldInput
                        fieldName={field.name}
                        columns={field.options || []}
                        value={data[field.name]}
                        onChange={(val: string[][]) => onChange(field.name, val)}
                        disabled={disabled}
                    />
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
        <div className={viewMode === 'list' ? "h-full w-full flex bg-slate-100 dark:bg-slate-955 overflow-hidden relative select-none" : "space-y-6 p-4 sm:p-6 md:p-8"}>
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

            {/* ==================== LIST VIEW (3-PANEL WORKSPACE) ==================== */}
            {viewMode === 'list' && (
                <>
                    {/* PANEL 1: Workflow Categories & Status Sidebar (Width: 260px) */}
                    <aside className="w-[260px] bg-slate-50 border-r border-slate-200 dark:bg-[#2b2d31] dark:border-slate-800 flex flex-col h-full shrink-0">
                        {/* Sidebar Header */}
                        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4">
                            <div className="flex items-center gap-2 min-w-0">
                                <GitBranch className="text-accent shrink-0" size={18} />
                                <span className="text-sm font-black text-slate-800 dark:text-white truncate">Quy trình duyệt</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedTemplateId('');
                                    setNewTitle('');
                                    setNewNote('');
                                    setCustomFormData({});
                                    setShowCreateModal(true);
                                }}
                                disabled={nonMaterialActiveTemplates.length === 0}
                                title="Tạo phiếu mới"
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white hover:bg-emerald-600 transition disabled:opacity-50"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        {/* Workflow Tabs */}
                        <div className="p-3 shrink-0 space-y-1">
                            {([
                                { id: 'mine', label: 'Quy trình của tôi', icon: FileText },
                                { id: 'pending', label: 'Chờ tôi duyệt', icon: Inbox },
                                { id: 'watching', label: 'Theo dõi', icon: Eye },
                            ] as { id: string; label: string; icon: any }[]).map(tab => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                const count = tab.id === 'pending'
                                    ? visibleListInstances.filter(canActOnInstance).length
                                    : tab.id === 'watching'
                                        ? visibleListInstances.filter(i => i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id)).length
                                        : 0;

                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => { setActiveTab(tab.id as any); setExpandedId(null); }}
                                        className={`flex items-center justify-between w-full px-3 py-2 rounded-xl text-xs font-bold transition select-none ${isActive
                                            ? 'bg-indigo-50 dark:bg-[#35373c] text-indigo-650 dark:text-white font-black'
                                            : 'text-slate-600 dark:text-[#949ba4] hover:bg-slate-200/60 dark:hover:bg-[#2e3035] hover:text-slate-900 dark:hover:text-[#dbdee1]'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Icon size={14} className="shrink-0" />
                                            <span className="truncate">{tab.label}</span>
                                        </div>
                                        {count > 0 && (
                                            <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black shrink-0">
                                                {count}
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
                                className={`w-full px-3 py-1.5 rounded-lg text-left text-[11px] font-bold transition flex items-center justify-between ${filterStatus === 'ALL'
                                    ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white'
                                    : 'text-slate-555 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-800 dark:hover:text-slate-300'
                                    }`}
                            >
                                <span>Tất cả</span>
                                <span className="text-[9px] opacity-60">({
                                    visibleListInstances.filter(i => {
                                        let matchTab = true;
                                        if (activeTab === 'mine') matchTab = i.createdBy === user.id;
                                        else if (activeTab === 'watching') matchTab = i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id) || false;
                                        else matchTab = (i.status === WorkflowInstanceStatus.RUNNING && i.currentNodeId && (isWorkflowStepAssignedToUser(i, nodes.find(n => n.id === i.currentNodeId)!, user) || user.role === Role.ADMIN || templateById.get(i.templateId)?.managers?.includes(user.id))) || false;
                                        return matchTab;
                                    }).length
                                })</span>
                            </button>
                            {Object.entries(STATUS_MAP).map(([s, config]) => {
                                const count = visibleListInstances.filter(i => {
                                    let matchTab = true;
                                    if (activeTab === 'mine') matchTab = i.createdBy === user.id;
                                    else if (activeTab === 'watching') matchTab = i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id) || false;
                                    else matchTab = (i.status === WorkflowInstanceStatus.RUNNING && i.currentNodeId && (isWorkflowStepAssignedToUser(i, nodes.find(n => n.id === i.currentNodeId)!, user) || user.role === Role.ADMIN || templateById.get(i.templateId)?.managers?.includes(user.id))) || false;
                                    return matchTab && i.status === s;
                                }).length;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setFilterStatus(s)}
                                        className={`w-full px-3 py-1.5 rounded-lg text-left text-[11px] font-bold transition flex items-center justify-between ${filterStatus === s
                                            ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white'
                                            : 'text-slate-555 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-800 dark:hover:text-slate-300'
                                            }`}
                                    >
                                        <span className="truncate">{config.label}</span>
                                        {count > 0 && <span className="text-[9px] opacity-60">({count})</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Templates List */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider px-2 py-1 select-none">
                                <span>Quy trình mẫu</span>
                            </div>
                            {nonMaterialActiveTemplates.map(t => {
                                const count = visibleListInstances.filter(i => {
                                    let matchTab = true;
                                    if (activeTab === 'mine') matchTab = i.createdBy === user.id;
                                    else if (activeTab === 'watching') matchTab = i.watchers?.includes(user.id) || templateById.get(i.templateId)?.defaultWatchers?.includes(user.id) || false;
                                    else matchTab = (i.status === WorkflowInstanceStatus.RUNNING && i.currentNodeId && (isWorkflowStepAssignedToUser(i, nodes.find(n => n.id === i.currentNodeId)!, user) || user.role === Role.ADMIN || templateById.get(i.templateId)?.managers?.includes(user.id))) || false;
                                    let matchStatus = filterStatus === 'ALL' ? true : i.status === filterStatus;
                                    return matchTab && matchStatus && i.templateId === t.id;
                                }).length;
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => {
                                            setSelectedTemplateIdFilter(selectedTemplateIdFilter === t.id ? '' : t.id);
                                        }}
                                        className={`w-full px-3 py-2 rounded-xl text-left text-xs font-bold transition flex items-center justify-between gap-2 ${selectedTemplateIdFilter === t.id
                                            ? 'bg-indigo-50 dark:bg-[#35373c] text-indigo-655 dark:text-white font-bold shadow-sm'
                                            : 'text-slate-600 dark:text-[#949ba4] hover:bg-slate-200/60 dark:hover:bg-[#2e3035] hover:text-slate-900 dark:hover:text-[#dbdee1]'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white shrink-0">
                                                <GitBranch size={10} />
                                            </div>
                                            <span className="truncate text-xs">{t.name}</span>
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

                    {/* If no activeInstanceId is selected, show PANEL 2 (Master list) as flex-1 */}
                    {!activeInstanceId ? (
                        <section className="flex-1 bg-white dark:bg-[#1e1f22] flex flex-col h-full overflow-hidden">
                            {/* Search Panel */}
                            <div className="p-4 shrink-0 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <div className="flex h-10 w-96 items-center gap-2.5 rounded-xl bg-slate-100 dark:bg-[#313338] px-3.5 text-slate-500 dark:text-slate-400">
                                    <Search size={16} />
                                    <input
                                        value={searchTerm}
                                        onChange={event => setSearchTerm(event.target.value)}
                                        placeholder="Tìm theo mã hoặc tiêu đề..."
                                        className="h-full min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-850 dark:text-[#dbdee1] outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    />
                                </div>
                                <div className="text-xs font-bold text-slate-400">
                                    Hiển thị {filteredInstances.length} phiếu
                                </div>
                            </div>

                            {/* Instance Cards List */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/10">
                                {filteredInstances.map(instance => {
                                    const template = templates.find(t => t.id === instance.templateId);
                                    const creator = users.find(u => u.id === instance.createdBy);
                                    const statusInfo = STATUS_MAP[instance.status];
                                    const StatusIcon = statusInfo.icon;
                                    const canAct = canActOnInstance(instance);
                                    const currentNode = nodes.find(n => n.id === instance.currentNodeId);

                                    return (
                                        <div
                                            key={instance.id}
                                            onClick={() => setExpandedId(instance.id)}
                                            className="p-5 rounded-2xl border bg-white hover:bg-slate-50/50 dark:bg-[#1e1f22] dark:hover:bg-[#2e3035] border-slate-200 dark:border-slate-800 transition-all shadow-sm hover:shadow duration-200 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 select-none"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    <span className="font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-500">{instance.code}</span>
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${statusInfo.color}`}>
                                                        <StatusIcon size={10} /> {statusInfo.label}
                                                    </span>
                                                    {canAct && (
                                                        <span className="text-[10px] font-bold text-amber-650 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded animate-pulse flex items-center gap-1">
                                                            <AlertCircle size={10} /> Cần duyệt
                                                        </span>
                                                    )}
                                                </div>
                                                <h3 className="font-bold text-sm text-slate-800 dark:text-white leading-snug mb-1 truncate">{instance.title}</h3>
                                                <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold">{template?.name}</p>
                                            </div>

                                            <div className="flex flex-row md:flex-col items-start md:items-end justify-between md:justify-center gap-2 shrink-0 md:text-right border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-slate-800">
                                                <div className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                                                    <User size={12} className="text-slate-400" /> {creator?.name}
                                                </div>
                                                <div className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
                                                    <Clock size={11} className="text-slate-450" /> {new Date(instance.createdAt).toLocaleString('vi-VN')}
                                                </div>
                                                {currentNode && instance.status === WorkflowInstanceStatus.RUNNING && (
                                                    <div className="text-[11px] font-black text-indigo-500 dark:text-indigo-400">
                                                        Bước hiện tại: {currentNode.label}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {filteredInstances.length === 0 && (
                                    <div className="text-center py-20 opacity-60">
                                        <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                        <p className="text-xs text-slate-500 font-bold">Không tìm thấy quy trình nào</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    ) : (
                        /* If activeInstanceId is selected, show PANEL 3 (Detail view) as flex-1 */
                        <main className="flex-1 bg-white dark:bg-[#313338] flex flex-col h-full overflow-hidden relative">
                            <div className="w-full h-full overflow-y-auto px-6 py-4 select-text">
                                <WorkflowInstanceDetail
                                    instanceId={activeInstanceId}
                                    onBack={() => { setExpandedId(null); setSearchParams({}, { replace: true }); }}
                                />
                            </div>
                        </main>
                    )}
                </>
            )}

            {/* ==================== KANBAN BOARD VIEW ==================== */}
            {viewMode === 'board' && (
                <div className="space-y-4 col-span-full">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <GitBranch className="text-accent" size={28} /> Quy trình duyệt
                            </h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Tạo và theo dõi các phiếu yêu cầu theo quy trình.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${(viewMode as string) === 'list' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <List size={14} /> Danh sách
                                </button>
                                <button
                                    onClick={() => setViewMode('board')}
                                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${(viewMode as string) === 'board' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <LayoutGrid size={14} /> Dạng bảng
                                </button>
                            </div>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                disabled={nonMaterialActiveTemplates.length === 0}
                                className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                            >
                                <Plus size={18} className="mr-2" /> Tạo phiếu mới
                            </button>
                        </div>
                    </div>

                    {/* Tabs & Filters */}
                    <div className="glass-card p-4 rounded-xl space-y-3">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setActiveTab('mine')}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'mine' ? 'bg-accent text-white shadow-md' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-355'}`}
                            >
                                <FileText size={13} /> Phiếu của tôi
                            </button>
                            <button
                                onClick={() => setActiveTab('pending')}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'pending' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-355'}`}
                            >
                                <Inbox size={13} /> Chờ tôi duyệt
                                {visibleListInstances.filter(canActOnInstance).length > 0 && (
                                    <span className="bg-white/30 px-1.5 py-0.5 rounded-full text-[10px]">
                                        {visibleListInstances.filter(canActOnInstance).length}
                                    </span>
                                )}
                            </button>
                            <button
                                onClick={() => setActiveTab('watching')}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'watching' ? 'bg-blue-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-355'}`}
                            >
                                <Eye size={13} /> Theo dõi
                                {(() => {
                                    const count = visibleListInstances.filter(i => {
                                        if (i.watchers?.includes(user.id)) return true;
                                        const tmpl = templateById.get(i.templateId);
                                        return tmpl?.defaultWatchers?.includes(user.id) || false;
                                    }).length;
                                    return count > 0 ? (
                                        <span className="bg-white/30 px-1.5 py-0.5 rounded-full text-[10px]">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                        </div>
                        <div className="flex flex-col md:flex-row gap-3">
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Tìm theo mã hoặc tiêu đề..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
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
                                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition ${filterStatus === s.id ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800' : 'bg-slate-100 dark:bg-slate-700 text-slate-555 dark:text-slate-400'}`}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Template selector for board view */}
                    <div className="glass-card p-4 rounded-xl">
                        <label className="text-xs font-bold text-slate-550 dark:text-slate-400 mb-2 block">Chọn quy trình để xem bảng:</label>
                        <div className="flex flex-wrap gap-2">
                            {boardTemplates.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setBoardTemplateId(t.id)}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${boardTemplateId === t.id
                                        ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-655 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                        }`}
                                >
                                    <GitBranch size={12} /> {t.name}
                                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">
                                        {visibleBoardInstances.filter(i => i.templateId === t.id && i.status === 'RUNNING').length}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {boardTemplateId ? (
                        <KanbanBoard
                            templateId={boardTemplateId}
                            instances={visibleBoardInstances}
                            employees={employees}
                            orgUnits={orgUnits}
                            onCardClick={async (instance) => {
                                await ensureInstanceFormData(instance);
                                navigate(`/wf/instances/${instance.id}`);
                            }}
                            onDragComplete={async (instanceId, action, comment, assigneeIds) => {
                                const ok = await processInstance(instanceId, action, user.id, comment, assigneeIds);
                                if (!ok) showToast('error', 'Không xử lý được phiếu.');
                            }}
                        />
                    ) : (
                        <div className="glass-card rounded-2xl p-12 flex flex-col items-center text-slate-400 dark:text-slate-500">
                            <LayoutGrid size={48} className="mb-4 opacity-30" />
                            <p className="text-sm font-bold">Chọn quy trình ở trên để xem dạng bảng Kanban</p>
                            <p className="text-xs mt-1">Mỗi cột đại diện cho một bước xử lý</p>
                        </div>
                    )}
                </div>
            )}

            {/* Board Detail Slide-over Modal */}
            {viewMode === 'board' && boardDetailInstanceId && (() => {
                const instance = instances.find(i => i.id === boardDetailInstanceId);
                if (!instance) return null;
                const template = templates.find(t => t.id === instance.templateId);
                const creator = users.find(u => u.id === instance.createdBy);
                const statusInfo = STATUS_MAP[instance.status];
                const StatusIcon = statusInfo.icon;

                return (
                    <div className="fixed inset-0 z-50 flex justify-end h-[100dvh] max-h-[100dvh] overflow-hidden">
                        {/* Backdrop */}
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                        {/* Panel */}
                        <div
                            className="relative bg-white dark:bg-slate-900 w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden"
                            style={{ animation: 'slideInRight 0.3s ease-out' }}
                        >
                            {/* Panel Header */}
                            <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 px-6 py-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-500">{instance.code}</span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${statusInfo.color}`}>
                                                <StatusIcon size={10} /> {statusInfo.label}
                                            </span>
                                        </div>
                                        <h3 className="font-bold text-lg text-slate-805 dark:text-white truncate">{instance.title}</h3>
                                        <p className="text-xs text-slate-400 mt-1">Tạo bởi: {creator?.name} • Quy trình: {template?.name}</p>
                                    </div>
                                    <button onClick={() => setBoardDetailInstanceId(null)} className="w-8 h-8 rounded-xl bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition">
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                            {/* Panel Body */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                <WorkflowInstanceDetail
                                    instanceId={instance.id}
                                    onBack={() => setBoardDetailInstanceId(null)}
                                />
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Shared Create Instance Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:w-[75vw] xl:max-w-[1050px] 2xl:max-w-[1200px] shadow-2xl flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh] overflow-hidden relative select-text animate-fade-in">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Send size={20} className="text-accent" /> Tạo phiếu mới
                        </h2>
                        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -webkit-overflow-scrolling-touch pr-1">
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Chọn quy trình *</label>
                                <select
                                    value={selectedTemplateId}
                                    onChange={e => handleSelectTemplate(e.target.value)}
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold"
                                >
                                    <option value="">-- Chọn quy trình --</option>
                                    {nonMaterialActiveTemplates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder="VD: Thanh toán hạng mục móng CT5..."
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-slate-850 dark:text-white"
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
                                <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                <textarea
                                    value={newNote}
                                    onChange={e => setNewNote(e.target.value)}
                                    placeholder="Nội dung chi tiết..."
                                    className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none text-slate-850 dark:text-white"
                                    rows={2}
                                />
                            </div>
                        </div>
                        <div className="flex gap-4 mt-8 border-t border-slate-100 dark:border-slate-700/50 pt-5">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button
                                onClick={handleCreate}
                                disabled={isSubmitting || !selectedTemplateId || !newTitle.trim() || selectedCustomFields.some(f => f.required && !customFormData[f.name])}
                                className="flex-1 px-5 py-3 bg-accent text-white rounded-xl font-bold text-base hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
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

            {/* Shared Edit Instance Modal */}
            {editingInstance && (() => {
                const editTemplate = templates.find(t => t.id === editingInstance.templateId);
                const editCustomFields = editTemplate?.customFields || [];
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4">
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:w-[75vw] xl:max-w-[1050px] 2xl:max-w-[1200px] shadow-2xl flex flex-col h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh] overflow-hidden relative select-text animate-fade-in">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Edit2 size={20} className="text-blue-500" /> Sửa phiếu
                            </h2>
                            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -webkit-overflow-scrolling-touch pr-1">
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mã phiếu</label>
                                    <input
                                        type="text" value={editingInstance.code} disabled
                                        className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-base opacity-60 font-semibold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tiêu đề phiếu *</label>
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={e => setEditTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-slate-850 dark:text-white"
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
                                    <label className="block text-sm font-bold text-slate-500 dark:text-slate-405 uppercase tracking-wider mb-1.5">Ghi chú</label>
                                    <textarea
                                        value={editFormData.note || ''}
                                        onChange={e => setEditFormData(prev => ({ ...prev, note: e.target.value }))}
                                        className="w-full px-4 py-3 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-base font-semibold resize-none text-slate-850 dark:text-white"
                                        rows={2}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-4 mt-8 border-t border-slate-100 dark:border-slate-700/50 pt-5">
                                <button onClick={() => setEditingInstance(null)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
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

            {/* Shared Delete Confirm Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-scale-in">
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa phiếu?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Phiếu và tất cả lịch sử xử lý sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-650 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Cancel Confirm Modal */}
            {cancelConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl animate-scale-in">
                        <h2 className="text-lg font-bold text-amber-600 mb-2">Hủy phiếu?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Phiếu sẽ bị hủy và không thể tiếp tục xử lý. Bạn vẫn có thể xem lại phiếu đã hủy.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setCancelConfirmId(null)} className="flex-1 px-5 py-3 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-base hover:bg-slate-50 dark:hover:bg-slate-700 transition">Đóng</button>
                            <button onClick={() => handleCancel(cancelConfirmId)} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-655 transition shadow-lg shadow-amber-500/20">Xác nhận hủy</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Shared Reopen/Revert Modal for Admin */}
            {reopenInstanceId && (() => {
                const inst = instances.find(i => i.id === reopenInstanceId);
                if (!inst) return null;
                const tplNodes = nodes.filter(n => n.templateId === inst.templateId && n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END);
                // Order nodes by edge sequence
                const tplEdges = edges.filter(e => e.templateId === inst.templateId);
                const startNode = nodes.find(n => n.templateId === inst.templateId && n.type === WorkflowNodeType.START);
                const orderedNodes: typeof tplNodes = [];
                if (startNode) {
                    let currentId = startNode.id;
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
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                        <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl animate-scale-in">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                                <Undo2 size={20} className="text-purple-500" /> Mở lại quy trình
                            </h2>
                            <p className="text-xs text-slate-400 mb-4">Chọn bước muốn quay lại để tiếp tục xử lý.</p>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-1.5">Quay lại bước *</label>
                                    <select
                                        value={reopenTargetNodeId}
                                        onChange={e => setReopenTargetNodeId(e.target.value)}
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500 text-slate-850 dark:text-white"
                                    >
                                        <option value="">-- Chọn bước --</option>
                                        {displayNodes.map((n, idx) => (
                                            <option key={n.id} value={n.id}>Bước {idx + 1}: {n.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-1.5">Lý do mở lại</label>
                                    <textarea
                                        value={reopenComment}
                                        onChange={e => setReopenComment(e.target.value)}
                                        placeholder="Nhập lý do mở lại quy trình..."
                                        className="w-full px-3 py-2 bg-white/80 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500 resize-none text-slate-850 dark:text-white"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setReopenInstanceId(null)}
                                        className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-650 dark:text-slate-355 rounded-xl text-xs font-bold hover:bg-slate-200 transition"
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
                                        className="px-4 py-2 bg-purple-500 text-white rounded-xl text-xs font-bold hover:bg-purple-650 transition shadow-md shadow-purple-500/20 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Undo2 size={13} /> Mở lại
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Shared File Preview Modal */}
            {previewFile && (
                <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
            )}
        </div>
    );
};

export default WorkflowInstances;
