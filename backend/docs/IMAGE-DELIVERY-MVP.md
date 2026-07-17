# Image Delivery MVP

## Goal

Define the backend image delivery contract used by the frontend canvas after workflow/file backendization.

## Resource Layers

For image files, backend should expose three resource intents:

- `thumbnail`
  Small, cheap canvas-first resource.
- `preview`
  Medium-resolution canvas resource for larger on-screen display.
- `download`
  Original-or-best-available resource for viewer/export/download use.

These resources must not be treated as one interchangeable URL in the normal case.

## Current Contract

File read models should expose:

- `fileId`
- `mimeType`
- `width`
- `height`
- `thumbnailUrl`
- `previewUrl`
- `downloadUrl`
- `thumbnailWidth`
- `thumbnailHeight`
- `previewWidth`
- `previewHeight`

Workflow hydrate responses for image file nodes should carry enough metadata for frontend to rebuild stable remote image assets without guessing.

## Delivery Rules

- `GET /api/v1/files/:fileId/thumbnail`
  Returns thumbnail derivative when available.
- `GET /api/v1/files/:fileId/preview`
  Returns preview derivative when available.
- `GET /api/v1/files/:fileId/download`
  Returns original content or download-oriented source.
- All three routes remain protected by account visibility rules.

## Cache Semantics

- All three resource routes remain authenticated private resources.
- Cache headers must not weaken permission checks: server still authenticates and authorizes every request before serving content or returning `304 Not Modified`.
- `thumbnail`
  Returns `Cache-Control: private, max-age=300, stale-while-revalidate=86400`.
- `preview`
  Returns `Cache-Control: private, max-age=120, stale-while-revalidate=3600`.
- `download`
  Returns `Cache-Control: private, max-age=0, must-revalidate`.
- All three resource routes return stable validators for the current file variant:
  - `ETag`
    Built from `fileId + variant + blob sha256`.
  - `Last-Modified`
    Derived from the underlying stored file variant modification time.
- Clients may use `If-None-Match` and `If-Modified-Since` for conditional requests.
- Server should return `304 Not Modified` when validators match after auth succeeds.

## Frontend Expectations

- Small canvas nodes should default to `thumbnail`.
- Larger display needs should upgrade to `preview`.
- Viewer should prefer original/download resource.
- If `thumbnailUrl` is absent and frontend falls back to `previewUrl`, that is degraded compatibility mode, not target steady state.

## Derivative Generation Baseline

- After image upload, backend extracts `width` / `height`.
- Backend writes thumbnail and preview derivatives to local storage.
- Derivative dimensions should remain stable across repeated reads for the same file version.
- Content-addressed original storage rules do not change.

## Diagnosis Guide

When frontend reports image flicker or repeated reload:

1. Verify file detail returns distinct `thumbnailUrl` and `previewUrl`.
2. Verify workflow detail hydrate returns the same distinct resource fields.
3. Verify thumbnail and preview dimensions are populated and plausible.
4. Verify protected resource access returns `200` for authenticated requests.
5. Verify repeated requests can hit browser cache or receive `304 Not Modified`.
6. Only after the above pass should frontend cache/state logic be treated as the primary suspect.

## Non-goals

- CDN offload
- responsive multi-breakpoint image sets beyond thumbnail/preview/original
- video poster derivation
- cross-account public image delivery
