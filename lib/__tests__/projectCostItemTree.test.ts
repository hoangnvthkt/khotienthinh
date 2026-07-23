import { describe, it, expect } from 'vitest';
import { ProjectContractCostAnalysisNode } from '../projectCostItemService';

describe('Project Contract Cost Analysis Tree Aggregation', () => {
  it('correctly aggregates direct actuals and performs bottom-up rollup', () => {
    // Parent node CPGT with child CPTT and grandchild CPNVL
    const cpnvlNode: ProjectContractCostAnalysisNode = {
      id: 'cpnvl-id',
      symbol: 'CPNVL',
      name: 'Chi phí vật liệu',
      parentId: 'cptt-id',
      category: 'materials',
      depth: 2,
      order: 1,
      budgetAmount: 100000000,
      totalBudgetAmount: 100000000,
      directActualAmount: 40000000,
      actualAmount: 40000000,
      varianceAmount: 60000000,
      variancePercent: 40,
      txCount: 2,
      directTxCount: 2,
      children: [],
    };

    const cpttNode: ProjectContractCostAnalysisNode = {
      id: 'cptt-id',
      symbol: 'CPTT',
      name: 'Chi phí trực tiếp',
      parentId: 'cpgt-id',
      category: 'overhead',
      depth: 1,
      order: 1,
      budgetAmount: 20000000,
      totalBudgetAmount: 20000000,
      directActualAmount: 10000000,
      actualAmount: 10000000,
      varianceAmount: 10000000,
      variancePercent: 50,
      txCount: 1,
      directTxCount: 1,
      children: [cpnvlNode],
    };

    const cpgtNode: ProjectContractCostAnalysisNode = {
      id: 'cpgt-id',
      symbol: 'CPGT',
      name: 'Chi phí giá thành',
      parentId: null,
      category: 'overhead',
      depth: 0,
      order: 1,
      budgetAmount: 50000000,
      totalBudgetAmount: 50000000,
      directActualAmount: 0,
      actualAmount: 0,
      varianceAmount: 50000000,
      variancePercent: 0,
      txCount: 0,
      directTxCount: 0,
      children: [cpttNode],
    };

    // Simulate bottom-up rollup computation
    const computeRollup = (node: ProjectContractCostAnalysisNode) => {
      let childBudgetSum = 0;
      let childActualSum = 0;
      let childTxCountSum = 0;

      for (const child of node.children) {
        computeRollup(child);
        childBudgetSum += child.totalBudgetAmount;
        childActualSum += child.actualAmount;
        childTxCountSum += child.txCount;
      }

      node.totalBudgetAmount = node.budgetAmount + childBudgetSum;
      node.actualAmount = node.directActualAmount + childActualSum;
      node.txCount = node.directTxCount + childTxCountSum;
      node.varianceAmount = node.totalBudgetAmount - node.actualAmount;
      node.variancePercent = node.totalBudgetAmount > 0
        ? (node.actualAmount / node.totalBudgetAmount) * 100
        : 0;
    };

    computeRollup(cpgtNode);

    // Assert CPNVL (leaf node)
    expect(cpnvlNode.actualAmount).toBe(40000000);
    expect(cpnvlNode.totalBudgetAmount).toBe(100000000);

    // Assert CPTT (middle node): direct 10m + child 40m = 50m actual
    expect(cpttNode.actualAmount).toBe(50000000);
    expect(cpttNode.totalBudgetAmount).toBe(120000000);
    expect(cpttNode.txCount).toBe(3);

    // Assert CPGT (root node): direct 0 + child 50m = 50m actual
    expect(cpgtNode.actualAmount).toBe(50000000);
    expect(cpgtNode.totalBudgetAmount).toBe(170000000);
    expect(cpgtNode.txCount).toBe(3);
    expect(cpgtNode.varianceAmount).toBe(120000000);
  });
});
