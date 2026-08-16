import { supabase } from './supabase';
import {
  QualityChecklist,
  QualityChecklistStatus,
  QualityChecklistClonedSection,
  QualityChecklistClonedItem,
  InspectionCategory,
  InspectionWorkType,
  InspectionTemplate,
  InspectionTemplateSection,
  InspectionTemplateItem,
  QualityInspectionAttempt,
  InspectionResult,
  ProjectSubmissionTarget,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildQualityChecklistForTask } from './qualityChecklistWorkflow';
import { parseNonNegativeLocaleNumber } from './localeNumberInput';
import { qualityChecklistCommandService } from './qualityChecklistCommandService';

const TABLE = 'quality_checklists';
const TPL_TABLE = 'inspection_templates';
const TPL_ITEM_TABLE = 'inspection_template_items';
const CAT_TABLE = 'inspection_categories';
const WT_TABLE = 'inspection_work_types';
const SEC_TABLE = 'template_sections';
const ATTEMPT_TABLE = 'quality_inspection_attempts';

const normalize = (row: any): QualityChecklist => {
  const mapped = fromDb(row);
  return {
    ...mapped,
    checklistData: mapped.checklistData || [],
    sitePhotos: mapped.sitePhotos || [],
    attachments: mapped.attachments || [],
    status: mapped.status || 'draft',
    currentAttempt: mapped.currentAttempt || 1,
  };
};

// ==================== AUTO-CALCULATE INSPECTION RESULT ====================

function calculateInspectionResult(checklist: Partial<QualityChecklist>): {
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  inspectionResult: InspectionResult;
} {
  const sections = checklist.checklistData || [];
  let totalCriteria = 0;
  let passedCriteria = 0;
  let failedCriteria = 0;

  sections.forEach(sec => {
    (sec.items || []).forEach(item => {
      totalCriteria += 1;
      
      // Auto-validate actual value against criteria rules
      let isPassed = true;
      const val = String(item.actualValue || '').trim();

      if (item.dataType === 'checkbox') {
        if (item.required && val !== 'true') {
          isPassed = false;
        }
      } else if (item.dataType === 'number') {
        if (item.required && !val) {
          isPassed = false;
        } else if (val) {
          const num = parseNonNegativeLocaleNumber(val);
          if (!/\d/.test(val) || !Number.isFinite(num)) {
            isPassed = false;
          } else {
            if (item.minValue !== undefined && item.minValue !== null && num < item.minValue) {
              isPassed = false;
            }
            if (item.maxValue !== undefined && item.maxValue !== null && num > item.maxValue) {
              isPassed = false;
            }
          }
        }
      } else {
        // text or photo
        if (item.required && !val) {
          isPassed = false;
        }
      }

      item.result = isPassed ? 'pass' : 'fail';
      if (isPassed) {
        passedCriteria += 1;
      } else {
        failedCriteria += 1;
      }
    });
  });

  const inspectionResult: InspectionResult = failedCriteria > 0 ? 'FAILED' : 'PASSED';
  return { totalCriteria, passedCriteria, failedCriteria, inspectionResult };
}

const shouldCalculateInspectionResult = (updates: Partial<QualityChecklist>): boolean =>
  Object.prototype.hasOwnProperty.call(updates, 'checklistData');

// ==================== CLONE TEMPLATE INTO CHECKLIST ====================

function cloneTemplateSections(
  sections: (InspectionTemplateSection & { items: InspectionTemplateItem[] })[]
): QualityChecklistClonedSection[] {
  return sections.map(sec => ({
    sectionId: sec.id,
    sectionName: sec.name,
    sortOrder: sec.sortOrder,
    items: (sec.items || []).map(item => ({
      id: item.id,
      itemName: item.itemName,
      acceptanceCriteria: item.acceptanceCriteria,
      inspectionMethod: item.inspectionMethod,
      required: item.required,
      dataType: item.dataType,
      minValue: item.minValue,
      maxValue: item.maxValue,
      unit: item.unit,
      sortOrder: item.sortOrder,
      actualValue: item.dataType === 'checkbox' ? 'false' : '',
      result: undefined,
      note: '',
      photoUrl: ''
    }))
  }));
}

async function nextCode(constructionSiteId: string): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('construction_site_id', constructionSiteId);
  if (error) throw error;
  return `QC-${String((count || 0) + 1).padStart(3, '0')}`;
}

export const qualityChecklistService = {
  // ===================== CATEGORIES & WORK TYPES =====================

  async listCategories(): Promise<InspectionCategory[]> {
    const { data, error } = await supabase
      .from(CAT_TABLE)
      .select('*')
      .order('code', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async createCategory(category: Partial<InspectionCategory>): Promise<InspectionCategory> {
    const dbItem = toDb(category);
    delete dbItem.id;
    const { data, error } = await supabase.from(CAT_TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  async updateCategory(id: string, updates: Partial<InspectionCategory>): Promise<void> {
    const dbItem = toDb(updates);
    delete dbItem.id;
    const { error } = await supabase.from(CAT_TABLE).update(dbItem).eq('id', id);
    if (error) throw error;
  },

  async removeCategory(id: string): Promise<void> {
    const { error } = await supabase.from(CAT_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async listWorkTypes(categoryId?: string): Promise<InspectionWorkType[]> {
    let query = supabase.from(WT_TABLE).select('*').order('code', { ascending: true });
    if (categoryId) query = query.eq('category_id', categoryId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async createWorkType(workType: Partial<InspectionWorkType>): Promise<InspectionWorkType> {
    const dbItem = toDb(workType);
    delete dbItem.id;
    const { data, error } = await supabase.from(WT_TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  async updateWorkType(id: string, updates: Partial<InspectionWorkType>): Promise<void> {
    const dbItem = toDb(updates);
    delete dbItem.id;
    const { error } = await supabase.from(WT_TABLE).update(dbItem).eq('id', id);
    if (error) throw error;
  },

  async removeWorkType(id: string): Promise<void> {
    const { error } = await supabase.from(WT_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== INSPECTION TEMPLATES =====================

  async listTemplates(workTypeId?: string): Promise<InspectionTemplate[]> {
    let query = supabase
      .from(TPL_TABLE)
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });
    if (workTypeId) query = query.eq('work_type_id', workTypeId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async listAllTemplates(workTypeId?: string): Promise<InspectionTemplate[]> {
    let query = supabase
      .from(TPL_TABLE)
      .select('*')
      .order('code', { ascending: true });
    if (workTypeId) query = query.eq('work_type_id', workTypeId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async getTemplateWithItems(templateId: string): Promise<InspectionTemplate & { sections: (InspectionTemplateSection & { items: InspectionTemplateItem[] })[] }> {
    const [tplRes, secRes] = await Promise.all([
      supabase.from(TPL_TABLE).select('*').eq('id', templateId).single(),
      supabase.from(SEC_TABLE).select('*').eq('template_id', templateId).order('sort_order', { ascending: true }),
    ]);
    if (tplRes.error) throw tplRes.error;
    if (secRes.error) throw secRes.error;

    const sections = secRes.data || [];
    const sectionIds = sections.map(s => s.id);
    
    let items: any[] = [];
    if (sectionIds.length > 0) {
      const { data, error } = await supabase
        .from(TPL_ITEM_TABLE)
        .select('*')
        .in('section_id', sectionIds)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      items = data || [];
    }

    const nestedSections = sections.map(sec => ({
      ...fromDb(sec),
      items: items.filter(i => i.section_id === sec.id).map(fromDb),
    }));

    return {
      ...fromDb(tplRes.data),
      sections: nestedSections,
    };
  },

  async createTemplate(template: Partial<InspectionTemplate>): Promise<InspectionTemplate> {
    const dbItem = toDb(template);
    delete dbItem.id;
    const { data, error } = await supabase.from(TPL_TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  async updateTemplate(id: string, updates: Partial<InspectionTemplate>): Promise<void> {
    const dbItem = toDb(updates);
    delete dbItem.id;
    const { error } = await supabase.from(TPL_TABLE).update(dbItem).eq('id', id);
    if (error) throw error;
  },

  async removeTemplate(id: string): Promise<void> {
    const { error } = await supabase.from(TPL_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== SECTIONS & ITEMS =====================

  async createSection(section: Partial<InspectionTemplateSection>): Promise<InspectionTemplateSection> {
    const dbItem = toDb(section);
    delete dbItem.id;
    const { data, error } = await supabase.from(SEC_TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  async updateSection(id: string, updates: Partial<InspectionTemplateSection>): Promise<void> {
    const dbItem = toDb(updates);
    delete dbItem.id;
    const { error } = await supabase.from(SEC_TABLE).update(dbItem).eq('id', id);
    if (error) throw error;
  },

  async removeSection(id: string): Promise<void> {
    const { error } = await supabase.from(SEC_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async createTemplateItem(item: Partial<InspectionTemplateItem>): Promise<InspectionTemplateItem> {
    const dbItem = toDb(item);
    delete dbItem.id;
    const { data, error } = await supabase.from(TPL_ITEM_TABLE).insert(dbItem).select().single();
    if (error) throw error;
    return fromDb(data);
  },

  async updateTemplateItem(id: string, updates: Partial<InspectionTemplateItem>): Promise<void> {
    const dbItem = toDb(updates);
    delete dbItem.id;
    const { error } = await supabase.from(TPL_ITEM_TABLE).update(dbItem).eq('id', id);
    if (error) throw error;
  },

  async removeTemplateItem(id: string): Promise<void> {
    const { error } = await supabase.from(TPL_ITEM_TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== CHECKLISTS =====================

  async list(projectId?: string | null, constructionSiteId?: string): Promise<QualityChecklist[]> {
    let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    if (constructionSiteId) query = query.eq('construction_site_id', constructionSiteId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalize);
  },

  async get(id: string): Promise<QualityChecklist | null> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? normalize(data) : null;
  },

  /** Tạo hồ sơ CL từ template — clone dữ liệu template vào record */
  async createFromTemplate(params: {
    templateId: string;
    projectId: string;
    constructionSiteId: string;
    taskId?: string;
    contractItemId?: string;
    title?: string;
    workDescription?: string;
    workLocation?: string;
    workDate?: string;
    workSupervisor?: string;
    createdBy?: string;
  }): Promise<QualityChecklist> {
    const tpl = await this.getTemplateWithItems(params.templateId);
    const checklistData = cloneTemplateSections(tpl.sections || []);
    const code = await nextCode(params.constructionSiteId);

    const checklist: Partial<QualityChecklist> = {
      constructionSiteId: params.constructionSiteId,
      projectId: params.projectId,
      taskId: params.taskId || null,
      contractItemId: params.contractItemId || null,
      templateId: params.templateId,
      workTypeId: tpl.workTypeId,
      
      // Snapshot template info
      templateCode: tpl.code,
      templateName: tpl.name,
      templateVersion: tpl.version,
      standardReference: tpl.standardReference,
      code,
      title: params.title || `${tpl.name} — ${code}`,
      workDescription: params.workDescription,
      workLocation: params.workLocation,
      workDate: params.workDate || new Date().toISOString().slice(0, 10),
      workSupervisor: params.workSupervisor,
      
      checklistData,
      sitePhotos: [],
      attachments: [],
      status: 'draft',
      currentAttempt: 1,
      totalCriteria: checklistData.reduce((sum, s) => sum + (s.items || []).length, 0),
      passedCriteria: 0,
      failedCriteria: 0,
      inspectionResult: undefined,
      createdBy: params.createdBy,
    };

    const result = await qualityChecklistCommandService.create({
      projectId: params.projectId,
      constructionSiteId: params.constructionSiteId,
    }, checklist);
    if (!result.checklist) throw new Error('Không nhận được hồ sơ chất lượng sau khi tạo.');
    return normalize(result.checklist);
  },

  /** Tạo hồ sơ CL nháp trực tiếp từ hạng mục tiến độ, không phụ thuộc template. */
  async createForTask(params: {
    projectId: string;
    constructionSiteId: string;
    taskId: string;
    title: string;
    workDescription?: string;
    workLocation?: string;
    workDate?: string;
    workSupervisor?: string;
    sitePhotos?: QualityChecklist['sitePhotos'];
    attachments?: QualityChecklist['attachments'];
    note?: string;
    createdBy?: string;
    submissionTarget?: ProjectSubmissionTarget | null;
  }): Promise<QualityChecklist> {
    const code = await nextCode(params.constructionSiteId);
    const checklist = buildQualityChecklistForTask({
      code,
      now: new Date().toISOString(),
      params,
      submissionTarget: params.submissionTarget,
    });

    const result = await qualityChecklistCommandService.create({
      projectId: params.projectId,
      constructionSiteId: params.constructionSiteId,
    }, checklist, params.submissionTarget ? {
      userId: params.submissionTarget.userId,
      name: params.submissionTarget.name,
      note: params.submissionTarget.note,
    } : null);
    if (!result.checklist) throw new Error('Không nhận được hồ sơ chất lượng sau khi tạo.');
    return normalize(result.checklist);
  },

  async update(id: string, updates: Partial<QualityChecklist>): Promise<void> {
    const current = await this.get(id);
    if (!current?.projectId || !current.updatedAt) {
      throw new Error('Không tìm thấy phạm vi hoặc phiên bản hồ sơ chất lượng.');
    }
    const calc = shouldCalculateInspectionResult(updates)
      ? calculateInspectionResult(updates)
      : {};
    const withCalc = {
      ...updates,
      ...calc,
    };
    await qualityChecklistCommandService.update({
      projectId: current.projectId,
      constructionSiteId: current.constructionSiteId,
    }, id, current.updatedAt, withCalc);
  },

  async setStatus(
    id: string,
    status: QualityChecklistStatus,
    userId?: string,
    reason?: string,
    submissionTarget?: ProjectSubmissionTarget,
  ): Promise<void> {
    const checklist = await this.get(id);
    if (!checklist?.projectId || !checklist.updatedAt) {
      throw new Error('Không tìm thấy phạm vi hoặc phiên bản hồ sơ chất lượng.');
    }

    if (checklist.status === 'cancelled') throw new Error('Hồ sơ CL đã huỷ, không thể đổi trạng thái.');
    if (checklist.status === 'approved' && status !== 'cancelled' && status !== 'draft') throw new Error('Hồ sơ CL đã duyệt. Chỉ có thể Huỷ hoặc quay về Nháp.');
    if ((status === 'returned' || status === 'cancelled') && !reason?.trim()) {
      throw new Error('Vui lòng nhập lý do trả lại/huỷ.');
    }

    await qualityChecklistCommandService.transition({
      projectId: checklist.projectId,
      constructionSiteId: checklist.constructionSiteId,
    }, id, checklist.updatedAt, status, {
      targetUserId: submissionTarget?.userId,
      targetName: submissionTarget?.name,
      targetNote: submissionTarget?.note,
      reason,
    });
  },

  async remove(id: string): Promise<void> {
    const checklist = await this.get(id);
    if (!checklist?.projectId || !checklist.updatedAt) {
      throw new Error('Không tìm thấy phạm vi hoặc phiên bản hồ sơ chất lượng.');
    }
    if (checklist.status !== 'draft') throw new Error('Chỉ xóa được hồ sơ CL ở trạng thái Nháp.');
    await qualityChecklistCommandService.remove({
      projectId: checklist.projectId,
      constructionSiteId: checklist.constructionSiteId,
    }, id, checklist.updatedAt);
  },

  // ===================== ATTEMPTS =====================

  async listAttempts(checklistId: string): Promise<QualityInspectionAttempt[]> {
    const { data, error } = await supabase
      .from(ATTEMPT_TABLE)
      .select('*')
      .eq('checklist_id', checklistId)
      .order('attempt_number', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async createAttempt(params: {
    checklistId: string;
    attemptNumber: number;
    inspectorName?: string;
    itemsData: QualityChecklistClonedSection[];
    result: 'PASSED' | 'FAILED';
    conclusion?: string;
    signatureUrl?: string;
    createdBy?: string;
  }): Promise<QualityInspectionAttempt> {
    const checklist = await this.get(params.checklistId);
    if (!checklist?.projectId || !checklist.updatedAt) {
      throw new Error('Không tìm thấy phạm vi hoặc phiên bản hồ sơ chất lượng.');
    }
    const result = await qualityChecklistCommandService.createAttempt({
      projectId: checklist.projectId,
      constructionSiteId: checklist.constructionSiteId,
    }, params.checklistId, checklist.updatedAt, params);
    if (!result.attempt) throw new Error('Không nhận được lần kiểm tra sau khi tạo.');
    return result.attempt;
  },

  // ===================== STATS =====================

  async getStats(projectId?: string | null, constructionSiteId?: string): Promise<{
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    returned: number;
    passRate: number;
  }> {
    const all = await this.list(projectId, constructionSiteId);
    const total = all.length;
    const draft = all.filter(c => c.status === 'draft').length;
    const submitted = all.filter(c => c.status === 'submitted').length;
    const approved = all.filter(c => c.status === 'approved').length;
    const returned = all.filter(c => c.status === 'returned').length;
    const concluded = all.filter(c => c.inspectionResult);
    const passed = concluded.filter(c => c.inspectionResult === 'PASSED');
    const passRate = concluded.length > 0 ? Math.round((passed.length / concluded.length) * 100) : 0;
    return { total, draft, submitted, approved, returned, passRate };
  },
};
