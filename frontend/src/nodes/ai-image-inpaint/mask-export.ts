import type { AIImageInpaintMaskMode } from './constants';
import type { AIImageInpaintMaskStroke } from './mask-strokes';

export interface InpaintImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ExportInpaintMaskImageDataOptions {
  source: InpaintImageDataLike;
  mask: InpaintImageDataLike;
  mode: AIImageInpaintMaskMode;
}

export interface RenderInpaintMaskImageDataFromStrokesOptions {
  width: number;
  height: number;
  strokes: readonly AIImageInpaintMaskStroke[];
}

export interface ExportInpaintMaskImageDataFromStrokesOptions {
  source: InpaintImageDataLike;
  strokes: readonly AIImageInpaintMaskStroke[];
  mode: AIImageInpaintMaskMode;
}

export interface ExportInpaintMaskImageDataFromMaskOptions {
  source: InpaintImageDataLike;
  mask: InpaintImageDataLike;
  mode: AIImageInpaintMaskMode;
}

export interface HasInpaintMaskStrokeMarksOptions {
  width?: number;
  height?: number;
}

export const INPAINT_MASK_MARKUP_RGBA = [255, 0, 0, 255] as const;
export const INPAINT_STRONG_MASK_OFF_RGBA = [0, 0, 0, 255] as const;
export const INPAINT_STRONG_MASK_ON_RGBA = [255, 255, 255, 255] as const;

function assertImageDataShape(imageData: InpaintImageDataLike, label: string): void {
  if (!Number.isInteger(imageData.width) || imageData.width <= 0) {
    throw new Error(`${label} width must be a positive integer.`);
  }

  if (!Number.isInteger(imageData.height) || imageData.height <= 0) {
    throw new Error(`${label} height must be a positive integer.`);
  }

  if (imageData.data.length !== imageData.width * imageData.height * 4) {
    throw new Error(`${label} data length does not match image dimensions.`);
  }
}

function assertSameDimensions(source: InpaintImageDataLike, mask: InpaintImageDataLike): void {
  assertImageDataShape(source, 'source');
  assertImageDataShape(mask, 'mask');

  if (source.width !== mask.width || source.height !== mask.height) {
    throw new Error('source and mask image dimensions must match.');
  }
}

function isMarkedPixel(mask: InpaintImageDataLike, pixelOffset: number): boolean {
  return mask.data[pixelOffset + 3] > 0;
}

export function hasMaskMarks(mask: InpaintImageDataLike): boolean {
  assertImageDataShape(mask, 'mask');

  for (let index = 3; index < mask.data.length; index += 4) {
    if (mask.data[index] > 0) {
      return true;
    }
  }

  return false;
}

export function hasInpaintMaskStrokes(
  strokes: readonly AIImageInpaintMaskStroke[] | null | undefined,
): boolean {
  return Array.isArray(strokes)
    && strokes.some((stroke) => stroke.tool === 'brush' && stroke.points.length > 0);
}

export function exportInpaintMaskImageData(
  options: ExportInpaintMaskImageDataOptions,
): InpaintImageDataLike {
  const { source, mask, mode } = options;
  assertSameDimensions(source, mask);

  const output = new Uint8ClampedArray(source.data.length);

  for (let index = 0; index < source.data.length; index += 4) {
    const marked = isMarkedPixel(mask, index);

    if (mode === 'original-markup') {
      if (marked) {
        output[index] = INPAINT_MASK_MARKUP_RGBA[0];
        output[index + 1] = INPAINT_MASK_MARKUP_RGBA[1];
        output[index + 2] = INPAINT_MASK_MARKUP_RGBA[2];
        output[index + 3] = INPAINT_MASK_MARKUP_RGBA[3];
      } else {
        output[index] = source.data[index];
        output[index + 1] = source.data[index + 1];
        output[index + 2] = source.data[index + 2];
        output[index + 3] = source.data[index + 3];
      }
      continue;
    }

    if (mode === 'strong-mask') {
      const color = marked ? INPAINT_STRONG_MASK_ON_RGBA : INPAINT_STRONG_MASK_OFF_RGBA;
      output[index] = color[0];
      output[index + 1] = color[1];
      output[index + 2] = color[2];
      output[index + 3] = color[3];
      continue;
    }

    throw new Error(`Unsupported inpaint mask mode: ${String(mode)}`);
  }

  return {
    width: source.width,
    height: source.height,
    data: output,
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function getDistanceSquaredToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0) {
    const pointDx = px - ax;
    const pointDy = py - ay;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const closestDx = px - closestX;
  const closestDy = py - closestY;
  return closestDx * closestDx + closestDy * closestDy;
}

function writeMaskPixel(
  data: Uint8ClampedArray,
  pixelOffset: number,
  marked: boolean,
): void {
  if (!marked) {
    data[pixelOffset] = 0;
    data[pixelOffset + 1] = 0;
    data[pixelOffset + 2] = 0;
    data[pixelOffset + 3] = 0;
    return;
  }

  data[pixelOffset] = INPAINT_MASK_MARKUP_RGBA[0];
  data[pixelOffset + 1] = INPAINT_MASK_MARKUP_RGBA[1];
  data[pixelOffset + 2] = INPAINT_MASK_MARKUP_RGBA[2];
  data[pixelOffset + 3] = INPAINT_MASK_MARKUP_RGBA[3];
}

function getCanvasRenderingContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true });
}

function renderMaskImageDataFromStrokesWithCanvas(
  width: number,
  height: number,
  strokes: readonly AIImageInpaintMaskStroke[],
): ImageData | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = getCanvasRenderingContext(canvas);
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, width, height);
  strokes.forEach((stroke) => {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = stroke.brushSize;

    if (stroke.tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out';
      context.strokeStyle = 'rgba(0, 0, 0, 1)';
      context.fillStyle = 'rgba(0, 0, 0, 1)';
    } else {
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = `rgba(${INPAINT_MASK_MARKUP_RGBA[0]}, ${INPAINT_MASK_MARKUP_RGBA[1]}, ${INPAINT_MASK_MARKUP_RGBA[2]}, 1)`;
      context.fillStyle = `rgba(${INPAINT_MASK_MARKUP_RGBA[0]}, ${INPAINT_MASK_MARKUP_RGBA[1]}, ${INPAINT_MASK_MARKUP_RGBA[2]}, 1)`;
    }

    stroke.points.forEach((point, index) => {
      context.beginPath();
      if (index > 0) {
        const previousPoint = stroke.points[index - 1];
        context.moveTo(previousPoint.x, previousPoint.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      } else {
        context.arc(point.x, point.y, stroke.brushSize / 2, 0, Math.PI * 2);
        context.fill();
      }
    });
    context.restore();
  });

  return context.getImageData(0, 0, width, height);
}

function paintMaskStrokeSegment(params: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  radius: number;
  marked: boolean;
}): void {
  const {
    data,
    width,
    height,
    fromX,
    fromY,
    toX,
    toY,
    radius,
    marked,
  } = params;

  if (
    !Number.isFinite(fromX) ||
    !Number.isFinite(fromY) ||
    !Number.isFinite(toX) ||
    !Number.isFinite(toY) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return;
  }

  const minX = Math.max(0, Math.floor(Math.min(fromX, toX) - radius));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(fromX, toX) + radius));
  const minY = Math.max(0, Math.floor(Math.min(fromY, toY) - radius));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(fromY, toY) + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distanceSquared = getDistanceSquaredToSegment(
        x,
        y,
        fromX,
        fromY,
        toX,
        toY,
      );

      if (distanceSquared <= radiusSquared) {
        writeMaskPixel(data, (y * width + x) * 4, marked);
      }
    }
  }
}

export function renderInpaintMaskImageDataFromStrokes(
  options: RenderInpaintMaskImageDataFromStrokesOptions,
): InpaintImageDataLike {
  const { width, height, strokes } = options;
  assertPositiveInteger(width, 'mask width');
  assertPositiveInteger(height, 'mask height');

  const canvasImageData = renderMaskImageDataFromStrokesWithCanvas(width, height, strokes);
  if (canvasImageData) {
    return canvasImageData;
  }

  const data = new Uint8ClampedArray(width * height * 4);

  strokes.forEach((stroke) => {
    const radius = Math.max(1, stroke.brushSize / 2);
    const marked = stroke.tool === 'brush';

    stroke.points.forEach((point, index) => {
      const previousPoint = index > 0 ? stroke.points[index - 1] : point;
      paintMaskStrokeSegment({
        data,
        width,
        height,
        fromX: previousPoint.x,
        fromY: previousPoint.y,
        toX: point.x,
        toY: point.y,
        radius,
        marked,
      });
    });
  });

  return {
    width,
    height,
    data,
  };
}

export function hasInpaintMaskStrokeMarks(
  strokes: readonly AIImageInpaintMaskStroke[] | null | undefined,
  options: HasInpaintMaskStrokeMarksOptions = {},
): boolean {
  const normalizedStrokes = Array.isArray(strokes) ? strokes : [];
  if (!hasInpaintMaskStrokes(normalizedStrokes)) {
    return false;
  }

  const { width, height } = options;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return true;
  }

  return hasMaskMarks(renderInpaintMaskImageDataFromStrokes({
    width,
    height,
    strokes: normalizedStrokes,
  }));
}

export function exportInpaintMaskImageDataFromStrokes(
  options: ExportInpaintMaskImageDataFromStrokesOptions,
): InpaintImageDataLike {
  assertImageDataShape(options.source, 'source');

  const mask = renderInpaintMaskImageDataFromStrokes({
    width: options.source.width,
    height: options.source.height,
    strokes: options.strokes,
  });

  if (!hasMaskMarks(mask)) {
    throw new Error('inpaint mask contains no marked pixels.');
  }

  return exportInpaintMaskImageData({
    source: options.source,
    mask,
    mode: options.mode,
  });
}

export function exportInpaintMaskImageDataFromMask(
  options: ExportInpaintMaskImageDataFromMaskOptions,
): InpaintImageDataLike {
  const { source, mask, mode } = options;
  assertSameDimensions(source, mask);

  if (!hasMaskMarks(mask)) {
    throw new Error('inpaint mask contains no marked pixels.');
  }

  return exportInpaintMaskImageData({
    source,
    mask,
    mode,
  });
}
