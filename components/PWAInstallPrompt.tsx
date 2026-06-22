import React, { useState, useEffect } from 'react';
import { Bell, Download, X, Smartphone, Zap, WifiOff } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showBanner, setShowBanner] = useState(false);
    const [showInstalledHint, setShowInstalledHint] = useState(false);
    const [showOfflineToast, setShowOfflineToast] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);

    useEffect(() => {
        const standalone = Boolean(
            window.matchMedia('(display-mode: standalone)').matches ||
            (navigator as any).standalone === true
        );
        setIsInstalled(standalone);

        if (!standalone && localStorage.getItem('pwa_was_installed') === 'true') {
            const dismissed = localStorage.getItem('pwa_open_app_hint_dismissed');
            if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 24 * 60 * 60 * 1000) {
                window.setTimeout(() => setShowInstalledHint(true), 12000);
            }
        }

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            const dismissed = localStorage.getItem('pwa_install_dismissed');
            if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 24 * 60 * 60 * 1000) {
                setTimeout(() => setShowBanner(true), 30000);
            }
        };

        const handleInstalled = () => {
            localStorage.setItem('pwa_was_installed', 'true');
            setIsInstalled(true);
            setShowBanner(false);
            setShowInstalledHint(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handler);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    useEffect(() => {
        const handleUpdateAvailable = (event: CustomEvent<{ registration: ServiceWorkerRegistration }>) => {
            setUpdateRegistration(event.detail.registration);
        };

        window.addEventListener('vioo:pwa-update-available', handleUpdateAvailable);
        return () => window.removeEventListener('vioo:pwa-update-available', handleUpdateAvailable);
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

    const handleDismissInstalledHint = () => {
        setShowInstalledHint(false);
        localStorage.setItem('pwa_open_app_hint_dismissed', Date.now().toString());
    };

    const handleApplyUpdate = () => {
        if (updateRegistration?.waiting) {
            updateRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            return;
        }
        window.location.reload();
    };

    return (
        <>
            {updateRegistration && (
                <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[999] animate-slide-in-right">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-blue-200 dark:border-blue-800 overflow-hidden">
                        <div className="p-4 flex items-center gap-3">
                            <div className="w-11 h-11 bg-blue-50 dark:bg-blue-950/40 rounded-xl flex items-center justify-center shrink-0">
                                <Zap size={20} className="text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-black text-slate-800 dark:text-white">Có phiên bản mới</div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">Cập nhật để dùng bản ERP mới nhất.</div>
                            </div>
                            <button onClick={() => setUpdateRegistration(null)}
                                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="px-4 pb-4">
                            <button onClick={handleApplyUpdate}
                                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                                <Download size={16} /> Cập nhật ngay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Install Banner */}
            {showBanner && !isInstalled && !updateRegistration && (
                <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[998] animate-slide-in-right">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
                        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-4 flex items-center gap-3">
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                                <Smartphone size={24} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-black text-white">Cài Vioo lên thiết bị</div>
                                <div className="text-[10px] text-emerald-100">Mở nhanh như app, không cần store</div>
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
                                    <Bell size={10} className="text-blue-500" /> Thông báo
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

            {showInstalledHint && !isInstalled && !showBanner && !updateRegistration && (
                <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[997] animate-slide-in-right">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-3">
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center shrink-0">
                            <Smartphone size={20} className="text-slate-600 dark:text-slate-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-black text-slate-800 dark:text-white">Vioo đã có thể mở bằng app</div>
                            <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                Nếu thấy Open in app trên thanh địa chỉ, bấm vào đó để mở cửa sổ PWA riêng.
                            </div>
                        </div>
                        <button onClick={handleDismissInstalledHint}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0">
                            <X size={16} />
                        </button>
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
