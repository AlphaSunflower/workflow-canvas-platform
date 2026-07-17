import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORKFLOW_GROUP_NAME,
  DEFAULT_WORKFLOW_NAME,
  parseWindowsLikeName,
  resolveWindowsLikeName,
} from "./workflow-name-resolver.ts";

test("parseWindowsLikeName extracts base name and sequence suffix", () => {
  assert.deepEqual(parseWindowsLikeName("新建画布 (3)"), {
    normalizedName: "新建画布 (3)",
    baseName: "新建画布",
    sequenceNumber: 3,
    hasSequenceSuffix: true,
  });

  assert.deepEqual(parseWindowsLikeName(" 手动画布 "), {
    normalizedName: "手动画布",
    baseName: "手动画布",
    sequenceNumber: 1,
    hasSequenceSuffix: false,
  });
});

test("resolveWindowsLikeName reuses missing default workflow number in same container", () => {
  const resolved = resolveWindowsLikeName({
    desiredName: undefined,
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: ["新建画布", "新建画布 (3)"],
  });

  assert.equal(resolved.usedFallbackName, true);
  assert.equal(resolved.conflicted, true);
  assert.equal(resolved.resolvedName, "新建画布 (2)");
});

test("resolveWindowsLikeName isolates workflow containers", () => {
  const rootResolved = resolveWindowsLikeName({
    desiredName: "新建画布",
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: ["新建画布"],
  });
  const groupResolved = resolveWindowsLikeName({
    desiredName: "新建画布",
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: [],
  });

  assert.equal(rootResolved.resolvedName, "新建画布 (2)");
  assert.equal(groupResolved.resolvedName, "新建画布");
});

test("resolveWindowsLikeName resolves move conflict in target container", () => {
  const resolved = resolveWindowsLikeName({
    desiredName: "效果图",
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: ["效果图", "效果图 (2)"],
  });

  assert.equal(resolved.resolvedName, "效果图 (3)");
});

test("resolveWindowsLikeName resolves manual duplicate group names per account", () => {
  const resolved = resolveWindowsLikeName({
    desiredName: "项目组",
    fallbackBaseName: DEFAULT_WORKFLOW_GROUP_NAME,
    existingNames: ["项目组", "项目组 (3)"],
  });

  assert.equal(resolved.resolvedName, "项目组 (2)");
});

test("resolveWindowsLikeName keeps unique manual names unchanged", () => {
  const resolved = resolveWindowsLikeName({
    desiredName: "品牌方案",
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: ["新建画布", "新建画布 (2)"],
  });

  assert.equal(resolved.conflicted, false);
  assert.equal(resolved.resolvedName, "品牌方案");
});

test("resolveWindowsLikeName increments explicit numbered rename when exact name already exists", () => {
  const resolved = resolveWindowsLikeName({
    desiredName: "方案 (2)",
    fallbackBaseName: DEFAULT_WORKFLOW_NAME,
    existingNames: ["方案", "方案 (2)", "方案 (3)"],
  });

  assert.equal(resolved.resolvedName, "方案 (4)");
});
