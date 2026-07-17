# Canvas Performance Recorder

Local diagnostic recorder for canvas performance investigations.

The recorder is disabled by default and is intended for short diagnostic
sessions. Use the in-app trace panel or the global trace helpers exposed by
`canvas-performance-trace-adapter.ts` to record a 10 minute trace, export the
JSON, and inspect the generated suspects.

From the repository root, `start-canvas-performance-recorder.cmd` starts the
frontend and opens `/?canvasImagePerf=1&canvasPerfTrace=1&canvasPerfTraceStart=1`
so a 10 minute trace begins automatically after the page loads.
Pass the current page URL as the first argument when you need to record the
same workflow/page instead of the default root canvas URL.

Do not add business analytics here. Every instrumentation point must be listed
in `docs/instrumentation-map.md` so it can be cleaned up later.
