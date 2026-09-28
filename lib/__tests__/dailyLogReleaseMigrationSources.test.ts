import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const authoritativeCloudSources = [
  ['20260923042822_fix_auth_profile_legacy_guard_order.sql', '76627f3d07668a309a1bd74a3371fc6f512ce6a3cfbe949da8b0220dfb4fa7e8'],
  ['20260924094500_project_material_request_site_stock_context.sql', '173db3df98e92faa696ea0ef21950f0d15cddd4cf9e8865829a01e59d1b116ae'],
  ['20260924164000_project_material_purchase_boq_warning_stock.sql', 'b9a30de2b7ace1890148f27f8e8611d99c2e39171f22c436c3dc20e35d9e36c5'],
  ['20260924165000_project_purchase_warning_verified_on_hand.sql', '6fd64d5a873b1ff34ee861344ae0bb40ccae139023e8dde0c7a2d60085aab893'],
  ['20260928062658_notification_event_recipients_request_safety.sql', 'cd8347d677f3c29d040fae5c61157f2660062120f3a961f1db6810a696c27681'],
  ['20260928065520_notification_preferences_digest.sql', '2d7f68b0d5dd80bdcce3b1fc3bf4539fe9433e7be226c7fc0b6fb9fce32941c1'],
] as const;

describe('Daily Log release migration history', () => {
  it('keeps the six already-applied Cloud sources byte-identical to the reconciled originals', () => {
    const missing = authoritativeCloudSources
      .map(([filename]) => filename)
      .filter(filename => !existsSync(join(process.cwd(), 'supabase/migrations', filename)));
    expect(missing).toEqual([]);

    const actual = authoritativeCloudSources.map(([filename]) =>
      createHash('sha256').update(readFileSync(join(process.cwd(), 'supabase/migrations', filename))).digest('hex'),
    );
    expect(actual).toEqual(authoritativeCloudSources.map(([, hash]) => hash));
  });

  it('allowlists those exact sources in the migration baseline', () => {
    const marker = JSON.parse(readFileSync(join(process.cwd(), 'supabase/baseline/current.json'), 'utf8'));
    expect(authoritativeCloudSources
      .map(([filename]) => filename)
      .filter(filename => !marker.allowedPostBaselineFiles.includes(filename))).toEqual([]);
  });
});
