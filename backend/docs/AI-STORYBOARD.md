# AI Storyboard
## 1. Scope

`aiStoryboard` is a storyboard workbench node for image-derived shot organization and per-shot media generation.

Current version includes:

1. `一键AI智能排序与写运镜`
2. Single-shot AI image generation
3. Single-shot video generation
4. Batch video dispatch with staggered scheduling
5. List, grid and table editing views
6. JSON preview and `筛选保留镜头`

Current version does not include:

1. `一键出图`
2. Batch AI image generation toolbar
3. Any arrange action that directly creates media

## 2. Arrange Boundary

`AI 智能编排` only does two things:

1. Reorder shots
2. Rewrite each arranged shot into a Chinese camera-motion prompt

It does not:

1. Create an execution run
2. Trigger image generation
3. Trigger video generation
4. Write any media output file

The arrange endpoint is:

- `POST /api/v1/ai/storyboard-arrange`

Request body:

```json
{
  "workflowId": "workflow-1",
  "nodeId": "node-1",
  "nodeType": "aiStoryboard",
  "shots": [
    {
      "shotId": "shot-1",
      "order": 1,
      "imageFileId": "file-1"
    }
  ]
}
```

Successful response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "shots": [
      {
        "shotId": "shot-1",
        "order": 1,
        "prompt": "中文运镜提示词"
      }
    ],
    "model": "gemini-3-flash-preview",
    "referenceCount": 1,
    "promptVersion": "ai-storyboard-arrange-v1"
  },
  "timestamp": 1710000000000
}
```

## 3. Multimodal Prompt Rule

Storyboard arrange uses the same LaoZhang multimodal chat completion client as AI prompt optimize.

Shared low-level provider:

- `backend/api/src/modules/ai/providers/laozhang-vision.client.ts`

Important rules:

1. No system prompt is sent for storyboard arrange.
2. The request is a single `user` multimodal message.
3. `user.content` is built as:
   - top-level fixed text prompt
   - per-shot `图片信息 [shotId: ...]:`
   - matching `image_url`
4. Image order must stay exactly the same as current shot order passed into the backend.
5. Images are preprocessed as `512px + jpeg + quality 0.6`.

## 4. Runtime Split

The node intentionally uses two different backend paths:

1. Multimodal large model for arrange:
   - shares the same LaoZhang vision client used by AI prompt optimize
2. Existing execution runtime for media:
   - image generation continues through existing `image-gen`
   - video generation continues through existing `video-gen`

This split is required to preserve current runtime behavior and avoid creating a second media pipeline.

## 5. Video Generation Rule

Single-shot video generation:

1. Uses only the current shot prompt
2. Uses the shot reference image
3. Reuses existing `video-gen` execution runtime

Batch video generation:

1. Skips shots already in `videoGenStatus === "generating"`
2. Dispatches remaining shots with about 3 seconds between starts
3. Retries only the storyboard video chain
4. Retries at most 2 times
5. Retry delays are 15 seconds and 30 seconds
6. Timeout-like errors do not retry

## 6. Frontend Editing Notes

The node keeps one local `shots[]` editing state and writes back into `node.config.shots`.

The three views must stay consistent:

1. List view
2. Grid view
3. Table view

The same shot update actions are shared across these views so prompt, image parameters, video parameters and status rendering do not drift.

## 7. Workbench UI Boundary

`aiStoryboard` is a workbench node, not a placeholder execution node.

Required UI boundaries:

1. The node must use the dark AI node shell and dark workbench view system.
2. List, grid, table and `筛选保留镜头` dialog must stay in the same dark visual language.
3. Shot cards, grid cards, table rows, empty states and dialog panels must not reintroduce large white or light-gray admin-panel surfaces.
4. The node must keep a large workbench default size and a minimum size floor so the toolbar, metadata area and first-screen view remain usable after creation.
5. Input/output handles must use dedicated storyboard handle classes with negative side offsets so the connection points render outside the node border and are not clipped by the content frame.

Current size contract:

```ts
defaultSize = { width: 1080, height: 760 }
minSize = { width: 860, height: 620 }
```

Current handle strategy:

1. Base class: `ai-storyboard-node__handle`
2. Input class: `ai-storyboard-node__handle--input`
3. Output class: `ai-storyboard-node__handle--output`
4. Input offset: `left: -10px`
5. Output offset: `right: -10px`
6. Hit-area expansion is provided by `ai-storyboard-node__handle::before`

## 8. Execution Entry Boundary

`aiStoryboard` must not return to the previous "unavailable placeholder" semantics.

The global node run affordance is not the primary user path for this node. Users operate it through internal workbench actions:

1. `一键AI智能排序与写运镜`
2. Single-shot `AI 出图`
3. Single-shot `生成视频`
4. `一键生成视频`

The node definition may keep a lightweight execution adapter only as registry/runtime compatibility. The actual media generation work must continue to be dispatched through the explicit storyboard workbench actions and the existing image/video execution runtime.

Regression tests must guard these boundaries:

1. Default size and minimum size stay above the workbench floor.
2. The node definition does not become a permanently invalid placeholder.
3. Workbench shell classes and dark view classes remain present.
4. Handle classes and negative offset rules remain present.
5. Broad `[style*=...]` article fallback overrides are not reintroduced as the primary dark-mode mechanism.
