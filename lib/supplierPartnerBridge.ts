import { BusinessPartner } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

export const supplierPartnerBridge = {
  async ensureLegacySupplier(partner?: BusinessPartner | null): Promise<void> {
    if (!partner?.id || !isSupabaseConfigured) return;

    const { error } = await supabase.from('suppliers').upsert({
      id: partner.id,
      name: partner.name,
      contact_person: partner.contactName || partner.ownerName || partner.name,
      phone: partner.phone || partner.contactPhone || 'Chua cap nhat',
      debt: 0,
    }, { onConflict: 'id' });

    if (error) throw error;
  },
};
