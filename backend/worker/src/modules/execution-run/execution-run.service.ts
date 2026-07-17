import { createLogger } from "@newworkflow/backend-shared";
import type { QueuePollResult } from "../queue/queue.types.ts";
import { QueueService } from "../queue/queue.service.ts";

export interface ExecutionRunServiceHealth {
  status: "idle" | "running" | "stopped";
  isPolling: boolean;
  pendingPoll: boolean;
  lastPollAt: string | null;
  lastPollFinishedAt: string | null;
  lastPollClaimedCount: number;
  lastKickAt: string | null;
  lastErrorMessage: string | null;
}

export class ExecutionRunService {
  private readonly logger = createLogger("worker-execution-run");
  private readonly queueService: QueueService;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pendingPoll = false;
  private lastPollAt: string | null = null;
  private lastPollFinishedAt: string | null = null;
  private lastPollClaimedCount = 0;
  private lastKickAt: string | null = null;
  private lastErrorMessage: string | null = null;
  private status: "idle" | "running" | "stopped" = "idle";

  constructor(queueService: QueueService, pollIntervalMs: number) {
    this.queueService = queueService;
    this.pollIntervalMs = pollIntervalMs;
    this.queueService.setDispatchKickHandler(() => {
      this.requestPoll();
    });
  }

  async start(): Promise<void> {
    if (this.timer) {
      return;
    }

    this.status = "running";
    await this.requestPoll();
    this.timer = setInterval(() => {
      void this.requestPoll();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.queueService.setDispatchKickHandler(null);

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.status = "stopped";
    this.pendingPoll = false;

    while (this.isPolling) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }

  async requestPoll(): Promise<QueuePollResult> {
    if (this.status === "stopped") {
      return {
        claimedTasks: [],
        claimedCount: 0,
      };
    }

    this.lastKickAt = new Date().toISOString();

    if (this.isPolling) {
      this.pendingPoll = true;
      this.logger.debug("Queue poll requested while previous poll is still running");
      return {
        claimedTasks: [],
        claimedCount: 0,
      };
    }

    return this.pollOnce();
  }

  async pollOnce(): Promise<QueuePollResult> {
    if (this.status === "stopped") {
      return {
        claimedTasks: [],
        claimedCount: 0,
      };
    }

    this.isPolling = true;
    this.pendingPoll = false;
    this.lastPollAt = new Date().toISOString();

    try {
      const result = await this.queueService.dispatchOnce();
      this.lastPollClaimedCount = result.claimedCount;
      this.lastErrorMessage = null;
      this.lastPollFinishedAt = new Date().toISOString();

      if (result.claimedCount > 0) {
        this.logger.info("Execution run poll completed", {
          claimedCount: result.claimedCount,
          taskIds: result.claimedTasks.map((item) => item.task.id),
        });
      } else {
        this.logger.debug("Execution run poll completed with no claimed tasks");
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      this.lastErrorMessage = message;
      this.lastPollFinishedAt = new Date().toISOString();

      this.logger.error("Execution run poll failed", {
        error: message,
      });

      throw error;
    } finally {
      this.isPolling = false;
      const currentStatus = this.status;

      if (this.pendingPoll && (currentStatus === "running" || currentStatus === "idle")) {
        this.pendingPoll = false;
        queueMicrotask(() => {
          void this.pollOnce();
        });
      }
    }
  }

  getHealth(): ExecutionRunServiceHealth {
    return {
      status: this.status,
      isPolling: this.isPolling,
      pendingPoll: this.pendingPoll,
      lastPollAt: this.lastPollAt,
      lastPollFinishedAt: this.lastPollFinishedAt,
      lastPollClaimedCount: this.lastPollClaimedCount,
      lastKickAt: this.lastKickAt,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}
