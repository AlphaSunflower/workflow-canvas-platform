import type { NodeId, Position, Dimensions, ImageSourceInfo, NodeStatus, NodeType, Timestamp, RFNode } from './base.types';
import type { FileMetadata, FileSource } from './file.types';
import type { NodeTaskRef } from './task.types';

export type ImageAssetSource = 'unknown' | 'local' | 'remote';
export type ImageAssetVariantKind = 'thumbnail' | 'original';
export type NodeRenderTier = 'full' | 'compact' | 'minimal';
export type NodeActiveState = 'active' | 'passive';
export type FileNodeImageResourceOwner = 'dom' | 'raster' | 'none';
export type FileNodeActiveReason =
  | 'selected'
  | 'hovered'
  | 'dragging'
  | 'context-menu'
  | 'viewer'
  | 'preview-modal'
  | 'preview-playing'
  | 'resizing'
  | 'rotating'
  | 'import-error'
  | 'upload-active';

export interface ImageAssetIntrinsicSize {
  width: number;
  height: number;
}

export interface ImageAssetVariant {
  url?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  updatedAt?: number;
}

export interface ImageAssetVariants {
  thumbnail?: ImageAssetVariant;
  original?: ImageAssetVariant;
}

export interface ImageAsset {
  assetId?: string;
  source: ImageAssetSource;
  variants: ImageAssetVariants;
  intrinsicSize?: ImageAssetIntrinsicSize;
  version: number;
}

export interface BaseNodeData {
  id: NodeId;
  type: NodeType;
  position: Position;
  dimensions: Dimensions;
  rotation: number;
  scale: number;
  locked: boolean;
  status: NodeStatus;
  zIndex: number;
  timestamp: Timestamp;
  annotation?: string;
}

export interface FileNodeData extends BaseNodeData {
  type: 'image' | 'video' | 'ply';
  fileId: string;
  backendFileId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  source: FileSource;
  imageAsset?: ImageAsset;
  thumbnailUrl?: string;
  previewUrl?: string;
  metadata: FileMetadata;
  renderTier?: NodeRenderTier;
  activeState?: NodeActiveState;
  activeReasons?: FileNodeActiveReason[];
  imageResourceOwner?: FileNodeImageResourceOwner;
}

export interface FileImportSessionGuard {
  nodeId: string;
  fileId: string;
  sessionId: string;
}

export interface AINodeData extends BaseNodeData {
  type:
    | 'aiImageGen'
    | 'aiImageInpaint'
    | 'aiVideoGen'
    | 'aiImageToPly'
    | 'aiStoryboard'
    | 'aiMultiViewRestore'
    | 'aiModelRenderTransfer'
    | 'aiImageHd'
    | 'aiFloorplanColorize';
  references: NodeReference[];
  outputs: string[];
  config: AIConfig;
  tasks: NodeTaskRef[];
}

export interface AIImageInputGroup {
  id: string;
  label: string;
  order: number;
}

export type AIImageInpaintTool = 'brush' | 'eraser';

export interface AIImageInpaintMaskPoint {
  x: number;
  y: number;
}

export interface AIImageInpaintMaskStroke {
  id: string;
  tool: AIImageInpaintTool;
  brushSize: number;
  points: AIImageInpaintMaskPoint[];
}

export type AIImageInpaintMaskSourceInfo = ImageSourceInfo;

export interface AIImageInpaintMaskDraftState {
  hasMarks: boolean;
  dirty: boolean;
  sourceInfo: AIImageInpaintMaskSourceInfo | null;
}

export interface AIImageInpaintMaskDraft {
  draftStrokes: AIImageInpaintMaskStroke[];
  dirty: boolean;
  hasMarks: boolean;
  sourceInfo: AIImageInpaintMaskSourceInfo | null;
}

export interface AIImageInpaintMaskSnapshot {
  strokes: AIImageInpaintMaskStroke[];
  sourceInfo: AIImageInpaintMaskSourceInfo;
  hasMarks: boolean;
  dirty: boolean;
}

export interface NodeReference {
  id: string;
  nodeId: string;
  fileId: string;
  type: 'single' | 'group';
  order: number;
}

export interface FileGroup {
  id: string;
  name: string;
  fileIds: string[];
  thumbnailUrl?: string;
}

export interface AIConfig {
  model?: string;
  prompt?: string;
  negativePrompt?: string;
  steps?: number;
  seed?: number;
  width?: number;
  height?: number;
  cfgScale?: number;
  sampler?: string;
  inputGroups?: AIImageInputGroup[];
  stylePreset?: string;
  aspectRatio?: string;
  imageSize?: string;
  quality?: string;
  resolutionPreset?: string;
  outputCount?: number;
  editorHeight?: number;
  maskMode?: string;
  hasMaskMarks?: boolean;
  /**
   * Persisted restore snapshot for the inpaint editor.
   * Live brush edits are kept in the editor draft and committed explicitly.
   */
  maskStrokes?: AIImageInpaintMaskStroke[];
  maskSourceFileId?: string;
  maskSourceWidth?: number;
  maskSourceHeight?: number;
  [key: string]: unknown;
}

export type StoryboardShotMediaStatus = 'idle' | 'generating' | 'completed' | 'failed';
export type StoryboardViewMode = 'list' | 'grid' | 'table';

export interface StoryboardPersistedShotData {
  id: string;
  order: number;
  row: number;
  col: number;
  originalIndex?: number;
  originalTotal?: number;
  sourceNodeId?: string;
  sourceFileId?: string;
  sourceImageFileId?: string;
  imageFileId?: string;
  videoFileId?: string;
  prompt: string;
  imageModel: string;
  imageAspectRatio: string;
  imageSize: string;
  videoModel: string;
  videoDuration: StoryboardVideoDuration;
  videoAspectRatio?: string;
  videoResolution?: string;
  /**
   * Legacy compatibility only. New saves strip execution-only fields from
   * storyboard shots and keep live execution state in the runtime store.
   */
  imageGenStatus?: StoryboardShotMediaStatus;
  imageGenMessage?: string;
  imageGenRunId?: string;
  videoGenStatus?: StoryboardShotMediaStatus;
  videoProgress?: number;
  videoError?: string;
  videoRunId?: string;
}

export interface StoryboardShotRuntimeState {
  imageGenStatus: StoryboardShotMediaStatus;
  imageGenMessage?: string;
  imageGenRunId?: string;
  videoGenStatus: StoryboardShotMediaStatus;
  videoProgress?: number;
  videoError?: string;
  videoRunId?: string;
}

export type StoryboardShotData = StoryboardPersistedShotData & StoryboardShotRuntimeState;

export type StoryboardCreationType = 'architecture' | 'product' | 'narrative' | 'custom';
export type StoryboardVideoDuration = 4 | 6 | 8;

export interface StoryboardConfig extends AIConfig {
  shots: StoryboardPersistedShotData[];
  viewMode: StoryboardViewMode;
  creationType?: StoryboardCreationType;
  defaultImageModel: string;
  defaultImageAspectRatio: string;
  defaultImageSize: string;
  batchVideoModel: string;
  batchVideoDuration: StoryboardVideoDuration;
  batchVideoAspectRatio: string;
  batchVideoResolution: string;
  processedInputFileIds: string[];
}

export type AnyNodeData = FileNodeData | AINodeData;
export type WorkflowNode = RFNode<AnyNodeData>;

export interface NodeRegistryEntry {
  type: NodeType;
  displayName: string;
  icon: string;
  color: string;
  factory: (id: NodeId, position: Position) => AnyNodeData;
  validator: (data: unknown) => boolean;
}

export interface NodeTypeInfo {
  type: NodeType;
  displayName: string;
  icon: string;
  color: string;
  category: 'file' | 'ai';
}

export interface NodeOperationResult {
  success: boolean;
  node?: AnyNodeData;
  error?: string;
}

export interface NodeIdGeneratorResult {
  success: boolean;
  nodeId?: NodeId;
  error?: string;
}

export interface NodeIdGenerator {
  next(): NodeIdGeneratorResult;
  release(id: string): void;
  getLastIssued(): number;
  getAvailableCount(): number;
  isExhausted(): boolean;
}

export interface RepulsionConfig {
  enabled: boolean;
  minDistance: number;
  animationDuration: number;
}
