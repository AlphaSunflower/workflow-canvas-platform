import assert from "node:assert/strict";

import { parseRunningHubCreateTaskResponse } from "../worker/src/modules/providers/runninghub/runninghub.parser.ts";

function buildCreateResponse(promptTips: string): string {
  return JSON.stringify({
    code: 0,
    msg: "success",
    data: {
      netWssUrl: null,
      taskId: "1910246754753896450",
      clientId: "e825290b08ca2015b8f62f0bbdb5f5f6",
      taskStatus: "QUEUED",
      promptTips,
    },
  });
}

async function run(): Promise<void> {
  const success = parseRunningHubCreateTaskResponse({
    responseText: buildCreateResponse(
      "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}",
    ),
    snapshotPath: "snapshot-success.json",
  });

  assert.equal(success.taskId, "1910246754753896450");
  assert.equal(success.clientId, "e825290b08ca2015b8f62f0bbdb5f5f6");
  assert.equal(success.taskStatus, "QUEUED");
  assert.equal(success.promptTipsSummary?.parseStatus, "parsed");
  assert.equal(success.promptTipsSummary?.result, true);
  assert.deepEqual(success.promptTipsSummary?.outputsToExecute, ["9"]);
  assert.equal(success.promptTipsSummary?.rawText, "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}");

  const invalidJson = parseRunningHubCreateTaskResponse({
    responseText: buildCreateResponse("not-json-prompt-tips"),
    snapshotPath: "snapshot-invalid-json.json",
  });

  assert.equal(invalidJson.promptTips, "not-json-prompt-tips");
  assert.equal(invalidJson.promptTipsSummary?.parseStatus, "invalid_json");
  assert.equal(invalidJson.promptTipsSummary?.rawText, "not-json-prompt-tips");

  assert.throws(
    () =>
      parseRunningHubCreateTaskResponse({
        responseText: buildCreateResponse(
          "{\"result\": false, \"error\": null, \"outputs_to_execute\": [], \"node_errors\": {}}",
        ),
        snapshotPath: "snapshot-result-false.json",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "PROVIDER_ERROR"
        && (error as { providerCode?: string }).providerCode === "PROMPT_TIPS_RESULT_FALSE",
      ),
  );

  assert.throws(
    () =>
      parseRunningHubCreateTaskResponse({
        responseText: buildCreateResponse(
          "{\"result\": true, \"error\": \"workflow broken\", \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}",
        ),
        snapshotPath: "snapshot-error.json",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "PROVIDER_ERROR"
        && (error as { providerCode?: string }).providerCode === "PROMPT_TIPS_ERROR",
      ),
  );

  assert.throws(
    () =>
      parseRunningHubCreateTaskResponse({
        responseText: buildCreateResponse(
          "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {\"9\": {\"errors\": [\"missing input\"]}}}",
        ),
        snapshotPath: "snapshot-node-errors.json",
      }),
    (error: unknown) =>
      Boolean(
        error
        && typeof error === "object"
        && (error as { code?: string }).code === "PROVIDER_ERROR"
        && (error as { providerCode?: string }).providerCode === "PROMPT_TIPS_NODE_ERRORS",
      ),
  );
}

void run();
