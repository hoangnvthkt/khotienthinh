import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import CostNormImportWizard from '../../components/costNorm/CostNormImportWizard';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import {
  CostNormComponentRecord,
  CostNormImportJobRecord,
  CostNormLibraryDetails,
  CostNormLibraryRecord,
  g8CostNormImportService,
} from '../../lib/costNorm/costNormImportService';
import { buildSearchText, resourceTypeLabel } from '../../lib/costNorm/import/normalize';
import { CostNormResourceType } from '../../lib/costNorm/import/types';

interface SettingsG8CostNormLibraryProps {
  actorId?: string | null;
}

const RESOURCE_TYPES: CostNormResourceType[] = ['material', 'labor', 'machine', 'adjustment', 'other'];
const FIELD = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-sky-300';
const CELL_FIELD = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-sky-300';
const ICON_BTN = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50';

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const statusClass = (status?: string) => {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'archived') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const normalizeQuery = (value: string) => value.trim().toLowerCase();

const componentMatches = (component: CostNormComponentRecord, query: string) => [
  component.rawResourceCode,
  component.rawResourceName,
  component.unit,
  component.resource?.code,
  component.resource?.name,
].some(value => String(value || '').toLowerCase().includes(query));

const SettingsG8CostNormLibrary: React.FC<SettingsG8CostNormLibraryProps> = ({ actorId }) => {
  const toast = useToast();
  const [libraries, setLibraries] = useState<CostNormLibraryRecord[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [details, setDetails] = useState<CostNormLibraryDetails | null>(null);
  const [query, setQuery] = useState('');
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [libraryForm, setLibraryForm] = useState({
    name: '',
    code: '',
    source: 'G8',
    version: '',
    region: '',
    decisionNo: '',
    effectiveDate: '',
    status: 'draft' as CostNormLibraryRecord['status'],
    description: '',
  });

  const loadLibraries = async (preferredLibraryId?: string) => {
    setLoadingLibraries(true);
    try {
      const rows = await g8CostNormImportService.listLibraries(100);
      setLibraries(rows);
      setSelectedLibraryId(prev => {
        const next = preferredLibraryId || (rows.some(row => row.id === prev) ? prev : rows[0]?.id || '');
        return next || '';
      });
    } catch (error) {
      logApiError('settings-g8.listLibraries', error);
      toast.error('Không thể tải thư viện G8', getApiErrorMessage(error));
    } finally {
      setLoadingLibraries(false);
    }
  };

  const loadDetails = async (libraryId: string) => {
    if (!libraryId) {
      setDetails(null);
      return;
    }
    setLoadingDetails(true);
    try {
      const nextDetails = await g8CostNormImportService.getLibraryDetails(libraryId);
      setDetails(nextDetails);
    } catch (error) {
      logApiError('settings-g8.getLibraryDetails', error);
      toast.error('Không thể tải chi tiết G8', getApiErrorMessage(error));
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    void loadLibraries();
  }, []);

  useEffect(() => {
    void loadDetails(selectedLibraryId);
  }, [selectedLibraryId]);

  useEffect(() => {
    if (!details?.library) return;
    setLibraryForm({
      name: details.library.name || '',
      code: details.library.code || '',
      source: details.library.source || 'G8',
      version: details.library.version || '',
      region: details.library.region || '',
      decisionNo: details.library.decisionNo || '',
      effectiveDate: details.library.effectiveDate || '',
      status: details.library.status || 'draft',
      description: details.library.description || '',
    });
  }, [details?.library.id]);

  const selectedLibrary = details?.library || libraries.find(row => row.id === selectedLibraryId) || null;
  const searchQuery = normalizeQuery(query);
  const filteredItems = useMemo(() => {
    if (!details) return [];
    if (!searchQuery) return details.items;
    return details.items.filter(item => [
      item.code,
      item.name,
      item.unit,
      item.searchText,
    ].some(value => String(value || '').toLowerCase().includes(searchQuery))
      || item.components.some(component => componentMatches(component, searchQuery)));
  }, [details, searchQuery]);

  const totals = useMemo(() => {
    const components = details?.items.flatMap(item => item.components) || [];
    return {
      items: details?.items.length || 0,
      components: components.length,
      material: components.filter(row => row.resourceType === 'material').length,
      labor: components.filter(row => row.resourceType === 'labor').length,
      machine: components.filter(row => row.resourceType === 'machine').length,
      warnings: details?.importErrors.filter(row => row.severity === 'warning').length || 0,
    };
  }, [details]);

  const handleStatusChange = async (status: CostNormLibraryRecord['status']) => {
    if (!selectedLibraryId || !status) return;
    setStatusSaving(true);
    try {
      const updated = await g8CostNormImportService.updateLibraryStatus(selectedLibraryId, status, actorId);
      setLibraries(prev => prev.map(row => row.id === updated.id ? updated : row));
      setDetails(prev => prev ? { ...prev, library: updated } : prev);
      setLibraryForm(prev => ({ ...prev, status: updated.status }));
      toast.success('Đã cập nhật trạng thái', `${updated.code} chuyển sang ${statusLabel[updated.status || 'draft']}.`);
    } catch (error) {
      logApiError('settings-g8.updateStatus', error);
      toast.error('Không thể cập nhật trạng thái', getApiErrorMessage(error));
    } finally {
      setStatusSaving(false);
    }
  };

  const saveLibraryMetadata = async () => {
    if (!selectedLibraryId) return;
    setSavingMetadata(true);
    try {
      const updated = await g8CostNormImportService.updateLibraryMetadata(selectedLibraryId, libraryForm, actorId);
      setLibraries(prev => prev.map(row => row.id === updated.id ? updated : row));
      setDetails(prev => prev ? { ...prev, library: updated } : prev);
      toast.success('Đã lưu metadata G8', updated.code);
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.saveMetadata', error);
      toast.error('Không thể lưu metadata', getApiErrorMessage(error));
    } finally {
      setSavingMetadata(false);
    }
  };

  const updateLocalItem = (itemId: string, patch: Record<string, any>) => {
    setDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(item => item.id === itemId
          ? {
            ...item,
            ...patch,
            searchText: buildSearchText(patch.code ?? item.code, patch.name ?? item.name, patch.unit ?? item.unit),
          }
          : item),
      };
    });
  };

  const updateLocalComponent = (componentId: string, patch: Record<string, any>) => {
    setDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(item => ({
          ...item,
          components: item.components.map(component => component.id === componentId
            ? {
              ...component,
              ...patch,
              isAdjustment: (patch.resourceType ?? component.resourceType) === 'adjustment',
            }
            : component),
        })),
      };
    });
  };

  const saveItem = async (itemId: string) => {
    const item = details?.items.find(row => row.id === itemId);
    if (!item) return;
    setBusyId(`item-save-${itemId}`);
    try {
      await g8CostNormImportService.updateNormItem(itemId, { code: item.code, name: item.name, unit: item.unit }, actorId);
      toast.success('Đã lưu công tác', item.code);
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.saveItem', error);
      toast.error('Không thể lưu công tác', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  const addItem = async () => {
    if (!selectedLibraryId) return;
    const code = `NEW.${Date.now().toString().slice(-6)}`;
    setBusyId('item-add');
    try {
      await g8CostNormImportService.createNormItem(selectedLibraryId, { code, name: 'Công tác mới', unit: '' }, actorId);
      toast.success('Đã thêm công tác', code);
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.addItem', error);
      toast.error('Không thể thêm công tác', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  const deleteItem = async (itemId: string) => {
    const item = details?.items.find(row => row.id === itemId);
    if (!item || !window.confirm(`Xoá công tác ${item.code} khỏi thư viện?`)) return;
    setBusyId(`item-delete-${itemId}`);
    try {
      await g8CostNormImportService.deleteNormItem(itemId, actorId);
      toast.success('Đã xoá công tác', item.code);
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.deleteItem', error);
      toast.error('Không thể xoá công tác', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  const saveComponent = async (componentId: string) => {
    const component = details?.items.flatMap(item => item.components).find(row => row.id === componentId);
    if (!component) return;
    setBusyId(`component-save-${componentId}`);
    try {
      await g8CostNormImportService.updateComponent(componentId, {
        resourceType: component.resourceType,
        rawResourceCode: component.rawResourceCode,
        rawResourceName: component.rawResourceName,
        unit: component.unit,
        coefficient: component.coefficient,
        note: component.note,
        lineIndex: component.lineIndex,
      }, actorId);
      toast.success('Đã lưu hao phí', component.rawResourceCode || component.rawResourceName);
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.saveComponent', error);
      toast.error('Không thể lưu hao phí', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  const addComponent = async (itemId: string, resourceType: CostNormResourceType = 'material') => {
    setBusyId(`component-add-${itemId}`);
    try {
      await g8CostNormImportService.createComponent(itemId, {
        resourceType,
        rawResourceName: 'Nguồn lực mới',
        unit: '',
        coefficient: null,
      }, actorId);
      toast.success('Đã thêm hao phí', resourceTypeLabel(resourceType));
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.addComponent', error);
      toast.error('Không thể thêm hao phí', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  const deleteComponent = async (componentId: string) => {
    if (!window.confirm('Xoá dòng hao phí này khỏi công tác?')) return;
    setBusyId(`component-delete-${componentId}`);
    try {
      await g8CostNormImportService.deleteComponent(componentId, actorId);
      toast.success('Đã xoá hao phí', '');
      void loadDetails(selectedLibraryId);
    } catch (error) {
      logApiError('settings-g8.deleteComponent', error);
      toast.error('Không thể xoá hao phí', getApiErrorMessage(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="animate-in slide-in-from-right-4 space-y-4 duration-300">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Database size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Định mức G8</h2>
              <div className="text-xs font-bold text-slate-400">Metadata, dữ liệu gốc và lịch sử import</div>
            </div>
          </div>
          <button
            onClick={() => loadLibraries(selectedLibraryId)}
            disabled={loadingLibraries}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingLibraries ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Tải lại
          </button>
        </div>
      </div>

      <CostNormImportWizard
        canManage
        actorId={actorId}
        onCommitted={(result) => {
          void loadLibraries(result.libraryId);
        }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="text-xs font-black uppercase text-slate-400">Thư viện</div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{libraries.length}</span>
          </div>
          <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
            {loadingLibraries && libraries.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Đang tải
              </div>
            ) : libraries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs font-bold text-slate-400">
                Chưa có thư viện G8
              </div>
            ) : libraries.map(library => (
              <button
                key={library.id}
                onClick={() => setSelectedLibraryId(library.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selectedLibraryId === library.id
                    ? 'border-sky-200 bg-sky-50'
                    : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-800">{library.name}</div>
                    <div className="mt-1 truncate font-mono text-[11px] font-bold text-slate-400">{library.code}</div>
                  </div>
                  <StatusBadge status={library.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-black uppercase text-slate-400">
                  {library.version && <span>{library.version}</span>}
                  {library.region && <span>{library.region}</span>}
                  <span>{formatDateTime(library.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {!selectedLibrary ? (
            <EmptyState />
          ) : loadingDetails ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm font-bold text-slate-400 shadow-sm">
              <Loader2 size={22} className="mx-auto mb-2 animate-spin" /> Đang tải chi tiết
            </div>
          ) : details ? (
            <>
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-xl font-black text-slate-800">{details.library.name}</h3>
                      <StatusBadge status={details.library.status} />
                    </div>
                    <div className="mt-1 font-mono text-xs font-bold text-slate-400">{details.library.code}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusSaving && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    <select
                      value={details.library.status || 'draft'}
                      onChange={event => handleStatusChange(event.target.value as CostNormLibraryRecord['status'])}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                    <button
                      onClick={saveLibraryMetadata}
                      disabled={savingMetadata}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {savingMetadata ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Lưu metadata
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-3">
                  <input value={libraryForm.name} onChange={event => setLibraryForm(prev => ({ ...prev, name: event.target.value }))} className={FIELD} placeholder="Tên thư viện" />
                  <input value={libraryForm.code} onChange={event => setLibraryForm(prev => ({ ...prev, code: event.target.value.toUpperCase() }))} className={`${FIELD} font-mono`} placeholder="Mã thư viện" />
                  <input value={libraryForm.source} onChange={event => setLibraryForm(prev => ({ ...prev, source: event.target.value }))} className={FIELD} placeholder="Nguồn" />
                  <input value={libraryForm.version || ''} onChange={event => setLibraryForm(prev => ({ ...prev, version: event.target.value }))} className={FIELD} placeholder="Phiên bản" />
                  <input value={libraryForm.region || ''} onChange={event => setLibraryForm(prev => ({ ...prev, region: event.target.value }))} className={FIELD} placeholder="Khu vực" />
                  <input value={libraryForm.decisionNo || ''} onChange={event => setLibraryForm(prev => ({ ...prev, decisionNo: event.target.value }))} className={FIELD} placeholder="Số quyết định" />
                  <input type="date" value={libraryForm.effectiveDate || ''} onChange={event => setLibraryForm(prev => ({ ...prev, effectiveDate: event.target.value }))} className={FIELD} />
                  <input value={libraryForm.description || ''} onChange={event => setLibraryForm(prev => ({ ...prev, description: event.target.value }))} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-sky-300 lg:col-span-2" placeholder="Mô tả" />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
                  <Metric label="Công tác" value={totals.items} />
                  <Metric label="Hao phí" value={totals.components} />
                  <Metric label="Vật liệu" value={totals.material} />
                  <Metric label="Nhân công" value={totals.labor} />
                  <Metric label="Máy" value={totals.machine} />
                  <Metric label="Warning" value={totals.warnings} tone={totals.warnings ? 'amber' : 'slate'} />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="relative">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-sky-300"
                      placeholder="Tìm mã, tên công tác, nguồn lực"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-right text-xs font-black text-slate-500">
                      {filteredItems.length}/{details.items.length} công tác
                    </div>
                    <button
                      onClick={addItem}
                      disabled={busyId === 'item-add'}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {busyId === 'item-add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      Thêm
                    </button>
                  </div>
                </div>

                <div className="max-h-[760px] space-y-3 overflow-y-auto pr-1">
                  {filteredItems.map(item => (
                    <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[140px_minmax(0,1fr)_80px_76px]">
                        <input
                          value={item.code}
                          onChange={event => updateLocalItem(item.id, { code: event.target.value.toUpperCase() })}
                          className={`${CELL_FIELD} font-mono text-sky-700`}
                          placeholder="Mã CT"
                        />
                        <input
                          value={item.name}
                          onChange={event => updateLocalItem(item.id, { name: event.target.value })}
                          className={CELL_FIELD}
                          placeholder="Tên công tác"
                        />
                        <input
                          value={item.unit || ''}
                          onChange={event => updateLocalItem(item.id, { unit: event.target.value })}
                          className={CELL_FIELD}
                          placeholder="ĐVT"
                        />
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => saveItem(item.id)} disabled={busyId === `item-save-${item.id}`} className={ICON_BTN} title="Lưu công tác">
                            {busyId === `item-save-${item.id}` ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          </button>
                          <button onClick={() => deleteItem(item.id)} disabled={busyId === `item-delete-${item.id}`} className={ICON_BTN} title="Xoá công tác">
                            {busyId === `item-delete-${item.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 2xl:grid-cols-3">
                        {RESOURCE_TYPES.map(type => {
                          const rows = item.components.filter(component => component.resourceType === type);
                          if (!rows.length) return null;
                          return (
                            <ResourceGroup
                              key={type}
                              type={type}
                              rows={rows}
                              busyId={busyId}
                              onAdd={() => addComponent(item.id, type)}
                              onChange={updateLocalComponent}
                              onSave={saveComponent}
                              onDelete={deleteComponent}
                            />
                          );
                        })}
                        {item.components.length === 0 && (
                          <button
                            onClick={() => addComponent(item.id)}
                            disabled={busyId === `component-add-${item.id}`}
                            className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-left text-xs font-bold text-slate-400 hover:border-sky-200 hover:text-sky-600 disabled:opacity-50"
                          >
                            {busyId === `component-add-${item.id}` ? 'Đang thêm...' : 'Thêm hao phí'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
                <ImportJobsPanel jobs={details.importJobs} />
                <RawRowsPanel details={details} />
                <ChangeLogsPanel details={details} />
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyState = () => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm">
    <FileSpreadsheet size={28} className="mx-auto mb-3 text-slate-300" />
    <div className="text-sm font-black text-slate-500">Chưa chọn thư viện G8</div>
  </div>
);

const StatusBadge: React.FC<{ status?: string }> = ({ status = 'draft' }) => (
  <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${statusClass(status)}`}>
    {statusLabel[status] || status}
  </span>
);

const Metric: React.FC<{ label: string; value: number | string; tone?: 'slate' | 'amber' }> = ({ label, value, tone = 'slate' }) => (
  <div className={`rounded-xl px-3 py-2 ${tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-800'}`}>
    <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
    <div className="text-lg font-black">{value}</div>
  </div>
);

const ResourceGroup: React.FC<{
  type: CostNormResourceType;
  rows: CostNormComponentRecord[];
  busyId: string;
  onAdd: () => void;
  onChange: (componentId: string, patch: Record<string, any>) => void;
  onSave: (componentId: string) => void;
  onDelete: (componentId: string) => void;
}> = ({ type, rows, busyId, onAdd, onChange, onSave, onDelete }) => (
  <div className="rounded-lg bg-white p-2">
    <div className="mb-1 flex items-center justify-between gap-2">
      <div className="text-[10px] font-black uppercase text-slate-400">{resourceTypeLabel(type)}</div>
      <div className="flex items-center gap-1">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{rows.length}</span>
        <button onClick={onAdd} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sky-600 hover:bg-sky-50" title="Thêm hao phí">
          <Plus size={13} />
        </button>
      </div>
    </div>
    <div className="space-y-1">
      {rows.map(row => (
        <div key={row.id} className="grid grid-cols-[78px_72px_minmax(0,1fr)_48px_62px_56px] gap-1">
          <select
            value={row.resourceType}
            onChange={event => onChange(row.id, { resourceType: event.target.value as CostNormResourceType })}
            className={CELL_FIELD}
          >
            {RESOURCE_TYPES.map(nextType => (
              <option key={nextType} value={nextType}>{resourceTypeLabel(nextType)}</option>
            ))}
          </select>
          <input
            value={row.rawResourceCode || ''}
            onChange={event => onChange(row.id, { rawResourceCode: event.target.value.toUpperCase() })}
            className={`${CELL_FIELD} font-mono`}
            placeholder="Mã"
          />
          <input
            value={row.rawResourceName || ''}
            onChange={event => onChange(row.id, { rawResourceName: event.target.value })}
            className={CELL_FIELD}
            placeholder="Tên"
          />
          <input
            value={row.unit || ''}
            onChange={event => onChange(row.id, { unit: event.target.value })}
            className={CELL_FIELD}
            placeholder="ĐVT"
          />
          <input
            type="number"
            step="any"
            value={row.coefficient ?? ''}
            onChange={event => onChange(row.id, { coefficient: event.target.value === '' ? null : Number(event.target.value) })}
            className={`${CELL_FIELD} text-right`}
            placeholder="ĐM"
          />
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => onSave(row.id)} disabled={busyId === `component-save-${row.id}`} className="inline-flex h-8 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Lưu hao phí">
              {busyId === `component-save-${row.id}` ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            </button>
            <button onClick={() => onDelete(row.id)} disabled={busyId === `component-delete-${row.id}`} className="inline-flex h-8 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" title="Xoá hao phí">
              {busyId === `component-delete-${row.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ImportJobsPanel: React.FC<{ jobs: CostNormImportJobRecord[] }> = ({ jobs }) => (
  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
      <FileSpreadsheet size={16} className="text-sky-600" /> Lịch sử import
    </div>
    <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400">Chưa có job</div>
      ) : jobs.map(job => (
        <div key={job.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-black text-slate-800">{job.fileName}</div>
              <div className="mt-1 font-mono text-[10px] font-bold text-slate-400">{job.fileHash || job.id}</div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${job.status === 'committed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {job.status}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] font-black uppercase text-slate-400">
            <span>{job.totalRows} dòng</span>
            <span>{job.parsedItems} CT</span>
            <span>{job.parsedComponents} HP</span>
            <span>{formatDateTime(job.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const RawRowsPanel: React.FC<{ details: CostNormLibraryDetails }> = ({ details }) => (
  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-black text-slate-800">
        <Database size={16} className="text-sky-600" /> Raw trace
      </div>
      {details.importErrors.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
          <AlertTriangle size={12} /> {details.importErrors.length}
        </span>
      )}
    </div>
    {details.importErrors.length > 0 && (
      <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50 p-2 text-[11px] font-bold text-amber-700">
        {details.importErrors.slice(0, 3).map((row: any) => `D${row.rowNumber || '-'}: ${row.message}`).join(' • ')}
      </div>
    )}
    <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-100">
      {details.rawRows.length === 0 ? (
        <div className="p-4 text-center text-xs font-bold text-slate-400">Chưa có raw rows</div>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase text-slate-400">
            <tr>
              <th className="p-2">Dòng</th>
              <th className="p-2">Loại</th>
              <th className="p-2">Mã</th>
              <th className="p-2">Nội dung</th>
              <th className="p-2">Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {details.rawRows.map(row => (
              <tr key={row.id} className="text-slate-600">
                <td className="p-2 font-mono font-bold">{row.rowNumber}</td>
                <td className="p-2 font-bold">{row.rowType}</td>
                <td className="p-2 font-mono">{row.workItemCode || row.resourceCode || row.parentItemCode || '-'}</td>
                <td className="max-w-[320px] truncate p-2 font-bold">{row.rowText || '-'}</td>
                <td className="p-2">
                  {row.warnings?.length ? (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle size={12} /> {row.warnings.length}
                    </span>
                  ) : (
                    <CheckCircle2 size={12} className="text-emerald-500" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

const ChangeLogsPanel: React.FC<{ details: CostNormLibraryDetails }> = ({ details }) => (
  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
      <Save size={16} className="text-sky-600" /> Lịch sử chỉnh sửa
    </div>
    <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
      {details.changeLogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400">Chưa có chỉnh sửa thủ công</div>
      ) : details.changeLogs.map(log => (
        <div key={log.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-black text-slate-800">{log.action}</div>
              <div className="mt-1 font-mono text-[10px] font-bold text-slate-400">
                {log.normItemId || log.componentId || details.library.code}
              </div>
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-400">
              {formatDateTime(log.createdAt)}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default SettingsG8CostNormLibrary;
