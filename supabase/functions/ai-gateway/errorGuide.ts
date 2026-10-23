// Từ điển lỗi (Đợt 1 hỗ trợ, chủ SP 23/10/2026): máy báo lỗi → nghĩa là gì, làm gì, ai xử lý — bằng lời người dùng hiểu.
// Nguồn: mã lỗi các hàm máy chủ đang chạy (raise exception …, rà 893 hàm 22/10), mã Postgres / PostgREST, mã HTTP, lỗi mạng / phiên,
// mã AI của cổng, và câu báo tiếng Việt màn hình hay hiện. Dùng ở: khối <du_lieu loai="man_hinh"> (lỗi gần đây trên máy người hỏi)
// và công cụ giai_thich_loi (người dùng dán / chụp câu báo lỗi). Luật cụ thể trước, luật theo họ mã sau. Không dùng API Deno.

export interface ErrorGuide {
  /** Khóa luật — để test và ghi chú. */
  id: string;
  /** Tên ngắn của tình huống. */
  title: string;
  /** Nghĩa là gì, một câu. */
  meaning: string;
  /** Làm gì, một–hai câu. */
  fix: string;
  /** Ai xử lý: "Bạn tự làm", "Admin", "Kế toán"… */
  who: string;
  /** Có thể do thiếu quyền → Trợ lý nên gọi quyen_cua_toi. */
  access?: boolean;
  /** Lỗi phần mềm thật → gợi ý lập phiếu sự cố nếu lặp lại. */
  bug?: boolean;
}
interface Rule extends ErrorGuide { test: RegExp }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const RULES: Rule[] = [
  // ── Mã cụ thể (đọc từ hàm máy chủ) ──────────────────────────────────────────────────────────────────────────────
  { id: 'finance_period_locked', test: /FINANCE_PERIOD_LOCKED|ky (tai chinh )?da khoa/i, title: 'Kỳ tài chính đã khóa',
    meaning: 'Ngày chứng từ rơi vào kỳ kế toán đã khóa sổ nên không ghi thêm / sửa được.', fix: 'Đổi ngày chứng từ sang kỳ đang mở, hoặc nhờ kế toán trưởng mở lại kỳ nếu thật sự cần ghi vào kỳ cũ.', who: 'Kế toán trưởng' },
  { id: 'payable_direct_write', test: /SUPPLIER_PAYABLE_DIRECT_WRITE/i, title: 'Không sửa thẳng công nợ',
    meaning: 'Công nợ NCC chỉ thay đổi qua chứng từ (nhận hàng, đối soát, hóa đơn, điều chỉnh, thanh toán) — không ai sửa thẳng số nợ.', fix: 'Ghi chứng từ điều chỉnh công nợ có lý do ở Tài chính → Phải trả.', who: 'Kế toán công nợ' },
  { id: 'stock_reconcile', test: /WMS_STOCK_(NEGATIVE_)?RECONCILIATION_REQUIRED|WMS_STOCK_CACHE_MISSING/i, title: 'Tồn kho cần đối chiếu',
    meaning: 'Số tồn của vật tư ở kho này đang lệch giữa sổ kho và số tồn hiển thị (hoặc bị âm) nên máy tạm chặn nhập / xuất.', fix: 'Báo thủ kho / Admin kiểm kê hoặc lập phiếu điều chỉnh cho vật tư đó rồi làm lại.', who: 'Thủ kho / Admin', bug: true },
  { id: 'stock_stale', test: /WMS_INVENTORY_STALE_QUANTITY/i, title: 'Tồn kho vừa thay đổi',
    meaning: 'Trong lúc bạn thao tác, tồn của vật tư này vừa được phiếu khác thay đổi.', fix: 'Tải lại màn để thấy số tồn mới rồi làm lại.', who: 'Bạn tự làm' },
  { id: 'stock_insufficient', test: /WMS_TRANSFER_STOCK_INSUFFICIENT|INSUFFICIENT_STOCK|khong du ton|vuot (so )?ton|ton kho khong du/i, title: 'Không đủ tồn kho',
    meaning: 'Số xuất / chuyển lớn hơn số đang có trong kho nguồn.', fix: 'Giảm số lượng, chọn kho khác còn hàng, hoặc nhập kho trước rồi xuất.', who: 'Bạn tự làm / thủ kho' },
  { id: 'link_over_po', test: /LINK_OVER_PO|vuot (phan )?(con )?(chua giao|con lai)|nhan vuot/i, title: 'Vượt số còn phải giao của đơn',
    meaning: 'Số nhận / gắn vào đơn lớn hơn phần đơn hàng còn chưa giao.', fix: 'Kiểm lại số trên phiếu giao; hàng giao dư thì ghi nhận dư hoặc báo Mua hàng tăng số trên đơn trước.', who: 'Thủ kho / Mua hàng' },
  { id: 'request_has_orders', test: /REQUEST_PURCHASE_HAS_ORDERS/i, title: 'Đề xuất đã có đơn mua',
    meaning: 'Đề xuất đã được đặt mua (có PO còn hiệu lực) nên không sửa / hủy nội dung được nữa.', fix: 'Liên hệ người mua để điều chỉnh trên đơn, hoặc lập đề xuất bổ sung cho phần mới.', who: 'Mua hàng' },
  { id: 'request_locked', test: /REQUEST_PURCHASE_LOCKED/i, title: 'Phiếu mua đã khóa theo đơn',
    meaning: 'Phiếu đã gắn với dòng đơn mua nên không đổi vật tư, số lượng, kho nhận được.', fix: 'Điều chỉnh trên đơn mua hoặc lập phiếu mới.', who: 'Mua hàng' },
  { id: 'source_withdrawn', test: /PROCUREMENT_SOURCE_WITHDRAWN/i, title: 'Đề xuất đã bị rút lại',
    meaning: 'Người đề xuất đã rút lại phiếu nên không lập đơn từ phiếu này được.', fix: 'Tải lại hộp thư Mua hàng; hỏi người đề xuất nếu vẫn cần mua.', who: 'Người đề xuất' },
  { id: 'source_review', test: /PROCUREMENT_SOURCE_REVIEW_REQUIRED|PROCUREMENT_SOURCE_NOT_FOUND/i, title: 'Nguồn đề xuất chưa sẵn sàng',
    meaning: 'Phiếu nguồn (đề xuất / quy trình) chưa được duyệt xong, đã đổi, hoặc không còn trong hộp thư Mua hàng.', fix: 'Tải lại hộp thư; phiếu chưa duyệt xong thì chờ duyệt rồi lập đơn.', who: 'Bạn tự làm' },
  { id: 'close_reason', test: /PROCUREMENT_CLOSE_REASON_REQUIRED|REASON_REQUIRED/i, title: 'Thiếu lý do',
    meaning: 'Thao tác này (đóng nhu cầu, chốt thiếu, hủy, đảo, điều chỉnh…) bắt buộc ghi lý do.', fix: 'Nhập lý do vào ô lý do rồi bấm lại.', who: 'Bạn tự làm' },
  { id: 'proactive_project', test: /PROCUREMENT_PROACTIVE_PROJECT_REQUIRED/i, title: 'Đơn chủ động thiếu dự án',
    meaning: 'Đơn mua chủ động phải chọn dự án / công trường để tính chi phí.', fix: 'Chọn dự án trên đơn rồi lưu lại.', who: 'Bạn tự làm' },
  { id: 'po_warehouse', test: /PROCUREMENT_PO_WAREHOUSE_INVALID/i, title: 'Kho nhận không hợp lệ',
    meaning: 'Kho nhận hàng trên đơn không còn dùng được hoặc không thuộc dự án của đơn.', fix: 'Chọn lại kho nhận trên đơn.', who: 'Bạn tự làm' },
  { id: 'po_schedule_posted', test: /PURCHASE_ORDER_POSTED_SCHEDULE_IMMUTABLE/i, title: 'Đợt giao đã nhận hàng',
    meaning: 'Đợt giao đã có hàng nhận / trả nên không sửa lịch giao đó được.', fix: 'Thêm đợt giao mới cho phần còn lại thay vì sửa đợt cũ.', who: 'Mua hàng' },
  { id: 'quality_approval', test: /FULFILLMENT_TRANSACTION_REQUIRES_QUALITY_APPROVAL/i, title: 'Phiếu nhập chưa duyệt chất lượng',
    meaning: 'Phiếu nhập còn ở trạng thái chờ, phải kiểm / duyệt chất lượng trước khi nhận vào kho.', fix: 'Mở phiếu nhập, kiểm hàng rồi bấm duyệt / nhận theo đúng bước.', who: 'Thủ kho' },
  { id: 'asset_whole', test: /REQUEST_ASSET_WHOLE_UNITS/i, title: 'Tài sản phải nhận số nguyên',
    meaning: 'Hàng là tài sản nên số nhận phải là số nguyên (cái, chiếc), không có phần lẻ.', fix: 'Sửa số nhận thành số nguyên.', who: 'Bạn tự làm' },
  { id: 'settlement_exceeded', test: /SUPPLIER_PAYABLE_SETTLEMENT_EXCEEDED|SUPPLIER_PAYMENT_AP_CREDIT_EXCEEDED|OVER_ALLOCATED|ALLOCATION_TOTAL_INVALID/i, title: 'Vượt số còn nợ',
    meaning: 'Số thanh toán / phân bổ lớn hơn số công nợ còn lại của chứng từ.', fix: 'Giảm số tiền về đúng số còn nợ; kiểm xem khoản này đã được trả ở đề nghị chi khác chưa.', who: 'Kế toán' },
  { id: 'invoice_total', test: /SUPPLIER_INVOICE_(RECEIPT_)?TOTAL_MISMATCH/i, title: 'Tổng hóa đơn không khớp',
    meaning: 'Tổng tiền hóa đơn khác tổng các dòng / số hàng đã nhận được gắn vào.', fix: 'Kiểm lại tiền hàng, VAT và các dòng nhận hàng đã chọn.', who: 'Kế toán' },
  { id: 'wms_count_closed', test: /WMS_COUNT_NOT_OPEN/i, title: 'Phiếu kiểm kê đã đóng',
    meaning: 'Đợt kiểm kê đã chốt nên không nhập thêm số đếm.', fix: 'Mở đợt kiểm kê mới nếu cần đếm lại.', who: 'Thủ kho' },
  { id: 'transfer_state', test: /WMS_TRANSFER_NOT_(IN_TRANSIT|PENDING)/i, title: 'Phiếu chuyển kho đã đổi trạng thái',
    meaning: 'Phiếu chuyển kho không còn ở bước này (đã nhận, đã hủy hoặc chưa xuất đi).', fix: 'Tải lại phiếu để xem trạng thái hiện tại.', who: 'Bạn tự làm' },
  { id: 'gantt_stale', test: /GANTT_STALE_VERSION|SCHEDULE_STALE_VERSION/i, title: 'Tiến độ vừa được người khác sửa',
    meaning: 'Kế hoạch / tiến độ vừa được người khác cập nhật trong lúc bạn sửa.', fix: 'Tải lại để xem bản mới rồi sửa lại phần của bạn.', who: 'Bạn tự làm' },

  // ── Họ mã của hàm máy chủ ─────────────────────────────────────────────────────────────────────────────────────────
  { id: 'denied', test: /\b[A-Z_]+_(DENIED|FORBIDDEN)\b|SCOPE_FORBIDDEN|PERMISSION_DENIED|permission denied|insufficient[_ ]privilege|\b42501\b|AI_DENIED|khong (co |du )?quyen|chua (duoc )?cap quyen|ngoai pham vi/i,
    title: 'Thiếu quyền', meaning: 'Tài khoản của bạn chưa có quyền làm thao tác này (hoặc chứng từ ngoài dự án / kho bạn được phân).',
    fix: 'Xem bạn đang có quyền gì; nhờ Admin cấp đúng quyền, hoặc nhờ người phụ trách dự án / kho thêm bạn vào.', who: 'Admin', access: true },
  { id: 'stale', test: /\b[A-Z_]+_(STALE_VERSION|VERSION_CONFLICT|SCOPE_CHANGED|STATE_CHANGED|TRANSACTION_CHANGED|SCOPE_OR_STATE_CHANGED)\b|REQUEST_PURCHASE_CHANGED|\bPT409\b|nguoi khac (vua )?(sua|cap nhat)|vua duoc (nguoi khac )?cap nhat|da thay doi o noi khac|ho so da thay doi/i,
    title: 'Người khác vừa sửa', meaning: 'Chứng từ vừa được người khác (hoặc chính bạn ở tab khác) cập nhật trong lúc bạn đang sửa, nên máy không ghi đè.',
    fix: 'Tải lại màn để thấy bản mới rồi làm lại; phần đang nhập ở form đơn mua / đề xuất thường vẫn được giữ.', who: 'Bạn tự làm' },
  { id: 'duplicate', test: /\b[A-Z_]+_(IDEMPOTENCY_CONFLICT|REPLAY_CONFLICT|ALREADY_EXISTS|DUPLICATE[A-Z_]*)\b|\b23505\b|duplicate key|da ton tai|bi trung/i,
    title: 'Đã có rồi / bấm hai lần', meaning: 'Thao tác này đã được ghi trước đó (bấm hai lần, mạng chập chờn gửi lại) hoặc trùng mã / trùng dòng đã có.',
    fix: 'Tải lại và kiểm xem chứng từ đã được tạo chưa trước khi làm lại; trùng mã thì đổi mã.', who: 'Bạn tự làm' },
  { id: 'not_found', test: /\b[A-Z_]+_NOT_FOUND\b|\bPGRST116\b|khong tim thay|da bi xoa|khong ton tai/i,
    title: 'Không tìm thấy', meaning: 'Chứng từ không còn (đã xóa / hủy) hoặc nằm ngoài phạm vi bạn được xem.',
    fix: 'Tải lại danh sách; vẫn cần xem thì hỏi người tạo hoặc Admin về quyền xem.', who: 'Bạn tự làm / Admin', access: true },
  { id: 'over', test: /\b[A-Z_]+_(EXCEEDED|OVER[A-Z_]*)\b/i, title: 'Vượt giới hạn',
    meaning: 'Số nhập lớn hơn số còn lại cho phép (còn phải giao, còn nợ, còn tồn…).', fix: 'Giảm số về trong giới hạn, kiểm số còn lại hiển thị trên màn.', who: 'Bạn tự làm' },
  { id: 'locked_state', test: /\b[A-Z_]+_(LOCKED|IMMUTABLE|NOT_DRAFT|NOT_PENDING|NOT_OPEN|NOT_RECEIVABLE|NOT_COMPLETED|POSTED_REQUIRED)\b|da (duoc )?(duyet|khoa|ghi so|chot)|khong (the )?sua (duoc )?(nua)?/i,
    title: 'Trạng thái không cho sửa', meaning: 'Chứng từ đã qua bước này (đã duyệt, đã ghi sổ, đã chốt / khóa) nên không sửa / làm lại bước đó được.',
    fix: 'Muốn đổi thì dùng đường sửa đúng chuẩn: trả lại / hủy / chứng từ điều chỉnh có lý do, tùy màn; không chắc thì hỏi người duyệt.', who: 'Người duyệt / bộ phận phụ trách' },
  { id: 'invalid', test: /\b[A-Z_]+_(REQUIRED|INVALID|MISMATCH|UNSUPPORTED)\b|\b(23502|23514|22P02|22003|22001|22007|22008)\b|AI_BAD_INPUT|invalid input|violates (not-null|check)|vui long (nhap|chon)|bat buoc|khong hop le|thieu (thong tin|du lieu)/i,
    title: 'Thiếu hoặc sai dữ liệu', meaning: 'Có ô bắt buộc còn trống, số / ngày sai dạng, hoặc dữ liệu không khớp nhau (đơn vị, mã, dự án…).',
    fix: 'Đọc dòng báo đỏ trên form, điền đủ ô bắt buộc, số dùng dấu phẩy cho phần lẻ, rồi lưu lại.', who: 'Bạn tự làm' },
  { id: 'fk', test: /\b23503\b|foreign key|dang duoc (su )?dung/i, title: 'Đang được dùng ở chỗ khác',
    meaning: 'Mục này đang được chứng từ khác dùng nên không xóa / đổi được.', fix: 'Gỡ hoặc hủy chứng từ đang dùng trước, hoặc ngừng dùng mục này thay vì xóa.', who: 'Bạn tự làm / Admin' },

  // ── Phiên, mạng, máy chủ, tệp, AI ──────────────────────────────────────────────────────────────────────────────
  { id: 'session', test: /AUTHENTICATION_REQUIRED|Active application account required|JWT expired|invalid jwt|PGRST30[0-3]|\b401\b|het phien|dang nhap lai|phien (dang nhap )?(da )?het/i,
    title: 'Hết phiên đăng nhập', meaning: 'Phiên đăng nhập đã hết hạn, tài khoản bị khóa / chưa kích hoạt, hoặc vừa đăng xuất ở thiết bị khác.',
    fix: 'Tải lại trang và đăng nhập lại; vẫn không vào được thì báo Admin kiểm trạng thái tài khoản.', who: 'Bạn tự làm / Admin' },
  { id: 'network', test: /Failed to fetch|Load failed|NetworkError|network request failed|ERR_INTERNET|mat (ket noi|mang)|khong co (ket noi|mang)|offline/i,
    title: 'Mất kết nối mạng', meaning: 'Máy không gọi được tới máy chủ (mạng yếu / đổi wifi / 4G chập chờn).',
    fix: 'Kiểm mạng rồi bấm lại; thao tác chưa ghi thì làm lại sau khi có mạng, đừng bấm liên tục nhiều lần.', who: 'Bạn tự làm' },
  { id: 'timeout', test: /\b57014\b|statement timeout|canceling statement|AI_TIMEOUT|timed out|timeout|\b504\b|het gio|qua thoi gian/i,
    title: 'Hết giờ chờ', meaning: 'Máy chủ xử lý quá lâu (dữ liệu lớn hoặc đang bận) nên dừng giữa chừng.',
    fix: 'Chờ một lát rồi thử lại; dữ liệu lớn (nhiều dòng, khoảng ngày dài) thì chia nhỏ. Lặp lại nhiều lần thì gửi phiếu sự cố.', who: 'Bạn tự làm / Admin', bug: true },
  { id: 'too_large', test: /\b413\b|payload too large|too large|exceeded the maximum allowed size|maximum allowed size|qua (lon|nang)|vuot dung luong/i,
    title: 'Tệp quá lớn', meaning: 'Tệp / ảnh vượt dung lượng cho phép tải lên.', fix: 'Chụp lại ảnh nhỏ hơn, nén PDF, hoặc chia thành nhiều tệp.', who: 'Bạn tự làm' },
  { id: 'rate', test: /\b429\b|rate limit|too many requests|AI_QUOTA|het luot|qua nhieu (lan|luot)/i, title: 'Quá nhiều lượt',
    meaning: 'Bạn (hoặc cả hệ thống) vừa gửi quá nhiều yêu cầu trong thời gian ngắn, hoặc đã hết lượt AI trong ngày.', fix: 'Chờ vài phút rồi thử lại; hết lượt AI trong ngày thì hỏi Admin tăng mức.', who: 'Bạn tự làm / Admin' },
  { id: 'ai_down', test: /AI_UNREACHABLE|AI_HTTP_\d+|AI_NOT_CONFIGURED|AI_FAILED/i, title: 'Máy chủ AI lỗi',
    meaning: 'Dịch vụ AI không trả lời hoặc chưa được cấu hình.', fix: 'Bấm Đọc lại / hỏi lại sau ít phút; vẫn lỗi thì nhập tay và báo Admin kiểm Cài đặt → Kết nối.', who: 'Admin', bug: true },
  { id: 'server', test: /\b(500|502|503|546)\b|non-2xx|internal server error|bad gateway|service unavailable|WORKER_LIMIT|loi may chu/i,
    title: 'Máy chủ lỗi', meaning: 'Máy chủ gặp lỗi khi xử lý (không phải do bạn nhập sai).', fix: 'Thử lại một lần; vẫn lỗi thì gửi phiếu sự cố kèm ảnh màn hình để Admin sửa.', who: 'Admin', bug: true },
  { id: 'function_missing', test: /PGRST202|Could not find the function|function .* does not exist/i, title: 'Ứng dụng cần tải lại',
    meaning: 'Bản ứng dụng trên máy cũ hơn máy chủ (vừa có bản cập nhật).', fix: 'Tải lại trang (hoặc tắt hẳn app rồi mở lại); vẫn lỗi thì báo Admin.', who: 'Bạn tự làm / Admin', bug: true },
  { id: 'conflict_http', test: /\b409\b/, title: 'Xung đột dữ liệu',
    meaning: 'Dữ liệu vừa thay đổi hoặc trùng với dữ liệu đã có.', fix: 'Tải lại màn rồi làm lại.', who: 'Bạn tự làm' },
  { id: 'forbidden_http', test: /\b403\b/, title: 'Bị từ chối', meaning: 'Máy chủ từ chối thao tác vì quyền.', fix: 'Xem quyền của bạn và nhờ Admin cấp nếu cần.', who: 'Admin', access: true },
  { id: 'not_found_http', test: /\b404\b/, title: 'Không tìm thấy', meaning: 'Màn / chứng từ / tệp không còn tồn tại hoặc đường dẫn cũ.', fix: 'Tải lại danh sách và mở lại từ menu.', who: 'Bạn tự làm' },
  { id: 'bad_request_http', test: /\b400\b/, title: 'Dữ liệu gửi lên không hợp lệ', meaning: 'Máy chủ không nhận dữ liệu vừa gửi (thiếu / sai ô).', fix: 'Kiểm lại các ô trên form rồi lưu lại; lặp lại thì gửi phiếu sự cố.', who: 'Bạn tự làm', bug: true },
  { id: 'js', test: /is not a function|cannot read propert|undefined is not|null is not an object|ChunkLoadError|Loading chunk|dynamically imported module/i,
    title: 'Lỗi hiển thị trên máy', meaning: 'Màn hình gặp lỗi khi chạy (thường sau khi có bản cập nhật, hoặc lỗi phần mềm).', fix: 'Tải lại trang; vẫn lỗi thì gửi phiếu sự cố kèm ảnh.', who: 'Admin', bug: true },
];

/** Mã kiểu UPPER_SNAKE hoặc SQLSTATE / mã HTTP thấy trong chữ — để hiện lại cho người dùng. */
const codeOf = (text: string): string | null => {
  const m = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,})\b/.exec(text) || /\b(PT409|PGRST\d{3}|[0-9]{2}[0-9A-Z]{3})\b/.exec(text) || /→ (\d{3})\b/.exec(text);
  return m ? m[1] : null;
};

/** Giải thích một câu báo lỗi: tối đa `limit` luật khớp (cụ thể trước). Không khớp → []. */
export const explainError = (text: string, limit = 1): Array<ErrorGuide & { code: string | null }> => {
  const raw = String(text || '').slice(0, 600);
  if (!raw.trim()) return [];
  const folded = fold(raw);
  const out: Array<ErrorGuide & { code: string | null }> = [];
  for (const rule of RULES) {
    if (!(rule.test.test(raw) || rule.test.test(folded))) continue;
    const { test: _t, ...guide } = rule;
    out.push({ ...guide, code: codeOf(raw) });
    if (out.length >= limit) break;
  }
  return out;
};

export const errorRuleIds = () => RULES.map(r => r.id);
