import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '../../types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import {
  employmentDateGaps, hrmWorkStatusService, statusChangeKind, validateEmploymentDate,
  workStatusAuditReason, workStatusErrorMessage,
} from '../hrmWorkStatus';

const person = (patch: Partial<Employee>): Employee => ({
  id: 'e1', employeeCode: 'TT001', fullName: 'Nguyễn A', title: '', gender: 'Nam', phone: '', email: '',
  status: 'Đang làm việc', ...patch,
});
const input = (patch: Partial<{ date: string; note: string; reference: string }> = {}) =>
  ({ date: '2026-10-15', note: 'Tự xin nghỉ', reference: '', ...patch });

describe('statusChangeKind', () => {
  it('asks for an exit date when resigning and a return date when coming back', () => {
    expect(statusChangeKind('Đang làm việc', 'Đã nghỉ việc')).toBe('exit');
    expect(statusChangeKind('Đã nghỉ việc', 'Đang làm việc')).toBe('return');
    expect(statusChangeKind('Đang làm việc', 'Đang làm việc')).toBeNull();
    expect(statusChangeKind(undefined, 'Đã nghỉ việc')).toBeNull();
  });
});

describe('validateEmploymentDate', () => {
  const today = '2026-10-19';
  it('requires a date that is not after today', () => {
    expect(validateEmploymentDate('exit', input({ date: '' }), {}, today)).toBe('Chọn ngày nghỉ việc.');
    expect(validateEmploymentDate('exit', input({ date: '2026-10-20' }), {}, today)).toBe('Ngày nghỉ việc không được sau hôm nay.');
    expect(validateEmploymentDate('exit', input({ date: today }), {}, today)).toBeNull();
  });

  it('keeps the exit on or after the start date and the return after the exit', () => {
    expect(validateEmploymentDate('exit', input({ date: '2026-01-04' }), { startDate: '2026-01-05' }, today))
      .toBe('Ngày nghỉ việc không được trước ngày vào làm 05/01/2026.');
    expect(validateEmploymentDate('exit', input({ date: '2026-01-05' }), { startDate: '2026-01-05' }, today)).toBeNull();
    expect(validateEmploymentDate('return', input({ date: '2026-03-31', note: 'Quay lại' }), { exitDate: '2026-03-31' }, today))
      .toBe('Ngày đi làm lại phải sau ngày nghỉ 31/03/2026.');
    expect(validateEmploymentDate('start', input({ date: '2026-04-01', note: '' }), { exitDate: '2026-03-31' }, today))
      .toBe('Ngày vào làm không được sau ngày nghỉ 31/03/2026.');
  });

  it('needs a short reason for exit and return, not for the start date', () => {
    expect(validateEmploymentDate('exit', input({ note: ' ' }), {}, today)).toBe('Ghi lý do ngắn.');
    expect(validateEmploymentDate('return', input({ note: '' }), {}, today)).toBe('Ghi lý do ngắn.');
    expect(validateEmploymentDate('start', input({ note: '' }), {}, today)).toBeNull();
  });
});

describe('employmentDateGaps', () => {
  it('lists resigned people without an exit date and active people without a start date', () => {
    const gaps = employmentDateGaps([
      person({ id: 'a', fullName: 'Trần B', status: 'Đã nghỉ việc' }),
      person({ id: 'b', fullName: 'An C', status: 'Đã nghỉ việc', exitDate: '2026-03-31' }),
      person({ id: 'c', fullName: 'Lê D', startDate: '' }),
      person({ id: 'd', fullName: 'Bùi E', startDate: '2025-01-06' }),
      person({ id: 'e', fullName: 'Đỗ F', status: 'Đã nghỉ việc', exitDate: '' }),
    ]);
    expect(gaps.resignedNoExit.map(p => p.id)).toEqual(['e', 'a']);
    expect(gaps.activeNoStart.map(p => p.id)).toEqual(['c']);
  });
});

describe('workStatusErrorMessage', () => {
  it('turns server codes into Vietnamese and keeps other messages', () => {
    expect(workStatusErrorMessage(new Error('HRM_WORK_STATUS_DATE_BEFORE_EXIT'), 'x')).toBe('Ngày đi làm lại phải sau ngày nghỉ việc.');
    expect(workStatusErrorMessage({ message: 'permission denied' }, 'x')).toBe('permission denied');
    expect(workStatusErrorMessage(null, 'Thử lại')).toBe('Thử lại');
  });
});

describe('hrmWorkStatusService', () => {
  beforeEach(() => rpc.mockReset());

  it('records the exit in one command with a reason long enough for the audit', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'Đã nghỉ việc', exitDate: '2026-10-15' }, error: null });
    const result = await hrmWorkStatusService.setStatus(person({}), 'Đã nghỉ việc', input({ reference: ' QĐ 12 ' }));
    expect(rpc).toHaveBeenCalledWith('set_hrm_employee_work_status', {
      p_employee_id: 'e1', p_status: 'Đã nghỉ việc', p_effective_date: '2026-10-15', p_note: 'Tự xin nghỉ',
      p_source_reference: 'QĐ 12', p_reason: 'Nghỉ việc TT001 từ 15/10/2026: Tự xin nghỉ',
    });
    expect(result).toEqual({ status: 'Đã nghỉ việc', exitDate: '2026-10-15' });
    expect(workStatusAuditReason('start', person({ employeeCode: '' }), input({ note: '' })).length).toBeGreaterThanOrEqual(10);
  });

  it('fills a missing start date and surfaces server refusals', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'HRM_START_DATE_ALREADY_SET' } });
    await expect(hrmWorkStatusService.setStartDate(person({}), '2025-01-06')).rejects.toThrow('HRM_START_DATE_ALREADY_SET');
    expect(rpc).toHaveBeenCalledWith('set_hrm_employee_start_date', {
      p_employee_id: 'e1', p_start_date: '2025-01-06', p_reason: 'Bổ sung ngày vào làm TT001 từ 06/01/2025',
    });
  });
});

describe('work status migration', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261020150000_hrm_work_status_events.sql'), 'utf8');

  it('writes the event and the status in one command, with the profile edit permission', () => {
    expect(sql).toContain("v_type := 'NGHI_VIEC'");
    expect(sql).toContain("v_type := 'TIEP_NHAN'");
    expect(sql).toMatch(/hrm_apply_work_status[\s\S]+for update/);
    expect(sql.match(/hrm\.employee\.edit_profile/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("perform app_private.audit_hrm_profile_command(\n    p_employee_id, 'HRM_EMPLOYMENT_EVENT'");
  });

  it('closes every path that changed the status without a date', () => {
    expect(sql).toMatch(/update_hrm_employee_core_profile[\s\S]+perform app_private\.hrm_apply_work_status/);
    expect(sql).toMatch(/archive_hrm_employee[\s\S]+HRM_WORK_STATUS_DATE_REQUIRED/);
    expect(sql).toContain('HRM_WORK_STATUS_CREATE_ACTIVE_ONLY');
    expect(sql).not.toMatch(/status = coalesce\(nullif\(trim\(p_status\)/);
  });

  it('reads the exit date the same way as the headcount chart and keeps grants tight', () => {
    expect(sql).toContain("'exit_date', case when employee.status = 'Đã nghỉ việc' then (");
    expect(sql).toContain("event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE'");
    expect(sql).toContain('revoke all on function app_private.hrm_apply_work_status(uuid, text, date, text, text, text) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.set_hrm_employee_work_status(uuid, text, date, text, text, text) to authenticated;');
  });
});
