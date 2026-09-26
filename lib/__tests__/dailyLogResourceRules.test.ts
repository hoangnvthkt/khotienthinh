import { describe, expect, it } from 'vitest';
import {
  calculateLaborHours,
  calculateMachineHours,
  validateResourceProvider,
} from '../dailyLogResourceRules';

describe('dailyLogResourceRules', () => {
  it('accepts a catalog provider snapshot', () => {
    expect(validateResourceProvider({
      entryMode: 'catalog',
      partnerId: 'partner-1',
      providerCodeSnapshot: 'NCC-001',
      providerNameSnapshot: 'Công ty An Phát',
    })).toEqual({ valid: true, errorCode: null });
  });

  it('requires type and name for a manual provider', () => {
    expect(validateResourceProvider({
      entryMode: 'manual',
      manualProviderType: 'day_labor',
      manualProviderName: '',
    })).toEqual({ valid: false, errorCode: 'manual_provider_name_required' });
  });

  it('rejects fields from the other provider mode', () => {
    expect(validateResourceProvider({
      entryMode: 'catalog',
      partnerId: 'partner-1',
      providerNameSnapshot: 'Công ty An Phát',
      manualProviderName: 'Tổ nhập tay',
    })).toEqual({ valid: false, errorCode: 'catalog_provider_manual_fields_not_allowed' });

    expect(validateResourceProvider({
      entryMode: 'manual',
      partnerId: 'partner-1',
      manualProviderType: 'day_labor',
      manualProviderName: 'Tổ anh Minh',
    })).toEqual({ valid: false, errorCode: 'manual_provider_partner_not_allowed' });
  });

  it('calculates only physical usage', () => {
    expect(calculateLaborHours({ peopleCount: 5, hoursPerPerson: 6 })).toBe(30);
    expect(calculateMachineHours({ machineCount: 2, hoursPerMachine: 7.5 })).toBe(15);
  });

  it('rejects non-positive physical usage', () => {
    expect(() => calculateLaborHours({ peopleCount: 0, hoursPerPerson: 6 }))
      .toThrow('INVALID_LABOR_USAGE');
    expect(() => calculateMachineHours({ machineCount: 2, hoursPerMachine: -1 }))
      .toThrow('INVALID_MACHINE_USAGE');
  });
});
