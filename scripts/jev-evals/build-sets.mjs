#!/usr/bin/env node
// Dựng bộ đo khớp (NCC / mã vật tư / dự án) = truy vấn + top-8 ứng viên theo điểm token kiểu Vioo + "khac".
// Ứng viên đúng không lọt top-8 thì chèn thêm (đánh dấu injected) — mô phỏng ứng viên từ bí danh đã học.
//   node scripts/jev-evals/build-sets.mjs   → data/set-supplier.json, set-item.json, set-project.json
import { readFileSync, writeFileSync } from 'node:fs';
import { rank } from './match.mjs';

const load = n => JSON.parse(readFileSync(new URL(`./data/${n}.json`, import.meta.url)));
const labels = load('labels');
const K = 8;

const SETS = {
  supplier: { rows: load('partners'), id: r => r.code, nameOf: r => r.name, opts: { stop: true },
    desc: r => `${r.name}${r.tax_code && r.tax_code !== '0' ? ` · MST ${r.tax_code}` : ''}${Array.isArray(r.classifications) && r.classifications.includes('owner') && !r.classifications.includes('supplier') ? ' · (chủ đầu tư, không phải NCC)' : ''}`,
    stateKey: 'ten_ncc_tren_phieu', instructions: 'Tên bên giao hàng đọc từ phiếu giao / câu nói ứng với đối tác nào trong danh sách? Chọn "khac" nếu không có đối tác nào đúng, là cá nhân / chuyển nội bộ, hoặc không đủ thông tin để chắc một đối tác.' },
  item: { rows: load('items'), id: r => r.sku, nameOf: r => r.name, opts: {},
    desc: r => `${r.name} · đơn vị ${r.unit || '?'}`,
    stateKey: 'ten_vat_tu_nguoi_viet', instructions: 'Dòng vật tư người dùng viết tay / nói ứng với mã nào trong danh mục? Chọn "khac" nếu không có mã đúng, hoặc thiếu quy cách nên không chắc một mã.' },
  project: { rows: load('projects'), id: r => r.code, nameOf: r => `${r.code} ${r.name} ${r.client_name || ''}`, opts: {},
    desc: r => `${r.code} · ${r.name}${r.client_name ? ` · CĐT ${r.client_name}` : ''} · ${r.status === 'active' ? 'đang thi công' : r.status === 'cancelled' ? 'đã hủy' : 'kế hoạch'}`,
    stateKey: 'cach_goi_du_an', instructions: 'Người dùng đang nói tới dự án nào? Ưu tiên dự án đang thi công khi cách gọi khớp nhiều dự án. Chọn "khac" nếu không có hoặc quá mơ hồ.' },
};

for (const [name, s] of Object.entries(SETS)) {
  const byId = new Map(s.rows.map(r => [s.id(r), r]));
  const cases = labels[name].map(l => {
    const top = rank(l.q, s.rows, s.nameOf, K, s.opts).map(x => s.id(x.r));
    const expectedIds = l.expected.filter(e => e !== 'khac');
    const injected = expectedIds.filter(e => !top.includes(e));
    const ids = [...top, ...injected].slice(0, K + injected.length);
    const criteria = {}; const map = {};
    ids.forEach((id, i) => { const key = `uv${i + 1}`; map[key] = id; criteria[key] = s.desc(byId.get(id)); });
    criteria.khac = 'Không có ứng viên nào đúng / không đủ thông tin';
    map.khac = 'khac';
    return { q: l.q, src: l.src, expected: l.expected, soft: !!l.soft, ambiguous: !!l.ambiguous, injected, state: { [s.stateKey]: l.q }, instructions: s.instructions, criteria, map };
  });
  writeFileSync(new URL(`./data/set-${name}.json`, import.meta.url), JSON.stringify(cases, null, 1));
  console.log(name, cases.length, 'ca;', cases.filter(c => c.injected.length).length, 'ca chèn ứng viên đúng');
}
