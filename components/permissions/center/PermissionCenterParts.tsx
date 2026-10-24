import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Building2, CheckCircle2, ChevronRight, FolderKanban, HeartPulse, Landmark, MapPin, MinusCircle, Network, ShieldCheck } from 'lucide-react';
import type { BulkApplyResult } from '../../../lib/permissions/permissionBulkService';
import { initialOf, templateColor, type CapabilityRow, type CenterPerson, type CenterTemplate } from '../../../lib/permissions/permissionCenterService';

export const PersonAvatar: React.FC<{ person: Pick<CenterPerson, 'name' | 'avatar' | 'templateCode'>; size?: number }> = ({ person, size = 36 }) => {
  const color = templateColor(person.templateCode);
  if (person.avatar) {
    return <img src={person.avatar} alt="" loading="lazy" width={size} height={size}
      className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, boxShadow: `0 0 0 2px ${color.solid}` }} />;
  }
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: color.solid }}>{initialOf(person.name)}</span>;
};

export const TemplateChip: React.FC<{ code: string | null; name: string }> = ({ code, name }) => {
  const color = templateColor(code);
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
    style={{ background: color.tint, color: color.text }}>{name}</span>;
};

export const TemplateDot: React.FC<{ code: string | null; light?: boolean }> = ({ code, light }) =>
  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: light ? '#ffffff' : templateColor(code).solid }} />;

export const optionLabels = (person: CenterPerson, template: CenterTemplate | undefined) =>
  person.options.map(key => template?.options.find(option => option.key === key)?.label || key);

/** Thẻ một người trong Toàn cảnh: ai, chức danh, mẫu, nhãn cần chú ý. */
export const PersonCard: React.FC<{ person: CenterPerson; template: CenterTemplate | undefined; selected: boolean; onOpen: () => void }> = ({ person, template, selected, onOpen }) => {
  const color = templateColor(person.templateCode);
  return (
    <button type="button" onClick={onOpen} aria-pressed={selected}
      className={`flex w-full items-start gap-2.5 rounded-xl border bg-card p-2.5 text-left transition hover:border-teal-300 ${selected ? 'border-teal-600 ring-2 ring-teal-600/20' : 'border-border'}`}>
      <PersonAvatar person={person} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold text-foreground">{person.name}</span>
        <span className="truncate text-xs text-muted-foreground">{person.position || 'Chưa có chức danh'}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          <TemplateChip code={person.templateCode} name={template?.name || 'Chưa gắn mẫu'} />
          {optionLabels(person, template).map(label => (
            <span key={label} className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: color.solid, color: color.text }}>{label}</span>
          ))}
          {person.conflicts.length > 0 && <span className="inline-flex whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Kiêm nhiệm</span>}
          {person.sensitive.length > 0 && <span className="inline-flex whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Nhạy cảm {person.sensitive.length}</span>}
          {person.extraCount > 0 && <span className="inline-flex whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Ngoài mẫu {person.extraCount}</span>}
        </span>
      </span>
    </button>
  );
};

/** "Làm được gì" bằng lời thường: ô viết tắt màu theo mẫu + tiêu đề + mô tả. */
export const CapabilityList: React.FC<{ rows: readonly CapabilityRow[]; code: string | null }> = ({ rows, code }) => {
  const color = templateColor(code);
  return (
    <ul className="space-y-2">
      {rows.map(row => (
        <li key={`${row.ab}-${row.title}`} className="flex items-start gap-2.5">
          <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
            style={{ background: color.tint, color: color.text }}>{row.ab}</span>
          <span className="min-w-0">
            <span className="block font-semibold text-foreground">{row.title}</span>
            <span className="block text-xs text-muted-foreground">{row.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
};

const OTHER_TOOLS = [
  { to: '/settings/role-templates', icon: ShieldCheck, title: 'Vai trò đặc biệt', text: 'Vai trò nhân sự (HR, HR Manage, xem tổng hợp)' },
  { to: '/settings?tab=project-room-templates', icon: FolderKanban, title: 'Room dự án', text: 'Mẫu vai trò trong từng dự án', route: '/settings' },
  { to: '/wms/owners', icon: Building2, title: 'Phân quyền kho', text: 'Thủ kho, kế toán kho theo từng kho' },
  { to: '/ai?tab=people', icon: Bot, title: 'Trung tâm AI', text: 'Cấp Trợ lý AI theo người', route: '/ai' },
  { to: '/finance/settings', icon: Landmark, title: 'Ma trận duyệt chi', text: 'Ai duyệt đề nghị chi ở mức nào' },
  { to: '/settings/hrm-shared-catalog', icon: Network, title: 'Sơ đồ tổ chức', text: 'Quản lý trực tiếp, trưởng đơn vị' },
  { to: '/settings?tab=attendance-locations', icon: MapPin, title: 'Địa điểm chấm công', text: 'Người duyệt bù công từng nơi', route: '/settings' },
  { to: '/settings/permission-health', icon: HeartPulse, title: 'Kiểm tra hệ quyền', text: 'Lỗi cấu hình quyền cần sửa' },
];

/** Gom lối vào: mọi chỗ khác cũng đang cấp quyền, bấm để mở đúng màn. */
export const OtherPermissionTools: React.FC<{ canOpenRoute: (path: string) => boolean }> = ({ canOpenRoute }) => {
  const tools = OTHER_TOOLS.filter(tool => canOpenRoute(tool.route || tool.to.split('?')[0]));
  if (!tools.length) return null;
  return (
    <section aria-labelledby="other-permission-tools" className="rounded-2xl border border-border bg-card p-4">
      <h2 id="other-permission-tools" className="text-sm font-bold text-foreground">Phân quyền ở chỗ khác</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Những quyền không nằm trong mẫu theo vị trí.</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {tools.map(tool => (
          <Link key={tool.to} to={tool.to}
            className="group flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 transition hover:border-teal-300 hover:bg-teal-50/40">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><tool.icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{tool.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{tool.text}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </section>
  );
};

/** Lý do bấm sẵn (ghi vào nhật ký từng người) — không còn lý do kiểu tên ảnh chụp màn hình. */
export const SAVE_REASONS = ['Theo chức danh', 'Điều chuyển bộ phận', 'Kiêm nhiệm tạm thời', 'Chủ SP duyệt'] as const;

export const ReasonChips: React.FC<{ value: string; onChange: (value: string) => void; label?: string; disabled?: boolean }> = ({ value, onChange, label = 'Lý do (ghi vào nhật ký)', disabled }) => (
  <div className="space-y-1.5">
    <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Lý do">
      {SAVE_REASONS.map(item => (
        <button key={item} type="button" role="radio" aria-checked={value === item} disabled={disabled} onClick={() => onChange(item)}
          className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${value === item ? 'border-teal-700 bg-teal-700 text-white' : 'border-border bg-background text-foreground hover:bg-muted'}`}>{item}</button>
      ))}
    </div>
  </div>
);

/** Kết quả áp hàng loạt / sao chép: đã xong, bỏ qua (kèm vì sao), chưa làm được (kèm lỗi). */
export const ApplyResultBox: React.FC<{ result: BulkApplyResult; doneText: string; nameOf: (userId: string) => string }> = ({ result, doneText, nameOf }) => {
  const name = (row: { userId: string; name: string }) => row.name || nameOf(row.userId);
  return (
    <div className="space-y-2" role="status">
      {result.done.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{doneText}</p>
      )}
      {result.skipped.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground"><MinusCircle size={14} className="mr-1 inline text-muted-foreground" />Bỏ qua {result.skipped.length} người</summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">{result.skipped.map(row => <li key={row.userId}><b className="text-foreground">{name(row)}</b> — {row.note}</li>)}</ul>
        </details>
      )}
      {result.failed.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-semibold text-rose-800"><AlertTriangle size={14} /> Chưa làm được {result.failed.length} người — quyền của họ giữ nguyên</p>
          <ul className="mt-1 space-y-0.5 text-xs text-rose-900">{result.failed.map(row => <li key={row.userId}><b>{name(row)}</b> — {row.error}</li>)}</ul>
        </div>
      )}
    </div>
  );
};
