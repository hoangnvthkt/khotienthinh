import {
  ContractCostItem,
  ProjectCostClassificationStatus,
  ProjectCostCategory,
  ProjectTransaction,
} from '../types';

export interface ContractCostItemOption {
  item: ContractCostItem;
  id: string;
  symbol: string;
  name: string;
  depth: number;
  displayIndex: string;
  label: string;
}

interface BuildOptions {
  activeOnly?: boolean;
}

const normalizeLookup = (value: unknown) => String(value || '').trim().toLowerCase();

const sortCostItems = (rows: ContractCostItem[]) =>
  [...rows].sort((a, b) =>
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    || String(a.symbol || '').localeCompare(String(b.symbol || ''), 'vi')
    || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));

export const buildContractCostItemOptions = (
  items: ContractCostItem[],
  options: BuildOptions = {},
): ContractCostItemOption[] => {
  const activeOnly = options.activeOnly ?? true;
  const rows = activeOnly ? items.filter(item => item.status === 'active') : [...items];
  const byParent = new Map<string, ContractCostItem[]>();
  rows.forEach(item => {
    const key = item.parentId || 'root';
    byParent.set(key, [...(byParent.get(key) || []), item]);
  });
  byParent.forEach((children, key) => byParent.set(key, sortCostItems(children)));

  const result: ContractCostItemOption[] = [];
  const visit = (parentId: string | null, depth: number, prefix: string) => {
    (byParent.get(parentId || 'root') || []).forEach((item, index) => {
      const displayIndex = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      result.push({
        item,
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        depth,
        displayIndex,
        label: `${displayIndex} - ${item.symbol} - ${item.name}`,
      });
      visit(item.id, depth + 1, displayIndex);
    });
  };

  visit(null, 0, '');
  return result;
};

export const resolveContractCostItem = (
  items: ContractCostItem[],
  rawValue: unknown,
  options: BuildOptions = {},
): ContractCostItem | null => {
  const value = normalizeLookup(rawValue);
  if (!value) return null;

  const optionRows = buildContractCostItemOptions(items, options);
  return optionRows.find(option =>
    normalizeLookup(option.id) === value
    || normalizeLookup(option.symbol) === value
    || normalizeLookup(option.name) === value
    || normalizeLookup(option.label) === value
    || value.split('-').map(part => normalizeLookup(part)).includes(normalizeLookup(option.symbol)))?.item || null;
};

export const inferProjectCostCategoryFromCostItem = (
  itemOrSymbol?: ContractCostItem | string | null,
): ProjectCostCategory => {
  const symbol = typeof itemOrSymbol === 'string'
    ? itemOrSymbol
    : itemOrSymbol?.symbol;
  const normalized = String(symbol || '').trim().toUpperCase();
  if (normalized === 'CPVL') return 'materials';
  if (normalized === 'CPNC') return 'labor';
  if (normalized === 'CPMTC') return 'machinery';
  if (['CPQL', 'CPL', 'CPC'].includes(normalized)) return 'overhead';
  return 'other';
};

export const getContractCostItemSnapshot = (
  item: ContractCostItem,
  status: ProjectCostClassificationStatus = 'manual',
): Pick<ProjectTransaction,
  'contractCostItemId'
  | 'contractCostItemSymbolSnapshot'
  | 'contractCostItemNameSnapshot'
  | 'costClassificationStatus'
> => ({
  contractCostItemId: item.id,
  contractCostItemSymbolSnapshot: item.symbol,
  contractCostItemNameSnapshot: item.name,
  costClassificationStatus: status,
});

export const clearContractCostItemSnapshot = (): Pick<ProjectTransaction,
  'contractCostItemId'
  | 'contractCostItemSymbolSnapshot'
  | 'contractCostItemNameSnapshot'
  | 'costClassificationStatus'
> => ({
  contractCostItemId: null,
  contractCostItemSymbolSnapshot: null,
  contractCostItemNameSnapshot: null,
  costClassificationStatus: 'unclassified',
});

export const applyContractCostItemToTransaction = <T extends Partial<ProjectTransaction>>(
  tx: T,
  item: ContractCostItem,
  status: ProjectCostClassificationStatus = 'manual',
): T & ReturnType<typeof getContractCostItemSnapshot> => ({
  ...tx,
  ...getContractCostItemSnapshot(item, status),
});
