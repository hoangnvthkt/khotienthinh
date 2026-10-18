import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarDays, CheckCircle2, Loader2, Package, RotateCcw, X } from 'lucide-react';
import { isCommandExpired, leaveRangeLabel, leaveView, mrDraftRoute, mrRequestRoute, mrView, onCommandChanged, type AssistantCommand } from '../../lib/assistantCommands';
import type { MrFormActions } from '../../lib/assistantMrForm';
import AssistantMrForm from './AssistantMrForm';

// Thẻ lệnh nháp của Trợ lý (T2a, chủ SP duyệt 18/10/2026): Trợ lý chỉ chuẩn bị; người dùng xem, sửa lý do, bấm Gửi đơn.
// Gửi = đúng lệnh gửi của module (như form thường). Sau đó thẻ thành biên nhận (mã đơn + Mở). Không gửi gì tới khi người dùng bấm.
// Đề xuất vật tư (T2b): thẻ là form gọn ngay trong chat (chủ SP 18/10) — chọn mã, người duyệt rồi Gửi duyệt / Lưu nháp tại chỗ, lưu đúng
// đường của form Đề xuất. Không có actions.mrForm (bản cũ) thì "Mở form đề xuất" mở form thật của dự án, Gõ nhanh điền sẵn.

export interface CommandActions {
  /** Người dùng bấm Gửi: chạy lệnh gửi của module, trả lệnh đã ghi biên nhận. */
  run: (command: AssistantCommand, edits: { reason?: string }) => Promise<AssistantCommand>;
  cancel: (command: AssistantCommand) => Promise<AssistantCommand>;
  openRoute: (route: string, title: string) => void;
  /** Form đề xuất vật tư trong chat: tải danh mục / kho / người duyệt của dự án, lưu nháp / gửi duyệt. */
  mrForm?: MrFormActions;
}

const days = (n: number | null) => (n == null ? null : `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ngày`);

type CardProps = { command: AssistantCommand; now: Date; you: string; actions: CommandActions };

const LeaveCard: React.FC<CardProps> = ({ command, now, you, actions }) => {
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

const qtyShow = (q: number | null) => (q == null ? null : q.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));
const ddmm = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);
const MR_PREVIEW = 5;

const MaterialRequestCard: React.FC<CardProps> = ({ command, now, you, actions }) => {
  const v = mrView(command);
  const [current, setCurrent] = useState(command);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Form Đề xuất (tab khác cùng trang) lưu xong báo về → thẻ đổi thành biên nhận ngay.
  useEffect(() => onCommandChanged(command.id, setCurrent), [command.id]);
  const expired = isCommandExpired(current, now);
  const project = v.projectCode || v.projectName || 'dự án';
  // Có form trong chat (app thật) và thẻ còn hạn → sửa + gửi ngay tại đây; không thì tóm tắt + "Mở form đề xuất".
  const inline = Boolean(actions.mrForm) && !expired;

  if (current.status === 'done') {
    const code = typeof current.result.code === 'string' ? current.result.code : '';
    const submitted = current.result.submitted === true;
    const approvers = Array.isArray(current.result.approvers) ? current.result.approvers.filter((n): n is string => typeof n === 'string') : [];
    return (
      <div className="vcc-cmd" data-state="done" data-testid="command">
        <p className="vcc-cmd-done"><CheckCircle2 size={15} aria-hidden="true" /> {submitted ? 'Đã gửi đề xuất' : 'Đã lưu nháp đề xuất'} {code}
          {submitted ? (approvers.length ? ` · chờ ${approvers.join(', ')} duyệt` : '') : ' · mở để gửi duyệt'}</p>
        <button type="button" className="vcc-chip" onClick={() => actions.openRoute(mrRequestRoute(current), code || 'Đề xuất vật tư')}><ArrowUpRight size={12} /> Mở</button>
      </div>
    );
  }
  if (current.status === 'cancelled') {
    return <div className="vcc-cmd" data-state="cancelled" data-testid="command"><p className="vcc-cmd-muted">Đã bỏ {current.title.toLowerCase()}.</p></div>;
  }
  const cancel = async () => {
    setBusy(true); setError(null);
    try { setCurrent(await actions.cancel(current)); } catch (e) { setError(e instanceof Error ? e.message : 'Chưa bỏ được.'); } finally { setBusy(false); }
  };
  return (
    <div className="vcc-cmd" data-state={expired ? 'expired' : current.status} data-testid="command" role="group" aria-label={current.title}>
      <div className="vcc-cmd-head">
        <span className="vcc-cmd-icon" aria-hidden="true"><Package size={15} /></span>
        <p className="vcc-cmd-title">{v.title || current.title}</p>
        <span className="vcc-cmd-tag">Nháp · Trợ lý chuẩn bị</span>
      </div>
      <dl className="vcc-cmd-facts">
        <div><dt>Dự án</dt><dd>{v.projectCode && v.projectName ? `${v.projectCode} · ${v.projectName}` : project}</dd></div>
        {!inline && v.purpose && v.purpose !== v.title && <div><dt>Dùng cho</dt><dd>{v.purpose}</dd></div>}
        {!inline && v.neededDate && <div><dt>Cần ngày</dt><dd>{ddmm(v.neededDate)}</dd></div>}
      </dl>
      {inline && actions.mrForm ? (
        <AssistantMrForm command={current} actions={actions.mrForm} you={you} onDone={setCurrent} onCancel={() => void cancel()} busyCancel={busy}
          onOpenFull={() => actions.openRoute(mrDraftRoute(current), `Đề xuất · ${project}`)} />
      ) : <>
      <ul className="vcc-cmd-lines" aria-label="Vật tư">
        {v.lines.slice(0, MR_PREVIEW).map((l, i) => (
          <li key={i}><span>{[l.name, l.spec].filter(Boolean).join(' ')}</span>
            <b>{l.qty != null ? `${qtyShow(l.qty)} ${l.unit || ''}`.trim() : <em>chưa có SL</em>}</b></li>
        ))}
        {v.lines.length > MR_PREVIEW && <li className="vcc-cmd-more">+ {v.lines.length - MR_PREVIEW} dòng nữa</li>}
      </ul>
      {expired && <p className="vcc-cmd-muted">Thẻ đã cũ — hỏi lại Trợ lý để chuẩn bị lại.</p>}
      {error && <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</p>}
      {!expired && (
        <div className="vcc-cmd-actions">
          <button type="button" className="vcc-btn" data-pri="true" onClick={() => actions.openRoute(mrDraftRoute(current), `Đề xuất · ${project}`)} disabled={busy}>
            <ArrowUpRight size={14} /> Mở form đề xuất</button>
          <button type="button" className="vcc-btn" onClick={() => void cancel()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Bỏ</button>
          <span className="vcc-cmd-note">Chọn mã và gửi ở form — chưa gửi gì tới khi {you} bấm.</span>
        </div>
      )}
      </>}
    </div>
  );
};

const AssistantCommandCard: React.FC<CardProps> = props =>
  props.command.kind === 'material_request' ? <MaterialRequestCard {...props} /> : <LeaveCard {...props} />;

export default AssistantCommandCard;
