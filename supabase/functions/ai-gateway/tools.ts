// Trợ lý v2 · T1: công cụ ĐỌC của Trợ lý (chủ SP 18/10/2026). Mỗi công cụ gọi lệnh máy chủ sẵn có bằng JWT người hỏi —
// RLS / kiểm quyền của module quyết định thấy gì; AI không bao giờ thấy nhiều hơn người hỏi. Không có công cụ ghi nghiệp vụ:
// công cụ chuan_bi_… (T2) chỉ ghi lệnh nháp + hiện thẻ, người dùng tự bấm gửi ở thẻ / form của module.
//   tim_ho_so          search_global_v1 (20 loại hồ sơ, như ô Tìm kiếm)
//   ton_kho            search_global_v1 (vật tư) → ai_stock_by_items_v1 (tồn theo kho người hỏi xem được)
//   chi_tiet_don_mua   get_procurement_order_v1 + get_procurement_po_payment_status_v1
//   chi_tiet_de_xuat   get_material_request_supply_v1 (đề xuất vật tư: đã đặt / đã nhận / còn thiếu)
//   viec_cua_toi       vcc_my_work_items_v1 (chờ tôi / tôi gửi / tôi theo dõi)
//   phep_nhan_vien     search_global_v1 (nhân viên) → get_hrm_leave_ledger (số phép năm) · list_hrm_leave_balances (toàn công ty). RPC tự chặn 42501.
//   chi_tiet_ho_so     (19/10) search_global_v1 (nhân viên) → get_hrm_employee_overview + get_hrm_employee_work_organization (+ get_hrm_employee_contract_employment
//                      khi RPC cho xem). Mức xem do app_private.hrm_employee_profile_access_level quyết (danh bạ / chính mình / quản lý trực tiếp / HR; không có → 42501).
//                      Chỉ trả thông tin công việc; không gọi RPC liên hệ cá nhân / lương / thuế / ngân hàng — CCCD, STK, lương, SĐT cá nhân không bao giờ qua Trợ lý.
//   bien_dong_nhan_su  get_hrm_headcount_trend_v1 (số người cuối tháng, vào làm, nghỉ việc; quyền Xem tổ chức) → thẻ biểu đồ (sự kiện chart).
// Quyền do RPC / RLS quyết, không phải lời nhắc (chủ SP 18/10 tối): mọi 42501 thành {loi: "Ngoài phạm vi người hỏi được xem: …"} để model nói
// đúng vậy thay vì bịa hay nói "không tồn tại". Rà soát 9 RPC × 3 vai: docs/command-center/10-ra-soat-quyen-cong-cu-tro-ly-2026-10-18.md.
//   chuan_bi_don_nghi_phep   preview_my_leave_request → lệnh nháp leave_request (thẻ Gửi đơn)
//   chuan_bi_de_xuat_vat_tu  assistant_mr_projects_v1 → lệnh nháp material_request (thẻ mở form Đề xuất, Gõ nhanh điền sẵn)
//   chuan_bi_don_mua         list_procurement_proactive_options_v1 + list_procurement_vendors_v1 → lệnh nháp purchase_order (form đơn mua trong chat)
//   chuan_bi_nhat_ky         assistant_daily_log_projects_v1 → lệnh nháp daily_log (thẻ đọc báo cáo bằng bộ của màn Nhật ký, tạo phiếu nháp)
//   chuan_bi_ghi_nho         → lệnh nháp memory_note (T4b: thẻ sửa chữ, người dùng bấm Lưu ghi nhớ)
// Kết quả gửi AI là JSON gọn (đã che SĐT / CCCD / STK ở cổng); mỗi hồ sơ có mã h1, h2… để AI dẫn nguồn.
// Tệp này không dùng API Deno để vitest kiểm thử được (lệnh máy chủ truyền vào qua `rpc`).
import type { SourceBook, ToolSpec } from './agent.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
/** runId + emit: công cụ CHUẨN BỊ (lệnh nháp) ghi dòng lệnh vào lượt AI và hiện thẻ cho người dùng (T2a).
 *  projectId: dự án đang xem ở Trung tâm — chỉ để xếp lên đầu khi hỏi lại; không tự ghép khi người dùng chưa nói dự án (chủ SP 18/10). */
export interface ToolContext {
  rpc: Rpc; book: SourceBook; runId?: string; emit?: (event: Record<string, unknown>) => void; projectId?: string | null;
  /** Nguyên văn tin người dùng vừa gửi (báo cáo Zalo dán vào) — công cụ nhật ký lưu nguyên văn, không bắt model chép lại. */
  question?: string;
}

export const KIND_LABEL: Record<string, string> = {
  project: 'Dự án', employee: 'Nhân viên', item: 'Vật tư', wms_tx: 'Phiếu kho', material_code: 'Đề xuất cấp mã', purchase_order: 'Đơn hàng',
  material_request: 'Đề xuất vật tư', rq: 'Phiếu yêu cầu', wf: 'Phiếu quy trình', partner: 'Đối tác', customer_contract: 'HĐ nhận thầu',
  subcontract: 'HĐ thầu phụ', supplier_contract: 'HĐ nhà cung cấp', payment_request: 'Đề nghị chi', asset: 'Tài sản', office_doc: 'Văn bản',
  vehicle_booking: 'Đặt xe', work_task: 'Công việc', feedback: 'Góp ý', leave: 'Đơn nghỉ phép',
};
const KINDS = Object.keys(KIND_LABEL);

export const TOOL_LABEL: Record<string, string> = {
  tim_ho_so: 'Tìm hồ sơ', ton_kho: 'Tồn kho', chi_tiet_don_mua: 'Chi tiết đơn mua', chi_tiet_de_xuat: 'Chi tiết đề xuất vật tư', viec_cua_toi: 'Việc của tôi', phep_nhan_vien: 'Số phép nhân viên', chi_tiet_ho_so: 'Hồ sơ nhân viên',
  bien_dong_nhan_su: 'Biến động nhân sự',
  chuan_bi_don_nghi_phep: 'Chuẩn bị đơn nghỉ phép', chuan_bi_de_xuat_vat_tu: 'Chuẩn bị đề xuất vật tư', chuan_bi_don_mua: 'Chuẩn bị đơn mua', chuan_bi_nhat_ky: 'Chuẩn bị nhật ký', chuan_bi_ghi_nho: 'Chuẩn bị ghi nhớ',
};

export const TOOLS: ToolSpec[] = [
  {
    name: 'tim_ho_so',
    description: 'Tìm hồ sơ theo chữ (mã, tên, nội dung) trong phạm vi người hỏi được xem: dự án, đơn hàng PO, đề xuất vật tư, phiếu kho, vật tư, đối tác/NCC, hợp đồng, phiếu yêu cầu, phiếu quy trình, đề nghị chi, văn bản, công việc, nhân viên, tài sản, đặt xe, nghỉ phép. Trả tối đa 8 hồ sơ, mỗi hồ sơ có mã nguồn hN.',
    parameters: { type: 'object', additionalProperties: false, required: ['tu_khoa'], properties: {
      tu_khoa: { type: 'string', description: 'Chữ cần tìm, ngắn: mã chứng từ (PO-646, MR-2026-2688), tên vật tư, tên NCC, tên dự án…' },
      loai: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Chỉ tìm các loại này (bỏ trống = mọi loại).' },
    } },
  },
  {
    name: 'ton_kho',
    description: 'Tồn kho hiện tại của vật tư theo từng kho người hỏi được xem (số lượng, đơn vị). Tìm vật tư theo tên hoặc mã.',
    parameters: { type: 'object', additionalProperties: false, required: ['vat_tu'], properties: {
      vat_tu: { type: 'string', description: 'Tên hoặc mã vật tư, VD "thép D16", "xi măng PCB40".' },
    } },
  },
  {
    name: 'chi_tiet_don_mua',
    description: 'Chi tiết một đơn hàng PO: NCC, dự án, kho nhận, trạng thái, ngày hẹn giao, các dòng hàng (đặt / đã nhận / còn phải giao, đơn giá), tổng tiền, tình hình thanh toán.',
    parameters: { type: 'object', additionalProperties: false, required: ['ma'], properties: {
      ma: { type: 'string', description: 'Số PO (VD PO-646) hoặc mã nguồn hN của đơn hàng đã tìm.' },
    } },
  },
  {
    name: 'chi_tiet_de_xuat',
    description: 'Chi tiết cung ứng của một đề xuất vật tư dự án: từng dòng cần bao nhiêu, đã đặt mua / điều chuyển bao nhiêu, đã nhận bao nhiêu, PO nào.',
    parameters: { type: 'object', additionalProperties: false, required: ['ma'], properties: {
      ma: { type: 'string', description: 'Mã đề xuất (VD MR-2026-2688) hoặc mã nguồn hN của đề xuất đã tìm.' },
    } },
  },
  {
    name: 'viec_cua_toi',
    description: 'Danh sách việc của người hỏi: "cho_toi" (việc chờ tôi xử lý), "toi_gui" (hồ sơ tôi gửi đang chờ người khác), "theo_doi" (hồ sơ tôi theo dõi).',
    parameters: { type: 'object', additionalProperties: false, required: ['nhom'], properties: {
      nhom: { type: 'string', enum: ['cho_toi', 'toi_gui', 'theo_doi'] },
      tu_khoa: { type: 'string', description: 'Lọc theo chữ trong mã / tiêu đề (không bắt buộc).' },
    } },
  },
  {
    name: 'phep_nhan_vien',
    description: 'Số ngày phép năm của một nhân viên (được hưởng, đã nghỉ, còn lại, đang chờ duyệt, phép chuyển từ năm trước) và các lần ghi sổ phép gần nhất. Dùng khi hỏi "còn bao nhiêu ngày phép", "số phép của ai". Luôn gọi công cụ này rồi mới trả lời: máy chủ tự kiểm quyền theo người hỏi và báo nếu ngoài quyền — không tự kết luận trước là có hay không có quyền. Trùng tên thì công cụ trả danh sách để hỏi lại bằng gợi ý bấm.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      ten: { type: 'string', description: 'Tên (có thể chỉ tên gọi, VD "Hương") hoặc mã nhân viên cần xem. Bỏ trống = chính người hỏi.' },
      nam: { type: 'integer', description: 'Năm phép (mặc định năm hiện tại).' },
      toan_cong_ty: { type: 'boolean', description: 'true khi hỏi số phép của cả công ty / nhiều người (ai còn nhiều phép nhất…); máy chủ kiểm quyền.' },
    } },
  },
  {
    name: 'chi_tiet_ho_so',
    description: 'Hồ sơ công việc của một nhân viên: họ tên, mã, chức danh, vị trí, phòng ban, quản lý trực tiếp, ngày vào, ngày chính thức, trạng thái, email công việc, hợp đồng hiện tại (loại, hạn) và quá trình công tác gần nhất. Dùng khi hỏi hồ sơ / thông tin / chức danh / phòng ban / ngày vào / hợp đồng / ai quản lý trực tiếp một người. Luôn gọi rồi mới trả lời: máy chủ tự quyết mức xem theo quyền người hỏi (danh bạ, chính mình, quản lý trực tiếp, HR) và báo nếu ngoài quyền. Không tra lương, CCCD, số tài khoản, SĐT cá nhân.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      ma: { type: 'string', description: 'Mã nguồn hN của nhân viên đã thấy, mã nhân viên (VD TT006974) hoặc tên (có thể chỉ tên gọi, VD "Thanh"). Bỏ trống = chính người hỏi.' },
    } },
  },
  // Biểu đồ (chủ SP 19/10): công cụ lấy số từ máy chủ rồi hiện thẻ biểu đồ; AI chỉ nhận xét, không tự vẽ, không tự cộng.
  {
    name: 'bien_dong_nhan_su',
    description: 'Biến động nhân sự toàn công ty theo tháng: số người cuối mỗi tháng, số vào làm, số nghỉ việc, đầu kỳ / cuối kỳ — và HIỆN THẺ BIỂU ĐỒ trong chat. Dùng khi hỏi biến động / tăng giảm / thống kê / biểu đồ nhân sự, số lao động, quân số, tuyển mới, nghỉ việc theo tháng, quý, năm, "6 tháng đầu năm". Máy chủ kiểm quyền (Xem tổ chức) và báo nếu ngoài quyền. Tối đa 24 tháng.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      tu_thang: { type: 'string', description: 'Tháng bắt đầu YYYY-MM, VD "6 tháng đầu năm 2026" → 2026-01; "quý 3" → 2026-07. Bỏ trống = 6 tháng gần nhất.' },
      den_thang: { type: 'string', description: 'Tháng kết thúc YYYY-MM, VD "6 tháng đầu năm 2026" → 2026-06. Bỏ trống = tháng này.' },
    } },
  },
  // T2a — lệnh nháp: chỉ CHUẨN BỊ và hiện thẻ; người dùng tự bấm Gửi đơn (màn hình gọi lệnh gửi của module).
  {
    name: 'chuan_bi_don_nghi_phep',
    description: 'CHUẨN BỊ đơn nghỉ phép nháp cho chính người hỏi (không gửi): kiểm tra số ngày, người duyệt, phép còn, vấn đề; rồi hiện thẻ để người dùng xem và tự bấm Gửi đơn. Dùng khi người dùng muốn xin nghỉ; chưa rõ loại thì gọi với loai bỏ trống để lấy danh sách loại thật (đưa thành gợi ý bấm), thiếu ngày / lý do thì công cụ báo để hỏi lại.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      loai: { type: 'string', description: 'Loại nghỉ theo lời người dùng, VD "phép năm", "nghỉ ốm", "việc riêng không lương".' },
      tu_ngay: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD.' },
      den_ngay: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD (bỏ trống = nghỉ trong một ngày).' },
      buoi_bat_dau: { type: 'string', enum: ['ca_ngay', 'sang', 'chieu'], description: 'Ngày đầu nghỉ cả ngày / buổi sáng / buổi chiều.' },
      buoi_ket_thuc: { type: 'string', enum: ['ca_ngay', 'sang', 'chieu'], description: 'Ngày cuối nghỉ cả ngày / buổi sáng / buổi chiều.' },
      ly_do: { type: 'string', description: 'Lý do nghỉ (ít nhất 3 ký tự), theo lời người dùng.' },
    } },
  },
  // T2b — đề xuất vật tư: tách câu thành dòng + chọn dự án; thẻ mở form Đề xuất thật (Gõ nhanh điền sẵn), người dùng khớp mã và tự gửi.
  {
    name: 'chuan_bi_de_xuat_vat_tu',
    description: 'CHUẨN BỊ phiếu đề xuất vật tư nháp cho dự án (không gửi): tách lời người dùng thành từng dòng vật tư rồi hiện thẻ form gọn trong chat; người dùng chọn mã, người duyệt và tự bấm Gửi duyệt. Dùng khi người dùng muốn đề xuất / xin / cần vật tư cho công trường và đã nói ít nhất một vật tư.',
    parameters: { type: 'object', additionalProperties: false, required: ['dong'], properties: {
      du_an: { type: 'string', description: 'Mã hoặc tên dự án theo lời người dùng; chưa nói thì bỏ trống — công cụ trả danh sách dự án để hỏi lại.' },
      ten_de_xuat: { type: 'string', description: 'Tên phiếu ngắn, VD "Vật tư đổ bê tông sàn tầng 4" (bỏ trống thì lấy theo mục đích).' },
      muc_dich: { type: 'string', description: 'Dùng cho việc gì / hạng mục nào, theo lời người dùng.' },
      ngay_can: { type: 'string', description: 'Ngày cần vật tư YYYY-MM-DD (nếu người dùng nói).' },
      dong: { type: 'array', minItems: 1, maxItems: 30, description: 'Mỗi vật tư một dòng, giữ nguyên cách gọi của người dùng.', items: {
        type: 'object', additionalProperties: false, required: ['ten'], properties: {
          ten: { type: 'string', description: 'Tên vật tư, VD "xi măng PCB40", "thép D16".' },
          quy_cach: { type: 'string', description: 'Quy cách / kích thước nếu có, VD "dày 0.45mm", "D110 C1".' },
          so_luong: { type: 'number', description: 'Số lượng (bỏ trống nếu người dùng chưa nói). Số kiểu Việt: dấu chấm phân cách nghìn (6.300 = 6300), dấu phẩy thập phân (7,5 = 7.5).' },
          don_vi: { type: 'string', description: 'Đơn vị theo lời người dùng: bao, tấn, cây, m, m3, cái…' },
          ghi_chu: { type: 'string', description: 'Ghi chú riêng của dòng (dùng cho khu nào, tổ nào…).' },
        } } },
    } },
  },
  // T2c — đơn mua từ báo giá: tách NCC + dòng hàng + đơn giá; thẻ là form đơn mua trong chat, người Mua hàng tự Lưu nháp / Gửi duyệt.
  {
    name: 'chuan_bi_don_mua',
    description: 'CHUẨN BỊ đơn mua (PO chủ động) nháp từ báo giá / lời người dùng (không lưu, không gửi): tách nhà cung cấp, từng dòng hàng (tên, quy cách, số lượng, đơn vị, đơn giá), VAT, ngày giao; rồi hiện thẻ form đơn mua để người Mua hàng chọn mã, NCC, lý do, người duyệt và tự bấm Gửi duyệt. Dùng khi người dùng muốn lập / đặt đơn mua, dán báo giá NCC.',
    parameters: { type: 'object', additionalProperties: false, required: ['dong'], properties: {
      du_an: { type: 'string', description: 'Mã hoặc tên dự án nhận hàng theo lời người dùng; chưa nói thì bỏ trống — công cụ trả danh sách để hỏi lại.' },
      ncc: { type: 'string', description: 'Tên hoặc mã số thuế nhà cung cấp trên báo giá / theo lời người dùng.' },
      ly_do: { type: 'string', enum: ['price_lock', 'long_lead', 'min_stock', 'other'], description: 'Lý do mua chủ động nếu người dùng nói: chốt giá / hàng đặt dài ngày / bù tồn / khác.' },
      ly_do_khac: { type: 'string', description: 'Lý do cụ thể (khi "khác" hoặc người dùng giải thích).' },
      vat: { type: 'number', description: 'Thuế VAT % trên báo giá (VD 8, 10).' },
      ngay_giao: { type: 'string', description: 'Ngày NCC hẹn giao YYYY-MM-DD (nếu có).' },
      ghi_chu: { type: 'string', description: 'Ghi chú đơn (số báo giá, điều kiện giao…).' },
      dong: { type: 'array', minItems: 1, maxItems: 40, description: 'Mỗi mặt hàng một dòng, chép đúng báo giá.', items: {
        type: 'object', additionalProperties: false, required: ['ten'], properties: {
          ten: { type: 'string', description: 'Tên hàng, VD "Thép D16 CB400".' },
          quy_cach: { type: 'string', description: 'Quy cách / kích thước / mác nếu có.' },
          so_luong: { type: 'number', description: 'Số lượng theo báo giá. Số kiểu Việt: dấu chấm phân cách nghìn (6.300 = 6300), dấu phẩy thập phân (7,5 = 7.5).' },
          don_vi: { type: 'string', description: 'Đơn vị theo báo giá: kg, tấn, cây, m, bao…' },
          don_gia: { type: 'number', description: 'Đơn giá (đồng) theo đơn vị trên báo giá, chưa VAT nếu báo giá tách VAT. Số kiểu Việt: dấu chấm phân cách nghìn (6.300 = 6300), dấu phẩy thập phân (7,5 = 7.5).' },
          thanh_tien: { type: 'number', description: 'Thành tiền của dòng nếu báo giá ghi (để công cụ đối chiếu SL × đơn giá).' },
        } } },
    } },
  },
  // T2d — nhật ký từ báo cáo Zalo: công cụ lưu nguyên văn tin + dự án; thẻ đọc bằng bộ của màn Nhật ký, người dùng tạo phiếu nháp.
  {
    name: 'chuan_bi_nhat_ky',
    description: 'CHUẨN BỊ phiếu nhật ký công trường nháp từ báo cáo Zalo / tin báo cáo ngày người dùng vừa dán (không lưu, không gửi). Công cụ tự lấy nguyên văn tin; thẻ sẽ tách ngày × mũi × dòng việc, gắn hạng mục kế hoạch, tổ đội để người dùng kiểm rồi bấm Tạo phiếu nháp. Dùng khi người dùng dán báo cáo thi công / muốn ghi nhật ký.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      du_an: { type: 'string', description: 'Mã hoặc tên dự án theo lời người dùng / trong tin; chưa rõ thì bỏ trống — công cụ trả danh sách để hỏi lại.' },
      ngay_bao_cao: { type: 'string', description: 'Ngày báo cáo YYYY-MM-DD cho các dòng không ghi ngày (mặc định hôm nay).' },
      noi_dung: { type: 'string', description: 'Chỉ khi báo cáo nằm trong ẢNH đính kèm: chép nguyên văn chữ trong ảnh (giữ xuống dòng). Báo cáo dán dạng chữ thì bỏ trống.' },
    } },
  },
  // T4b — trí nhớ cá nhân: chỉ chuẩn bị thẻ; người dùng sửa chữ rồi bấm Lưu ghi nhớ.
  {
    name: 'chuan_bi_ghi_nho',
    description: 'CHUẨN BỊ một ghi nhớ cá nhân khi người dùng bảo nhớ giúp / ghi nhớ / từ nay hãy… (sở thích, thông tin nền về công việc của họ). Chỉ hiện thẻ; người dùng tự bấm Lưu ghi nhớ. Không dùng cho mật khẩu, số tài khoản, CCCD.',
    parameters: { type: 'object', additionalProperties: false, required: ['noi_dung'], properties: {
      noi_dung: { type: 'string', description: 'Nội dung ghi nhớ, một câu gọn, rõ nghĩa khi đọc riêng (3–300 ký tự).' },
    } },
  },
];

// ── tiện ích ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const asArray = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null);
const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const round = (v: unknown, digits = 3) => { const n = num(v); return n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits; };
const day = (v: unknown) => { const s = str(v, 40); return s ? s.slice(0, 10) : null; };
/** Bỏ khóa null / rỗng cho gọn token. */
const compact = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>;

/** "Thép D16 – PCB40" → [["thep"],["d16"],["pcb40"]]: bỏ dấu, chỉ chữ + số + . / -, tối đa 6 cụm (như ô Tìm kiếm). */
export const searchTerms = (text: string): string[][] =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9./-]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).map(t => [t.slice(0, 60)]);

type RpcError = { message?: string; code?: string } | null;
/** Máy chủ từ chối theo quyền người hỏi (42501 / *_DENIED). */
const denied = (error: RpcError) => Boolean(error && (error.code === '42501' || /DENIED|42501/i.test(error.message || '')));
/** Hồ sơ không có (PT404 / *_NOT_FOUND) — chỉ gặp khi người hỏi đã có quyền xem loại đó. */
const notFound = (error: RpcError) => Boolean(error && (error.code === 'PT404' || /NOT_FOUND/i.test(error.message || '')));
/** Lời báo thống nhất khi RPC chặn 42501: model nói rõ là ngoài quyền xem — không bịa, không nói "không tồn tại" (rà soát 18/10). */
export const outOfScope = (what: string) => ({ loi: `Ngoài phạm vi người hỏi được xem: ${what} (máy chủ từ chối theo quyền). Nói rõ là ngoài quyền xem, không đoán số, không nói là không tồn tại.` });
const toolError = (error: RpcError, what: string) =>
  JSON.stringify(denied(error) ? outOfScope(what) : notFound(error) ? { loi: `Không thấy ${what} trong phạm vi người hỏi được xem.` } : { loi: `Chưa đọc được ${what}, thử lại sau.` });

const searchRecords = async (ctx: ToolContext, text: string, kinds: string[] | null, limit: number) => {
  const terms = searchTerms(text);
  const none = { records: [] as Record<string, unknown>[], denied: [] as string[] };
  if (!terms.length) return { ...none, error: null, empty: true };
  const r = await ctx.rpc('search_global_v1', { p_terms: terms, p_kinds: kinds, p_limit: limit });
  if (r.error) return { ...none, error: r.error, empty: false };
  const records = asArray(asObject(r.data).records).map(asObject).filter(x => typeof x.id === 'string' && typeof x.kind === 'string');
  // Nguồn chặn 42501 (SECURITY DEFINER như danh bạ) nằm ở `denied`; nguồn theo RLS (vật tư, kho…) chỉ trả rỗng — không phân biệt được "không có" và "không quyền".
  const deniedKinds = asArray(asObject(r.data).denied).filter((k): k is string => typeof k === 'string');
  return { records, denied: deniedKinds, error: null, empty: false };
};

/** Hồ sơ gửi màn hình (mở được): bỏ thông tin liên hệ cá nhân trong extra. */
const recordForScreen = (rec: Record<string, unknown>) => {
  const extra = asObject(rec.extra);
  const { phone: _p, email: _e, ...safeExtra } = extra;
  return compact({ kind: rec.kind, id: rec.id, code: str(rec.code), title: str(rec.title, 300), subtitle: str(rec.subtitle, 300), status: str(rec.status, 40),
    date: str(rec.date, 40), projectId: str(rec.projectId), siteId: str(rec.siteId), extra: safeExtra, rank: num(rec.rank) ?? 0 });
};

/** Hồ sơ theo mã hN: công cụ đã trả trong lượt này (refBook, đủ extra) hoặc hồ sơ ô tìm ngay gửi kèm câu hỏi (SourceBook, 19/10). */
const byRef = (ctx: ToolContext, refBook: Map<string, Record<string, unknown>>, ma: string, kind: string) => {
  if (!/^h\d{1,3}$/i.test(ma)) return undefined;
  const hit = refBook.get(ma.toLowerCase());
  if (hit && hit.kind === kind) return hit;
  const src = ctx.book.find(ma);
  return src?.type === 'record' && src.record.kind === kind ? src.record : undefined;
};

/** Tìm đúng một hồ sơ theo mã hN đã cấp hoặc theo mã chứng từ. */
const resolveOne = async (ctx: ToolContext, ma: string, kind: string, refBook: Map<string, Record<string, unknown>>) => {
  const fromRef = byRef(ctx, refBook, ma, kind);
  if (fromRef) return { record: fromRef, error: null };
  const found = await searchRecords(ctx, ma, [kind], 5);
  if (found.error) return { record: null, error: found.error };
  const folded = ma.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = found.records.find(r => String(r.code || '').toLowerCase().replace(/[^a-z0-9]/g, '') === folded);
  return { record: exact || found.records[0] || null, error: null };
};

// ── T2a: lệnh nháp ─────────────────────────────────────────────────────────────────────────────────────────────────────
const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const SESSION: Record<string, 'full' | 'morning' | 'afternoon'> = { ca_ngay: 'full', sang: 'morning', chieu: 'afternoon' };
const SESSION_LABEL: Record<string, string> = { full: 'cả ngày', morning: 'buổi sáng', afternoon: 'buổi chiều' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Từ chung trong câu xin nghỉ, không dùng để phân biệt loại ("xin nghỉ", "đơn nghỉ"). */
const GENERIC_WORDS = new Set(['nghi', 'xin', 'don', 'loai']);
const words = (v: unknown) => fold(v).split(/[^a-z0-9]+/).filter(Boolean);
/**
 * "phép năm" / "ốm" / "đi muộn" → loại nghỉ đang dùng: trùng mã, hoặc mọi từ (bỏ dấu, bỏ từ chung) đều có trong tên loại.
 * Khớp nhiều loại hoặc không loại nào → null (Trợ lý hỏi lại kèm danh sách).
 */
export const matchLeaveType = (text: string, types: Array<Record<string, unknown>>) => {
  const q = fold(text);
  if (!q) return null;
  const byCode = types.filter(t => fold(t.code) === q || fold(t.name) === q);
  if (byCode.length === 1) return byCode[0];
  const wanted = words(q).filter(w => !GENERIC_WORDS.has(w));
  if (!wanted.length) return null;
  const hits = types.filter(t => { const name = new Set(words(t.name)); return wanted.every(w => name.has(w)); });
  return hits.length === 1 ? hits[0] : null;
};

const PROJECT_GENERIC = new Set(['du', 'an', 'cong', 'trinh', 'ct', 'da']);
/** Dự án theo lời người dùng: trùng mã / tên thì lấy luôn; không thì mọi từ (bỏ "dự án", "công trình") phải có trong mã + tên. */
export const matchProjects = <T extends Record<string, unknown>>(text: string, projects: T[]): T[] => {
  const q = fold(text);
  if (!q) return [];
  const exact = projects.filter(p => fold(p.code) === q || fold(p.name) === q);
  if (exact.length) return exact;
  const wanted = words(q).filter(w => !PROJECT_GENERIC.has(w));
  if (!wanted.length) return [];
  return projects.filter(p => {
    const code = fold(p.code);
    // Mã + tên + tên chủ đầu tư ("Dự án xinhai" ↔ CĐT "CÔNG TY TNHH XIN HAI VINA"); viết liền / tách đều khớp.
    const hay = `${code} ${fold(p.name)} ${fold(p.client)}`;
    const have = new Set(words(hay));
    const squashed = words(hay).join('');
    return wanted.every(w => have.has(w) || code.includes(w) || (w.length >= 4 && squashed.includes(w)));
  });
};
// Chữ chung trong tên dự án / chủ đầu tư — không dùng để nhận dự án từ tin báo cáo.
const NAME_COMMON = new Set(['nha', 'may', 'san', 'xuat', 'gia', 'cong', 'cac', 'pham', 'giai', 'doan', 'du', 'an', 'trinh', 'xuong', 'van', 'phong', 'khu', 'ty', 'tnhh', 'viet', 'nam', 'hung', 'yen', 'ha', 'noi', 'the', 'kho', 'xay', 'dung', 'mo', 'rong', 'moi', 'bong', 'thu', 'nhoi', 'gd', 'gd2', 'gd1', 'vina', 'phan', 'co', 'tap', 'doan', 'quoc', 'te', 'mot', 'thanh', 'vien', 'company', 'limited', 'ltd']);
/** Dự án có mã, chữ riêng trong tên (≥ 4 ký tự, không phải chữ chung) xuất hiện nguyên chữ trong tin, hoặc tên chủ đầu tư viết liền
 *  ("XinHai" ↔ "XIN HAI VINA", từ ≥ 5 ký tự). */
export const projectsMentioned = <T extends Record<string, unknown>>(text: string, projects: T[]): T[] => {
  const tw = words(text);
  const have = new Set(tw);
  const joined = ` ${tw.join(' ')} `;
  return projects.filter(p => {
    const code = words(p.code);
    if (code.length && joined.includes(` ${code.join(' ')} `)) return true;
    if (code.some(w => w.length >= 3 && !/^\d+$/.test(w) && have.has(w))) return true;
    if (words(p.name).some(w => w.length >= 4 && !NAME_COMMON.has(w) && !/^\d+$/.test(w) && have.has(w))) return true;
    const client = words(p.client).filter(w => !NAME_COMMON.has(w));
    const squashed = client.join('');
    // Tên chủ đầu tư viết tách ("Xin Hai" ↔ "XIN HAI VINA"): hai chữ riêng liền nhau xuất hiện nguyên cụm trong tin (bộ kiểm hồi quy 18/10).
    const pairs = client.slice(1).map((w, i) => `${client[i]} ${w}`).filter(pair => pair.length >= 6);
    return client.some(w => w.length >= 4 && have.has(w)) || pairs.some(pair => joined.includes(` ${pair} `))
      || (squashed.length >= 5 && tw.some(w => w.length >= 5 && !NAME_COMMON.has(w) && squashed.includes(w)));
  });
};
const projectLabel = (p: Record<string, unknown>) => [str(p.code, 40), str(p.name, 80)].filter(Boolean).join(' · ');
/** Ngày hôm nay giờ Việt Nam (YYYY-MM-DD). */
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function prepareMaterialRequest(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const lines = asArray(args.dong).map(asObject).map(l => {
    const qty = num(l.so_luong);
    return compact({ name: str(l.ten, 160), spec: str(l.quy_cach, 80), qty: qty != null && qty > 0 ? qty : null, unit: str(l.don_vi, 20), note: str(l.ghi_chu, 160) });
  }).filter(l => l.name).slice(0, 30);
  if (!lines.length) return JSON.stringify({ loi: 'Chưa có vật tư nào. Hỏi lại người dùng cần vật tư gì, bao nhiêu.' });
  const neededDate = str(args.ngay_can, 10);
  if (neededDate && (!ISO_DAY.test(neededDate) || neededDate < vnToday())) return JSON.stringify({ loi: 'Ngày cần chưa đúng (YYYY-MM-DD, không trước hôm nay). Hỏi lại người dùng.' });

  const list = await ctx.rpc('assistant_mr_projects_v1', {});
  if (list.error) return toolError(list.error, 'dự án');
  const projects = asArray(list.data).map(asObject).filter(p => str(p.id));
  if (!projects.length) return JSON.stringify({ loi: 'Người hỏi chưa được lập đề xuất vật tư ở dự án nào — nói rõ và gợi ý nhờ quản lý dự án cấp quyền.' });
  // Chủ SP 18/10: chưa nói dự án thì HỎI LẠI bằng gợi ý bấm (dự án đang xem đứng đầu), không tự ghép vào dự án đang xem.
  // Chỉ được lập đề xuất ở đúng một dự án thì dùng luôn (thẻ ghi rõ dự án).
  const asked = str(args.du_an, 80);
  const hits = asked ? matchProjects(asked, projects) : [];
  const project = hits.length === 1 ? hits[0] : !asked && projects.length === 1 ? projects[0] : null;
  if (!project) {
    const pool = hits.length > 1 ? hits : projects;
    const current = pool.find(p => p.id === ctx.projectId);
    const options = [...(current ? [current] : []), ...pool.filter(p => p !== current)].slice(0, 6);
    return JSON.stringify(compact({ loi: asked && !hits.length ? `Không thấy dự án "${asked}" trong các dự án người hỏi được lập đề xuất.` : 'Người dùng chưa nói đề xuất cho dự án nào.',
      can_hoi: 'Hỏi lại một câu: đề xuất cho dự án nào; mỗi dự án dưới đây là một gợi ý bấm, ghi đúng như danh sách. Chưa chuẩn bị gì.',
      cac_du_an: options.map(projectLabel), du_an_dang_xem: current ? projectLabel(current) : null }));
  }
  const purpose = str(args.muc_dich, 200);
  const first = String(lines[0].name);
  const raw = (str(args.ten_de_xuat, 120) || purpose || `Vật tư ${first}${lines.length > 1 ? ` và ${lines.length - 1} vật tư khác` : ''}`).slice(0, 120);
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const code = str(project.code, 40) || str(project.name, 40) || 'dự án';
  const payload = compact({ projectId: str(project.id, 80), projectCode: str(project.code, 40), projectName: str(project.name, 160), siteId: str(project.siteId, 80),
    title, purpose, neededDate, lines });
  const missingQty = lines.filter(l => l.qty == null).length;
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'material_request', p_title: `Đề xuất vật tư ${code}`,
    p_payload: payload, p_preview: compact({ lineCount: lines.length, missingQty: missingQty || null }) });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify(compact({
    da_hien_the: true, du_an: projectLabel(project), ten_de_xuat: title, so_dong: lines.length, dong_chua_co_so_luong: missingQty || null, ngay_can: neededDate,
    ghi_chu: 'Thẻ đề xuất nháp (form gọn) đã hiện ngay trong chat: người dùng chọn mã, kiểm số lượng, chọn người duyệt rồi tự bấm Gửi duyệt hoặc Lưu nháp trên thẻ. Không nói là đã gửi hay đã tạo phiếu.',
  }));
}

async function prepareOrder(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  // Đối chiếu thành tiền (T3, thử thật ảnh báo giá: model đọc "6.300 kg" thành 6,3): SL × giá lệch đúng 1.000 lần thì sửa SL, lệch khác thì cảnh báo.
  const checks: string[] = [];
  const lines = asArray(args.dong).map(asObject).map(l => {
    let qty = num(l.so_luong); const price = num(l.don_gia); const amount = num(l.thanh_tien);
    const name = str(l.ten, 160);
    if (qty != null && qty > 0 && price != null && price > 0 && amount != null && amount > 0) {
      const ratio = amount / (qty * price);
      if (Math.abs(ratio - 1000) < 10) { checks.push(`${name}: sửa SL ${qty} → ${qty * 1000} theo thành tiền`); qty *= 1000; }
      else if (Math.abs(amount - qty * price) > Math.max(1000, price * 0.5)) checks.push(`${name}: SL × đơn giá khác thành tiền trên báo giá — kiểm lại`);
    }
    // Thành tiền báo giá ghi đi theo thẻ (19/10): thẻ đối chiếu lại với SL × đơn giá người mua đang nhập và cảnh báo ngay trên dòng.
    return compact({ name, spec: str(l.quy_cach, 80), qty: qty != null && qty > 0 ? qty : null, unit: str(l.don_vi, 20), price: price != null && price >= 0 ? price : null,
      amount: amount != null && amount > 0 ? amount : null });
  }).filter(l => l.name).slice(0, 40);
  if (!lines.length) return JSON.stringify({ loi: 'Chưa có mặt hàng nào. Hỏi lại người dùng mua gì, bao nhiêu, giá bao nhiêu.' });
  const delivery = str(args.ngay_giao, 10);
  if (delivery && (!ISO_DAY.test(delivery) || delivery < vnToday())) return JSON.stringify({ loi: 'Ngày giao chưa đúng (YYYY-MM-DD, không trước hôm nay). Hỏi lại người dùng.' });
  const vat = num(args.vat);
  // Lập đơn chủ động là việc của phòng Mua hàng (quyền quản lý Mua hàng) — như màn Lập đơn chủ động.
  const options = await ctx.rpc('list_procurement_proactive_options_v1', {});
  if (options.error) return denied(options.error)
    ? JSON.stringify({ loi: 'Người hỏi chưa có quyền lập đơn mua (quản lý Mua hàng). Nói rõ: nhờ phòng Mua hàng lập, hoặc gửi đề xuất vật tư.' })
    : toolError(options.error, 'dự án');
  const projects = asArray(asObject(options.data).projects).map(asObject).filter(p => str(p.id));
  if (!projects.length) return JSON.stringify({ loi: 'Chưa có dự án nào để lập đơn mua.' });
  // Như đề xuất vật tư: chưa nói dự án thì hỏi lại bằng gợi ý bấm (dự án đang xem đứng đầu), không tự chọn.
  const asked = str(args.du_an, 80);
  const hits = asked ? matchProjects(asked, projects) : [];
  const project = hits.length === 1 ? hits[0] : !asked && projects.length === 1 ? projects[0] : null;
  if (!project) {
    const pool = hits.length > 1 ? hits : projects;
    const current = pool.find(p => p.id === ctx.projectId);
    const options6 = [...(current ? [current] : []), ...pool.filter(p => p !== current)].slice(0, 6);
    return JSON.stringify(compact({ loi: asked && !hits.length ? `Không thấy dự án "${asked}" trong các dự án lập đơn mua được.` : 'Người dùng chưa nói đơn mua cho dự án nào.',
      can_hoi: 'Hỏi lại một câu: đơn mua cho dự án nào; mỗi dự án dưới đây là một gợi ý bấm, ghi đúng như danh sách. Chưa chuẩn bị gì.',
      cac_du_an: options6.map(projectLabel), du_an_dang_xem: current ? projectLabel(current) : null }));
  }
  // NCC: khớp một thì chọn sẵn; nhiều thì đưa lên thẻ làm nút chọn (người dùng bấm, không phải gõ lại).
  const vendorQuery = str(args.ncc, 120);
  let vendor: Record<string, unknown> | null = null;
  let vendorOptions: Array<Record<string, unknown>> = [];
  if (vendorQuery) {
    const found = await ctx.rpc('list_procurement_vendors_v1', { p_search: vendorQuery });
    const vendors = found.error ? [] : asArray(found.data).map(asObject).filter(v => str(v.id));
    const q = fold(vendorQuery);
    const exact = vendors.filter(v => fold(v.name) === q || (str(v.taxCode) && fold(v.taxCode) === q));
    vendor = exact.length === 1 ? exact[0] : vendors.length === 1 ? vendors[0] : null;
    vendorOptions = vendor ? [] : vendors.slice(0, 5);
  }
  const warehouses = asArray(project.warehouses).map(asObject);
  const code = str(project.code, 40) || str(project.name, 40) || 'dự án';
  const vendorName = vendor ? str(vendor.name, 120) : null;
  const payload = compact({
    projectId: str(project.id, 80), projectCode: str(project.code, 40), projectName: str(project.name, 160),
    warehouseId: str(warehouses[0]?.id, 80), vendorId: vendor ? str(vendor.id, 80) : null, vendorName, vendorQuery,
    vendorOptions: vendorOptions.length ? vendorOptions.map(v => compact({ id: str(v.id, 80), name: str(v.name, 120), taxCode: str(v.taxCode, 20) })) : null,
    reasonCode: typeof args.ly_do === 'string' && ['price_lock', 'long_lead', 'min_stock', 'other'].includes(args.ly_do) ? args.ly_do : null,
    reason: str(args.ly_do_khac, 200), vat: vat != null && vat >= 0 && vat <= 100 ? vat : null, deliveryDate: delivery, note: str(args.ghi_chu, 300), lines,
  });
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'purchase_order',
    p_title: `Đơn mua ${vendorName || vendorQuery || ''} · ${code}`.replace(/\s+·/, ' ·').slice(0, 160), p_payload: payload,
    p_preview: compact({ lineCount: lines.length, missingPrice: lines.filter(l => l.price == null).length || null }) });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  // Tiền do công cụ tính (model hay cộng sai số lớn) — theo SL × đơn giá trên báo giá, thẻ tính lại theo mã đã chọn.
  const priced = lines.filter(l => l.qty != null && l.price != null);
  const subtotal = priced.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0);
  const vatRate = vat != null && vat >= 0 && vat <= 100 ? vat : null;
  const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
  return JSON.stringify(compact({
    tam_tinh: priced.length ? money(subtotal) : null, vat: vatRate != null ? `${vatRate}%` : null,
    tong: priced.length && vatRate != null ? money(subtotal * (1 + vatRate / 100)) : null,
    da_hien_the: true, du_an: projectLabel(project), ncc: vendorName || (vendorOptions.length ? `chưa chắc (${vendorOptions.length} NCC gần giống, người dùng bấm chọn trên thẻ)` : vendorQuery ? `không thấy "${vendorQuery}" — người dùng tìm NCC trên thẻ` : 'chưa có — người dùng chọn trên thẻ'),
    so_dong: lines.length, dong_chua_co_gia: lines.filter(l => l.price == null).length || null, doi_chieu: checks.length ? checks : null,
    ghi_chu: 'Thẻ đơn mua nháp (form gọn) đã hiện ngay trong chat: người dùng chọn mã, NCC, lý do mua chủ động, người duyệt rồi tự bấm Lưu nháp hoặc Gửi duyệt. Không nói là đã lập hay đã gửi đơn.',
  }));
}

async function prepareMemoryNote(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const text = (str(args.noi_dung, 400) || '').replace(/\s+/g, ' ');
  if (text.length < 3) return JSON.stringify({ loi: 'Chưa rõ cần nhớ gì. Hỏi lại người dùng một câu.' });
  if (text.length > 300) return JSON.stringify({ loi: 'Ghi nhớ quá dài (trên 300 ký tự). Viết gọn lại rồi gọi lại công cụ.' });
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'memory_note', p_title: 'Ghi nhớ', p_payload: { text }, p_preview: {} });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify({ da_hien_the: true, noi_dung: text,
    ghi_chu: 'Thẻ ghi nhớ đã hiện: người dùng sửa chữ nếu cần rồi tự bấm Lưu ghi nhớ. Chỉ nói 1 câu; không nói là đã nhớ. Xem / quên ở nút Trí nhớ.' });
}

async function prepareDailyLog(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  // Báo cáo trong ảnh (T3): model chép nguyên văn vào noi_dung; báo cáo dán chữ thì lấy nguyên văn tin (không bắt model chép lại).
  const typed = String(ctx.question || '').trim();
  const fromImage = typeof args.noi_dung === 'string' ? args.noi_dung.trim() : '';
  const text = typed.length >= 80 || !fromImage ? typed : fromImage.slice(0, 15000);
  if (text.length < 20) return JSON.stringify({ loi: 'Chưa thấy nội dung báo cáo. Nhờ người dùng dán tin báo cáo Zalo (có thể nhiều ngày) vào một tin.' });
  if (text.length > 15000) return JSON.stringify({ loi: 'Tin quá dài (trên 15.000 ký tự). Nhờ người dùng dán tối đa 7 ngày mỗi lần.' });
  const reportDate = str(args.ngay_bao_cao, 10) || vnToday();
  if (!ISO_DAY.test(reportDate) || reportDate > vnToday()) return JSON.stringify({ loi: 'Ngày báo cáo chưa đúng (YYYY-MM-DD, không sau hôm nay).' });
  const list = await ctx.rpc('assistant_daily_log_projects_v1', {});
  if (list.error) return toolError(list.error, 'dự án');
  const projects = asArray(list.data).map(asObject).filter(p => str(p.id));
  if (!projects.length) return JSON.stringify({ loi: 'Người hỏi chưa được ghi nhật ký ở dự án nào — nói rõ và gợi ý nhờ quản lý dự án cấp quyền Nhật ký.' });
  // Như đề xuất / đơn mua: chưa rõ dự án thì hỏi lại bằng gợi ý bấm (dự án đang xem đứng đầu); chỉ một dự án thì dùng luôn.
  // Dự án theo lời người dùng; không nói thì tìm mã / tên riêng của dự án ngay trong tin ("XinHai", "DA29") — đúng một thì dùng.
  const asked = str(args.du_an, 80);
  const hits = asked ? matchProjects(asked, projects) : projectsMentioned(text, projects);
  const project = hits.length === 1 ? hits[0] : !asked && projects.length === 1 ? projects[0] : null;
  if (!project) {
    const pool = hits.length > 1 ? hits : projects;
    const current = pool.find(p => p.id === ctx.projectId);
    const options = [...(current ? [current] : []), ...pool.filter(p => p !== current)].slice(0, 6);
    return JSON.stringify(compact({ loi: asked && !hits.length ? `Không thấy dự án "${asked}" trong các dự án ghi nhật ký được.` : 'Chưa rõ báo cáo của dự án nào.',
      can_hoi: 'Hỏi lại một câu: báo cáo của dự án nào; mỗi dự án dưới đây là một gợi ý bấm, ghi đúng như danh sách. Khi người dùng chọn, gọi lại công cụ với du_an (báo cáo đã dán vẫn dùng được). Chưa chuẩn bị gì.',
      cac_du_an: options.map(projectLabel), du_an_dang_xem: current ? projectLabel(current) : null }));
  }
  const code = str(project.code, 40) || str(project.name, 40) || 'dự án';
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'daily_log', p_title: `Nhật ký từ báo cáo Zalo · ${code}`,
    p_payload: compact({ projectId: str(project.id, 80), projectCode: str(project.code, 40), projectName: str(project.name, 160), siteId: str(project.siteId, 80), reportDate, text }),
    p_preview: { chars: text.length } });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify({ da_hien_the: true, du_an: projectLabel(project), ngay_bao_cao: reportDate,
    ghi_chu: 'Thẻ nhật ký đã hiện và đang tự đọc báo cáo (10–40 giây) bằng bộ của màn Nhật ký: tách ngày, mũi, dòng việc, hạng mục, tổ đội. Người dùng kiểm, sửa hạng mục rồi tự bấm Tạo phiếu nháp. Không tự tóm tắt hạng mục / tiến độ, không nói là đã ghi nhật ký.' });
}

async function prepareLeave(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const typesRes = await ctx.rpc('assistant_leave_types_v1', {});
  if (typesRes.error) return toolError(typesRes.error, 'loại nghỉ phép');
  const types = asArray(typesRes.data).map(asObject);
  const type = matchLeaveType(str(args.loai, 80) || '', types);
  if (!type) return JSON.stringify({ loi: 'Chưa rõ loại nghỉ.', can_hoi: 'Hỏi lại người dùng chọn một loại; mỗi loại dưới đây là một gợi ý bấm.',
    cac_loai: types.filter(t => t.unit !== 'minute').map(t => str(t.name)).filter(Boolean) });
  if (type.unit === 'minute') return JSON.stringify({ loi: `${str(type.name)} tính theo phút — người dùng mở màn Nghỉ phép để điền.` });
  const start = str(args.tu_ngay, 10);
  const end = str(args.den_ngay, 10) || start;
  if (!start || !end || !ISO_DAY.test(start) || !ISO_DAY.test(end) || end < start) return JSON.stringify({ loi: 'Ngày chưa đúng (YYYY-MM-DD, ngày kết thúc không trước ngày bắt đầu). Hỏi lại người dùng.' });
  const reason = str(args.ly_do, 300);
  if (!reason || reason.length < 3) return JSON.stringify({ loi: 'Thiếu lý do nghỉ. Hỏi lại người dùng.' });
  const startSession = SESSION[String(args.buoi_bat_dau)] || 'full';
  const endSession = SESSION[String(args.buoi_ket_thuc)] || (start === end ? startSession : 'full');
  const pv = await ctx.rpc('preview_my_leave_request', { p_type: type.code, p_start: start, p_end: end, p_start_session: startSession, p_end_session: endSession, p_minutes: null, p_subtype: null });
  if (pv.error) return JSON.stringify({ loi: pv.error.message || 'Chưa kiểm tra được đơn nghỉ.' });
  const d = asObject(pv.data);
  const steps = asArray(d.steps).map(asObject).map(st => compact({ buoc: str(st.label, 60), nguoi: str(st.name, 80) }));
  const problems = asArray(d.problems).map(p => str(p, 200)).filter((p): p is string => Boolean(p));
  const days = num(d.days);
  const payload = { type: type.code, typeName: str(type.name), start, end, startSession, endSession, reason, requiresAttachment: type.requiresAttachment === true };
  const preview = compact({ days, annualRemaining: num(d.annualRemaining), steps: steps.map(st => ({ label: st.buoc, name: st.nguoi })), problems });
  const when = start === end ? `${start.slice(8, 10)}/${start.slice(5, 7)}` : `${start.slice(8, 10)}/${start.slice(5, 7)}–${end.slice(8, 10)}/${end.slice(5, 7)}`;
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'leave_request', p_title: `Đơn ${String(type.name).toLowerCase()} ${when}`, p_payload: payload, p_preview: preview });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify(compact({
    da_hien_the: true, loai: str(type.name), tu: start, den: end, buoi_dau: SESSION_LABEL[startSession], buoi_cuoi: SESSION_LABEL[endSession], so_ngay: days,
    nguoi_duyet: steps, phep_nam_con: num(d.annualRemaining), van_de: problems,
    can_dinh_kem: type.requiresAttachment === true ? 'Loại này cần giấy tờ: người dùng mở màn Nghỉ phép để đính kèm.' : null,
    ghi_chu: 'Thẻ đơn nháp đã hiện cho người dùng; họ tự xem và bấm Gửi đơn. Không nói là đã gửi hay đã tạo.',
  }));
}

// ── số phép nhân viên (chủ SP 18/10 tối: Admin hỏi phép của nhân viên khác bị Trợ lý tự từ chối) ────────────────────────────
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
/** Năm phép theo lời model: số / chuỗi 4 số trong 2000–2100; thiếu hoặc hỏng → năm hiện tại (giờ Việt Nam). */
export const leaveYearOf = (raw: unknown, today = vnToday()) => {
  const n = num(raw);
  return n != null && Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX ? n : Number(today.slice(0, 4));
};
/** Số dư phép (hrm_leave_balance_json) → khóa tiếng Việt cho model; null = chưa có sổ phép năm đó (không ghi 0). */
export const leaveBalanceOf = (raw: unknown) => {
  const b = asObject(raw);
  if (!Object.keys(b).length) return null;
  return compact({
    duoc_huong: round(b.accruedDays), chuyen_tu_nam_truoc: round(b.carriedDays), phep_chuyen_het_han: round(b.carryExpiredDays),
    phep_chuyen_con_dung_duoc: round(b.carryLeft), han_dung_phep_chuyen: day(b.carryExpiresOn),
    da_nghi_co_luong: round(b.usedPaidDays), da_nghi_khong_luong: round(b.usedUnpaidDays),
    con_lai: round(b.availableDays), dang_cho_duyet: round(b.pendingDays),
  });
};
const LEDGER_KIND: Record<string, string> = { opening: 'mở sổ', accrual: 'cấp phép', leave: 'nghỉ phép', leave_cancel: 'hủy đơn, hoàn phép', carry_in: 'chuyển phép tồn sang', carry_expire: 'phép tồn hết hạn', adjust: 'HR điều chỉnh' };
const EMPLOYEE_GENERIC = new Set(['nhan', 'vien', 'anh', 'chi', 'em', 'ban', 'co', 'chu', 'bac', 'ong', 'ba', 'nv', 'ma']);
/**
 * Chọn nhân viên theo lời người dùng trong các hồ sơ tìm được: trùng mã → một người; trùng cả tên → những người đó;
 * còn lại giữ mọi hồ sơ có đủ các chữ hỏi (bỏ "nhân viên", "anh", "chị") trong mã + tên. Nhiều người → Trợ lý hỏi lại.
 */
export const matchEmployees = <T extends Record<string, unknown>>(text: string, records: T[]): T[] => {
  const q = fold(text);
  if (!q) return [];
  const byCode = records.filter(r => fold(r.code) === q);
  if (byCode.length === 1) return byCode;
  const byName = records.filter(r => fold(r.title) === q);
  if (byName.length) return byName;
  const wanted = words(q).filter(w => !EMPLOYEE_GENERIC.has(w));
  if (!wanted.length) return records;
  const hits = records.filter(r => { const have = new Set(words(`${r.code} ${r.title}`)); return wanted.every(w => have.has(w)); });
  return hits.length ? hits : records;
};
const employeeRow = (rec: Record<string, unknown>, ref: string) =>
  compact({ ref, ma_nv: str(rec.code, 40), ten: str(rec.title, 120), chuc_danh: str(String(rec.subtitle || '').split(' · ')[0], 80), trang_thai: str(rec.status, 40) });

type Picked = { record: Record<string, unknown> } | { reply: string };
/** Hồ sơ nhân viên của chính người hỏi: tài khoản → danh bạ (ưu tiên hồ sơ đang làm việc). Danh bạ bị chặn (42501) → nói rõ là ngoài quyền danh bạ. */
const ownEmployee = async (ctx: ToolContext): Promise<Picked> => {
  const me = await ctx.rpc('current_app_user_id', {});
  const userId = str(me.data, 80);
  const dir = userId ? await ctx.rpc('list_hrm_employee_directory', {}) : null;
  if (dir?.error) return { reply: toolError(dir.error, 'danh bạ nhân viên (để tìm hồ sơ của chính người hỏi)') };
  const mine = dir ? asArray(dir.data).map(asObject).filter(e => str(e.user_id) === userId) : [];
  const own = mine.find(e => e.status === 'Đang làm việc') || mine[0];
  if (!own) return { reply: JSON.stringify({ loi: 'Không thấy hồ sơ nhân viên gắn với tài khoản của người hỏi. Gợi ý: mở màn Nghỉ phép hoặc nhờ HR kiểm tra hồ sơ.' }) };
  return { record: { kind: 'employee', id: own.id, code: own.employee_code, title: own.full_name, subtitle: str(own.title, 80), status: own.status, extra: compact({ email: str(own.email, 120) }) } };
};
/** Một nhân viên theo lời người dùng: mã hN đã cấp, mã NV hoặc tên trong danh bạ người hỏi được xem; trùng tên → danh sách để hỏi lại bằng gợi ý bấm. */
const pickEmployee = async (ctx: ToolContext, asked: string, refBook: Map<string, Record<string, unknown>>, remember: (rec: Record<string, unknown>) => string, pending: string): Promise<Picked> => {
  const fromRef = byRef(ctx, refBook, asked, 'employee');
  if (fromRef) return { record: fromRef };
  const found = await searchRecords(ctx, asked, ['employee'], 8);
  if (found.error) return { reply: toolError(found.error, 'danh bạ nhân viên') };
  const hits = matchEmployees(asked, found.records);
  if (!hits.length) return { reply: JSON.stringify({ loi: `Không thấy nhân viên "${asked}" trong danh bạ người hỏi được xem. Hỏi lại tên đầy đủ hoặc mã nhân viên.` }) };
  if (hits.length > 1) return { reply: JSON.stringify({
    loi: `Có ${hits.length} nhân viên khớp "${asked}".`, can_hoi: `Hỏi lại một câu: là ai; mỗi người dưới đây là một gợi ý bấm ghi "Tên · mã NV". ${pending}`,
    cac_nhan_vien: hits.slice(0, 6).map(rec => employeeRow(rec, remember(rec))),
  }) };
  return { record: hits[0] };
};

const CONTRACT_TYPE: Record<string, string> = { probation: 'thử việc', fixed_term: 'có thời hạn', definite: 'có thời hạn', indefinite: 'không xác định thời hạn', seasonal: 'thời vụ' };
const EVENT_TYPE: Record<string, string> = { TIEP_NHAN: 'tiếp nhận', THU_VIEC: 'thử việc', CHINH_THUC: 'lên chính thức', DIEU_CHUYEN: 'điều chuyển', BO_NHIEM: 'bổ nhiệm', MIEN_NHIEM: 'miễn nhiệm',
  DIEU_CHINH_LUONG: 'điều chỉnh lương', KHEN_THUONG: 'khen thưởng', KY_LUAT: 'kỷ luật', TAM_HOAN: 'tạm hoãn hợp đồng', NGHI_VIEC: 'nghỉ việc' };
/** Mức xem máy chủ trả (hrm_employee_profile_access_level) → chữ cho model biết vì sao thiếu phần. */
const ACCESS_LABEL: Record<string, string> = { DIRECTORY: 'danh bạ', SELF: 'chính mình', MANAGER: 'quản lý trực tiếp', HR: 'HR', HR_MANAGE: 'HR' };

/**
 * chi_tiet_ho_so (19/10): hồ sơ CÔNG VIỆC của một nhân viên theo đúng mức xem máy chủ cấp cho người hỏi.
 * get_hrm_employee_overview chặn 42501 khi không có cả quyền danh bạ; hợp đồng chỉ gọi khi visibleSections cho phép (HR / chính mình).
 * Không gọi RPC liên hệ cá nhân, lương, thuế, ngân hàng: CCCD / STK / lương / SĐT cá nhân không bao giờ qua Trợ lý.
 */
async function employeeProfile(args: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>, remember: (rec: Record<string, unknown>) => string): Promise<string> {
  const asked = str(args.ma, 100);
  const picked = asked ? await pickEmployee(ctx, asked, refBook, remember, 'Chưa tra hồ sơ.') : await ownEmployee(ctx);
  if ('reply' in picked) return picked.reply;
  const record = picked.record;
  const who = str(record.title, 120) || 'người này';
  const ov = await ctx.rpc('get_hrm_employee_overview', { p_employee_id: record.id });
  if (ov.error) return JSON.stringify(denied(ov.error) ? outOfScope(`hồ sơ nhân sự của ${who}`) : notFound(ov.error) ? { loi: `Không thấy hồ sơ nhân sự của ${who} trong phạm vi người hỏi được xem.` } : { loi: 'Chưa đọc được hồ sơ nhân sự, thử lại sau.' });
  const o = asObject(ov.data);
  const sum = asObject(o.summary);
  const level = str(o.accessLevel, 20) || '';
  const sections = asArray(o.visibleSections).filter((s): s is string => typeof s === 'string');

  const work = await ctx.rpc('get_hrm_employee_work_organization', { p_employee_id: record.id });
  const w = work.error ? {} : asObject(work.data);
  const mgr = asObject(w.directManager);
  const contractsVisible = sections.includes('contracts_employment');
  const ce = contractsVisible ? await ctx.rpc('get_hrm_employee_contract_employment', { p_employee_id: record.id }) : null;
  const c = ce && !ce.error ? asObject(ce.data) : {};
  const contracts = asArray(c.contracts).map(asObject);
  const today = vnToday();
  const current = contracts.find(x => x.status === 'active' && String(x.effectiveFrom || '') <= today && (!x.effectiveTo || String(x.effectiveTo) >= today)) || contracts.find(x => x.status === 'active') || null;
  const events = asArray(c.employmentEvents).map(asObject);
  const notes = [
    !contractsVisible ? 'Hợp đồng và quá trình công tác chỉ hiện với HR hoặc chính người đó — được hỏi thì nói là ngoài phạm vi người hỏi được xem.' : null,
    'Lương, CCCD, số tài khoản, SĐT cá nhân không tra ở Trợ lý — chỉ sang màn Nhân sự nếu có quyền.',
  ].filter(Boolean);
  return JSON.stringify(compact({
    ref: remember(record), ho_ten: str(o.fullName, 120) || who, ma_nv: str(o.employeeCode, 40) || str(record.code, 40), chuc_danh: str(o.title, 100) || str(w.title, 100),
    vi_tri: str(asObject(w.position).name, 100) || str(sum.positionName, 100), phong_ban: str(asObject(w.orgUnit).name, 120) || str(sum.orgUnitName, 120),
    quan_ly_truc_tiep: str(mgr.employeeId, 80)
      ? compact({ ref: remember({ kind: 'employee', id: mgr.employeeId, code: mgr.employeeCode, title: mgr.fullName, subtitle: str(mgr.title, 80), extra: {} }),
        ten: str(mgr.fullName, 120), ma_nv: str(mgr.employeeCode, 40), chuc_danh: str(mgr.title, 100) })
      : work.error ? null : 'chưa gán trong sơ đồ tổ chức',
    ngay_vao: day(w.startDate ?? sum.startDate), ngay_chinh_thuc: day(w.officialDate ?? sum.officialDate), trang_thai: str(o.status, 40) || str(record.status, 40),
    email_cong_viec: str(asObject(record.extra).email, 120),
    hop_dong_hien_tai: current
      ? compact({ so: str(current.contractNumber, 60), loai: CONTRACT_TYPE[String(current.type)] || str(current.type, 30), hieu_luc_tu: day(current.effectiveFrom), han: day(current.effectiveTo) || 'không xác định thời hạn' })
      : ce && !ce.error ? 'chưa có hợp đồng đang hiệu lực' : null,
    so_hop_dong: contracts.length || null,
    qua_trinh_gan_nhat: events.slice(0, 5).map(e => compact({ ngay: day(e.eventDate), loai: EVENT_TYPE[String(e.eventTypeCode)] || str(e.eventTypeCode, 30), chuc_danh: str(e.titleSnapshot, 80), don_vi: str(e.orgUnitName, 80) })),
    muc_xem: ACCESS_LABEL[level] || str(level, 20),
    ghi_chu: notes.join(' '),
  }));
}

async function employeeLeave(args: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>, remember: (rec: Record<string, unknown>) => string): Promise<string> {
  const year = leaveYearOf(args.nam);
  // Toàn công ty: list_hrm_leave_balances tự chặn người không phải HR (42501).
  if (args.toan_cong_ty === true) {
    const all = await ctx.rpc('list_hrm_leave_balances', { p_year: year });
    if (all.error) return JSON.stringify(denied(all.error) ? { ...outOfScope('số phép toàn công ty'), goi_y: 'Có thể hỏi số phép của chính mình.' } : { loi: 'Chưa đọc được số phép toàn công ty, thử lại sau.' });
    const rows = asArray(all.data).map(asObject).filter(r => str(r.employeeId));
    const ranked = rows.map(r => ({ r, balance: leaveBalanceOf(r.balance) })).sort((a, b) => (num(b.balance?.con_lai) ?? -1) - (num(a.balance?.con_lai) ?? -1));
    const shown = ranked.slice(0, 30);
    return JSON.stringify(compact({
      nam: year, tong_nhan_vien: rows.length, chua_co_so_phep: ranked.filter(x => !x.balance).length || null,
      nhan_vien: shown.map(({ r, balance }) => compact({
        ref: remember({ kind: 'employee', id: r.employeeId, code: r.employeeCode, title: r.fullName, subtitle: r.orgUnitName, extra: {} }),
        ma_nv: str(r.employeeCode, 40), ten: str(r.fullName, 120), phong_ban: str(r.orgUnitName, 80), phep_nam: balance, ghi_chu: balance ? undefined : 'chưa có sổ phép năm này',
      })),
      con: rows.length > shown.length ? rows.length - shown.length : null,
      ghi_chu: 'Xếp theo số phép còn lại giảm dần. Chỉ nêu người được hỏi hoặc vài người đầu; đừng liệt kê cả danh sách khi không được hỏi.',
    }));
  }

  // Một người: chính mình (bỏ trống tên) hoặc theo mã hN / tên / mã NV trong danh bạ (quyền danh bạ của người hỏi).
  const asked = str(args.ten, 100);
  const picked = asked ? await pickEmployee(ctx, asked, refBook, remember, 'Chưa tra số phép.') : await ownEmployee(ctx);
  if ('reply' in picked) return picked.reply;
  const record = picked.record;

  const ledger = await ctx.rpc('get_hrm_leave_ledger', { p_employee_id: record.id, p_year: year });
  if (ledger.error) return JSON.stringify(denied(ledger.error) ? outOfScope(`số phép của ${str(record.title, 120) || 'người này'}`) : { loi: 'Chưa đọc được sổ phép, thử lại sau.' });
  const d = asObject(ledger.data);
  const balance = leaveBalanceOf(d.balance);
  const entries = asArray(d.entries).map(asObject);
  return JSON.stringify(compact({
    ref: remember(record), ten: str(record.title, 120), ma_nv: str(record.code, 40), chuc_danh: str(record.subtitle, 80), nam: year,
    phep_nam: balance,
    ghi_chu: balance ? undefined : `Chưa có sổ phép năm ${year} của người này (HR chưa cấp phép năm) — nói rõ là chưa có số, không ghi 0.`,
    so_lan_ghi_so: entries.length || null,
    ghi_so_gan_nhat: entries.slice(0, 5).map(e => compact({ ngay: day(e.createdAt), loai: LEDGER_KIND[String(e.kind)] || str(e.kind, 30), so_ngay: round(e.days),
      don: str(e.leaveCode, 40), nghi_tu: day(e.leaveStart), nghi_den: day(e.leaveEnd), con_sau_do: round(e.balanceAfter), ghi_chu: str(e.note, 120) })),
  }));
}

// ── biến động nhân sự → thẻ biểu đồ (chủ SP 19/10) ───────────────────────────────────────────────────────────────────────
const MONTH = /^(\d{4})-(\d{2})$/;
const monthIndex = (v: unknown) => { const m = MONTH.exec(String(v ?? '').trim()); return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };
const monthText = (i: number) => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
const lastDay = (i: number) => new Date(Date.UTC(Math.floor(i / 12), i % 12 + 1, 0)).toISOString().slice(0, 10);
const viDay = (iso: unknown) => { const t = day(iso); return t ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)}` : null; };

/** Khoảng tháng theo lời model: thiếu thì 6 tháng gần nhất; hỏng / đảo / quá 24 tháng → lỗi để model hỏi lại. */
export const headcountRange = (args: Record<string, unknown>, today = vnToday()) => {
  const now = monthIndex(today.slice(0, 7))!;
  const to = args.den_thang ? monthIndex(args.den_thang) : now;
  const from = args.tu_thang ? monthIndex(args.tu_thang) : to != null ? to - 5 : null;
  if (from == null || to == null) return { loi: 'Tháng chưa đúng (YYYY-MM). Hỏi lại người dùng khoảng thời gian.' };
  if (from > to) return { loi: 'Tháng bắt đầu sau tháng kết thúc. Hỏi lại người dùng.' };
  if (from > now) return { loi: 'Khoảng thời gian ở tương lai — chưa có số. Nói rõ với người dùng.' };
  if (to - from >= 24) return { loi: 'Tối đa 24 tháng mỗi lần. Hỏi lại người dùng khoảng ngắn hơn.' };
  return { from: `${monthText(from)}-01`, to: lastDay(to) };
};

/** Số máy chủ (get_hrm_headcount_trend_v1) → thẻ biểu đồ dùng chung (lib/assistantChart.ts) + số gọn cho model.
 *  Không biết ngày thì không ghi 0: chưa ai đã nghỉ có ngày nghỉ → cột nghỉ việc "chưa có số". */
export const headcountChart = (raw: unknown) => {
  const d = asObject(raw);
  const months = asArray(d.months).map(asObject).filter(m => MONTH.test(String(m.month)));
  if (!months.length) return null;
  const years = new Set(months.map(m => String(m.month).slice(0, 4)));
  const label = (m: string) => (years.size > 1 ? `T${Number(m.slice(5))}/${m.slice(2, 4)}` : `T${Number(m.slice(5))}`);
  const first = String(months[0].month); const last = String(months[months.length - 1].month);
  const span = first === last ? label(first) : `${label(first)}–${label(last)}`;
  const title = `Biến động nhân sự ${years.size > 1 ? span : `${span}/${first.slice(0, 4)}`}`;
  const noExit = num(d.resignedNoExitDate) ?? 0; const withExit = num(d.resignedWithExitDate) ?? 0; const noStart = num(d.activeNoStartDate) ?? 0;
  const leftKnown = !(noExit > 0 && withExit === 0);
  const hired = months.map(m => num(m.hired) ?? 0);
  const left = months.map(m => (leftKnown ? num(m.left) ?? 0 : null));
  const heads = months.map(m => num(m.headcount));
  const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const notes = [
    ...(noStart > 0 ? [`${noStart} người đang làm chưa có ngày vào làm — chưa tính vào tháng nào.`] : []),
    ...(noExit > 0 ? [leftKnown ? `${noExit} người đã nghỉ chưa có ngày nghỉ việc — số nghỉ việc có thể thiếu.` : `${noExit} người đã nghỉ chưa có ngày nghỉ việc — chưa có số nghỉ việc theo tháng.`] : []),
  ];
  const opening = num(d.opening); const closing = heads[heads.length - 1] ?? null;
  const chart = {
    v: 1, title,
    stats: [
      { label: 'Đầu kỳ', value: opening, hint: viDay(`${first}-01`) ? `trước ${viDay(`${first}-01`)}` : null },
      { label: 'Cuối kỳ', value: closing, hint: viDay(months[months.length - 1].endDate) },
      { label: 'Vào làm', value: sum(hired), hint: null },
      { label: 'Nghỉ việc', value: leftKnown ? sum(left) : null, hint: leftKnown ? null : 'chưa có ngày nghỉ' },
    ],
    labels: months.map(m => label(String(m.month))),
    panels: [
      { title: 'Số người cuối tháng', kind: 'line', unit: 'người', series: [{ label: 'Số người', values: heads }] },
      { title: 'Vào làm và nghỉ việc', kind: 'bar', unit: 'người', series: [{ label: 'Vào làm', values: hired }, { label: 'Nghỉ việc', values: left }] },
    ],
    notes,
    source: `Hồ sơ nhân sự · ngày vào làm, ngày nghỉ việc · đang làm việc hôm nay: ${num(d.activeNow) ?? '—'} người`,
    link: { route: '/hrm/employees', label: 'Hồ sơ nhân sự' },
  };
  const forModel = compact({
    khoang: `${first} → ${last}`, dau_ky: opening, cuoi_ky: closing, chenh_lech: opening != null && closing != null ? closing - opening : null,
    tong_vao_lam: sum(hired), tong_nghi_viec: leftKnown ? sum(left) : 'chưa có số (chưa ghi ngày nghỉ việc)',
    theo_thang: months.map((m, i) => compact({ thang: chart.labels[i], vao: hired[i], nghi: left[i] ?? undefined, cuoi_thang: heads[i] })),
    dang_lam_viec_hom_nay: num(d.activeNow), thieu_du_lieu: notes,
  });
  return { chart, forModel };
};

async function headcountTrend(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const range = headcountRange(args);
  if ('loi' in range) return JSON.stringify(range);
  const r = await ctx.rpc('get_hrm_headcount_trend_v1', { p_from: range.from, p_to: range.to });
  if (r.error) return toolError(r.error, 'số liệu nhân sự toàn công ty (cần quyền Xem tổ chức)');
  const built = headcountChart(r.data);
  if (!built) return JSON.stringify({ loi: 'Chưa có số tháng nào trong khoảng này.' });
  const ref = ctx.book.chart(built.chart);
  if (ref) ctx.emit?.({ type: 'chart', chart: { ref, type: 'chart', chart: built.chart } });
  return JSON.stringify({ ...built.forModel, da_hien_bieu_do: Boolean(ref),
    ghi_chu: 'Thẻ biểu đồ (số người cuối tháng; vào làm và nghỉ việc) đã hiện ngay trong chat. Trả lời 2–3 câu: tăng / giảm bao nhiêu người từ đầu kỳ đến cuối kỳ, tháng nổi bật, rồi nói rõ phần thiếu dữ liệu (thieu_du_lieu) nếu có. Dùng đúng số công cụ trả, không tự cộng, không liệt kê lại từng tháng, không vẽ bảng.' });
}

// ── các công cụ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function runTool(name: string, rawArgs: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>): Promise<string> {
  const args = asObject(rawArgs);
  const remember = (rec: Record<string, unknown>) => { const ref = ctx.book.record(recordForScreen(rec)); refBook.set(ref, rec); return ref; };

  if (name === 'tim_ho_so') {
    const text = str(args.tu_khoa, 100);
    if (!text) return JSON.stringify({ loi: 'Thiếu chữ cần tìm.' });
    const kinds = asArray(args.loai).filter((k): k is string => typeof k === 'string' && KINDS.includes(k));
    const found = await searchRecords(ctx, text, kinds.length ? kinds : null, 8);
    if (found.error) return toolError(found.error, 'hồ sơ');
    const rows = found.records.slice(0, 8).map(rec => compact({ ref: remember(rec), loai: KIND_LABEL[String(rec.kind)] || rec.kind, ma: str(rec.code),
      ten: str(rec.title, 160), mo_ta: str(rec.subtitle, 160), trang_thai: str(rec.status, 40), ngay: day(rec.date) }));
    if (rows.length) return JSON.stringify({ ket_qua: rows });
    const deniedLabels = found.denied.map(k => KIND_LABEL[k] || k);
    return JSON.stringify({ ket_qua: [], ghi_chu: deniedLabels.length
      ? `Không thấy hồ sơ nào khớp. Nguồn ngoài quyền xem của người hỏi: ${deniedLabels.join(', ')}. Nói rõ là ngoài phạm vi được xem, không khẳng định là không tồn tại.`
      : 'Không thấy hồ sơ nào khớp trong phạm vi người hỏi được xem (không có quyền xem loại hồ sơ đó thì cũng không thấy). Không khẳng định là không tồn tại.' });
  }

  if (name === 'ton_kho') {
    const text = str(args.vat_tu, 100);
    if (!text) return JSON.stringify({ loi: 'Thiếu tên vật tư.' });
    const found = await searchRecords(ctx, text, ['item'], 6);
    if (found.error) return toolError(found.error, 'danh mục vật tư');
    if (found.denied.includes('item')) return JSON.stringify(outOfScope('danh mục vật tư'));
    if (!found.records.length) return JSON.stringify({ ket_qua: [], ghi_chu: 'Không thấy vật tư khớp trong danh mục người hỏi được xem — người không có quyền xem kho / danh mục cũng không thấy gì. Nói rõ là không thấy trong phạm vi được xem, không khẳng định là không tồn tại.' });
    const items = found.records.slice(0, 6);
    const stock = await ctx.rpc('ai_stock_by_items_v1', { p_item_ids: items.map(i => i.id) });
    if (stock.error) return toolError(stock.error, 'tồn kho');
    const rows = asArray(stock.data).map(asObject);
    return JSON.stringify({ ket_qua: items.map(item => {
      const byWarehouse = rows.filter(r => r.itemId === item.id).map(r => compact({ kho: str(r.warehouseName), ton: round(r.qty), don_vi: str(r.unit) }));
      return compact({ ref: remember(item), ma: str(item.code), ten: str(item.title, 160), don_vi: str(asObject(item.extra).unit),
        tong_ton: round(byWarehouse.reduce((s, w) => s + (num(w.ton) || 0), 0)), theo_kho: byWarehouse,
        ghi_chu: byWarehouse.length ? undefined : 'Không còn tồn ở kho nào người hỏi được xem.' });
    }) });
  }

  if (name === 'chi_tiet_don_mua') {
    const ma = str(args.ma, 60);
    if (!ma) return JSON.stringify({ loi: 'Thiếu số PO.' });
    const hit = await resolveOne(ctx, ma, 'purchase_order', refBook);
    if (hit.error) return toolError(hit.error, 'đơn hàng');
    if (!hit.record) return JSON.stringify({ loi: `Không thấy đơn hàng ${ma} trong phạm vi người hỏi được xem.` });
    const po = await ctx.rpc('get_procurement_order_v1', { p_po_id: hit.record.id });
    if (po.error) return toolError(po.error, 'đơn hàng');
    const d = asObject(po.data);
    const pay = await ctx.rpc('get_procurement_po_payment_status_v1', { p_po_ids: [hit.record.id] });
    const payment = pay.error ? null : asObject(asObject(pay.data)[String(hit.record.id)]);
    const lines = asArray(d.lines).map(asObject);
    return JSON.stringify(compact({
      ref: remember(hit.record), so_po: str(d.poNumber), trang_thai: str(d.status, 40), giai_doan: str(d.stage, 40), ncc: str(d.vendorName),
      du_an: str(d.projectCode), kho_nhan: str(d.warehouseName), ngay_dat: day(d.orderDate), hen_giao: day(d.expectedDeliveryDate),
      tong_tien: num(d.totalAmount), tong_duyet: num(d.approvedTotalAmount), vat: num(d.vatRate), nguoi_lap: str(d.createdByName), cho_duyet: str(d.submittedToName),
      so_dot_giao: asArray(d.deliveries).length || null,
      dong: lines.slice(0, 30).map(l => compact({ ten: str(l.name, 160), ma: str(l.sku), don_vi: str(l.unit), dat: round(l.qty), da_nhan: round(l.receivedQty),
        con_phai_giao: round(l.remainingToDeliver), don_gia: num(l.unitPrice) })),
      con_dong: lines.length > 30 ? lines.length - 30 : null,
      thanh_toan: payment && Object.keys(payment).length ? compact({ tinh_trang: str(payment.status, 20), da_ghi_nhan: num(payment.recognized), da_tra: num(payment.paid),
        con_no: num(payment.outstanding), dang_de_nghi_chi: num(payment.inRequest), han_tiep: day(payment.nextDue), qua_han: payment.overdue === true ? true : null,
        tam_ung: num(payment.advance) })
        // Người công trường xem được PO của dự án nhưng tình hình thanh toán thuộc Tài chính / Mua hàng → nói rõ, không im lặng bỏ qua.
        : denied(pay.error) ? { loi: 'Ngoài phạm vi người hỏi được xem: tình hình thanh toán (quyền Tài chính / Mua hàng).' } : null,
    }));
  }

  if (name === 'chi_tiet_de_xuat') {
    const ma = str(args.ma, 60);
    if (!ma) return JSON.stringify({ loi: 'Thiếu mã đề xuất.' });
    const hit = await resolveOne(ctx, ma, 'material_request', refBook);
    if (hit.error) return toolError(hit.error, 'đề xuất vật tư');
    if (!hit.record) return JSON.stringify({ loi: `Không thấy đề xuất ${ma} trong phạm vi người hỏi được xem.` });
    const mr = await ctx.rpc('get_material_request_supply_v1', { p_request_id: hit.record.id });
    if (mr.error) return toolError(mr.error, 'đề xuất vật tư');
    const d = asObject(mr.data);
    const lines = asArray(d.lines).map(asObject);
    return JSON.stringify(compact({
      ref: remember(hit.record), ma: str(hit.record.code), ten: str(hit.record.title, 160), trang_thai: str(d.status, 40), giai_doan: str(d.phase, 40),
      dong: lines.slice(0, 30).map(l => compact({ ten: str(l.itemName, 160), ma: str(l.sku), don_vi: str(l.unit), can: round(l.needQty), da_dat: round(l.sourcedQty),
        da_nhan: round(l.receivedQty), da_dong: round(l.closedQty), tinh_trang: str(l.state, 20),
        po: asArray(l.orders).map(asObject).map(o => str(o.poNumber)).filter(Boolean) })),
      con_dong: lines.length > 30 ? lines.length - 30 : null,
    }));
  }

  if (name === 'viec_cua_toi') {
    const tab = args.nhom === 'toi_gui' ? 'sent' : args.nhom === 'theo_doi' ? 'watch' : 'mine';
    const r = await ctx.rpc('vcc_my_work_items_v1', { p_tab: tab });
    if (r.error) return toolError(r.error, 'việc của bạn');
    const filter = str(args.tu_khoa, 60)?.toLowerCase();
    const all = asArray(asObject(r.data).items).map(asObject).filter(i => typeof i.id === 'string');
    const items = filter ? all.filter(i => `${i.code} ${i.title}`.toLowerCase().includes(filter)) : all;
    return JSON.stringify(compact({ tong: items.length, viec: items.slice(0, 15).map(i => compact({ ref: ctx.book.work(i), ma: str(i.code), viec: str(i.title, 160),
      loai_viec: str(i.kind, 20), nguoi: str(i.who), ghi_chu: str(i.meta, 120), han: str(i.dueAt, 40), trang_thai: str(i.status, 40) })),
      con: items.length > 15 ? items.length - 15 : null }));
  }

  if (name === 'phep_nhan_vien') return employeeLeave(args, ctx, refBook, remember);
  if (name === 'chi_tiet_ho_so') return employeeProfile(args, ctx, refBook, remember);
  if (name === 'bien_dong_nhan_su') return headcountTrend(args, ctx);

  if (name === 'chuan_bi_don_nghi_phep') return prepareLeave(args, ctx);
  if (name === 'chuan_bi_de_xuat_vat_tu') return prepareMaterialRequest(args, ctx);
  if (name === 'chuan_bi_don_mua') return prepareOrder(args, ctx);
  if (name === 'chuan_bi_nhat_ky') return prepareDailyLog(args, ctx);
  if (name === 'chuan_bi_ghi_nho') return prepareMemoryNote(args, ctx);

  return JSON.stringify({ loi: `Không có công cụ ${name}.` });
}
