// ══════════════════════════════════════════
//  PREDICTIVE SERVICE — Dự báo & phát hiện bất thường
// ══════════════════════════════════════════

import { InventoryItem, Transaction, ProjectFinance, HrmConstructionSite } from '../types';

// ═════════ Types ═════════

export interface ForecastPoint {
  date: string;
  actual?: number;
  predicted: number;
}

export interface StockForecast {
  itemId: string;
  itemName: string;
  itemSku: string;
  currentStock: number;
  minStock: number;
  unit: string;
  forecastDays: ForecastPoint[];
  daysUntilStockout: number | null; // null = won't run out
  trend: 'decreasing' | 'stable' | 'increasing';
  dailyConsumption: number;
}

export interface BudgetBurndown {
  projectId: string;
  projectName: string;
  totalBudget: number;
  totalActual: number;
  usagePercent: number;
  burnRate: number; // per day
  daysRemaining: number | null;
  estimatedOverrun: number | null; // null = within budget
  status: 'healthy' | 'warning' | 'critical';
  burndownPoints: { label: string; budget: number; actual: number }[];
}

export interface Anomaly {
  id: string;
  type: 'spike' | 'drop' | 'unusual_pattern';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  value: number;
  expectedRange: [number, number];
  detectedAt: string;
}

// ═════════ Statistical Helpers ═════════

function linearRegression(data: number[]): { slope: number; intercept: number; r2: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: data[0] || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += data[i];
    sumXY += i * data[i]; sumXX += i * i; sumYY += data[i] * data[i];
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const yMean = sumY / n;
  const ssTot = data.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const ssRes = data.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1));
}

function zScore(value: number, arr: number[]): number {
  const sd = stdDev(arr);
  return sd > 0 ? (value - mean(arr)) / sd : 0;
}

// ═════════ Stock Forecast ═════════

export function forecastStock(
  items: InventoryItem[],
  transactions: Transaction[],
  forecastDays: number = 30
): StockForecast[] {
  const now = Date.now();
  const day = 86400000;

  return items
    .filter(it => it.minStock > 0)
    .map(item => {
      const totalStock = Object.values(item.stockByWarehouse || {})
        .reduce((s, v) => s + (Number(v) || 0), 0);

      // Get daily consumption from last 30 days
      const dailyOut: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date(now - i * day).toISOString().split('T')[0];
        dailyOut[d] = 0;
      }

      transactions.forEach(tx => {
        if (tx.type !== 'EXPORT' && tx.type !== 'TRANSFER') return;
        const d = tx.date.split('T')[0];
        if (d in dailyOut) {
          const txQty = tx.items
            .filter(ti => ti.itemId === item.id)
            .reduce((s, ti) => s + ti.quantity, 0);
          dailyOut[d] += txQty;
        }
      });

      const consumptionData = Object.values(dailyOut).reverse();
      const avgConsumption = mean(consumptionData);
      const { slope, intercept } = linearRegression(consumptionData);

      // Generate forecast points
      const forecastPoints: ForecastPoint[] = [];
      let runningStock = totalStock;

      for (let i = 0; i < forecastDays; i++) {
        const date = new Date(now + i * day).toISOString().split('T')[0];
        const predictedConsumption = Math.max(0, intercept + slope * (consumptionData.length + i));
        runningStock -= predictedConsumption;

        forecastPoints.push({
          date,
          actual: i === 0 ? totalStock : undefined,
          predicted: Math.max(0, runningStock),
        });
      }

      // Days until stockout
      let daysUntilStockout: number | null = null;
      if (avgConsumption > 0) {
        daysUntilStockout = Math.ceil(totalStock / avgConsumption);
        if (daysUntilStockout > forecastDays * 2) daysUntilStockout = null;
      }

      const trend: StockForecast['trend'] = slope < -0.5 ? 'decreasing' : slope > 0.5 ? 'increasing' : 'stable';

      return {
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        currentStock: totalStock,
        minStock: item.minStock,
        unit: item.unit,
        forecastDays: forecastPoints,
        daysUntilStockout,
        trend,
        dailyConsumption: Math.round(avgConsumption * 100) / 100,
      };
    })
    .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999));
}

// ═════════ Budget Burndown ═════════

export function analyzeBudgetBurndown(
  finances: ProjectFinance[],
  sites: HrmConstructionSite[]
): BudgetBurndown[] {
  return finances
    .filter(f => f.status === 'active')
    .map(f => {
      const site = sites.find(s => s.id === f.constructionSiteId);
      const totalBudget = f.budgetMaterials + f.budgetLabor + f.budgetSubcontract + f.budgetMachinery + f.budgetOverhead;
      const totalActual = f.actualMaterials + f.actualLabor + f.actualSubcontract + f.actualMachinery + f.actualOverhead;

      if (totalBudget <= 0) return null;

      const usagePercent = (totalActual / totalBudget) * 100;
      const progress = f.progressPercent || 0;

      // Estimate burn rate: actual / progress * 100 = estimated total
      const estimatedTotal = progress > 0 ? (totalActual / progress) * 100 : totalActual;
      const estimatedOverrun = estimatedTotal > totalBudget ? estimatedTotal - totalBudget : null;

      // Calculate remaining budget days
      const startDate = f.contractSignDate ? new Date(f.contractSignDate) : null;
      const daysSinceStart = startDate ? Math.max(1, (Date.now() - startDate.getTime()) / 86400000) : 30;
      const burnRate = totalActual / daysSinceStart;
      const remainingBudget = totalBudget - totalActual;
      const daysRemaining = burnRate > 0 ? Math.ceil(remainingBudget / burnRate) : null;

      // Burndown chart data
      const quarters = ['VL', 'NC', 'TC', 'MÁY', 'CP khác'];
      const budgets = [f.budgetMaterials, f.budgetLabor, f.budgetSubcontract, f.budgetMachinery, f.budgetOverhead];
      const actuals = [f.actualMaterials, f.actualLabor, f.actualSubcontract, f.actualMachinery, f.actualOverhead];
      const burndownPoints = quarters.map((label, i) => ({
        label,
        budget: budgets[i],
        actual: actuals[i],
      }));

      const status: BudgetBurndown['status'] =
        usagePercent >= 100 ? 'critical' :
        usagePercent >= 85 ? 'warning' : 'healthy';

      return {
        projectId: f.constructionSiteId,
        projectName: site?.name || 'Dự án',
        totalBudget,
        totalActual,
        usagePercent,
        burnRate: Math.round(burnRate),
        daysRemaining,
        estimatedOverrun,
        status,
        burndownPoints,
      };
    })
    .filter(Boolean) as BudgetBurndown[];
}

// ═════════ Anomaly Detection ═════════

export function detectAnomalies(
  transactions: Transaction[],
  items: InventoryItem[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = Date.now();
  const day = 86400000;

  // Group transactions by day
  const dailyCounts: Record<string, number> = {};
  const dailyValues: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(now - i * day).toISOString().split('T')[0];
    dailyCounts[d] = 0;
    dailyValues[d] = 0;
  }

  transactions.forEach(tx => {
    const d = tx.date.split('T')[0];
    if (d in dailyCounts) {
      dailyCounts[d]++;
      const txValue = tx.items.reduce((s, ti) => s + ti.quantity * (ti.price || 0), 0);
      dailyValues[d] += txValue;
    }
  });

  const counts = Object.values(dailyCounts);
  const values = Object.values(dailyValues);

  // Check today for anomalies
  const today = new Date().toISOString().split('T')[0];
  const todayCount = dailyCounts[today] || 0;
  const todayValue = dailyValues[today] || 0;

  const countZ = zScore(todayCount, counts);
  const valueZ = zScore(todayValue, values);

  if (Math.abs(countZ) > 2) {
    anomalies.push({
      id: `anom_count_${today}`,
      type: countZ > 0 ? 'spike' : 'drop',
      severity: Math.abs(countZ) > 3 ? 'high' : 'medium',
      title: countZ > 0
        ? `📈 Số giao dịch hôm nay tăng đột biến`
        : `📉 Số giao dịch hôm nay giảm bất thường`,
      description: `Hôm nay có ${todayCount} giao dịch (trung bình: ${mean(counts).toFixed(0)}, σ: ${stdDev(counts).toFixed(1)})`,
      value: todayCount,
      expectedRange: [
        Math.max(0, Math.round(mean(counts) - 2 * stdDev(counts))),
        Math.round(mean(counts) + 2 * stdDev(counts)),
      ],
      detectedAt: new Date().toISOString(),
    });
  }

  if (Math.abs(valueZ) > 2 && todayValue > 0) {
    anomalies.push({
      id: `anom_value_${today}`,
      type: valueZ > 0 ? 'spike' : 'drop',
      severity: Math.abs(valueZ) > 3 ? 'high' : 'medium',
      title: valueZ > 0
        ? `💰 Giá trị giao dịch hôm nay cao bất thường`
        : `💸 Giá trị giao dịch hôm nay thấp bất thường`,
      description: `Giá trị: ${(todayValue / 1e6).toFixed(1)}M (TB: ${(mean(values) / 1e6).toFixed(1)}M)`,
      value: todayValue,
      expectedRange: [
        Math.max(0, mean(values) - 2 * stdDev(values)),
        mean(values) + 2 * stdDev(values),
      ],
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for items with unusual consumption
  items.filter(it => it.minStock > 0).forEach(item => {
    const itemTxs = transactions.filter(tx =>
      tx.type === 'EXPORT' && tx.items.some(ti => ti.itemId === item.id)
    );
    if (itemTxs.length < 5) return;

    const qtys = itemTxs.map(tx =>
      tx.items.filter(ti => ti.itemId === item.id).reduce((s, ti) => s + ti.quantity, 0)
    );
    const lastQty = qtys[qtys.length - 1] || 0;
    const z = zScore(lastQty, qtys);

    if (Math.abs(z) > 2.5) {
      anomalies.push({
        id: `anom_item_${item.id}`,
        type: z > 0 ? 'spike' : 'drop',
        severity: Math.abs(z) > 3 ? 'high' : 'medium',
        title: `${z > 0 ? '⬆️' : '⬇️'} ${item.name} — xuất kho ${z > 0 ? 'đột biến' : 'giảm mạnh'}`,
        description: `Lần cuối: ${lastQty} ${item.unit} (TB: ${mean(qtys).toFixed(1)}, σ: ${stdDev(qtys).toFixed(1)})`,
        value: lastQty,
        expectedRange: [
          Math.max(0, mean(qtys) - 2 * stdDev(qtys)),
          mean(qtys) + 2 * stdDev(qtys),
        ],
        detectedAt: new Date().toISOString(),
      });
    }
  });

  return anomalies.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });
}
