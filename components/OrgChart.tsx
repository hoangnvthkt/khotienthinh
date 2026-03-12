import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { OrgUnit, OrgUnitType } from '../types';
import {
    Building2, HardHat, Factory, FolderTree, Plus, Trash2, Edit2, X, Check,
    ChevronDown, ChevronRight, MoreVertical, Layers, GitBranch
} from 'lucide-react';

const TYPE_CONFIG: Record<OrgUnitType, { label: string; icon: typeof Building2; color: string; bgGrad: string }> = {
    company: { label: 'Tổng công ty', icon: Building2, color: '#6366f1', bgGrad: 'linear-gradient(135deg, #6366f1, #818cf8)' },
    department: { label: 'Phòng / Ban', icon: FolderTree, color: '#0ea5e9', bgGrad: 'linear-gradient(135deg, #0ea5e9, #38bdf8)' },
    construction_site: { label: 'Công trường', icon: HardHat, color: '#f97316', bgGrad: 'linear-gradient(135deg, #f97316, #fb923c)' },
    factory: { label: 'Nhà máy', icon: Factory, color: '#8b5cf6', bgGrad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
    custom: { label: 'Tuỳ chỉnh', icon: Layers, color: '#10b981', bgGrad: 'linear-gradient(135deg, #10b981, #34d399)' },
};

// ========== CSS STYLES (Injected once) ==========
const OrgChartStyles = () => (
    <style>{`
    @keyframes marchingAnts {
      to { stroke-dashoffset: -20; }
    }
    .org-line {
      stroke-dasharray: 8 6;
      animation: marchingAnts 0.8s linear infinite;
      stroke-width: 2;
      fill: none;
    }
    .org-node-card {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: top center;
    }
    .org-node-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.12);
    }
    @keyframes nodeAppear {
      from { opacity: 0; transform: scale(0.85) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .org-node-enter { animation: nodeAppear 0.35s ease-out forwards; }
    .org-actions-menu {
      opacity: 0; pointer-events: none;
      transition: opacity 0.2s; position: absolute;
      right: -8px; top: 50%; transform: translateY(-50%);
    }
    .org-node-card:hover .org-actions-menu,
    .org-actions-menu.force-show {
      opacity: 1; pointer-events: all;
    }
    .org-tree-branch {
      position: relative;
      padding-left: 40px;
    }
    .org-tree-branch::before {
      content: '';
      position: absolute;
      left: 20px;
      top: 0;
      bottom: 20px;
      width: 2px;
      background: repeating-linear-gradient(
        to bottom,
        rgba(148,163,184,0.4) 0px,
        rgba(148,163,184,0.4) 6px,
        transparent 6px,
        transparent 12px
      );
    }
  `}</style>
);

// ========= OrgNode - single tree node =========
interface OrgNodeProps {
    unit: OrgUnit;
    allUnits: OrgUnit[];
    depth: number;
    onAdd: (parentId: string) => void;
    onEdit: (unit: OrgUnit) => void;
    onDelete: (id: string) => void;
}

const OrgNode: React.FC<OrgNodeProps> = ({ unit, allUnits, depth, onAdd, onEdit, onDelete }) => {
    const [expanded, setExpanded] = useState(true);
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const children = allUnits
        .filter(u => u.parentId === unit.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);

    const cfg = TYPE_CONFIG[unit.type] || TYPE_CONFIG.custom;
    const Icon = cfg.icon;

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
        };
        if (showMenu) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showMenu]);

    return (
        <div className="org-node-enter" style={{ marginBottom: children.length > 0 ? 4 : 0 }}>
            {/* Node card */}
            <div className="org-node-card relative flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg shadow-sm"
                style={{ borderLeft: `4px solid ${cfg.color}` }}>
                {/* Expand/Collapse toggle */}
                {children.length > 0 && (
                    <button onClick={() => setExpanded(!expanded)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors -ml-1">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                )}

                {/* Icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                    style={{ background: cfg.bgGrad }}>
                    <Icon size={18} className="text-white" />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-slate-800 dark:text-white truncate">{unit.name}</div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
                        {unit.description && <span className="text-xs text-slate-400 truncate max-w-[180px]">{unit.description}</span>}
                    </div>
                </div>

                {/* Count badge */}
                {children.length > 0 && (
                    <div className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                        {children.length}
                    </div>
                )}

                {/* Actions */}
                <div ref={menuRef} className={`org-actions-menu ${showMenu ? 'force-show' : ''}`}>
                    <button onClick={() => setShowMenu(!showMenu)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-white dark:bg-slate-700 shadow-md border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors">
                        <MoreVertical size={14} />
                    </button>
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50 min-w-[160px] overflow-hidden">
                            <button onClick={() => { onAdd(unit.id); setShowMenu(false); }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-2 transition-colors">
                                <Plus size={14} className="text-emerald-500" /> Thêm nhánh con
                            </button>
                            <button onClick={() => { onEdit(unit); setShowMenu(false); }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 transition-colors">
                                <Edit2 size={14} className="text-blue-500" /> Chỉnh sửa
                            </button>
                            <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                            <button onClick={() => { onDelete(unit.id); setShowMenu(false); }}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 transition-colors">
                                <Trash2 size={14} /> Xoá {children.length > 0 ? `(+ ${children.length} nhánh con)` : ''}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Children */}
            {expanded && children.length > 0 && (
                <div className="org-tree-branch mt-2">
                    {children.map(child => (
                        <div key={child.id} className="relative mb-2">
                            {/* Horizontal dash connector */}
                            <div className="absolute left-[-20px] top-[22px] w-[20px] h-[2px]"
                                style={{
                                    background: `repeating-linear-gradient(to right, ${TYPE_CONFIG[child.type]?.color || '#94a3b8'}80 0px, ${TYPE_CONFIG[child.type]?.color || '#94a3b8'}80 6px, transparent 6px, transparent 12px)`
                                }} />
                            <OrgNode unit={child} allUnits={allUnits} depth={depth + 1}
                                onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ========== ADD / EDIT MODAL ==========
interface OrgUnitModalProps {
    isOpen: boolean;
    editUnit?: OrgUnit | null;
    parentId?: string | null;
    allUnits: OrgUnit[];
    onClose: () => void;
    onSave: (unit: OrgUnit) => void;
}

const OrgUnitModal: React.FC<OrgUnitModalProps> = ({ isOpen, editUnit, parentId, allUnits, onClose, onSave }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<OrgUnitType>('department');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (editUnit) { setName(editUnit.name); setType(editUnit.type); setDescription(editUnit.description || ''); }
        else { setName(''); setType(parentId ? 'department' : 'company'); setDescription(''); }
    }, [editUnit, parentId, isOpen]);

    if (!isOpen) return null;

    const parentUnit = parentId ? allUnits.find(u => u.id === parentId) : null;
    const siblings = allUnits.filter(u => u.parentId === (editUnit?.parentId ?? parentId));

    const handleSave = () => {
        if (!name.trim()) return;
        const unit: OrgUnit = {
            id: editUnit?.id || crypto.randomUUID(),
            name: name.trim(),
            type,
            parentId: editUnit ? editUnit.parentId : (parentId || null),
            description: description.trim() || undefined,
            orderIndex: editUnit?.orderIndex ?? siblings.length,
            createdAt: editUnit?.createdAt || new Date().toISOString(),
        };
        onSave(unit);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div onClick={e => e.stopPropagation()}
                className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between"
                    style={{ background: TYPE_CONFIG[type]?.bgGrad || TYPE_CONFIG.custom.bgGrad }}>
                    <div className="flex items-center gap-3 text-white">
                        <GitBranch size={20} />
                        <span className="font-bold text-lg">{editUnit ? 'Chỉnh sửa đơn vị' : 'Thêm đơn vị mới'}</span>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/20 hover:bg-white/30 text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Parent info */}
                    {parentUnit && (
                        <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                            Thuộc: <span className="font-bold text-slate-700 dark:text-white">{parentUnit.name}</span>
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tên đơn vị *</label>
                        <input value={name} onChange={e => setName(e.target.value)} autoFocus
                            placeholder="VD: Phòng kế toán, Công trường A..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" />
                    </div>

                    {/* Type */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Loại đơn vị</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.entries(TYPE_CONFIG) as [OrgUnitType, typeof TYPE_CONFIG.company][]).map(([key, cfg]) => {
                                const Icon = cfg.icon;
                                return (
                                    <button key={key} onClick={() => setType(key)}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${type === key
                                                ? 'border-current shadow-md scale-[1.02]'
                                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                                            }`}
                                        style={type === key ? { borderColor: cfg.color, color: cfg.color, background: `${cfg.color}08` } : {}}>
                                        <Icon size={16} />
                                        {cfg.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Mô tả</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                            placeholder="Mô tả thêm (tuỳ chọn)"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none transition-all" />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Huỷ</button>
                    <button onClick={handleSave} disabled={!name.trim()}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: TYPE_CONFIG[type]?.bgGrad || TYPE_CONFIG.custom.bgGrad }}>
                        <span className="flex items-center gap-2"><Check size={16} /> {editUnit ? 'Cập nhật' : 'Thêm mới'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

// ========== MAIN ORG CHART COMPONENT ==========
const OrgChart: React.FC = () => {
    const { orgUnits, addOrgUnit, updateOrgUnit, removeOrgUnit } = useApp();
    const [modalOpen, setModalOpen] = useState(false);
    const [editUnit, setEditUnit] = useState<OrgUnit | null>(null);
    const [addParentId, setAddParentId] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const rootUnits = orgUnits
        .filter(u => !u.parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex);

    const handleAdd = (parentId?: string) => {
        setEditUnit(null);
        setAddParentId(parentId || null);
        setModalOpen(true);
    };

    const handleEdit = (unit: OrgUnit) => {
        setEditUnit(unit);
        setAddParentId(null);
        setModalOpen(true);
    };

    const handleSave = (unit: OrgUnit) => {
        if (editUnit) updateOrgUnit(unit);
        else addOrgUnit(unit);
    };

    const handleDelete = (id: string) => {
        const children = orgUnits.filter(u => u.parentId === id);
        if (children.length > 0) {
            setConfirmDelete(id);
        } else {
            removeOrgUnit(id);
        }
    };

    return (
        <div className="space-y-6">
            <OrgChartStyles />

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                        <GitBranch size={24} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-800 dark:text-white">Sơ đồ tổ chức</h2>
                        <p className="text-sm text-slate-500">Quản lý cấu trúc tổ chức — phòng ban, công trường, nhà máy</p>
                    </div>
                </div>
                <button onClick={() => handleAdd()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all">
                    <Plus size={18} /> Thêm gốc
                </button>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3">
                {(Object.entries(TYPE_CONFIG) as [OrgUnitType, typeof TYPE_CONFIG.company][]).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const count = orgUnits.filter(u => u.type === key).length;
                    return (
                        <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border"
                            style={{ borderColor: `${cfg.color}40`, color: cfg.color, background: `${cfg.color}08` }}>
                            <Icon size={13} /> {cfg.label} ({count})
                        </div>
                    );
                })}
            </div>

            {/* Tree */}
            {rootUnits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center mb-4">
                        <GitBranch size={36} className="text-indigo-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 dark:text-slate-300 mb-1">Chưa có sơ đồ tổ chức</h3>
                    <p className="text-sm text-slate-400 mb-4">Bắt đầu bằng cách thêm đơn vị gốc (Tổng công ty)</p>
                    <button onClick={() => handleAdd()}
                        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm shadow-lg hover:shadow-xl transition-all">
                        <Plus size={18} /> Tạo sơ đồ tổ chức
                    </button>
                </div>
            ) : (
                <div className="bg-white/50 dark:bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-6">
                    {rootUnits.map(root => (
                        <OrgNode key={root.id} unit={root} allUnits={orgUnits} depth={0}
                            onAdd={(pid) => handleAdd(pid)} onEdit={handleEdit} onDelete={handleDelete} />
                    ))}
                </div>
            )}

            {/* Modal */}
            <OrgUnitModal isOpen={modalOpen} editUnit={editUnit} parentId={addParentId}
                allUnits={orgUnits} onClose={() => setModalOpen(false)} onSave={handleSave} />

            {/* Delete confirmation */}
            {confirmDelete && (() => {
                const target = orgUnits.find(u => u.id === confirmDelete);
                const childCount = orgUnits.filter(u => u.parentId === confirmDelete).length;
                return (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
                        onClick={() => setConfirmDelete(null)}>
                        <div onClick={e => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-red-200 dark:border-red-800/40 w-full max-w-sm mx-4 p-6 text-center">
                            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                                <Trash2 size={28} className="text-red-500" />
                            </div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-2">Xoá "{target?.name}"?</h3>
                            <p className="text-sm text-slate-500 mb-6">Hành động này sẽ xoá đơn vị này và <strong className="text-red-500">{childCount} đơn vị con</strong> bên trong.</p>
                            <div className="flex gap-3">
                                <button onClick={() => setConfirmDelete(null)}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 transition-colors">Huỷ</button>
                                <button onClick={() => { removeOrgUnit(confirmDelete); setConfirmDelete(null); }}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-500 to-rose-600 shadow-lg hover:shadow-xl transition-all">Xoá tất cả</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default OrgChart;
