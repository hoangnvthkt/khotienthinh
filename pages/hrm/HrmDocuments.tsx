import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  Search, Upload, FileText, Image, File as FileIcon, Trash2, Download, Eye, X, Plus,
  Filter, Tag, FolderOpen, Paperclip, Clock, ChevronDown, Mail, MailOpen, Send,
  User, Calendar, AlertTriangle, CheckCircle2, Archive, Hash, Building2, Settings, Pencil, GripVertical
} from 'lucide-react';
import {
  hrmDocumentService, HrmDocument, DocCategory, DOC_STATUS_CONFIG
} from '../../lib/hrmDocumentService';

type DocTab = 'employee_record' | 'incoming' | 'outgoing';

const FILE_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  'application/pdf': { icon: <FileText size={18} />, color: 'text-red-500 bg-red-50' },
  'image/jpeg': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
  'image/png': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
  'image/webp': { icon: <Image size={18} />, color: 'text-blue-500 bg-blue-50' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: <FileText size={18} />, color: 'text-emerald-500 bg-emerald-50' },
  'application/vnd.ms-excel': { icon: <FileText size={18} />, color: 'text-emerald-500 bg-emerald-50' },
  'application/msword': { icon: <FileText size={18} />, color: 'text-blue-600 bg-blue-50' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: <FileText size={18} />, color: 'text-blue-600 bg-blue-50' },
};
const getFileIcon = (ft: string) => FILE_ICONS[ft] || { icon: <FileIcon size={18} />, color: 'text-slate-500 bg-slate-50' };

const TAB_CONFIG: { key: DocTab; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'employee_record', label: 'Hồ sơ NV', icon: <User size={16} />, color: 'from-indigo-500 to-blue-500' },
  { key: 'incoming', label: 'Công văn đến', icon: <MailOpen size={16} />, color: 'from-emerald-500 to-teal-500' },
  { key: 'outgoing', label: 'Công văn đi', icon: <Send size={16} />, color: 'from-violet-500 to-purple-500' },
];

import { usePermission } from '../../hooks/usePermission';

const HrmDocuments: React.FC = () => {
  useModuleData('hrm');
  const { employees, user } = useApp();
  const { theme } = useTheme();
  const { canManage } = usePermission();
  const canCRUD = canManage('/hrm/documents');

  const [activeTab, setActiveTab] = useState<DocTab>('employee_record');
  const [documents, setDocuments] = useState<HrmDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<HrmDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Dynamic categories
  const [allCategories, setAllCategories] = useState<DocCategory[]>([]);
  const [showCatManager, setShowCatManager] = useState(false);
  const [editingCat, setEditingCat] = useState<DocCategory | null>(null);
  const [catForm, setCatForm] = useState({ label: '', icon: '📁', key: '' });

  // Upload form
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadDocNumber, setUploadDocNumber] = useState('');
  const [uploadEmployeeId, setUploadEmployeeId] = useState('');
  const [uploadSender, setUploadSender] = useState('');
  const [uploadReceiver, setUploadReceiver] = useState('');
  const [uploadDocDate, setUploadDocDate] = useState('');
  const [uploadDeadline, setUploadDeadline] = useState('');
  const [uploadAssignedTo, setUploadAssignedTo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  // Load categories from DB
  const loadCategories = useCallback(async () => {
    const cats = await hrmDocumentService.listCategories();
    setAllCategories(cats);
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const categories = useMemo(() => allCategories.filter(c => c.docType === activeTab), [allCategories, activeTab]);

  // Load documents
  const loadDocs = useCallback(async () => {
    setIsSearching(true);
    try {
      let docs: HrmDocument[];
      if (searchQuery.trim()) {
        docs = await hrmDocumentService.search(searchQuery.trim(), activeTab);
      } else {
        docs = await hrmDocumentService.list(activeTab, filterCategory !== 'all' ? filterCategory : undefined);
      }
      setDocuments(docs);
    } finally {
      setIsSearching(false);
    }
  }, [activeTab, searchQuery, filterCategory]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // Debounce search
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {}, 300);
  };

  // Drag & drop
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
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

  const resetUploadForm = async () => {
    setShowUploadModal(false);
    setUploadFiles([]); setUploadTitle(''); setUploadCategory('other');
    setUploadDescription(''); setUploadTags(''); setUploadDocNumber('');
    setUploadEmployeeId(''); setUploadSender(''); setUploadReceiver('');
    setUploadDocDate(''); setUploadDeadline(''); setUploadAssignedTo('');
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || !uploadTitle) return;
    if (activeTab === 'employee_record' && !uploadEmployeeId) { alert('Vui lòng chọn nhân viên'); return; }
    setUploading(true);
    try {
      const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean);
      let docNumber = uploadDocNumber;
      if ((activeTab === 'incoming' || activeTab === 'outgoing') && !docNumber) {
        docNumber = await hrmDocumentService.getNextDocNumber(activeTab);
      }
      let successCount = 0;
      for (const file of uploadFiles) {
        const v = hrmDocumentService.validateFile(file);
        if (!v.valid) { alert(v.error); continue; }
        const result = await hrmDocumentService.upload(file, {
          docType: activeTab,
          docCategory: uploadCategory,
          title: uploadFiles.length === 1 ? uploadTitle : file.name.replace(/\.[^.]+$/, ''),
          employeeId: uploadEmployeeId || undefined,
          docNumber: docNumber || undefined,
          description: uploadDescription || undefined,
          sender: uploadSender || undefined,
          receiver: uploadReceiver || undefined,
          assignedTo: uploadAssignedTo || undefined,
          docDate: uploadDocDate || undefined,
          deadline: uploadDeadline || undefined,
          tags, uploadedBy: user?.name,
        });
        if (result) successCount++;
      }
      if (successCount > 0) {
        await loadDocs();
        resetUploadForm();
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
      alert('Lỗi upload: ' + (err?.message || 'Không xác định'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: HrmDocument) => {
    if (!confirm(`Xoá "${doc.title}"?`)) return;
    await hrmDocumentService.remove(doc);
    await loadDocs();
  };

  const handleDownload = async (doc: HrmDocument) => {
    const url = await hrmDocumentService.getSignedUrl(doc.storagePath);
    window.open(url, '_blank');
  };

  const handlePreview = async (doc: HrmDocument) => {
    const url = await hrmDocumentService.getSignedUrl(doc.storagePath);
    setPreviewUrl(url); setPreviewDoc(doc);
  };

  const handleStatusChange = async (doc: HrmDocument, newStatus: string) => {
    await hrmDocumentService.updateStatus(doc.id, newStatus);
    await loadDocs();
  };

  // KPIs
  const kpis = useMemo(() => {
    const overdue = documents.filter(d => d.deadline && new Date(d.deadline) < new Date() && d.status !== 'completed').length;
    return {
      total: documents.length,
      processing: documents.filter(d => d.status === 'processing' || d.status === 'active').length,
      overdue,
    };
  }, [documents]);

  const currentTabConfig = TAB_CONFIG.find(t => t.key === activeTab)!;

  // ---- Category CRUD handlers ----
  const handleAddCategory = async () => {
    if (!catForm.label.trim()) return;
    const key = catForm.key.trim() || catForm.label.toLowerCase().replace(/[^a-z0-9]/g, '_');
    await hrmDocumentService.addCategory({
      docType: activeTab, key, label: catForm.label, icon: catForm.icon,
      sortOrder: categories.length + 1,
    });
    setCatForm({ label: '', icon: '📁', key: '' });
    await loadCategories();
  };

  const handleUpdateCategory = async () => {
    if (!editingCat || !catForm.label.trim()) return;
    await hrmDocumentService.updateCategory(editingCat.id, { label: catForm.label, icon: catForm.icon });
    setEditingCat(null); setCatForm({ label: '', icon: '📁', key: '' });
    await loadCategories();
  };

  const handleDeleteCategory = async (cat: DocCategory) => {
    if (!confirm(`Xoá danh mục "${cat.icon} ${cat.label}"?`)) return;
    await hrmDocumentService.deleteCategory(cat.id);
    await loadCategories();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <FolderOpen className="text-indigo-500" size={24} /> Hồ sơ & Công văn
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Lưu trữ tập trung, tìm kiếm thông minh</p>
        </div>
        {canCRUD && (
        <button onClick={() => { resetUploadForm(); setShowUploadModal(true); }}
          className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-xs font-black hover:shadow-lg transition flex items-center gap-1.5 shadow-md">
          <Upload size={16} /> Tải lên
        </button>
        )}
      </div>

      {/* 🔍 SMART SEARCH BAR */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <div className="relative">
          <Search size={20} className={`absolute left-4 top-1/2 -translate-y-1/2 ${isSearching ? 'text-indigo-500 animate-pulse' : 'text-slate-300'}`} />
          <input
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="🔍 Tìm kiếm: tên nhân viên, số công văn, nội dung, tag..."
            className="w-full pl-12 pr-4 py-3.5 rounded-xl border-2 border-slate-200 dark:border-slate-600 text-sm font-bold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none dark:bg-slate-700 dark:text-white transition-all placeholder:text-slate-400 placeholder:font-normal"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="mt-2 text-[10px] font-bold text-slate-400">
            {isSearching ? '⏳ Đang tìm...' : `📋 Tìm thấy ${documents.length} kết quả cho "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tổng tài liệu', value: kpis.total, icon: <FolderOpen size={12} />, color: 'text-indigo-600' },
          { label: 'Đang xử lý', value: kpis.processing, icon: <Clock size={12} />, color: 'text-blue-600' },
          { label: 'Quá hạn', value: kpis.overdue, icon: <AlertTriangle size={12} />, color: kpis.overdue > 0 ? 'text-red-600' : 'text-slate-400' },
        ].map((k, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 shadow-sm">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">{k.icon} {k.label}</div>
            <div className={`text-xl font-black ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {TAB_CONFIG.map(tab => (
          <button key={tab.key}
            onClick={() => { setActiveTab(tab.key); setFilterCategory('all'); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-black transition-all ${
              activeTab === tab.key
                ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilterCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${
            filterCategory === 'all' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
          }`}>📁 Tất cả</button>
        {categories.map(c => (
          <button key={c.key} onClick={() => setFilterCategory(c.key)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${
              filterCategory === c.key ? c.color + ' ring-1 ring-indigo-300' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
            }`}>{c.icon} {c.label}</button>
        ))}
        <button onClick={() => { setShowCatManager(true); setEditingCat(null); setCatForm({ label: '', icon: '📁', key: '' }); }}
          className="px-2 py-1.5 rounded-lg text-[10px] font-bold border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 hover:text-indigo-500 hover:border-indigo-300 transition-all flex items-center gap-1">
          <Settings size={10} /> Quản lý
        </button>
      </div>

      {/* Document List */}
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl border-2 border-dashed transition-all ${
          dragOver ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 dark:border-slate-600'
        } shadow-sm overflow-hidden`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      >
        {documents.length === 0 ? (
          <div className="p-16 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <Upload size={48} className={`mx-auto mb-4 ${dragOver ? 'text-indigo-400 animate-bounce' : 'text-slate-200'}`} />
            <p className="text-sm font-bold text-slate-400">
              {dragOver ? 'Thả file vào đây!' : searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có tài liệu. Kéo thả file hoặc nhấn để upload'}
            </p>
          </div>
        ) : (
          <div>
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                {currentTabConfig.icon} {currentTabConfig.label} ({documents.length})
              </span>
              <button onClick={() => fileInputRef.current?.click()}
                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
                <Plus size={10} /> Thêm file
              </button>
            </div>

            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {documents.map(doc => {
                const fi = getFileIcon(doc.fileType);
                const catConfig = categories.find(c => c.key === doc.docCategory);
                const isImg = hrmDocumentService.isImage(doc.fileType);
                const thumbUrl = isImg ? hrmDocumentService.getPublicUrl(doc.storagePath) : null;
                const emp = doc.employeeId ? employeeMap.get(doc.employeeId) : null;
                const statusConfig = DOC_STATUS_CONFIG[doc.status] || DOC_STATUS_CONFIG.active;
                const isOverdue = doc.deadline && new Date(doc.deadline) < new Date() && doc.status !== 'completed';

                return (
                  <div key={doc.id}
                    className="group relative p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-all cursor-pointer"
                    onClick={() => handlePreview(doc)}>
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{doc.title}</span>
                          {isOverdue && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-red-100 text-red-600 flex items-center gap-0.5">
                              <AlertTriangle size={8} /> Quá hạn
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                          {emp && <span className="font-bold text-indigo-500">👤 {emp.fullName}</span>}
                          {doc.docNumber && <span className="font-mono">#{doc.docNumber}</span>}
                          {doc.sender && <span>📨 {doc.sender}</span>}
                          {doc.receiver && <span>📤 {doc.receiver}</span>}
                          <span>{hrmDocumentService.formatSize(doc.fileSize)}</span>
                          <span>{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {catConfig && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold border ${catConfig.color}`}>
                              {catConfig.label}
                            </span>
                          )}
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                          {doc.tags.slice(0, 3).map(t => (
                            <span key={t} className="px-1 py-0.5 rounded text-[8px] font-bold bg-indigo-50 text-indigo-500 border border-indigo-100">#{t}</span>
                          ))}
                        </div>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {(activeTab === 'incoming' && doc.status !== 'completed') && (
                          <button onClick={e => { e.stopPropagation(); handleStatusChange(doc, 'completed'); }}
                            className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-500 hover:bg-emerald-100" title="Đã xử lý">
                            <CheckCircle2 size={13} />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); handleDownload(doc); }}
                          className="w-7 h-7 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500" title="Tải xuống">
                          <Download size={13} />
                        </button>
                        {canCRUD && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(doc); }}
                          className="w-7 h-7 rounded-lg bg-white shadow border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500" title="Xoá">
                          <Trash2 size={13} />
                        </button>
                        )}
                      </div>
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
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.doc,.docx,.zip,.rar"
        onChange={handleFileSelect} />

      {/* ============ UPLOAD MODAL ============ */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-600 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className={`px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r ${currentTabConfig.color} rounded-t-3xl flex items-center justify-between`}>
              <span className="font-bold text-lg text-white flex items-center gap-2"><Upload size={18} /> Tải lên — {currentTabConfig.label}</span>
              <button onClick={resetUploadForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Files */}
              {uploadFiles.length > 0 ? (
                <div className="space-y-2">
                  {uploadFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getFileIcon(f.type).color}`}>
                        {getFileIcon(f.type).icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{f.name}</div>
                        <div className="text-[10px] text-slate-400">{hrmDocumentService.formatSize(f.size)}</div>
                      </div>
                      <button onClick={() => setUploadFiles(uploadFiles.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2 rounded-xl border border-dashed border-slate-200 text-[10px] font-bold text-slate-400 hover:text-indigo-500 flex items-center justify-center gap-1">
                    <Plus size={10} /> Thêm file
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-indigo-400 rounded-xl p-6 text-center transition-all hover:bg-indigo-50/30"
                >
                  <Upload size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-bold text-slate-500">Nhấn để chọn file hoặc kéo thả vào đây</p>
                  <p className="text-[10px] text-slate-400 mt-1">PDF, ảnh, Word, Excel — tối đa 50MB</p>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                  {activeTab === 'employee_record' ? 'Tên tài liệu' : 'Trích yếu'} *
                </label>
                <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                  placeholder={activeTab === 'employee_record' ? 'VD: CMND mặt trước, Hợp đồng #001...' : 'VD: V/v đề xuất nhân sự...'}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-700 dark:text-white" />
              </div>

              {/* Employee (for employee_record tab) */}
              {activeTab === 'employee_record' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Nhân viên *</label>
                  <select value={uploadEmployeeId} onChange={e => setUploadEmployeeId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 dark:text-white outline-none">
                    <option value="">Chọn nhân viên</option>
                    {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName}</option>)}
                  </select>
                </div>
              )}

              {/* Doc Number + Doc Date */}
              {(activeTab === 'incoming' || activeTab === 'outgoing') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Số công văn</label>
                    <input value={uploadDocNumber} onChange={e => setUploadDocNumber(e.target.value)}
                      placeholder="Tự động nếu để trống"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{activeTab === 'incoming' ? 'Ngày nhận' : 'Ngày ký'}</label>
                    <input type="date" value={uploadDocDate} onChange={e => setUploadDocDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
                  </div>
                </div>
              )}

              {/* Sender / Receiver */}
              {activeTab === 'incoming' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn vị gửi</label>
                    <input value={uploadSender} onChange={e => setUploadSender(e.target.value)}
                      placeholder="VD: Sở XD, Thuế..."
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Hạn xử lý</label>
                    <input type="date" value={uploadDeadline} onChange={e => setUploadDeadline(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
                  </div>
                </div>
              )}
              {activeTab === 'outgoing' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Đơn vị nhận</label>
                  <input value={uploadReceiver} onChange={e => setUploadReceiver(e.target.value)}
                    placeholder="VD: Chủ đầu tư, UBND..."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
                </div>
              )}

              {/* Category */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Phân loại</label>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map(c => (
                    <button key={c.key} onClick={() => setUploadCategory(c.key)}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                        uploadCategory === c.key ? c.color + ' ring-2 ring-offset-1 ring-indigo-300' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400'
                      }`}>{c.icon} {c.label}</button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ghi chú (tuỳ chọn)</label>
                <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)}
                  rows={2} placeholder="Mô tả thêm..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none resize-none dark:bg-slate-700 dark:text-white" />
              </div>

              {/* Tags */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tags (cách nhau bằng dấu phẩy)</label>
                <input value={uploadTags} onChange={e => setUploadTags(e.target.value)}
                  placeholder="VD: block-a, tầng-1, thuế"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm outline-none dark:bg-slate-700 dark:text-white" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={resetUploadForm} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">Huỷ</button>
              <button onClick={handleUpload} disabled={uploadFiles.length === 0 || !uploadTitle || uploading}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r ${currentTabConfig.color} shadow-lg flex items-center gap-2 disabled:opacity-50`}>
                {uploading ? (<><Clock size={14} className="animate-spin" /> Đang tải...</>) : (<><Upload size={14} /> Tải lên</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ PREVIEW MODAL ============ */}
      {previewDoc && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-600 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getFileIcon(previewDoc.fileType).color}`}>
                  {getFileIcon(previewDoc.fileType).icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-700 dark:text-white truncate">{previewDoc.title}</div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
                    <span>{previewDoc.fileName}</span>
                    <span>•</span>
                    <span>{hrmDocumentService.formatSize(previewDoc.fileSize)}</span>
                    <span>•</span>
                    <span>{new Date(previewDoc.createdAt).toLocaleDateString('vi-VN')}</span>
                    {previewDoc.docNumber && <><span>•</span><span className="font-mono">#{previewDoc.docNumber}</span></>}
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
            <div className="flex-1 overflow-auto p-4">
              {hrmDocumentService.isImage(previewDoc.fileType) ? (
                <div className="flex items-center justify-center min-h-[300px]">
                  <img src={previewUrl} alt={previewDoc.title} className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-lg" />
                </div>
              ) : hrmDocumentService.isPdf(previewDoc.fileType) ? (
                <iframe src={previewUrl} className="w-full h-[70vh] rounded-xl border border-slate-200" title={previewDoc.title} />
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
                  <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 ${getFileIcon(previewDoc.fileType).color}`}>
                    <FileIcon size={36} />
                  </div>
                  <p className="text-sm font-bold text-slate-500">Không thể xem trước loại file này</p>
                  <button onClick={() => handleDownload(previewDoc)}
                    className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg">
                    <Download size={14} /> Tải xuống để xem
                  </button>
                </div>
              )}
              {/* Description & Tags */}
              {(previewDoc.description || previewDoc.tags.length > 0 || previewDoc.sender || previewDoc.receiver) && (
                <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 space-y-2">
                  {previewDoc.sender && <p className="text-xs text-slate-600 dark:text-slate-300">📨 <strong>Từ:</strong> {previewDoc.sender}</p>}
                  {previewDoc.receiver && <p className="text-xs text-slate-600 dark:text-slate-300">📤 <strong>Đến:</strong> {previewDoc.receiver}</p>}
                  {previewDoc.description && <p className="text-xs text-slate-600 dark:text-slate-300">{previewDoc.description}</p>}
                  {previewDoc.tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
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

      {/* ============ CATEGORY MANAGER MODAL ============ */}
      {showCatManager && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-600 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <div className={`px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r ${currentTabConfig.color} rounded-t-3xl flex items-center justify-between`}>
              <span className="font-bold text-white flex items-center gap-2"><Settings size={18} /> Quản lý danh mục — {currentTabConfig.label}</span>
              <button onClick={() => setShowCatManager(false)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><X size={18} /></button>
            </div>

            {/* Existing categories */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {categories.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-6">Chưa có danh mục nào</p>
              )}
              {categories.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 group">
                  <span className="text-lg shrink-0">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{cat.label}</span>
                    <span className="text-[9px] text-slate-400 ml-2 font-mono">{cat.key}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingCat(cat); setCatForm({ label: cat.label, icon: cat.icon, key: cat.key }); }}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 flex items-center justify-center text-indigo-500 hover:bg-indigo-50" title="Sửa">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => handleDeleteCategory(cat)}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 flex items-center justify-center text-red-400 hover:bg-red-50" title="Xoá">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add/Edit form */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/50">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">
                {editingCat ? '✏️ Sửa danh mục' : '➕ Thêm danh mục mới'}
              </div>
              <div className="flex gap-2">
                <input value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })}
                  placeholder="📁" maxLength={2}
                  className="w-12 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-center text-lg outline-none dark:bg-slate-700" />
                <input value={catForm.label} onChange={e => setCatForm({ ...catForm, label: e.target.value })}
                  placeholder="Tên danh mục (VD: Thư mời, Biên bản...)"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:text-white" />
                {editingCat ? (
                  <div className="flex gap-1">
                    <button onClick={handleUpdateCategory}
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600">Lưu</button>
                    <button onClick={() => { setEditingCat(null); setCatForm({ label: '', icon: '📁', key: '' }); }}
                      className="px-3 py-2 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-100">Huỷ</button>
                  </div>
                ) : (
                  <button onClick={handleAddCategory} disabled={!catForm.label.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 flex items-center gap-1">
                    <Plus size={12} /> Thêm
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HrmDocuments;
