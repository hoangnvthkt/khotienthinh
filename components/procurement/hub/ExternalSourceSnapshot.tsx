import React from 'react';
import type { ProcurementInboxDetail } from '../../../lib/procurementInboxService';
import { StateBox } from './hubUi';

/** Preserve approved free-form data, including blank approved quantities. */
export const ExternalSourceSnapshot: React.FC<{ detail: ProcurementInboxDetail; withdrawn: boolean }> = ({ detail, withdrawn }) => {
  const snapshot = detail.sourceSnapshot;
  if (!snapshot) return <StateBox kind="error" message="Chưa tải được nội dung đã duyệt. Mở phiếu nguồn để kiểm tra." />;
  const cell = (value: string | undefined) => value?.trim() ? value : '—';
  return <section className="min-w-0 space-y-4" aria-label="Nội dung đã duyệt từ module">
    <div className={`rounded-xl border px-3 py-3 text-sm ${withdrawn ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200'}`}>
      <p className="font-semibold">{withdrawn ? 'Nguồn đã thu hồi — tạm dừng xử lý' : 'Đã tiếp nhận dữ liệu đã duyệt'}</p>
      <p className="mt-1">{withdrawn ? snapshot.withdrawnReason || 'Chờ phiếu nguồn được duyệt lại.' : 'Kiểm tra quy cách và nơi nhận trước khi chuyển sang bước mua/cấp phát.'}</p>
    </div>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-semibold text-foreground">Danh sách đề xuất</h3>
      <span className="text-xs text-muted-foreground">{snapshot.rows.length} dòng · Lần duyệt {snapshot.revision}</span>
    </div>
    {snapshot.rows.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Phiếu nguồn chưa có bảng chi tiết. Mở phiếu nguồn để kiểm tra thông tin.</p> : <>
      <div className="space-y-3 md:hidden">
        {snapshot.rows.map((row, index) => <article key={row.id} className="rounded-xl border border-border bg-card p-3">
          <h4 className="break-words font-semibold">{index + 1}. {cell(row.cells[0])}</h4>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-2 text-sm">
            {snapshot.columns.slice(1).map((label, col) => <React.Fragment key={`${col}:${label}`}>
              <dt className="break-words text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap break-words text-foreground">{cell(row.cells[col + 1])}</dd>
            </React.Fragment>)}
          </dl>
        </article>)}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block" tabIndex={0} aria-label="Bảng đề xuất, cuộn ngang để xem đủ cột">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-muted/70 text-muted-foreground"><tr>{snapshot.columns.map((label, i) => <th key={`${i}:${label}`} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{snapshot.rows.map(row => <tr key={row.id}>{snapshot.columns.map((_, i) => <td key={i} className="min-w-[90px] max-w-[240px] whitespace-pre-wrap break-words px-3 py-3 align-top">{cell(row.cells[i])}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Dấu “—” là thông tin chưa được điền tại nguồn. Số lượng đề xuất và số lượng phê duyệt được giữ riêng.</p>
    </>}
    {snapshot.notes && <div><h4 className="text-sm font-semibold">Thông tin thêm từ phiếu</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{snapshot.notes}</p></div>}
  </section>;
};
