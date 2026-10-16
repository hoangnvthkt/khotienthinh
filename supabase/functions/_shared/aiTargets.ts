// Kết nối AI dùng chung cho edge function (ai-gateway, wms-doc-reader, integrations) — chủ SP 16/10/2026.
// Một "đích" = loại + endpoint + khóa + model. Nguồn: kết nối Admin thêm ở Cài đặt → Kết nối (khóa trong Vault), chưa gán thì
// khóa trong Secrets như cũ. Tệp này không dùng API Deno để vitest kiểm thử được.

export type AiKind = 'anthropic' | 'gemini' | 'openai' | 'openai_compatible';
export type ModelClass = 'fast' | 'reasoning';
export type AiFeature = 'ai.fast' | 'ai.reasoning' | 'wms.doc_reader';

export interface AiTarget {
  kind: AiKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  source: 'connection' | 'secrets';
  name: string;
  connectionId?: string;
}

export const DEFAULT_BASE_URL: Record<AiKind, string> = {
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  openai_compatible: '',
};

export const DEFAULT_MODELS: Record<AiKind, Record<ModelClass, string>> = {
  anthropic: { fast: 'claude-haiku-5-5', reasoning: 'claude-opus-5-5' },
  gemini: { fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
  openai: { fast: '', reasoning: '' },
  openai_compatible: { fast: '', reasoning: '' },
};

export const KIND_LABEL: Record<AiKind, string> = {
  anthropic: 'Anthropic (Claude)', gemini: 'Google (Gemini)', openai: 'OpenAI', openai_compatible: 'Chuẩn OpenAI',
};

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** Hàng từ integration_secret_v1 (service_role) → đích; thiếu khóa thì null. */
export const targetFromConnection = (row: unknown, modelClass: ModelClass): AiTarget | null => {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const kind = r.kind as AiKind;
  if (!r.apiKey || !(kind in DEFAULT_BASE_URL)) return null;
  return {
    kind, baseUrl: trimUrl(String(r.baseUrl || DEFAULT_BASE_URL[kind])), apiKey: String(r.apiKey),
    model: String(r.model || DEFAULT_MODELS[kind][modelClass] || ''), source: 'connection', name: String(r.name || KIND_LABEL[kind]), connectionId: String(r.id || ''),
  };
};

export interface EnvEntry { id: string; kind: AiKind; name: string; baseUrl: string; model: string; keyHint: string; target: AiTarget }

/** Khóa đang có trong Secrets của edge function (chỉ đọc trên màn Kết nối). */
export const envEntries = (env: (name: string) => string | undefined): EnvEntry[] => {
  const out: EnvEntry[] = [];
  const add = (id: string, kind: AiKind, name: string, key: string | undefined, baseUrl: string, model: string) => {
    if (!key || !baseUrl) return;
    const target: AiTarget = { kind, baseUrl: trimUrl(baseUrl), apiKey: key, model, source: 'secrets', name };
    out.push({ id, kind, name, baseUrl: target.baseUrl, model, keyHint: key.slice(-4), target });
  };
  add('env:anthropic', 'anthropic', 'Anthropic (Secrets)', env('ANTHROPIC_API_KEY'), DEFAULT_BASE_URL.anthropic, env('AI_MODEL_FAST') || DEFAULT_MODELS.anthropic.fast);
  add('env:gemini', 'gemini', 'Gemini (Secrets)', env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'), DEFAULT_BASE_URL.gemini,
    env('GEMINI_FAST_MODEL') || env('GEMINI_MODEL') || DEFAULT_MODELS.gemini.fast);
  add('env:openai', 'openai', 'OpenAI (Secrets)', env('OPENAI_API_KEY'), DEFAULT_BASE_URL.openai, env('AI_MODEL_FAST') || '');
  add('env:ninerouter', 'openai_compatible', '9Router (Secrets)', env('NINEROUTER_KEY'), env('NINEROUTER_URL') || '', env('NINEROUTER_MODEL') || '');
  return out;
};

/** Endpoint chỉ https và không trỏ vào máy nội bộ (chặn dùng máy chủ Vioo dò mạng trong). */
export const isSafeEndpoint = (url: string): boolean => {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.startsWith('[') || host.includes(':')) return false;
  return true;
};

export interface ProbeResult {
  ok: boolean;
  ms: number;
  httpStatus: number | null;
  /** Số model đọc được; null khi không đọc được danh sách. */
  models: number | null;
  modelIds: string[];
  /** BAD_KEY · BAD_ENDPOINT · RATE_LIMIT · UNREACHABLE · UNSAFE_ENDPOINT · HTTP_5xx · MODEL_NOT_FOUND (vẫn ok) */
  code: string | null;
  message: string;
}

const MESSAGES: Record<string, string> = {
  BAD_KEY: 'Sai khóa hoặc khóa không có quyền',
  BAD_ENDPOINT: 'Sai endpoint (không tìm thấy)',
  RATE_LIMIT: 'Hết hạn mức hoặc bị giới hạn tốc độ',
  UNREACHABLE: 'Không gọi được tới endpoint',
  UNSAFE_ENDPOINT: 'Endpoint phải là https công khai',
  MODEL_NOT_FOUND: 'Kết nối được nhưng không thấy model đã chọn',
};
export const probeMessage = (code: string | null, httpStatus: number | null) =>
  code ? MESSAGES[code] || `Nhà cung cấp trả lỗi ${httpStatus ?? ''}`.trim() : 'Kết nối được';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Thử kết nối bằng lệnh nhẹ nhất: đọc danh sách model (không tốn token). */
export const probe = async (target: Pick<AiTarget, 'kind' | 'baseUrl' | 'apiKey' | 'model'>, fetchFn: FetchFn, now: () => number = Date.now): Promise<ProbeResult> => {
  const started = now();
  const done = (partial: Partial<ProbeResult>): ProbeResult => {
    const code = partial.code ?? null;
    return { ok: false, httpStatus: null, models: null, modelIds: [], ...partial, code, ms: now() - started, message: probeMessage(code, partial.httpStatus ?? null) };
  };
  const base = trimUrl(target.baseUrl || DEFAULT_BASE_URL[target.kind]);
  if (!isSafeEndpoint(base)) return done({ code: 'UNSAFE_ENDPOINT' });
  const request: { url: string; headers: Record<string, string> } = target.kind === 'anthropic'
    ? { url: `${base}/v1/models?limit=1000`, headers: { 'x-api-key': target.apiKey, 'anthropic-version': '2023-06-01' } }
    : target.kind === 'gemini'
      ? { url: `${base}/v1beta/models?pageSize=1000`, headers: { 'x-goog-api-key': target.apiKey } }
      : { url: `${base}/models`, headers: { Authorization: `Bearer ${target.apiKey}` } };
  let res: Response;
  try {
    res = await fetchFn(request.url, { method: 'GET', headers: request.headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch {
    return done({ code: 'UNREACHABLE' });
  }
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? 'BAD_KEY' : res.status === 404 ? 'BAD_ENDPOINT' : res.status === 429 ? 'RATE_LIMIT' : `HTTP_${res.status}`;
    return done({ httpStatus: res.status, code });
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { return done({ httpStatus: res.status, code: 'BAD_ENDPOINT' }); }
  const raw = (target.kind === 'gemini' ? data.models : data.data) as Array<Record<string, unknown>> | undefined;
  const ids = (Array.isArray(raw) ? raw : []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  const wanted = (target.model || '').trim();
  const missing = wanted && ids.length > 0 && !ids.includes(wanted);
  return done({ ok: true, httpStatus: res.status, models: ids.length, modelIds: ids.slice(0, 300), code: missing ? 'MODEL_NOT_FOUND' : null });
};
