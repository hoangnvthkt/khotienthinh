import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import type { CapabilityRow, CenterPerson, CenterTemplate } from '../../../lib/permissions/permissionCenterService';
import { emptySodAcknowledgement, sodAcknowledgementIssue, toSodAcceptances, type SodAcknowledgement } from '../../../lib/permissions/sodService';
import { userTemplateAssignmentService, type TemplateAssignmentPreview } from '../../../lib/userTemplateAssignmentService';
import { primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { SodAcknowledgeFields, SodRuleList, type SodControlOwnerCandidate } from '../SodAcknowledge';
import { CapabilityList, PersonAvatar, ReasonChips, SAVE_REASONS, TemplateChip, optionLabels } from './PermissionCenterParts';

interface PermissionPersonPanelProps {
  person: CenterPerson;
  templates: readonly CenterTemplate[];
  baseRows: readonly CapabilityRow[];
  candidates: readonly SodControlOwnerCandidate[];
  actorUserId: string | null;
  /** Hiện nút đóng (ngăn bên phải trên máy tính). Trên điện thoại ngăn nằm trong Drawer có nút đóng sẵn. */
  onClose?: () => void;
  onOpenDetail: () => void;
  onSaved: () => void | Promise<void>;
  /** Mở Sao chép với người này làm mẫu. */
  onCopyFrom?: () => void;
}

const Section: React.FC<{ no: number; title: string; children: React.ReactNode }> = ({ no, title, children }) => (
  <section className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs text-white">{no}</span>{title}
    </h3>
    {children}
  </section>
);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(item => b.includes(item));

/** Ngăn "Theo người": mẫu + ô tích (đổi có xem trước), làm được gì, khác mẫu, quyền ở chỗ khác. */
const PermissionPersonPanel: React.FC<PermissionPersonPanelProps> = ({
  person, templates, baseRows, candidates, actorUserId, onClose, onOpenDetail, onSaved, onCopyFrom,
}) => {
  const [code, setCode] = useState<string>(person.templateCode || '');
  const [options, setOptions] = useState<string[]>(person.options);
  const [showBase, setShowBase] = useState(false);
  const [preview, setPreview] = useState<TemplateAssignmentPreview | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reason, setReason] = useState<string>(SAVE_REASONS[0]);
  const [ack, setAck] = useState<SodAcknowledgement>(() => emptySodAcknowledgement());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    setCode(person.templateCode || ''); setOptions(person.options); setShowBase(false);
    setPreview(null); setPreviewState('idle'); setError(''); setDone(''); setReason(SAVE_REASONS[0]);
  }, [person.userId, person.templateCode, person.options.join('|')]);

  const current = templates.find(template => template.code === person.templateCode);
  const draft = templates.find(template => template.code === code);
  const changed = Boolean(code) && (code !== (person.templateCode || '') || !sameSet(options, person.options));

  // Xem trước ngay khi đổi mẫu / ô tích: số quyền thêm, gỡ và cảnh báo kiêm nhiệm của đúng người này.
  useEffect(() => {
    if (!changed || !code) { setPreview(null); setPreviewState('idle'); return; }
    let cancelled = false;
    setPreviewState('loading');
    userTemplateAssignmentService.preview(person.userId, code, options)
      .then(result => {
        if (cancelled) return;
        setPreview(result); setPreviewState('idle');
        const owner = candidates.some(candidate => candidate.id === result.sod.defaultControlOwnerId) ? result.sod.defaultControlOwnerId : null;
        setAck(emptySodAcknowledgement(owner));
      })
      .catch(previewError => {
        if (cancelled) return;
        logApiError('permissionCenter.preview', previewError);
        setPreviewState('error');
      });
    return () => { cancelled = true; };
  }, [changed, code, options.join('|'), person.userId]);

  const sodWarnings = preview?.sod.warnings || [];
  const sodIssue = sodWarnings.length ? sodAcknowledgementIssue(ack, actorUserId, person.userId) : '';
  const saveBlock = !changed ? 'Chưa có thay đổi'
    : previewState === 'loading' ? 'Đang tính thay đổi'
    : previewState === 'error' || !preview ? 'Chưa xem trước được thay đổi'
    : sodIssue;

  const save = async () => {
    if (!draft || saveBlock) return;
    setSaving(true); setError('');
    try {
      const result = await userTemplateAssignmentService.save(person.userId, draft.code, options,
        `Trung tâm phân quyền: ${reason} — mẫu "${draft.name}"`,
        sodWarnings.length ? toSodAcceptances(sodWarnings, ack) : []);
      setDone(`Đã lưu: thêm ${result.added}, gỡ ${result.removed} quyền.`);
      await onSaved();
    } catch (saveError) {
      logApiError('permissionCenter.save', saveError);
      setError(getApiErrorMessage(saveError, 'Không lưu được.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleOption = (key: string) => {
    setDone('');
    setOptions(currentOptions => currentOptions.includes(key) ? currentOptions.filter(item => item !== key) : [...currentOptions, key]);
  };

  const places = useMemo(() => {
    const conflict = person.conflicts[0];
    return [
      { label: 'Room dự án', value: person.roomProjects ? `${person.roomProjects} dự án` : 'Chưa vào Room nào', hint: person.roomProjects ? 'Việc dự án theo vai trò trong Room' : 'Thêm ở Room của từng dự án', warn: false },
      { label: 'Thủ kho', value: person.warehouses.length ? person.warehouses.join(', ') : 'Không', hint: person.warehouses.length ? 'Gán ở Phân quyền kho' : 'Không giữ kho nào', warn: false },
      { label: 'Vai trò nhân sự', value: person.hrRoles.length ? person.hrRoles.join(', ') : 'Không', hint: person.hrRoles.length ? 'Gán ở Vai trò đặc biệt' : 'Chỉ dữ liệu của mình', warn: false },
      {
        label: 'Kiêm nhiệm',
        value: conflict ? conflict.rule : 'Không',
        hint: conflict
          ? `${conflict.scope}${conflict.until ? ` · ${conflict.controlOwner || 'người kiểm soát'} đến ${new Date(conflict.until).toLocaleDateString('vi-VN')}` : ' · chưa ghi nhận'}`
          : 'Không chạm luật kiêm nhiệm',
        warn: Boolean(conflict),
      },
    ];
  }, [person]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
        <PersonAvatar person={person} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-foreground">{person.name}</h2>
          <p className="text-sm text-muted-foreground">{person.position || 'Chưa có chức danh'} · {person.department || 'Chưa có phòng'}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <TemplateChip code={person.templateCode} name={current?.name || 'Chưa gắn mẫu'} />
            {optionLabels(person, current).map(label => <span key={label} className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground">{label}</span>)}
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{person.grantCount} quyền</span>
          </div>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <Section no={1} title="Mẫu theo vị trí">
          <label className="block">
            <span className="sr-only">Mẫu quyền</span>
            <select value={code} onChange={event => { setCode(event.target.value); setOptions([]); setDone(''); }}
              className="min-h-10 w-full rounded-lg border border-border bg-background px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/40">
              {!person.templateCode && <option value="">Chưa gắn mẫu — chọn mẫu</option>}
              {templates.map(template => <option key={template.code} value={template.code}>{template.name} · {template.people} người</option>)}
            </select>
          </label>
          {draft?.options.map(option => (
            <label key={option.key} className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border p-2.5">
              <input type="checkbox" checked={options.includes(option.key)} onChange={() => toggleOption(option.key)} className="mt-0.5 h-4 w-4 accent-teal-700" />
              <span><span className="block text-sm font-semibold text-foreground">{option.label}</span>{option.description && <span className="block text-xs text-muted-foreground">{option.description}</span>}</span>
            </label>
          ))}
          {!changed && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {person.templateCode ? `Đang theo mẫu "${current?.name}". Sửa mẫu là cập nhật người này; phần chỉnh riêng được giữ.` : 'Người này chưa theo mẫu nào. Chọn mẫu để quyền tự cập nhật theo vị trí.'}
            </p>
          )}
          {changed && previewState === 'loading' && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Đang tính thay đổi…</p>}
          {changed && previewState === 'error' && <p role="alert" className="text-xs font-semibold text-rose-700">Chưa xem trước được thay đổi. Thử chọn lại mẫu.</p>}
          {changed && preview && (
            <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900">
              Sẽ thêm {preview.add.length} quyền, gỡ {preview.remove.length} quyền mẫu cũ. Quyền ngoài mẫu giữ nguyên.
            </p>
          )}
          {changed && sodWarnings.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900"><AlertTriangle size={14} /> Thay đổi này làm người này kiêm nhiệm — ghi nhận trước khi lưu</p>
              <SodRuleList warnings={sodWarnings} />
              <SodAcknowledgeFields warnings={sodWarnings} value={ack} onChange={setAck} candidates={candidates} disabled={saving} />
            </div>
          )}
          {changed && <ReasonChips value={reason} onChange={setReason} />}
        </Section>

        <Section no={2} title="Làm được gì">
          {draft && draft.summary.length > 0 && draft.code !== 'basic_employee' && <CapabilityList rows={draft.summary} code={draft.code} />}
          {draft?.code === 'basic_employee' || !draft
            ? <CapabilityList rows={baseRows} code="basic_employee" />
            : (
              <>
                <button type="button" onClick={() => setShowBase(value => !value)} aria-expanded={showBase} className={`${secondaryBtn} min-h-9 text-xs`}>
                  {showBase ? 'Ẩn việc cơ bản' : `Xem việc cơ bản của mọi nhân viên (${baseRows.length})`}
                </button>
                {showBase && <div className="rounded-lg bg-muted/50 p-3"><CapabilityList rows={baseRows} code="basic_employee" /></div>}
              </>
            )}
        </Section>

        <Section no={3} title="Khác mẫu">
          {person.extraCount === 0 && person.templateCode && (
            <p className="flex items-center gap-2 rounded-lg bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-800"><CheckCircle2 size={16} /> Đúng theo mẫu, không có quyền riêng.</p>
          )}
          {person.extraCount > 0 && (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold text-foreground">Có {person.extraCount} quyền riêng ngoài mẫu</p>
              <div className="flex flex-wrap gap-1">
                {person.extra.map(label => <span key={label} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{label}</span>)}
                {person.extraCount > person.extra.length && <span className="px-1 py-0.5 text-xs text-muted-foreground">và {person.extraCount - person.extra.length} quyền khác</span>}
              </div>
            </div>
          )}
          {person.sensitive.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <p className="flex flex-wrap justify-between gap-1 text-sm font-semibold text-foreground">Quyền nhạy cảm ({person.sensitive.length})<span className="text-xs font-normal text-muted-foreground">Admin cấp riêng, có hạn</span></p>
              <div className="flex flex-wrap gap-1">
                {person.sensitive.map(label => <span key={label} className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-900">{label}</span>)}
              </div>
            </div>
          )}
        </Section>

        <Section no={4} title="Ở chỗ khác">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {places.map(place => (
              <div key={place.label} className={`rounded-lg border p-2.5 ${place.warn ? 'border-amber-300 bg-amber-50' : 'border-border bg-background'}`}>
                <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{place.label}</span>
                <span className="block text-sm font-semibold text-foreground">{place.value}</span>
                <span className="block text-xs text-muted-foreground">{place.hint}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-3">
        <button type="button" onClick={onOpenDetail} className={`${secondaryBtn} min-h-10 flex-1 md:flex-none`}>
          <SlidersHorizontal size={15} /> Chỉnh chi tiết
        </button>
        {onCopyFrom && (
          <button type="button" onClick={onCopyFrom} className={`${secondaryBtn} min-h-10 flex-1 md:flex-none`}>
            <Copy size={15} /> Sao chép sang người khác
          </button>
        )}
        <button type="button" onClick={() => void save()} disabled={Boolean(saveBlock) || saving} title={saveBlock || undefined}
          className={`${primaryBtn} min-h-10 flex-1 md:ml-auto md:flex-none`}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Lưu thay đổi
        </button>
        {error && <p role="alert" className="basis-full text-xs font-semibold text-rose-700">{error}</p>}
        {done && <p role="status" className="basis-full text-xs font-semibold text-leaf-800">{done}</p>}
      </div>
    </div>
  );
};

export default PermissionPersonPanel;
