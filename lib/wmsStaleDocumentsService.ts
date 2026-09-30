import { supabase } from './supabase';

// Phiếu kho chờ xử lý quá N ngày (K1 — kiểm soát phiếu treo).
export interface WmsStaleDocument {
  id: string; type: string; status: string; date: string; ageDays: number; warehouseId: string | null; warehouseName: string | null;
  requesterName: string | null; sourceType: string | null; note: string | null; itemCount: number; step: string; keepers: string[];
}
export interface WmsStaleDocuments { minDays: number; total: number; oldestDays: number | null; documents: WmsStaleDocument[] }

export const wmsStaleDocumentsService = {
  async list(minDays = 3): Promise<WmsStaleDocuments> {
    const { data, error } = await supabase.rpc('list_wms_stale_documents_v1', { p_min_days: minDays });
    if (error) throw new Error('Không tải được danh sách phiếu kho tồn đọng.');
    return data as WmsStaleDocuments;
  },
};

export const WMS_TYPE_LABELS: Record<string, string> = {
  IMPORT: 'Nhập', EXPORT: 'Xuất', TRANSFER: 'Chuyển kho', LIQUIDATION: 'Xuất hủy', ADJUSTMENT: 'Điều chỉnh',
};
