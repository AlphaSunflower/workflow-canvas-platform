import assert from "node:assert/strict";

import type { ExecutionTaskRecord } from "../api/src/modules/executions/executions.repository.ts";
import { ProviderConcurrencyService } from "../worker/src/modules/queue/provider-concurrency.service.ts";
import { createExecutionTaskRecord } from "./helpers/execution-store.fixture.ts";

function createTask(input: {
  id: string;
  nodeType: string;
  taskType: ExecutionTaskRecord["taskType"];
  provider: string | null;
}): ExecutionTaskRecord {
  return createExecutionTaskRecord({
    id: input.id,
    nodeType: input.nodeType,
    taskType: input.taskType,
    provider: input.provider,
  });
}

async function runRunningHubConcurrencyScenario(): Promise<void> {
  const service = new ProviderConcurrencyService({
    maxConcurrencyByProvider: {
      runninghub: 3,
    },
  });

  const tasks = [
    createTask({
      id: "1",
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      provider: "runninghub",
    }),
    createTask({
      id: "2",
      nodeType: "aiMultiViewRestore",
      taskType: "multi-view-restore",
      provider: "runninghub",
    }),
    createTask({
      id: "3",
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      provider: "runninghub",
    }),
    createTask({
      id: "4",
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      provider: "runninghub",
    }),
  ];

  const slots = tasks.slice(0, 3).map((task) => service.acquire(task));

  assert.ok(slots.every(Boolean));
  assert.equal(service.canDispatch(tasks[3]!), false);
  assert.equal(service.acquire(tasks[3]!), null);
  assert.equal(service.getHealth().providers.runninghub?.active, 3);
  assert.equal(service.getHealth().providers.runninghub?.max, 3);
  assert.equal(service.getHealth().providers.runninghub?.available, 0);

  service.release(slots[0]!);

  assert.equal(service.canDispatch(tasks[3]!), true);
  assert.ok(service.acquire(tasks[3]!));
  assert.equal(service.getHealth().providers.runninghub?.active, 3);
  assert.equal(service.getHealth().providers.runninghub?.available, 0);
}

async function runNonRunningHubScenario(): Promise<void> {
  const service = new ProviderConcurrencyService({
    maxConcurrencyByProvider: {
      runninghub: 3,
    },
  });

  const task = createTask({
    id: "floorplan-1",
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    provider: null,
  });

  const slots = Array.from({ length: 5 }, () => service.acquire(task));

  assert.ok(slots.every(Boolean));
  assert.equal(service.getProviderKey(task), "floorplan-colorize");
  assert.equal(service.getHealth().providers["floorplan-colorize"]?.max, null);
  assert.equal(service.getHealth().providers["floorplan-colorize"]?.active, 5);
  assert.equal(service.getHealth().providers["floorplan-colorize"]?.available, null);
}

async function runLaozhangVeoUnlimitedScenario(): Promise<void> {
  const service = new ProviderConcurrencyService({
    maxConcurrencyByProvider: {
      runninghub: 3,
      "laozhang-veo": null,
    },
  });

  const tasks = Array.from({ length: 5 }, (_, index) => createTask({
    id: `video-unlimited-${index + 1}`,
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    provider: "laozhang-veo",
  }));

  const slots = tasks.map((task) => service.acquire(task));
  const nextTask = createTask({
    id: "video-unlimited-next",
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    provider: "laozhang-veo",
  });
  const providerPriorityTask = createTask({
    id: "video-provider-priority",
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    provider: "laozhang-veo",
  });

  assert.ok(slots.every(Boolean));
  assert.equal(service.getProviderKey(providerPriorityTask), "laozhang-veo");
  assert.equal(service.canDispatch(nextTask), true);
  assert.ok(service.acquire(nextTask));
  assert.equal(service.getHealth().providers["laozhang-veo"]?.active, 6);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.max, null);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.available, null);
}

async function runLaozhangVeoLimitedScenario(): Promise<void> {
  const service = new ProviderConcurrencyService({
    maxConcurrencyByProvider: {
      runninghub: 3,
      "laozhang-veo": 2,
    },
  });

  const tasks = Array.from({ length: 3 }, (_, index) => createTask({
    id: `video-limited-${index + 1}`,
    nodeType: "aiVideoGen",
    taskType: "video-gen",
    provider: "laozhang-veo",
  }));

  const first = service.acquire(tasks[0]!);
  const second = service.acquire(tasks[1]!);

  assert.ok(first);
  assert.ok(second);
  assert.equal(service.canDispatch(tasks[2]!), false);
  assert.equal(service.acquire(tasks[2]!), null);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.active, 2);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.max, 2);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.available, 0);

  service.release(first);

  assert.equal(service.canDispatch(tasks[2]!), true);
  assert.ok(service.acquire(tasks[2]!));
  assert.equal(service.getHealth().providers["laozhang-veo"]?.active, 2);
  assert.equal(service.getHealth().providers["laozhang-veo"]?.available, 0);
}

async function run(): Promise<void> {
  await runRunningHubConcurrencyScenario();
  await runNonRunningHubScenario();
  await runLaozhangVeoUnlimitedScenario();
  await runLaozhangVeoLimitedScenario();
}

void run();
