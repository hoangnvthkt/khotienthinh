import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileClock } from 'lucide-react';
import type { BoqMaterialBudgetLine, BoqMaterialTreeNode } from '../../../types/materialPlanning';

export interface BoqMaterialDraftFields {
  quantity: string;
  neededDate: string;
  destination: string;
}

interface BoqMaterialTreeProps {
  nodes: BoqMaterialTreeNode[];
  childrenByParent: Record<string, BoqMaterialTreeNode[]>;
  expanded: Set<string>;
  loadingParents: Set<string>;
  selected: Set<string>;
  drafts: Record<string, BoqMaterialDraftFields>;
  canViewPrice: boolean;
  onToggleNode: (node: BoqMaterialTreeNode) => void;
  onToggleLine: (line: BoqMaterialBudgetLine, checked: boolean) => void;
  onDraftChange: (lineId: string, patch: Partial<BoqMaterialDraftFields>) => void;
  onLoadMore: (parentId: string | null) => void;
  nextCursorByParent: Record<string, string | null>;
}

const parentKey = (parentId: string | null) => parentId ?? '__root__';
const qty = (value: string | null) => {
  if (value == null) return 'Chưa xác định';
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/u, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''}`;
};

const DraftInputs = ({
  line,
  draft,
  onDraftChange,
}: {
  line: BoqMaterialBudgetLine;
  draft: BoqMaterialDraftFields;
  onDraftChange: BoqMaterialTreeProps['onDraftChange'];
}) => (
  <div className="grid gap-2 pt-3 sm:grid-cols-3">
    <input
      aria-label={`Số lượng dự kiến cho ${line.itemName}`}
      inputMode="decimal"
      value={draft.quantity}
      onChange={event => onDraftChange(line.id, { quantity: event.target.value })}
      placeholder={`Tối đa ${qty(line.balance.uncovered)} ${line.unit}`}
      className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
    <input
      aria-label={`Ngày cần cho ${line.itemName}`}
      type="date"
      value={draft.neededDate}
      onChange={event => onDraftChange(line.id, { neededDate: event.target.value })}
      className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
    <input
      aria-label={`Nơi nhận cho ${line.itemName}`}
      value={draft.destination}
      onChange={event => onDraftChange(line.id, { destination: event.target.value })}
      placeholder="Nơi nhận"
      className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
  </div>
);

const IssueBadges = ({ line }: { line: BoqMaterialBudgetLine }) => {
  const [open, setOpen] = useState(false);
  const issues = [...new Set([...line.issues, ...line.balance.blockingIssues])];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {issues.map(issue => (
        <span key={issue} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          {issue}
        </span>
      ))}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50"
      >
        <FileClock size={12} /> Nguồn và đối soát
      </button>
      {open && (
        <div className="basis-full rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-600">
          BOQ: {line.id} · Work: {line.workBoqItemId || 'chưa phân bổ'} · {issues.length > 0 ? issues.join(', ') : 'Không có cảnh báo nguồn'}
        </div>
      )}
    </div>
  );
};

const MaterialLine = ({
  line,
  selected,
  draft,
  canViewPrice,
  onToggleLine,
  onDraftChange,
}: {
  line: BoqMaterialBudgetLine;
  selected: boolean;
  draft: BoqMaterialDraftFields;
  canViewPrice: boolean;
  onToggleLine: BoqMaterialTreeProps['onToggleLine'];
  onDraftChange: BoqMaterialTreeProps['onDraftChange'];
}) => (
  <div className="border-t border-slate-100 px-3 py-3 sm:px-4">
    <div className="hidden items-start gap-3 md:grid md:grid-cols-[minmax(220px,1.5fr)_repeat(6,minmax(74px,0.55fr))_auto]">
      <label className="flex min-w-0 items-start gap-2">
        <input
          type="checkbox"
          aria-label={`Chọn ${line.itemName}`}
          checked={selected}
          disabled={!line.balance.selectable}
          onChange={event => onToggleLine(line, event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        <span className="min-w-0">
          <span className="block truncate text-xs font-black text-slate-800">{line.itemName}</span>
          <span className="block text-[10px] font-bold text-slate-400">{line.sku || 'Không SKU'} · {line.unit}</span>
        </span>
      </label>
      <span className="text-xs font-bold text-slate-700">B {qty(line.balance.budget)}</span>
      <span className="text-xs font-bold text-slate-700">I {qty(line.balance.issuedNet)}</span>
      <span className="text-[10px] font-bold leading-4 text-slate-600" title="Chờ duyệt / Chờ bố trí / Đang thực hiện">
        O {qty(line.balance.open.awaitingApproval)} / {qty(line.balance.open.awaitingArrangement)} / {qty(line.balance.open.executing)}
      </span>
      <span className="text-xs font-bold text-slate-700">C {qty(line.balance.closed)}</span>
      <span className="text-xs font-black text-emerald-700">Còn {qty(line.balance.uncovered)}</span>
      <span className="text-xs font-black text-rose-600">Dư {qty(line.balance.excess)}</span>
      {canViewPrice && <span className="text-right text-xs font-bold text-slate-600">{qty(line.unitPrice)}</span>}
    </div>

    <div className="md:hidden">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label={`Chọn ${line.itemName}`}
          checked={selected}
          disabled={!line.balance.selectable}
          onChange={event => onToggleLine(line, event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        <span>
          <span className="block text-sm font-black text-slate-800">{line.itemName}</span>
          <span className="text-[10px] font-bold text-slate-400">{line.sku || 'Không SKU'} · {line.unit}</span>
        </span>
      </label>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <span>B <strong>{qty(line.balance.budget)}</strong></span>
        <span>I <strong>{qty(line.balance.issuedNet)}</strong></span>
        <span>C <strong>{qty(line.balance.closed)}</strong></span>
        <span className="col-span-2">O <strong>{qty(line.balance.open.awaitingApproval)} / {qty(line.balance.open.awaitingArrangement)} / {qty(line.balance.open.executing)}</strong></span>
        <span className="text-emerald-700">Còn <strong>{qty(line.balance.uncovered)}</strong></span>
        <span className="text-rose-600">Dư <strong>{qty(line.balance.excess)}</strong></span>
        {canViewPrice && <span>Đơn giá <strong>{qty(line.unitPrice)}</strong></span>}
      </div>
    </div>

    {!line.balance.selectable && (
      <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-amber-700">
        <AlertTriangle size={12} /> Chưa đủ attribution để lập preview
      </div>
    )}
    <IssueBadges line={line} />
    {selected && <DraftInputs line={line} draft={draft} onDraftChange={onDraftChange} />}
  </div>
);

const TreeLevel = ({
  nodes,
  depth,
  props,
}: {
  nodes: BoqMaterialTreeNode[];
  depth: number;
  props: BoqMaterialTreeProps;
}) => nodes.map(node => {
  const isExpanded = props.expanded.has(node.id);
  const children = props.childrenByParent[node.id] || [];
  const canExpand = node.childCount > 0;
  return (
    <section key={node.id} className="overflow-hidden border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 bg-slate-50/80 px-3 py-3" style={{ paddingLeft: `${12 + depth * 18}px` }}>
        {canExpand ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Thu gọn' : 'Mở'} ${node.name}`}
            onClick={() => props.onToggleNode(node)}
            className="rounded-md p-1 text-slate-500 hover:bg-white"
          >
            {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : <span className="w-7" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black text-slate-800">
            {node.wbsCode ? `${node.wbsCode} · ` : ''}{node.name}
          </div>
          <div className="text-[10px] font-bold text-slate-400">
            {node.synthetic === 'unallocated' ? 'Nhánh chưa phân bổ' : `Task ${node.taskId || 'chưa gắn'}`}
            {node.quantityGroups?.length ? ` · ${node.materials.length} dòng · ${node.quantityGroups.map(group => `${group.unit}: ${group.lineCount}`).join(', ')}` : ''}
          </div>
        </div>
        {props.loadingParents.has(node.id) && <span className="text-[10px] font-bold text-blue-600">Đang tải…</span>}
      </div>
      {(node.synthetic !== 'unallocated' || isExpanded) && node.materials.map(line => (
        <MaterialLine
          key={line.id}
          line={line}
          selected={props.selected.has(line.id)}
          draft={props.drafts[line.id] || { quantity: '', neededDate: '', destination: '' }}
          canViewPrice={props.canViewPrice}
          onToggleLine={props.onToggleLine}
          onDraftChange={props.onDraftChange}
        />
      ))}
      {isExpanded && children.length > 0 && <TreeLevel nodes={children} depth={depth + 1} props={props} />}
      {isExpanded && props.nextCursorByParent[parentKey(node.id)] && (
        <button type="button" onClick={() => props.onLoadMore(node.id)} className="ml-12 mb-3 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] font-black text-slate-600">
          Tải thêm đầu mục
        </button>
      )}
    </section>
  );
});

export const BoqMaterialTree: React.FC<BoqMaterialTreeProps> = props => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="hidden grid-cols-[minmax(220px,1.5fr)_repeat(6,minmax(74px,0.55fr))_auto] gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2 text-[9px] font-black uppercase text-slate-500 md:grid">
      <span>Vật tư / nguồn</span><span>B</span><span>I</span><span>O: duyệt / bố trí / chạy</span><span>C</span><span>Còn</span><span>Dư</span>
      {props.canViewPrice && <span className="text-right">Đơn giá</span>}
    </div>
    <TreeLevel nodes={props.nodes} depth={0} props={props} />
    {props.nextCursorByParent.__root__ && (
      <div className="border-t border-slate-100 p-3 text-center">
        <button type="button" onClick={() => props.onLoadMore(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">
          Tải thêm công tác
        </button>
      </div>
    )}
  </div>
);
