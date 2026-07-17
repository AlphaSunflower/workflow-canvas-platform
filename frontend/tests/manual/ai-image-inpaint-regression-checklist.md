# AI Image Inpaint Regression Checklist

## Automated Checks

- Frontend: run `npm.cmd run typecheck`.
- Frontend targeted tests:
  - `TEST_FILE=workflow-validators.test.mjs npm.cmd test`
  - `TEST_FILE=task-runtime.test.mjs npm.cmd test`
  - `TEST_FILE=ai-image-inpaint.adapter.spec.js npm.cmd test`
  - `TEST_FILE=mask-export.spec.js npm.cmd test`
- Backend: run `npm.cmd run typecheck`.
- Backend targeted tests:
  - `BACKEND_TEST_FILE=ai-image-inpaint.create.spec.ts npm.cmd test`
  - `BACKEND_TEST_FILE=ai-image-inpaint.executor.spec.ts npm.cmd test`
- Existing image-node regression tests:
  - `BACKEND_TEST_FILE=ai-image-gen.create.spec.ts npm.cmd test`
  - `BACKEND_TEST_FILE=ai-image-hd.create.spec.ts npm.cmd test`
  - `BACKEND_TEST_FILE=ai-floorplan-colorize.create.spec.ts npm.cmd test`

## Manual E2E Flow

- Create an `aiImageInpaint` node from the canvas menu.
- Drag one image node into the inpaint node.
- Drag a second image into the same inpaint node and verify it replaces the first source image instead of creating another input group.
- Enter a non-empty prompt.
- Verify running is blocked before any painted mark exists.
- Paint over part of the image and verify the preview mark is semi-transparent red.
- Use eraser, brush size, and clear actions; verify the mark layer updates without moving or editing the original image node.
- Select `original-markup` mode and run.
- Verify the frontend uploads a PNG named like `inpaint-mask-{nodeId}.png` and the request contains `nodeType=aiImageInpaint`, `taskType=image-inpaint`, `sourceFileId`, `maskFileId`, and `maskMode=original-markup`.
- Verify the worker sends exactly two provider images: the original image and the original image with opaque painted markup.
- Select `strong-mask` mode, repaint, and run again.
- Verify the worker sends exactly two provider images: the original image and a black/white mask image.
- Verify neither mode sends a native provider `mask` parameter.
- Verify success creates a new image node connected from `main:result`.
- Verify the source image node is unchanged.

## History And Failure Checks

- Open task history after a successful run.
- Verify the detail view distinguishes source image, mark/mask image, and inpaint result image.
- Verify `maskMode` is visible in the task detail.
- Force one failure, for example with an invalid backend file id in a test build, and verify the UI shows a readable reason instead of only an unknown error.

## Existing Image Node Regression

- Run `aiImageGen` with multiple reference images and verify grouped output still creates result image nodes.
- Run `aiImageHd` with one source image and verify the original source-only flow is unchanged.
- Run `aiFloorplanColorize` with a source image and style preset and verify `stylePreset`, `sourceFileId`, image size, and aspect ratio still reach the backend.
