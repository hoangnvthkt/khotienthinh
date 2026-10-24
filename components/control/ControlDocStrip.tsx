import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { controlErrorMessage, controlService, type ControlFinding } from '../../lib/controlFindings';
import { FindingRow, SEV_STYLE, SEV_TITLE } from '../aiCenter/AiControlPanel';

// Dải cảnh báo trên chứng từ (Kiểm soát viên, chủ SP 24/10): lệch đang mở của đơn mua / đề xuất đang xem, cách sửa (biểu tượng i),
// Chấp nhận có lý do cho người có quyền. Không có lệch, không có quyền xem hoặc lỗi tải → không hiện gì (không chen vào việc chính).
export const ControlDocStrip: React.FC<{ poId?: string | null; requestId?: string | null; className?: string }> = ({ poId, requestId, className = '' }) => {
  const toast = useToast();
  const [items, setItems] = useState<ControlFinding[]>([]);
  const load = useCallback(() => {
    if (!poId && !requestId) { setItems([]); return; }
    controlService.forDoc({ poId, requestId }).then(setItems).catch(() => setItems([]));
  }, [poId, requestId]);
  useEffect(load, [load]);
  if (!items.length) return null;
  const top = items[0].severity;
  const accept = async (f: ControlFinding, reason: string) => {
    try { await controlService.accept(f.id, reason); toast.success('Đã chấp nhận lệch', f.objectCode || f.ruleTitle); load(); return true; }
    catch (e) { toast.error('Chưa chấp nhận được', controlErrorMessage(e)); return false; }
  };
  return <section aria-label="Kiểm soát phát hiện lệch" className={`overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 ${className}`}>
    <header className="flex flex-wrap items-center gap-2 border-b border-amber-200 px-3 py-2 text-sm dark:border-amber-900">
      <ShieldAlert size={16} className="text-amber-700 dark:text-amber-300" />
      <b className="text-amber-900 dark:text-amber-100">Kiểm soát: {items.length} lệch cần sửa</b>
      <span className={`rounded-full px-1.5 text-[11px] font-semibold ring-1 ${SEV_STYLE[top]}`} title={SEV_TITLE[top]}>{top}</span>
      <a href="#/kiem-soat" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">Lệch cần sửa <ArrowUpRight size={13} /></a>
    </header>
    <ul className="divide-y divide-amber-200/70 bg-card/60 dark:divide-amber-900/60">
      {items.map(f => <FindingRow key={f.id} f={f} onAccept={accept} onReopen={async () => load()} />)}
    </ul>
  </section>;
};
