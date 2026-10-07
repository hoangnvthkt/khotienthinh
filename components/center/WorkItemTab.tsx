import React, { Suspense } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { CENTER_MODULES, type CenterModuleKey, type RendererId } from '../../lib/center/centerRegistry';
import type { ItemDrillTarget } from '../../lib/center/drill';
import { displayCode, dueInfo, type WorkItem, type WorkItemKind } from '../../lib/center/workItemsService';

export type RendererComponent = React.ComponentType<{ renderer: RendererId; props: Record<string, string>; onExit?: (path: string) => void }>;

const KIND_LABEL: Record<WorkItemKind, string> = {
  approve: 'Chờ bạn duyệt',
  do: 'Cần bạn làm',
  confirm: 'Chờ bạn xác nhận',
  read: 'Cần xác nhận đã đọc',
  wait: 'Đang chờ người khác',
  watch: 'Đang theo dõi',
};

// Tab hồ sơ trong vùng làm việc: đầu tab theo mockup (nhãn module · mã · tiêu đề · "Mở ở màn … ↗"),
// thân là màn xử lý thật của module mở ngay tại chỗ (view đã tách hoặc trang module chạy trong tab).
const WorkItemTab: React.FC<{
  item?: WorkItem | null;
  title: string;
  module: CenterModuleKey;
  target: ItemDrillTarget;
  now: Date;
  onNavigate: (path: string) => void;
  onBack?: () => void;
  Renderer: RendererComponent;
}> = ({ item, title, module: moduleKey, target, now, onNavigate, onBack, Renderer }) => {
  const module = CENTER_MODULES[moduleKey];
  const route = target.kind === 'tab' ? target.route : target.path;
  const due = item ? dueInfo(item.dueAt, now) : null;
  return (
    <div className={`vcc-page vcc-mod-${moduleKey}`}>
      {onBack && (
        <button type="button" className="vcc-link vcc-mobile-only mb-2" onClick={onBack}><ArrowLeft size={13} /> Việc của tôi</button>
      )}
      <div className="vcc-detail-head">
        <span className="vcc-badge vcc-badge-m">{module.label}</span>
        {item && <span className="vcc-badge">{KIND_LABEL[item.kind]}</span>}
        <h1>{item ? <><span className="vcc-ent text-[15px]">{displayCode(item)}</span> · {item.title}</> : title}</h1>
        <button type="button" className={`vcc-link ml-auto${target.kind === 'route' ? ' vcc-desktop-only' : ''}`} onClick={() => onNavigate(route)}>
          Mở ở màn {module.label} <ArrowUpRight size={13} />
        </button>
      </div>
      {item && (
        <p className="vcc-muted mb-3 mt-0.5">
          {item.who && <span className="vcc-who">{item.who}</span>}
          {item.who && item.meta && ' · '}
          {item.meta}
          {due && <>{(item.who || item.meta) && ' · '}<span className="vcc-due" data-tone={due.tone} style={{ marginLeft: 0, fontSize: 'inherit' }}>{due.tone === 'normal' ? `hạn ${due.label}` : due.label}</span></>}
        </p>
      )}
      {!item && <div className="mb-3" />}
      {target.kind === 'tab' ? (
        <div className="vcc-embed">
          <Suspense fallback={<StateBox kind="loading" title="Đang mở hồ sơ…" />}>
            <Renderer renderer={target.renderer} props={target.props} onExit={onNavigate} />
          </Suspense>
        </div>
      ) : (
        <section className="vcc-card p-4">
          <p className="m-0 font-medium">Hồ sơ này xử lý ở màn {module.label}.</p>
          <p className="vcc-muted mt-1 mb-3 text-[12.5px]">Trung tâm điều hành mở đúng hồ sơ cho bạn; thao tác duyệt / sửa vẫn làm ở màn {module.label} như hiện nay.</p>
          <button type="button" className="vcc-btn" data-pri="true" onClick={() => onNavigate(route)}>
            Mở ở màn {module.label} <ArrowUpRight size={14} />
          </button>
        </section>
      )}
    </div>
  );
};

export default WorkItemTab;
