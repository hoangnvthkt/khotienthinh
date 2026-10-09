import React, { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown, ArrowUp, ArrowUpRight, BarChart3, CalendarCheck, CalendarClock, CalendarDays, CalendarOff, CalendarRange, Car, ClipboardCheck, ClipboardList,
  EyeOff, MoreHorizontal, FileBarChart, FileText, Flame, GitBranch, IdCard, Inbox, LineChart, ListChecks, Lock, Mail, MapPin, NotebookPen, Package, PackageCheck,
  Plus, Receipt, RotateCcw, ShoppingCart, Truck, Users, Wallet,
} from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { CENTER_WIDGET_GROUPS, type CenterWidgetId } from '../../lib/center/centerRegistry';
import type { CenterToday } from '../../lib/center/centerTodayService';
import type { WidgetAction } from '../../lib/center/centerActions';
import { buildTodayWidgets, type WidgetView } from '../../lib/center/todayWidgets';
import MonthCalendar from './MonthCalendar';
import CenterSearchBox from './CenterSearchBox';
import { applyCenterLayout, pinnedActionsOf, type CenterLayout } from '../../lib/center/centerLayout';

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

export interface CenterPerson {
  fullName: string;
  gender?: string | null;
}

export type TodayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CenterToday };

/** "Chào anh Sơn" khi biết giới tính; không thì "Xin chào, Phạm Ngọc Sơn". */
export const Greeting: React.FC<{ person: CenterPerson }> = ({ person }) => {
  const honorific = person.gender === 'Nam' ? 'anh' : person.gender === 'Nữ' ? 'chị' : null;
  const givenName = person.fullName.trim().split(/\s+/).pop() || person.fullName;
  return honorific
    ? <>Chào {honorific} <span className="vcc-who">{givenName}</span></>
    : <>Xin chào, <span className="vcc-who">{person.fullName}</span></>;
};

/** Biểu tượng + màu của từng nút thao tác nhanh — cùng style "Truy cập nhanh" ở Home (gradient, bóng màu,
 *  chữ đậm xám); thao tác trùng app ở Home thì dùng đúng biểu tượng và màu của app đó (key theo buildWidgetActions). */
export const ACTION_STYLES: Record<string, { icon: LucideIcon; gradient: string; shadow: string }> = {
  material_request: { icon: Package, gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/25' },
  daily_log: { icon: NotebookPen, gradient: 'from-indigo-500 to-blue-600', shadow: 'shadow-indigo-500/25' },
  work_plan: { icon: CalendarRange, gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/25' },
  daily_report: { icon: FileBarChart, gradient: 'from-violet-500 to-indigo-600', shadow: 'shadow-violet-500/25' },
  checkin: { icon: MapPin, gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/25' },
  leave: { icon: CalendarOff, gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/25' },
  makeup: { icon: CalendarClock, gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/25' },
  timesheet: { icon: CalendarCheck, gradient: 'from-teal-500 to-cyan-600', shadow: 'shadow-teal-500/25' },
  assignment: { icon: Truck, gradient: 'from-purple-500 to-pink-600', shadow: 'shadow-purple-500/25' },
  request: { icon: Inbox, gradient: 'from-cyan-500 to-sky-600', shadow: 'shadow-cyan-500/25' },
  workflow: { icon: GitBranch, gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/25' },
  po: { icon: ShoppingCart, gradient: 'from-emerald-600 to-teal-700', shadow: 'shadow-emerald-600/25' },
  task: { icon: ClipboardList, gradient: 'from-teal-600 to-emerald-700', shadow: 'shadow-teal-600/25' },
  booking: { icon: Car, gradient: 'from-sky-500 to-blue-600', shadow: 'shadow-sky-500/25' },
  compose: { icon: FileText, gradient: 'from-teal-600 to-emerald-700', shadow: 'shadow-teal-600/25' },
  incoming: { icon: Mail, gradient: 'from-cyan-600 to-teal-700', shadow: 'shadow-cyan-600/25' },
  directory: { icon: IdCard, gradient: 'from-fuchsia-500 to-purple-600', shadow: 'shadow-fuchsia-500/25' },
  hot: { icon: Flame, gradient: 'from-rose-500 to-orange-500', shadow: 'shadow-rose-500/25' },
  inbox: { icon: ListChecks, gradient: 'from-lime-500 to-emerald-600', shadow: 'shadow-lime-500/25' },
  receive: { icon: PackageCheck, gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/25' },
  count: { icon: ClipboardCheck, gradient: 'from-amber-600 to-yellow-600', shadow: 'shadow-amber-600/25' },
  site_fund: { icon: Wallet, gradient: 'from-teal-600 to-emerald-600', shadow: 'shadow-teal-600/25' },
  project_finance: { icon: LineChart, gradient: 'from-blue-600 to-cyan-700', shadow: 'shadow-blue-600/25' },
  payment_request: { icon: Receipt, gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/25' },
};
export const LOCKED_STYLE = { icon: Lock, gradient: 'from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700', shadow: 'shadow-slate-400/20' };
const FALLBACK_STYLE = { icon: ArrowUpRight, gradient: 'from-slate-600 to-slate-800', shadow: 'shadow-slate-600/25' };

export const actionStyle = (action: WidgetAction) => (action.enabled ? ACTION_STYLES[action.key] || FALLBACK_STYLE : LOCKED_STYLE);

/** Ô vuông biểu tượng gradient như app ở Home. */
export const AppIcon: React.FC<{ style: { icon: LucideIcon; gradient: string; shadow: string }; size?: 'tile' | 'row' }> = ({ style, size = 'tile' }) => {
  const Icon = style.icon;
  return (
    <span className={`vcc-appicon bg-gradient-to-br ${style.gradient} shadow-md ${style.shadow}`} data-size={size}>
      <Icon size={size === 'tile' ? 20 : 16} />
    </span>
  );
};

/** Nút thao tác nhanh: bấm là làm ngay (mở form thật hoặc đúng màn của module).
 *  tile = biểu tượng app trong ô; row = dòng trong thư mục, kèm lý do khi bị khóa. */
export const QuickAction: React.FC<{ action: WidgetAction; onAction: (action: WidgetAction) => void; variant?: 'tile' | 'row' }> = ({ action, onAction, variant = 'tile' }) => {
  const style = actionStyle(action);
  const common = {
    type: 'button' as const,
    disabled: !action.enabled,
    title: action.enabled ? action.label : action.lockReason,
    onClick: () => onAction(action),
  };
  return variant === 'tile' ? (
    <button {...common} className="vcc-tile">
      <AppIcon style={style} />
      <span className="vcc-tile-label">{action.label}</span>
    </button>
  ) : (
    <button {...common} className="vcc-act">
      <AppIcon style={style} size="row" />
      <span className="vcc-act-text">
        <span className="vcc-ellipsis">{action.label}</span>
        {!action.enabled && action.lockReason && <span className="vcc-act-why">{action.lockReason}</span>}
      </span>
    </button>
  );
};

const MORE_STYLE = { icon: MoreHorizontal, gradient: 'from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700', shadow: 'shadow-slate-400/20' };

/** Ô "…": còn nút không hiện trên ô (vượt 4 nút hoặc chưa có quyền) → mở thư mục đủ thao tác. */
const MoreTile: React.FC<{ count: number; onOpen: () => void }> = ({ count, onOpen }) => (
  <button type="button" className="vcc-tile" data-more="true" onClick={onOpen} aria-haspopup="dialog" aria-label={`Xem thêm ${count} thao tác`} title={`Xem thêm ${count} thao tác`}>
    <AppIcon style={MORE_STYLE} />
    <span className="vcc-tile-label">Xem thêm</span>
  </button>
);

// Ô = nhóm nút thao tác nhanh (việc cần làm đã ở cột "Việc của tôi"). Bấm nút → làm ngay; bấm nền ô hoặc
// "N chưa có quyền" → bung thư mục đầy đủ từ đúng vị trí ô (kèm lý do của nút bị khóa).
const WidgetCard: React.FC<{
  view: WidgetView;
  actions: WidgetAction[] | null;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
  onAction: (action: WidgetAction) => void;
  onOpenFolder: (view: WidgetView, anchor: HTMLElement) => void;
  /** Nút nhanh người dùng đã chọn cho ô này (undefined = mặc định 4 nút đầu). */
  pinned?: string[];
  header?: React.ReactNode;
  /** Chế độ tùy chỉnh: ô không bung thư mục, hiện ↑ ↓ ✕. */
  edit?: { first: boolean; last: boolean; onMove: (direction: -1 | 1) => void; onHide: () => void };
}> = ({ view, actions, canOpenRoute, onNavigate, onAction, onOpenFolder, pinned, header, edit }) => {
  const Icon = WIDGET_ICONS[view.id];
  const allowed = canOpenRoute(view.route);
  const ref = useRef<HTMLElement>(null);
  const open = () => { if (ref.current) onOpenFolder(view, ref.current); };
  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    if (edit || (event.target as HTMLElement).closest('button, select, a')) return;
    open();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (edit || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  };
  const shown = actions ? pinnedActionsOf(actions, pinned) : [];
  const more = actions ? actions.length - shown.length : 0;
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
    >
      <header className="vcc-whead">
        <span className="vcc-wicon"><Icon size={14} /></span>
        <div className="min-w-0 flex-1">
          <h3 id={`vcc-w-${view.id}`} className="vcc-wname vcc-ellipsis">{view.title}</h3>
        </div>
        {edit ? (
          <span className="vcc-wedit">
            <button type="button" onClick={() => edit.onMove(-1)} disabled={edit.first} aria-label={`Đưa ${view.title} lên trước`} title="Lên trước"><ArrowUp size={13} /></button>
            <button type="button" onClick={() => edit.onMove(1)} disabled={edit.last} aria-label={`Đưa ${view.title} xuống sau`} title="Xuống sau"><ArrowDown size={13} /></button>
            <button type="button" onClick={edit.onHide} aria-label={`Ẩn ${view.title}`} title="Ẩn ô này"><EyeOff size={13} /></button>
          </span>
        ) : (
          <>
            {header}
            <button
              type="button"
              className="vcc-wlink"
              onClick={() => onNavigate(view.route)}
              disabled={!allowed}
              aria-label={view.routeLabel}
              title={allowed ? view.routeLabel : 'Bạn chưa có quyền vào module này'}
            >
              {allowed ? <ArrowUpRight size={15} /> : <Lock size={13} />}
            </button>
          </>
        )}
      </header>
      <div className="vcc-wbody">
        {view.empty && <p className="m-0 text-[12.5px] vcc-muted">{view.empty.text}</p>}
        {actions === null ? (
          <p className="m-0 text-[12.5px] vcc-muted">Đang kiểm tra quyền…</p>
        ) : (
          <div className="vcc-qa" role="group" aria-label={`Thao tác nhanh ${view.title}`}>
            {shown.map(action => <QuickAction key={action.key} action={action} onAction={onAction} />)}
            {more > 0 && <MoreTile count={more} onOpen={open} />}
          </div>
        )}
      </div>
    </section>
  );
};

const TodayView: React.FC<{
  person: CenterPerson;
  now: Date;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
  onAction: (action: WidgetAction) => void;
  onOpenFolder: (view: WidgetView, anchor: HTMLElement) => void;
  actionsFor: (id: CenterWidgetId) => WidgetAction[] | null;
  today: TodayState;
  mineCount: number | null;
  onSelectProject: (projectId: string) => void;
  onRetry: () => void;
  customize: TodayCustomize;
}> = ({ person, now, canOpenRoute, onNavigate, onAction, onOpenFolder, actionsFor, today, mineCount, onSelectProject, onRetry, customize }) => {
  const data = today.status === 'ready' ? today.data : null;
  const ctx = { now, mineCount };
  const { visible: views, hidden: hiddenViews } = applyCenterLayout(data ? buildTodayWidgets(data, ctx) : [], customize.layout);
  const editing = customize.editing;

  return (
    <div className="vcc-page">
      {/* Đầu trang: lời chào · Tìm kiếm toàn hệ thống (giữa) · lịch tháng (chủ SP 09/10) */}
      <div className="vcc-hero">
        <h1 className="vcc-hero-hi m-0 text-[22px] font-semibold leading-tight"><Greeting person={person} /></h1>
        <div className="vcc-hero-search"><CenterSearchBox /></div>
        <div className="vcc-hero-cal"><MonthCalendar now={now} /></div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs vcc-muted">
        {editing && (
          <span className="flex min-w-0 flex-1 items-center gap-2"><CalendarDays size={13} />Dùng ↑ ↓ để đổi thứ tự, mắt gạch để ẩn ô. Bấm "Xong" để lưu cho tài khoản của bạn.</span>
        )}
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
                <div className="min-w-0"><h3 className="vcc-wname">{group.label}</h3></div>
              </header>
              <div className="vcc-wbody"><p className="m-0 text-[12.5px] vcc-muted">Đang tải thao tác…</p></div>
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
            onAction={onAction}
            onOpenFolder={onOpenFolder}
            pinned={customize.layout.pinned?.[view.id]}
            header={view.id === 'project' && data && data.projectOptions.length > 1 ? (
              <select
                className="vcc-select"
                aria-label="Chọn dự án"
                value={data.project?.id || ''}
                onChange={event => onSelectProject(event.target.value)}
              >
                {data.projectOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.code}</option>
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
