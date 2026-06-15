-- Phase 1 unused/overlapped index cleanup.
-- Manual apply only. Do not wrap this file in BEGIN/COMMIT because
-- DROP INDEX CONCURRENTLY cannot run inside a transaction block.
--
-- Required preflight:
--   npx supabase db query --linked -f supabase/perf/index_drop_preflight.sql

DROP INDEX CONCURRENTLY IF EXISTS public.idx_audit_trail_module;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_acceptance_records_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_asset_maintenances_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_assets_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_material_budget_items_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_schedules_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_documents_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_material_requests_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_vendors_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_purchase_orders_site;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_request_instances_created_by;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_request_instances_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_workflow_instances_created_at;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_boq_reconciliation_groups_step_handler;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_contract_variations_step_handler;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_certificates_step_handler;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_project_material_requests_step_handler;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_purchase_orders_step_handler;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quantity_acceptances_step_handler;
