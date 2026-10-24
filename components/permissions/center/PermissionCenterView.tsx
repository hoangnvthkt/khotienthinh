import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Copy, History, KeyRound, LayoutGrid, ListChecks, RefreshCw, Search, ShieldAlert, ShieldCheck, Users, UserCheck, Layers } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../../lib/apiError';
import {
  buildKpis, filterPeople, groupByDepartment, permissionCenterService, templateColor,
  type CenterKpiKey, type PermissionCenterData,
} from '../../../lib/permissions/permissionCenterService';
import { Kpi } from '../../finance/financeUi';
import { StateBox, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import PermissionBulkTab, { type BulkPreset } from './PermissionBulkTab';
import PermissionControlTab from './PermissionControlTab';
import PermissionCopyTab from './PermissionCopyTab';
import PermissionLogTab from './PermissionLogTab';
import PermissionPersonPanel from './PermissionPersonPanel';
import PermissionTemplatesTab from './PermissionTemplatesTab';
import { OtherPermissionTools, PersonCard, TemplateDot } from './PermissionCenterParts';

const SettingsUserPermissionTemplates = React.lazy(() => import('../../../pages/settings/SettingsUserPermissionTemplates'));

export interface PermissionCenterViewProps {
  allowed: boolean;
  currentUserId: string;
  isAdmin: boolean;
  /** Người có thể làm người kiểm soát khi ghi nhận kiêm nhiệm. */
  people: readonly { id: string; name: string; active: boolean }[];
  canOpenRoute: (path: string) => boolean;
  onOpenDetail: (userId: string) => void;
  /** Tăng khi màn chỉnh chi tiết đóng: nạp lại. */
  reloadKey?: number;
}

type Tab = 'overview' | 'templates' | 'template-items' | 'bulk' | 'copy' | 'control' | 'log';
const TABS: Tab[] = ['overview', 'templates', 'template-items', 'bulk', 'copy', 'control', 'log'];
const KPI_ICONS: Record<CenterKpiKey, { icon: React.ElementType; tone: string }> = {
  all: { icon: Users, tone: 'text-teal-700' },
  templated: { icon: UserCheck, tone: 'text-leaf-700' },
  conflicts: { icon: ShieldAlert, tone: 'text-amber-600' },
  sensitive: { icon: KeyRound, tone: 'text-violet-700' },
  extra: { icon: Layers, tone: 'text-slate-600' },
  expiring: { icon: Clock3, tone: 'text-sky-700' },
};

/** Trên điện thoại dải tab cuộn ngang: đưa tab đang mở vào khung nhìn (không cuộn cả trang). */
const keepTabInView = (element: HTMLButtonElement | null) => {
  const strip = element?.parentElement;
  if (!element || !strip) return;
  const left = element.offsetLeft - strip.offsetLeft;
  if (left < strip.scrollLeft || left + element.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8);
};

const useIsWide = () => {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
};

/** Trung tâm phân quyền: một chỗ xem ai làm được gì, gắn mẫu theo vị trí, chỉnh từng người. */
const PermissionCenterView: React.FC<PermissionCenterViewProps> = ({ allowed, currentUserId, isAdmin, people, canOpenRoute, onOpenDetail, reloadKey = 0 }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.includes(searchParams.get('tab') as Tab) ? searchParams.get('tab') : 'overview') as Tab;
  const selectedUserId = searchParams.get('person');
  const copyFrom = searchParams.get('from');
  const selectedTemplate = searchParams.get('template') || '';
  const [data, setData] = useState<PermissionCenterData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [kpi, setKpi] = useState<CenterKpiKey>('all');
  const [bulkPreset, setBulkPreset] = useState<{ key: number; preset: BulkPreset | null }>({ key: 0, preset: null });
  const [changes, setChanges] = useState(0);
  const isWide = useIsWide();

  const setParams = useCallback((patch: Record<string, string | null>) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    setChanges(value => value + 1);
    setState(current => (current === 'ready' ? 'ready' : 'loading'));
    try {
      setData(await permissionCenterService.load());
      setState('ready'); setError('');
    } catch (loadError) {
      logApiError('permissionCenter.load', loadError);
      setError(getApiErrorMessage(loadError, 'Không tải được dữ liệu phân quyền.'));
      setState('error');
    }
  }, []);

  useEffect(() => { if (allowed) void load(); }, [allowed, load, reloadKey]);
  useEffect(() => {
    if (!selectedUserId || isWide) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setParams({ person: null }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedUserId, isWide, setParams]);

  const templatesByCode = useMemo(() => new Map((data?.templates || []).map(template => [template.code, template])), [data]);
  const baseRows = templatesByCode.get('basic_employee')?.summary || [];
  const kpis = useMemo(() => buildKpis(data?.people || []), [data]);
  const filtered = useMemo(() => filterPeople(data?.people || [], { query, templateCode: templateFilter, kpi }), [data, query, templateFilter, kpi]);
  const groups = useMemo(() => groupByDepartment(filtered), [filtered]);
  const selected = data?.people.find(person => person.userId === selectedUserId) || null;
  const hasFilter = Boolean(query.trim() || templateFilter || kpi !== 'all');
  const ownerCandidates = useMemo(() => people
    .filter(candidate => candidate.active && candidate.id !== currentUserId)
    .map(candidate => ({ id: candidate.id, name: candidate.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi')), [people, currentUserId]);
  const candidates = useMemo(() => ownerCandidates.filter(candidate => candidate.id !== selectedUserId), [ownerCandidates, selectedUserId]);

  if (!allowed) {
    return <StateBox kind="denied" title="Bạn chưa có quyền phân quyền" message="Trang này dành cho người quản lý phân quyền. Nhờ Admin nếu bạn cần." />;
  }

  const openPerson = (userId: string) => setParams({ tab: 'overview', person: userId, from: null });
  const openTab = (next: Tab, patch: Record<string, string | null> = {}) => setParams({ tab: next, person: null, ...patch });
  const openBulk = (preset: BulkPreset | null) => { setBulkPreset(current => ({ key: current.key + 1, preset })); openTab('bulk'); };
  const clearFilter = () => { setQuery(''); setTemplateFilter(null); setKpi('all'); };
  const openDetail = () => { if (selectedUserId) onOpenDetail(selectedUserId); };

  const panel = selected && data ? (
    <PermissionPersonPanel person={selected} templates={data.templates} baseRows={baseRows} candidates={candidates} actorUserId={currentUserId}
      onClose={() => setParams({ person: null })} onOpenDetail={openDetail} onSaved={load}
      onCopyFrom={() => openTab('copy', { from: selected.userId })} />
  ) : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><ShieldCheck size={22} /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground md:text-2xl">Phân quyền</h1>
            <p className="text-sm text-muted-foreground">Ai được làm gì trong công ty: xem toàn cảnh, gắn mẫu theo vị trí, chỉnh từng người.</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <button type="button" onClick={() => void load()} aria-label="Làm mới" title="Làm mới" className={`${secondaryBtn} min-h-10`}><RefreshCw size={15} /></button>
          {data && (
            <button type="button" onClick={() => openTab('copy')} aria-label="Sao chép quyền" className={`${secondaryBtn} min-h-10 flex-1 md:flex-none`}>
              <Copy size={15} /> <span className="sm:hidden">Sao chép</span><span className="hidden sm:inline">Sao chép quyền</span>
            </button>
          )}
          {data && (
            <button type="button" onClick={() => openBulk(null)} aria-label="Phân quyền hàng loạt" className={`${primaryBtn} min-h-10 flex-1 md:flex-none`}>
              <ListChecks size={15} /> <span className="sm:hidden">Hàng loạt</span><span className="hidden sm:inline">Phân quyền hàng loạt</span>
            </button>
          )}
        </div>
      </header>

      {state === 'loading' && !data && <StateBox kind="loading" title="Đang tải phân quyền…" />}
      {state === 'error' && !data && <StateBox kind="error" message={error} onRetry={() => void load()} />}

      {data && (
        <>
          <div className="no-scrollbar grid grid-flow-col auto-cols-[minmax(160px,1fr)] gap-3 overflow-x-auto md:grid-flow-row md:grid-cols-3 xl:grid-cols-6">
            {kpis.map(item => (
              <Kpi key={item.key} active={tab === 'overview' && kpi === item.key && item.key !== 'all'} icon={KPI_ICONS[item.key].icon} tone={KPI_ICONS[item.key].tone}
                label={item.label} value={item.value} hint={item.hint}
                onClick={() => { setKpi(item.key); setParams({ tab: 'overview', person: null }); }} />
            ))}
          </div>

          <div role="tablist" aria-label="Phân quyền" className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
            {([['overview', 'Toàn cảnh', LayoutGrid, null], ['templates', 'Theo vị trí', Layers, data.templates.length], ['bulk', 'Hàng loạt', ListChecks, null],
              ['copy', 'Sao chép', Copy, null], ['control', 'Kiểm soát', ShieldAlert, data.people.filter(person => person.conflicts.length > 0).length || null],
              ['log', 'Nhật ký', History, null]] as const).map(([key, label, Icon, badge]) => {
              const on = tab === key || (key === 'templates' && tab === 'template-items');
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => (key === 'bulk' ? openBulk(null) : openTab(key))}
                  ref={on ? keepTabInView : undefined}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${on ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
                  <Icon size={16} />{label}
                  {badge !== null && <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-white/20' : 'bg-muted'}`}>{badge}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'overview' && (
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-[999_1_620px] space-y-3">
                <div className="space-y-2.5 rounded-2xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-h-10 flex-[1_1_240px] items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-500/40">
                      <Search size={16} className="text-muted-foreground" />
                      <span className="sr-only">Tìm người</span>
                      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên, chức danh, phòng ban…" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
                    </label>
                    {hasFilter && <button type="button" onClick={clearFilter} className={`${secondaryBtn} min-h-10`}>Xóa lọc</button>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.templates.map(template => {
                      const on = templateFilter === template.code;
                      const color = templateColor(template.code);
                      return (
                        <button key={template.code} type="button" aria-pressed={on} onClick={() => setTemplateFilter(on ? null : template.code)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold"
                          style={on ? { background: color.solid, borderColor: color.solid, color: '#ffffff' } : undefined}>
                          <TemplateDot code={template.code} light={on} />{template.name}<span className="tabular-nums opacity-80">{template.people}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
                  <span>{filtered.length} người · {groups.length} phòng ban, công trường</span>
                  <span className="hidden md:inline">Bấm một người để xem họ làm được gì</span>
                </div>
                {groups.length === 0 && <StateBox kind="empty" title="Không có ai khớp bộ lọc" message="Bỏ bớt điều kiện lọc để xem thêm người." onRetry={clearFilter} />}
                {groups.map(group => (
                  <section key={group.name} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                      <h2 className="text-sm font-bold text-foreground">{group.name}</h2>
                      <span className="text-xs text-muted-foreground">{group.people.length} người</span>
                      <span aria-hidden="true" className="ml-auto flex h-2 w-full max-w-[220px] overflow-hidden rounded-full bg-muted sm:w-40">
                        {group.mix.map(part => <span key={part.templateCode || 'none'} style={{ width: `${(part.count * 100) / group.people.length}%`, background: templateColor(part.templateCode).solid }} />)}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 2xl:grid-cols-3">
                      {group.people.map(person => (
                        <PersonCard key={person.userId} person={person} template={person.templateCode ? templatesByCode.get(person.templateCode) : undefined}
                          selected={person.userId === selectedUserId} onOpen={() => openPerson(person.userId)} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {isWide && (
                <aside className="sticky top-4 flex min-w-0 max-w-[520px] flex-[1_1_400px] flex-col overflow-hidden rounded-2xl border border-border bg-card" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
                  {panel || (
                    <div className="space-y-2 p-6">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Users size={20} /></div>
                      <h2 className="font-bold text-foreground">Chọn một người</h2>
                      <p className="text-sm text-muted-foreground">Thấy ngay người đó theo mẫu nào, làm được gì, phần nào khác mẫu và quyền ở chỗ khác (Room dự án, kho, nhân sự, kiêm nhiệm).</p>
                      <p className="text-sm text-muted-foreground">Bảng quyền chi tiết chỉ mở khi bấm "Chỉnh chi tiết".</p>
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}

          {tab === 'templates' && (
            <PermissionTemplatesTab templates={data.templates} people={data.people} baseRows={baseRows}
              selectedCode={selectedTemplate || data.templates[0]?.code || ''} onSelect={code => setParams({ template: code })}
              onOpenPerson={openPerson} onEditItems={() => setParams({ tab: 'template-items' })}
              onAddPeople={code => openBulk({ userIds: [], kind: 'template', templateCode: code })}
              canEdit={isAdmin} onSummarySaved={load} />
          )}

          {tab === 'template-items' && (
            <div className="space-y-3">
              <button type="button" onClick={() => { setParams({ tab: 'templates' }); void load(); }} className={`${secondaryBtn} min-h-10`}><ArrowLeft size={15} /> Về Theo vị trí</button>
              <Suspense fallback={<StateBox kind="loading" />}>
                <SettingsUserPermissionTemplates />
              </Suspense>
            </div>
          )}

          {tab === 'bulk' && (
            <PermissionBulkTab key={bulkPreset.key} templates={data.templates} people={data.people} candidates={ownerCandidates} actorUserId={currentUserId}
              preset={bulkPreset.preset} onApplied={load} />
          )}

          {tab === 'copy' && (
            <PermissionCopyTab templates={data.templates} people={data.people} candidates={ownerCandidates} actorUserId={currentUserId}
              fromUserId={copyFrom} onFromChange={userId => setParams({ from: userId })} onApplied={load} />
          )}

          {tab === 'control' && (
            <PermissionControlTab people={data.people} candidates={ownerCandidates} actorUserId={currentUserId} reloadKey={changes}
              onOpenPerson={openPerson} onShowAll={next => { setKpi(next); openTab('overview'); }}
              onExtend={userIds => openBulk({ userIds, kind: 'extend', step: 3 })} />
          )}

          {tab === 'log' && <PermissionLogTab reloadKey={changes} />}

          {(tab === 'overview' || tab === 'templates') && <OtherPermissionTools canOpenRoute={canOpenRoute} />}
        </>
      )}

      {!isWide && panel && (
        <div role="dialog" aria-modal="true" aria-label={`Quyền của ${selected?.name}`} className="fixed inset-0 z-50 flex flex-col bg-background">{panel}</div>
      )}
    </div>
  );
};

export default PermissionCenterView;
