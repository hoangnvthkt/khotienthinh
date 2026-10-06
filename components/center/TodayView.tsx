import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, BarChart3, ClipboardCheck, FileText, Lock, ShoppingCart, Users, Wallet } from 'lucide-react';
import { CENTER_WIDGET_GROUPS, type CenterWidgetId } from '../../lib/center/centerRegistry';

const WIDGET_ICONS: Record<CenterWidgetId, LucideIcon> = {
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

/** "Chào anh Sơn" khi biết giới tính; không thì "Xin chào, Phạm Ngọc Sơn". */
const Greeting: React.FC<{ person: CenterPerson }> = ({ person }) => {
  const honorific = person.gender === 'Nam' ? 'anh' : person.gender === 'Nữ' ? 'chị' : null;
  const givenName = person.fullName.trim().split(/\s+/).pop() || person.fullName;
  return honorific
    ? <>Chào {honorific} <span className="vcc-who">{givenName}</span></>
    : <>Xin chào, <span className="vcc-who">{person.fullName}</span></>;
};

const TodayView: React.FC<{
  person: CenterPerson;
  now: Date;
  canOpenRoute: (route: string) => boolean;
  onNavigate: (route: string) => void;
}> = ({ person, now, canOpenRoute, onNavigate }) => {
  const weekday = WEEKDAYS[now.getDay()];
  return (
    <div className="vcc-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-semibold leading-tight"><Greeting person={person} /></h1>
          <p className="mt-1 vcc-muted">{weekday}, {pad(now.getDate())}/{pad(now.getMonth() + 1)}/{now.getFullYear()}</p>
        </div>
        <div className="vcc-card flex items-center gap-4 px-4 py-3" aria-label="Lịch hôm nay">
          <div className="text-center leading-tight">
            <div className="text-[11px] font-medium vcc-muted">TH {now.getMonth() + 1}</div>
            <div className="text-[26px] font-semibold tabular-nums">{pad(now.getDate())}</div>
            <div className="text-[11px] vcc-muted">{weekday}</div>
          </div>
          <p className="m-0 max-w-[190px] text-xs vcc-muted">Thời tiết công trường và lịch trong ngày sẽ hiện ở đây.</p>
        </div>
      </div>

      <div className="vcc-card vcc-card2 mt-4 px-4 py-3 text-[12.5px]">
        <b>Trung tâm điều hành đang thí điểm.</b>{' '}
        <span className="vcc-muted">Số liệu từng nhóm sẽ có dần. Trong lúc chờ, mở module bằng nút trong từng thẻ.</span>
      </div>

      <div className="vcc-grid mt-4">
        {CENTER_WIDGET_GROUPS.map(group => {
          const Icon = WIDGET_ICONS[group.id];
          const allowed = canOpenRoute(group.route);
          return (
            <section key={group.id} className={`vcc-card vcc-widget vcc-mod-${group.module}`} aria-labelledby={`vcc-w-${group.id}`}>
              <header className="vcc-whead">
                <span className="vcc-wicon"><Icon size={14} /></span>
                <div className="min-w-0">
                  <h3 id={`vcc-w-${group.id}`} className="vcc-wname">{group.label}</h3>
                  <div className="text-xs vcc-muted vcc-ellipsis">{group.hint}</div>
                </div>
              </header>
              <div className="vcc-wbody">
                <p className="m-0 text-[12.5px] vcc-muted"><span className="font-medium">Sắp có:</span> {group.preview}</p>
                {allowed ? (
                  <button type="button" className="vcc-chip" onClick={() => onNavigate(group.route)}>
                    {group.routeLabel} <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <button type="button" className="vcc-chip" disabled title="Bạn chưa có quyền vào module này">
                    {group.routeLabel} <Lock size={12} />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default TodayView;
