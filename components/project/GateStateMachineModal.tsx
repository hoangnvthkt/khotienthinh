import React, { useState } from 'react';
import {
    X, CheckCircle2, XCircle, Clock, Shield, AlertTriangle,
    ChevronRight, User, Calendar, FileText, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { ProjectTask, GateStatus } from '../../types';

interface GateStateMachineModalProps {
    task: ProjectTask | null;
    onClose: () => void;
    onTransition: (taskId: string, status: GateStatus, reason?: string) => Promise<void>;
}

// State machine definition
const GATE_STATES: Record<GateStatus, {
    label: string;
    color: string;
    bg: string;
    border: string;
    icon: React.ElementType;
    description: string;
}> = {
    none: {
        label: 'Chưa nghiệm thu',
        color: 'text-slate-500',
        bg: 'bg-slate-50 dark:bg-slate-800',
        border: 'border-slate-200 dark:border-slate-600',
        icon: Clock,
        description: 'Task hoàn thành 100%, chờ nộp nghiệm thu nội bộ',
    },
    pending: {
        label: 'Chờ duyệt',
        color: 'text-amber-600',
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        border: 'border-amber-300 dark:border-amber-700',
        icon: Clock,
        description: 'Đã nộp nghiệm thu, đang chờ quản lý xem xét',
    },
    approved: {
        label: 'Đã duyệt ✓',
        color: 'text-emerald-600',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        border: 'border-emerald-300 dark:border-emerald-700',
        icon: CheckCircle2,
        description: 'Nghiệm thu nội bộ thành công. Task kế tiếp có thể bắt đầu.',
    },
    rejected: {
        label: 'Bị từ chối',
        color: 'text-red-600',
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-300 dark:border-red-700',
        icon: XCircle,
        description: 'Chất lượng chưa đạt yêu cầu. Cần sửa chữa và nộp lại.',
    },
};

// Visual flow: none → pending → approved/rejected
const STATE_FLOW: GateStatus[] = ['none', 'pending', 'approved'];

const GateStateMachineModal: React.FC<GateStateMachineModalProps> = ({ task, onClose, onTransition }) => {
    const [rejectReason, setRejectReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [showRejectForm, setShowRejectForm] = useState(false);

    if (!task) return null;

    const currentState = task.gateStatus || 'none';
    const cfg = GATE_STATES[currentState];
    const StateIcon = cfg.icon;

    const handleTransition = async (status: GateStatus, reason?: string) => {
        setLoading(true);
        await onTransition(task.id, status, reason);
        setLoading(false);
        if (status === 'approved' || status === 'rejected') onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md mx-4 animate-in zoom-in-95 duration-200 overflow-hidden">

                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-slate-800 to-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shield size={18} className="text-amber-400" />
                        <span className="font-bold text-white text-sm">Nghiệm thu nội bộ</span>
                    </div>
                    <button onClick={onClose} className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                        <X size={15} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Task info */}
                    <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 shrink-0" style={{ backgroundColor: task.color || '#f97316' }} />
                        <div>
                            <p className="font-bold text-slate-800 dark:text-white text-sm">{task.name}</p>
                            <div className="flex items-center gap-3 mt-1">
                                {task.assignee && (
                                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                        <User size={9} /> {task.assignee}
                                    </span>
                                )}
                                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                    <Calendar size={9} /> {new Date(task.endDate).toLocaleDateString('vi-VN')}
                                </span>
                                <span className="text-[10px] font-bold text-emerald-600">✓ {task.progress}%</span>
                            </div>
                        </div>
                    </div>

                    {/* State Machine Flow */}
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Quy trình phê duyệt</p>
                        <div className="flex items-center gap-1">
                            {STATE_FLOW.map((state, i) => {
                                const s = GATE_STATES[state];
                                const Icon = s.icon;
                                const isActive = state === currentState;
                                const isPast = STATE_FLOW.indexOf(currentState) > i;
                                const isRejected = currentState === 'rejected' && state === 'pending';
                                return (
                                    <React.Fragment key={state}>
                                        <div className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                                            isActive
                                                ? `${s.bg} ${s.border} ring-2 ring-offset-1 ${state === 'pending' ? 'ring-amber-300' : state === 'approved' ? 'ring-emerald-300' : 'ring-slate-300'}`
                                                : isPast || isRejected
                                                    ? 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 opacity-60'
                                                    : 'bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-700/50 opacity-40'
                                        }`}>
                                            <Icon size={16} className={isActive ? s.color : 'text-slate-400'} />
                                            <span className={`text-[9px] font-bold text-center leading-tight ${isActive ? s.color : 'text-slate-400'}`}>
                                                {s.label.replace(' ✓', '')}
                                            </span>
                                        </div>
                                        {i < STATE_FLOW.length - 1 && (
                                            <ChevronRight size={12} className="text-slate-300 shrink-0" />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {/* Rejected branch */}
                            <div className="flex flex-col items-center gap-1 ml-1">
                                <div className="w-px h-4 bg-slate-200 dark:bg-slate-600" />
                                <div className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                                    currentState === 'rejected'
                                        ? 'bg-red-50 dark:bg-red-900/20 border-red-300 ring-2 ring-offset-1 ring-red-300'
                                        : 'bg-white dark:bg-slate-800/50 border-slate-100 opacity-40'
                                }`}>
                                    <XCircle size={14} className={currentState === 'rejected' ? 'text-red-500' : 'text-slate-400'} />
                                    <span className={`text-[9px] font-bold ${currentState === 'rejected' ? 'text-red-500' : 'text-slate-400'}`}>Từ chối</span>
                                </div>
                            </div>
                        </div>

                        {/* Current state description */}
                        <div className={`mt-3 p-2.5 rounded-xl text-[11px] font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                            <StateIcon size={11} className="inline mr-1.5" />
                            {cfg.description}
                            {task.gateApprovedBy && (
                                <span className="ml-2 opacity-70">— {task.gateApprovedBy}</span>
                            )}
                            {task.gateApprovedAt && (
                                <span className="ml-1 opacity-60 text-[9px]">
                                    {new Date(task.gateApprovedAt).toLocaleDateString('vi-VN')}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Reject reason form */}
                    {showRejectForm && (
                        <div className="space-y-2 p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800">
                            <label className="flex items-center gap-1 text-[10px] font-bold text-red-600 uppercase">
                                <FileText size={10} /> Lý do từ chối
                            </label>
                            <textarea
                                value={rejectReason}
                                onChange={e => setRejectReason(e.target.value)}
                                placeholder="VD: Chất lượng bê tông chưa đạt mác M300, cần kiểm tra lại..."
                                rows={3}
                                className="w-full px-3 py-2 text-xs rounded-xl border border-red-200 dark:border-red-700 bg-white dark:bg-slate-800 resize-none focus:ring-2 focus:ring-red-400 outline-none"
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowRejectForm(false)}
                                    className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-500 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                    Huỷ
                                </button>
                                <button
                                    onClick={() => handleTransition('rejected', rejectReason)}
                                    disabled={loading}
                                    className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-red-500 hover:bg-red-600 flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                                >
                                    <ThumbsDown size={12} /> Xác nhận từ chối
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Action buttons based on current state */}
                    {!showRejectForm && (
                        <div className="flex gap-2">
                            {/* none → pending */}
                            {currentState === 'none' && (
                                <button
                                    onClick={() => handleTransition('pending')}
                                    disabled={loading}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg shadow-amber-500/20 hover:shadow-xl hover:scale-[1.02] flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                                >
                                    <Shield size={14} />
                                    {loading ? 'Đang xử lý...' : 'Nộp nghiệm thu'}
                                </button>
                            )}

                            {/* pending → approved or rejected */}
                            {currentState === 'pending' && (
                                <>
                                    <button
                                        onClick={() => setShowRejectForm(true)}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 hover:bg-red-100 flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                        <ThumbsDown size={14} /> Từ chối
                                    </button>
                                    <button
                                        onClick={() => handleTransition('approved')}
                                        disabled={loading}
                                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:scale-[1.02] flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
                                    >
                                        <ThumbsUp size={14} />
                                        {loading ? 'Đang duyệt...' : 'Duyệt'}
                                    </button>
                                </>
                            )}

                            {/* rejected → re-submit (back to pending) */}
                            {currentState === 'rejected' && (
                                <button
                                    onClick={() => handleTransition('pending')}
                                    disabled={loading}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-amber-700 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 hover:bg-amber-100 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                                >
                                    <Shield size={14} />
                                    {loading ? 'Đang xử lý...' : 'Nộp lại'}
                                </button>
                            )}

                            {/* approved → final state message */}
                            {currentState === 'approved' && (
                                <div className="flex-1 py-2.5 rounded-xl text-sm font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 flex items-center justify-center gap-2">
                                    <CheckCircle2 size={14} /> Đã nghiệm thu xong
                                </div>
                            )}
                        </div>
                    )}

                    {/* Warning if gate blocked successors */}
                    {currentState !== 'approved' && currentState !== 'none' && (
                        <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/10 rounded-xl text-[10px] text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                            <span>Các hạng mục phụ thuộc vào task này đang bị <strong>tạm khóa</strong> cho đến khi nghiệm thu được duyệt.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GateStateMachineModal;
