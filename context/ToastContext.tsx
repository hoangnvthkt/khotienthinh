
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
}

interface ToastContextType {
    toasts: Toast[];
    toast: {
        success: (title: string, message?: string) => void;
        error: (title: string, message?: string) => void;
        warning: (title: string, message?: string) => void;
        info: (title: string, message?: string) => void;
    };
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

const STYLES = {
    success: 'bg-emerald-600 border-emerald-700',
    error: 'bg-red-600 border-red-700',
    warning: 'bg-amber-500 border-amber-600',
    info: 'bg-blue-600 border-blue-700',
};

const BAR_STYLES = {
    success: 'bg-emerald-400',
    error: 'bg-red-400',
    warning: 'bg-amber-300',
    info: 'bg-blue-400',
};

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const [visible, setVisible] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const Icon = ICONS[toast.type];
    const duration = toast.duration ?? 4000;

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));

        const timer = setTimeout(() => {
            setLeaving(true);
            setTimeout(() => onRemove(toast.id), 350);
        }, duration);

        return () => clearTimeout(timer);
    }, []);

    const handleClose = () => {
        setLeaving(true);
        setTimeout(() => onRemove(toast.id), 350);
    };

    return (
        <div
            className={`
        relative flex items-start gap-3 w-full max-w-sm rounded-2xl shadow-2xl border text-white p-4 overflow-hidden
        transition-all duration-350 ease-out
        ${STYLES[toast.type]}
        ${visible && !leaving ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}
      `}
            style={{ transitionProperty: 'opacity, transform' }}
        >
            <div className="shrink-0 mt-0.5">
                <Icon size={20} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-black text-sm leading-tight">{toast.title}</p>
                {toast.message && <p className="text-xs mt-0.5 opacity-80 leading-snug">{toast.message}</p>}
            </div>
            <button onClick={handleClose} className="shrink-0 opacity-70 hover:opacity-100 transition-opacity mt-0.5">
                <X size={16} />
            </button>
            {/* Progress bar */}
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20 overflow-hidden">
                <div
                    className={`h-full ${BAR_STYLES[toast.type]} animate-[shrink_var(--dur)_linear_forwards]`}
                    style={{ '--dur': `${duration}ms` } as React.CSSProperties}
                />
            </div>
        </div>
    );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((type: ToastType, title: string, message?: string, duration?: number) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
        setToasts(prev => [...prev, { id, type, title, message, duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const toast = {
        success: (title: string, message?: string) => addToast('success', title, message),
        error: (title: string, message?: string) => addToast('error', title, message),
        warning: (title: string, message?: string) => addToast('warning', title, message),
        info: (title: string, message?: string) => addToast('info', title, message),
    };

    return (
        <ToastContext.Provider value={{ toasts, toast, removeToast }}>
            {children}
            {/* Toast Container */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className="pointer-events-auto">
                        <ToastItem toast={t} onRemove={removeToast} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used within ToastProvider');
    return context.toast;
};
