
import React from 'react';

interface SkeletonProps {
    className?: string;
}

export const SkeletonRect: React.FC<SkeletonProps> = ({ className = '' }) => (
    <div
        className={`bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 bg-[length:400px_100%] animate-shimmer rounded ${className}`}
    />
);

export const SkeletonCard: React.FC = () => (
    <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1 space-y-2">
                <SkeletonRect className="h-3 w-24" />
                <SkeletonRect className="h-7 w-32" />
                <SkeletonRect className="h-4 w-16 mt-2" />
            </div>
            <SkeletonRect className="w-12 h-12 rounded-xl" />
        </div>
    </div>
);

export const SkeletonTableRow: React.FC<{ cols?: number }> = ({ cols = 5 }) => (
    <tr>
        {Array.from({ length: cols }).map((_, i) => (
            <td key={i} className="p-4">
                <SkeletonRect className={`h-4 ${i === 1 ? 'w-40' : 'w-20'}`} />
            </td>
        ))}
    </tr>
);

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 6, cols = 5 }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                        {Array.from({ length: cols }).map((_, i) => (
                            <th key={i} className="p-4">
                                <SkeletonRect className="h-3 w-16" />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {Array.from({ length: rows }).map((_, i) => (
                        <SkeletonTableRow key={i} cols={cols} />
                    ))}
                </tbody>
            </table>
        </div>
        {/* Mobile */}
        <div className="md:hidden divide-y divide-slate-100">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="p-4 space-y-3">
                    <SkeletonRect className="h-3 w-20" />
                    <SkeletonRect className="h-5 w-40" />
                    <div className="flex justify-between">
                        <SkeletonRect className="h-4 w-20" />
                        <SkeletonRect className="h-4 w-16" />
                    </div>
                </div>
            ))}
        </div>
    </div>
);
