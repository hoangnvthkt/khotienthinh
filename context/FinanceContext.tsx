
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  CashFund, CashVoucher, CashVoucherItem,
  CashVoucherStatus
} from '../types';

// ============ Mapping helpers (camelCase ↔ snake_case) ============

const mapFundFromDb = (f: any): CashFund => ({
  id: f.id,
  name: f.name,
  currency: f.currency,
  openingBalance: Number(f.opening_balance),
  description: f.description,
  isActive: f.is_active,
  createdAt: f.created_at,
});

const mapFundToDb = (f: CashFund) => ({
  id: f.id,
  name: f.name,
  currency: f.currency,
  opening_balance: f.openingBalance,
  description: f.description || null,
  is_active: f.isActive,
});

const mapVoucherFromDb = (v: any): CashVoucher => ({
  id: v.id,
  code: v.code,
  type: v.type,
  fundId: v.fund_id,
  date: v.date,
  amount: Number(v.amount),
  contactName: v.contact_name,
  contactType: v.contact_type,
  contactId: v.contact_id,
  reason: v.reason,
  status: v.status,
  approvedBy: v.approved_by,
  approvedAt: v.approved_at,
  note: v.note,
  createdBy: v.created_by,
  createdAt: v.created_at,
});

const mapVoucherToDb = (v: CashVoucher) => ({
  id: v.id,
  code: v.code,
  type: v.type,
  fund_id: v.fundId,
  date: v.date,
  amount: v.amount,
  contact_name: v.contactName || null,
  contact_type: v.contactType || null,
  contact_id: v.contactId || null,
  reason: v.reason,
  status: v.status,
  approved_by: v.approvedBy || null,
  approved_at: v.approvedAt || null,
  note: v.note || null,
  created_by: v.createdBy,
});

const mapItemFromDb = (i: any): CashVoucherItem => ({
  id: i.id,
  voucherId: i.voucher_id,
  description: i.description,
  amount: Number(i.amount),
  costCategory: i.cost_category,
});

const mapItemToDb = (i: CashVoucherItem) => ({
  id: i.id,
  voucher_id: i.voucherId,
  description: i.description,
  amount: i.amount,
  cost_category: i.costCategory || null,
});

// ============ Context Type ============

interface FinanceContextType {
  // Cash Funds
  cashFunds: CashFund[];
  addCashFund: (fund: CashFund) => void;
  updateCashFund: (fund: CashFund) => void;
  removeCashFund: (id: string) => void;
  // Cash Vouchers
  cashVouchers: CashVoucher[];
  addCashVoucher: (voucher: CashVoucher, items: CashVoucherItem[]) => void;
  updateCashVoucher: (voucher: CashVoucher, items?: CashVoucherItem[]) => void;
  approveCashVoucher: (id: string, approvedBy: string) => void;
  cancelCashVoucher: (id: string) => void;
  removeCashVoucher: (id: string) => void;
  // Cash Voucher Items
  cashVoucherItems: CashVoucherItem[];
  // Loading
  isFinanceLoading: boolean;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cashFunds, setCashFunds] = useState<CashFund[]>([]);
  const [cashVouchers, setCashVouchers] = useState<CashVoucher[]>([]);
  const [cashVoucherItems, setCashVoucherItems] = useState<CashVoucherItem[]>([]);
  const [isFinanceLoading, setIsFinanceLoading] = useState(isSupabaseConfigured);

  // ============ Fetch Data ============
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsFinanceLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setIsFinanceLoading(true);

        const [fundsRes, vouchersRes, itemsRes] = await Promise.all([
          supabase.from('cash_funds').select('*').order('created_at', { ascending: true }),
          supabase.from('cash_vouchers').select('*').order('date', { ascending: false }),
          supabase.from('cash_voucher_items').select('*'),
        ]);

        if (fundsRes.data) setCashFunds(fundsRes.data.map(mapFundFromDb));
        if (vouchersRes.data) setCashVouchers(vouchersRes.data.map(mapVoucherFromDb));
        if (itemsRes.data) setCashVoucherItems(itemsRes.data.map(mapItemFromDb));
      } catch (error) {
        console.error('Error fetching finance data:', error);
      } finally {
        setIsFinanceLoading(false);
      }
    };

    fetchData();

    // ============ Realtime Subscriptions ============
    const channels = [
      supabase.channel('finance:cash_funds').on('postgres_changes', { event: '*', schema: 'public', table: 'cash_funds' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const mapped = mapFundFromDb(payload.new);
          setCashFunds(prev => {
            const exists = prev.find(f => f.id === mapped.id);
            if (exists) return prev.map(f => f.id === mapped.id ? mapped : f);
            return [...prev, mapped];
          });
        } else if (payload.eventType === 'DELETE') {
          setCashFunds(prev => prev.filter(f => f.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('finance:cash_vouchers').on('postgres_changes', { event: '*', schema: 'public', table: 'cash_vouchers' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const mapped = mapVoucherFromDb(payload.new);
          setCashVouchers(prev => {
            const exists = prev.find(v => v.id === mapped.id);
            if (exists) return prev.map(v => v.id === mapped.id ? mapped : v);
            return [mapped, ...prev];
          });
        } else if (payload.eventType === 'DELETE') {
          setCashVouchers(prev => prev.filter(v => v.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('finance:cash_voucher_items').on('postgres_changes', { event: '*', schema: 'public', table: 'cash_voucher_items' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const mapped = mapItemFromDb(payload.new);
          setCashVoucherItems(prev => {
            const exists = prev.find(i => i.id === mapped.id);
            if (exists) return prev.map(i => i.id === mapped.id ? mapped : i);
            return [...prev, mapped];
          });
        } else if (payload.eventType === 'DELETE') {
          setCashVoucherItems(prev => prev.filter(i => i.id !== payload.old.id));
        }
      }).subscribe(),
    ];

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, []);

  // ============ Sync helpers ============
  const syncUpsert = async (table: string, data: any) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(table).upsert(data);
    if (error) console.error(`Error syncing ${table}:`, error);
  };

  const syncDelete = async (table: string, id: string) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) console.error(`Error deleting from ${table}:`, error);
  };

  // ============ Cash Funds CRUD ============
  const addCashFund = useCallback((fund: CashFund) => {
    setCashFunds(prev => [...prev, fund]);
    syncUpsert('cash_funds', mapFundToDb(fund));
  }, []);

  const updateCashFund = useCallback((fund: CashFund) => {
    setCashFunds(prev => prev.map(f => f.id === fund.id ? fund : f));
    syncUpsert('cash_funds', mapFundToDb(fund));
  }, []);

  const removeCashFund = useCallback((id: string) => {
    setCashFunds(prev => prev.filter(f => f.id !== id));
    syncDelete('cash_funds', id);
  }, []);

  // ============ Cash Vouchers CRUD ============
  const addCashVoucher = useCallback((voucher: CashVoucher, items: CashVoucherItem[]) => {
    setCashVouchers(prev => [voucher, ...prev]);
    setCashVoucherItems(prev => [...prev, ...items]);
    syncUpsert('cash_vouchers', mapVoucherToDb(voucher));
    // Insert items in batch
    if (items.length > 0 && isSupabaseConfigured) {
      supabase.from('cash_voucher_items').insert(items.map(mapItemToDb)).then(({ error }) => {
        if (error) console.error('Error inserting voucher items:', error);
      });
    }
  }, []);

  const updateCashVoucher = useCallback((voucher: CashVoucher, items?: CashVoucherItem[]) => {
    setCashVouchers(prev => prev.map(v => v.id === voucher.id ? voucher : v));
    syncUpsert('cash_vouchers', mapVoucherToDb(voucher));
    if (items && isSupabaseConfigured) {
      // Replace items: delete old, insert new
      supabase.from('cash_voucher_items').delete().eq('voucher_id', voucher.id).then(() => {
        setCashVoucherItems(prev => [...prev.filter(i => i.voucherId !== voucher.id), ...items]);
        if (items.length > 0) {
          supabase.from('cash_voucher_items').insert(items.map(mapItemToDb)).then(({ error }) => {
            if (error) console.error('Error re-inserting voucher items:', error);
          });
        }
      });
    }
  }, []);

  const approveCashVoucher = useCallback((id: string, approvedBy: string) => {
    const now = new Date().toISOString();
    setCashVouchers(prev => prev.map(v =>
      v.id === id ? { ...v, status: 'approved' as CashVoucherStatus, approvedBy, approvedAt: now } : v
    ));
    if (isSupabaseConfigured) {
      supabase.from('cash_vouchers').update({
        status: 'approved', approved_by: approvedBy, approved_at: now
      }).eq('id', id).then(({ error }) => {
        if (error) console.error('Error approving voucher:', error);
      });
    }
  }, []);

  const cancelCashVoucher = useCallback((id: string) => {
    setCashVouchers(prev => prev.map(v =>
      v.id === id ? { ...v, status: 'cancelled' as CashVoucherStatus } : v
    ));
    if (isSupabaseConfigured) {
      supabase.from('cash_vouchers').update({ status: 'cancelled' }).eq('id', id).then(({ error }) => {
        if (error) console.error('Error cancelling voucher:', error);
      });
    }
  }, []);

  const removeCashVoucher = useCallback((id: string) => {
    setCashVouchers(prev => prev.filter(v => v.id !== id));
    setCashVoucherItems(prev => prev.filter(i => i.voucherId !== id));
    syncDelete('cash_vouchers', id); // ON DELETE CASCADE handles items
  }, []);

  return (
    <FinanceContext.Provider value={{
      cashFunds, addCashFund, updateCashFund, removeCashFund,
      cashVouchers, addCashVoucher, updateCashVoucher, approveCashVoucher, cancelCashVoucher, removeCashVoucher,
      cashVoucherItems,
      isFinanceLoading,
    }}>
      {children}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within FinanceProvider');
  return context;
};
