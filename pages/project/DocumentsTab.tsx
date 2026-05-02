import React, { useState, useEffect, useRef, useCallback } from 'react';
import AiInsightPanel from '../../components/AiInsightPanel';
import {
    Upload, FileText, Image, File as FileIcon, Trash2, Download, Eye, X, Plus,
    Search, Filter, Tag, Edit2, Save, FolderOpen, Paperclip, Clock,
    CheckCircle2, AlertTriangle, ChevronDown
} from 'lucide-react';
import { documentService, ProjectDocument, DOC_CATEGORIES } from '../../lib/documentService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface DocumentsTabProps {
    constructionSiteId?: string;
    projectId?: string;
    uploadedBy?: string;
}

const FILE_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
    'application/pdf': { icon: <FileText size={18} />, color: 'text-red-500 bg-red-50' },
    'image/jpeg': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
    'image/png': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
    'image/webp': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
    'image/gif': { icon: <Image size={18} />, color: 'text-purple-500 bg-purple-50' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: <FileText size={18} />, color: 'text-emerald-500 bg-emerald-50' },
    'application/vnd.ms-excel': { icon: <FileText size={18} />, color: 'text-emerald-500 bg-emerald-50' },
    'application/msword': { icon: <FileText size={18} />, color: 'text-blue-600 bg-blue-50' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: <FileText size={18} />, color: 'text-blue-600 bg-blue-50' },
};

const getFileIcon = (fileType: string) => FILE_ICONS[fileType] || { icon: <FileIcon size={18} />, color: 'text-slate-500 bg-slate-50' };

const DocumentsTab: React.FC<DocumentsTabProps> = ({ constructionSiteId, projectId, uploadedBy }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const effectiveId = projectId || constructionSiteId || '';
    const [documents, setDocuments] = useState<ProjectDocument[]>([]);
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<ProjectDocument | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    // Upload form
    const [uploadFiles, setUploadFiles] = useState<File[]>([]);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadCategory, setUploadCategory] = useState('general');
    const [uploadDescription, setUploadDescription] = useState('');
    const [uploadTags, setUploadTags] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load documents
    const loadDocs = useCallback(async () => {
        if (!effectiveId) return;
        const docs = await documentService.list(effectiveId, filterCategory, constructionSiteId || null);
        setDocuments(docs);
    }, [effectiveId, filterCategory, constructionSiteId]);

    useEffect(() => { loadDocs(); }, [loadDocs]);

    // Search filter
    const filteredDocs = documents.filter(d => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return d.title.toLowerCase().includes(q) ||
               d.fileName.toLowerCase().includes(q) ||
               (d.description || '').toLowerCase().includes(q) ||
               d.tags.some(t => t.toLowerCase().includes(q));
    });

    // Drag & drop
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const files: File[] = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            setUploadFiles(files);
            setUploadTitle(files[0].name.replace(/\.[^.]+$/, ''));
            setShowUploadModal(true);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files: File[] = Array.from(e.target.files || []);
        if (files.length > 0) {
            setUploadFiles(files);
            setUploadTitle(files[0].name.replace(/\.[^.]+$/, ''));
            setShowUploadModal(true);
        }
    };

    const handleUpload = async () => {
        if (uploadFiles.length === 0 || !uploadTitle) return;
        // Validate file sizes
        for (const file of uploadFiles) {
            const v = documentService.validateFile(file);
            if (!v.valid) { toast.warning('File không hợp lệ', v.error); return; }
        }
        setUploading(true);
        try {
            const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean);
            for (const file of uploadFiles) {
                await documentService.upload(file, effectiveId, {
                    title: uploadFiles.length === 1 ? uploadTitle : file.name.replace(/\.[^.]+$/, ''),
                    category: uploadCategory,
                    projectId: projectId || constructionSiteId || null,
                    constructionSiteId: constructionSiteId || null,
                    description: uploadDescription || undefined,
                    uploadedBy,
                    tags,
                });
            }
            await loadDocs();
            resetUploadForm();
            toast.success('Tải lên thành công', `${uploadFiles.length} file đã được tải lên`);
        } catch (err: any) {
            console.error('Upload failed:', err);
            toast.error('Lỗi upload', err?.message);
        } finally {
            setUploading(false);
        }
    };

    const resetUploadForm = () => {
        setShowUploadModal(false);
        setUploadFiles([]);
        setUploadTitle('');
        setUploadCategory('general');
        setUploadDescription('');
        setUploadTags('');
    };

    const handleDelete = async (doc: ProjectDocument) => {
        const ok = await confirm({ targetName: doc.title, title: 'Xoá tài liệu', warningText: 'File sẽ bị xóa khỏi Storage vĩnh viễn.' });
        if (!ok) return;
        try {
            await documentService.remove(doc);
            await loadDocs();
            toast.success('Xoá tài liệu thành công');
        } catch (e: any) {
            toast.error('Lỗi xoá', e?.message);
        }
    };

    const handleDownload = async (doc: ProjectDocument) => {
        const url = await documentService.getSignedUrl(doc.storagePath);
        window.open(url, '_blank');
    };

    const handlePreview = async (doc: ProjectDocument) => {
        const url = await documentService.getSignedUrl(doc.storagePath);
        setPreviewUrl(url);
        setPreviewDoc(doc);
    };

    // Stats
    const totalSize = documents.reduce((s, d) => s + d.fileSize, 0);
    const imageCount = documents.filter(d => documentService.isImage(d.fileType)).length;
    const pdfCount = documents.filter(d => documentService.isPdf(d.fileType)).length;

    return (
        <div className="space-y-5">
            {/* AI Analysis */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-white">Tài liệu dự án</h3>
                <AiInsightPanel module="documents" siteId={constructionSiteId} />
            </div>
            {/* KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Tổng tài liệu', value: documents.length, icon: <FolderOpen size={11} />, color: 'text-indigo-600' },
                    { label: 'Dung lượng', value: documentService.formatSize(totalSize), icon: <Paperclip size={11} />, color: 'text-cyan-600' },
                    { label: 'Hình ảnh', value: imageCount, icon: <Image size={11} />, color: 'text-pink-600' },
                    { label: 'PDF', value: pdfCount, icon: <FileText size={11} />, color: 'text-red-600' },
                ].map((k, i) => (
                    <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">{k.icon} {k.label}</div>
                        <div className={`text-lg font-black ${k.color}`}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
                <div className="flex flex-col md:flex-row gap-3">
                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Tìm tài liệu..."
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-700 dark:text-white" />
                    </div>
                    {/* Category Filter */}
                    <div className="relative">
                        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                            className="appearance-none pl-3 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold bg-white dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                            <option value="all">📁 Tất cả</option>
                            {DOC_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    {/* Upload Button */}
                    <button onClick={() => { resetUploadForm(); setShowUploadModal(true); }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg hover:shadow-xl transition-all">
                        <Upload size={14} /> Tải lên
                    </button>
                </div>
            </div>

            {/* Drop zone + File list */}
            <div
                className={`bg-white dark:bg-slate-800 rounded-2xl border-2 border-dashed transition-all ${dragOver ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-600'} shadow-sm overflow-hidden`}
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            >
                {filteredDocs.length === 0 ? (
                    <div className="p-16 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={48} className={`mx-auto mb-4 ${dragOver ? 'text-indigo-400 animate-bounce' : 'text-slate-200'}`} />
                        <p className="text-sm font-bold text-slate-400">
                            {dragOver ? 'Thả file vào đây!' : 'Kéo thả file hoặc nhấn để chọn'}
                        </p>
                        <p className="text-[10px] text-slate-300 mt-1">Hỗ trợ PDF, hình ảnh, Excel, Word, AutoCAD...</p>
                    </div>
                ) : (
                    <div>
                        {/* Header */}
                        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                <FolderOpen size={14} className="text-indigo-500" />
                                Tài liệu ({filteredDocs.length})
                            </span>
                            <button onClick={() => fileInputRef.current?.click()}
                                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
                                <Plus size={10} /> Thêm file
                            </button>
                        </div>

                        {/* File Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0.5 p-2">
                            {filteredDocs.map(doc => {
                                const fi = getFileIcon(doc.fileType);
                                const catConfig = DOC_CATEGORIES.find(c => c.key === doc.category);
                                const isImg = documentService.isImage(doc.fileType);
                                const thumbUrl = isImg ? documentService.getPublicUrl(doc.storagePath) : null;

                                return (
                                    <div key={doc.id}
                                        className="group relative bg-white dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500 transition-all p-3 cursor-pointer"
                                        onClick={() => handlePreview(doc)}>
                                        <div className="flex items-start gap-3">
                                            {/* Thumbnail or Icon */}
                                            {thumbUrl ? (
                                                <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-slate-100">
                                                    <img src={thumbUrl} alt={doc.title} className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${fi.color}`}>
                                                    {fi.icon}
                                                </div>
                                            )}
                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{doc.title}</div>
                                                <div className="text-[10px] text-slate-400 truncate">{doc.fileName}</div>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    {catConfig && (
                                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold border ${catConfig.color}`}>
                                                            {catConfig.label}
                                                        </span>
                                                    )}
                                                    <span className="text-[9px] text-slate-300">{documentService.formatSize(doc.fileSize)}</span>
                                                    <span className="text-[9px] text-slate-300">{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
                                                </div>
                                                {doc.tags.length > 0 && (
                                                    <div className="flex gap-1 mt-1 flex-wrap">
                                                        {doc.tags.slice(0, 3).map(t => (
                                                            <span key={t} className="px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-50 text-indigo-500 border border-indigo-100">#{t}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {/* Hover actions */}
                                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={e => { e.stopPropagation(); handleDownload(doc); }}
                                                className="w-6 h-6 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500" title="Tải xuống">
                                                <Download size={11} />
                                            </button>
                                            <button onClick={e => { e.stopPropagation(); handleDelete(doc); }}
                                                className="w-6 h-6 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500" title="Xoá">
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" multiple className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.doc,.docx,.dwg,.dxf,.zip,.rar"
                onChange={handleFileSelect} />

            {/* Upload Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-600 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-t-3xl flex items-center justify-between">
                            <span className="font-bold text-lg text-white flex items-center gap-2"><Upload size={18} /> Tải lên tài liệu</span>
                            <button onClick={resetUploadForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Selected files */}
                            {uploadFiles.length > 0 && (
                                <div className="space-y-2">
                                    {uploadFiles.map((f, i) => (
                                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getFileIcon(f.type).color}`}>
                                                {getFileIcon(f.type).icon}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{f.name}</div>
                                                <div className="text-[10px] text-slate-400">{documentService.formatSize(f.size)}</div>
                                            </div>
                                            <button onClick={() => setUploadFiles(uploadFiles.filter((_, j) => j !== i))}
                                                className="text-slate-300 hover:text-red-500"><X size={14} /></button>
                                        </div>
                                    ))}
                                    <button onClick={() => fileInputRef.current?.click()}
                                        className="w-full py-2 rounded-xl border border-dashed border-slate-200 text-[10px] font-bold text-slate-400 hover:text-indigo-500 hover:border-indigo-300 flex items-center justify-center gap-1">
                                        <Plus size={10} /> Thêm file
                                    </button>
                                </div>
                            )}

                            {/* Title */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tiêu đề *</label>
                                <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                                    placeholder="VD: Hợp đồng xây dựng Block A"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-700 dark:text-white" />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Danh mục</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {DOC_CATEGORIES.map(c => (
                                        <button key={c.key} onClick={() => setUploadCategory(c.key)}
                                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${uploadCategory === c.key ? c.color + ' ring-2 ring-offset-1 ring-indigo-300' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400'}`}>
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mô tả (tuỳ chọn)</label>
                                <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)}
                                    rows={2} placeholder="Ghi chú..."
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none dark:bg-slate-700 dark:text-white" />
                            </div>

                            {/* Tags */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tags (cách nhau bằng dấu phẩy)</label>
                                <input value={uploadTags} onChange={e => setUploadTags(e.target.value)}
                                    placeholder="VD: block-a, tầng-1, kết-cấu"
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-700 dark:text-white" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
                            <button onClick={resetUploadForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">Huỷ</button>
                            <button onClick={handleUpload} disabled={uploadFiles.length === 0 || !uploadTitle || uploading}
                                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg flex items-center gap-2 disabled:opacity-50 hover:shadow-xl transition-all">
                                {uploading ? (
                                    <><Clock size={14} className="animate-spin" /> Đang tải...</>
                                ) : (
                                    <><Upload size={14} /> Tải lên {uploadFiles.length > 1 ? `(${uploadFiles.length} file)` : ''}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {previewDoc && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-600 w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getFileIcon(previewDoc.fileType).color}`}>
                                    {getFileIcon(previewDoc.fileType).icon}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-black text-slate-700 dark:text-white truncate">{previewDoc.title}</div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                        <span>{previewDoc.fileName}</span>
                                        <span>•</span>
                                        <span>{documentService.formatSize(previewDoc.fileSize)}</span>
                                        <span>•</span>
                                        <span>{new Date(previewDoc.createdAt).toLocaleDateString('vi-VN')}</span>
                                        {previewDoc.uploadedBy && <><span>•</span><span>{previewDoc.uploadedBy}</span></>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => handleDownload(previewDoc)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100">
                                    <Download size={12} /> Tải xuống
                                </button>
                                <button onClick={() => setPreviewDoc(null)}
                                    className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-slate-600"><X size={18} /></button>
                            </div>
                        </div>
                        {/* Content */}
                        <div className="flex-1 overflow-auto p-4">
                            {documentService.isImage(previewDoc.fileType) ? (
                                <div className="flex items-center justify-center min-h-[300px]">
                                    <img src={previewUrl}
                                        alt={previewDoc.title}
                                        className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-lg" />
                                </div>
                            ) : documentService.isPdf(previewDoc.fileType) ? (
                                <iframe
                                    src={previewUrl}
                                    className="w-full h-[70vh] rounded-xl border border-slate-200"
                                    title={previewDoc.title} />
                            ) : (
                                <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
                                    <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 ${getFileIcon(previewDoc.fileType).color}`}>
                                        <FileIcon size={36} />
                                    </div>
                                    <p className="text-sm font-bold text-slate-500">Không thể xem trước loại file này</p>
                                    <p className="text-[10px] text-slate-400 mt-1">{previewDoc.fileType}</p>
                                    <button onClick={() => handleDownload(previewDoc)}
                                        className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg">
                                        <Download size={14} /> Tải xuống để xem
                                    </button>
                                </div>
                            )}
                            {/* Description & Tags */}
                            {(previewDoc.description || previewDoc.tags.length > 0) && (
                                <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600">
                                    {previewDoc.description && (
                                        <p className="text-xs text-slate-600 dark:text-slate-300">{previewDoc.description}</p>
                                    )}
                                    {previewDoc.tags.length > 0 && (
                                        <div className="flex gap-1.5 mt-2 flex-wrap">
                                            {previewDoc.tags.map(t => (
                                                <span key={t} className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-indigo-50 text-indigo-500 border border-indigo-100">#{t}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DocumentsTab;
