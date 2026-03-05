
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info);
    }

    render() {
        if (this.state.hasError) {
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
