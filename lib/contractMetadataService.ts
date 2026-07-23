import {
  ContractCostItem,
  ContractLaborCatalogItem,
  ContractMachineCatalogItem,
  ContractMaterialNormItem,
  ContractFormTemplate,
  ContractGuarantee,
  ContractServiceCatalogItem,
  ContractTemplateField,
  ContractTemplateSection,
  ContractTypeMetadata,
  InventoryItem,
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
const mapServiceCatalog = (row: any): ContractServiceCatalogItem => fromDb(row) as ContractServiceCatalogItem;
const mapLaborCatalog = (row: any): ContractLaborCatalogItem => fromDb(row) as ContractLaborCatalogItem;
const mapMachineCatalog = (row: any): ContractMachineCatalogItem => fromDb(row) as ContractMachineCatalogItem;
const mapMaterialNorm = (row: any): ContractMaterialNormItem => fromDb(row) as ContractMaterialNormItem;
const mapCostItem = (row: any): ContractCostItem => fromDb(row) as ContractCostItem;
const mapInventoryItem = (row: any): InventoryItem => fromDb({
  ...row,
  accounting_code: row.accounting_code ?? row.accountingCode ?? null,
  stock_by_warehouse: row.stock_by_warehouse || {},
}) as InventoryItem;

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

const catalogList = async <T>(table: string, mapper: (row: any) => T): Promise<T[]> => {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapper);
};

const catalogUpsert = async <T>(
  table: string,
  input: Record<string, any>,
  mapper: (row: any) => T,
): Promise<T> => {
  const payload = cleanUndefined(toDb({
    ...input,
    id: input.id || crypto.randomUUID(),
    code: input.code?.trim(),
    name: input.name?.trim(),
    workCode: input.workCode?.trim(),
    materialName: input.materialName?.trim(),
    status: input.status || 'active',
    updatedAt: new Date().toISOString(),
    createdAt: input.createdAt,
  }));
  if (!isSupabaseConfigured) return mapper(payload);
  const { data, error } = await supabase
    .from(table)
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return mapper(data);
};

const catalogRemove = async (table: string, id: string): Promise<void> => {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
};

export const contractServiceCatalogService = {
  list: () => catalogList('contract_service_catalogs', mapServiceCatalog),
  upsert: (input: Partial<ContractServiceCatalogItem> & { code: string; name: string }) =>
    catalogUpsert('contract_service_catalogs', {
      ...input,
      unitPrice: Number(input.unitPrice || 0),
    }, mapServiceCatalog),
  remove: (id: string) => catalogRemove('contract_service_catalogs', id),
};

export const contractLaborCatalogService = {
  list: () => catalogList('contract_labor_catalogs', mapLaborCatalog),
  upsert: (input: Partial<ContractLaborCatalogItem> & { code: string; name: string }) =>
    catalogUpsert('contract_labor_catalogs', input, mapLaborCatalog),
  remove: (id: string) => catalogRemove('contract_labor_catalogs', id),
};

export const contractMachineCatalogService = {
  list: () => catalogList('contract_machine_catalogs', mapMachineCatalog),
  upsert: (input: Partial<ContractMachineCatalogItem> & { code: string; name: string }) =>
    catalogUpsert('contract_machine_catalogs', input, mapMachineCatalog),
  remove: (id: string) => catalogRemove('contract_machine_catalogs', id),
};

export const contractMaterialNormService = {
  list: () => catalogList('contract_material_norms', mapMaterialNorm),
  upsert: (input: Partial<ContractMaterialNormItem> & { workCode: string; materialName: string }) =>
    catalogUpsert('contract_material_norms', {
      ...input,
      wastePercent: Number(input.wastePercent || 0),
      norm: Number(input.norm || 0),
    }, mapMaterialNorm),
  remove: (id: string) => catalogRemove('contract_material_norms', id),
};

export const contractCostItemService = {
  async list(): Promise<ContractCostItem[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('contract_cost_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapCostItem);
  },

  async upsert(input: Partial<ContractCostItem> & { symbol: string; name: string }): Promise<ContractCostItem> {
    const payload = cleanUndefined(toDb({
      id: input.id || crypto.randomUUID(),
      parentId: input.parentId || null,
      symbol: input.symbol.trim(),
      name: input.name.trim(),
      category: input.category || null,
      costType: input.costType || null,
      description: input.description || null,
      status: input.status || 'active',
      sortOrder: Number(input.sortOrder || 0),
      updatedAt: new Date().toISOString(),
      createdAt: input.createdAt,
    }));
    if (!isSupabaseConfigured) return mapCostItem(payload);
    const { data, error } = await supabase
      .from('contract_cost_items')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapCostItem(data);
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { data: childRows, error: childError } = await supabase
      .from('contract_cost_items')
      .select('id')
      .eq('parent_id', id)
      .limit(1);
    if (childError) throw childError;
    if ((childRows?.length || 0) > 0) {
      throw new Error('Khoản mục này đang có khoản mục con. Vui lòng xoá hoặc chuyển các khoản mục con trước.');
    }
    const { error } = await supabase
      .from('contract_cost_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

export const contractCatalogInventoryService = {
  async listMaterials(): Promise<InventoryItem[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('items')
      .select('id, sku, accounting_code, name, category, unit, purchase_unit, purchase_conversion_factor, price_in, price_out, min_stock, supplier_id, image_url, location, stock_by_warehouse')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapInventoryItem);
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
