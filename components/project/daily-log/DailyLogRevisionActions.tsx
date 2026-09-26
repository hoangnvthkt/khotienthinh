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
  return <section aria-label="Phiên bản nhật ký" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm dark:border-teal-900 dark:bg-teal-950/20">
    <p className="font-semibold">Phiên bản {revisionNo}</p>
    {revisionReason && <p className="mt-1 break-words text-muted-foreground">Lý do: {revisionReason}</p>}
    {supersededByDailyLogId
      ? <button type="button" onClick={() => onOpenRevision(supersededByDailyLogId)} className="mt-2 min-h-11 font-semibold text-teal-700 underline dark:text-teal-300">Mở bản điều chỉnh mới</button>
      : status === 'verified' && (periodLocked
        ? <p className="mt-2">Kỳ tiến độ đang khóa. <Link className="inline-flex min-h-11 items-center font-semibold underline" to={reopenUrl}>Mở Chốt tiến độ</Link> để mở kỳ trước khi điều chỉnh.</p>
        : canCreate && <>
          <p className="mt-1 text-muted-foreground">Bản đã xác nhận vẫn có hiệu lực đến khi bản điều chỉnh được duyệt và công bố.</p>
          <button type="button" disabled={busy} onClick={onCreate} className="mt-3 min-h-11 w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:w-auto">{busy ? 'Đang tạo…' : 'Tạo bản điều chỉnh'}</button>
        </>)}
  </section>;
}
