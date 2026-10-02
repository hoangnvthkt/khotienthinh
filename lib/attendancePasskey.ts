// Fingerprint / Face ID unlock for punches (G1, owner decision 02/10/2026).
// The phone keeps the private key; the server only sees a public key and signed challenges.
import { supabase } from './supabase';

const DEVICE_ID_KEY = 'vioo.attendance.deviceLocalId';
const FUNCTION_NAME = 'hrm-attendance-passkey';

type Json = Record<string, unknown>;

const toBuffer = (value: string): ArrayBuffer => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const toBase64Url = (buffer: ArrayBuffer | null | undefined): string | undefined => {
  if (!buffer) return undefined;
  let binary = '';
  new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A random id kept on this phone, so one phone used for several accounts can be noticed. */
export const getDeviceLocalId = (): string | null => {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
};

export const describeThisDevice = (): string => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  const android = /Android[^;)]*;\s*([^;)]+)/i.exec(agent);
  if (android) return android[1].replace(/Build\/.*/i, '').trim() || 'Android';
  if (/Macintosh/i.test(agent)) return 'Mac';
  if (/Windows/i.test(agent)) return 'Windows';
  return 'Thiết bị khác';
};

export const isPasskeySupported = async (): Promise<boolean> => {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

const callFunction = async (body: Json): Promise<Json> => {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
  if (error) {
    let message = '';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try { message = String(((await context.json()) as Json).error || ''); } catch { /* keep default */ }
    }
    throw new Error(message || 'Không xác thực được vân tay / Face ID. Hãy thử lại.');
  }
  return (data || {}) as Json;
};

const describeCancel = (error: unknown): Error => {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError') return new Error('Đã hủy hoặc hết thời gian xác thực vân tay / Face ID.');
  if (name === 'InvalidStateError') return new Error('Điện thoại này đã đăng ký cho tài khoản của bạn.');
  return error instanceof Error ? error : new Error('Không xác thực được vân tay / Face ID.');
};

/** Enrols this phone. Returns ACTIVE for the first phone, PENDING when HR must approve. */
export const registerThisPhone = async (): Promise<{ status: string; pendingReason?: string | null }> => {
  const { options } = await callFunction({ action: 'register-options' }) as { options: Json & {
    challenge: string; user: Json & { id: string }; excludeCredentials?: Array<Json & { id: string }>;
  } };
  let credential: PublicKeyCredential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        ...(options as unknown as PublicKeyCredentialCreationOptions),
        challenge: toBuffer(options.challenge),
        user: { ...(options.user as unknown as PublicKeyCredentialUserEntity), id: toBuffer(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map(item => ({
          ...(item as unknown as PublicKeyCredentialDescriptor), id: toBuffer(item.id),
        })),
      },
    }) as PublicKeyCredential;
  } catch (error) {
    throw describeCancel(error);
  }
  const attestation = credential.response as AuthenticatorAttestationResponse;
  const { device } = await callFunction({
    action: 'register-verify',
    deviceLocalId: getDeviceLocalId(),
    deviceLabel: describeThisDevice(),
    response: {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toBase64Url(attestation.clientDataJSON),
        attestationObject: toBase64Url(attestation.attestationObject),
        transports: typeof attestation.getTransports === 'function' ? attestation.getTransports() : [],
      },
    },
  }) as { device: { status: string; pendingReason?: string | null } };
  return device;
};

/** Unlocks one punch: fingerprint / Face ID on the registered phone → single-use token. */
export const getPunchToken = async (): Promise<string> => {
  const { options } = await callFunction({ action: 'punch-options' }) as { options: Json & {
    challenge: string; allowCredentials?: Array<Json & { id: string }>;
  } };
  let credential: PublicKeyCredential;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        ...(options as unknown as PublicKeyCredentialRequestOptions),
        challenge: toBuffer(options.challenge),
        allowCredentials: (options.allowCredentials || []).map(item => ({
          ...(item as unknown as PublicKeyCredentialDescriptor), id: toBuffer(item.id),
        })),
      },
    }) as PublicKeyCredential;
  } catch (error) {
    throw describeCancel(error);
  }
  const assertion = credential.response as AuthenticatorAssertionResponse;
  const { punchToken } = await callFunction({
    action: 'punch-verify',
    response: {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toBase64Url(assertion.clientDataJSON),
        authenticatorData: toBase64Url(assertion.authenticatorData),
        signature: toBase64Url(assertion.signature),
        userHandle: toBase64Url(assertion.userHandle),
      },
    },
  }) as { punchToken: string };
  if (!punchToken) throw new Error('Không nhận được xác nhận chấm công.');
  return punchToken;
};
