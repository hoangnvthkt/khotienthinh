
import React, { useState } from 'react';
import { useRequest } from '../../context/RequestContext';
import { useApp } from '../../context/AppContext';
import { Role, WorkflowCustomField, CustomFieldType } from '../../types';
import {
    Plus, FileText, Search, Trash2, Edit2, ToggleLeft, ToggleRight,
    ShieldAlert, X, ChevronDown, ChevronUp, GripVertical, Settings2,
    Type, AlignLeft, Hash, Calendar, List, Paperclip, Layers,
    Clock, User, Inbox
} from 'lucide-react';

const FIELD_TYPE_CONFIG: Record<CustomFieldType, { label: string; icon: any; color: string }> = {
    text: { label: 'Văn bản ngắn', icon: Type, color: 'bg-blue-500' },
    textarea: { label: 'Văn bản dài', icon: AlignLeft, color: 'bg-indigo-500' },
    number: { label: 'Số', icon: Hash, color: 'bg-emerald-500' },
    date: { label: 'Ngày tháng', icon: Calendar, color: 'bg-amber-500' },
    select: { label: 'Danh sách chọn', icon: List, color: 'bg-violet-500' },
    file: { label: 'Tệp đính kèm', icon: Paperclip, color: 'bg-rose-500' },
};

const ICON_OPTIONS = ['FileText', 'Inbox', 'Clock', 'Settings2', 'Layers', 'User'];
const COLOR_OPTIONS = [
    { value: 'from-blue-500 to-cyan-500', label: 'Xanh dương' },
    { value: 'from-emerald-500 to-teal-500', label: 'Xanh lá' },
    { value: 'from-violet-500 to-purple-600', label: 'Tím' },
    { value: 'from-orange-500 to-amber-500', label: 'Cam' },
    { value: 'from-rose-500 to-pink-600', label: 'Hồng' },
    { value: 'from-slate-500 to-slate-700', label: 'Xám' },
];

const RequestCategories: React.FC = () => {
    const { categories, requests, createCategory, updateCategory, deleteCategory } = useRequest();
    const { user, users } = useApp();

    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState<typeof categories[0] | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Form state
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formIcon, setFormIcon] = useState('FileText');
    const [formColor, setFormColor] = useState('from-blue-500 to-cyan-500');
    const [formApproverRole, setFormApproverRole] = useState('');
    const [formApproverUserId, setFormApproverUserId] = useState('');
    const [formSlaHours, setFormSlaHours] = useState<string>('');
    const [formFields, setFormFields] = useState<WorkflowCustomField[]>([]);

    // Add field form
    const [showAddField, setShowAddField] = useState(false);
    const [newFieldLabel, setNewFieldLabel] = useState('');
    const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
    const [newFieldRequired, setNewFieldRequired] = useState(false);
    const [newFieldOptions, setNewFieldOptions] = useState('');

    if (user.role !== Role.ADMIN) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <ShieldAlert size={48} className="mb-4 opacity-20" />
                <h2 className="text-xl font-black uppercase tracking-widest">Truy cập bị từ chối</h2>
                <p className="text-sm font-medium">Chỉ Admin mới có quyền quản lý danh mục yêu cầu.</p>
            </div>
        );
    }

    const filtered = categories.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const resetForm = () => {
        setFormName(''); setFormDesc(''); setFormIcon('FileText');
        setFormColor('from-blue-500 to-cyan-500');
        setFormApproverRole(''); setFormApproverUserId('');
        setFormSlaHours('');
        setFormFields([]);
    };

    const openEditModal = (cat: typeof categories[0]) => {
        setEditingCategory(cat);
        setFormName(cat.name);
        setFormDesc(cat.description);
        setFormIcon(cat.icon);
        setFormColor(cat.color);
        setFormApproverRole(cat.approverRole || '');
        setFormApproverUserId(cat.approverUserId || '');
        setFormSlaHours(cat.slaHours ? String(cat.slaHours) : '');
        setFormFields(cat.customFields || []);
    };

    const handleCreate = async () => {
        if (!formName.trim()) return;
        await createCategory({
            name: formName.trim(),
            description: formDesc.trim(),
            icon: formIcon,
            color: formColor,
            customFields: formFields,
            approverRole: (formApproverRole as Role) || undefined,
            approverUserId: formApproverUserId || undefined,
            slaHours: formSlaHours ? parseFloat(formSlaHours) : undefined,
            isActive: true,
            createdBy: user.id,
        });
        setShowCreateModal(false);
        resetForm();
    };

    const handleEdit = async () => {
        if (!editingCategory || !formName.trim()) return;
        await updateCategory({
            ...editingCategory,
            name: formName.trim(),
            description: formDesc.trim(),
            icon: formIcon,
            color: formColor,
            customFields: formFields,
            approverRole: (formApproverRole as Role) || undefined,
            approverUserId: formApproverUserId || undefined,
            slaHours: formSlaHours ? parseFloat(formSlaHours) : undefined,
        });
        setEditingCategory(null);
        resetForm();
    };

    const handleDelete = async (id: string) => {
        await deleteCategory(id);
        setDeleteConfirmId(null);
    };

    const addCustomField = () => {
        if (!newFieldLabel.trim()) return;
        const field: WorkflowCustomField = {
            id: crypto.randomUUID(),
            name: newFieldLabel.trim().toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '_').replace(/_+/g, '_'),
            label: newFieldLabel.trim(),
            type: newFieldType,
            required: newFieldRequired,
            options: newFieldType === 'select' ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
        };
        setFormFields(prev => [...prev, field]);
        setNewFieldLabel(''); setNewFieldType('text'); setNewFieldRequired(false); setNewFieldOptions('');
        setShowAddField(false);
    };

    const removeField = (id: string) => setFormFields(prev => prev.filter(f => f.id !== id));
    const toggleFieldRequired = (id: string) => setFormFields(prev => prev.map(f => f.id === id ? { ...f, required: !f.required } : f));

    const renderCategoryForm = (isEdit: boolean) => (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tên danh mục *</label>
                    <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="VD: Xin nghỉ phép, Đề xuất mua sắm..."
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" autoFocus />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Màu sắc</label>
                    <div className="flex gap-2 flex-wrap">
                        {COLOR_OPTIONS.map(c => (
                            <button key={c.value} onClick={() => setFormColor(c.value)}
                                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${c.value} transition-all ${formColor === c.value ? 'ring-2 ring-offset-2 ring-accent dark:ring-offset-slate-800 scale-110' : 'opacity-60 hover:opacity-100'}`}
                                title={c.label} />
                        ))}
                    </div>
                </div>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mô tả</label>
                <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Mô tả ngắn..."
                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none" rows={2} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Người duyệt theo vai trò</label>
                    <select value={formApproverRole} onChange={e => setFormApproverRole(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm">
                        <option value="">-- Không chỉ định --</option>
                        <option value={Role.ADMIN}>Quản trị</option>
                        <option value={Role.EMPLOYEE}>Nhân viên</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Hoặc chỉ định cụ thể</label>
                    <select value={formApproverUserId} onChange={e => setFormApproverUserId(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm">
                        <option value="">-- Không chỉ định --</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                    </select>
                </div>
            </div>

            {/* SLA */}
            <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Hạn xử lý (SLA)</label>
                <div className="flex items-center gap-3">
                    <input type="number" value={formSlaHours} onChange={e => setFormSlaHours(e.target.value)} placeholder="VD: 1, 4, 24..."
                        min="0" step="0.5"
                        className="w-32 px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" />
                    <span className="text-xs text-slate-500 font-medium">giờ (để trống = không giới hạn)</span>
                </div>
                {formSlaHours && parseFloat(formSlaHours) > 0 && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <Clock size={10} /> Hạn duyệt tự động tính: thời điểm tạo + {formSlaHours}h
                    </p>
                )}
            </div>

            {/* Custom Fields */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Layers size={14} className="text-violet-500" /> Trường tùy chỉnh ({formFields.length})
                    </h3>
                    <button onClick={() => setShowAddField(true)}
                        className="flex items-center px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition font-bold text-xs">
                        <Plus size={13} className="mr-1" /> Thêm
                    </button>
                </div>
                {formFields.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        <FileText className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                        <p className="text-[10px] text-slate-400">Chưa có trường nào</p>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {formFields.map((field, idx) => {
                            const ft = FIELD_TYPE_CONFIG[field.type];
                            const FIcon = ft.icon;
                            return (
                                <div key={field.id} className="flex items-center gap-2 p-2.5 bg-white/50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700 group">
                                    <GripVertical size={12} className="text-slate-300" />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm font-bold text-slate-700 dark:text-white truncate block">{field.label}</span>
                                    </div>
                                    <button onClick={() => toggleFieldRequired(field.id)}
                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition ${field.required ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-400'}`}>
                                        {field.required ? 'Bắt buộc' : 'Tùy chọn'}
                                    </button>
                                    <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded ${ft.color} flex items-center gap-1`}>
                                        <FIcon size={9} /> {ft.label}
                                    </span>
                                    <button onClick={() => removeField(field.id)} className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition opacity-0 group-hover:opacity-100">
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
                <button onClick={() => { isEdit ? setEditingCategory(null) : setShowCreateModal(false); resetForm(); }}
                    className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                <button onClick={isEdit ? handleEdit : handleCreate} disabled={!formName.trim()}
                    className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20">
                    {isEdit ? 'Lưu thay đổi' : 'Tạo danh mục'}
                </button>
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Settings2 className="text-accent" size={28} /> Danh mục yêu cầu
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Quản lý các loại phiếu yêu cầu trong hệ thống.</p>
                </div>
                <button onClick={() => { resetForm(); setShowCreateModal(true); }}
                    className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20">
                    <Plus size={18} className="mr-2" /> Tạo danh mục mới
                </button>
            </div>

            {/* Search */}
            <div className="glass-card p-4 rounded-xl">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input type="text" placeholder="Tìm kiếm danh mục..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm" />
                </div>
            </div>

            {/* Category Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(cat => {
                    const reqCount = requests.filter(r => r.categoryId === cat.id).length;
                    const creator = users.find(u => u.id === cat.createdBy);
                    return (
                        <div key={cat.id} className="glass-card rounded-2xl p-5 hover:shadow-lg transition-all group relative overflow-hidden">
                            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${cat.color}`} />
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center text-white shadow-md`}>
                                        <Inbox size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm text-slate-800 dark:text-white">{cat.name}</h3>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${cat.isActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                                            {cat.isActive ? 'Đang hoạt động' : 'Đã tắt'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {cat.description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{cat.description}</p>}
                            <div className="flex items-center gap-4 text-[10px] text-slate-400 font-medium mb-4">
                                <span className="flex items-center gap-1"><Inbox size={10} /> {reqCount} phiếu</span>
                                <span className="flex items-center gap-1"><Layers size={10} /> {cat.customFields?.length || 0} trường</span>
                                {cat.slaHours ? <span className="flex items-center gap-1 text-amber-500"><Clock size={10} /> SLA: {cat.slaHours}h</span> : null}
                                <span className="flex items-center gap-1"><Clock size={10} /> {new Date(cat.createdAt).toLocaleDateString('vi-VN')}</span>
                            </div>
                            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <User size={10} /> {creator?.name || 'N/A'}
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => updateCategory({ ...cat, isActive: !cat.isActive })}
                                        className={`p-1.5 rounded-lg transition ${cat.isActive ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                        {cat.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                    </button>
                                    <button onClick={() => openEditModal(cat)} className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition">
                                        <Edit2 size={14} />
                                    </button>
                                    <button onClick={() => setDeleteConfirmId(cat.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="col-span-full text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <Inbox className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold">Chưa có danh mục nào.</p>
                        <p className="text-sm text-slate-300 dark:text-slate-500">Bấm "Tạo danh mục mới" để bắt đầu.</p>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setShowCreateModal(false); resetForm(); }}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Plus size={20} className="text-accent" /> Tạo danh mục mới
                        </h2>
                        {renderCategoryForm(false)}
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingCategory && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setEditingCategory(null); resetForm(); }}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Edit2 size={20} className="text-blue-500" /> Sửa danh mục
                        </h2>
                        {renderCategoryForm(true)}
                    </div>
                </div>
            )}

            {/* Add Field Modal */}
            {showAddField && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAddField(false)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Plus size={20} className="text-violet-500" /> Thêm trường mới
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tên trường *</label>
                                <input type="text" value={newFieldLabel} onChange={e => setNewFieldLabel(e.target.value)} placeholder="VD: Lý do, Số tiền..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 text-sm" autoFocus />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Loại trường</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(Object.entries(FIELD_TYPE_CONFIG) as [CustomFieldType, typeof FIELD_TYPE_CONFIG[CustomFieldType]][]).map(([type, config]) => {
                                        const Icon = config.icon;
                                        return (
                                            <button key={type} onClick={() => setNewFieldType(type)}
                                                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition border ${newFieldType === type
                                                    ? `${config.color} text-white border-transparent shadow-md`
                                                    : 'bg-white/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-400'
                                                    }`}>
                                                <Icon size={12} /> {config.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            {newFieldType === 'select' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Các tùy chọn (phân cách bằng dấu phẩy)</label>
                                    <input type="text" value={newFieldOptions} onChange={e => setNewFieldOptions(e.target.value)} placeholder="VD: Option A, Option B"
                                        className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm" />
                                </div>
                            )}
                            <button onClick={() => setNewFieldRequired(!newFieldRequired)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition border ${newFieldRequired
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-50 dark:bg-slate-700/50 text-slate-500 border-slate-200 dark:border-slate-600'
                                    }`}>
                                {newFieldRequired ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                {newFieldRequired ? 'Bắt buộc' : 'Không bắt buộc'}
                            </button>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowAddField(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={addCustomField} disabled={!newFieldLabel.trim()}
                                className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition disabled:opacity-50 shadow-lg shadow-violet-500/20">Thêm trường</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirm */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa danh mục?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Tất cả phiếu yêu cầu liên quan sẽ bị xóa vĩnh viễn.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm transition">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RequestCategories;
