import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, Info, LockKeyhole, PencilLine, Table2 } from 'lucide-react';
import { Badge, StateBox, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { MISSING_CHIP, NUM } from './roster/rosterUi';
import { hrmPersonnelProfileService } from '../../lib/hrmPersonnelProfileService';
import {
  formatCustomValue, groupProfileCustomFields, isEmptyCustomValue, rosterBatchLink, rosterPersonLink, summarizeProfileCustomFields,
  type ProfileCustomField, type ProfileCustomFields,
} from '../../lib/hrmProfileCustomFields';

export type ProfileCustomFieldsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ProfileCustomFields };

/** Reads the extra columns of one person when the viewer may (self, HR); null while not asked. */
export const useProfileCustomFields = (employeeId: string | null | undefined, enabled: boolean) => {
  const [state, setState] = useState<ProfileCustomFieldsState | null>(null);
  const token = useRef(0);
  const load = useCallback(async () => {
    const mine = ++token.current;
    if (!employeeId || !enabled) { setState(null); return; }
    setState(current => (current?.status === 'ready' && current.data.employeeId === employeeId ? current : { status: 'loading' }));
    try {
      const data = await hrmPersonnelProfileService.getCustomFields(employeeId);
      if (mine === token.current) setState({ status: 'ready', data });
    } catch (error) {
      if (mine === token.current) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không thể tải thông tin thêm.' });
    }
  }, [employeeId, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { state, reload: load };
};

const BOOL_STYLE: Record<string, string> = {
  'Có': 'border-mint-200 bg-mint-50 text-mint-800 dark:border-mint-900 dark:bg-mint-950/40 dark:text-mint-200',
  'Không': 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const FieldValue: React.FC<{ field: ProfileCustomField; hr: boolean }> = ({ field, hr }) => {
  if (isEmptyCustomValue(field.value)) {
    return field.required && hr
      ? <span className={MISSING_CHIP}>Thiếu</span>
      : <span className="text-sm text-muted-foreground">Chưa có</span>;
  }
  const text = formatCustomValue(field.type, field.value);
  if (field.type === 'boolean') return <Badge className={BOOL_STYLE[text] || BOOL_STYLE['Không']}>{text}</Badge>;
  const numeric = field.type === 'money' || field.type === 'number';
  return <span className={`break-words text-sm ${numeric ? NUM : 'font-semibold text-foreground'}`}>{text}</span>;
};

const FieldRow: React.FC<{ field: ProfileCustomField; hr: boolean; onOpenBatch: (batchId: string) => void }> = ({ field, hr, onOpenBatch }) =>
  <div className="flex items-start justify-between gap-4 px-4 py-2.5">
    <dt className="flex min-w-0 items-center gap-1.5 pt-0.5 text-sm text-muted-foreground">
      <span className="break-words">{field.label}</span>
      {field.payOnly && field.group !== 'pay' && <LockKeyhole size={12} className="shrink-0 text-leaf-600 dark:text-leaf-400" aria-label="Chỉ HR Manage xem" />}
      {field.hint && <span title={field.hint} className="shrink-0 text-muted-foreground/70"><Info size={13} aria-label={field.hint} /></span>}
    </dt>
    <dd className="flex min-w-0 max-w-[60%] flex-col items-end gap-1 text-right">
      <FieldValue field={field} hr={hr} />
      {field.pending && <button type="button" onClick={() => onOpenBatch(field.pending!.batchId)}
        title={`Mở phiếu ${field.pending.batchCode}`}
        className="inline-flex max-w-full items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-px text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Clock3 size={11} className="shrink-0" />
        <span className="truncate">Chờ duyệt → {formatCustomValue(field.type, field.pending.value) || 'để trống'}</span>
      </button>}
    </dd>
  </div>;

/**
 * "Thông tin thêm" of one person: the columns HR added in Cấu hình of Bảng nhân sự, grouped like the table.
 * Read only; HR changes a value in Bảng nhân sự, where every change goes through an approved request.
 */
const ProfileCustomFieldsPanel: React.FC<{ state: ProfileCustomFieldsState | null; onRetry: () => void }> = ({ state, onRetry }) => {
  const navigate = useNavigate();
  if (!state || state.status === 'loading') return <StateBox kind="loading" title="Đang tải thông tin thêm…" />;
  if (state.status === 'error') {
    const denied = /quyền/.test(state.message);
    return <StateBox kind={denied ? 'denied' : 'error'} title={denied ? 'Không có quyền xem thông tin thêm' : 'Chưa tải được thông tin thêm'}
      message={state.message} onRetry={denied ? undefined : onRetry} />;
  }

  const { data } = state;
  const hr = data.accessLevel !== 'SELF';
  const groups = groupProfileCustomFields(data.fields);
  const counts = summarizeProfileCustomFields(data.fields);
  const openRoster = () => navigate(rosterPersonLink(data.employeeId));
  const hiddenNote = data.hiddenPayCount > 0 && <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
    <LockKeyhole size={12} /> {data.hiddenPayCount} cột lương chỉ HR Manage xem</p>;

  if (data.fields.length === 0) {
    return <div className="space-y-2">
      <StateBox kind="empty" title={hr ? 'Chưa có cột thông tin thêm' : 'Chưa có thông tin thêm'}
        message={hr ? (data.can.configure ? 'Tạo cột ở Bảng nhân sự → Cấu hình.' : 'Admin hoặc HR Manage tạo cột ở Bảng nhân sự → Cấu hình.') : undefined} />
      {hr && (data.can.edit || data.can.configure) && <div className="flex justify-center">
        <button type="button" onClick={() => navigate('/hrm/employees?view=roster')} className={`${secondaryBtn} bg-card`}><Table2 size={15} />Mở Bảng nhân sự</button>
      </div>}
      {hiddenNote}
    </div>;
  }

  return <section className="space-y-3" aria-label="Thông tin thêm">
    {hr && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-foreground">Thông tin thêm</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span><b className="tabular-nums text-foreground">{counts.total}</b> cột</span>
          {counts.missing > 0 && <span className={MISSING_CHIP}>Thiếu {counts.missing}</span>}
          {counts.pending > 0 && <span className="rounded-md bg-indigo-50 px-1.5 py-px text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">Chờ duyệt {counts.pending}</span>}
        </p>
      </div>
      {data.can.edit && <button type="button" onClick={openRoster} className={`${primaryBtn} w-full sm:w-auto`}
        title="Mở người này ở Bảng nhân sự; thay đổi gửi phiếu duyệt">
        <PencilLine size={15} />Đổi ở Bảng nhân sự</button>}
    </div>}

    <div className="grid gap-3 lg:grid-cols-2">
      {groups.map(group => <section key={group.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${group.tone}`}>
            {group.key === 'pay' && <LockKeyhole size={11} />}{group.label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{group.fields.length} cột</span>
        </header>
        <dl className="divide-y divide-border">
          {group.fields.map(field => <FieldRow key={field.id} field={field} hr={hr} onOpenBatch={id => navigate(rosterBatchLink(id))} />)}
        </dl>
      </section>)}
    </div>

    {hiddenNote}
    {!hr && <p className="px-1 text-xs text-muted-foreground">Thông tin sai? Báo HR để sửa.</p>}
  </section>;
};

export default ProfileCustomFieldsPanel;
