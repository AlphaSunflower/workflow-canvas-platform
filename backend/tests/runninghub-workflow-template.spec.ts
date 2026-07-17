import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
  AI_IMAGE_TO_PLY_INPUT_NODE_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import { RunningHubWorkflowTemplateService } from "../worker/src/modules/providers/runninghub/runninghub-workflow-template.service.ts";

async function writeTemplate(rootDir: string, fileName: string, content: unknown): Promise<void> {
  const runninghubDir = path.join(rootDir, "runninghub");
  await fs.mkdir(runninghubDir, { recursive: true });
  await fs.writeFile(
    path.join(runninghubDir, fileName),
    JSON.stringify(content, null, 2),
    "utf8",
  );
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-template-test-"));
  const snapshotDir = path.join(rootDir, "snapshots");

  try {
    await writeTemplate(rootDir, "sharp_api.json", {
      "1": {
        inputs: {
          image: "placeholder.png",
        },
        class_type: "LoadImage",
      },
      "5": {
        inputs: {
          image: ["1", 0],
        },
        class_type: "SharpPredict",
      },
    });

    const service = new RunningHubWorkflowTemplateService({
      backendRoot: rootDir,
      snapshotDir,
    });

    const template = await service.loadTemplate();
    assert.equal(template.descriptor.templateKey, AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY);
    assert.equal(template.descriptor.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
    assert.ok(template.document["1"]);
    assert.ok(template.document["5"]);

    const buildResult = await service.buildNodeInfoList({
      uploadedFileName: "uploaded-image-name.png",
      snapshotLabel: "template-case",
    });

    assert.equal(buildResult.templateKey, AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY);
    assert.equal(buildResult.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
    assert.deepEqual(buildResult.nodeInfoList, [
      {
        nodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
        fieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
        fieldValue: "uploaded-image-name.png",
      },
    ]);
    assert.ok(buildResult.snapshotPath.endsWith(".json"));

    const snapshotRaw = await fs.readFile(buildResult.snapshotPath, "utf8");
    const snapshot = JSON.parse(snapshotRaw) as {
      provider: string;
      templateKey: string;
      workflowId: string;
      nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
    };

    assert.equal(snapshot.provider, "runninghub");
    assert.equal(snapshot.templateKey, AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY);
    assert.equal(snapshot.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
    assert.deepEqual(snapshot.nodeInfoList, buildResult.nodeInfoList);

    await assert.rejects(
      () =>
        service.buildNodeInfoList({
          uploadedFileName: "   ",
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    const missingNodeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-template-missing-node-"));
    await writeTemplate(missingNodeRoot, "sharp_api.json", {
      "2": {
        inputs: {
          image: "placeholder.png",
        },
      },
    });

    const missingNodeService = new RunningHubWorkflowTemplateService({
      backendRoot: missingNodeRoot,
      snapshotDir: path.join(missingNodeRoot, "snapshots"),
    });

    await assert.rejects(
      () => missingNodeService.loadTemplate(),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    const missingFieldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-template-missing-field-"));
    await writeTemplate(missingFieldRoot, "sharp_api.json", {
      "1": {
        inputs: {
          file: "placeholder.png",
        },
      },
    });

    const missingFieldService = new RunningHubWorkflowTemplateService({
      backendRoot: missingFieldRoot,
      snapshotDir: path.join(missingFieldRoot, "snapshots"),
    });

    await assert.rejects(
      () => missingFieldService.loadTemplate(),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    const missingTemplateService = new RunningHubWorkflowTemplateService({
      backendRoot: rootDir,
      snapshotDir,
    });

    await assert.rejects(
      () =>
        missingTemplateService.loadTemplate("missing-template-key"),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    const multiViewRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-template-multi-view-"));
    await writeTemplate(multiViewRoot, "multi-view-restore_api.json", {
      "102": {
        inputs: {
          image: "reference.png",
        },
      },
      "124": {
        inputs: {
          image: "render.png",
        },
      },
      "127": {
        inputs: {
          images: ["109", 0],
        },
      },
    });

    const multiViewService = new RunningHubWorkflowTemplateService({
      backendRoot: multiViewRoot,
      snapshotDir: path.join(multiViewRoot, "snapshots"),
      descriptors: [
        {
          templateKey: "multi-view-restore-v1",
          workflowId: "2014516111097729025",
          fileName: "multi-view-restore_api.json",
          inputBindings: [
            {
              inputKey: "render",
              nodeId: "124",
              fieldName: "image",
            },
            {
              inputKey: "reference",
              nodeId: "102",
              fieldName: "image",
            },
          ],
          outputNodeIds: ["127"],
        },
      ],
    });

    const multiViewTemplate = await multiViewService.loadTemplate("multi-view-restore-v1");
    assert.equal(multiViewTemplate.descriptor.templateKey, "multi-view-restore-v1");
    assert.equal(multiViewTemplate.descriptor.inputBindings.length, 2);
    assert.deepEqual(multiViewTemplate.descriptor.outputNodeIds, ["127"]);

    const multiViewBuildResult = await multiViewService.buildNodeInfoList({
      templateKey: "multi-view-restore-v1",
      uploadedFileNames: {
        render: "render-uploaded.png",
        reference: "reference-uploaded.png",
      },
      snapshotLabel: "multi-view-case",
    });

    assert.deepEqual(multiViewBuildResult.nodeInfoList, [
      {
        nodeId: "124",
        fieldName: "image",
        fieldValue: "render-uploaded.png",
      },
      {
        nodeId: "102",
        fieldName: "image",
        fieldValue: "reference-uploaded.png",
      },
    ]);

    await assert.rejects(
      () =>
        multiViewService.buildNodeInfoList({
          templateKey: "multi-view-restore-v1",
          uploadedFileNames: {
            render: "render-uploaded.png",
          },
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    const missingOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runninghub-template-missing-output-"));
    await writeTemplate(missingOutputRoot, "multi-view-restore_api.json", {
      "102": {
        inputs: {
          image: "reference.png",
        },
      },
      "124": {
        inputs: {
          image: "render.png",
        },
      },
    });

    const missingOutputService = new RunningHubWorkflowTemplateService({
      backendRoot: missingOutputRoot,
      snapshotDir: path.join(missingOutputRoot, "snapshots"),
      descriptors: [
        {
          templateKey: "multi-view-restore-v1",
          workflowId: "2014516111097729025",
          fileName: "multi-view-restore_api.json",
          inputBindings: [
            {
              inputKey: "render",
              nodeId: "124",
              fieldName: "image",
            },
            {
              inputKey: "reference",
              nodeId: "102",
              fieldName: "image",
            },
          ],
          outputNodeIds: ["127"],
        },
      ],
    });

    await assert.rejects(
      () => missingOutputService.loadTemplate("multi-view-restore-v1"),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "VALIDATION_ERROR",
        ),
    );

    await fs.rm(missingNodeRoot, { recursive: true, force: true });
    await fs.rm(missingFieldRoot, { recursive: true, force: true });
    await fs.rm(multiViewRoot, { recursive: true, force: true });
    await fs.rm(missingOutputRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
