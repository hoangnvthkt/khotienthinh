import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { File, FilePlus2, Loader2, Paperclip, Save, Trash2, Upload, X } from 'lucide-react';
import { ContractAppendix, ContractAttachment, ContractItemType, ContractVariation } from '../../types';
import { contractAppendixService } from '../../lib/hdService';
import { variationService } from '../../lib/variationService';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string | null;
  constructionSiteId?: string | null;
}

const emptyAppendix = (
  contractId: string,
  contractType: ContractItemType,
  projectId?: string | null,
  constructionSiteId?: string | null,
): ContractAppendix => ({
  id: crypto.randomUUID(),
  contractId,
  contractType,
  projectId: projectId || null,
  constructionSiteId: constructionSiteId || null,
  appendixNumber: '',
  name: '',
  signedDate: new Date().toISOString().slice(0, 10),
  value: 0,
  status: 'draft',
  variationIds: [],
  attachments: [],
  note: '',
});

const sanitizeFileName = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));

const ContractAppendixPanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu phụ lục',
    fallbackError: 'Không thể lưu phụ lục hợp đồng.',
    logScope: 'contractAppendix.save',
  });
  const [items, setItems] = useState<ContractAppendix[]>([]);
  const [variations, setVariations] = useState<ContractVariation[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ContractAppendix | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appendices, variationRows] = await Promise.all([
        contractAppendixService.listByContract(contractId, contractType),
        variationService.listByContract(contractId, contractType),
      ]);
      setItems(appendices);
      setVariations(variationRows.filter(item => item.status === 'approved'));
    } catch (error) {
      logApiError('contractAppendix.load', error);
      toast.error('Không thể tải phụ lục', getApiErrorMessage(error, 'Không thể tải danh sách phụ lục.'));
    } finally {
      setLoading(false);
    }
  }, [contractId, contractType, toast]);

  useEffect(() => { load(); }, [load]);

  const selectedVariationValue = useMemo(() => {
    if (!form) return 0;
    return variations
      .filter(item => form.variationIds.includes(item.id))
      .reduce((sum, item) => sum + Number(item.totalAmountDelta || 0), 0);
  }, [form, variations]);

  const openCreate = () => setForm(emptyAppendix(contractId, contractType, projectId, constructionSiteId));
  const openEdit = (item: ContractAppendix) => setForm({ ...item, variationIds: item.variationIds || [], attachments: item.attachments || [] });

  const toggleVariation = (variationId: string) => {
    setForm(prev => {
      if (!prev) return prev;
      const exists = prev.variationIds.includes(variationId);
      return {
        ...prev,
        variationIds: exists ? prev.variationIds.filter(id => id !== variationId) : [...prev.variationIds, variationId],
      };
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!form || !file) return;
    if (!isSupabaseConfigured) {
      toast.warning('Chưa cấu hình Supabase Storage', 'Không thể upload file phụ lục trong môi trường hiện tại.');
      return;
    }
    setUploading(true);
    try {
      const safeName = sanitizeFileName(file.name);
      const path = `appendices/${contractId}/${form.id}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('contract-files').upload(path, file);
      if (error) throw error;
      const attachment: ContractAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        fileName: safeName,
        storagePath: path,
        fileType: file.type || safeName.split('.').pop() || '',
        fileSize: file.size,
        category: 'other',
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.name || user?.username || '',
      };
      setForm(prev => prev ? { ...prev, attachments: [...(prev.attachments || []), attachment] } : prev);
      toast.success('Upload file phụ lục thành công');
    } catch (error) {
      logApiError('contractAppendix.upload', error);
      toast.error('Không thể upload file', getApiErrorMessage(error, 'Không thể upload file phụ lục.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setForm(prev => prev ? { ...prev, attachments: prev.attachments.filter(item => item.id !== attachmentId) } : prev);
  };

  const save = async () => {
    if (!form) return;
    if (!form.appendixNumber.trim() || !form.name.trim()) {
      toast.warning('Thiếu thông tin phụ lục', 'Vui lòng nhập số phụ lục và tên phụ lục.');
      return;
    }
    await run(async () => {
      await contractAppendixService.upsert({
        ...form,
        appendixNumber: form.appendixNumber.trim(),
        name: form.name.trim(),
        value: Number(form.value || selectedVariationValue || 0),
      });
      setForm(null);
      await load();
    }, { successTitle: 'Đã lưu phụ lục' });
  };

  const remove = async (item: ContractAppendix) => {
    const ok = await confirm({
      title: 'Xoá phụ lục',
      targetName: item.appendixNumber,
      warningText: 'Phụ lục sẽ bị xoá khỏi hợp đồng. Dữ liệu BOQ version liên quan không bị xoá.',
    });
    if (!ok) return;
    await run(async () => {
      await contractAppendixService.remove(item.id);
      await load();
    }, { successTitle: 'Đã xoá phụ lục', errorTitle: 'Không thể xoá phụ lục' });
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
          <FilePlus2 size={14} className="text-indigo-500" /> Phụ lục hợp đồng
        </h4>
        <button
          onClick={openCreate}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
        >
          <FilePlus2 size={12} /> Thêm phụ lục
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Đang tải phụ lục...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
          Chưa có phụ lục hợp đồng
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3 text-left">Số PL</th>
                <th className="p-3 text-left">Tên phụ lục</th>
                <th className="p-3 text-center">Ngày ký</th>
                <th className="p-3 text-right">Giá trị</th>
                <th className="p-3 text-center">Version BOQ</th>
                <th className="p-3 text-center">File</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/60">
                  <td className="p-3 font-mono font-black text-indigo-600">{item.appendixNumber}</td>
                  <td className="p-3 font-bold text-slate-700">{item.name}</td>
                  <td className="p-3 text-center text-slate-500">{item.signedDate ? new Date(item.signedDate).toLocaleDateString('vi-VN') : '-'}</td>
                  <td className="p-3 text-right font-black text-slate-800">{fmtMoney(item.value)}</td>
                  <td className="p-3 text-center text-slate-500">{item.variationIds?.length || 0}</td>
                  <td className="p-3 text-center text-slate-500">{item.attachments?.length || 0}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => openEdit(item)} className="px-2 py-1 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50">Sửa</button>
                    <button onClick={() => remove(item)} className="ml-1 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-indigo-500 uppercase">Phụ lục hợp đồng</p>
                <h3 className="font-black text-slate-800 dark:text-white">{form.appendixNumber || 'Phụ lục mới'}</h3>
              </div>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Số phụ lục *" value={form.appendixNumber} onChange={value => setForm({ ...form, appendixNumber: value })} />
                <Field label="Tên phụ lục *" className="md:col-span-2" value={form.name} onChange={value => setForm({ ...form, name: value })} />
                <SelectField label="Trạng thái" value={form.status} onChange={value => setForm({ ...form, status: value as ContractAppendix['status'] })}>
                  <option value="draft">Nháp</option>
                  <option value="signed">Đã ký</option>
                  <option value="active">Hiệu lực</option>
                  <option value="cancelled">Huỷ</option>
                </SelectField>
                <Field label="Ngày ký" type="date" value={form.signedDate || ''} onChange={value => setForm({ ...form, signedDate: value })} />
                <Field label="Giá trị" type="number" value={String(form.value || selectedVariationValue || 0)} onChange={value => setForm({ ...form, value: Number(value) })} />
                <Field label="Ghi chú" className="md:col-span-2" value={form.note || ''} onChange={value => setForm({ ...form, note: value })} />
              </div>

              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 text-[10px] font-black uppercase text-slate-400">Liên kết version điều chỉnh BOQ</div>
                {variations.length === 0 ? (
                  <div className="p-4 text-xs font-bold text-slate-400">Chưa có version BOQ đã duyệt để gắn vào phụ lục.</div>
                ) : (
                  <div className="divide-y divide-slate-50 max-h-48 overflow-y-auto">
                    {variations.map(version => (
                      <label key={version.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={form.variationIds.includes(version.id)} onChange={() => toggleVariation(version.id)} />
                          <span className="font-bold text-slate-700">V{version.versionNumber || '?'} - {version.title}</span>
                        </div>
                        <span className={Number(version.totalAmountDelta || 0) >= 0 ? 'font-black text-emerald-600' : 'font-black text-red-600'}>
                          {Number(version.totalAmountDelta || 0) >= 0 ? '+' : ''}{fmtMoney(version.totalAmountDelta || 0)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-xs font-black text-slate-700 flex items-center gap-1.5"><Paperclip size={13} /> File đính kèm</h5>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" />
                </div>
                {(form.attachments || []).length === 0 ? (
                  <div className="py-4 text-center text-xs font-bold text-slate-400">Chưa có file phụ lục</div>
                ) : (
                  <div className="space-y-2">
                    {form.attachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50">
                        <File size={16} className="text-indigo-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate">{attachment.name}</p>
                          <p className="text-[10px] text-slate-400">{(attachment.fileSize / 1024).toFixed(0)} KB</p>
                        </div>
                        <button onClick={() => removeAttachment(attachment.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
              <button onClick={() => setForm(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-sm text-slate-600">Huỷ</button>
              <button onClick={save} disabled={saving || uploading} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu phụ lục
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}> = ({ label, value, onChange, type = 'text', className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
    >
      {children}
    </select>
  </label>
);

export default ContractAppendixPanel;
