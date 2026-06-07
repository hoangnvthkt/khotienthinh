import { useEffect, useMemo, useState } from 'react';
import { inventoryLedgerService, InventoryLedgerFilters } from '../lib/inventoryLedgerService';
import type { InventoryBalance, InventoryLedgerEntry, InventoryLedgerReportResult } from '../types';

export function useInventoryLedger(filters: InventoryLedgerFilters) {
  const [entries, setEntries] = useState<InventoryLedgerEntry[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [available, setAvailable] = useState(false);
  const [report, setReport] = useState<InventoryLedgerReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const reportResult = await inventoryLedgerService.getReport(filters);
        if (!mounted) return;
        if (reportResult.available) {
          setEntries(reportResult.entriesPage);
          setBalances([]);
          setReport(reportResult);
          setAvailable(true);
          return;
        }

        const fallbackFilters = {
          ...filters,
          dateFrom: undefined,
          transactionType: 'all' as const,
          search: undefined,
          limit: Math.max(filters.limit || 5000, 5000),
        };
        const [entryResult, balanceResult] = await Promise.all([
          inventoryLedgerService.listEntries(fallbackFilters),
          inventoryLedgerService.listBalances(filters),
        ]);
        if (!mounted) return;
        setEntries(entryResult.entries);
        setBalances(balanceResult.balances);
        setReport(null);
        setAvailable(entryResult.available && balanceResult.available);
      } catch (err: any) {
        if (!mounted) return;
        setEntries([]);
        setBalances([]);
        setReport(null);
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

  return { entries, balances, report, available, loading, error };
}
