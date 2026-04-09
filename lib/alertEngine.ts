// ══════════════════════════════════════════
//  SMART ALERT ENGINE — Quét & Cảnh báo tự động
// ══════════════════════════════════════════

import {
  InventoryItem, MaterialRequest, ProjectFinance, Asset,
  LaborContract, AssetMaintenance, HrmConstructionSite, AssetStatus
} from '../types';

// ═════════ Alert Types ═════════

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 
  | 'low_stock'        // Tồn kho thấp
  | 'request_overdue'  // Phiếu quá hạn SLA
  | 'budget_overrun'   // Ngân sách vượt
  | 'contract_expiring'// Hợp đồng sắp hết hạn
  | 'asset_maintenance'// Thiết bị quá hạn bảo trì
  | 'asset_warranty'   // Thiết bị hết bảo hành
  | 'project_deadline' // Dự án sắp deadline
  | 'waste_threshold'; // Hao hụt vượt ngưỡng

export interface SmartAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  entityId: string;       // ID of the related entity
  entityType: string;     // 'item' | 'request' | 'project' | 'contract' | 'asset'
  navigateTo?: string;    // Route to navigate to
  createdAt: string;
  dismissed?: boolean;
  actionLabel?: string;   // "Tạo đề xuất mua" | "Xem chi tiết"
}

// ═════════ Alert Rules Configuration ═════════

const RULES = {
  LOW_STOCK_THRESHOLD: 1.0,     // stock <= minStock * ratio → alert
  REQUEST_SLA_HOURS: 48,        // Phiếu chờ > 48h → overdue
  BUDGET_WARNING_PERCENT: 90,   // Budget usage > 90% → warning
  BUDGET_CRITICAL_PERCENT: 100, // Budget usage > 100% → critical
  CONTRACT_EXPIRY_DAYS: 30,     // HĐ hết hạn < 30 ngày → warning
  CONTRACT_EXPIRY_CRITICAL: 7,  // HĐ hết hạn < 7 ngày → critical
  MAINTENANCE_OVERDUE_DAYS: 0,  // Quá hạn bảo trì → alert
  WARRANTY_EXPIRY_DAYS: 30,     // Bảo hành sắp hết < 30 ngày
  PROJECT_DEADLINE_DAYS: 14,    // Dự án sắp deadline < 14 ngày
  WASTE_THRESHOLD_PERCENT: 10,  // Hao hụt > 10% → alert
};

// ═════════ Helper Functions ═════════

const genId = () => `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

function daysBetween(dateStr: string, reference?: Date): number {
  const target = new Date(dateStr);
  const ref = reference || new Date();
  return Math.ceil((target.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
}

function hoursSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

// ═════════ Alert Scanners ═════════

/** Scan 1: Tồn kho thấp */
function scanLowStock(items: InventoryItem[]): SmartAlert[] {
  return items
    .filter(item => {
      if (!item.minStock || item.minStock <= 0) return false;
      const totalStock = Object.values(item.stockByWarehouse || {})
        .reduce((sum: number, qty) => sum + (Number(qty) || 0), 0);
      return totalStock <= item.minStock * RULES.LOW_STOCK_THRESHOLD;
    })
    .map(item => {
      const totalStock = Object.values(item.stockByWarehouse || {})
        .reduce((sum: number, qty) => sum + (Number(qty) || 0), 0);
      const isOut = totalStock <= 0;
      return {
        id: genId(),
        category: 'low_stock' as AlertCategory,
        severity: isOut ? 'critical' as AlertSeverity : 'warning' as AlertSeverity,
        title: isOut ? `🔴 ${item.name} — HẾT HÀNG` : `⚠️ ${item.name} — Tồn thấp`,
        message: isOut
          ? `${item.sku} đã hết hàng (tồn: 0, tối thiểu: ${item.minStock}). Cần bổ sung gấp!`
          : `${item.sku} tồn ${totalStock} / tối thiểu ${item.minStock} ${item.unit}`,
        entityId: item.id,
        entityType: 'item',
        navigateTo: '/inventory',
        createdAt: now(),
        actionLabel: 'Tạo đề xuất mua',
      };
    });
}

/** Scan 2: Phiếu đề xuất quá SLA */
function scanOverdueRequests(requests: MaterialRequest[]): SmartAlert[] {
  return requests
    .filter(r => r.status === 'PENDING' && hoursSince(r.createdDate) > RULES.REQUEST_SLA_HOURS)
    .map(r => {
      const hours = Math.round(hoursSince(r.createdDate));
      const days = Math.floor(hours / 24);
      return {
        id: genId(),
        category: 'request_overdue' as AlertCategory,
        severity: days >= 3 ? 'critical' as AlertSeverity : 'warning' as AlertSeverity,
        title: `⏰ ${r.code} — Chờ duyệt ${days > 0 ? `${days} ngày` : `${hours}h`}`,
        message: `Phiếu đề xuất ${r.code} đã chờ duyệt quá ${RULES.REQUEST_SLA_HOURS}h SLA. Vui lòng xử lý.`,
        entityId: r.id,
        entityType: 'request',
        navigateTo: '/requests',
        createdAt: now(),
        actionLabel: 'Duyệt ngay',
      };
    });
}

/** Scan 3: Ngân sách dự án vượt ngưỡng */
function scanBudgetOverrun(
  finances: ProjectFinance[],
  sites: HrmConstructionSite[]
): SmartAlert[] {
  return finances
    .filter(f => f.status === 'active')
    .map(f => {
      const totalBudget = f.budgetMaterials + f.budgetLabor + f.budgetSubcontract + f.budgetMachinery + f.budgetOverhead;
      const totalActual = f.actualMaterials + f.actualLabor + f.actualSubcontract + f.actualMachinery + f.actualOverhead;
      if (totalBudget <= 0) return null;
      
      const usagePercent = (totalActual / totalBudget) * 100;
      const site = sites.find(s => s.id === f.constructionSiteId);
      const siteName = site?.name || 'Dự án';

      if (usagePercent >= RULES.BUDGET_CRITICAL_PERCENT) {
        return {
          id: genId(),
          category: 'budget_overrun' as AlertCategory,
          severity: 'critical' as AlertSeverity,
          title: `🔴 ${siteName} — Vượt ngân sách!`,
          message: `Chi phí thực tế ${(totalActual / 1e6).toFixed(1)}M / Ngân sách ${(totalBudget / 1e6).toFixed(1)}M (${usagePercent.toFixed(0)}%). Cần xem xét ngay.`,
          entityId: f.id,
          entityType: 'project',
          navigateTo: `/projects/${f.constructionSiteId}`,
          createdAt: now(),
          actionLabel: 'Xem tài chính',
        };
      } else if (usagePercent >= RULES.BUDGET_WARNING_PERCENT) {
        return {
          id: genId(),
          category: 'budget_overrun' as AlertCategory,
          severity: 'warning' as AlertSeverity,
          title: `⚠️ ${siteName} — Ngân sách ${usagePercent.toFixed(0)}%`,
          message: `Chi phí đã sử dụng ${usagePercent.toFixed(0)}% ngân sách. Còn lại ${((totalBudget - totalActual) / 1e6).toFixed(1)}M.`,
          entityId: f.id,
          entityType: 'project',
          navigateTo: `/projects/${f.constructionSiteId}`,
          createdAt: now(),
        };
      }
      return null;
    })
    .filter(Boolean) as SmartAlert[];
}

/** Scan 4: Hợp đồng lao động sắp hết hạn */
function scanExpiringContracts(
  contracts: LaborContract[],
  employees: { id: string; name: string }[]
): SmartAlert[] {
  return contracts
    .filter(c => c.status === 'active' && c.endDate)
    .map(c => {
      const daysLeft = daysBetween(c.endDate!);
      if (daysLeft < 0 || daysLeft > RULES.CONTRACT_EXPIRY_DAYS) return null;

      const emp = employees.find(e => e.id === c.employeeId);
      const empName = emp?.name || c.employeeId;

      return {
        id: genId(),
        category: 'contract_expiring' as AlertCategory,
        severity: daysLeft <= RULES.CONTRACT_EXPIRY_CRITICAL ? 'critical' as AlertSeverity : 'warning' as AlertSeverity,
        title: daysLeft <= 0
          ? `🔴 HĐ ${c.contractNumber} — ĐÃ HẾT HẠN`
          : `⚠️ HĐ ${c.contractNumber} — Còn ${daysLeft} ngày`,
        message: `Hợp đồng ${c.contractNumber} của ${empName} sẽ hết hạn ${c.endDate}. Cần gia hạn hoặc thanh lý.`,
        entityId: c.id,
        entityType: 'contract',
        navigateTo: '/hrm/contracts',
        createdAt: now(),
        actionLabel: 'Gia hạn HĐ',
      };
    })
    .filter(Boolean) as SmartAlert[];
}

/** Scan 5: Thiết bị quá hạn bảo trì */
function scanAssetMaintenance(
  assets: Asset[],
  maintenances: AssetMaintenance[]
): SmartAlert[] {
  const alerts: SmartAlert[] = [];

  assets.forEach(asset => {
    if (asset.status === AssetStatus.DISPOSED) return;

    // Check warranty expiry
    if (asset.warrantyMonths && asset.warrantyMonths > 0) {
      const purchaseDate = new Date(asset.purchaseDate);
      const warrantyEnd = new Date(purchaseDate);
      warrantyEnd.setMonth(warrantyEnd.getMonth() + asset.warrantyMonths);
      const daysLeft = daysBetween(warrantyEnd.toISOString());

      if (daysLeft > 0 && daysLeft <= RULES.WARRANTY_EXPIRY_DAYS) {
        alerts.push({
          id: genId(),
          category: 'asset_warranty',
          severity: daysLeft <= 7 ? 'critical' : 'warning',
          title: `🛡️ ${asset.name} — Bảo hành còn ${daysLeft} ngày`,
          message: `Tài sản ${asset.code} sẽ hết bảo hành ngày ${warrantyEnd.toLocaleDateString('vi-VN')}. Nên kiểm tra trước khi hết hạn.`,
          entityId: asset.id,
          entityType: 'asset',
          navigateTo: `/assets/${asset.id}`,
          createdAt: now(),
        });
      }
    }

    // Check overdue maintenance
    const lastMaint = maintenances
      .filter(m => m.assetId === asset.id && m.status === 'completed')
      .sort((a, b) => new Date(b.endDate || b.startDate).getTime() - new Date(a.endDate || a.startDate).getTime())[0];

    const pendingMaint = maintenances.find(m => m.assetId === asset.id && m.status === 'planned');
    if (pendingMaint) {
      const daysUntil = daysBetween(pendingMaint.startDate);
      if (daysUntil < RULES.MAINTENANCE_OVERDUE_DAYS) {
        alerts.push({
          id: genId(),
          category: 'asset_maintenance',
          severity: 'warning',
          title: `🔧 ${asset.name} — Quá hạn bảo trì`,
          message: `Lịch bảo trì ${asset.code} đã quá hạn ${Math.abs(daysUntil)} ngày. Vui lòng thực hiện.`,
          entityId: asset.id,
          entityType: 'asset',
          navigateTo: `/assets/${asset.id}`,
          createdAt: now(),
          actionLabel: 'Ghi nhận bảo trì',
        });
      }
    }
  });

  return alerts;
}

/** Scan 6: Dự án sắp deadline */
function scanProjectDeadlines(
  finances: ProjectFinance[],
  sites: HrmConstructionSite[]
): SmartAlert[] {
  return finances
    .filter(f => (f.status === 'active') && f.estimatedEndDate)
    .map(f => {
      const daysLeft = daysBetween(f.estimatedEndDate!);
      if (daysLeft < 0 || daysLeft > RULES.PROJECT_DEADLINE_DAYS) return null;

      const site = sites.find(s => s.id === f.constructionSiteId);
      const progress = f.progressPercent || 0;

      return {
        id: genId(),
        category: 'project_deadline' as AlertCategory,
        severity: daysLeft <= 3 ? 'critical' as AlertSeverity : 'warning' as AlertSeverity,
        title: `📅 ${site?.name || 'Dự án'} — Còn ${daysLeft} ngày`,
        message: `Tiến độ ${progress}% — Deadline ${f.estimatedEndDate}. ${progress < 80 ? 'Cần đẩy nhanh tiến độ!' : 'Sắp hoàn thành.'}`,
        entityId: f.id,
        entityType: 'project',
        navigateTo: `/projects/${f.constructionSiteId}`,
        createdAt: now(),
      };
    })
    .filter(Boolean) as SmartAlert[];
}

// ═════════ Main Engine ═════════

export interface AlertEngineInput {
  items: InventoryItem[];
  requests: MaterialRequest[];
  projectFinances: ProjectFinance[];
  constructionSites: HrmConstructionSite[];
  laborContracts: LaborContract[];
  employees: { id: string; name: string }[];
  assets: Asset[];
  assetMaintenances: AssetMaintenance[];
}

export interface AlertEngineSummary {
  alerts: SmartAlert[];
  critical: number;
  warning: number;
  info: number;
  lastScanAt: string;
}

class AlertEngine {
  private cache: SmartAlert[] = [];
  private lastScan: string = '';
  private dismissedIds = new Set<string>();

  constructor() {
    // Load dismissed from localStorage
    try {
      const dismissed = JSON.parse(localStorage.getItem('vioo_dismissed_alerts') || '[]');
      dismissed.forEach((id: string) => this.dismissedIds.add(id));
    } catch {}
  }

  /** Run all alert scanners */
  scan(input: AlertEngineInput): AlertEngineSummary {
    const allAlerts: SmartAlert[] = [
      ...scanLowStock(input.items),
      ...scanOverdueRequests(input.requests),
      ...scanBudgetOverrun(input.projectFinances, input.constructionSites),
      ...scanExpiringContracts(input.laborContracts, input.employees),
      ...scanAssetMaintenance(input.assets, input.assetMaintenances),
      ...scanProjectDeadlines(input.projectFinances, input.constructionSites),
    ];

    // Deduplicate by entity (keep latest per entityId+category)
    const deduped = new Map<string, SmartAlert>();
    allAlerts.forEach(a => {
      const key = `${a.category}_${a.entityId}`;
      if (!this.dismissedIds.has(key)) {
        deduped.set(key, a);
      }
    });

    this.cache = Array.from(deduped.values())
      .sort((a, b) => {
        const sevOrder = { critical: 0, warning: 1, info: 2 };
        return sevOrder[a.severity] - sevOrder[b.severity];
      });
    this.lastScan = now();

    return {
      alerts: this.cache,
      critical: this.cache.filter(a => a.severity === 'critical').length,
      warning: this.cache.filter(a => a.severity === 'warning').length,
      info: this.cache.filter(a => a.severity === 'info').length,
      lastScanAt: this.lastScan,
    };
  }

  /** Get cached alerts */
  getAlerts(): SmartAlert[] {
    return this.cache;
  }

  /** Dismiss an alert */
  dismiss(alert: SmartAlert) {
    const key = `${alert.category}_${alert.entityId}`;
    this.dismissedIds.add(key);
    this.cache = this.cache.filter(a => `${a.category}_${a.entityId}` !== key);
    try {
      localStorage.setItem('vioo_dismissed_alerts', JSON.stringify(Array.from(this.dismissedIds)));
    } catch {}
  }

  /** Reset dismissed alerts */
  resetDismissed() {
    this.dismissedIds.clear();
    localStorage.removeItem('vioo_dismissed_alerts');
  }

  /** Get count by severity */
  getCounts() {
    return {
      critical: this.cache.filter(a => a.severity === 'critical').length,
      warning: this.cache.filter(a => a.severity === 'warning').length,
      info: this.cache.filter(a => a.severity === 'info').length,
      total: this.cache.length,
    };
  }
}

// Singleton
export const alertEngine = new AlertEngine();

// ═════════ Category Labels & Icons ═════════

export const ALERT_CATEGORY_INFO: Record<AlertCategory, { label: string; icon: string; color: string }> = {
  low_stock:         { label: 'Tồn kho thấp',       icon: '📦', color: 'orange' },
  request_overdue:   { label: 'Phiếu quá hạn',      icon: '⏰', color: 'red' },
  budget_overrun:    { label: 'Vượt ngân sách',      icon: '💰', color: 'red' },
  contract_expiring: { label: 'HĐ sắp hết hạn',     icon: '📋', color: 'amber' },
  asset_maintenance: { label: 'Bảo trì quá hạn',    icon: '🔧', color: 'blue' },
  asset_warranty:    { label: 'Bảo hành sắp hết',    icon: '🛡️', color: 'purple' },
  project_deadline:  { label: 'Deadline dự án',      icon: '📅', color: 'indigo' },
  waste_threshold:   { label: 'Hao hụt vượt ngưỡng', icon: '⚠️', color: 'orange' },
};

export const SEVERITY_INFO: Record<AlertSeverity, { label: string; color: string; bgClass: string }> = {
  critical: { label: 'Nghiêm trọng', color: 'red',   bgClass: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
  warning:  { label: 'Cảnh báo',     color: 'amber', bgClass: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' },
  info:     { label: 'Thông tin',     color: 'blue',  bgClass: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
};
