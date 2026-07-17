import assert from "node:assert/strict";

import {
  checkDatabaseSchemaHealth,
  checkPostgresHealth,
  findMissingSchemaTables,
} from "../../shared/src/index.ts";
import { WorkerApp } from "../../worker/src/app.ts";
import { createWorkerDependencies } from "../../worker/src/composition/create-worker-dependencies.ts";
import {
  cleanupDbE2EContext,
  createDbE2EContext,
  createDbTestEnv,
  startDbApi,
  closeDbApi,
} from "./bootstrap-db.ts";

interface HealthResponseBody {
  status: string;
  persistenceMode: string;
  database: {
    status: string;
    schema: {
      status: string;
      requiredTables: string[];
      missingTables: string[];
    };
  };
}

async function fetchHealthz(baseUrl: string): Promise<{
  status: number;
  body: HealthResponseBody;
}> {
  const response = await fetch(`${baseUrl}/healthz`);
  return {
    status: response.status,
    body: await response.json() as HealthResponseBody,
  };
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("schema_health");
  const api = await startDbApi(context);
  const workerEnv = createDbTestEnv(context, "worker");
  const worker = new WorkerApp(createWorkerDependencies({
    env: workerEnv,
    rootDir: context.rootDir,
  }));
  let workerStarted = false;

  try {
    await worker.start();
    workerStarted = true;
    const workerPort = worker.getListeningPort();
    assert.ok(workerPort);
    const workerBaseUrl = `http://${workerEnv.host}:${workerPort}`;

    const missingTables = await findMissingSchemaTables(context.pool);
    assert.deepEqual(missingTables, []);

    const schemaHealth = await checkDatabaseSchemaHealth("db", context.databaseConfig);
    assert.equal(schemaHealth.enabled, true);
    assert.equal(schemaHealth.status, "ok");
    assert.deepEqual(schemaHealth.missingTables, []);
    assert.ok(schemaHealth.requiredTables.includes("provider_call_logs"));
    assert.ok(schemaHealth.requiredTables.includes("intermediate_artifacts"));

    const postgresHealth = await checkPostgresHealth("db", context.databaseConfig);
    assert.equal(postgresHealth.status, "ok");
    assert.equal(postgresHealth.schema.status, "ok");
    assert.ok(postgresHealth.schema.requiredTables.includes("provider_call_logs"));
    assert.ok(postgresHealth.schema.requiredTables.includes("intermediate_artifacts"));

    const apiOkHealth = await fetchHealthz(api.baseUrl);
    const workerOkHealth = await fetchHealthz(workerBaseUrl);
    assert.equal(apiOkHealth.status, 200);
    assert.equal(workerOkHealth.status, 200);
    assert.equal(apiOkHealth.body.database.schema.status, "ok");
    assert.equal(workerOkHealth.body.database.schema.status, "ok");
    assert.ok(apiOkHealth.body.database.schema.requiredTables.includes("provider_call_logs"));
    assert.ok(workerOkHealth.body.database.schema.requiredTables.includes("provider_call_logs"));
    assert.ok(apiOkHealth.body.database.schema.requiredTables.includes("intermediate_artifacts"));
    assert.ok(workerOkHealth.body.database.schema.requiredTables.includes("intermediate_artifacts"));

    await context.pool.query("drop table intermediate_artifacts");
    const missingSchemaHealth = await checkDatabaseSchemaHealth("db", context.databaseConfig);
    assert.equal(missingSchemaHealth.status, "missing");
    assert.deepEqual(missingSchemaHealth.missingTables, ["intermediate_artifacts"]);
    assert.match(missingSchemaHealth.errorMessage ?? "", /DATABASE_SCHEMA_NOT_READY/u);

    const missingPostgresHealth = await checkPostgresHealth("db", context.databaseConfig);
    assert.equal(missingPostgresHealth.status, "error");
    assert.equal(missingPostgresHealth.schema.status, "missing");
    assert.deepEqual(missingPostgresHealth.schema.missingTables, ["intermediate_artifacts"]);

    const env = createDbTestEnv(context, "api");
    const apiMissingHealth = await fetchHealthz(api.baseUrl);
    const workerMissingHealth = await fetchHealthz(workerBaseUrl);
    assert.equal(apiMissingHealth.status, 200);
    assert.equal(workerMissingHealth.status, 200);
    assert.equal(apiMissingHealth.body.persistenceMode, env.persistenceMode);
    assert.equal(workerMissingHealth.body.persistenceMode, workerEnv.persistenceMode);
    assert.equal(apiMissingHealth.body.status, "degraded");
    assert.equal(workerMissingHealth.body.status, "degraded");
    assert.equal(apiMissingHealth.body.database.status, "error");
    assert.equal(workerMissingHealth.body.database.status, "error");
    assert.equal(apiMissingHealth.body.database.schema.status, "missing");
    assert.equal(workerMissingHealth.body.database.schema.status, "missing");
    assert.deepEqual(apiMissingHealth.body.database.schema.missingTables, ["intermediate_artifacts"]);
    assert.deepEqual(workerMissingHealth.body.database.schema.missingTables, ["intermediate_artifacts"]);
  } finally {
    if (workerStarted) {
      await worker.stop().catch(() => undefined);
    }
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
