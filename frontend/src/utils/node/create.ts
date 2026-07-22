/**
 * Node creation utilities.
 * @module utils/node/create
 */

import type { Dimensions, NodeId, Position } from '@/types/base.types';
import type {
  AIConfig,
  AIImageInputGroup,
  AINodeData,
  AnyNodeData,
  FileGroup,
  FileNodeData,
  NodeReference,
  StoryboardConfig,
} from '@/types/node.types';
import type { FileMetadata, FileSource } from '@/types/file.types';
import { createEmptyImageAsset } from '@/services/image/image-asset';
import { createLocalImportFileSource } from '@/services/file/file-service';
import { PREVIEW_SIZE_1080P, MAX_FILE_REFERENCES, MAX_GROUP_FILES } from '@/constants/file.constants';
import { createGroupPortHandle, parseGroupPortHandle } from '@/nodes/shared/group-port-handle';
import {
  AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_DEFAULT_SIZE,
} from '@/nodes/ai-image-inpaint/constants';
import {
  AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_DEFAULT_MODEL,
  AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  resolveAIVideoGenSize,
} from '@/nodes/ai-video-gen/constants';
import { isAINodeData } from './type-guards';

const DEFAULT_NODE_CREATION_SCALE = 2;
const DEFAULT_NODE_CREATION_AREA_SCALE = DEFAULT_NODE_CREATION_SCALE * DEFAULT_NODE_CREATION_SCALE;

function scaleNodeCreationDimensions(dimensions: Dimensions): Dimensions {
  return {
    width: Math.max(1, Math.round(dimensions.width * DEFAULT_NODE_CREATION_SCALE)),
    height: Math.max(1, Math.round(dimensions.height * DEFAULT_NODE_CREATION_SCALE)),
  };
}

const DEFAULT_FILE_NODE_BASE_DIMENSIONS: Dimensions = {
  width: Math.max(220, PREVIEW_SIZE_1080P.width + 100),
  height: Math.max(160, PREVIEW_SIZE_1080P.height + 92),
};

const DEFAULT_MEDIA_NODE_ASPECT_RATIO = PREVIEW_SIZE_1080P.width / PREVIEW_SIZE_1080P.height;
const DEFAULT_FILE_NODE_DIMENSIONS = scaleNodeCreationDimensions(DEFAULT_FILE_NODE_BASE_DIMENSIONS);
const DEFAULT_MEDIA_NODE_AREA =
  DEFAULT_FILE_NODE_BASE_DIMENSIONS.width * DEFAULT_FILE_NODE_BASE_DIMENSIONS.height * DEFAULT_NODE_CREATION_AREA_SCALE;
const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_AI_IMAGE_ASPECT_RATIO = '1:1';
const DEFAULT_AI_IMAGE_RESOLUTION = '1024x1024';
const DEFAULT_AI_IMAGE_SIZE = '1K';
const DEFAULT_STORYBOARD_VIEW_MODE = 'list' as const;
const DEFAULT_STORYBOARD_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_STORYBOARD_IMAGE_ASPECT_RATIO = 'auto' as const;
const DEFAULT_STORYBOARD_IMAGE_SIZE = DEFAULT_AI_IMAGE_SIZE;
const DEFAULT_STORYBOARD_VIDEO_MODEL = AI_VIDEO_GEN_DEFAULT_MODEL;
const DEFAULT_STORYBOARD_VIDEO_DURATION = AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS;
const DEFAULT_STORYBOARD_VIDEO_ASPECT_RATIO = AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
const DEFAULT_STORYBOARD_VIDEO_RESOLUTION = AI_VIDEO_GEN_DEFAULT_RESOLUTION;
const DEFAULT_AI_GROUP_LIMIT = 10;
const AI_IMAGE_INPUT_PORT_ID = 'images';
const AI_IMAGE_RESULT_PORT_ID = 'result';

function isValidMediaDimension(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveAuthoritativeImageSize(
  fileNode: FileNodeData,
): Pick<FileMetadata, 'width' | 'height'> | null {
  if (fileNode.type !== 'image') {
    return null;
  }

  const candidates: Array<Pick<FileMetadata, 'width' | 'height'> | undefined> = [
    fileNode.imageAsset?.intrinsicSize,
    fileNode.imageAsset?.variants.original,
    fileNode.metadata,
  ];

  for (const candidate of candidates) {
    if (isValidMediaDimension(candidate?.width) && isValidMediaDimension(candidate?.height)) {
      return {
        width: candidate.width,
        height: candidate.height,
      };
    }
  }

  return null;
}

function createAIConfigSuperset(overrides: AIConfig = {}): AIConfig {
  return {
    model: DEFAULT_AI_IMAGE_MODEL,
    prompt: '',
    negativePrompt: '',
    steps: 30,
    seed: 0,
    width: 1024,
    height: 1024,
    cfgScale: 7,
    sampler: 'default',
    aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
    imageSize: DEFAULT_AI_IMAGE_SIZE,
    resolutionPreset: DEFAULT_AI_IMAGE_RESOLUTION,
    outputCount: 1,
    strength: 0.75,
    denoise: 0.5,
    cameraCount: 4,
    textureQuality: 'high',
    fps: 24,
    duration: 4,
    ...overrides,
  };
}

function createDefaultStoryboardConfig(): StoryboardConfig {
  return {
    shots: [],
    viewMode: DEFAULT_STORYBOARD_VIEW_MODE,
    defaultImageModel: DEFAULT_STORYBOARD_IMAGE_MODEL,
    defaultImageAspectRatio: DEFAULT_STORYBOARD_IMAGE_ASPECT_RATIO,
    defaultImageSize: DEFAULT_STORYBOARD_IMAGE_SIZE,
    batchVideoModel: DEFAULT_STORYBOARD_VIDEO_MODEL,
    batchVideoDuration: DEFAULT_STORYBOARD_VIDEO_DURATION,
    batchVideoAspectRatio: DEFAULT_STORYBOARD_VIDEO_ASPECT_RATIO,
    batchVideoResolution: DEFAULT_STORYBOARD_VIDEO_RESOLUTION,
    processedInputFileIds: [],
    inputGroups: [createAIImageInputGroup(0)],
  };
}

export function createAIImageInputGroup(order: number, id: string = `group-${order + 1}`): AIImageInputGroup {
  return {
    id,
    label: `Group ${order + 1}`,
    order,
  };
}

export function createDefaultAIInputGroups(count: number = DEFAULT_AI_GROUP_LIMIT): AIImageInputGroup[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => createAIImageInputGroup(index));
}

export function ensureAIImageInputGroups(config: AIConfig | undefined): AIImageInputGroup[] {
  const rawGroups = Array.isArray(config?.inputGroups) ? config.inputGroups : [];

  if (rawGroups.length === 0) {
    return [createAIImageInputGroup(0)];
  }

  return rawGroups.map((group, index) => ({
    id: typeof group.id === 'string' && group.id.length > 0 ? group.id : `group-${index + 1}`,
    label: typeof group.label === 'string' && group.label.length > 0 ? group.label : `Group ${index + 1}`,
    order: typeof group.order === 'number' && Number.isFinite(group.order) ? group.order : index,
  }));
}

export function normalizeAIImageGenInputHandle(
  handle: string | undefined,
  config: AIConfig | undefined
): string | undefined {
  const defaultGroupId = ensureAIImageInputGroups(config)[0]?.id;
  if (!handle) {
    return defaultGroupId ? createGroupPortHandle(defaultGroupId, AI_IMAGE_INPUT_PORT_ID) : undefined;
  }

  const parsedHandle = parseGroupPortHandle(handle);
  if (parsedHandle) {
    return parsedHandle.portId === AI_IMAGE_INPUT_PORT_ID
      ? handle
      : createGroupPortHandle(parsedHandle.groupId, AI_IMAGE_INPUT_PORT_ID);
  }

  return createGroupPortHandle(handle, AI_IMAGE_INPUT_PORT_ID);
}

export function normalizeAIImageGenOutputHandle(
  handle: string | undefined,
  config: AIConfig | undefined
): string | undefined {
  const defaultGroupId = ensureAIImageInputGroups(config)[0]?.id;
  if (!handle) {
    return defaultGroupId ? createGroupPortHandle(defaultGroupId, AI_IMAGE_RESULT_PORT_ID) : undefined;
  }

  const parsedHandle = parseGroupPortHandle(handle);
  if (parsedHandle) {
    return parsedHandle.portId === AI_IMAGE_RESULT_PORT_ID
      ? handle
      : createGroupPortHandle(parsedHandle.groupId, AI_IMAGE_RESULT_PORT_ID);
  }

  return createGroupPortHandle(handle, AI_IMAGE_RESULT_PORT_ID);
}

export function ensureFixedAIInputGroups(
  config: AIConfig | undefined,
  count: number = DEFAULT_AI_GROUP_LIMIT
): AIImageInputGroup[] {
  const normalized = ensureAIImageInputGroups(config);

  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const existing = normalized[index];
    return {
      id: existing?.id ?? `group-${index + 1}`,
      label: existing?.label ?? `Group ${index + 1}`,
      order: index,
    };
  });
}

export function calculateFileNodeDimensions(
  fileType: 'image' | 'video' | 'ply',
  metadata: Pick<FileMetadata, 'width' | 'height'> = {},
  targetArea: number = DEFAULT_MEDIA_NODE_AREA
): Dimensions {
  if (fileType === 'ply') {
    return { ...DEFAULT_FILE_NODE_DIMENSIONS };
  }

  const safeArea = Math.max(targetArea, 1);
  const hasValidSize =
    typeof metadata.width === 'number' &&
    metadata.width > 0 &&
    typeof metadata.height === 'number' &&
    metadata.height > 0;
  const sourceWidth: number = hasValidSize ? metadata.width as number : PREVIEW_SIZE_1080P.width;
  const sourceHeight: number = hasValidSize ? metadata.height as number : PREVIEW_SIZE_1080P.height;

  const aspectRatio = sourceWidth / sourceHeight || DEFAULT_MEDIA_NODE_ASPECT_RATIO;

  return {
    width: Math.max(1, Math.round(Math.sqrt(safeArea * aspectRatio))),
    height: Math.max(1, Math.round(Math.sqrt(safeArea / aspectRatio))),
  };
}

export function buildFileNodeMediaLayoutPatch(
  fileNode: FileNodeData,
  width: number,
  height: number,
  duration?: number,
): Partial<FileNodeData> | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  const authoritativeImageSize = resolveAuthoritativeImageSize(fileNode);
  const layoutWidth = authoritativeImageSize?.width ?? width;
  const layoutHeight = authoritativeImageSize?.height ?? height;
  const currentArea = Math.max(fileNode.dimensions.width * fileNode.dimensions.height, 1);
  const nextDimensions = calculateFileNodeDimensions(fileNode.type, {
    width: layoutWidth,
    height: layoutHeight,
  }, currentArea);
  const normalizedDuration =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : undefined;

  const shouldUpdateDimensions =
    nextDimensions.width !== fileNode.dimensions.width ||
    nextDimensions.height !== fileNode.dimensions.height;

  const shouldUpdateMetadata =
    fileNode.metadata.width !== layoutWidth ||
    fileNode.metadata.height !== layoutHeight ||
    (normalizedDuration !== undefined && fileNode.metadata.duration !== normalizedDuration);

  if (!shouldUpdateDimensions && !shouldUpdateMetadata) {
    return null;
  }

  return {
    ...(shouldUpdateDimensions ? { dimensions: nextDimensions } : {}),
    ...(shouldUpdateMetadata
      ? {
        metadata: {
          ...fileNode.metadata,
          width: layoutWidth,
          height: layoutHeight,
          ...(normalizedDuration !== undefined ? { duration: normalizedDuration } : {}),
        },
      }
      : {}),
  };
}

export function createDefaultFileNodeData(
  id: NodeId,
  position: Position,
  fileType: 'image' | 'video' | 'ply',
  fileId: string,
  fileName: string,
  fileSize: number,
  mimeType: string,
  metadata: FileMetadata = {},
  source?: FileSource
): FileNodeData {
  const now = Date.now();
  const resolvedSource = source ?? createLocalImportFileSource({
    sourceDisplayName: fileName,
    localSource: {
      status: 'runtime-only',
    },
    importedAt: now,
  });
  return {
    id,
    type: fileType,
    position,
    dimensions: calculateFileNodeDimensions(fileType, metadata),
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId,
    fileName,
    fileSize,
    mimeType,
    source: resolvedSource,
    imageAsset: fileType === 'image' ? createEmptyImageAsset(fileId, metadata) : undefined,
    metadata,
  };
}

export function createSequentialNodeId(sequence: number): NodeId {
  return {
    value: String(sequence),
    display: `#${String(sequence).padStart(5, '0')}`,
  };
}

export function createDefaultAINodeData(
  id: NodeId,
  position: Position,
  aiType: AINodeData['type']
): AINodeData {
  const now = Date.now();
  const defaultDimensions = aiType === 'aiImageInpaint'
    ? { ...AI_IMAGE_INPAINT_DEFAULT_SIZE }
    : scaleNodeCreationDimensions({ width: 320, height: 296 });

  return {
    id,
    type: aiType,
    position,
    dimensions: defaultDimensions,
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    references: [],
    outputs: [],
    config: getDefaultAIConfig(aiType),
    tasks: [],
  };
}

export function canAddReferenceToNode(node: AnyNodeData): boolean {
  if (!isAINodeData(node)) {
    return false;
  }
  return node.references.length < MAX_FILE_REFERENCES;
}

export function getReferenceCount(node: AnyNodeData): number {
  if (!isAINodeData(node)) {
    return 0;
  }
  return node.references.length;
}

export function getRemainingReferenceSlots(node: AnyNodeData): number {
  if (!isAINodeData(node)) {
    return 0;
  }
  return Math.max(0, MAX_FILE_REFERENCES - node.references.length);
}

export function createNodeReference(
  nodeId: string,
  fileId: string,
  type: 'single' | 'group' = 'single',
  order: number = 0
): NodeReference {
  return {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    nodeId,
    fileId,
    type,
    order,
  };
}

export function createFileGroup(name: string, fileIds: string[]): FileGroup {
  const limitedFileIds = fileIds.slice(0, MAX_GROUP_FILES);
  return {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    name,
    fileIds: limitedFileIds,
  };
}

export function getDefaultAIConfig(type: AINodeData['type']): AIConfig {
  const defaults: Record<AINodeData['type'], AIConfig> = {
    aiImageGen: createAIConfigSuperset({
      quality: 'auto',
      inputGroups: [createAIImageInputGroup(0)],
    }),
    aiImageInpaint: createAIConfigSuperset({
      aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
      imageSize: DEFAULT_AI_IMAGE_SIZE,
      editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
      maskMode: 'original-markup',
      hasMaskMarks: false,
      maskStrokes: [],
      maskSourceFileId: undefined,
      maskSourceWidth: undefined,
      maskSourceHeight: undefined,
      inputGroups: [{ id: 'main', label: '原图', order: 0 }],
    }),
    aiVideoGen: createAIConfigSuperset({
      model: AI_VIDEO_GEN_DEFAULT_MODEL,
      duration: AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
      fps: undefined,
      aspectRatio: AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
      imageSize: undefined,
      resolutionPreset: AI_VIDEO_GEN_DEFAULT_RESOLUTION,
      resolution: AI_VIDEO_GEN_DEFAULT_RESOLUTION,
      size: resolveAIVideoGenSize({
        aspectRatio: AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
        resolution: AI_VIDEO_GEN_DEFAULT_RESOLUTION,
      }) ?? '1280x720',
      camera: undefined,
      lighting: undefined,
      inputGroups: [createAIImageInputGroup(0)],
    }),
    aiImageToPly: createAIConfigSuperset({
      model: 'meshy-ai',
      textureQuality: 'high',
      cameraCount: 4,
      inputGroups: createDefaultAIInputGroups(),
    }),
    aiStoryboard: createDefaultStoryboardConfig(),
    aiMultiViewRestore: createAIConfigSuperset({
      steps: 20,
      denoise: 0.35,
      inputGroups: createDefaultAIInputGroups(),
    }),
    aiModelRenderTransfer: createAIConfigSuperset({
      steps: 30,
      strength: 0.8,
      inputGroups: createDefaultAIInputGroups(),
    }),
    aiImageHd: createAIConfigSuperset({
      steps: 20,
      aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
      imageSize: '1K',
      resolutionPreset: undefined,
      inputGroups: createDefaultAIInputGroups(),
    }),
    aiFloorplanColorize: createAIConfigSuperset({
      steps: 20,
      aspectRatio: DEFAULT_AI_IMAGE_ASPECT_RATIO,
      imageSize: '1K',
      model: DEFAULT_AI_IMAGE_MODEL,
      resolutionPreset: undefined,
      stylePreset: 'three-d-render',
      inputGroups: [createAIImageInputGroup(0)],
    }),
  };

  return defaults[type] ?? {};
}
