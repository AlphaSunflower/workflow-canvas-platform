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

create index if not exists idx_intermediate_artifacts_source_blob_id
  on intermediate_artifacts(source_blob_id);

create index if not exists idx_intermediate_artifacts_status
  on intermediate_artifacts(status);

create index if not exists idx_intermediate_artifacts_last_used_at
  on intermediate_artifacts(last_used_at desc);
