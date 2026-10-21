import { useCallback, useEffect, useMemo, useState } from 'react';
import { inventoryLedgerService } from '../lib/inventoryLedgerService';
import type { InventoryNxtRow } from '../lib/inventoryNxtReport';

type NxtFilters = { warehouseId?: string; materialId?: string; dateFrom: string; dateTo: string; search?: string };

export function useInventoryNxtReport(filters: NxtFilters) {
  const [rows, setRows] = useState<InventoryNxtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    inventoryLedgerService.getNxtReport(filters)
      .then(result => { if (mounted) setRows(result); })
      .catch((err: any) => {
        if (!mounted) return;
        setRows([]);
        const message = String(err?.message || '');
        setError(/statement timeout/i.test(message)
          ? 'Máy chủ tính quá lâu. Thử chọn một kho hoặc thu hẹp khoảng ngày rồi bấm Thử lại.'
          : message || 'Chưa tải được báo cáo nhập xuất tồn.');
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce(value => value + 1), []);
  return { rows, loading, error, reload };
}
