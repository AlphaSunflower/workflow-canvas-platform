import {
  createLogger,
} from "@newworkflow/backend-shared";
import type { QueueTaskExecutor } from "../executors/queue-task-executor.types.ts";
import { ExecutionEventService } from "../execution-events/execution-event.service.ts";
import { RetryPolicyService } from "../retry/retry-policy.service.ts";
import { ProviderConcurrencyService } from "./provider-concurrency.service.ts";
import { QueueRepository } from "./queue.repository.ts";
import type {
  QueueClaimedTask,
  QueueBackpressureSnapshot,
  QueueHealthSnapshot,
  QueuePollResult,
  QueueTaskExecutionOutcome,
} from "./queue.types.ts";
import type {
  ProviderConcurrencyServiceLike,
} from "./provider-concurrency.types.ts";

export interface QueueServiceOptions {
  maxConcurrency?: number;
  scanLimitMultiplier?: number;
  workerId?: string;
  taskLeaseMs?: number;
  taskHeartbeatIntervalMs?: number;
  recoveryScanLimit?: number;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.trunc(value);
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return null;
  }

  return Math.trunc(value);
}

export class QueueService {
  private readonly queueRepository: QueueRepository;
  private readonly executionEventService: ExecutionEventService;
  private readonly logger = createLogger("worker-queue");
  private readonly maxConcurrency: number | null;
  private readonly scanLimitMultiplier: number;
  private readonly workerId: string;
  private readonly taskLeaseMs: number;
  private readonly taskHeartbeatIntervalMs: number;
  private readonly recoveryScanLimit: number;
  private readonly retryPolicyService: RetryPolicyService;
  private readonly taskExecutor: QueueTaskExecutor;
  private readonly providerConcurrencyService: ProviderConcurrencyServiceLike;
  private activeTaskIds = new Set<string>();
  private lastScanLimit = 0;
  private lastCandidateCount = 0;
  private lastProviderSkippedCount = 0;
  private lastClaimedCount = 0;
  private queuedTaskCount = 0;
  private queuedTaskCountByProvider: Record<string, number> = {};
  private lastProviderSlotSkippedTaskId: string | null = null;
  private lastProviderSlotSkippedTaskNo: string | null = null;
  private lastProviderSlotSkippedProvider: string | null = null;
  private lastProviderSlotSkippedAt: string | null = null;
  private lastDispatchKickScheduledAt: string | null = null;
  private lastProviderBackpressure: QueueBackpressureSnapshot | null = null;
  private dispatchKickHandler: (() => void) | null = null;

  constructor(
    queueRepository: QueueRepository,
    taskExecutor: QueueTaskExecutor,
    executionEventService: ExecutionEventService,
    retryPolicyService: RetryPolicyService,
    providerConcurrencyService?: ProviderConcurrencyServiceLike,
    options?: QueueServiceOptions,
  ) {
    this.queueRepository = queueRepository;
    this.taskExecutor = taskExecutor;
    this.executionEventService = executionEventService;
    this.retryPolicyService = retryPolicyService;
    this.maxConcurrency = normalizeOptionalPositiveInteger(options?.maxConcurrency);
    this.scanLimitMultiplier = normalizePositiveInteger(options?.scanLimitMultiplier, 4);
    this.workerId = options?.workerId?.trim() || `worker-${process.pid}`;
    this.taskLeaseMs = normalizePositiveInteger(options?.taskLeaseMs, 120_000);
    this.taskHeartbeatIntervalMs = normalizePositiveInteger(
      options?.taskHeartbeatIntervalMs,
      Math.max(5_000, Math.floor(this.taskLeaseMs / 4)),
    );
    this.recoveryScanLimit = normalizePositiveInteger(options?.recoveryScanLimit, 100);
    this.providerConcurrencyService =
      providerConcurrencyService
      ?? new ProviderConcurrencyService();
  }

  async pollOnce(): Promise<QueuePollResult> {
    await this.recoverExpiredProcessingTasks();
    const claimedTasks = await this.claimDispatchableTasks();

    if (claimedTasks.length === 0) {
      return {
        claimedTasks: [],
        claimedCount: 0,
      };
    }

    this.lastClaimedCount = claimedTasks.length;
    await Promise.all(claimedTasks.map((item) => this.executeClaimedTask(item)));

    return {
      claimedTasks,
      claimedCount: claimedTasks.length,
    };
  }

  async dispatchOnce(): Promise<QueuePollResult> {
    await this.recoverExpiredProcessingTasks();
    const claimedTasks = await this.claimDispatchableTasks();

    if (claimedTasks.length === 0) {
      return {
        claimedTasks: [],
        claimedCount: 0,
      };
    }

    this.lastClaimedCount = claimedTasks.length;

    for (const item of claimedTasks) {
      void this.executeClaimedTask(item);
    }

    return {
      claimedTasks,
      claimedCount: claimedTasks.length,
    };
  }

  setDispatchKickHandler(handler: (() => void) | null): void {
    this.dispatchKickHandler = handler;
  }

  private async claimDispatchableTasks(): Promise<QueueClaimedTask[]> {
    await this.refreshQueuedTaskStats();
    const capacity =
      typeof this.maxConcurrency === "number"
        ? this.maxConcurrency - this.activeTaskIds.size
        : null;

    if (typeof capacity === "number" && capacity <= 0) {
      this.lastScanLimit = 0;
      this.lastCandidateCount = 0;
      this.lastClaimedCount = 0;
      return [];
    }

    const candidateLimit =
      typeof capacity === "number"
        ? Math.max(capacity * this.scanLimitMultiplier, capacity)
        : Math.max(this.queuedTaskCount, 1);
    const candidates = await this.queueRepository.listQueuedTasks(candidateLimit);
    this.lastScanLimit = candidateLimit;
    this.lastCandidateCount = candidates.length;
    this.lastProviderSkippedCount = 0;

    if (candidates.length === 0) {
      this.lastClaimedCount = 0;
      return [];
    }

    const claimedTasks: QueueClaimedTask[] = [];

    for (const candidate of candidates) {
      if (typeof capacity === "number" && claimedTasks.length >= capacity) {
        break;
      }

      if (this.activeTaskIds.has(candidate.id)) {
        continue;
      }

      if (!(await this.providerConcurrencyService.canDispatch(candidate))) {
        this.lastProviderSkippedCount += 1;
        this.recordProviderSlotSkipped(candidate);
        continue;
      }

      const providerSlot = await this.providerConcurrencyService.acquire(candidate);

      if (!providerSlot) {
        this.lastProviderSkippedCount += 1;
        this.recordProviderSlotSkipped(candidate);
        continue;
      }

      this.logger.info("Queue acquired provider slot", {
        taskId: candidate.id,
        taskNo: candidate.taskNo,
        provider: providerSlot.providerKey,
        providerConcurrency: this.providerConcurrencyService.getHealth().providers[providerSlot.providerKey] ?? null,
      });

      const claimed = await this.queueRepository.claimQueuedTaskById(candidate.id, {
        workerId: this.workerId,
        leaseMs: this.taskLeaseMs,
      });

      if (!claimed) {
        this.logger.debug("Queue claim lost after provider slot acquire", {
          taskId: candidate.id,
          taskNo: candidate.taskNo,
          provider: providerSlot.providerKey,
        });
        await this.providerConcurrencyService.release(providerSlot);
        continue;
      }

      claimedTasks.push({
        runId: claimed.runId,
        task: claimed.task,
        providerSlot,
      });

      this.activeTaskIds.add(claimed.task.id);
    }

    if (claimedTasks.length === 0) {
      this.lastClaimedCount = 0;
      await this.refreshQueuedTaskStats();
      return [];
    }

    await this.refreshQueuedTaskStats();

    return claimedTasks;
  }

  private async executeClaimedTask(item: QueueClaimedTask): Promise<void> {
    let outcome: QueueTaskExecutionOutcome = "failed";
    const heartbeat = this.startLeaseHeartbeat(item.task.id);

    try {
      this.logger.info("Queue claimed task", {
        runId: item.runId,
        taskId: item.task.id,
        taskNo: item.task.taskNo,
        groupId: item.task.groupId,
        provider: this.providerConcurrencyService.getProviderKey(item.task),
      });

      outcome = await this.executeTaskWithRetry(item);

      this.logger.info(
        outcome === "completed"
          ? "Queue completed task"
          : outcome === "backpressure"
            ? "Queue requeued task due to provider backpressure"
            : "Queue failed task",
        {
          taskId: item.task.id,
          taskNo: item.task.taskNo,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Queue task execution failed.";

      this.logger.error("Queue failed task", {
        taskId: item.task.id,
        taskNo: item.task.taskNo,
        error: message,
      });
    } finally {
      heartbeat.stop();
      await this.providerConcurrencyService.release(item.providerSlot);
      this.logger.info("Queue released provider slot", {
        taskId: item.task.id,
        taskNo: item.task.taskNo,
        provider: item.providerSlot.providerKey,
        outcome,
        providerConcurrency: this.providerConcurrencyService.getHealth().providers[item.providerSlot.providerKey] ?? null,
      });
      this.activeTaskIds.delete(item.task.id);

      if (outcome !== "backpressure") {
        this.requestDispatchKick();
      }
    }
  }

  private async executeTaskWithRetry(
    item: QueueClaimedTask,
  ): Promise<QueueTaskExecutionOutcome> {
    const maxAttempts = this.retryPolicyService.getMaxAttempts();

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      await this.queueRepository.updateTaskAttempt({
        taskId: item.task.id,
        attemptNo,
        retryCount: this.retryPolicyService.getRetryCountForAttempt(attemptNo),
        currentStep: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });

      if (attemptNo > 1) {
        await this.executionEventService.recordAttemptStarted({
          taskId: item.task.id,
          attemptNo,
        });
      }

      try {
        await this.taskExecutor.execute({
          runId: item.runId,
          task: item.task,
        });

        await this.executionEventService.recordAttemptCompleted({
          taskId: item.task.id,
          attemptNo,
        });
        await this.queueRepository.markTaskCompleted(item.task.id);
        return "completed";
      } catch (error) {
        const normalizedError = this.retryPolicyService.normalizeError(error);
        const taskState = await this.queueRepository.getTaskById(item.task.id);
        const stepType = taskState?.currentStep ?? null;

        if (this.retryPolicyService.isProviderBackpressure(normalizedError)) {
          const delayMs = this.retryPolicyService.getProviderBackpressureDelayMs();
          const providerKey = this.providerConcurrencyService.getProviderKey(item.task);
          const occurredAt = new Date().toISOString();

          await this.queueRepository.updateTaskAttempt({
            taskId: item.task.id,
            attemptNo,
            retryCount: this.retryPolicyService.getRetryCountForAttempt(attemptNo),
            currentStep: stepType,
            lastErrorCode: normalizedError.code,
            lastErrorMessage: normalizedError.message,
          });

          await this.executionEventService.recordProviderBackpressureScheduled({
            taskId: item.task.id,
            attemptNo,
            delayMs,
            error: normalizedError,
            stepType,
          });

          await this.queueRepository.requeueTask({
            taskId: item.task.id,
            errorCode: normalizedError.code,
            errorMessage: normalizedError.message,
          });
          this.incrementQueuedTaskStats(providerKey);

          this.lastProviderBackpressure = {
            taskId: item.task.id,
            taskNo: item.task.taskNo,
            provider: providerKey,
            providerCode: normalizedError.providerCode ?? null,
            errorCode: normalizedError.code,
            errorMessage: normalizedError.message,
            occurredAt,
          };

          this.logger.warn("Queue encountered provider backpressure", {
            taskId: item.task.id,
            taskNo: item.task.taskNo,
            provider: providerKey,
            providerCode: normalizedError.providerCode ?? null,
            errorCode: normalizedError.code,
            delayMs,
          });

          setTimeout(() => {
            this.requestDispatchKick();
          }, delayMs);

          return "backpressure";
        }

        const decision = this.retryPolicyService.evaluate({
          attemptNo,
          maxAttempts,
          error: normalizedError,
        });

        await this.queueRepository.updateTaskAttempt({
          taskId: item.task.id,
          attemptNo,
          retryCount: this.retryPolicyService.getRetryCountForAttempt(attemptNo),
          currentStep: stepType,
          lastErrorCode: normalizedError.code,
          lastErrorMessage: normalizedError.message,
        });

        await this.executionEventService.recordAttemptFailure({
          taskId: item.task.id,
          attemptNo,
          stepType,
          error: normalizedError,
          finalFailure: decision.finalFailure,
        });

        if (!decision.shouldRetry) {
          await this.queueRepository.markTaskFailed(
            item.task.id,
            normalizedError.code,
            normalizedError.message,
          );
          return "failed";
        }

        await this.executionEventService.recordAttemptRetryScheduled({
          taskId: item.task.id,
          attemptNo,
          nextAttemptNo: decision.nextAttemptNo,
          delayMs: decision.delayMs,
          error: normalizedError,
          stepType,
        });

        await new Promise((resolve) => {
          setTimeout(resolve, decision.delayMs);
        });
      }
    }

    return "failed";
  }

  getHealth(): QueueHealthSnapshot {
    return {
      activeTaskCount: this.activeTaskIds.size,
      maxConcurrency: this.maxConcurrency,
      queuedTaskCount: this.queuedTaskCount,
      queuedTaskCountByProvider: this.queuedTaskCountByProvider,
      lastScanLimit: this.lastScanLimit,
      lastCandidateCount: this.lastCandidateCount,
      lastProviderSkippedCount: this.lastProviderSkippedCount,
      lastClaimedCount: this.lastClaimedCount,
      lastProviderSlotSkippedTaskId: this.lastProviderSlotSkippedTaskId,
      lastProviderSlotSkippedTaskNo: this.lastProviderSlotSkippedTaskNo,
      lastProviderSlotSkippedProvider: this.lastProviderSlotSkippedProvider,
      lastProviderSlotSkippedAt: this.lastProviderSlotSkippedAt,
      lastDispatchKickScheduledAt: this.lastDispatchKickScheduledAt,
      lastProviderBackpressure: this.lastProviderBackpressure,
      providerConcurrency: this.providerConcurrencyService.getHealth(),
    };
  }

  private async recoverExpiredProcessingTasks(): Promise<void> {
    const recoveredCount = await this.queueRepository.recoverExpiredProcessingTasks({
      workerId: this.workerId,
      limit: this.recoveryScanLimit,
    });

    if (recoveredCount > 0) {
      this.logger.warn("Queue recovered expired processing tasks", {
        workerId: this.workerId,
        recoveredCount,
      });
      await this.refreshQueuedTaskStats();
    }
  }

  private startLeaseHeartbeat(taskId: string): { stop: () => void } {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    const beat = async () => {
      if (stopped) {
        return;
      }

      try {
        const ok = await this.queueRepository.heartbeatTaskLease({
          taskId,
          workerId: this.workerId,
          leaseMs: this.taskLeaseMs,
        });

        if (!ok) {
          this.logger.warn("Queue task lease heartbeat was not accepted", {
            taskId,
            workerId: this.workerId,
          });
        }
      } catch (error) {
        this.logger.warn("Queue task lease heartbeat failed", {
          taskId,
          workerId: this.workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!stopped) {
          timer = setTimeout(() => {
            void beat();
          }, this.taskHeartbeatIntervalMs);
        }
      }
    };

    timer = setTimeout(() => {
      void beat();
    }, this.taskHeartbeatIntervalMs);

    return {
      stop: () => {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  private recordProviderSlotSkipped(candidate: QueueClaimedTask["task"]): void {
    const providerKey = this.providerConcurrencyService.getProviderKey(candidate);
    this.lastProviderSlotSkippedTaskId = candidate.id;
    this.lastProviderSlotSkippedTaskNo = candidate.taskNo;
    this.lastProviderSlotSkippedProvider = providerKey;
    this.lastProviderSlotSkippedAt = new Date().toISOString();

    this.logger.info("Queue skipped task because provider has no available slot", {
      taskId: candidate.id,
      taskNo: candidate.taskNo,
      provider: providerKey,
      providerConcurrency: this.providerConcurrencyService.getHealth().providers[providerKey] ?? null,
    });
  }

  private requestDispatchKick(): void {
    this.lastDispatchKickScheduledAt = new Date().toISOString();
    this.dispatchKickHandler?.();
  }

  private async refreshQueuedTaskStats(): Promise<void> {
    const queuedStats = await this.queueRepository.getQueuedTaskStats();
    this.queuedTaskCount = queuedStats.total;
    this.queuedTaskCountByProvider = queuedStats.byProvider;
  }

  private incrementQueuedTaskStats(providerKey: string): void {
    this.queuedTaskCount += 1;
    this.queuedTaskCountByProvider = {
      ...this.queuedTaskCountByProvider,
      [providerKey]: (this.queuedTaskCountByProvider[providerKey] ?? 0) + 1,
    };
  }
}
