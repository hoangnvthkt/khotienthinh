import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const servicePath = path.resolve(process.cwd(), 'lib/paymentCertificateService.ts');

describe('Payment Certificate transition service', () => {
  it('routes status changes through the backend transition command', () => {
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).toMatch(/supabase\.rpc\('transition_project_payment_certificate_status'/);
    expect(source).not.toMatch(/const \{ error \} = await supabase\.from\(TABLE\)\.update\(toDb\(updates\)\)\.eq\('id', id\);/);
  });
});
