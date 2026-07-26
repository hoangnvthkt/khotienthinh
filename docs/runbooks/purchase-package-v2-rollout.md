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

## Acceptance Evidence

Last verified on Supabase Cloud:

- Targeted V2 unit suite: `10 passed (10)`, `76 passed (76)`.
- Purchase package DB smoke: passed with invoice reconciliation, return, direct consumption, close-short, QR delivery, and anomaly view checks.
- Company procurement DB smoke: passed after running legacy receipt smoke through the material transition context.
- Full verification: `npm run lint`, `npm test`, `npm run build`, and `git diff --check`.

Acceptance coverage:

1. MR 1,000 -> package 1,000 -> approval covered by package approval smoke.
2. `single` auto `-01` + WMS + QR covered by package approval smoke.
3. `multiple` creates zero auto batch before manual delivery covered by package form/action tests.
4. Delivery price/VAT variance without supplemental approval covered by delivery command smoke.
5. 500 + 510 over-release warning projection covered by package domain/action tests.
6. QR batch lookup scopes to one delivery batch covered by receipt workflow and smoke.
7. Same warehouse keeper can approve SL/CL and confirm receipt covered by WMS permission behavior and receipt smoke.
8. 100/90 and 100/0 rejected receipt behavior covered by receipt smoke and modal workflow.
9. Direct consumption cost/AP without inventory movement and idempotent finalize covered by receipt smoke.
10. Multiple receipt APs for same supplier and invoice/payment allocation covered by invoice and payment tests.
11. Supplier payment no longer posts material expense covered by AP/payment tests.
12. Post-receipt supplier return stock/cost/AP reversal covered by return smoke.
13. Purchase/stock unit snapshot conversion covered by receipt service tests.
14. Concurrent/idempotent create/finalize covered by delivery idempotency and finalize retry smoke.
15. Legacy audit migration is read-only and verified by anomaly view smoke.

Pilot environment variables are intentionally not changed in this repo. Set them only after choosing the pilot construction site:

```bash
VITE_ENABLE_PURCHASE_PACKAGE_V2=true
VITE_PURCHASE_PACKAGE_V2_SITE_IDS=<pilot-construction-site-id>
```
