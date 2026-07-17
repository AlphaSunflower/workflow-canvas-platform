# AI Image Nodes

## Scope

The LaoZhang-backed image-model routing rules are shared by these image nodes:

- `aiImageGen`
- `aiImageHd`
- `aiFloorplanColorize`
- `aiModelRenderTransfer`
- `aiStoryboard` image-shot execution path via `aiImageGen`

This document defines the shared image-model contract for those nodes.

Supported model paths:

- `gemini-3-pro-image-preview`
- `gpt-image-2-vip`
- `gpt-image-2-official`

Each group still produces exactly one output image.

## Node Shapes

Node execution contracts:

- `aiImageGen`
  - task type: `image-gen`
  - execution mode: `legacy-grouped-task`
  - provider: `laozhang`
  - group input: ordered `referenceFileIds`
  - group size: `1..5`
- `aiImageHd`
  - task type: `image-hd`
  - execution mode: `legacy-grouped-task`
  - provider: `laozhang`
  - group input: single `sourceFileId`
  - group size: exactly `1`
- `aiFloorplanColorize`
  - task type: `floorplan-colorize`
  - execution mode: `legacy-grouped-task`
  - provider: `laozhang`
  - group input: single `sourceFileId`
  - group size: exactly `1`
- `aiModelRenderTransfer`
  - task type: `model-render-transfer`
  - execution mode: `legacy-grouped-task`
  - provider: `laozhang`
  - group input: `whiteModelFileId + styleReferenceFileId`
- `aiStoryboard`
  - image-shot task type: `image-gen`
  - execution mode: `node-action-only`
  - reuses `aiImageGen` grouped request shape
  - group input: ordered `referenceFileIds`
  - group size: `1..5`

Input order must be preserved before provider dispatch. No implicit reordering is allowed.

## Frontend Parameter Contract

Frontend image nodes expose only simplified image-model parameters:

- `model`
- `imageSize`
- `aspectRatio`
- `quality` only when `model = gpt-image-2-official`

Additional node-specific inputs are still sent as file ids or ordered reference arrays.

Frontend request rules:

- send `model`
- send `imageSize`
- send `aspectRatio`
- send `quality` only for `gpt-image-2-official`
- send node-specific file ids or `referenceFileIds`
- do not send derived provider-specific `size`

This keeps provider-specific mapping logic centralized on the backend.

## Model Routing

### Gemini Path

Model:

- `gemini-3-pro-image-preview`

Backend provider payload behavior:

- keep `imageSize`
- keep `aspectRatio` when supported
- omit `aspectRatio` when the request uses `auto`

### GPT Image 2 Path

Model:

- `gpt-image-2-vip`

Backend execution rules:

1. Validate `imageSize`
2. Validate `aspectRatio`
3. Resolve backend-only final `size` from shared constants
4. Send only final `size` to the OpenAI-compatible image endpoint

For `gpt-image-2-vip`, `aspectRatio = auto` is invalid. Requests must use a concrete supported ratio.

### GPT Image 2 Official Path

Frontend/internal model:

- `gpt-image-2-official`

Provider route:

- `sora2official`

Provider model sent to LaoZhang Sora2Official:

- `gpt-image-2`

Backend execution rules:

1. Validate `quality` as one of `auto`, `low`, `medium`, `high`
2. Resolve `aspectRatio = auto` to provider `size = auto`
3. Resolve concrete aspect ratios with the same shared `imageSize + aspectRatio -> WIDTHxHEIGHT` mapping used by GPT Image 2
4. Send `quality` and resolved `size` to the OpenAI-compatible `/images/generations` endpoint
5. Store `providerRoute`, `providerModel`, `quality`, and `resolvedSize` in task input/query echo fields

Current scope:

- Text-to-image generation without reference images is supported.
- Reference image edit support is intentionally blocked until the Official `/images/edits` path is implemented.

## Shared Size Mapping

The only source of truth is:

- `backend/shared/src/constants/aiImageGen.ts`

Backend resolution API:

- `resolveAIImageGenOutputSize(model, imageSize, aspectRatio)`

Current GPT mapping examples:

- `1K + 1:1 -> 1280x1280`
- `1K + 16:9 -> 1280x720`
- `2K + 4:5 -> 1632x2048`
- `4K + 9:16 -> 2160x3840`

Official-specific behavior:

- `gpt-image-2-official + auto -> auto`
- `gpt-image-2-official + 16:9` uses the same concrete mapping as `gpt-image-2-vip`

The worker computes `resolvedSize` only on the backend. The frontend must never duplicate this mapping.

## Provider Dispatch

### Gemini Dispatch

Endpoint style:

- LaoZhang Gemini-compatible image generation JSON payload

Gemini request shape:

- prompt text
- ordered input images
- `imageSize`
- optional `aspectRatio`

### GPT Dispatch

Endpoint style:

- `POST {openaiApiBaseUrl}/images/edits`

Request transport:

- `multipart/form-data`

Request fields:

- `model`
- `prompt` when the node has a prompt
- `size`
- repeated `image[]`

The backend must not send:

- `imageSize`
- `aspectRatio`

to the external GPT endpoint.

### GPT Image 2 Official Dispatch

Endpoint style:

- `POST {providers.laozhang.sora2Official.apiBaseUrl}/images/generations`

Request transport:

- JSON

Request fields:

- `model = gpt-image-2`
- `prompt`
- `size = auto | WIDTHxHEIGHT`
- `quality = auto | low | medium | high`

Credential source:

- `providers.laozhang.sora2Official.apiKey`
- `LAOZHANG_SORA2OFFICIAL_API_KEY`

This route intentionally does not use `providers.laozhang.apiKey` or `providers.laozhang.openaiApiBaseUrl`.

## Worker Behavior

Relevant files:

- `backend/worker/src/modules/executors/ai-image-gen.executor.ts`
- `backend/worker/src/modules/executors/multi-image-generate.helper.ts`
- `backend/worker/src/modules/executors/ai-image-hd.executor.ts`
- `backend/worker/src/modules/executors/ai-floorplan-colorize.executor.ts`
- `backend/worker/src/modules/executors/white-model-render.executor.ts`
- `backend/worker/src/modules/executors/white-model-render-task.executor.ts`
- `backend/worker/src/modules/executors/single-image-generate.helper.ts`
- `backend/worker/src/modules/providers/laozhang/laozhang.client.ts`

Worker routing rules:

1. Read `task.input.model`
2. If missing, fall back to `task.model`
3. If model is GPT Image 2, resolve final `resolvedSize`
4. If model is GPT Image 2 Official, route through Sora2Official with `providerModel = gpt-image-2`, `quality`, and `resolvedSize`
5. If model is Gemini, continue using `imageSize + aspectRatio`
6. Emit `model`, `quality`, `providerRoute`, `providerModel`, and `resolvedSize` in step-start payloads when applicable

## Event Payload Rules

Step-start payloads must include:

- `model`
- `imageSize`
- `aspectRatio`
- `resolvedSize`

Additional prompt or file fields stay node-specific.

Field behavior:

- Gemini path: `resolvedSize = null`
- GPT Image 2 path: `resolvedSize = <final mapped size>`
- GPT Image 2 Official path: `resolvedSize = auto | <final mapped size>` and `quality` is included

## Query Echo Rules

Execution query responses must echo the real task model for all adapted image nodes.

Affected query surfaces:

- run detail
- task list
- task detail
- task events

Expected behavior:

- `task.model` reflects the real selected model
- GPT event payload shows `resolvedSize`
- GPT Image 2 Official task/query payloads show `quality`, `providerRoute = sora2official`, `providerModel = gpt-image-2`, and `resolvedSize`
- Gemini tasks continue to echo model without changing legacy execution semantics

## Response Parsing

### Gemini

Supported response shapes:

- `inlineData`
- `inline_data`

### GPT

Supported response shapes:

- `data[0].b64_json`
- `data[0].url`

If GPT returns `url`, the backend downloads the image bytes and stores the final asset before completing the task.

### GPT Image 2 Official

Supported response shapes are the same as GPT:

- `data[0].b64_json`
- `data[0].url`

If Official returns `url`, the backend downloads the image bytes and stores the final asset before completing the task.

## Validation Summary

Backend create-execution validation:

- valid model only
- valid `imageSize`
- valid `aspectRatio`
- GPT requires a supported concrete aspect ratio
- GPT Image 2 Official allows `aspectRatio = auto`
- GPT Image 2 Official validates `quality`
- GPT Image 2 Official allows an empty `referenceFileIds` group for text-to-image
- group input count and shape still follow each node's own limits

Worker execution validation:

- node-specific required prompt or file input must exist
- GPT must resolve a non-empty final `resolvedSize`
- GPT Image 2 Official with reference images fails with `GPT_IMAGE_2_OFFICIAL_IMAGE_EDIT_NOT_IMPLEMENTED`

## Regression Coverage

Backend focused coverage:

- `backend/tests/ai-image-gen.create.spec.ts`
- `backend/tests/ai-image-gen.executor.spec.ts`
- `backend/tests/ai-image-hd.create.spec.ts`
- `backend/tests/ai-image-hd.executor.spec.ts`
- `backend/tests/ai-floorplan-colorize.create.spec.ts`
- `backend/tests/ai-floorplan-colorize.executor.spec.ts`
- `backend/tests/white-model-render.create.spec.ts`
- `backend/tests/white-model-render.executor.spec.ts`
- `backend/tests/providers.laozhang.spec.ts`
- `backend/tests/executions.query.spec.ts`
- `backend/tests/executions.image-models.query.spec.ts`

Frontend focused coverage:

- `frontend/src/execution-runtime/adapters/ai-image-gen.adapter.spec.ts`
- `frontend/src/execution-runtime/adapters/white-model-render.adapter.spec.ts`
- `frontend/src/nodes/ai-image-gen/component.model.spec.tsx`
- `frontend/src/nodes/ai-image-hd/component.model.spec.tsx`
- `frontend/src/nodes/ai-image-hd/runtime.spec.ts`
- `frontend/src/nodes/ai-floorplan-colorize/component.spec.tsx`
- `frontend/src/nodes/ai-floorplan-colorize/runtime.spec.ts`
- `frontend/src/nodes/ai-model-render-transfer/component.model.spec.tsx`
- `frontend/src/nodes/ai-storyboard/storyboard-shot-image-runner.spec.ts`

## Non-Goals

Still out of scope:

- frontend-side `size` derivation
- multi-output images per group
- negative prompt
- user-managed provider keys
- provider-agnostic dynamic model plugin system
- `aiMultiViewRestore` image-model adaptation
