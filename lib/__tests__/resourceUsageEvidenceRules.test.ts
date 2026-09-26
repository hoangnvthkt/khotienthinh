import { describe, expect, it } from 'vitest';
import type { VerifiedResourceUsageEvidence } from '../../types';
import {
  buildResourceEvidenceProviderKey,
  groupResourceEvidence,
  sanitizeResourceEvidenceRow,
} from '../resourceUsageEvidenceRules';

const laborEvidence = (overrides: Partial<VerifiedResourceUsageEvidence> = {}): VerifiedResourceUsageEvidence => ({
  resourceLineId: crypto.randomUUID(),
  resourceType: 'labor',
  dailyLogId: 'summary-1',
  summarySourceId: 'source-1',
  contributionId: 'contribution-1',
  revisionNo: 1,
  revisionState: 'current',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  logDate: '2026-09-23',
  workAreaCode: 'A',
  workAreaName: 'Khu A',
  taskId: 'task-1',
  wbsCode: '1.1',
  taskName: 'Bê tông móng',
  provider: { entryMode: 'catalog', partnerId: 'partner-1', providerNameSnapshot: 'Công ty An Phát' },
  peopleCount: 5,
  hoursPerPerson: 6,
  totalLaborHours: 30,
  sourceUserName: 'Nguyễn Văn A',
  verifiedByName: 'Chỉ huy trưởng',
  verifiedAt: '2026-09-23T10:00:00Z',
  ...overrides,
});

describe('resourceUsageEvidenceRules', () => {
  it('keeps manual provider types separate and normalizes accents and spaces', () => {
    expect(buildResourceEvidenceProviderKey({
      entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: '  Tổ  Anh Minh ',
    })).toBe('manual:day_labor:to anh minh');
    expect(buildResourceEvidenceProviderKey({
      entryMode: 'manual', manualProviderType: 'machine_owner', manualProviderName: 'Tổ Anh Minh',
    })).toBe('manual:machine_owner:to anh minh');
    expect(buildResourceEvidenceProviderKey({
      entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'to anh minh',
    })).toBe('manual:day_labor:to anh minh');
    expect(buildResourceEvidenceProviderKey({
      entryMode: 'manual', manualProviderType: 'free_crew', manualProviderName: 'Đội Cọc',
    })).toBe('manual:free_crew:doi coc');
  });

  it('groups catalog evidence by partner id using only current physical quantities', () => {
    const groups = groupResourceEvidence([
      laborEvidence({ totalLaborHours: 30 }),
      laborEvidence({ totalLaborHours: 10, peopleCount: 2 }),
      laborEvidence({ revisionState: 'superseded', totalLaborHours: 99 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      providerKey: 'catalog:partner-1', peopleCount: 7,
      totalLaborHours: 40, machineCount: 0, totalMachineHours: 0, lineCount: 2,
    });
    expect(groups[0]).not.toHaveProperty('amount');
  });

  it('keeps manual providers of different types in different groups', () => {
    const groups = groupResourceEvidence([
      laborEvidence({ provider: { entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'Tổ Anh Minh' } }),
      laborEvidence({ provider: { entryMode: 'manual', manualProviderType: 'machine_owner', manualProviderName: 'Tổ Anh Minh' } }),
    ]);
    expect(groups.map(group => group.providerKey)).toEqual([
      'manual:day_labor:to anh minh', 'manual:machine_owner:to anh minh',
    ]);
  });

  it('drops legacy money fields from untrusted top-level and nested provider rows', () => {
    const row = sanitizeResourceEvidenceRow({
      resource_line_id: 'labor-1', resource_type: 'labor', total_labor_hours: 8,
      unit_cost: 900000, total_cost: 900000,
      provider: { entryMode: 'manual', manualProviderType: 'day_labor', manualProviderName: 'Tổ A', amount: 900000 },
    });
    expect(row).not.toHaveProperty('unitCost');
    expect(row).not.toHaveProperty('totalCost');
    expect(row.provider).not.toHaveProperty('amount');
    expect(JSON.stringify(row)).not.toContain('900000');
  });

  it('accepts the camelCase RPC row shape without losing lineage', () => {
    const row = sanitizeResourceEvidenceRow({
      resourceLineId: 'labor-1', resourceType: 'labor', dailyLogId: 'summary-1',
      summarySourceId: 'source-1', contributionId: 'contribution-1', revisionNo: 2,
      revisionState: 'current', logDate: '2026-09-23', workAreaCode: 'A',
      workAreaName: 'Khu A', taskId: 'task-1', taskName: 'Bê tông móng',
      verifiedAt: '2026-09-23T10:00:00Z',
      provider: { entryMode: 'catalog', partnerId: 'partner-1', providerNameSnapshot: 'NCC cũ' },
      peopleCount: 2, hoursPerPerson: 4, totalLaborHours: 8,
    });
    expect(row).toMatchObject({
      resourceLineId: 'labor-1', dailyLogId: 'summary-1', revisionNo: 2,
      provider: { providerNameSnapshot: 'NCC cũ' }, totalLaborHours: 8,
    });
  });
});
