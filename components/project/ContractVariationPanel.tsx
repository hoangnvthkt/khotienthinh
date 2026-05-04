import React, { useCallback, useEffect, useState } from 'react';
import { Check, FilePlus2, Plus, Send, X } from 'lucide-react';
import { ContractItem, ContractItemType, ContractVariation } from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { variationService } from '../../lib/variationService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN') + ' đ';

const STATUS_PERMISSION: Record<string, ProjectPermissionCode> = {
  submitted: 'submit',
  approved: 'approve',
  rejected: 'approve',
};

const ContractVariationPanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId }) => {
  const toast = useToast();
  const { user } = useApp();
  const [items, setItems] = useState<ContractVariation[]>([]);
  const [boq, setBoq] = useState<ContractItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [contractItemId, setContractItemId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('m2');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const load = useCallback(async () => {
    const [vars, boqItems] = await Promise.all([
      variationService.listByContract(contractId, contractType),
      contractItemService.listByContract(contractId, contractType),
    ]);
    setItems(vars);
    setBoq(boqItems);
  }, [contractId, contractType]);

  useEffect(() => { load().catch(console.error); }, [load]);

  const reset = () => {
    setShowForm(false);
    setTitle('');
    setReason('');
    setContractItemId('');
    setCode('');
    setName('');
    setUnit('m2');
    setQuantityDelta('');
    setUnitPrice('');
  };

  const handleCreate = async () => {
    const selected = boq.find(i => i.id === contractItemId);
    const qty = Number(quantityDelta) || 0;
    const price = Number(unitPrice || selected?.unitPrice || 0);
    if (!title || !qty || !price || (!selected && (!code || !name))) return;

    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code: 'edit',
        actionLabel: 'tạo phát sinh hợp đồng',
      });
      await variationService.create({
        contractId,
        contractType,
        constructionSiteId,
        code: `PS-${Date.now().toString().slice(-5)}`,
        title,
        reason,
        items: [{
          contractItemId: selected?.id,
          code: selected?.code || code,
          name: selected?.name || name,
          unit: selected?.unit || unit,
          quantityDelta: qty,
          unitPrice: price,
          amountDelta: qty * price,
        }],
      });
      reset();
      await load();
      toast.success('Đã tạo phát sinh hợp đồng');
    } catch (e: any) {
      toast.error('Lỗi tạo phát sinh', e?.message);
    }
  };

  const setStatus = async (item: ContractVariation, status: 'submitted' | 'approved' | 'rejected') => {
    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code: STATUS_PERMISSION[status],
        actionLabel: status === 'submitted' ? 'gửi duyệt phát sinh' : 'duyệt hoặc từ chối phát sinh',
      });
      await variationService.setStatus(item.id, status, user?.id, undefined, user, projectId);
      await load();
      toast.success(status === 'approved' ? 'Đã duyệt phát sinh' : status === 'submitted' ? 'Đã gửi duyệt' : 'Đã từ chối');
    } catch (e: any) {
      toast.error('Lỗi cập nhật phát sinh', e?.message);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5"><FilePlus2 size={13} className="text-violet-500" /> Phát sinh hợp đồng</h4>
          <button onClick={() => setShowForm(!showForm)} className="text-[10px] font-bold text-violet-600 flex items-center gap-1"><Plus size={10} /> Thêm</button>
        </div>
        {showForm && (
          <div className="p-3 bg-violet-50/50 border-b border-violet-100 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Tiêu đề phát sinh" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Lý do" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
            </div>
            <select value={contractItemId} onChange={e => {
              const selected = boq.find(i => i.id === e.target.value);
              setContractItemId(e.target.value);
              if (selected) {
                setCode(selected.code); setName(selected.name); setUnit(selected.unit); setUnitPrice(String(selected.unitPrice || 0));
              }
            }} className="w-full px-2 py-1.5 rounded-lg border border-violet-200 text-xs bg-white">
              <option value="">Hạng mục mới hoặc chọn BOQ hiện có...</option>
              {boq.map(item => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
            </select>
            <div className="grid grid-cols-5 gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="Mã" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên hạng mục" className="col-span-2 px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ĐVT" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input type="number" value={quantityDelta} onChange={e => setQuantityDelta(e.target.value)} placeholder="+/- KL" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="Đơn giá" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <div className="flex gap-1">
                <button onClick={handleCreate} className="flex-1 px-2 py-1.5 rounded-lg bg-violet-500 text-white text-[10px] font-bold">Lưu</button>
                <button onClick={reset} className="px-2 py-1.5 rounded-lg text-slate-500 hover:bg-white"><X size={12} /></button>
              </div>
            </div>
          </div>
        )}
        <div className="divide-y divide-slate-50">
          {items.map(item => (
            <div key={item.id} className="px-3 py-2 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-700">{item.code} - {item.title}</div>
                <div className="text-[10px] text-slate-400">{item.reason || 'Không có lý do'} • {item.items.length} dòng</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${item.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : item.status === 'submitted' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  {item.status}
                </span>
                <span className="font-black text-violet-600">{fmt(item.totalAmountDelta)}</span>
                {item.status === 'draft' && <button onClick={() => setStatus(item, 'submitted')} className="text-amber-500"><Send size={13} /></button>}
                {item.status === 'submitted' && <button onClick={() => setStatus(item, 'approved')} className="text-emerald-500"><Check size={13} /></button>}
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Chưa có phát sinh</div>}
        </div>
      </div>
    </div>
  );
};

export default ContractVariationPanel;
