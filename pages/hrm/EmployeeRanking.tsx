import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Trophy, Medal, Crown, Settings2, Plus, Trash2, Save, RotateCcw,
  ChevronDown, ChevronUp, Loader2, AlertCircle, Star, TrendingUp,
  Users, Calendar, Target, Clock, Shield, Award, BarChart3, Eye, EyeOff, CheckCircle
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

interface Criteria {
  id: string;
  key: string;
  label: string;
  description: string | null;
  weight: number;
  data_source: string;
  is_active: boolean;
  sort_order: number;
}

interface EmployeeScore {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  positionName: string;
  departmentName: string;
  scores: Record<string, number>;
  totalScore: number;
  rank: number;
  grade: string;
  gradeEmoji: string;
}

interface RankingResponse {
  rankings: EmployeeScore[];
  criteria: Criteria[];
  meta: { month: number; year: number; workingDays: number; totalWeight: number; employeeCount: number };
}

const GRADE_COLORS: Record<string, string> = {
  'Xuất sắc': 'from-amber-400 to-yellow-500 text-amber-900',
  'Tốt': 'from-emerald-400 to-green-500 text-emerald-900',
  'Khá': 'from-blue-400 to-cyan-500 text-blue-900',
  'Trung bình': 'from-orange-400 to-amber-500 text-orange-900',
  'Cần cải thiện': 'from-red-400 to-rose-500 text-red-900',
};

const GRADE_RING: Record<string, string> = {
  'Xuất sắc': 'ring-amber-400',
  'Tốt': 'ring-emerald-400',
  'Khá': 'ring-blue-400',
  'Trung bình': 'ring-orange-400',
  'Cần cải thiện': 'ring-red-400',
};

const SOURCE_ICONS: Record<string, typeof Target> = {
  attendance: Calendar,
  requests: Target,
  leave: Clock,
  manual: Star,
};

// ===== SVG RADAR CHART =====
const RadarChart: React.FC<{ employees: EmployeeScore[]; criteria: Criteria[]; selectedIds: Set<string> }> = ({ employees, criteria, selectedIds }) => {
  const cx = 150, cy = 150, r = 110;
  const n = criteria.length;
  if (n < 3) return null;

  const angleStep = (2 * Math.PI) / n;
  const getPoint = (index: number, value: number) => {
    const angle = angleStep * index - Math.PI / 2;
    const dist = (value / 100) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  const gridLevels = [20, 40, 60, 80, 100];
  const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#ec4899'];

  const selected = employees.filter(e => selectedIds.has(e.employeeId));

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[320px] mx-auto">
      {/* Grid */}
      {gridLevels.map(level => {
        const points = criteria.map((_, i) => getPoint(i, level));
        return (
          <polygon
            key={level}
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-700"
            strokeWidth={level === 100 ? 1.5 : 0.5}
          />
        );
      })}
      {/* Axis lines */}
      {criteria.map((_, i) => {
        const p = getPoint(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={0.5} />;
      })}
      {/* Data polygons */}
      {selected.map((emp, ei) => {
        const color = COLORS[ei % COLORS.length];
        const points = criteria.map((c, i) => getPoint(i, emp.scores[c.key] || 0));
        return (
          <g key={emp.employeeId}>
            <polygon
              points={points.map(p => `${p.x},${p.y}`).join(' ')}
              fill={color}
              fillOpacity={0.15}
              stroke={color}
              strokeWidth={2}
            />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color} />
            ))}
          </g>
        );
      })}
      {/* Labels */}
      {criteria.map((c, i) => {
        const p = getPoint(i, 118);
        const anchor = p.x < cx - 10 ? 'end' : p.x > cx + 10 ? 'start' : 'middle';
        return (
          <text key={i} x={p.x} y={p.y} textAnchor={anchor} dominantBaseline="central"
            className="fill-slate-500 dark:fill-slate-400" fontSize={9} fontWeight={700}>
            {c.label.length > 10 ? c.label.slice(0, 10) + '…' : c.label}
          </text>
        );
      })}
    </svg>
  );
};

const EmployeeRanking: React.FC = () => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<RankingResponse | null>(null);

  // Criteria config
  const [showConfig, setShowConfig] = useState(false);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  // Radar selection
  const [radarSelected, setRadarSelected] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Load criteria on mount
  useEffect(() => { loadCriteria(); }, []);

  const loadCriteria = async () => {
    const { data: rows, error: err } = await supabase.from('ranking_criteria').select('*').order('sort_order');
    if (err) console.error('Load criteria error:', err);
    if (rows) setCriteria(rows);
  };

  const calculateRanking = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/employee-ranking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year }),
      });
      const result = await resp.json();
      if (result.error) throw new Error(result.error);
      setData(result);
      // Auto-select top 3 for radar
      const top3 = new Set<string>(result.rankings.slice(0, 3).map((r: EmployeeScore) => r.employeeId));
      setRadarSelected(top3);
    } catch (err: any) {
      setError(err.message || 'Không thể tính xếp hạng');
    } finally {
      setLoading(false);
    }
  };

  // Criteria management
  const totalWeight = useMemo(() => criteria.filter(c => c.is_active).reduce((s, c) => s + Number(c.weight), 0), [criteria]);

  const updateCriteriaWeight = (id: string, weight: number) => {
    setCriteria(prev => prev.map(c => c.id === id ? { ...c, weight } : c));
  };

  const toggleCriteria = (id: string) => {
    setCriteria(prev => prev.map(c => c.id === id ? { ...c, is_active: !c.is_active } : c));
  };

  const addCriteria = async () => {
    if (!newLabel.trim()) return;
    const key = newLabel.trim().toLowerCase().replace(/\s+/g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const { data: row, error: err } = await supabase.from('ranking_criteria').insert({
      key, label: newLabel.trim(), weight: 10, data_source: 'manual', sort_order: criteria.length + 1,
    }).select().single();
    if (err) { console.error('Add criteria error:', err); setError('Không thể thêm tiêu chí: ' + err.message); return; }
    if (row) { setCriteria(prev => [...prev, row]); setNewLabel(''); }
  };

  const deleteCriteria = async (id: string) => {
    const { error: err } = await supabase.from('ranking_criteria').delete().eq('id', id);
    if (err) { console.error('Delete criteria error:', err); return; }
    setCriteria(prev => prev.filter(c => c.id !== id));
  };

  const saveCriteria = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      for (const c of criteria) {
        const { error: err } = await supabase.from('ranking_criteria')
          .update({ weight: c.weight, is_active: c.is_active })
          .eq('id', c.id);
        if (err) { console.error('Save error for', c.key, err); throw err; }
      }
      // Re-fetch from DB to confirm persistence
      await loadCriteria();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError('Lưu thất bại: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const toggleRadar = (id: string) => {
    setRadarSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const PODIUM_STYLES = [
    { bg: 'from-amber-400 to-yellow-500', shadow: 'shadow-amber-400/40', icon: Crown, size: 'w-20 h-20 sm:w-24 sm:h-24', textSize: 'text-3xl sm:text-4xl', order: 'order-2', height: 'h-32 sm:h-36', label: '#1' },
    { bg: 'from-slate-300 to-slate-400', shadow: 'shadow-slate-400/30', icon: Medal, size: 'w-16 h-16 sm:w-20 sm:h-20', textSize: 'text-2xl sm:text-3xl', order: 'order-1', height: 'h-24 sm:h-28', label: '#2' },
    { bg: 'from-amber-600 to-orange-700', shadow: 'shadow-orange-600/30', icon: Medal, size: 'w-16 h-16 sm:w-20 sm:h-20', textSize: 'text-2xl sm:text-3xl', order: 'order-3', height: 'h-20 sm:h-24', label: '#3' },
  ];

  const activeCriteria = data?.criteria || criteria.filter(c => c.is_active);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 flex items-center justify-center shadow-2xl shadow-orange-500/30">
            <Trophy size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Xếp hạng Nhân viên</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm flex items-center gap-1 mt-0.5">
              <Award size={12} className="text-amber-500" />
              Đánh giá hiệu suất tổng hợp • Tháng {month}/{year}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month/Year selector */}
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-white">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-white">
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${showConfig ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-300' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'}`}>
            <Settings2 size={16} /> Tiêu chí
          </button>
          <button onClick={calculateRanking} disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white font-black text-sm shadow-xl shadow-orange-500/25 hover:shadow-2xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Đang tính...</> : <><BarChart3 size={16} /> Tính xếp hạng</>}
          </button>
        </div>
      </div>

      {/* ===== CRITERIA CONFIG PANEL ===== */}
      {showConfig && (
        <div className="glass-card rounded-2xl p-5 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
              <Settings2 size={16} className="text-indigo-500" /> Cấu hình tiêu chí đánh giá
            </h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${totalWeight === 100 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-red-100 dark:bg-red-900/30 text-red-600'}`}>
                Tổng: {totalWeight}%{totalWeight !== 100 && ' ⚠️'}
              </span>
              <button onClick={saveCriteria} disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 ${saveSuccess ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white hover:bg-indigo-600'}`}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : saveSuccess ? <><CheckCircle size={12} /> Đã lưu!</> : <><Save size={12} /> Lưu</>}
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {criteria.map(c => {
              const SrcIcon = SOURCE_ICONS[c.data_source] || Star;
              return (
                <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${c.is_active ? 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' : 'bg-slate-50 dark:bg-slate-900/30 border-slate-100 dark:border-slate-800 opacity-50'}`}>
                  <button onClick={() => toggleCriteria(c.id)} className="shrink-0">
                    {c.is_active ? <Eye size={16} className="text-emerald-500" /> : <EyeOff size={16} className="text-slate-400" />}
                  </button>
                  <SrcIcon size={16} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-white truncate">{c.label}</p>
                    {c.description && <p className="text-[10px] text-slate-400 truncate">{c.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="range" min={0} max={100} step={5} value={c.weight}
                      onChange={e => updateCriteriaWeight(c.id, Number(e.target.value))}
                      className="w-20 sm:w-28 accent-indigo-500" disabled={!c.is_active} />
                    <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 w-10 text-right">{c.weight}%</span>
                  </div>
                  {c.data_source === 'manual' && (
                    <button onClick={() => deleteCriteria(c.id)} className="text-red-400 hover:text-red-600 transition p-1">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add new criteria */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
              placeholder="Thêm tiêu chí mới (VD: Teamwork, Sáng tạo...)" onKeyDown={e => e.key === 'Enter' && addCriteria()}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-400 outline-none" />
            <button onClick={addCriteria} disabled={!newLabel.trim()}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 disabled:opacity-40 transition">
              <Plus size={14} /> Thêm
            </button>
          </div>
          <p className="text-[10px] text-slate-400">💡 Tiêu chí tự thêm (manual) sẽ mặc định 50 điểm. Có thể mở rộng sau để nhập điểm thủ công cho từng NV.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
          <AlertCircle size={20} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="relative mb-8">
            <div className="w-28 h-28 rounded-[2rem] bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-red-500/20 flex items-center justify-center border-2 border-dashed border-amber-300 dark:border-amber-700">
              <Trophy size={48} className="text-amber-400 dark:text-amber-500" />
            </div>
            <div className="absolute -top-2 -right-2 w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg animate-bounce">
              <Star size={18} className="text-white" />
            </div>
          </div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white mb-2">Chọn tháng & bấm "Tính xếp hạng"</h2>
          <p className="text-sm text-slate-500 max-w-md">Hệ thống sẽ tổng hợp chấm công, yêu cầu, nghỉ phép... để tính điểm xếp hạng nhân viên.</p>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative mb-8">
            <div className="w-28 h-28 rounded-full border-4 border-amber-200 dark:border-amber-800 border-t-amber-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Trophy size={36} className="text-amber-500" />
            </div>
          </div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white mb-1">Đang tính xếp hạng...</h2>
          <p className="text-sm text-slate-400 animate-pulse">Phân tích chấm công, yêu cầu, nghỉ phép T{month}/{year}</p>
        </div>
      )}

      {/* ===== DATA ===== */}
      {data && (
        <div className="space-y-6">
          {/* ===== TOP 3 PODIUM ===== */}
          {data.rankings.length >= 3 && (
            <div className="flex items-end justify-center gap-3 sm:gap-6 py-4">
              {[1, 0, 2].map(podiumIdx => {
                const emp = data.rankings[podiumIdx];
                if (!emp) return null;
                const style = PODIUM_STYLES[podiumIdx];
                const Icon = style.icon;
                return (
                  <div key={emp.employeeId} className={`flex flex-col items-center ${style.order}`}>
                    <div className="relative mb-2">
                      <div className={`${style.size} rounded-2xl bg-gradient-to-br ${style.bg} flex items-center justify-center shadow-2xl ${style.shadow} text-white`}>
                        <span className={`${style.textSize} font-black`}>{emp.fullName.charAt(0)}</span>
                      </div>
                      <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white dark:bg-slate-900 shadow-lg flex items-center justify-center">
                        <Icon size={16} className={podiumIdx === 0 ? 'text-amber-500' : podiumIdx === 1 ? 'text-slate-400' : 'text-amber-700'} />
                      </div>
                    </div>
                    <p className="text-sm font-black text-slate-800 dark:text-white text-center truncate max-w-[120px]">{emp.fullName}</p>
                    <p className="text-[10px] text-slate-400 truncate max-w-[100px]">{emp.positionName || emp.employeeCode}</p>
                    <div className={`mt-1.5 relative rounded-xl overflow-hidden ${style.height} w-16 sm:w-20 flex items-end justify-center`}>
                      <div className={`w-full h-full bg-gradient-to-t ${style.bg} opacity-20 absolute inset-0 rounded-xl`} />
                      <span className={`relative text-lg sm:text-xl font-black bg-gradient-to-br ${style.bg} bg-clip-text text-transparent pb-2`}>
                        {emp.totalScore}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Meta info */}
          <div className="flex flex-wrap gap-3 justify-center">
            {[
              { icon: Users, label: `${data.meta.employeeCount} nhân viên`, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/20' },
              { icon: Calendar, label: `${data.meta.workingDays} ngày làm việc`, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' },
              { icon: Target, label: `${activeCriteria.length} tiêu chí`, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/20' },
              { icon: TrendingUp, label: `Tổng trọng số: ${data.meta.totalWeight}%`, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20' },
            ].map((m, i) => (
              <span key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold ${m.color}`}>
                <m.icon size={12} /> {m.label}
              </span>
            ))}
          </div>

          {/* ===== RADAR + TABLE LAYOUT ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Radar Chart */}
            <div className="glass-card rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                <BarChart3 size={14} className="text-violet-500" /> So sánh Radar
              </h3>
              {activeCriteria.length >= 3 ? (
                <>
                  <RadarChart employees={data.rankings} criteria={activeCriteria} selectedIds={radarSelected} />
                  {/* Legend */}
                  <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                    {data.rankings.filter(e => radarSelected.has(e.employeeId)).map((emp, i) => {
                      const colors = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#ec4899'];
                      return (
                        <span key={emp.employeeId} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                          {emp.fullName}
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-8">Cần ít nhất 3 tiêu chí để vẽ radar chart</p>
              )}
            </div>

            {/* Ranking Table */}
            <div className="lg:col-span-2 glass-card rounded-2xl p-5 overflow-x-auto">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Trophy size={14} className="text-amber-500" /> Bảng xếp hạng — T{data.meta.month}/{data.meta.year}
              </h3>
              <div className="min-w-[600px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="pb-2 text-left text-[10px] font-black text-slate-400 uppercase w-10">Rank</th>
                      <th className="pb-2 text-left text-[10px] font-black text-slate-400 uppercase w-6">📊</th>
                      <th className="pb-2 text-left text-[10px] font-black text-slate-400 uppercase">Nhân viên</th>
                      {activeCriteria.map(c => (
                        <th key={c.key} className="pb-2 text-center text-[10px] font-black text-slate-400 uppercase" title={c.description || c.label}>
                          {c.label.length > 8 ? c.label.slice(0, 8) + '…' : c.label}
                        </th>
                      ))}
                      <th className="pb-2 text-center text-[10px] font-black text-slate-400 uppercase">Tổng</th>
                      <th className="pb-2 text-center text-[10px] font-black text-slate-400 uppercase">Xếp loại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rankings.map(emp => {
                      const gradeColor = GRADE_COLORS[emp.grade] || GRADE_COLORS['Trung bình'];
                      const ring = GRADE_RING[emp.grade] || 'ring-slate-300';
                      const isExpanded = expandedRow === emp.employeeId;
                      const isInRadar = radarSelected.has(emp.employeeId);
                      return (
                        <React.Fragment key={emp.employeeId}>
                          <tr className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/30 dark:bg-indigo-950/10' : ''}`}
                            onClick={() => setExpandedRow(isExpanded ? null : emp.employeeId)}>
                            <td className="py-2.5">
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${emp.rank <= 3 ? `bg-gradient-to-br ${PODIUM_STYLES[emp.rank - 1]?.bg || 'from-slate-300 to-slate-400'} text-white shadow-sm` : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                {emp.rank}
                              </span>
                            </td>
                            <td className="py-2.5">
                              <button onClick={e => { e.stopPropagation(); toggleRadar(emp.employeeId); }}
                                className={`w-5 h-5 rounded flex items-center justify-center transition-all ${isInRadar ? 'bg-violet-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-violet-100'}`}
                                title={isInRadar ? 'Bỏ khỏi radar' : 'Thêm vào radar'}>
                                <BarChart3 size={10} />
                              </button>
                            </td>
                            <td className="py-2.5">
                              <div>
                                <p className="font-bold text-slate-800 dark:text-white text-[13px]">{emp.fullName}</p>
                                <p className="text-[10px] text-slate-400">{emp.employeeCode}{emp.positionName ? ` • ${emp.positionName}` : ''}</p>
                              </div>
                            </td>
                            {activeCriteria.map(c => {
                              const val = emp.scores[c.key] ?? 0;
                              const color = val >= 80 ? 'bg-emerald-500' : val >= 60 ? 'bg-blue-500' : val >= 40 ? 'bg-amber-500' : 'bg-red-500';
                              return (
                                <td key={c.key} className="py-2.5 text-center">
                                  <div className="inline-flex flex-col items-center gap-0.5">
                                    <span className="text-xs font-black text-slate-700 dark:text-white">{val}</span>
                                    <div className="w-10 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${val}%` }} />
                                    </div>
                                  </div>
                                </td>
                              );
                            })}
                            <td className="py-2.5 text-center">
                              <span className={`text-base font-black ring-2 ${ring} px-2.5 py-1 rounded-xl`}>
                                {emp.totalScore}
                              </span>
                            </td>
                            <td className="py-2.5 text-center">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r ${gradeColor} text-[11px] font-black shadow-sm`}>
                                {emp.gradeEmoji} {emp.grade}
                              </span>
                            </td>
                          </tr>
                          {/* Expanded detail */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={activeCriteria.length + 5} className="py-3 px-4 bg-slate-50/50 dark:bg-slate-800/20">
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                  {activeCriteria.map(c => {
                                    const val = emp.scores[c.key] ?? 0;
                                    const SrcIcon = SOURCE_ICONS[c.data_source] || Star;
                                    return (
                                      <div key={c.key} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                          <SrcIcon size={12} className="text-slate-400" />
                                          <span className="text-[10px] font-bold text-slate-500 uppercase">{c.label}</span>
                                        </div>
                                        <p className="text-xl font-black text-slate-800 dark:text-white">{val}<span className="text-xs text-slate-400 font-medium">/100</span></p>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mt-1.5">
                                          <div className={`h-full rounded-full transition-all ${val >= 80 ? 'bg-emerald-500' : val >= 60 ? 'bg-blue-500' : val >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${val}%` }} />
                                        </div>
                                        <p className="text-[9px] text-slate-400 mt-1">Trọng số: {c.weight}%</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
      `}</style>
    </div>
  );
};

export default EmployeeRanking;
