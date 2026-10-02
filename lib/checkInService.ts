import { AttendanceRecord, Employee, HrmConstructionSite, HrmOffice } from '../types';
import type { CheckInLocationType } from './attendanceGeo';
import { mapEmployeeFromDb } from './employeeSelfService';
import { supabase } from './supabase';

export interface AttendancePunchInput {
  employeeId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  location: { id: string; type: CheckInLocationType };
  imageBlob: Blob;
  /** Single-use token from a verified fingerprint / Face ID unlock (G1). */
  punchToken: string | null;
}

export interface PasskeyState {
  /** Company setting: punches need the registered phone's fingerprint / Face ID. */
  required: boolean;
  /** HR exempted this person (phone without passkey support). */
  exempt: boolean;
  devices: Array<{ id: string; status: 'ACTIVE' | 'PENDING' | 'REVOKED'; deviceLabel: string | null; registeredAt: string }>;
}

export interface MyCheckInContext {
  employee: Employee | null;
  attendanceRecords: AttendanceRecord[];
  constructionSites: HrmConstructionSite[];
  offices: HrmOffice[];
  /** Construction sites the person is currently assigned to (project staff). */
  assignedSiteIds: string[];
}

const PHOTO_BUCKET = 'checkin-photos';

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

const normalizeImageBlob = (blob: Blob | null): Blob | null => {
  if (!blob) return null;
  if (!(blob instanceof Blob)) throw new Error('Ảnh check-in phải là Blob hợp lệ.');
  if (!blob.size) throw new Error('Ảnh check-in rỗng.');
  return blob.type ? blob : blob.slice(0, blob.size, 'image/jpeg');
};

const uploadCheckInPhoto = async (
  blob: Blob | null,
  employeeId: string,
): Promise<string> => {
  const image = normalizeImageBlob(blob);
  if (!image) throw new Error('Chưa chụp được ảnh chấm công.');

  const contentType = image.type && image.type.startsWith('image/') ? image.type : 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const safeEmployeeId = employeeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `${safeEmployeeId}/${new Date().toISOString().slice(0, 10)}_${Date.now()}.${ext}`;
  const file = typeof File !== 'undefined'
    ? new File([image], `checkin.${ext}`, { type: contentType })
    : image;

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file, { contentType, upsert: false });
  if (error) throw error;

  const { data: publicUrlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(data.path);
  return publicUrlData.publicUrl || data.path;
};

export const checkInService = {
  async loadMyContext(): Promise<MyCheckInContext> {
    const { data, error } = await supabase.rpc('get_my_checkin_context');
    if (error) throw new Error(error.message || 'Không thể tải hồ sơ Check-in.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Không thể tải hồ sơ Check-in.');
    }

    const payload = data as Record<string, unknown>;
    return {
      employee: payload.employee && typeof payload.employee === 'object'
        ? mapEmployeeFromDb(payload.employee)
        : null,
      attendanceRecords: Array.isArray(payload.attendanceRecords)
        ? payload.attendanceRecords as AttendanceRecord[]
        : [],
      constructionSites: Array.isArray(payload.constructionSites)
        ? payload.constructionSites as HrmConstructionSite[]
        : [],
      offices: Array.isArray(payload.offices) ? payload.offices as HrmOffice[] : [],
      assignedSiteIds: Array.isArray(payload.assignedSiteIds) ? payload.assignedSiteIds.map(String) : [],
    };
  },

  /** One-button punch: the server decides "vào"/"ra", measures the distance and stamps the time. */
  async punch(input: AttendancePunchInput): Promise<AttendanceRecord> {
    const imageUrl = await uploadCheckInPhoto(input.imageBlob, input.employeeId);
    const { data, error } = await supabase.rpc('employee_attendance_punch_v2', {
      p_lat: input.lat,
      p_lng: input.lng,
      p_accuracy_m: input.accuracyM,
      p_location_type: input.location.type,
      p_location_id: input.location.id,
      p_image_url: imageUrl,
      p_device_info: createDeviceInfo(),
      p_punch_token: input.punchToken,
    });
    if (error) throw error;
    if (!data || Array.isArray(data)) throw new Error('Chưa nhận được kết quả chấm công. Vui lòng thử lại.');
    return data as AttendanceRecord;
  },

  async loadPasskeyState(employeeId: string): Promise<PasskeyState> {
    const [settings, exemption, devices] = await Promise.all([
      supabase.from('hrm_attendance_settings').select('require_device_passkey').limit(1).maybeSingle(),
      supabase.from('hrm_attendance_passkey_exemptions').select('valid_until').eq('employee_id', employeeId).limit(1).maybeSingle(),
      supabase.from('hrm_attendance_devices').select('id,status,device_label,registered_at')
        .eq('employee_id', employeeId).neq('status', 'REVOKED').order('registered_at', { ascending: false }).limit(10),
    ]);
    if (settings.error) throw settings.error;
    if (devices.error) throw devices.error;
    const validUntil = exemption.data?.valid_until as string | null | undefined;
    return {
      required: settings.data?.require_device_passkey !== false,
      exempt: Boolean(exemption.data) && (!validUntil || validUntil >= new Date().toLocaleDateString('sv-SE')),
      devices: (devices.data || []).map(row => ({
        id: String(row.id),
        status: row.status as 'ACTIVE' | 'PENDING' | 'REVOKED',
        deviceLabel: (row.device_label as string | null) || null,
        registeredAt: String(row.registered_at),
      })),
    };
  },
};
