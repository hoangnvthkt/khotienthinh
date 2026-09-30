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

const VIEWS = new Set<RequestQueryFilter['view']>(['ALL', 'ASSIGNED_TO_ME', 'CREATED_BY_ME', 'WATCHING']);
const STATUSES = new Set<NonNullable<RequestQueryFilter['status']>>(['PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED']);

/** List filters live in the URL so opening/closing a request keeps them. */
export const parseRequestListParams = (params: URLSearchParams): Required<Pick<RequestQueryFilter, 'view'>> & {
  status?: RequestQueryFilter['status'];
  overdue: boolean;
  search: string;
} => {
  const view = params.get('view') as RequestQueryFilter['view'] | null;
  const status = params.get('status') as RequestQueryFilter['status'] | null;
  return {
    view: view && VIEWS.has(view) ? view : 'ALL',
    status: status && STATUSES.has(status) ? status : undefined,
    overdue: params.get('overdue') === '1',
    search: params.get('q') ?? '',
  };
};

export const buildRequestListParams = (filter: {
  view: RequestQueryFilter['view'];
  status?: RequestQueryFilter['status'];
  overdue?: boolean;
  search?: string;
}): URLSearchParams => {
  const params = new URLSearchParams();
  if (filter.view !== 'ALL') params.set('view', filter.view);
  if (filter.status) params.set('status', filter.status);
  if (filter.overdue) params.set('overdue', '1');
  if (filter.search) params.set('q', filter.search);
  return params;
};
