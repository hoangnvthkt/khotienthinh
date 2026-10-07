import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CalendarDays, ChevronRight, ClipboardCheck, EyeOff, FileText, Lock, Plus, RotateCcw, ShoppingCart, Users, Wallet } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { CENTER_WIDGET_GROUPS, type CenterWidgetId } from '../../lib/center/centerRegistry';
import type { DrillTarget } from '../../lib/center/drill';
import type { CenterToday } from '../../lib/center/centerTodayService';
import type { WidgetAction } from '../../lib/center/centerActions';
import { buildTodaySummary, buildTodayWidgets, ddmm, type Stat, type WeatherSlot, type WidgetView } from '../../lib/center/todayWidgets';
import { applyCenterLayout, type CenterLayout } from '../../lib/center/centerLayout';

/** Tùy chỉnh ô (mockup v1.1: "Tùy chỉnh" → ↑ ↓ ✕ trên từng ô, "Ô đã ẩn" để thêm lại, "Xong"). */
export interface TodayCustomize {
  layout: CenterLayout;
  editing: boolean;
  canManage: boolean;
  /** Vì sao chưa tùy chỉnh được (thiếu quyền / chưa tải bố cục). */
  lockReason?: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  onToggle: () => void;
  onMove: (id: CenterWidgetId, direction: -1 | 1) => void;
  onHide: (id: CenterWidgetId) => void;
  onShow: (id: CenterWidgetId) => void;
  onReset: () => void;
}

export const WIDGET_ICONS: Record<CenterWidgetId, LucideIcon> = {
  project: BarChart3,
  hrm: Users,
  work: ClipboardCheck,
  office: FileText,
  supply: ShoppingCart,
  finance: Wallet,
};

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad = (value: number) => String(value).padStart(2, '0');

export interface CenterPerson {
  fullName: string;
  gender?: string | null;
}

export type TodayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CenterToday };

/** "Chào anh Sơn" khi biết giới tính; không thì "Xin chào, Phạm Ngọc Sơn". */
const Greeting: React.FC<{ person: CenterPerson }> = ({ person }) => {
  const honorific = person.gender === 'Nam' ? 'anh' : person.gender === 'Nữ' ? 'chị' : null;
  const givenName = person.fullName.trim().split(/\s+/).pop() || person.fullName;
  return honorific
    ? <>Chào {honorific} <span className="vcc-who">{givenName}</span></>
    : <>Xin chào, <span className="vcc-who">{person.fullName}</span></>;
};

/** Con số bấm được: mở đúng danh sách / hồ sơ. Khóa khi thiếu quyền, kèm lý do. */
export const DrillLink: React.FC<{ stat: Stat; onDrill: (target: DrillTarget) => void }> = ({ stat, onDrill }) => stat.locked ? (
  <span className="vcc-stat-v" data-tone="muted" data-locked="true" title={stat.locked}>
    <Lock size={11} /> {stat.value}
  </span>
) : (
  <button type="button" className="vcc-stat-v" data-tone={stat.tone || 'num'} onClick={() => onDrill(stat.target)} title={`Mở ${stat.target.title}`}>
    {stat.value} <ArrowUpRight size={11} />
  </button>
);

// Bấm vào ô (không phải vào số / nút / ô chọn) → bung thư mục thao tác từ đúng vị trí ô.
const WidgetCard: React.FC<{
  view: WidgetView;
  actions: WidgetAction[] | null;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
  onDrill: (target: DrillTarget) => void;
  onOpenFolder: (view: WidgetView, anchor: HTMLElement) => void;
  header?: React.ReactNode;
  /** Chế độ tùy chỉnh: ô không bung thư mục, hiện ↑ ↓ ✕. */
  edit?: { first: boolean; last: boolean; onMove: (direction: -1 | 1) => void; onHide: () => void };
}> = ({ view, actions, canOpenRoute, onNavigate, onDrill, onOpenFolder, header, edit }) => {
  const Icon = WIDGET_ICONS[view.id];
  const allowed = canOpenRoute(view.route);
  const ref = useRef<HTMLElement>(null);
  const open = () => { if (ref.current) onOpenFolder(view, ref.current); };
  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    if (edit || (event.target as HTMLElement).closest('button, select, a, [data-locked]')) return;
    open();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (edit || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  };
  const enabledCount = actions?.filter(action => action.enabled).length;
  return (
    <section
      ref={ref}
      className={`vcc-card vcc-widget vcc-mod-${view.module}`}
      aria-labelledby={`vcc-w-${view.id}`}
      data-widget={view.id}
      data-folder={edit ? undefined : 'true'}
      data-editing={edit ? 'true' : undefined}
      tabIndex={edit ? undefined : 0}
      aria-haspopup={edit ? undefined : 'dialog'}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title={edit ? undefined : 'Bấm để mở thao tác của nhóm này'}
    >
      <header className="vcc-whead">
        <span className="vcc-wicon"><Icon size={14} /></span>
        <div className="min-w-0 flex-1">
          <h3 id={`vcc-w-${view.id}`} className="vcc-wname vcc-ellipsis">{view.title}</h3>
          <div className="text-xs vcc-muted vcc-ellipsis">{view.sub}</div>
        </div>
        {edit ? (
          <span className="vcc-wedit">
            <button type="button" onClick={() => edit.onMove(-1)} disabled={edit.first} aria-label={`Đưa ${view.title} lên trước`} title="Lên trước"><ArrowUp size={13} /></button>
            <button type="button" onClick={() => edit.onMove(1)} disabled={edit.last} aria-label={`Đưa ${view.title} xuống sau`} title="Xuống sau"><ArrowDown size={13} /></button>
            <button type="button" onClick={edit.onHide} aria-label={`Ẩn ${view.title}`} title="Ẩn ô này"><EyeOff size={13} /></button>
          </span>
        ) : header}
      </header>
      <div className="vcc-wbody">
        {view.empty ? (
          <div>
            <p className="m-0 text-[12.5px] vcc-muted">{view.empty.text}</p>
            <button type="button" className="vcc-link mt-2" onClick={() => onDrill(view.empty!.target)}>Mở {view.empty.target.title} <ArrowUpRight size={12} /></button>
          </div>
        ) : (
          <div>
            {view.stats.map(stat => (
              <div key={stat.key} className="vcc-stat" data-stat={stat.key}>
                <span className="vcc-stat-k">{stat.label}</span>
                <span className="vcc-stat-val">
                  <DrillLink stat={stat} onDrill={onDrill} />
                  {stat.hint && <span className="vcc-stat-hint">{stat.hint}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="vcc-wfoot">
          <button type="button" className="vcc-chip" data-more="true" onClick={open} aria-haspopup="dialog" aria-label={`Thao tác ${view.title}`}>
            Thao tác{enabledCount !== undefined ? ` · ${enabledCount}` : ''} <ChevronRight size={13} />
          </button>
          {allowed ? (
            <button type="button" className="vcc-chip" onClick={() => onNavigate(view.route)}>
              {view.routeLabel} <ArrowUpRight size={13} />
            </button>
          ) : (
            <button type="button" className="vcc-chip" disabled title="Bạn chưa có quyền vào module này">
              {view.routeLabel} <Lock size={12} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

const TodayView: React.FC<{
  person: CenterPerson;
  now: Date;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
  onDrill: (target: DrillTarget) => void;
  onOpenFolder: (view: WidgetView, anchor: HTMLElement) => void;
  actionsFor: (id: CenterWidgetId) => WidgetAction[] | null;
  today: TodayState;
  weather: WeatherSlot;
  mineCount: number | null;
  onSelectProject: (projectId: string) => void;
  onRetry: () => void;
  customize: TodayCustomize;
}> = ({ person, now, canOpenRoute, onNavigate, onDrill, onOpenFolder, actionsFor, today, weather, mineCount, onSelectProject, onRetry, customize }) => {
  const weekday = WEEKDAYS[now.getDay()];
  const data = today.status === 'ready' ? today.data : null;
  const ctx = { now, weather, mineCount };
  const { visible: views, hidden: hiddenViews } = applyCenterLayout(data ? buildTodayWidgets(data, ctx) : [], customize.layout);
  const editing = customize.editing;
  const summary = buildTodaySummary(data, ctx);
  const trip = data?.widgets.office.nextTrip;
  const tripToday = trip && ddmm(trip.pickupAt) === `${pad(now.getDate())}/${pad(now.getMonth() + 1)}` ? trip : null;
  const site = data?.project?.site;
  const weatherText = weather && weather !== 'loading'
    ? `${weather.temperature}° · ${weather.label}${weather.concreteWarning ? ' · hạn chế đổ bê tông' : ''}`
    : weather === 'loading' ? 'Đang lấy thời tiết…' : site && site.latitude != null ? 'Không lấy được thời tiết' : null;

  return (
    <div className="vcc-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-semibold leading-tight"><Greeting person={person} /></h1>
          <p className="mt-1 vcc-muted">{weekday}, {pad(now.getDate())}/{pad(now.getMonth() + 1)}/{now.getFullYear()}{summary ? ` · ${summary}` : ''}</p>
        </div>
        <div className="vcc-card vcc-cal" aria-label="Lịch hôm nay">
          <div className="text-center leading-tight">
            <div className="text-[11px] font-medium vcc-muted">TH {now.getMonth() + 1}</div>
            <div className="text-[26px] font-semibold tabular-nums">{pad(now.getDate())}</div>
            <div className="text-[11px] vcc-muted">{weekday}</div>
          </div>
          <div className="vcc-cal-sep" />
          <div className="min-w-0 text-xs">
            {weatherText ? <div className="font-semibold text-[13px]">{weatherText}</div> : <div className="font-semibold text-[13px] vcc-muted">Thời tiết công trường</div>}
            <div className="vcc-muted vcc-ellipsis">{site ? `${site.name}${weather && weather !== 'loading' && weather.humidity != null ? ` · độ ẩm ${weather.humidity}%` : ''}` : 'Chưa chọn dự án / công trường'}</div>
            <div className="vcc-muted vcc-ellipsis">{tripToday ? `Lịch: ${ddmm(tripToday.pickupAt)} ${new Date(tripToday.pickupAt).toTimeString().slice(0, 5)} xe đi ${tripToday.destination}` : 'Lịch: không có chuyến xe hôm nay'}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs vcc-muted">
        <CalendarDays size={13} />
        <span className="min-w-0 flex-1">{editing
          ? 'Dùng ↑ ↓ để đổi thứ tự, mắt gạch để ẩn ô. Bấm "Xong" để lưu cho tài khoản của bạn.'
          : 'Bấm vào số để mở đúng danh sách; bấm vào ô để bung thao tác của nhóm. Số liệu và nút theo quyền của bạn.'}</span>
        {!editing && hiddenViews.length > 0 && <span>{hiddenViews.length} ô đang ẩn ·</span>}
        {customize.status === 'saving' && <span role="status">Đang lưu bố cục…</span>}
        {customize.status === 'saved' && !editing && <span role="status">Đã lưu bố cục</span>}
        {customize.status === 'error' && <span role="alert" className="vcc-danger-text">Chưa lưu được bố cục — bấm "Xong" để thử lại</span>}
        {editing && (
          <button type="button" className="vcc-link" onClick={customize.onReset}><RotateCcw size={12} /> Về mặc định</button>
        )}
        <button
          type="button"
          className="vcc-link"
          onClick={customize.onToggle}
          disabled={!editing && (!customize.canManage || today.status !== 'ready')}
          title={!editing && !customize.canManage ? customize.lockReason : undefined}
          aria-pressed={editing}
        >
          {!editing && !customize.canManage && <Lock size={11} />}{editing ? 'Xong' : 'Tùy chỉnh'}
        </button>
      </div>

      {today.status === 'error' && (
        <div className="mt-3"><StateBox kind="error" title="Chưa đọc được số liệu hôm nay" message={today.message} onRetry={onRetry} /></div>
      )}

      <div className="vcc-grid mt-3" aria-busy={today.status === 'loading'} data-editing={editing || undefined}>
        {today.status === 'loading' && CENTER_WIDGET_GROUPS.filter(group => group.id !== 'finance').map(group => {
          const Icon = WIDGET_ICONS[group.id];
          return (
            <section key={group.id} className={`vcc-card vcc-widget vcc-mod-${group.module}`} aria-label={group.label}>
              <header className="vcc-whead">
                <span className="vcc-wicon"><Icon size={14} /></span>
                <div className="min-w-0"><h3 className="vcc-wname">{group.label}</h3><div className="text-xs vcc-muted">{group.hint}</div></div>
              </header>
              <div className="vcc-wbody"><p className="m-0 text-[12.5px] vcc-muted">Đang đọc số liệu…</p></div>
            </section>
          );
        })}
        {views.map((view, index) => (
          <WidgetCard
            key={view.id}
            view={view}
            edit={editing ? { first: index === 0, last: index === views.length - 1,
              onMove: direction => customize.onMove(view.id, direction), onHide: () => customize.onHide(view.id) } : undefined}
            actions={actionsFor(view.id)}
            canOpenRoute={canOpenRoute}
            onNavigate={onNavigate}
            onDrill={onDrill}
            onOpenFolder={onOpenFolder}
            header={view.id === 'project' && data && data.projectOptions.length > 1 ? (
              <select
                className="vcc-select"
                aria-label="Chọn dự án"
                value={data.project?.id || ''}
                onChange={event => onSelectProject(event.target.value)}
              >
                {data.projectOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.code}{option.waiting > 0 ? ` · ${option.waiting} việc` : ''}</option>
                ))}
              </select>
            ) : undefined}
          />
        ))}
      </div>
      {editing && (
        <div className="vcc-card vcc-card2 mt-3 flex flex-wrap items-center gap-2 px-3 py-2.5" aria-label="Ô đã ẩn">
          <span className="text-xs vcc-muted">Ô đã ẩn:</span>
          {hiddenViews.length === 0 ? <span className="text-xs vcc-muted">không có</span> : hiddenViews.map(view => (
            <button key={view.id} type="button" className={`vcc-chip vcc-mod-${view.module}`} onClick={() => customize.onShow(view.id)}>
              <Plus size={12} /> {view.title}
            </button>
          ))}
        </div>
      )}
      {data && views.length === 0 && !editing && (
        <div className="mt-3"><StateBox kind="empty" title="Bạn đã ẩn hết các ô" message='Bấm "Tùy chỉnh" để thêm lại ô cần xem.' /></div>
      )}
      {data?.project?.source && data.project.source !== 'selected' && (
        <p className="mt-3 text-xs vcc-muted">
          Dự án {data.project.code} được chọn vì {data.project.source === 'assignment' ? 'bạn đang được điều động tới công trường này'
            : data.project.source === 'most_work' ? 'đây là dự án có nhiều việc chờ bạn nhất' : 'đây là dự án đầu tiên bạn thuộc'}.
          {data.projectOptions.length > 1 ? ' Đổi dự án ở góc thẻ Dự án.' : ''}
        </p>
      )}
    </div>
  );
};

export default TodayView;
