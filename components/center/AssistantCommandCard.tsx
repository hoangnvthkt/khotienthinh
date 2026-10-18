import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarDays, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react';
import { isCommandExpired, leaveRangeLabel, leaveView, type AssistantCommand } from '../../lib/assistantCommands';

// Thẻ lệnh nháp của Trợ lý (T2a, chủ SP duyệt 18/10/2026): Trợ lý chỉ chuẩn bị; người dùng xem, sửa lý do, bấm Gửi đơn.
// Gửi = đúng lệnh gửi của module (như form thường). Sau đó thẻ thành biên nhận (mã đơn + Mở). Không gửi gì tới khi người dùng bấm.

export interface CommandActions {
  /** Người dùng bấm Gửi: chạy lệnh gửi của module, trả lệnh đã ghi biên nhận. */
  run: (command: AssistantCommand, edits: { reason?: string }) => Promise<AssistantCommand>;
  cancel: (command: AssistantCommand) => Promise<AssistantCommand>;
  openRoute: (route: string, title: string) => void;
}

const days = (n: number | null) => (n == null ? null : `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ngày`);

const AssistantCommandCard: React.FC<{ command: AssistantCommand; now: Date; you: string; actions: CommandActions }> = ({ command, now, you, actions }) => {
  const v = leaveView(command);
  const [reason, setReason] = useState(v.reason);
  const [busy, setBusy] = useState<null | 'run' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(command.status === 'failed' ? command.error : null);
  const [current, setCurrent] = useState(command);
  const expired = isCommandExpired(current, now);
  const blocked = v.problems.length > 0 || v.requiresAttachment;
  const open = current.status === 'prepared' || current.status === 'failed';

  const run = async () => {
    if (reason.trim().length < 3) { setError('Nhập lý do (ít nhất 3 ký tự).'); return; }
    setBusy('run'); setError(null);
    try { setCurrent(await actions.run(current, { reason })); } catch (e) { setError(e instanceof Error ? e.message : 'Chưa gửi được đơn.'); } finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy('cancel'); setError(null);
    try { setCurrent(await actions.cancel(current)); } catch (e) { setError(e instanceof Error ? e.message : 'Chưa bỏ được.'); } finally { setBusy(null); }
  };

  if (current.status === 'done') {
    const code = typeof current.result.code === 'string' ? current.result.code : '';
    const route = typeof current.result.route === 'string' ? current.result.route : '/hrm/leave';
    const approver = v.steps[0];
    return (
      <div className="vcc-cmd" data-state="done" data-testid="command">
        <p className="vcc-cmd-done"><CheckCircle2 size={15} aria-hidden="true" /> Đã gửi đơn {code}{approver ? ` · chờ ${approver.name || approver.label} duyệt` : ''}</p>
        <button type="button" className="vcc-chip" onClick={() => actions.openRoute(route, code || 'Nghỉ phép')}><ArrowUpRight size={12} /> Mở</button>
      </div>
    );
  }
  if (current.status === 'cancelled') {
    return <div className="vcc-cmd" data-state="cancelled" data-testid="command"><p className="vcc-cmd-muted">Đã bỏ {current.title.toLowerCase()}.</p></div>;
  }

  return (
    <div className="vcc-cmd" data-state={expired ? 'expired' : current.status} data-testid="command" role="group" aria-label={current.title}>
      <div className="vcc-cmd-head">
        <span className="vcc-cmd-icon" aria-hidden="true"><CalendarDays size={15} /></span>
        <p className="vcc-cmd-title">{current.title}</p>
        <span className="vcc-cmd-tag">Nháp · Trợ lý chuẩn bị</span>
      </div>
      <dl className="vcc-cmd-facts">
        <div><dt>Loại</dt><dd>{v.typeName}</dd></div>
        <div><dt>Thời gian</dt><dd>{leaveRangeLabel(v)}{days(v.days) ? ` · ${days(v.days)}` : ''}</dd></div>
        {v.steps.length > 0 && <div><dt>Người duyệt</dt><dd>{v.steps.map(s => (s.name ? `${s.label} — ${s.name}` : s.label)).join(' → ')}</dd></div>}
        {v.annualRemaining != null && <div><dt>Phép năm còn</dt><dd>{days(v.annualRemaining)}</dd></div>}
      </dl>
      {v.problems.length > 0 && (
        <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {v.problems.join(' · ')}</p>
      )}
      {v.requiresAttachment && (
        <p className="vcc-cmd-warn"><AlertTriangle size={14} aria-hidden="true" /> Loại này cần giấy tờ — mở màn Nghỉ phép để đính kèm.</p>
      )}
      {expired && <p className="vcc-cmd-muted">Thẻ đã cũ — hỏi lại Trợ lý để chuẩn bị lại.</p>}
      {open && !expired && (
        <>
          <label className="vcc-cmd-field">
            <span>Lý do</span>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={300} disabled={busy !== null} aria-label="Lý do nghỉ" />
          </label>
          {error && <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</p>}
          <div className="vcc-cmd-actions">
            {v.requiresAttachment ? (
              <button type="button" className="vcc-btn" data-pri="true" onClick={() => actions.openRoute('/hrm/leave', 'Nghỉ phép')}><ArrowUpRight size={14} /> Mở màn Nghỉ phép</button>
            ) : (
              <button type="button" className="vcc-btn" data-pri="true" onClick={() => void run()} disabled={busy !== null || blocked}>
                {busy === 'run' ? <Loader2 size={14} className="animate-spin" /> : current.status === 'failed' ? <RotateCcw size={14} /> : null}
                {busy === 'run' ? 'Đang gửi…' : current.status === 'failed' ? 'Gửi lại' : 'Gửi đơn'}
              </button>
            )}
            <button type="button" className="vcc-btn" onClick={() => void cancel()} disabled={busy !== null}><X size={14} /> Bỏ</button>
            <span className="vcc-cmd-note">Chưa gửi gì tới khi {you} bấm.</span>
          </div>
        </>
      )}
    </div>
  );
};

export default AssistantCommandCard;
