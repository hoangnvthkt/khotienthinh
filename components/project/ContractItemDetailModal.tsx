import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { ContractItem, ContractItemResource, ContractItemResourceType, ContractItemType } from '../../types';
import { contractItemResourceService, contractItemService } from '../../lib/contractItemService';
import { useToast } from '../../context/ToastContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';

type ResourceDraft = Omit<ContractItemResource, 'id' | 'contractItemId' | 'createdAt'>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
  parentOptions: ContractItem[];
  item?: ContractItem | null;
}

const emptyResource = (resourceType: ContractItemResourceType): ResourceDraft => ({
  resourceType,
  code: '',
  name: '',
  unit: '',
  norm: 1,
  coefficient: 1,
  quantity: 1,
  unitPrice: 0,
  totalPrice: 0,
  order: 0,
});

const emptyForm = (): Partial<ContractItem> => ({
  code: '',
  name: '',
  parentId: '',
  description: '',
  category: '',
  brand: '',
  origin: '',
  technicalSpec: '',
  length: 0,
  width: 0,
  height: 0,
  quantity: 0,
  unit: '',
  unitPrice: 0,
  materialUnitPrice: 0,
  laborUnitPrice: 0,
  machineUnitPrice: 0,
  workCode: '',
});

const calcResourceTotal = (resource: ResourceDraft) =>
  Number(resource.quantity || 0) * Number(resource.unitPrice || 0);

const ContractItemDetailModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSaved,
  contractId,
  contractType,
  projectId,
  constructionSiteId,
  parentOptions,
  item,
}) => {
  const toast = useToast();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu hạng mục BOQ',
    fallbackError: 'Không thể lưu hạng mục lên Supabase.',
    logScope: 'contractItemDetail.save',
  });
  const [form, setForm] = useState<Partial<ContractItem>>(emptyForm());
  const [resources, setResources] = useState<ResourceDraft[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(item ? { ...item, parentId: item.parentId || '' } : emptyForm());
    setResources([]);
    if (!item?.id) return;
    setLoadingResources(true);
    contractItemResourceService.listByItem(item.id)
      .then(data => setResources(data.map(({ id: _id, contractItemId: _contractItemId, createdAt: _createdAt, ...resource }) => resource)))
      .catch(error => toast.error('Không thể tải định mức hạng mục', error?.message))
      .finally(() => setLoadingResources(false));
  }, [isOpen, item?.id]);

  const totals = useMemo(() => {
    const material = resources.filter(r => r.resourceType === 'material').reduce((sum, r) => sum + calcResourceTotal(r), 0);
    const labor = resources.filter(r => r.resourceType === 'labor').reduce((sum, r) => sum + calcResourceTotal(r), 0);
    const machine = resources.filter(r => r.resourceType === 'machine').reduce((sum, r) => sum + calcResourceTotal(r), 0);
    const unitPrice = Number(form.unitPrice || 0) || material + labor + machine;
    const total = Number(form.quantity || 0) * unitPrice;
    return { material, labor, machine, unitPrice, total };
  }, [form.quantity, form.unitPrice, resources]);

  if (!isOpen) return null;

  const setField = (key: keyof ContractItem, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const addResource = (resourceType: ContractItemResourceType) => {
    setResources(prev => [...prev, { ...emptyResource(resourceType), order: prev.length }]);
  };

  const updateResource = (index: number, patch: Partial<ResourceDraft>) => {
    setResources(prev => prev.map((resource, i) => i === index ? { ...resource, ...patch } : resource));
  };

  const save = async () => {
    if (!form.code?.trim() || !form.name?.trim()) {
      toast.warning('Thiếu thông tin hạng mục', 'Vui lòng nhập mã số và tên hạng mục.');
      return;
    }
    const saved = await run(async () => {
      const payload = {
        ...form,
        contractId,
        contractType,
        projectId: projectId || constructionSiteId || null,
        constructionSiteId,
        code: form.code!.trim(),
        name: form.name!.trim(),
        unit: form.unit || 'm2',
        quantity: Number(form.quantity || 0),
        unitPrice: totals.unitPrice,
        totalPrice: totals.total,
        materialUnitPrice: totals.material,
        laborUnitPrice: totals.labor,
        machineUnitPrice: totals.machine,
        revisedUnitPrice: totals.unitPrice,
        revisedQuantity: Number(form.quantity || 0),
        revisedTotalPrice: totals.total,
        order: item?.order ?? parentOptions.length,
      } as Omit<ContractItem, 'id' | 'createdAt'>;

      let itemId = item?.id;
      if (itemId) {
        await contractItemService.update(itemId, payload);
      } else {
        const created = await contractItemService.create(payload);
        itemId = created.id;
      }
      await contractItemResourceService.replaceForItem(itemId!, resources.map((resource, index) => ({
        ...resource,
        order: index,
        totalPrice: calcResourceTotal(resource),
      })));
    }, {
      successTitle: item ? 'Cập nhật hạng mục thành công' : 'Thêm hạng mục thành công',
    });
    if (saved !== undefined) {
      onSaved();
      onClose();
    }
  };

  const renderResources = (resourceType: ContractItemResourceType, title: string) => {
    const rows = resources.map((resource, index) => ({ resource, index })).filter(row => row.resource.resourceType === resourceType);
    return (
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
          <span className="text-[10px] font-black text-slate-500 uppercase">{title}</span>
          <button onClick={() => addResource(resourceType)} className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
            <Plus size={10} /> Thêm dòng
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="p-2 text-left">Mã/Tên</th>
                <th className="p-2">ĐVT</th>
                <th className="p-2 text-right">Định mức</th>
                <th className="p-2 text-right">Hệ số</th>
                <th className="p-2 text-right">Số lượng</th>
                <th className="p-2 text-right">Đơn giá</th>
                <th className="p-2 text-right">Thành tiền</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ resource, index }) => (
                <tr key={`${resourceType}-${index}`} className="border-b border-slate-50">
                  <td className="p-1 min-w-48">
                    <input value={resource.name} onChange={e => updateResource(index, { name: e.target.value })} placeholder="Tên"
                      className="w-full px-2 py-1 rounded border border-slate-200" />
                  </td>
                  <td className="p-1"><input value={resource.unit || ''} onChange={e => updateResource(index, { unit: e.target.value })} className="w-16 px-2 py-1 rounded border border-slate-200" /></td>
                  <td className="p-1"><input type="number" value={resource.norm || ''} onChange={e => updateResource(index, { norm: Number(e.target.value) || 0 })} className="w-20 px-2 py-1 rounded border border-slate-200 text-right" /></td>
                  <td className="p-1"><input type="number" value={resource.coefficient || ''} onChange={e => updateResource(index, { coefficient: Number(e.target.value) || 0 })} className="w-20 px-2 py-1 rounded border border-slate-200 text-right" /></td>
                  <td className="p-1"><input type="number" value={resource.quantity || ''} onChange={e => updateResource(index, { quantity: Number(e.target.value) || 0 })} className="w-20 px-2 py-1 rounded border border-slate-200 text-right" /></td>
                  <td className="p-1"><input type="number" value={resource.unitPrice || ''} onChange={e => updateResource(index, { unitPrice: Number(e.target.value) || 0 })} className="w-24 px-2 py-1 rounded border border-slate-200 text-right" /></td>
                  <td className="p-2 text-right font-bold text-slate-700">{calcResourceTotal(resource).toLocaleString('vi-VN')}</td>
                  <td className="p-1 text-center">
                    <button onClick={() => setResources(prev => prev.filter((_, i) => i !== index))} className="text-red-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="p-3 text-center text-slate-300 font-bold">Chưa có dữ liệu</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[92vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-black text-slate-800">{item ? 'Sửa hạng mục BOQ' : 'Thêm hạng mục mới'}</h3>
            <p className="text-xs text-slate-400">Khai báo thông tin, giá và định mức vật liệu/nhân công/máy thi công.</p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={form.code || ''} onChange={e => setField('code', e.target.value)} placeholder="Mã số *" className={inputCls} />
            <input value={form.name || ''} onChange={e => setField('name', e.target.value)} placeholder="Tên hạng mục *" className={`md:col-span-2 ${inputCls}`} />
            <select value={form.parentId || ''} onChange={e => setField('parentId', e.target.value || undefined)} className={inputCls}>
              <option value="">Không có hạng mục cha</option>
              {parentOptions.filter(parent => parent.id !== item?.id).map(parent => (
                <option key={parent.id} value={parent.id}>{parent.code} - {parent.name}</option>
              ))}
            </select>
            <input value={form.category || ''} onChange={e => setField('category', e.target.value)} placeholder="Chủng loại" className={inputCls} />
            <input value={form.brand || ''} onChange={e => setField('brand', e.target.value)} placeholder="Thương hiệu" className={inputCls} />
            <input value={form.origin || ''} onChange={e => setField('origin', e.target.value)} placeholder="Xuất xứ" className={inputCls} />
            <textarea value={form.description || ''} onChange={e => setField('description', e.target.value)} placeholder="Mô tả" rows={2} className={`md:col-span-2 ${inputCls}`} />
            <textarea value={form.technicalSpec || ''} onChange={e => setField('technicalSpec', e.target.value)} placeholder="Thông số kỹ thuật" rows={2} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <input type="number" value={form.length || ''} onChange={e => setField('length', Number(e.target.value) || 0)} placeholder="Dài" className={inputCls} />
            <input type="number" value={form.width || ''} onChange={e => setField('width', Number(e.target.value) || 0)} placeholder="Rộng" className={inputCls} />
            <input type="number" value={form.height || ''} onChange={e => setField('height', Number(e.target.value) || 0)} placeholder="Cao" className={inputCls} />
            <input type="number" value={form.quantity || ''} onChange={e => setField('quantity', Number(e.target.value) || 0)} placeholder="Khối lượng" className={inputCls} />
            <input value={form.unit || ''} onChange={e => setField('unit', e.target.value)} placeholder="Đơn vị" className={inputCls} />
            <input value={form.workCode || ''} onChange={e => setField('workCode', e.target.value)} placeholder="Mã công tác" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="number" value={form.unitPrice || ''} onChange={e => setField('unitPrice', Number(e.target.value) || 0)} placeholder="Đơn giá tổng" className={inputCls} />
            <div className="px-3 py-2 rounded-xl bg-slate-50 text-xs"><span className="text-slate-400 block">VL/NC/MTC</span><b>{totals.material.toLocaleString('vi-VN')} / {totals.labor.toLocaleString('vi-VN')} / {totals.machine.toLocaleString('vi-VN')}</b></div>
            <div className="px-3 py-2 rounded-xl bg-emerald-50 text-xs"><span className="text-emerald-500 block">Đơn giá dùng tính</span><b>{totals.unitPrice.toLocaleString('vi-VN')}</b></div>
            <div className="px-3 py-2 rounded-xl bg-indigo-50 text-xs"><span className="text-indigo-500 block">Thành tiền</span><b>{totals.total.toLocaleString('vi-VN')}</b></div>
          </div>

          {loadingResources ? (
            <div className="py-6 text-center text-sm text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Đang tải định mức...</div>
          ) : (
            <div className="space-y-3">
              {renderResources('material', 'Vật liệu')}
              {renderResources('labor', 'Nhân công')}
              {renderResources('machine', 'Máy thi công')}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Đóng</button>
          <button onClick={save} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Đang lưu...' : 'Lưu hạng mục'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContractItemDetailModal;
