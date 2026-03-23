import React from 'react';

const LoadingSpinner: React.FC = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-slate-200 animate-spin border-t-accent" />
      </div>
      <p className="text-sm font-bold text-slate-400 animate-pulse">Đang tải...</p>
    </div>
  </div>
);

export default LoadingSpinner;
