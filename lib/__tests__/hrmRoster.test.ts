import { describe, expect, it } from 'vitest';
import {
  codeFromIdNumber, importItemsFor, matchRosterImport, missingFields, monthStartOf, parseRosterDate, parseRosterSheet, pay3pLabel,
  salaryTotal, seniorityMonths, uniqueCodeFromIdNumber, type RosterCatalogs, type RosterRow,
} from '../hrmRoster';

const catalogs: RosterCatalogs = {
  orgUnits: [
    { id: 'u-bld', code: 'BLĐ', name: 'Ban lãnh đạo', blockCode: 'K1' },
    { id: 'u-tt', code: 'TTTH', name: 'Phòng Truyền Thông Thương Hiệu', blockCode: 'K1' },
  ],
  positions: [
    { id: 'p-tgd', code: 'VT001', name: 'Tổng giám đốc', groupCode: 'BoD', levelCode: 'E10' },
    { id: 'p-tp', code: 'VT013', name: 'Trưởng phòng Truyền thông', groupCode: 'QLCT', levelCode: 'E8' },
  ],
  levels: [{ code: 'E8', name: 'Quản lý cấp trung' }, { code: 'E10', name: 'Tổng giám đốc' }],
  groups: [],
  education: [{ code: 'ĐH', name: 'Đại học' }, { code: 'THPT', name: 'THPT (12/12)' }],
  blocks: [{ code: 'K1', name: 'Khối 1' }],
};

const person = (id: string, code: string, fullName: string, values: RosterRow['values'] = {}): RosterRow =>
  ({ employeeId: id, employeeCode: code, fullName, status: 'Đang làm việc', values, pending: {} });

// Two header rows like the company "Data" sheet: "Vị trí công việc" spans Nhóm / Mã / Tên gọi.
const HEADER = ['TT', 'Khối', 'Mã', 'Họ và tên', 'Vị trí công việc', null, null, 'Bộ phận', 'Level', 'Tổng lương hiện tại', 'Lương cơ bản\r\n(P1)',
  'PCTN \r\n(P2)', 'PC điện thoại\r\n(p2)', 'P3 tiêu chuẩn', 'PC giữ gìn xe', null, null, 'Tổng lương sau khi +thâm niên', ' Ngày vào ',
  ' Ngày ký HĐLĐ chính thức ', ' Phép năm \r\n(tính đến tháng hiện tại) ', ' SDT liên hệ ', ' Ngày sinh ', ' CCCD ', ' Ngày cấp ', ' Nơi cấp ',
  ' Địa chỉ thường trú ', ' Trình độ ', ' Nơi đào tạo ', null, 'Mô tả/ghi chú'];
const SUB = [null, null, null, null, 'Nhóm', 'Mã', 'Tên gọi', null, null, null, null, null, null, null, null, ' Thâm Niên '];
const row = (cells: Record<number, unknown>) => Array.from({ length: 31 }, (_, i) => cells[i] ?? null);

const matrix = [
  [null, null, 'DATA NHÂN SỰ'],
  HEADER,
  SUB,
  row({ 2: 'KHỐI 1 - VĂN PHÒNG' }),
  row({ 0: 1, 1: 'K1', 2: 'BLD', 3: 'Nguyễn Văn An', 4: 'BoD', 5: 'VT001', 6: 'Tổng giám đốc', 7: 'Ban lãnh đạo', 8: 'E10',
    10: 10000000, 11: 1000000, 12: 0, 13: 17000000, 15: 185, 16: 2000000, 18: '15/4/2011', 19: 40648, 20: 11,
    21: 912345678, 22: 29768, 23: '001099000123', 24: 44454, 25: 'Cục CS QLHC', 26: 'Hưng Yên', 27: 'Đại học', 30: 'ghi chú' }),
  row({ 0: 2, 3: 'Trần Thị Bích', 6: 'Trưởng phòng Truyền thông', 7: 'Phòng Truyền thông thương hiệu', 8: 'E8',
    18: '1/0/00', 21: '0988 111 222 / 0977000111', 23: 10990004567, 27: 'Khác' }),
];

describe('parseRosterDate', () => {
  it('reads Excel serial dates and d/m/yyyy text the same way', () => {
    expect(parseRosterDate(40648)).toEqual({ value: '2011-04-15', bad: false });
    expect(parseRosterDate('15/4/2011')).toEqual({ value: '2011-04-15', bad: false });
    expect(parseRosterDate('3/9/26')).toEqual({ value: '2026-09-03', bad: false });
  });
  it('flags impossible dates instead of guessing', () => {
    expect(parseRosterDate('1/0/00')).toEqual({ value: null, bad: true });
    expect(parseRosterDate('31/2/2026')).toEqual({ value: null, bad: true });
    expect(parseRosterDate(' -   ')).toEqual({ value: null, bad: false });
  });
});

describe('parseRosterSheet', () => {
  const parsed = parseRosterSheet('Data', matrix);
  it('skips group rows and maps columns by header text', () => {
    expect(parsed.rows.map(r => r.fullName)).toEqual(['Nguyễn Văn An', 'Trần Thị Bích']);
    const [an] = parsed.rows;
    expect(an.positionText).toBe('Tổng giám đốc');
    expect(an.levelText).toBe('E10');
    expect(an.values).toMatchObject({ startDate: '2011-04-15', officialDate: '2011-04-15', p1: 10000000, phoneAllowance: 0, p3: 17000000, seniorityAllowance: 2000000, leaveRemaining: 11, idNumber: '001099000123' });
  });
  it('repairs numbers Excel stripped and reports what it did', () => {
    const [an, bich] = parsed.rows;
    expect(an.values.phone).toBe('0912345678');
    expect(bich.values.idNumber).toBe('010990004567');
    expect(bich.values.phone).toBe('0988111222');
    expect(bich.values.startDate).toBeNull();
    expect(parsed.issues.map(i => `${i.fullName}:${i.column}`)).toEqual(expect.arrayContaining([
      'Nguyễn Văn An:SĐT', 'Trần Thị Bích:Ngày vào', 'Trần Thị Bích:SĐT', 'Trần Thị Bích:CCCD',
    ]));
  });
});

describe('matchRosterImport', () => {
  const parsed = parseRosterSheet('Data', matrix);
  it('matches exact names, asks HR when the name is written differently, and lists people missing from the file', () => {
    const roster = [person('e1', 'TT905', 'Nguyễn Văn An'), person('e2', 'TT906', 'Trần Bích'), person('e3', 'TT907', 'demo')];
    const plan = matchRosterImport(parsed, roster);
    expect(plan.matches.map(m => [m.row.fullName, m.how, m.employeeId, m.candidates])).toEqual([
      ['Nguyễn Văn An', 'name', 'e1', []],
      ['Trần Thị Bích', 'confirm', null, ['e2']],
    ]);
    expect(plan.notInFile.map(r => r.employeeCode)).toEqual(['TT907']);
  });
  it('treats tone-mark placement as the same name; a different tone is only a suggestion for HR', () => {
    const sheet = parseRosterSheet('Data', [HEADER, SUB, row({ 3: 'Lê Văn Thủy' }), row({ 3: 'Trần Văn Thanh' })]);
    const plan = matchRosterImport(sheet, [person('a', 'TT901', 'Lê Văn Thuỷ'), person('b', 'TT902', 'Trần Văn Thành')]);
    expect(plan.matches.map(m => [m.how, m.employeeId])).toEqual([['variant', 'a'], ['confirm', null]]);
  });
  it('never auto-picks one of two people with the same name', () => {
    const sheet = parseRosterSheet('Data', [HEADER, SUB, row({ 3: 'Đỗ Ngọc Đức (1)' })]);
    const plan = matchRosterImport(sheet, [person('a', 'TT903', 'Đỗ Ngọc Đức'), person('b', 'TT904', 'Đỗ Ngọc Đức')]);
    expect(plan.matches[0]).toMatchObject({ how: 'confirm', employeeId: null, candidates: ['a', 'b'] });
  });
});

describe('importItemsFor', () => {
  const parsed = parseRosterSheet('Data', matrix);
  const roster = [person('e1', 'TT905', 'Nguyễn Văn An', { orgUnit: 'u-bld', position: 'p-tgd', startDate: '2011-01-01', phone: '0999000001' })];
  const plan = matchRosterImport(parsed, roster);
  const taken = (code: string, id: string | null) => roster.some(r => r.employeeCode === code && r.employeeId !== id);

  it('fills empty cells, corrects different ones, keeps equal ones, and derives the new code from CCCD', () => {
    const items = importItemsFor(plan.matches[0], roster[0], catalogs, { viewPay: true, editPay: true }, taken);
    const byField = Object.fromEntries(items.map(i => [i.field, [i.oldValue, i.newValue]]));
    expect(byField.orgUnit).toBeUndefined();
    expect(byField.position).toBeUndefined();
    expect(byField.startDate).toEqual(['2011-01-01', '2011-04-15']);
    expect(byField.phone).toEqual(['0999000001', '0912345678']);
    expect(byField.level).toEqual([null, 'E10']);
    expect(byField.education).toEqual([null, 'ĐH']);
    expect(byField.employeeCode).toEqual(['TT905', 'TT000123']);
    expect(items.every(i => i.personKey === 'e1')).toBe(true);
  });
  it('leaves pay out for HR without the compensation permission', () => {
    const items = importItemsFor(plan.matches[0], roster[0], catalogs, { viewPay: false, editPay: false }, taken);
    expect(items.some(i => ['p1', 'pctn', 'p3', 'seniorityAllowance'].includes(i.field))).toBe(false);
  });
  it('creates a new person with a temporary key and the full name', () => {
    const items = importItemsFor({ ...plan.matches[1], how: 'new', employeeId: null }, null, catalogs, { viewPay: true, editPay: true }, taken);
    expect(items[0]).toMatchObject({ employeeId: null, personKey: 'new:6', field: 'fullName', newValue: 'Trần Thị Bích' });
    expect(items.find(i => i.field === 'position')?.newValue).toBe('p-tp');
    expect(items.find(i => i.field === 'orgUnit')?.newValue).toBe('u-tt');
    expect(items.some(i => i.field === 'education')).toBe(false);
  });
});

describe('codes and helpers', () => {
  it('builds TT + last 6 digits and takes one more digit when the code is used', () => {
    expect(codeFromIdNumber('036199004321')).toBe('TT004321');
    expect(codeFromIdNumber('12345')).toBeNull();
    expect(uniqueCodeFromIdNumber('036199004321', code => code === 'TT004321')).toBe('TT9004321');
  });
  it('counts placeholder phones as missing, never as known', () => {
    const row = person('x', 'TT1', 'A', { orgUnit: 'u', position: 'p', level: 'E1', startDate: '2020-01-01', phone: '0999999999', dateOfBirth: '1990-01-01', idNumber: '0' });
    expect(missingFields(row, { viewPersonal: true })).toEqual(['phone']);
    expect(missingFields(row, { viewPersonal: false })).toEqual([]);
  });
  it('computes seniority in whole months', () => {
    expect(seniorityMonths('2011-04-15', '2026-10-16')).toBe(186);
    expect(seniorityMonths('2026-10-17', '2026-10-16')).toBe(0);
    expect(seniorityMonths(null, '2026-10-16')).toBeNull();
  });
});

describe('3P', () => {
  it('adds up the agreed total from P3 tiêu chuẩn, and stays unknown when no pay is known', () => {
    expect(salaryTotal({ p1: 6600000, pctn: 450000, phoneAllowance: 450000, p3: 8000000 })).toBe(15500000);
    expect(salaryTotal({ p1: null, p3: null })).toBeNull();
  });
  it('labels the bậc and dải, an upcoming start and rows HR must check', () => {
    const base = { grade: 'E5', band: null, from: '2026-10-01', to: null, review: 'approved' as const, note: null, source: 'roster_data' };
    expect(pay3pLabel(base, '2026-10-16')).toBe('E5 · Chưa xếp dải');
    expect(pay3pLabel({ ...base, band: 'B3', from: '2026-11-01' }, '2026-10-16')).toBe('E5 · B3 · từ 01/11/2026');
    expect(pay3pLabel({ ...base, review: 'needs_review' }, '2026-10-16')).toBe('E5 · Chưa xếp dải · cần xem');
    expect(pay3pLabel(null, '2026-10-16')).toBeNull();
  });
  it('starts pay changes on the 1st of the month', () => {
    expect(monthStartOf('2026-10-16')).toBe('2026-10-01');
  });
});
