import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { ContractItem, ContractItemType, ContractVariation } from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { variationService } from '../../lib/variationService';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface Props {
  contractId: string;
  contractType: ContractItemType;
}

const fmt = (n: number) => n.toLocaleString('vi-VN') + ' đ';
const shortMoney = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  return fmt(n);
};
const num = (value: unknown) => Number(value || 0);

const groupKey = (item?: Pick<ContractItem, 'code' | 'name'>) => {
  if (!item) return 'Khác';
  const first = (item.code || '').split(/[.-]/)[0];
  return first ? `${first}. ${item.name}` : item.name || 'Khác';
};

const ContractBoqVersionHistory: React.FC<Props> = ({ contractId, contractType }) => {
  const toast = useToast();
  const [boq, setBoq] = useState<ContractItem[]>([]);
  const [versions, setVersions] = useState<ContractVariation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, variationData] = await Promise.all([
        contractItemService.listByContract(contractId, contractType),
        variationService.listByContract(contractId, contractType),
      ]);
      setBoq(items);
      setVersions(variationData.filter(item => item.status === 'approved').sort((a, b) =>
        num(a.versionNumber) - num(b.versionNumber) || (a.createdAt || '').localeCompare(b.createdAt || '')
      ));
    } catch (error) {
      logApiError('boqVersionHistory.load', error);
      toast.error('Không thể tải lịch sử BOQ', getApiErrorMessage(error, 'Không thể tải lịch sử version BOQ.'));
    } finally {
      setLoading(false);
    }
  }, [contractId, contractType, toast]);

  useEffect(() => { load(); }, [load]);

  const originalValue = useMemo(() => boq.reduce((sum, item) => sum + num(item.totalPrice), 0), [boq]);
  const maxDelta = useMemo(() => Math.max(1, ...versions.map(v => Math.abs(num(v.totalAmountDelta)))), [versions]);

  const affectedRows = useMemo(() => {
    const map = new Map<string, { code: string; name: string; base: number; deltas: Record<string, number> }>();
    for (const item of boq) {
      map.set(item.id, { code: item.code, name: item.name, base: num(item.totalPrice), deltas: {} });
    }
    for (const version of versions) {
      for (const line of version.items) {
        const id = line.contractItemId || `${version.id}-${line.code}`;
        const current = map.get(id) || { code: line.code, name: line.name, base: 0, deltas: {} };
        current.deltas[version.id] = (current.deltas[version.id] || 0) + num(line.amountDelta);
        map.set(id, current);
      }
    }
    return Array.from(map.values()).filter(row => Object.values(row.deltas).some(value => value !== 0));
  }, [boq, versions]);

  const lanes = useMemo(() => {
    const itemById = new Map(boq.map(item => [item.id, item]));
    const map = new Map<string, Record<string, number>>();
    for (const version of versions) {
      for (const line of version.items) {
        const key = groupKey(itemById.get(line.contractItemId || ''));
        const lane = map.get(key) || {};
        lane[version.id] = (lane[version.id] || 0) + num(line.amountDelta);
        map.set(key, lane);
      }
    }
    return Array.from(map.entries()).map(([name, values]) => ({ name, values }));
  }, [boq, versions]);

  if (loading) {
    return <div className="p-6 text-center text-sm text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Đang tải lịch sử BOQ...</div>;
  }

  return (
    <div className="space-y-4 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
            <GitCompareArrows size={13} className="text-indigo-500" /> Waterfall giá trị HĐ
          </h4>
          <span className="text-[10px] text-slate-400 font-bold">V0: {fmt(originalValue)}</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <div className="w-20 font-black text-slate-500">V0</div>
            <div className="flex-1 h-7 bg-slate-100 rounded-lg overflow-hidden">
              <div className="h-full bg-slate-400 rounded-lg" style={{ width: '100%' }} />
            </div>
            <div className="w-28 text-right font-black">{shortMoney(originalValue)}</div>
          </div>
          {versions.map(version => {
            const delta = num(version.totalAmountDelta);
            const pct = Math.max(8, Math.min(100, Math.abs(delta) / maxDelta * 100));
            return (
              <div key={version.id} className="flex items-center gap-3 text-xs">
                <div className="w-20 font-black text-slate-500">V{version.versionNumber || '?'}</div>
                <div className="flex-1 h-7 bg-slate-100 rounded-lg overflow-hidden">
                  <div className={`h-full rounded-lg ${delta >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className={`w-28 text-right font-black ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta >= 0 ? '+' : ''}{shortMoney(delta)}
                </div>
              </div>
            );
          })}
          {versions.length === 0 && <div className="py-6 text-center text-xs font-bold text-slate-400">Chưa có version điều chỉnh đã duyệt</div>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100">
          <h4 className="text-xs font-black text-slate-700">Bảng so sánh BOQ theo version</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-slate-50 text-slate-400 uppercase">
                <th className="p-2 text-left">Hạng mục</th>
                <th className="p-2 text-right">BOQ gốc</th>
                {versions.map(version => <th key={version.id} className="p-2 text-right">V{version.versionNumber || '?'}</th>)}
                <th className="p-2 text-right">Tổng thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {affectedRows.map(row => {
                const totalDelta = Object.values(row.deltas).reduce((sum, value) => sum + value, 0);
                return (
                  <tr key={`${row.code}-${row.name}`} className="border-t border-slate-50">
                    <td className="p-2 font-bold text-slate-700">{row.code} - {row.name}</td>
                    <td className="p-2 text-right text-slate-500">{shortMoney(row.base)}</td>
                    {versions.map(version => {
                      const delta = row.deltas[version.id] || 0;
                      return <td key={version.id} className={`p-2 text-right font-bold ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-slate-300'}`}>{delta ? shortMoney(delta) : '-'}</td>;
                    })}
                    <td className={`p-2 text-right font-black ${totalDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{shortMoney(totalDelta)}</td>
                  </tr>
                );
              })}
              {affectedRows.length === 0 && <tr><td colSpan={versions.length + 3} className="p-6 text-center text-xs font-bold text-slate-400">Chưa có hạng mục thay đổi</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center gap-1.5">
          <TrendingUp size={13} className="text-emerald-500" />
          <h4 className="text-xs font-black text-slate-700">Đường găng chi phí theo nhóm BOQ</h4>
        </div>
        <div className="p-3 space-y-2">
          {lanes.map(lane => (
            <div key={lane.name} className="grid grid-cols-12 gap-2 items-center text-[10px]">
              <div className="col-span-3 font-bold text-slate-600 truncate">{lane.name}</div>
              <div className="col-span-9 flex gap-1">
                {versions.map(version => {
                  const delta = lane.values[version.id] || 0;
                  return (
                    <div key={version.id} title={`V${version.versionNumber}: ${fmt(delta)}`} className={`h-7 min-w-16 rounded-lg border flex items-center justify-center px-2 font-black ${delta > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : delta < 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
                      {delta > 0 ? <TrendingUp size={10} className="mr-1" /> : delta < 0 ? <TrendingDown size={10} className="mr-1" /> : null}
                      V{version.versionNumber || '?'}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {lanes.length === 0 && <div className="py-6 text-center text-xs font-bold text-slate-400">Chưa có lane chi phí</div>}
        </div>
      </div>
    </div>
  );
};

export default ContractBoqVersionHistory;
