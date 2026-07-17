# Canvas Performance Trace Analysis Guide

1. Start a `10min-default` recording from the canvas trace panel.
2. Reproduce the slow operation: import, pan, zoom, box select, save, or viewer open.
3. Export the JSON trace.
4. Inspect `summary` first, then `suspects`, then the timeline around the suspect `atMs`.
5. Focus on the 500ms window around each long task.

Common patterns:

- High `imageManager.emit/sec` near pan/zoom means resource state broadcasts are still too chatty.
- Slow `raster.draw` means the 2D canvas draw budget is exceeded.
- Slow `nodePatch.flush` means node writes are still too large for one frame.
- Many `reactFlow.nodesRefChange` events near render plan rebuilds usually points to React Flow churn.
