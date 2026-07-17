import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileNodeData } from '@/types';
import {
  resolveFileResource,
  type FileResourceDiagnosticsMetadata,
  type FileResourceHandle,
} from '@/services/file-resource';
import type { AIImageInpaintMaskMode } from './constants';
import {
  exportInpaintMaskImageDataFromMask,
  hasMaskMarks,
  type InpaintImageDataLike,
} from './mask-export';
import {
  InpaintBrushIcon,
  InpaintEraserIcon,
  InpaintTrashIcon,
} from './icons';
import type {
  AIImageInpaintMaskDraft,
  AIImageInpaintMaskDraftState,
  AIImageInpaintMaskPoint,
  AIImageInpaintMaskSnapshot,
  AIImageInpaintMaskSourceInfo,
  AIImageInpaintMaskStroke,
  AIImageInpaintTool,
} from './mask-strokes';
import {
  cloneAIImageInpaintMaskStrokes,
  createAIImageInpaintMaskSnapshotSignature,
  createAIImageInpaintMaskStrokesSignature,
} from './mask-strokes';

export interface InpaintCanvasEditorState {
  hasSource: boolean;
  hasMarks: boolean;
  draftState: AIImageInpaintMaskDraftState;
  flushMaskDraft: () => void;
  commitMaskSnapshot: () => AIImageInpaintMaskSnapshot | null;
  exportMaskBlob: (mode: AIImageInpaintMaskMode) => Promise<Blob>;
}

export interface InpaintCanvasEditorProps {
  nodeId: string;
  sourceNode: FileNodeData | null;
  maskMode: AIImageInpaintMaskMode;
  maskStrokes: AIImageInpaintMaskStroke[];
  maskSourceFileId?: string;
  maskSourceWidth?: number;
  maskSourceHeight?: number;
  disabled?: boolean;
  deferPreviewResize?: boolean;
  workflowId?: string | null;
  authScope?: string | null;
  onStateChange?: (state: InpaintCanvasEditorState) => void;
  onMaskDraftStateChange?: (state: AIImageInpaintMaskDraftState) => void;
  onMaskSnapshotCommit?: (snapshot: AIImageInpaintMaskSnapshot | null) => void;
}

interface LoadedImageState {
  image: HTMLImageElement;
  width: number;
  height: number;
  src: string;
}

interface SourceLoadSignature {
  sourceNodeId: string;
  sourceFileId: string;
  sourceLoadUrl: string;
}

export type InpaintSourceImageLoadKind = 'original' | 'none';

export interface InpaintSourceImageLoadResult {
  kind: InpaintSourceImageLoadKind;
  url?: string;
  hasOriginalSource: boolean;
}

export interface InpaintSourceLoadTransition {
  shouldResetLoadedImage: boolean;
  shouldClearPreviousSource: boolean;
}

interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImagePointerPoint extends AIImageInpaintMaskPoint {
  canvasX: number;
  canvasY: number;
}

export interface InpaintPointerCoordinate {
  clientX: number;
  clientY: number;
}

export interface InpaintCoalescedPointerEvent {
  clientX: number;
  clientY: number;
  nativeEvent?: {
    getCoalescedEvents?: () => readonly InpaintPointerCoordinate[];
  };
}

interface InpaintEditorFrameStyle extends React.CSSProperties {
  '--inpaint-source-aspect-ratio'?: string;
}

interface CanvasViewport {
  width: number;
  height: number;
  dpr: number;
  ready: boolean;
}

interface InpaintEditorSourceResourceState {
  url?: string;
  loading: boolean;
  error?: string;
  diagnostics?: FileResourceDiagnosticsMetadata;
  revision: number;
}

const DEFAULT_BRUSH_SIZE = 36;
const MIN_BRUSH_SIZE = 4;
const MAX_BRUSH_SIZE = 160;
const MIN_READY_CANVAS_SIZE = 2;
const MAX_PREVIEW_BACKING_PIXELS = 1_750_000;
const MARK_ALPHA = 255;
const MASK_SNAPSHOT_AUTO_COMMIT_DELAY_MS = 4000;
const DEFAULT_IMAGE_LOADING_MESSAGE = '正在加载原图';
const DEFAULT_CANVAS_PENDING_MESSAGE = '正在准备原图预览';
const DEFAULT_PREVIEW_RENDER_ERROR_MESSAGE = '原图预览渲染失败。';
const DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE = '局部重绘原图不可用，请重新连接输入图或刷新后重试。';

function stopPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function stopControlPropagation(event: React.MouseEvent | React.PointerEvent): void {
  event.stopPropagation();
}

function isPrimaryPointerButton(event: React.MouseEvent | React.PointerEvent): boolean {
  return event.button === 0;
}

function stopPrimaryPointerEvent(event: React.MouseEvent | React.PointerEvent): void {
  if (isPrimaryPointerButton(event)) {
    stopPointerEvent(event);
  }
}

function getCanvasContext(
  canvas: HTMLCanvasElement,
  settings?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', settings);
  if (!context) {
    throw new Error('Canvas 2D is not supported by this browser.');
  }

  return context;
}

function createReadableCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getContext('2d', { willReadFrequently: true });
  return canvas;
}

export function resolveInpaintImageDrawRect(params: {
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): DrawRect | null {
  const {
    imageWidth,
    imageHeight,
    canvasWidth,
    canvasHeight,
  } = params;
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return null;
  }

  const imageRatio = imageWidth / imageHeight;
  const canvasRatio = canvasWidth / canvasHeight;
  const width = canvasRatio > imageRatio
    ? canvasHeight * imageRatio
    : canvasWidth;
  const height = canvasRatio > imageRatio
    ? canvasHeight
    : canvasWidth / imageRatio;

  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCanvasDevicePixelRatio(): number {
  if (typeof window === 'undefined') {
    return 1;
  }

  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function normalizeCanvasSizeValue(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

export function resolveInpaintCanvasElementLayoutSize(
  element: Pick<HTMLElement, 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight' | 'getBoundingClientRect'>,
): { width: number; height: number } {
  const clientWidth = normalizeCanvasSizeValue(element.clientWidth);
  const clientHeight = normalizeCanvasSizeValue(element.clientHeight);
  const offsetWidth = normalizeCanvasSizeValue(element.offsetWidth);
  const offsetHeight = normalizeCanvasSizeValue(element.offsetHeight);

  if (clientWidth > 0 && clientHeight > 0) {
    return { width: clientWidth, height: clientHeight };
  }

  if (offsetWidth > 0 && offsetHeight > 0) {
    return { width: offsetWidth, height: offsetHeight };
  }

  const bounds = element.getBoundingClientRect();
  return {
    width: normalizeCanvasSizeValue(bounds.width),
    height: normalizeCanvasSizeValue(bounds.height),
  };
}

export function resolveInpaintCanvasViewport(
  width: number,
  height: number,
  dpr = 1,
): CanvasViewport {
  const normalizedWidth = normalizeCanvasSizeValue(width);
  const normalizedHeight = normalizeCanvasSizeValue(height);
  const ready = normalizedWidth >= MIN_READY_CANVAS_SIZE && normalizedHeight >= MIN_READY_CANVAS_SIZE;
  const normalizedDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const effectiveDpr = ready
    ? Math.min(
      normalizedDpr,
      Math.sqrt(MAX_PREVIEW_BACKING_PIXELS / Math.max(1, normalizedWidth * normalizedHeight)),
    )
    : normalizedDpr;

  return {
    width: Math.max(1, normalizedWidth),
    height: Math.max(1, normalizedHeight),
    dpr: effectiveDpr,
    ready,
  };
}

export function resolveInpaintAspectFitSize(params: {
  containerWidth: number;
  containerHeight: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
}): { width: number; height: number } | null {
  const containerWidth = Number.isFinite(params.containerWidth)
    ? Math.floor(params.containerWidth)
    : 0;
  const containerHeight = Number.isFinite(params.containerHeight)
    ? Math.floor(params.containerHeight)
    : 0;
  if (containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }

  const imageWidth = Number.isFinite(params.imageWidth) ? Number(params.imageWidth) : 0;
  const imageHeight = Number.isFinite(params.imageHeight) ? Number(params.imageHeight) : 0;
  if (imageWidth <= 0 || imageHeight <= 0) {
    return {
      width: containerWidth,
      height: containerHeight,
    };
  }

  const imageRatio = imageWidth / imageHeight;
  const containerRatio = containerWidth / containerHeight;
  if (containerRatio > imageRatio) {
    return {
      width: containerHeight * imageRatio,
      height: containerHeight,
    };
  }

  return {
    width: containerWidth,
    height: containerWidth / imageRatio,
  };
}

function resizeDisplayCanvas(canvas: HTMLCanvasElement, shell: HTMLElement): CanvasViewport {
  const layoutSize = resolveInpaintCanvasElementLayoutSize(shell);
  const viewport = resolveInpaintCanvasViewport(
    layoutSize.width,
    layoutSize.height,
    getCanvasDevicePixelRatio(),
  );
  const { width, height, dpr } = viewport;
  if (!viewport.ready) {
    return viewport;
  }

  const backingWidth = Math.max(1, Math.round(width * dpr));
  const backingHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }

  return viewport;
}

function resizeCanvasToViewport(canvas: HTMLCanvasElement, viewport: CanvasViewport): void {
  if (!viewport.ready) {
    return;
  }

  const backingWidth = Math.max(1, Math.round(viewport.width * viewport.dpr));
  const backingHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));

  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }
}

function ensureCanvasPixelSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = getCanvasContext(canvas);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function areCanvasViewportsEqual(left: CanvasViewport, right: CanvasViewport): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.dpr === right.dpr
    && left.ready === right.ready;
}

export function areInpaintSourceLoadSignaturesEqual(
  left: SourceLoadSignature | null,
  right: SourceLoadSignature | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.sourceNodeId === right.sourceNodeId
    && left.sourceFileId === right.sourceFileId
    && left.sourceLoadUrl === right.sourceLoadUrl;
}

export function resolveInpaintSourceLoadTransition(
  previous: SourceLoadSignature | null,
  next: SourceLoadSignature | null,
): InpaintSourceLoadTransition {
  if (!previous) {
    return {
      shouldResetLoadedImage: true,
      shouldClearPreviousSource: !next,
    };
  }

  if (!next) {
    return {
      shouldResetLoadedImage: false,
      shouldClearPreviousSource: false,
    };
  }

  const sameSourceIdentity = previous.sourceNodeId === next.sourceNodeId
    && previous.sourceFileId === next.sourceFileId;
  const sameLoadUrl = previous.sourceLoadUrl === next.sourceLoadUrl;

  return {
    shouldResetLoadedImage: !sameSourceIdentity || !sameLoadUrl,
    shouldClearPreviousSource: !sameSourceIdentity,
  };
}

export function shouldResolveInpaintSourceResource(params: {
  currentKey: string | null;
  nextKey: string | null;
  currentUrl?: string;
  currentLoading: boolean;
  currentError?: string;
}): boolean {
  const currentKey = params.currentKey?.trim() ?? '';
  const nextKey = params.nextKey?.trim() ?? '';
  if (!nextKey) {
    return false;
  }

  if (currentKey !== nextKey) {
    return true;
  }

  return !params.currentUrl && !params.currentLoading && Boolean(params.currentError);
}

function isFinitePointerCoordinate(point: InpaintPointerCoordinate): boolean {
  return Number.isFinite(point.clientX) && Number.isFinite(point.clientY);
}

function areInpaintMaskPointsEqual(
  left: Pick<AIImageInpaintMaskPoint, 'x' | 'y'>,
  right: Pick<AIImageInpaintMaskPoint, 'x' | 'y'>,
): boolean {
  return left.x === right.x && left.y === right.y;
}

export function getInpaintCoalescedPointerCoordinates(
  event: InpaintCoalescedPointerEvent,
): InpaintPointerCoordinate[] {
  const fallbackPoint = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  const coalescedEvents = event.nativeEvent?.getCoalescedEvents?.() ?? [];
  const points = coalescedEvents
    .filter(isFinitePointerCoordinate)
    .map((point) => ({
      clientX: point.clientX,
      clientY: point.clientY,
    }));

  if (points.length === 0) {
    return isFinitePointerCoordinate(fallbackPoint) ? [fallbackPoint] : [];
  }

  const lastPoint = points[points.length - 1];
  if (
    isFinitePointerCoordinate(fallbackPoint) &&
    (lastPoint.clientX !== fallbackPoint.clientX || lastPoint.clientY !== fallbackPoint.clientY)
  ) {
    points.push(fallbackPoint);
  }

  return points;
}

export function shouldDeferInpaintMaskSnapshotCommit(params: {
  isPointerDown: boolean;
  hasActiveStroke: boolean;
}): boolean {
  return params.isPointerDown || params.hasActiveStroke;
}

export function resolveInpaintSourceImageLoadUrl(
  sourceNode: FileNodeData | null,
  resolvedOriginalUrl?: string,
  isResolvingOriginal = false,
): InpaintSourceImageLoadResult {
  const originalUrl = resolvedOriginalUrl?.trim();
  if (originalUrl) {
    return {
      kind: 'original',
      url: originalUrl,
      hasOriginalSource: true,
    };
  }

  if (!sourceNode) {
    return {
      kind: 'none',
      hasOriginalSource: false,
    };
  }

  return {
    kind: 'none',
    hasOriginalSource: isResolvingOriginal,
  };
}

function dataUrlToObjectUrl(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  const metadata = dataUrl.slice(0, commaIndex);
  const mimeMatch = /^data:([^;]+);base64$/.exec(metadata);
  const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
  const binary = window.atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function getFileResourceDiagnostics(error: unknown): FileResourceDiagnosticsMetadata | undefined {
  return error && typeof error === 'object'
    ? (error as { fileResourceDiagnostics?: FileResourceDiagnosticsMetadata }).fileResourceDiagnostics
    : undefined;
}

function loadImage(src: string): Promise<LoadedImageState> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width <= 0 || height <= 0) {
        reject(new Error('原图尺寸无效。'));
        return;
      }

      resolve({ image, width, height, src });
    };
    image.onerror = () => reject(new Error('局部重绘原图加载失败。'));
    image.src = src;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('局部重绘遮罩导出失败。'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

function imageDataLikeToCanvasImageData(
  context: CanvasRenderingContext2D,
  imageData: InpaintImageDataLike,
): ImageData {
  const output = context.createImageData(imageData.width, imageData.height);
  output.data.set(imageData.data);
  return output;
}

function canvasImageDataToImageDataLike(imageData: ImageData): InpaintImageDataLike {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function createStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getSourceFileId(sourceNode: FileNodeData | null): string {
  return sourceNode?.fileId ?? '';
}

function cloneInpaintMaskStrokes(
  strokes: readonly AIImageInpaintMaskStroke[],
): AIImageInpaintMaskStroke[] {
  return cloneAIImageInpaintMaskStrokes(strokes);
}

function areInpaintMaskSourceInfoEqual(
  left: AIImageInpaintMaskSourceInfo | null,
  right: AIImageInpaintMaskSourceInfo | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.fileId === right.fileId
    && left.width === right.width
    && left.height === right.height;
}

function areInpaintMaskDraftStatesEqual(
  left: AIImageInpaintMaskDraftState,
  right: AIImageInpaintMaskDraftState,
): boolean {
  return left.hasMarks === right.hasMarks
    && left.dirty === right.dirty
    && areInpaintMaskSourceInfoEqual(left.sourceInfo, right.sourceInfo);
}

export function createInpaintMaskSourceSignature(sourceInfo: AIImageInpaintMaskSourceInfo | null): string {
  return sourceInfo
    ? `${sourceInfo.fileId}:${sourceInfo.width}:${sourceInfo.height}`
    : 'no-source';
}

export function areInpaintMaskSourceDimensionsMatched(params: {
  sourceFileId: string;
  width: number;
  height: number;
  maskSourceFileId?: string;
  maskSourceWidth?: number;
  maskSourceHeight?: number;
}): boolean {
  return (
    params.sourceFileId.length > 0 &&
    params.maskSourceFileId === params.sourceFileId &&
    params.maskSourceWidth === params.width &&
    params.maskSourceHeight === params.height
  );
}

export function getInpaintBrushImagePixelSize(
  visualBrushSize: number,
  image: Pick<LoadedImageState, 'width' | 'height'>,
  drawRect: Pick<DrawRect, 'width' | 'height'> | null,
): number {
  if (!drawRect || drawRect.width <= 0 || drawRect.height <= 0) {
    return visualBrushSize;
  }

  const scaleX = image.width / drawRect.width;
  const scaleY = image.height / drawRect.height;
  const imageScale = Math.max(scaleX, scaleY);
  return Math.max(1, visualBrushSize * imageScale);
}

export function isInpaintCanvasPointInsideDrawRect(
  point: Pick<ImagePointerPoint, 'canvasX' | 'canvasY'>,
  drawRect: Pick<DrawRect, 'x' | 'y' | 'width' | 'height'> | null,
): boolean {
  if (!drawRect || drawRect.width <= 0 || drawRect.height <= 0) {
    return false;
  }

  return (
    point.canvasX >= drawRect.x &&
    point.canvasY >= drawRect.y &&
    point.canvasX <= drawRect.x + drawRect.width &&
    point.canvasY <= drawRect.y + drawRect.height
  );
}

export function resolveInpaintBrushPreviewPoint(
  point: Pick<ImagePointerPoint, 'canvasX' | 'canvasY'>,
  drawRect: Pick<DrawRect, 'x' | 'y' | 'width' | 'height'> | null,
): { x: number; y: number } | null {
  if (!isInpaintCanvasPointInsideDrawRect(point, drawRect)) {
    return null;
  }

  return {
    x: point.canvasX,
    y: point.canvasY,
  };
}

export function resolveInpaintCanvasLocalPoint(params: {
  clientX: number;
  clientY: number;
  canvasBounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
  viewport: Pick<CanvasViewport, 'width' | 'height'>;
}): { canvasX: number; canvasY: number } | null {
  const {
    clientX,
    clientY,
    canvasBounds,
    viewport,
  } = params;
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(canvasBounds.left) ||
    !Number.isFinite(canvasBounds.top) ||
    !Number.isFinite(canvasBounds.width) ||
    !Number.isFinite(canvasBounds.height) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    canvasBounds.width <= 0 ||
    canvasBounds.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }

  return {
    canvasX: (clientX - canvasBounds.left) * (viewport.width / canvasBounds.width),
    canvasY: (clientY - canvasBounds.top) * (viewport.height / canvasBounds.height),
  };
}

export function resolveInpaintImagePointerPoint(params: {
  canvasX: number;
  canvasY: number;
  imageWidth: number;
  imageHeight: number;
  drawRect: Pick<DrawRect, 'x' | 'y' | 'width' | 'height'> | null;
}): ImagePointerPoint | null {
  const {
    canvasX,
    canvasY,
    imageWidth,
    imageHeight,
    drawRect,
  } = params;
  if (
    !Number.isFinite(canvasX) ||
    !Number.isFinite(canvasY) ||
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    !drawRect ||
    !isInpaintCanvasPointInsideDrawRect({ canvasX, canvasY }, drawRect)
  ) {
    return null;
  }

  const rect = drawRect;
  return {
    x: clamp(((canvasX - rect.x) / rect.width) * imageWidth, 0, imageWidth - 1),
    y: clamp(((canvasY - rect.y) / rect.height) * imageHeight, 0, imageHeight - 1),
    canvasX,
    canvasY,
  };
}

function drawStrokeSegment(
  context: CanvasRenderingContext2D,
  stroke: Pick<AIImageInpaintMaskStroke, 'tool' | 'brushSize'>,
  from: AIImageInpaintMaskPoint | null,
  to: AIImageInpaintMaskPoint,
): void {
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
    context.strokeStyle = `rgba(255, 0, 0, ${MARK_ALPHA / 255})`;
    context.fillStyle = `rgba(255, 0, 0, ${MARK_ALPHA / 255})`;
  }

  context.beginPath();
  if (from) {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  } else {
    context.arc(to.x, to.y, stroke.brushSize / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function toPreviewMaskPoint(
  point: AIImageInpaintMaskPoint,
  image: Pick<LoadedImageState, 'width' | 'height'>,
  drawRect: DrawRect,
): AIImageInpaintMaskPoint {
  return {
    x: drawRect.x + (point.x / image.width) * drawRect.width,
    y: drawRect.y + (point.y / image.height) * drawRect.height,
  };
}

function getPreviewBrushSize(
  sourceBrushSize: number,
  image: Pick<LoadedImageState, 'width' | 'height'>,
  drawRect: DrawRect,
): number {
  const scaleX = drawRect.width / image.width;
  const scaleY = drawRect.height / image.height;
  return Math.max(1, sourceBrushSize * Math.min(scaleX, scaleY));
}

function drawPreviewStrokeSegment(params: {
  canvas: HTMLCanvasElement;
  viewport: CanvasViewport;
  image: Pick<LoadedImageState, 'width' | 'height'>;
  drawRect: DrawRect;
  stroke: Pick<AIImageInpaintMaskStroke, 'tool' | 'brushSize'>;
  from: AIImageInpaintMaskPoint | null;
  to: AIImageInpaintMaskPoint;
}): void {
  const {
    canvas,
    viewport,
    image,
    drawRect,
    stroke,
    from,
    to,
  } = params;
  const context = getCanvasContext(canvas);
  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  drawStrokeSegment(
    context,
    {
      tool: stroke.tool,
      brushSize: getPreviewBrushSize(stroke.brushSize, image, drawRect),
    },
    from ? toPreviewMaskPoint(from, image, drawRect) : null,
    toPreviewMaskPoint(to, image, drawRect),
  );
  context.setTransform(1, 0, 0, 1, 0, 0);
}

export const InpaintCanvasEditor: React.FC<InpaintCanvasEditorProps> = ({
  nodeId,
  sourceNode,
  maskMode,
  maskStrokes,
  maskSourceFileId,
  maskSourceWidth,
  maskSourceHeight,
  disabled = false,
  deferPreviewResize = false,
  workflowId,
  authScope,
  onStateChange,
  onMaskDraftStateChange,
  onMaskSnapshotCommit,
}) => {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushPreviewRef = useRef<HTMLDivElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRectRef = useRef<DrawRect | null>(null);
  const loadedImageRef = useRef<LoadedImageState | null>(null);
  const sourceImageDataRef = useRef<ImageData | null>(null);
  const isPointerDownRef = useRef(false);
  const activeStrokeRef = useRef<AIImageInpaintMaskStroke | null>(null);
  const pendingStrokePointsRef = useRef<ImagePointerPoint[]>([]);
  const pendingBrushPreviewPointRef = useRef<ImagePointerPoint | null>(null);
  const sourceResourceNodeRef = useRef<FileNodeData | null>(sourceNode);
  const sourceResourceOptionsRef = useRef<{
    workflowId?: string | null;
    authScope?: string | null;
    version?: string | number | null;
    etag?: string | null;
  }>({});
  const redrawFrameIdRef = useRef<number | null>(null);
  const strokeFrameIdRef = useRef<number | null>(null);
  const brushPreviewFrameIdRef = useRef<number | null>(null);
  const flushStrokeFrameNowRef = useRef<(() => void) | null>(null);
  const commitMaskSnapshotRef = useRef<(() => AIImageInpaintMaskSnapshot | null) | null>(null);
  const autoCommitTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastCommittedSnapshotSignatureRef = useRef<string | null>(null);
  const lastRestoredPersistedSnapshotSignatureRef = useRef<string | null>(null);
  const activeSourceLoadSignatureRef = useRef<SourceLoadSignature | null>(null);
  const sourceResourceHandleRef = useRef<FileResourceHandle | null>(null);
  const sourceResourceSequenceRef = useRef(0);
  const resolvedSourceResourceKeyRef = useRef<string | null>(null);
  const maskStrokesRef = useRef<AIImageInpaintMaskStroke[]>(maskStrokes);
  const draftStrokesRef = useRef<AIImageInpaintMaskStroke[]>(cloneInpaintMaskStrokes(maskStrokes));
  const draftRef = useRef<AIImageInpaintMaskDraft>({
    draftStrokes: draftStrokesRef.current,
    dirty: false,
    hasMarks: false,
    sourceInfo: null,
  });
  const lastNotifiedDraftStateRef = useRef<AIImageInpaintMaskDraftState | null>(null);
  const viewportRef = useRef<CanvasViewport>({ width: 1, height: 1, dpr: 1, ready: false });
  const hasMarksRef = useRef(false);
  const hasBrushPreviewRef = useRef(false);
  const [tool, setTool] = useState<AIImageInpaintTool>('brush');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [hasBrushPreview, setHasBrushPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hasMarks, setHasMarks] = useState(false);
  const [loadedImage, setLoadedImage] = useState<LoadedImageState | null>(null);
  const [viewportSize, setViewportSize] = useState<CanvasViewport>({
    width: 1,
    height: 1,
    dpr: 1,
    ready: false,
  });
  const [sourceResource, setSourceResource] = useState<InpaintEditorSourceResourceState>(() => ({
    loading: false,
    revision: 0,
  }));
  const sourceResourceRef = useRef<InpaintEditorSourceResourceState>(sourceResource);
  const sourceNodeId = sourceNode?.id.value ?? '';
  const sourceFileId = sourceNode?.fileId ?? '';
  const hasSourceNode = Boolean(sourceNode);
  const sourceImageAsset = sourceNode?.imageAsset;
  const sourceOriginalVariant = sourceImageAsset?.variants.original;
  const sourceOriginalVersion = sourceImageAsset?.version ?? null;
  const sourceOriginalEtag = typeof sourceOriginalVariant?.updatedAt === 'number'
    ? String(sourceOriginalVariant.updatedAt)
    : null;
  const sourceResourceKey = [
    sourceNodeId,
    sourceFileId,
    sourceNode?.backendFileId ?? '',
    sourceNode?.source.type ?? '',
    sourceNode?.fileName ?? '',
    sourceNode?.mimeType ?? '',
    sourceOriginalVariant?.url ?? '',
    sourceOriginalVersion ?? '',
    sourceOriginalEtag ?? '',
    sourceNode?.metadata.width ?? '',
    sourceNode?.metadata.height ?? '',
    workflowId ?? '',
    authScope ?? '',
  ].join('|');
  sourceResourceNodeRef.current = sourceNode;
  sourceResourceOptionsRef.current = {
    workflowId,
    authScope,
    version: sourceOriginalVersion,
    etag: sourceOriginalEtag,
  };

  useEffect(() => {
    sourceResourceRef.current = sourceResource;
  }, [sourceResource]);

  const sourceLoadResult = useMemo(
    () => resolveInpaintSourceImageLoadUrl(sourceNode, sourceResource.url, sourceResource.loading),
    [
      sourceResource.loading,
      sourceResource.url,
      sourceFileId,
      sourceImageAsset,
      sourceNode,
      sourceNodeId,
    ],
  );
  const sourceLoadUrl = sourceLoadResult.kind === 'original' ? sourceLoadResult.url : undefined;
  const sourceLoadSignature = useMemo<SourceLoadSignature | null>(() => (
    hasSourceNode && sourceLoadUrl
      ? {
        sourceNodeId,
        sourceFileId,
        sourceLoadUrl,
      }
      : null
  ), [hasSourceNode, sourceFileId, sourceLoadUrl, sourceNodeId]);

  const canEdit = Boolean(sourceNode && loadedImage && !disabled);
  const canShowBrushPreview = Boolean(canEdit && hasBrushPreview);
  const canHideSystemCursor = canShowBrushPreview;
  const previewStateMessage = useMemo(() => {
    if (loadError) {
      return null;
    }

    if (renderError) {
      return null;
    }

    if (!loadedImage) {
      return DEFAULT_IMAGE_LOADING_MESSAGE;
    }

    if (!viewportSize.ready) {
      return DEFAULT_CANVAS_PENDING_MESSAGE;
    }

    return null;
  }, [loadError, loadedImage, renderError, sourceLoadUrl, viewportSize.ready]);
  const sourceAspectStyle = useMemo<InpaintEditorFrameStyle>(() => {
    const image = loadedImage;
    if (!image || image.width <= 0 || image.height <= 0) {
      return {};
    }

    return {
      '--inpaint-source-aspect-ratio': `${image.width} / ${image.height}`,
    };
  }, [loadedImage]);
  const brushPreviewStyle = useMemo<React.CSSProperties>(() => ({
    width: brushSize,
    height: brushSize,
  }), [brushSize]);
  const canvasClasses = [
    'ai-image-inpaint-editor__canvas nodrag nopan',
    canHideSystemCursor ? 'ai-image-inpaint-editor__canvas--custom-cursor' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    viewportRef.current = viewportSize;
  }, [viewportSize]);

  const updateHasMarks = useCallback((nextHasMarks: boolean): void => {
    if (hasMarksRef.current === nextHasMarks) {
      return;
    }

    hasMarksRef.current = nextHasMarks;
    draftRef.current = {
      ...draftRef.current,
      hasMarks: nextHasMarks,
    };
    setHasMarks(nextHasMarks);
  }, []);

  const getCurrentSourceInfo = useCallback((): AIImageInpaintMaskSourceInfo | null => {
    const image = loadedImageRef.current;
    if (!image || sourceFileId.length === 0) {
      return null;
    }

    return {
      fileId: sourceFileId,
      width: image.width,
      height: image.height,
    };
  }, [sourceFileId]);

  const getMaskDraftState = useCallback((): AIImageInpaintMaskDraftState => ({
    hasMarks: draftRef.current.hasMarks,
    dirty: draftRef.current.dirty,
    sourceInfo: getCurrentSourceInfo() ?? draftRef.current.sourceInfo,
  }), [getCurrentSourceInfo]);

  const notifyMaskDraftState = useCallback((state = getMaskDraftState()): void => {
    const lastState = lastNotifiedDraftStateRef.current;
    if (lastState && areInpaintMaskDraftStatesEqual(lastState, state)) {
      return;
    }

    lastNotifiedDraftStateRef.current = {
      hasMarks: state.hasMarks,
      dirty: state.dirty,
      sourceInfo: state.sourceInfo ? { ...state.sourceInfo } : null,
    };
    onMaskDraftStateChange?.(state);
  }, [getMaskDraftState, onMaskDraftStateChange]);

  const clearMaskDraftState = useCallback((params?: {
    sourceInfo?: AIImageInpaintMaskSourceInfo | null;
    dirty?: boolean;
  }): void => {
    const sourceInfo = params?.sourceInfo ?? null;
    draftStrokesRef.current = [];
    maskStrokesRef.current = [];
    activeStrokeRef.current = null;
    pendingStrokePointsRef.current = [];
    if (maskCanvasRef.current) {
      clearCanvas(maskCanvasRef.current);
    }
    if (previewMaskCanvasRef.current) {
      clearCanvas(previewMaskCanvasRef.current);
    }
    draftRef.current = {
      draftStrokes: draftStrokesRef.current,
      dirty: params?.dirty ?? false,
      hasMarks: false,
      sourceInfo,
    };
    updateHasMarks(false);
    notifyMaskDraftState();
  }, [notifyMaskDraftState, updateHasMarks]);

  const releaseSourceResourceHandle = useCallback((): void => {
    sourceResourceHandleRef.current?.release();
    sourceResourceHandleRef.current = null;
  }, []);

  const clearLoadedOriginalImage = useCallback((options: { clearMask: boolean }): void => {
    loadedImageRef.current = null;
    sourceImageDataRef.current = null;
    maskCanvasRef.current = null;
    lastRestoredPersistedSnapshotSignatureRef.current = null;
    drawRectRef.current = null;
    baseCanvasRef.current && clearCanvas(baseCanvasRef.current);
    previewMaskCanvasRef.current && clearCanvas(previewMaskCanvasRef.current);
    setLoadedImage(null);
    if (options.clearMask) {
      clearMaskDraftState();
    }
  }, [clearMaskDraftState]);

  useEffect(() => {
    notifyMaskDraftState();
  }, [notifyMaskDraftState]);

  useEffect(() => {
    const resourceNode = sourceResourceNodeRef.current;
    const resourceOptions = sourceResourceOptionsRef.current;

    if (!resourceNode) {
      sourceResourceSequenceRef.current += 1;
      resolvedSourceResourceKeyRef.current = null;
      releaseSourceResourceHandle();
      if (activeSourceLoadSignatureRef.current) {
        activeSourceLoadSignatureRef.current = null;
        clearLoadedOriginalImage({ clearMask: true });
      } else if (loadedImageRef.current) {
        clearLoadedOriginalImage({ clearMask: true });
      }
      setSourceResource((current) => (
        current.url || current.error || current.loading
          ? { loading: false, revision: current.revision + 1 }
          : current
      ));
      return undefined;
    }

    const currentResource = sourceResourceRef.current;
    if (!shouldResolveInpaintSourceResource({
      currentKey: resolvedSourceResourceKeyRef.current,
      nextKey: sourceResourceKey,
      currentUrl: currentResource.url,
      currentLoading: currentResource.loading,
      currentError: currentResource.error,
    })) {
      return undefined;
    }

    let cancelled = false;
    const sequence = sourceResourceSequenceRef.current + 1;
    sourceResourceSequenceRef.current = sequence;

    const releaseCurrentHandle = (): void => {
      releaseSourceResourceHandle();
    };

    setSourceResource((current) => ({
      url: current.url,
      diagnostics: current.diagnostics,
      revision: current.revision + 1,
      loading: true,
    }));

    void resolveFileResource(resourceNode, {
      purpose: 'inpaint-editor-original',
      require: 'displayUrl',
      workflowId: resourceOptions.workflowId,
      authScope: resourceOptions.authScope,
      version: resourceOptions.version,
      etag: resourceOptions.etag,
      owner: `inpaint-editor:${nodeId}:${resourceNode.id.value}:${resourceNode.fileId}`,
    }).then((handle) => {
      if (cancelled || sourceResourceSequenceRef.current !== sequence) {
        handle.release();
        return;
      }
      if (activeSourceLoadSignatureRef.current?.sourceNodeId !== resourceNode.id.value
        || activeSourceLoadSignatureRef.current?.sourceFileId !== resourceNode.fileId) {
        activeSourceLoadSignatureRef.current = null;
        clearLoadedOriginalImage({ clearMask: true });
      }

      const displayUrl = handle.displayUrl ?? handle.objectUrl;
      if (!displayUrl) {
        handle.release();
        if (!cancelled && sourceResourceSequenceRef.current === sequence) {
          releaseCurrentHandle();
          if (activeSourceLoadSignatureRef.current?.sourceNodeId !== resourceNode.id.value
            || activeSourceLoadSignatureRef.current?.sourceFileId !== resourceNode.fileId) {
            activeSourceLoadSignatureRef.current = null;
            clearLoadedOriginalImage({ clearMask: true });
          }
          setSourceResource((current) => ({
            loading: false,
            revision: current.revision + 1,
            error: DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE,
          }));
        }
        return;
      }

      releaseCurrentHandle();
      sourceResourceHandleRef.current = handle;
      resolvedSourceResourceKeyRef.current = sourceResourceKey;
      setSourceResource((current) => ({
        url: displayUrl,
        loading: false,
        revision: current.revision + 1,
      }));
    }).catch((error: unknown) => {
      if (cancelled || sourceResourceSequenceRef.current !== sequence) {
        return;
      }

      releaseCurrentHandle();
      resolvedSourceResourceKeyRef.current = null;
      if (activeSourceLoadSignatureRef.current?.sourceNodeId !== resourceNode.id.value
        || activeSourceLoadSignatureRef.current?.sourceFileId !== resourceNode.fileId) {
        activeSourceLoadSignatureRef.current = null;
        clearLoadedOriginalImage({ clearMask: true });
      }
      setSourceResource((current) => ({
        loading: false,
        revision: current.revision + 1,
        error: error instanceof Error ? error.message : DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE,
        diagnostics: getFileResourceDiagnostics(error),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearLoadedOriginalImage,
    nodeId,
    releaseSourceResourceHandle,
    sourceResourceKey,
  ]);

  const clearAutoCommitTimer = useCallback((): void => {
    if (autoCommitTimerRef.current === null) {
      return;
    }

    window.clearTimeout(autoCommitTimerRef.current);
    autoCommitTimerRef.current = null;
  }, []);

  const updateBrushPreview = useCallback((point: { x: number; y: number } | null): void => {
    const preview = brushPreviewRef.current;
    if (!point || !canEdit) {
      if (preview) {
        preview.style.transform = 'translate(-9999px, -9999px)';
      }
      if (hasBrushPreviewRef.current) {
        hasBrushPreviewRef.current = false;
        setHasBrushPreview(false);
      }
      return;
    }

    if (preview) {
      preview.style.transform = `translate(${point.x - brushSize / 2}px, ${point.y - brushSize / 2}px)`;
    }
    if (!hasBrushPreviewRef.current) {
      hasBrushPreviewRef.current = true;
      setHasBrushPreview(true);
    }
  }, [brushSize, canEdit]);

  const scheduleBrushPreviewUpdate = useCallback((point: ImagePointerPoint | null): void => {
    pendingBrushPreviewPointRef.current = point;
    if (brushPreviewFrameIdRef.current !== null) {
      return;
    }

    brushPreviewFrameIdRef.current = window.requestAnimationFrame(() => {
      brushPreviewFrameIdRef.current = null;
      const pendingPoint = pendingBrushPreviewPointRef.current;
      const previewPoint = pendingPoint
        ? resolveInpaintBrushPreviewPoint(pendingPoint, drawRectRef.current)
        : null;
      updateBrushPreview(previewPoint);
    });
  }, [updateBrushPreview]);

  const syncDisplayCanvasSize = useCallback((): CanvasViewport | null => {
    const baseCanvas = baseCanvasRef.current;
    const previewMaskCanvas = previewMaskCanvasRef.current;
    const frame = baseCanvas?.parentElement;
    const stage = frame?.parentElement;
    if (!baseCanvas || !previewMaskCanvas || !frame || !stage) {
      return null;
    }

    const stageSize = resolveInpaintCanvasElementLayoutSize(stage);
    const image = loadedImageRef.current;
    const frameSize = resolveInpaintAspectFitSize({
      containerWidth: stageSize.width,
      containerHeight: stageSize.height,
      imageWidth: image?.width,
      imageHeight: image?.height,
    });
    if (frameSize) {
      frame.style.width = `${frameSize.width}px`;
      frame.style.height = `${frameSize.height}px`;
    }

    const nextViewport = resizeDisplayCanvas(baseCanvas, frame);
    resizeCanvasToViewport(previewMaskCanvas, nextViewport);
    viewportRef.current = nextViewport;
    setViewportSize((current) => (
      areCanvasViewportsEqual(current, nextViewport) ? current : nextViewport
    ));
    return nextViewport;
  }, []);

  const renderBaseLayer = useCallback((viewport = viewportRef.current): DrawRect | null => {
    const canvas = baseCanvasRef.current;
    const image = loadedImageRef.current?.image;
    if (!canvas || !image) {
      drawRectRef.current = null;
      baseCanvasRef.current && clearCanvas(baseCanvasRef.current);
      previewMaskCanvasRef.current && clearCanvas(previewMaskCanvasRef.current);
      return null;
    }

    if (!viewport.ready) {
      return null;
    }

    try {
      const context = getCanvasContext(canvas);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const rect = resolveInpaintImageDrawRect({
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        canvasWidth: viewport.width,
        canvasHeight: viewport.height,
      }) ?? {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      };
      drawRectRef.current = rect;
      setRenderError(null);
      return rect;
    } catch (error) {
      drawRectRef.current = null;
      setRenderError(error instanceof Error ? error.message : DEFAULT_PREVIEW_RENDER_ERROR_MESSAGE);
      return null;
    }
  }, []);

  const getMaskCanvas = useCallback((width: number, height: number): HTMLCanvasElement => {
    let canvas = maskCanvasRef.current;
    if (!canvas) {
      canvas = createReadableCanvas();
      maskCanvasRef.current = canvas;
    }
    ensureCanvasPixelSize(canvas, width, height);
    return canvas;
  }, []);

  const renderMaskCanvasFromStrokes = useCallback((
    width: number,
    height: number,
    strokes: readonly AIImageInpaintMaskStroke[],
  ): HTMLCanvasElement => {
    const canvas = getMaskCanvas(width, height);
    const context = getCanvasContext(canvas);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    strokes.forEach((stroke) => {
      stroke.points.forEach((point, index) => {
        drawStrokeSegment(
          context,
          stroke,
          index > 0 ? stroke.points[index - 1] : null,
          point,
        );
      });
    });
    return canvas;
  }, [getMaskCanvas]);

  const renderPreviewMaskLayer = useCallback((params?: {
    viewport?: CanvasViewport;
    drawRect?: DrawRect | null;
  }): boolean => {
    const previewCanvas = previewMaskCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const image = loadedImageRef.current;
    const viewport = params?.viewport ?? viewportRef.current;
    const drawRect = params?.drawRect ?? drawRectRef.current;
    if (!previewCanvas) {
      return false;
    }

    const context = getCanvasContext(previewCanvas);
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (!viewport.ready) {
      return false;
    }

    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!maskCanvas || !image || !drawRect) {
      return false;
    }

    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    context.drawImage(maskCanvas, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }, []);

  const redraw = useCallback((): boolean => {
    const viewport = syncDisplayCanvasSize() ?? viewportRef.current;
    const rect = renderBaseLayer(viewport);
    renderPreviewMaskLayer({ viewport, drawRect: rect });
    return Boolean(rect);
  }, [renderBaseLayer, renderPreviewMaskLayer, syncDisplayCanvasSize]);

  const cancelScheduledRedraw = useCallback((): void => {
    if (redrawFrameIdRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(redrawFrameIdRef.current);
    redrawFrameIdRef.current = null;
  }, []);

  const scheduleRedraw = useCallback((): void => {
    if (deferPreviewResize) {
      cancelScheduledRedraw();
      return;
    }

    if (redrawFrameIdRef.current !== null) {
      return;
    }

    redrawFrameIdRef.current = window.requestAnimationFrame(() => {
      redrawFrameIdRef.current = null;
      redraw();
    });
  }, [cancelScheduledRedraw, deferPreviewResize, redraw]);

  const exportMaskBlob = useCallback(async (mode: AIImageInpaintMaskMode): Promise<Blob> => {
    flushStrokeFrameNowRef.current?.();
    const imageData = sourceImageDataRef.current;
    const image = loadedImageRef.current;
    if (!imageData) {
      throw new Error('原图尚未准备完成，无法导出局部重绘遮罩。');
    }

    if (!image || image.width !== imageData.width || image.height !== imageData.height) {
      throw new Error('原图尚未准备完成，无法导出局部重绘遮罩。');
    }

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || maskCanvas.width !== imageData.width || maskCanvas.height !== imageData.height) {
      throw new Error('请先在原图上标记需要局部重绘的区域。');
    }

    const finalMask = canvasImageDataToImageDataLike(
      getCanvasContext(maskCanvas, { willReadFrequently: true }).getImageData(0, 0, imageData.width, imageData.height),
    );
    if (!hasMaskMarks(finalMask)) {
      throw new Error('请先在原图上标记需要局部重绘的区域。');
    }

    const exported = exportInpaintMaskImageDataFromMask({
      source: imageData,
      mask: finalMask,
      mode,
    });
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exported.width;
    exportCanvas.height = exported.height;
    const exportContext = getCanvasContext(exportCanvas);
    exportContext.putImageData(imageDataLikeToCanvasImageData(exportContext, exported), 0, 0);

    const blob = await canvasToPngBlob(exportCanvas);
    commitMaskSnapshotRef.current?.();
    return blob;
  }, []);

  useEffect(() => {
    if (!sourceLoadSignature) {
      if (hasSourceNode && !sourceLoadResult.hasOriginalSource) {
        setLoadError(sourceResource.loading
          ? null
          : sourceResource.error ?? DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE);
        setRenderError(null);
        if (!sourceResource.loading
          && activeSourceLoadSignatureRef.current
          && activeSourceLoadSignatureRef.current.sourceFileId !== sourceFileId) {
          activeSourceLoadSignatureRef.current = null;
          clearLoadedOriginalImage({ clearMask: true });
        }
        return undefined;
      }

      if (hasSourceNode && activeSourceLoadSignatureRef.current?.sourceFileId === sourceFileId) {
        if (!loadedImageRef.current && sourceResource.error) {
          setLoadError(sourceResource.error);
          setRenderError(null);
        }
        return undefined;
      }

      if (hasSourceNode) {
        if (activeSourceLoadSignatureRef.current) {
          activeSourceLoadSignatureRef.current = null;
          clearLoadedOriginalImage({ clearMask: true });
        }
        setLoadError(sourceResource.error ?? null);
        setRenderError(null);
        return undefined;
      }

      const transition = resolveInpaintSourceLoadTransition(
        activeSourceLoadSignatureRef.current,
        null,
      );
      if (!activeSourceLoadSignatureRef.current || (hasSourceNode && !transition.shouldClearPreviousSource)) {
        return undefined;
      }
      activeSourceLoadSignatureRef.current = null;
      clearLoadedOriginalImage({ clearMask: true });
      setLoadError(hasSourceNode ? sourceResource.error ?? null : null);
      setRenderError(null);
      return undefined;
    }

    if (areInpaintSourceLoadSignaturesEqual(
      activeSourceLoadSignatureRef.current,
      sourceLoadSignature,
    )) {
      if (loadedImageRef.current && sourceImageDataRef.current) {
        return undefined;
      }
    }

    let cancelled = false;
    let objectUrlToRevoke: string | null = null;
    const transition = resolveInpaintSourceLoadTransition(
      activeSourceLoadSignatureRef.current,
      sourceLoadSignature,
    );
    activeSourceLoadSignatureRef.current = sourceLoadSignature;
    setLoadError(null);
    setRenderError(null);
    if (transition.shouldResetLoadedImage && (!loadedImageRef.current || loadedImageRef.current.src !== sourceLoadSignature.sourceLoadUrl)) {
      clearLoadedOriginalImage({ clearMask: transition.shouldClearPreviousSource });
    }

    const src = sourceLoadSignature.sourceLoadUrl.startsWith('data:')
      ? (() => {
        objectUrlToRevoke = dataUrlToObjectUrl(sourceLoadSignature.sourceLoadUrl);
        return objectUrlToRevoke;
      })()
      : sourceLoadSignature.sourceLoadUrl;

    void loadImage(src)
      .then((nextImage) => {
        if (cancelled) {
          return;
        }

        if (!areInpaintSourceLoadSignaturesEqual(activeSourceLoadSignatureRef.current, sourceLoadSignature)) {
          return;
        }

        let sourceImageData: ImageData;
        try {
          const sourceCanvas = createReadableCanvas();
          sourceCanvas.width = nextImage.width;
          sourceCanvas.height = nextImage.height;
          const sourceContext = getCanvasContext(sourceCanvas, { willReadFrequently: true });
          sourceContext.drawImage(nextImage.image, 0, 0, nextImage.width, nextImage.height);
          sourceImageData = sourceContext.getImageData(0, 0, nextImage.width, nextImage.height);
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : '读取原图像素失败，无法导出遮罩。');
          releaseSourceResourceHandle();
          setSourceResource((current) => ({
            loading: false,
            revision: current.revision + 1,
            error: error instanceof Error ? error.message : DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE,
          }));
          clearLoadedOriginalImage({ clearMask: transition.shouldClearPreviousSource });
          return;
        }

        loadedImageRef.current = nextImage;
        sourceImageDataRef.current = sourceImageData;
        getMaskCanvas(nextImage.width, nextImage.height);
        setSourceResource((current) => (
          current.error ? { ...current, error: undefined } : current
        ));
        draftRef.current = {
          ...draftRef.current,
          dirty: false,
          sourceInfo: {
            fileId: sourceFileId,
            width: nextImage.width,
            height: nextImage.height,
          },
        };
        setLoadedImage(nextImage);
        notifyMaskDraftState();
        window.requestAnimationFrame(() => {
          if (!cancelled) {
            scheduleRedraw();
          }
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (!areInpaintSourceLoadSignaturesEqual(activeSourceLoadSignatureRef.current, sourceLoadSignature)) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : '原图加载失败。');
        releaseSourceResourceHandle();
        setSourceResource((current) => ({
          loading: false,
          revision: current.revision + 1,
          error: error instanceof Error ? error.message : DEFAULT_ORIGINAL_UNAVAILABLE_MESSAGE,
        }));
        clearLoadedOriginalImage({ clearMask: transition.shouldClearPreviousSource });
      });

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [
    hasSourceNode,
    clearLoadedOriginalImage,
    getMaskCanvas,
    scheduleRedraw,
    releaseSourceResourceHandle,
    sourceLoadResult.hasOriginalSource,
    sourceLoadSignature,
    sourceFileId,
    sourceResource.error,
    sourceResource.loading,
    notifyMaskDraftState,
  ]);

  useEffect(() => {
    const canvas = baseCanvasRef.current;
    const frame = canvas?.parentElement;
    const stage = frame?.parentElement;
    if (!canvas || !frame || !stage) {
      return undefined;
    }
    if (typeof ResizeObserver === 'undefined') {
      if (!deferPreviewResize) {
        syncDisplayCanvasSize();
        scheduleRedraw();
      }
      return undefined;
    }

    const handleResize = () => {
      if (deferPreviewResize) {
        return;
      }
      syncDisplayCanvasSize();
      scheduleRedraw();
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(stage);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, [deferPreviewResize, scheduleRedraw, syncDisplayCanvasSize]);

  useEffect(() => {
    scheduleRedraw();
  }, [loadedImage, scheduleRedraw, viewportSize]);

  useEffect(() => {
    if (deferPreviewResize) {
      return;
    }

    redraw();
  }, [deferPreviewResize, redraw]);

  const getImagePointFromClient = useCallback((point: InpaintPointerCoordinate): ImagePointerPoint | null => {
    const canvas = baseCanvasRef.current;
    if (!drawRectRef.current && loadedImageRef.current) {
      redraw();
    }

    const rect = drawRectRef.current;
    const image = loadedImageRef.current;
    if (!canvas || !rect || !image) {
      return null;
    }

    const canvasBounds = canvas.getBoundingClientRect();
    const localPoint = resolveInpaintCanvasLocalPoint({
      clientX: point.clientX,
      clientY: point.clientY,
      canvasBounds,
      viewport: viewportRef.current,
    });
    if (!localPoint) {
      return null;
    }

    return resolveInpaintImagePointerPoint({
      canvasX: localPoint.canvasX,
      canvasY: localPoint.canvasY,
      imageWidth: image.width,
      imageHeight: image.height,
      drawRect: rect,
    });
  }, [redraw]);

  const getImagePointsFromPointerEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): ImagePointerPoint[] => (
    getInpaintCoalescedPointerCoordinates(event)
      .map(getImagePointFromClient)
      .filter((point): point is ImagePointerPoint => point !== null)
  ), [getImagePointFromClient]);

  const getLastImagePointFromPointerEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): ImagePointerPoint | null => {
    const points = getImagePointsFromPointerEvent(event);
    return points[points.length - 1] ?? null;
  }, [getImagePointsFromPointerEvent]);

  const drawStrokePreview = useCallback((
    stroke: Pick<AIImageInpaintMaskStroke, 'tool' | 'brushSize'>,
    from: AIImageInpaintMaskPoint | null,
    to: AIImageInpaintMaskPoint,
  ) => {
    const image = loadedImageRef.current;
    const drawRect = drawRectRef.current;
    const previewMaskCanvas = previewMaskCanvasRef.current;
    if (!image || !drawRect || !previewMaskCanvas) {
      return;
    }

    const maskCanvas = getMaskCanvas(image.width, image.height);
    const context = getCanvasContext(maskCanvas);
    drawStrokeSegment(context, stroke, from, to);
    drawPreviewStrokeSegment({
      canvas: previewMaskCanvas,
      viewport: viewportRef.current,
      image,
      drawRect,
      stroke,
      from,
      to,
    });
    if (stroke.tool === 'brush') {
      updateHasMarks(true);
    }
  }, [getMaskCanvas, updateHasMarks]);

  const flushPendingStrokePoints = useCallback((): void => {
    strokeFrameIdRef.current = null;
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || pendingStrokePointsRef.current.length === 0) {
      pendingStrokePointsRef.current = [];
      return;
    }

    const points = pendingStrokePointsRef.current;
    pendingStrokePointsRef.current = [];
    points.forEach((point) => {
      const previousPoint = activeStroke.points[activeStroke.points.length - 1] ?? null;
      activeStroke.points.push({ x: point.x, y: point.y });
      drawStrokePreview(activeStroke, previousPoint, point);
    });
  }, [drawStrokePreview]);

  const scheduleStrokePointFlush = useCallback((): void => {
    if (strokeFrameIdRef.current !== null) {
      return;
    }

    strokeFrameIdRef.current = window.requestAnimationFrame(flushPendingStrokePoints);
  }, [flushPendingStrokePoints]);

  const queueStrokePoints = useCallback((points: readonly ImagePointerPoint[]): void => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || points.length === 0) {
      return;
    }

    const nextPoints: ImagePointerPoint[] = [];
    points.forEach((point) => {
      const previousPoint = nextPoints[nextPoints.length - 1]
        ?? pendingStrokePointsRef.current[pendingStrokePointsRef.current.length - 1]
        ?? activeStroke.points[activeStroke.points.length - 1]
        ?? null;
      if (previousPoint && areInpaintMaskPointsEqual(previousPoint, point)) {
        return;
      }

      nextPoints.push(point);
    });
    if (nextPoints.length === 0) {
      return;
    }

    pendingStrokePointsRef.current.push(...nextPoints);
    scheduleStrokePointFlush();
  }, [scheduleStrokePointFlush]);

  const flushStrokeFrameNow = useCallback((): void => {
    if (strokeFrameIdRef.current !== null) {
      window.cancelAnimationFrame(strokeFrameIdRef.current);
      strokeFrameIdRef.current = null;
    }
    flushPendingStrokePoints();
  }, [flushPendingStrokePoints]);

  useEffect(() => {
    flushStrokeFrameNowRef.current = flushStrokeFrameNow;
  }, [flushStrokeFrameNow]);

  const flushMaskDraft = useCallback((): void => {
    flushStrokeFrameNow();
    notifyMaskDraftState();
  }, [flushStrokeFrameNow, notifyMaskDraftState]);

  const commitMaskSnapshot = useCallback((): AIImageInpaintMaskSnapshot | null => {
    flushStrokeFrameNow();
    clearAutoCommitTimer();
    if (shouldDeferInpaintMaskSnapshotCommit({
      isPointerDown: isPointerDownRef.current,
      hasActiveStroke: Boolean(activeStrokeRef.current),
    })) {
      notifyMaskDraftState();
      return null;
    }

    const sourceInfo = getCurrentSourceInfo() ?? draftRef.current.sourceInfo;
    const signature = createAIImageInpaintMaskSnapshotSignature({
      strokes: draftStrokesRef.current,
      sourceInfo,
      hasMarks: draftRef.current.hasMarks,
    });
    if (!draftRef.current.dirty && lastCommittedSnapshotSignatureRef.current === signature) {
      notifyMaskDraftState();
      return sourceInfo
        ? {
          strokes: cloneInpaintMaskStrokes(draftStrokesRef.current),
          sourceInfo,
          hasMarks: draftRef.current.hasMarks,
          dirty: false,
        }
        : null;
    }

    lastCommittedSnapshotSignatureRef.current = signature;
    if (!sourceInfo) {
      onMaskSnapshotCommit?.(null);
      notifyMaskDraftState();
      return null;
    }

    const snapshot: AIImageInpaintMaskSnapshot = {
      strokes: cloneInpaintMaskStrokes(draftStrokesRef.current),
      sourceInfo,
      hasMarks: draftRef.current.hasMarks,
      dirty: draftRef.current.dirty,
    };
    maskStrokesRef.current = snapshot.strokes;
    draftStrokesRef.current = snapshot.strokes;
    draftRef.current = {
      ...draftRef.current,
      draftStrokes: draftStrokesRef.current,
      dirty: false,
      sourceInfo,
    };
    notifyMaskDraftState();
    onMaskSnapshotCommit?.(snapshot);
    return snapshot;
  }, [
    clearAutoCommitTimer,
    flushStrokeFrameNow,
    getCurrentSourceInfo,
    notifyMaskDraftState,
    onMaskSnapshotCommit,
  ]);

  useEffect(() => {
    commitMaskSnapshotRef.current = commitMaskSnapshot;
  }, [commitMaskSnapshot]);

  const scheduleMaskSnapshotCommit = useCallback((): void => {
    clearAutoCommitTimer();
    autoCommitTimerRef.current = window.setTimeout(() => {
      autoCommitTimerRef.current = null;
      if (shouldDeferInpaintMaskSnapshotCommit({
        isPointerDown: isPointerDownRef.current,
        hasActiveStroke: Boolean(activeStrokeRef.current),
      })) {
        return;
      }
      commitMaskSnapshot();
    }, MASK_SNAPSHOT_AUTO_COMMIT_DELAY_MS);
  }, [clearAutoCommitTimer, commitMaskSnapshot]);

  useEffect(() => {
    onStateChange?.({
      hasSource: Boolean(sourceNode),
      hasMarks,
      draftState: getMaskDraftState(),
      flushMaskDraft,
      commitMaskSnapshot,
      exportMaskBlob,
    });
  }, [
    commitMaskSnapshot,
    exportMaskBlob,
    flushMaskDraft,
    getMaskDraftState,
    hasMarks,
    onStateChange,
    sourceNode,
  ]);

  const syncBrushPreviewFromPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>): ImagePointerPoint | null => {
    if (!canEdit) {
      scheduleBrushPreviewUpdate(null);
      return null;
    }

    const point = getLastImagePointFromPointerEvent(event);
    scheduleBrushPreviewUpdate(point);
    return point;
  }, [canEdit, getLastImagePointFromPointerEvent, scheduleBrushPreviewUpdate]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit) {
      return;
    }
    if (!isPrimaryPointerButton(event)) {
      scheduleBrushPreviewUpdate(null);
      return;
    }

    stopPointerEvent(event);
    const point = syncBrushPreviewFromPointer(event);
    if (!point) {
      return;
    }

    clearAutoCommitTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingStrokePointsRef.current = [];
    const image = loadedImageRef.current;
    const activeStroke: AIImageInpaintMaskStroke = {
      id: createStrokeId(),
      tool,
      brushSize: image
        ? getInpaintBrushImagePixelSize(brushSize, image, drawRectRef.current)
        : brushSize,
      points: [{ x: point.x, y: point.y }],
    };
    isPointerDownRef.current = true;
    activeStrokeRef.current = activeStroke;
    drawStrokePreview(activeStroke, null, point);
  }, [
    brushSize,
    canEdit,
    clearAutoCommitTimer,
    drawStrokePreview,
    scheduleBrushPreviewUpdate,
    syncBrushPreviewFromPointer,
    tool,
  ]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit) {
      return;
    }

    const points = getImagePointsFromPointerEvent(event);
    const lastPoint = points[points.length - 1] ?? null;
    scheduleBrushPreviewUpdate(lastPoint);
    if (!lastPoint) {
      if (isPointerDownRef.current) {
        stopPointerEvent(event);
      }
      return;
    }

    if (!isPointerDownRef.current) {
      return;
    }

    stopPointerEvent(event);
    queueStrokePoints(points);
  }, [canEdit, getImagePointsFromPointerEvent, queueStrokePoints, scheduleBrushPreviewUpdate]);

  const handlePointerEnter = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    syncBrushPreviewFromPointer(event);
  }, [syncBrushPreviewFromPointer]);

  const finishPointerStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current) {
      return;
    }

    stopPointerEvent(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    queueStrokePoints(getImagePointsFromPointerEvent(event));
    flushStrokeFrameNow();
    const finishedStroke = activeStrokeRef.current;
    const image = loadedImageRef.current;
    const sourceFileId = getSourceFileId(sourceNode);
    isPointerDownRef.current = false;
    activeStrokeRef.current = null;
    pendingStrokePointsRef.current = [];

    if (!finishedStroke || !image || !sourceNode || sourceFileId.length === 0) {
      return;
    }

    draftStrokesRef.current = [...draftStrokesRef.current, finishedStroke];
    maskStrokesRef.current = draftStrokesRef.current;
    draftRef.current = {
      draftStrokes: draftStrokesRef.current,
      dirty: true,
      hasMarks: hasMarksRef.current,
      sourceInfo: {
        fileId: sourceFileId,
        width: image.width,
        height: image.height,
      },
    };
    notifyMaskDraftState();
    scheduleMaskSnapshotCommit();
  }, [
    flushStrokeFrameNow,
    getImagePointsFromPointerEvent,
    notifyMaskDraftState,
    queueStrokePoints,
    scheduleMaskSnapshotCommit,
    sourceNode,
  ]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    scheduleBrushPreviewUpdate(null);
    finishPointerStroke(event);
  }, [finishPointerStroke, scheduleBrushPreviewUpdate]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    scheduleBrushPreviewUpdate(null);
    finishPointerStroke(event);
  }, [finishPointerStroke, scheduleBrushPreviewUpdate]);

  const handleClearMarks = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stopPointerEvent(event);
    const image = loadedImageRef.current;
    if (!image) {
      return;
    }

    flushStrokeFrameNow();
    const sourceFileId = getSourceFileId(sourceNode);
    if (image && sourceNode && sourceFileId.length > 0) {
      const sourceInfo = {
        fileId: sourceFileId,
        width: image.width,
        height: image.height,
      };
      getMaskCanvas(image.width, image.height);
      lastRestoredPersistedSnapshotSignatureRef.current = [
        createInpaintMaskSourceSignature(sourceInfo),
        createAIImageInpaintMaskStrokesSignature([]),
      ].join('::');
      clearMaskDraftState({
        sourceInfo,
        dirty: true,
      });
      commitMaskSnapshot();
    }
  }, [
    clearMaskDraftState,
    commitMaskSnapshot,
    flushStrokeFrameNow,
    getMaskCanvas,
    sourceNode,
  ]);

  useEffect(() => () => {
    const commitMaskSnapshot = commitMaskSnapshotRef.current ?? (() => null);
    commitMaskSnapshot();
    clearAutoCommitTimer();
    sourceResourceSequenceRef.current += 1;
    releaseSourceResourceHandle();
    if (redrawFrameIdRef.current !== null) {
      window.cancelAnimationFrame(redrawFrameIdRef.current);
      redrawFrameIdRef.current = null;
    }
    if (strokeFrameIdRef.current !== null) {
      window.cancelAnimationFrame(strokeFrameIdRef.current);
      strokeFrameIdRef.current = null;
    }
    if (brushPreviewFrameIdRef.current !== null) {
      window.cancelAnimationFrame(brushPreviewFrameIdRef.current);
      brushPreviewFrameIdRef.current = null;
    }
  }, [clearAutoCommitTimer, releaseSourceResourceHandle]);

  useEffect(() => {
    const image = loadedImageRef.current;
    const sourceFileId = getSourceFileId(sourceNode);
    if (!image || !sourceNode || sourceFileId.length === 0) {
      return;
    }

    const sourceInfo = {
      fileId: sourceFileId,
      width: image.width,
      height: image.height,
    };
    if (shouldDeferInpaintMaskSnapshotCommit({
      isPointerDown: isPointerDownRef.current,
      hasActiveStroke: Boolean(activeStrokeRef.current),
    })) {
      return;
    }

    const sourceMatchesMask = areInpaintMaskSourceDimensionsMatched({
      sourceFileId,
      width: image.width,
      height: image.height,
      maskSourceFileId,
      maskSourceWidth,
      maskSourceHeight,
    });

    if (!sourceMatchesMask) {
      lastRestoredPersistedSnapshotSignatureRef.current = null;
      const hasPersistedMask = maskStrokes.length > 0
        || typeof maskSourceFileId === 'string'
        || typeof maskSourceWidth === 'number'
        || typeof maskSourceHeight === 'number';
      clearMaskDraftState({
        sourceInfo,
        dirty: hasPersistedMask,
      });
      if (hasPersistedMask) {
        commitMaskSnapshot();
      }
      scheduleRedraw();
      return;
    }

    const restoreSignature = [
      createInpaintMaskSourceSignature(sourceInfo),
      createAIImageInpaintMaskStrokesSignature(maskStrokes),
    ].join('::');
    if (lastRestoredPersistedSnapshotSignatureRef.current === restoreSignature) {
      return;
    }

    const nextMaskCanvas = renderMaskCanvasFromStrokes(image.width, image.height, maskStrokes);
    const nextMask = getCanvasContext(nextMaskCanvas, { willReadFrequently: true }).getImageData(0, 0, image.width, image.height);
    const nextHasMarks = hasMaskMarks(nextMask);
    lastRestoredPersistedSnapshotSignatureRef.current = restoreSignature;
    draftStrokesRef.current = cloneInpaintMaskStrokes(maskStrokes);
    maskStrokesRef.current = draftStrokesRef.current;
    draftRef.current = {
      ...draftRef.current,
      draftStrokes: draftStrokesRef.current,
      dirty: false,
      hasMarks: nextHasMarks,
      sourceInfo,
    };
    lastCommittedSnapshotSignatureRef.current = createAIImageInpaintMaskSnapshotSignature({
      strokes: draftStrokesRef.current,
      sourceInfo,
      hasMarks: nextHasMarks,
    });
    updateHasMarks(nextHasMarks);
    notifyMaskDraftState();
    scheduleRedraw();
  }, [
    clearMaskDraftState,
    commitMaskSnapshot,
    loadedImage,
    maskSourceFileId,
    maskSourceHeight,
    maskSourceWidth,
    maskStrokes,
    notifyMaskDraftState,
    renderMaskCanvasFromStrokes,
    scheduleRedraw,
    sourceNode,
    updateHasMarks,
  ]);

  return (
    <div
      className={[
        'ai-image-inpaint-editor',
        sourceNode ? 'ai-image-inpaint-editor--filled' : 'ai-image-inpaint-editor--empty',
        disabled ? 'ai-image-inpaint-editor--disabled' : '',
      ].filter(Boolean).join(' ')}
      data-node-dropzone="body"
      data-node-id={nodeId}
    >
      {sourceNode ? (
        <>
          <div className="ai-image-inpaint-editor__stage">
            <div
              className={[
                'ai-image-inpaint-editor__frame',
                loadedImage ? 'ai-image-inpaint-editor__frame--source-ratio' : '',
              ].filter(Boolean).join(' ')}
              style={sourceAspectStyle}
            >
              <canvas
                ref={baseCanvasRef}
                className="ai-image-inpaint-editor__canvas ai-image-inpaint-editor__canvas--base nodrag nopan"
                aria-hidden="true"
              />
              {loadedImage && (
                <img
                  className="ai-image-inpaint-editor__source-image"
                  src={loadedImage.src}
                  alt=""
                  draggable={false}
                />
              )}
              <canvas
                ref={previewMaskCanvasRef}
                className="ai-image-inpaint-editor__canvas ai-image-inpaint-editor__canvas--mask nodrag nopan"
                aria-hidden="true"
              />
              <canvas
                className={`${canvasClasses} ai-image-inpaint-editor__canvas--interaction`}
                aria-label="局部重绘遮罩编辑器"
                onMouseDown={stopPrimaryPointerEvent}
                onPointerEnter={handlePointerEnter}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerStroke}
                onPointerCancel={handlePointerCancel}
                onPointerLeave={handlePointerLeave}
              />
              {canEdit && (
                <div
                  ref={brushPreviewRef}
                  className={[
                    'ai-image-inpaint-editor__brush-preview',
                    tool === 'eraser' ? 'ai-image-inpaint-editor__brush-preview--eraser' : '',
                  ].filter(Boolean).join(' ')}
                  style={brushPreviewStyle}
                />
              )}
              {!loadedImage && !loadError && !previewStateMessage && (
                <div className="ai-image-inpaint-editor__state">正在加载原图</div>
              )}
              {previewStateMessage && (
                <div className="ai-image-inpaint-editor__state">
                  {previewStateMessage}
                </div>
              )}
              {loadError && (
                <div className="ai-image-inpaint-editor__state ai-image-inpaint-editor__state--error">
                  {loadError}
                </div>
              )}
              {!loadError && renderError && (
                <div className="ai-image-inpaint-editor__state ai-image-inpaint-editor__state--error">
                  {renderError}
                </div>
              )}
            </div>
          </div>

          <div className="ai-image-inpaint-editor__toolbar">
            <div className="ai-image-inpaint-editor__tool-group" role="group" aria-label="遮罩工具">
              <button
                type="button"
                className={[
                  'ai-image-inpaint-editor__tool-button nodrag nopan',
                  tool === 'brush' ? 'ai-image-inpaint-editor__tool-button--active' : '',
                ].filter(Boolean).join(' ')}
                aria-label="画笔"
                title="画笔"
                onMouseDown={stopPointerEvent}
                onClick={() => setTool('brush')}
                disabled={disabled}
              >
                <InpaintBrushIcon className="ai-image-inpaint-editor__button-icon" />
              </button>
              <button
                type="button"
                className={[
                  'ai-image-inpaint-editor__tool-button nodrag nopan',
                  tool === 'eraser' ? 'ai-image-inpaint-editor__tool-button--active' : '',
                ].filter(Boolean).join(' ')}
                aria-label="橡皮"
                title="橡皮"
                onMouseDown={stopPointerEvent}
                onClick={() => setTool('eraser')}
                disabled={disabled}
              >
                <InpaintEraserIcon className="ai-image-inpaint-editor__button-icon" />
              </button>
            </div>

            <label
              className="ai-image-inpaint-editor__size-control nodrag nopan"
              onMouseDown={stopControlPropagation}
              onPointerDown={stopControlPropagation}
              onClick={stopControlPropagation}
            >
              <span>笔刷</span>
              <input
                className="ai-image-inpaint-editor__size-range nodrag nopan"
                type="range"
                min={MIN_BRUSH_SIZE}
                max={MAX_BRUSH_SIZE}
                value={brushSize}
                onMouseDown={stopControlPropagation}
                onPointerDown={stopControlPropagation}
                onClick={stopControlPropagation}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                disabled={disabled}
              />
              <span className="ai-image-inpaint-editor__size-value">{brushSize}</span>
            </label>

            <button
              type="button"
              className="ai-image-inpaint-editor__clear-button ai-image-inpaint-editor__clear-button--icon-only nodrag nopan"
              aria-label="清除标记"
              title="清除标记"
              onMouseDown={stopPointerEvent}
              onClick={handleClearMarks}
              disabled={disabled || !hasMarks}
            >
              <InpaintTrashIcon className="ai-image-inpaint-editor__button-icon" />
              清除
            </button>
          </div>

          <div className={[
            'ai-image-inpaint-editor__mark-status',
            hasMarks ? 'ai-image-inpaint-editor__mark-status--ready' : '',
          ].filter(Boolean).join(' ')}>
            {hasMarks ? (maskMode === 'strong-mask' ? '强遮罩已就绪' : '柔和遮罩已就绪') : '在原图上涂抹需要重绘的区域'}


          </div>
        </>
      ) : (
        <div className="ai-image-inpaint-node__placeholder">
          连接一张图片输入后编辑局部重绘遮罩。
        </div>
      )}
    </div>
  );
};

InpaintCanvasEditor.displayName = 'InpaintCanvasEditor';

