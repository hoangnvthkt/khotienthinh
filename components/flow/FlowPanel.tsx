import React from 'react';
import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import { FLOW_UNASSIGNED, type FlowDataset, type FlowWaitingPerson } from '../../lib/center/centerFlowService';
import {
  AGE_LABEL, daysSince, ddmm, fmtInt, hoursText, outcomeColor, outcomeLabel, sourceLabel, unitName, unitSummary,
  type FlowSelection, type SankeyColors,
} from '../../lib/center/flowModel';

// Ngăn bên phải của Dòng chảy công việc: mặc định "Điểm nghẽn hôm nay"; bấm phòng / dải / kết quả / dự án thì đổi theo.
// Chỉ số, tên người, tuổi việc — không có nút Nhắc / Xem phiếu (PR-3).

const Stat: React.FC<{ value: React.ReactNode; label: string; tone?: 'warn' | 'bad' }> = ({ value, label, tone }) => (
  <div className="vfl-stat" data-tone={tone}><b>{value}</b><small>{label}</small></div>
);

const Bars: React.FC<{ rows: Array<{ key: string; label: string; value: number; color: string; title?: string }>; max?: number }> = ({ rows, max }) => {
  const top = max ?? Math.max(1, ...rows.map(row => row.value));
  return (
    <div className="vfl-bars">
      {rows.map(row => (
        <div key={row.key} className="vfl-bar" title={row.title || row.label}>
          <span className="vfl-bar-l">{row.label}</span>
          <span className="vfl-bar-t"><i style={{ width: `${Math.min(100, (row.value / top) * 100)}%`, background: row.color }} /></span>
          <span className="vfl-bar-v">{fmtInt(row.value)}</span>
        </div>
      ))}
    </div>
  );
};

const PersonRow: React.FC<{ person: FlowWaitingPerson; data: FlowDataset; now: Date }> = ({ person, data, now }) => {
  const age = daysSince(person.oldestAt, now);
  const dead = age >= data.thresholds.deadDays;
  return (
    <div className="vfl-person">
      <div className="min-w-0">
        <div className="vfl-person-name">
          <span className="vcc-who">{person.name || 'Người dùng'}</span>
          {person.unitId !== FLOW_UNASSIGNED && <span className="vfl-pill">{unitName(data, person.unitId)}</span>}
          {person.pile && <span className="vfl-pill" data-tone="bad" title={`Giữ từ ${data.thresholds.pilePerson} việc trở lên`}>ùn</span>}
        </div>
        <div className="vfl-person-meta">
          <span data-tone={person.stuck > 0 ? 'bad' : 'warn'}>{fmtInt(person.n)} việc đang chờ</span>
          {person.stuck > 0 && <> · {fmtInt(person.stuck)} đứng yên</>}
          {person.overdue > 0 && <> · {fmtInt(person.overdue)} quá hạn</>}
          <> · cũ nhất từ {ddmm(person.oldestAt)}</>
          {dead && <span data-tone="bad"> · {fmtInt(age)} ngày</span>}
        </div>
      </div>
    </div>
  );
};

const Back: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" className="vfl-back" onClick={onClick}><ChevronLeft size={14} /> Điểm nghẽn hôm nay</button>
);

export const FlowPanel: React.FC<{
  data: FlowDataset;
  colors: SankeyColors;
  selection: FlowSelection | null;
  now: Date;
  onSelect: (selection: FlowSelection | null) => void;
  onOpen: (route: string) => void;
  onShowPeople: () => void;
}> = ({ data, colors, selection, now, onSelect, onOpen, onShowPeople }) => {
  const t = data.thresholds;
  const back = () => onSelect(null);

  if (selection?.type === 'unit') {
    const u = unitSummary(data, selection.id);
    return (
      <div className="vfl-panel-body">
        <Back onClick={back} />
        <h3 className="vfl-panel-title"><span className="vcc-ent">{u.name}</span></h3>
        <p className="vfl-panel-sub">
          {u.gap ? <span data-tone="bad">Người chưa có phòng ban trong Nhân sự — gắn phòng để sơ đồ đúng.</span> : u.people != null ? `${fmtInt(u.people)} người` : null}
        </p>
        <div className="vfl-stats">
          <Stat value={fmtInt(u.waiting)} label="đang chờ" tone={u.waiting ? 'warn' : undefined} />
          <Stat value={fmtInt(u.stuck)} label={`đứng yên > ${t.stuckBusinessDays} ngày`} tone={u.stuck ? 'bad' : undefined} />
          <Stat value={fmtInt(u.overdue)} label="quá hạn" tone={u.overdue ? 'bad' : undefined} />
        </div>
        <div className="vfl-stats">
          <Stat value={fmtInt(u.received)} label={`nhận / ${data.rangeDays} ngày`} />
          <Stat value={fmtInt(u.sent)} label={`giao đi / ${data.rangeDays} ngày`} />
          <Stat value={fmtInt(u.internal)} label="nội bộ phòng" />
        </div>
        {u.outcomes.length > 0 && (
          <>
            <h4 className="vfl-h4">Kết quả xử lý tại phòng</h4>
            <Bars rows={u.outcomes.map(row => ({ key: row.outcome, label: outcomeLabel(row.outcome), value: row.n, color: outcomeColor(row.outcome, colors) }))} max={u.received} />
          </>
        )}
        {u.partners.length > 0 && (
          <>
            <h4 className="vfl-h4">Trao đổi với phòng khác</h4>
            <div className="vfl-bars">
              {u.partners.slice(0, 6).map(partner => (
                <button key={partner.id} type="button" className="vfl-bar vfl-bar-btn" title={`Nhận từ ${partner.name}: ${partner.received} · giao cho: ${partner.sent}`}
                  onClick={() => onSelect({ type: 'unit', id: partner.id })}>
                  <span className="vfl-bar-l">{unitName(data, partner.id)}</span>
                  <span className="vfl-bar-t vfl-bar-duo">
                    <i style={{ width: `${Math.min(100, (partner.received / Math.max(1, u.received)) * 100)}%`, background: colors.unit }} />
                    <i style={{ width: `${Math.min(100, (partner.sent / Math.max(1, u.received)) * 100)}%`, background: colors.done, opacity: 0.55 }} />
                  </span>
                  <span className="vfl-bar-v">{fmtInt(partner.received)}↓ {fmtInt(partner.sent)}↑</span>
                </button>
              ))}
            </div>
          </>
        )}
        <h4 className="vfl-h4">Người đang giữ việc</h4>
        {u.holders.length > 0 ? u.holders.map(person => <PersonRow key={person.userId} person={person} data={data} now={now} />)
          : <p className="vfl-panel-sub">Không có việc đang chờ ở phòng này.</p>}
      </div>
    );
  }

  if (selection?.type === 'link') {
    const link = data.links.find(row => row.from === selection.from && row.to === selection.to);
    return (
      <div className="vfl-panel-body">
        <Back onClick={back} />
        <h3 className="vfl-panel-title"><span className="vcc-ent">{unitName(data, selection.from)}</span> → <span className="vcc-ent">{unitName(data, selection.to)}</span></h3>
        <p className="vfl-panel-sub">{link ? `${fmtInt(link.n)} lượt giao trong ${data.rangeDays} ngày` : 'Không có lượt giao.'}</p>
        {link && (
          <div className="vfl-stats">
            <Stat value={fmtInt(link.done)} label="đã xử lý" />
            <Stat value={fmtInt(link.waiting)} label="đang chờ" tone={link.waiting ? 'warn' : undefined} />
            <Stat value={hoursText(link.medHours)} label="trung vị xử lý" />
          </div>
        )}
        <div className="vfl-note">Danh sách phiếu trên dải này mở được ở đợt sau (PR-3).</div>
      </div>
    );
  }

  if (selection?.type === 'outcome') {
    const row = data.outcomes.find(o => o.outcome === selection.id);
    const total = data.outcomes.reduce((s, o) => s + o.n, 0);
    const byUnit = data.unitOutcomes.filter(o => o.outcome === selection.id).sort((a, b) => b.n - a.n);
    return (
      <div className="vfl-panel-body">
        <Back onClick={back} />
        <h3 className="vfl-panel-title">{outcomeLabel(selection.id)} <span className="vfl-pill" style={{ color: outcomeColor(selection.id, colors) }}>{fmtInt(row?.n ?? 0)} / {data.rangeDays} ngày</span></h3>
        <p className="vfl-panel-sub">{total ? `${Math.round(((row?.n ?? 0) / total) * 100)}% số lượt giao.` : null}</p>
        {row && selection.id !== 'waiting' && (
          <div className="vfl-stats">
            <Stat value={hoursText(row.medHours)} label="trung vị" />
            <Stat value={hoursText(row.avgHours)} label="trung bình" />
            <Stat value={fmtInt(row.n)} label="lượt" />
          </div>
        )}
        {selection.id === 'waiting' && (
          <>
            <h4 className="vfl-h4">Tuổi của {fmtInt(data.waiting.total)} việc đang chờ</h4>
            <Bars rows={data.waiting.age.map(bucket => ({ key: bucket.bucket, label: AGE_LABEL[bucket.bucket] || bucket.bucket, value: bucket.n,
              color: bucket.bucket === 'd30p' ? colors.rejected : bucket.bucket === 'd1' || bucket.bucket === 'd3' ? colors.done : colors.waiting }))} />
          </>
        )}
        {selection.id === 'done' && <div className="vfl-note">Trung bình cao hơn trung vị nhiều = phần lớn xử lý nhanh, vài lượt kéo rất dài.</div>}
        {selection.id === 'returned' && <div className="vfl-note">Trả lại nhiều ở một mẫu phiếu = form thiếu trường hoặc người lập chưa được hướng dẫn.</div>}
        {selection.id === 'skipped' && <div className="vfl-note">Bỏ qua bước thường do người duyệt vắng; nhiều lần ở cùng bước = bước thừa trong quy trình.</div>}
        {byUnit.length > 0 && (
          <>
            <h4 className="vfl-h4">Theo phòng xử lý</h4>
            <Bars rows={byUnit.map(o => ({ key: o.unit, label: unitName(data, o.unit), value: o.n, color: outcomeColor(selection.id, colors) }))} />
          </>
        )}
      </div>
    );
  }

  if (selection?.type === 'project') {
    const project = data.projects.find(p => p.id === selection.id);
    if (!project) return <div className="vfl-panel-body"><Back onClick={back} /><p className="vfl-panel-sub">Không có số liệu dự án.</p></div>;
    const open = project.mrPending + project.mrApproved + project.mrTransit;
    return (
      <div className="vfl-panel-body">
        <Back onClick={back} />
        <h3 className="vfl-panel-title"><span className="vcc-ent">{project.name}</span></h3>
        <p className="vfl-panel-sub">{project.code}</p>
        <div className="vfl-stats">
          <Stat value={fmtInt(project.waiting)} label="việc đang chờ" tone={project.waiting ? 'warn' : undefined} />
          <Stat value={fmtInt(project.stuck)} label="đứng yên" tone={project.stuck ? 'bad' : undefined} />
          <Stat value={fmtInt(open)} label="đề xuất VT đang mở" />
        </div>
        <h4 className="vfl-h4">Đề xuất vật tư</h4>
        <div className="vfl-stats">
          <Stat value={fmtInt(project.mrPending)} label="chờ duyệt" tone={project.mrPending ? 'warn' : undefined} />
          <Stat value={fmtInt(project.mrApproved)} label="đã duyệt, chờ cấp" tone={project.mrApproved && (project.mrAvgDays ?? 0) > 30 ? 'bad' : project.mrApproved ? 'warn' : undefined} />
          <Stat value={fmtInt(project.mrTransit)} label="đang chuyển" />
        </div>
        {project.mrAvgDays != null && <p className="vfl-panel-sub">Chờ cấp trung bình {project.mrAvgDays.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ngày từ lúc lập.</p>}
        <div className="vfl-note">Đề xuất đã duyệt mà chưa cấp là điểm nghẽn ở Vật tư / Mua hàng, không phải ở người duyệt.</div>
        <div className="vfl-actions">
          <button type="button" className="vdb-pri" onClick={() => onOpen(`/da?projectId=${encodeURIComponent(project.id)}&tab=material`)}>Mở Vật tư dự án <ArrowUpRight size={14} /></button>
          <button type="button" className="vdb-btn" onClick={() => onOpen('/procurement')}>Mua hàng</button>
        </div>
      </div>
    );
  }

  // Tổng quan: điểm nghẽn hôm nay.
  const roles = data.waiting.byRole;
  return (
    <div className="vfl-panel-body">
      <h3 className="vfl-panel-title">Điểm nghẽn hôm nay {data.waiting.stuck > 0 && <span className="vfl-pill" data-tone="bad">{fmtInt(data.waiting.stuck)} đứng yên</span>}</h3>
      {data.waiting.total === 0 ? <p className="vfl-panel-sub">Không có việc nào đang chờ trong phạm vi này.</p> : (
        <>
          {data.waiting.byPerson.length > 0 && (
            <>
              <h4 className="vfl-h4">Ùn ở người</h4>
              {data.waiting.byPerson.slice(0, 5).map(person => <PersonRow key={person.userId} person={person} data={data} now={now} />)}
              {data.waiting.byPerson.length > 5 && <button type="button" className="vdb-btn vfl-more" onClick={onShowPeople}>Xem cả {fmtInt(data.waiting.byPerson.length)} người</button>}
            </>
          )}
          <h4 className="vfl-h4">Tuổi của {fmtInt(data.waiting.total)} việc đang chờ</h4>
          <Bars rows={data.waiting.age.map(bucket => ({ key: bucket.bucket, label: AGE_LABEL[bucket.bucket] || bucket.bucket, value: bucket.n,
            color: bucket.bucket === 'd30p' ? colors.rejected : bucket.bucket === 'd1' || bucket.bucket === 'd3' ? colors.done : colors.waiting }))} />
          {(data.waiting.unassigned > 0 || data.waiting.dead > 0) && (
            <div className="vfl-stats">
              <Stat value={fmtInt(data.waiting.unassigned)} label="chưa giao người" tone={data.waiting.unassigned ? 'bad' : undefined} />
              <Stat value={fmtInt(data.waiting.dead)} label={`chờ trên ${t.deadDays} ngày`} tone={data.waiting.dead ? 'bad' : undefined} />
              <Stat value={fmtInt(data.waiting.overdueByDefaultSla)} label="quá SLA mặc định" tone={data.waiting.overdueByDefaultSla ? 'warn' : undefined} />
            </div>
          )}
          {data.waiting.byKind.length > 0 && (
            <>
              <h4 className="vfl-h4">Theo loại phiếu</h4>
              <Bars rows={data.waiting.byKind.slice(0, 6).map(kind => ({ key: `${kind.source}:${kind.name}`, label: kind.name, value: kind.n, color: colors.waiting,
                title: `${kind.name} · ${sourceLabel(kind.source)} · ${kind.stuck} đứng yên` }))} />
            </>
          )}
          {roles.length > 0 && (
            <>
              <h4 className="vfl-h4">Chờ một vai, chưa gắn người</h4>
              <Bars rows={roles.map(role => ({ key: role.role, label: role.role, value: role.n, color: colors.other, title: `${role.n} việc chờ ${role.role} · ${role.stuck} đứng yên` }))} />
            </>
          )}
        </>
      )}
      {data.notifications && (
        <>
          <h4 className="vfl-h4">Thông tin gửi đi mà chưa được đọc</h4>
          <div className="vfl-stats">
            <Stat value={fmtInt(data.notifications.unread7d)} label={`thông báo quá ${t.unreadDays} ngày`} tone={data.notifications.unread7d ? 'bad' : undefined} />
            <Stat value={fmtInt(data.notifications.people7d)} label="người chưa đọc" />
            <Stat value={data.notifications.total30 ? `${Math.round((data.notifications.unread30 / data.notifications.total30) * 100)}%` : '—'} label="chưa đọc / 30 ngày" />
          </div>
        </>
      )}
      {(data.gaps.employeesWithoutUnit > 0 || data.gaps.unitsWithoutManager > 0) && (
        <div className="vfl-note">
          Lỗ hổng dữ liệu: {data.gaps.employeesWithoutUnit > 0 && <>{fmtInt(data.gaps.employeesWithoutUnit)}/{fmtInt(data.gaps.employeesActive)} nhân viên chưa gắn phòng ban</>}
          {data.gaps.employeesWithoutUnit > 0 && data.gaps.unitsWithoutManager > 0 && '; '}
          {data.gaps.unitsWithoutManager > 0 && <>{fmtInt(data.gaps.unitsWithoutManager)} phòng chưa có trưởng phòng</>}
          {data.gaps.assignments > 0 && <>; {Math.round((data.gaps.assignmentsWithoutSla / data.gaps.assignments) * 100)}% lượt giao chưa có SLA</>}.
        </div>
      )}
    </div>
  );
};

export default FlowPanel;
