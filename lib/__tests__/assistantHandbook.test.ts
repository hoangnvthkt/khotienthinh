// Sổ tay Vioo (B3, 22/10/2026): tệp sinh phải khớp nguồn; tìm mục bằng từ khóa không dấu đúng ý; công cụ so_tay trả bước + mã mở màn.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HANDBOOK } from '../../supabase/functions/ai-gateway/handbook.generated';
import { scoreEntry, searchHandbook, tokens } from '../../supabase/functions/ai-gateway/handbook';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { runTool, TOOL_INFO, TOOLS } from '../../supabase/functions/ai-gateway/tools';
import { EXTRA_PAGES, ROUTE_KEYWORDS, quickActionDefs } from '../search/searchCatalog';
import { buildHandbook, entriesFromGuide, parseFrontmatter, renderGenerated } from '../../scripts/handbook/lib.mjs';
import { parseSources } from '../assistantChat';

const top = (q: string) => searchHandbook(q).map(h => h.entry.id);

describe('sổ tay — tệp sinh và nguồn', () => {
  it('handbook.generated.ts khớp docs/so-tay + hướng dẫn Dự án + danh mục (quên chạy npm run handbook:build thì đỏ)', () => {
    const docs = readdirSync('docs/so-tay').filter(f => f.endsWith('.md')).sort().map(name => ({ name, text: readFileSync(`docs/so-tay/${name}`, 'utf8') }));
    const guide = readFileSync('docs/huong-dan-su-dung-phong-quan-ly-du-an.md', 'utf8');
    const entries = buildHandbook({ docs, guide, catalog: { quickActions: quickActionDefs(new Date(2026, 0, 5)), extraPages: EXTRA_PAGES, routeKeywords: ROUTE_KEYWORDS } });
    expect(readFileSync('supabase/functions/ai-gateway/handbook.generated.ts', 'utf8')).toBe(renderGenerated(entries));
    expect(HANDBOOK.length).toBe(entries.length);
    expect(HANDBOOK.length).toBeGreaterThan(80);
    expect(renderGenerated(entries).length).toBeLessThan(500_000);
  });
  it('mục viết tay: frontmatter đủ, thân có bước, ≤ 1200 ký tự, đường dẫn bắt đầu bằng /', () => {
    for (const e of HANDBOOK.filter(x => x.source === 'docs')) {
      expect(e.title, e.id).toBeTruthy(); expect(e.routes.length, e.id).toBeGreaterThan(0);
      for (const r of e.routes) expect(r.route.startsWith('/'), `${e.id} ${r.route}`).toBe(true);
      expect(e.body, e.id).toMatch(/\*\*Các bước:\*\*/); expect(e.body.length, e.id).toBeLessThanOrEqual(1200);
    }
    expect(parseFrontmatter('---\ntitle: A\nroutes: /x|X;/y\n---\nthân').meta).toEqual({ title: 'A', routes: '/x|X;/y' });
  });
  it('hướng dẫn Dự án: trích mục có "Các bước thực hiện", gộp tab vào tiêu đề, route từ chữ "route `/da`"', () => {
    const guide = '## 3. Truy cập module\n### Mục đích\nMở module.\n### Các bước thực hiện\n1. Chọn **Dự án**.\n2. Route `/da`.\n`[HÌNH MINH HỌA: x]`\n### Lưu ý\nCần quyền.\n## 10. Tab Tiến độ\n### 10.1. Xem tiến độ\n#### Mục đích\nXem.\n#### Các bước thực hiện\n1. Mở tab.\n## 19. Checklist\n### Khi tạo\n- a\n';
    const out = entriesFromGuide(guide);
    expect(out.map(e => [e.id, e.title, e.routes[0].route])).toEqual([['du-an-3-truy-cap-module', 'Dự án: Truy cập module', '/da'], ['du-an-10-1-xem-tien-do', 'Dự án: Tiến độ · Xem tiến độ', '/da']]);
    expect(out[0].body).toBe('**Khi nào:** Mở module.\n**Các bước:**\n1. Chọn **Dự án**.\n2. Route `/da`.\n**Lưu ý:**\nCần quyền.');
  });
});

describe('sổ tay — tìm mục', () => {
  it('bỏ từ đệm, không dấu; câu thường gặp ra đúng mục đầu', () => {
    expect(tokens('Làm sao để xin nghỉ phép vậy em?')).toEqual(['nghi', 'phep']);
    expect(top('Làm sao để xin nghỉ phép vậy em?')[0]).toBe('so-tay-nghi-phep');
    expect(top('quên chấm công thì làm thế nào')[0]).toBe('so-tay-cham-cong-bu');
    expect(top('cách lập đơn hàng từ báo giá nhà cung cấp')[0]).toBe('so-tay-lap-don-hang');
    expect(top('chụp phiếu giao để nhận hàng ở kho')[0]).toBe('so-tay-nhan-hang-chup-phieu');
    expect(top('hướng dẫn ghi nhật ký công trường')[0]).toBe('so-tay-nhat-ky-cong-truong');
    expect(top('đặt xe đi công tác ở đâu')[0]).toBe('so-tay-dat-xe');
    expect(top('báo lỗi phần mềm cho admin kiểu gì')[0]).toBe('so-tay-gop-y-bao-loi');
    expect(top('xem phiếu lương của tôi')[0]).toBe('so-tay-nhan-su-phieu-luong');
  });
  it('hướng dẫn Dự án và danh mục cũng tìm được; mục lạc đề bị cắt; không khớp → rỗng', () => {
    expect(top('tạo mới dự án').some(id => id.startsWith('du-an-4-3'))).toBe(true);
    expect(top('đề xuất mã vật tư mới')).toContain('thao-tac-new-code');
    expect(top('đổi nền sáng tối')).toContain('thao-tac-theme');
    expect(top('cách nấu phở cho ngon')).toEqual([]);
    expect(top('đặt suất ăn trưa ở căng tin')).toEqual([]);
    expect(top('')).toEqual([]);
    const leave = HANDBOOK.find(e => e.id === 'so-tay-nghi-phep')!;
    expect(scoreEntry(leave, ['nghi', 'phep'])).toBeGreaterThan(scoreEntry(HANDBOOK.find(e => e.id === 'thao-tac-leave')!, ['nghi', 'phep']) - 1);
  });
});

describe('công cụ so_tay', () => {
  it('có trong danh sách, không RPC; trả bước + mã mở màn hN (nguồn page) cho tối đa 3 mục; không khớp → ket_qua rỗng + ghi chú không bịa', async () => {
    expect(TOOLS.find(t => t.name === 'so_tay')).toBeTruthy();
    expect(TOOL_INFO.so_tay).toMatchObject({ kind: 'tra_cuu', rpcs: [] });
    const book = new SourceBook();
    const ctx = { rpc: async () => ({ data: null, error: null }), book };
    const out = JSON.parse(await runTool('so_tay', { cau_hoi: 'xin nghỉ phép' }, ctx, new Map()));
    expect(out.ket_qua[0]).toMatchObject({ tieu_de: 'Xin nghỉ phép', phan_he: 'Nhân sự', mo_man: [{ ma: 'h1', nhan: 'Nghỉ phép' }] });
    expect(out.ket_qua[0].noi_dung).toContain('**Gửi đơn**');
    expect(out.ket_qua.length).toBeLessThanOrEqual(3);
    expect(out.ghi_chu).toMatch(/\[\[hN\]\]/);
    const cited = book.cited('Anh mở Nghỉ phép [[h1]] rồi bấm Gửi đơn.');
    expect(cited).toEqual([{ ref: 'h1', type: 'page', page: { route: '/hrm/leave', label: 'Nghỉ phép', title: 'Xin nghỉ phép' } }]);
    expect(parseSources(cited)).toEqual([{ ref: 'h1', type: 'page', page: { route: '/hrm/leave', label: 'Nghỉ phép', title: 'Xin nghỉ phép' } }]);
    expect(parseSources([{ ref: 'h2', type: 'page', page: { route: 'javascript:alert(1)', label: 'x' } }])).toEqual([]);
    const none = JSON.parse(await runTool('so_tay', { cau_hoi: 'đặt suất ăn trưa ở căng tin' }, ctx, new Map()));
    expect(none.ket_qua).toEqual([]); expect(none.ghi_chu).toMatch(/Không bịa bước/);
  });
});
