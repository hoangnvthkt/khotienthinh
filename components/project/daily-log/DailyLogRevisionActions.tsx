import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  revisionNo?: number;
  revisionReason?: string | null;
  supersededByDailyLogId?: string | null;
  status: string;
  canCreate: boolean;
  periodLocked: boolean;
  reopenUrl: string;
  busy: boolean;
  onCreate: () => void;
  onOpenRevision: (id: string) => void;
}

export function DailyLogRevisionActions({ revisionNo = 1, revisionReason, supersededByDailyLogId,
  status, canCreate, periodLocked, reopenUrl, busy, onCreate, onOpenRevision }: Props) {
  return <section aria-label="Phiên bản nhật ký" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
    <p className="font-medium text-muted-foreground">Phiên bản {revisionNo}</p>
    {revisionReason && <p className="mt-1 break-words text-muted-foreground">Lý do: {revisionReason}</p>}
    {supersededByDailyLogId
      ? <button type="button" onClick={() => onOpenRevision(supersededByDailyLogId)} className="mt-2 min-h-11 font-semibold text-teal-700 underline dark:text-teal-300">Mở bản điều chỉnh mới</button>
      : status === 'verified' && (periodLocked
        ? <p className="mt-2">Kỳ tiến độ đang khóa. <Link className="inline-flex min-h-11 items-center font-semibold underline" to={reopenUrl}>Mở Chốt tiến độ</Link> để mở kỳ trước khi điều chỉnh.</p>
        : canCreate && <>
          <p className="mt-1 text-muted-foreground">Cần sửa số liệu đã duyệt? Tạo bản điều chỉnh; bản hiện tại vẫn có hiệu lực đến khi bản mới được duyệt.</p>
          <button type="button" disabled={busy} onClick={onCreate} className="mt-3 min-h-11 w-full rounded-xl border border-border bg-background px-4 py-2 font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:w-auto">{busy ? 'Đang tạo…' : 'Tạo bản điều chỉnh'}</button>
        </>)}
  </section>;
}
