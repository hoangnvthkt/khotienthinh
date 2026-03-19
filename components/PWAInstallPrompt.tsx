import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Zap, WifiOff } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showBanner, setShowBanner] = useState(false);
    const [showOfflineToast, setShowOfflineToast] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        // Listen for install prompt
        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            // Show banner after 30 seconds of use
            const dismissed = localStorage.getItem('pwa_install_dismissed');
            if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 24 * 60 * 60 * 1000) {
                setTimeout(() => setShowBanner(true), 30000);
            }
        };

        window.addEventListener('beforeinstallprompt', handler);

        // Listen for successful install
        window.addEventListener('appinstalled', () => {
            setIsInstalled(true);
            setShowBanner(false);
            setDeferredPrompt(null);
        });

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    // Online/Offline status
    useEffect(() => {
        const handleOnline = () => setShowOfflineToast(false);
        const handleOffline = () => {
            setShowOfflineToast(true);
            setTimeout(() => setShowOfflineToast(false), 5000);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') {
            setIsInstalled(true);
        }
        setShowBanner(false);
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowBanner(false);
        localStorage.setItem('pwa_install_dismissed', Date.now().toString());
    };

    return (
        <>
            {/* Install Banner */}
            {showBanner && !isInstalled && (
                <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[998] animate-slide-in-right">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
                        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-4 flex items-center gap-3">
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                                <Smartphone size={24} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-black text-white">Cài KhoViet lên thiết bị</div>
                                <div className="text-[10px] text-emerald-100">Truy cập nhanh, hoạt động offline</div>
                            </div>
                            <button onClick={handleDismiss}
                                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4">
                            <div className="flex gap-3 mb-3">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    <Zap size={10} className="text-amber-500" /> Truy cập nhanh
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    <WifiOff size={10} className="text-blue-500" /> Hoạt động offline
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    <Download size={10} className="text-emerald-500" /> Không cần store
                                </div>
                            </div>
                            <button onClick={handleInstall}
                                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2">
                                <Download size={16} /> Cài đặt ngay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Offline Toast */}
            {showOfflineToast && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] animate-fade-in-down">
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-800 dark:bg-slate-700 shadow-2xl border border-slate-600">
                        <WifiOff size={14} className="text-red-400" />
                        <span className="text-xs font-bold text-white">Mất kết nối mạng</span>
                    </div>
                </div>
            )}
        </>
    );
};

export default PWAInstallPrompt;
