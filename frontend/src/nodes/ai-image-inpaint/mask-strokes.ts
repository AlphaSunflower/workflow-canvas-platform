import type {
  AIImageInpaintMaskDraft,
  AIImageInpaintMaskDraftState,
  AIImageInpaintMaskPoint,
  AIImageInpaintMaskSnapshot,
  AIImageInpaintMaskSourceInfo,
  AIImageInpaintMaskStroke,
  AIImageInpaintTool,
} from '@/types/node.types';

export type {
  AIImageInpaintMaskDraft,
  AIImageInpaintMaskDraftState,
  AIImageInpaintMaskPoint,
  AIImageInpaintMaskSnapshot,
  AIImageInpaintMaskSourceInfo,
  AIImageInpaintMaskStroke,
  AIImageInpaintTool,
};

export const AI_IMAGE_INPAINT_MASK_TOOLS = [
  'brush',
  'eraser',
] as const satisfies readonly AIImageInpaintTool[];

export function createEmptyAIImageInpaintMaskStrokes(): AIImageInpaintMaskStroke[] {
  return [];
}

export function cloneAIImageInpaintMaskStrokes(
  strokes: readonly AIImageInpaintMaskStroke[],
): AIImageInpaintMaskStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

export function createAIImageInpaintMaskStrokesSignature(
  strokes: readonly AIImageInpaintMaskStroke[],
): string {
  return strokes
    .map((stroke) => [
      stroke.id,
      stroke.tool,
      stroke.brushSize,
      stroke.points.map((point) => `${point.x},${point.y}`).join(';'),
    ].join(':'))
    .join('|');
}

export function createAIImageInpaintMaskSnapshotSignature(params: {
  strokes: readonly AIImageInpaintMaskStroke[];
  sourceInfo: AIImageInpaintMaskSourceInfo | null;
  hasMarks: boolean;
}): string {
  const source = params.sourceInfo
    ? `${params.sourceInfo.fileId}:${params.sourceInfo.width}:${params.sourceInfo.height}`
    : 'no-source';
  return [
    source,
    params.hasMarks ? 'marked' : 'empty',
    createAIImageInpaintMaskStrokesSignature(params.strokes),
  ].join('::');
}

export function isAIImageInpaintTool(value: unknown): value is AIImageInpaintTool {
  return value === 'brush' || value === 'eraser';
}

export function isAIImageInpaintMaskPoint(value: unknown): value is AIImageInpaintMaskPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const point = value as Partial<AIImageInpaintMaskPoint>;
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

export function isAIImageInpaintMaskStroke(value: unknown): value is AIImageInpaintMaskStroke {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const stroke = value as Partial<AIImageInpaintMaskStroke>;
  return (
    typeof stroke.id === 'string' &&
    stroke.id.length > 0 &&
    isAIImageInpaintTool(stroke.tool) &&
    typeof stroke.brushSize === 'number' &&
    Number.isFinite(stroke.brushSize) &&
    stroke.brushSize > 0 &&
    Array.isArray(stroke.points) &&
    stroke.points.every(isAIImageInpaintMaskPoint)
  );
}

export function normalizeAIImageInpaintMaskStrokes(value: unknown): AIImageInpaintMaskStroke[] {
  return Array.isArray(value)
    ? value.filter(isAIImageInpaintMaskStroke)
    : [];
}
