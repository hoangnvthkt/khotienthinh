
import React, { useRef, useEffect, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { Trash2, Save, RotateCcw, PenTool, X } from 'lucide-react';

interface SignaturePadProps {
    currentSignatureUrl?: string;
    onSave: (dataUrl: string) => Promise<void>;
    onDelete: () => Promise<void>;
    onClose: () => void;
}

const SignaturePad: React.FC<SignaturePadProps> = ({ currentSignatureUrl, onSave, onDelete, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    const [isEmpty, setIsEmpty] = useState(true);
    const [saving, setSaving] = useState(false);
    const [mode, setMode] = useState<'view' | 'draw'>(currentSignatureUrl ? 'view' : 'draw');

    useEffect(() => {
        if (mode === 'draw' && canvasRef.current) {
            const canvas = canvasRef.current;
            const container = canvas.parentElement;
            if (container) {
                canvas.width = container.clientWidth;
                canvas.height = 200;
            }
            const pad = new SignaturePadLib(canvas, {
                backgroundColor: 'rgba(255,255,255,0)',
                penColor: '#1e293b',
                minWidth: 1.5,
                maxWidth: 3,
            });
            pad.addEventListener('endStroke', () => setIsEmpty(pad.isEmpty()));
            padRef.current = pad;
            setIsEmpty(true);
            return () => { pad.off(); };
        }
    }, [mode]);

    const handleClear = () => {
        padRef.current?.clear();
        setIsEmpty(true);
    };

    const handleSave = async () => {
        if (!padRef.current || padRef.current.isEmpty()) return;
        setSaving(true);
        const dataUrl = padRef.current.toDataURL('image/png');
        await onSave(dataUrl);
        setSaving(false);
        setMode('view');
    };

    const handleDelete = async () => {
        if (!confirm('Xóa chữ ký số?')) return;
        setSaving(true);
        await onDelete();
        setSaving(false);
        setMode('draw');
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="glass-card bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
                            <PenTool size={20} />
                        </div>
                        <div>
                            <h2 className="font-black text-lg text-slate-800 dark:text-white">Chữ ký số</h2>
                            <p className="text-xs text-slate-400">Vẽ chữ ký của bạn bên dưới</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {mode === 'view' && currentSignatureUrl ? (
                        <div className="space-y-4">
                            <div className="border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl p-6 bg-white dark:bg-slate-900/50 flex items-center justify-center min-h-[200px]">
                                <img src={currentSignatureUrl} alt="Chữ ký" className="max-h-[180px] max-w-full object-contain" />
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setMode('draw')}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl font-bold text-sm hover:opacity-90 transition shadow-lg shadow-violet-500/20">
                                    <PenTool size={15} /> Vẽ lại
                                </button>
                                <button onClick={handleDelete} disabled={saving}
                                    className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl font-bold text-sm hover:bg-red-100 dark:hover:bg-red-900/40 transition disabled:opacity-50">
                                    <Trash2 size={15} /> Xóa
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900/50 relative">
                                <canvas ref={canvasRef} className="w-full cursor-crosshair" style={{ touchAction: 'none' }} />
                                {isEmpty && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <p className="text-slate-300 dark:text-slate-600 font-bold text-sm">Vẽ chữ ký tại đây...</p>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button onClick={handleSave} disabled={isEmpty || saving}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-bold text-sm hover:opacity-90 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                    <Save size={15} /> {saving ? 'Đang lưu...' : 'Lưu chữ ký'}
                                </button>
                                <button onClick={handleClear}
                                    className="flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition">
                                    <RotateCcw size={15} /> Xóa
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SignaturePad;
