// G1 anti buddy punching (owner decision 02/10/2026): each punch is unlocked with the
// fingerprint / Face ID of the person's own registered phone (WebAuthn passkey).
// Only the public key is stored — no biometric data leaves the phone.
//
// Actions (end-user JWT required):
//   register-options / register-verify — enrol this phone (first phone active, others wait for HR)
//   punch-options / punch-verify        — verify the passkey and return a single-use punch token
import { createClient } from '@supabase/supabase-js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const DEFAULT_ORIGINS = ['https://khotienthinh.vercel.app'];
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const allowedOrigins = (): string[] => {
  const configured = (Deno.env.get('HRM_PASSKEY_ORIGINS') || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
};

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
});

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const headers = corsHeaders(origin);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!origin || !(allowedOrigins().includes(origin) || DEV_ORIGIN.test(origin))) {
      throw new HttpError(403, 'Tên miền này chưa được phép đăng ký vân tay / Face ID.');
    }
    const rpID = new URL(origin).hostname;

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ.');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ.');

    const { data: appUser } = await admin.from('users')
      .select('id, name, is_active, account_status').eq('auth_id', authData.user.id).maybeSingle();
    if (!appUser || appUser.is_active !== true || appUser.account_status === 'DISABLED') {
      throw new HttpError(403, 'Tài khoản không còn hoạt động.');
    }
    const { data: employee } = await admin.from('employees')
      .select('id, employee_code, full_name')
      .eq('user_id', appUser.id).eq('status', 'Đang làm việc')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (!employee) throw new HttpError(403, 'Tài khoản chưa được liên kết hồ sơ nhân sự.');

    const raw = await request.text();
    if (raw.length > 20000) throw new HttpError(400, 'Yêu cầu không hợp lệ.');
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;

    const saveChallenge = async (purpose: 'register' | 'punch', challenge: string) => {
      const { error } = await admin.from('hrm_attendance_challenges').insert({ employee_id: employee.id, purpose, challenge });
      if (error) throw new Error('CHALLENGE_SAVE_FAILED');
    };
    // The challenge must have been issued to this person for this purpose, recently, and only once.
    const takeChallenge = async (purpose: 'register' | 'punch', clientDataJSON: unknown) => {
      if (typeof clientDataJSON !== 'string') throw new HttpError(400, 'Yêu cầu không hợp lệ.');
      const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(clientDataJSON)));
      const challenge = String(clientData.challenge || '');
      const { data } = await admin.from('hrm_attendance_challenges')
        .update({ used_at: new Date().toISOString() })
        .eq('employee_id', employee.id).eq('purpose', purpose).eq('challenge', challenge)
        .is('used_at', null).gt('expires_at', new Date().toISOString())
        .select('challenge');
      if (!data?.length) throw new HttpError(400, 'Phiên xác thực đã hết hạn. Hãy thử lại.');
      return challenge;
    };

    const { data: devices } = await admin.from('hrm_attendance_devices')
      .select('id, credential_id, public_key, sign_count, transports, status')
      .eq('employee_id', employee.id).neq('status', 'REVOKED').limit(20);

    switch (body.action) {
      case 'register-options': {
        const options = await generateRegistrationOptions({
          rpName: 'Vioo chấm công',
          rpID,
          userName: employee.employee_code || employee.id,
          userDisplayName: employee.full_name || appUser.name || '',
          userID: new TextEncoder().encode(employee.id),
          attestationType: 'none',
          excludeCredentials: (devices || []).map(device => ({ id: device.credential_id, transports: device.transports || [] })),
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        });
        await saveChallenge('register', options.challenge);
        return json({ options });
      }
      case 'register-verify': {
        const response = body.response as { response?: { clientDataJSON?: unknown } } | undefined;
        const expectedChallenge = await takeChallenge('register', response?.response?.clientDataJSON);
        const verification = await verifyRegistrationResponse({
          // deno-lint-ignore no-explicit-any
          response: response as any,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
        if (!verification.verified || !verification.registrationInfo) throw new HttpError(400, 'Không xác minh được vân tay / Face ID.');
        const credential = verification.registrationInfo.credential;
        const { data, error } = await admin.rpc('hrm_register_attendance_device', {
          p_employee_id: employee.id,
          p_user_id: appUser.id,
          p_credential_id: credential.id,
          p_public_key: toBase64Url(credential.publicKey),
          p_sign_count: credential.counter,
          p_transports: credential.transports || [],
          p_device_local_id: typeof body.deviceLocalId === 'string' ? body.deviceLocalId.slice(0, 80) : null,
          p_device_label: typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 120) : null,
        });
        if (error) throw new Error('DEVICE_SAVE_FAILED');
        return json({ device: data });
      }
      case 'punch-options': {
        const active = (devices || []).filter(device => device.status === 'ACTIVE');
        if (active.length === 0) {
          const pending = (devices || []).some(device => device.status === 'PENDING');
          throw new HttpError(409, pending
            ? 'Điện thoại này đang chờ HR duyệt. Bạn sẽ chấm công được sau khi được duyệt.'
            : 'Chưa đăng ký điện thoại chấm công.');
        }
        const options = await generateAuthenticationOptions({
          rpID,
          userVerification: 'required',
          allowCredentials: active.map(device => ({ id: device.credential_id, transports: device.transports || [] })),
        });
        await saveChallenge('punch', options.challenge);
        return json({ options });
      }
      case 'punch-verify': {
        const response = body.response as { id?: unknown; response?: { clientDataJSON?: unknown } } | undefined;
        const device = (devices || []).find(row => row.credential_id === response?.id && row.status === 'ACTIVE');
        if (!device) throw new HttpError(403, 'Điện thoại này không phải thiết bị chấm công đã đăng ký của bạn.');
        const expectedChallenge = await takeChallenge('punch', response?.response?.clientDataJSON);
        const verification = await verifyAuthenticationResponse({
          // deno-lint-ignore no-explicit-any
          response: response as any,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: device.credential_id,
            publicKey: fromBase64Url(device.public_key),
            counter: Number(device.sign_count) || 0,
            // deno-lint-ignore no-explicit-any
            transports: (device.transports || []) as any,
          },
        });
        if (!verification.verified) throw new HttpError(403, 'Không xác minh được vân tay / Face ID.');
        const { data: punchToken, error } = await admin.rpc('hrm_issue_attendance_punch_token', {
          p_employee_id: employee.id,
          p_credential_id: device.credential_id,
          p_new_sign_count: verification.authenticationInfo.newCounter,
        });
        if (error) throw new HttpError(403, 'Thiết bị chấm công không hợp lệ. Liên hệ phòng HCNS.');
        return json({ punchToken });
      }
      default:
        throw new HttpError(400, 'Yêu cầu không hợp lệ.');
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('hrm-attendance-passkey failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'Không xác thực được. Hãy thử lại.' }, 500);
  }
});
