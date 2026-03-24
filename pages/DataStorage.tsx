import React, { useState } from 'react';
import { HardDrive, Cloud, Server, Maximize2, Minimize2, ExternalLink, RefreshCw } from 'lucide-react';

const TABS = [
  {
    key: 'google',
    label: 'Google Drive',
    icon: Cloud,
    color: 'from-blue-500 to-cyan-500',
    bg: 'bg-blue-50',
    textColor: 'text-blue-600',
    url: 'https://drive.google.com/embeddedfolderview?id=1MmKkQOL_9XyUaIhJtcgRsGp6vmdFv9Bt#grid',
  },
  {
    key: 'synology',
    label: 'Synology Drive',
    icon: Server,
    color: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    textColor: 'text-emerald-600',
    url: 'https://hoangnv.synology.me:5001/d/s/17YLz88s6btopuQpnKdRBWh1bYX9DuDQ/H-SFFgvAm07EatvjtHKpgMsM1eCuGYfD-LrDgYNcXEQ0',
  },
] as const;

const DataStorage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('google');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const currentTab = TABS.find(t => t.key === activeTab) || TABS[0];

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-slate-900' : 'p-4 lg:p-6'} flex flex-col h-full`}>
      {/* Header */}
      <div className={`flex items-center justify-between ${isFullscreen ? 'p-4 border-b border-slate-200 dark:border-slate-700' : 'mb-4'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30">
            <HardDrive size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white">Kho dữ liệu</h1>
            <p className="text-xs text-slate-400">Truy cập Google Drive & Synology Drive</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            title="Tải lại"
          >
            <RefreshCw size={16} />
          </button>

          {/* Open in new tab */}
          <a
            href={currentTab.url.replace('#grid', '')}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            title="Mở trong tab mới"
          >
            <ExternalLink size={16} />
          </a>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(f => !f)}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className={`flex gap-2 ${isFullscreen ? 'px-4 pb-3' : 'mb-3'}`}>
        {TABS.map(tab => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                isActive
                  ? `bg-gradient-to-r ${tab.color} text-white shadow-lg`
                  : `${tab.bg} ${tab.textColor} dark:bg-slate-800 dark:text-slate-300 hover:shadow-md`
              }`}
            >
              <TabIcon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* iframe container */}
      <div className={`flex-1 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${isFullscreen ? 'mx-4 mb-4' : ''}`}>
        <iframe
          key={`${currentTab.key}-${refreshKey}`}
          src={currentTab.url}
          className="w-full h-full border-0"
          style={{ minHeight: isFullscreen ? undefined : '70vh' }}
          allow="autoplay; encrypted-media"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
          title={currentTab.label}
        />
      </div>
    </div>
  );
};

export default DataStorage;
