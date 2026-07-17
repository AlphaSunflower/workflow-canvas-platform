# AI Image Inpaint Editor Regression Checklist

## Automated Checks

- `npm.cmd run typecheck`
- `TEST_FILE=inpaint-layout.spec.js npm.cmd test`
- `TEST_FILE=InpaintCanvasEditor.spec.js npm.cmd test`
- `TEST_FILE=mask-export.spec.js npm.cmd test`
- `TEST_FILE=mask-strokes.spec.js npm.cmd test`
- `TEST_FILE=ai-image-inpaint.adapter.spec.js npm.cmd test`
- `TEST_FILE=workflow-validators.test.mjs npm.cmd test`
- `TEST_FILE=task-runtime.test.mjs npm.cmd test`

## Preview And Floating Layout

- Create an `aiImageInpaint` node and confirm the editor appears above the node body as a floating window with a small gap.
- Move the node and confirm the floating editor remains fixed relative to the node.
- Confirm the node body only contains the title, prompt, parameters, run controls, and footer.
- Resize the node body and confirm prompt, parameters, handles, and footer remain usable.
- Resize the floating editor independently and confirm only the editor height changes.
- Pan and zoom the React Flow canvas and confirm the floating editor is not clipped.

## Source Image And Cursor

- Drag one image node into the floating editor and confirm the editor shows the original image, not a blurry thumbnail.
- Verify local imported images, backend images, and AI output images can load as the source image.
- Move the pointer over the displayed image area and confirm the circular brush cursor appears.
- Move the pointer over letterboxed blank space and confirm the brush cursor hides or becomes inactive.
- Change brush size and confirm the visible cursor size and painted stroke width change together.

## Mask Editing Persistence

- Draw several brush marks and confirm the semi-transparent red preview appears.
- On a 2K source image, hold the brush down and draw continuous zig-zag strokes for at least 30 seconds; confirm there is no obvious pointer lag, editor freeze, or delayed mask catch-up.
- On a 4K source image, repeat continuous brush drawing for at least 30 seconds; confirm the editor remains responsive and the stroke remains continuous.
- On the same 4K source image, switch to eraser and erase continuously for at least 30 seconds; confirm the erased trail follows the pointer without obvious stutter.
- On a 2K source image, draw at least 100 short strokes with repeated pointer down/up; confirm releasing the pointer does not freeze the editor or the overall canvas.
- On a 4K source image, draw at least 100 short strokes with repeated pointer down/up; confirm node dragging, canvas panning, and zooming remain responsive after the sequence.
- Alternate 50 short brush strokes and 50 short eraser strokes; confirm the editor does not replay or flicker the full mask after each release.
- While drawing or erasing, pan the React Flow canvas with the other hand/input device if available; confirm the whole canvas does not stutter or pause.
- While drawing quickly, confirm the final stroke includes the release endpoint and does not drop the tail segment.
- Drag the canvas, move the node, and zoom the canvas; confirm marks stay visible.
- Save and reload the workflow; confirm marks are restored for the same source image and dimensions.
- Switch to eraser, erase part of the marks, and confirm only the erased area is removed.
- Clear all marks and confirm execution is blocked with a clear no-mark message.
- Replace the source image or source dimensions and confirm old marks are cleared.
- Remove the source image and confirm execution is blocked with a clear no-source message.
- After clearing marks, save and reload the workflow; confirm the editor remains empty.

## Execution Modes

- Run with `original-markup` and confirm the uploaded mask image is the original image with opaque red marks.
- Run with `strong-mask` and confirm the uploaded mask image is black background with white marked areas.
- After the 2K/4K pressure test, run both mask modes and confirm the uploaded mask still matches the visible final marks.
- After the repeated short-stroke pressure test, run both mask modes and confirm the uploaded mask still matches the visible final marks.
- Confirm the request contains `nodeType=aiImageInpaint`, `taskType=image-inpaint`, `sourceFileId`, `maskFileId`, and `maskMode`.
- Confirm successful execution creates a new output image node and does not overwrite the original image node.
- Confirm mask export failure, source registration failure, and mask registration failure show readable errors.

## Existing Image Node Regression

- Run an `aiImageGen` node and verify output commit still creates image output nodes.
- Run an `aiImageHd` node with one image input and verify grouped input/output handles still work.
- Run an `aiFloorplanColorize` node with one floorplan image and verify grouped input/output handles still work.
- Verify task history still shows generated outputs for the existing image nodes.
