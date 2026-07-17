import { ExecutionRunService } from "../modules/execution-run/execution-run.service.ts";
import { ProviderSnapshotCleanerService } from "../modules/providers/provider-snapshot-cleaner.service.ts";
import { QueueRepository } from "../modules/queue/queue.repository.ts";
import { QueueService } from "../modules/queue/queue.service.ts";
import type { WorkerCompositionContext } from "./worker-composition.context.ts";

export interface WorkerRunCompositionInput {
  context: WorkerCompositionContext;
  executionsRepository: ConstructorParameters<typeof QueueRepository>[0];
  executionEventService: ConstructorParameters<typeof QueueService>[2];
  retryPolicyService: ConstructorParameters<typeof QueueService>[3];
  providerConcurrencyService: ConstructorParameters<typeof QueueService>[4];
  queueTaskExecutor: ConstructorParameters<typeof QueueService>[1];
  workerId?: string;
}

export function composeWorkerRunServices(
  input: WorkerRunCompositionInput,
) {
  const queueRepository = input.context.resolve(
    "queueRepository",
    () => new QueueRepository(input.executionsRepository),
  );
  const queueService = input.context.resolve(
    "queueService",
    () => new QueueService(
      queueRepository,
      input.queueTaskExecutor,
      input.executionEventService,
      input.retryPolicyService,
      input.providerConcurrencyService,
      {
        workerId: input.workerId,
      },
    ),
  );
  const executionRunService = input.context.resolve(
    "executionRunService",
    () => new ExecutionRunService(queueService, input.context.env.workerPollIntervalMs),
  );
  const providerSnapshotCleanerService = input.context.resolve(
    "providerSnapshotCleanerService",
    () => new ProviderSnapshotCleanerService({
      snapshotDir: input.context.snapshotDir,
    }),
  );

  return {
    queueService,
    executionRunService,
    providerSnapshotCleanerService,
  };
}
