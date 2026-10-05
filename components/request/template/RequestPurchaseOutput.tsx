import React from 'react';
import { ArrowRight, PackageCheck, ShoppingCart } from 'lucide-react';
import { PURCHASE_NEED_KEY, purchaseNeedField } from '../../../lib/requestPurchaseNeed';
import type { RequestTemplateDraft, RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';
export const RequestPurchaseOutput: React.FC<{ fields: RequestTemplateDraft['fields']; dispatch: (action: RequestTemplateDraftAction) => void }> = ({ fields, dispatch }) => {
 const enabled = fields.some(f => f.key === PURCHASE_NEED_KEY);
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
  <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Kết nối Mua hàng</h2><p className="mt-1 text-sm text-slate-500">Tự chuyển nhu cầu sau khi hoàn thành bước duyệt cuối.</p></div><button type="button" role="switch" aria-label="Chuyển sang Mua hàng sau duyệt" aria-checked={enabled} onClick={() => dispatch(enabled ? { type: 'REMOVE_FIELD', key: PURCHASE_NEED_KEY } : { type: 'UPSERT_FIELD', field: purchaseNeedField(fields.length + 1) })} className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? 'bg-teal-600' : 'bg-slate-300'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-6' : 'left-1'}`} /></button></div>
  <div className="my-5 flex flex-wrap items-center gap-2 text-sm font-semibold text-teal-800 dark:text-teal-300"><span>Yêu cầu đã duyệt</span><ArrowRight size={15} /><ShoppingCart size={16} /><span>Mua hàng</span><ArrowRight size={15} /><PackageCheck size={16} /><span>Nhận hàng / cấp phát</span></div>
  <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{enabled ? 'Đã thêm bảng nhu cầu chuẩn vào form: tên hàng, quy cách, đơn vị, số lượng, kho nhận, ngày cần, loại hàng và người dự kiến nhận tài sản.' : 'Bật để thêm bảng nhu cầu chuẩn vào mẫu. Các bảng tự tạo khác vẫn giữ nguyên.'}</p>
  <p className="mt-3 text-xs leading-5 text-slate-500">Lưu và xuất bản phiên bản mới để áp dụng cho phiếu tạo sau đó. Phiếu đang duyệt giữ cấu hình lúc gửi; phiếu đã duyệt không tự chuyển lại. Nếu cần đổi số lượng, người duyệt trả lại phiếu để người lập sửa và gửi lại.</p>
 </section>;
};
