import { supabase } from './supabase';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';

export interface ProjectDocument {
  id: string;
  projectId?: string | null;
  constructionSiteId?: string | null;
  category: string;
  title: string;
  description?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  uploadedBy?: string;
  linkedRecordType?: string;
  linkedRecordId?: string;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const BUCKET = 'project-files';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — Supabase free tier limit

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-rar-compressed',
  'text/plain', 'text/csv',
  'application/dxf', 'application/dwg', // CAD files
];

const toCamel = (row: any): ProjectDocument => ({
  id: row.id,
  projectId: row.project_id,
  constructionSiteId: row.construction_site_id,
  category: row.category,
  title: row.title,
  description: row.description,
  fileName: row.file_name,
  fileType: row.file_type,
  fileSize: row.file_size,
  storagePath: row.storage_path,
  uploadedBy: row.uploaded_by,
  linkedRecordType: row.linked_record_type,
  linkedRecordId: row.linked_record_id,
  tags: row.tags || [],
  version: row.version || 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const DOC_CATEGORIES = [
  { key: 'contract', label: '📋 Hợp đồng', color: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
  { key: 'drawing', label: '📐 Bản vẽ', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  { key: 'acceptance', label: '✅ Nghiệm thu', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  { key: 'permit', label: '📜 Giấy phép', color: 'bg-amber-50 text-amber-600 border-amber-200' },
  { key: 'report', label: '📊 Báo cáo', color: 'bg-violet-50 text-violet-600 border-violet-200' },
  { key: 'photo', label: '📷 Hình ảnh', color: 'bg-pink-50 text-pink-600 border-pink-200' },
  { key: 'invoice', label: '🧾 Hoá đơn', color: 'bg-orange-50 text-orange-600 border-orange-200' },
  { key: 'general', label: '📁 Chung', color: 'bg-slate-50 text-slate-600 border-slate-200' },
];

export const documentService = {
  /** Validate file before upload */
  validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File quá lớn (${this.formatSize(file.size)}). Tối đa ${this.formatSize(MAX_FILE_SIZE)}.` };
    }
    // Allow all types but warn for unusual ones
    return { valid: true };
  },

  /** Upload file to storage and create metadata record */
  async upload(
    file: File,
    projectIdOrSiteId: string,
    meta: {
      title: string;
      category: string;
      projectId?: string | null;
      constructionSiteId?: string | null;
      description?: string;
      uploadedBy?: string;
      linkedRecordType?: string;
      linkedRecordId?: string;
      tags?: string[];
    }
  ): Promise<ProjectDocument | null> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      console.error('Validation error:', validation.error);
      return null;
    }

    const ext = file.name.split('.').pop() || '';
    // Use UUID in path to prevent collisions
    const uuid = crypto.randomUUID();
    const storagePath = `${projectIdOrSiteId}/${uuid}_${file.name}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { upsert: false });
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    // Create metadata record
    const doc = {
      id: crypto.randomUUID(),
      project_id: meta.projectId ?? projectIdOrSiteId,
      construction_site_id: meta.constructionSiteId === undefined ? projectIdOrSiteId : meta.constructionSiteId,
      category: meta.category,
      title: meta.title,
      description: meta.description || null,
      file_name: file.name,
      file_type: file.type || `application/${ext}`,
      file_size: file.size,
      storage_path: storagePath,
      uploaded_by: meta.uploadedBy || null,
      linked_record_type: meta.linkedRecordType || null,
      linked_record_id: meta.linkedRecordId || null,
      tags: meta.tags || [],
      version: 1,
    };

    const { data, error } = await supabase.from('project_documents').insert(doc).select().single();
    if (error) {
      console.error('Insert error:', error);
      // Cleanup uploaded file
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return null;
    }
    return toCamel(data);
  },

  /** List documents for a construction site */
  async list(projectIdOrSiteId: string, category?: string, constructionSiteId?: string | null): Promise<ProjectDocument[]> {
    let query = supabase
      .from('project_documents')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    const { data } = await query;
    return dedupeRowsById(data || []).map(toCamel);
  },

  /** Get a signed URL for private file access (1 hour expiry) */
  async getSignedUrl(storagePath: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600); // 1 hour
    if (error || !data?.signedUrl) {
      // Fallback to public URL if signed URL fails
      return this.getPublicUrl(storagePath);
    }
    return data.signedUrl;
  },

  /** Get public URL for a file (fallback) */
  getPublicUrl(storagePath: string): string {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  },

  /** Delete a document (storage + metadata) */
  async remove(doc: ProjectDocument): Promise<void> {
    await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    await supabase.from('project_documents').delete().eq('id', doc.id);
  },

  /** Update metadata only */
  async update(id: string, updates: Partial<ProjectDocument>): Promise<void> {
    const snake: any = {};
    const map: Record<string, string> = {
      constructionSiteId: 'construction_site_id', fileName: 'file_name',
      projectId: 'project_id',
      fileType: 'file_type', fileSize: 'file_size', storagePath: 'storage_path',
      uploadedBy: 'uploaded_by', linkedRecordType: 'linked_record_type',
      linkedRecordId: 'linked_record_id', updatedAt: 'updated_at',
    };
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'id') continue;
      snake[map[k] || k] = v;
    }
    snake.updated_at = new Date().toISOString();
    await supabase.from('project_documents').update(snake).eq('id', id);
  },

  /** Format file size */
  formatSize(bytes: number): string {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
    return bytes + ' B';
  },

  /** Check if file is an image */
  isImage(fileType: string): boolean {
    return fileType.startsWith('image/');
  },

  /** Check if file is PDF */
  isPdf(fileType: string): boolean {
    return fileType === 'application/pdf';
  },

  /** Maximum file size */
  MAX_FILE_SIZE,
};
