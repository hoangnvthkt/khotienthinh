-- Generated from Supabase cloud pg_get_indexdef via supabase/perf/index_drop_preflight.sql.
-- Rollback for drop_unused_overlapped_indexes_phase1.sql.
-- Manual apply only. Do not wrap in BEGIN/COMMIT because CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acceptance_records_site ON public.acceptance_records USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_maintenances_status ON public.asset_maintenances USING btree (status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_status ON public.assets USING btree (status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_trail_module ON public.audit_trail USING btree (module);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boq_reconciliation_groups_step_handler ON public.boq_reconciliation_groups USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_variations_step_handler ON public.contract_variations USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_material_budget_items_site ON public.material_budget_items USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_certificates_step_handler ON public.payment_certificates USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_schedules_site ON public.payment_schedules USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_documents_site ON public.project_documents USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_material_requests_site ON public.project_material_requests USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_material_requests_step_handler ON public.project_material_requests USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_vendors_site ON public.project_vendors USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_site ON public.purchase_orders USING btree (construction_site_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_step_handler ON public.purchase_orders USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quantity_acceptances_step_handler ON public.quantity_acceptances USING btree (submitted_to_user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_request_instances_created_by ON public.request_instances USING btree (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_request_instances_status ON public.request_instances USING btree (status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_instances_created_at ON public.workflow_instances USING btree (created_at DESC);
