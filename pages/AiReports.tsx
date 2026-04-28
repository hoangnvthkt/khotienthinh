import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText, RefreshCw, Clock, Play, Calendar, BarChart3,
  ChevronRight, Loader2, AlertTriangle, CheckCircle2, ArrowLeft,
  Package, Users, DollarSign, Zap, Eye
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { escapeHtml } from '../lib/safeHtml';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

interface Report {
  id: string;
  name: string;
  description: string;
  type: string;
  frequency: string;
  last_run_at: string | null;
  is_active: boolean;
  created_at: string;
  ai_report_results: { id: string; created_at: string; status: string }[];
}

interface ReportResult {
  id: string;
  report_id: string;
  content: string;
  data: any;
  status: string;
  error_message: string | null;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; gradient: string; emoji: string }> = {
  attendance: { icon: Users, gradient: 'from-teal-500 to-cyan-500', emoji: '👥' },
  inventory: { icon: Package, gradient: 'from-amber-500 to-orange-500', emoji: '📦' },
  finance: { icon: DollarSign, gradient: 'from-emerald-500 to-green-500', emoji: '💰' },
  custom: { icon: Zap, gradient: 'from-indigo-500 to-purple-500', emoji: '⚡' },
};

const FREQ_LABELS: Record<string, string> = {
  daily: 'Hàng ngày',
  weekly: 'Hàng tuần',
  monthly: 'Hàng tháng',
};

const AiReports: React.FC = () => {
  const { user } = useApp();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<ReportResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewResult, setViewResult] = useState<ReportResult | null>(null);

  // Load reports
  const loadReports = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ai_scheduled_reports')
      .select('*, ai_report_results(id, created_at, status)')
      .order('created_at', { ascending: true });
    setReports(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  // Generate report
  const generateReport = async (reportId: string) => {
    setGenerating(reportId);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-scheduled-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ action: 'generate', reportId }),
      });
      const result = await resp.json();
      if (result.error) throw new Error(result.error);
      
      // Refresh reports and show result
      await loadReports();
      if (result.result) {
        setViewResult(result.result);
      }
    } catch (err: any) {
      console.error('Report generation error:', err);
    }
    setGenerating(null);
  };

  // Load history
  const loadHistory = async (report: Report) => {
    setSelectedReport(report);
    setHistoryLoading(true);
    const { data } = await supabase
      .from('ai_report_results')
      .select('*')
      .eq('report_id', report.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory(data || []);
    setHistoryLoading(false);
  };

  // Format markdown simple
  const formatMd = (text: string) => {
    return escapeHtml(text)
      .replace(/## (.+)/g, '<h3 class="text-base font-black text-slate-800 dark:text-white mt-4 mb-2">$1</h3>')
      .replace(/### (.+)/g, '<h4 class="text-sm font-bold text-slate-700 dark:text-slate-300 mt-3 mb-1">$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-black">$1</strong>')
      .replace(/\n- (.+)/g, '<li class="text-sm text-slate-600 dark:text-slate-400 ml-4 list-disc">$1</li>')
      .replace(/\n\n/g, '<br/>')
      .replace(/\n/g, '<br/>');
  };

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return 'Chưa chạy';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Vừa xong';
    if (mins < 60) return `${mins} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h trước`;
    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
  };

  // ============ VIEW REPORT RESULT ============
  if (viewResult) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <button onClick={() => setViewResult(null)}
          className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-500 transition-colors">
          <ArrowLeft size={16} /> Quay lại
        </button>

        <div className="glass-card rounded-3xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <FileText size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">Kết quả báo cáo</h2>
                <p className="text-[11px] text-white/60">
                  {new Date(viewResult.created_at).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-slate-700 dark:text-slate-300"
              dangerouslySetInnerHTML={{ __html: formatMd(viewResult.content) }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ============ VIEW HISTORY ============
  if (selectedReport) {
    const cfg = TYPE_CONFIG[selectedReport.type] || TYPE_CONFIG.custom;
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <button onClick={() => setSelectedReport(null)}
          className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-500 transition-colors">
          <ArrowLeft size={16} /> Quay lại
        </button>

        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-lg`}>
              <cfg.icon size={22} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-black text-slate-800 dark:text-white">{selectedReport.name}</h2>
              <p className="text-xs text-slate-500">{selectedReport.description}</p>
            </div>
            <button
              onClick={() => generateReport(selectedReport.id)}
              disabled={generating === selectedReport.id}
              className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:shadow-lg transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
            >
              {generating === selectedReport.id ? (
                <><Loader2 size={14} className="animate-spin" /> Đang tạo...</>
              ) : (
                <><Play size={14} /> Tạo mới</>
              )}
            </button>
          </div>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <FileText size={40} className="text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-400">Chưa có báo cáo nào</p>
            <p className="text-[11px] text-slate-300 mt-1">Nhấn "Tạo mới" để tạo báo cáo đầu tiên</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Lịch sử báo cáo ({history.length})</h3>
            {history.map((r) => (
              <button
                key={r.id}
                onClick={() => setViewResult(r)}
                className="w-full glass-card rounded-2xl p-4 flex items-center gap-4 hover:shadow-lg hover:-translate-y-px transition-all text-left"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                  r.status === 'completed' ? 'bg-emerald-50 text-emerald-500' : 'bg-red-50 text-red-500'
                }`}>
                  {r.status === 'completed' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white">
                    {new Date(r.created_at).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(r.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    {' • '}
                    {r.content?.length || 0} ký tự
                  </p>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Eye size={14} />
                  <ChevronRight size={14} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ============ MAIN LIST ============
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <BarChart3 size={20} className="text-white" />
            </div>
            Báo cáo AI
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 ml-[52px]">
            Tự động tổng hợp báo cáo bằng trí tuệ nhân tạo
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-indigo-500" />
        </div>
      ) : reports.length === 0 ? (
        <div className="glass-card rounded-3xl p-12 text-center">
          <FileText size={48} className="text-slate-200 mx-auto mb-4" />
          <p className="text-sm font-bold text-slate-400">Chưa có báo cáo nào được cấu hình</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reports.map((report) => {
            const cfg = TYPE_CONFIG[report.type] || TYPE_CONFIG.custom;
            const Icon = cfg.icon;
            const resultCount = report.ai_report_results?.length || 0;
            const isGenerating = generating === report.id;

            return (
              <div
                key={report.id}
                className="glass-card rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 group"
              >
                <div className="flex items-stretch">
                  {/* Left accent */}
                  <div className={`w-1.5 bg-gradient-to-b ${cfg.gradient}`} />
                  
                  {/* Content */}
                  <div className="flex-1 p-5">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-lg shrink-0`}>
                        <Icon size={22} className="text-white" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-black text-slate-800 dark:text-white truncate">{report.name}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                            report.frequency === 'daily' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                            report.frequency === 'weekly' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                          }`}>
                            {FREQ_LABELS[report.frequency] || report.frequency}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{report.description}</p>
                        
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock size={10} /> Chạy lần cuối: {timeAgo(report.last_run_at || '')}
                          </span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <FileText size={10} /> {resultCount} kết quả
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => loadHistory(report)}
                          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center gap-1.5"
                        >
                          <Calendar size={13} /> Lịch sử
                        </button>
                        <button
                          onClick={() => generateReport(report.id)}
                          disabled={isGenerating}
                          className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:shadow-lg hover:shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isGenerating ? (
                            <><Loader2 size={13} className="animate-spin" /> Đang tạo...</>
                          ) : (
                            <><Play size={13} /> Tạo ngay</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AiReports;
