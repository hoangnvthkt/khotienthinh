import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { resolveApprovedBranchConnection } from './cloudConnection';

const migrationPaths = [
  'supabase/migrations/20260914045955_request_content_revisions.sql',
  'supabase/migrations/20260914045956_request_discussion_storage.sql',
  'supabase/migrations/20260914075111_request_discussion_rpc_permissions.sql',
];

describe('request discussion and content revision migrations on approved Cloud branch', () => {
  let db: Client;

  beforeAll(async () => {
    const config = resolveApprovedBranchConnection(process.env.PROCUREMENT_PARENT_ENV_FILE);
    const url = new URL(config.databaseUrl);
    url.search = '';
    db = new Client({
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: true,
        ca: readFileSync(resolve(process.env.PROCUREMENT_TEST_CA_FILE!), 'utf8'),
      },
      statement_timeout: 45_000,
      application_name: 'request-discussion-migration-rollback-test',
    });
    await db.connect();
    await db.query('begin');
    const history = await db.query(`select version
      from supabase_migrations.schema_migrations
      where version in ('20260914045955','20260914045956','20260914075111')`);
    const applied = new Set(history.rows.map(row => row.version));
    const baseCount = Number(applied.has('20260914045955')) + Number(applied.has('20260914045956'));
    if (baseCount === 0 || baseCount === 2) {
      for (const path of migrationPaths.filter(path => !applied.has(path.split('/').pop()!.slice(0, 14)))) {
        const sql = readFileSync(resolve(path), 'utf8');
        try {
          await db.query(sql);
        } catch (error) {
          const position = Number((error as { position?: string }).position ?? 0);
          const context = position > 0 ? sql.slice(Math.max(0, position - 180), position + 180) : '';
          throw new Error(`${path}: ${(error as Error).message}\n${context}`, { cause: error });
        }
      }
    } else {
      throw new Error('REQUEST_MIGRATION_PARTIAL_STATE');
    }
    if (baseCount === 2) {
      // Exercise the default-off contract without changing the deployed gate state after rollback.
      await db.query(`update app_private.request_feature_gates set enabled=false,updated_at=now()`);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.query('rollback').catch(() => undefined);
      await db.end().catch(() => undefined);
    }
  });

  it('adds revision and collaboration schema with RLS enabled', async () => {
    const result = await db.query(`select
      to_regclass('public.request_content_revisions') is not null as revisions,
      to_regclass('public.request_comments') is not null as comments,
      to_regclass('public.request_comment_mentions') is not null as mentions,
      to_regclass('public.request_attachments') is not null as attachments,
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.request_comments')), false) as comments_rls,
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.request_attachments')), false) as attachments_rls`);
    expect(result.rows[0]).toEqual({
      revisions: true, comments: true, mentions: true, attachments: true,
      comments_rls: true, attachments_rls: true,
    });
  });

  it('exposes only invoker wrappers and keeps privileged commands private', async () => {
    const result = await db.query(`select
      to_regprocedure('public.update_request_content(uuid,text,text,jsonb,timestamptz,text)') is not null as update_rpc,
      to_regprocedure('public.command_request_comment(text,jsonb,text)') is not null as comment_rpc,
      to_regprocedure('public.list_request_comments(uuid,text,integer)') is not null as comments_rpc,
      to_regprocedure('public.list_request_mention_candidates(uuid,text,text,integer)') is not null as mentions_rpc,
      (select prosecdef from pg_proc where oid = to_regprocedure('public.update_request_content(uuid,text,text,jsonb,timestamptz,text)')) as public_definer,
      (select prosecdef from pg_proc where oid = to_regprocedure('app_private.update_request_content(uuid,text,text,jsonb,timestamptz,text)')) as private_definer`);
    expect(result.rows[0]).toEqual({
      update_rpc: true, comment_rpc: true, comments_rpc: true, mentions_rpc: true,
      public_definer: false, private_definer: true,
    });
    const permissions = await db.query(`select
      has_function_privilege('authenticated','app_private.command_request_comment(text,jsonb,text)','execute') as comment_command,
      has_function_privilege('authenticated','app_private.list_request_comments(uuid,text,integer)','execute') as comments_list,
      has_function_privilege('authenticated','app_private.list_request_mention_candidates(uuid,text,text,integer)','execute') as mention_candidates,
      has_function_privilege('authenticated','app_private.list_request_activity(uuid,text,integer)','execute') as activity_list,
      has_function_privilege('authenticated','app_private.claim_request_attachment(uuid)','execute') as attachment_claim,
      has_function_privilege('authenticated','app_private.authorize_request_attachment(uuid,text)','execute') as attachment_authorize,
      has_function_privilege('authenticated','app_private.get_request_comment_anchor(uuid,uuid)','execute') as comment_anchor,
      has_function_privilege('authenticated','app_private.request_attachment_storage_can_insert(text,uuid)','execute') as storage_insert`);
    expect(permissions.rows[0]).toEqual({
      comment_command: true, comments_list: true, mention_candidates: true, activity_list: true,
      attachment_claim: true, attachment_authorize: true, comment_anchor: true, storage_insert: true,
    });
  });

  it('creates a private request attachment bucket without direct public access', async () => {
    const result = await db.query(`select id, public, file_size_limit::integer as file_size_limit
      from storage.buckets where id = 'request-attachments'`);
    expect(result.rows).toEqual([{ id: 'request-attachments', public: false, file_size_limit: 26214400 }]);
  });

  it('keeps all rollout gates closed by default', async () => {
    const result = await db.query(`select gate,enabled from app_private.request_feature_gates order by gate`);
    expect(result.rows).toEqual([
      { gate: 'attachments', enabled: false }, { gate: 'content_edit', enabled: false },
      { gate: 'discussion_read', enabled: false }, { gate: 'discussion_write', enabled: false },
    ]);
  });

  it('revisions a pending request, restarts approval, and persists an editable mention comment', async () => {
    await db.query(`update app_private.request_feature_gates set enabled=true,updated_at=now()`);
    const creatorAuth = crypto.randomUUID(); const approverAuth = crypto.randomUUID();
    const creatorEmail = `creator-${crypto.randomUUID()}@test.invalid`; const approverEmail = `approver-${crypto.randomUUID()}@test.invalid`;
    await db.query(`select set_config('app.authorization_legacy_migration','on',true)`);
    await db.query(`insert into auth.users(id,email) values($1,$2),($3,$4)`, [creatorAuth, creatorEmail, approverAuth, approverEmail]);
    await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('app.account_lifecycle_command','on',true)`);
    const people = await db.query(`update public.users set
      name=case when auth_id=$1 then 'Cloud Creator' else 'Cloud Approver' end,
      role=case when auth_id=$1 then 'ADMIN'::public.user_role else 'EMPLOYEE'::public.user_role end
      where auth_id in ($1,$2) returning id,auth_id,role::text`, [creatorAuth, approverAuth]);
    const creator = people.rows.find(row => row.auth_id === creatorAuth)!;
    const approver = people.rows.find(row => row.auth_id === approverAuth)!;
    expect(creator).toBeTruthy(); expect(approver).toBeTruthy();
    const claims = (person: { auth_id: string }) => JSON.stringify({ sub: person.auth_id, role: 'authenticated' });
    const asAuthenticated = async (sql: string, params: unknown[] = []) => {
      await db.query('set local role authenticated');
      try { return await db.query(sql, params); }
      finally { await db.query('reset role'); }
    };
    await db.query(`select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)`, [claims(creator), creator.auth_id]);
    const template = await db.query(`insert into public.request_templates(name,description,created_by)
      values('Request collaboration rollback fixture','cloud transaction only',$1) returning id`, [creator.id]);
    const version = await db.query(`insert into public.request_template_versions(
      request_template_id,version_number,form_schema,usage_scope,flow_mode,completion_policy,status,created_by)
      values($1,1,'[{"key":"quantity","label":"Số lượng","fieldType":"number","required":true}]',
        '{"companyWide":true}','SEQUENTIAL','ALL','DRAFT',$2) returning id`, [template.rows[0].id, creator.id]);
    await db.query(`insert into public.request_approval_blocks(request_template_version_id,block_key,name,sort_order,approver_source,fixed_user_ids)
      values($1,'manager','Quản lý',0,'FIXED_SINGLE',array[$2::uuid])`, [version.rows[0].id, approver.id]);
    await db.query(`select public.publish_request_template_version($1,(select updated_at from public.request_templates where id=$1))`, [template.rows[0].id]);
    const submitted = await db.query(`select public.submit_request($1,'Bàn phím','Bản đầu','{"quantity":1}','{}',$2) result`, [version.rows[0].id, crypto.randomUUID()]);
    const initial = submitted.rows[0].result as { requestId: string; updatedAt: string };
    const editKey=crypto.randomUUID();
    const revised = await db.query(`select public.update_request_content($1,'Bàn phím cơ','Bản đã sửa','{"quantity":2}',$2,$3) result`, [initial.requestId, initial.updatedAt, editKey]);
    expect(revised.rows[0].result.contentRevision).toBe(2);
    const replay = await db.query(`select public.update_request_content($1,'Bàn phím cơ','Bản đã sửa','{"quantity":2}',$2,$3) result`, [initial.requestId, initial.updatedAt, editKey]);
    expect(replay.rows[0].result).toEqual(revised.rows[0].result);
    const noOp = await db.query(`select public.update_request_content($1,'Bàn phím cơ','Bản đã sửa','{"quantity":2}',$2,$3) result`, [initial.requestId, revised.rows[0].result.updatedAt, crypto.randomUUID()]);
    expect(noOp.rows[0].result.contentRevision).toBe(2);
    const rounds = await db.query(`select count(distinct assignment_round_id)::integer rounds,
      count(*) filter(where status='CANCELLED')::integer cancelled,
      count(*) filter(where status='PENDING' and (metadata->>'contentRevision')::integer=2)::integer current
      from public.workflow_step_assignments where workflow_subject_id=(select workflow_subject_id from public.request_instances where id=$1)`, [initial.requestId]);
    expect(rounds.rows[0]).toEqual({ rounds: 2, cancelled: 1, current: 1 });
    const detail = await db.query(`select public.get_request_detail($1) result`, [initial.requestId]);
    expect(detail.rows[0].result.approvalBlocks[0].status).toBe('ACTIVE');
    expect(detail.rows[0].result.approvalBlocks[0].assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ contentRevision: 1, isCurrentRound: false, status: 'CANCELLED' }),
      expect.objectContaining({ contentRevision: 2, isCurrentRound: true, status: 'PENDING' }),
    ]));

    const content = { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'mention', userId: approver.id, label: 'Cloud Approver' }, { type: 'text', text: ' kiểm tra giúp' },
    ] }] };
    const created = await asAuthenticated(`select public.command_request_comment('create',$1,$2) result`, [{ requestId: initial.requestId, content, attachmentIds: [] }, crypto.randomUUID()]);
    const comment = created.rows[0].result as { id: string; lockVersion: number };
    const editedContent = { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Đã cập nhật nội dung' }] }] };
    await asAuthenticated(`select public.command_request_comment('edit',$1,$2)`, [{ requestId: initial.requestId, commentId: comment.id, expectedLockVersion: comment.lockVersion, content: editedContent }, crypto.randomUUID()]);
    const page = await asAuthenticated(`select public.list_request_comments($1,null,30) result`, [initial.requestId]);
    expect(page.rows[0].result.total).toBe(1);
    expect(page.rows[0].result.items[0]).toMatchObject({ id: comment.id, contentText: 'Đã cập nhật nội dung', lockVersion: 2 });
    expect(await db.query(`select count(*)::integer count from public.request_comment_edits where comment_id=$1`, [comment.id]).then(result => result.rows[0].count)).toBe(1);
    const activity = await asAuthenticated(`select public.list_request_activity($1,null,40) result`, [initial.requestId]);
    expect(activity.rows[0].result.items.some((item: { itemType: string }) => item.itemType === 'comment')).toBe(true);
    expect(activity.rows[0].result.items.some((item: { itemType: string }) => item.itemType === 'revision')).toBe(true);
    const candidates = await asAuthenticated(`select public.list_request_mention_candidates($1,'Cloud',null,20) result`, [initial.requestId]);
    expect(candidates.rows[0].result.items).toEqual(expect.arrayContaining([expect.objectContaining({ userId: approver.id })]));
    const anchor = await asAuthenticated(`select public.get_request_comment_anchor($1,$2) result`, [initial.requestId, comment.id]);
    expect(anchor.rows[0].result).toMatchObject({ commentId: comment.id, rootCommentId: comment.id });
    const reservation = await asAuthenticated(`select public.command_request_comment('reserve_attachment',$1,$2) result`, [{
      requestId: initial.requestId, fileName: 'cloud.txt', mimeType: 'text/plain', sizeBytes: 16, kind: 'discussion_file',
    }, crypto.randomUUID()]);
    expect(reservation.rows[0].result).toMatchObject({ status: 'pending' });
    const outbox = await db.query(`select event_type,payload->>'route' route from app_private.request_notification_outbox
      where request_id=$1 and event_type like 'REQUEST_COMMENT_%' order by event_type`, [initial.requestId]);
    expect(outbox.rows.some(row => row.event_type === 'REQUEST_COMMENT_MENTIONED' && row.route === `/rq/${initial.requestId}?comment=${comment.id}`)).toBe(true);

    await db.query('savepoint direct_write_guard');
    await db.query('set local role authenticated');
    await expect(db.query(`insert into public.request_comments(request_id,author_user_id,content_document,content_text)
      values($1,$2,'{"version":1,"type":"doc","content":[]}','bypass')`, [initial.requestId, creator.id])).rejects.toThrow(/permission denied/);
    await db.query('rollback to savepoint direct_write_guard');
    await db.query('reset role');

    await db.query(`select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)`, [claims(approver), approver.auth_id]);
    const returned = await db.query(`select public.act_on_request($1,'RETURN','Cần cập nhật',null,null,$2,$3) result`, [initial.requestId, crypto.randomUUID(), revised.rows[0].result.updatedAt]);
    await db.query(`select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)`, [claims(creator), creator.auth_id]);
    const returnedEdit = await db.query(`select public.update_request_content($1,'Bàn phím cơ','Bản sửa sau trả lại','{"quantity":3}',$2,$3) result`, [initial.requestId, returned.rows[0].result.updatedAt, crypto.randomUUID()]);
    expect(returnedEdit.rows[0].result).toMatchObject({ status: 'RETURNED', contentRevision: 3 });
    const resubmitted = await db.query(`select public.act_on_request($1,'RESUBMIT','Đã sửa','{"quantity":3}',null,$2,$3) result`, [initial.requestId, crypto.randomUUID(), returnedEdit.rows[0].result.updatedAt]);
    await db.query(`select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)`, [claims(approver), approver.auth_id]);
    const approved = await db.query(`select public.act_on_request($1,'APPROVE','Đồng ý',null,null,$2,$3) result`, [initial.requestId, crypto.randomUUID(), resubmitted.rows[0].result.updatedAt]);
    expect(approved.rows[0].result.status).toBe('APPROVED');
    await db.query(`select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)`, [claims(creator), creator.auth_id]);
    await expect(db.query(`select public.update_request_content($1,'Không được sửa','', '{}',$2,$3)`, [initial.requestId, approved.rows[0].result.updatedAt, crypto.randomUUID()]))
      .rejects.toThrow(/REQUEST_EDIT_STATUS_LOCKED/);
  });
});
