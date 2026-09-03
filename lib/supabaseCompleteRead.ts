export interface SupabaseCompleteReadOptions {
  label: string;
  maxRows: number;
  orderBy: string | readonly string[];
  pageSize?: number;
}

export interface SupabaseCompleteReadResult<T> {
  data: T[] | null;
  error: any;
}

const DEFAULT_PAGE_SIZE = 1_000;

interface SortRule {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

/**
 * Executes a Supabase list query page-by-page and preserves the familiar
 * `{ data, error }` result shape used by existing services.
 *
 * The caller supplies the table's deterministic key columns. Existing
 * business ordering remains first; these columns are appended as stable
 * tie-breakers before range pages are requested.
 */
export async function fetchAllSupabaseRows<T = any>(
  query: any,
  options: SupabaseCompleteReadOptions,
): Promise<SupabaseCompleteReadResult<T>> {
  const pageSize = positiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, 'Page size');
  const maxRows = positiveInteger(options.maxRows, 'Maximum rows');
  const orderColumns = typeof options.orderBy === 'string' ? [options.orderBy] : [...options.orderBy];
  if (orderColumns.length === 0 || orderColumns.some(column => !column.trim())) {
    throw new Error('Complete read requires at least one deterministic order column');
  }

  const originalOrder = readAndRemoveRootOrder(query);
  let orderedQuery = query;
  for (const column of orderColumns) {
    orderedQuery = orderedQuery.order(column, { ascending: true });
  }
  orderedQuery = orderedQuery.limit(pageSize);

  const rows: T[] = [];
  let cursor: Record<string, unknown> | undefined;
  while (true) {
    if (cursor) addKeysetPredicate(orderedQuery, orderColumns, cursor);
    const result = await orderedQuery;
    if (result.error) return { data: null, error: result.error };

    const page = (result.data || []) as T[];
    if (rows.length + page.length > maxRows) {
      return {
        data: null,
        error: new Error(`${options.label} exceeded safety cap of ${maxRows} rows`),
      };
    }
    rows.push(...page);

    if (page.length < pageSize) {
      return { data: sortByOriginalOrder(rows, originalOrder), error: null };
    }

    const last = page[page.length - 1] as Record<string, unknown>;
    cursor = Object.fromEntries(orderColumns.map(column => [column, last?.[column]]));
    const missingColumn = orderColumns.find(column => cursor?.[column] === undefined || cursor?.[column] === null);
    if (missingColumn) {
      return {
        data: null,
        error: new Error(`${options.label} cannot continue keyset pagination without ${missingColumn}`),
      };
    }
  }
}

const readAndRemoveRootOrder = (query: any): SortRule[] => {
  const url = query?.url;
  if (!(url instanceof URL)) return [];
  const order = url.searchParams.get('order');
  if (!order) return [];
  url.searchParams.delete('order');
  return order.split(',').map((part: string) => {
    const [column, direction = 'asc', nulls = direction === 'asc' ? 'nullsfirst' : 'nullslast'] = part.split('.');
    return { column: column.replace(/^"|"$/gu, ''), ascending: direction !== 'desc', nullsFirst: nulls === 'nullsfirst' };
  });
};

const postgrestValue = (value: unknown): string => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
};

const addKeysetPredicate = (
  query: any,
  columns: readonly string[],
  cursor: Record<string, unknown>,
): void => {
  if (query?.url instanceof URL) {
    if (columns.length === 1) {
      query.url.searchParams.append(columns[0], `gt.${postgrestValue(cursor[columns[0]])}`);
      return;
    }
    const branches = columns.map((column, index) => {
      const equals = columns.slice(0, index)
        .map(previous => `${previous}.eq.${postgrestValue(cursor[previous])}`);
      const greater = `${column}.gt.${postgrestValue(cursor[column])}`;
      return index === 0 ? greater : `and(${[...equals, greater].join(',')})`;
    });
    query.url.searchParams.append('or', `(${branches.join(',')})`);
    return;
  }

  if (columns.length === 1 && typeof query.gt === 'function') {
    query.gt(columns[0], cursor[columns[0]]);
    return;
  }
  if (typeof query.or === 'function') {
    const branches = columns.map((column, index) => {
      const equals = columns.slice(0, index).map(previous => `${previous}.eq.${postgrestValue(cursor[previous])}`);
      const greater = `${column}.gt.${postgrestValue(cursor[column])}`;
      return index === 0 ? greater : `and(${[...equals, greater].join(',')})`;
    });
    query.or(branches.join(','));
  }
};

const compareValues = (left: unknown, right: unknown, rule: SortRule): number => {
  if (left == null || right == null) {
    if (left == null && right == null) return 0;
    const nullResult = left == null ? -1 : 1;
    return rule.nullsFirst ? nullResult : -nullResult;
  }
  const result = left < right ? -1 : left > right ? 1 : 0;
  return rule.ascending ? result : -result;
};

const sortByOriginalOrder = <T>(rows: T[], rules: SortRule[]): T[] => {
  if (rules.length === 0) return rows;
  return [...rows].sort((left: any, right: any) => {
    for (const rule of rules) {
      const result = compareValues(left?.[rule.column], right?.[rule.column], rule);
      if (result !== 0) return result;
    }
    return 0;
  });
};
