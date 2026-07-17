# Canvas Performance Recorder Cleanup Checklist

- Remove the adapter calls from the instrumentation point.
- Remove the event type from `schema.ts` if no longer used.
- Remove analyzer rules that depend on the event.
- Remove the row from `instrumentation-map.md`.
- Update `event-schema.md` if the exported shape changes.
- Run `npm.cmd run typecheck`.
- Run trace and canvas performance tests.
- Confirm diagnostics disabled mode records nothing.
