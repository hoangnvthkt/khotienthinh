alter table if exists public.purchase_orders
  add column if not exists approval_request_title text;

comment on column public.purchase_orders.approval_request_title
  is 'Custom subject/title printed in the purchase order approval request.';
