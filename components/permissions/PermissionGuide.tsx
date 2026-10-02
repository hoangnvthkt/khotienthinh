import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

const GUIDE_OPEN_KEY = 'vioo:permission-guide-open';

const readOpen = () => {
  try { return window.localStorage.getItem(GUIDE_OPEN_KEY) !== 'closed'; } catch { return true; }
};

const LAYERS: Array<{ title: string; text: string }> = [
  {
    title: 'Loại tài khoản (ô ở trên cùng)',
    text: 'Quản trị viên = toàn quyền, các phần bên dưới không cần chỉnh. Tài khoản kho = gắn với một kho. Tài khoản thường = chỉ làm được những gì được cấp ở phần ①.',
  },
  {
    title: '① Quyền theo công việc',
    text: 'Phần dùng hằng ngày. Mỗi phân hệ có các bậc: Xem → Lập/Sửa → Duyệt → Quản trị. Phạm vi: Toàn công ty, Chính mình (việc của mình) hoặc Được phân công. Ô có ổ khóa là quyền đến từ chỗ khác, sửa ở chỗ được ghi trong ô.',
  },
  {
    title: '② Vai trò đặc biệt',
    text: 'Chỉ cho vài người: Nhân sự, Trưởng phòng nhân sự, Kiểm toán. Mở dữ liệu nhạy cảm như lương, hợp đồng lao động. Có hiệu lực ngay khi xác nhận.',
  },
  {
    title: '③ Quyền đến từ nguồn khác (chỉ xem)',
    text: 'Xem Tài chính/Hợp đồng dự án (công tắc Admin bật) và quyền trong từng dự án (Room: Dự án → tab Phân quyền). Hiện ở đây để biết người này làm được gì, không sửa ở đây.',
  },
];

// Short how-to for the person setting permissions, shown above the editor.
const PermissionGuide: React.FC = () => {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => setOpen(current => {
    try { window.localStorage.setItem(GUIDE_OPEN_KEY, current ? 'closed' : 'open'); } catch { /* per-viewer convenience only */ }
    return !current;
  });

  return (
    <section className="rounded-xl border border-emerald-100 bg-emerald-50/50">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-black text-emerald-800">
        <BookOpen size={14} />
        <span className="flex-1">Hướng dẫn nhanh: phân quyền cho một người</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-emerald-100 px-3 pb-3 pt-2 text-[11px] text-slate-600">
          <div>
            <p className="font-black text-slate-800">Đa số trường hợp chỉ cần 3 bước</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Ở <b>Điền nhanh theo mẫu vị trí</b>, chọn mẫu đúng chức vụ (mẫu có dấu ★ là gợi ý theo chức vụ của người này) rồi bấm <b>Điền vào bảng</b>.</li>
              <li>Nếu người này làm khác mẫu, tích thêm hoặc bỏ vài ô trong danh sách phân hệ.</li>
              <li>Bấm <b>Lưu thông tin</b> (lý do đã được ghi sẵn theo mẫu, sửa nếu cần). Khung "Thay đổi quyền sẽ lưu" cho biết chính xác những gì thêm, bớt.</li>
            </ol>
          </div>
          <div>
            <p className="font-black text-slate-800">Màn này gồm những phần nào</p>
            <ul className="mt-1 space-y-1">
              {LAYERS.map(layer => (
                <li key={layer.title}><b className="text-slate-700">{layer.title}:</b> {layer.text}</li>
              ))}
            </ul>
          </div>
          <p className="rounded-lg bg-white/70 px-2 py-1.5">
            Danh sách phân hệ dài vì phủ toàn bộ hệ thống. Người không dùng phân hệ nào thì để trống phân hệ đó, không cần mở ra.
          </p>
        </div>
      )}
    </section>
  );
};

export default PermissionGuide;
