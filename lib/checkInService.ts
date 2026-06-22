import { AttendanceRecord } from '../types';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export type CameraCheckInAction = 'check_in' | 'check_out';
export type CameraCheckInLocationType = 'construction_site' | 'office';

export interface CameraCheckInLocation {
  id: string;
  name: string;
  type: CameraCheckInLocationType;
  lat: number | null;
  lng: number | null;
  radius: number;
  distanceM: number | null;
  inRange: boolean | null;
}

export interface CameraCheckInInput {
  action: CameraCheckInAction;
  employeeId: string;
  workDate: string;
  eventTime: string;
  lat: number | null;
  lng: number | null;
  location: CameraCheckInLocation;
  imageBlob: Blob | null;
}

type CameraCheckInRpcPayload = {
  p_action: CameraCheckInAction;
  p_employee_id: string;
  p_work_date: string;
  p_event_time: string;
  p_lat: number | null;
  p_lng: number | null;
  p_location_type: CameraCheckInLocationType;
  p_location_id: string;
  p_location_name: string;
  p_distance_m: number | null;
  p_in_range: boolean | null;
  p_image_url: string | null;
  p_device_info: Record<string, unknown>;
};

const PHOTO_BUCKET = 'checkin-photos';

const isFiniteNumberOrNull = (value: unknown): value is number | null => (
  value === null || (typeof value === 'number' && Number.isFinite(value))
);

const assertJsonSafe = (value: unknown, path: string): void => {
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} phải là số hữu hạn.`);
    return;
  }
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new Error(`${path} không JSON-safe (${type}).`);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) throw new Error(`${path} không được là Blob/File.`);
  if (typeof File !== 'undefined' && value instanceof File) throw new Error(`${path} không được là File.`);
  if (typeof FormData !== 'undefined' && value instanceof FormData) throw new Error(`${path} không được là FormData.`);
  if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) throw new Error(`${path} không được là MediaStream.`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (type === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path} phải là plain object JSON-safe.`);
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      assertJsonSafe(child, `${path}.${key}`);
    });
  }
};

const createDeviceInfo = (): Record<string, unknown> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
  return {
    user_agent: navigator.userAgent || null,
    platform: navigator.platform || null,
    language: navigator.language || null,
    online: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio || 1,
    },
  };
};

const prepareJsonBody = (payload: CameraCheckInRpcPayload): string => {
  const required: Array<keyof CameraCheckInRpcPayload> = ['p_action', 'p_employee_id', 'p_work_date', 'p_event_time'];
  const missing = required.filter((key) => !payload[key]);
  if (missing.length) throw new Error(`Thiếu payload check-in bắt buộc: ${missing.join(', ')}.`);
  if (!isFiniteNumberOrNull(payload.p_lat)) throw new Error('Latitude không hợp lệ.');
  if (!isFiniteNumberOrNull(payload.p_lng)) throw new Error('Longitude không hợp lệ.');

  Object.entries(payload).forEach(([key, value]) => assertJsonSafe(value, key));
  const body = JSON.stringify(payload);
  if (!body || body === '{}' || body === 'null') throw new Error('Payload check-in rỗng, không gọi Supabase.');

  console.info('[employee_camera_checkin_v1] payload', payload);
  console.info('[employee_camera_checkin_v1] JSON.stringify(payload)', body);
  return body;
};

const normalizeImageBlob = (blob: Blob | null): Blob | null => {
  if (!blob) return null;
  if (!(blob instanceof Blob)) throw new Error('Ảnh check-in phải là Blob hợp lệ.');
  if (!blob.size) throw new Error('Ảnh check-in rỗng.');
  return blob.type ? blob : blob.slice(0, blob.size, 'image/jpeg');
};

const uploadCheckInPhoto = async (
  blob: Blob | null,
  employeeId: string,
  action: CameraCheckInAction,
): Promise<string | null> => {
  const image = normalizeImageBlob(blob);
  if (!image) return null;

  const contentType = image.type && image.type.startsWith('image/') ? image.type : 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const safeEmployeeId = employeeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `${safeEmployeeId}/${new Date().toISOString().slice(0, 10)}_${action}_${Date.now()}.${ext}`;
  const file = typeof File !== 'undefined'
    ? new File([image], `${action}.${ext}`, { type: contentType })
    : image;

  console.info('[camera-checkin-storage] upload', {
    bucket: PHOTO_BUCKET,
    path: filePath,
    contentType,
    size: image.size,
  });

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file, { contentType, upsert: true });
  if (error) throw error;

  const { data: publicUrlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(data.path);
  return publicUrlData.publicUrl || data.path;
};

const callCameraCheckInRpc = async (payload: CameraCheckInRpcPayload): Promise<AttendanceRecord> => {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Chưa cấu hình Supabase URL/Anon Key.');

  const body = prepareJsonBody(payload);
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Phiên đăng nhập Supabase không hợp lệ.');

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/employee_camera_checkin_v1`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Supabase trả về phản hồi không phải JSON (${response.status}): ${text.slice(0, 180)}`);
    }
  }

  if (!response.ok) throw parsed || new Error(`Supabase RPC lỗi ${response.status}`);
  if (!parsed || Array.isArray(parsed)) throw new Error('Supabase không trả về bản ghi chấm công hợp lệ.');
  return parsed as AttendanceRecord;
};

export const checkInService = {
  async submit(input: CameraCheckInInput): Promise<AttendanceRecord> {
    const imageUrl = await uploadCheckInPhoto(input.imageBlob, input.employeeId, input.action);
    return callCameraCheckInRpc({
      p_action: input.action,
      p_employee_id: input.employeeId,
      p_work_date: input.workDate,
      p_event_time: input.eventTime,
      p_lat: input.lat,
      p_lng: input.lng,
      p_location_type: input.location.type,
      p_location_id: input.location.id,
      p_location_name: input.location.name,
      p_distance_m: input.location.distanceM,
      p_in_range: input.location.inRange,
      p_image_url: imageUrl,
      p_device_info: createDeviceInfo(),
    });
  },
};
