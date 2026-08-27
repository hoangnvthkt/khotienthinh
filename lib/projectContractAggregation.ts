import type {
  CustomerContract,
  HdContractStatus,
  SubcontractorContract,
  SupplierContract,
} from '../types';

export type ProjectContractType = 'customer' | 'supplier' | 'subcontractor';
export type ProjectContractTypeFilter = 'all' | ProjectContractType;

export interface ProjectContractView {
  id: string;
  code: string;
  name: string;
  partyName: string;
  type: ProjectContractType;
  value: number;
  signedDate?: string;
  effectiveDate?: string;
  endDate?: string;
  status: HdContractStatus;
  note?: string;
  sourcePath: string;
}

interface ProjectContractSources {
  customerContracts: CustomerContract[];
  supplierContracts: SupplierContract[];
  subcontractorContracts: SubcontractorContract[];
}

export const buildProjectContractViews = ({
  customerContracts,
  supplierContracts,
  subcontractorContracts,
}: ProjectContractSources): ProjectContractView[] => [
  ...customerContracts.map(contract => ({
    id: contract.id,
    code: contract.code,
    name: contract.name,
    partyName: contract.customerName,
    type: 'customer' as const,
    value: contract.value,
    signedDate: contract.signedDate,
    effectiveDate: contract.effectiveDate,
    endDate: contract.endDate,
    status: contract.status,
    note: contract.note,
    sourcePath: `/hd/customer/${contract.id}`,
  })),
  ...supplierContracts.map(contract => ({
    id: contract.id,
    code: contract.code,
    name: contract.name,
    partyName: contract.supplierName || 'Chưa xác định nhà cung cấp',
    type: 'supplier' as const,
    value: contract.value,
    signedDate: contract.signedDate,
    effectiveDate: contract.effectiveDate,
    endDate: contract.expiryDate,
    status: contract.status,
    note: contract.note,
    sourcePath: `/hd/supplier?supplierContractId=${contract.id}`,
  })),
  ...subcontractorContracts.map(contract => ({
    id: contract.id,
    code: contract.code,
    name: contract.name,
    partyName: contract.subcontractorName,
    type: 'subcontractor' as const,
    value: contract.value,
    signedDate: contract.signedDate,
    effectiveDate: contract.effectiveDate,
    endDate: contract.completionDate,
    status: contract.status,
    note: contract.note,
    sourcePath: `/hd/subcontractor/${contract.id}`,
  })),
].sort((left, right) => (right.signedDate || '').localeCompare(left.signedDate || ''));

export const filterProjectContractViews = (
  contracts: ProjectContractView[],
  filter: ProjectContractTypeFilter,
): ProjectContractView[] => filter === 'all'
  ? contracts
  : contracts.filter(contract => contract.type === filter);

export const summarizeProjectContracts = (contracts: ProjectContractView[]) => ({
  total: contracts.length,
  active: contracts.filter(contract => contract.status === 'active' || contract.status === 'signed').length,
  customerValue: contracts
    .filter(contract => contract.type === 'customer')
    .reduce((total, contract) => total + contract.value, 0),
  supplierValue: contracts
    .filter(contract => contract.type === 'supplier')
    .reduce((total, contract) => total + contract.value, 0),
  subcontractorValue: contracts
    .filter(contract => contract.type === 'subcontractor')
    .reduce((total, contract) => total + contract.value, 0),
});

export const filterContractOverviewGroups = <T extends { project: { id: string } }>(
  groups: T[],
  projectId: string,
): T[] => projectId === 'all'
  ? groups
  : groups.filter(group => group.project.id === projectId);

export const contractMatchesProjectFilter = (
  projectId: string | null | undefined,
  filter: string,
): boolean => {
  if (filter === 'all') return true;
  if (filter === 'unassigned') return !projectId;
  return projectId === filter;
};

export const removeSupplierContractDeepLink = (params: URLSearchParams): URLSearchParams => {
  const next = new URLSearchParams(params);
  next.delete('supplierContractId');
  return next;
};
