import { DbExecutionsRepository } from "../../../api/src/modules/executions/db-executions.repository.ts";
import { JsonExecutionsRepository } from "../../../api/src/modules/executions/json-executions.repository.ts";
import { DbFilesRepository } from "../../../api/src/modules/files/db-files.repository.ts";
import type { FilesRepository } from "../../../api/src/modules/files/files.repository.types.ts";
import { JsonFilesRepository } from "../../../api/src/modules/files/json-files.repository.ts";
import { ExecutionEventService } from "../modules/execution-events/execution-event.service.ts";
import { RetryPolicyService } from "../modules/retry/retry-policy.service.ts";
import { createWorkerStorageAdapter } from "../modules/storage/storage-adapter.factory.ts";
import { StorageService } from "../modules/storage/storage.service.ts";
import type { WorkerCompositionContext } from "./worker-composition.context.ts";

function createWorkerFilesRepository(context: WorkerCompositionContext): FilesRepository {
  if (context.env.persistenceMode === "db") {
    return new DbFilesRepository(context.env.database, { rootDir: context.rootDir });
  }

  return new JsonFilesRepository(context.rootDir);
}

export function composeWorkerCore(context: WorkerCompositionContext) {
  const executionsRepository = context.resolve(
    "executionsRepository",
    () => context.env.persistenceMode === "db"
      ? new DbExecutionsRepository(context.env.database)
      : new JsonExecutionsRepository(context.rootDir),
  );
  const filesRepository = context.resolve(
    "filesRepository",
    () => createWorkerFilesRepository(context),
  );
  const storageService = context.resolve(
    "storageService",
    () => new StorageService(createWorkerStorageAdapter(
      context.env.objectStorage,
      context.rootDir,
    )),
  );
  const executionEventService = context.resolve(
    "executionEventService",
    () => new ExecutionEventService(executionsRepository),
  );
  const retryPolicyService = context.resolve(
    "retryPolicyService",
    () => new RetryPolicyService(),
  );

  return {
    executionsRepository,
    filesRepository,
    storageService,
    executionEventService,
    retryPolicyService,
  };
}
