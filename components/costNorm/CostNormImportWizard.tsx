import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { g8CostNormImportService } from '../../lib/costNorm/costNormImportService';
import { buildSearchText, resourceTypeLabel } from '../../lib/costNorm/import/normalize';
import {
  CostNormImportCommitResult,
  CostNormLibraryMetadata,
  CostNormResourceType,
  G8ColumnMapping,
  G8ParseResult,
  ParsedNormComponent,
  ParsedNormItem,
} from '../../lib/costNorm/import/types';

const BTN_SOFT = 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';
const BTN_PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50';
const FIELD = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';
const MINI_FIELD = 'w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';
const CELL_FIELD = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';
const ICON_BTN = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';

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

const createDraftId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cloneItems = (items: ParsedNormItem[]) => items.map(item => ({
  ...item,
  warnings: [...item.warnings],
  rawData: { ...item.rawData },
  components: item.components.map(component => ({
    ...component,
    warnings: [...component.warnings],
    rawData: { ...component.rawData },
  })),
}));

const withReindexedComponents = (item: ParsedNormItem): ParsedNormItem => ({
  ...item,
  components: item.components.map((component, index) => ({ ...component, lineIndex: index })),
  sourceRowEnd: item.components.reduce((max, component) => Math.max(max, component.sourceRowNumber || max), item.sourceRowStart),
});

const computeDraftStats = (items: ParsedNormItem[]) => ({
  parsedItems: items.length,
  parsedComponents: items.reduce((sum, item) => sum + item.components.length, 0),
});

const markEdited = (rawData: Record<string, unknown>, actorId?: string | null) => ({
  ...rawData,
  editedInPreview: true,
  editedBy: actorId || null,
  editedAt: new Date().toISOString(),
});

const draftValidation = (items: ParsedNormItem[]) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const codes = new Map<string, number>();
  items.forEach(item => {
    const code = item.code.trim().toUpperCase();
    if (!code) errors.push('Có công tác thiếu mã.');
    if (!item.name.trim()) errors.push(`${code || 'Công tác'} thiếu tên.`);
    if (!item.unit.trim()) warnings.push(`${code || item.name || 'Công tác'} thiếu đơn vị.`);
    if (code) codes.set(code, (codes.get(code) || 0) + 1);
    item.components.forEach(component => {
      const label = `${code || item.name || 'Công tác'}/${component.resourceCode || component.resourceName || component.lineIndex + 1}`;
      if (!component.resourceCode.trim() && !component.resourceName.trim()) errors.push(`${label} thiếu mã hoặc tên nguồn lực.`);
      if (!component.unit.trim()) warnings.push(`${label} thiếu đơn vị.`);
      if (component.coefficient === null || component.coefficient === undefined) warnings.push(`${label} thiếu định mức.`);
    });
  });
  Array.from(codes.entries()).forEach(([code, count]) => {
    if (count > 1) errors.push(`Trùng mã công tác ${code}.`);
  });
  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
};

const buildDraftSearchText = (code: string, name: string, unit: string) => buildSearchText(code, name, unit);

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
  const validation = useMemo(() => draftValidation(parseResult?.items || []), [parseResult]);

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
      setParseResult({
        ...result,
        items: cloneItems(result.items),
      });
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
    if (validation.errors.length > 0) {
      toast.error('Dữ liệu preview chưa hợp lệ', validation.errors.slice(0, 3).join(' • '));
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

  const setDraftItems = (updater: (items: ParsedNormItem[]) => ParsedNormItem[]) => {
    setParseResult(prev => {
      if (!prev) return prev;
      const items = updater(cloneItems(prev.items)).map(withReindexedComponents);
      const stats = computeDraftStats(items);
      return {
        ...prev,
        ...stats,
        items,
      };
    });
  };

  const updateDraftItem = (itemId: string, patch: Partial<Pick<ParsedNormItem, 'code' | 'name' | 'unit'>>) => {
    setDraftItems(items => items.map(item => item.id === itemId
      ? {
        ...item,
        ...patch,
        code: patch.code !== undefined ? patch.code.toUpperCase() : item.code,
        searchText: buildDraftSearchText(patch.code ?? item.code, patch.name ?? item.name, patch.unit ?? item.unit),
        rawData: markEdited(item.rawData, actorId),
      }
      : item));
  };

  const deleteDraftItem = (itemId: string) => {
    if (!window.confirm('Xoá công tác này khỏi preview import?')) return;
    setDraftItems(items => items.filter(item => item.id !== itemId));
  };

  const addDraftItem = () => {
    setDraftItems(items => {
      const code = `NEW.${Date.now().toString().slice(-6)}`;
      const item: ParsedNormItem = {
        id: createDraftId('preview-item'),
        code,
        name: 'Công tác mới',
        unit: '',
        sourceSheetName: parseResult?.sheetName || 'manual',
        sourceRowStart: parseResult?.totalRows || 0,
        sourceRowEnd: parseResult?.totalRows || 0,
        searchText: buildDraftSearchText(code, 'Công tác mới', ''),
        rawData: {
          source: 'g8_preview_manual_add',
          editedBy: actorId || null,
          editedAt: new Date().toISOString(),
        },
        confidenceScore: 0.5,
        warnings: ['Công tác thêm thủ công trong preview.'],
        components: [],
      };
      return [...items, item];
    });
  };

  const updateDraftComponent = (
    itemId: string,
    componentId: string,
    patch: Partial<Pick<ParsedNormComponent, 'resourceCode' | 'resourceName' | 'resourceType' | 'unit' | 'coefficient' | 'note'>>,
  ) => {
    setDraftItems(items => items.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        components: item.components.map(component => component.id === componentId
          ? {
            ...component,
            ...patch,
            resourceCode: patch.resourceCode !== undefined ? patch.resourceCode.toUpperCase() : component.resourceCode,
            isAdjustment: (patch.resourceType ?? component.resourceType) === 'adjustment',
            rawData: markEdited(component.rawData, actorId),
          }
          : component),
      };
    }));
  };

  const deleteDraftComponent = (itemId: string, componentId: string) => {
    setDraftItems(items => items.map(item => item.id === itemId
      ? { ...item, components: item.components.filter(component => component.id !== componentId) }
      : item));
  };

  const addDraftComponent = (itemId: string, resourceType: CostNormResourceType = 'material') => {
    setDraftItems(items => items.map(item => {
      if (item.id !== itemId) return item;
      const component: ParsedNormComponent = {
        id: createDraftId(`${item.id}-component`),
        itemCode: item.code,
        resourceCode: '',
        resourceName: '',
        resourceType,
        unit: '',
        coefficient: null,
        lineIndex: item.components.length,
        sourceSheetName: item.sourceSheetName,
        sourceRowNumber: item.sourceRowEnd,
        isAdjustment: resourceType === 'adjustment',
        note: '',
        rawData: {
          source: 'g8_preview_manual_add',
          editedBy: actorId || null,
          editedAt: new Date().toISOString(),
        },
        confidenceScore: 0.5,
        warnings: ['Dòng hao phí thêm thủ công trong preview.'],
      };
      return { ...item, components: [...item.components, component] };
    }));
  };

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

          <div className="flex justify-end">
            <button type="button" onClick={addDraftItem} className={BTN_SOFT}>
              <Plus size={14} /> Thêm công tác
            </button>
          </div>

          {parseResult.issues.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
              <AlertTriangle size={14} className="mr-1 inline" />
              {parseResult.issues.slice(0, 5).map(issue => `D${issue.rowNumber}: ${issue.message}`).join(' • ')}
            </div>
          )}

          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className={`rounded-xl border p-3 text-xs font-bold ${validation.errors.length ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <AlertTriangle size={14} className="mr-1 inline" />
              {[...validation.errors, ...validation.warnings].slice(0, 8).join(' • ')}
            </div>
          )}

          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {parseResult.items.map(item => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-[140px_minmax(0,1fr)_90px_88px]">
                  <input
                    value={item.code}
                    onChange={event => updateDraftItem(item.id, { code: event.target.value })}
                    className={`${CELL_FIELD} font-mono text-indigo-700`}
                    placeholder="Mã CT"
                  />
                  <input
                    value={item.name}
                    onChange={event => updateDraftItem(item.id, { name: event.target.value })}
                    className={CELL_FIELD}
                    placeholder="Tên công tác"
                  />
                  <input
                    value={item.unit}
                    onChange={event => updateDraftItem(item.id, { unit: event.target.value })}
                    className={CELL_FIELD}
                    placeholder="ĐVT"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => addDraftComponent(item.id)} className={ICON_BTN} title="Thêm hao phí">
                      <Plus size={14} />
                    </button>
                    <button type="button" onClick={() => deleteDraftItem(item.id)} className={ICON_BTN} title="Xoá công tác">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-3">
                  {groupedTypes.map(type => {
                    const rows = item.components.filter(component => component.resourceType === type);
                    if (!rows.length) return null;
                    return (
                      <div key={type} className="rounded-lg bg-white p-2 dark:bg-slate-900">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[10px] font-black uppercase text-slate-400">{resourceTypeLabel(type)}</div>
                          <button type="button" onClick={() => addDraftComponent(item.id, type)} className="text-[10px] font-black text-indigo-600 hover:text-indigo-700">
                            Thêm
                          </button>
                        </div>
                        <div className="space-y-1">
                          {rows.map(row => (
                            <div key={row.id} className="grid grid-cols-[78px_72px_minmax(0,1fr)_48px_62px_28px] gap-1">
                              <select
                                value={row.resourceType}
                                onChange={event => updateDraftComponent(item.id, row.id, { resourceType: event.target.value as CostNormResourceType })}
                                className={CELL_FIELD}
                              >
                                {groupedTypes.map(nextType => (
                                  <option key={nextType} value={nextType}>{resourceTypeLabel(nextType)}</option>
                                ))}
                              </select>
                              <input
                                value={row.resourceCode}
                                onChange={event => updateDraftComponent(item.id, row.id, { resourceCode: event.target.value })}
                                className={`${CELL_FIELD} font-mono`}
                                placeholder="Mã"
                              />
                              <input
                                value={row.resourceName}
                                onChange={event => updateDraftComponent(item.id, row.id, { resourceName: event.target.value })}
                                className={CELL_FIELD}
                                placeholder="Tên"
                              />
                              <input
                                value={row.unit}
                                onChange={event => updateDraftComponent(item.id, row.id, { unit: event.target.value })}
                                className={CELL_FIELD}
                                placeholder="ĐVT"
                              />
                              <input
                                type="number"
                                step="any"
                                value={row.coefficient ?? ''}
                                onChange={event => updateDraftComponent(item.id, row.id, { coefficient: event.target.value === '' ? null : Number(event.target.value) })}
                                className={`${CELL_FIELD} text-right`}
                                placeholder="ĐM"
                              />
                              <button type="button" onClick={() => deleteDraftComponent(item.id, row.id)} className="inline-flex h-8 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" title="Xoá hao phí">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {item.components.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                      Chưa có hao phí. Bấm nút thêm để bổ sung.
                    </div>
                  )}
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
