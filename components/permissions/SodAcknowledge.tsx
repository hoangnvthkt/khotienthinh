import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import {
  conflictToSodWarnings,
  emptySodAcknowledgement,
  groupSodWarnings,
  SOD_EXPIRY_MONTHS,
  sodAcknowledgementIssue,
  sodExpiryAfterMonths,
  sodService,
  type SodAcknowledgement,
  type SodWarning,
  type UserSodConflict,
} from '../../lib/permissions/sodService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

export interface SodControlOwnerCandidate {
  id: string;
  name: string;
}

const viDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const monthsFromNow = (iso: string) => {
  const diff = (Date.parse(iso) - Date.now()) / (1000 * 60 * 60 * 24 * 30.4);
  return SOD_EXPIRY_MONTHS.find(months => Math.abs(diff - months) < 0.5) ?? null;
};

const fieldCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50';

interface SodRuleListProps { warnings: readonly SodWarning[] }

/** Các cặp quyền kiêm nhiệm sẽ phát sinh, gộp theo luật (thủ kho nhiều kho = một dòng). */
export const SodRuleList: React.FC<SodRuleListProps> = ({ warnings }) => (
  <ul className="space-y-1.5">
    {groupSodWarnings(warnings).map(group => (
      <li key={group.ruleCode} className="rounded-lg border-l-4 border-l-amber-400 bg-white px-3 py-2">
        <div className="text-sm font-black text-slate-800">{group.name}</div>
        <div className="text-[11px] text-slate-500 !whitespace-normal">{group.description}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {group.permissions.map(permission => (
            <span key={permission.code} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              {permission.moduleLabel ? `${permission.moduleLabel}: ${permission.label}` : permission.label}
            </span>
          ))}
          {group.scopeLabels.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Kho: {group.scopeLabels.join(', ')}</span>
          )}
        </div>
      </li>
    ))}
  </ul>
);

interface SodAcknowledgeFieldsProps {
  warnings: readonly SodWarning[];
  value: SodAcknowledgement;
  onChange: (value: SodAcknowledgement) => void;
  candidates: readonly SodControlOwnerCandidate[];
  disabled?: boolean;
}

/** Bốn ô ghi nhận: vì sao, ai kiểm soát, kiểm soát bằng cách nào, đến bao giờ. */
export const SodAcknowledgeFields: React.FC<SodAcknowledgeFieldsProps> = ({ warnings, value, onChange, candidates, disabled = false }) => {
  const suggestions = useMemo(() => [...new Set(warnings.flatMap(warning => warning.controls))], [warnings]);
  const chosenMonths = monthsFromNow(value.expiresAt);
  const addControl = (text: string) => {
    const current = value.compensatingControls.trim();
    if (current.split('\n').map(line => line.trim()).includes(text)) return;
    onChange({ ...value, compensatingControls: current ? `${current}\n${text}` : text });
  };

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">Vì sao cần kiêm nhiệm</span>
        <input value={value.reason} disabled={disabled} onChange={event => onChange({ ...value, reason: event.target.value })}
          placeholder="Ví dụ: công trường thiếu người, kế toán kiêm thủ kho" className={fieldCls} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">Người kiểm soát</span>
        <select value={value.controlOwnerUserId} disabled={disabled} onChange={event => onChange({ ...value, controlOwnerUserId: event.target.value })} className={fieldCls}>
          <option value="">Chọn người kiểm soát…</option>
          {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <div className="space-y-1">
        <span className="text-xs font-bold text-slate-600">Kiểm soát bù bằng cách nào</span>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(text => (
              <button key={text} type="button" disabled={disabled} onClick={() => addControl(text)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-[11px] font-semibold text-slate-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50">
                + {text}
              </button>
            ))}
          </div>
        )}
        <textarea value={value.compensatingControls} disabled={disabled} rows={2} aria-label="Kiểm soát bù bằng cách nào"
          onChange={event => onChange({ ...value, compensatingControls: event.target.value })}
          placeholder="Bấm gợi ý ở trên hoặc tự ghi" className={fieldCls} />
      </div>
      <div className="space-y-1">
        <span className="text-xs font-bold text-slate-600">Hiệu lực ghi nhận</span>
        <div role="radiogroup" aria-label="Hiệu lực ghi nhận" className="flex flex-wrap items-center gap-1.5">
          {SOD_EXPIRY_MONTHS.map(months => (
            <button key={months} type="button" role="radio" aria-checked={chosenMonths === months} disabled={disabled}
              onClick={() => onChange({ ...value, expiresAt: sodExpiryAfterMonths(months) })}
              className={`min-h-9 rounded-lg border px-3 text-xs font-bold ${chosenMonths === months ? 'border-teal-600 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {months} tháng
            </button>
          ))}
          <span className="text-[11px] text-slate-500">đến {viDate(value.expiresAt)}</span>
        </div>
      </div>
    </div>
  );
};

interface SodAcknowledgeDialogProps {
  targetName: string;
  targetUserId: string;
  actorUserId?: string | null;
  warnings: readonly SodWarning[];
  value: SodAcknowledgement;
  onChange: (value: SodAcknowledgement) => void;
  candidates: readonly SodControlOwnerCandidate[];
  busy?: boolean;
  /** Người đã giữ sẵn cặp quyền (ghi nhận lại), không phải cấp mới. */
  existing?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Hộp ghi nhận khi bấm Lưu ở màn Người dùng và bộ quyền tạo kiêm nhiệm mới, hoặc ghi nhận kiêm nhiệm đang có. */
export const SodAcknowledgeDialog: React.FC<SodAcknowledgeDialogProps> = ({
  targetName, targetUserId, actorUserId = null, warnings, value, onChange, candidates, busy = false, existing = false, error = '',
  onConfirm, onCancel,
}) => {
  const issue = sodAcknowledgementIssue(value, actorUserId, targetUserId);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sod-ack-title">
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><ShieldAlert size={20} /></div>
            <div>
              <h3 id="sod-ack-title" className="text-base font-black text-slate-800">Ghi nhận kiêm nhiệm</h3>
              <p className="text-xs text-slate-500">{targetName} {existing ? 'đang' : 'sẽ'} kiêm {groupSodWarnings(warnings).length} việc cần tách người. Lưu lại ai cho phép, ai kiểm soát, đến bao giờ.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto bg-amber-50/40 px-5 py-4">
          <SodRuleList warnings={warnings} />
          <SodAcknowledgeFields warnings={warnings} value={value} onChange={onChange} candidates={candidates} disabled={busy} />
          {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">{existing ? 'Để sau' : 'Quay lại sửa quyền'}</button>
          <button type="button" onClick={onConfirm} disabled={busy || Boolean(issue)} title={issue || undefined}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {existing ? 'Ghi nhận' : 'Ghi nhận và lưu'}
          </button>
        </footer>
      </div>
    </div>
  );
};

interface SodConflictNoticeProps {
  userId: string;
  targetName?: string;
  reloadKey?: number;
  /** Có thì hiện nút Ghi nhận cho cặp chưa ghi nhận (người quản lý phân quyền). */
  candidates?: readonly SodControlOwnerCandidate[];
  actorUserId?: string | null;
  defaultControlOwnerId?: string | null;
}

/** Dòng nhắc ở đầu phần quyền khi người này đang kiêm nhiệm (theo quyền đã lưu); bấm Ghi nhận để lưu ngoại lệ. */
export const SodConflictNotice: React.FC<SodConflictNoticeProps> = ({
  userId, targetName = '', reloadKey = 0, candidates, actorUserId = null, defaultControlOwnerId = null,
}) => {
  const [conflict, setConflict] = useState<UserSodConflict | null>(null);
  const [reload, setReload] = useState(0);
  const [recording, setRecording] = useState<UserSodConflict['conflicts'][number] | null>(null);
  const [ack, setAck] = useState<SodAcknowledgement>(() => emptySodAcknowledgement());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setConflict(null);
    sodService.listConflicts(userId)
      .then(rows => { if (!cancelled) setConflict(rows[0] || null); })
      .catch(loadError => { logApiError('sodConflictNotice.load', loadError); });
    return () => { cancelled = true; };
  }, [userId, reloadKey, reload]);

  const startRecord = (item: UserSodConflict['conflicts'][number]) => {
    const owner = candidates?.some(candidate => candidate.id === defaultControlOwnerId) ? defaultControlOwnerId : null;
    setAck(emptySodAcknowledgement(owner));
    setError('');
    setRecording(item);
  };
  const confirmRecord = async () => {
    if (!recording) return;
    setBusy(true); setError('');
    try {
      await sodService.recordExisting(userId, recording.ruleCode, ack);
      setRecording(null);
      setReload(value => value + 1);
    } catch (recordError) {
      logApiError('sodConflictNotice.record', recordError);
      setError(getApiErrorMessage(recordError, 'Không ghi nhận được.'));
    } finally {
      setBusy(false);
    }
  };

  if (!conflict) return null;
  return (
    <div role="status" className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {conflict.conflicts.map(item => {
        const scopes = item.scopes.filter(scope => scope.scopeType !== 'global').map(scope => scope.scopeLabel || scope.scopeId);
        return (
          <div key={item.ruleCode} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AlertTriangle size={13} className="shrink-0" />
            <span className="font-black">Đang kiêm nhiệm: {item.name}{scopes.length > 0 ? ` (${scopes.join(', ')})` : ''}</span>
            <span className="font-semibold text-amber-800">
              {item.acceptance
                ? `· đã ghi nhận đến ${viDate(item.acceptance.expiresAt)}${item.acceptance.controlOwnerName ? `, ${item.acceptance.controlOwnerName} kiểm soát` : ''}`
                : '· chưa ghi nhận ngoại lệ'}
            </span>
            {candidates && (
              <button type="button" onClick={() => startRecord(item)}
                className="ml-auto inline-flex min-h-8 items-center rounded-lg border border-amber-300 bg-white px-2.5 text-[11px] font-black text-amber-900 hover:bg-amber-100">
                {item.acceptance ? 'Ghi nhận lại' : 'Ghi nhận'}
              </button>
            )}
          </div>
        );
      })}
      {recording && candidates && (
        <SodAcknowledgeDialog existing targetName={targetName || conflict.name} targetUserId={userId} actorUserId={actorUserId}
          warnings={conflictToSodWarnings(recording)} value={ack} onChange={setAck} candidates={candidates}
          busy={busy} error={error} onConfirm={() => void confirmRecord()} onCancel={() => setRecording(null)} />
      )}
    </div>
  );
};
