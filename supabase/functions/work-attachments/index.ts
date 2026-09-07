import { createClient } from '@supabase/supabase-js';
import { processFile, InvalidFile, imageProcessorHealth } from './processor.ts';
import { cleanupAttachments, finalizeAttachment, type Claim } from './worker.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const internal = request.headers.get('x-web-push-secret');
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (internal) {
    if (!Deno.env.get('SEND_WEB_PUSH_SECRET') || internal !== Deno.env.get('SEND_WEB_PUSH_SECRET')) return response({ error: 'Unauthorized' }, 401);
  } else {
    if (!token || (await admin.auth.getUser(token)).error) return response({ error: 'Unauthorized' }, 401);
  }
  if (Number(request.headers.get('content-length')) > 2048) return response({ error: 'Invalid request' }, 400);
  const raw = await request.text();
  if (raw.length > 2048) return response({ error: 'Invalid request' }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return response({ error: 'Invalid request' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: 'Invalid request' }, 400);
  try {
    if (body.action === 'health') {
      if (!internal) return response({ error: 'Forbidden' }, 403);
      return response(await imageProcessorHealth());
    }
    if (body.action === 'cleanup') {
      if (!internal) return response({ error: 'Forbidden' }, 403);
      return response(await cleanupAttachments(admin));
    }
    if (internal || !['finalize','read'].includes(body.action) || typeof body.attachmentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.attachmentId)) return response({ error: 'Invalid request' }, 400);
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const result = await user.rpc('command_work_attachment', { p_command: body.action === 'finalize' ? 'claim' : 'read', p_payload: { attachmentId: body.attachmentId, ...(body.action === 'read' ? { variant: body.variant } : {}) }, p_idempotency_key: crypto.randomUUID() });
    if (result.error) return response({ error: result.error.message }, result.error.code === '42501' ? 403 : 409);
    if (body.action === 'finalize') return response(await finalizeAttachment(admin, result.data as Claim, (bytes, mime, size, keep) => processFile(bytes, mime, size, keep, Number(Deno.env.get('WORK_IMAGE_MAX_EDGE') || 1920))));
    const download = body.variant === 'original' || !result.data.mimeType.startsWith('image/');
    const signed = await admin.storage.from('work-attachments').createSignedUrl(result.data.path, 60, { download: download ? result.data.fileName : false });
    if (signed.error) throw new Error('WORK_SIGN_FAILED');
    return response({ signedUrl: signed.data.signedUrl, expiresIn: 60 });
  } catch (error) {
    if (error instanceof InvalidFile) return response({ error: 'WORK_INVALID_FILE' }, 422);
    console.error('Work attachment operation failed');
    return response({ error: 'WORK_ATTACHMENT_OPERATION_FAILED' }, 500);
  }
});
