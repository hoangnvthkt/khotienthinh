import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Package,
  RefreshCcw,
  Save,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import {
  InventoryItem,
  MaterialBudgetItem,
  MaterialDemandDistributionMethod,
  MaterialForecastRow,
  MaterialForecastWindow,
  MaterialPlanningDraftPo,
  MaterialPlanningRule,
  PlanningCurveTemplate,
  ProjectTask,
  ProjectWorkBoqItem,
  PurchaseOrder,
  Transaction,
} from '../../types';
import {
  materialPlanningRuleService,
  MATERIAL_FORECAST_WINDOWS,
  projectMaterialPlanningService,
} from '../../lib/projectMaterialPlanningService';
import { useToast } from '../../context/ToastContext';

interface MaterialPlanningPanelProps {
  projectId?: string | null;
  constructionSiteId?: string | null;
  scopeKey: string;
  siteWarehouseId?: string;
  canManage: boolean;
  userId?: string | null;
  tasks: ProjectTask[];
  workBoqItems: ProjectWorkBoqItem[];
  materialBudgetItems: MaterialBudgetItem[];
  inventoryItems: InventoryItem[];
  purchaseOrders: PurchaseOrder[];
  transactions: Transaction[];
  rules: MaterialPlanningRule[];
  curveTemplates: PlanningCurveTemplate[];
  loading?: boolean;
  onRefresh?: () => void;
  onRuleSaved: (rule: MaterialPlanningRule) => void;
  onCreateDraftPo: (draft: MaterialPlanningDraftPo) => void;
}

const fmtQty = (value: number) =>
  (Number(value) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const fmtMoney = (value: number) => {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(0)} tr`;
  return n.toLocaleString('vi-VN');
};

const windowLabel = (window: MaterialForecastWindow) =>
  MATERIAL_FORECAST_WINDOWS.find(item => item.key === window)?.label || window;

const distributionLabel: Record<MaterialDemandDistributionMethod, string> = {
  pre_start: 'Trước khi thi công',
  linear: 'Rải đều theo ngày',
  custom_curve: 'Theo curve',
};

const priceSourceLabel: Record<MaterialForecastRow['planningUnitPriceSource'], string> = {
  latest_confirmed_po: 'Giá PO mới nhất',
  latest_received: 'Giá nhập mới nhất',
  material_master: 'Giá danh mục',
  fallback: 'Chưa có giá',
};

const ruleSourceLabel: Record<MaterialForecastRow['ruleSource'], string> = {
  item: 'Theo vật tư',
  category: 'Theo nhóm',
  default: 'Mặc định',
};

const findRuleForRow = (row: MaterialForecastRow, rules: MaterialPlanningRule[]) => {
  if (row.inventoryItemId) {
    return rules.find(rule => rule.inventoryItemId === row.inventoryItemId);
  }
  const category = row.category.trim().toLowerCase();
  return rules.find(rule => !rule.inventoryItemId && String(rule.category || '').trim().toLowerCase() === category);
};

const pickShortageWindow = (row: MaterialForecastRow): MaterialForecastWindow =>
  row.shortageQty['7d'] > 0 ? '7d' : row.shortageQty['30d'] > 0 ? '30d' : '90d';

const getCurveTotal = (curve?: PlanningCurveTemplate) =>
  (curve?.points || []).reduce((sum, point) => sum + Number(point.percentage || 0), 0);

const MaterialPlanningPanel: React.FC<MaterialPlanningPanelProps> = ({
  projectId,
  constructionSiteId,
  scopeKey,
  siteWarehouseId,
  canManage,
  userId,
  tasks,
  workBoqItems,
  materialBudgetItems,
  inventoryItems,
  purchaseOrders,
  transactions,
  rules,
  curveTemplates,
  loading = false,
  onRefresh,
  onRuleSaved,
  onCreateDraftPo,
}) => {
  const toast = useToast();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [savingRuleKey, setSavingRuleKey] = useState<string | null>(null);
  const [creatingPoKey, setCreatingPoKey] = useState<string | null>(null);

  const forecast = useMemo(
    () => projectMaterialPlanningService.buildForecast({
      projectId,
      constructionSiteId,
      siteWarehouseId,
      tasks,
      workBoqItems,
      materialBudgetItems,
      inventoryItems,
      purchaseOrders,
      transactions,
      rules,
      curveTemplates,
    }),
    [constructionSiteId, curveTemplates, inventoryItems, materialBudgetItems, projectId, purchaseOrders, rules, siteWarehouseId, tasks, transactions, workBoqItems],
  );

  const topShortageRows = useMemo(
    () => forecast.rows
      .filter(row => row.shortageValue30d > 0)
      .sort((a, b) => b.shortageValue30d - a.shortageValue30d)
      .slice(0, 10),
    [forecast.rows],
  );
  const demandRowCount30d = useMemo(
    () => forecast.rows.filter(row => row.forecastQty30d > 0).length,
    [forecast.rows],
  );

  const toggleRow = (rowKey: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const saveRule = async (
    row: MaterialForecastRow,
    patch: Partial<Pick<MaterialPlanningRule, 'leadTimeDays' | 'distributionMethod' | 'curveTemplateId'>>,
  ) => {
    if (!scopeKey) {
      toast.warning('Thiếu phạm vi dự án', 'Chưa xác định được scope để lưu rule kế hoạch vật tư.');
      return;
    }
    if (!canManage) {
      toast.warning('Không có quyền chỉnh sửa', 'Bạn cần quyền quản trị tab Vật tư để cập nhật kế hoạch.');
      return;
    }

    const existing = findRuleForRow(row, rules);
    const leadTimeDays = Math.max(0, Math.min(365, Math.round(Number(patch.leadTimeDays ?? row.leadTimeDays) || 0)));
    const distributionMethod = patch.distributionMethod || row.distributionMethod;
    const curveTemplateId = patch.curveTemplateId !== undefined ? patch.curveTemplateId : row.curveTemplateId || null;
    const rule: MaterialPlanningRule = {
      ...existing,
      scopeKey,
      projectId: projectId || null,
      constructionSiteId: constructionSiteId || null,
      inventoryItemId: row.inventoryItemId || null,
      category: row.inventoryItemId ? null : row.category,
      leadTimeDays,
      distributionMethod,
      curveTemplateId: distributionMethod === 'custom_curve' ? curveTemplateId || null : null,
      createdBy: existing?.createdBy || userId || null,
      updatedBy: userId || null,
    };

    setSavingRuleKey(row.key);
    try {
      const saved = await materialPlanningRuleService.upsertRule(rule);
      onRuleSaved(saved);
      const curve = curveTemplateId ? curveTemplates.find(item => item.id === curveTemplateId) : undefined;
      toast.success('Đã lưu rule kế hoạch', `${row.itemName}: ${leadTimeDays} ngày, ${distributionLabel[distributionMethod]}${curve ? ` - ${curve.name}` : ''}.`);
    } catch (error: any) {
      console.error('Failed to save material planning rule', error);
      toast.error('Không lưu được rule kế hoạch', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingRuleKey(null);
    }
  };

  const createPoFromRow = async (row: MaterialForecastRow) => {
    if (!canManage) {
      toast.warning('Không có quyền tạo PO', 'Bạn cần quyền quản trị tab Vật tư để tạo PO từ thiếu hụt.');
      return;
    }
    const window = pickShortageWindow(row);
    setCreatingPoKey(row.key);
    try {
      const draft = projectMaterialPlanningService.createDraftPoFromShortage({
        row,
        window,
        siteWarehouseId,
        inventoryItems,
      });
      onCreateDraftPo(draft);
      toast.success('Đã tạo PO nháp từ kế hoạch', `${row.itemName}: thiếu ${fmtQty(row.shortageQty[window])} ${row.unit} trong ${windowLabel(window)}.`);
    } catch (error: any) {
      toast.warning('Chưa thể tạo PO', error?.message || 'Vui lòng kiểm tra mã vật tư và kho công trường.');
    } finally {
      setCreatingPoKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{
        __html: `
        /* Spacing and layout for Material Planning tables */
        .planning-table th {
          padding: 12px 16px !important;
          font-weight: 950 !important;
          font-size: 10px !important;
          white-space: nowrap !important;
        }
        .planning-table td {
          padding: 12px 16px !important;
          vertical-align: middle !important;
          white-space: nowrap !important;
        }
        .planning-table td.wrap-cell {
          white-space: normal !important;
          min-width: 260px !important;
        }
        .planning-table tbody tr {
          transition: background-color 0.15s ease-in-out;
        }
        .planning-table tbody tr:hover {
          background-color: rgba(99, 102, 241, 0.05) !important;
        }
        .dark .planning-table tbody tr:hover {
          background-color: rgba(99, 102, 241, 0.1) !important;
        }
      `}} />
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
              <TrendingUp size={16} className="text-emerald-500" /> Kế hoạch vật tư theo tiến độ
            </h3>
            <p className="mt-1 text-[10px] font-bold text-slate-400">
              Dự báo nhu cầu còn lại từ BOQ triển khai, tiến độ WBS, tồn kho công trường và PO đang về.
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
        </div>

        {!siteWarehouseId && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
            Chưa xác định kho công trường. Forecast vẫn tính nhu cầu, nhưng thiếu hụt sẽ chưa trừ tồn kho tại công trường.
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-[9px] font-black uppercase text-slate-400">Nhu cầu VT 30 ngày</div>
            <div className="mt-1 text-lg font-black text-slate-800">{demandRowCount30d} vật tư</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-[9px] font-black uppercase text-slate-400">GT mua 30 ngày</div>
            <div className="mt-1 text-lg font-black text-slate-800">{fmtMoney(forecast.summary.demandValue['30d'])}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-[9px] font-black uppercase text-slate-400">GT mua 90 ngày</div>
            <div className="mt-1 text-lg font-black text-slate-800">{fmtMoney(forecast.summary.demandValue['90d'])}</div>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <div className="text-[9px] font-black uppercase text-red-400">GT thiếu hụt</div>
            <div className="mt-1 text-lg font-black text-red-600">{fmtMoney(forecast.summary.shortageValue['30d'])}</div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <div className="text-[9px] font-black uppercase text-amber-500">Dòng thiếu 7 ngày</div>
            <div className="mt-1 text-lg font-black text-amber-700">{forecast.summary.criticalShortageCount}</div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="text-[9px] font-black uppercase text-blue-500">Chưa link mã kho</div>
            <div className="mt-1 text-lg font-black text-blue-700">{forecast.summary.missingInventoryCount}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {forecast.summary.etaMissingPoCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">
              <AlertTriangle size={11} /> {forecast.summary.etaMissingPoCount} vật tư có PO thiếu ETA
            </span>
          )}
          {forecast.summary.invalidTaskCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">
              <Clock size={11} /> {forecast.summary.invalidTaskCount} dòng thiếu ngày tiến độ
            </span>
          )}
          {forecast.summary.shortageRowCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black text-red-600">
              <Package size={11} /> {forecast.summary.shortageRowCount} vật tư thiếu trong 30 ngày
            </span>
          )}
        </div>
      </div>

      {topShortageRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-red-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
          <div className="border-b border-red-100 bg-red-50/70 px-5 py-3">
            <h4 className="text-xs font-black uppercase tracking-wide text-red-700">Top 10 vật tư thiếu hụt giá trị lớn nhất trong 30 ngày</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs planning-table">
              <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-700/50 dark:border-slate-600/50 text-[10px] font-black uppercase text-indigo-950 dark:text-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left">Vật tư</th>
                  <th className="px-4 py-2 text-right">Nhu cầu 30d</th>
                  <th className="px-4 py-2 text-right">GT nhu cầu</th>
                  <th className="px-4 py-2 text-right">Thiếu 30d</th>
                  <th className="px-4 py-2 text-right">GT thiếu</th>
                  <th className="px-4 py-2 text-right">Giá kế hoạch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
                {topShortageRows.map(row => (
                  <tr key={`top-${row.key}`} className="hover:bg-red-50/40">
                    <td className="wrap-cell font-black text-slate-800 dark:text-slate-100">
                      <div>{row.itemName}</div>
                      <div className="font-mono text-[10px] font-bold text-slate-400">{row.sku || '-'}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-700 dark:text-slate-300">{fmtQty(row.forecastQty30d)} {row.unit}</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-700 dark:text-slate-300">{fmtMoney(row.forecastValue30d)}</td>
                    <td className="px-4 py-2 text-right font-black text-red-600 dark:text-red-400">{fmtQty(row.shortageQty30d)} {row.unit}</td>
                    <td className="px-4 py-2 text-right font-black text-red-600 dark:text-red-400">{fmtMoney(row.shortageValue30d)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="font-bold text-slate-700 dark:text-slate-300">{fmtMoney(row.planningUnitPrice)}</div>
                      <div className="text-[9px] font-black uppercase text-slate-400">{priceSourceLabel[row.planningUnitPriceSource]}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1780px] text-xs planning-table">
            <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-700/50 dark:border-slate-600/50 text-[10px] font-black uppercase tracking-wide text-indigo-950 dark:text-slate-200">
              <tr>
                <th className="px-3 py-3 text-left">Vật tư</th>
                <th className="px-3 py-3 text-left">Nhóm</th>
                <th className="px-3 py-3 text-center">Lead time</th>
                <th className="px-3 py-3 text-center">Phân bổ</th>
                <th className="px-3 py-3 text-center">Curve</th>
                <th className="px-3 py-3 text-right">Nhu cầu 7 ngày tới</th>
                <th className="px-3 py-3 text-right">Nhu cầu 30 ngày tới</th>
                <th className="px-3 py-3 text-right">GT nhu cầu 30 ngày tới</th>
                <th className="px-3 py-3 text-right">Nhu cầu 90 ngày tới</th>
                <th className="px-3 py-3 text-right">Tồn CT</th>
                <th className="px-3 py-3 text-right">PO về 30 ngày tới</th>
                <th className="px-3 py-3 text-right">Thiếu 30 ngày tới</th>
                <th className="px-3 py-3 text-right">GT thiếu</th>
                <th className="px-3 py-3 text-right">Giá kế hoạch</th>
                <th className="px-3 py-3 text-left">Cảnh báo</th>
                <th className="px-3 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/40">
              {forecast.rows.map(row => {
                const expanded = expandedRows.has(row.key);
                const shortage = row.shortageQty['30d'] > 0;
                const canCreatePo = canManage && shortage && !!row.inventoryItemId && !!siteWarehouseId;
                return (
                  <React.Fragment key={row.key}>
                    <tr className={`${row.shortageQty['7d'] > 0 ? 'bg-red-50/40 dark:bg-red-950/20' : shortage ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''} hover:bg-slate-50/80 dark:hover:bg-slate-700/30`}>
                      <td className="wrap-cell text-slate-800 dark:text-slate-100">
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => toggleRow(row.key)}
                            className="mt-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <div>
                            <div className="font-black text-slate-800 dark:text-slate-100">{row.itemName}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                              <span className="font-mono">{row.sku || 'Chưa có SKU'}</span>
                              <span>{row.unit}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="font-bold text-slate-600 dark:text-slate-300">
                        <div>{row.category}</div>
                        <div className="mt-0.5 text-[9px] font-black uppercase text-slate-400">{ruleSourceLabel[row.ruleSource]}</div>
                      </td>
                      <td className="text-center">
                        <input
                          type="number"
                          min={0}
                          max={365}
                          disabled={!canManage || savingRuleKey === row.key}
                          defaultValue={row.leadTimeDays}
                          onBlur={event => {
                            const next = Number(event.currentTarget.value || 0);
                            if (next !== row.leadTimeDays) void saveRule(row, { leadTimeDays: next });
                          }}
                          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </td>
                      <td className="text-center">
                        <select
                          value={row.distributionMethod}
                          disabled={!canManage || savingRuleKey === row.key}
                          onChange={event => {
                            const distributionMethod = event.target.value as MaterialDemandDistributionMethod;
                            void saveRule(row, {
                              distributionMethod,
                              curveTemplateId: distributionMethod === 'custom_curve'
                                ? row.curveTemplateId || curveTemplates[0]?.id || null
                                : null,
                            });
                          }}
                          className="w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <option value="pre_start">Trước khi thi công</option>
                          <option value="linear">Rải đều theo ngày</option>
                          <option value="custom_curve">Theo curve</option>
                        </select>
                      </td>
                      <td className="text-center">
                        {row.distributionMethod === 'custom_curve' ? (
                          <div className="space-y-1">
                            <select
                              value={row.curveTemplateId || ''}
                              disabled={!canManage || savingRuleKey === row.key || curveTemplates.length === 0}
                              onChange={event => void saveRule(row, { distributionMethod: 'custom_curve', curveTemplateId: event.target.value || null })}
                              className="w-40 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                            >
                              <option value="">Chọn curve</option>
                              {curveTemplates.map(curve => (
                                <option key={curve.id} value={curve.id}>{curve.name}</option>
                              ))}
                            </select>
                            {(() => {
                              const curve = curveTemplates.find(item => item.id === row.curveTemplateId);
                              return curve ? (
                                <div className="mx-auto flex h-5 w-40 overflow-hidden rounded bg-slate-100 dark:bg-slate-700" title={`Tổng ${getCurveTotal(curve).toFixed(0)}%`}>
                                  {curve.points.map(point => (
                                    <div
                                      key={`${curve.id}-${point.sequence}`}
                                      className="bg-emerald-500"
                                      style={{ width: `${Math.max(2, Number(point.percentage || 0))}%`, opacity: 0.45 + Math.min(0.45, Number(point.percentage || 0) / 100) }}
                                    />
                                  ))}
                                </div>
                              ) : <div className="text-[9px] font-bold text-amber-600 dark:text-amber-400">Chưa chọn curve</div>;
                            })()}
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td className="text-right font-bold text-slate-700 dark:text-slate-300">{fmtQty(row.forecastQty7d)}</td>
                      <td className="text-right font-bold text-slate-700 dark:text-slate-300">{fmtQty(row.forecastQty30d)}</td>
                      <td className="text-right font-bold text-slate-700 dark:text-slate-300">{fmtMoney(row.forecastValue30d)}</td>
                      <td className="text-right font-bold text-slate-700 dark:text-slate-300">{fmtQty(row.forecastQty90d)}</td>
                      <td className="text-right font-bold text-emerald-700 dark:text-emerald-400">{fmtQty(row.siteAvailableQty)}</td>
                      <td className="text-right font-bold text-blue-700 dark:text-blue-400">{fmtQty(row.incomingQty['30d'])}</td>
                      <td className={`text-right font-black ${shortage ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {fmtQty(row.shortageQty['30d'])}
                      </td>
                      <td className={`text-right font-black ${shortage ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        {fmtMoney(row.shortageValue['30d'])}
                      </td>
                      <td className="text-right">
                        <div className="font-bold text-slate-700 dark:text-slate-300">{fmtMoney(row.planningUnitPrice)}</div>
                        <div className="text-[9px] font-black uppercase text-slate-400">{priceSourceLabel[row.planningUnitPriceSource]}</div>
                      </td>
                      <td className="">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {row.warnings.slice(0, 3).map(warning => (
                            <span key={warning} className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[9px] font-black text-amber-700 dark:text-amber-300">
                              {warning}
                            </span>
                          ))}
                          {row.warnings.length === 0 && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-450">OK</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => void createPoFromRow(row)}
                          disabled={!canCreatePo || creatingPoKey === row.key}
                          title={!row.inventoryItemId ? 'Cần liên kết mã kho trước khi tạo PO' : undefined}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[10px] font-black text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {creatingPoKey === row.key ? <Save size={11} className="animate-pulse" /> : <ShoppingCart size={11} />}
                          Tạo PO
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                        <td colSpan={16} className="px-10 py-3">
                          <div className="overflow-hidden rounded-xl border border-slate-100 bg-white dark:bg-slate-900 dark:border-slate-800">
                            <table className="w-full text-[11px] planning-table">
                              <thead className="bg-indigo-50/80 border-b border-indigo-100/80 dark:bg-slate-700/50 dark:border-slate-600/50 text-[10px] font-black uppercase text-indigo-950 dark:text-slate-200">
                                <tr>
                                  <th className="px-3 py-2 text-left">WBS / đầu mục</th>
                                  <th className="px-3 py-2 text-center">Ngày thi công</th>
                                  <th className="px-3 py-2 text-center">Ngày cần</th>
                                  <th className="px-3 py-2 text-right">Còn cần</th>
                                  <th className="px-3 py-2 text-right">7d</th>
                                  <th className="px-3 py-2 text-right">30d</th>
                                  <th className="px-3 py-2 text-right">90d</th>
                                  <th className="px-3 py-2 text-left">Ghi chú</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/40">
                                {row.details.map(detail => (
                                  <tr key={detail.id}>
                                    <td className="wrap-cell text-slate-750 dark:text-slate-250">
                                      <div className="font-bold text-slate-700 dark:text-slate-300">{detail.taskName}</div>
                                      <div className="font-mono text-[9px] font-bold text-indigo-500 dark:text-indigo-400">{detail.wbsCode || '-'}</div>
                                    </td>
                                    <td className="text-center text-slate-500 dark:text-slate-400">
                                      {detail.startDate?.slice(0, 10) || '-'} - {detail.endDate?.slice(0, 10) || '-'}
                                    </td>
                                    <td className="text-center font-bold text-slate-700 dark:text-slate-300">{detail.needDate || '-'}</td>
                                    <td className="text-right font-bold text-slate-700 dark:text-slate-300">{fmtQty(detail.remainingDemandQty)}</td>
                                    <td className="text-right text-slate-600 dark:text-slate-450">{fmtQty(detail.demandQty['7d'])}</td>
                                    <td className="text-right text-slate-600 dark:text-slate-450">{fmtQty(detail.demandQty['30d'])}</td>
                                    <td className="text-right text-slate-600 dark:text-slate-450">{fmtQty(detail.demandQty['90d'])}</td>
                                    <td className="wrap-cell text-slate-500 dark:text-slate-450">
                                      {detail.warnings.length > 0 ? detail.warnings.join(', ') : distributionLabel[detail.distributionMethod]}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {forecast.rows.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-6 py-12 text-center">
                    <Package size={32} className="mx-auto mb-2 text-slate-200" />
                    <div className="text-sm font-black text-slate-400">Chưa có dữ liệu để lập kế hoạch vật tư</div>
                    <div className="mt-1 text-[10px] font-bold text-slate-300">Cần BOQ triển khai có vật tư và đầu mục đã liên kết tiến độ.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MaterialPlanningPanel;
