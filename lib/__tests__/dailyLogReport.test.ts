import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';
import {
  buildDrafts, datesInText, fold, formatTaskRow, leafTaskRows, learnPairs, memoryHints, reportTaskWindow, slipSaveInput,
  type MemoryAlias, type ReportRead,
} from '../dailyLogReport';
import { parseMemoryAliases } from '../aiMemoryService';
import type { ProjectTask } from '../../types';
import type { DailyLogDocumentBundle } from '../dailyLogWbsService';

// Trích cây hạng mục thật DA29 (17/10/2026): khối nhà → nhóm → phân đoạn → việc.
const t = (id: string, wbsCode: string, name: string, parentId: string | null, startDate?: string, endDate?: string, progress = 0) =>
  ({ id, wbsCode, name, parentId, startDate, endDate, progress }) as unknown as ProjectTask;
const TASKS = [
  t('nx', '4', 'NHÀ XƯỞNG (CHIA 3 PHÂN ĐOẠN)', null),
  t('mong', '4.1', 'Móng, dầm móng, giằng tường móng', 'nx'),
  t('pd2', '4.1.2', 'Phân đoạn 2 (Trục 6-15)', 'mong'),
  t('pd3', '4.1.3', 'Phân đoạn 3 (Trục 15-19)', 'mong'),
  t('t4128', '4.1.2.8', 'Gia công, lắp dựng cốt thép, ván khuôn tường móng', 'pd2', '2026-10-05', '2026-10-13', 30),
  t('t41312', '4.1.3.12', 'Xây tường móng hành lang PĐ 1+2+3', 'pd3', '2026-10-10', '2026-11-17', 0),
  t('nen', '4.2', 'San lấp, đầm nền', 'nx'),
  t('t426', '4.2.6', 'Đắp đá Base dày 30cm, đầm chặt K=0,95', 'nen', '2026-10-12', '2026-10-17', 0),
  t('t411', '4.1.1.1', 'Đào đất móng PĐ1', 'mong', '2026-08-01', '2026-08-10', 100),
  t('t499', '4.9.9', 'Hoàn thiện sơn', 'nx', '2027-01-01', '2027-01-20', 0),
];
const rows = leafTaskRows(TASKS);
const AREAS = [{ code: 'NX1', name: 'Nhà xưởng' }, { code: 'NHA-NGHI-CA', name: 'Nhà Nghỉ ca' }];
const READ: ReportRead = {
  days: [
    { date: '2026-10-15', weather: 'Nắng', issues: ['Thiếu cát chiều'], nextDayPlan: null, sections: [
      { area: 'Nhà xưởng', crews: [{ name: 'Tổ Mr Ích', canonical: 'Tổ Đỗ Duy Ích', people: 20 }], works: [
        { text: 'Lắp dựng cofa cổ cột, dầm chân tường', taskCodes: ['4.1.2.8'], location: null, quantity: null, unit: null, percent: null, confidence: 'high', reason: null },
        { text: 'Xây tường hàng lang', taskCodes: ['4.1.3.12'], location: null, quantity: null, unit: null, percent: 10, confidence: 'high', reason: null },
        { text: 'Xây bể làm mát', taskCodes: [], location: null, quantity: null, unit: null, percent: null, confidence: 'high', reason: null },
        { text: 'Đổ BT sàn', taskCodes: ['9.9.9'], location: null, quantity: null, unit: null, percent: null, confidence: 'high', reason: null },
      ] },
      { area: 'nha xuong', crews: [{ name: 'cn a Đoàn', canonical: null, people: null }], works: [
        { text: 'Đắp base trục 6-16', taskCodes: ['4.2.6'], location: 'trục 6-16', quantity: null, unit: null, percent: null, confidence: 'low', reason: 'base B hay base A?' },
      ] },
    ] },
    { date: '2026-10-20', weather: null, issues: [], nextDayPlan: null, sections: [
      { area: 'Khu cầu công', crews: [], works: [{ text: 'Dọn mặt bằng', taskCodes: [], location: null, quantity: null, unit: null, percent: null, confidence: 'high', reason: null }] },
    ] },
  ],
  warnings: [],
};

describe('dữ liệu gửi AI', () => {
  it('hạng mục lá với khối nhà + 2 cấp gần nhất', () => {
    expect(rows.map(r => r.code)).toEqual(['4.1.2.8', '4.1.3.12', '4.2.6', '4.1.1.1', '4.9.9']);
    expect(formatTaskRow(rows[0])).toBe('4.1.2.8 | NHÀ XƯỞNG (CHIA 3 PHÂN ĐOẠN) › Móng, dầm móng, giằng tường móng › Phân đoạn 2 (Trục 6-15) › Gia công, lắp dựng cốt thép, ván khuôn tường móng | 05/10→13/10 | 30%');
  });
  it('cửa sổ kế hoạch quanh ngày báo cáo: bỏ việc xong lâu và việc còn xa; giữ việc mới xong 14 ngày', () => {
    expect(reportTaskWindow(rows, ['2026-10-15']).map(r => r.code)).toEqual(['4.1.2.8', '4.1.3.12', '4.2.6']);
    expect(reportTaskWindow([...rows, { ...rows[3], id: 'x', code: '4.1.1.2', end: '2026-10-08' }], ['2026-10-15']).map(r => r.code)).toContain('4.1.1.2');
    // Quá giới hạn ký tự thì bỏ bớt (giữ việc gần ngày báo cáo nhất trước).
    expect(reportTaskWindow(rows, ['2026-10-15'], 30, formatTaskRow(rows[1]).length + 5).map(r => r.code)).toEqual(['4.1.3.12']);
  });
  it('ngày trong tin dán: dd/mm, dd/mm/yyyy; bỏ ngày sau ngày báo cáo hoặc quá 45 ngày', () => {
    expect(datesInText('BC ngày 13/10\n... 14/10/2026 ...\n15-10: xong; 31/12; 1/7; trục 6/16', '2026-10-17')).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });
  it('fold khớp chuẩn hóa máy chủ (ai_alias_norm)', () => {
    expect(fold('Lắp dựng COFA cổ cột!!')).toBe('lap dung cofa co cot');
    expect(fold('Tổ Đỗ Duy Ích')).toBe('to do duy ich');
  });
});

describe('kết quả AI → phiếu nháp', () => {
  it('gộp khu vực trùng tên, chỉ nhận mã có thật, ngày sau ngày báo cáo về ngày báo cáo, khu vực lạ thành mũi mới', () => {
    const slips = buildDrafts(READ, { reportDate: '2026-10-17', rows, areas: AREAS, memory: [] });
    expect(slips.map(s => `${s.date}|${s.areaCode}|${s.works.length}`)).toEqual(['2026-10-15|NX1|5', '2026-10-17|KHU-CAU-CONG|1']);
    const nx = slips[0];
    expect(nx.works.map(w => w.taskIds)).toEqual([['t4128'], ['t41312'], [], [], ['t426']]);
    expect(nx.works[3]).toMatchObject({ source: 'low', reason: 'Mã AI đưa không có trong kế hoạch.' });
    expect(nx.works[4]).toMatchObject({ source: 'low', reason: 'base B hay base A?' });
    expect(nx.crews.map(c => `${c.label}:${c.people}`)).toEqual(['Tổ Đỗ Duy Ích:20', 'cn a Đoàn:null']);
    expect(nx.issues).toEqual(['Thiếu cát chiều']);
  });

  it('trí nhớ: cách gọi đã xác nhận thắng AI (lấy đích nhiều lượt nhất), tổ / mũi theo tên chuẩn; gợi ý gửi AI', () => {
    const memory: MemoryAlias[] = [
      { kind: 'task', alias: 'Xây bể làm mát', aliasNorm: 'xay be lam mat', targetId: 't41312', targetLabel: '4.1.3.12 Xây tường', hits: 1 },
      { kind: 'task', alias: 'Lắp dựng cofa cổ cột, dầm chân tường', aliasNorm: 'lap dung cofa co cot dam chan tuong', targetId: 't4128', targetLabel: '4.1.2.8', hits: 3 },
      { kind: 'task', alias: 'Lắp dựng cofa cổ cột, dầm chân tường', aliasNorm: 'lap dung cofa co cot dam chan tuong', targetId: 't426', targetLabel: '4.2.6', hits: 1 },
      { kind: 'crew', alias: 'cn a Đoàn', aliasNorm: 'cn a doan', targetId: null, targetLabel: 'Tổ công nhật Đỗ Hiệp Đoàn', hits: 2 },
      { kind: 'area', alias: 'Khu cầu công', aliasNorm: 'khu cau cong', targetId: 'NX1', targetLabel: 'Nhà xưởng', hits: 1 },
    ];
    const slips = buildDrafts(READ, { reportDate: '2026-10-17', rows, areas: AREAS, memory });
    expect(slips[0].works[0]).toMatchObject({ taskIds: ['t4128'], source: 'memory' });
    expect(slips[0].works[2]).toMatchObject({ taskIds: ['t41312'], source: 'memory' });
    expect(slips[0].crews[1]).toMatchObject({ label: 'Tổ công nhật Đỗ Hiệp Đoàn', fromMemory: true });
    expect(slips[1].areaCode).toBe('NX1');
    expect(memoryHints(memory, rows)).toBe('Xây bể làm mát → 4.1.3.12\nLắp dựng cofa cổ cột, dầm chân tường → 4.1.2.8\nLắp dựng cofa cổ cột, dầm chân tường → 4.2.6\ncn a Đoàn → Tổ công nhật Đỗ Hiệp Đoàn\nKhu cầu công → Nhà xưởng');
  });

  it('học cách gọi: mọi hạng mục đã chọn, tổ đổi tên, khu vực khác tên mũi; không học việc phát sinh', () => {
    const slips = buildDrafts(READ, { reportDate: '2026-10-17', rows, areas: AREAS, memory: [] });
    const pairs = learnPairs(slips, rows);
    expect(pairs).toContainEqual({ kind: 'task', alias: 'Lắp dựng cofa cổ cột, dầm chân tường', targetId: 't4128', targetLabel: '4.1.2.8 Gia công, lắp dựng cốt thép, ván khuôn tường móng' });
    expect(pairs).toContainEqual({ kind: 'crew', alias: 'Tổ Mr Ích', targetId: null, targetLabel: 'Tổ Đỗ Duy Ích' });
    expect(pairs.some(p => p.alias === 'Xây bể làm mát')).toBe(false);
    expect(pairs.some(p => p.kind === 'area' && p.alias === 'Nhà xưởng')).toBe(false);
  });

  it('dữ liệu lưu phiếu: % chỉ khi báo cáo ghi, mốc khối lượng của phiếu, nhân công gắn việc đầu, phát sinh vào nội dung', () => {
    const [slip] = buildDrafts(READ, { reportDate: '2026-10-17', rows, areas: AREAS, memory: [] });
    const doc = {
      tasks: TASKS, workBoqItems: [{ id: 'boq-426', sourceTaskId: 't426' }],
      quantityBaselines: { t4128: { fingerprint: 'fp-4128' }, t426: { fingerprint: 'fp-426' } },
      resourceProviders: [{ id: 'p-ich', code: 'NCC-ICH', name: 'Tổ Đỗ Duy Ích', isActive: true }],
    } as unknown as DailyLogDocumentBundle;
    let n = 0;
    const input = slipSaveInput(slip, doc, { id: 'c1', rowVersion: 1 }, () => `k${(n += 1)}`);
    expect(input.items.map(i => ({ taskId: i.taskId, value: i.enteredValue, fp: i.baselineFingerprint, boq: i.workBoqItemId }))).toEqual([
      { taskId: 't4128', value: '', fp: 'fp-4128', boq: null },
      { taskId: 't41312', value: 10, fp: '', boq: null },
      { taskId: 't426', value: '', fp: 'fp-426', boq: 'boq-426' },
    ]);
    expect(input.items[2].note).toBe('- Đắp base trục 6-16');
    expect(input.items[0].issues).toBe('- Thiếu cát chiều');
    expect(input.labor).toEqual([{ workItemClientKey: 'k1', laborType: 'Tổ Đỗ Duy Ích', peopleCount: 20, hoursPerPerson: 8,
      provider: { entryMode: 'catalog', partnerId: 'p-ich', providerCodeSnapshot: 'NCC-ICH', providerNameSnapshot: 'Tổ Đỗ Duy Ích' } }]);
    expect(input.content).toContain('Việc ngoài kế hoạch — chờ QS:\n  - Xây bể làm mát\n  - Đổ BT sàn');
    expect(input.content).toContain('Nhân công chưa ghi số người: cn a Đoàn');
    expect(input.content).toContain('Thời tiết: Nắng');
  });
});

describe('skill daily_log_from_report + trí nhớ', () => {
  const skill = SKILLS.daily_log_from_report;
  it('đầu vào: chữ hoặc ảnh, ngày báo cáo hợp lệ, có danh sách hạng mục; chỉ chép nên tắt suy nghĩ', () => {
    expect(skill.noThinking).toBe(true);
    const ok = { text: 'BC 15/10 xây tường hành lang', reportDate: '2026-10-17', tasks: '4.1.3.12 | Nhà xưởng › Xây tường | 10/10→17/11 | 0%' };
    expect(skill.parseInput(ok)).toMatchObject({ pages: '0', reportDate: '2026-10-17' });
    expect(() => skill.parseInput({ ...ok, reportDate: '17/10/2026' })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ ...ok, tasks: '' })).toThrow('AI_BAD_INPUT');
    expect(() => skill.parseInput({ ...ok, text: 'ngắn' })).toThrow('AI_BAD_INPUT');
  });
  it('đầu ra: bỏ ngày sai, mã lạ ký tự, % > 100, dòng không chữ, mục rỗng', () => {
    const out = skill.parseOutput({ days: [
      { date: '15/10', sections: [{ area: 'Nhà xưởng', crews: [{ name: 'Tổ Ích', canonical: null, people: '20' }], works: [
        { text: 'Xây tường', taskCodes: ['4.1.3.12', 'DROP TABLE;'], location: null, quantity: null, unit: null, percent: 150, confidence: 'low', reason: 'x' },
        { text: ' ', taskCodes: [] }] }, { area: 'Trống', crews: [], works: [] }], weather: null, issues: ['Mưa'], nextDayPlan: null },
      { date: '2026-10-16', sections: [], weather: null, issues: [], nextDayPlan: null }], warnings: ['a'] }) as unknown as ReportRead;
    expect(out.days).toHaveLength(1);
    expect(out.days[0].date).toBeNull();
    expect(out.days[0].sections).toHaveLength(1);
    expect(out.days[0].sections[0].crews[0].people).toBe(20);
    expect(out.days[0].sections[0].works).toEqual([{ text: 'Xây tường', taskCodes: ['4.1.3.12'], location: null, quantity: null, unit: null, percent: null, confidence: 'low', reason: 'x' }]);
  });
  it('trí nhớ từ máy chủ: bỏ dòng lạ loại / thiếu đích', () => {
    expect(parseMemoryAliases([{ kind: 'task', alias: 'A', aliasNorm: 'a b', targetId: 't1', targetLabel: '1 A', hits: 2 }, { kind: 'item', aliasNorm: 'x', targetLabel: 'y' }, { kind: 'crew', aliasNorm: 'c' }]))
      .toEqual([{ kind: 'task', alias: 'A', aliasNorm: 'a b', targetId: 't1', targetLabel: '1 A', hits: 2 }]);
  });
});
