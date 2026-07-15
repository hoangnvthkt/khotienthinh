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
  normalizeLookupText,
  SITE_WAREHOUSE_STOP_WORDS,
} from '../../lib/projectMaterialTabUtils';
import {
  formatCurrencyVi,
  formatViDecimal,
  formatViPercent,
  formatViQuantity,
  type DecimalPolicy,
} from '../../lib/locale/decimal';
import {
  inspectLocalizedNumberDraft,
  localizedNumberValidationMessage,
} from '../../lib/locale/inputDraft';
import {
  LocalizedMoneyInput,
  LocalizedNumberInput,
} from '../common/LocalizedNumberInput';
import { getProjectScopeKey } from '../../lib/projectWeeklyProgressService';
import {
  calculateOpeningRecognizedValue,
  projectOpeningBalanceService,
  ProjectOpeningBalanceLockResult,
} from '../../lib/projectOpeningBalanceService';
import {
  clearProjectOpeningBalanceCommandId,
  getOrCreateProjectOpeningBalanceCommandId,
} from '../../lib/projectOpeningBalanceCommand';

const QUANTITY_POLICY: DecimalPolicy = {
  kind: 'quantity',
  maxFractionDigits: 6,
  min: 0,
  allowNegative: false,
};
const UNIT_PRICE_POLICY: DecimalPolicy = {
  kind: 'currency',
  maxFractionDigits: 6,
  min: 0,
  allowNegative: false,
};
const PERCENT_POLICY: DecimalPolicy = {
  kind: 'percent',
  maxFractionDigits: 2,
  min: 0,
  max: 100,
  allowNegative: false,
};
const VND_TOTAL_POLICY: DecimalPolicy = {
  kind: 'vnd',
  maxFractionDigits: 0,
  min: 0,
  allowNegative: false,
};

const fmtFull = (value: number) => formatCurrencyVi(value, 'VND');
const formatInitialDraft = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  // Keep unexpected source precision visible so policy validation can reject it.
  return formatViDecimal(value, { maximumFractionDigits: 20 });
};

type EditableLineNumberKey = 'purchasedQty' | 'issuedQty' | 'usedQty' | 'remainingQty' | 'unitPrice';
type ProjectOpeningBalanceModalLine = Omit<ProjectOpeningBalanceLine, EditableLineNumberKey> &
  Pick<ProjectOpeningBalanceImportRow, 'rowNumber' | 'purchasedAmount' | 'issuedAmount' | 'errors' | 'warnings'> & {
    [Key in EditableLineNumberKey]: string;
  };

const toDraftLine = (line: ProjectOpeningBalanceImportRow | ProjectOpeningBalanceLine): ProjectOpeningBalanceModalLine => ({
  ...line,
  purchasedQty: formatInitialDraft(line.purchasedQty),
  issuedQty: formatInitialDraft(line.issuedQty),
  usedQty: formatInitialDraft(line.usedQty),
  remainingQty: formatInitialDraft(line.remainingQty),
  unitPrice: formatInitialDraft(line.unitPrice),
});

const readDraftNumber = (draft: string, policy: DecimalPolicy): number => {
  const result = inspectLocalizedNumberDraft(draft, policy);
  return result.ok === true ? result.value ?? 0 : 0;
};

const emptyLine = (warehouseId = ''): ProjectOpeningBalanceModalLine => ({
  sku: '',
  itemName: '',
  unit: 'Cái',
  warehouseId,
  purchasedQty: '',
  issuedQty: '',
  usedQty: '',
  remainingQty: '',
  unitPrice: '',
  remainingValue: 0,
  note: '',
});

type PreparedLockInput =
  | { ok: false; error: string }
  | {
      ok: true;
      contractValue: number;
      constructionProgress: number;
      purchasedValue: number;
      issuedValue: number;
      usedValue: number;
      lines: ProjectOpeningBalanceLine[];
    };

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
  const [contractValue, setContractValue] = useState(formatInitialDraft(finance?.contractValue));
  const [constructionProgress, setConstructionProgress] = useState(formatInitialDraft(finance?.progressPercent));
  const [purchasedValue, setPurchasedValue] = useState('');
  const [issuedValue, setIssuedValue] = useState('');
  const [usedValue, setUsedValue] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ProjectOpeningBalanceModalLine[]>([emptyLine(defaultWarehouseId)]);
  const [importMessages, setImportMessages] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setContractValue(formatInitialDraft(finance?.contractValue));
    setConstructionProgress(formatInitialDraft(finance?.progressPercent));
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
        setContractValue(formatInitialDraft(balance.contractValue));
        setConstructionProgress(formatInitialDraft(balance.constructionProgressPercent));
        setPurchasedValue(formatInitialDraft(balance.purchasedValue));
        setIssuedValue(formatInitialDraft(balance.issuedValue));
        setUsedValue(formatInitialDraft(balance.usedValue));
        setNote(balance.note || '');
        if (balance.id) {
          const savedLines = await projectOpeningBalanceService.listLines(balance.id);
          if (!cancelled && savedLines.length > 0) setLines(savedLines.map(toDraftLine));
        }
      })
      .catch(() => setExistingOpening(null));
    return () => { cancelled = true; };
  }, [defaultWarehouseId, finance?.contractValue, finance?.progressPercent, open, scopeKey]);

  const locked = existingOpening?.status === 'locked';
  const purchasedValuePreview = readDraftNumber(purchasedValue, VND_TOTAL_POLICY);
  const issuedValuePreview = readDraftNumber(issuedValue, VND_TOTAL_POLICY);
  const usedValuePreview = readDraftNumber(usedValue, VND_TOTAL_POLICY);
  const contractValuePreview = readDraftNumber(contractValue, VND_TOTAL_POLICY);
  const constructionProgressPreview = readDraftNumber(constructionProgress, PERCENT_POLICY);
  const recognizedValue = calculateOpeningRecognizedValue(
    purchasedValuePreview,
    issuedValuePreview,
    usedValuePreview,
  );
  const valueProgress = contractValuePreview > 0
    ? Math.min(100, Math.round((recognizedValue / contractValuePreview) * 100))
    : 0;
  const lineTotals = useMemo(() => lines.reduce((acc, line) => {
    const remainingQty = readDraftNumber(line.remainingQty, QUANTITY_POLICY);
    const unitPrice = readDraftNumber(line.unitPrice, UNIT_PRICE_POLICY);
    acc.remainingValue += remainingQty * unitPrice;
    acc.remainingQty += remainingQty;
    return acc;
  }, { remainingQty: 0, remainingValue: 0 }), [lines]);

  const updateLine = (index: number, patch: Partial<ProjectOpeningBalanceModalLine>) => {
    setLines(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const resolveWarehouseId = (raw: string): string => {
    const value = raw.trim().toLowerCase();
    const found = warehouses.find(warehouse =>
      warehouse.id.toLowerCase() === value || warehouse.name.trim().toLowerCase() === value
    );
    return found?.id || raw || defaultWarehouseId;
  };

  const getPurchasedAmount = (line: ProjectOpeningBalanceModalLine) =>
    (typeof line.purchasedAmount === 'number' && Number.isFinite(line.purchasedAmount) ? line.purchasedAmount : 0)
      || readDraftNumber(line.purchasedQty, QUANTITY_POLICY) * readDraftNumber(line.unitPrice, UNIT_PRICE_POLICY);
  const getIssuedAmount = (line: ProjectOpeningBalanceModalLine) =>
    (typeof line.issuedAmount === 'number' && Number.isFinite(line.issuedAmount) ? line.issuedAmount : 0)
      || readDraftNumber(line.issuedQty, QUANTITY_POLICY) * readDraftNumber(line.unitPrice, UNIT_PRICE_POLICY);
  const getRemainingAmount = (line: ProjectOpeningBalanceModalLine) =>
    readDraftNumber(line.remainingQty, QUANTITY_POLICY) * readDraftNumber(line.unitPrice, UNIT_PRICE_POLICY);

  const hasLineActivity = (line: ProjectOpeningBalanceModalLine) =>
    Boolean(
      line.sku
      || line.accountingCode
      || line.itemName
      || line.purchasedQty.trim()
      || line.issuedQty.trim()
      || line.usedQty.trim()
      || line.remainingQty.trim()
      || line.unitPrice.trim()
      || getPurchasedAmount(line) > 0
      || getIssuedAmount(line) > 0
      || getRemainingAmount(line) > 0
    );

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = await projectOpeningBalanceService.parseOpeningBalanceImport(file, {
        existingItems: items,
        defaultWarehouseId,
      });
      const nextLines = parsed.rows.map(row => toDraftLine({
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
      setPurchasedValue(formatInitialDraft(parsed.totals.purchasedValue || 0));
      setIssuedValue(formatInitialDraft(parsed.totals.issuedValue || 0));
      setUsedValue(formatInitialDraft(parsed.totals.usedValue || parsed.totals.issuedValue || 0));
      setImportMessages({ errors: parsed.errors, warnings: parsed.warnings });
      toast.success('Đã đọc file đầu kỳ', `${validLines.length} dòng vật tư được đưa vào bảng rà soát.`);
    } catch (error: any) {
      logApiError('ProjectOpeningBalanceModal.import', error);
      toast.error('Không đọc được file đầu kỳ', getApiErrorMessage(error, 'Vui lòng kiểm tra định dạng Excel.'));
    }
  };

  const prepareLockInput = (): PreparedLockInput => {
    if (!constructionSiteId) return { ok: false, error: 'Dự án cần liên kết công trường trước khi nhập đầu kỳ.' };
    if (!asOfDate) return { ok: false, error: 'Thiếu ngày chốt đầu kỳ.' };

    const parseField = (
      draft: string,
      policy: DecimalPolicy,
      label: string,
      allowEmpty = true,
    ): { ok: true; value: number } | { ok: false; error: string } => {
      const result = inspectLocalizedNumberDraft(draft, policy, { allowEmpty });
      if (result.ok === false) {
        return { ok: false, error: `${label}: ${localizedNumberValidationMessage(result)}` };
      }
      return { ok: true, value: result.value ?? 0 };
    };

    const parsedContractValue = parseField(contractValue, VND_TOTAL_POLICY, 'Tổng giá trị dự án', false);
    if (parsedContractValue.ok === false) return parsedContractValue;
    if (parsedContractValue.value <= 0) {
      return { ok: false, error: 'Tổng giá trị dự án phải lớn hơn 0.' };
    }
    const parsedConstructionProgress = parseField(
      constructionProgress,
      PERCENT_POLICY,
      'Tiến độ thi công',
    );
    if (parsedConstructionProgress.ok === false) return parsedConstructionProgress;
    const parsedPurchasedValue = parseField(purchasedValue, VND_TOTAL_POLICY, 'Giá trị vật tư đã mua');
    if (parsedPurchasedValue.ok === false) return parsedPurchasedValue;
    const parsedIssuedValue = parseField(issuedValue, VND_TOTAL_POLICY, 'Giá trị đã xuất/cấp');
    if (parsedIssuedValue.ok === false) return parsedIssuedValue;
    const parsedUsedValue = parseField(usedValue, VND_TOTAL_POLICY, 'Giá trị đã sử dụng');
    if (parsedUsedValue.ok === false) return parsedUsedValue;

    const warehouseIds = new Set(warehouses.map(warehouse => warehouse.id));
    const activeLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => hasLineActivity(line));
    if (activeLines.length === 0) {
      return {
        ok: false,
        error: 'Chưa có dòng vật tư đầu kỳ. Vui lòng import Excel kế toán hoặc nhập dòng vật tư trước khi khóa.',
      };
    }

    const preparedLines: ProjectOpeningBalanceLine[] = [];
    for (const { line, index } of activeLines) {
      const rowLabel = `Dòng ${index + 1}`;
      if (!line.sku || !line.itemName || !line.warehouseId) {
        return { ok: false, error: `${rowLabel}: phải đủ mã vật tư, tên vật tư và kho.` };
      }
      if (!warehouseIds.has(line.warehouseId)) {
        return { ok: false, error: `${rowLabel}: kho "${line.warehouseId}" chưa tồn tại trong danh mục kho.` };
      }

      const purchasedQty = parseField(line.purchasedQty, QUANTITY_POLICY, `${rowLabel} - số lượng đã mua`);
      if (purchasedQty.ok === false) return purchasedQty;
      const issuedQty = parseField(line.issuedQty, QUANTITY_POLICY, `${rowLabel} - số lượng đã xuất`);
      if (issuedQty.ok === false) return issuedQty;
      const usedQty = parseField(line.usedQty, QUANTITY_POLICY, `${rowLabel} - số lượng đã dùng`);
      if (usedQty.ok === false) return usedQty;
      const remainingQty = parseField(line.remainingQty, QUANTITY_POLICY, `${rowLabel} - số lượng tồn`);
      if (remainingQty.ok === false) return remainingQty;
      const unitPrice = parseField(line.unitPrice, UNIT_PRICE_POLICY, `${rowLabel} - đơn giá`);
      if (unitPrice.ok === false) return unitPrice;

      preparedLines.push({
        id: line.id,
        openingBalanceId: line.openingBalanceId,
        inventoryItemId: line.inventoryItemId,
        accountingCode: line.accountingCode,
        sku: line.sku,
        itemName: line.itemName,
        unit: line.unit,
        warehouseId: line.warehouseId,
        purchasedQty: purchasedQty.value,
        issuedQty: issuedQty.value,
        usedQty: usedQty.value,
        remainingQty: remainingQty.value,
        unitPrice: unitPrice.value,
        remainingValue: remainingQty.value * unitPrice.value,
        note: line.note,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      });
    }

    return {
      ok: true,
      contractValue: parsedContractValue.value,
      constructionProgress: parsedConstructionProgress.value,
      purchasedValue: parsedPurchasedValue.value,
      issuedValue: parsedIssuedValue.value,
      usedValue: parsedUsedValue.value,
      lines: preparedLines,
    };
  };

  const handleLock = async () => {
    const prepared = prepareLockInput();
    if (prepared.ok === false) {
      toast.warning('Chưa đủ dữ liệu đầu kỳ', prepared.error);
      return;
    }
    setLoading(true);
    try {
      const preparedRecognizedValue = calculateOpeningRecognizedValue(
        prepared.purchasedValue,
        prepared.issuedValue,
        prepared.usedValue,
      );
      const openingBalance: ProjectOpeningBalance = {
        id: existingOpening?.status === 'draft' ? existingOpening.id : undefined,
        scopeKey,
        projectId: project.id,
        constructionSiteId,
        asOfDate,
        contractValue: prepared.contractValue,
        constructionProgressPercent: prepared.constructionProgress,
        purchasedValue: prepared.purchasedValue,
        issuedValue: prepared.issuedValue,
        usedValue: prepared.usedValue,
        recognizedValue: preparedRecognizedValue,
        status: 'draft',
        note: note.trim() || null,
        createdBy: user.id,
      };
      const commandId = getOrCreateProjectOpeningBalanceCommandId(scopeKey, user.id);
      const result = await projectOpeningBalanceService.lockOpeningBalance({
        commandId,
        openingBalance,
        lines: prepared.lines,
        existingItems: items,
        existingFinance: finance,
        actorUserId: user.id,
      });

      // The authoritative atomic RPC has succeeded. From this point onward,
      // derived-cache or UI refresh failures must not be reported as a failed
      // lock or cause a new command to be submitted.
      clearProjectOpeningBalanceCommandId(scopeKey, user.id, commandId);
      setExistingOpening(result.openingBalance);
      toast.success('Đã khóa dữ liệu đầu kỳ', 'Dashboard, tồn kho và tiến độ theo giá trị đã nhận số đầu kỳ.');
      if (result.warnings?.length) {
        toast.warning('Đã khóa, còn dữ liệu dẫn xuất cần đồng bộ', result.warnings.join(' '));
      }

      try {
        await Promise.all([
          refreshWmsRecords({
            itemIds: [
              ...result.createdItems.map(item => item.id),
              ...result.updatedItems.map(item => item.id),
              ...result.stockTransactions.flatMap(tx => (tx.items || []).map(item => item.itemId)),
            ],
            transactionIds: result.stockTransactions.map(tx => tx.id),
          }),
          loadModuleData('da', true),
        ]);
        await onApplied?.(result);
      } catch (postCommitError: any) {
        logApiError('ProjectOpeningBalanceModal.postCommitRefresh', postCommitError);
        toast.warning(
          'Dữ liệu đã được khóa an toàn',
          'Giao diện chưa tải lại đầy đủ. Vui lòng mở lại trang để nhận dữ liệu mới nhất.',
        );
      }
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
  const lockedPurchasedValue = Number(existingOpening?.purchasedValue || 0);
  const lockedIssuedValue = Number(existingOpening?.issuedValue || existingOpening?.usedValue || 0);
  const lockedRecognizedValue = Number(existingOpening?.recognizedValue || 0);
  const lockedStockDocumentCount = (existingOpening?.stockTransactionIds || []).length;
  const lockedLineCount = lines.filter(hasLineActivity).length;
  const lockedRemainingLineCount = lines.filter(
    line => readDraftNumber(line.remainingQty, QUANTITY_POLICY) > 0,
  ).length;

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
                <div><span className="text-emerald-600 font-bold block">Tiến độ thi công</span>{formatViPercent(existingOpening?.constructionProgressPercent || 0)}</div>
                <div><span className="text-emerald-600 font-bold block">Tiến độ theo giá trị</span>{formatViPercent(existingOpening?.contractValue ? Math.round(((existingOpening?.recognizedValue || 0) / existingOpening.contractValue) * 100) : 0)}</div>
              </div>
              <div className="mt-4 pt-4 border-t border-emerald-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div><span className="text-emerald-600 font-bold block">Tổng nhập tham chiếu</span>{fmtFull(lockedPurchasedValue)}</div>
                <div><span className="text-emerald-600 font-bold block">Tổng xuất/đã dùng</span>{fmtFull(lockedIssuedValue)}</div>
                <div><span className="text-emerald-600 font-bold block">Chi phí vật tư ghi nhận</span>{fmtFull(lockedRecognizedValue)}</div>
                <div><span className="text-emerald-600 font-bold block">Chứng từ kho</span>{lockedStockDocumentCount > 0 ? `${lockedStockDocumentCount} chứng từ` : 'Chưa có'}</div>
              </div>
              <div className="mt-3 rounded-xl bg-white/60 px-3 py-2 text-xs font-bold text-emerald-700">
                Dòng vật tư: {lockedLineCount} dòng. Dòng còn tồn: {lockedRemainingLineCount} dòng.
                {lockedStockDocumentCount > 0
                  ? ' Có thể tra chứng từ trong Kho/WMS -> Lịch sử kho / giao dịch kho.'
                  : ' Bản chốt này chưa có chứng từ kho, cần tạo lại dấu vết đầu kỳ.'}
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
                <LocalizedMoneyInput
                  value={contractValue}
                  onDraftChange={(draft) => setContractValue(draft)}
                  allowEmpty={false}
                  min={0}
                  className={inputCls}
                  placeholder="0"
                  aria-label="Tổng giá trị dự án / hợp đồng"
                />
              </div>
              <div>
                <label className={labelCls}>Tiến độ thi công hiện tại (%)</label>
                <LocalizedNumberInput
                  value={constructionProgress}
                  policy={PERCENT_POLICY}
                  onDraftChange={(draft) => setConstructionProgress(draft)}
                  className={inputCls}
                  placeholder="0"
                  aria-label="Tiến độ thi công hiện tại"
                />
              </div>
              <div className="md:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">
                Tiến độ này là số chốt ban đầu. Sau khi triển khai, tab Gantt/tiến độ tuần sẽ tiếp tục cập nhật tiến độ thi công.
              </div>
            </div>
          ) : step === 2 ? (
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Giá trị vật tư đã mua</label>
                <LocalizedMoneyInput
                  value={purchasedValue}
                  onDraftChange={(draft) => setPurchasedValue(draft)}
                  min={0}
                  className={inputCls}
                  placeholder="0"
                  aria-label="Giá trị vật tư đã mua"
                />
              </div>
              <div>
                <label className={labelCls}>Giá trị đã xuất/cấp</label>
                <LocalizedMoneyInput
                  value={issuedValue}
                  onDraftChange={(draft) => setIssuedValue(draft)}
                  min={0}
                  className={inputCls}
                  placeholder="0"
                  aria-label="Giá trị đã xuất/cấp"
                />
              </div>
              <div>
                <label className={labelCls}>Giá trị đã sử dụng</label>
                <LocalizedMoneyInput
                  value={usedValue}
                  onDraftChange={(draft) => setUsedValue(draft)}
                  min={0}
                  className={inputCls}
                  placeholder="0"
                  aria-label="Giá trị đã sử dụng"
                />
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
                  <div className="text-xs font-bold text-slate-400">
                    {lines.filter(hasLineActivity).length} dòng vật tư - {lines.filter(line => readDraftNumber(line.remainingQty, QUANTITY_POLICY) > 0).length} dòng còn tồn - tổng tồn {formatViQuantity(lineTotals.remainingQty)} - {fmtFull(lineTotals.remainingValue)}
                  </div>
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
                            {key === 'unitPrice' ? (
                              <LocalizedMoneyInput
                                value={line[key]}
                                maxFractionDigits={6}
                                min={0}
                                onDraftChange={(draft) => updateLine(index, { [key]: draft } as Partial<ProjectOpeningBalanceModalLine>)}
                                className="w-32 px-2 py-1.5 rounded-lg border border-slate-200 text-right tabular-nums"
                                aria-label={`Dòng ${index + 1} - đơn giá`}
                              />
                            ) : (
                              <LocalizedNumberInput
                                value={line[key]}
                                policy={QUANTITY_POLICY}
                                onDraftChange={(draft) => updateLine(index, { [key]: draft } as Partial<ProjectOpeningBalanceModalLine>)}
                                className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-right tabular-nums"
                                aria-label={`Dòng ${index + 1} - ${key}`}
                              />
                            )}
                          </td>
                        ))}
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(getPurchasedAmount(line))}</td>
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(getIssuedAmount(line))}</td>
                        <td className="p-2 text-right font-black text-slate-700 tabular-nums whitespace-nowrap">{fmtFull(getRemainingAmount(line))}</td>
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
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Giá trị dự án</div><div className="font-black text-slate-800">{fmtFull(contractValuePreview)}</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Tiến độ thi công</div><div className="font-black text-slate-800">{formatViPercent(constructionProgressPreview, 2)}</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Recognized</div><div className="font-black text-slate-800">{fmtFull(recognizedValue)}</div></div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Dòng vật tư import</div><div className="font-black text-slate-800">{lines.filter(hasLineActivity).length} dòng</div></div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-600">
                Dòng còn tồn: <span className="font-black text-slate-900">{lines.filter(line => readDraftNumber(line.remainingQty, QUANTITY_POLICY) > 0).length}</span>. Nếu toàn bộ vật tư đã xuất hết, hệ thống vẫn ghi chi phí đầu kỳ và tạo chứng từ chốt đầu kỳ không làm thay đổi tồn kho.
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800 flex gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                Sau khi khóa, phần mềm sẽ tạo chi phí vật tư đầu kỳ và chứng từ kho đầu kỳ để lưu dấu vết. Không sửa trực tiếp bản đã khóa.
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
