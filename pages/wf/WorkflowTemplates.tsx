import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { Role, WorkflowNodeType, WorkflowTemplate, WorkflowTemplateCategory } from '../../types';
import {
    Plus, GitBranch, Trash2, ToggleLeft, ToggleRight,
    Search, Layers, Clock, User, ShieldAlert, ChevronRight, Edit2, Shield, Eye, X,
    Copy, FolderOpen, FolderCog, ChevronUp, ChevronDown, Check
} from 'lucide-react';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import {
    isMaterialRequestWorkflowTemplate,
    isProjectOwnedWorkflowTemplate,
    isRequestModuleWorkflowTemplate,
} from '../../lib/workflowVisibility';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage } from '../../lib/apiError';
import { canPerform } from '../../lib/permissions/permissionService';

const UNCATEGORIZED = '__uncategorized__';
const ALL_GROUPS = '__all__';
type StatusFilter = 'all' | 'active' | 'inactive';

const inputClass = 'w-full px-4 py-2.5 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm';
const labelClass = 'block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5';

const CategorySelect: React.FC<{ value: string | null; onChange: (value: string | null) => void; categories: WorkflowTemplateCategory[] }> = ({ value, onChange, categories }) => (
    <div>
        <label className={labelClass}>Nhóm quy trình</label>
        <select className={inputClass} value={value || ''} onChange={e => onChange(e.target.value || null)}>
            <option value="">Chưa phân nhóm</option>
            {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
            ))}
        </select>
    </div>
);

const ModalShell: React.FC<{ title: React.ReactNode; onClose: () => void; footer: React.ReactNode; children: React.ReactNode }> = ({ title, onClose, footer, children }) => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 h-[100dvh] max-h-[100dvh] overflow-hidden p-0 sm:p-4" onClick={onClose}>
        <div className="glass-card bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh] overflow-hidden relative" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">{title}</h2>
                <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Đóng"><X size={18} /></button>
            </div>
            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">{children}</div>
            <div className="flex gap-3 mt-6 border-t border-slate-100 dark:border-slate-700/50 pt-4">{footer}</div>
        </div>
    </div>
);

const WorkflowTemplates: React.FC = () => {
    const navigate = useNavigate();
    const {
        templates, categories, createTemplate, updateTemplate, deleteTemplate, cloneTemplate, setTemplateCategory,
        saveCategory, deleteCategory, reorderCategories, instances, getTemplateNodes, loadTemplateStructures,
    } = useWorkflow();
    const { user, users } = useApp();
    const toast = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [activeGroup, setActiveGroup] = useState<string>(ALL_GROUPS);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
    const [createError, setCreateError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Role pickers
    const [newManagers, setNewManagers] = useState<string[]>([]);
    const [newWatchers, setNewWatchers] = useState<string[]>([]);
    const [editManagers, setEditManagers] = useState<string[]>([]);
    const [editWatchers, setEditWatchers] = useState<string[]>([]);
    // Clone
    const [cloneSource, setCloneSource] = useState<WorkflowTemplate | null>(null);
    const [cloneName, setCloneName] = useState('');
    const [cloneCategoryId, setCloneCategoryId] = useState<string | null>(null);
    // Group management
    const [showGroupManager, setShowGroupManager] = useState(false);
    const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
    const [newGroupName, setNewGroupName] = useState('');
    const [groupBusy, setGroupBusy] = useState(false);
    const [groupDeleteId, setGroupDeleteId] = useState<string | null>(null);

    useEffect(() => {
        const hasActiveOverlay = showCreateModal || !!editingTemplate || !!deleteConfirmId || !!cloneSource || showGroupManager;
        if (hasActiveOverlay) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [showCreateModal, editingTemplate, deleteConfirmId, cloneSource, showGroupManager]);

    // Helper: User picker component
    const UserPicker: React.FC<{ selected: string[]; onChange: (v: string[]) => void; label: string; icon: React.ReactNode; color: string }> = ({ selected, onChange, label, icon, color }) => {
        const availableUsers = users.filter(u => !selected.includes(u.id));
        return (
        <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                {icon} {label}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {selected.map(uid => {
                    const u = users.find(x => x.id === uid);
                    return (
                        <span key={uid} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${color}`}>
                            {u?.name || uid}
                            <button type="button" onClick={() => onChange(selected.filter(x => x !== uid))} className="hover:opacity-70"><X size={12} /></button>
                        </span>
                    );
                })}
            </div>
            <select
                className="w-full px-3 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                value=""
                onChange={e => { if (e.target.value && !selected.includes(e.target.value)) onChange([...selected, e.target.value]); }}
            >
                <option value="">-- Chọn nhân viên --</option>
                {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
        </div>
    );
    };

    const isSystemAdmin = user.role === Role.ADMIN;
    const canViewTemplates = isSystemAdmin
        || canPerform(user, 'workflow.template.view', { scopeType: 'global', scopeId: '*' });
    const canCreateWorkflowTemplates = isSystemAdmin
        || canPerform(user, 'workflow.template.create', { scopeType: 'global', scopeId: '*' });
    const canEditWorkflowTemplates = isSystemAdmin
        || canPerform(user, 'workflow.template.edit', { scopeType: 'global', scopeId: '*' });
    const canPublishWorkflowTemplates = isSystemAdmin
        || canPerform(user, 'workflow.template.publish', { scopeType: 'global', scopeId: '*' });
    const canManageGroups = canCreateWorkflowTemplates || canEditWorkflowTemplates;
    const canManageTemplate = (_template: WorkflowTemplate) => canEditWorkflowTemplates;

    const visibleTemplates = useMemo(() => templates
        .filter(t => !isRequestModuleWorkflowTemplate(t) && !isProjectOwnedWorkflowTemplate(t))
        .filter(t => user.role === Role.ADMIN || !isMaterialRequestWorkflowTemplate(t)),
    [templates, user.role]);

    // Inactive templates' steps are not preloaded; load them so step counts are real.
    const inactiveTemplateKey = visibleTemplates.filter(t => !t.isActive).map(t => t.id).sort().join(',');
    useEffect(() => {
        if (!canViewTemplates || !inactiveTemplateKey) return;
        loadTemplateStructures(inactiveTemplateKey.split(',')).catch(error => {
            console.warn('Cannot load inactive workflow template steps:', error);
        });
    }, [canViewTemplates, inactiveTemplateKey, loadTemplateStructures]);

    const knownCategoryIds = useMemo(() => new Set(categories.map(c => c.id)), [categories]);
    const groupKeyOf = (t: WorkflowTemplate) => (t.categoryId && knownCategoryIds.has(t.categoryId) ? t.categoryId : UNCATEGORIZED);

    const filtered = visibleTemplates.filter(t =>
        matchesSearchQueryMultiple([t.name, t.description], searchTerm)
        && (statusFilter === 'all' || (statusFilter === 'active' ? t.isActive : !t.isActive))
    );
    const isFiltering = !!searchTerm.trim() || statusFilter !== 'all';

    const countByGroup = useMemo(() => {
        const counts = new Map<string, number>();
        filtered.forEach(t => counts.set(groupKeyOf(t), (counts.get(groupKeyOf(t)) || 0) + 1));
        return counts;
    }, [filtered, knownCategoryIds]);

    // A deleted group may still be selected; fall back to "all".
    useEffect(() => {
        if (activeGroup !== ALL_GROUPS && activeGroup !== UNCATEGORIZED && !knownCategoryIds.has(activeGroup)) {
            setActiveGroup(ALL_GROUPS);
        }
    }, [activeGroup, knownCategoryIds]);

    const sections: Array<{ key: string; name: string; items: WorkflowTemplate[] }> = useMemo(() => {
        const groups = [
            ...categories.map(c => ({ key: c.id, name: c.name })),
            { key: UNCATEGORIZED, name: 'Chưa phân nhóm' },
        ].filter(group => activeGroup === ALL_GROUPS || activeGroup === group.key);
        return groups
            .map(group => ({
                ...group,
                items: filtered
                    .filter(t => groupKeyOf(t) === group.key)
                    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'vi')),
            }))
            // In the overview, hide empty groups while filtering and always hide an empty "Chưa phân nhóm".
            .filter(group => activeGroup !== ALL_GROUPS || group.items.length > 0 || (!isFiltering && group.key !== UNCATEGORIZED));
    }, [activeGroup, categories, filtered, isFiltering, knownCategoryIds]);

    if (!canViewTemplates) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <ShieldAlert size={48} className="mb-4 opacity-20" />
                <h2 className="text-xl font-black uppercase tracking-widest">Truy cập bị từ chối</h2>
                <p className="text-sm font-medium">Chỉ Admin hoặc Quản trị viên mới có quyền quản lý quy trình.</p>
            </div>
        );
    }

    const openCreateModal = (categoryId: string | null = null) => {
        setNewCategoryId(categoryId);
        setCreateError('');
        setShowCreateModal(true);
    };

    const handleCreate = async () => {
        setCreateError('');
        if (!canCreateWorkflowTemplates) {
            setCreateError('Tài khoản chưa có quyền quản trị Mẫu quy trình.');
            return;
        }
        if (!newName.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const t = await createTemplate(newName.trim(), newDesc.trim(), user.id);
            if (!t) throw new Error('Không nhận được dữ liệu mẫu quy trình sau khi tạo.');
            // Save managers + default watchers
            await updateTemplate({ ...t, managers: newManagers, defaultWatchers: newWatchers });
            if (newCategoryId) await setTemplateCategory(t.id, newCategoryId);
            setShowCreateModal(false);
            setNewName('');
            setNewDesc('');
            setNewManagers([]);
            setNewWatchers([]);
            setNewCategoryId(null);
            setCreateError('');
            navigate(`/wf/builder/${t.id}`);
        } catch (error) {
            console.error('Create workflow template failed:', error);
            setCreateError(getApiErrorMessage(error, 'Không thể tạo mẫu quy trình. Vui lòng thử lại.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleActive = async (t: WorkflowTemplate) => {
        if (!canPublishWorkflowTemplates) return;
        try {
            await updateTemplate({ ...t, isActive: !t.isActive });
            toast.success(t.isActive ? 'Đã tắt quy trình' : 'Đã bật quy trình');
        } catch (error) {
            console.error('Toggle workflow template failed:', error);
            toast.error(
                t.isActive ? 'Chưa tắt được quy trình' : 'Chưa bật được quy trình',
                getApiErrorMessage(error, 'Vui lòng mở quy trình để kiểm tra các bước rồi thử lại.'),
            );
        }
    };

    const handleDelete = async (id: string) => {
        if (isDeleting) return;
        setIsDeleting(true);
        try {
            await deleteTemplate(id);
            setDeleteConfirmId(null);
            toast.success('Đã xóa mẫu quy trình');
        } catch (error) {
            console.error('Delete workflow template failed:', error);
            toast.error(
                'Không thể xóa mẫu quy trình',
                getApiErrorMessage(error, 'Không thể xóa mẫu quy trình. Vui lòng thử lại.'),
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const openEditModal = (t: WorkflowTemplate) => {
        if (!canManageTemplate(t)) return;
        setEditingTemplate(t);
        setEditName(t.name);
        setEditDesc(t.description);
        setEditCategoryId(t.categoryId && knownCategoryIds.has(t.categoryId) ? t.categoryId : null);
        setEditManagers(t.managers || []);
        setEditWatchers(t.defaultWatchers || []);
    };

    const handleEdit = async () => {
        if (!editingTemplate || !editName.trim() || isSubmitting) return;
        if (!canManageTemplate(editingTemplate)) return;
        setIsSubmitting(true);
        try {
            await updateTemplate({ ...editingTemplate, name: editName.trim(), description: editDesc.trim(), managers: editManagers, defaultWatchers: editWatchers });
            if ((editingTemplate.categoryId || null) !== editCategoryId) {
                await setTemplateCategory(editingTemplate.id, editCategoryId);
            }
            setEditingTemplate(null);
            toast.success('Đã lưu thông tin quy trình');
        } catch (error) {
            console.error('Edit workflow template failed:', error);
            toast.error('Không lưu được thay đổi', getApiErrorMessage(error, 'Vui lòng thử lại.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const openCloneModal = (t: WorkflowTemplate) => {
        setCloneSource(t);
        setCloneName(`${t.name} (copy)`);
        setCloneCategoryId(t.categoryId && knownCategoryIds.has(t.categoryId) ? t.categoryId : null);
    };

    const handleClone = async () => {
        if (!cloneSource || !cloneName.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const { template, printTemplateCopyFailures } = await cloneTemplate(cloneSource.id, cloneName.trim(), cloneCategoryId);
            setCloneSource(null);
            if (printTemplateCopyFailures > 0) {
                toast.warning('Đã nhân bản quy trình', `${printTemplateCopyFailures} mẫu in chưa sao chép được — vui lòng tải lại trong tab Mẫu in.`);
            } else {
                toast.success('Đã nhân bản quy trình', 'Bản sao đang tắt. Chỉnh sửa xong hãy bật để sử dụng.');
            }
            navigate(`/wf/builder/${template.id}`);
        } catch (error) {
            console.error('Clone workflow template failed:', error);
            toast.error('Không nhân bản được quy trình', getApiErrorMessage(error, 'Vui lòng thử lại.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    // ---- Group management ----
    const templateCountInCategory = (categoryId: string) => visibleTemplates.filter(t => t.categoryId === categoryId).length;

    const runGroupAction = async (action: () => Promise<unknown>, successMessage?: string) => {
        if (groupBusy) return false;
        setGroupBusy(true);
        try {
            await action();
            if (successMessage) toast.success(successMessage);
            return true;
        } catch (error) {
            console.error('Workflow group action failed:', error);
            toast.error('Không lưu được nhóm', getApiErrorMessage(error, 'Vui lòng thử lại.'));
            return false;
        } finally {
            setGroupBusy(false);
        }
    };

    const handleAddGroup = async () => {
        const name = newGroupName.trim();
        if (!name) return;
        const ok = await runGroupAction(() => saveCategory(null, name), 'Đã thêm nhóm');
        if (ok) setNewGroupName('');
    };

    const handleRenameGroup = async (category: WorkflowTemplateCategory) => {
        const name = (groupDrafts[category.id] ?? category.name).trim();
        if (!name || name === category.name) return;
        const ok = await runGroupAction(() => saveCategory(category.id, name), 'Đã đổi tên nhóm');
        if (ok) setGroupDrafts(prev => { const next = { ...prev }; delete next[category.id]; return next; });
    };

    const handleMoveGroup = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= categories.length) return;
        const ids = categories.map(c => c.id);
        [ids[index], ids[target]] = [ids[target], ids[index]];
        void runGroupAction(() => reorderCategories(ids));
    };

    const handleDeleteGroup = async (categoryId: string) => {
        const ok = await runGroupAction(() => deleteCategory(categoryId), 'Đã xóa nhóm');
        if (ok) setGroupDeleteId(null);
    };

    const renderCard = (t: WorkflowTemplate) => {
        const creator = users.find(u => u.id === t.createdBy);
        const nodeCount = getTemplateNodes(t.id).filter(n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END).length;
        const instanceCount = instances.filter(i => i.templateId === t.id).length;
        const canManageThisTemplate = canManageTemplate(t);
        return (
            <div
                key={t.id}
                className={`glass-card rounded-2xl p-5 transition-all group relative overflow-hidden ${canManageThisTemplate ? 'cursor-pointer hover:shadow-lg' : ''}`}
                onClick={() => { if (canManageThisTemplate) navigate(`/wf/builder/${t.id}`); }}
            >
                {/* Active indicator */}
                <div className={`absolute top-0 left-0 w-full h-1 ${t.isActive ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-slate-300 dark:bg-slate-600'}`} />

                <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${t.isActive ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                            <Layers size={18} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate" title={t.name}>{t.name}</h3>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${t.isActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                                {t.isActive ? 'Đang hoạt động' : 'Đã tắt'}
                            </span>
                        </div>
                    </div>
                    {canManageThisTemplate && <ChevronRight size={16} className="shrink-0 text-slate-300 group-hover:text-accent transition" />}
                </div>

                {t.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{t.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400 font-medium mb-4">
                    <span className="flex items-center gap-1"><Layers size={10} /> {nodeCount} bước</span>
                    <span className="flex items-center gap-1"><GitBranch size={10} /> {instanceCount} phiếu</span>
                    {(t.customFields?.length || 0) > 0 && (
                        <span className="flex items-center gap-1 text-violet-500">📋 {t.customFields.length} trường</span>
                    )}
                    {(t.managers?.length || 0) > 0 && (
                        <span className="flex items-center gap-1 text-amber-500" title={`Quản trị: ${t.managers.map(uid => users.find(u => u.id === uid)?.name || uid).join(', ')}`}>
                            <Shield size={10} /> {t.managers.length}
                        </span>
                    )}
                    {(t.defaultWatchers?.length || 0) > 0 && (
                        <span className="flex items-center gap-1 text-blue-500" title={`Theo dõi: ${t.defaultWatchers.map(uid => users.find(u => u.id === uid)?.name || uid).join(', ')}`}>
                            <Eye size={10} /> {t.defaultWatchers.length}
                        </span>
                    )}
                    <span className="flex items-center gap-1"><Clock size={10} /> {new Date(t.createdAt).toLocaleDateString('vi-VN')}</span>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 min-w-0">
                        <User size={10} />
                        <span className="truncate">{creator?.name || 'N/A'}</span>
                    </div>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {canPublishWorkflowTemplates && (
                            <button
                                onClick={() => handleToggleActive(t)}
                                className={`p-1.5 rounded-lg transition ${t.isActive ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                title={t.isActive ? 'Tắt quy trình' : 'Bật quy trình'}
                                aria-label={t.isActive ? 'Tắt quy trình' : 'Bật quy trình'}
                            >
                                {t.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            </button>
                        )}
                        {canCreateWorkflowTemplates && (
                            <button
                                onClick={() => openCloneModal(t)}
                                className="p-1.5 rounded-lg text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition"
                                title="Nhân bản quy trình"
                                aria-label="Nhân bản quy trình"
                            >
                                <Copy size={14} />
                            </button>
                        )}
                        {canManageThisTemplate && (
                            <button
                                onClick={() => openEditModal(t)}
                                className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                                title="Sửa thông tin"
                                aria-label="Sửa thông tin"
                            >
                                <Edit2 size={14} />
                            </button>
                        )}
                        {isSystemAdmin && (
                            <button
                                onClick={() => setDeleteConfirmId(t.id)}
                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                                title="Xóa quy trình"
                                aria-label="Xóa quy trình"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const groupChips = [
        { key: ALL_GROUPS, name: 'Tất cả', count: filtered.length },
        ...categories.map(c => ({ key: c.id, name: c.name, count: countByGroup.get(c.id) || 0 })),
        ...((countByGroup.get(UNCATEGORIZED) || 0) > 0 || activeGroup === UNCATEGORIZED
            ? [{ key: UNCATEGORIZED, name: 'Chưa phân nhóm', count: countByGroup.get(UNCATEGORIZED) || 0 }]
            : []),
    ];

    const cloneStepCount = cloneSource ? getTemplateNodes(cloneSource.id).filter(n => n.type !== WorkflowNodeType.START && n.type !== WorkflowNodeType.END).length : 0;
    const groupPendingDelete = categories.find(c => c.id === groupDeleteId) || null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <GitBranch className="text-accent" size={28} /> Quản lý Quy trình
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Thiết kế và quản lý các mẫu quy trình duyệt phiếu, gom theo phòng ban.</p>
                </div>
                <div className="flex w-full md:w-auto gap-2">
                    {canManageGroups && (
                        <button
                            onClick={() => setShowGroupManager(true)}
                            className="flex flex-1 md:flex-none items-center justify-center px-4 py-2.5 border border-slate-200 dark:border-slate-600 bg-white/70 dark:bg-slate-800/60 text-slate-600 dark:text-slate-200 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition font-bold text-sm"
                        >
                            <FolderCog size={17} className="mr-2" /> Quản lý nhóm
                        </button>
                    )}
                    {canCreateWorkflowTemplates && (
                        <button
                            onClick={() => openCreateModal(activeGroup !== ALL_GROUPS && activeGroup !== UNCATEGORIZED ? activeGroup : null)}
                            className="flex flex-1 md:flex-none items-center justify-center px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-emerald-600 transition font-bold shadow-lg shadow-emerald-500/20 text-sm"
                        >
                            <Plus size={18} className="mr-2" /> Tạo quy trình mới
                        </button>
                    )}
                </div>
            </div>

            {/* Search + status */}
            <div className="glass-card p-4 rounded-xl flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input
                        type="text" placeholder="Tìm kiếm quy trình..."
                        value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-accent text-sm"
                    />
                </div>
                <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 p-1 text-xs font-bold">
                    {([['all', 'Tất cả'], ['active', 'Đang bật'], ['inactive', 'Đã tắt']] as Array<[StatusFilter, string]>).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setStatusFilter(value)}
                            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg transition ${statusFilter === value ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Group chips */}
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {groupChips.map(chip => {
                    const selected = activeGroup === chip.key;
                    return (
                        <button
                            key={chip.key}
                            type="button"
                            onClick={() => setActiveGroup(chip.key)}
                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${selected
                                ? 'border-accent bg-accent text-white shadow-md shadow-emerald-500/20'
                                : 'border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:border-accent/60'}`}
                        >
                            {chip.key !== ALL_GROUPS && <FolderOpen size={13} />}
                            {chip.name}
                            <span className={`rounded-full px-1.5 text-[10px] ${selected ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>{chip.count}</span>
                        </button>
                    );
                })}
            </div>

            {/* Catalog */}
            {filtered.length === 0 && activeGroup === ALL_GROUPS && isFiltering ? (
                <div className="text-center py-16 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <Search className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-500 font-bold">Không tìm thấy quy trình phù hợp.</p>
                    <button type="button" onClick={() => { setSearchTerm(''); setStatusFilter('all'); }} className="mt-2 text-sm font-bold text-accent hover:underline">Xóa bộ lọc</button>
                </div>
            ) : visibleTemplates.length === 0 && categories.length === 0 ? (
                <div className="text-center py-20 glass-card rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <GitBranch className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold">Chưa có quy trình nào.</p>
                    <p className="text-sm text-slate-300 dark:text-slate-500">Bấm "Tạo quy trình mới" để bắt đầu.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {sections.map(section => (
                        <section key={section.key}>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                    <FolderOpen size={16} className={section.key === UNCATEGORIZED ? 'text-slate-400' : 'text-accent'} />
                                    {section.name}
                                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">{section.items.length}</span>
                                </h2>
                                {canCreateWorkflowTemplates && section.key !== UNCATEGORIZED && (
                                    <button
                                        type="button"
                                        onClick={() => openCreateModal(section.key)}
                                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-accent hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                    >
                                        <Plus size={14} /> Thêm vào nhóm
                                    </button>
                                )}
                            </div>
                            {section.items.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {section.items.map(renderCard)}
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-6 text-center text-xs font-medium text-slate-400">
                                    {isFiltering ? 'Không có quy trình phù hợp trong nhóm này.' : 'Nhóm chưa có quy trình. Tạo mới, hoặc sửa một quy trình có sẵn để chuyển vào nhóm.'}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <ModalShell
                    title={<><Plus size={20} className="text-accent" /> Tạo quy trình mới</>}
                    onClose={() => { setShowCreateModal(false); setCreateError(''); }}
                    footer={<>
                        <button onClick={() => { setShowCreateModal(false); setCreateError(''); }} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                        <button onClick={handleCreate} disabled={!newName.trim() || isSubmitting} className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20">{isSubmitting ? 'Đang tạo...' : 'Tạo & Thiết kế'}</button>
                    </>}
                >
                    <div>
                        <label className={labelClass}>Tên quy trình *</label>
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="VD: Đề nghị thanh toán, Xin nghỉ phép..."
                            className={inputClass}
                            autoFocus
                        />
                    </div>
                    <CategorySelect value={newCategoryId} onChange={setNewCategoryId} categories={categories} />
                    <div>
                        <label className={labelClass}>Mô tả</label>
                        <textarea
                            value={newDesc}
                            onChange={e => setNewDesc(e.target.value)}
                            placeholder="Mô tả ngắn về quy trình này..."
                            className={`${inputClass} resize-none`}
                            rows={3}
                        />
                    </div>
                    <UserPicker selected={newManagers} onChange={setNewManagers} label="Quản trị viên" icon={<Shield size={12} className="text-amber-500" />} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
                    <UserPicker selected={newWatchers} onChange={setNewWatchers} label="Người theo dõi mặc định" icon={<Eye size={12} className="text-blue-500" />} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
                    {createError && (
                        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                            {createError}
                        </div>
                    )}
                </ModalShell>
            )}

            {/* Clone Modal */}
            {cloneSource && (
                <ModalShell
                    title={<><Copy size={20} className="text-violet-500" /> Nhân bản quy trình</>}
                    onClose={() => setCloneSource(null)}
                    footer={<>
                        <button onClick={() => setCloneSource(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                        <button onClick={handleClone} disabled={!cloneName.trim() || isSubmitting} className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20">{isSubmitting ? 'Đang nhân bản...' : 'Nhân bản & mở'}</button>
                    </>}
                >
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Sao chép từ <span className="font-bold text-slate-700 dark:text-slate-200">{cloneSource.name}</span>
                    </p>
                    <div>
                        <label className={labelClass}>Tên bản sao *</label>
                        <input type="text" value={cloneName} onChange={e => setCloneName(e.target.value)} className={inputClass} autoFocus />
                    </div>
                    <CategorySelect value={cloneCategoryId} onChange={setCloneCategoryId} categories={categories} />
                    <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-xs text-violet-800 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200">
                        <p className="font-bold mb-1.5">Giữ nguyên toàn bộ cài đặt:</p>
                        <ul className="space-y-1">
                            <li className="flex items-center gap-1.5"><Check size={12} /> {cloneStepCount} bước cùng người xử lý, người theo dõi, SLA</li>
                            <li className="flex items-center gap-1.5"><Check size={12} /> {cloneSource.customFields?.length || 0} trường tùy chỉnh</li>
                            <li className="flex items-center gap-1.5"><Check size={12} /> {cloneSource.managers?.length || 0} quản trị viên, {cloneSource.defaultWatchers?.length || 0} người theo dõi mặc định</li>
                            <li className="flex items-center gap-1.5"><Check size={12} /> Các mẫu in</li>
                        </ul>
                        <p className="mt-2 font-medium opacity-80">Bản sao ở trạng thái <b>Đã tắt</b> để anh/chị chỉnh sửa trước khi bật cho nhân viên dùng. Phiếu của quy trình gốc không bị sao chép.</p>
                    </div>
                </ModalShell>
            )}

            {/* Delete Confirm Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
                        <h2 className="text-lg font-bold text-red-600 mb-2">Xóa quy trình?</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Chỉ xóa được mẫu chưa có phiếu, phiên bản hoặc liên kết sử dụng. Mẫu đã sử dụng cần được tắt thay vì xóa.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                            <button disabled={isDeleting} onClick={() => handleDelete(deleteConfirmId)} className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition shadow-lg shadow-red-500/20 disabled:cursor-not-allowed disabled:opacity-60">{isDeleting ? 'Đang xóa...' : 'Xóa'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingTemplate && (
                <ModalShell
                    title={<><Edit2 size={20} className="text-blue-500" /> Sửa quy trình</>}
                    onClose={() => setEditingTemplate(null)}
                    footer={<>
                        <button onClick={() => setEditingTemplate(null)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Hủy</button>
                        <button onClick={handleEdit} disabled={!editName.trim() || isSubmitting} className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition disabled:opacity-50 shadow-lg shadow-blue-500/20">{isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
                    </>}
                >
                    <div>
                        <label className={labelClass}>Tên quy trình *</label>
                        <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={inputClass} autoFocus />
                    </div>
                    <CategorySelect value={editCategoryId} onChange={setEditCategoryId} categories={categories} />
                    <div>
                        <label className={labelClass}>Mô tả</label>
                        <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className={`${inputClass} resize-none`} rows={3} />
                    </div>
                    <UserPicker selected={editManagers} onChange={setEditManagers} label="Quản trị viên" icon={<Shield size={12} className="text-amber-500" />} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
                    <UserPicker selected={editWatchers} onChange={setEditWatchers} label="Người theo dõi mặc định" icon={<Eye size={12} className="text-blue-500" />} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
                </ModalShell>
            )}

            {/* Group Manager Modal */}
            {showGroupManager && (
                <ModalShell
                    title={<><FolderCog size={20} className="text-accent" /> Nhóm quy trình</>}
                    onClose={() => { setShowGroupManager(false); setGroupDeleteId(null); setGroupDrafts({}); }}
                    footer={<button onClick={() => { setShowGroupManager(false); setGroupDeleteId(null); setGroupDrafts({}); }} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition">Xong</button>}
                >
                    <p className="text-xs text-slate-500 dark:text-slate-400">Nhóm giúp gom quy trình theo phòng ban trên danh sách. Nhóm không ảnh hưởng quyền hay luồng duyệt.</p>
                    <div className="space-y-2">
                        {categories.length === 0 && (
                            <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-3 py-4 text-center text-xs text-slate-400">Chưa có nhóm nào.</p>
                        )}
                        {categories.map((category, index) => {
                            const draft = groupDrafts[category.id] ?? category.name;
                            const dirty = draft.trim() !== category.name && !!draft.trim();
                            const count = templateCountInCategory(category.id);
                            return (
                                <div key={category.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-2">
                                    <div className="flex items-center gap-1.5">
                                        <div className="flex flex-col">
                                            <button type="button" onClick={() => handleMoveGroup(index, -1)} disabled={index === 0 || groupBusy} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" aria-label="Lên"><ChevronUp size={14} /></button>
                                            <button type="button" onClick={() => handleMoveGroup(index, 1)} disabled={index === categories.length - 1 || groupBusy} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" aria-label="Xuống"><ChevronDown size={14} /></button>
                                        </div>
                                        <input
                                            value={draft}
                                            onChange={e => setGroupDrafts(prev => ({ ...prev, [category.id]: e.target.value }))}
                                            onKeyDown={e => { if (e.key === 'Enter') void handleRenameGroup(category); }}
                                            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none hover:border-slate-200 focus:border-accent focus:bg-white dark:focus:bg-slate-700"
                                            aria-label="Tên nhóm"
                                        />
                                        <span className="shrink-0 text-[10px] font-bold text-slate-400">{count} QT</span>
                                        {dirty ? (
                                            <button type="button" onClick={() => handleRenameGroup(category)} disabled={groupBusy} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50" title="Lưu tên" aria-label="Lưu tên"><Check size={15} /></button>
                                        ) : (
                                            <button type="button" onClick={() => setGroupDeleteId(category.id)} disabled={groupBusy} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50" title="Xóa nhóm" aria-label="Xóa nhóm"><Trash2 size={14} /></button>
                                        )}
                                    </div>
                                    {groupPendingDelete?.id === category.id && (
                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                                            <span>{count > 0 ? `${count} quy trình sẽ chuyển về "Chưa phân nhóm".` : 'Xóa nhóm trống này?'}</span>
                                            <span className="flex gap-2">
                                                <button type="button" onClick={() => setGroupDeleteId(null)} className="font-bold text-slate-500 hover:underline">Hủy</button>
                                                <button type="button" onClick={() => handleDeleteGroup(category.id)} disabled={groupBusy} className="font-bold text-red-600 hover:underline disabled:opacity-50">Xóa nhóm</button>
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex gap-2">
                        <input
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleAddGroup(); }}
                            placeholder="Tên nhóm mới, VD: Phòng Kế toán"
                            className={inputClass}
                        />
                        <button type="button" onClick={handleAddGroup} disabled={!newGroupName.trim() || groupBusy} className="shrink-0 inline-flex items-center gap-1 px-4 rounded-xl bg-accent text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50">
                            <Plus size={16} /> Thêm
                        </button>
                    </div>
                </ModalShell>
            )}
        </div>
    );
};

export default WorkflowTemplates;
