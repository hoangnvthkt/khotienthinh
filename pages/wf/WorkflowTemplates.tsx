
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { Role } from '../../types';
import {
    Plus, GitBranch, Settings2, Trash2, ToggleLeft, ToggleRight,
    Search, Layers, Clock, User, ShieldAlert, ChevronRight, Edit2
} from 'lucide-react';

const WorkflowTemplates: React.FC = () => {
    const navigate = useNavigate();
    const { templates, createTemplate, updateTemplate, deleteTemplate, instances, getTemplateNodes } = useWorkflow();
    const { user, users } = useApp();
    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [editingTemplate, setEditingTemplate] = useState<typeof templates[0] | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');

    if (user.role !== Role.ADMIN) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <ShieldAlert size={48} className="mb-4 opacity-20" />
                <h2 className="text-xl font-black uppercase tracking-widest">Truy cập bị từ chối</h2>
                <p className="text-sm font-medium">Chỉ Admin mới có quyền quản lý quy trình.</p>
            </div>
        );
    }

    const filtered = templates.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCreate = async () => {
        if (!newName.trim()) return;
        const t = await createTemplate(newName.trim(), newDesc.trim(), user.id);
        if (t) {
            setShowCreateModal(false);
            setNewName('');
            setNewDesc('');
            navigate(`/wf/builder/${t.id}`);
        }
    };

    const handleToggleActive = async (t: typeof templates[0]) => {
        await updateTemplate({ ...t, isActive: !t.isActive });
    };

    const handleDelete = async (id: string) => {
        await deleteTemplate(id);
        setDeleteConfirmId(null);
    };

    const openEditModal = (t: typeof templates[0]) => {
        setEditingTemplate(t);
        setEditName(t.name);
        setEditDesc(t.description);
    };

    const handleEdit = async () => {
        if (!editingTemplate || !editName.trim()) return;
        await updateTemplate({ ...editingTemplate, name: editName.trim(), description: editDesc.trim() });
        setEditingTemplate(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <GitBranch className="text-accent" size={28} /> Quản lý Quy trình
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Thiết kế và quản lý các mẫu quy trình duyệt phiếu cho công ty.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20"
                >
                    <Plus size={18} className="mr-2" /> Tạo quy trình mới
                </button>
            </div>

            {/* Search */}
            <div className="glass-card p-4 rounded-xl flex gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input
                        type="text" placeholder="Tìm kiếm quy trình..."
                        value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                    />
                </div>
            </div>

            {/* Template Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(t => {
                    const creator = users.find(u => u.id === t.createdBy);
                    const nodeCount = getTemplateNodes(t.id).length;
                    const instanceCount = instances.filter(i => i.templateId === t.id).length;
                    return (
                        <div
                            key={t.id}
                            className="glass-card rounded-2xl p-5 hover:shadow-lg transition-all group cursor-pointer relative overflow-hidden"
                            onClick={() => navigate(`/wf/builder/${t.id}`)}
                        >
                            {/* Active indicator */}
                            <div className={`absolute top-0 left-0 w-full h-1 ${t.isActive ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`} />

                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.isActive ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                                        <Layers size={18} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-sm text-slate-800 dark:text-white">{t.name}</h3>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${t.isActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                                            {t.isActive ? 'Đang hoạt động' : 'Đã tắt'}
                                        </span>
                                    </div>
                                </div>
                                <ChevronRight size={16} className="text-slate-300 group-hover:text-accent transition" />
                            </div>

                            {t.description && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{t.description}</p>
                            )}

                            <div className="flex items-center gap-4 text-[10px] text-slate-400 font-medium mb-4">
                                <span className="flex items-center gap-1"><Layers size={10} /> {nodeCount} bước</span>
                                <span className="flex items-center gap-1"><GitBranch size={10} /> {instanceCount} phiếu</span>
                                {(t.customFields?.length || 0) > 0 && (
                                    <span className="flex items-center gap-1 text-violet-500">📋 {t.customFields.length} trường</span>
                                )}
                                <span className="flex items-center gap-1"><Clock size={10} /> {new Date(t.createdAt).toLocaleDateString('vi-VN')}</span>
                            </div>

                            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <User size={10} />
                                    <span>{creator?.name || 'N/A'}</span>
                                </div>
                                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                    <button
                                        onClick={() => handleToggleActive(t)}
                                        className={`p-1.5 rounded-lg transition ${t.isActive ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                        title={t.isActive ? 'Tắt quy trình' : 'Bật quy trình'}
                                    >
                                        {t.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirmId(t.id)}
                                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                                        title="Xóa quy trình"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                    <button
                                        onClick={() => openEditModal(t)}
                                        className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                                        title="Sửa thông tin"
                                    >
                                        <Edit2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {filtered.length === 0 && (
                    <div className="col-span-full text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        <GitBranch className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold">Chưa có quy trình nào.</p>
                        <p className="text-sm text-slate-300 dark:text-slate-500">Bấm "Tạo quy trình mới" để bắt đầu.</p>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Plus size={20} className="text-accent" /> Tạo quy trình mới
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tên quy trình *</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="VD: Đề nghị thanh toán, Xin nghỉ phép..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mô tả</label>
                                <textarea
                                    value={newDesc}
                                    onChange={e => setNewDesc(e.target.value)}
                                    placeholder="Mô tả ngắn về quy trình này..."
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20">Tạo & Thiết kế</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirm Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa quy trình?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Tất cả các bước và phiếu liên quan sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20">Xóa</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingTemplate && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditingTemplate(null)}>
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                            <Edit2 size={20} className="text-blue-500" /> Sửa quy trình
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Tên quy trình *</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Mô tả</label>
                                <textarea
                                    value={editDesc}
                                    onChange={e => setEditDesc(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm resize-none"
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setEditingTemplate(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button onClick={handleEdit} disabled={!editName.trim()} className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition disabled:opacity-50 shadow-lg shadow-blue-500/20">Lưu thay đổi</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowTemplates;
