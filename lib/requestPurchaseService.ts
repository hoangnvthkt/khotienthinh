import { supabase } from './supabase';
export interface PurchaseNeedOptions { warehouses: { id: string; name: string }[]; categories: { id: string; name: string }[]; }
export interface RequestPurchaseLine { id: string; name: string; specification: string; unit: string; qty: number; kind: 'asset' | 'material'; warehouseId: string; warehouseName: string; neededDate: string; recipientName: string | null; categoryName: string | null; orderedQty: number; receivedQty: number; orders: { id: string; code: string; status: string }[]; assets: { id: string; code: string; status: string; holder: string | null }[]; }
const messages: Record<string, string> = {
 REQUEST_PURCHASE_HAS_ORDERS: 'Phiếu đã có đơn mua. Hủy hoặc xử lý xong các đơn liên quan trước khi thay đổi phiếu.',
 REQUEST_PURCHASE_INVALID: 'Bảng nhu cầu chưa đầy đủ hoặc không hợp lệ. Kiểm tra tên hàng, đơn vị, số lượng, kho nhận, ngày cần và nhóm tài sản.',
 REQUEST_PURCHASE_CHANGED: 'Phiếu đã thay đổi hoặc bị thu hồi. Tải lại trước khi lập đơn.',
 REQUEST_PURCHASE_QTY: 'Số lượng đặt vượt phần nhu cầu còn lại hoặc không hợp lệ.',
 REQUEST_PURCHASE_UNIT: 'Đơn vị trong danh mục phải khớp đơn vị đã duyệt. Chọn đúng hàng hoặc trả lại phiếu để sửa đơn vị.',
 REQUEST_PURCHASE_LOCKED: 'Đơn đã liên kết Yêu cầu. Không thay đổi hàng, kho hoặc số lượng; hãy hủy đơn nháp và lập lại từ phiếu nguồn.',
 REQUEST_ASSET_WHOLE_UNITS: 'Tài sản phải nhận theo số chiếc nguyên, không vượt số đã duyệt.',
};
async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
 const { data, error } = await supabase.rpc(name, params);
 if (error) throw new Error(Object.entries(messages).find(([key]) => error.message.includes(key))?.[1] || error.message);
 return data as T;
}
export const requestPurchaseService = {
 options: () => rpc<PurchaseNeedOptions>('request_purchase_options_v1', {}),
 order: (input: { requestId: string; revision: number; lineId: string; itemId: string; qty: number; vendorId: string; unitPrice: number; vatRate: number; key: string; note: string }) => rpc<{ purchaseOrderId: string; poNumber: string }>('create_request_purchase_order_v1', { p_input: input }),
};
