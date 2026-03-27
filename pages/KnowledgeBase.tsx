import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock, Database, Search, BookOpen, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface RagDocument {
  id: string;
  title: string;
  source: string;
  file_name: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error_message: string | null;
  storage_path: string | null;
  source_id?: string;
  uploaded_by: string;
  created_at: string;
}

const KnowledgeBase: React.FC = () => {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('rag_documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setDocuments(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // Auto-refresh processing documents
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'processing');
    if (!hasProcessing) return;
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  const uploadFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const allowed = ['pdf', 'docx', 'txt', 'doc', 'md', 'xlsx'];
    if (!allowed.includes(ext)) {
      alert(`Định dạng .${ext} không được hỗ trợ. Chỉ chấp nhận: ${allowed.join(', ')}`);
      return;
    }

    setUploading(true);
    try {
      // 1. Upload to Storage — sanitize filename for Supabase
      const sanitize = (name: string) => name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove Vietnamese diacritics
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^a-zA-Z0-9._-]/g, '_')                 // Replace special chars with _
        .replace(/_+/g, '_');                               // Collapse multiple _
      const storagePath = `docs/${Date.now()}_${sanitize(file.name)}`;
      const { error: uploadErr } = await supabase.storage
        .from('knowledge-base')
        .upload(storagePath, file);
      if (uploadErr) throw uploadErr;

      // 2. Create document record
      const { data: doc, error: docErr } = await supabase
        .from('rag_documents')
        .insert({
          title: file.name.replace(/\.[^.]+$/, ''),
          source: 'upload',
          file_name: file.name,
          file_type: ext,
          file_size: file.size,
          storage_path: storagePath,
          status: 'pending',
          uploaded_by: 'admin',
        })
        .select()
        .single();
      if (docErr) throw docErr;

      // 3. Trigger processing
      await supabase.functions.invoke('process-document', {
        body: { documentId: doc.id },
      });

      await fetchDocuments();
    } catch (err: any) {
      console.error('Upload error:', err);
      alert(`Lỗi upload: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    files.forEach((f: File) => uploadFile(f));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach((f: File) => uploadFile(f));
    }
  };


  const syncFromDocModules = async () => {
    setSyncing(true);
    try {
      // Sync from hrm_documents
      const { data: hrmDocs } = await supabase
        .from('hrm_documents')
        .select('id, title, file_name, file_type, file_size, storage_path')
        .not('storage_path', 'is', null);

      // Sync from project_documents  
      const { data: projDocs } = await supabase
        .from('project_documents')
        .select('id, title, file_name, file_type, file_size, storage_path')
        .not('storage_path', 'is', null);

      // Filter out image files (not supported for text extraction)
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
      const filterDocs = (docs: any[]) => (docs || []).filter(d => {
        const ext = (d.file_name || '').split('.').pop()?.toLowerCase() || '';
        const mimeIsImage = (d.file_type || '').startsWith('image/');
        return !imageExts.includes(ext) && !mimeIsImage;
      });

      const filteredHrm = filterDocs(hrmDocs);
      const filteredProj = filterDocs(projDocs);

      const existingSourceIds = new Set(documents.filter(d => d.source !== 'upload').map(d => d.source_id));
      let syncCount = 0;

      for (const doc of [...filteredHrm, ...filteredProj]) {
        if (existingSourceIds.has(doc.id)) continue;
        const source = filteredHrm.includes(doc) ? 'hrm_documents' : 'project_documents';
        const { data: newDoc } = await supabase
          .from('rag_documents')
          .insert({
            title: doc.title || doc.file_name,
            source,
            source_id: doc.id,
            file_name: doc.file_name,
            file_type: doc.file_type,
            file_size: doc.file_size,
            storage_path: doc.storage_path,
            status: 'pending',
            uploaded_by: 'sync',
          })
          .select()
          .single();

        if (newDoc) {
          supabase.functions.invoke('process-document', { body: { documentId: newDoc.id } });
          syncCount++;
        }
      }

      alert(syncCount > 0 ? `Đã đồng bộ ${syncCount} tài liệu mới.` : 'Không có tài liệu mới để đồng bộ.');
      fetchDocuments();
    } catch (err: any) {
      alert(`Lỗi đồng bộ: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const deleteDocument = async (doc: RagDocument) => {
    if (!confirm(`Xóa tài liệu "${doc.title}"?`)) return;
    try {
      // Delete chunks first
      await supabase.from('rag_chunks').delete().eq('document_id', doc.id);
      // Delete storage file if uploaded directly
      if (doc.source === 'upload' && doc.storage_path) {
        await supabase.storage.from('knowledge-base').remove([doc.storage_path]);
      }
      // Delete document record
      await supabase.from('rag_documents').delete().eq('id', doc.id);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    } catch (err: any) {
      alert(`Lỗi xóa: ${err.message}`);
    }
  };

  const reprocessDocument = async (doc: RagDocument) => {
    try {
      await supabase.from('rag_documents').update({ status: 'pending', error_message: null }).eq('id', doc.id);
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'processing' as const, error_message: null } : d));
      await supabase.functions.invoke('process-document', { body: { documentId: doc.id } });
      fetchDocuments();
    } catch (err: any) {
      alert(`Lỗi xử lý lại: ${err.message}`);
    }
  };

  const filteredDocs = searchQuery
    ? documents.filter(d =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.file_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : documents;

  const stats = {
    total: documents.length,
    ready: documents.filter(d => d.status === 'ready').length,
    processing: documents.filter(d => d.status === 'processing' || d.status === 'pending').length,
    error: documents.filter(d => d.status === 'error').length,
    totalChunks: documents.reduce((s, d) => s + (d.chunk_count || 0), 0),
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    ready: { icon: <CheckCircle size={14} />, label: 'Sẵn sàng', color: 'text-emerald-500 bg-emerald-500/10' },
    processing: { icon: <Loader2 size={14} className="animate-spin" />, label: 'Đang xử lý', color: 'text-blue-500 bg-blue-500/10' },
    pending: { icon: <Clock size={14} />, label: 'Chờ xử lý', color: 'text-amber-500 bg-amber-500/10' },
    error: { icon: <AlertCircle size={14} />, label: 'Lỗi', color: 'text-red-500 bg-red-500/10' },
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <BookOpen className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white">Kho Kiến Thức</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Upload tài liệu để AI trả lời câu hỏi về quy định, chính sách công ty</p>
          </div>
        </div>
        <button
          onClick={syncFromDocModules}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Đang đồng bộ...' : 'Đồng bộ từ Hồ sơ'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Tổng tài liệu', value: stats.total, icon: <FileText size={18} />, color: 'from-blue-500 to-cyan-500' },
          { label: 'Sẵn sàng', value: stats.ready, icon: <CheckCircle size={18} />, color: 'from-emerald-500 to-green-500' },
          { label: 'Đang xử lý', value: stats.processing, icon: <Clock size={18} />, color: 'from-amber-500 to-orange-500' },
          { label: 'Chunks', value: stats.totalChunks, icon: <Database size={18} />, color: 'from-violet-500 to-purple-500' },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center text-white shadow-sm`}>
                {s.icon}
              </div>
              <div>
                <p className="text-2xl font-black text-slate-800 dark:text-white">{s.value}</p>
                <p className="text-xs text-slate-400 font-medium">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
          dragOver
            ? 'border-violet-500 bg-violet-500/5 scale-[1.01]'
            : 'border-slate-300 dark:border-slate-600 hover:border-violet-400 dark:hover:border-violet-500 bg-white/50 dark:bg-slate-800/30'
        }`}
        onClick={() => document.getElementById('file-upload')?.click()}
      >
        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.md,.xlsx"
          multiple
          onChange={handleFileInput}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={40} className="text-violet-500 animate-spin" />
            <p className="text-violet-600 dark:text-violet-400 font-bold">Đang upload và xử lý...</p>
          </div>
        ) : (
          <>
            <Upload size={40} className={`mx-auto mb-3 ${dragOver ? 'text-violet-500' : 'text-slate-400'}`} />
            <p className="text-lg font-bold text-slate-700 dark:text-slate-300">Kéo thả file vào đây hoặc click để chọn</p>
            <p className="text-sm text-slate-400 mt-1">Hỗ trợ: PDF, DOCX, TXT, MD, XLSX • Tối đa 20MB/file</p>
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Tìm kiếm tài liệu..."
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
        />
      </div>

      {/* Document List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="text-violet-500 animate-spin" />
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <BookOpen size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-bold">Chưa có tài liệu nào</p>
          <p className="text-sm">Upload tài liệu hoặc đồng bộ từ module Hồ sơ & Công văn</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDocs.map(doc => {
            const st = statusConfig[doc.status] || statusConfig.pending;
            return (
              <div key={doc.id} className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:shadow-md transition-all group">
                {/* Icon */}
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <FileText size={20} className="text-slate-500 dark:text-slate-400" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 dark:text-white truncate">{doc.title}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                    <span>{doc.file_name}</span>
                    <span>{formatSize(doc.file_size)}</span>
                    {doc.chunk_count > 0 && <span>{doc.chunk_count} chunks</span>}
                    <span className="capitalize">{doc.source === 'upload' ? 'Upload' : doc.source === 'hrm_documents' ? 'Hồ sơ' : 'Dự án'}</span>
                  </div>
                  {doc.error_message && (
                    <p className="text-xs text-red-400 mt-1 truncate">{doc.error_message}</p>
                  )}
                </div>

                {/* Status */}
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${st.color} shrink-0`}>
                  {st.icon} {st.label}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {doc.status === 'error' && (
                    <button
                      onClick={() => reprocessDocument(doc)}
                      className="p-2 rounded-lg hover:bg-blue-500/10 text-blue-500 transition-colors"
                      title="Xử lý lại"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteDocument(doc)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                    title="Xóa"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
