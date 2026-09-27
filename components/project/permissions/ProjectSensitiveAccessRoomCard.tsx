import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FileSignature, Globe2, Wallet, X } from 'lucide-react';
import { projectSensitiveAccessService, type SensitiveViewAccessRow } from '../../../lib/projectSensitiveAccessService';
import ProjectSensitiveAccessPanel, { isOn } from './ProjectSensitiveAccessPanel';

interface Props {
  projectId: string;
}

type Summary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; viewers: SensitiveViewAccessRow[]; finance: number; contract: number; allProjects: number };

const avatarColor = (value: string) => ['bg-indigo-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600'][value.charCodeAt(0) % 5];

/** Room-style card for the finance / contract view switches; details open in a drawer. */
const ProjectSensitiveAccessRoomCard: React.FC<Props> = ({ projectId }) => {
  const [summary, setSummary] = useState<Summary>({ status: 'loading' });
  const [open, setOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    setSummary({ status: 'loading' });
    try {
      const [projectRows, allRows] = await Promise.all([
        projectSensitiveAccessService.list(projectId),
        projectSensitiveAccessService.list(null),
      ]);
      const viewers = projectRows.filter(row => isOn(row, 'finance', false) || isOn(row, 'contract', false));
      setSummary({
        status: 'ready',
        viewers,
        finance: projectRows.filter(row => isOn(row, 'finance', false)).length,
        contract: projectRows.filter(row => isOn(row, 'contract', false)).length,
        allProjects: allRows.filter(row => row.financeAll || row.contractAll).length,
      });
    } catch {
      setSummary({ status: 'error' });
    }
  }, [projectId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const preview = summary.status === 'ready' ? summary.viewers.slice(0, 4) : [];

  return <>
    <button type="button" onClick={() => setOpen(true)} className="group relative flex min-h-56 w-full flex-col rounded-2xl border border-emerald-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 active:translate-y-0 dark:border-emerald-900/60 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Dữ liệu nhạy cảm</p>
          <h3 className="mt-1 text-sm font-black text-slate-800 dark:text-white">Ai được xem Tài chính & Hợp đồng</h3>
        </div>
        <ChevronRight size={17} className="mt-1 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-300">Công tắc xem dòng tiền, chi phí, tạm ứng và hợp đồng chủ đầu tư của dự án. Chỉ Admin thay đổi.</p>
      {summary.status === 'loading' && <div className="mt-4 h-7 w-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />}
      {summary.status === 'error' && <p className="mt-4 text-xs font-bold text-red-700">Không tải được số người xem · mở để thử lại</p>}
      {summary.status === 'ready' && <div className="mt-4 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-600 dark:text-slate-200">{summary.viewers.length} người đang xem</span>
        <div className="flex -space-x-2">
          {preview.map(row => row.userAvatar
            ? <img key={row.userId} src={row.userAvatar} alt={row.userName} className="h-7 w-7 rounded-full border-2 border-white object-cover dark:border-slate-800" />
            : <span key={row.userId} title={row.userName} className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-black text-white dark:border-slate-800 ${avatarColor(row.userName || row.userId)}`}>{(row.userName || '?').slice(0, 1).toUpperCase()}</span>)}
          {summary.viewers.length > preview.length && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] font-black text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-200">+{summary.viewers.length - preview.length}</span>}
        </div>
      </div>}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
        {summary.status === 'ready' && <>
          <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200"><Wallet size={11} />Tài chính {summary.finance}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-sky-100 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200"><FileSignature size={11} />Hợp đồng {summary.contract}</span>
          {summary.allProjects > 0 && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"><Globe2 size={11} />Tất cả dự án {summary.allProjects}</span>}
        </>}
      </div>
    </button>

    {/* Portal: the card lives in the Room grid, whose mobile styles would clip the drawer text. */}
    {open && createPortal(<div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label="Ai được xem Tài chính & Hợp đồng" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <aside className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        <header className="border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Dữ liệu nhạy cảm</p>
              <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">Ai được xem Tài chính & Hợp đồng</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300">Admin, người xử lý chứng từ trong Room Thanh toán / Nghiệm thu và người được mở "Tất cả dự án" luôn xem được. Người chỉ có quyền Xem trong Room vẫn cần bật ở đây. Mỗi thay đổi được lưu ngay, kèm lý do.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X size={18} /></button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <ProjectSensitiveAccessPanel projectId={projectId} embedded onChanged={loadSummary} />
        </main>
      </aside>
    </div>, document.body)}
  </>;
};

export default ProjectSensitiveAccessRoomCard;
