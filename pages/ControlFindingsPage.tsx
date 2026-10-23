import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AiControlPanel from '../components/aiCenter/AiControlPanel';
import { controlService, type ControlService } from '../lib/controlFindings';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

// Lệch cần sửa (Kiểm soát viên K1, chủ SP 23/10/2026): người xử lý / trưởng bộ phận xem lệch dữ liệu giao cho mình (luật đã bật "Báo người
// xử lý"), mở chứng từ để sửa; trưởng bộ phận chấp nhận lệch có lý do. Admin thấy hết như tab Trung tâm AI → Kiểm soát.
const ControlFindingsPage: React.FC<{ service?: ControlService }> = ({ service = controlService }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><ShieldCheck size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground md:text-2xl">Lệch cần sửa</h1>
          <p className="text-sm text-muted-foreground">Số liệu chứng từ chưa khớp nhau — mở chứng từ để sửa</p>
        </div>
      </header>
      <AiControlPanel service={service} onOpenRoute={route => navigate(route)} notify={(text, kind) => (kind === 'error' ? toast.error(text) : toast.success(text))}
        confirm={o => confirm({ title: o.title, targetName: o.targetName, warningText: o.message, actionLabel: o.confirmText, intent: 'warning', countdownSeconds: 0 })} />
    </div>
  );
};

export default ControlFindingsPage;
