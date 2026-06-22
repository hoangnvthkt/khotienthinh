import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const REQUEST_TIMEOUT_MS = 15000;
const REFRESH_LOCK_TIMEOUT_MS = REQUEST_TIMEOUT_MS + 2500;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 450;
const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504, 522, 524]);
const NON_RETRY_STATUS_CODES = new Set([400, 401, 403, 404]);
const REFRESH_LOCK_NAME = 'vioo-supabase-refresh-token';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

let refreshFetchPromise: Promise<Response> | null = null;

export const isTransientSupabaseError = (error: any): boolean => {
    if (!error) return false;
    const status = Number(error.status || error.statusCode || error.code);
    if (TRANSIENT_STATUS_CODES.has(status)) return true;
    const message = String(error.message || error.error_description || error.details || '').toLowerCase();
    return (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('abort') ||
        message.includes('pgrst002') ||
        message.includes('schema cache')
    );
};

const getRequestUrl = (input: FetchInput): string => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
};

const getRequestMethod = (input: FetchInput, init?: FetchInit): string => {
    if (init?.method) return init.method.toUpperCase();
    if (typeof input !== 'string' && !(input instanceof URL) && input.method) return input.method.toUpperCase();
    return 'GET';
};

const isRefreshTokenRequest = (input: FetchInput, init?: FetchInit): boolean => {
    try {
        const url = new URL(getRequestUrl(input));
        return getRequestMethod(input, init) === 'POST' &&
            url.pathname.endsWith('/auth/v1/token') &&
            url.searchParams.get('grant_type') === 'refresh_token';
    } catch {
        return false;
    }
};

const notifyRetry = (detail: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vioo:supabase-retry', { detail }));
};

const notifyRecovered = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vioo:supabase-recovered'));
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getRetryDelay = (attemptIndex: number): number => {
    const exponential = BASE_BACKOFF_MS * (2 ** attemptIndex);
    const jitter = Math.floor(Math.random() * 350);
    return exponential + jitter;
};

const fetchWithTimeout = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const timeout = globalThis.setTimeout(() => controller.abort('supabase-request-timeout'), REQUEST_TIMEOUT_MS);
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason || 'upstream-abort');

    if (upstreamSignal) {
        if (upstreamSignal.aborted) abortFromUpstream();
        else upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }

    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        globalThis.clearTimeout(timeout);
        upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
};

const shouldRetryResponse = (response: Response): boolean => {
    if (NON_RETRY_STATUS_CODES.has(response.status)) return false;
    return TRANSIENT_STATUS_CODES.has(response.status);
};

const canRetryRequest = (input: FetchInput, init?: FetchInit): boolean => {
    const method = getRequestMethod(input, init);
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
};

const fetchWithRetry = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    let lastError: unknown = null;
    const url = getRequestUrl(input);
    const retryableRequest = canRetryRequest(input, init);

    if (!retryableRequest) {
        return fetchWithTimeout(input, init);
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetchWithTimeout(input, init);
            if (response.ok) notifyRecovered();
            if (!shouldRetryResponse(response) || attempt === MAX_ATTEMPTS - 1) {
                return response;
            }

            const delay = getRetryDelay(attempt);
            notifyRetry({ url, attempt: attempt + 1, status: response.status, delay });
            await sleep(delay);
        } catch (error: any) {
            lastError = error;
            if (init?.signal?.aborted || attempt === MAX_ATTEMPTS - 1) throw error;

            const delay = getRetryDelay(attempt);
            notifyRetry({ url, attempt: attempt + 1, error: error?.message || 'network_error', delay });
            await sleep(delay);
        }
    }

    throw lastError;
};

const withRefreshLock = async <T,>(task: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
    if (!locks?.request) return task();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            notifyRetry({ url: 'supabase-auth-refresh-lock', error: 'refresh_lock_timeout', delay: 0 });
            reject(new Error('supabase refresh lock timeout'));
        }, REFRESH_LOCK_TIMEOUT_MS);
    });

    try {
        return await Promise.race([
            locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, task),
            timeoutPromise,
        ]);
    } finally {
        if (timeoutId) globalThis.clearTimeout(timeoutId);
    }
};

const resilientFetch: typeof fetch = async (input, init) => {
    if (!isRefreshTokenRequest(input, init)) return fetchWithRetry(input, init);

    if (!refreshFetchPromise) {
        refreshFetchPromise = withRefreshLock(() => fetchWithRetry(input, init))
            .finally(() => {
                refreshFetchPromise = null;
            });
    }

    const response = await refreshFetchPromise;
    return response.clone();
};

export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder_key',
    {
        db: {
            timeout: REQUEST_TIMEOUT_MS,
        },
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
        global: {
            fetch: resilientFetch,
        },
    }
);
