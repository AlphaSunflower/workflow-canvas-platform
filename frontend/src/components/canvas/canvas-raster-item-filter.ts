import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import type { CanvasRenderPlan } from './canvas-render-plan';

export function filterRasterItemsByRenderPlan(
  items: readonly CanvasImageRasterItem[],
  rasterEligibleImageNodes: readonly CanvasRenderPlan['rasterEligibleImageNodes'][number][],
  activeImageNodeIdSet: ReadonlySet<string>,
): CanvasImageRasterItem[] {
  const rasterOwnedNodeIds = new Set(
    rasterEligibleImageNodes
      .filter((node) => node.data.imageResourceOwner === 'raster')
      .map((node) => node.id),
  );

  return items.filter((item) => (
    rasterOwnedNodeIds.has(item.nodeId) &&
    !activeImageNodeIdSet.has(item.nodeId)
  ));
}
