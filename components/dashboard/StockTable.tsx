import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ROUTES, type DrillDown } from '../../lib/dashboard/dashboardModel';
import type { DashMove, DashMoveKind, DashProject, DashStockItem } from '../../lib/dashboard/dashboardTypes';

// Bảng tồn / nhập / xuất vật tư (chủ SP 10/10): tên vật tư (trên) + mã (dưới), ĐVT, Tổng BOQ, Đã đặt chưa giao, Đang giao, Tổng nhập,
// Tổng xuất, Trả lại (nhà cung cấp), Tồn kho, Còn lại; 10 dòng một trang.
// Còn lại = BOQ − (nhập + đang giao + đã đặt chưa giao − trả lại): so kế hoạch với lượng đã cam kết mua — dương (xanh) còn được mua,
// âm (đỏ) đã đặt / mua vượt BOQ. Bấm số nào cũng ra chứng từ tạo nên số đó (đơn mua, đợt giao, phiếu kho, phiếu trả NCC, dòng dự toán),
// bấm chứng từ → mở đúng phiếu / đơn trong tab mới.

export type LoadMaterialMoves = (key: string, kind: DashMoveKind, projectId: string | null) => Promise<DashMove[]>;

const PAGE = 10;
const qty = (value: number | null) => (value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value));

interface Row {
  key: string;
  itemId: string | null;
  name: string;
  code: string | null;
  unit: string;
  boq: number | null;
  ordered: number;
  transit: number;
  imported: number;
  exported: number;
  returned: number;
  stock: number;
  remaining: number | null;
  /** Dự toán theo dự án (bấm Tổng BOQ). */
  boqByProject: Array<{ projectId: string; boq: number }>;
}

/** Thực tế đã cam kết mua = nhập + đang giao + đã đặt chưa giao − trả nhà cung cấp. */
export const committed = (row: Pick<Row, 'imported' | 'transit' | 'ordered' | 'returned'>) => row.imported + row.transit + row.ordered - row.returned;

/** Gộp các dự án đang lọc thành một dòng mỗi vật tư. */
export const stockRows = (items: readonly DashStockItem[]): Row[] => {
  const byKey = new Map<string, Row>();
  items.forEach(item => {
    const row = byKey.get(item.key) || { key: item.key, itemId: item.itemId, name: item.name, code: item.code, unit: item.unit,
      boq: null, ordered: 0, transit: 0, imported: 0, exported: 0, returned: 0, stock: 0, remaining: null, boqByProject: [] };
    if (item.boq != null) { row.boq = (row.boq ?? 0) + item.boq; row.boqByProject.push({ projectId: item.projectId, boq: item.boq }); }
    row.ordered += item.ordered;
    row.transit += item.transit;
    row.imported += item.imported;
    row.exported += item.exported;
    row.returned += item.returned;
    row.stock += item.stock;
    row.itemId = row.itemId || item.itemId;
    row.code = row.code || item.code;
    row.unit = row.unit || item.unit;
    byKey.set(item.key, row);
  });
  return [...byKey.values()].map(row => ({ ...row, remaining: row.boq != null ? row.boq - committed(row) : null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
};

const KIND_TITLE: Record<DashMoveKind, string> = {
  ordered: 'Đã đặt chưa giao', transit: 'Đang giao', in: 'Nhập kho', out: 'Xuất kho', return: 'Trả nhà cung cấp', ledger: 'Sổ kho (tồn)',
};
const KIND_HINT: Record<DashMoveKind, string> = {
  ordered: 'Dòng đơn mua chưa nhận, chưa lên đợt giao. Bấm một dòng để mở đơn mua.',
  transit: 'Đợt giao chưa nhận xong. Bấm một dòng để mở đơn mua.',
  in: 'Phiếu nhập vào kho dự án (không gồm hàng công trường trả về). Bấm một dòng để mở phiếu kho.',
  out: 'Phiếu xuất khỏi kho dự án (không gồm trả nhà cung cấp). Bấm một dòng để mở phiếu kho.',
  return: 'Phiếu trả nhà cung cấp đã hoàn tất. Bấm một dòng để mở phiếu kho.',
  ledger: 'Mọi dòng sổ kho: vào dương, ra âm — cộng lại bằng Tồn kho. Bấm một dòng để mở phiếu kho.',
};
const EVENT_LABEL: Record<string, string> = {
  purchase_receipt: 'Nhập mua', request_po_receipt: 'Nhập theo đơn mua', direct_supplier_receipt: 'Nhập thẳng từ NCC', site_hot_purchase_receipt: 'Mua nóng',
  transfer_receipt: 'Nhận điều chuyển', transfer_issue: 'Điều chuyển đi', warehouse_transfer: 'Điều chuyển kho', construction_issue: 'Xuất thi công',
  project_issue: 'Xuất cho dự án', project_return_receipt: 'Công trường trả về kho', loss_issue: 'Hao hụt', adjustment_in: 'Điều chỉnh tăng',
  adjustment_out: 'Điều chỉnh giảm', inventory_adjustment: 'Kiểm kê điều chỉnh', warehouse_loss: 'Hao hụt kho', direct_manual_receipt: 'Nhập tay',
  legacy_direct_receipt: 'Nhập (dữ liệu cũ)', legacy_direct_issue: 'Xuất (dữ liệu cũ)', reversal: 'Đảo phiếu',
  // Trạng thái đơn mua / đợt giao
  sent: 'Đã gửi NCC', confirmed: 'NCC đã xác nhận', in_transit: 'Đang giao', partial: 'Giao một phần', planned: 'Đã lên lịch giao',
  waiting_delivery: 'Chờ giao', wms_pending: 'Chờ nhập kho', receiving: 'Đang nhận', quality_approved: 'Đã kiểm đạt', supplemental_pending: 'Chờ duyệt bổ sung',
};

const StockTable: React.FC<{
  items: readonly DashStockItem[];
  projects: readonly DashProject[];
  /** Đang lọc một dự án (chứng từ chỉ của dự án đó); null = mọi dự án đang xem. */
  projectId: string | null;
  loadMoves?: LoadMaterialMoves;
  /** Mở ngăn chi tiết ngay (dự toán, cách tính Còn lại). */
  onShow: (drill: DrillDown) => void;
  /** Ngăn đọc chứng từ khi bấm: không mở lại nếu người dùng đã đóng trong lúc tải. */
  onDrill: (drill: DrillDown | null) => void;
}> = ({ items, projects, projectId, loadMoves, onShow, onDrill }) => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const all = useMemo(() => stockRows(items), [items]);
  const rows = useMemo(() => {
    const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
    const words = fold(query.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter(row => { const hay = fold(`${row.name} ${row.code || ''}`); return words.every(word => hay.includes(word)); });
  }, [all, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
  const multi = !projectId && projects.length > 1;
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const unitLabel = (row: Row) => `SL${row.unit ? ` (${row.unit})` : ''}`;

  const openMoves = (row: Row, kind: DashMoveKind) => {
    if (!loadMoves || !row.itemId) return;
    const po = kind === 'ordered' || kind === 'transit';
    const base: DrillDown = {
      title: `${KIND_TITLE[kind]} · ${row.name}`,
      subtitle: `${row.code ? `${row.code} · ` : ''}${KIND_HINT[kind]}`,
      columns: [
        { key: 'code', label: po ? 'Đơn mua' : 'Mã phiếu' }, { key: 'date', label: kind === 'transit' ? 'Ngày giao' : 'Ngày', kind: 'date' },
        { key: 'event', label: po ? 'Trạng thái' : 'Loại' }, ...(po || kind === 'return' ? [{ key: 'partner', label: 'Nhà cung cấp' }] : [{ key: 'warehouse', label: 'Kho' }]),
        ...(multi ? [{ key: 'project', label: 'Dự án' }] : []), { key: 'qty', label: unitLabel(row), kind: 'number' as const },
      ],
      rows: [],
      status: 'loading',
    };
    onDrill(base);
    loadMoves(row.key, kind, projectId)
      .then(moves => onDrill({
        ...base, status: undefined,
        rows: moves.map(move => ({
          id: move.id,
          route: move.transactionId ? ROUTES.stockDocument(move.transactionId) : move.poId ? ROUTES.purchaseOrder(move.poId) : undefined,
          cells: { code: move.code, date: move.date ? move.date.slice(0, 10) : null, event: (move.event && EVENT_LABEL[move.event]) || move.event || '—',
            partner: move.partner || '—', warehouse: move.warehouse || '—', project: move.projectCode, qty: move.qty },
        })),
        total: { qty: moves.reduce((sum, move) => sum + move.qty, 0) },
        hint: moves.length >= 500 ? 'Hiện 500 chứng từ gần nhất.' : undefined,
      }))
      .catch(error => onDrill({ ...base, status: 'error', message: error instanceof Error ? error.message : 'Chưa tải được chứng từ.' }));
  };

  // Tổng BOQ → dòng dự toán theo dự án (mở Vật tư dự án → Dự toán).
  const openBoq = (row: Row) => onShow({
    title: `Tổng BOQ · ${row.name}`,
    subtitle: `${row.code ? `${row.code} · ` : ''}Dự toán vật tư theo dự án. Bấm một dòng để mở dự toán.`,
    columns: [{ key: 'project', label: 'Dự án' }, { key: 'qty', label: unitLabel(row), kind: 'number' }],
    rows: row.boqByProject.map(item => {
      const project = projectById.get(item.projectId);
      return { id: item.projectId, route: ROUTES.project(item.projectId, 'material', { materialTab: 'boq' }),
        cells: { project: project ? `${project.code} · ${project.name}` : item.projectId, qty: item.boq } };
    }),
    total: { qty: row.boq },
  });

  // Còn lại → cách tính từng bước; mỗi dòng mở được chứng từ của nó.
  const openRemaining = (row: Row) => onShow({
    title: `Còn lại · ${row.name}`,
    subtitle: 'Còn lại = BOQ − (nhập + đang giao + đã đặt chưa giao − trả lại). Dương: còn được mua; âm: đã đặt / mua vượt BOQ.',
    columns: [{ key: 'part', label: 'Thành phần' }, { key: 'qty', label: unitLabel(row), kind: 'number' }],
    rows: [
      { id: 'boq', cells: { part: 'Tổng BOQ', qty: row.boq } },
      { id: 'in', cells: { part: '− Tổng nhập', qty: -row.imported } },
      { id: 'transit', cells: { part: '− Đang giao', qty: -row.transit } },
      { id: 'ordered', cells: { part: '− Đã đặt chưa giao', qty: -row.ordered } },
      { id: 'return', cells: { part: '+ Trả nhà cung cấp', qty: row.returned } },
    ],
    total: { qty: row.remaining },
    hint: 'Bấm từng số trên bảng để xem chứng từ của thành phần đó.',
  });

  const Num: React.FC<{ row: Row; kind: DashMoveKind; value: number }> = ({ row, kind, value }) => (
    value !== 0 && row.itemId && loadMoves
      ? <button type="button" className="vdb-numlink" onClick={() => openMoves(row, kind)} title={`Xem chứng từ: ${KIND_TITLE[kind]}`}>{qty(value)}</button>
      : <span>{qty(value)}</span>
  );

  return (
    <div className="vdb-stock">
      <div className="vdb-stock-bar">
        <label className="vdb-stock-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Tìm tên hoặc mã vật tư"
            aria-label="Tìm vật tư" />
        </label>
        <span className="vdb-muted text-xs">{rows.length} vật tư</span>
      </div>
      <div className="vdb-table-wrap">
        <table className="vdb-table vdb-stock-table">
          <thead>
            <tr>
              <th>Vật tư</th><th>ĐVT</th>
              <th data-num>Tổng BOQ</th><th data-num>Đã đặt chưa giao</th><th data-num>Đang giao</th><th data-num>Tổng nhập</th>
              <th data-num>Tổng xuất</th><th data-num>Trả lại</th><th data-num>Tồn kho</th><th data-num>Còn lại</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={10} className="vdb-muted">{query ? 'Không có vật tư khớp.' : 'Chưa có dự toán, đơn mua hoặc giao dịch kho.'}</td></tr>}
            {shown.map(row => (
              <tr key={row.key}>
                <td>
                  <span className="vdb-stock-name">{row.name}</span>
                  <span className="vdb-stock-code">{row.code || 'Chưa có mã'}</span>
                </td>
                <td>{row.unit || '—'}</td>
                <td data-num>
                  {row.boq != null ? <button type="button" className="vdb-numlink" onClick={() => openBoq(row)} title="Xem dự toán theo dự án">{qty(row.boq)}</button> : '—'}
                </td>
                <td data-num><Num row={row} kind="ordered" value={row.ordered} /></td>
                <td data-num><Num row={row} kind="transit" value={row.transit} /></td>
                <td data-num><Num row={row} kind="in" value={row.imported} /></td>
                <td data-num><Num row={row} kind="out" value={row.exported} /></td>
                <td data-num><Num row={row} kind="return" value={row.returned} /></td>
                <td data-num><Num row={row} kind="ledger" value={row.stock} /></td>
                <td data-num data-remaining={row.remaining == null ? undefined : row.remaining < 0 ? 'over' : row.remaining > 0 ? 'left' : 'zero'}>
                  {row.remaining == null ? '—' : (
                    <button type="button" className="vdb-numlink" onClick={() => openRemaining(row)}
                      title={row.remaining < 0 ? 'Đã đặt / mua vượt BOQ — bấm xem cách tính' : 'Còn được mua theo BOQ — bấm xem cách tính'}>{qty(row.remaining)}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="vdb-pager" aria-label="Phân trang vật tư">
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Trang trước"><ChevronLeft size={14} /></button>
          <span>Trang {current + 1} / {pages}</span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Trang sau"><ChevronRight size={14} /></button>
        </nav>
      )}
    </div>
  );
};

export default StockTable;
