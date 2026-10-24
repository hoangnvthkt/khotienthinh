import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, KeyRound, Layers, ListChecks, Loader2, Search } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import {
  permissionBulkService, searchGrantable, type BulkAction, type BulkApplyResult, type BulkPreviewRow, type GrantableItem,
} from '../../../lib/permissions/permissionBulkService';
import { templateColor, type CenterPerson, type CenterTemplate } from '../../../lib/permissions/permissionCenterService';
import { emptySodAcknowledgement, sodAcknowledgementIssue, type SodAcknowledgement } from '../../../lib/permissions/sodService';
import { primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { SodAcknowledgeFields, SodRuleList, type SodControlOwnerCandidate } from '../SodAcknowledge';
import { ApplyResultBox, ReasonChips, SAVE_REASONS, TemplateChip, TemplateDot } from './PermissionCenterParts';
import PermissionPeoplePicker from './PermissionPeoplePicker';

export type BulkKind = BulkAction['kind'];

export interface BulkPreset { userIds: string[]; kind?: BulkKind; templateCode?: string; step?: 1 | 2 | 3 }

interface PermissionBulkTabProps {
  templates: readonly CenterTemplate[];
  people: readonly CenterPerson[];
  candidates: readonly SodControlOwnerCandidate[];
  actorUserId: string | null;
  preset?: BulkPreset | null;
  onApplied: () => void | Promise<void>;
}

const KINDS: { kind: BulkKind; title: string; desc: string; icon: React.ElementType }[] = [
  { kind: 'template', title: 'Gắn vào mẫu', desc: 'Đổi mẫu theo vị trí cho cả nhóm; quyền ngoài mẫu giữ nguyên', icon: Layers },
  { kind: 'option', title: 'Tích / bỏ một ô', desc: 'Duyệt PO, Kế toán trưởng, Kế toán kho — chỉ mẫu có ô đó', icon: ListChecks },
  { kind: 'extend', title: 'Gia hạn quyền có hạn', desc: 'Thêm 1 năm cho quyền hết hạn trong 30 ngày', icon: CalendarClock },
  { kind: 'add', title: 'Thêm một quyền', desc: 'Chọn trong danh mục, áp cho mọi người đã chọn', icon: KeyRound },
];
const STEPS = ['Chọn người', 'Chọn việc', 'Xem trước và áp'];

/** Hàng loạt: chọn nhiều người → một việc → xem trước từng người → áp (mỗi người một dòng nhật ký). */
const PermissionBulkTab: React.FC<PermissionBulkTabProps> = ({ templates, people, candidates, actorUserId, preset, onApplied }) => {
  const [step, setStep] = useState<1 | 2 | 3>(preset?.step || 1);
  const [selected, setSelected] = useState<string[]>(preset?.userIds || []);
  const [kind, setKind] = useState<BulkKind>(preset?.kind || 'template');
  const [templateCode, setTemplateCode] = useState(preset?.templateCode || '');
  const [templateOptions, setTemplateOptions] = useState<string[]>([]);
  const [optionKey, setOptionKey] = useState('');
  const [optionOn, setOptionOn] = useState(true);
  const [permission, setPermission] = useState<GrantableItem | null>(null);
  const [catalog, setCatalog] = useState<GrantableItem[] | null>(null);
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [rows, setRows] = useState<BulkPreviewRow[] | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [reason, setReason] = useState<string>(SAVE_REASONS[0]);
  const [ack, setAck] = useState<SodAcknowledgement>(() => emptySodAcknowledgement());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [applyError, setApplyError] = useState('');

  const nameOf = (userId: string) => people.find(person => person.userId === userId)?.name || '';
  const template = templates.find(item => item.code === templateCode);
  const optionDefs = useMemo(() => {
    const map = new Map<string, { label: string; templates: string[] }>();
    templates.forEach(item => item.options.forEach(option => {
      const entry = map.get(option.key) || { label: option.label, templates: [] };
      entry.templates.push(item.name);
      map.set(option.key, entry);
    }));
    return [...map.entries()].map(([key, value]) => ({ key, ...value }));
  }, [templates]);
  const option = optionDefs.find(item => item.key === optionKey);

  const action: BulkAction | null = kind === 'template' ? (templateCode ? { kind, templateCode, options: templateOptions } : null)
    : kind === 'option' ? (optionKey ? { kind, optionKey, on: optionOn } : null)
    : kind === 'extend' ? { kind, withinDays: 30 }
    : permission ? { kind, permissionCode: permission.code, scopeType: permission.scopeType } : null;
  const actionKey = JSON.stringify(action);
  const actionLabel = kind === 'template' ? `gắn mẫu ${template?.name || ''}${templateOptions.length ? ` + ${templateOptions.map(key => template?.options.find(item => item.key === key)?.label || key).join(', ')}` : ''}`
    : kind === 'option' ? `${optionOn ? 'tích' : 'bỏ tích'} ô ${option?.label || ''}`
    : kind === 'extend' ? 'gia hạn 1 năm quyền sắp hết hạn'
    : `thêm quyền ${permission ? `${permission.module}: ${permission.label}` : ''}`;

  // Danh mục quyền chỉ tải khi chọn "Thêm một quyền".
  useEffect(() => {
    if (kind !== 'add' || catalog || catalogState === 'loading') return;
    setCatalogState('loading');
    permissionBulkService.grantableCatalog()
      .then(items => { setCatalog(items); setCatalogState('idle'); })
      .catch(error => { logApiError('permissionBulk.catalog', error); setCatalogState('error'); });
  }, [kind, catalog, catalogState]);

  // Xem trước từng người khi tới bước 3 (và khi đổi việc).
  useEffect(() => {
    if (step !== 3 || !action || !selected.length) return undefined;
    let cancelled = false;
    setPreviewState('loading'); setRows(null); setResult(null); setApplyError('');
    permissionBulkService.previewBulk(selected, action)
      .then(next => {
        if (cancelled) return;
        setRows(next); setPreviewState('idle'); setAck(emptySodAcknowledgement());
      })
      .catch(error => {
        if (cancelled) return;
        logApiError('permissionBulk.preview', error);
        setPreviewError(getApiErrorMessage(error, 'Chưa xem trước được.')); setPreviewState('error');
      });
    return () => { cancelled = true; };
  }, [step, actionKey, selected.join('|')]);

  const applyRows = (rows || []).filter(row => !row.skip);
  const warnedIds = applyRows.filter(row => row.warnings.length).map(row => row.userId);
  const warnings = applyRows.flatMap(row => row.warnings);
  const ackIssue = warnings.length
    ? (warnedIds.includes(ack.controlOwnerUserId) ? 'Người kiểm soát phải khác người được cấp quyền.' : sodAcknowledgementIssue(ack, actorUserId, warnedIds[0]))
    : '';
  const ownerCandidates = candidates.filter(candidate => !warnedIds.includes(candidate.id));
  const totals = applyRows.reduce((sum, row) => ({ add: sum.add + row.add, remove: sum.remove + row.remove, extended: sum.extended + row.extended }), { add: 0, remove: 0, extended: 0 });

  const nextBlock = step === 1 ? (selected.length ? '' : 'Chọn ít nhất một người')
    : step === 2 ? (action ? '' : kind === 'template' ? 'Chọn mẫu' : kind === 'option' ? 'Chọn ô cần tích' : 'Chọn một quyền')
    : previewState === 'loading' ? 'Đang xem trước'
    : !rows || previewState === 'error' ? 'Chưa xem trước được'
    : !applyRows.length ? 'Không có ai cần đổi'
    : ackIssue;
  const busy = Boolean(progress);

  const apply = async () => {
    if (!action || nextBlock) return;
    setApplyError(''); setProgress({ done: 0, total: applyRows.length });
    try {
      const next = await permissionBulkService.applyBulk(applyRows.map(row => row.userId), action,
        `Phân quyền hàng loạt — ${actionLabel}: ${reason}`, warnings.length ? ack : null,
        (done, total) => setProgress({ done, total }));
      setResult({ ...next, skipped: [...next.skipped, ...(rows || []).filter(row => row.skip).map(row => ({ userId: row.userId, name: row.name, note: row.note || 'Không cần đổi' }))] });
      setProgress(null);
      await onApplied();
    } catch (error) {
      logApiError('permissionBulk.apply', error);
      setApplyError(getApiErrorMessage(error, 'Chưa áp được. Quyền của mọi người giữ nguyên.'));
    } finally {
      setProgress(null);
    }
  };

  const restart = () => { setResult(null); setRows(null); setSelected([]); setStep(1); setPermission(null); };
  const catalogMatches = useMemo(() => searchGrantable(catalog || [], catalogQuery), [catalog, catalogQuery]);
  const expiringSelected = people.filter(person => selected.includes(person.userId) && person.expiringSoon > 0).length;

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-x-5 rounded-2xl border border-border bg-card px-4 py-3" aria-label="Các bước">
        {STEPS.map((label, index) => {
          const no = (index + 1) as 1 | 2 | 3;
          const on = step === no;
          const done = step > no;
          return (
            <li key={label}>
              <button type="button" onClick={() => done && !busy && !result && setStep(no)} disabled={!done || busy || Boolean(result)} aria-current={on ? 'step' : undefined}
                className="flex items-center gap-2 disabled:cursor-default">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${on || done ? 'bg-teal-700 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {done ? <Check size={14} /> : no}
                </span>
                <span className={`text-sm ${on ? 'font-bold text-foreground' : 'hidden font-medium text-muted-foreground sm:inline'}`}>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="rounded-2xl border border-border bg-card p-4">
        {step === 1 && (
          <PermissionPeoplePicker people={people} templates={templates} selected={selected} onChange={setSelected} />
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Việc cần làm" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {KINDS.map(item => {
                const on = kind === item.kind;
                return (
                  <button key={item.kind} type="button" role="radio" aria-checked={on} onClick={() => setKind(item.kind)}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left ${on ? 'border-teal-600 bg-teal-50/60 ring-2 ring-teal-600/15' : 'border-border bg-background hover:border-teal-300'}`}>
                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-teal-700 text-white' : 'bg-teal-50 text-teal-700'}`}><item.icon size={18} /></span>
                    <span className="min-w-0"><span className="block font-semibold text-foreground">{item.title}</span><span className="block text-xs text-muted-foreground">{item.desc}</span></span>
                  </button>
                );
              })}
            </div>

            {kind === 'template' && (
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-muted-foreground">Gắn vào mẫu</span>
                <div className="flex flex-wrap gap-1.5">
                  {templates.map(item => {
                    const on = templateCode === item.code;
                    const color = templateColor(item.code);
                    return (
                      <button key={item.code} type="button" aria-pressed={on} onClick={() => { setTemplateCode(item.code); setTemplateOptions([]); }}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold"
                        style={on ? { background: color.solid, borderColor: color.solid, color: '#ffffff' } : undefined}>
                        <TemplateDot code={item.code} light={on} />{item.name}
                      </button>
                    );
                  })}
                </div>
                {template?.options.map(item => (
                  <label key={item.key} className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border p-2.5">
                    <input type="checkbox" checked={templateOptions.includes(item.key)} className="mt-0.5 h-4 w-4 accent-teal-700"
                      onChange={() => setTemplateOptions(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])} />
                    <span><span className="block text-sm font-semibold text-foreground">{item.label}</span>{item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}</span>
                  </label>
                ))}
              </div>
            )}

            {kind === 'option' && (
              <div className="space-y-2">
                <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Tích hay bỏ">
                  {[[true, 'Tích ô'], [false, 'Bỏ tích']].map(([value, label]) => (
                    <button key={String(value)} type="button" role="radio" aria-checked={optionOn === value} onClick={() => setOptionOn(Boolean(value))}
                      className={`min-h-9 rounded-md px-3 text-sm font-semibold ${optionOn === value ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {optionDefs.map(item => (
                    <button key={item.key} type="button" aria-pressed={optionKey === item.key} onClick={() => setOptionKey(item.key)}
                      className={`rounded-xl border p-3 text-left ${optionKey === item.key ? 'border-teal-600 bg-teal-50/60' : 'border-border bg-background hover:border-teal-300'}`}>
                      <span className="block font-semibold text-foreground">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">Có ở mẫu: {item.templates.join(', ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {kind === 'extend' && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                {expiringSelected
                  ? `${expiringSelected} người đã chọn có quyền hết hạn trong 30 ngày. Quyền đó được gia hạn thêm 1 năm, quyền khác giữ nguyên.`
                  : 'Chưa ai trong nhóm đã chọn có quyền hết hạn trong 30 ngày — xem trước sẽ báo "Không có quyền sắp hết hạn".'}
              </p>
            )}

            {kind === 'add' && (
              <div className="space-y-2">
                <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-500/40">
                  <Search size={16} className="text-muted-foreground" />
                  <span className="sr-only">Tìm quyền</span>
                  <input value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} placeholder="Tìm quyền: xuất báo cáo, duyệt chấm công…" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
                </label>
                {catalogState === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang tải danh mục quyền…</p>}
                {catalogState === 'error' && <p role="alert" className="text-sm font-semibold text-rose-700">Chưa tải được danh mục quyền. <button type="button" className="underline" onClick={() => setCatalogState('idle')}>Thử lại</button></p>}
                {permission && (
                  <p className="flex flex-wrap items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900">
                    <CheckCircle2 size={15} /> {permission.module}: {permission.label}
                    <span className="font-normal text-teal-800">· {permission.scopeType === 'own' ? 'của mình' : 'toàn công ty'}</span>
                  </p>
                )}
                <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                  {catalogMatches.map(item => (
                    <button key={`${item.code}@${item.scopeType}`} type="button" aria-pressed={permission?.code === item.code} onClick={() => setPermission(item)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${permission?.code === item.code ? 'bg-teal-50 font-semibold text-teal-900' : 'hover:bg-muted'}`}>
                      <span className="min-w-0 flex-1"><span className="text-muted-foreground">{item.module}:</span> {item.label}</span>
                      {item.sensitive && <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Nhạy cảm</span>}
                    </button>
                  ))}
                  {catalog && catalogMatches.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground">Không có quyền khớp. Quyền theo dự án / kho cấp ở "Chỉnh chi tiết".</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground">
              {selected.length} người · {actionLabel}
              {rows && <span className="font-normal text-muted-foreground"> — {applyRows.length} người sẽ đổi{totals.add ? `, thêm ${totals.add}` : ''}{totals.remove ? `, gỡ ${totals.remove}` : ''}{totals.extended ? `, gia hạn ${totals.extended}` : ''} quyền</span>}
            </p>
            {previewState === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Đang xem trước từng người…</p>}
            {previewState === 'error' && <p role="alert" className="text-sm font-semibold text-rose-700">{previewError}</p>}
            {rows && (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_56px_56px_minmax(0,1.4fr)] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-bold text-muted-foreground md:grid">
                  <span>Người</span><span>Hiện tại</span><span>Sau khi áp</span><span className="text-right">Thêm</span><span className="text-right">Gỡ</span><span>Lưu ý</span>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map(row => {
                    const person = people.find(item => item.userId === row.userId);
                    const toName = kind === 'template' ? (row.toTemplate || template?.name || '') : row.fromTemplate || 'Chưa gắn mẫu';
                    const note = row.skip ? row.note : row.warnings.length ? 'Kiêm nhiệm — cần ghi nhận' : row.extended ? `Gia hạn ${row.extended} quyền` : '—';
                    return (
                      <li key={row.userId} className={`grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_56px_56px_minmax(0,1.4fr)] md:items-center ${row.skip ? 'bg-muted/30' : ''}`}>
                        <span className="col-span-2 min-w-0 md:col-span-1">
                          <span className="block truncate font-semibold text-foreground">{row.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{person?.position || 'Chưa có chức danh'}</span>
                        </span>
                        <span className="min-w-0"><TemplateChip code={person?.templateCode || null} name={row.fromTemplate || 'Chưa gắn mẫu'} /></span>
                        <span className="min-w-0">
                          {kind === 'template' ? <TemplateChip code={templateCode} name={toName} /> : <span className="text-xs text-muted-foreground">{row.skip ? 'Giữ nguyên' : toName}</span>}
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-leaf-700 md:text-right md:text-sm">{row.add ? `+${row.add}` : <span className="text-muted-foreground">0</span>}<span className="text-muted-foreground md:hidden"> thêm</span></span>
                        <span className="text-xs font-semibold tabular-nums text-rose-700 md:text-right md:text-sm">{row.remove ? `−${row.remove}` : <span className="text-muted-foreground">0</span>}<span className="text-muted-foreground md:hidden"> gỡ</span></span>
                        <span className={`col-span-2 md:col-span-1 ${note === '—' ? 'hidden md:block' : ''}`}>
                          <span className={row.warnings.length && !row.skip ? 'inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800' : 'text-xs text-muted-foreground'}>{note}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {warnings.length > 0 && !result && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900"><AlertTriangle size={14} /> {warnedIds.length} người sẽ kiêm nhiệm — một lần ghi nhận dùng cho cả nhóm</p>
                <SodRuleList warnings={warnings} />
                <SodAcknowledgeFields warnings={warnings} value={ack} onChange={setAck} candidates={ownerCandidates} disabled={busy} />
              </div>
            )}
            {rows && applyRows.length > 0 && !result && <ReasonChips value={reason} onChange={setReason} label="Lý do (ghi vào nhật ký từng người)" disabled={busy} />}
            {applyError && <p role="alert" className="text-sm font-semibold text-rose-700">{applyError}</p>}
            {result && <ApplyResultBox result={result} nameOf={nameOf} doneText={`Đã áp cho ${result.done.length} người. Mỗi người một dòng nhật ký: “${reason}”.`} />}
          </div>
        )}
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="basis-full text-sm font-semibold text-foreground sm:mr-auto sm:basis-auto">
          {progress ? `Đang áp ${progress.done}/${progress.total} người…` : `Đã chọn ${selected.length} người`}
        </span>
        {result ? (
          <button type="button" onClick={restart} className={`${primaryBtn} min-h-10 flex-1 sm:flex-none`}>Làm lượt khác</button>
        ) : (
          <>
            {step > 1 && <button type="button" onClick={() => setStep((step - 1) as 1 | 2)} disabled={busy} className={`${secondaryBtn} min-h-10 flex-1 sm:flex-none`}><ArrowLeft size={15} /> Quay lại</button>}
            {step < 3 ? (
              <button type="button" onClick={() => setStep((step + 1) as 2 | 3)} disabled={Boolean(nextBlock)} title={nextBlock || undefined} className={`${primaryBtn} min-h-10 flex-[2_1_0%] sm:flex-none`}>
                {step === 1 ? 'Tiếp: chọn việc' : 'Tiếp: xem trước'} <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" onClick={() => void apply()} disabled={Boolean(nextBlock) || busy} title={nextBlock || undefined} className={`${primaryBtn} min-h-10 flex-[2_1_0%] sm:flex-none`}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Áp dụng cho {applyRows.length} người
              </button>
            )}
          </>
        )}
        {step === 3 && nextBlock && !busy && !result && previewState === 'idle' && rows && <span className="basis-full text-right text-xs text-muted-foreground">{nextBlock}</span>}
      </div>
    </div>
  );
};

export default PermissionBulkTab;
