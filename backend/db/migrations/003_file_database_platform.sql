create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  role text not null default 'member',
  status text not null default 'enabled',
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_users_role
    check (role in ('member', 'admin')),
  constraint chk_users_status
    check (status in ('enabled', 'disabled'))
);

create index if not exists idx_users_role
  on users(role);

create index if not exists idx_users_status
  on users(status);

create table if not exists refresh_tokens (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id),
  token_hash text not null unique,
  status text not null default 'active',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_from_id text null references refresh_tokens(id),
  revoked_at timestamptz null,
  revoked_reason text null,
  user_agent text null,
  ip_address text null,
  constraint chk_refresh_tokens_status
    check (status in ('active', 'rotated', 'revoked', 'expired'))
);

create index if not exists idx_refresh_tokens_user_id
  on refresh_tokens(user_id);

create index if not exists idx_refresh_tokens_status
  on refresh_tokens(status);

create index if not exists idx_refresh_tokens_expires_at
  on refresh_tokens(expires_at);

create table if not exists audit_logs (
  id text primary key default gen_random_uuid()::text,
  actor_user_id text null references users(id),
  actor_role text null,
  action text not null,
  target_type text not null,
  target_id text null,
  payload jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor_user_id
  on audit_logs(actor_user_id);

create index if not exists idx_audit_logs_action
  on audit_logs(action);

create index if not exists idx_audit_logs_created_at
  on audit_logs(created_at desc);

create table if not exists file_blobs (
  id uuid primary key default gen_random_uuid(),
  sha256 varchar(64) not null unique,
  size bigint not null,
  mime_type text not null,
  storage_key text not null,
  storage_provider text not null default 'local',
  preview_storage_key text null,
  preview_mime_type text null,
  preview_size bigint null,
  preview_width int null,
  preview_height int null,
  thumbnail_storage_key text null,
  thumbnail_mime_type text null,
  thumbnail_size bigint null,
  thumbnail_width int null,
  thumbnail_height int null,
  extension text null,
  width int null,
  height int null,
  duration numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table file_blobs
  add column if not exists preview_storage_key text null,
  add column if not exists preview_mime_type text null,
  add column if not exists preview_size bigint null,
  add column if not exists preview_width int null,
  add column if not exists preview_height int null,
  add column if not exists thumbnail_storage_key text null,
  add column if not exists thumbnail_mime_type text null,
  add column if not exists thumbnail_size bigint null,
  add column if not exists thumbnail_width int null,
  add column if not exists thumbnail_height int null,
  add column if not exists duration numeric null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_file_blobs_storage_key
  on file_blobs(storage_provider, storage_key);

create table if not exists file_assets (
  id uuid primary key default gen_random_uuid(),
  user_id text null,
  blob_id uuid null references file_blobs(id),
  original_name text not null,
  display_name text not null,
  mime_type text not null,
  file_type text not null,
  source_type text not null,
  status text not null default 'ready',
  pending_upload_id uuid null,
  sha256 varchar(64) null,
  size bigint null,
  extension text null,
  width int null,
  height int null,
  duration numeric null,
  preview_ready boolean not null default false,
  preview_width int null,
  preview_height int null,
  thumbnail_ready boolean not null default false,
  thumbnail_width int null,
  thumbnail_height int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_file_assets_file_type
    check (file_type in ('image', 'video', 'ply', 'unknown')),
  constraint chk_file_assets_source_type
    check (source_type in ('input', 'intermediate', 'output')),
  constraint chk_file_assets_status
    check (status in ('pending_upload', 'ready', 'failed', 'deleted'))
);

alter table file_assets
  alter column blob_id drop not null;

alter table file_assets
  add column if not exists status text not null default 'ready',
  add column if not exists pending_upload_id uuid null,
  add column if not exists sha256 varchar(64) null,
  add column if not exists size bigint null,
  add column if not exists extension text null,
  add column if not exists width int null,
  add column if not exists height int null,
  add column if not exists duration numeric null,
  add column if not exists preview_ready boolean not null default false,
  add column if not exists preview_width int null,
  add column if not exists preview_height int null,
  add column if not exists thumbnail_ready boolean not null default false,
  add column if not exists thumbnail_width int null,
  add column if not exists thumbnail_height int null,
  add column if not exists updated_at timestamptz not null default now();

alter table file_assets
  drop constraint if exists chk_file_assets_file_type;

alter table file_assets
  add constraint chk_file_assets_file_type
    check (file_type in ('image', 'video', 'ply', 'unknown'));

alter table file_assets
  drop constraint if exists chk_file_assets_status;

alter table file_assets
  add constraint chk_file_assets_status
    check (status in ('pending_upload', 'ready', 'failed', 'deleted'));

create index if not exists idx_file_assets_user_id
  on file_assets(user_id);

create index if not exists idx_file_assets_blob_id
  on file_assets(blob_id);

create index if not exists idx_file_assets_sha256
  on file_assets(sha256);

create index if not exists idx_file_assets_status
  on file_assets(status);

create index if not exists idx_file_assets_created_at
  on file_assets(created_at desc);

create table if not exists file_uploads (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references file_assets(id),
  user_id text null,
  sha256 varchar(64) not null,
  size bigint not null,
  mime_type text not null,
  original_name text not null,
  display_name text not null,
  file_type text not null,
  source_type text not null,
  width int null,
  height int null,
  duration numeric null,
  status text not null default 'pending',
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  completed_at timestamptz null,
  constraint chk_file_uploads_file_type
    check (file_type in ('image', 'video', 'ply', 'unknown')),
  constraint chk_file_uploads_source_type
    check (source_type in ('input', 'intermediate', 'output')),
  constraint chk_file_uploads_status
    check (status in ('pending', 'completed', 'failed', 'expired', 'cancelled'))
);

create index if not exists idx_file_uploads_file_id
  on file_uploads(file_id);

create index if not exists idx_file_uploads_user_id
  on file_uploads(user_id);

create index if not exists idx_file_uploads_status
  on file_uploads(status);

create index if not exists idx_file_uploads_created_at
  on file_uploads(created_at desc);

create table if not exists file_blob_variants (
  id uuid primary key default gen_random_uuid(),
  blob_id uuid not null references file_blobs(id),
  variant text not null,
  variant_key text not null default 'default',
  storage_provider text not null default 'local',
  storage_key text not null,
  mime_type text not null,
  size bigint null,
  extension text null,
  width int null,
  height int null,
  duration numeric null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_file_blob_variants_variant
    check (variant in ('original', 'preview', 'thumbnail', 'derived')),
  constraint uq_file_blob_variants_blob_variant_key
    unique (blob_id, variant, variant_key)
);

alter table file_blob_variants
  add column if not exists variant_key text not null default 'default',
  add column if not exists metadata jsonb null,
  add column if not exists updated_at timestamptz not null default now();

alter table file_blob_variants
  drop constraint if exists uq_file_blob_variants_blob_variant;

alter table file_blob_variants
  drop constraint if exists uq_file_blob_variants_blob_variant_key;

alter table file_blob_variants
  add constraint uq_file_blob_variants_blob_variant_key
    unique (blob_id, variant, variant_key);

create index if not exists idx_file_blob_variants_blob_id
  on file_blob_variants(blob_id);

create index if not exists idx_file_blob_variants_storage_key
  on file_blob_variants(storage_provider, storage_key);

create table if not exists file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid null references file_assets(id),
  blob_id uuid null references file_blobs(id),
  upload_id uuid null references file_uploads(id),
  actor_user_id text null,
  event_type text not null,
  payload jsonb null,
  created_at timestamptz not null default now()
);

alter table file_events
  add column if not exists upload_id uuid null references file_uploads(id);

create index if not exists idx_file_events_file_id
  on file_events(file_id);

create index if not exists idx_file_events_blob_id
  on file_events(blob_id);

create index if not exists idx_file_events_upload_id
  on file_events(upload_id);

create index if not exists idx_file_events_event_type
  on file_events(event_type);

create index if not exists idx_file_events_created_at
  on file_events(created_at desc);

create table if not exists storage_objects (
  id uuid primary key default gen_random_uuid(),
  legacy_blob_id text null,
  sha256 varchar(64) not null,
  file_type text not null,
  source_type text not null,
  original_name text not null,
  mime_type text not null,
  storage_provider text not null default 'local',
  storage_key text not null,
  absolute_path text null,
  size bigint not null,
  extension text null,
  width int null,
  height int null,
  duration numeric null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  migrated_at timestamptz not null default now(),
  constraint chk_storage_objects_file_type
    check (file_type in ('image', 'video', 'ply', 'unknown')),
  constraint chk_storage_objects_source_type
    check (source_type in ('input', 'intermediate', 'output')),
  constraint uq_storage_objects_provider_key
    unique (storage_provider, storage_key)
);

alter table storage_objects
  add column if not exists duration numeric null,
  add column if not exists metadata jsonb null,
  add column if not exists migrated_at timestamptz not null default now();

create index if not exists idx_storage_objects_sha256
  on storage_objects(sha256);

create index if not exists idx_storage_objects_source_type
  on storage_objects(source_type);

create table if not exists workflow_groups (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb null
);

create index if not exists idx_workflow_groups_owner_user_id
  on workflow_groups(owner_user_id);

create table if not exists workflows (
  id text primary key,
  project_id text not null default 'default',
  owner_user_id text not null,
  name text not null,
  group_id text null,
  container_key text not null default '__ungrouped__',
  is_auto_named boolean not null default true,
  node_count int not null default 0,
  connection_count int not null default 0,
  timestamp bigint null,
  version int not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workflows_owner_user_id
  on workflows(owner_user_id);

create index if not exists idx_workflows_group_id
  on workflows(group_id);

create index if not exists idx_workflows_project_id
  on workflows(project_id);

create index if not exists idx_workflows_updated_at
  on workflows(updated_at desc);

create table if not exists workflow_file_bindings (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null references workflows(id),
  owner_user_id text not null,
  node_id text not null,
  file_id uuid not null references file_assets(id),
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_workflow_file_bindings_role
    check (role in ('file-node', 'node-reference', 'connection-reference', 'file-group')),
  constraint uq_workflow_file_bindings_identity
    unique (workflow_id, node_id, file_id, role)
);

create index if not exists idx_workflow_file_bindings_workflow_id
  on workflow_file_bindings(workflow_id);

create index if not exists idx_workflow_file_bindings_file_id
  on workflow_file_bindings(file_id);

create index if not exists idx_workflow_file_bindings_owner_user_id
  on workflow_file_bindings(owner_user_id);

create table if not exists execution_runs (
  id uuid primary key default gen_random_uuid(),
  run_no varchar(32) not null unique,
  user_id text null,
  workflow_id text null,
  project_id text null,
  node_type text not null,
  task_type text not null,
  execution_mode text not null,
  node_id text null,
  node_title text null,
  provider text null,
  status text not null,
  total_task_count int not null default 0,
  completed_task_count int not null default 0,
  failed_task_count int not null default 0,
  request_payload jsonb not null,
  result_summary jsonb null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  constraint chk_execution_runs_status
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

alter table execution_runs
  add column if not exists workflow_id text null,
  add column if not exists project_id text null;

alter table execution_runs
  alter column provider drop not null;

create index if not exists idx_execution_runs_user_id
  on execution_runs(user_id);

create index if not exists idx_execution_runs_workflow_id
  on execution_runs(workflow_id);

create index if not exists idx_execution_runs_project_id
  on execution_runs(project_id);

create index if not exists idx_execution_runs_status
  on execution_runs(status);

create index if not exists idx_execution_runs_created_at
  on execution_runs(created_at desc);

create index if not exists idx_execution_runs_node_type
  on execution_runs(node_type);

create table if not exists execution_tasks (
  id uuid primary key default gen_random_uuid(),
  task_no varchar(32) not null unique,
  run_id uuid not null references execution_runs(id),
  user_id text null,
  workflow_id text null,
  project_id text null,
  node_type text null,
  node_id text null,
  node_title text null,
  task_type text null,
  group_id text null,
  group_order int null,
  provider text null,
  model text null,
  input jsonb null,
  status text not null,
  current_step text null,
  current_attempt_no int not null default 0,
  retry_count int not null default 0,
  max_retries int not null default 2,
  last_error_code text null,
  last_error_message text null,
  result_file_id uuid null references file_assets(id),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  constraint chk_execution_tasks_status
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint chk_execution_tasks_retry_count
    check (retry_count >= 0),
  constraint chk_execution_tasks_max_retries
    check (max_retries >= 0)
);

alter table execution_tasks
  add column if not exists workflow_id text null,
  add column if not exists project_id text null,
  add column if not exists node_id text null,
  add column if not exists node_type text null,
  add column if not exists node_title text null,
  add column if not exists task_type text null,
  add column if not exists input jsonb null;

alter table execution_tasks
  alter column group_id drop not null,
  alter column group_order drop not null,
  alter column provider drop not null,
  alter column model drop not null;

create index if not exists idx_execution_tasks_run_id
  on execution_tasks(run_id);

create index if not exists idx_execution_tasks_workflow_id
  on execution_tasks(workflow_id);

create index if not exists idx_execution_tasks_project_id
  on execution_tasks(project_id);

create index if not exists idx_execution_tasks_status
  on execution_tasks(status);

create index if not exists idx_execution_tasks_created_at
  on execution_tasks(created_at desc);

create index if not exists idx_execution_tasks_group_id
  on execution_tasks(group_id);

create index if not exists idx_execution_tasks_node_type
  on execution_tasks(node_type);

create table if not exists task_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references execution_tasks(id),
  attempt_no int not null,
  status text not null,
  current_step text null,
  progress int not null default 0,
  error_code text null,
  error_message text null,
  provider_request_meta jsonb null,
  provider_response_meta jsonb null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint uq_task_attempts_task_attempt unique (task_id, attempt_no),
  constraint chk_task_attempts_status
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

create index if not exists idx_task_attempts_task_id
  on task_attempts(task_id);

create index if not exists idx_task_attempts_started_at
  on task_attempts(started_at desc);

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references execution_runs(id),
  task_id uuid not null references execution_tasks(id),
  workflow_id text null,
  attempt_no int null,
  event_type text not null,
  status text not null,
  phase text null,
  step_type text null,
  progress int not null default 0,
  message text null,
  payload jsonb null,
  created_at timestamptz not null default now(),
  constraint chk_task_events_status
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled'))
);

alter table task_events
  add column if not exists workflow_id text null;

create index if not exists idx_task_events_task_id
  on task_events(task_id);

create index if not exists idx_task_events_run_id
  on task_events(run_id);

create index if not exists idx_task_events_workflow_id
  on task_events(workflow_id);

create index if not exists idx_task_events_created_at
  on task_events(created_at desc);

create table if not exists task_file_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references execution_tasks(id),
  file_id uuid not null references file_assets(id),
  workflow_id text null,
  role text not null,
  order_index int null,
  source_handle text null,
  group_id text null,
  created_at timestamptz not null default now(),
  constraint chk_task_file_links_role
    check (role in ('input', 'reference', 'intermediate', 'output'))
);

alter table task_file_links
  add column if not exists workflow_id text null;

alter table task_file_links
  alter column group_id drop not null;

create index if not exists idx_task_file_links_task_id
  on task_file_links(task_id);

create index if not exists idx_task_file_links_file_id
  on task_file_links(file_id);

create index if not exists idx_task_file_links_workflow_id
  on task_file_links(workflow_id);

create index if not exists idx_task_file_links_role
  on task_file_links(role);

create table if not exists provider_call_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references execution_tasks(id),
  attempt_id uuid null references task_attempts(id),
  step_type text not null,
  provider text not null,
  model text not null,
  request_summary jsonb null,
  response_summary jsonb null,
  http_status int null,
  success boolean not null default false,
  error_code text null,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_provider_call_logs_task_id
  on provider_call_logs(task_id);

create index if not exists idx_provider_call_logs_attempt_id
  on provider_call_logs(attempt_id);

create index if not exists idx_provider_call_logs_step_type
  on provider_call_logs(step_type);

create index if not exists idx_provider_call_logs_started_at
  on provider_call_logs(started_at desc);

create table if not exists intermediate_artifacts (
  id uuid primary key default gen_random_uuid(),
  source_blob_id uuid not null references file_blobs(id),
  artifact_type text not null,
  file_id uuid null references file_assets(id),
  provider text not null,
  model text not null,
  pipeline_version text not null,
  prompt_version text not null,
  status text not null,
  last_task_id uuid null references execution_tasks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz null,
  constraint chk_intermediate_artifacts_type
    check (artifact_type in ('lineart', 'depth')),
  constraint chk_intermediate_artifacts_status
    check (status in ('processing', 'ready', 'failed')),
  constraint uq_intermediate_artifacts_cache_key
    unique (
      source_blob_id,
      artifact_type,
      provider,
      model,
      pipeline_version,
      prompt_version
    )
);

alter table intermediate_artifacts
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_intermediate_artifacts_source_blob_id
  on intermediate_artifacts(source_blob_id);

create index if not exists idx_intermediate_artifacts_status
  on intermediate_artifacts(status);

create index if not exists idx_intermediate_artifacts_last_used_at
  on intermediate_artifacts(last_used_at desc);

create table if not exists legacy_migration_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  source_root text not null,
  status text not null,
  summary jsonb not null,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint chk_legacy_migration_runs_status
    check (status in ('generated', 'applied', 'failed'))
);

alter table legacy_migration_runs
  add column if not exists error_message text null;

create index if not exists idx_legacy_migration_runs_status
  on legacy_migration_runs(status);

create index if not exists idx_legacy_migration_runs_started_at
  on legacy_migration_runs(started_at desc);
