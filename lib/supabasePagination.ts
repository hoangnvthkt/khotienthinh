export interface CursorPage<T, C> {
  items: T[];
  nextCursor?: C;
}

export const clampPageSize = (
  value: number | undefined,
  fallback = 50,
  maximum = 100,
): number => Math.min(Math.max(Math.floor(Number(value || fallback)), 1), maximum);

const assertPositiveInteger = (value: number, message: string): void => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(message);
};

export function takeCursorPage<T, C>(
  rows: T[],
  pageSize: number,
  getCursor: (row: T) => C,
): CursorPage<T, C> {
  assertPositiveInteger(pageSize, 'Page size must be a positive integer');
  const items = rows.slice(0, pageSize);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > pageSize && last !== undefined ? getCursor(last) : undefined,
  };
}

const bytesToBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function encodeCursor<C>(cursor: C): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeCursor<C>(cursor: string): C {
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(cursor.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as C;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

export function chunkValues<T>(values: readonly T[], chunkSize: number): T[][] {
  assertPositiveInteger(chunkSize, 'Chunk size must be a positive integer');
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

const abortError = (): Error => {
  const error = new Error('Complete read was aborted');
  error.name = 'AbortError';
  return error;
};

export async function fetchAllPages<T, C>(input: {
  pageSize: number;
  maxRows: number;
  signal?: AbortSignal;
  loadPage: (cursor?: C) => Promise<CursorPage<T, C>>;
}): Promise<T[]> {
  assertPositiveInteger(input.pageSize, 'Page size must be a positive integer');
  assertPositiveInteger(input.maxRows, 'Maximum rows must be a positive integer');

  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: C | undefined;

  while (true) {
    if (input.signal?.aborted) throw abortError();
    const page = await input.loadPage(cursor);
    if (input.signal?.aborted) throw abortError();

    if (rows.length + page.items.length > input.maxRows) {
      throw new Error(`Complete read exceeded safety cap of ${input.maxRows} rows`);
    }
    rows.push(...page.items);

    if (page.nextCursor === undefined) return rows;
    const cursorKey = JSON.stringify(page.nextCursor);
    if (seenCursors.has(cursorKey)) {
      throw new Error('Complete read received a repeated cursor');
    }
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }
}
