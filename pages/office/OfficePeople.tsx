import React, { useState } from 'react';
import type { OfficePage, OfficePeopleKind, OfficePerson } from '../../lib/office/officeTypes';
import type { OfficeService } from '../../lib/office/officeService';
import { displayDate } from '../../lib/office/officePresentation';
import { OfficeError, OfficePagination, useOfficeQuery } from './OfficeShared';
const labels: Record<OfficePeopleKind, string> = { recipients: 'Người nhận', viewers: 'Đã xem', followers: 'Người theo dõi', downloads: 'Đã tải tệp đính kèm' };
export function OfficePeoplePanel({ id, kind, initial, service, revision = 0, children }: {
  id: string; kind: OfficePeopleKind; initial?: OfficePage<OfficePerson>; service: OfficeService; revision?: number; children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const result = useOfficeQuery(() => expanded || revision > 0 ? service.people(id, kind, page) : Promise.resolve(initial || null), [service, id, kind, page, expanded, revision]);
  const data = expanded || revision > 0 ? result.data : initial;
  const rows = expanded ? data?.items : data?.items.slice(0, 4);
  return <section className="office-panel office-form-section office-people-panel">
    <h2>{labels[kind]}{data && <span className="office-people-count">{data.total}</span>}</h2>
    {result.error ? <OfficeError error={result.error} retry={result.refresh} /> : !data ? <p className="office-helper">{result.loading ? 'Đang tải…' : 'Chưa có số liệu.'}</p> : <>
      {rows?.length ? <ul className="office-person-list">{rows.map(person => <li key={person.user_id}>
        <span className="office-person-avatar" aria-hidden="true">{person.name.split(' ').slice(-2).map(part => part[0]).join('')}</span>
        <div><strong>{person.name}</strong><small>{person.username ? `@${person.username}` : 'Cá nhân'}{person.occurred_at && ` · ${displayDate(person.occurred_at, true)}`}</small></div>
      </li>)}</ul> : <p className="office-helper">{kind === 'recipients' ? 'Chưa phát hành tới người nhận.' : kind === 'viewers' ? 'Chưa có người nhận mở văn bản.' : kind === 'followers' ? 'Chưa có người theo dõi.' : 'Chưa ghi nhận lượt tải tệp.'}</p>}
      {!expanded && data.total > 4 && <button className="office-secondary" onClick={() => setExpanded(true)}>Xem thêm ({data.total - 4})</button>}
      {expanded && <><OfficePagination page={page} total={data.total} onChange={setPage} /><button className="office-secondary" onClick={() => { setExpanded(false); setPage(0); }}>Thu gọn</button></>}
    </>}
    {kind === 'downloads' && <small className="office-helper">Ghi nhận khi người dùng chọn tải sau khi tệp đã tải về trình duyệt; không xác nhận việc lưu trên thiết bị. Không tính thao tác xem trước.</small>}
    {children}
  </section>;
}
