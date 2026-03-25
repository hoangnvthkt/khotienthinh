import { supabase } from './supabase';

// ==================== TYPES ====================
export interface HrmDocument {
  id: string;
  docType: 'employee_record' | 'incoming' | 'outgoing';
  docCategory: string;
  employeeId?: string;
  title: string;
  docNumber?: string;
  description?: string;
  sender?: string;
  receiver?: string;
  signedBy?: string;
  assignedTo?: string;
  docDate?: string;
  deadline?: string;
  status: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  tags: string[];
  uploadedBy?: string;
  createdAt: string;
  updatedAt: string;
}

const BUCKET = 'hr-documents';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ==================== DYNAMIC CATEGORIES ====================
export interface DocCategory {
  id: string;
  docType: 'employee_record' | 'incoming' | 'outgoing';
  key: string;
  label: string;
  icon: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

const catToCamel = (row: any): DocCategory => ({
  id: row.id,
  docType: row.doc_type,
  key: row.key,
  label: row.label,
  icon: row.icon || '📁',
  color: row.color || 'bg-slate-50 text-slate-600 border-slate-200',
  sortOrder: row.sort_order || 0,
  isActive: row.is_active !== false,
});

export const DOC_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Hiệu lực', color: 'bg-emerald-100 text-emerald-700' },
  processing: { label: 'Đang xử lý', color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Đã xử lý', color: 'bg-slate-100 text-slate-600' },
  archived: { label: 'Lưu trữ', color: 'bg-gray-100 text-gray-500' },
  draft: { label: 'Nháp', color: 'bg-yellow-100 text-yellow-700' },
  sent: { label: 'Đã gửi', color: 'bg-indigo-100 text-indigo-700' },
};

// ==================== MAPPER ====================
const toCamel = (row: any): HrmDocument => ({
  id: row.id,
  docType: row.doc_type,
  docCategory: row.doc_category,
  employeeId: row.employee_id,
  title: row.title,
  docNumber: row.doc_number,
  description: row.description,
  sender: row.sender,
  receiver: row.receiver,
  signedBy: row.signed_by,
  assignedTo: row.assigned_to,
  docDate: row.doc_date,
  deadline: row.deadline,
  status: row.status,
  fileName: row.file_name,
  fileType: row.file_type,
  fileSize: row.file_size,
  storagePath: row.storage_path,
  tags: row.tags || [],
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ==================== SERVICE ====================
export const hrmDocumentService = {
  // ---- Category CRUD ----
  async listCategories(docType?: string): Promise<DocCategory[]> {
    let query = supabase.from('hrm_doc_categories').select('*').eq('is_active', true).order('sort_order');
    if (docType) query = query.eq('doc_type', docType);
    const { data } = await query;
    return (data || []).map(catToCamel);
  },

  async addCategory(cat: { docType: string; key: string; label: string; icon?: string; color?: string; sortOrder?: number }): Promise<DocCategory | null> {
    const { data, error } = await supabase.from('hrm_doc_categories').insert({
      doc_type: cat.docType,
      key: cat.key,
      label: cat.label,
      icon: cat.icon || '📁',
      color: cat.color || 'bg-slate-50 text-slate-600 border-slate-200',
      sort_order: cat.sortOrder || 50,
    }).select().single();
    if (error) { console.error('Add category error:', error); return null; }
    return catToCamel(data);
  },

  async updateCategory(id: string, updates: Partial<{ label: string; icon: string; color: string; sortOrder: number; isActive: boolean }>): Promise<void> {
    const dbUpdates: any = {};
    if (updates.label !== undefined) dbUpdates.label = updates.label;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    if (updates.color !== undefined) dbUpdates.color = updates.color;
    if (updates.sortOrder !== undefined) dbUpdates.sort_order = updates.sortOrder;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
    await supabase.from('hrm_doc_categories').update(dbUpdates).eq('id', id);
  },

  async deleteCategory(id: string): Promise<void> {
    await supabase.from('hrm_doc_categories').delete().eq('id', id);
  },

  validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File quá lớn (${this.formatSize(file.size)}). Tối đa 50MB.` };
    }
    return { valid: true };
  },

  async upload(
    file: File,
    meta: {
      docType: 'employee_record' | 'incoming' | 'outgoing';
      docCategory: string;
      title: string;
      employeeId?: string;
      docNumber?: string;
      description?: string;
      sender?: string;
      receiver?: string;
      signedBy?: string;
      assignedTo?: string;
      docDate?: string;
      deadline?: string;
      status?: string;
      tags?: string[];
      uploadedBy?: string;
    }
  ): Promise<HrmDocument | null> {
    const validation = this.validateFile(file);
    if (!validation.valid) { alert(validation.error); return null; }

    const uuid = crypto.randomUUID();
    const folder = meta.docType === 'employee_record' ? `employees/${meta.employeeId || 'unknown'}` : meta.docType;
    const storagePath = `${folder}/${uuid}_${file.name}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false });
    if (uploadError) { console.error('Upload error:', uploadError); return null; }

    const doc = {
      doc_type: meta.docType,
      doc_category: meta.docCategory,
      employee_id: meta.employeeId || null,
      title: meta.title,
      doc_number: meta.docNumber || null,
      description: meta.description || null,
      sender: meta.sender || null,
      receiver: meta.receiver || null,
      signed_by: meta.signedBy || null,
      assigned_to: meta.assignedTo || null,
      doc_date: meta.docDate || null,
      deadline: meta.deadline || null,
      status: meta.status || 'active',
      file_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      storage_path: storagePath,
      tags: meta.tags || [],
      uploaded_by: meta.uploadedBy || null,
    };

    const { data, error } = await supabase.from('hrm_documents').insert(doc).select().single();
    if (error) {
      console.error('Insert error:', error);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return null;
    }
    return toCamel(data);
  },

  async search(query: string, docTypeFilter?: string): Promise<HrmDocument[]> {
    const { data, error } = await supabase.rpc('search_hrm_documents', {
      search_text: query || '',
      doc_type_filter: docTypeFilter || null,
    });
    if (error) { console.error('Search error:', error); return []; }
    return (data || []).map(toCamel);
  },

  async list(docType?: string, category?: string): Promise<HrmDocument[]> {
    let query = supabase.from('hrm_documents').select('*').order('created_at', { ascending: false }).limit(200);
    if (docType) query = query.eq('doc_type', docType);
    if (category && category !== 'all') query = query.eq('doc_category', category);
    const { data } = await query;
    return (data || []).map(toCamel);
  },

  async listByEmployee(employeeId: string): Promise<HrmDocument[]> {
    const { data } = await supabase.from('hrm_documents').select('*')
      .eq('employee_id', employeeId).order('created_at', { ascending: false });
    return (data || []).map(toCamel);
  },

  async updateStatus(id: string, status: string): Promise<void> {
    await supabase.from('hrm_documents').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  },

  async remove(doc: HrmDocument): Promise<void> {
    await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    await supabase.from('hrm_documents').delete().eq('id', doc.id);
  },

  getPublicUrl(storagePath: string): string {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  },

  async getSignedUrl(storagePath: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) return this.getPublicUrl(storagePath);
    return data.signedUrl;
  },

  isImage(fileType: string): boolean { return fileType.startsWith('image/'); },
  isPdf(fileType: string): boolean { return fileType === 'application/pdf'; },

  formatSize(bytes: number): string {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
    return bytes + ' B';
  },

  /** Auto-generate document number */
  generateDocNumber(type: 'incoming' | 'outgoing', sequence: number): string {
    const prefix = type === 'incoming' ? 'CV-DEN' : 'CV-DI';
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
  },

  async getNextDocNumber(type: 'incoming' | 'outgoing'): Promise<string> {
    const { count } = await supabase.from('hrm_documents')
      .select('id', { count: 'exact', head: true })
      .eq('doc_type', type)
      .gte('created_at', `${new Date().getFullYear()}-01-01`);
    return this.generateDocNumber(type, (count || 0) + 1);
  },
};
