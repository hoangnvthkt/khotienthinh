import { BusinessPartner, PartnerClassification } from '../types';
import { fromDb, toDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';

const TABLE = 'business_partners';

const cleanUndefined = <T extends Record<string, any>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const normalizePartner = (row: any): BusinessPartner => {
  const partner = fromDb(row) as BusinessPartner;
  return {
    ...partner,
    classifications: (partner.classifications || []) as PartnerClassification[],
    isActive: partner.isActive ?? true,
  };
};

const normalizeCode = (name: string) => {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 18);
  return `DT-${base || crypto.randomUUID().slice(0, 8).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
};

export const partnerService = {
  async list(options: { includeInactive?: boolean; classification?: PartnerClassification } = {}): Promise<BusinessPartner[]> {
    if (!isSupabaseConfigured) return [];
    let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
    if (!options.includeInactive) query = query.eq('is_active', true);
    if (options.classification) query = query.contains('classifications', [options.classification]);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizePartner);
  },

  async upsert(partner: Partial<BusinessPartner> & { name: string }): Promise<BusinessPartner> {
    const now = new Date().toISOString();
    const payload = cleanUndefined(toDb({
      id: partner.id || crypto.randomUUID(),
      code: partner.code?.trim() || normalizeCode(partner.name),
      name: partner.name.trim(),
      ownerUserId: partner.ownerUserId || null,
      ownerName: partner.ownerName || null,
      createdDate: partner.createdDate || new Date().toISOString().split('T')[0],
      taxCode: partner.taxCode || null,
      address: partner.address || null,
      classifications: partner.classifications || [],
      phone: partner.phone || null,
      country: partner.country || 'Việt Nam',
      province: partner.province || null,
      ward: partner.ward || null,
      email: partner.email || null,
      website: partner.website || null,
      bankName: partner.bankName || null,
      bankAccount: partner.bankAccount || null,
      contactName: partner.contactName || null,
      contactTitle: partner.contactTitle || null,
      contactPhone: partner.contactPhone || null,
      contactEmail: partner.contactEmail || null,
      isActive: partner.isActive ?? true,
      note: partner.note || null,
      updatedAt: now,
      createdAt: partner.createdAt,
    }));

    if (!isSupabaseConfigured) return normalizePartner(payload);
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return normalizePartner(data);
  },

  async deactivate(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase
      .from(TABLE)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    return this.deactivate(id);
  },
};
