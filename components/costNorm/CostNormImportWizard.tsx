import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Save, Upload } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { g8CostNormImportService } from '../../lib/costNorm/costNormImportService';
import { resourceTypeLabel } from '../../lib/costNorm/import/normalize';
import {
  CostNormImportCommitResult,
  CostNormLibraryMetadata,
  CostNormResourceType,
  G8ColumnMapping,
  G8ParseResult,
} from '../../lib/costNorm/import/types';

const BTN_SOFT = 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';
const BTN_PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50';
const FIELD = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';
const MINI_FIELD = 'w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';

interface CostNormImportWizardProps {
  canManage: boolean;
  actorId?: string | null;
  onCommitted?: (result: CostNormImportCommitResult) => void;
}

const normalizeCode = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const emptyMetadata = (): CostNormLibraryMetadata => ({
  name: '',
  code: '',
  source: 'G8',
  version: '',
  region: '',
  decisionNo: '',
  effectiveDate: '',
  status: 'draft',
  description: '',
});

const updateMappingValue = (mapping: G8ColumnMapping, key: keyof G8ColumnMapping, value: string): G8ColumnMapping => ({
  ...mapping,
  [key]: Math.max(0, Number(value || 0)),
});

const groupedTypes: CostNormResourceType[] = ['material', 'labor', 'machine', 'adjustment', 'other'];

const CostNormImportWizard: React.FC<CostNormImportWizardProps> = ({ canManage, actorId, onCommitted }) => {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<CostNormLibraryMetadata>(emptyMetadata);
  const [parseResult, setParseResult] = useState<G8ParseResult | null>(null);
  const [mapping, setMapping] = useState<G8ColumnMapping | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CostNormImportCommitResult | null>(null);

  const totals = useMemo(() => ({
    material: parseResult?.items.reduce((sum, item) => sum + item.components.filter(row => row.resourceType === 'material').length, 0) || 0,
    labor: parseResult?.items.reduce((sum, item) => sum + item.components.filter(row => row.resourceType === 'labor').length, 0) || 0,
    machine: parseResult?.items.reduce((sum, item) => sum + item.components.filter(row => row.resourceType === 'machine').length, 0) || 0,
  }), [parseResult]);

  if (!canManage) return null;

  const setMeta = (patch: Partial<CostNormLibraryMetadata>) => setMetadata(prev => ({ ...prev, ...patch }));

  const chooseFile = (nextFile?: File | null) => {
    if (!nextFile) return;
    setFile(nextFile);
    setParseResult(null);
    setCommitResult(null);
    setStep(1);
    const baseName = nextFile.name.replace(/\.[^.]+$/, '');
    setMetadata(prev => ({
      ...prev,
      name: prev.name || baseName,
      code: prev.code || normalizeCode(baseName || `G8_${Date.now()}`),
    }));
  };

  const analyze = async (sheetName?: string, overrideMapping?: G8ColumnMapping | null) => {
    if (!file) {
      toast.warning('Chưa chọn file', 'Vui lòng chọn file Excel G8 trước khi phân tích.');
      return;
    }
    setAnalyzing(true);
    try {
      const result = await g8CostNormImportService.parseImportFile(file, {
        sheetName: sheetName || parseResult?.sheetName,
        columnMapping: overrideMapping || mapping || undefined,
      });
      setParseResult(result);
      setMapping(result.columnMapping);
      setStep(result.items.length > 0 ? 3 : 2);
      toast.info('Đã phân tích G8', `${result.parsedItems} công tác, ${result.parsedComponents} dòng hao phí.`);
    } catch (error) {
      logApiError('cost-norm-g8.analyze', error);
      toast.error('Không thể đọc file G8', getApiErrorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const commit = async () => {
    if (!file || !parseResult) return;
    if (!metadata.name.trim() || !metadata.code.trim()) {
      toast.warning('Thiếu thư viện', 'Vui lòng nhập tên và mã thư viện.');
      return;
    }
    setCommitting(true);
    try {
      const result = await g8CostNormImportService.commitParsedCostNormLibrary({
        metadata,
        parseResult,
        file,
        actorId,
      });
      setCommitResult(result);
      setStep(4);
      onCommitted?.(result);
      toast.success('Đã import thư viện G8', `${result.itemCount} công tác, ${result.componentCount} dòng hao phí.`);
    } catch (error) {
      logApiError('cost-norm-g8.commit', error);
      toast.error('Không thể commit thư viện G8', getApiErrorMessage(error));
    } finally {
      setCommitting(false);
    }
  };

  const mappingValue = mapping || parseResult?.columnMapping;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase text-emerald-600">G8 Excel Cost Norm Import</div>
          <h2 className="text-sm font-black text-slate-800 dark:text-white">Import thư viện định mức G8</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase text-slate-400">
            {(['Upload', 'Analyze', 'Preview', 'Commit'] as const).map((label, index) => (
              <span key={label} className={`rounded-full px-2 py-1 ${step === index + 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                {index + 1}. {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={BTN_SOFT}>
            <Upload size={14} /> Chọn G8 Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />
          </label>
          <button onClick={() => analyze()} disabled={analyzing || !file} className={BTN_PRIMARY}>
            {analyzing ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Phân tích
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <input value={metadata.name} onChange={event => setMeta({ name: event.target.value })} className={FIELD} placeholder="Tên thư viện" />
        <input value={metadata.code} onChange={event => setMeta({ code: normalizeCode(event.target.value) })} className={`${FIELD} font-mono`} placeholder="Mã thư viện" />
        <input value={metadata.version || ''} onChange={event => setMeta({ version: event.target.value })} className={FIELD} placeholder="Phiên bản" />
        <input value={metadata.region || ''} onChange={event => setMeta({ region: event.target.value })} className={FIELD} placeholder="Khu vực" />
        <input value={metadata.decisionNo || ''} onChange={event => setMeta({ decisionNo: event.target.value })} className={FIELD} placeholder="Số quyết định" />
        <input type="date" value={metadata.effectiveDate || ''} onChange={event => setMeta({ effectiveDate: event.target.value })} className={FIELD} />
      </div>

      {file && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 dark:bg-slate-800">
          {file.name} • {(file.size / 1024 / 1024).toFixed(2)} MB
        </div>
      )}

      {parseResult && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]">
            <select value={parseResult.sheetName} onChange={event => analyze(event.target.value, mappingValue || null)} className={FIELD}>
              {parseResult.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
            </select>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 dark:bg-slate-800">
              Header dòng {parseResult.detectedHeaderRow || '-'} • confidence {Math.round(parseResult.confidenceScore * 100)}% • {parseResult.totalRows} dòng raw
            </div>
          </div>

          {mappingValue && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              {([
                ['itemCodeCol', 'Mã CT'],
                ['resourceCodeCol', 'Mã NL'],
                ['nameCol', 'Tên'],
                ['unitCol', 'ĐVT'],
                ['coefficientCol', 'Định mức'],
              ] as Array<[keyof G8ColumnMapping, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
                  {label}
                  <input
                    type="number"
                    min={0}
                    value={mappingValue[key]}
                    onChange={event => setMapping(updateMappingValue(mappingValue, key, event.target.value))}
                    className={MINI_FIELD}
                  />
                </label>
              ))}
              <button onClick={() => analyze(parseResult.sheetName, mappingValue)} disabled={analyzing} className={BTN_SOFT}>
                <RefreshCw size={14} /> Cập nhật mapping
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Metric label="Công tác" value={parseResult.parsedItems} />
            <Metric label="Hao phí" value={parseResult.parsedComponents} />
            <Metric label="Vật liệu" value={totals.material} />
            <Metric label="Nhân công" value={totals.labor} />
            <Metric label="Máy" value={totals.machine} />
          </div>

          {parseResult.issues.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} className="mr-1 inline" />
              {parseResult.issues.slice(0, 5).map(issue => `D${issue.rowNumber}: ${issue.message}`).join(' • ')}
            </div>
          )}

          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {parseResult.items.map(item => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-[140px_minmax(0,1fr)_80px_100px]">
                  <div className="font-mono text-xs font-black text-indigo-700">{item.code}</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-100">{item.name || '-'}</div>
                  <div className="text-xs font-bold text-slate-500">{item.unit || '-'}</div>
                  <div className="text-right text-[10px] font-black uppercase text-slate-400">{item.components.length} dòng</div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-3">
                  {groupedTypes.map(type => {
                    const rows = item.components.filter(component => component.resourceType === type);
                    if (!rows.length) return null;
                    return (
                      <div key={type} className="rounded-lg bg-white p-2 dark:bg-slate-900">
                        <div className="mb-1 text-[10px] font-black uppercase text-slate-400">{resourceTypeLabel(type)}</div>
                        <div className="space-y-1">
                          {rows.map(row => (
                            <div key={row.id} className="grid grid-cols-[90px_minmax(0,1fr)_55px_70px] gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                              <span className="font-mono">{row.resourceCode || '-'}</span>
                              <span className="truncate">{row.resourceName}</span>
                              <span>{row.unit || '-'}</span>
                              <span className="text-right">{row.coefficient ?? '-'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button onClick={commit} disabled={committing || !parseResult.items.length} className={BTN_PRIMARY}>
              {committing ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Commit thư viện G8
            </button>
          </div>
        </div>
      )}

      {commitResult && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
          <CheckCircle2 size={14} className="mr-1 inline" />
          Library {commitResult.libraryId.slice(0, 8)} • Job {commitResult.importJobId.slice(0, 8)} • {commitResult.itemCount} công tác • {commitResult.componentCount} hao phí
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
    <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
    <div className="text-lg font-black text-slate-800 dark:text-white">{value}</div>
  </div>
);

export default CostNormImportWizard;
