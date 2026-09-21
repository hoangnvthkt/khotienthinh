import type {
  BoqMaterialBalance,
  BoqMaterialBalanceInput,
  BoqMaterialDraftInput,
  BoqMaterialPlanPreview,
  BoqMaterialPlanPreviewGroup,
  BoqMaterialTreeNode,
  BoqMaterialTreePage,
} from '../../types/materialPlanning';
import { formatDecimal6, parseQuantity6, sumQuantitiesInUnit } from '../procurement/decimal';

const add = (...values: bigint[]) => values.reduce((total, value) => total + value, 0n);
const nonnegative = (value: bigint) => formatDecimal6(value > 0n ? value : 0n);

export function calculateBoqBalance(input: BoqMaterialBalanceInput): BoqMaterialBalance {
  if (!input.unit || input.unit.trim() !== input.unit) {
    throw new Error('INVALID_UNIT: A canonical unit is required.');
  }
  const budget = parseQuantity6(input.budget);
  const issues = [...new Set(input.issues || [])];
  const blockingIssues = [...new Set(input.blockingIssues || [])];
  const values = [
    input.issuedNet,
    input.open.awaitingApproval,
    input.open.awaitingArrangement,
    input.open.executing,
    input.closed,
  ];
  if (values.some(value => value == null)) {
    return {
      ...input,
      issues,
      blockingIssues,
      uncovered: null,
      excess: null,
      completeness: 'unknown',
      selectable: false,
    };
  }

  const issued = parseQuantity6(input.issuedNet!);
  const awaitingApproval = parseQuantity6(input.open.awaitingApproval!);
  const awaitingArrangement = parseQuantity6(input.open.awaitingArrangement!);
  const executing = parseQuantity6(input.open.executing!);
  const closed = parseQuantity6(input.closed!);
  const covered = add(issued, awaitingApproval, awaitingArrangement, executing, closed);
  return {
    ...input,
    issues,
    blockingIssues,
    uncovered: nonnegative(budget - covered),
    excess: nonnegative(covered - budget),
    completeness: issues.length > 0 || blockingIssues.length > 0 ? 'partial' : 'complete',
    selectable: blockingIssues.length === 0,
  };
}

export function buildBoqPlanPreview(input: { lines: BoqMaterialDraftInput[] }): BoqMaterialPlanPreview {
  const groups = new Map<string, BoqMaterialPlanPreviewGroup>();
  const sourceIds = new Set<string>();

  for (const draft of input.lines) {
    if (sourceIds.has(draft.line.id)) throw new Error('BOQ_PREVIEW_SOURCE_DUPLICATE');
    sourceIds.add(draft.line.id);
    if (!draft.line.balance.selectable || draft.line.balance.uncovered == null) {
      throw new Error('BOQ_PREVIEW_SOURCE_UNKNOWN');
    }
    if (!draft.line.itemId) throw new Error('BOQ_PREVIEW_ITEM_IDENTITY_MISSING');
    if (!draft.neededDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.neededDate)) {
      throw new Error('BOQ_PREVIEW_NEEDED_DATE_INVALID');
    }
    if (!draft.destination.trim()) throw new Error('BOQ_PREVIEW_DESTINATION_REQUIRED');

    const quantity = parseQuantity6(draft.draftQty);
    if (quantity > parseQuantity6(draft.line.balance.uncovered)) {
      throw new Error('BOQ_PREVIEW_QUANTITY_EXCEEDS_UNCOVERED');
    }
    if (quantity === 0n) continue;

    const key = `${draft.line.itemId}:${draft.line.unit}`;
    const allocation = {
      sourceBudgetLineId: draft.line.id,
      sourceWorkBoqItemId: draft.line.workBoqItemId,
      sourceTaskId: draft.line.taskId,
      quantity: formatDecimal6(quantity),
      neededDate: draft.neededDate,
      destination: draft.destination.trim(),
    };
    const current = groups.get(key);
    if (current) {
      current.allocations.push(allocation);
      current.totalQty = sumQuantitiesInUnit(
        current.allocations.map(item => ({ quantity: item.quantity, unit: current.unit })),
        current.unit,
      );
    } else {
      groups.set(key, {
        key,
        itemId: draft.line.itemId,
        sku: draft.line.sku,
        itemName: draft.line.itemName,
        unit: draft.line.unit,
        totalQty: formatDecimal6(quantity),
        allocations: [allocation],
      });
    }
  }

  return {
    groups: [...groups.values()].sort((left, right) => left.unit.localeCompare(right.unit)
      || left.itemName.localeCompare(right.itemName, 'vi')
      || left.itemId.localeCompare(right.itemId)),
    sourceLineCount: input.lines.length,
  };
}

export function groupBoqTreePage(input: Omit<BoqMaterialTreePage, 'nodes'> & { nodes: BoqMaterialTreeNode[] }): BoqMaterialTreePage {
  const nodeIds = new Set<string>();
  const lineIds = new Set<string>();
  const nodes = input.nodes.map(node => {
    if (nodeIds.has(node.id)) throw new Error('BOQ_TREE_NODE_DUPLICATE');
    nodeIds.add(node.id);
    const unitCounts = new Map<string, number>();
    for (const material of node.materials) {
      if (lineIds.has(material.id)) throw new Error('BOQ_TREE_LINE_DUPLICATE');
      lineIds.add(material.id);
      unitCounts.set(material.unit, (unitCounts.get(material.unit) || 0) + 1);
    }
    return {
      ...node,
      quantityGroups: [...unitCounts.entries()]
        .map(([unit, lineCount]) => ({ unit, lineCount }))
        .sort((left, right) => left.unit.localeCompare(right.unit)),
    };
  });
  return { ...input, nodes };
}
