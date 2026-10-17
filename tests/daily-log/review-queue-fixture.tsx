// Nhật ký · Duyệt nhanh (PR-1): thẻ "Chờ bạn duyệt" + dải duyệt lần lượt + Duyệt thay. Hàng chờ thật SMB 17/10/2026; không gọi Supabase.
// Màn xem phiếu ở đây là bản rút gọn (nút Xác nhận / Trả lại giả lập) — chỉ để thử luồng đi qua hàng chờ.
// ?as=hoang: người duyệt dự phòng (phiếu treo của anh Sơn) · mặc định: anh Sơn (phiếu giao cho mình)
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { DailyLogReviewQueueBar, DailyLogReviewQueueCard } from '../../components/project/daily-log/DailyLogReviewQueue';
import { nextReviewItem, otherProjects, parseReviewQueue, scopeQueue, type DailyLogReviewItem } from '../../lib/dailyLogReviewQueue';

const params = new URLSearchParams(location.search);
const hoang = params.get('as') === 'hoang';
const smb = (date: string, hours: number, permission: 'approve' | 'verify', summary = false) => ({
  id: `smb-${date}`, projectId: 'smb', constructionSiteId: 'site-smb', projectCode: 'SMB-2026', projectName: 'DỰ ÁN SƠN MIỀN BẮC',
  date, submittedAt: new Date(Date.parse('2026-10-17T12:00:00Z') - hours * 3_600_000).toISOString(), waitingHours: hours,
  senderName: 'Nguyễn Chấp Việt', assigneeId: 'son', assigneeName: 'Phạm Ngọc Sơn', permission, summary });
const SMB = [smb('2026-10-01', 340, 'approve', true), smb('2026-10-05', 172, 'verify'), smb('2026-10-06', 171, 'verify'), smb('2026-10-07', 147, 'verify'), smb('2026-10-08', 147, 'verify')];
const DA29 = { id: 'da29-2026-10-01', projectId: 'da29', constructionSiteId: 'site-da29', projectCode: 'DA29', date: '2026-10-01', submittedAt: '2026-10-02T15:54:00Z',
  waitingHours: 356, assigneeName: 'Nguyễn Văn Năm', permission: 'approve', summary: true };
const initial = parseReviewQueue(hoang ? { mine: [], takeover: [...SMB, DA29], isBackup: true, takeoverDays: 2 } : { mine: [...SMB, { ...DA29, assigneeName: 'Phạm Ngọc Sơn' }], takeover: [], takeoverDays: 2 });

const Fixture: React.FC = () => {
  const [queue, setQueue] = useState(initial);
  const [viewId, setViewId] = useState<string | null>(null);
  const [asking, setAsking] = useState<DailyLogReviewItem | null>(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const mineHere = scopeQueue(queue.mine, 'smb', 'site-smb');
  const takeoverHere = scopeQueue(queue.takeover, 'smb', 'site-smb');
  const others = otherProjects([...queue.mine, ...queue.takeover], 'smb', 'site-smb');
  const mode = viewId && mineHere.some(i => i.id === viewId) ? 'mine' : viewId && takeoverHere.some(i => i.id === viewId) ? 'takeover' : null;
  const current = [...mineHere, ...takeoverHere].find(i => i.id === viewId) || null;
  const act = (label: string) => {
    if (!current) return;
    const list = mode === 'mine' ? mineHere : takeoverHere;
    const next = nextReviewItem(list, current.id);
    setQueue(q => ({ ...q, mine: q.mine.filter(i => i.id !== current.id) }));
    setToast(`${label} ${current.date.slice(8)}/${current.date.slice(5, 7)}`);
    if (next) setViewId(next.id); else { setViewId(null); setToast('Đã xử lý hết nhật ký chờ duyệt ở dự án này'); }
  };
  const takeOver = () => {
    if (!asking || reason.trim().length < 3) return;
    setQueue(q => ({ ...q, takeover: q.takeover.filter(i => i.id !== asking.id), mine: [...q.mine, { ...asking, assigneeName: 'Admin Hoàng' }] }));
    setToast('Đã nhận duyệt thay'); setAsking(null); setReason('');
  };
  return <div className="min-h-screen bg-background p-3 text-foreground sm:p-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-black">Nhật ký công trường · SMB-2026</h1>
      <DailyLogReviewQueueCard mine={mineHere} takeover={takeoverHere} takeoverDays={queue.takeoverDays} others={others}
        onOpen={item => setViewId(item.id)} otherLink={g => `#/da?projectId=${g.projectId}&tab=dailylog&dailyLogId=${g.firstId}`} />
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Lịch nhật ký tháng 10…</div>
      {toast && <p role="status" className="text-sm font-semibold text-leaf-700">{toast}</p>}
    </div>
    {current && <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-3" role="dialog" aria-label="Xem nhật ký">
      <div className="flex h-[92dvh] w-[96vw] max-w-[1180px] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
          <div><h3 className="text-lg font-black">Nhật ký công trường</h3>
            <p className="text-xs font-bold text-muted-foreground">{new Date(current.date).toLocaleDateString('vi-VN')} · 24 nhân công · {current.senderName} gửi</p></div>
          <button type="button" onClick={() => setViewId(null)} className="rounded-xl px-3 py-2 text-sm">Đóng</button>
        </div>
        {mode && <DailyLogReviewQueueBar items={mode === 'mine' ? mineHere : takeoverHere} currentId={current.id} mode={mode}
          takeoverDays={queue.takeoverDays} onOpen={item => setViewId(item.id)} onTakeOver={item => setAsking(item)} />}
        <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm sm:p-6"><p>- Đổ bê tông móng M3 trục 4–6</p><p>- Lắp cốp pha cột tầng 1</p></div>
        <div className="flex gap-2 border-t border-border p-3">
          <button type="button" disabled={mode !== 'mine'} onClick={() => act('Trả lại')} className="flex-1 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-40 sm:flex-none">Trả lại</button>
          <button type="button" disabled={mode !== 'mine'} onClick={() => act(current.permission === 'approve' ? 'Đã duyệt' : 'Đã xác nhận')}
            className="flex-1 rounded-xl bg-leaf-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 sm:flex-none">{current.permission === 'approve' ? 'Duyệt' : 'Xác nhận'}</button>
        </div>
      </div>
    </div>}
    {asking && <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 px-3" role="dialog" aria-label="Duyệt thay nhật ký">
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-card p-4">
        <p className="font-bold">Duyệt thay nhật ký</p>
        <textarea aria-label="Lý do" value={reason} onChange={e => setReason(e.target.value)} className="w-full rounded-xl border border-border p-2 text-sm" />
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setAsking(null)} className="rounded-xl px-3 py-2 text-sm">Hủy</button>
          <button type="button" onClick={takeOver} className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white">Nhận duyệt thay</button></div>
      </div>
    </div>}
  </div>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
