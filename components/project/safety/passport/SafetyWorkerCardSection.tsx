import React, { useState } from 'react';
import { CreditCard, Loader2, Printer, RefreshCw, ShieldOff } from 'lucide-react';
import type {
  SafetyProjectAssignment,
  SafetyWorkerDetailPayload,
} from '../../../../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../../../../lib/safetyWorkforceApi';
import SafetyPassportCardPreview from '../SafetyPassportCardPreview';

interface Props {
  scope: SafetyWorkforceRequestScope;
  detail: SafetyWorkerDetailPayload;
  onChanged: (detail: SafetyWorkerDetailPayload) => void;
}

export const canIssueSafetyCard = (
  assignment: Pick<SafetyProjectAssignment, 'assignmentStatus' | 'eligibilityStatus'> | null,
): boolean => Boolean(
  assignment?.assignmentStatus === 'active'
  && assignment.eligibilityStatus === 'eligible',
);

export const isFutureSafetyCardExpiry = (value: string, now = new Date()): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const expiry = new Date(`${value}T23:59:59.999`);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() > now.getTime();
};

const defaultExpiry = (): string => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
};

const eligibilityReason = (status?: SafetyProjectAssignment['eligibilityStatus']): string => {
  if (status === 'missing_profile') return 'Hồ sơ cá nhân chưa đầy đủ.';
  if (status === 'missing_certificate') return 'Thiếu chứng chỉ an toàn bắt buộc.';
  if (status === 'expired_certificate') return 'Có chứng chỉ an toàn đã hết hạn.';
  if (status === 'missing_site_requirement') return 'Chưa hoàn thành yêu cầu an toàn của công trường.';
  if (status === 'suspended') return 'Phân công đang bị tạm khóa.';
  return 'Phân công chưa đủ điều kiện cấp thẻ.';
};

const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Không thực hiện được thao tác thẻ an toàn';

export const SafetyWorkerCardSection: React.FC<Props> = ({ scope, detail, onChanged }) => {
  const activeAssignment = detail.assignments.find(assignment => assignment.assignmentStatus === 'active')
    || detail.rosterItem.activeAssignment;
  const activeCard = detail.cards.find(card => (
    card.assignmentId === activeAssignment?.id && card.status === 'active'
  )) || detail.rosterItem.activeCard;
  const [expiry, setExpiry] = useState(activeCard?.expiresAt?.slice(0, 10) || defaultExpiry());
  const [revokeReason, setRevokeReason] = useState('');
  const [showRevoke, setShowRevoke] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (command: () => Promise<SafetyWorkerDetailPayload>): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      onChanged(await command());
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const issue = (): void => {
    if (!activeAssignment || !canIssueSafetyCard(activeAssignment)) return;
    if (!isFutureSafetyCardExpiry(expiry)) {
      setMessage('Ngày hết hạn thẻ phải ở tương lai.');
      return;
    }
    void run(() => safetyWorkforceApi.issueCard(scope, activeAssignment.id, expiry));
  };

  const renew = (): void => {
    if (!activeCard) return;
    if (!isFutureSafetyCardExpiry(expiry)) {
      setMessage('Ngày gia hạn phải ở tương lai.');
      return;
    }
    void run(() => safetyWorkforceApi.renewCard(scope, activeCard.id, expiry));
  };

  const revoke = (): void => {
    if (!activeCard) return;
    if (!revokeReason.trim()) {
      setMessage('Vui lòng nhập lý do thu hồi thẻ.');
      return;
    }
    void run(() => safetyWorkforceApi.revokeCard(scope, activeCard.id, revokeReason.trim()));
  };

  const print = async (): Promise<void> => {
    if (!activeCard) return;
    setSaving(true);
    setMessage(null);
    try {
      await safetyWorkforceApi.logCardPrint(scope, activeCard.id);
      window.print();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <CreditCard className="text-orange-600" size={16} />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Thẻ an toàn</h3>
      </div>
      {message && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">{message}</div>}

      {!activeAssignment ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-500 dark:bg-slate-950"><ShieldOff size={15} /> Không có phân công đang hoạt động</div>
      ) : !activeCard && !canIssueSafetyCard(activeAssignment) ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="font-black">Chưa thể cấp thẻ</div>
          <div className="mt-1 font-medium">{eligibilityReason(activeAssignment.eligibilityStatus)}</div>
        </div>
      ) : !activeCard ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
          <label><span className="mb-1 block text-[11px] font-black text-slate-600 dark:text-slate-300">Ngày hết hạn</span><input type="date" value={expiry} disabled={saving} onChange={event => setExpiry(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
          <button type="button" onClick={issue} disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={14} /> : <CreditCard size={14} />} Cấp thẻ an toàn</button>
        </div>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <SafetyPassportCardPreview
            card={activeCard}
            compact
            workerName={detail.profile.fullName}
            workerCode={detail.profile.workerCode}
            photoUrl={detail.rosterItem.worker.photoUrl}
            organizationName={detail.rosterItem.team?.name || detail.rosterItem.subcontractor?.name}
            roleName={activeAssignment.roleName}
          />
          <div className="space-y-3">
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="font-bold text-slate-400">Mã thẻ</dt><dd className="mt-1 font-mono font-black text-slate-800 dark:text-slate-100">{activeCard.cardCode}</dd></div>
              <div><dt className="font-bold text-slate-400">Số lần in</dt><dd className="mt-1 font-black text-slate-800 dark:text-slate-100">{activeCard.printedCount}</dd></div>
            </dl>
            <label className="block"><span className="mb-1 block text-[11px] font-black text-slate-600 dark:text-slate-300">Gia hạn đến</span><input type="date" value={expiry} disabled={saving} onChange={event => setExpiry(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={renew} disabled={saving} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 disabled:opacity-50"><RefreshCw size={13} /> Gia hạn</button>
              <button type="button" onClick={() => { void print(); }} disabled={saving} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"><Printer size={13} /> In</button>
              <button type="button" onClick={() => setShowRevoke(value => !value)} disabled={saving} className="min-h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 disabled:opacity-50">Thu hồi</button>
            </div>
            {showRevoke && <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3"><label className="block"><span className="mb-1 block text-[11px] font-black text-red-700">Lý do thu hồi</span><input value={revokeReason} disabled={saving} onChange={event => setRevokeReason(event.target.value)} className="min-h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold outline-none" /></label><button type="button" onClick={revoke} disabled={saving} className="min-h-9 rounded-lg bg-red-600 px-3 text-xs font-black text-white disabled:opacity-50">Xác nhận thu hồi</button></div>}
          </div>
        </div>
      )}
    </section>
  );
};

export default SafetyWorkerCardSection;
