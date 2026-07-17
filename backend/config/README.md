# Backend Config

The backend uses a single JSON config file by default:

- `backend/config/backend.config.json`

The example template is:

- `backend/config/backend.config.example.json`

## Usage

1. Edit `backend.config.json` as JSON.
2. Restart the backend with `backend/start-backend.cmd` or `npm run start` from `backend/`.

Environment variables may still override matching config values when supported by `shared/src/env.ts`.

## Common Fields

- `runtime.nodeEnv`: runtime environment, usually `development`.
- `runtime.host`: API and Worker bind host.
- `services.api.port`: API port.
- `services.worker.port`: Worker port.
- `services.worker.pollIntervalMs`: Worker polling interval in milliseconds.
- `persistence.mode`: runtime persistence backend. Supported values are `db` and `json`; `db` is the default DB Only path.
- `persistence.cutoverStage`: optional operator note for the current cutover stage. Supported documentation values are `db-read-write` and `json-legacy-fallback`. This field is not used by runtime selection; `persistence.mode` remains authoritative.
- `database.url`: optional PostgreSQL connection string. When set, it takes precedence over host/port/database/user/password.
- `database.host`: PostgreSQL host. Default is `127.0.0.1`.
- `database.port`: PostgreSQL port. Default is `5432`.
- `database.database`: PostgreSQL database name. Default is `newworkflow`.
- `database.user`: PostgreSQL user. Default is `postgres`.
- `database.password`: PostgreSQL password. Use `null` for local trust/passwordless setups.
- `database.ssl`: enable PostgreSQL SSL with relaxed certificate verification.
- `database.maxPoolSize`: max connections per process pool.
- `database.idleTimeoutMillis`: idle connection timeout.
- `database.connectionTimeoutMillis`: connection acquisition timeout.
- `database.statementTimeoutMillis`: PostgreSQL statement timeout. `0` disables the statement timeout.
- `database.healthcheckTimeoutMillis`: `/healthz` DB ping timeout.
- `providers.laozhang.apiKey`: Laozhang API key.
- `providers.laozhang.apiUrl`: Laozhang Gemini image endpoint URL. The current Gemini image generation path continues to use this full endpoint.
- `providers.laozhang.openaiApiBaseUrl`: Laozhang OpenAI-compatible image API base URL. `gpt-image-2-vip` will use this base URL instead of the Gemini full endpoint.
- `providers.laozhang.sora2Official.apiKey`: Laozhang Sora2Official group API key for `GPT Image 2 Official`.
- `providers.laozhang.sora2Official.apiBaseUrl`: Laozhang Sora2Official OpenAI-compatible base URL. Default is `https://api.laozhang.ai/v1`.
- `providers.laozhang.vision.apiUrl`: Laozhang vision API URL.
- `providers.laozhang.vision.model`: Laozhang vision model.
- `providers.laozhang.vision.timeoutMs`: Laozhang vision request timeout in milliseconds. Default is `180000` for multimodal prompt optimize and storyboard arrange requests.
- `providers.laozhang.veo.apiBaseUrl`: Laozhang Veo API base URL.
- `providers.laozhang.veo.pollIntervalMs`: Laozhang Veo async task polling interval in milliseconds.
- `providers.laozhang.veo.timeoutMs`: Laozhang Veo request timeout in milliseconds.
- `providers.laozhang.veo.maxConcurrency`: Optional local dispatch concurrency limit for `laozhang-veo`; omitted, non-integer, or values lower than `1` mean no local concurrency limit.
- `providers.runninghub.apiKey`: RunningHub API key.
- `providers.runninghub.apiBaseUrl`: RunningHub API base URL.
- `providers.runninghub.maxConcurrency`: RunningHub local dispatch concurrency limit; default is `3`.
- `paths.providerSnapshotDir`: provider raw response snapshot directory, relative to `backend/`.

## Laozhang Image Endpoints

The backend now keeps two separate Laozhang image addresses:

- `providers.laozhang.apiUrl`
  Used by the existing Gemini image generation route. This is a full endpoint such as `.../v1beta/models/gemini-3-pro-image-preview:generateContent`.
- `providers.laozhang.openaiApiBaseUrl`
  Used by the OpenAI-compatible image route for `gpt-image-2-vip`. This should be a base URL such as `https://api.laozhang.ai/v1`.
- `providers.laozhang.sora2Official.apiBaseUrl`
  Used by the Sora2Official group route for `gpt-image-2-official`; the worker sends the official provider model `gpt-image-2` through this base URL.

The Sora2Official route also uses its own API key:

- `providers.laozhang.sora2Official.apiKey`
- `LAOZHANG_SORA2OFFICIAL_API_KEY`

The optional environment override for the base URL is:

- `LAOZHANG_SORA2OFFICIAL_BASE_URL`

Do not replace the Gemini endpoint with either OpenAI-compatible base URL. They are intentionally kept separate so the worker can route different image models without sharing one ambiguous address or API key.

## Laozhang Veo Concurrency

`laozhang-veo` is used by video generation tasks. By default, no local Worker concurrency limit is configured, so the Worker may dispatch all created video tasks that have available queue capacity. This matches the provider deployment where the backend maps to multiple client-side access lanes.

The Veo worker route uses the Laozhang Veo 3.1 official-forward Videos API. Keep `providers.laozhang.veo.apiBaseUrl` as an OpenAI-style base URL such as `https://api.laozhang.ai/v1`; the worker creates tasks with `POST /v1/videos` multipart form data, polls `GET /v1/videos/{id}`, and downloads MP4 bytes from `GET /v1/videos/{id}/content`.

Supported Veo models are:

- `veo-3.1-fast-generate-preview`
- `veo-3.1-generate-preview`

To enable local limiting for the current Worker process, explicitly set a positive integer:

- `providers.laozhang.veo.maxConcurrency`
- `LAOZHANG_VEO_MAX_CONCURRENCY`

Rules:

- Omitted, non-integer, or values lower than `1` mean unlimited local dispatch for `laozhang-veo`.
- `2` means the Worker dispatches at most 2 `laozhang-veo` tasks at the same time.
- `3` means the Worker dispatches at most 3 `laozhang-veo` tasks at the same time.
- This setting only affects `laozhang-veo`; it does not change RunningHub defaults.

## RunningHub Concurrency

RunningHub tasks keep their existing local concurrency limit behavior.

- If `providers.runninghub.maxConcurrency` is omitted, invalid, or lower than `1`, env parsing falls back to `3`.
- Worker startup logs include the effective `runninghubMaxConcurrency`.

## Persistence And Database

The runtime switch has two implemented values:

- `db`: API and Worker use PostgreSQL-backed repositories as the primary source of truth.
- `json`: legacy fallback for rollback and isolated diagnostics only. Do not use it for the main backend test chain.

The default persistence mode is DB:

```json
{
  "persistence": {
    "mode": "db",
    "cutoverStage": "db-read-write"
  }
}
```

If `persistence.mode` is omitted, runtime config resolves to `db`. Invalid values in `persistence.mode` or `BACKEND_PERSISTENCE_MODE` fail during config loading instead of falling back to JSON.

DB mode requires a reachable PostgreSQL database and the backend schema from `backend/db/migrations/001_init.sql` through `003_file_database_platform.sql`. `npm run check-config`, `npm run start`, and `npm run dev` fail clearly when the DB connection or required tables are missing. API and Worker `/healthz` also report DB errors as degraded health.

Minimal DB mode config:

```json
{
  "persistence": {
    "mode": "db",
    "cutoverStage": "db-read-write"
  },
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "newworkflow",
    "user": "postgres",
    "password": "postgres"
  }
}
```

DB Only coverage:

- auth, refresh session, and audit logs
- file blobs, file assets, uploads, variants, events, and storage object index
- workflows, groups, payload JSONB, and workflow-file bindings
- execution runs, tasks, task events, and task-file links
- Worker output/intermediate file assets
- admin read APIs

`persistence.cutoverStage` is for humans and deployment records. It does not create a third runtime mode. Use it to document these states:

- `db-read-write`: primary DB runtime for production and backend DB tests.
- `json-legacy-fallback`: explicit rollback/diagnostic state using legacy JSON stores.

In `json` mode, API and Worker keep using legacy JSON stores and `/healthz` reports database status as `disabled`. JSON mode is explicit; DB mode never silently falls back to JSON.

Environment overrides:

- `BACKEND_PERSISTENCE_MODE`
- `DATABASE_URL`
- `BACKEND_DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `BACKEND_DATABASE_HOST`
- `BACKEND_DATABASE_PORT`
- `BACKEND_DATABASE_NAME`
- `BACKEND_DATABASE_USER`
- `BACKEND_DATABASE_PASSWORD`
- `BACKEND_DATABASE_SSL`
- `BACKEND_DATABASE_MAX_POOL_SIZE`
- `BACKEND_DATABASE_IDLE_TIMEOUT_MS`
- `BACKEND_DATABASE_CONNECTION_TIMEOUT_MS`
- `BACKEND_DATABASE_STATEMENT_TIMEOUT_MS`
- `BACKEND_DATABASE_HEALTHCHECK_TIMEOUT_MS`

`DATABASE_URL` and `BACKEND_DATABASE_URL` take precedence over individual host/port/database/user/password fields.

## DB Only Startup Pattern

Recommended sequence:

1. Apply backend DB migrations through `003_file_database_platform.sql`.
2. Set `persistence.mode = "db"` and database connection fields, or provide equivalent environment overrides.
3. Run `npm run check-config` from `backend/`; this now verifies DB connectivity and required schema in DB mode.
4. Start API and Worker together with `npm run start` or `npm run dev`.
5. Check API and Worker `/healthz`; `database.status` must be `ok`.

Use `persistence.mode = "json"` only when deliberately entering the documented legacy fallback path. Do not rely on JSON stores as an implicit fallback for DB errors.
