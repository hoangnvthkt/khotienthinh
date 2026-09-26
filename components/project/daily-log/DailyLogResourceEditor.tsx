import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BusinessPartner, DailyLogLaborInput, DailyLogMachineInput, DailyLogResourceProvider } from '../../../types';
import { calculateLaborHours, calculateMachineHours, validateResourceProvider } from '../../../lib/dailyLogResourceRules';

interface DailyLogResourceEditorProps {
  workItemClientKey: string;
  resourceProviders: BusinessPartner[];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
  readOnly?: boolean;
  onLaborChange(rows: DailyLogLaborInput[]): void;
  onMachinesChange(rows: DailyLogMachineInput[]): void;
}

const fieldClass = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800';

const providerValue = (provider: DailyLogResourceProvider) => provider.entryMode === 'catalog'
  ? `catalog:${provider.partnerId || ''}` : 'manual';

const MANUAL_LABOR_TYPES = [
  ['free_crew', 'Tổ đội tự do'], ['day_labor', 'Nhân công nhật'],
  ['unregistered_provider', 'Đơn vị chưa có trong danh mục'], ['other', 'Khác'],
] as const;
const MANUAL_MACHINE_TYPES = [
  ['machine_owner', 'Chủ máy'], ['unregistered_rental_provider', 'Đơn vị cho thuê chưa có trong danh mục'], ['other', 'Khác'],
] as const;

export const DailyLogResourceEditor: React.FC<DailyLogResourceEditorProps> = ({
  workItemClientKey, resourceProviders, labor, machines, readOnly,
  onLaborChange, onMachinesChange,
}) => {
  const updateProvider = <T extends DailyLogLaborInput | DailyLogMachineInput>(
    rows: T[], index: number, value: string, onChange: (next: T[]) => void, kind: 'labor' | 'machine',
  ) => {
    const next = [...rows];
    if (value === 'manual') {
      next[index] = { ...next[index], provider: {
        entryMode: 'manual',
        manualProviderType: kind === 'labor' ? 'free_crew' : 'machine_owner',
        manualProviderName: '',
      } };
    } else if (value.startsWith('catalog:')) {
      const partner = resourceProviders.find(item => item.id === value.slice('catalog:'.length));
      next[index] = { ...next[index], provider: {
        entryMode: 'catalog', partnerId: partner?.id || null,
        providerCodeSnapshot: partner?.code || null, providerNameSnapshot: partner?.name || null,
      } };
    } else {
      next[index] = { ...next[index], provider: { entryMode: 'catalog' } };
    }
    onChange(next);
  };

  const renderProviderFields = <T extends DailyLogLaborInput | DailyLogMachineInput>(
    row: T, index: number, rows: T[], onChange: (next: T[]) => void, kind: 'labor' | 'machine',
  ) => {
    const validation = validateResourceProvider(row.provider);
    const selectedCatalogProvider = row.provider.entryMode === 'catalog'
      ? resourceProviders.find(partner => partner.id === row.provider.partnerId)
      : undefined;
    const catalogProviderInactive = row.provider.entryMode === 'catalog'
      && Boolean(row.provider.partnerId)
      && selectedCatalogProvider?.isActive === false;
    const manualTypes = kind === 'labor' ? MANUAL_LABOR_TYPES : MANUAL_MACHINE_TYPES;
    return (
      <>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          Nguồn cung cấp
          <select aria-label={`Nguồn cung cấp ${kind === 'labor' ? 'nhân công' : 'máy'} ${index + 1}`}
            value={providerValue(row.provider)} disabled={readOnly}
            onChange={event => updateProvider(rows, index, event.target.value, onChange, kind)} className={fieldClass}>
            <option value="">Chọn NCC/đội hoặc nhập tay</option>
            {resourceProviders.filter(partner => partner.isActive !== false).map(partner => (
              <option key={partner.id} value={`catalog:${partner.id}`}>{partner.code ? `${partner.code} - ` : ''}{partner.name}</option>
            ))}
            {catalogProviderInactive && selectedCatalogProvider && (
              <option value={`catalog:${selectedCatalogProvider.id}`} disabled>
                {selectedCatalogProvider.code ? `${selectedCatalogProvider.code} - ` : ''}{selectedCatalogProvider.name} (đã ngừng hoạt động)
              </option>
            )}
            <option value="manual">Nhập tay</option>
          </select>
        </label>
        {row.provider.entryMode === 'manual' && (
          <>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Loại nguồn
              <select value={row.provider.manualProviderType || ''} disabled={readOnly} className={fieldClass}
                onChange={event => {
                  const next = [...rows];
                  next[index] = { ...row, provider: { ...row.provider, manualProviderType: event.target.value as DailyLogResourceProvider['manualProviderType'] } };
                  onChange(next);
                }}>
                {manualTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Tên nguồn <span className="sr-only">bắt buộc</span>
              <input value={row.provider.manualProviderName || ''} disabled={readOnly} className={fieldClass}
                placeholder={kind === 'labor' ? 'Ví dụ: Tổ anh Minh' : 'Ví dụ: Chủ máy anh Nam'}
                onChange={event => {
                  const next = [...rows];
                  next[index] = { ...row, provider: { ...row.provider, manualProviderName: event.target.value } };
                  onChange(next);
                }} />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Ghi chú nguồn <span className="font-normal text-slate-400">(không bắt buộc)</span>
              <input value={row.provider.manualProviderNote || ''} disabled={readOnly} className={fieldClass}
                placeholder="Thông tin nhận diện thêm"
                onChange={event => {
                  const next = [...rows];
                  next[index] = { ...row, provider: { ...row.provider, manualProviderNote: event.target.value } };
                  onChange(next);
                }} />
            </label>
          </>
        )}
        {!validation.valid && <p className="col-span-full text-xs font-medium text-red-600">Chọn NCC/đội hoặc nhập tay và điền đủ thông tin nguồn.</p>}
        {catalogProviderInactive && <p className="col-span-full text-xs font-medium text-red-600">Nguồn danh mục đã ngừng hoạt động. Hãy chọn nguồn đang hoạt động hoặc nhập tay.</p>}
      </>
    );
  };

  return (
    <div className="space-y-5 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/70">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Nhân công hôm nay</h4>
          {!readOnly && <button type="button" onClick={() => onLaborChange([...labor, {
            workItemClientKey, laborType: '', peopleCount: 1, hoursPerPerson: 8, provider: { entryMode: 'catalog' },
          }])} className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-950/50"><Plus size={14} /> Thêm dòng</button>}
        </div>
        {labor.length === 0 ? <p className="text-xs text-slate-500">Chưa ghi nhận nhân công cho WBS này.</p> : (
          <div className="space-y-3">{labor.map((row, index) => {
            let total = 0;
            try { total = calculateLaborHours(row); } catch { total = 0; }
            return <div key={`${workItemClientKey}-labor-${index}`} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-6 dark:border-slate-700 dark:bg-slate-950/50">
              {renderProviderFields(row, index, labor, onLaborChange, 'labor')}
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Nhóm nhân công<input value={row.laborType} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...labor]; next[index] = { ...row, laborType: event.target.value }; onLaborChange(next); }} /></label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Số người<input type="number" min="0.1" step="0.1" value={row.peopleCount} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...labor]; next[index] = { ...row, peopleCount: Number(event.target.value) }; onLaborChange(next); }} /></label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Giờ mỗi người<input type="number" min="0.1" step="0.1" value={row.hoursPerPerson} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...labor]; next[index] = { ...row, hoursPerPerson: Number(event.target.value) }; onLaborChange(next); }} /></label>
              <div className="flex items-end justify-between gap-2"><div><div className="text-xs font-semibold text-slate-500">Tổng giờ công</div><div className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{total.toLocaleString('vi-VN')} giờ</div></div>{!readOnly && <button type="button" aria-label={`Xóa dòng nhân công ${index + 1}`} onClick={() => onLaborChange(labor.filter((_, rowIndex) => rowIndex !== index))} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>}</div>
            </div>;
          })}</div>
        )}
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Máy hôm nay</h4>
          {!readOnly && <button type="button" onClick={() => onMachinesChange([...machines, {
            workItemClientKey, machineType: '', machineCount: 1, hoursPerMachine: 8, provider: { entryMode: 'catalog' },
          }])} className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-950/50"><Plus size={14} /> Thêm dòng</button>}
        </div>
        {machines.length === 0 ? <p className="text-xs text-slate-500">Chưa ghi nhận máy cho WBS này.</p> : (
          <div className="space-y-3">{machines.map((row, index) => {
            let total = 0;
            try { total = calculateMachineHours(row); } catch { total = 0; }
            return <div key={`${workItemClientKey}-machine-${index}`} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-6 dark:border-slate-700 dark:bg-slate-950/50">
              {renderProviderFields(row, index, machines, onMachinesChange, 'machine')}
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Loại máy<input value={row.machineType} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...machines]; next[index] = { ...row, machineType: event.target.value }; onMachinesChange(next); }} /></label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Số máy<input type="number" min="0.1" step="0.1" value={row.machineCount} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...machines]; next[index] = { ...row, machineCount: Number(event.target.value) }; onMachinesChange(next); }} /></label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Giờ mỗi máy<input type="number" min="0.1" step="0.1" value={row.hoursPerMachine} disabled={readOnly} className={fieldClass} onChange={event => { const next = [...machines]; next[index] = { ...row, hoursPerMachine: Number(event.target.value) }; onMachinesChange(next); }} /></label>
              <div className="flex items-end justify-between gap-2"><div><div className="text-xs font-semibold text-slate-500">Tổng giờ máy</div><div className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{total.toLocaleString('vi-VN')} giờ</div></div>{!readOnly && <button type="button" aria-label={`Xóa dòng máy ${index + 1}`} onClick={() => onMachinesChange(machines.filter((_, rowIndex) => rowIndex !== index))} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>}</div>
            </div>;
          })}</div>
        )}
      </section>
    </div>
  );
};
