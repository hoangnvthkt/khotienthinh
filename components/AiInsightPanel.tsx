import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot, Sparkles, X, Loader2, RefreshCw, AlertTriangle,
  AlertCircle, Info, ChevronDown, ChevronUp, Zap, Clock, Lightbulb
} from 'lucide-react';
import { escapeHtml } from '../lib/safeHtml';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

interface AiAlert {
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

interface AiInsightResult {
  insights: string;
  alerts: AiAlert[];
  suggestions: string[];
  cached?: boolean;
  generatedAt?: string;
}

interface AiInsightPanelProps {
  module: 'cashflow' | 'material' | 'gantt' | 'subcontract' | 'supplychain' | 'dailylog' | 'documents' | 'contract';
  siteId: string;
  siteName?: string;
  data?: any;
  compact?: boolean;
}

const MODULE_CONFIG: Record<string, { title: string; gradient: string; emoji: string }> = {
  cashflow: { title: 'Phân tích Dòng tiền', gradient: 'from-emerald-500 to-teal-600', emoji: '💰' },
  material: { title: 'Phân tích Vật tư', gradient: 'from-amber-500 to-orange-600', emoji: '📦' },
  gantt: { title: 'Phân tích Tiến độ', gradient: 'from-blue-500 to-indigo-600', emoji: '📅' },
  subcontract: { title: 'Đánh giá Nhà thầu', gradient: 'from-violet-500 to-purple-600', emoji: '👷' },
  supplychain: { title: 'Phân tích Cung ứng', gradient: 'from-cyan-500 to-blue-600', emoji: '🚛' },
  dailylog: { title: 'Phân tích Nhật ký', gradient: 'from-rose-500 to-pink-600', emoji: '📋' },
  documents: { title: 'Phân tích Tài liệu', gradient: 'from-indigo-500 to-blue-600', emoji: '📑' },
  contract: { title: 'Phân tích Hợp đồng', gradient: 'from-fuchsia-500 to-purple-600', emoji: '📝' },
};

const ALERT_STYLES = {
  critical: { bg: 'bg-red-500/10 border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-400', icon: AlertCircle, dot: 'bg-red-500' },
  warning: { bg: 'bg-amber-500/10 border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle, dot: 'bg-amber-500' },
  info: { bg: 'bg-blue-500/10 border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-400', icon: Info, dot: 'bg-blue-500' },
};

const formatMarkdown = (text: string): string => {
  return escapeHtml(text)
    .replace(/^### (.*?)$/gm, '<h4 class="text-sm font-black text-slate-800 dark:text-white mt-3 mb-1">$1</h4>')
    .replace(/^## (.*?)$/gm, '<h3 class="text-base font-black text-slate-800 dark:text-white mt-3 mb-1.5">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-black text-slate-800 dark:text-white">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-pink-600 dark:text-pink-400">$1</code>')
    .replace(/\n/g, '<br/>')
    .replace(/(^|<br\/>)- (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 mt-0.5 shrink-0">•</span><span>$2</span></span>')
    .replace(/(^|<br\/>)(\d+)\. (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 font-bold mt-0.5 w-4 text-right shrink-0">$2.</span><span>$3</span></span>');
};

const AiInsightPanel: React.FC<AiInsightPanelProps> = ({ module, siteId, siteName, data, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiInsightResult | null>(null);
  const [error, setError] = useState('');
  const [showAlerts, setShowAlerts] = useState(true);

  const cfg = MODULE_CONFIG[module] || MODULE_CONFIG.cashflow;

  const analyze = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-project-insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ module, siteId, siteName, data: data || {}, force }),
      });
      const json = await resp.json();
      if (json.error) throw new Error(json.error);
      setResult(json);
      setIsOpen(true);
    } catch (err: any) {
      setError(err.message || 'Không thể phân tích');
    } finally {
      setLoading(false);
    }
  }, [module, siteId, siteName, data]);

  // Auto-open when result is loaded
  useEffect(() => {
    if (result) setIsOpen(true);
  }, [result]);

  // ===== TRIGGER BUTTON =====
  if (!isOpen && !result) {
    return (
      <button
        onClick={() => analyze()}
        disabled={loading}
        className={`group flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r ${cfg.gradient} text-white text-xs font-black uppercase tracking-wider shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50`}
      >
        {loading ? (
          <><Loader2 size={14} className="animate-spin" /> Đang phân tích...</>
        ) : (
          <><Sparkles size={14} className="group-hover:rotate-12 transition-transform" /> 🤖 AI Phân tích</>
        )}
      </button>
    );
  }

  // ===== EXPANDED PANEL =====
  return (
    <div className="ai-insight-panel mt-4 animate-[slideDown_0.3s_ease-out]">
      {/* Main Card */}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
        {/* Header */}
        <div className={`bg-gradient-to-r ${cfg.gradient} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                {cfg.emoji} {cfg.title}
              </h3>
              <p className="text-[10px] text-white/60">
                {result?.cached && <><Zap size={9} className="inline mr-0.5" />Từ cache • </>}
                {result?.generatedAt && new Date(result.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => analyze(true)}
              disabled={loading}
              className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-all active:scale-90"
              title="Phân tích lại"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => { setIsOpen(false); setResult(null); }}
              className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-all active:scale-90"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-500 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && !result && (
          <div className="px-4 py-8 flex flex-col items-center justify-center">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full border-3 border-indigo-200 dark:border-indigo-800 border-t-indigo-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Bot size={22} className="text-indigo-500" />
              </div>
            </div>
            <p className="text-sm font-bold text-slate-500 animate-pulse">AI đang phân tích dữ liệu...</p>
            <p className="text-[10px] text-slate-400 mt-1">Sử dụng Gemini Flash • 5-10 giây</p>
          </div>
        )}

        {/* Content */}
        {result && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {/* Alerts */}
            {result.alerts && result.alerts.length > 0 && (
              <div className="px-4 py-3">
                <button
                  onClick={() => setShowAlerts(!showAlerts)}
                  className="flex items-center justify-between w-full mb-2"
                >
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <AlertTriangle size={12} className="text-amber-500" />
                    Cảnh báo ({result.alerts.length})
                  </span>
                  {showAlerts ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
                </button>
                {showAlerts && (
                  <div className="space-y-2">
                    {result.alerts.map((alert, i) => {
                      const style = ALERT_STYLES[alert.level];
                      const AlertIcon = style.icon;
                      return (
                        <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-xl border ${style.bg}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${style.dot} mt-1.5 shrink-0`} />
                          <div className="min-w-0">
                            <p className={`text-xs font-bold ${style.text}`}>{alert.title}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{alert.detail}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Main Insights */}
            <div className="px-4 py-3">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Sparkles size={12} className="text-indigo-500" />
                Phân tích chi tiết
              </p>
              <div
                className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(result.insights) }}
              />
            </div>

            {/* Suggestions */}
            {result.suggestions && result.suggestions.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Lightbulb size={12} className="text-amber-500" />
                  Đề xuất hành động
                </p>
                <div className="space-y-1.5">
                  {result.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/30">
                      <span className="text-amber-500 font-black text-xs mt-0.5 shrink-0">{i + 1}.</span>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default AiInsightPanel;
