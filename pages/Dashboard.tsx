
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import {
  Package, AlertTriangle, TrendingUp, Clock, ShieldCheck, FileText, Settings,
  ArrowLeftRight, Info, LayoutGrid, ListFilter,
  BarChart3, LineChart as LineChartIcon
} from 'lucide-react';
import { Role, TransactionStatus, TransactionType } from '../types';
import { SkeletonCard, SkeletonRect } from '../components/Skeleton';

const StatCard: React.FC<{
  title: string;
  value: string;
  icon: React.ElementType;
  color: string;
  trend?: string;
  onClick?: () => void;
}> = ({ title, value, icon: Icon, color, trend, onClick }) => (
  <div
    onClick={onClick}
    className={`bg-white dark:bg-slate-800 p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-start justify-between hover:shadow-md transition-all ${onClick ? 'cursor-pointer active:scale-95' : ''}`}
  >
    <div className="min-w-0 font-sans">
      <p className="text-slate-500 dark:text-slate-400 text-[10px] md:text-[11px] uppercase font-black tracking-widest mb-1 truncate">{title}</p>
      <h3 className="text-lg md:text-2xl font-black text-slate-800 dark:text-white truncate">{value}</h3>
      {trend && (
        <div className="flex items-center mt-1 md:mt-2">
          <span className={`text-[9px] md:text-[10px] px-1.5 py-0.5 rounded-full font-bold ${trend.startsWith('+') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
            {trend}
          </span>
          <span className="text-[9px] md:text-[10px] text-slate-400 ml-1 font-medium hidden xs:inline">so với kỳ trước</span>
        </div>
      )}
    </div>
    <div className={`p-2 md:p-3 rounded-xl ${color} bg-opacity-10 shrink-0 border border-current border-opacity-10`}>
      <Icon className={`w-4 h-4 md:w-6 md:h-6 ${color.replace('bg-', 'text-')}`} />
    </div>
  </div>
);

const DashboardSkeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="flex justify-between items-center">
      <div className="space-y-2">
        <SkeletonRect className="h-8 w-48" />
        <SkeletonRect className="h-4 w-32" />
      </div>
      <SkeletonRect className="h-10 w-32 rounded-xl" />
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 h-[400px]">
        <SkeletonRect className="h-full w-full rounded-xl" />
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 h-[400px]">
        <div className="space-y-4">
          <SkeletonRect className="h-4 w-3/4" />
          <SkeletonRect className="h-12 w-full rounded-xl" />
          <SkeletonRect className="h-12 w-full rounded-xl" />
          <SkeletonRect className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  </div>
);

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { items, transactions, activities, isLoading, warehouses, user, theme } = useApp();
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [selectedWhId, setSelectedWhId] = useState<string>(user.assignedWarehouseId || 'all');

  const isKeeper = user.role === Role.KEEPER;
  const isDark = theme === 'dark';

  // Lọc danh sách nhật ký theo quyền hạn
  const filteredActivities = useMemo(() => {
    if (!isKeeper) return activities;
    return activities.filter(act => act.warehouseId === user.assignedWarehouseId);
  }, [activities, isKeeper, user.assignedWarehouseId]);

  const stats = useMemo(() => {
    let totalStock = 0;
    let lowStock = 0;
    let totalValue = 0;

    items.forEach(item => {
      const currentWh = isKeeper ? user.assignedWarehouseId : (selectedWhId === 'all' ? null : selectedWhId);
      const stock = currentWh
        ? (item.stockByWarehouse[currentWh] || 0)
        : Object.values(item.stockByWarehouse).reduce((a, b) => (a as number) + (b as number), 0);

      totalStock += stock;
      totalValue += stock * item.priceIn;
      if (stock <= item.minStock && stock > 0) lowStock++;
    });

    const pendingTx = transactions.filter(t => {
      if (isKeeper) {
        return (t.requesterId === user.id && t.status === TransactionStatus.PENDING) ||
          (t.targetWarehouseId === user.assignedWarehouseId && t.status === TransactionStatus.APPROVED);
      }
      return t.status === TransactionStatus.PENDING;
    }).length;

    return { totalStock, lowStock, totalValue, pendingTx };
  }, [items, transactions, isKeeper, user, selectedWhId]);

  const fluctuationsData = useMemo(() => {
    const data: any[] = [];
    const days = 7;
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('vi-VN', { weekday: 'short' });

      let dayIn = 0;
      let dayOut = 0;

      transactions.forEach(tx => {
        const txDate = tx.date.split('T')[0];
        if (txDate !== dateStr) return;

        const isRelevant = selectedWhId === 'all' ||
          tx.sourceWarehouseId === selectedWhId ||
          tx.targetWarehouseId === selectedWhId;

        if (!isRelevant) return;

        const qty = tx.items.reduce((sum, item) => sum + item.quantity, 0);

        if (tx.type === TransactionType.IMPORT) {
          if (selectedWhId === 'all' || tx.targetWarehouseId === selectedWhId) dayIn += qty;
        } else if (tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION) {
          if (selectedWhId === 'all' || tx.sourceWarehouseId === selectedWhId) dayOut += qty;
        } else if (tx.type === TransactionType.TRANSFER) {
          if (selectedWhId !== 'all') {
            if (tx.targetWarehouseId === selectedWhId) dayIn += qty;
            if (tx.sourceWarehouseId === selectedWhId) dayOut += qty;
          }
        } else if (tx.type === TransactionType.ADJUSTMENT && tx.targetWarehouseId) {
          if (selectedWhId === 'all' || tx.targetWarehouseId === selectedWhId) {
            if (qty > 0) dayIn += qty;
            else dayOut += Math.abs(qty);
          }
        }
      });

      data.push({ name: label, in: dayIn, out: dayOut });
    }
    return data;
  }, [selectedWhId, transactions]);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffInSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffInSec < 60) return 'Vừa xong';
    if (diffInSec < 3600) return `${Math.floor(diffInSec / 60)} phút trước`;
    return date.toLocaleDateString('vi-VN');
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'TRANSACTION': return <ArrowLeftRight size={16} />;
      case 'INVENTORY': return <Package size={16} />;
      case 'REQUEST': return <FileText size={16} />;
      case 'SYSTEM': return <Settings size={16} />;
      default: return <Info size={16} />;
    }
  };

  const getActivityColor = (status?: string) => {
    switch (status) {
      case 'SUCCESS': return 'bg-green-100 text-green-600 border-green-200';
      case 'WARNING': return 'bg-orange-100 text-orange-600 border-orange-200';
      case 'DANGER': return 'bg-red-100 text-red-600 border-red-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Trung tâm điều khiển</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm flex items-center mt-1 uppercase tracking-tight font-bold">
            <ShieldCheck size={14} className="mr-1 text-green-500" />
            {isKeeper ? `PHẠM VI: ${warehouses.find(w => w.id === user.assignedWarehouseId)?.name}` : 'TOÀN HỆ THỐNG'}
          </p>
        </div>
        {!isKeeper && (
          <select
            value={selectedWhId}
            onChange={(e) => setSelectedWhId(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">Tất cả kho</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title="Giá trị kho"
          value={`${(stats.totalValue / 1000000).toLocaleString()} Tr`}
          icon={TrendingUp}
          color="bg-blue-600"
          trend="+5.2%"
          onClick={() => navigate('/inventory')}
        />
        <StatCard
          title="Tổng tồn kho"
          value={stats.totalStock.toLocaleString()}
          icon={Package}
          color="bg-emerald-600"
          onClick={() => navigate('/inventory')}
        />
        <StatCard
          title="Cảnh báo tồn"
          value={stats.lowStock.toString()}
          icon={AlertTriangle}
          color="bg-red-500"
          onClick={() => navigate('/inventory', { state: { filter: 'low' } })}
        />
        {user.role !== Role.ACCOUNTANT && (
          <StatCard
            title="Chờ phê duyệt"
            value={stats.pendingTx.toString()}
            icon={Clock}
            color="bg-orange-500"
            onClick={() => navigate('/operations', { state: { tab: 'PENDING' } })}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col overflow-hidden min-h-[400px]">
          <div className="p-6 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2">
              <LayoutGrid size={18} className="text-accent" />
              {isKeeper ? 'Biến động tại kho quản lý' : 'Biến động vật tư hệ thống'}
            </h3>
            <div className="bg-slate-100 dark:bg-slate-700 p-1 rounded-xl flex items-center">
              <button onClick={() => setChartType('bar')} className={`p-2 rounded-lg ${chartType === 'bar' ? 'bg-white dark:bg-slate-600 text-accent shadow-sm' : 'text-slate-400'}`}><BarChart3 size={16} /></button>
              <button onClick={() => setChartType('line')} className={`p-2 rounded-lg ${chartType === 'line' ? 'bg-white dark:bg-slate-600 text-accent shadow-sm' : 'text-slate-400'}`}><LineChartIcon size={16} /></button>
            </div>
          </div>
          <div className="p-6 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart data={fluctuationsData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#f1f5f9'} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', color: isDark ? '#f8fafc' : '#1e293b' }} />
                  <Bar dataKey="in" name="Nhập" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="out" name="Xuất" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <AreaChart data={fluctuationsData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#f1f5f9'} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: '16px', border: 'none' }} />
                  <Area type="monotone" dataKey="in" stroke="#2563eb" fill="#2563eb" fillOpacity={isDark ? 0.2 : 0.1} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col h-full overflow-hidden">
          <div className="p-6 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-black text-slate-800 dark:text-white text-sm uppercase tracking-widest">
              {isKeeper ? 'Nhật ký kho này' : 'Nhật ký toàn cục'}
            </h3>
            <ListFilter size={18} className="text-slate-400" />
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-4 max-h-[450px]">
            {filteredActivities.length > 0 ? (
              filteredActivities.map((act) => (
                <div key={act.id} className="relative pl-8">
                  <div className="absolute left-[11px] top-7 bottom-[-20px] w-px bg-slate-100 dark:bg-slate-700"></div>
                  <div className={`absolute left-0 top-0.5 w-6 h-6 rounded-lg border flex items-center justify-center z-10 ${getActivityColor(act.status)}`}>
                    {getActivityIcon(act.type)}
                  </div>
                  <div className="pb-5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-black text-slate-800 dark:text-slate-200">{act.action}</span>
                      <span className="text-[9px] text-slate-400 font-bold">{formatTime(act.timestamp)}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{act.description}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                <Info size={40} className="dark:text-white" />
                <p className="text-xs font-black uppercase mt-4 dark:text-white">Chưa có hoạt động</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
