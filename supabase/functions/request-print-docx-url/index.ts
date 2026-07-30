import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const { requestId } = await request.json();
    if (typeof requestId !== 'string' || !requestId.trim()) return Response.json({ error: 'requestId is required' }, { status: 400 });

    const { data: detail, error: detailError } = await context.supabase.rpc('get_request_detail', { p_request_id: requestId });
    const path = detail?.printConfig?.docxStoragePath;
    if (detailError || !path || typeof path !== 'string') return Response.json({ error: 'Not found' }, { status: 404 });

    const { data: signed, error: signedError } = await context.supabaseAdmin.storage
      .from('workflow-templates')
      .createSignedUrl(path, 60, { download: false });
    if (signedError || !signed?.signedUrl) {
      console.error('request-print-docx-url signing failed', signedError);
      return Response.json({ error: 'Unable to create document URL' }, { status: 500 });
    }
    return Response.json({ signedUrl: signed.signedUrl, expiresIn: 60 });
  }),
};
