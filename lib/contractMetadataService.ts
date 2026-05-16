import {
  ContractFormTemplate,
  ContractGuarantee,
  ContractTemplateField,
  ContractTemplateSection,
  ContractTypeMetadata,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const mapContractType = (row: any): ContractTypeMetadata => fromDb(row) as ContractTypeMetadata;
const mapTemplate = (row: any): ContractFormTemplate => fromDb(row) as ContractFormTemplate;
const mapSection = (row: any): ContractTemplateSection => fromDb(row) as ContractTemplateSection;
const mapField = (row: any): ContractTemplateField => fromDb(row) as ContractTemplateField;
const mapGuarantee = (row: any): ContractGuarantee => fromDb(row) as ContractGuarantee;

const normalizeCode = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || crypto.randomUUID().slice(0, 8);

const assembleTemplates = (
  templates: ContractFormTemplate[],
  sections: ContractTemplateSection[],
  fields: ContractTemplateField[],
): ContractFormTemplate[] => {
  const fieldsBySection = fields.reduce<Record<string, ContractTemplateField[]>>((acc, field) => {
    (acc[field.sectionId] ||= []).push(field);
    return acc;
  }, {});
  const sectionsByTemplate = sections.reduce<Record<string, ContractTemplateSection[]>>((acc, section) => {
    (acc[section.templateId] ||= []).push({
      ...section,
      fields: (fieldsBySection[section.id] || []).sort((a, b) => a.sortOrder - b.sortOrder),
    });
    return acc;
  }, {});
  return templates.map(template => ({
    ...template,
    sections: (sectionsByTemplate[template.id] || []).sort((a, b) => a.sortOrder - b.sortOrder),
  }));
};

export const contractTypeService = {
  async list(options: { includeInactive?: boolean } = {}): Promise<ContractTypeMetadata[]> {
    if (!isSupabaseConfigured) return [];
    let query = supabase.from('contract_type_metadata').select('*').order('sort_order', { ascending: true });
    if (!options.includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapContractType);
  },

  async upsert(input: Partial<ContractTypeMetadata> & { name: string }): Promise<ContractTypeMetadata> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      code: input.code?.trim() || normalizeCode(input.name),
      name: input.name.trim(),
      description: input.description || null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapContractType(payload);
    const { data, error } = await supabase
      .from('contract_type_metadata')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapContractType(data);
  },

  async deactivate(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from('contract_type_metadata')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

export const contractTemplateService = {
  async listByContractType(contractTypeId: string, options: { includeInactive?: boolean } = {}): Promise<ContractFormTemplate[]> {
    if (!isSupabaseConfigured || !contractTypeId) return [];
    let templateQuery = supabase
      .from('contract_form_templates')
      .select('*')
      .eq('contract_type_id', contractTypeId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (!options.includeInactive) templateQuery = templateQuery.eq('is_active', true);

    const { data: templatesData, error: templateError } = await templateQuery;
    if (templateError) throw templateError;
    const templates = (templatesData || []).map(mapTemplate);
    if (templates.length === 0) return [];
    const templateIds = templates.map(t => t.id);

    const [{ data: sectionsData, error: sectionError }, { data: fieldsData, error: fieldError }] = await Promise.all([
      supabase.from('contract_template_sections').select('*').in('template_id', templateIds).order('sort_order', { ascending: true }),
      supabase.from('contract_template_fields').select('*').in('template_id', templateIds).order('sort_order', { ascending: true }),
    ]);
    if (sectionError) throw sectionError;
    if (fieldError) throw fieldError;

    const sections = (sectionsData || []).filter((s: any) => options.includeInactive || s.is_active).map(mapSection);
    const fields = (fieldsData || []).filter((f: any) => options.includeInactive || f.is_active).map(mapField);
    return assembleTemplates(templates, sections, fields);
  },

  async getDefaultTemplate(contractTypeId: string): Promise<ContractFormTemplate | null> {
    const templates = await this.listByContractType(contractTypeId);
    return templates.find(t => t.isDefault) || templates[0] || null;
  },

  async upsertTemplate(input: Partial<ContractFormTemplate> & { contractTypeId: string; name: string }): Promise<ContractFormTemplate> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      contractTypeId: input.contractTypeId,
      name: input.name.trim(),
      description: input.description || null,
      isDefault: input.isDefault ?? true,
      isActive: input.isActive ?? true,
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapTemplate(payload);
    const { data, error } = await supabase
      .from('contract_form_templates')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapTemplate(data);
  },

  async upsertSection(input: Partial<ContractTemplateSection> & { templateId: string; title: string }): Promise<ContractTemplateSection> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      templateId: input.templateId,
      title: input.title.trim(),
      description: input.description || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapSection(payload);
    const { data, error } = await supabase
      .from('contract_template_sections')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapSection(data);
  },

  async upsertField(input: Partial<ContractTemplateField> & {
    templateId: string;
    sectionId: string;
    key: string;
    label: string;
  }): Promise<ContractTemplateField> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      templateId: input.templateId,
      sectionId: input.sectionId,
      key: input.key.trim(),
      label: input.label.trim(),
      fieldType: input.fieldType || 'text',
      required: input.required ?? false,
      placeholder: input.placeholder || null,
      options: input.options || [],
      defaultValue: input.defaultValue || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapField(payload);
    const { data, error } = await supabase
      .from('contract_template_fields')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapField(data);
  },

  async deactivateSection(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from('contract_template_sections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async deactivateField(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from('contract_template_fields')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

const DEFAULT_GUARANTEES: Array<Pick<ContractGuarantee, 'guaranteeType' | 'name'>> = [
  { guaranteeType: 'performance', name: 'Bảo lãnh thực hiện hợp đồng' },
  { guaranteeType: 'advance', name: 'Bảo lãnh tạm ứng' },
  { guaranteeType: 'warranty', name: 'Bảo lãnh bảo hành' },
];

export const contractGuaranteeService = {
  async listByContract(contractId: string): Promise<ContractGuarantee[]> {
    if (!isSupabaseConfigured || !contractId) return [];
    const { data, error } = await supabase
      .from('contract_guarantees')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapGuarantee);
  },

  async upsert(input: Partial<ContractGuarantee> & { contractId: string; name: string }): Promise<ContractGuarantee> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      contractId: input.contractId,
      guaranteeType: input.guaranteeType || 'other',
      name: input.name.trim(),
      amount: input.amount || 0,
      percent: input.percent || 0,
      bankName: input.bankName || null,
      guaranteeNumber: input.guaranteeNumber || null,
      issueDate: input.issueDate || null,
      expiryDate: input.expiryDate || null,
      status: input.status || 'draft',
      note: input.note || null,
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapGuarantee(payload);
    const { data, error } = await supabase
      .from('contract_guarantees')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapGuarantee(data);
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('contract_guarantees').delete().eq('id', id);
    if (error) throw error;
  },

  async createDefaults(contractId: string): Promise<void> {
    const existing = await this.listByContract(contractId);
    if (existing.length > 0) return;
    await Promise.all(DEFAULT_GUARANTEES.map(g => this.upsert({
      contractId,
      guaranteeType: g.guaranteeType,
      name: g.name,
      status: 'draft',
    })));
  },
};
