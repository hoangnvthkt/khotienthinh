import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.G2_CLOUD_DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

suite('G2 allocation concurrency on an ephemeral Supabase Cloud branch', () => {
  const suffix = randomUUID().slice(0, 8);
  const actorId = randomUUID();
  const actorEmail = `g2-race-${suffix}@example.invalid`;
  const projectId = `g2-race-project-${suffix}`;
  const siteId = `g2-race-site-${suffix}`;
  const warehouseId = `g2-race-warehouse-${suffix}`;
  const warehouseTypeCode = `G2_RACE_${suffix.toUpperCase()}`;
  const requestId = `g2-race-mr-${suffix}`;
  const poId = `g2-race-po-${suffix}`;
  let demandLineId = '';
  let sourceRevisionId = '';
  let executionLineId = '';
  const clients: pg.Client[] = [];

  const connect = async () => {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    client.on('error', () => {});
    await client.connect();
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    const client = await connect();
    await client.query('begin');
    await client.query('alter table public.requests disable trigger trg_enforce_material_request_code_v1');
    await client.query('alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2');
    await client.query(
      `insert into public.project_permission_rooms(
        code,group_code,name,allowed_actions,required_actions,sort_order
      ) values
        ('material_request','materials','Material request',array['view'],'{}',1),
        ('material_po','materials','Material PO',array['view','edit'],array['view'],2)
      on conflict (code) do nothing`,
    );
    await client.query(
      `insert into app_private.project_permission_room_action_bindings(
        room_code,action_code,legacy_permission_codes,enforcement_status,
        relationship_description,pbac_fallback_enabled,prerequisite_action_codes
      ) values
        ('material_request','view','{}','enforced','G2 race read',false,'{}'),
        ('material_po','view','{}','enforced','G2 race price',false,'{}'),
        ('material_po','edit','{}','enforced','G2 race allocation',false,array['view'])
      on conflict (room_code,action_code) do nothing`,
    );
    await client.query(
      `insert into auth.users(
        id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
      ) values ($1,'authenticated','authenticated',$2,'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [actorId, actorEmail],
    );
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actorId, email: actorEmail })]);
    await client.query(`select set_config('request.jwt.claim.email', $1, true)`, [actorEmail]);
    await client.query(`set local session_replication_role = 'replica'`);
    await client.query(
      `update public.users set name='G2 race actor',username=$1::text,
        role='ADMIN'::public.user_role,is_active=true,account_status='ACTIVE'
       where auth_id=$1::uuid`,
      [actorId],
    );
    await client.query(`set local session_replication_role = 'origin'`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actorId, email: actorEmail })]);
    await client.query(`select set_config('request.jwt.claim.email', $1, true)`, [actorEmail]);
    await client.query(
      `insert into public.projects(id,code,name) values ($1,$2,'G2 allocation race')`,
      [projectId, `G2R-${suffix}`],
    );
    await client.query(
      `insert into public.warehouse_types(code,name) values ($1,'G2 race warehouse')`,
      [warehouseTypeCode],
    );
    await client.query(
      `insert into public.warehouses(id,name,address,type) values ($1,'G2 race warehouse','Test',$2)`,
      [warehouseId, warehouseTypeCode],
    );
    await client.query(
      `insert into public.requests(
        id,code,title,site_warehouse_id,requester_id,status,items,created_date,
        expected_date,project_id,construction_site_id,request_origin,workflow_step
      ) values ($1,$2,'G2 race',$3,$4,'DRAFT',$5::jsonb,now(),now(),$6,$7,'project','draft')`,
      [requestId, `MR-${suffix}`, warehouseId, actorId,
        JSON.stringify([{ lineId: 'need-a', itemId: 'item-a', requestQty: 100, unitSnapshot: 'kg' }]),
        projectId, siteId],
    );
    await client.query(`select set_config('app.material_transition_context', 'on', false)`);
    await client.query(
      `update public.requests set status='APPROVED',workflow_step='batch_planning' where id=$1`,
      [requestId],
    );
    await client.query(`select set_config('app.material_transition_context', '', false)`);
    const actorCheck = await client.query(
      `select public.current_app_user_id()::text actor_id,
        (select role::text from public.users where id=public.current_app_user_id()) actor_role`,
    );
    if (actorCheck.rows[0]?.actor_id !== actorId || actorCheck.rows[0]?.actor_role !== 'ADMIN') {
      throw new Error(`G2_RACE_ACTOR_SETUP_FAILED:${JSON.stringify(actorCheck.rows[0])}`);
    }
    await client.query(`select public.sync_project_material_request_demand_v1($1,1,$2)`, [requestId, `race-sync-${suffix}`]);
    await client.query(
      `insert into public.purchase_orders(
        id,vendor_id,vendor_name,po_number,items,total_amount,order_date,status,
        project_id,construction_site_id,source_mode
      ) values ($1,'vendor-a','Vendor A',$2,$3::jsonb,100,current_date::text,
        'confirmed',$4,$5,'from_request')`,
      [poId, `PO-${suffix}`, JSON.stringify([{ lineId: 'po-a', itemId: 'item-a', qty: 100, unit: 'kg' }]), projectId, siteId],
    );
    const identity = await client.query(
      `select line.id demand_line_id, line.current_source_revision_id source_revision_id,
        execution.id execution_line_id
       from public.procurement_demand_lines line
       join public.procurement_source_line_registry execution on execution.source_line_id='po-a'
       join public.procurement_source_documents document on document.id=execution.source_document_id
         and document.source_adapter='purchase_order' and document.source_document_id=$1
       limit 1`,
      [poId],
    );
    ({ demand_line_id: demandLineId, source_revision_id: sourceRevisionId, execution_line_id: executionLineId } = identity.rows[0]);
    await client.query('commit');
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map(client => client.end()));
  });

  it('allows only one concurrent 60 allocation against approved quantity 100', async () => {
    const run = async (key: string) => {
      const client = await connect();
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actorId, email: actorEmail })]);
      await client.query(`select set_config('request.jwt.claim.email', $1, true)`, [actorEmail]);
      try {
        await client.query(
          `select public.save_procurement_allocation_v1(
            $1,$2,$3,'po','committed',0,60,'kg',60,'kg',1,1,1,$4,$5
          )`,
          [demandLineId, sourceRevisionId, executionLineId, `Race writer ${key}`, key],
        );
        await client.query('commit');
        return { outcome: 'committed' as const };
      } catch (error) {
        await client.query('rollback');
        return { outcome: 'rejected' as const, error: error as { code?: string; message?: string } };
      }
    };

    const results = await Promise.all([
      run(`race-a-${suffix}`),
      run(`race-b-${suffix}`),
    ]);
    expect(results.filter(result => result.outcome === 'committed')).toHaveLength(1);
    const rejected = results.find(result => result.outcome === 'rejected');
    expect(rejected?.error?.code).toBe('40001');
    expect(['PROCUREMENT_VERSION_CONFLICT', 'PROCUREMENT_AVAILABLE_EXCEEDED'])
      .toContain(rejected?.error?.message);

    const verifier = await connect();
    const total = await verifier.query(
      `select coalesce(sum(committed_need_qty),0)::text total
       from public.procurement_supply_allocations where demand_line_id=$1`,
      [demandLineId],
    );
    expect(total.rows[0].total).toBe('60.000000');
  }, 60_000);
});
