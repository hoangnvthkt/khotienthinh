import { useEffect, useMemo, useState } from 'react';
import { inventoryLedgerService, InventoryLedgerFilters } from '../lib/inventoryLedgerService';
import type { InventoryBalance, InventoryLedgerEntry } from '../types';

export function useInventoryLedger(filters: InventoryLedgerFilters) {
  const [entries, setEntries] = useState<InventoryLedgerEntry[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [entryResult, balanceResult] = await Promise.all([
          inventoryLedgerService.listEntries(filters),
          inventoryLedgerService.listBalances(filters),
        ]);
        if (!mounted) return;
        setEntries(entryResult.entries);
        setBalances(balanceResult.balances);
        setAvailable(entryResult.available && balanceResult.available);
      } catch (err: any) {
        if (!mounted) return;
        setEntries([]);
        setBalances([]);
        setAvailable(false);
        setError(err?.message || 'Không thể tải thẻ kho.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [key]);

  return { entries, balances, available, loading, error };
}
