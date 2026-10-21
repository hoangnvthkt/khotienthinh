import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, Loader2, Send, X } from 'lucide-react';
import { isCommandExpired, workTaskRoute, workTaskView, type AssistantCommand } from '../../lib/assistantCommands';
import type { WorkTaskCardActions } from '../../lib/assistantWorkTask';
import type { WorkAssignablePeople, WorkLevel } from '../../lib/work/workBoardService';
import { WORK_LEVEL_LABELS } from '../../lib/work/workBoardService';
import { dateAt, personOption, quickChoices } from '../../lib/work/workQuick';
import { localIsoDate } from '../../lib/work/workAi';
import { workDayLabel } from '../../lib/work/workPresentation';

/** Vioo Work · Đợt 1 PR-3: thẻ "Giao việc" Trợ lý chuẩn bị. Người dùng kiểm người làm, hạn, mức rồi bấm Giao — chưa bấm thì chưa giao gì. */
export const AssistantWorkTaskCard: React.FC<{
  command: AssistantCommand; now: Date; you: string;
  actions: { cancel: (c: AssistantCommand) => Promise<AssistantCommand>; openRoute: (route: string, title: string) => void; workTask?: WorkTaskCardActions };
}> = ({ command, now, you, actions }) => {
  const v = workTaskView(command);
  const [current, setCurrent] = useState(command);
  const [people, setPeople] = useState<WorkAssignablePeople | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState(v.title);
  const [assigneeId, setAssigneeId] = useState(v.assigneeUserId || '');
  const [date, setDate] = useState(v.deadlineDate || '');
  const [time, setTime] = useState(v.deadlineTime);
  const [level, setLevel] = useState<WorkLevel>(v.level || 'B');
  const [description, setDescription] = useState(v.description);
  const [busy, setBusy] = useState<null | 'give' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(command.status === 'failed' ? command.error : null);
  const expired = isCommandExpired(current, now);

  useEffect(() => {
    if (!actions.workTask || current.status !== 'prepared') return;
    let live = true;
    actions.workTask.people().then(p => { if (live) setPeople(p); }, () => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [actions.workTask, current.status]);
  const choices = useMemo(() => quickChoices(people), [people]);
  const picked = choices.find(p => p.userId === assigneeId) || null;

  if (current.status === 'done') {
    const code = typeof current.result.code === 'string' ? current.result.code : '';
    const who = typeof current.result.assigneeName === 'string' ? current.result.assigneeName : v.assigneeName;
    const due = typeof current.result.deadlineAt === 'string' ? workDayLabel(current.result.deadlineAt) : null;
    return (
      <div className="vcc-cmd" data-state="done" data-testid="command">
        <p className="vcc-cmd-done"><CheckCircle2 size={15} aria-hidden="true" /> Đã giao {code}{who ? ` cho ${who}` : ''}{due ? ` · hạn ${due}` : ''}</p>
        {code && <button type="button" className="vcc-chip" onClick={() => actions.openRoute(workTaskRoute(code), code)}><ArrowUpRight size={12} /> Mở việc</button>}
      </div>
    );
  }
  if (current.status === 'cancelled') return <div className="vcc-cmd" data-state="cancelled" data-testid="command"><p className="vcc-cmd-muted">Đã bỏ việc nháp.</p></div>;

  const deadline = date ? dateAt(date, time) : null;
  const give = async () => {
    if (!actions.workTask) return;
    if (title.trim().length < 2) { setError('Nhập tên việc.'); return; }
    if (!picked) { setError('Chọn người làm.'); return; }
    if (!deadline || deadline.getTime() <= Date.now()) { setError('Chọn hạn sau thời điểm hiện tại.'); return; }
    setBusy('give'); setError(null);
    try {
      setCurrent(await actions.workTask.give(current, { title: title.trim(), assigneeId: picked.userId, assigneeName: picked.isMe ? 'chính bạn' : picked.name,
        deadline, level, description, checklist: v.checklist }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa giao được việc.'); } finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy('cancel'); setError(null);
    try { setCurrent(await actions.cancel(current)); } catch (e) { setError(e instanceof Error ? e.message : 'Chưa bỏ được.'); } finally { setBusy(null); }
  };
  const off = Boolean(busy) || expired;

  return (
    <div className="vcc-cmd vcc-wt" data-state={expired ? 'expired' : current.status} data-testid="command" role="group" aria-label="Giao việc">
      <div className="vcc-cmd-head">
        <span className="vcc-cmd-icon" aria-hidden="true"><ClipboardList size={15} /></span>
        <p className="vcc-cmd-title">Giao việc · Vioo Work</p>
        <span className="vcc-cmd-tag">Nháp · chưa giao</span>
      </div>
      <label className="vcc-cmd-field"><span>Việc</span>
        <input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} disabled={off} aria-label="Tên việc" />
      </label>
      <div className="vcc-wt-row">
        <label className="vcc-cmd-field vcc-wt-person"><span>Người làm</span>
          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} disabled={off || !people} aria-label="Người làm">
            <option value="" disabled>{!people ? (loadError ? 'Không tải được danh sách' : 'Đang tải…') : 'Chọn người làm'}</option>
            {choices.map(p => <option key={p.userId} value={p.userId}>{personOption(p, you)}</option>)}
          </select>
        </label>
        <label className="vcc-cmd-field"><span>Hạn</span>
          <input type="date" value={date} min={localIsoDate(now)} onChange={e => setDate(e.target.value)} disabled={off} aria-label="Ngày hạn" />
        </label>
        <label className="vcc-cmd-field vcc-wt-time"><span>Giờ</span>
          <input type="time" value={time} step={900} onChange={e => setTime(e.target.value || '17:00')} disabled={off} aria-label="Giờ hạn" />
        </label>
      </div>
      <div className="vcc-wt-levels" role="group" aria-label="Mức quan trọng">
        {(['A', 'B', 'C'] as const).map(l => (
          <button type="button" key={l} aria-pressed={level === l} disabled={off} onClick={() => setLevel(l)}>{l} · {WORK_LEVEL_LABELS[l]}</button>
        ))}
      </div>
      {(description || v.checklist.length > 0) && (
        <label className="vcc-cmd-field"><span>Yêu cầu</span>
          <textarea value={description} maxLength={4000} rows={2} onChange={e => setDescription(e.target.value)} disabled={off} aria-label="Yêu cầu" />
        </label>
      )}
      {v.checklist.length > 0 && <p className="vcc-cmd-note">Checklist {v.checklist.length} mục: {v.checklist.slice(0, 3).join(' · ')}{v.checklist.length > 3 ? '…' : ''}</p>}
      {!v.assigneeUserId && v.assigneeName == null && !assigneeId && <p className="vcc-cmd-muted">Chưa rõ người làm — chọn ở ô Người làm.</p>}
      {error && <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</p>}
      {expired ? <p className="vcc-cmd-muted">Thẻ đã cũ — nhờ Trợ lý chuẩn bị lại.</p> : !actions.workTask ? <p className="vcc-cmd-muted">Mở Vioo Work → Giao nhanh để giao việc này.</p> : (
        <div className="vcc-cmd-actions">
          <button type="button" className="vcc-btn" data-pri="true" onClick={() => void give()} disabled={Boolean(busy) || !people}>
            {busy === 'give' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Giao</button>
          <button type="button" className="vcc-btn" onClick={() => void cancel()} disabled={Boolean(busy)}><X size={14} /> Bỏ</button>
          {deadline && picked && <span className="vcc-cmd-note">{picked.isMe ? 'Tự ghi cho mình' : `→ ${picked.name}`} · hạn {workDayLabel(deadline.toISOString())}</span>}
        </div>
      )}
    </div>
  );
};
