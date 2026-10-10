// Dữ liệu minh họa cho Bảng điều khiển (không phải số liệu thật). Số khớp nhau giữa các bảng: doanh thu = đã thu + còn nợ
// + giữ lại + khấu trừ tạm ứng; chi phí = tổng các nhóm; 12 tháng cộng lại đúng tổng.
// ?dash=bgd (mặc định) | ketoan | cht | muahang | none | error | slow
import type { CostCategory, DashGap, DashMonth, DashMove, DashMoveKind, DashProject, DashStockItem, DashboardDataset, DashboardId } from '../../lib/dashboard/dashboardTypes';

const TODAY = '2026-10-07';
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const B = 1e9;

interface Seed {
  id: string; code: string; name: string; status: string; director: string; site: string; lat: number | null; lng: number | null;
  start: string; end: string; planned: number; actual: number; contract: number; variation: number; costRatio: number; finance: boolean;
  mix: Partial<Record<CostCategory, number>>; matBudget: number; gaps?: DashGap[];
}

const SEEDS: Seed[] = [
  { id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', status: 'active', director: 'Nguyễn Văn Hoàng', site: 'Sơn Miền Bắc', lat: 21.0957, lng: 106.0742,
    start: '2026-01-05', end: '2026-12-20', planned: 72, actual: 68, contract: 48.6 * B, variation: 1.25 * B, costRatio: 0.78, finance: true,
    mix: { materials: 0.46, labor: 0.17, machinery: 0.08, subcontract: 0.21, overhead: 0.06, other: 0.02 }, matBudget: 19.4 * B },
  { id: 'da29', code: 'DA29', name: 'Nhà xưởng DA29 KCN Quế Võ', status: 'active', director: 'Phạm Ngọc Sơn', site: 'KCN Quế Võ', lat: 21.1512, lng: 106.1693,
    start: '2026-03-01', end: '2026-11-30', planned: 61, actual: 42, contract: 22.4 * B, variation: 0.38 * B, costRatio: 0.84, finance: true,
    mix: { materials: 0.52, labor: 0.2, machinery: 0.1, subcontract: 0.12, overhead: 0.05, other: 0.01 }, matBudget: 10.1 * B, gaps: ['baseline', 'ar_due'] },
  { id: 'hpg', code: 'HPHY-2025', name: 'Kho thép Hòa Phát Hưng Yên', status: 'active', director: 'Trần Văn Hải', site: 'Phố Nối A, Hưng Yên', lat: 20.9284, lng: 106.0486,
    start: '2025-06-10', end: '2026-09-15', planned: 100, actual: 86, contract: 15.8 * B, variation: 0.62 * B, costRatio: 0.86, finance: true,
    mix: { materials: 0.41, labor: 0.22, machinery: 0.12, subcontract: 0.17, overhead: 0.07, other: 0.01 }, matBudget: 6.3 * B },
  { id: 'xhv', code: 'XHV-2026', name: 'Công trường Xin Hai Vina', status: 'active', director: 'Lê Minh Tuấn', site: 'Xin Hai Vina, Mê Linh', lat: 21.1802, lng: 105.7213,
    start: '2026-02-15', end: '2027-02-28', planned: 34, actual: 33, contract: 31.2 * B, variation: 0, costRatio: 1.18, finance: true,
    mix: { materials: 0.5, labor: 0.18, machinery: 0.09, subcontract: 0.16, overhead: 0.06, other: 0.01 }, matBudget: 13.6 * B },
  { id: 'tttm', code: 'TTTM-HD', name: 'Trung tâm thương mại Hải Dương', status: 'active', director: 'Nguyễn Văn Hoàng', site: 'TP Hải Dương', lat: 20.9399, lng: 106.3309,
    start: '2026-05-01', end: '2027-08-30', planned: 18, actual: 20, contract: 64.5 * B, variation: 0, costRatio: 0.74, finance: true,
    mix: { materials: 0.55, labor: 0.15, machinery: 0.11, subcontract: 0.13, overhead: 0.05, other: 0.01 }, matBudget: 27.8 * B, gaps: ['unclassified'] },
  { id: 'cda1', code: 'CDA1', name: 'Dự án Cầu đường A1', status: 'completed', director: 'Đỗ Quang Huy', site: 'Thanh Trì, Hà Nội', lat: 20.9447, lng: 105.8456,
    start: '2025-03-01', end: '2026-06-30', planned: 100, actual: 100, contract: 9.6 * B, variation: 0.21 * B, costRatio: 0.81, finance: true,
    mix: { materials: 0.38, labor: 0.21, machinery: 0.2, subcontract: 0.14, overhead: 0.06, other: 0.01 }, matBudget: 3.9 * B },
  { id: 'ql1a', code: 'QL1A', name: 'Đường quốc lộ 1A đoạn Phủ Lý', status: 'active', director: 'Lê Minh Tuấn', site: 'Phủ Lý, Hà Nam', lat: null, lng: null,
    start: '2026-01-10', end: '2026-12-31', planned: 66, actual: 69, contract: 12.3 * B, variation: 0.45 * B, costRatio: 0.76, finance: true,
    mix: { materials: 0.44, labor: 0.19, machinery: 0.18, subcontract: 0.12, overhead: 0.06, other: 0.01 }, matBudget: 5.2 * B, gaps: ['coords', 'material_price'] },
  { id: 'vphn', code: 'VPHN', name: 'Cải tạo văn phòng Hà Nội', status: 'active', director: 'Phạm Ngọc Sơn', site: 'Cầu Giấy, Hà Nội', lat: 21.0335, lng: 105.7994,
    start: '2026-07-01', end: '2026-12-15', planned: 42, actual: 35, contract: 3.4 * B, variation: 0, costRatio: 0.8, finance: false,
    mix: { materials: 0.4, labor: 0.35, machinery: 0.05, subcontract: 0.12, overhead: 0.06, other: 0.02 }, matBudget: 1.2 * B },
];

// Ngẫu nhiên tất định để các tháng có sóng như thật.
const wave = (seed: string, index: number) => {
  let h = 0;
  for (const char of `${seed}:${index}`) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return 0.45 + ((h % 1000) / 1000) * 1.1;
};
const round = (value: number) => Math.round(value / 1000) * 1000;

const activeMonths = (seed: Seed) => MONTHS.map((month, index) => ({ month, index }))
  .filter(({ month }) => month >= seed.start.slice(0, 7) && month <= (seed.end < TODAY ? seed.end : TODAY).slice(0, 7));

const spread = (seed: Seed, total: number, salt: string): Map<string, number> => {
  const months = activeMonths(seed);
  const weights = months.map(({ index }) => wave(seed.id + salt, index));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return new Map(months.map(({ month }, i) => [month, round((total * weights[i]) / sum)]));
};

const project = (seed: Seed): { project: DashProject; months: DashMonth[] } => {
  const output = seed.contract * seed.actual / 100;
  const accepted = round(Math.max(0, output * 0.86));
  const cost = round(output * seed.costRatio);
  const budget = round(seed.contract * 0.84);
  const retention = round(accepted * 0.05);
  const advanceRecovered = round(Math.min(accepted * 0.1, seed.contract * 0.1));
  const outstanding = round(accepted * (seed.id === 'da29' ? 0.32 : seed.id === 'hpg' ? 0.24 : 0.14));
  const paid = Math.max(0, accepted - outstanding - retention - advanceRecovered);
  const advanceTotal = round(seed.contract * 0.1);
  const received = paid + advanceTotal;
  const costByCategory = Object.fromEntries(Object.entries(seed.mix).map(([key, share]) => [key, round(cost * (share as number))])) as Partial<Record<CostCategory, number>>;
  const apOutstanding = round(cost * (seed.id === 'xhv' ? 0.34 : 0.21));
  const sub = costByCategory.subcontract ?? 0;
  const sup = (costByCategory.materials ?? 0) + (costByCategory.machinery ?? 0);
  const purchased = round(seed.matBudget * Math.min(0.97, seed.actual / 100 + 0.08));
  const revenueM = spread(seed, accepted, 'r');
  const costM = spread(seed, cost, 'c');
  const inM = spread(seed, received, 'i');
  const outM = spread(seed, cost - apOutstanding, 'o');
  const matInM = spread(seed, purchased * 0.9, 'mi');
  const matOutM = spread(seed, purchased * 0.72, 'mo');
  return {
    project: {
      id: seed.id, code: seed.code, name: seed.name, status: seed.status, createdAt: seed.start, director: seed.director,
      site: { name: seed.site, address: seed.site, lat: seed.lat, lng: seed.lng },
      start: seed.start, end: seed.end, plannedProgress: seed.planned, actualProgress: seed.actual, updatedAt: '2026-10-07T07:00:00+07:00',
      finance: seed.finance ? {
        contractValue: seed.contract, variation: seed.variation, budget, output: round(output), accepted, received, cost, costByCategory,
        ar: { requested: round(accepted * 1.08), retention, advance: Math.max(0, advanceTotal - advanceRecovered), advanceRecovered, outstanding,
          overdue: round(outstanding * (seed.id === 'da29' ? 0.7 : seed.id === 'hpg' ? 0.55 : 0.18)),
          flow: { paid, outstanding, retention, recovered: advanceRecovered } },
        ap: { requested: round(apOutstanding * 1.4), retention: round(sub * 0.05), advance: round(sub * 0.06), outstanding: apOutstanding, overdue: round(apOutstanding * 0.17),
          paid: round(sub * 0.72) + round(sup * 0.81),
          subcontract: { total: sub, paid: round(sub * 0.72) }, supplier: { total: sup, paid: round(sup * 0.81) } },
        // QL1A: kế toán chưa nhập đợt phải thu và đợt chi NCC → bảng hiện "Chưa có dữ liệu".
        records: seed.id === 'ql1a' ? { arRounds: 0, apDocs: 5, receipts: 0, payments: 0 } : { arRounds: 6, apDocs: 14, receipts: 9, payments: 11 },
      } : null,
      materials: { budget: seed.matBudget, purchased, imported: round(purchased * 0.9), exported: round(purchased * 0.72),
        estimated: seed.id === 'smb' ? round(purchased * 0.12) : 0 },
      gaps: seed.gaps ?? [],
    },
    months: MONTHS.map(month => ({
      month, projectId: seed.id, revenue: revenueM.get(month) ?? 0, cost: costM.get(month) ?? 0, cashIn: seed.finance ? inM.get(month) ?? 0 : 0,
      cashOut: seed.finance ? outM.get(month) ?? 0 : 0, matIn: matInM.get(month) ?? 0, matOut: matOutM.get(month) ?? 0,
    })).filter(row => row.revenue || row.cost || row.cashIn || row.cashOut || row.matIn || row.matOut),
  };
};

const MATERIALS: Array<[string, string, number]> = [
  ['Thép cây D16 CB400 Hòa Phát', 'kg', 0.24], ['Bê tông thương phẩm M300', 'm³', 0.21], ['Thép cây D10 CB300', 'kg', 0.12], ['Xi măng PCB40 Bút Sơn', 'tấn', 0.1],
  ['Tôn lợp mạ màu 0,45mm', 'm²', 0.08], ['Gạch đặc 6,5×10,5×22', 'viên', 0.06], ['Cát vàng hạt to', 'm³', 0.05], ['Đá 1×2 xanh', 'm³', 0.05],
  ['Cáp điện CXV 3×95+1×50', 'm', 0.05], ['Sơn chống thấm Kova CT-11A', 'thùng', 0.04],
];

const CODES = ['VT-000124', 'VT-000087', 'VT-000125', 'VT-000033', 'VT-000201', 'VT-000058', 'VT-000041', 'VT-000042', 'VT-000310', 'VT-000277'];

/** Tồn / nhập / xuất: mỗi vật tư một mã danh mục chung giữa các dự án; thêm 1 dòng chỉ có dự toán (chưa gắn danh mục). */
const stockOf = (seed: Seed): DashStockItem[] => {
  const count = seed.id === 'smb' || seed.id === 'tttm' ? 10 : 5;
  const rows: DashStockItem[] = MATERIALS.slice(0, count).map(([name, unit, share], index) => {
    const boq = Math.round(seed.matBudget * share / 1e6) * 10;
    const imported = Math.round(boq * Math.min(0.95, seed.actual / 100 + 0.1 - index * 0.04));
    const exported = Math.round(imported * 0.82);
    const returned = index % 3 === 0 ? Math.round(imported * 0.02) : 0;
    const ordered = index % 2 === 0 ? Math.round(boq * 0.08) : 0;
    const transit = index % 3 === 1 ? Math.round(boq * 0.05) : 0;
    const siteBack = index === 2 ? Math.round(exported * 0.03) : 0;
    return { projectId: seed.id, key: `item-${index}`, itemId: `item-${index}`, name, code: CODES[index], unit, boq, ordered, transit, imported, exported, returned,
      stock: imported + siteBack - exported - returned };
  });
  // Vượt BOQ ở DA29 (thép D16) để thấy cảnh báo.
  if (seed.id === 'da29') rows[0] = { ...rows[0], exported: rows[0].boq! + 120, imported: rows[0].boq! + 200, stock: 80 - rows[0].returned };
  rows.push({ projectId: seed.id, key: 'name:phụ gia chống thấm sika', itemId: null, name: 'Phụ gia chống thấm Sika', code: null, unit: 'kg', boq: 450,
    ordered: 0, transit: 0, imported: 0, exported: 0, returned: 0, stock: 0 });
  return rows;
};

/** Chứng từ mẫu cộng đúng số trên bảng (chia 3 dòng). */
export const fixtureMoves = (dataset: DashboardDataset, key: string, kind: DashMoveKind, projectId: string | null): DashMove[] =>
  dataset.stockItems.filter(item => item.key === key && (!projectId || item.projectId === projectId)).flatMap(item => {
    const field = { ordered: 'ordered', transit: 'transit', in: 'imported', out: 'exported', return: 'returned', ledger: 'stock' } as const;
    const total = item[field[kind]];
    if (!total) return [];
    const parts = [Math.round(total * 0.5), Math.round(total * 0.3)];
    parts.push(total - parts[0] - parts[1]);
    const code = SEEDS.find(seed => seed.id === item.projectId)!.code;
    const po = kind === 'ordered' || kind === 'transit';
    return parts.map((part, index) => ({
      id: `${item.projectId}-${key}-${kind}-${index}`, date: `2026-0${7 + index}-1${index}T08:00:00+07:00`,
      code: po ? `PO-2026-0${index + 4}${item.projectId.length}` : `${kind === 'out' ? 'PX' : 'PN'}-2026-0${index + 4}${item.projectId.length}`,
      event: kind === 'ordered' ? 'confirmed' : kind === 'transit' ? 'waiting_delivery' : kind === 'out' ? 'construction_issue' : 'request_po_receipt',
      partner: po || kind === 'return' ? 'Công ty Thép Hòa Phát' : null, warehouse: `Kho ${code}`, projectId: item.projectId, projectCode: code,
      qty: part, unit: item.unit, transactionId: po ? null : `tx-${item.projectId}-${kind}-${index}`, poId: po || kind === 'return' ? `po-${item.projectId}-${index}` : null,
      expected: null,
    }));
  });

const ACCESS: Record<string, DashboardId[]> = {
  bgd: ['portfolio', 'cashflow', 'materials', 'debt'],
  ketoan: ['cashflow', 'debt', 'portfolio'],
  cht: ['portfolio', 'materials'],
  muahang: ['materials'],
  none: [],
};

export const buildDashboardFixture = (role: string): DashboardDataset => {
  const built = SEEDS.map(project);
  const ownProjects = role === 'cht' ? new Set(['da29', 'vphn']) : null;
  const keep = built.filter(item => !ownProjects || ownProjects.has(item.project.id));
  // Như máy chủ: không xem tiền → finance null, tháng không có phần tiền; không có bảng Vật tư → không có số vật tư.
  const access = ACCESS[role] ?? ACCESS.bgd;
  const money = role !== 'muahang';
  const mat = access.includes('materials');
  const projects = keep.map(item => ({ ...item.project, finance: money ? item.project.finance : null, materials: mat ? item.project.materials : null,
    gaps: item.project.gaps.filter(gap => (money || !['contract', 'budget', 'unclassified', 'ar_due', 'ap_due'].includes(gap)) && (mat || !gap.startsWith('material')))  }));
  const ids = new Set(mat ? projects.map(item => item.id) : []);
  return {
    generatedAt: '2026-10-07T08:25:00+07:00',
    today: TODAY,
    access,
    projects,
    months: keep.flatMap(item => item.months).map(row => (money ? row : { ...row, revenue: 0, cost: 0, cashIn: 0, cashOut: 0 }))
      .map(row => (mat ? row : { ...row, matIn: 0, matOut: 0 })),
    materialItems: SEEDS.filter(seed => ids.has(seed.id)).flatMap(seed => MATERIALS.slice(0, seed.id === 'smb' || seed.id === 'tttm' ? 10 : 5).map(([name, unit, share], index) => {
      const budget = round(seed.matBudget * share);
      return { id: `${seed.id}-m${index}`, projectId: seed.id, name, unit, budget, purchased: round(budget * Math.min(0.98, seed.actual / 100 + 0.1 - index * 0.03)) };
    })),
    stockItems: SEEDS.filter(seed => ids.has(seed.id)).flatMap(stockOf),
  };
};
