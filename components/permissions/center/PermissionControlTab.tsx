import React, { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, ChevronRight, KeyRound, Layers, Loader2, ShieldAlert } from 'lucide-react';
import { logApiError } from '../../../lib/apiError';
import { permissionBulkService, type ExpiryOverview } from '../../../lib/permissions/permissionBulkService';
import type { CenterPerson } from '../../../lib/permissions/permissionCenterService';
import { secondaryBtn } from '../../procurement/hub/hubUi';
import { SodConflictNotice, type SodControlOwnerCandidate } from '../SodAcknowledge';
import { PersonAvatar } from './PermissionCenterParts';

interface PermissionControlTabProps {
  people: readonly CenterPerson[];
  candidates: readonly SodControlOwnerCandidate[];
  actorUserId: string | null;
  reloadKey: number;
  onOpenPerson: (userId: string) => void;
  onShowAll: (kpi: 'sensitive' | 'extra') => void;
  onExtend: (userIds: string[]) => void;
}

const viDate = (value: string | null) => (value ? new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

const Card: React.FC<{ icon: React.ElementType; tone: string; title: string; count?: number; children: React.ReactNode }> = ({ icon: Icon, tone, title, count, children }) => (
  <section className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-4">
    <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted ${tone}`}><Icon size={16} /></span>
      {title}{count !== undefined && <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{count}</span>}
    </h2>
    {children}
  </section>
);

const PersonRow: React.FC<{ person: CenterPerson; text: string; badge?: string; onOpen: () => void }> = ({ person, text, badge, onOpen }) => (
  <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 py-2 text-left hover:border-teal-300">
    <PersonAvatar person={person} size={30} />
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{text}</span></span>
    {badge && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">{badge}</span>}
    <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
  </button>
);

/** Kiểm soát: kiêm nhiệm (ghi nhận lại tại chỗ), quyền nhạy cảm, quyền sắp hết hạn, quyền ngoài mẫu. */
const PermissionControlTab: React.FC<PermissionControlTabProps> = ({ people, candidates, actorUserId, reloadKey, onOpenPerson, onShowAll, onExtend }) => {
  const [expiry, setExpiry] = useState<ExpiryOverview | null>(null);
  const [expiryState, setExpiryState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    setExpiryState('loading');
    permissionBulkService.expiryOverview()
      .then(next => { if (!cancelled) { setExpiry(next); setExpiryState('ready'); } })
      .catch(error => { if (!cancelled) { logApiError('permissionControl.expiry', error); setExpiryState('error'); } });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const conflicted = people.filter(person => person.conflicts.length > 0);
  const sensitive = [...people].filter(person => person.sensitive.length > 0).sort((a, b) => b.sensitive.length - a.sensitive.length);
  const extra = [...people].filter(person => person.extraCount > 0).sort((a, b) => b.extraCount - a.extraCount);
  const expiring = people.filter(person => person.expiringSoon > 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card icon={ShieldAlert} tone="text-amber-600" title="Kiêm nhiệm" count={conflicted.length}>
        {conflicted.length === 0 && <p className="flex items-center gap-2 rounded-lg bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-800"><CheckCircle2 size={16} /> Không ai kiêm nhiệm.</p>}
        {conflicted.map(person => (
          <div key={person.userId} className="space-y-1.5 rounded-xl border border-border p-2.5">
            <button type="button" onClick={() => onOpenPerson(person.userId)} className="flex w-full items-center gap-2.5 text-left">
              <PersonAvatar person={person} size={30} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.position || 'Chưa có chức danh'}</span></span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>
            <SodConflictNotice userId={person.userId} targetName={person.name} reloadKey={reloadKey} actorUserId={actorUserId}
              candidates={candidates.filter(candidate => candidate.id !== person.userId)} />
          </div>
        ))}
      </Card>

      <Card icon={KeyRound} tone="text-violet-700" title="Quyền nhạy cảm" count={sensitive.length}>
        {sensitive.length === 0 && <p className="text-sm text-muted-foreground">Không ai có quyền nhạy cảm cấp riêng.</p>}
        <div className="space-y-1.5">
          {sensitive.slice(0, 8).map(person => (
            <PersonRow key={person.userId} person={person} text={person.sensitive.slice(0, 2).join(' · ')} badge={String(person.sensitive.length)} onOpen={() => onOpenPerson(person.userId)} />
          ))}
        </div>
        {sensitive.length > 8 && <button type="button" onClick={() => onShowAll('sensitive')} className={`${secondaryBtn} min-h-9 w-full`}>Xem cả {sensitive.length} người</button>}
      </Card>

      <Card icon={CalendarClock} tone="text-sky-700" title="Sắp hết hạn trong 30 ngày" count={expiring.length}>
        {expiryState === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang xem hạn quyền…</p>}
        {expiryState === 'error' && <p role="alert" className="text-sm font-semibold text-rose-700">Chưa xem được hạn quyền. Bấm Làm mới để thử lại.</p>}
        {expiring.length === 0 && expiryState !== 'loading' && (
          <div className="flex items-start gap-2 rounded-lg bg-leaf-50 px-3 py-2 text-sm text-leaf-800">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span><span className="block font-semibold">Không có quyền nào hết hạn trong 30 ngày tới.</span>
              {expiry?.nextExpiry && <span className="block text-xs">Quyền có hạn gần nhất hết vào {viDate(expiry.nextExpiry)}{expiry.within90 ? ` · ${expiry.within90} quyền hết hạn trong 90 ngày` : ''}.</span>}
            </span>
          </div>
        )}
        {expiring.length > 0 && (
          <>
            <div className="space-y-1.5">
              {expiring.map(person => <PersonRow key={person.userId} person={person} text={`${person.expiringSoon} quyền sắp hết hạn`} onOpen={() => onOpenPerson(person.userId)} />)}
            </div>
            <button type="button" onClick={() => onExtend(expiring.map(person => person.userId))} className={`${secondaryBtn} min-h-10 w-full`}>
              <CalendarClock size={15} /> Gia hạn 1 năm cho {expiring.length} người
            </button>
          </>
        )}
      </Card>

      <Card icon={Layers} tone="text-slate-600" title="Quyền ngoài mẫu" count={extra.length}>
        {extra.length === 0 && <p className="text-sm text-muted-foreground">Mọi người đúng theo mẫu.</p>}
        <div className="space-y-1.5">
          {extra.slice(0, 8).map(person => (
            <PersonRow key={person.userId} person={person} text={person.extra.slice(0, 2).join(' · ') || 'Quyền riêng'} badge={`${person.extraCount} quyền`} onOpen={() => onOpenPerson(person.userId)} />
          ))}
        </div>
        {extra.length > 8 && <button type="button" onClick={() => onShowAll('extra')} className={`${secondaryBtn} min-h-9 w-full`}>Xem cả {extra.length} người</button>}
      </Card>
    </div>
  );
};

export default PermissionControlTab;
