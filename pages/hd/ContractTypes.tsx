import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Layers, Loader2, Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import {
  ContractFormTemplate,
  ContractTemplateField,
  ContractTemplateFieldType,
  ContractTemplateSection,
  ContractTypeMetadata,
} from '../../types';
import { contractTemplateService, contractTypeService } from '../../lib/contractMetadataService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

const FIELD_TYPES: Array<{ value: ContractTemplateFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Số' },
  { value: 'currency', label: 'Tiền' },
  { value: 'percent', label: '%' },
  { value: 'date', label: 'Ngày' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Điện thoại' },
  { value: 'url', label: 'Website' },
  { value: 'select', label: 'Danh sách' },
];

const emptyType = (): Partial<ContractTypeMetadata> => ({
  code: '',
  name: '',
  description: '',
  isActive: true,
  sortOrder: 0,
});

const emptyField = (templateId = '', sectionId = ''): Partial<ContractTemplateField> => ({
  templateId,
  sectionId,
  key: '',
  label: '',
  fieldType: 'text',
  required: false,
  placeholder: '',
  defaultValue: '',
  options: [],
  sortOrder: 0,
  isActive: true,
});

const ContractTypes: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();

  const [types, setTypes] = useState<ContractTypeMetadata[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [templates, setTemplates] = useState<ContractFormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingType, setEditingType] = useState<Partial<ContractTypeMetadata>>(emptyType());
  const [sectionTitle, setSectionTitle] = useState('');
  const [fieldForm, setFieldForm] = useState<Partial<ContractTemplateField> | null>(null);

  const selectedType = useMemo(() => types.find(type => type.id === selectedTypeId) || null, [types, selectedTypeId]);
  const activeTemplate = useMemo(() => templates.find(t => t.isDefault) || templates[0] || null, [templates]);

  const loadTypes = async () => {
    setLoading(true);
    try {
      const data = await contractTypeService.list({ includeInactive: true });
      setTypes(data);
      setSelectedTypeId(current => current || data[0]?.id || '');
    } catch (error: any) {
      toast.error('Lỗi tải loại hợp đồng', error?.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async (typeId: string) => {
    if (!typeId) { setTemplates([]); return; }
    try {
      setTemplates(await contractTemplateService.listByContractType(typeId, { includeInactive: true }));
    } catch (error: any) {
      toast.error('Lỗi tải mẫu hợp đồng', error?.message);
    }
  };

  useEffect(() => { loadTypes(); }, []);
  useEffect(() => { loadTemplates(selectedTypeId); }, [selectedTypeId]);

  const saveType = async () => {
    if (!editingType.name?.trim()) return toast.error('Thiếu tên loại hợp đồng');
    setSaving(true);
    try {
      const saved = await contractTypeService.upsert({
        ...editingType,
        name: editingType.name,
        sortOrder: Number(editingType.sortOrder || 0),
      });
      toast.success(editingType.id ? 'Cập nhật loại hợp đồng' : 'Thêm loại hợp đồng');
      setShowTypeForm(false);
      setEditingType(emptyType());
      await loadTypes();
      setSelectedTypeId(saved.id);
    } catch (error: any) {
      toast.error('Lỗi lưu loại hợp đồng', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivateType = async (type: ContractTypeMetadata) => {
    const ok = await confirm({
      title: 'Ngưng sử dụng loại hợp đồng',
      targetName: type.name,
      warningText: 'Loại hợp đồng sẽ được ẩn khỏi form tạo mới, dữ liệu cũ vẫn được giữ.',
    });
    if (!ok) return;
    try {
      await contractTypeService.deactivate(type.id);
      toast.success('Đã ngưng sử dụng loại hợp đồng');
      await loadTypes();
    } catch (error: any) {
      toast.error('Lỗi cập nhật loại hợp đồng', error?.message);
    }
  };

  const ensureTemplate = async () => {
    if (!selectedType) return;
    setSaving(true);
    try {
      const template = await contractTemplateService.upsertTemplate({
        contractTypeId: selectedType.id,
        name: `Mẫu ${selectedType.name}`,
        description: `Mẫu khai báo mặc định cho ${selectedType.name}`,
        isDefault: true,
        isActive: true,
      });
      await contractTemplateService.upsertSection({
        templateId: template.id,
        title: 'Thông tin bổ sung',
        sortOrder: 10,
        isActive: true,
      });
      toast.success('Đã tạo mẫu mặc định');
      await loadTemplates(selectedType.id);
    } catch (error: any) {
      toast.error('Lỗi tạo mẫu', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const addSection = async () => {
    if (!activeTemplate || !sectionTitle.trim()) return;
    setSaving(true);
    try {
      await contractTemplateService.upsertSection({
        templateId: activeTemplate.id,
        title: sectionTitle.trim(),
        sortOrder: (activeTemplate.sections?.length || 0) * 10 + 10,
        isActive: true,
      });
      setSectionTitle('');
      await loadTemplates(selectedTypeId);
      toast.success('Đã thêm nhóm trường');
    } catch (error: any) {
      toast.error('Lỗi thêm nhóm trường', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivateSection = async (section: ContractTemplateSection) => {
    const ok = await confirm({ title: 'Ẩn nhóm trường', targetName: section.title });
    if (!ok) return;
    try {
      await contractTemplateService.deactivateSection(section.id);
      await loadTemplates(selectedTypeId);
      toast.success('Đã ẩn nhóm trường');
    } catch (error: any) {
      toast.error('Lỗi ẩn nhóm trường', error?.message);
    }
  };

  const saveField = async () => {
    if (!fieldForm?.templateId || !fieldForm.sectionId || !fieldForm.key?.trim() || !fieldForm.label?.trim()) {
      return toast.error('Thiếu key hoặc tên trường');
    }
    setSaving(true);
    try {
      await contractTemplateService.upsertField({
        ...fieldForm,
        templateId: fieldForm.templateId,
        sectionId: fieldForm.sectionId,
        key: fieldForm.key,
        label: fieldForm.label,
        sortOrder: Number(fieldForm.sortOrder || 0),
        options: parseOptions(fieldForm.options as any),
      });
      setFieldForm(null);
      await loadTemplates(selectedTypeId);
      toast.success('Đã lưu trường dữ liệu');
    } catch (error: any) {
      toast.error('Lỗi lưu trường', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivateField = async (field: ContractTemplateField) => {
    const ok = await confirm({ title: 'Ẩn trường dữ liệu', targetName: field.label });
    if (!ok) return;
    try {
      await contractTemplateService.deactivateField(field.id);
      await loadTemplates(selectedTypeId);
      toast.success('Đã ẩn trường dữ liệu');
    } catch (error: any) {
      toast.error('Lỗi ẩn trường', error?.message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="font-black text-slate-800 dark:text-white flex items-center gap-2"><Settings2 size={17} /> Loại hợp đồng</div>
          <button onClick={() => { setEditingType(emptyType()); setShowTypeForm(true); }} className="p-2 rounded-xl bg-violet-600 text-white"><Plus size={14} /></button>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="inline animate-spin mr-2" size={16} />Đang tải...</div>
          ) : types.length === 0 ? (
            <div className="py-12 text-center text-slate-400">Chưa có loại hợp đồng</div>
          ) : types.map(type => (
            <button
              key={type.id}
              onClick={() => setSelectedTypeId(type.id)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition ${selectedTypeId === type.id ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-800 dark:text-white">{type.name}</div>
                  <div className="text-xs text-slate-400 font-mono">{type.code}</div>
                  {type.description && <div className="text-xs text-slate-500 mt-1">{type.description}</div>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${type.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {type.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 flex gap-1">
                <span onClick={e => { e.stopPropagation(); setEditingType(type); setShowTypeForm(true); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-amber-600 hover:bg-amber-50"><Edit2 size={12} /> Sửa</span>
                <span onClick={e => { e.stopPropagation(); deactivateType(type); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 size={12} /> Ẩn</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm min-h-[600px]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-black text-slate-800 dark:text-white flex items-center gap-2"><Layers size={17} /> Mẫu khai báo</div>
            <div className="text-xs text-slate-400">{selectedType ? selectedType.name : 'Chọn loại hợp đồng để cấu hình mẫu'}</div>
          </div>
          {selectedType && !activeTemplate && (
            <button onClick={ensureTemplate} disabled={saving} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-50">
              Tạo mẫu mặc định
            </button>
          )}
        </div>

        {!selectedType ? (
          <div className="py-24 text-center text-slate-400">Chọn loại hợp đồng</div>
        ) : !activeTemplate ? (
          <div className="py-24 text-center text-slate-400">Loại hợp đồng này chưa có mẫu khai báo</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900 p-4">
              <div className="font-bold text-slate-800 dark:text-white">{activeTemplate.name}</div>
              <div className="text-xs text-slate-500">{activeTemplate.description || 'Không có mô tả'}</div>
            </div>

            <div className="flex gap-2">
              <input
                value={sectionTitle}
                onChange={e => setSectionTitle(e.target.value)}
                placeholder="Tên nhóm trường mới"
                className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none"
              />
              <button onClick={addSection} disabled={saving || !sectionTitle.trim()} className="px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-bold disabled:opacity-50">
                Thêm nhóm
              </button>
            </div>

            {(activeTemplate.sections || []).map(section => (
              <div key={section.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
                  <div>
                    <div className="font-black text-slate-700 dark:text-slate-200">{section.title}</div>
                    <div className="text-xs text-slate-400">{section.fields?.length || 0} trường</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setFieldForm(emptyField(activeTemplate.id, section.id))} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold">Thêm trường</button>
                    <button onClick={() => deactivateSection(section)} className="px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 text-xs font-bold">Ẩn nhóm</button>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(section.fields || []).length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">Chưa có trường dữ liệu</div>
                  ) : section.fields!.map(field => (
                    <div key={field.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white">{field.label} {field.required && <span className="text-red-500">*</span>}</div>
                        <div className="text-xs text-slate-400 font-mono">{field.key} · {FIELD_TYPES.find(t => t.value === field.fieldType)?.label}</div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setFieldForm(field)} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50"><Edit2 size={14} /></button>
                        <button onClick={() => deactivateField(field)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTypeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-black text-slate-800 dark:text-white">{editingType.id ? 'Sửa loại hợp đồng' : 'Thêm loại hợp đồng'}</h3>
              <button onClick={() => setShowTypeForm(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <TextInput label="Mã loại" value={editingType.code || ''} onChange={value => setEditingType({ ...editingType, code: value })} placeholder="Tự sinh nếu bỏ trống" />
              <TextInput label="Tên loại *" value={editingType.name || ''} onChange={value => setEditingType({ ...editingType, name: value })} />
              <TextInput label="Mô tả" value={editingType.description || ''} onChange={value => setEditingType({ ...editingType, description: value })} />
              <TextInput label="Thứ tự" type="number" value={String(editingType.sortOrder || 0)} onChange={value => setEditingType({ ...editingType, sortOrder: Number(value) })} />
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={editingType.isActive ?? true} onChange={e => setEditingType({ ...editingType, isActive: e.target.checked })} />
                Đang hoạt động
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setShowTypeForm(false)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300">Hủy</button>
              <button onClick={saveType} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {fieldForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-black text-slate-800 dark:text-white">{fieldForm.id ? 'Sửa trường' : 'Thêm trường'}</h3>
              <button onClick={() => setFieldForm(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <TextInput label="Key *" value={fieldForm.key || ''} onChange={value => setFieldForm({ ...fieldForm, key: value })} placeholder="paymentTerms" />
                <TextInput label="Tên trường *" value={fieldForm.label || ''} onChange={value => setFieldForm({ ...fieldForm, label: value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Kiểu dữ liệu</label>
                  <select value={fieldForm.fieldType || 'text'} onChange={e => setFieldForm({ ...fieldForm, fieldType: e.target.value as ContractTemplateFieldType })} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none">
                    {FIELD_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                <TextInput label="Thứ tự" type="number" value={String(fieldForm.sortOrder || 0)} onChange={value => setFieldForm({ ...fieldForm, sortOrder: Number(value) })} />
              </div>
              <TextInput label="Placeholder" value={fieldForm.placeholder || ''} onChange={value => setFieldForm({ ...fieldForm, placeholder: value })} />
              <TextInput label="Giá trị mặc định" value={fieldForm.defaultValue || ''} onChange={value => setFieldForm({ ...fieldForm, defaultValue: value })} />
              {fieldForm.fieldType === 'select' && (
                <TextInput
                  label="Options"
                  value={Array.isArray(fieldForm.options) ? fieldForm.options.map(o => `${o.label}:${o.value}`).join(', ') : String(fieldForm.options || '')}
                  onChange={value => setFieldForm({ ...fieldForm, options: value as any })}
                  placeholder="Label 1:value1, Label 2:value2"
                />
              )}
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={fieldForm.required || false} onChange={e => setFieldForm({ ...fieldForm, required: e.target.checked })} />
                Bắt buộc nhập
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setFieldForm(null)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300">Hủy</button>
              <button onClick={saveField} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu trường
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const parseOptions = (value: any): Array<{ label: string; value: string }> => {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [label, optionValue] = part.split(':').map(item => item.trim());
      return { label, value: optionValue || label };
    });
};

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/30"
    />
  </div>
);

export default ContractTypes;
