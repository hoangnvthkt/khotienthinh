import React, { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Network } from 'lucide-react';
import type { HrmOrgTreeNode, HrmSharedOrgUnit } from '../../../types/hrmSharedCatalog';

export interface HrmOrgChartOverviewProps {
  roots: HrmOrgTreeNode[];
  selectedUnitId: string | null;
  query: string;
  expansionCommand: { expanded: boolean; version: number };
  onSelectUnit(unit: HrmSharedOrgUnit): void;
}

const collectIds = (nodes: HrmOrgTreeNode[]): string[] => nodes.flatMap(node => [
  node.id,
  ...collectIds(node.children),
]);

const containsQuery = (node: HrmOrgTreeNode, query: string): boolean => {
  if (!query) return true;
  const ownText = `${node.code || ''} ${node.name}`.toLocaleLowerCase('vi');
  return ownText.includes(query) || node.children.some(child => containsQuery(child, query));
};

const OrgNode: React.FC<{
  node: HrmOrgTreeNode;
  depth: number;
  expandedIds: Set<string>;
  selectedUnitId: string | null;
  normalizedQuery: string;
  onToggle(id: string): void;
  onSelectUnit(unit: HrmSharedOrgUnit): void;
}> = ({ node, depth, expandedIds, selectedUnitId, normalizedQuery, onToggle, onSelectUnit }) => {
  if (!containsQuery(node, normalizedQuery)) return null;
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id) || Boolean(normalizedQuery);
  const visibleChildren = node.children.filter(child => containsQuery(child, normalizedQuery));

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-slate-200 pl-4' : ''}>
      <div
        className={`group flex items-center gap-2 rounded-xl border px-3 py-2.5 transition ${
          selectedUnitId === node.id
            ? 'border-indigo-300 bg-indigo-50 text-indigo-950'
            : 'border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50'
        }`}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          disabled={!hasChildren}
          aria-label={expanded ? `Thu gọn ${node.name}` : `Mở rộng ${node.name}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white disabled:opacity-30"
        >
          {hasChildren && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
        </button>
        <button
          type="button"
          onClick={() => onSelectUnit(node)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            node.type === 'company' ? 'bg-slate-900 text-white' : 'bg-indigo-50 text-indigo-600'
          }`}>
            {node.type === 'company' ? <Network size={17} /> : <Building2 size={17} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black">{node.name}</span>
            <span className="block truncate text-[11px] font-semibold text-slate-400">
              {node.customTypeLabel || (node.type === 'company' ? 'Tổng công ty' : 'Đơn vị tổ chức')}
            </span>
          </span>
        </button>
      </div>
      {expanded && visibleChildren.length > 0 && (
        <div className="mt-2 space-y-2">
          {visibleChildren.map(child => (
            <OrgNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedUnitId={selectedUnitId}
              normalizedQuery={normalizedQuery}
              onToggle={onToggle}
              onSelectUnit={onSelectUnit}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const HrmOrgChartOverview: React.FC<HrmOrgChartOverviewProps> = ({
  roots,
  selectedUnitId,
  query,
  expansionCommand,
  onSelectUnit,
}) => {
  const rootIds = useMemo(() => roots.map(root => root.id), [roots]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(rootIds));
  const normalizedQuery = query.trim().toLocaleLowerCase('vi');

  useEffect(() => {
    setExpandedIds(new Set(expansionCommand.expanded ? collectIds(roots) : rootIds));
  }, [expansionCommand.version, expansionCommand.expanded, rootIds, roots]);

  const toggle = (id: string) => setExpandedIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3" aria-label="Sơ đồ tổng quan">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-black text-slate-800">Sơ đồ tổng quan</h3>
          <p className="mt-0.5 text-xs font-medium text-slate-500">Chọn một đơn vị để xem định biên và nhân sự.</p>
        </div>
        <span className="shrink-0 text-[11px] font-bold text-slate-400">Mặc định thu gọn</span>
      </div>
      <div className="space-y-2">
        {roots.map(root => (
          <OrgNode
            key={root.id}
            node={root}
            depth={0}
            expandedIds={expandedIds}
            selectedUnitId={selectedUnitId}
            normalizedQuery={normalizedQuery}
            onToggle={toggle}
            onSelectUnit={onSelectUnit}
          />
        ))}
        {!roots.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-500">
            Chưa có đơn vị tổ chức.
          </div>
        )}
      </div>
    </section>
  );
};

export default HrmOrgChartOverview;
