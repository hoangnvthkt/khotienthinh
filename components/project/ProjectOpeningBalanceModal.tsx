import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Lock, Plus, Trash2, Upload, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useToast } from '../../context/ToastContext';
import {
  Project,
  ProjectFinance,
  ProjectOpeningBalance,
  ProjectOpeningBalanceImportRow,
  ProjectOpeningBalanceLine,
} from '../../types';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import {
  formatVietnameseMoney,
  formatVietnameseNumber,
  normalizeLookupText,
  parseVietnameseMoney,
  parseVietnameseNumber,
  SITE_WAREHOUSE_STOP_WORDS,
} from '../../lib/projectMaterialTabUtils';
import { getProjectScopeKey } from '../../lib/projectWeeklyProgressService';
import {
  calculateOpeningRecognizedValue,
  projectOpeningBalanceService,
  ProjectOpeningBalanceLockResult,
} from '../../lib/projectOpeningBalanceService';

const fmtFull = (n: number) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')} đ`;
const toNumber = (value: string | number): number => parseVietnameseNumber(value);
const toMoney = (value: string | number): number => parseVietnameseMoney(value);
const fmtInput = (value: unknown, maximumFractionDigits = 6) => formatVietnameseNumber(value, maximumFractionDigits);
const fmtMoneyInput = (value: unknown) => formatVietnameseMoney(value);

type ProjectOpeningBalanceModalLine = ProjectOpeningBalanceLine & Pick<ProjectOpeningBalanceImportRow, 'purchasedAmount' | 'issuedAmount'>;

const emptyLine = (warehouseId = ''): ProjectOpeningBalanceModalLine => ({
  sku: '',
  itemName: '',
  unit: 'Cái',
  warehouseId,
  purchasedQty: 0,
  issuedQty: 0,
  usedQty: 0,
  remainingQty: 0,
  unitPrice: 0,
  remainingValue: 0,
  note: '',
});

interface ProjectOpeningBalanceModalProps {
  open: boolean;
  project: Project;
  constructionSiteId: string;
  siteName?: string;
  finance?: ProjectFinance | null;
  onClose: () => void;
  onApplied?: (result: ProjectOpeningBalanceLockResult) => void | Promise<void>;
}

const ProjectOpeningBalanceModal: React.FC<ProjectOpeningBalanceModalProps> = ({
  open,
  project,
  constructionSiteId,
  siteName,
  finance,
  onClose,
  onApplied,
}) => {
  useModuleData('wms-core');
  const {
    items,
    warehouses,
    user,
    addProjectFinance,
    updateProjectFinance,
    addProjectTransaction,
    loadModuleData,
    refreshWmsRecords,
  } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const scopeKey = useMemo(() => getProjectScopeKey(project.id, constructionSiteId), [constructionSiteId, project.id]);
  const defaultWarehouseId = useMemo(() => {
    const active = warehouses.filter(warehouse => !warehouse.isArchived);
    const siteWarehouses = active.filter(warehouse => warehouse.type === 'SITE');
    const siteText = normalizeLookupText(siteName || project.name);
    if (siteText) {
      const exact = siteWarehouses.find(warehouse => normalizeLookupText(warehouse.name).includes(siteText));
      if (exact) return exact.id;
      const tokens = siteText.split(' ').filter(token => token.length > 1 && !SITE_WAREHOUSE_STOP_WORDS.has(token));
      const allTokenMatch = siteWarehouses.find(warehouse => {
        const name = normalizeLookupText(warehouse.name);
        return tokens.length > 0 && tokens.every(token => name.includes(token));
      });
      if (allTokenMatch) return allTokenMatch.id;
      const partialTokenMatch = siteWarehouses.find(warehouse => {
        const name = normalizeLookupText(warehouse.name);
        return tokens.some(token => name.includes(token));
      });
      if (partialTokenMatch) return partialTokenMatch.id;
    }
    return siteWarehouses[0]?.id || active[0]?.id || '';
  }, [project.name, siteName, warehouses]);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [existingOpening, setExistingOpening] = useState<ProjectOpeningBalance | null>(null);
  const [asOfDate, setAsOfDate] = useState('2026-06-20');
  const [contractValue, setContractValue] = useState(String(finance?.contractValue || ''));
  const [constructionProgress, setConstructionProgress] = useState(String(finance?.progressPercent || ''));
  const [purchasedValue, setPurchasedValue] = useState('');
  const [issuedValue, setIssuedValue] = useState('');
  const [usedValue, setUsedValue] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ProjectOpeningBalanceModalLine[]>([emptyLine(defaultWarehouseId)]);
  const [importMessages, setImportMessages] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setContractValue(finance?.contractValue ? fmtMoneyInput(finance.contractValue) : '');
    setConstructionProgress(finance?.progressPercent ? fmtInput(finance.progressPercent, 2) : '');
    setAsOfDate('2026-06-20');
    setImportMessages({ errors: [], warnings: [] });
    setLines([emptyLine(defaultWarehouseId)]);
    let cancelled = false;
    projectOpeningBalanceService.getOpeningBalanceByScope(scopeKey)
      .then(async balance => {
        if (cancelled) return;
        setExistingOpening(balance);
        if (!balance) return;
        setAsOfDate(balance.asOfDate);
        setContractValue(balance.contractValue ? fmtMoneyInput(balance.contractValue) : '');
        setConstructionProgress(balance.constructionProgressPercent ? fmtInput(balance.constructionProgressPercent, 2) : '');
        setPurchasedValue(balance.purchasedValue ? fmtMoneyInput(balance.purchasedValue) : '');
        setIssuedValue(balance.issuedValue ? fmtMoneyInput(balance.issuedValue) : '');
        setUsedValue(balance.usedValue ? fmtMoneyInput(balance.usedValue) : '');
        setNote(balance.note || '');
        if (balance.id) {
          const savedLines = await projectOpeningBalanceService.listLines(balance.id);
          if (!cancelled && savedLines.length > 0) setLines(savedLines);
        }
      })
      .catch(() => setExistingOpening(null));
    return () => { cancelled = true; };
  }, [defaultWarehouseId, finance?.contractValue, finance?.progressPercent, open, scopeKey]);

  const locked = existingOpening?.status === 'locked';
  const recognizedValue = calculateOpeningRecognizedValue(toMoney(purchasedValue), toMoney(issuedValue), toMoney(usedValue));
  const valueProgress = toMoney(contractValue) > 0 ? Math.min(100, Math.round((recognizedValue / toMoney(contractValue)) * 100)) : 0;
  const lineTotals = useMemo(() => lines.reduce((acc, line) => {
    const unitPrice = Number(line.unitPrice || 0);
    acc.remainingValue += Number(line.remainingValue || Number(line.remainingQty || 0) * unitPrice || 0);
    acc.remainingQty += Number(line.remainingQty || 0);
    return acc;
  }, { remainingQty: 0, remainingValue: 0 }), [lines]);

  const updateLine = (index: number, patch: Partial<ProjectOpeningBalanceModalLine>) => {
    setLines(prev => prev.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, ...patch };
      if (patch.remainingQty !== undefined || patch.unitPrice !== undefined) {
        next.remainingValue = Number(next.remainingQty || 0) * Number(next.unitPrice || 0);
      }
      return next;
    }));
  };

  const resolveWarehouseId = (raw: string): string => {
    const value = raw.trim().toLowerCase();
    const found = warehouses.find(warehouse =>
      warehouse.id.toLowerCase() === value || warehouse.name.trim().toLowerCase() === value
    );
    return found?.id || raw || defaultWarehouseId;
  };

  const formatInputOnBlur = (value: string, setter: (next: string) => void, maximumFractionDigits = 2) => {
    if (!String(value || '').trim()) return;
    setter(formatVietnameseNumber(value, maximumFractionDigits));
  };

  const formatMoneyOnBlur = (value: string, setter: (next: string) => void) => {
    if (!String(value || '').trim()) return;
    setter(fmtMoneyInput(value));
  };

  const getPurchasedAmount = (line: ProjectOpeningBalanceModalLine) =>
    Number(line.purchasedAmount || 0) || Number(line.purchasedQty || 0) * Number(line.unitPrice || 0);
  const getIssuedAmount = (line: ProjectOpeningBalanceModalLine) =>
    Number(line.issuedAmount || 0) || Number(line.issuedQty || 0) * Number(line.unitPrice || 0);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = await projectOpeningBalanceService.parseOpeningBalanceImport(file, {
        existingItems: items,
        defaultWarehouseId,
      });
      const nextLines = parsed.rows.map(row => ({
        ...row,
        warehouseId: resolveWarehouseId(row.warehouseId || ''),
      }));
      const validLines = nextLines.filter(row => row.sku && row.itemName && row.warehouseId && !(row.errors || []).length);
      if (validLines.length === 0) {
        setImportMessages({ errors: parsed.errors, warnings: parsed.warnings });
        toast.warning('File chưa có dòng hợp lệ', 'Cần mã vật tư, tên vật tư và kho.');
        return;
      }
      setLines(validLines);
      setPurchasedValue(fmtMoneyInput(parsed.totals.purchasedValue || 0));
      setIssuedValue(fmtMoneyInput(parsed.totals.issuedValue || 0));
      setUsedValue(fmtMoneyInput(parsed.totals.usedValue || parsed.totals.issuedValue || 0));
      setImportMessages({ errors: parsed.errors, warnings: parsed.warnings });
      toast.success('Đã đọc file đầu kỳ', `${validLines.length} dòng vật tư được đưa vào bảng rà soát.`);
    } catch (error: any) {
      logApiError('ProjectOpeningBalanceModal.import', error);
      toast.error('Không đọc được file đầu kỳ', getApiErrorMessage(error, 'Vui lòng kiểm tra định dạng Excel.'));
    }
  };

  const validate = (): string | null => {
    if (!constructionSiteId) return 'Dự án cần liên kết công trường trước khi nhập đầu kỳ.';
    if (!asOfDate) return 'Thiếu ngày chốt đầu kỳ.';
    if (toMoney(contractValue) <= 0) return 'Tổng giá trị dự án phải lớn hơn 0.';
    if (toNumber(constructionProgress) < 0 || toNumber(constructionProgress) > 100) return 'Tiến độ thi công phải trong khoảng 0-100%.';
    const warehouseIds = new Set(warehouses.map(warehouse => warehouse.id));
    const invalidLine = lines.find(line => line.remainingQty > 0 && (!line.sku || !line.itemName || !line.warehouseId));
    if (invalidLine) return 'Dòng tồn kho có số lượng phải đủ mã vật tư, tên vật tư và kho.';
    const invalidWarehouse = lines.find(line => line.remainingQty > 0 && !warehouseIds.has(line.warehouseId));
    if (invalidWarehouse) return `Kho "${invalidWarehouse.warehouseId}" chưa tồn tại trong danh mục kho.`;
    return null;
  };

  const handleLock = async () => {
    const error = validate();
    if (error) {
      toast.warning('Chưa đủ dữ liệu đầu kỳ', error);
      return;
    }
    setLoading(true);
    try {
      const openingBalance: ProjectOpeningBalance = {
        id: existingOpening?.status === 'draft' ? existingOpening.id : undefined,
        scopeKey,
        projectId: project.id,
        constructionSiteId,
        asOfDate,
        contractValue: toMoney(contractValue),
        constructionProgressPercent: toNumber(constructionProgress),
        purchasedValue: toMoney(purchasedValue),
        issuedValue: toMoney(issuedValue),
        usedValue: toMoney(usedValue),
        recognizedValue,
        status: 'draft',
        note: note.trim() || null,
        createdBy: user.id,
      };
      const result = await projectOpeningBalanceService.lockOpeningBalance({
        openingBalance,
        lines,
        existingItems: items,
        existingFinance: finance,
        actorUserId: user.id,
      });

      if (finance) await updateProjectFinance(result.projectFinance);
      else await addProjectFinance(result.projectFinance);
      if (result.materialProjectTransaction) await addProjectTransaction(result.materialProjectTransaction);
      await Promise.all([
        refreshWmsRecords({
          itemIds: [
            ...result.createdItems.map(item => item.id),
            ...result.stockTransactions.flatMap(tx => (tx.items || []).map(item => item.itemId)),
          ],
          transactionIds: result.stockTransactions.map(tx => tx.id),
        }),
        loadModuleData('da', true),
      ]);
      setExistingOpening(result.openingBalance);
      await onApplied?.(result);
      toast.success('Đã khóa dữ liệu đầu kỳ', 'Dashboard, tồn kho và tiến độ theo giá trị đã nhận số đầu kỳ.');
      onClose();
    } catch (error: any) {
      logApiError('ProjectOpeningBalanceModal.lock', error);
      toast.error('Không khóa được đầu kỳ', getApiErrorMessage(error, 'Vui lòng kiểm tra dữ liệu và thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const steps = ['Mốc chốt', 'Giá trị & tiến độ', 'Vật tư tổng', 'Tồn kho', 'Rà soát'];
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500 bg-white';
  const labelCls = 'text-[10px] font-black text-slate-500 uppercase block mb-1';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-black text-slate-800 flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-orange-500" /> Nhập dữ liệu đầu kỳ
            </div>
            <p className="text-xs font-bold text-slate-400 mt-1">{project.code} - {project.name} {siteName ? `- ${siteName}` : ''}</p>
          </div>
          <button onClick={onClose} disabled={loading} className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 flex items-center justify-center disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="grid grid-cols-5 gap-2">
            {steps.map((label, index) => (
              <button
                key={label}
                onClick={() => setStep(index)}
                disabled={loading}
                className={`h-10 rounded-xl text-[11px] font-black border transition-all ${
                  step === index
                    ? 'bg-orange-500 text-white border-orange-500'
                    : index < step
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : 'bg-slate-50 text-slate-500 border-slate-100'
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {locked ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
              <div className="flex items-center gap-2 font-black"><Lock size={18} /> Đầu kỳ đã khóa</div>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-emerald-600 font-bold block">Ngày chốt</span>{existingOpening?.asOfDate}</div>
                <div><span className="text-emerald-600 font-bold block">Giá trị dự án</span>{fmtFull(existingOpening?.contractValue || 0)}</div>
                <div><span className="text-emerald-600 font-bold block">Tiến độ thi công</span>{existingOpening?.constructionProgressPercent || 0}%</div>
                <div><span className="text-emerald-600 font-bold block">Tiến độ theo giá trị</span>{existingOpening?.contractValue ? Math.round(((existingOpening?.recognizedValue || 0) / existingOpening.contractValue) * 100) : 0}%</div>
              </div>
            </div>
          ) : step === 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Ngày chốt đầu kỳ</label>
                <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Scope</label>
                <input value={scopeKey} readOnly className={`${inputCls} bg-slate-50 text-slate-500`} />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Ghi chú</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} className={`${inputCls} resize-y font-medium`} placeholder="VD: Chốt số liệu thực tế SMB đến ngày đưa phần mềm vào vận hành." />
              </div>
            </div>
          ) : step === 1 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Tổng giá trị dự án / hợp đồng</label>
                <input type="text" inputMode="decimal" value={contractValue} onChange={e => setContractValue(e.target.value)} onBlur={() => formatMoneyOnBlur(contractValue, setContractValue)} className={inputCls} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Tiến độ thi công hiện tại (%)</label>
                <input type="text" inputMode="decimal" value={constructionProgress} onChange={e => setConstructionProgress(e.target.value)} onBlur={() => formatInputOnBlur(constructionProgress, setConstructionProgress, 2)} className={inputCls} placeholder="0" />
              </div>
              <div className="md:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">
                Tiến độ này là số chốt ban đầu. Sau khi triển khai, tab Gantt/tiến độ tuần sẽ tiếp tục cập nhật tiến độ thi công.
              </div>
            </div>
          ) : step === 2 ? (
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Giá trị vật tư đã mua</label>
                <input type="text" inputMode="decimal" value={purchasedValue} onChange={e => setPurchasedValue(e.target.value)} onBlur={() => formatMoneyOnBlur(purchasedValue, setPurchasedValue)} className={inputCls} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Giá trị đã xuất/cấp</label>
                <input type="text" inputMode="decimal" value={issuedValue} onChange={e => setIssuedValue(e.target.value)} onBlur={() => formatMoneyOnBlur(issuedValue, setIssuedValue)} className={inputCls} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Giá trị đã sử dụng</label>
                <input type="text" inputMode="decimal" value={usedValue} onChange={e => setUsedValue(e.target.value)} onBlur={() => formatMoneyOnBlur(usedValue, setUsedValue)} className={inputCls} placeholder="0" />
              </div>
              <div className="md:col-span-3 grid md:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="text-[10px] font-black uppercase text-blue-500">Recognized value</div>
                  <div className="text-lg font-black text-blue-800">{fmtFull(recognizedValue)}</div>
                </div>
                <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                  <div className="text-[10px] font-black uppercase text-orange-500">Tiến độ theo giá trị</div>
                  <div className="text-lg font-black text-orange-700">{valueProgress}%</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs font-bold text-slate-500">
                  Chi phí vật tư đầu kỳ ưu tiên giá trị đã xuất/sử dụng; giá trị đã mua chỉ dùng làm tham chiếu tổng nhập.
                </div>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-slate-700">Tồn kho chi tiết</div>
                  <div className="text-xs font-bold text-slate-400">{lines.length} dòng - tổng tồn {lineTotals.remainingQty.toLocaleString('vi-VN')} - {fmtFull(lineTotals.remainingValue)}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 flex items-center gap-1.5">
                    <Upload size={14} /> Import Excel
                  </button>
                  <button onClick={() => setLines(prev => [...prev, emptyLine(defaultWarehouseId)])} className="px-3 py-2 rounded-xl text-xs font-black text-orange-700 bg-orange-50 border border-orange-100 flex items-center gap-1.5">
                    <Plus size={14} /> Dòng
                  </button>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
                </div>
              </div>
              {(importMessages.errors.length > 0 || importMessages.warnings.length > 0) && (
                <div className="grid md:grid-cols-2 gap-3">
                  {importMessages.errors.length > 0 && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                      <div className="mb-1 font-black uppercase">Dòng lỗi</div>
                      {importMessages.errors.slice(0, 6).map(message => <div key={message}>{message}</div>)}
                      {importMessages.errors.length > 6 && <div>+{importMessages.errors.length - 6} lỗi khác</div>}
                    </div>
                  )}
                  {importMessages.warnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                      <div className="mb-1 font-black uppercase">Cảnh báo</div>
                      {importMessages.warnings.slice(0, 6).map(message => <div key={message}>{message}</div>)}
                      {importMessages.warnings.length > 6 && <div>+{importMessages.warnings.length - 6} cảnh báo khác</div>}
                    </div>
                  )}
                </div>
              )}
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-[1600px] w-full table-fixed text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="w-32 p-2 text-left">Mã vật tư</th>
                      <th className="w-64 p-2 text-left">Tên vật tư gốc</th>
                      <th className="w-24 p-2 text-left">ĐVT</th>
                      <th className="w-48 p-2 text-left">Kho</th>
                      <th className="w-28 p-2 text-right">Đã mua</th>
                      <th className="w-28 p-2 text-right">Đã xuất</th>
                      <th className="w-28 p-2 text-right">Đã dùng</th>
                      <th className="w-28 p-2 text-right">Tồn</th>
                      <th className="w-40 p-2 text-right">Đơn giá</th>
                      <th className="w-36 p-2 text-right">Tiền nhập</th>
                      <th className="w-36 p-2 text-right">Tiền xuất</th>
                      <th className="w-36 p-2 text-right">Tiền tồn</th>
                      <th className="w-12 p-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, index) => (
                      <tr key={index} className="align-top">
                        <td className="p-2"><input value={line.accountingCode || line.sku || ''} onChange={e => updateLine(index, { accountingCode: e.target.value, sku: e.target.value })} className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 font-bold" /></td>
                        <td className="p-2"><input value={line.itemName} onChange={e => updateLine(index, { itemName: e.target.value })} className="w-60 px-2 py-1.5 rounded-lg border border-slate-200 font-bold" /></td>
                        <td className="p-2"><input value={line.unit} onChange={e => updateLine(index, { unit: e.target.value })} className="w-20 px-2 py-1.5 rounded-lg border border-slate-200" /></td>
                        <td className="p-2">
                          <select value={line.warehouseId} onChange={e => updateLine(index, { warehouseId: e.target.value })} className="w-44 px-2 py-1.5 rounded-lg border border-slate-200 font-bold">
                            <option value="">Chọn kho</option>
                            {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                          </select>
                        </td>
                        {(['purchasedQty', 'issuedQty', 'usedQty', 'remainingQty', 'unitPrice'] as const).map(key => (
                          <td key={key} className="p-2">
                            <input type="text" inputMode="decimal" value={key === 'unitPrice' ? fmtMoneyInput(line[key]) : fmtInput(line[key], 6)} onChange={e => updateLine(index, { [key]: key === 'unitPrice' ? toMoney(e.target.value) : toNumber(e.target.value) })} className={`${key === 'unitPrice' ? 'w-32' : 'w-24'} px-2 py-1.5 rounded-lg border border-slate-200 text-right tabular-nums`} />
                          </td>
                        ))}
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(getPurchasedAmount(line))}</td>
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(getIssuedAmount(line))}</td>
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(line.remainingValue || 0)}</td>
                        <td className="p-2 text-center">
                          <button onClick={() => setLines(prev => prev.filter((_, i) => i !== index))} className="w-7 h-7 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={14} className="mx-auto" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid md:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Giá trị dự án</div><div className="font-black text-slate-800">{fmtFull(toMoney(contractValue))}</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Tiến độ thi công</div><div className="font-black text-slate-800">{toNumber(constructionProgress)}%</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Recognized</div><div className="font-black text-slate-800">{fmtFull(recognizedValue)}</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Tồn chi tiết</div><div className="font-black text-slate-800">{lines.filter(line => line.remainingQty > 0).length} dòng</div></div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800 flex gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                Sau khi khóa, phần mềm sẽ tạo chi phí vật tư đầu kỳ và phiếu điều chỉnh tồn kho. Không sửa trực tiếp bản đã khóa.
              </div>
            </div>
          )}
        </div>

        {!locked && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <button onClick={() => setStep(prev => Math.max(0, prev - 1))} disabled={step === 0 || loading} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center gap-2">
              <ChevronLeft size={16} /> Trước
            </button>
            {step < steps.length - 1 ? (
              <button onClick={() => setStep(prev => Math.min(steps.length - 1, prev + 1))} disabled={loading} className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-orange-500 hover:bg-orange-600 flex items-center gap-2">
                Tiếp <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={handleLock} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Khóa đầu kỳ
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectOpeningBalanceModal;
