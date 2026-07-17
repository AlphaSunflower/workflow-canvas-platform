import {
  type RequeueTaskInput,
  type ExecutionsRepository,
} from "../../../../api/src/modules/executions/executions.repository.types.ts";
import {
  type ExecutionTaskRecord,
  type QueueClaimResult,
  type QueuedTaskStats,
} from "../../../../api/src/modules/executions/executions.repository.ts";
import type { ExecutionStepType } from "@newworkflow/backend-shared";

export class QueueRepository {
  private readonly executionsRepository: ExecutionsRepository;

  constructor(executionsRepository: ExecutionsRepository) {
    this.executionsRepository = executionsRepository;
  }

  async claimQueuedTasks(limit: number): Promise<QueueClaimResult[]> {
    return this.executionsRepository.claimQueuedTasks(limit);
  }

  async listQueuedTasks(limit: number): Promise<ExecutionTaskRecord[]> {
    return this.executionsRepository.listQueuedTasks(limit);
  }

  async getQueuedTaskStats(): Promise<QueuedTaskStats> {
    return this.executionsRepository.getQueuedTaskStats();
  }

  async claimQueuedTaskById(
    taskId: string,
    options?: { workerId?: string; leaseMs?: number },
  ): Promise<QueueClaimResult | null> {
    return this.executionsRepository.claimQueuedTaskById(taskId, options);
  }

  async markTaskCompleted(taskId: string): Promise<void> {
    await this.executionsRepository.markTaskCompleted(taskId);
  }

  async markTaskFailed(
    taskId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.executionsRepository.markTaskFailed(taskId, errorCode, errorMessage);
  }

  async requeueTask(input: RequeueTaskInput): Promise<void> {
    await this.executionsRepository.requeueTask(input);
  }

  async updateTaskAttempt(input: {
    taskId: string;
    attemptNo: number;
    retryCount: number;
    currentStep: ExecutionStepType | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  }): Promise<void> {
    await this.executionsRepository.updateTaskAttempt(input);
  }

  async getTaskById(taskId: string): Promise<ExecutionTaskRecord | null> {
    return this.executionsRepository.getTaskById(taskId);
  }

  async heartbeatTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean> {
    return this.executionsRepository.heartbeatTaskLease?.(input) ?? true;
  }

  async recoverExpiredProcessingTasks(input: {
    workerId: string;
    limit: number;
  }): Promise<number> {
    return this.executionsRepository.recoverExpiredProcessingTasks?.(input) ?? 0;
  }
}
