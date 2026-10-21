// Công trường 3D: số liệu giả lập đúng hình JSON của vcc_site3d_v1 (mã WBS khớp bố cục dựng sẵn, tên / số là minh họa).
// Quy mô gần thật: SMB ~350 đầu việc, DA29 ~360 đầu việc, nhật ký mỗi ngày từ 01/07, máy + tổ đội + tồn kho.

const TODAY = '2026-10-17';
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 3, 1);
const iso = (d: number) => new Date(D0 + d * DAY).toISOString().slice(0, 10);
const todayIdx = Math.round((Date.UTC(2026, 9, 17) - D0) / DAY);
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

type RawTask = [string, string | null, string, number, string | null, string | null, string | null, string | null, number | null, string | null];

const STAGES = ['Đào đất', 'Gia công lắp dựng cốt thép', 'Gia công lắp dựng ván khuôn', 'Đổ bê tông', 'Lấp đất', 'Xây tường', 'Lắp dựng kết cấu thép', 'Lợp tôn mái', 'Lắp tôn vách'];
function leaf(wbs: string, parent: string, i: number, start: number, span: number): RawTask {
  const ps = Math.round(start), pe = Math.round(start + span);
  const lag = Math.round(rnd() * 20) - 6;
  const progress = todayIdx <= ps + lag ? 0 : todayIdx >= pe + lag ? 100 : Math.round(100 * (todayIdx - ps - lag) / Math.max(1, pe - ps));
  const as = progress > 0 ? iso(ps + lag) : null, ae = progress >= 100 ? iso(pe + lag) : null;
  return [wbs, parent, `${STAGES[i % STAGES.length]} ${wbs}`, progress, iso(ps), iso(pe), as, ae, Math.round(rnd() * 500 * 10) / 10, i % 2 ? 'm3' : 'kg'];
}

function smbTasks(): RawTask[] {
  const out: RawTask[] = [];
  const ROOTS = ['Nhà văn phòng - Móng', 'Nhà văn phòng - Kết cấu', 'Nhà văn phòng - Xây', 'Nhà văn phòng - Hoàn thiện', 'Nhà xưởng 1 - Móng', 'Nhà xưởng 1 - Kết cấu', 'Nhà xưởng 1 - Mái, vách', 'Nhà xưởng 1 - Hoàn thiện',
    'Nhà xưởng 2 - Móng', 'Nhà xưởng 2 - Kết cấu', 'Nhà xưởng 2 - Mái, vách', 'Nhà xưởng 2 - Hoàn thiện', 'Nhà xưởng 3 - Móng', 'Nhà xưởng 3 - Kết cấu', 'Nhà xưởng 3 - Mái, vách', 'Nhà xưởng 3 - Hoàn thiện', 'Hạ tầng'];
  ROOTS.forEach((name, r) => {
    const root = String(r + 1);
    out.push([root, null, name, 0, iso(r * 8), iso(r * 8 + 200), null, null, null, null]);
    for (let i = 1; i <= 40; i += 1) out.push(leaf(`${root}.${i}`, root, i, r * 8 + i * 3.2, 14 + rnd() * 20));
  });
  return out;
}

function daTasks(): RawTask[] {
  const out: RawTask[] = [];
  const ROOTS = ['Phần cọc', 'Nhà văn phòng', 'Nhà nghỉ ca', 'Xưởng sản xuất chính + kho', 'WC + khí nén', 'Trạm biến áp', 'Hồ PCCC, nhà xe', 'Hạ tầng', 'Cây xanh, bàn giao'];
  ROOTS.forEach((name, r) => {
    const root = String(r + 1);
    out.push([root, null, name, 0, iso(60 + r * 6), iso(320), null, null, null, null]);
    for (let s = 1; s <= 9; s += 1) {
      const mid = `${root}.${s}`;
      out.push([mid, root, `${name} - phần ${s}`, 0, iso(60 + r * 6 + s * 9), iso(330), null, null, null, null]);
      const isSeg = root === '4' && s === 1;
      for (let t = 1; t <= (isSeg ? 3 : 9); t += 1) {
        const w = `${mid}.${t}`;
        if (isSeg) { // 4.1.1 … 4.1.3: móng từng phân đoạn, có cấp 4
          out.push([w, mid, `Móng phân đoạn ${t}`, 0, iso(90 + t * 20), iso(200), null, null, null, null]);
          for (let u = 1; u <= 11; u += 1) out.push(leaf(`${w}.${u}`, w, u, 90 + t * 20 + u * 4, 12));
        } else out.push(leaf(w, mid, t, 60 + r * 6 + s * 9 + t * 5, 18 + rnd() * 25));
      }
    }
  });
  return out;
}

function series(tasks: RawTask[]): Record<string, [string, number][]> {
  const out: Record<string, [string, number][]> = {};
  for (const t of tasks) {
    if (!t[6] || !t[1]) continue;
    const start = Math.round((Date.parse(t[6]) - D0) / DAY), pts: [string, number][] = [];
    for (let d = Math.max(start, 91); d <= todayIdx; d += 4) pts.push([iso(d), Math.min(t[3], Math.round((d - start) * 4))]);
    if (pts.length) out[t[0]] = pts;
  }
  return out;
}

const MACHINES: [string, string, number][] = [['Máy xúc PC200', 'Máy xúc', 1], ['Ô tô tải 15 tấn', 'Ô tô tải', 2], ['Cẩu Kato 25 tấn', 'Cẩu', 1], ['Máy lu rung 12 tấn', 'Máy lu', 1], ['Máy ủi D6', 'Máy ủi', 1], ['Đầm cóc', 'Đầm', 2]];
function logs(site: 'SMB' | 'DA29'): unknown[] {
  const out: unknown[] = [];
  for (let d = 91; d <= todayIdx; d += 1) {
    if (d % 7 === 0) continue; // Chủ nhật nghỉ
    const workers = 18 + Math.round(rnd() * 30);
    const labor = site === 'DA29'
      ? [['Tổ cốt thép, ván khuôn móng', Math.round(workers * 0.5)], ['Tổ đào đất', Math.round(workers * 0.2)], ['Tổ lấp đất', Math.round(workers * 0.2)], ['Nhà nghỉ ca', 4]]
      : [['Tổ đội', workers], ['Xây ALC', 6], ['Lắp dựng kết cấu', 5]];
    out.push([iso(d), workers, d >= todayIdx - 2 ? 'submitted' : 'verified', MACHINES.filter((_, i) => (d + i) % 3 !== 0), labor]);
  }
  return out;
}

const STOCK: [string, string, number][] = [['Thép XD D10', 'kg', 4200], ['Thép XD D16', 'kg', 12800], ['Thép XD D22', 'kg', 9600], ['Cọc ly tâm D300 dài 10 m', 'm', 820], ['Base B', 'm3', 140], ['Xi măng PCB30', 'bao', 260],
  ['Cát vàng', 'm3', 35], ['Gạch đặc 6,5×10,5', 'viên', 18000], ['Tấm ALC 100 mm', 'tấm', 420], ['Xà gồ C200', 'm', 640], ['Lưới thép hàn D8', 'tấm', 38], ['Thang giáo', 'bộ', 120], ['Dầu Diezel', 'lít', 600]];

export function site3dRaw(code: string): Record<string, unknown> {
  seed = code === 'DA29' ? 29 : 7;
  const tasks = code === 'DA29' ? daTasks() : smbTasks();
  return {
    access: true, canManage: true,
    project: code === 'DA29' ? { id: '00000000-0000-4000-8000-0000000000d2', code: 'DA29', name: 'Nhà máy XinHai Vina giai đoạn 2' } : { id: '00000000-0000-4000-8000-00000000005b', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc' },
    today: TODAY, tasks, series: series(tasks), logs: logs(code === 'DA29' ? 'DA29' : 'SMB'), stock: STOCK,
  };
}

export const SITE3D_PROJECTS = [
  { id: '00000000-0000-4000-8000-0000000000d2', code: 'DA29', name: 'Nhà máy XinHai Vina giai đoạn 2' },
  { id: '00000000-0000-4000-8000-00000000005b', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc' },
  { id: '00000000-0000-4000-8000-000000000001', code: 'VP-01', name: 'Văn phòng công ty' },
];
