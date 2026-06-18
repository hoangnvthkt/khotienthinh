
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    resetKey?: string;
}

interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: ErrorInfo;
    isRecovering?: boolean;
    recoveryTitle?: string;
    recoveryMessage?: string;
}

const getRecoveryConfig = (error: Error) => {
    const message = error.message || '';
    const isChunkLoadError =
        error.name === 'ChunkLoadError' ||
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('error loading dynamically imported module');

    if (isChunkLoadError) {
        return {
            storageKey: 'chunk_failed_reload_at',
            throttleMs: 30000,
            title: 'Đang cập nhật ứng dụng',
            message: 'Ứng dụng đang tải lại phiên bản mới nhất.',
        };
    }

    const isDevContextMismatch =
        import.meta.env.DEV &&
        message.includes('useApp must be used within AppProvider');

    if (isDevContextMismatch) {
        return {
            storageKey: 'dev_app_context_reload_at',
            throttleMs: 10000,
            title: 'Đang khởi động lại môi trường dev',
            message: 'Ứng dụng đang làm mới context sau khi HMR cập nhật.',
        };
    }

    return null;
};

const canReloadOnce = (storageKey: string, throttleMs: number) => {
    if (typeof window === 'undefined') return false;

    try {
        const now = Date.now();
        const lastReloadAt = Number(sessionStorage.getItem(storageKey) || 0);
        return !Number.isFinite(lastReloadAt) || now - lastReloadAt >= throttleMs;
    } catch {
        return false;
    }
};

const reloadOnce = (storageKey: string, throttleMs: number) => {
    if (typeof window === 'undefined') return false;

    try {
        const now = Date.now();
        const lastReloadAt = Number(sessionStorage.getItem(storageKey) || 0);

        if (Number.isFinite(lastReloadAt) && now - lastReloadAt < throttleMs) {
            return false;
        }

        sessionStorage.setItem(storageKey, String(now));
        window.setTimeout(() => window.location.reload(), 50);
        return true;
    } catch (err) {
        console.warn('Unable to persist reload guard:', err);
        return false;
    }
};

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    componentDidMount() {
        this.clearExpiredReloadMarker('chunk_failed_reload_at', 5 * 60 * 1000);
        this.clearExpiredReloadMarker('dev_app_context_reload_at', 60 * 1000);
        sessionStorage.removeItem('chunk_failed_reload');
    }

    componentDidUpdate(prevProps: Props) {
        if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
            this.setState({
                hasError: false,
                error: undefined,
                errorInfo: undefined,
                isRecovering: false,
                recoveryTitle: undefined,
                recoveryMessage: undefined,
            });
        }
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        const recovery = getRecoveryConfig(error);
        const isRecovering = recovery ? canReloadOnce(recovery.storageKey, recovery.throttleMs) : false;
        return {
            hasError: true,
            error,
            isRecovering,
            recoveryTitle: isRecovering ? recovery?.title : undefined,
            recoveryMessage: isRecovering ? recovery?.message : undefined,
        };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        const recovery = getRecoveryConfig(error);
        const didScheduleRecovery = recovery ? reloadOnce(recovery.storageKey, recovery.throttleMs) : false;

        this.setState({
            errorInfo: info,
            isRecovering: didScheduleRecovery,
            recoveryTitle: didScheduleRecovery ? recovery?.title : undefined,
            recoveryMessage: didScheduleRecovery ? recovery?.message : undefined,
        });

        if (import.meta.env.DEV) {
            console.error('ErrorBoundary caught:', error, info.componentStack);
        } else {
            console.error('ErrorBoundary caught:', error);
        }
    }

    private clearExpiredReloadMarker(storageKey: string, maxAgeMs: number) {
        try {
            const lastReloadAt = Number(sessionStorage.getItem(storageKey) || 0);
            if (lastReloadAt && Date.now() - lastReloadAt > maxAgeMs) {
                sessionStorage.removeItem(storageKey);
            }
        } catch {
            // Ignore storage cleanup failures; the boundary can still render recovery UI.
        }
    }

    render() {
        if (this.state.hasError) {
            if (this.state.isRecovering) {
                return (
                    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
                        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 max-w-md w-full text-center">
                            <div className="w-12 h-12 mx-auto mb-5 rounded-full border-4 border-slate-200 border-t-slate-800 dark:border-slate-700 dark:border-t-slate-100 animate-spin" />
                            <h1 className="text-xl font-black text-slate-800 dark:text-white mb-2">
                                {this.state.recoveryTitle || 'Đang tải lại ứng dụng'}
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">
                                {this.state.recoveryMessage || 'Ứng dụng đang tự phục hồi sau một cập nhật.'}
                            </p>
                        </div>
                    </div>
                );
            }

            return (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-red-100 dark:border-red-900/30 p-10 max-w-lg w-full text-center">
                        <div className="text-7xl mb-6">⚠️</div>
                        <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-3">Đã xảy ra lỗi hệ thống</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Ứng dụng gặp lỗi không mong muốn.</p>
                        {this.state.error && (
                            <pre className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 text-red-700 dark:text-red-400 text-xs p-4 rounded-xl text-left overflow-auto mb-6 max-h-32">
                                {this.state.error.message}
                            </pre>
                        )}
                        {import.meta.env.DEV && this.state.errorInfo?.componentStack && (
                            <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs p-4 rounded-xl text-left overflow-auto mb-6 max-h-40">
                                {this.state.errorInfo.componentStack.trim()}
                            </pre>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            className="px-8 py-3 bg-slate-800 dark:bg-accent text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-slate-700 transition shadow-lg shadow-slate-900/20"
                        >
                            Tải lại ứng dụng
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
