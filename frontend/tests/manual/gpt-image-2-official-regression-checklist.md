# GPT Image 2 Official Regression Checklist

## Config

- Confirm `backend/config/backend.config.json` contains `providers.laozhang.sora2Official.apiKey`.
- Confirm `providers.laozhang.sora2Official.apiBaseUrl` is `https://api2.laozhang.ai/v1` unless testing another compatible gateway.
- Confirm example config and tests do not contain a real API key.

## AI Image Gen

- Create an `aiImageGen` node.
- Select `GPT Image 2 Official`.
- Confirm the legacy option is displayed as `GPT Image 2`.
- Confirm the Official-only `quality` control is visible.
- Select each quality value once: `auto`, `low`, `medium`, `high`.
- Select aspect ratio `Auto` and run with prompt only, no reference images.
- Confirm the execution request uses `model = gpt-image-2-official`, `aspectRatio = auto`, and the selected `quality`.
- Confirm the backend task stores `providerRoute = sora2official`, `providerModel = gpt-image-2`, and `resolvedSize = auto`.
- Confirm the canvas receives a new output image node after completion.
- Switch to `GPT Image 2` and confirm the Official-only `quality` control is hidden.
- Switch to Gemini and confirm existing reference-image generation still runs.

## Current Limit

- Connect a reference image to `GPT Image 2 Official`.
- Confirm the frontend blocks execution with a text-to-image-only message.
- Confirm no provider request is sent for the blocked reference-image edit path.

## Regressions

- Run `aiImageGen` with Gemini and one or more reference images.
- Run `aiImageGen` with `GPT Image 2` and one or more reference images.
- Run `aiImageInpaint` and confirm output image node creation still works.
- Run `aiImageHd` and confirm output image node creation still works.
- Run `aiFloorplanColorize` and confirm output image node creation still works.
