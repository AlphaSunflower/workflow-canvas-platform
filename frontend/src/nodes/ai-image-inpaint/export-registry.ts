import type { AIImageInpaintMaskMode } from './constants';
import type { AIImageInpaintMaskSnapshot } from './mask-strokes';

export interface InpaintMaskExportRequest {
  mode: AIImageInpaintMaskMode;
}

export type InpaintMaskExporter = (
  request: InpaintMaskExportRequest,
) => Promise<Blob>;

export interface InpaintMaskExportController {
  exportMask: InpaintMaskExporter;
  commitSnapshot?: () => AIImageInpaintMaskSnapshot | null;
}

const exporterByNodeId = new Map<string, InpaintMaskExportController>();

export function registerAIImageInpaintMaskExporter(
  nodeId: string,
  exporter: InpaintMaskExporter | InpaintMaskExportController,
): () => void {
  const controller = typeof exporter === 'function'
    ? { exportMask: exporter }
    : exporter;
  exporterByNodeId.set(nodeId, controller);

  return () => {
    if (exporterByNodeId.get(nodeId) === controller) {
      exporterByNodeId.delete(nodeId);
    }
  };
}

export function getAIImageInpaintMaskExporter(
  nodeId: string,
): InpaintMaskExporter | null {
  return exporterByNodeId.get(nodeId)?.exportMask ?? null;
}

export function getAIImageInpaintMaskExportController(
  nodeId: string,
): InpaintMaskExportController | null {
  return exporterByNodeId.get(nodeId) ?? null;
}
