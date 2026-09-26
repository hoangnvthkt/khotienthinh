import type { DailyLogResourceProvider } from '../types';

export type ResourceProviderValidationError =
  | 'catalog_provider_required'
  | 'catalog_provider_manual_fields_not_allowed'
  | 'manual_provider_type_required'
  | 'manual_provider_name_required'
  | 'manual_provider_partner_not_allowed';

export type ResourceProviderValidationResult =
  | { valid: true; errorCode: null }
  | { valid: false; errorCode: ResourceProviderValidationError };

const roundPhysicalUsage = (value: number): number =>
  Math.round((value + Number.EPSILON) * 10_000) / 10_000;

const hasManualProviderFields = (provider: DailyLogResourceProvider): boolean =>
  provider.manualProviderType != null
  || provider.manualProviderName != null
  || provider.manualProviderNote != null;

const hasCatalogProviderFields = (provider: DailyLogResourceProvider): boolean =>
  provider.partnerId != null
  || provider.providerCodeSnapshot != null
  || provider.providerNameSnapshot != null;

export const validateResourceProvider = (
  provider: DailyLogResourceProvider,
): ResourceProviderValidationResult => {
  if (provider.entryMode === 'catalog') {
    if (hasManualProviderFields(provider)) {
      return { valid: false, errorCode: 'catalog_provider_manual_fields_not_allowed' };
    }
    return provider.partnerId && provider.providerNameSnapshot?.trim()
      ? { valid: true, errorCode: null }
      : { valid: false, errorCode: 'catalog_provider_required' };
  }

  if (hasCatalogProviderFields(provider)) {
    return { valid: false, errorCode: 'manual_provider_partner_not_allowed' };
  }
  if (!provider.manualProviderType) {
    return { valid: false, errorCode: 'manual_provider_type_required' };
  }
  return provider.manualProviderName?.trim()
    ? { valid: true, errorCode: null }
    : { valid: false, errorCode: 'manual_provider_name_required' };
};

export const calculateLaborHours = (input: {
  peopleCount: number;
  hoursPerPerson: number;
}): number => {
  if (
    !Number.isFinite(input.peopleCount)
    || input.peopleCount <= 0
    || !Number.isFinite(input.hoursPerPerson)
    || input.hoursPerPerson <= 0
  ) {
    throw new RangeError('INVALID_LABOR_USAGE');
  }
  return roundPhysicalUsage(input.peopleCount * input.hoursPerPerson);
};

export const calculateMachineHours = (input: {
  machineCount: number;
  hoursPerMachine: number;
}): number => {
  if (
    !Number.isFinite(input.machineCount)
    || input.machineCount <= 0
    || !Number.isFinite(input.hoursPerMachine)
    || input.hoursPerMachine <= 0
  ) {
    throw new RangeError('INVALID_MACHINE_USAGE');
  }
  return roundPhysicalUsage(input.machineCount * input.hoursPerMachine);
};
