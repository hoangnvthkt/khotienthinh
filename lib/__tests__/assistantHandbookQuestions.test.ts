// Câu hỏi kiểm tìm mục sổ tay (Đợt 1 hỗ trợ, chủ SP 23/10/2026): câu viết theo cách người dùng thật hỏi, KHÁC câu mẫu trong frontmatter
// `questions:` của mục (để đo đúng, không học vẹt). Mỗi câu → id mục đúng (hoặc vài id cùng đúng). Đạt khi mục đúng nằm trong 3 mục Trợ lý nhận.
// Thêm mục sổ tay mới → thêm 1–2 câu ở đây. Số đo in ra khi chạy: top-1 / top-3.
import { describe, expect, it } from 'vitest';
import { searchHandbook } from '../../supabase/functions/ai-gateway/handbook';
import { HANDBOOK } from '../../supabase/functions/ai-gateway/handbook.generated';

type Case = [question: string, expected: string | string[]];
const id = (file: string) => `so-tay-${file}`;

export const QUESTION_BANK: Case[] = [
  // Nhân sự
  ['hôm nay em ở công trường mà máy báo cách xa quá không chấm được', id('nhan-su-cham-cong-ngoai-vung')],
  ['iphone không hiện xin quyền camera khi chấm công', id('nhan-su-quyen-vi-tri-camera')],
  ['đổi điện thoại mới thì chấm công thế nào', id('nhan-su-dang-ky-dien-thoai-cham-cong')],
  ['tháng này em đi làm được bao nhiêu công', [id('bang-cong-phieu-luong'), id('nhan-su-lich-cong-cua-toi')]],
  ['quên bấm ra ca hôm qua', id('cham-cong-bu')],
  ['em còn mấy ngày phép năm', id('nhan-su-so-phep-con-lai')],
  ['gửi nhầm đơn nghỉ rồi muốn rút lại', id('nhan-su-huy-don-nghi-phep')],
  ['đơn nghỉ của em ai đang duyệt vậy', id('nhan-su-don-nghi-cho-ai-duyet')],
  ['trưởng phòng duyệt đơn nghỉ cho nhân viên ở đâu', id('nhan-su-duyet-don-nghi')],
  ['sáng mai em đến muộn 1 tiếng xin phép kiểu gì', id('nhan-su-di-muon-ve-som')],
  ['làm thêm giờ chủ nhật thì ghi nhận thế nào', id('nhan-su-xac-nhan-lam-them-gio')],
  ['đi công tác hải phòng 3 ngày thì chấm công sao', id('nhan-su-cong-tac')],
  ['xem phiếu lương tháng 9', id('nhan-su-phieu-luong')],
  ['đổi ảnh đại diện', id('nhan-su-sua-thong-tin-ca-nhan')],
  ['đổi số tài khoản nhận lương', id('nhan-su-de-nghi-cap-nhat-ho-so')],
  ['hợp đồng lao động của em hết hạn khi nào', id('nhan-su-xem-hop-dong-lao-dong')],
  ['sếp trực tiếp của em là ai', id('nhan-su-quan-ly-truc-tiep')],
  ['xin số điện thoại anh Đô phòng kỹ thuật', id('nhan-su-tra-cuu-dong-nghiep')],
  ['HR thêm nhân viên mới vào hệ thống', id('nhan-su-them-nhan-vien-moi')],
  ['nhập danh sách nhân sự từ file excel', id('nhan-su-bang-nhan-su-nhap-excel')],
  ['nhân viên nghỉ việc thì cập nhật thế nào', id('nhan-su-cho-nghi-viec')],
  ['chuyển anh Tuấn sang công trường DA29', id('nhan-su-dieu-dong-cong-truong')],
  ['chốt bảng công tháng 10', id('nhan-su-chot-cong-thang')],
  ['duyệt đơn chấm công bù cho anh em công trường', id('nhan-su-duyet-de-xuat-cham-cong')],
  ['HR duyệt máy chấm công cho nhân viên', id('nhan-su-duyet-dien-thoai-cham-cong')],
  ['cách chấm công vào ca buổi sáng', id('cham-cong')],
  ['xin nghỉ ốm 2 ngày', id('nghi-phep')],
  ['xem lại giờ check in tuần trước', id('nhan-su-lich-cong-cua-toi')],
  // Tài chính, Hợp đồng
  ['NCC Hòa Phát mình đang nợ bao nhiêu', id('tai-chinh-xem-cong-no-ncc')],
  ['tại sao nợ nhà cung cấp lại ít hơn giá trị PO', id('tai-chinh-cong-no-khac-tong-don')],
  ['lập đề nghị thanh toán cho nhà cung cấp', id('de-nghi-chi')],
  ['đề nghị chi của em đã được duyệt chưa', id('tai-chinh-de-nghi-chi-dang-o-dau')],
  ['duyệt đề nghị thanh toán', id('tai-chinh-duyet-de-nghi-chi')],
  ['hủy đề nghị chi đã gửi', id('tai-chinh-sua-huy-dao-de-nghi-chi')],
  ['kế toán xác nhận đã chuyển khoản cho NCC', id('tai-chinh-xac-nhan-da-chi')],
  ['tạm ứng trước cho nhà cung cấp', id('tai-chinh-tam-ung-ncc')],
  ['NCC trả lại tiền tạm ứng', id('tai-chinh-hoan-tam-ung-ncc')],
  ['nhập hóa đơn điện tử của nhà cung cấp', id('tai-chinh-ghi-hoa-don-ncc')],
  ['nhà cung cấp tăng giá sau khi giao hàng thì xử lý sao', id('tai-chinh-chot-gia-ncc')],
  ['ghi nhận tiền chủ đầu tư chuyển về', id('tai-chinh-thu-tien-cdt')],
  ['chi tiền điện nước văn phòng ghi ở đâu', id('tai-chinh-phieu-chi-khac')],
  ['đối chiếu sao kê ngân hàng', id('tai-chinh-sao-ke-ngan-hang')],
  ['chi quỹ công trường mua đồ lặt vặt', id('tai-chinh-quy-cong-truong')],
  ['dự án vượt ngân sách xem ở đâu', id('tai-chinh-ngan-sach-du-an')],
  ['dòng tiền 3 tháng tới thế nào', id('tai-chinh-du-bao-dong-tien')],
  ['xuất báo cáo công nợ ra excel', id('tai-chinh-bao-cao-xuat-excel')],
  ['sao em không vào được mục tài chính', id('tai-chinh-khong-thay-so-lieu')],
  ['thanh toán cho thầu phụ theo khối lượng nghiệm thu', id('tai-chinh-nghiem-thu-thau-phu')],
  ['điều chỉnh công nợ vì ghi sai số tiền', id('tai-chinh-dieu-chinh-cong-no')],
  ['đối soát bê tông tháng 10 với nhà cung cấp', [id('hop-dong-doi-soat-thang'), id('mua-hang-hop-dong-nguyen-tac')]],
  ['thêm nhà cung cấp mới', id('hop-dong-them-doi-tac')],
  ['nhập hợp đồng mua bán với NCC', id('hop-dong-them-hd-ncc')],
  ['tạo hợp đồng thi công với chủ đầu tư', id('hop-dong-them-hd-nhan-thau')],
  // Chung, tài khoản, lỗi
  ['em quên mật khẩu đăng nhập rồi', 'so-tay-chung-quen-mat-khau'],
  ['muốn đổi pass cho bảo mật', 'so-tay-chung-doi-mat-khau'],
  ['đăng nhập báo sai thông tin dù gõ đúng', 'so-tay-chung-khong-dang-nhap-duoc'],
  ['đang dùng tự nhiên bị văng ra màn đăng nhập', 'so-tay-chung-tu-dang-xuat'],
  ['mất điện thoại thì khóa tài khoản trên máy đó kiểu gì', 'so-tay-chung-dang-xuat-moi-thiet-bi'],
  ['công trường sóng yếu nhập liệu có bị mất không', 'so-tay-chung-mat-mang'],
  ['cài vioo ra màn hình iphone như app', 'so-tay-chung-cai-app-dien-thoai'],
  ['iphone không nhận được thông báo của vioo', 'so-tay-chung-bat-thong-bao-day'],
  ['thông báo nhiều quá muốn tắt bớt', 'so-tay-chung-cach-nhan-thong-bao'],
  ['đánh dấu đã đọc hết thông báo', 'so-tay-chung-xem-thong-bao'],
  ['sao em không thấy mục mua hàng trên menu', ['so-tay-chung-khong-thay-menu']],
  ['phiếu này không có nút duyệt', ['so-tay-chung-khong-thay-nut', 'so-tay-quy-trinh-khong-thay-nut-duyet']],
  ['lưu thì báo đã được người khác cập nhật', 'so-tay-chung-du-lieu-vua-bi-sua'],
  ['bấm lưu nó báo lỗi đỏ', 'so-tay-chung-loi-khi-luu'],
  ['màn hình trắng xóa không load', 'so-tay-chung-trang-trang-tai-mai'],
  ['không upload được ảnh lên', 'so-tay-chung-tai-tep-anh-loi'],
  ['xuất danh sách ra file excel', 'so-tay-chung-xuat-excel'],
  ['chuyển giao diện tối', 'so-tay-chung-giao-dien-sang-toi'],
  ['tạo nhóm chat với phòng kỹ thuật', 'so-tay-chung-tin-nhan-tao-hoi-thoai'],
  ['trợ lý báo em chưa được cấp quyền dùng', 'so-tay-chung-tro-ly-chua-duoc-cap'],
  ['những việc đang chờ em xử lý xem ở đâu', 'so-tay-chung-viec-cho-toi'],
  ['báo lỗi phần mềm cho admin', 'so-tay-gop-y-bao-loi'],
  ['phím tắt tìm kiếm nhanh', 'so-tay-tim-kiem'],
  ['em vừa nhận thông báo có lệch dữ liệu phải sửa', 'so-tay-chung-lech-can-sua'],
  ['trưởng phòng chấp nhận lệch kiểm soát', 'so-tay-chung-lech-can-sua'],
  // Quy trình, Yêu cầu, Văn bản, Work, Đặt xe, Tài sản, VPP
  ['trình ký hồ sơ thanh toán qua phần mềm', 'so-tay-phieu-quy-trinh'],
  ['phiếu trình ký của em đang nằm ở ai', 'so-tay-quy-trinh-xem-buoc-theo-doi'],
  ['phiếu bị trả về bắt bổ sung thì sửa sao', 'so-tay-quy-trinh-bi-yeu-cau-bo-sung'],
  ['xóa phiếu quy trình nháp', 'so-tay-quy-trinh-xoa-nhap-huy-mo-lai'],
  ['tạo mẫu quy trình duyệt mới cho phòng', 'so-tay-quy-trinh-tao-mau'],
  ['duyệt phiếu quy trình được giao cho em', 'so-tay-quy-trinh-duyet-phieu'],
  ['tạo phiếu yêu cầu mua văn phòng', ['so-tay-yeu-cau-tao-de-xuat', 'so-tay-vpp']],
  ['trả lại phiếu yêu cầu cho người gửi', 'so-tay-yeu-cau-duyet-tra-lai'],
  ['tiếp nhận công văn đến', 'so-tay-van-ban-den-tiep-nhan'],
  ['cấp số và phát hành văn bản đi', 'so-tay-van-ban-duyet-cap-so-phat-hanh'],
  ['soạn thông báo nội bộ', 'so-tay-van-ban'],
  ['văn bản giao cho em xử lý', 'so-tay-van-ban-xu-ly-duoc-giao'],
  ['giao việc cho nhân viên trong phòng', 'so-tay-giao-viec'],
  ['cập nhật việc đang vướng', 'so-tay-cong-viec-cap-nhat-tien-do'],
  ['chốt kỳ công việc cuối tuần', 'so-tay-cong-viec-chot-ky'],
  ['đặt xe đi công trường ngày mai', 'so-tay-dat-xe'],
  ['hủy chuyến xe đã đặt', 'so-tay-dat-xe-huy-danh-gia'],
  ['duyệt đơn đặt xe', 'so-tay-dat-xe-duyet'],
  ['phân xe và tài xế cho chuyến', 'so-tay-dat-xe-dieu-phoi'],
  ['tài xế bắt đầu chuyến đi', 'so-tay-dat-xe-tai-xe-chuyen'],
  ['cấp laptop cho nhân viên mới', 'so-tay-tai-san-cap-phat-thu-hoi'],
  ['máy in hỏng ghi sửa chữa', 'so-tay-tai-san-bao-tri'],
  ['kiểm kê tài sản cuối năm', 'so-tay-tai-san-kiem-ke'],
  ['xin bút giấy văn phòng phẩm', 'so-tay-vpp'],
  ['cấp phát văn phòng phẩm cho phòng', 'so-tay-vpp-duyet-cap-phat'],
  ['mở google drive công ty', 'so-tay-kho-du-lieu-drive'],
  // Dự án, Nhật ký, Tiến độ
  ['tạo dự án mới', 'so-tay-du-an-tay-tao-du-an-moi'],
  ['em không thấy dự án SMB trong danh sách', 'so-tay-du-an-tay-khong-thay-du-an'],
  ['thêm kỹ sư vào dự án', 'so-tay-du-an-tay-them-thanh-vien'],
  ['cấp quyền duyệt nhật ký cho chỉ huy trưởng', ['so-tay-du-an-tay-phan-quyen-room', 'so-tay-du-an-tay-duyet-nhat-ky']],
  ['dán tin báo cáo zalo vào nhật ký', 'so-tay-du-an-tay-nhat-ky-tu-zalo'],
  ['quên ghi nhật ký hôm thứ 2 giờ ghi lại', 'so-tay-du-an-tay-ghi-bu-nhat-ky'],
  ['ghi nhật ký thi công hằng ngày', 'so-tay-nhat-ky-cong-truong'],
  ['chỉ huy trưởng duyệt nhật ký ngày', 'so-tay-du-an-tay-duyet-nhat-ky'],
  ['chỉ huy trưởng đi vắng ai duyệt nhật ký', 'so-tay-du-an-tay-duyet-thay-nhat-ky'],
  ['nhật ký bị trả lại sửa sao', 'so-tay-du-an-tay-nhat-ky-bi-tra-lai'],
  ['nhật ký duyệt rồi nhập sai khối lượng', 'so-tay-du-an-tay-sua-nhat-ky-da-duyet'],
  ['sao phần trăm tiến độ không nhảy', 'so-tay-du-an-tay-tien-do-khong-doi'],
  ['ghi lý do chậm tiến độ', 'so-tay-du-an-tay-ly-do-cham'],
  ['xin lùi ngày kế hoạch hạng mục móng', 'so-tay-du-an-tay-dieu-chinh-tien-do'],
  ['mốc khống chế của dự án', 'so-tay-du-an-tay-moc-khong-che'],
  ['lập kế hoạch thi công tuần sau', 'so-tay-ke-hoach-tuan'],
  ['kế hoạch vật tư tuần', 'so-tay-du-an-tay-ke-hoach-vat-tu'],
  ['báo sự cố an toàn ở công trường', 'so-tay-du-an-tay-su-co-an-toan'],
  ['xem mô hình 3d công trường', 'so-tay-du-an-tay-mo-hinh-3d'],
  ['xuất pdf nhật ký gửi chủ đầu tư', 'so-tay-du-an-tay-xuat-bao-cao'],
  ['xem chi phí đã chi của dự án', 'so-tay-du-an-tay-chi-phi-du-an'],
  ['xem nhiều dự án cùng lúc', 'so-tay-du-an-tay-da-du-an'],
  // Mua hàng, Kho, Đề xuất vật tư
  ['công trường cần thép, lập đề xuất ở đâu', 'so-tay-de-xuat-vat-tu'],
  ['đề xuất của em về được bao nhiêu rồi', 'so-tay-de-xuat-theo-doi-tien-do'],
  ['đề xuất bị trả lại sửa thế nào', 'so-tay-de-xuat-sua-gui-lai'],
  ['không tìm thấy mã vật tư cần dùng', 'so-tay-de-xuat-ma-vat-tu-moi'],
  ['đủ hàng rồi đóng đề xuất', 'so-tay-de-xuat-ket-thuc'],
  ['giao dòng đề xuất cho người mua', 'so-tay-mua-hang-giao-nhan-viec'],
  ['gộp nhiều đề xuất thành một đơn mua', 'so-tay-mua-hang-lap-don-tu-de-xuat'],
  ['lập PO từ báo giá excel của nhà cung cấp', 'so-tay-lap-don-hang'],
  ['gửi duyệt PO', 'so-tay-mua-hang-gui-duyet-don'],
  ['giám đốc duyệt đơn mua hàng', 'so-tay-mua-hang-duyet-don'],
  ['PO đã duyệt muốn hủy', 'so-tay-mua-hang-sua-huy-don-da-duyet'],
  ['nhà cung cấp giao làm 3 lần', 'so-tay-mua-hang-giao-nhieu-dot'],
  ['NCC không giao đủ, chốt đơn thiếu', 'so-tay-mua-hang-ket-thuc-thieu'],
  ['gọi hàng theo hợp đồng nguyên tắc bê tông', 'so-tay-mua-hang-hop-dong-nguyen-tac'],
  ['phiếu giao kho chụp đang chờ mua hàng', 'so-tay-mua-hang-phieu-giao-cho'],
  ['trả hàng lỗi cho nhà cung cấp', 'so-tay-mua-hang-tra-hang-ncc'],
  ['lấy vật tư từ kho thay vì mua mới', 'so-tay-mua-hang-cap-tu-kho'],
  ['thủ kho nhận hàng theo PO', ['so-tay-kho-nhan-hang-theo-don', 'so-tay-nhan-hang-chup-phieu']],
  ['chụp phiếu giao hàng để nhập kho', 'so-tay-nhan-hang-chup-phieu'],
  ['nhập nhầm số lượng nhận', 'so-tay-kho-sua-so-nhan-nham'],
  ['đối chiếu nhận hàng tồn đọng', 'so-tay-kho-doi-chieu-nhan-hang'],
  ['chuyển thép từ kho SMB sang DA29', 'so-tay-kho-chuyen-kho'],
  ['xuất kho cho tổ đội thi công', 'so-tay-xuat-kho-chuyen-kho'],
  ['xem tồn kho xi măng các kho', 'so-tay-kho-ton-the-kho'],
  ['báo cáo nhập xuất tồn tháng', 'so-tay-kho-bao-cao-nxt'],
  ['in phiếu nhập kho', 'so-tay-kho-in-phieu'],
  ['thủ kho không thấy kho của mình', 'so-tay-kho-khong-thay-kho'],
  ['tổ đội trả lại vật tư thừa về kho', 'so-tay-kho-hoan-tra-tu-to-doi'],
  ['xuất hủy vật tư hỏng', 'so-tay-kho-xuat-huy'],
  ['chọn quy cách thép khi nhập', 'so-tay-kho-quy-cach'],
  ['thép nhập theo cây hay kg', 'so-tay-kho-thep-cay-kg'],
  ['nhập kho hàng không có đơn mua', 'so-tay-kho-nhap-hang-khong-co-don'],
  ['kiểm kê kho cuối tháng', 'so-tay-kiem-ke'],
];

const rank = (q: string, expected: string | string[]) => {
  const want = Array.isArray(expected) ? expected : [expected];
  return searchHandbook(q, 3).findIndex(h => want.includes(h.entry.id));
};

describe('sổ tay — câu hỏi kiểm tìm mục', () => {
  it('mọi id trong bộ câu hỏi có thật trong sổ tay', () => {
    const ids = new Set(HANDBOOK.map(e => e.id));
    const missing = QUESTION_BANK.flatMap(([, e]) => (Array.isArray(e) ? e : [e])).filter(x => !ids.has(x));
    expect(missing).toEqual([]);
  });
  it('mục đúng nằm trong 3 mục đầu ≥ 92 % câu, đứng đầu ≥ 80 % câu', () => {
    const ranks = QUESTION_BANK.map(([q, e]) => ({ q, e, r: rank(q, e) }));
    const top1 = ranks.filter(x => x.r === 0).length / ranks.length;
    const top3 = ranks.filter(x => x.r >= 0).length / ranks.length;
    const misses = ranks.filter(x => x.r < 0).map(x => `${x.q} → ${searchHandbook(x.q, 3).map(h => h.entry.id).join(', ') || '(không có)'}`);
    console.log(`Sổ tay ${HANDBOOK.length} mục · ${ranks.length} câu kiểm · top-1 ${Math.round(top1 * 100)} % · top-3 ${Math.round(top3 * 100)} %${misses.length ? `\nTrượt:\n${misses.join('\n')}` : ''}`);
    expect(top3).toBeGreaterThanOrEqual(0.92);
    expect(top1).toBeGreaterThanOrEqual(0.8);
  });
});
