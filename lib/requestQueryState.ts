import type { RequestListItem } from './requestRuntimeService';

export interface RequestQueryFilter {
  view: 'ALL' | 'ASSIGNED_TO_ME' | 'CREATED_BY_ME' | 'WATCHING';
  status?: 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  overdue?: boolean;
  templateId?: string;
  search?: string;
}

export const requestQueryKey = (filter: RequestQueryFilter): string => JSON.stringify({
  view: filter.view,
  status: filter.status ?? null,
  overdue: filter.overdue ?? null,
  templateId: filter.templateId ?? null,
  search: filter.search?.trim() || null,
});

export const mergeRequestPage = <T extends { id: string }>(current: T[], next: T[]): T[] => {
  const seen = new Set<string>();
  return [...current, ...next].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export type RequestQueryItem = RequestListItem;
