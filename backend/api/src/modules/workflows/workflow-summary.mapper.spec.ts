import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowSummaryMapper } from "./workflow-summary.mapper.ts";

test("WorkflowSummaryMapper applies group workflow counts and excludes null groups", () => {
  const mapper = new WorkflowSummaryMapper();

  const groups = [
    {
      groupId: "group-a",
      ownerUserId: "user-1",
      name: "Group A",
      workflowCount: 0,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      groupId: "group-b",
      ownerUserId: "user-1",
      name: "Group B",
      workflowCount: 0,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
  const items = [
    {
      workflowId: "wf-1",
      projectId: "p-1",
      ownerUserId: "user-1",
      name: "Canvas 1",
      groupId: "group-a",
      containerKey: "group-a",
      isAutoNamed: false,
      nodeCount: 0,
      connectionCount: 0,
      timestamp: 1,
      version: 1,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      workflowId: "wf-2",
      projectId: "p-1",
      ownerUserId: "user-1",
      name: "Canvas 2",
      groupId: "group-a",
      containerKey: "group-a",
      isAutoNamed: false,
      nodeCount: 0,
      connectionCount: 0,
      timestamp: 1,
      version: 1,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      workflowId: "wf-3",
      projectId: "p-1",
      ownerUserId: "user-1",
      name: "Canvas 3",
      groupId: null,
      containerKey: "__ungrouped__",
      isAutoNamed: false,
      nodeCount: 0,
      connectionCount: 0,
      timestamp: 1,
      version: 1,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ];

  const result = mapper.applyGroupWorkflowCounts(groups, items);

  assert.deepEqual(
    result.map((group) => ({ id: group.groupId, count: group.workflowCount })),
    [
      { id: "group-a", count: 2 },
      { id: "group-b", count: 0 },
    ],
  );
});

