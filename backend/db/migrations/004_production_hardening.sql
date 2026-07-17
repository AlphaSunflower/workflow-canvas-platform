create extension if not exists pgcrypto;

create sequence if not exists execution_run_no_seq;
create sequence if not exists execution_task_no_seq;

select setval(
  'execution_run_no_seq',
  greatest(
    coalesce(
      (
        select max((regexp_match(run_no, '-([0-9]+)$'))[1]::bigint)
        from execution_runs
        where run_no ~ '-[0-9]+$'
      ),
      0
    ),
    (select count(*) from execution_runs)
  ),
  true
);

select setval(
  'execution_task_no_seq',
  greatest(
    coalesce(
      (
        select max((regexp_match(task_no, '-([0-9]+)$'))[1]::bigint)
        from execution_tasks
        where task_no ~ '-[0-9]+$'
      ),
      0
    ),
    (select count(*) from execution_tasks)
  ),
  true
);

alter table execution_tasks
  add column if not exists claimed_by text null,
  add column if not exists claimed_at timestamptz null,
  add column if not exists lease_until timestamptz null,
  add column if not exists heartbeat_at timestamptz null,
  add column if not exists attempt_started_at timestamptz null;

create table if not exists provider_concurrency_leases (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  task_id uuid not null references execution_tasks(id) on delete cascade,
  worker_id text not null,
  lease_until timestamptz not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint uq_provider_concurrency_leases_task unique (task_id)
);

create index if not exists idx_provider_concurrency_leases_provider
  on provider_concurrency_leases(provider_key, lease_until);

create index if not exists idx_provider_concurrency_leases_worker
  on provider_concurrency_leases(worker_id, lease_until);

create index if not exists idx_execution_tasks_queue_claim
  on execution_tasks(created_at asc, group_order asc nulls last)
  where status = 'queued';

create index if not exists idx_execution_tasks_expired_lease
  on execution_tasks(lease_until asc)
  where status = 'processing' and lease_until is not null;

create index if not exists idx_execution_tasks_run_status
  on execution_tasks(run_id, status);

create index if not exists idx_execution_tasks_workflow_created
  on execution_tasks(workflow_id, created_at desc);

create index if not exists idx_execution_runs_workflow_created
  on execution_runs(workflow_id, created_at desc);

create index if not exists idx_execution_runs_workflow_node_completed
  on execution_runs(workflow_id, node_id, completed_at desc nulls last, created_at desc)
  where status = 'completed';

create index if not exists idx_workflow_file_bindings_workflow_file
  on workflow_file_bindings(workflow_id, file_id);

create index if not exists idx_file_uploads_pending_created
  on file_uploads(created_at asc)
  where status = 'pending';

create index if not exists idx_file_blob_variants_provider_key
  on file_blob_variants(storage_provider, storage_key, variant);
