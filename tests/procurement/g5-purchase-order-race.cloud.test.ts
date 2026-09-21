import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.G5_CLOUD_DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

suite('G5 atomic purchase-order concurrency on an ephemeral Supabase Cloud branch', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const numericSuffix = String(Number.parseInt(suffix, 16) % 900000 + 100000);
  const actorId = randomUUID();
  const actorEmail = `g5-race-${suffix}@example.invalid`;
  const positionId = randomUUID();
  const projectId = `g5-race-project-${suffix}`;
  const warehouseId = `g5-race-warehouse-${suffix}`;
  const warehouseType = `G5_RACE_${suffix.toUpperCase()}`;
  const itemId = `g5-race-item-${suffix}`;
  const requestId = `g5-race-mr-${suffix}`;
  const poNumberBase = `PO-${numericSuffix}`;
  let demandLineId = '';
  let sourceRevisionId = '';
  let demandVersion = '';
  let requestCode = '';
  const clients: pg.Client[] = [];

  const connect = async () => {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    client.on('error', () => {});
    await client.connect();
    clients.push(client);
    return client;
  };

  const setActor = async (client: pg.Client) => {
    await client.query(`select set_config('request.jwt.claim.email', $1, true)`, [actorEmail]);
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actorId]);
    await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: actorId, email: actorEmail, role: 'authenticated' }),
    ]);
  };

  beforeAll(async () => {
    const client = await connect();
    await client.query('begin');
    await client.query(
      `insert into public.users(id,name,email,username,role,is_active,account_status)
       values ($1::uuid,'G5 race buyer',$2,$1::uuid::text,'ADMIN'::public.user_role,true,'ACTIVE')`,
      [actorId, actorEmail],
    );
    await client.query(
      `insert into public.hrm_positions(id,name,level,code,is_active,sort_order,source,metadata)
       values ($1,'G5 race buyer',1,$2,true,0,'smoke','{}'::jsonb)`,
      [positionId, `G5-${suffix}`],
    );
    await client.query(
      `insert into public.project_permission_rooms(code,group_code,name,allowed_actions,required_actions,sort_order)
       values
         ('material_request','material','Material request',array['view','edit'],array['view'],1),
         ('material_po','material','Material PO',array['view','edit'],array['view'],2)
       on conflict (code) do nothing`,
    );
    await client.query(
      `insert into app_private.project_permission_room_action_bindings(
         room_code,action_code,enforcement_status,relationship_description,
         verified_at,verified_source,pbac_fallback_enabled,prerequisite_action_codes
       ) values
         ('material_request','view','enforced','G5 race read',now(),'g5_race',false,'{}'),
         ('material_po','view','enforced','G5 race price',now(),'g5_race',false,'{}'),
         ('material_po','edit','enforced','G5 race allocation',now(),'g5_race',false,array['view'])
       on conflict (room_code,action_code) do update set
         enforcement_status=excluded.enforcement_status,
         prerequisite_action_codes=excluded.prerequisite_action_codes`,
    );
    await client.query(
      `insert into public.projects(id,code,name) values ($1,$2,'G5 PO race')`,
      [projectId, `G5R-${suffix}`],
    );
    await client.query(
      `insert into public.project_staff(id,project_id,user_id,position_id,start_date,note)
       values (gen_random_uuid(),$1,$2,$3,current_date,'G5 race buyer')`,
      [projectId, actorId, positionId],
    );
    await client.query(
      `insert into public.project_permission_room_members(
         project_id,construction_site_id,room_code,project_staff_id,is_active
       )
       select $1,null,room.code,staff.id,true
       from public.project_staff staff
       cross join (values ('material_request'),('material_po')) room(code)
       where staff.project_id=$1 and staff.user_id=$2`,
      [projectId, actorId],
    );
    await client.query(
      `insert into public.project_permission_room_member_actions(room_member_id,action_code,is_active)
       select member.id,action.code,true
       from public.project_permission_room_members member
       cross join lateral (
         select code from (values ('view'),('edit')) actions(code)
         where code='view' or member.room_code='material_po'
       ) action
       where member.project_id=$1`,
      [projectId],
    );
    await client.query(
      `insert into public.warehouse_types(code,name) values ($1,'G5 race warehouse')`,
      [warehouseType],
    );
    await client.query(
      `insert into public.warehouses(id,name,address,type,project_id)
       values ($1,'G5 race warehouse','Test',$2,$3)`,
      [warehouseId, warehouseType, projectId],
    );
    await client.query(
      `insert into public.items(id,sku,name,category,unit,price_in,price_out,min_stock)
       values ($1,$2,'G5 race steel','Smoke','kg',10,10,0)`,
      [itemId, `G5-${suffix}`],
    );
    await setActor(client);
    await client.query(
      `insert into public.requests(
         id,title,site_warehouse_id,requester_id,status,items,created_date,
         expected_date,project_id,request_origin,workflow_step
       ) values ($1,'G5 race demand',$2,$3,'DRAFT',$4::jsonb,now(),now(),$5,'project','draft')`,
      [requestId, warehouseId, actorId,
        JSON.stringify([{ lineId: 'need-a', itemId, requestQty: 100, unitSnapshot: 'kg', itemNameSnapshot: 'G5 race steel' }]),
        projectId],
    );
    requestCode = (await client.query(`select code from public.requests where id=$1`, [requestId])).rows[0].code;
    await client.query(`select set_config('app.material_transition_context','on',true)`);
    await client.query(
      `update public.requests set status='APPROVED',workflow_step='batch_planning' where id=$1`,
      [requestId],
    );
    await client.query(`select set_config('app.material_transition_context','',true)`);
    await client.query(
      `insert into app_private.purchase_order_number_registry(po_number) values ($1)`,
      [poNumberBase],
    );
    await client.query(`select public.sync_project_material_request_demand_v1($1,1,$2)`, [requestId, `g5-race-sync-${suffix}`]);
    const identity = await client.query(
      `select line.id::text demand_line_id,
         line.current_source_revision_id::text source_revision_id,
         line.version::text demand_version
       from public.procurement_demand_lines line
       join public.procurement_demands demand on demand.id=line.demand_id
       where demand.project_id=$1`,
      [projectId],
    );
    ({ demand_line_id: demandLineId, source_revision_id: sourceRevisionId, demand_version: demandVersion } = identity.rows[0]);
    await client.query('commit');
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map(client => client.end()));
  });

  it('commits one PO and rolls the losing PO back when two buyers each allocate 60 of 100', async () => {
    const run = async (writer: '01' | '02') => {
      const client = await connect();
      const poId = `g5-race-po-${suffix}-${writer}`;
      const poLineId = `g5-race-line-${suffix}-${writer}`;
      await client.query('begin');
      await setActor(client);
      await client.query('set role authenticated');
      try {
        await client.query(
          `select public.create_procurement_purchase_order_v1(
             $1::jsonb,$2::jsonb,$3::jsonb,$4::uuid,$5::uuid
           )`,
          [
            JSON.stringify({
              id: poId, project_id: projectId, vendor_id: `vendor-${writer}`,
              vendor_name: `Vendor ${writer}`, po_number: `${poNumberBase}-${writer}`,
              items: [{ lineId: poLineId, itemId, name: 'G5 race steel', unit: 'kg',
                unitSnapshot: 'kg', stockUnitSnapshot: 'kg', purchaseUnitSnapshot: 'kg',
                purchaseConversionFactor: 1, qty: 60, unitPrice: 10 }],
              total_amount: 600, order_date: new Date().toISOString().slice(0, 10),
              status: 'draft', source_mode: 'company_consolidated', purchase_mode: 'single',
              created_by_id: actorId, target_warehouse_id: warehouseId,
            }),
            JSON.stringify([{
              project_id: projectId, target_warehouse_id: warehouseId,
              allocation_status: 'open', purchase_order_id: poId,
              purchase_order_line_id: poLineId, material_request_id: requestId,
              material_request_code: requestCode, request_line_id: 'need-a',
              item_id: itemId, requested_qty: 100, ordered_qty: 60,
              requested_qty_snapshot: 100, ordered_stock_qty_snapshot: 60,
              actual_received_qty_snapshot: 0, unit: 'kg',
            }]),
            JSON.stringify([{
              demandLineId, sourceRevisionId, purchaseOrderLineId: poLineId,
              expectedVersion: demandVersion, needQty: '60', needUnit: 'kg',
              executionQty: '60', executionUnit: 'kg',
              conversionNumerator: '1', conversionDenominator: '1', reason: `G5 race ${writer}`,
            }]),
            actorId,
            randomUUID(),
          ],
        );
        await client.query('commit');
        return { outcome: 'committed' as const, poId };
      } catch (error) {
        await client.query('rollback');
        return { outcome: 'rejected' as const, poId, error: error as { code?: string; message?: string } };
      }
    };

    const results = await Promise.all([run('01'), run('02')]);
    expect(results.filter(result => result.outcome === 'committed')).toHaveLength(1);
    const rejected = results.find(result => result.outcome === 'rejected');
    expect(rejected?.error?.code).toBe('40001');
    expect(['PROCUREMENT_VERSION_CONFLICT', 'PROCUREMENT_AVAILABLE_EXCEEDED'])
      .toContain(rejected?.error?.message);

    const verifier = await connect();
    const totals = await verifier.query(
      `select
         (select coalesce(sum(committed_need_qty),0)::text
          from public.procurement_supply_allocations where demand_line_id=$1) committed,
         (select count(*)::text from public.purchase_orders where id like $2) po_count,
         (select count(*)::text from public.purchase_order_request_lines where purchase_order_id like $2) link_count`,
      [demandLineId, `g5-race-po-${suffix}-%`],
    );
    expect(totals.rows[0]).toEqual({ committed: '60.000000', po_count: '1', link_count: '1' });
  }, 60_000);
});
