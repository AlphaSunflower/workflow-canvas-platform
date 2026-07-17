import assert from "node:assert/strict";

import type { QueuePollResult } from "../worker/src/modules/queue/queue.types.ts";
import { ExecutionRunService } from "../worker/src/modules/execution-run/execution-run.service.ts";
import { QueueService } from "../worker/src/modules/queue/queue.service.ts";

class QueueServiceStub {
  private readonly results: QueuePollResult[];
  private readonly delaysMs: number[];
  private readonly kickHandlers: Array<(() => void) | null> = [];
  private dispatchKickHandler: (() => void) | null = null;
  public pollCalls = 0;

  constructor(results: QueuePollResult[], delaysMs?: number[]) {
    this.results = results;
    this.delaysMs = delaysMs ?? results.map(() => 0);
  }

  setDispatchKickHandler(handler: (() => void) | null): void {
    this.dispatchKickHandler = handler;
    this.kickHandlers.push(handler);
  }

  async dispatchOnce(): Promise<QueuePollResult> {
    const index = this.pollCalls;
    this.pollCalls += 1;

    const delayMs = this.delaysMs[index] ?? 0;

    if (delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }

    return this.results[index] ?? {
      claimedTasks: [],
      claimedCount: 0,
    };
  }

  emitKick(): void {
    this.dispatchKickHandler?.();
  }

  getRegisteredKickHandlers(): Array<(() => void) | null> {
    return this.kickHandlers;
  }
}

async function runKickDuringPollingScenario(): Promise<void> {
  const queueService = new QueueServiceStub(
    [
      { claimedTasks: [], claimedCount: 1 },
      { claimedTasks: [], claimedCount: 2 },
    ],
    [30, 0],
  );
  const executionRunService = new ExecutionRunService(
    queueService as unknown as QueueService,
    5_000,
  );

  const firstPollPromise = executionRunService.pollOnce();

  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });

  const queuedPollResult = await executionRunService.requestPoll();

  assert.equal(queuedPollResult.claimedCount, 0);
  assert.equal(executionRunService.getHealth().pendingPoll, true);

  const firstPollResult = await firstPollPromise;

  assert.equal(firstPollResult.claimedCount, 1);

  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

  const health = executionRunService.getHealth();

  assert.equal(queueService.pollCalls, 2);
  assert.equal(health.pendingPoll, false);
  assert.equal(health.lastPollClaimedCount, 2);
  assert.ok(health.lastKickAt);
}

async function runKickAfterTaskReleaseScenario(): Promise<void> {
  const queueService = new QueueServiceStub([
    { claimedTasks: [], claimedCount: 0 },
    { claimedTasks: [], claimedCount: 1 },
  ]);
  const executionRunService = new ExecutionRunService(
    queueService as unknown as QueueService,
    5_000,
  );

  await executionRunService.start();
  queueService.emitKick();

  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

  assert.equal(queueService.pollCalls >= 2, true);
  assert.equal(executionRunService.getHealth().lastPollClaimedCount, 1);
  assert.ok(executionRunService.getHealth().lastKickAt);

  await executionRunService.stop();
}

async function runStopDisablesKickScenario(): Promise<void> {
  const queueService = new QueueServiceStub([
    { claimedTasks: [], claimedCount: 0 },
  ]);
  const executionRunService = new ExecutionRunService(
    queueService as unknown as QueueService,
    5_000,
  );

  await executionRunService.start();
  await executionRunService.stop();
  const callsBeforeKick = queueService.pollCalls;

  queueService.emitKick();

  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

  assert.equal(queueService.pollCalls, callsBeforeKick);
  assert.deepEqual(queueService.getRegisteredKickHandlers().at(-1), null);
}

async function run(): Promise<void> {
  await runKickDuringPollingScenario();
  await runKickAfterTaskReleaseScenario();
  await runStopDisablesKickScenario();
}

void run();
