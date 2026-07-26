# Purchase Package V2 Rollout

## Verification

Run before deploy:

```bash
npm run lint
npm test
npm run build
npx supabase db query --linked --agent=no -f supabase/tests/purchase_package_delivery_receipt_v2_smoke.sql
```

Run Supabase advisors:

```bash
npx supabase db advisors --linked --agent=no --level error --fail-on error
```

## MR-2026-9753 Preflight

Confirm the MR owner and current routing:

```sql
select r.id, r.code, r.status, r.requester_id,
       u.name as requester_name,
       r.submitted_to_user_id, r.submitted_to_permission
from public.requests r
left join public.users u on u.id = r.requester_id
where r.code = 'MR-2026-9753';
```

Confirm PO packages start with no released value:

```sql
select po.id, po.po_number, po.status, po.purchase_mode,
       po.reference_gross_amount,
       count(batch.id) as delivery_count
from public.purchase_orders po
left join public.purchase_order_delivery_batches batch
  on batch.purchase_order_id = po.id
where po.material_request_id = (
  select id from public.requests where code = 'MR-2026-9753'
)
group by po.id;
```

Check V2 anomalies for the MR packages:

```sql
select * from public.purchase_package_v2_anomalies
where purchase_order_id in (
  select id from public.purchase_orders
  where material_request_id = (
    select id from public.requests where code = 'MR-2026-9753'
  )
);
```

Check duplicate invoice numbers that accounting must reconcile manually:

```sql
select supplier_id, lower(trim(invoice_number)) as normalized_invoice_number,
       count(*) as duplicate_count
from public.supplier_payable_documents
where nullif(trim(invoice_number), '') is not null
  and status not in ('cancelled', 'reversed')
group by supplier_id, lower(trim(invoice_number))
having count(*) > 1;
```

## Rollout Rule

If Room approver mapping is wrong, fix the workflow/Room mapping separately. Do not edit request quantity, package quantity, or delivery quantity just to remove an overage warning.

After deploy, the MR creator submits through the existing workflow. The first package for the MR must show released = 0 before any delivery is created or approved.
