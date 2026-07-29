import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request DOCX download boundary', () => {
  it('uses an authenticated edge function before signing a private DOCX URL', () => {
    const source = readFileSync('supabase/functions/request-print-docx-url/index.ts', 'utf8');
    expect(source).toContain("get_request_detail");
    expect(source).toContain("createSignedUrl");
    expect(source).toContain("withSupabase({ auth: 'user' }");
    expect(source).toContain('context.supabaseAdmin.storage');
  });
});
