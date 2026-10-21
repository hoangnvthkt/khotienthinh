// Cài đặt → Kết nối (chủ SP 16/10/2026): Admin thêm endpoint + API key của nhà cung cấp, thử kết nối, gán cho từng tính năng.
// Khóa mã hóa trong Vault; màn hình chỉ gửi khóa lên khi nhập mới và không bao giờ nhận lại (chỉ 4 ký tự cuối).
import { supabase } from './supabase';

export type ConnectionKind = 'anthropic' | 'gemini' | 'openai' | 'openai_compatible' | 'typesafe';
export type ConnectionFeature = 'ai.fast' | 'ai.reasoning' | 'wms.doc_reader' | 'ai.assistant' | 'ai.decisions';

export const KIND_OPTIONS: Array<{ kind: ConnectionKind; label: string; baseUrl: string; keyHint: string; modelHint: string }> = [
  { kind: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', keyHint: 'sk-ant-…', modelHint: 'claude-haiku-5-5' },
  { kind: 'gemini', label: 'Google (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com', keyHint: 'AIza…', modelHint: 'gemini-2.5-flash' },
  { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-…', modelHint: 'gpt-…' },
  { kind: 'openai_compatible', label: 'Chuẩn OpenAI khác (9Router, OpenRouter…)', baseUrl: '', keyHint: 'khóa của cổng', modelHint: 'tên model của cổng' },
  // TypeSafe Jev (J1, 18/10): model quyết định có kiểu (không sinh chữ) — chỉ gán cho "Trợ lý · điều hướng Jev".
  { kind: 'typesafe', label: 'TypeSafe (Jev · quyết định có kiểu)', baseUrl: 'https://api.typesafe.ai', keyHint: 'khóa tạo ở console.typesafe.ai', modelHint: 'jev-1.14.0' },
];
const SHORT: Record<ConnectionKind, string> = { anthropic: 'Anthropic', gemini: 'Gemini', openai: 'OpenAI', openai_compatible: 'Chuẩn OpenAI', typesafe: 'TypeSafe Jev' };
/** Tên ngắn: dùng làm tên mặc định khi thêm kết nối. */
export const kindLabel = (kind: ConnectionKind) => SHORT[kind] || kind;

/** Mẫu trong ô "Loại": mỗi loại kết nối + nhà cung cấp quen (điền sẵn endpoint, model). */
export interface ConnectionPreset { id: string; kind: ConnectionKind; label: string; name: string; baseUrl: string; keyHint: string; modelHint: string }
export const PRESETS: ConnectionPreset[] = [
  ...KIND_OPTIONS.filter(o => o.kind !== 'openai_compatible').map(o => ({ ...o, id: o.kind, name: SHORT[o.kind] })),
  // RevidAPI (16/10): cổng chuẩn OpenAI bán lại Claude, GPT, Gemini… trả bằng VND; khóa dạng sk_…
  { id: 'revidapi', kind: 'openai_compatible', label: 'RevidAPI (Claude, GPT, Gemini… trả VND)', name: 'RevidAPI', baseUrl: 'https://revidapi.com/v1', keyHint: 'sk_…', modelHint: 'claude-sonnet-5' },
  { ...KIND_OPTIONS[3], id: 'openai_compatible', name: SHORT.openai_compatible },
];
/** Mẫu của một kết nối đã lưu: theo endpoint nếu khớp nhà cung cấp quen, không thì theo loại. */
export const presetOf = (kind: ConnectionKind, baseUrl: string): ConnectionPreset =>
  PRESETS.find(p => p.id !== p.kind && p.kind === kind && baseUrl.replace(/\/+$/, '').startsWith(p.baseUrl)) || PRESETS.find(p => p.id === kind)!;
export const kindLabelFull = (kind: ConnectionKind) => KIND_OPTIONS.find(o => o.kind === kind)?.label || kind;

/** emptyLabel: khi chưa gán kết nối thì tính năng dùng gì (mặc định khóa trong Secrets). */
export const FEATURES: Array<{ feature: ConnectionFeature; label: string; emptyLabel?: string }> = [
  { feature: 'ai.fast', label: 'Trợ lý · model nhanh' },
  { feature: 'ai.reasoning', label: 'Trợ lý · model suy luận' },
  // Trợ lý v2 (17/10): hội thoại ở tab Trợ lý; chủ SP chọn claude-sonnet-5-5.
  { feature: 'ai.assistant', label: 'Trợ lý · hội thoại', emptyLabel: 'Như Trợ lý · model suy luận' },
  // B1 (21/10): một kết nối cho mọi chỗ đọc ảnh chứng từ (phiếu giao ở Kho, báo giá ở Lập đơn, phiếu viết tay ở Đề xuất); chưa gán → model nhanh.
  { feature: 'wms.doc_reader', label: 'Đọc ảnh chứng từ · Kho, Lập đơn, Đề xuất', emptyLabel: 'Như Trợ lý · model nhanh' },
  // J1 (18/10): Jev chạy bóng cạnh hội thoại — chỉ ghi so sánh vào ai_decisions, không đổi câu trả lời. Gán kết nối TypeSafe.
  { feature: 'ai.decisions', label: 'Trợ lý · điều hướng Jev (chạy bóng)', emptyLabel: 'Tắt — chưa ghi so sánh' },
];

export interface TestSummary { ms: number | null; httpStatus: number | null; models: number | null; code: string | null; message: string | null }

export interface Connection {
  id: string;
  kind: ConnectionKind;
  name: string;
  baseUrl: string;
  model: string | null;
  hasKey: boolean;
  keyHint: string | null;
  enabled: boolean;
  status: 'untested' | 'ok' | 'error';
  lastTestedAt: string | null;
  lastTest: TestSummary;
  updatedAt: string | null;
  updatedByName: string | null;
  /** Giá USD mỗi 1 triệu token (vào · ra) — để tính chi phí từng lượt AI và trần tháng; null = chưa khai. */
  priceInPerM: number | null;
  priceOutPerM: number | null;
  /** USD mỗi lượt gọi model — cho cổng báo token vào không ổn định (RevidAPI); có thì bỏ giá token vào. */
  pricePerCall: number | null;
}

/** Khóa đang có trong Secrets của edge function — chỉ đọc. */
export interface EnvConnection { id: string; kind: ConnectionKind; name: string; baseUrl: string; model: string; keyHint: string }

export interface ProbeResult { ok: boolean; ms: number; httpStatus: number | null; models: number | null; modelIds: string[]; code: string | null; message: string; balance?: { amount: number; unit: string } | null }

export interface ConnectionDraft { id?: string; kind: ConnectionKind; name: string; baseUrl: string; apiKey: string; model: string; enabled: boolean; priceIn: string; priceOut: string; pricePerCall: string }

const ERRORS: Record<string, string> = {
  INTEGRATIONS_ADMIN_REQUIRED: 'Chỉ Admin quản lý kết nối.',
  INTEGRATIONS_KEY_REQUIRED: 'Nhập API key.',
  INTEGRATIONS_KEY_REQUIRED_FOR_NEW_ENDPOINT: 'Đổi endpoint thì nhập lại API key (khóa cũ không gửi tới địa chỉ mới).',
  INTEGRATIONS_NOT_FOUND: 'Không tìm thấy kết nối.',
  INTEGRATIONS_TEST_FAILED: 'Chưa thử được, thử lại sau.',
  INTEGRATIONS_KEY_TOO_LONG: 'API key quá dài.',
  INTEGRATIONS_BAD_PRICE: 'Giá phải từ 0 đến 1.000 USD mỗi 1 triệu token.',
};
export const integrationError = (e: unknown, fallback = 'Chưa lưu được.') => {
  const msg = (e as { message?: string } | null)?.message || String(e || '');
  const code = Object.keys(ERRORS).find(k => msg.includes(k));
  if (code) return ERRORS[code];
  if (/check constraint.*base_url|base_url/i.test(msg)) return 'Endpoint phải bắt đầu bằng https://';
  if (/check constraint.*name/i.test(msg)) return 'Nhập tên kết nối.';
  return msg || fallback;
};

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
/** Ô giá: "0,33" hoặc "0.33" → "0.33"; trống → "" (xóa giá). */
export const priceText = (v: string) => v.trim().replace(',', '.');
const usd = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 6 });
/** "0,008 $/lượt + ra 1,6378" hoặc "0,33 / 1,64 $" — giá USD (mỗi lượt gọi; mỗi 1 triệu token vào / ra). */
export const priceLabel = (c: Pick<Connection, 'priceInPerM' | 'priceOutPerM' | 'pricePerCall'>) => {
  if (c.pricePerCall != null) return `${usd(c.pricePerCall)} $/lượt${c.priceOutPerM != null ? ` + ra ${usd(c.priceOutPerM)}` : ''}`;
  return c.priceInPerM == null || c.priceOutPerM == null ? null : `${usd(c.priceInPerM)} / ${usd(c.priceOutPerM)} $`;
};
const parseConnection = (raw: Record<string, unknown>): Connection => {
  const t = (raw.lastTest || {}) as Record<string, unknown>;
  return {
    id: String(raw.id), kind: raw.kind as ConnectionKind, name: String(raw.name || ''), baseUrl: String(raw.baseUrl || ''), model: (raw.model as string) || null,
    hasKey: raw.hasKey === true, keyHint: (raw.keyHint as string) || null, enabled: raw.enabled !== false,
    status: raw.status === 'ok' || raw.status === 'error' ? raw.status : 'untested', lastTestedAt: (raw.lastTestedAt as string) || null,
    lastTest: { ms: num(t.ms), httpStatus: num(t.httpStatus), models: num(t.models), code: (t.code as string) || null, message: (t.message as string) || null },
    updatedAt: (raw.updatedAt as string) || null, updatedByName: (raw.updatedByName as string) || null,
    priceInPerM: num(raw.priceInPerM), priceOutPerM: num(raw.priceOutPerM), pricePerCall: num(raw.pricePerCall),
  };
};

const invoke = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke('integrations', { body });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    let code = '';
    try { code = (await (error as { context?: Response }).context?.json?.())?.error || ''; } catch { code = ''; }
    if (status === 404 && !code) throw new Error('Hàm integrations chưa triển khai.');
    throw new Error(code || error.message);
  }
  return data as T;
};

export const integrationsService = {
  async list(): Promise<{ connections: Connection[]; assignments: Record<ConnectionFeature, string | null> }> {
    const { data, error } = await supabase.rpc('get_integration_connections_v1');
    if (error) throw error;
    const raw = (data || {}) as { connections?: Array<Record<string, unknown>>; assignments?: Record<string, string | null> };
    const a = raw.assignments || {};
    return {
      connections: (raw.connections || []).map(parseConnection),
      assignments: { 'ai.fast': a['ai.fast'] || null, 'ai.reasoning': a['ai.reasoning'] || null, 'wms.doc_reader': a['wms.doc_reader'] || null, 'ai.assistant': a['ai.assistant'] || null, 'ai.decisions': a['ai.decisions'] || null},
    };
  },
  async envConnections(): Promise<EnvConnection[]> {
    const r = await invoke<{ entries?: EnvConnection[] }>({ action: 'env' });
    return r.entries || [];
  },
  async save(draft: ConnectionDraft): Promise<Connection> {
    const { data, error } = await supabase.rpc('save_integration_connection_v1', { p: {
      id: draft.id || null, kind: draft.kind, name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), model: draft.model.trim() || null,
      enabled: draft.enabled, apiKey: draft.apiKey.trim() || null,
      priceInPerM: priceText(draft.priceIn), priceOutPerM: priceText(draft.priceOut), pricePerCall: priceText(draft.pricePerCall),
    } });
    if (error) throw error;
    return parseConnection(data as Record<string, unknown>);
  },
  async remove(id: string) {
    const { error } = await supabase.rpc('delete_integration_connection_v1', { p_id: id });
    if (error) throw error;
  },
  async assign(feature: ConnectionFeature, connectionId: string | null) {
    const { error } = await supabase.rpc('set_integration_assignment_v1', { p_feature: feature, p_connection_id: connectionId });
    if (error) throw error;
  },
  /** Thử kết nối đã lưu (ghi kết quả), khóa trong Secrets, hoặc bản nháp trước khi lưu. */
  async test(target: { connectionId: string } | { envId: string } | { draft: Omit<ConnectionDraft, 'name' | 'enabled' | 'id' | 'priceIn' | 'priceOut' | 'pricePerCall'>; connectionId?: string }) {
    return invoke<{ result: ProbeResult; connection?: Record<string, unknown> | null }>({ action: 'test', ...target })
      .then(r => ({ result: r.result, connection: r.connection ? parseConnection(r.connection) : null }));
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
/** "09:12" hôm nay, "09:12 14/10" ngày khác. */
export const testedAtLabel = (iso: string | null, now = new Date()) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? time : `${time} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
