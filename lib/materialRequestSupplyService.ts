import { supabase } from './supabase';

// Đề xuất vật tư sau khi duyệt: "Đang cung ứng" → tự "Hoàn tất" khi nhận đủ, hoặc CHT / người lập "Kết thúc".
// Không còn bước tạo đợt giao: Mua hàng mua mới (PO) hoặc cấp từ kho cho từng dòng.

export type MaterialRequestSupplyLineState = 'done' | 'closed' | 'waiting' | 'none';
export type MaterialRequestSupplyPhase = 'supplying' | 'completed' | 'ended' | 'other';

export interface MaterialRequestSupplyLine {
  lineId: string; itemId: string | null; itemName: string; sku: string | null; unit: string | null;
  needQty: number; sourcedQty: number; receivedQty: number; closedQty: number; state: MaterialRequestSupplyLineState;
  orders: Array<{ id: string; poNumber: string | null; status: string; qty: number }>;
  transfers: Array<{ id: string; status: string; qty: number; sourceWarehouseName: string | null }>;
}

export interface MaterialRequestSupply {
  requestId: string; status: string; workflowStep: string | null; phase: MaterialRequestSupplyPhase; canEnd: boolean;
  ending: { reason: string; at: string; byName: string | null } | null;
  lines: MaterialRequestSupplyLine[];
}

/** Tóm tắt từng đề xuất đang cung ứng của dự án (thẻ kanban, danh sách "Đề xuất treo cần quyết"). */
export interface MaterialRequestSupplySummary {
  lineCount: number; doneLines: number; unsourcedLines: number; sourcedAny: boolean; canEnd: boolean;
}

export const MATERIAL_REQUEST_END_REASONS = ['Không cần nữa', 'Đã mua ngoài hệ thống', 'Thay bằng đề xuất khác', 'Lệch quy đổi, coi như đủ'];

/** Dòng đủ khi đã nhận ≥ 98% số cần (dung sai lệch quy đổi đơn vị). */
export const SUPPLY_DONE_RATIO = 0.98;

const ERROR_MESSAGES: Record<string, string> = {
  MR_SUPPLY_NOT_FOUND: 'Không tìm thấy đề xuất hoặc bạn không có quyền xem. Tải lại.',
  MR_SUPPLY_STATE: 'Đề xuất không còn ở bước Đang cung ứng. Tải lại.',
  MR_SUPPLY_END_DENIED: 'Chỉ chỉ huy trưởng (quyền Duyệt đề xuất) hoặc người lập phiếu được kết thúc đề xuất.',
  MR_SUPPLY_REASON_REQUIRED: 'Nhập lý do kết thúc.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không tải được tiến độ cung ứng. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const materialRequestSupplyService = {
  get(requestId: string) {
    return call<MaterialRequestSupply>('get_material_request_supply_v1', { p_request_id: requestId });
  },
  list(projectId: string, constructionSiteId?: string | null) {
    return call<Record<string, MaterialRequestSupplySummary>>('list_material_request_supply_v1', {
      p_project_id: projectId, p_construction_site_id: constructionSiteId || null,
    });
  },
  end(input: { requestIds: string[]; reason: string }) {
    return call<{ ended: number; closedLines: number }>('end_material_request_supply_v1', { p_input: input });
  },
};
