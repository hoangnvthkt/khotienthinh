
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflow } from '../../context/WorkflowContext';
import { useApp } from '../../context/AppContext';
import { WorkflowNode, WorkflowEdge, WorkflowNodeType, Role } from '../../types';
import {
    ArrowLeft, Save, Play, CheckCircle, Circle, Square, Trash2,
    Plus, GripVertical, Zap, UserCheck, Flag, Settings2, X
} from 'lucide-react';

const NODE_COLORS: Record<WorkflowNodeType, { bg: string; border: string; text: string; icon: any }> = {
    START: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-700 dark:text-emerald-300', icon: Play },
    ACTION: { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-300 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-300', icon: Zap },
    APPROVAL: { bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300', icon: UserCheck },
    END: { bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-300 dark:border-red-700', text: 'text-red-700 dark:text-red-300', icon: Flag },
};

const NODE_LABELS: Record<WorkflowNodeType, string> = {
    START: 'Bắt đầu',
    ACTION: 'Hành động',
    APPROVAL: 'Duyệt',
    END: 'Kết thúc',
};

const WorkflowBuilder: React.FC = () => {
    const { id: templateId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { templates, getTemplateNodes, getTemplateEdges, saveNodesAndEdges, updateTemplate } = useWorkflow();
    const { users } = useApp();

    const template = templates.find(t => t.id === templateId);
    const canvasRef = useRef<HTMLDivElement>(null);

    const [localNodes, setLocalNodes] = useState<WorkflowNode[]>([]);
    const [localEdges, setLocalEdges] = useState<WorkflowEdge[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isSaving, setIsSaving] = useState(false);
    const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (templateId) {
            setLocalNodes(getTemplateNodes(templateId));
            setLocalEdges(getTemplateEdges(templateId));
        }
    }, [templateId, templates]);

    const generateId = () => crypto.randomUUID();

    const addNode = (type: WorkflowNodeType) => {
        // Check constraints
        if (type === WorkflowNodeType.START && localNodes.some(n => n.type === WorkflowNodeType.START)) return;
        if (type === WorkflowNodeType.END && localNodes.some(n => n.type === WorkflowNodeType.END)) return;

        const newNode: WorkflowNode = {
            id: generateId(),
            templateId: templateId!,
            type,
            label: NODE_LABELS[type],
            config: {},
            positionX: 100 + Math.random() * 300,
            positionY: 80 + localNodes.length * 120,
        };
        setLocalNodes(prev => [...prev, newNode]);
        setHasChanges(true);
    };

    const removeNode = (nodeId: string) => {
        setLocalNodes(prev => prev.filter(n => n.id !== nodeId));
        setLocalEdges(prev => prev.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
        if (selectedNodeId === nodeId) setSelectedNodeId(null);
        setHasChanges(true);
    };

    const handleCanvasMouseDown = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        const rect = canvasRef.current!.getBoundingClientRect();
        const node = localNodes.find(n => n.id === nodeId)!;
        setDraggingNodeId(nodeId);
        setDragOffset({
            x: e.clientX - rect.left - node.positionX,
            y: e.clientY - rect.top - node.positionY,
        });
        setSelectedNodeId(nodeId);
    };

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
        if (!draggingNodeId || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left - dragOffset.x);
        const y = Math.max(0, e.clientY - rect.top - dragOffset.y);
        setLocalNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, positionX: x, positionY: y } : n));
        setHasChanges(true);
    }, [draggingNodeId, dragOffset]);

    const handleCanvasMouseUp = () => {
        setDraggingNodeId(null);
    };

    const handleStartConnect = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        if (connectingFrom === null) {
            setConnectingFrom(nodeId);
        } else if (connectingFrom !== nodeId) {
            // Check if edge already exists
            const exists = localEdges.some(e => e.sourceNodeId === connectingFrom && e.targetNodeId === nodeId);
            if (!exists) {
                const newEdge: WorkflowEdge = {
                    id: generateId(),
                    templateId: templateId!,
                    sourceNodeId: connectingFrom,
                    targetNodeId: nodeId,
                    label: '',
                };
                setLocalEdges(prev => [...prev, newEdge]);
                setHasChanges(true);
            }
            setConnectingFrom(null);
        }
    };

    const removeEdge = (edgeId: string) => {
        setLocalEdges(prev => prev.filter(e => e.id !== edgeId));
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!templateId) return;
        setIsSaving(true);
        await saveNodesAndEdges(templateId, localNodes, localEdges);
        setHasChanges(false);
        setIsSaving(false);
    };

    const handleUpdateNodeLabel = (nodeId: string, label: string) => {
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n));
        setHasChanges(true);
    };

    const handleUpdateNodeConfig = (nodeId: string, config: WorkflowNode['config']) => {
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config } : n));
        setHasChanges(true);
    };

    // Calculate edge paths between nodes
    const getEdgePath = (edge: WorkflowEdge) => {
        const source = localNodes.find(n => n.id === edge.sourceNodeId);
        const target = localNodes.find(n => n.id === edge.targetNodeId);
        if (!source || !target) return '';
        const sx = source.positionX + 90; // center of node
        const sy = source.positionY + 28; // bottom of node
        const tx = target.positionX + 90;
        const ty = target.positionY + 28;
        // Bezier curve
        const midY = (sy + ty) / 2;
        return `M ${sx} ${sy + 20} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty - 20}`;
    };

    if (!template) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <Square size={48} className="mb-4 opacity-20" />
                <h2 className="text-xl font-black">Không tìm thấy quy trình</h2>
                <button onClick={() => navigate('/wf/templates')} className="mt-4 text-accent hover:underline font-bold text-sm">← Quay lại</button>
            </div>
        );
    }

    const selectedNode = localNodes.find(n => n.id === selectedNodeId);

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col overflow-hidden">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 glass-card rounded-xl mb-3">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/wf/templates')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 className="font-bold text-sm text-slate-800 dark:text-white">{template.name}</h1>
                        <p className="text-[10px] text-slate-400">{template.description || 'Chưa có mô tả'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {connectingFrom && (
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg animate-pulse">
                            🔗 Chọn node đích để kết nối...
                        </span>
                    )}
                    {hasChanges && (
                        <span className="text-[10px] font-bold text-amber-500">• Chưa lưu</span>
                    )}
                    <button
                        onClick={() => { setConnectingFrom(null); }}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${connectingFrom ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
                    >
                        {connectingFrom ? <><X size={12} /> Hủy kết nối</> : <>🔗 Kết nối</>}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        className="flex items-center px-4 py-2 bg-accent text-white rounded-xl text-xs font-bold hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                    >
                        <Save size={14} className="mr-1.5" /> {isSaving ? 'Đang lưu...' : 'Lưu'}
                    </button>
                </div>
            </div>

            <div className="flex-1 flex gap-3 min-h-0">
                {/* Left Palette */}
                <div className="w-48 shrink-0 glass-card rounded-xl p-3 space-y-2 overflow-auto">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Thêm bước</p>
                    {([WorkflowNodeType.START, WorkflowNodeType.ACTION, WorkflowNodeType.APPROVAL, WorkflowNodeType.END] as const).map(type => {
                        const colors = NODE_COLORS[type];
                        const Icon = colors.icon;
                        const disabled = (type === WorkflowNodeType.START && localNodes.some(n => n.type === WorkflowNodeType.START)) ||
                            (type === WorkflowNodeType.END && localNodes.some(n => n.type === WorkflowNodeType.END));
                        return (
                            <button
                                key={type}
                                onClick={() => addNode(type)}
                                disabled={disabled}
                                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition border ${colors.bg} ${colors.border} ${colors.text} hover:shadow-md disabled:opacity-30 disabled:cursor-not-allowed`}
                            >
                                <Icon size={14} /> {NODE_LABELS[type]}
                            </button>
                        );
                    })}

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Hướng dẫn</p>
                        <div className="text-[10px] text-slate-400 space-y-1.5">
                            <p>• Kéo để di chuyển node</p>
                            <p>• Bấm <span className="font-bold text-accent">🔗 Kết nối</span> rồi chọn 2 node để nối</p>
                            <p>• Bấm vào node → chỉnh sửa bên phải</p>
                            <p>• Bấm <span className="font-bold text-accent">Lưu</span> để lưu thay đổi</p>
                        </div>
                    </div>
                </div>

                {/* Canvas */}
                <div
                    ref={canvasRef}
                    className="flex-1 glass-card rounded-xl relative overflow-auto cursor-crosshair"
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onClick={() => { setSelectedNodeId(null); }}
                    style={{ minHeight: 500 }}
                >
                    {/* Grid pattern */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-slate-300 dark:text-slate-700" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>

                    {/* Edges SVG */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ minWidth: 1200, minHeight: 800 }}>
                        <defs>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                            </marker>
                        </defs>
                        {localEdges.map(edge => (
                            <g key={edge.id}>
                                <path
                                    d={getEdgePath(edge)}
                                    stroke="#94a3b8"
                                    strokeWidth="2"
                                    fill="none"
                                    markerEnd="url(#arrowhead)"
                                    className="transition-all"
                                />
                            </g>
                        ))}
                    </svg>

                    {/* Edge delete buttons */}
                    {localEdges.map(edge => {
                        const source = localNodes.find(n => n.id === edge.sourceNodeId);
                        const target = localNodes.find(n => n.id === edge.targetNodeId);
                        if (!source || !target) return null;
                        const mx = (source.positionX + target.positionX) / 2 + 90;
                        const my = (source.positionY + target.positionY) / 2 + 28;
                        return (
                            <button
                                key={`del-${edge.id}`}
                                onClick={(e) => { e.stopPropagation(); removeEdge(edge.id); }}
                                className="absolute w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] hover:bg-red-600 transition shadow-md z-10 opacity-0 hover:opacity-100"
                                style={{ left: mx - 10, top: my - 10 }}
                                title="Xóa kết nối"
                            >
                                ×
                            </button>
                        );
                    })}

                    {/* Nodes */}
                    {localNodes.map(node => {
                        const colors = NODE_COLORS[node.type];
                        const Icon = colors.icon;
                        const isSelected = selectedNodeId === node.id;
                        const isConnecting = connectingFrom === node.id;
                        return (
                            <div
                                key={node.id}
                                className={`absolute select-none cursor-grab active:cursor-grabbing transition-shadow ${isSelected ? 'z-20' : 'z-10'}`}
                                style={{ left: node.positionX, top: node.positionY }}
                                onMouseDown={(e) => handleCanvasMouseDown(e, node.id)}
                                onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id); }}
                            >
                                <div className={`w-[180px] rounded-xl border-2 shadow-lg transition-all ${colors.bg} ${isSelected ? 'ring-2 ring-accent ring-offset-2' : ''} ${isConnecting ? 'ring-2 ring-amber-400 ring-offset-2 animate-pulse' : ''} ${colors.border}`}>
                                    <div className={`px-3 py-2 flex items-center gap-2 ${colors.text}`}>
                                        <Icon size={14} />
                                        <span className="font-bold text-xs truncate flex-1">{node.label}</span>
                                        {node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END && (
                                            <button onClick={(e) => { e.stopPropagation(); removeNode(node.id); }} className="p-0.5 hover:bg-white/50 rounded transition">
                                                <Trash2 size={10} />
                                            </button>
                                        )}
                                    </div>
                                    {node.config.assigneeRole && (
                                        <div className="px-3 pb-2">
                                            <span className="text-[9px] font-bold text-slate-400 bg-white/60 dark:bg-slate-800/40 px-1.5 py-0.5 rounded">
                                                👤 {node.config.assigneeRole}
                                            </span>
                                        </div>
                                    )}
                                    {node.config.assigneeUserId && (
                                        <div className="px-3 pb-2">
                                            <span className="text-[9px] font-bold text-slate-400 bg-white/60 dark:bg-slate-800/40 px-1.5 py-0.5 rounded">
                                                👤 {users.find(u => u.id === node.config.assigneeUserId)?.name || 'User'}
                                            </span>
                                        </div>
                                    )}

                                    {/* Connection port */}
                                    <div className="flex justify-center pb-1">
                                        <button
                                            onClick={(e) => handleStartConnect(e, node.id)}
                                            className={`w-4 h-4 rounded-full border-2 transition hover:scale-125 ${connectingFrom ? 'bg-amber-400 border-amber-500 animate-pulse' : 'bg-slate-200 border-slate-300 dark:bg-slate-600 dark:border-slate-500 hover:bg-accent hover:border-accent'}`}
                                            title="Kết nối"
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {localNodes.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <Plus size={48} className="text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                                <p className="text-sm text-slate-400 font-bold">Bắt đầu bằng cách thêm node từ palette bên trái</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel - Node Config */}
                {selectedNode && (
                    <div className="w-64 shrink-0 glass-card rounded-xl p-4 space-y-4 overflow-auto">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cấu hình bước</p>
                            <button onClick={() => setSelectedNodeId(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"><X size={14} /></button>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tên bước</label>
                            <input
                                type="text"
                                value={selectedNode.label}
                                onChange={e => handleUpdateNodeLabel(selectedNode.id, e.target.value)}
                                className="w-full px-3 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none focus:ring-2 focus:ring-accent"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Loại</label>
                            <div className={`px-3 py-2 rounded-lg text-xs font-bold ${NODE_COLORS[selectedNode.type].bg} ${NODE_COLORS[selectedNode.type].text}`}>
                                {selectedNode.type}
                            </div>
                        </div>

                        {(selectedNode.type === WorkflowNodeType.APPROVAL || selectedNode.type === WorkflowNodeType.ACTION) && (
                            <>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Phân công theo vai trò</label>
                                    <select
                                        value={selectedNode.config.assigneeRole || ''}
                                        onChange={e => handleUpdateNodeConfig(selectedNode.id, { ...selectedNode.config, assigneeRole: e.target.value as Role || undefined })}
                                        className="w-full px-3 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">-- Không chỉ định --</option>
                                        <option value={Role.ADMIN}>Admin</option>
                                        <option value={Role.KEEPER}>Thủ kho</option>
                                        <option value={Role.ACCOUNTANT}>Kế toán</option>
                                        <option value={Role.EMPLOYEE}>Nhân viên</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Hoặc chỉ định cụ thể</label>
                                    <select
                                        value={selectedNode.config.assigneeUserId || ''}
                                        onChange={e => handleUpdateNodeConfig(selectedNode.id, { ...selectedNode.config, assigneeUserId: e.target.value || undefined })}
                                        className="w-full px-3 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none focus:ring-2 focus:ring-accent"
                                    >
                                        <option value="">-- Không chỉ định --</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">SLA (giờ)</label>
                                    <input
                                        type="number"
                                        value={selectedNode.config.slaHours || ''}
                                        onChange={e => handleUpdateNodeConfig(selectedNode.id, { ...selectedNode.config, slaHours: Number(e.target.value) || undefined })}
                                        placeholder="VD: 24"
                                        className="w-full px-3 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none focus:ring-2 focus:ring-accent"
                                    />
                                </div>
                            </>
                        )}

                        {selectedNode.type !== WorkflowNodeType.START && selectedNode.type !== WorkflowNodeType.END && (
                            <button
                                onClick={() => removeNode(selectedNode.id)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 rounded-lg text-xs font-bold hover:bg-red-100 transition"
                            >
                                <Trash2 size={12} /> Xóa bước này
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkflowBuilder;
