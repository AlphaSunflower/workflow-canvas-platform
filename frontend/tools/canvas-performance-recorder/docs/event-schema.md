# Canvas Performance Trace Event Schema

All events use:

```ts
{
  ts: number;
  type: CanvasTraceEventType;
  phase: 'start' | 'end' | 'instant';
  durationMs?: number;
  opId?: string;
  frameId?: number;
  data?: Record<string, string | number | boolean | null | undefined>;
}
```

Sensitive values are redacted or hashed by `privacy.ts`. Do not record file
names, URLs, raw node data, tokens, or user content.

Raster backend events may include aggregate texture and sprite counts such as
`textureUploadCount`, `textureEvictedCount`, `textureRetainedCount`,
`activeSpriteCount`, and `spritePoolSize`. These fields must stay aggregate-only.

High frequency events are counted per second in the default preset. Start/end
operation events, long tasks, frame gaps, and slow operation events remain in
the timeline.
