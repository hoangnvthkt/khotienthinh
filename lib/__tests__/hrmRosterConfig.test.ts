import { afterEach, describe, expect, it } from 'vitest';
import {
  fieldDef, fieldLabel, importItemsFor, isPayField, matchRosterImport, missingFields, parseRosterSheet, rosterFields,
  setRosterCustomFields, type RosterCatalogs, type RosterCustomFieldInput, type RosterRow,
} from '../hrmRoster';
import { customFieldProblems, effectiveStep1, type CustomFieldDraft } from '../hrmRosterConfig';

const field = (patch: Partial<RosterCustomFieldInput>): RosterCustomFieldInput => ({
  key: 'custom:abc123', label: 'Loại hợp đồng', group: 'contract', type: 'select', options: ['HĐ thử việc', 'HĐ 1 năm'],
  required: false, payOnly: false, hint: null, sortOrder: 1, isActive: true, ...patch,
});

const catalogs: RosterCatalogs = { orgUnits: [], positions: [], levels: [], groups: [], education: [], blocks: [] };
const person = (values: RosterRow['values'] = {}): RosterRow => ({ employeeId: 'e1', employeeCode: 'TT901', fullName: 'Lê Văn An', status: 'Đang làm việc', values, pending: {} });

afterEach(() => setRosterCustomFields([]));

describe('custom columns in the roster', () => {
  it('adds active columns at the end of their group and keeps labels of hidden ones', () => {
    setRosterCustomFields([
      field({}),
      field({ key: 'custom:pay001', label: 'Lương đóng BHXH', group: 'pay', type: 'money', options: [], sortOrder: 2 }),
      field({ key: 'custom:old001', label: 'Size áo', group: 'other', type: 'text', options: [], isActive: false, sortOrder: 3 }),
    ]);
    const keys = rosterFields().map(item => item.key);
    expect(keys.indexOf('custom:abc123')).toBe(keys.indexOf('leaveRemaining') + 1);
    expect(keys.indexOf('custom:pay001')).toBe(keys.indexOf('seniorityAllowance') + 1);
    expect(keys).not.toContain('custom:old001');
    expect(fieldLabel('custom:old001')).toBe('Size áo');
    expect(isPayField('custom:pay001')).toBe(true);
    expect(isPayField('custom:abc123')).toBe(false);
    expect(fieldDef('custom:abc123')).toMatchObject({ type: 'select', options: ['HĐ thử việc', 'HĐ 1 năm'], custom: true, editable: true });
  });

  it('turns a yes / no column into a Có / Không choice', () => {
    setRosterCustomFields([field({ key: 'custom:yes001', label: 'Đã ký cam kết', type: 'boolean', options: [] })]);
    expect(fieldDef('custom:yes001').options).toEqual(['Có', 'Không']);
  });

  it('counts a required column as missing only for people who can see it', () => {
    setRosterCustomFields([field({ required: true }), field({ key: 'custom:pay001', label: 'Lương đóng BHXH', group: 'pay', type: 'money', options: [], required: true })]);
    const row = person({ orgUnit: 'u', position: 'p', level: 'E1', startDate: '2020-01-01', phone: '0912345678', dateOfBirth: '1990-01-01', idNumber: '001099000123' });
    expect(missingFields(row, { viewPersonal: true, viewPay: false })).toEqual(['custom:abc123']);
    expect(missingFields(row, { viewPersonal: true, viewPay: true })).toEqual(['custom:abc123', 'custom:pay001']);
  });
});

describe('importing custom columns', () => {
  const HEADER = ['TT', 'Khối', 'Mã', 'Họ và tên', 'Vị trí công việc', null, null, 'Bộ phận', 'Level', 'Loại hợp đồng', 'Lương đóng BHXH'];
  const SUB = [null, null, null, null, 'Nhóm', 'Mã', 'Tên gọi'];

  it('reads the column by its name and rejects a choice that is not in the list', () => {
    setRosterCustomFields([field({}), field({ key: 'custom:pay001', label: 'Lương đóng BHXH', group: 'pay', type: 'money', options: [] })]);
    const parsed = parseRosterSheet('Data', [HEADER, SUB,
      [1, 'K1', 'X', 'Lê Văn An', null, null, 'Kỹ sư', 'Phòng A', 'E5', 'hđ 1 NĂM', 5100000],
      [2, 'K1', 'X', 'Trần Văn Bình', null, null, 'Kỹ sư', 'Phòng A', 'E5', 'HĐ 5 năm', null]]);
    expect(parsed.rows[0].values['custom:abc123']).toBe('HĐ 1 năm');
    expect(parsed.rows[0].values['custom:pay001']).toBe(5100000);
    expect(parsed.rows[1].values['custom:abc123']).toBeNull();
    expect(parsed.issues.some(issue => issue.fullName === 'Trần Văn Bình' && issue.column === 'Loại hợp đồng')).toBe(true);

    const plan = matchRosterImport(parsed, [person()]);
    const taken = () => false;
    const hr = importItemsFor(plan.matches[0], person(), catalogs, { viewPay: false, editPay: false }, taken).map(item => item.field);
    const manage = importItemsFor(plan.matches[0], person(), catalogs, { viewPay: true, editPay: true }, taken).map(item => item.field);
    expect(hr).toContain('custom:abc123');
    expect(hr).not.toContain('custom:pay001');
    expect(manage).toContain('custom:pay001');
  });
});

describe('Cấu hình', () => {
  const draft = (patch: Partial<CustomFieldDraft>): CustomFieldDraft => ({ label: 'Nguyên quán', group: 'personal', type: 'text', options: [], required: false, payOnly: false, hint: '', ...patch });

  it('explains what blocks saving a column', () => {
    expect(customFieldProblems(draft({}), [], ['CCCD'])).toEqual([]);
    expect(customFieldProblems(draft({ label: ' ' }), [], [])).toEqual(['Nhập tên cột (ít nhất 2 ký tự).']);
    expect(customFieldProblems(draft({ label: 'cccd' }), [], ['CCCD'])).toEqual(['Đã có cột cùng tên.']);
    expect(customFieldProblems(draft({ type: 'select', options: ['A'] }), [], [])).toEqual(['Danh sách chọn cần ít nhất 2 lựa chọn.']);
    expect(customFieldProblems(draft({ type: 'select', options: ['A', 'a', ''] }), [], [])).toEqual(['Có lựa chọn bị trùng.']);
  });

  it('uses HR Manage when step 1 is empty', () => {
    const config = { approvals: { general: { step1: [], step2: [] }, pay: { step1: ['u1'], step2: ['tgd'] } }, defaultApproverIds: ['giang', 'hoang'] };
    expect(effectiveStep1(config, 'general')).toEqual(['giang', 'hoang']);
    expect(effectiveStep1(config, 'pay')).toEqual(['u1']);
  });
});
