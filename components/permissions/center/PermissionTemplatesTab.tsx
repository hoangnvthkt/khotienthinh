import React, { useEffect, useState } from 'react';
import { Loader2, PencilLine, Plus, Settings2, Trash2 } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import { permissionCenterService, templateColor, type CapabilityRow, type CenterPerson, type CenterTemplate } from '../../../lib/permissions/permissionCenterService';
import { inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { CapabilityList, PersonAvatar } from './PermissionCenterParts';

interface PermissionTemplatesTabProps {
  templates: readonly CenterTemplate[];
  people: readonly CenterPerson[];
  baseRows: readonly CapabilityRow[];
  selectedCode: string;
  onSelect: (code: string) => void;
  onOpenPerson: (userId: string) => void;
  /** Mở bảng quyền chi tiết của mẫu (màn sửa mẫu hiện có). */
  onEditItems: () => void;
  canEdit: boolean;
  onSummarySaved: () => void | Promise<void>;
}

/** Tab "Theo vị trí": 8 mẫu, mỗi mẫu một màu; mẫu đang chọn hiện làm được gì, ô tích và người đang theo. */
const PermissionTemplatesTab: React.FC<PermissionTemplatesTabProps> = ({
  templates, people, baseRows, selectedCode, onSelect, onOpenPerson, onEditItems, canEdit, onSummarySaved,
}) => {
  const selected = templates.find(template => template.code === selectedCode) || templates[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CapabilityRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setEditing(false); setError(''); }, [selected?.code]);
  if (!selected) return null;

  const color = templateColor(selected.code);
  const members = people.filter(person => person.templateCode === selected.code);
  const rows = selected.code === 'basic_employee' ? baseRows : selected.summary;

  const startEdit = () => { setDraft(rows.map(row => ({ ...row }))); setError(''); setEditing(true); };
  const updateRow = (index: number, patch: Partial<CapabilityRow>) => setDraft(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const saveSummary = async () => {
    const clean = draft.filter(row => row.title.trim());
    setSaving(true); setError('');
    try {
      await permissionCenterService.saveSummary(selected.code, clean);
      setEditing(false);
      await onSummarySaved();
    } catch (saveError) {
      logApiError('permissionCenter.saveSummary', saveError);
      setError(getApiErrorMessage(saveError, 'Không lưu được phần mô tả.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {templates.map(template => {
          const on = template.code === selected.code;
          const c = templateColor(template.code);
          return (
            <button key={template.code} type="button" onClick={() => onSelect(template.code)} aria-pressed={on}
              className={`flex flex-col overflow-hidden rounded-2xl border bg-card text-left transition hover:shadow-sm ${on ? 'ring-2' : 'border-border'}`}
              style={on ? { borderColor: c.solid, boxShadow: `0 0 0 3px ${c.tint}` } : undefined}>
              <span aria-hidden="true" className="block h-1.5" style={{ background: c.solid }} />
              <span className="flex flex-col gap-1 p-3.5">
                <span className="text-base font-bold text-foreground">{template.name}</span>
                <span className="text-xs text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{template.people}</span> người · {template.itemCount} quyền</span>
                {template.description && <span className="line-clamp-2 text-xs text-muted-foreground">{template.description}</span>}
                {template.options.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {template.options.map(option => <span key={option.key} className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: c.solid, color: c.text }}>Ô tích: {option.label}</span>)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-xl" style={{ background: color.solid }} />
          <div className="min-w-[200px] flex-1">
            <h2 className="text-lg font-bold text-foreground">{selected.name}</h2>
            <p className="text-sm text-muted-foreground">{members.length} người đang theo mẫu · {selected.itemCount} quyền</p>
          </div>
          {canEdit && (
            <button type="button" onClick={onEditItems} className={`${secondaryBtn} min-h-10 flex-1 sm:flex-none`}>
              <Settings2 size={15} /> Sửa quyền trong mẫu
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-6 p-4">
          <div className="min-w-0 flex-[1_1_420px] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-foreground">Làm được gì</h3>
              {canEdit && !editing && <button type="button" onClick={startEdit} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"><PencilLine size={14} /> Sửa mô tả</button>}
            </div>
            {!editing && (rows.length ? <CapabilityList rows={rows} code={selected.code} /> : <p className="text-sm text-muted-foreground">Chưa có mô tả bằng lời cho mẫu này.</p>)}
            {editing && (
              <div className="space-y-2">
                {draft.map((row, index) => (
                  <div key={index} className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-2">
                    <label className="w-16"><span className="sr-only">Viết tắt</span>
                      <input value={row.ab} maxLength={3} onChange={event => updateRow(index, { ab: event.target.value })} className={`${inputCls} w-full text-center uppercase`} />
                    </label>
                    <label className="min-w-[140px] flex-1"><span className="sr-only">Việc</span>
                      <input value={row.title} onChange={event => updateRow(index, { title: event.target.value })} placeholder="Việc (ví dụ: Tài chính)" className={`${inputCls} w-full`} />
                    </label>
                    <label className="min-w-[200px] flex-[2_1_200px]"><span className="sr-only">Làm được gì</span>
                      <input value={row.text} onChange={event => updateRow(index, { text: event.target.value })} placeholder="Làm được gì, bằng lời thường" className={`${inputCls} w-full`} />
                    </label>
                    <button type="button" onClick={() => setDraft(current => current.filter((_, i) => i !== index))} aria-label={`Bỏ dòng ${row.title || index + 1}`}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Trash2 size={15} /></button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setDraft(current => [...current, { ab: '', title: '', text: '' }])} className={`${secondaryBtn} min-h-9`}><Plus size={14} /> Thêm dòng</button>
                  <button type="button" onClick={() => setEditing(false)} disabled={saving} className={`${secondaryBtn} min-h-9 sm:ml-auto`}>Thôi</button>
                  <button type="button" onClick={() => void saveSummary()} disabled={saving} className={`${primaryBtn} min-h-9`}>
                    {saving && <Loader2 size={14} className="animate-spin" />} Lưu mô tả
                  </button>
                </div>
                {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
              </div>
            )}
            {selected.options.map(option => (
              <div key={option.key} className="rounded-lg border border-dashed border-border px-3 py-2 text-sm">
                <span className="font-semibold text-foreground">Ô tích: {option.label}</span>
                {option.description && <span className="text-muted-foreground"> — {option.description}</span>}
              </div>
            ))}
            {selected.code !== 'basic_employee' && (
              <p className="text-xs text-muted-foreground">Cộng thêm phần cơ bản của mọi nhân viên: {baseRows.map(row => row.title.toLowerCase()).join(', ')}.</p>
            )}
          </div>

          <div className="min-w-0 flex-[1_1_300px] space-y-2">
            <h3 className="text-sm font-bold text-foreground">Người đang theo mẫu ({members.length})</h3>
            {members.length === 0
              ? <p className="text-sm text-muted-foreground">Chưa có ai theo mẫu này.</p>
              : (
                <div className="flex max-h-80 flex-wrap gap-1.5 overflow-y-auto">
                  {members.map(person => (
                    <button key={person.userId} type="button" onClick={() => onOpenPerson(person.userId)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-sm hover:border-teal-300">
                      <PersonAvatar person={person} size={26} />{person.name}
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default PermissionTemplatesTab;
