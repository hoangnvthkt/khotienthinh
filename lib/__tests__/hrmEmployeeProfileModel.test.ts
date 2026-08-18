import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '../../types';
import { toEmployeeProfileUpdatePayload } from '../hrmEmployeeProfileModel';

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  id: 'e1', employeeCode: 'TT001', fullName: 'Nguyễn A', title: 'Cố vấn',
  gender: 'Nam', phone: '0900000000', email: 'a@example.com',
  status: 'Đang làm việc', ...overrides,
});

describe('HRM employee profile payload', () => {
  it('never writes organization-managed fields from the employee profile form', () => {
    const payload = toEmployeeProfileUpdatePayload(employee({
      orgUnitId: 'u1', positionId: 'p1', departmentId: 'd1',
      constructionSiteId: 'c1', factoryId: 'f1', title: 'Cố vấn',
    }));

    expect(payload).not.toHaveProperty('org_unit_id');
    expect(payload).not.toHaveProperty('position_id');
    expect(payload).not.toHaveProperty('department_id');
    expect(payload).not.toHaveProperty('construction_site_id');
    expect(payload).not.toHaveProperty('factory_id');
    expect(payload).not.toHaveProperty('title');
    expect(payload).toMatchObject({
      full_name: 'Nguyễn A',
      phone: '0900000000',
      email: 'a@example.com',
    });
  });

  it('normalizes optional personal fields to null without adding organization data', () => {
    const payload = toEmployeeProfileUpdatePayload(employee({
      officeId: undefined,
      employeeTypeId: '',
      maritalStatus: '',
      avatarUrl: undefined,
    }));

    expect(payload).toMatchObject({
      office_id: null,
      employee_type_id: null,
      marital_status: null,
      avatar_url: null,
    });
    expect(Object.keys(payload)).not.toContain('employee_code');
  });

  it('keeps organization selectors and title out of the employee profile form', () => {
    const source = readFileSync(join(process.cwd(), 'components/hrm/EmployeeModal.tsx'), 'utf8');
    const cardSource = readFileSync(
      join(process.cwd(), 'components/hrm/organization/HrmEmployeeOrganizationCard.tsx'),
      'utf8',
    );

    expect(source).toContain('HrmEmployeeOrganizationCard');
    expect(cardSource).toContain('Phân bổ / Chuyển vị trí');
    expect(source).not.toContain('name="title"');
    expect(source).not.toContain('name="positionId"');
    expect(source).not.toContain('name="orgUnitId"');
    expect(source).not.toContain('name="departmentId"');
    expect(source).not.toContain('name="constructionSiteId"');
    expect(source).not.toContain('name="factoryId"');
  });
});
