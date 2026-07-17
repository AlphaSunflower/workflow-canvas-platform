import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowNodeSanitizer } from "./workflow-node-sanitizer.ts";

test("WorkflowNodeSanitizer removes local-only file state and unsafe urls", () => {
  const sanitizer = new WorkflowNodeSanitizer();

  const result = sanitizer.sanitize({
    "node-1": {
      file: { local: true },
      localFile: { id: "local" },
      objectUrl: "blob:abc",
      localState: { previewing: true },
      previewUrl: " data:image/png;base64,aaa ",
      thumbnailUrl: "https://cdn.example.test/thumb.png",
      imageAsset: { stale: true },
      keep: "value",
    },
  });

  assert.deepEqual(result, {
    "node-1": {
      thumbnailUrl: "https://cdn.example.test/thumb.png",
      keep: "value",
    },
  });
});
