import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Loader2 } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import { permissionBulkService, type BulkApplyResult, type CopyPreviewRow, type CopyWhat } from '../../../lib/permissions/permissionBulkService';
import type { CenterPerson, CenterTemplate } from '../../../lib/permissions/permissionCenterService';
import { emptySodAcknowledgement, sodAcknowledgementIssue, type SodAcknowledgement } from '../../../lib/permissions/sodService';
import { primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { SodAcknowledgeFields, SodRuleList, type SodControlOwnerCandidate } from '../SodAcknowledge';
import { ApplyResultBox, PersonAvatar, ReasonChips, SAVE_REASONS, TemplateChip, optionLabels } from './PermissionCenterParts';
import PermissionPeoplePicker from './PermissionPeoplePicker';

interface PermissionCopyTabProps {
  templates: readonly CenterTemplate[];
  people: readonly CenterPerson[];
  candidates: readonly SodControlOwnerCandidate[];
  actorUserId: string | null;
  fromUserId: string | null;
  onFromChange: (userId: string) => void;
  onApplied: () => void | Promise<void>;
}

const defaultWhat = (person: CenterPerson | undefined): CopyWhat => ({
  template: Boolean(person?.templateCode), extra: false, warehouses: Boolean(person?.warehouses.length), room: false,
});
const TONE: Record<CopyPreviewRow['lines'][number]['tone'], string> = {
  ok: 'text-leaf-800', warn: 'font-semibold text-amber-800', muted: 'text-muted-foreground',
};

/** Sao chép quyền từ một người làm mẫu sang một hoặc nhiều người: mẫu, quyền riêng, thủ kho, Room dự án. */
const PermissionCopyTab: React.FC<PermissionCopyTabProps> = ({ templates, people, candidates, actorUserId, fromUserId, onFromChange, onApplied }) => {
  const sorted = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [people]);
  const source = people.find(person => person.userId === fromUserId) || sorted[0];
  const sourceTemplate = templates.find(template => template.code === source?.templateCode);
  const [what, setWhat] = useState<CopyWhat>(() => defaultWhat(source));
  const [targets, setTargets] = useState<string[]>([]);
  const [rows, setRows] = useState<CopyPreviewRow[] | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [reason, setReason] = useState<string>(SAVE_REASONS[1]);
  const [ack, setAck] = useState<SodAcknowledgement>(() => emptySodAcknowledgement());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [applyError, setApplyError] = useState('');

  useEffect(() => { setWhat(defaultWhat(source)); setTargets([]); setResult(null); }, [source?.userId]);

  const anyWhat = what.template || what.extra || what.warehouses || what.room;
  const previewKey = `${source?.userId}|${targets.join(',')}|${JSON.stringify(what)}`;
  useEffect(() => {
    if (!source || !targets.length || !anyWhat || result) { setRows(null); setPreviewState('idle'); return undefined; }
    let cancelled = false;
    setPreviewState('loading');
    const timer = window.setTimeout(() => {
      permissionBulkService.previewCopy(source.userId, targets, what)
        .then(next => { if (!cancelled) { setRows(next); setPreviewState('idle'); setAck(emptySodAcknowledgement()); } })
        .catch(error => {
          if (cancelled) return;
          logApiError('permissionCopy.preview', error);
          setPreviewError(getApiErrorMessage(error, 'Chưa xem trước được.')); setPreviewState('error');
        });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [previewKey]);

  if (!source) return null;

  const items: { key: keyof CopyWhat; label: string; desc: string; available: boolean }[] = [
    { key: 'template', label: 'Mẫu và ô tích', available: Boolean(source.templateCode),
      desc: source.templateCode ? [sourceTemplate?.name, ...optionLabels(source, sourceTemplate)].filter(Boolean).join(' + ') : 'Chưa theo mẫu' },
    { key: 'extra', label: 'Quyền riêng ngoài mẫu', available: source.extraCount > 0,
      desc: source.extraCount ? `${source.extraCount} quyền${source.sensitive.length ? `, có ${source.sensitive.length} quyền nhạy cảm` : ''}` : 'Không có' },
    { key: 'warehouses', label: 'Thủ kho theo kho', available: source.warehouses.length > 0,
      desc: source.warehouses.length ? source.warehouses.join(', ') : 'Không giữ kho nào' },
    { key: 'room', label: 'Vai trò trong Room dự án', available: source.roomProjects > 0,
      desc: source.roomProjects ? `${source.roomProjects} dự án — vào cùng dự án, cùng vị trí và vai trò` : 'Không ở Room nào' },
  ];

  const warnedIds = (rows || []).filter(row => row.warnings.length).map(row => row.userId);
  const warnings = (rows || []).flatMap(row => row.warnings);
  const ackIssue = warnings.length
    ? (warnedIds.includes(ack.controlOwnerUserId) ? 'Người kiểm soát phải khác người được cấp quyền.' : sodAcknowledgementIssue(ack, actorUserId, warnedIds[0]))
    : '';
  const busy = Boolean(progress);
  const block = !targets.length ? 'Chọn người nhận'
    : !anyWhat ? 'Chọn ít nhất một phần để chép'
    : previewState === 'loading' ? 'Đang xem trước'
    : previewState === 'error' || !rows ? 'Chưa xem trước được'
    : ackIssue;
  const nameOf = (userId: string) => people.find(person => person.userId === userId)?.name || '';

  const apply = async () => {
    if (block) return;
    setApplyError(''); setProgress({ done: 0, total: targets.length });
    try {
      setResult(await permissionBulkService.applyCopy(source.userId, targets, what, `Chép quyền từ ${source.name}: ${reason}`,
        warnings.length ? ack : null, (done, total) => setProgress({ done, total })));
      setProgress(null);
      await onApplied();
    } catch (error) {
      logApiError('permissionCopy.apply', error);
      setApplyError(getApiErrorMessage(error, 'Chưa chép được. Quyền của mọi người giữ nguyên.'));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section className="min-w-0 flex-[1_1_320px] space-y-4 rounded-2xl border border-border bg-card p-4 lg:max-w-[400px]">
        <h2 className="text-sm font-bold text-foreground">Chép từ</h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Người làm mẫu</span>
          <select value={source.userId} onChange={event => onFromChange(event.target.value)} disabled={busy}
            className="min-h-10 w-full rounded-lg border border-border bg-background px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/40">
            {sorted.map(person => <option key={person.userId} value={person.userId}>{person.name}{person.position ? ` — ${person.position}` : ''}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <PersonAvatar person={source} size={40} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-foreground">{source.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{source.position || 'Chưa có chức danh'} · {source.department || 'Chưa có phòng'}</span>
            <span className="mt-1 block"><TemplateChip code={source.templateCode} name={sourceTemplate?.name || 'Chưa gắn mẫu'} /></span>
          </span>
        </div>
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-muted-foreground">Chép những gì</span>
          {items.map(item => (
            <label key={item.key} className={`flex min-h-12 items-start gap-2.5 rounded-lg border p-2.5 ${item.available ? 'border-border' : 'border-dashed border-border opacity-60'}`}>
              <input type="checkbox" checked={what[item.key] && item.available} disabled={!item.available || busy} className="mt-0.5 h-4 w-4 accent-teal-700"
                onChange={() => { setResult(null); setWhat(current => ({ ...current, [item.key]: !current[item.key] })); }} />
              <span className="min-w-0"><span className="block text-sm font-semibold text-foreground">{item.label}</span><span className="block text-xs text-muted-foreground">{item.desc}</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="min-w-0 flex-[999_1_480px] space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">Chép sang</h2>
          <span className="text-xs text-muted-foreground">Gợi ý người cùng phòng hoặc cùng mẫu; tìm để chọn người khác</span>
        </div>
        <PermissionPeoplePicker people={people} templates={templates} selected={targets} excludeUserId={source.userId} disabled={busy}
          onChange={next => { setResult(null); setTargets(next); }}
          suggested={person => (Boolean(source.department) && person.department === source.department) || (Boolean(source.templateCode) && person.templateCode === source.templateCode)} />

        {targets.length > 0 && anyWhat && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <h3 className="text-sm font-bold text-foreground">Xem trước</h3>
            {previewState === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang tính cho từng người…</p>}
            {previewState === 'error' && <p role="alert" className="text-sm font-semibold text-rose-700">{previewError}</p>}
            {previewState === 'idle' && rows?.map(row => (
              <div key={row.userId} className="rounded-lg bg-muted/40 px-3 py-2">
                <span className="block text-sm font-semibold text-foreground">{row.name}</span>
                {row.lines.map(line => <span key={line.text} className={`block text-xs ${TONE[line.tone]}`}>{line.text}</span>)}
                {row.warnings.length > 0 && <span className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Kiêm nhiệm — cần ghi nhận</span>}
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && !result && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900"><AlertTriangle size={14} /> {warnedIds.length} người sẽ kiêm nhiệm — ghi nhận trước khi chép</p>
            <SodRuleList warnings={warnings} />
            <SodAcknowledgeFields warnings={warnings} value={ack} onChange={setAck} candidates={candidates.filter(candidate => !warnedIds.includes(candidate.id))} disabled={busy} />
          </div>
        )}
        {rows && !result && <ReasonChips value={reason} onChange={setReason} label={`Lý do (nhật ký ghi: “Chép quyền từ ${source.name}: ${reason}”)`} disabled={busy} />}
        {applyError && <p role="alert" className="text-sm font-semibold text-rose-700">{applyError}</p>}
        {result && <ApplyResultBox result={result} nameOf={nameOf} doneText={`Đã chép cho ${result.done.length} người. Nhật ký ghi: “Chép quyền từ ${source.name}”.`} />}

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <span className="text-sm font-semibold text-foreground sm:mr-auto">{progress ? `Đang chép ${progress.done}/${progress.total} người…` : `${targets.length} người nhận`}</span>
          {result ? (
            <button type="button" onClick={() => { setResult(null); setTargets([]); }} className={`${secondaryBtn} min-h-10`}>Chép lượt khác</button>
          ) : (
            <button type="button" onClick={() => void apply()} disabled={Boolean(block) || busy} title={block || undefined} className={`${primaryBtn} min-h-10 flex-1 sm:flex-none`}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Chép sang {targets.length} người
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default PermissionCopyTab;
