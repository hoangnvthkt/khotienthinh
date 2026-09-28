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
  ['20260928080828_authorization_user_snapshot_for_admins.sql', '14bf6573c3b31015bbac291a01332c41d066d00b75ce719285546c2f8fe25258'],
  ['20260928083215_authorization_p2_documents_activities_rls.sql', '5f2cfb046f6980100ce4c99e41686443de7ec5f17bd53fe119ece4984492a9cd'],
  ['20260928083534_safety_storage_site_scoped_access.sql', '2e92d60b1c2964eeb60bea78cc7a69ab793ba01409679d6c57b3e1bcbe3dc649'],
  ['20260928084924_authorization_p1_6_private_project_photos.sql', 'bd00f8f6cab77baa59a62df5534ad1719f22b0cc73b90dcb8539d7808f1714ca'],
  ['20260928092719_authorization_p3_project_room_templates.sql', 'efc54a519fae25926767ca0452e5c27941070d57a78014a7a6207ae007ef5886'],
  ['20260928101825_authorization_p3_roles_to_personal_grants.sql', '904af1dcd1e025c878d983f7016dc5b3fa3bb5ddf8673d3785a3abe3cf4072f5'],
  ['20260928113000_authorization_p3_user_permission_templates.sql', 'a158d3af473ba0947f58cfcdfcfa607b113b9f101374933045fdd8b70a3352f8'],
] as const;

describe('Daily Log release migration history', () => {
  it('keeps the already-applied Cloud sources byte-identical to the reconciled originals', () => {
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
