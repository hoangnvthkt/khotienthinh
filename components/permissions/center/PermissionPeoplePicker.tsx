import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { filterPeople, NO_DEPARTMENT, type CenterPerson, type CenterTemplate } from '../../../lib/permissions/permissionCenterService';
import { PersonAvatar } from './PermissionCenterParts';

interface PermissionPeoplePickerProps {
  people: readonly CenterPerson[];
  templates: readonly CenterTemplate[];
  selected: readonly string[];
  onChange: (userIds: string[]) => void;
  /** Gợi ý trước (cùng phòng / cùng mẫu); có tìm kiếm thì tìm cả công ty. */
  suggested?: (person: CenterPerson) => boolean;
  disabled?: boolean;
  /** Bỏ người này khỏi danh sách (người nguồn khi sao chép). */
  excludeUserId?: string | null;
}

const ALL = '__all__';

/** Chọn nhiều người: lọc theo phòng ban / công trường, tìm không dấu, chọn cả nhóm. */
const PermissionPeoplePicker: React.FC<PermissionPeoplePickerProps> = ({ people, templates, selected, onChange, suggested, disabled, excludeUserId }) => {
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState<string>(suggested ? '__suggested__' : ALL);
  const candidates = useMemo(() => people.filter(person => person.userId !== excludeUserId), [people, excludeUserId]);
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    candidates.forEach(person => counts.set(person.department || NO_DEPARTMENT, (counts.get(person.department || NO_DEPARTMENT) || 0) + 1));
    return [...counts.entries()].sort(([a], [b]) => (a === NO_DEPARTMENT ? 1 : b === NO_DEPARTMENT ? -1 : a.localeCompare(b, 'vi')));
  }, [candidates]);
  const suggestedPeople = useMemo(() => (suggested ? candidates.filter(suggested) : []), [candidates, suggested]);

  const visible = useMemo(() => {
    const base = query.trim()
      ? filterPeople(candidates, { query, templateCode: null, kpi: 'all' })
      : department === '__suggested__' ? suggestedPeople
      : department === ALL ? candidates
      : candidates.filter(person => (person.department || NO_DEPARTMENT) === department);
    return [...base].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [candidates, suggestedPeople, query, department]);

  const templateName = (code: string | null) => templates.find(template => template.code === code)?.name || 'Chưa gắn mẫu';
  const allVisibleSelected = visible.length > 0 && visible.every(person => selected.includes(person.userId));
  const toggle = (userId: string) => onChange(selected.includes(userId) ? selected.filter(id => id !== userId) : [...selected, userId]);
  const toggleVisible = () => {
    const ids = visible.map(person => person.userId);
    onChange(allVisibleSelected ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const chips: [string, string, number][] = [
    ...(suggested ? [['__suggested__', 'Gợi ý', suggestedPeople.length] as [string, string, number]] : []),
    [ALL, 'Tất cả', candidates.length],
    ...departments.map(([name, count]) => [name, name, count] as [string, string, number]),
  ];

  return (
    <div className="space-y-3">
      <label className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-500/40">
        <Search size={16} className="text-muted-foreground" />
        <span className="sr-only">Tìm người</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên, chức danh, phòng ban…" disabled={disabled}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      {!query.trim() && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
          {chips.map(([key, label, count]) => (
            <button key={key} type="button" aria-pressed={department === key} onClick={() => setDepartment(key)} disabled={disabled}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${department === key ? 'border-teal-700 bg-teal-700 text-white' : 'border-border bg-background text-foreground hover:bg-muted'}`}>
              {label}<span className="tabular-nums opacity-75">{count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{visible.length} người</span>
        {visible.length > 0 && (
          <button type="button" onClick={toggleVisible} disabled={disabled} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-teal-700 hover:bg-teal-50">
            {allVisibleSelected ? 'Bỏ chọn nhóm này' : 'Chọn cả nhóm'}
          </button>
        )}
      </div>
      {visible.length === 0 && <p className="rounded-lg bg-muted/60 px-3 py-4 text-center text-sm text-muted-foreground">Không có ai khớp. Thử tìm tên khác.</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map(person => {
          const on = selected.includes(person.userId);
          return (
            <label key={person.userId} className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 ${on ? 'border-teal-600 bg-teal-50/60' : 'border-border bg-background hover:border-teal-300'}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(person.userId)} disabled={disabled} className="h-4 w-4 shrink-0 accent-teal-700" />
              <PersonAvatar person={person} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{person.position || 'Chưa có chức danh'} · {templateName(person.templateCode)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default PermissionPeoplePicker;
