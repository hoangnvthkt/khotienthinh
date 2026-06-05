import React from 'react';
import { AlertTriangle, CheckCircle2, Link2 } from 'lucide-react';
import { ProjectWorkflowRollbackDependencyResult } from '../../types';

interface Props {
  dependencies?: ProjectWorkflowRollbackDependencyResult | null;
  title?: string;
}

const typeLabel: Record<string, string> = {
  purchase_order: 'PO',
  fulfillment_batch: 'Đợt cấp',
  transaction: 'Giao dịch kho',
  supplier_return: 'Trả NCC',
  project_document_links: 'Liên kết chứng từ',
};

const statusLabel = (status?: string) => {
  if (status === 'active') return 'Đang hoạt động';
  if (status === 'reversed') return 'Đã đảo chiều';
  if (status === 'cancelled' || status === 'canceled') return 'Đã hủy';
  if (status === 'returned') return 'Đã trả';
  if (status === 'void') return 'Vô hiệu';
  return status || '-';
};

const ProjectWorkflowDependencyList: React.FC<Props> = ({
  dependencies,
  title = 'Dependency downstream',
}) => {
  if (!dependencies) return null;

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${dependencies.allowed ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
      <div className="flex items-start gap-2">
        {dependencies.allowed ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="font-black">{title}</div>
          <div className="mt-0.5 text-[10px]">
            {dependencies.allowed
              ? 'Không còn chứng từ downstream đang hoạt động.'
              : `Còn ${dependencies.activeCount} chứng từ đang hoạt động, cần reverse/cancel/return đủ trước khi rollback.`}
          </div>
          {dependencies.dependencies.length > 0 && (
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
              {dependencies.dependencies.map((dependency, index) => {
                const active = dependency.status === 'active';
                return (
                  <div key={`${dependency.type}-${dependency.id || index}`} className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 ${active ? 'border-red-100 bg-white/70' : 'border-white/80 bg-white/55'}`}>
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Link2 size={11} className="shrink-0" />
                      <span className="truncate">{typeLabel[dependency.type] || dependency.type}</span>
                      {dependency.id && <span className="truncate font-mono text-[9px] opacity-70">{dependency.id}</span>}
                    </span>
                    <span className={active ? 'text-red-700' : 'text-emerald-700'}>{statusLabel(dependency.status)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectWorkflowDependencyList;
