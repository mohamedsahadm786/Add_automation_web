-- Run-status execution id. Run once in the Supabase SQL editor. Additive + idempotent.
--
-- n8n's Error Trigger only receives the FAILED execution's id, not the tenant_id.
-- To mark the right tenant failed, the Orchestrator stamps its execution id onto
-- tenant_run_status at run start; the Error Trigger then looks the tenant up by it:
--
--   -- at start (orchestrator):
--   upsert tenant_run_status (tenant_id, status='running', started_at=now(),
--                             finished_at=null, execution_id=:orchestrator_exec_id)
--   -- on error (Error Trigger, has only the failed execution id):
--   update public.tenant_run_status
--      set status='failed', finished_at=now(), message=:err, updated_at=now()
--    where execution_id = :failed_execution_id;
--
-- One row per tenant (keyed by tenant_id), so execution_id holds the latest run's
-- id — fine for sequential per-tenant runs.

alter table public.tenant_run_status
    add column if not exists execution_id text;

create index if not exists idx_tenant_run_status_execution_id
    on public.tenant_run_status (execution_id);

-- (tenant_run_status already has RLS off + grants from pipeline_run_status_migration.sql;
--  a new column inherits the table grants.)
