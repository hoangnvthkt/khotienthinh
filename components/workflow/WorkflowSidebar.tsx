import React from 'react';
import { Eye, GitBranch, Inbox, Plus, User as UserIcon } from 'lucide-react';
import type { WorkflowTemplate, WorkflowTemplateCategory } from '../../types';
import WorkflowTemplateGroupList from './WorkflowTemplateGroupList';

export type WorkflowNavId = 'pending' | 'mine' | 'watching';

interface Props {
    activeNav: WorkflowNavId | null;
    counts: Record<WorkflowNavId, number>;
    onNav: (id: WorkflowNavId) => void;
    onCreate: () => void;
    createDisabled?: boolean;
    templates: WorkflowTemplate[];
    categories: WorkflowTemplateCategory[];
    userId: string;
    selectedTemplateId: string;
    onSelectTemplate: (id: string) => void;
    getTemplateCount: (templateId: string) => number;
}

const NAV_ITEMS: Array<{ id: WorkflowNavId; label: string; icon: React.ReactNode }> = [
    { id: 'pending', label: 'Chờ tôi duyệt', icon: <Inbox size={16} /> },
    { id: 'mine', label: 'Phiếu của tôi', icon: <UserIcon size={16} /> },
    { id: 'watching', label: 'Theo dõi', icon: <Eye size={16} /> },
];

/**
 * Left column of the Quy trình module. Tinted background with dark text so names stay
 * readable; the active item is a white card; "Chờ tôi duyệt" breathes while something waits.
 */
const WorkflowSidebar: React.FC<Props> = ({
    activeNav, counts, onNav, onCreate, createDisabled, templates, categories, userId, selectedTemplateId, onSelectTemplate, getTemplateCount,
}) => (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--wf-side-border)] bg-[var(--wf-side-bg)] text-[var(--wf-side-text)] lg:flex">
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
            <span className="flex min-w-0 items-center gap-2 text-base font-bold">
                <GitBranch size={18} className="shrink-0 text-[var(--wf-green)]" />
                <span className="truncate">Quy trình duyệt</span>
            </span>
            <button
                type="button"
                onClick={onCreate}
                disabled={createDisabled}
                title="Tạo phiếu mới"
                aria-label="Tạo phiếu mới"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--wf-green)] text-white shadow-sm transition hover:bg-[var(--wf-green-hover)] disabled:opacity-40"
            >
                <Plus size={16} />
            </button>
        </div>

        <nav className="space-y-0.5 px-3 pb-3" aria-label="Phiếu của bạn">
            {NAV_ITEMS.map(item => {
                const active = activeNav === item.id;
                const count = counts[item.id];
                return (
                    <button
                        key={item.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => onNav(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${active
                            ? 'bg-[var(--wf-side-active-bg)] text-[var(--wf-side-active-text)] shadow-sm ring-1 ring-[var(--wf-side-border)]'
                            : 'text-[var(--wf-side-text)] hover:bg-[var(--wf-side-hover)]'}`}
                    >
                        <span className={active ? 'text-[var(--wf-green)]' : 'text-[var(--wf-side-muted)]'}>{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                            <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${item.id === 'pending'
                                ? 'wf-pulse bg-amber-100 text-amber-800'
                                : 'bg-[var(--wf-side-badge-bg)] text-[var(--wf-side-badge-text)]'}`}
                            >
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </nav>

        <div className="wf-scroll flex-1 overflow-y-auto border-t border-[var(--wf-side-border)] px-3 py-3">
            <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--wf-side-heading)]">Quy trình mẫu</p>
            {templates.length === 0 ? (
                <p className="px-1 py-2 text-xs text-[var(--wf-side-muted)]">Chưa có quy trình nào đang hoạt động.</p>
            ) : (
                <WorkflowTemplateGroupList
                    templates={templates}
                    categories={categories}
                    userId={userId}
                    selectedTemplateId={selectedTemplateId}
                    getGroupCount={group => group.reduce((sum, template) => sum + getTemplateCount(template.id), 0)}
                    renderTemplate={template => {
                        const selected = selectedTemplateId === template.id;
                        const count = getTemplateCount(template.id);
                        return (
                            <button
                                type="button"
                                aria-pressed={selected}
                                onClick={() => onSelectTemplate(template.id)}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${selected
                                    ? 'bg-[var(--wf-side-active-bg)] font-bold text-[var(--wf-side-active-text)] shadow-sm ring-1 ring-[var(--wf-side-border)]'
                                    : 'font-medium text-[var(--wf-side-text)] hover:bg-[var(--wf-side-hover)]'}`}
                            >
                                <GitBranch size={13} className={`shrink-0 ${selected ? 'text-[var(--wf-green)]' : 'text-[var(--wf-side-muted)]'}`} />
                                <span className="min-w-0 flex-1 truncate" title={template.name}>{template.name}</span>
                                {count > 0 && <span className="shrink-0 rounded-full bg-[var(--wf-side-badge-bg)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--wf-side-badge-text)]">{count}</span>}
                            </button>
                        );
                    }}
                />
            )}
        </div>
    </aside>
);

export default WorkflowSidebar;
