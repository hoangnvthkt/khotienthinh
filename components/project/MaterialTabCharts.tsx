import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type MaterialWasteChartDatum = {
  name: string;
  'Dự toán': number;
  'Thực tế': number;
  isOver?: boolean;
};

export type MaterialBudgetCategoryChartDatum = {
  name: string;
  value: number;
};

export type MaterialTopBudgetChartDatum = {
  name: string;
  'Dự toán': number;
  'Thực tế': number;
};

const CHART_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'];

const fmt = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

export const MaterialWasteComparisonChart: React.FC<{ data: MaterialWasteChartDatum[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height={300}>
    <BarChart data={data} barGap={4}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="Dự toán" fill="#818cf8" radius={[4, 4, 0, 0]} />
      <Bar dataKey="Thực tế" radius={[4, 4, 0, 0]}>
        {data.map((entry, idx) => (
          <Cell key={idx} fill={entry.isOver ? '#ef4444' : '#10b981'} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

export const MaterialBudgetDashboardCharts: React.FC<{
  categoryData: MaterialBudgetCategoryChartDatum[];
  topValueData: MaterialTopBudgetChartDatum[];
}> = ({ categoryData, topValueData }) => (
  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
      <h4 className="mb-4 text-sm font-black text-slate-800">Ngân sách theo nhóm VT</h4>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={categoryData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }) => `${name} ${Number((percent || 0) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}
          >
            {CHART_COLORS.map((color, index) => <Cell key={index} fill={color} />)}
          </Pie>
          <Tooltip formatter={(value: number) => `${fmt(value)} đ`} />
        </PieChart>
      </ResponsiveContainer>
    </div>

    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
      <h4 className="mb-4 text-sm font-black text-slate-800">Top giá trị DT cao nhất</h4>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={topValueData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={value => `${value}tr`} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value: number) => `${fmt(value)} triệu`} />
          <Legend />
          <Bar dataKey="Dự toán" fill="#6366f1" radius={[0, 4, 4, 0]} />
          <Bar dataKey="Thực tế" fill="#ec4899" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);
