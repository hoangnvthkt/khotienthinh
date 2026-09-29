import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '../../index.css';
import { DailyLogRevisionActions } from '../../components/project/daily-log/DailyLogRevisionActions';
import ReasonConfirmModal from '../../components/ReasonConfirmModal';

function Fixture() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState('');
  const locked = new URLSearchParams(location.search).has('locked');
  return <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
    <h1 className="text-xl font-bold">Nhật ký ngày 23/09/2026</h1>
    <p>Bản tổng hợp đã xác nhận · Bê tông móng khu A</p>
    <DailyLogRevisionActions status="verified" canCreate periodLocked={locked}
      revisionNo={1} supersededByDailyLogId={reason ? 'revision-2' : null}
      reopenUrl="/da?projectId=p1&tab=weekly_progress" busy={false}
      onCreate={() => setOpen(true)} onOpenRevision={setSelected} />
    {reason && <output aria-label="Lý do đã ghi">{reason}</output>}
    {selected && <p>Đang xem bản điều chỉnh 2</p>}
    <ReasonConfirmModal isOpen={open} onClose={() => setOpen(false)}
      onConfirm={value => { setReason(value); setOpen(false); }} title="Tạo bản điều chỉnh"
      targetName="Nhật ký ngày 23/09/2026" actionLabel="Tạo bản điều chỉnh"
      reasonPlaceholder="Nhập lý do điều chỉnh..." countdownSeconds={0} intent="warning" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<HashRouter><Fixture /></HashRouter>);
