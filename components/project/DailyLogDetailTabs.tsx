import React, { useState } from 'react';
import { Plus, X, Package, Users, Wrench, Layers } from 'lucide-react';
import {
  DailyLogVolume, DailyLogMaterial, DailyLogLabor, DailyLogMachine,
  LaborType, LABOR_TYPE_LABELS, MachineType, MACHINE_TYPE_LABELS,
  ContractItem,
} from '../../types';

interface Props {
  volumes: DailyLogVolume[];
  materials: DailyLogMaterial[];
  laborDetails: DailyLogLabor[];
  machines: DailyLogMachine[];
  onVolumesChange: (v: DailyLogVolume[]) => void;
  onMaterialsChange: (v: DailyLogMaterial[]) => void;
  onLaborChange: (v: DailyLogLabor[]) => void;
  onMachinesChange: (v: DailyLogMachine[]) => void;
  contractItems?: ContractItem[];
}

type TabKey = 'volumes' | 'materials' | 'labor' | 'machines';
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'volumes', label: 'Khối lượng', icon: <Layers size={12} /> },
  { key: 'materials', label: 'Vật tư', icon: <Package size={12} /> },
  { key: 'labor', label: 'Nhân công', icon: <Users size={12} /> },
  { key: 'machines', label: 'Máy TC', icon: <Wrench size={12} /> },
];

const inputCls = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-1 focus:ring-teal-400 bg-white dark:bg-slate-700';

const DailyLogDetailTabs: React.FC<Props> = ({
  volumes, materials, laborDetails, machines,
  onVolumesChange, onMaterialsChange, onLaborChange, onMachinesChange,
  contractItems = [],
}) => {
  const [tab, setTab] = useState<TabKey>('volumes');

  return (
    <div className="border-t border-slate-100 pt-4">
      <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Chi tiết thi công (FastCons)</label>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              tab === t.key
                ? 'text-teal-700 bg-teal-100 border border-teal-200'
                : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {t.icon} {t.label}
            {t.key === 'volumes' && volumes.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-teal-500 text-white text-[8px] flex items-center justify-center">{volumes.length}</span>}
            {t.key === 'materials' && materials.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-orange-500 text-white text-[8px] flex items-center justify-center">{materials.length}</span>}
            {t.key === 'labor' && laborDetails.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-blue-500 text-white text-[8px] flex items-center justify-center">{laborDetails.length}</span>}
            {t.key === 'machines' && machines.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-purple-500 text-white text-[8px] flex items-center justify-center">{machines.length}</span>}
          </button>
        ))}
      </div>

      {/* Volumes Tab */}
      {tab === 'volumes' && (
        <div className="space-y-2">
          {volumes.map((v, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-teal-50/50 border border-teal-100">
              {contractItems.length > 0 ? (
                <select className={`${inputCls} flex-1`} value={v.contractItemId}
                  onChange={e => {
                    const ci = contractItems.find(c => c.id === e.target.value);
                    const updated = [...volumes];
                    updated[i] = { ...v, contractItemId: e.target.value, contractItemName: ci?.name, unit: ci?.unit || v.unit };
                    onVolumesChange(updated);
                  }}>
                  <option value="">Chọn hạng mục...</option>
                  {contractItems.map(ci => <option key={ci.id} value={ci.id}>{ci.code} — {ci.name}</option>)}
                </select>
              ) : (
                <input placeholder="Tên hạng mục" value={v.contractItemName || ''} className={`${inputCls} flex-1`}
                  onChange={e => { const u = [...volumes]; u[i] = { ...v, contractItemName: e.target.value }; onVolumesChange(u); }} />
              )}
              <input type="number" placeholder="KL" value={v.quantity || ''} className={`${inputCls} w-20`}
                onChange={e => { const u = [...volumes]; u[i] = { ...v, quantity: Number(e.target.value) }; onVolumesChange(u); }} />
              <input placeholder="ĐVT" value={v.unit} className={`${inputCls} w-14`}
                onChange={e => { const u = [...volumes]; u[i] = { ...v, unit: e.target.value }; onVolumesChange(u); }} />
              <button onClick={() => onVolumesChange(volumes.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onVolumesChange([...volumes, { contractItemId: '', quantity: 0, unit: 'm2' }])}
            className="flex items-center gap-1 text-[10px] font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200">
            <Plus size={10} /> Thêm khối lượng
          </button>
        </div>
      )}

      {/* Materials Tab */}
      {tab === 'materials' && (
        <div className="space-y-2">
          {materials.map((m, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-orange-50/50 border border-orange-100">
              <input placeholder="Tên vật tư" value={m.itemName} className={`${inputCls} flex-1`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, itemName: e.target.value }; onMaterialsChange(u); }} />
              <input type="number" placeholder="SL" value={m.quantity || ''} className={`${inputCls} w-20`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, quantity: Number(e.target.value) }; onMaterialsChange(u); }} />
              <input placeholder="ĐVT" value={m.unit} className={`${inputCls} w-14`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, unit: e.target.value }; onMaterialsChange(u); }} />
              <button onClick={() => onMaterialsChange(materials.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onMaterialsChange([...materials, { itemName: '', unit: 'kg', quantity: 0 }])}
            className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg border border-orange-200">
            <Plus size={10} /> Thêm vật tư
          </button>
        </div>
      )}

      {/* Labor Tab */}
      {tab === 'labor' && (
        <div className="space-y-2">
          {laborDetails.map((l, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-blue-50/50 border border-blue-100">
              <select value={l.laborType} className={`${inputCls} w-28`}
                onChange={e => { const u = [...laborDetails]; u[i] = { ...l, laborType: e.target.value as LaborType }; onLaborChange(u); }}>
                {Object.entries(LABOR_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="number" placeholder="SL" value={l.count || ''} className={`${inputCls} w-16`}
                onChange={e => { const u = [...laborDetails]; u[i] = { ...l, count: Number(e.target.value) }; onLaborChange(u); }} />
              <input type="number" placeholder="Giờ" value={l.hours || ''} className={`${inputCls} w-16`}
                onChange={e => { const u = [...laborDetails]; u[i] = { ...l, hours: Number(e.target.value) }; onLaborChange(u); }} />
              <input type="number" placeholder="Đơn giá" value={l.unitCost || ''} className={`${inputCls} w-24`}
                onChange={e => { const u = [...laborDetails]; u[i] = { ...l, unitCost: Number(e.target.value) }; onLaborChange(u); }} />
              <button onClick={() => onLaborChange(laborDetails.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onLaborChange([...laborDetails, { laborType: 'tho_chinh', count: 0, hours: 8 }])}
            className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200">
            <Plus size={10} /> Thêm nhân công
          </button>
        </div>
      )}

      {/* Machines Tab */}
      {tab === 'machines' && (
        <div className="space-y-2">
          {machines.map((m, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-purple-50/50 border border-purple-100">
              <input placeholder="Tên máy" value={m.machineName} className={`${inputCls} flex-1`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, machineName: e.target.value }; onMachinesChange(u); }} />
              <select value={m.machineType} className={`${inputCls} w-28`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, machineType: e.target.value as MachineType }; onMachinesChange(u); }}>
                {Object.entries(MACHINE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="number" step="0.5" placeholder="Số ca" value={m.shifts || ''} className={`${inputCls} w-16`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, shifts: Number(e.target.value) }; onMachinesChange(u); }} />
              <input type="number" placeholder="ĐG/ca" value={m.unitCost || ''} className={`${inputCls} w-24`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, unitCost: Number(e.target.value) }; onMachinesChange(u); }} />
              <button onClick={() => onMachinesChange(machines.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onMachinesChange([...machines, { machineName: '', machineType: 'excavator', shifts: 1 }])}
            className="flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg border border-purple-200">
            <Plus size={10} /> Thêm máy thi công
          </button>
        </div>
      )}
    </div>
  );
};

export default DailyLogDetailTabs;
