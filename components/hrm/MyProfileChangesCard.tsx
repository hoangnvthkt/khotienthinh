import React, { useCallback, useEffect, useState } from 'react';
import { FilePenLine, Loader2, RefreshCcw } from 'lucide-react';
import { describePayload } from '../../lib/hrmProfileFields';
import { hrmProfileChangeService, type ProfileChangeRequest } from '../../lib/hrmProfileChangeService';
import ProfileChangeRequestDialog from './ProfileChangeRequestDialog';

const STATUS_META: Record<ProfileChangeRequest['status'], { label: string; className: string }> = {
  pending: { label: 'Chờ HR duyệt', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
  approved: { label: 'Đã cập nhật', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  rejected: { label: 'Bị từ chối', className: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' },
  cancelled: { label: 'Đã hủy', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString('vi-VN') : '';

/** Own profile: the one entry point to ask HR for a change, plus what happened to earlier asks. */
const MyProfileChangesCard: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [rows, setRows] = useState<ProfileChangeRequest[] | null>(null);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await hrmProfileChangeService.listMine());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được đề nghị của bạn.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await hrmProfileChangeService.cancel(id);
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Không hủy được đề nghị.');
    } finally {
      setCancelling(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Cập nhật hồ sơ</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Đổi CCCD, tài khoản lương, địa chỉ, người phụ thuộc… gửi HR duyệt kèm ảnh giấy tờ.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Tải lại">
          <RefreshCcw size={15} />
        </button>
      </div>
      <button type="button" onClick={() => { setJustSent(false); setDialogOpen(true); }}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-black text-white active:scale-[0.98]">
        <FilePenLine size={16} /> Đề nghị cập nhật
      </button>
      {justSent && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Đã gửi. HR sẽ duyệt và bạn nhận thông báo khi có kết quả.</p>}

      <div className="mt-4 space-y-2">
        {error ? (
          <p className="text-sm font-semibold text-rose-600">{error}</p>
        ) : rows === null ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="animate-spin" size={14} /> Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">Chưa có đề nghị nào.</p>
        ) : rows.slice(0, 6).map(row => {
          const summary = describePayload(row.kind, row.payload).slice(0, 2).map(([, value]) => value).join(' · ');
          return (
            <article key={row.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-black text-slate-800 dark:text-white">{row.kindLabel}</p>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-black ${STATUS_META[row.status].className}`}>{STATUS_META[row.status].label}</span>
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{summary || row.note || '—'} · gửi {formatDate(row.createdAt)}</p>
              {row.status === 'rejected' && row.decisionNote && (
                <p className="mt-1 text-xs font-bold text-rose-700 dark:text-rose-300">Lý do: {row.decisionNote}</p>
              )}
              {row.status === 'pending' && (
                <button type="button" onClick={() => void cancel(row.id)} disabled={cancelling === row.id}
                  className="mt-1 block text-xs font-bold text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline disabled:opacity-50">
                  {cancelling === row.id ? 'Đang hủy…' : 'Hủy đề nghị'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {dialogOpen && (
        <ProfileChangeRequestDialog
          employeeId={employeeId}
          onClose={() => setDialogOpen(false)}
          onSubmitted={() => { setDialogOpen(false); setJustSent(true); void load(); }}
        />
      )}
    </section>
  );
};

export default MyProfileChangesCard;
